-- EditCoreAI: cuentas, créditos y códigos de recarga.
-- Servidor Supabase propio de EditCoreAI (no compartido con otros proyectos).
-- Las tablas no tienen acceso directo desde la app: solo las funciones public.editcoreai_*.

create schema if not exists editcoreai;
revoke all on schema editcoreai from public, anon, authenticated;
grant usage on schema editcoreai to service_role;

create table editcoreai.accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  plan text not null default 'free',
  status text not null default 'active' check (status in ('active', 'suspended')),
  credits_balance numeric(14, 2) not null default 0 check (credits_balance >= 0),
  is_unlimited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_email_idx on editcoreai.accounts (lower(email));

create table editcoreai.credit_transactions (
  id bigserial primary key,
  user_id uuid not null references editcoreai.accounts(user_id) on delete cascade,
  amount numeric(14, 2) not null,
  balance_after numeric(14, 2) not null,
  kind text not null check (kind in ('usage', 'voucher', 'admin_grant', 'purchase', 'refund')),
  model text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  description text,
  created_at timestamptz not null default now()
);
create index credit_transactions_user_idx on editcoreai.credit_transactions (user_id, created_at desc);

create table editcoreai.vouchers (
  code_hash text primary key,
  credits numeric(14, 2) not null check (credits > 0),
  max_uses integer not null default 1 check (max_uses > 0),
  uses integer not null default 0,
  expires_at timestamptz,
  note text,
  created_by uuid references editcoreai.accounts(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table editcoreai.voucher_redemptions (
  code_hash text not null references editcoreai.vouchers(code_hash) on delete cascade,
  user_id uuid not null references editcoreai.accounts(user_id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code_hash, user_id)
);

create table editcoreai.voucher_failures (
  id bigserial primary key,
  user_id uuid not null references editcoreai.accounts(user_id) on delete cascade,
  at timestamptz not null default now()
);
create index voucher_failures_user_idx on editcoreai.voucher_failures (user_id, at desc);

alter table editcoreai.accounts enable row level security;
alter table editcoreai.credit_transactions enable row level security;
alter table editcoreai.vouchers enable row level security;
alter table editcoreai.voucher_redemptions enable row level security;
alter table editcoreai.voucher_failures enable row level security;

grant all on all tables in schema editcoreai to service_role;
grant usage, select on all sequences in schema editcoreai to service_role;

-- Internas (no expuestas)

create or replace function editcoreai.ensure_account(p_uid uuid)
returns editcoreai.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc editcoreai.accounts;
  v_email text;
begin
  select * into acc from editcoreai.accounts where user_id = p_uid;
  if found then
    return acc;
  end if;
  select email into v_email from auth.users where id = p_uid;
  if v_email is null then
    raise exception 'USER_NOT_FOUND';
  end if;
  insert into editcoreai.accounts (user_id, email) values (p_uid, lower(v_email))
  on conflict (user_id) do nothing;
  select * into acc from editcoreai.accounts where user_id = p_uid;
  return acc;
end;
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
    'is_unlimited', acc.is_unlimited
  );
$$;

create or replace function editcoreai.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NO_SESSION' using errcode = '28000';
  end if;
  return uid;
end;
$$;

create or replace function editcoreai.require_admin()
returns editcoreai.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc editcoreai.accounts := editcoreai.ensure_account(editcoreai.require_uid());
begin
  if acc.role <> 'admin' or acc.status <> 'active' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return acc;
end;
$$;

revoke all on all functions in schema editcoreai from public, anon, authenticated;

-- API para la app (solo usuarios con sesión)

create or replace function public.editcoreai_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return editcoreai.account_json(editcoreai.ensure_account(editcoreai.require_uid()));
end;
$$;

create or replace function public.editcoreai_consume_credits(
  p_amount numeric,
  p_model text default null,
  p_tokens_in integer default 0,
  p_tokens_out integer default 0,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := editcoreai.require_uid();
  acc editcoreai.accounts;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 10000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  perform editcoreai.ensure_account(uid);
  select * into acc from editcoreai.accounts where user_id = uid for update;
  if acc.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'ACCOUNT_SUSPENDED', 'account', editcoreai.account_json(acc));
  end if;
  if acc.is_unlimited or acc.role = 'admin' then
    insert into editcoreai.credit_transactions (user_id, amount, balance_after, kind, model, tokens_in, tokens_out, description)
    values (uid, 0, acc.credits_balance, 'usage', left(p_model, 120), greatest(coalesce(p_tokens_in, 0), 0), greatest(coalesce(p_tokens_out, 0), 0), left(p_description, 300));
    return jsonb_build_object('ok', true, 'deducted', 0, 'account', editcoreai.account_json(acc));
  end if;
  if acc.credits_balance < p_amount then
    return jsonb_build_object('ok', false, 'error', 'OUT_OF_CREDITS', 'required', p_amount, 'account', editcoreai.account_json(acc));
  end if;
  update editcoreai.accounts
     set credits_balance = credits_balance - p_amount, updated_at = now()
   where user_id = uid
  returning * into acc;
  insert into editcoreai.credit_transactions (user_id, amount, balance_after, kind, model, tokens_in, tokens_out, description)
  values (uid, -p_amount, acc.credits_balance, 'usage', left(p_model, 120), greatest(coalesce(p_tokens_in, 0), 0), greatest(coalesce(p_tokens_out, 0), 0), left(p_description, 300));
  return jsonb_build_object('ok', true, 'deducted', p_amount, 'account', editcoreai.account_json(acc));
end;
$$;

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
     set credits_balance = credits_balance + v.credits, updated_at = now()
   where user_id = uid
  returning * into acc;
  insert into editcoreai.credit_transactions (user_id, amount, balance_after, kind, description)
  values (uid, v.credits, acc.credits_balance, 'voucher', 'Código de recarga');
  return jsonb_build_object('ok', true, 'credits_added', v.credits, 'account', editcoreai.account_json(acc));
end;
$$;

-- API de administración (solo cuentas con rol admin en esta base)

create or replace function public.editcoreai_admin_create_voucher(
  p_credits numeric,
  p_max_uses integer default 1,
  p_expires_at timestamptz default null,
  p_note text default null,
  p_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if p_credits is null or p_credits <= 0 or p_credits > 1000000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  if v_code = '' then
    v_code := upper(encode(extensions.gen_random_bytes(10), 'hex'));
  elsif length(v_code) < 12 then
    raise exception 'CODE_TOO_SHORT' using errcode = '22023';
  end if;
  insert into editcoreai.vouchers (code_hash, credits, max_uses, expires_at, note, created_by)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), p_credits, greatest(coalesce(p_max_uses, 1), 1), p_expires_at, left(p_note, 300), admin_acc.user_id);
  return jsonb_build_object('ok', true, 'code', v_code, 'credits', p_credits, 'max_uses', greatest(coalesce(p_max_uses, 1), 1), 'expires_at', p_expires_at);
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
     set credits_balance = credits_balance + v_delta, updated_at = now()
   where user_id = v_uid
  returning * into acc;
  insert into editcoreai.credit_transactions (user_id, amount, balance_after, kind, description)
  values (v_uid, v_delta, acc.credits_balance, 'admin_grant', coalesce(left(p_note, 300), 'Ajuste de administrador ' || admin_acc.email));
  return jsonb_build_object('ok', true, 'account', editcoreai.account_json(acc));
end;
$$;

create or replace function public.editcoreai_admin_set_status(p_email text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
  v_uid uuid;
  acc editcoreai.accounts;
begin
  if p_status not in ('active', 'suspended') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if v_uid = admin_acc.user_id then
    return jsonb_build_object('ok', false, 'error', 'CANNOT_CHANGE_SELF');
  end if;
  perform editcoreai.ensure_account(v_uid);
  update editcoreai.accounts set status = p_status, updated_at = now() where user_id = v_uid returning * into acc;
  return jsonb_build_object('ok', true, 'account', editcoreai.account_json(acc));
end;
$$;

revoke all on function public.editcoreai_my_account() from public, anon;
revoke all on function public.editcoreai_consume_credits(numeric, text, integer, integer, text) from public, anon;
revoke all on function public.editcoreai_redeem_voucher(text) from public, anon;
revoke all on function public.editcoreai_admin_create_voucher(numeric, integer, timestamptz, text, text) from public, anon;
revoke all on function public.editcoreai_admin_grant_credits(text, numeric, text) from public, anon;
revoke all on function public.editcoreai_admin_set_status(text, text) from public, anon;

grant execute on function public.editcoreai_my_account() to authenticated;
grant execute on function public.editcoreai_consume_credits(numeric, text, integer, integer, text) to authenticated;
grant execute on function public.editcoreai_redeem_voucher(text) to authenticated;
grant execute on function public.editcoreai_admin_create_voucher(numeric, integer, timestamptz, text, text) to authenticated;
grant execute on function public.editcoreai_admin_grant_credits(text, numeric, text) to authenticated;
grant execute on function public.editcoreai_admin_set_status(text, text) to authenticated;
