-- EditCoreAI: las compras de ME AI se pagan en yuanes (u otra moneda). El costo real de cada dólar de panel
-- = total pagado en USD (monto × tipo de cambio del día de la compra) ÷ total de dólares de panel recibidos.
-- Reemplaza la compra inicial supuesta (10,000 por $200 USD) por la real: paquete de ¥500 = 21,000 de panel.

alter table editcoreai.meai_topups add column if not exists currency text not null default 'USD';
alter table editcoreai.meai_topups add column if not exists amount_local numeric(14, 4);
alter table editcoreai.meai_topups add column if not exists fx_usd numeric(14, 8);
update editcoreai.meai_topups set amount_local = real_usd, fx_usd = 1 where amount_local is null;

delete from editcoreai.meai_topups where created_by = 'sistema' and note = 'Compra inicial' and currency = 'USD';
insert into editcoreai.meai_topups (panel_usd, real_usd, note, created_by, currency, amount_local, fx_usd)
select 21000, round(500 * 0.148808, 4), 'Paquete ¥500 (saldo actual)', 'sistema', 'CNY', 500, 0.148808
 where not exists (select 1 from editcoreai.meai_topups);

insert into editcoreai.settings (key, value) values ('cny_usd', '0.148808'::jsonb)
on conflict (key) do nothing;

create or replace function editcoreai.recalc_panel_rate()
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric;
begin
  select round(sum(real_usd) / nullif(sum(panel_usd), 0), 8) into v_rate from editcoreai.meai_topups;
  v_rate := coalesce(v_rate, 0.02);
  insert into editcoreai.settings (key, value, updated_at) values ('panel_usd_rate', to_jsonb(v_rate), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_rate;
end;
$$;
revoke all on function editcoreai.recalc_panel_rate() from public, anon, authenticated;

select editcoreai.recalc_panel_rate();

drop function if exists public.editcoreai_admin_meai_topup(numeric, numeric, text);

create or replace function public.editcoreai_admin_meai_topup(
  p_panel numeric,
  p_amount numeric,
  p_currency text,
  p_fx_usd numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
  v_currency text := upper(btrim(coalesce(p_currency, 'USD')));
  v_fx numeric := case when upper(btrim(coalesce(p_currency, 'USD'))) = 'USD' then 1 else p_fx_usd end;
  v_rate numeric;
begin
  if p_panel is null or p_panel <= 0 or p_panel > 100000000
     or p_amount is null or p_amount < 0 or p_amount > 100000000
     or v_fx is null or v_fx <= 0 or v_fx > 100
     or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  insert into editcoreai.meai_topups (panel_usd, real_usd, note, created_by, currency, amount_local, fx_usd)
  values (p_panel, round(p_amount * v_fx, 4), left(nullif(btrim(coalesce(p_note, '')), ''), 200), admin_acc.email,
          v_currency, p_amount, v_fx);
  if v_currency = 'CNY' then
    insert into editcoreai.settings (key, value, updated_at) values ('cny_usd', to_jsonb(v_fx), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  v_rate := editcoreai.recalc_panel_rate();
  return jsonb_build_object('ok', true, 'panel_usd_rate', v_rate);
end;
$$;

create or replace function public.editcoreai_admin_meai_delete_topup(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
  v_rate numeric;
begin
  delete from editcoreai.meai_topups where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  v_rate := editcoreai.recalc_panel_rate();
  return jsonb_build_object('ok', true, 'panel_usd_rate', v_rate);
end;
$$;

create or replace function public.editcoreai_admin_set_markup(p_markup numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
begin
  if p_markup is null or p_markup < 1 or p_markup > 1000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  insert into editcoreai.settings (key, value, updated_at) values ('markup', to_jsonb(round(p_markup, 4)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'markup', round(p_markup, 4));
end;
$$;

revoke all on function public.editcoreai_admin_meai_topup(numeric, numeric, text, numeric, text) from public, anon;
revoke all on function public.editcoreai_admin_meai_delete_topup(bigint) from public, anon;
revoke all on function public.editcoreai_admin_set_markup(numeric) from public, anon;
grant execute on function public.editcoreai_admin_meai_topup(numeric, numeric, text, numeric, text) to authenticated;
grant execute on function public.editcoreai_admin_meai_delete_topup(bigint) to authenticated;
grant execute on function public.editcoreai_admin_set_markup(numeric) to authenticated;

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
    'cny_usd', editcoreai.setting_numeric('cny_usd', 0.148808),
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
        from (select id, created_at, panel_usd, real_usd, currency, amount_local, fx_usd, note, created_by
                from editcoreai.meai_topups order by created_at desc limit 20) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.editcoreai_admin_meai_summary() from public, anon;
grant execute on function public.editcoreai_admin_meai_summary() to authenticated;
