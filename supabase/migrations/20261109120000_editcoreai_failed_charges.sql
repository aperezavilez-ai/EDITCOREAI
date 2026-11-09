alter table editcoreai.credit_transactions drop constraint if exists credit_transactions_kind_check;
alter table editcoreai.credit_transactions add constraint credit_transactions_kind_check
  check (kind in ('usage', 'voucher', 'admin_grant', 'purchase', 'refund', 'bonus', 'charge_failed'));

create or replace function public.editcoreai_proxy_charge_failed(
  p_user uuid, p_model text, p_tokens_in integer, p_tokens_out integer,
  p_cached_tokens integer, p_provider_cost numeric, p_error text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  acc editcoreai.accounts;
  v_cost numeric := greatest(coalesce(p_provider_cost, 0), 0);
begin
  if v_cost > 1000 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  perform editcoreai.ensure_account(p_user);
  select * into acc from editcoreai.accounts where user_id = p_user;
  insert into editcoreai.credit_transactions
    (user_id, amount, balance_after, kind, model, tokens_in, tokens_out, cached_tokens, provider_cost, real_cost, description)
  values
    (p_user, 0, acc.credits_balance, 'charge_failed', left(p_model, 120),
     greatest(coalesce(p_tokens_in, 0), 0), greatest(coalesce(p_tokens_out, 0), 0),
     greatest(coalesce(p_cached_tokens, 0), 0), v_cost,
     round(v_cost * editcoreai.setting_numeric('panel_usd_rate', 0.02), 6),
     'Cobro fallido: la IA respondió y no se pudo descontar. Error: ' || left(coalesce(p_error, ''), 200));
  return jsonb_build_object('ok', true, 'recorded', true);
end;
$$;

revoke all on function public.editcoreai_proxy_charge_failed(uuid, text, integer, integer, integer, numeric, text) from public, anon, authenticated;
grant execute on function public.editcoreai_proxy_charge_failed(uuid, text, integer, integer, integer, numeric, text) to service_role;
