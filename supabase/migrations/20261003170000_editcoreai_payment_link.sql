-- EditCoreAI: link de pago fijo de Mercado Pago (sin token).
-- Mientras no haya token en el servidor, la app abre este link y el administrador carga el saldo a mano
-- cuando recibe el comprobante. Con token, la función payments crea un link único por compra y acredita sola.

insert into editcoreai.settings (key, value) values
  ('topup_payment_link', '""'::jsonb),
  ('topup_contact', '""'::jsonb)
on conflict (key) do nothing;

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
    'credit_usd', editcoreai.setting_numeric('topup_credit_usd', 20),
    'payment_link', editcoreai.setting_text('topup_payment_link', ''),
    'contact', editcoreai.setting_text('topup_contact', '')
  );
$$;
revoke all on function editcoreai.topup_offer_json() from public, anon, authenticated;

-- p_link: '' para quitarlo; solo links https de Mercado Pago. p_contact: dónde mandan el comprobante.
create or replace function public.editcoreai_admin_set_payment_link(p_link text, p_contact text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_acc editcoreai.accounts := editcoreai.require_admin();
  v_link text := btrim(coalesce(p_link, ''));
  v_contact text := btrim(coalesce(p_contact, ''));
begin
  if v_link <> '' and v_link !~ '^https://(mpago\.la|mpago\.li|link\.mercadopago\.com\.mx|(www\.)?mercadopago\.com\.mx)/[A-Za-z0-9/_?=.&%-]+$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LINK');
  end if;
  if length(v_contact) > 120 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CONTACT');
  end if;
  insert into editcoreai.settings (key, value, updated_at) values ('topup_payment_link', to_jsonb(v_link), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into editcoreai.settings (key, value, updated_at) values ('topup_contact', to_jsonb(v_contact), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'offer', editcoreai.topup_offer_json());
end;
$$;

revoke all on function public.editcoreai_admin_set_payment_link(text, text) from public, anon;
grant execute on function public.editcoreai_admin_set_payment_link(text, text) to authenticated;
