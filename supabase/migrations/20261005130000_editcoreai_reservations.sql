-- Reserva previa de saldo: antes de llamar al proveedor, ai-proxy aparta el costo máximo de la respuesta.
-- Con consultas en paralelo o saldo bajo, nadie puede consumir más de lo que tiene.
-- Las reservas viejas (más de 15 minutos, más que cualquier respuesta) ya no cuentan.

create table editcoreai.reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references editcoreai.accounts(user_id) on delete cascade,
  amount numeric(14, 6) not null check (amount >= 0),
  created_at timestamptz not null default now()
);
create index reservations_user_idx on editcoreai.reservations (user_id, created_at);
alter table editcoreai.reservations enable row level security;
grant all on editcoreai.reservations to service_role;

create or replace function public.editcoreai_proxy_reserve(p_user uuid, p_provider_cost numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc editcoreai.accounts;
  v_factor numeric := editcoreai.setting_numeric('panel_usd_rate', 0.02) * editcoreai.setting_numeric('markup', 2);
  v_need numeric;
  v_held numeric;
  v_available numeric;
  v_id uuid;
begin
  if p_provider_cost is null or p_provider_cost < 0 or p_provider_cost > 1000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  perform editcoreai.ensure_account(p_user);
  select * into acc from editcoreai.accounts where user_id = p_user for update;
  if acc.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'ACCOUNT_SUSPENDED');
  end if;
  if acc.is_unlimited or acc.role = 'admin' then
    return jsonb_build_object('ok', true, 'reservation', null);
  end if;
  delete from editcoreai.reservations where user_id = p_user and created_at < now() - interval '15 minutes';
  select coalesce(sum(amount), 0) into v_held from editcoreai.reservations where user_id = p_user;
  v_available := acc.credits_balance - v_held;
  v_need := round(p_provider_cost * v_factor, 6);
  if v_available <= 0 or v_need > v_available then
    return jsonb_build_object(
      'ok', false,
      'error', 'OUT_OF_CREDITS',
      'available_panel', case when v_factor > 0 then round(greatest(v_available, 0) / v_factor, 6) else 0 end
    );
  end if;
  insert into editcoreai.reservations (user_id, amount) values (p_user, v_need) returning id into v_id;
  return jsonb_build_object('ok', true, 'reservation', v_id);
end;
$$;

create or replace function public.editcoreai_proxy_release(p_reservation uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  delete from editcoreai.reservations where id = p_reservation;
  select jsonb_build_object('ok', true);
$$;

drop function if exists public.editcoreai_proxy_charge(uuid, text, integer, integer, integer, numeric);

create or replace function public.editcoreai_proxy_charge(
  p_user uuid,
  p_model text,
  p_tokens_in integer,
  p_tokens_out integer,
  p_cached_tokens integer,
  p_provider_cost numeric,
  p_reservation uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc editcoreai.accounts;
  v_cost numeric := greatest(coalesce(p_provider_cost, 0), 0);
  v_real numeric;
  v_charge numeric := 0;
begin
  if v_cost > 1000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  v_real := round(v_cost * editcoreai.setting_numeric('panel_usd_rate', 0.02), 6);
  perform editcoreai.ensure_account(p_user);
  select * into acc from editcoreai.accounts where user_id = p_user for update;
  if p_reservation is not null then
    delete from editcoreai.reservations where id = p_reservation and user_id = p_user;
  end if;
  if not (acc.is_unlimited or acc.role = 'admin') then
    v_charge := least(round(v_real * editcoreai.setting_numeric('markup', 2), 6), acc.credits_balance);
    update editcoreai.accounts
       set credits_balance = credits_balance - v_charge, updated_at = now()
     where user_id = p_user
    returning * into acc;
  end if;
  insert into editcoreai.credit_transactions
    (user_id, amount, balance_after, kind, model, tokens_in, tokens_out, cached_tokens, provider_cost, real_cost, description)
  values
    (p_user, -v_charge, acc.credits_balance, 'usage', left(p_model, 120),
     greatest(coalesce(p_tokens_in, 0), 0), greatest(coalesce(p_tokens_out, 0), 0),
     greatest(coalesce(p_cached_tokens, 0), 0), v_cost, v_real, 'Uso de IA');
  return jsonb_build_object('ok', true, 'charged', v_charge, 'account', editcoreai.account_json(acc));
end;
$$;

revoke all on function public.editcoreai_proxy_reserve(uuid, numeric) from public, anon, authenticated;
revoke all on function public.editcoreai_proxy_release(uuid) from public, anon, authenticated;
revoke all on function public.editcoreai_proxy_charge(uuid, text, integer, integer, integer, numeric, uuid) from public, anon, authenticated;
grant execute on function public.editcoreai_proxy_reserve(uuid, numeric) to service_role;
grant execute on function public.editcoreai_proxy_release(uuid) to service_role;
grant execute on function public.editcoreai_proxy_charge(uuid, text, integer, integer, integer, numeric, uuid) to service_role;
