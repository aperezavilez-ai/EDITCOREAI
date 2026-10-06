-- EditCoreAI: regalo de bienvenida al registrarse y un solo administrador.
-- Cada cuenta nueva recibe signup_bonus_usd de saldo una sola vez por correo (aunque la cuenta se borre y se
-- vuelva a crear). Cuando se acaba, la app muestra la recarga de Mercado Pago, que se acredita sola.

insert into editcoreai.settings (key, value) values ('signup_bonus_usd', '2'::jsonb)
on conflict (key) do nothing;

alter table editcoreai.credit_transactions drop constraint if exists credit_transactions_kind_check;
alter table editcoreai.credit_transactions add constraint credit_transactions_kind_check
  check (kind in ('usage', 'voucher', 'admin_grant', 'purchase', 'refund', 'bonus'));

create table if not exists editcoreai.signup_bonus_claims (
  email text primary key,
  amount numeric(14, 6) not null,
  claimed_at timestamptz not null default now()
);
alter table editcoreai.signup_bonus_claims enable row level security;
grant all on editcoreai.signup_bonus_claims to service_role;
insert into editcoreai.signup_bonus_claims (email, amount)
select lower(email), 0 from editcoreai.accounts on conflict (email) do nothing;

create unique index if not exists accounts_single_admin_idx on editcoreai.accounts ((true)) where role = 'admin';

create or replace function editcoreai.ensure_account(p_uid uuid)
returns editcoreai.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc editcoreai.accounts;
  v_email text;
  v_bonus numeric := greatest(coalesce(editcoreai.setting_numeric('signup_bonus_usd', 0), 0), 0);
begin
  select * into acc from editcoreai.accounts where user_id = p_uid;
  if found then
    return acc;
  end if;
  select lower(email) into v_email from auth.users where id = p_uid;
  if v_email is null then
    raise exception 'USER_NOT_FOUND';
  end if;
  insert into editcoreai.accounts (user_id, email) values (p_uid, v_email)
  on conflict (user_id) do nothing;
  if v_bonus > 0 then
    insert into editcoreai.signup_bonus_claims (email, amount) values (v_email, v_bonus)
    on conflict (email) do nothing;
    if found then
      update editcoreai.accounts
         set credits_balance = credits_balance + v_bonus, topup_base = credits_balance + v_bonus, updated_at = now()
       where user_id = p_uid
      returning * into acc;
      insert into editcoreai.credit_transactions (user_id, amount, balance_after, kind, description)
      values (p_uid, v_bonus, acc.credits_balance, 'bonus', 'Regalo de bienvenida');
    end if;
  end if;
  select * into acc from editcoreai.accounts where user_id = p_uid;
  return acc;
end;
$$;
revoke all on function editcoreai.ensure_account(uuid) from public, anon, authenticated;

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
    'signup_bonus_usd', editcoreai.setting_numeric('signup_bonus_usd', 0),
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

-- p_usd: 0 para no regalar nada.
create or replace function public.editcoreai_admin_set_signup_bonus(p_usd numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
begin
  if p_usd is null or p_usd < 0 or p_usd > 100 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  end if;
  insert into editcoreai.settings (key, value, updated_at) values ('signup_bonus_usd', to_jsonb(round(p_usd, 2)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'signup_bonus_usd', round(p_usd, 2));
end;
$$;

revoke all on function public.editcoreai_admin_set_signup_bonus(numeric) from public, anon;
grant execute on function public.editcoreai_admin_set_signup_bonus(numeric) to authenticated;
