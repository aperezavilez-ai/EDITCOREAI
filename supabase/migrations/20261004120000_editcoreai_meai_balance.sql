-- EditCoreAI: saldo global de ME AI y cobro con el costo real.
-- ME AI descuenta en "dólares de panel"; cada dólar de panel cuesta panel_usd_rate dólares reales (0.02).
-- credit_transactions.provider_cost = dólares de panel · real_cost = dinero real · al usuario se le cobra real_cost × markup.

insert into editcoreai.settings (key, value) values ('panel_usd_rate', '0.02'::jsonb)
on conflict (key) do nothing;

alter table editcoreai.credit_transactions add column if not exists real_cost numeric(14, 6) not null default 0;
update editcoreai.credit_transactions
   set real_cost = round(provider_cost * editcoreai.setting_numeric('panel_usd_rate', 0.02), 6)
 where kind = 'usage' and real_cost = 0 and provider_cost > 0;

-- Lecturas del medidor de ME AI (límite y gastado, en dólares de panel) para repartir el consumo por periodo.
create table if not exists editcoreai.meai_snapshots (
  id bigserial primary key,
  taken_at timestamptz not null default now(),
  limit_panel numeric(16, 4) not null,
  used_panel numeric(16, 4) not null
);
create index if not exists meai_snapshots_taken_at_idx on editcoreai.meai_snapshots (taken_at);
alter table editcoreai.meai_snapshots enable row level security;
grant all on editcoreai.meai_snapshots to service_role;
grant usage, select on sequence editcoreai.meai_snapshots_id_seq to service_role;

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
  v_real numeric;
  v_charge numeric := 0;
begin
  if v_cost > 1000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  v_real := round(v_cost * editcoreai.setting_numeric('panel_usd_rate', 0.02), 6);
  perform editcoreai.ensure_account(p_user);
  select * into acc from editcoreai.accounts where user_id = p_user for update;
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

revoke all on function public.editcoreai_proxy_charge(uuid, text, integer, integer, integer, numeric) from public, anon, authenticated;
grant execute on function public.editcoreai_proxy_charge(uuid, text, integer, integer, integer, numeric) to service_role;

-- Solo ai-proxy (service_role): guarda una lectura del medidor como máximo cada 5 minutos.
create or replace function public.editcoreai_proxy_meai_snapshot(p_limit numeric, p_used numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_row editcoreai.meai_snapshots;
begin
  if p_limit is null or p_used is null or p_limit < 0 or p_used < 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  select * into last_row from editcoreai.meai_snapshots order by taken_at desc limit 1;
  if last_row.id is null or last_row.taken_at < now() - interval '5 minutes'
     or last_row.limit_panel <> p_limit then
    insert into editcoreai.meai_snapshots (limit_panel, used_panel) values (p_limit, p_used);
  end if;
  delete from editcoreai.meai_snapshots where taken_at < now() - interval '400 days';
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.editcoreai_proxy_meai_snapshot(numeric, numeric) from public, anon, authenticated;
grant execute on function public.editcoreai_proxy_meai_snapshot(numeric, numeric) to service_role;

-- Consumo de un periodo: lo que bajó el saldo de ME AI, repartido entre usuarios, admin (vía servidor) y el resto.
create or replace function editcoreai.meai_period(p_start timestamptz, latest editcoreai.meai_snapshots, p_rate numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base editcoreai.meai_snapshots;
  v_from timestamptz;
  v_meai numeric;
  v_users_panel numeric;
  v_users_real numeric;
  v_users_charged numeric;
  v_admin_panel numeric;
  v_requests bigint;
begin
  select * into base from editcoreai.meai_snapshots
   where taken_at <= p_start and taken_at >= p_start - interval '1 hour'
   order by taken_at desc limit 1;
  if base.id is null then
    select * into base from editcoreai.meai_snapshots where taken_at >= p_start order by taken_at asc limit 1;
  end if;
  v_from := greatest(p_start, coalesce(base.taken_at, p_start));
  if base.id is not null and latest.id is not null and base.limit_panel = latest.limit_panel then
    v_meai := greatest(latest.used_panel - base.used_panel, 0);
  end if;
  select coalesce(sum(ct.provider_cost) filter (where a.role <> 'admin'), 0),
         coalesce(sum(ct.real_cost) filter (where a.role <> 'admin'), 0),
         coalesce(-sum(ct.amount) filter (where a.role <> 'admin'), 0),
         coalesce(sum(ct.provider_cost) filter (where a.role = 'admin'), 0),
         count(*)
    into v_users_panel, v_users_real, v_users_charged, v_admin_panel, v_requests
    from editcoreai.credit_transactions ct
    join editcoreai.accounts a on a.user_id = ct.user_id
   where ct.kind = 'usage' and ct.created_at >= v_from;
  return jsonb_build_object(
    'since', v_from,
    'complete', base.id is not null and base.taken_at <= p_start,
    'meai_panel', v_meai,
    'meai_real', round(v_meai * p_rate, 6),
    'users_panel', v_users_panel,
    'users_real', v_users_real,
    'users_charged', v_users_charged,
    'users_profit', v_users_charged - v_users_real,
    'admin_proxy_panel', v_admin_panel,
    'admin_other_panel', case when v_meai is null then null else greatest(v_meai - v_users_panel - v_admin_panel, 0) end,
    'requests', v_requests
  );
end;
$$;

revoke all on function editcoreai.meai_period(timestamptz, editcoreai.meai_snapshots, numeric) from public, anon, authenticated;

create or replace function public.editcoreai_admin_meai_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
  latest editcoreai.meai_snapshots;
  v_rate numeric := editcoreai.setting_numeric('panel_usd_rate', 0.02);
  v_week jsonb;
  v_daily numeric;
begin
  select * into latest from editcoreai.meai_snapshots order by taken_at desc limit 1;
  v_week := editcoreai.meai_period(now() - interval '7 days', latest, v_rate);
  if (v_week ->> 'meai_panel') is not null and (v_week ->> 'since')::timestamptz < now() - interval '1 hour' then
    v_daily := (v_week ->> 'meai_panel')::numeric
               / greatest(extract(epoch from (now() - (v_week ->> 'since')::timestamptz)) / 86400, 1.0 / 24);
  end if;
  return jsonb_build_object(
    'panel_usd_rate', v_rate,
    'markup', editcoreai.setting_numeric('markup', 2),
    'latest', case when latest.id is null then null else jsonb_build_object(
      'taken_at', latest.taken_at,
      'limit_panel', latest.limit_panel,
      'used_panel', latest.used_panel,
      'remaining_panel', greatest(latest.limit_panel - latest.used_panel, 0),
      'remaining_real', round(greatest(latest.limit_panel - latest.used_panel, 0) * v_rate, 2)
    ) end,
    'daily_panel', v_daily,
    'days_left', case when v_daily > 0 and latest.id is not null
                      then floor(greatest(latest.limit_panel - latest.used_panel, 0) / v_daily) end,
    'today', editcoreai.meai_period(date_trunc('day', now()), latest, v_rate),
    'week', v_week,
    'month', editcoreai.meai_period(now() - interval '30 days', latest, v_rate)
  );
end;
$$;

revoke all on function public.editcoreai_admin_meai_summary() from public, anon;
grant execute on function public.editcoreai_admin_meai_summary() to authenticated;

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
    'real_cost_today', (select coalesce(sum(real_cost), 0) from editcoreai.credit_transactions where kind = 'usage' and created_at >= date_trunc('day', now())),
    'real_cost_total', (select coalesce(sum(real_cost), 0) from editcoreai.credit_transactions where kind = 'usage'),
    'requests_today', (select count(*) from editcoreai.credit_transactions where kind = 'usage' and created_at >= date_trunc('day', now())),
    'vouchers_active', (select count(*) from editcoreai.vouchers where uses < max_uses and (expires_at is null or expires_at > now())),
    'markup', editcoreai.setting_numeric('markup', 2),
    'panel_usd_rate', editcoreai.setting_numeric('panel_usd_rate', 0.02)
  );
end;
$$;

-- Lista de usuarios con su consumo de los últimos 30 días (panel de ME AI, costo real y lo cobrado).
create or replace function public.editcoreai_admin_list_users(p_search text default null, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
  v_search text := lower(btrim(coalesce(p_search, '')));
begin
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.last_seen_at desc nulls last, t.created_at desc)
      from (
        select a.user_id, a.email, a.role, a.plan, a.status, a.credits_balance, a.is_unlimited, a.created_at,
               a.last_seen_at, a.app_version,
               (select u.last_sign_in_at from auth.users u where u.id = a.user_id) as last_sign_in_at,
               (select max(ct.created_at) from editcoreai.credit_transactions ct where ct.user_id = a.user_id and ct.kind = 'usage') as last_used_at,
               coalesce(m.panel_30d, 0) as panel_30d,
               coalesce(m.real_30d, 0) as real_30d,
               coalesce(m.charged_30d, 0) as charged_30d,
               coalesce(m.requests_30d, 0) as requests_30d
          from editcoreai.accounts a
          left join lateral (
            select sum(ct.provider_cost) as panel_30d, sum(ct.real_cost) as real_30d,
                   -sum(ct.amount) as charged_30d, count(*) as requests_30d
              from editcoreai.credit_transactions ct
             where ct.user_id = a.user_id and ct.kind = 'usage' and ct.created_at >= now() - interval '30 days'
          ) m on true
         where v_search = '' or a.email like '%' || v_search || '%'
         order by a.last_seen_at desc nulls last, a.created_at desc
         limit least(greatest(coalesce(p_limit, 100), 1), 500)
      ) t
  ), '[]'::jsonb);
end;
$$;
