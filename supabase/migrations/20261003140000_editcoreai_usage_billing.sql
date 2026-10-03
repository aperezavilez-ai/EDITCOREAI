-- EditCoreAI: saldo en dólares que se consume según los tokens reales de cada consulta.
-- Las consultas de los usuarios pasan por la función ai-proxy del servidor; solo ella cobra (service_role).
-- credits_balance pasa a significar dólares (USD) con 6 decimales.
-- topup_base = saldo justo después de la última recarga; la barra de uso es (topup_base - saldo) / topup_base.

alter table editcoreai.accounts alter column credits_balance type numeric(14, 6);
alter table editcoreai.accounts add column if not exists topup_base numeric(14, 6) not null default 0;
update editcoreai.accounts set topup_base = credits_balance where topup_base = 0 and credits_balance > 0;

alter table editcoreai.credit_transactions alter column amount type numeric(14, 6);
alter table editcoreai.credit_transactions alter column balance_after type numeric(14, 6);
alter table editcoreai.credit_transactions add column if not exists provider_cost numeric(14, 6) not null default 0;
alter table editcoreai.credit_transactions add column if not exists cached_tokens integer not null default 0;

create table if not exists editcoreai.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table editcoreai.settings enable row level security;
grant all on editcoreai.settings to service_role;

-- markup: cuánto paga el usuario por cada dólar que cobra el proveedor.
-- allowed_models: null = todos los modelos de chat del proveedor; o una lista de nombres.
insert into editcoreai.settings (key, value) values
  ('markup', '2'::jsonb),
  ('allowed_models', 'null'::jsonb)
on conflict (key) do nothing;

create or replace function editcoreai.setting_numeric(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::numeric from editcoreai.settings where key = p_key), p_default);
$$;

create or replace function editcoreai.account_json(acc editcoreai.accounts)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', acc.user_id,
    'email', acc.email,
    'role', acc.role,
    'plan', acc.plan,
    'status', acc.status,
    'credits_balance', acc.credits_balance,
    'topup_base', acc.topup_base,
    'is_unlimited', acc.is_unlimited
  );
$$;

-- El cliente ya no puede descontarse saldo: solo el servidor (ai-proxy) cobra.
revoke execute on function public.editcoreai_consume_credits(numeric, text, integer, integer, text) from authenticated;

-- Solo para ai-proxy (service_role)

create or replace function public.editcoreai_proxy_account(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc editcoreai.accounts := editcoreai.ensure_account(p_user);
begin
  return editcoreai.account_json(acc) || jsonb_build_object(
    'markup', editcoreai.setting_numeric('markup', 2),
    'allowed_models', (select value from editcoreai.settings where key = 'allowed_models')
  );
end;
$$;

create or replace function public.editcoreai_proxy_charge(
  p_user uuid,
  p_model text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_cached_tokens integer,
  p_provider_cost numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc editcoreai.accounts;
  v_cost numeric := greatest(coalesce(p_provider_cost, 0), 0);
  v_charge numeric := 0;
begin
  if v_cost > 1000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  perform editcoreai.ensure_account(p_user);
  select * into acc from editcoreai.accounts where user_id = p_user for update;
  if not (acc.is_unlimited or acc.role = 'admin') then
    v_charge := least(round(v_cost * editcoreai.setting_numeric('markup', 2), 6), acc.credits_balance);
    update editcoreai.accounts
       set credits_balance = credits_balance - v_charge, updated_at = now()
     where user_id = p_user
    returning * into acc;
  end if;
  insert into editcoreai.credit_transactions
    (user_id, amount, balance_after, kind, model, tokens_in, tokens_out, cached_tokens, provider_cost, description)
  values
    (p_user, -v_charge, acc.credits_balance, 'usage', left(p_model, 120),
     greatest(coalesce(p_tokens_in, 0), 0), greatest(coalesce(p_tokens_out, 0), 0),
     greatest(coalesce(p_cached_tokens, 0), 0), v_cost, 'Uso de IA');
  return jsonb_build_object('ok', true, 'charged', v_charge, 'account', editcoreai.account_json(acc));
end;
$$;

revoke all on function public.editcoreai_proxy_account(uuid) from public, anon, authenticated;
revoke all on function public.editcoreai_proxy_charge(uuid, text, integer, integer, integer, numeric) from public, anon, authenticated;
grant execute on function public.editcoreai_proxy_account(uuid) to service_role;
grant execute on function public.editcoreai_proxy_charge(uuid, text, integer, integer, integer, numeric) to service_role;

-- Recargas: cada recarga reinicia la barra de uso (topup_base = saldo nuevo).

create or replace function public.editcoreai_redeem_voucher(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := editcoreai.require_uid();
  acc editcoreai.accounts := editcoreai.ensure_account(uid);
  v editcoreai.vouchers;
  v_hash text := encode(extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'), 'hex');
  v_error text;
begin
  if acc.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'ACCOUNT_SUSPENDED');
  end if;
  if (select count(*) from editcoreai.voucher_failures where user_id = uid and at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;
  select * into v from editcoreai.vouchers where code_hash = v_hash for update;
  if not found then
    v_error := 'INVALID_CODE';
  elsif v.expires_at is not null and v.expires_at < now() then
    v_error := 'EXPIRED';
  elsif v.uses >= v.max_uses then
    v_error := 'USED_UP';
  elsif exists (select 1 from editcoreai.voucher_redemptions where code_hash = v_hash and user_id = uid) then
    v_error := 'ALREADY_REDEEMED';
  end if;
  if v_error is not null then
    insert into editcoreai.voucher_failures (user_id) values (uid);
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;
  insert into editcoreai.voucher_redemptions (code_hash, user_id) values (v_hash, uid);
  update editcoreai.vouchers set uses = uses + 1 where code_hash = v_hash;
  update editcoreai.accounts
     set credits_balance = credits_balance + v.credits,
         topup_base = credits_balance + v.credits,
         updated_at = now()
   where user_id = uid
  returning * into acc;
  insert into editcoreai.credit_transactions (user_id, amount, balance_after, kind, description)
  values (uid, v.credits, acc.credits_balance, 'voucher', 'Código de recarga');
  return jsonb_build_object('ok', true, 'credits_added', v.credits, 'account', editcoreai.account_json(acc));
end;
$$;

create or replace function public.editcoreai_admin_grant_credits(p_email text, p_amount numeric, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
  v_uid uuid;
  acc editcoreai.accounts;
  v_delta numeric;
begin
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  perform editcoreai.ensure_account(v_uid);
  select * into acc from editcoreai.accounts where user_id = v_uid for update;
  v_delta := greatest(p_amount, -acc.credits_balance);
  update editcoreai.accounts
     set credits_balance = credits_balance + v_delta,
         topup_base = case when v_delta > 0 then credits_balance + v_delta
                           else greatest(topup_base + v_delta, credits_balance + v_delta) end,
         updated_at = now()
   where user_id = v_uid
  returning * into acc;
  insert into editcoreai.credit_transactions (user_id, amount, balance_after, kind, description)
  values (v_uid, v_delta, acc.credits_balance, 'admin_grant', coalesce(left(p_note, 300), 'Ajuste de administrador ' || admin_acc.email));
  return jsonb_build_object('ok', true, 'account', editcoreai.account_json(acc));
end;
$$;

-- Panel de administración: incluye lo que te cobra el proveedor y lo que cobras a los usuarios.

create or replace function public.editcoreai_admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
begin
  return jsonb_build_object(
    'users_total', (select count(*) from editcoreai.accounts),
    'users_active', (select count(*) from editcoreai.accounts where status = 'active'),
    'users_suspended', (select count(*) from editcoreai.accounts where status = 'suspended'),
    'credits_in_circulation', (select coalesce(sum(credits_balance), 0) from editcoreai.accounts where not is_unlimited and role <> 'admin'),
    'credits_consumed_total', (select coalesce(-sum(amount), 0) from editcoreai.credit_transactions where kind = 'usage'),
    'credits_consumed_today', (select coalesce(-sum(amount), 0) from editcoreai.credit_transactions where kind = 'usage' and created_at >= date_trunc('day', now())),
    'provider_cost_today', (select coalesce(sum(provider_cost), 0) from editcoreai.credit_transactions where kind = 'usage' and created_at >= date_trunc('day', now())),
    'provider_cost_total', (select coalesce(sum(provider_cost), 0) from editcoreai.credit_transactions where kind = 'usage'),
    'requests_today', (select count(*) from editcoreai.credit_transactions where kind = 'usage' and created_at >= date_trunc('day', now())),
    'vouchers_active', (select count(*) from editcoreai.vouchers where uses < max_uses and (expires_at is null or expires_at > now())),
    'markup', editcoreai.setting_numeric('markup', 2)
  );
end;
$$;

create or replace function public.editcoreai_my_transactions(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := editcoreai.require_uid();
begin
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
      from (
        select amount, balance_after, kind, model, tokens_in, tokens_out, description, created_at
          from editcoreai.credit_transactions
         where user_id = uid
         order by created_at desc
         limit least(greatest(coalesce(p_limit, 20), 1), 100)
      ) t
  ), '[]'::jsonb);
end;
$$;
