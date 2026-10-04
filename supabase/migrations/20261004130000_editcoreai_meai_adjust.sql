-- EditCoreAI: el administrador registra recargas de ME AI y corrige el saldo global a mano.
-- El saldo sale de ME AI en vivo; una recarga registrada recalcula panel_usd_rate (dinero real pagado ÷ dólares de panel).
-- meai_balance_offset (dólares de panel) se suma al saldo leído cuando el administrador lo corrige.

create table if not exists editcoreai.meai_topups (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  panel_usd numeric(16, 4) not null check (panel_usd > 0),
  real_usd numeric(14, 4) not null check (real_usd >= 0),
  note text,
  created_by text
);
alter table editcoreai.meai_topups enable row level security;
grant all on editcoreai.meai_topups to service_role;
grant usage, select on sequence editcoreai.meai_topups_id_seq to service_role;

insert into editcoreai.meai_topups (panel_usd, real_usd, note, created_by)
select 10000, 200, 'Compra inicial', 'sistema'
 where not exists (select 1 from editcoreai.meai_topups);

insert into editcoreai.settings (key, value) values ('meai_balance_offset', '0'::jsonb)
on conflict (key) do nothing;

create or replace function public.editcoreai_admin_meai_topup(p_panel numeric, p_real numeric, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
  v_rate numeric;
begin
  if p_panel is null or p_panel <= 0 or p_panel > 100000000 or p_real is null or p_real < 0 or p_real > 10000000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  insert into editcoreai.meai_topups (panel_usd, real_usd, note, created_by)
  values (p_panel, p_real, left(nullif(btrim(coalesce(p_note, '')), ''), 200), admin_acc.email);
  select round(sum(real_usd) / nullif(sum(panel_usd), 0), 6) into v_rate from editcoreai.meai_topups;
  insert into editcoreai.settings (key, value, updated_at) values ('panel_usd_rate', to_jsonb(v_rate), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'panel_usd_rate', v_rate);
end;
$$;

-- p_remaining = saldo que el administrador ve en ME AI (dólares de panel); null = quitar la corrección.
create or replace function public.editcoreai_admin_meai_set_balance(p_remaining numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
  latest editcoreai.meai_snapshots;
  v_offset numeric := 0;
begin
  if p_remaining is not null then
    if p_remaining < 0 or p_remaining > 100000000 then
      raise exception 'INVALID_AMOUNT' using errcode = '22023';
    end if;
    select * into latest from editcoreai.meai_snapshots order by taken_at desc limit 1;
    if latest.id is null then
      return jsonb_build_object('ok', false, 'error', 'NO_READING');
    end if;
    v_offset := round(p_remaining - (latest.limit_panel - latest.used_panel), 4);
  end if;
  insert into editcoreai.settings (key, value, updated_at) values ('meai_balance_offset', to_jsonb(v_offset), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'offset_panel', v_offset);
end;
$$;

revoke all on function public.editcoreai_admin_meai_topup(numeric, numeric, text) from public, anon;
revoke all on function public.editcoreai_admin_meai_set_balance(numeric) from public, anon;
grant execute on function public.editcoreai_admin_meai_topup(numeric, numeric, text) to authenticated;
grant execute on function public.editcoreai_admin_meai_set_balance(numeric) to authenticated;

-- Lo gastado (total_usage) solo crece: el consumo del periodo se mide aunque cambie el límite por una recarga.
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
  if base.id is not null and latest.id is not null then
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
  v_offset numeric := editcoreai.setting_numeric('meai_balance_offset', 0);
  v_remaining numeric;
  v_week jsonb;
  v_daily numeric;
begin
  select * into latest from editcoreai.meai_snapshots order by taken_at desc limit 1;
  v_remaining := greatest(latest.limit_panel - latest.used_panel + v_offset, 0);
  v_week := editcoreai.meai_period(now() - interval '7 days', latest, v_rate);
  if (v_week ->> 'meai_panel') is not null and (v_week ->> 'since')::timestamptz < now() - interval '1 hour' then
    v_daily := (v_week ->> 'meai_panel')::numeric
               / greatest(extract(epoch from (now() - (v_week ->> 'since')::timestamptz)) / 86400, 1.0 / 24);
  end if;
  return jsonb_build_object(
    'panel_usd_rate', v_rate,
    'markup', editcoreai.setting_numeric('markup', 2),
    'offset_panel', v_offset,
    'latest', case when latest.id is null then null else jsonb_build_object(
      'taken_at', latest.taken_at,
      'limit_panel', latest.limit_panel,
      'used_panel', latest.used_panel,
      'remaining_panel', v_remaining,
      'remaining_real', round(v_remaining * v_rate, 2)
    ) end,
    'daily_panel', v_daily,
    'days_left', case when v_daily > 0 and latest.id is not null then floor(v_remaining / v_daily) end,
    'today', editcoreai.meai_period(date_trunc('day', now()), latest, v_rate),
    'week', v_week,
    'month', editcoreai.meai_period(now() - interval '30 days', latest, v_rate),
    'topups', coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
        from (select created_at, panel_usd, real_usd, note, created_by
                from editcoreai.meai_topups order by created_at desc limit 10) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.editcoreai_admin_meai_summary() from public, anon;
grant execute on function public.editcoreai_admin_meai_summary() to authenticated;
