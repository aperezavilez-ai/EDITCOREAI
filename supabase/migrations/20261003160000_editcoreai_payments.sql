-- EditCoreAI: recargas pagadas con Mercado Pago.
-- La función payments (Deno) crea el pago pendiente y la preferencia de Mercado Pago; el aviso de
-- Mercado Pago (webhook) se confirma consultando el pago en su API y solo entonces se acredita.
-- Un mismo pago de Mercado Pago no puede acreditarse dos veces (mp_payment_id único + estado).

create table if not exists editcoreai.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references editcoreai.accounts(user_id) on delete cascade,
  amount_local numeric(14, 2) not null check (amount_local > 0),
  currency text not null,
  credit_usd numeric(14, 6) not null check (credit_usd > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  mp_preference_id text,
  mp_payment_id text unique,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists payments_user_idx on editcoreai.payments (user_id, created_at desc);
create index if not exists payments_status_idx on editcoreai.payments (status, created_at desc);
alter table editcoreai.payments enable row level security;
grant all on editcoreai.payments to service_role;

-- topup_price: lo que paga el usuario en la moneda de la cuenta de Mercado Pago.
-- topup_credit_usd: saldo en dólares que recibe por esa recarga.
insert into editcoreai.settings (key, value) values
  ('topup_price', '399'::jsonb),
  ('topup_currency', '"MXN"'::jsonb),
  ('topup_credit_usd', '20'::jsonb)
on conflict (key) do nothing;

create or replace function editcoreai.setting_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value #>> '{}' from editcoreai.settings where key = p_key), p_default);
$$;
revoke all on function editcoreai.setting_text(text, text) from public, anon, authenticated;

create or replace function editcoreai.topup_offer_json()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'price', editcoreai.setting_numeric('topup_price', 399),
    'currency', editcoreai.setting_text('topup_currency', 'MXN'),
    'credit_usd', editcoreai.setting_numeric('topup_credit_usd', 20)
  );
$$;
revoke all on function editcoreai.topup_offer_json() from public, anon, authenticated;

-- Solo la función payments (service_role)

create or replace function public.editcoreai_payment_create(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc editcoreai.accounts;
  offer jsonb := editcoreai.topup_offer_json();
  pay editcoreai.payments;
begin
  select * into acc from editcoreai.accounts where user_id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_ACCOUNT');
  end if;
  if acc.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'ACCOUNT_SUSPENDED');
  end if;
  if (select count(*) from editcoreai.payments where user_id = p_user and created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;
  insert into editcoreai.payments (user_id, amount_local, currency, credit_usd)
  values (p_user, (offer->>'price')::numeric, offer->>'currency', (offer->>'credit_usd')::numeric)
  returning * into pay;
  return jsonb_build_object(
    'ok', true,
    'id', pay.id,
    'email', acc.email,
    'amount', pay.amount_local,
    'currency', pay.currency,
    'credit_usd', pay.credit_usd
  );
end;
$$;

create or replace function public.editcoreai_payment_set_preference(p_id uuid, p_preference text)
returns void
language sql
security definer
set search_path = ''
as $$
  update editcoreai.payments set mp_preference_id = p_preference where id = p_id and status = 'pending';
$$;

-- p_status: estado del pago según la API de Mercado Pago (approved, rejected, cancelled, pending…).
create or replace function public.editcoreai_payment_settle(
  p_id uuid,
  p_mp_payment_id text,
  p_status text,
  p_amount numeric,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay editcoreai.payments;
  acc editcoreai.accounts;
begin
  select * into pay from editcoreai.payments where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_PAYMENT');
  end if;
  if pay.status = 'approved' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if p_status in ('rejected', 'cancelled') then
    update editcoreai.payments set status = p_status where id = p_id;
    return jsonb_build_object('ok', true, 'status', p_status);
  end if;
  if p_status <> 'approved' then
    return jsonb_build_object('ok', true, 'status', 'pending');
  end if;
  if upper(coalesce(p_currency, '')) <> upper(pay.currency) or coalesce(p_amount, 0) < pay.amount_local then
    return jsonb_build_object('ok', false, 'error', 'AMOUNT_MISMATCH');
  end if;
  if exists (select 1 from editcoreai.payments where mp_payment_id = p_mp_payment_id and id <> p_id) then
    return jsonb_build_object('ok', false, 'error', 'DUPLICATE_PAYMENT');
  end if;

  update editcoreai.payments
     set status = 'approved', mp_payment_id = p_mp_payment_id, approved_at = now()
   where id = p_id;
  update editcoreai.accounts
     set credits_balance = credits_balance + pay.credit_usd,
         topup_base = credits_balance + pay.credit_usd,
         updated_at = now()
   where user_id = pay.user_id
  returning * into acc;
  insert into editcoreai.credit_transactions (user_id, amount, balance_after, kind, description)
  values (pay.user_id, pay.credit_usd, acc.credits_balance, 'purchase',
          format('Recarga Mercado Pago %s %s (pago %s)', pay.amount_local, pay.currency, p_mp_payment_id));
  return jsonb_build_object('ok', true, 'status', 'approved', 'credit_usd', pay.credit_usd);
end;
$$;

create or replace function public.editcoreai_payment_offer()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select editcoreai.topup_offer_json();
$$;

revoke all on function public.editcoreai_payment_create(uuid) from public, anon, authenticated;
revoke all on function public.editcoreai_payment_set_preference(uuid, text) from public, anon, authenticated;
revoke all on function public.editcoreai_payment_settle(uuid, text, text, numeric, text) from public, anon, authenticated;
revoke all on function public.editcoreai_payment_offer() from public, anon, authenticated;
grant execute on function public.editcoreai_payment_create(uuid) to service_role;
grant execute on function public.editcoreai_payment_set_preference(uuid, text) to service_role;
grant execute on function public.editcoreai_payment_settle(uuid, text, text, numeric, text) to service_role;
grant execute on function public.editcoreai_payment_offer() to service_role;

-- Administrador: precio de la recarga y últimos pagos

create or replace function public.editcoreai_admin_payments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
begin
  return jsonb_build_object(
    'offer', editcoreai.topup_offer_json(),
    'approved_today', (select coalesce(sum(amount_local), 0) from editcoreai.payments
                        where status = 'approved' and approved_at >= date_trunc('day', now())),
    'approved_total', (select coalesce(sum(amount_local), 0) from editcoreai.payments where status = 'approved'),
    'recent', coalesce((
      select jsonb_agg(row_to_json(r) order by r.created_at desc)
        from (
          select p.created_at, a.email, p.amount_local, p.currency, p.credit_usd, p.status, p.mp_payment_id
            from editcoreai.payments p
            join editcoreai.accounts a on a.user_id = p.user_id
           where p.status <> 'pending' or p.created_at > now() - interval '1 day'
           order by p.created_at desc
           limit 20
        ) r
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.editcoreai_admin_set_topup(p_price numeric, p_credit_usd numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
begin
  if p_price is null or p_price <= 0 or p_price > 100000 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PRICE');
  end if;
  if p_credit_usd is not null and (p_credit_usd <= 0 or p_credit_usd > 10000) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CREDIT');
  end if;
  insert into editcoreai.settings (key, value, updated_at) values ('topup_price', to_jsonb(round(p_price, 2)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if p_credit_usd is not null then
    insert into editcoreai.settings (key, value, updated_at) values ('topup_credit_usd', to_jsonb(round(p_credit_usd, 2)), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'offer', editcoreai.topup_offer_json());
end;
$$;

revoke all on function public.editcoreai_admin_payments() from public, anon;
revoke all on function public.editcoreai_admin_set_topup(numeric, numeric) from public, anon;
grant execute on function public.editcoreai_admin_payments() to authenticated;
grant execute on function public.editcoreai_admin_set_topup(numeric, numeric) to authenticated;
