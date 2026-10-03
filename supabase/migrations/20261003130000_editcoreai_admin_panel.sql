-- EditCoreAI: datos para el panel de administración y el historial del usuario.

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
    'requests_today', (select count(*) from editcoreai.credit_transactions where kind = 'usage' and created_at >= date_trunc('day', now())),
    'vouchers_active', (select count(*) from editcoreai.vouchers where uses < max_uses and (expires_at is null or expires_at > now()))
  );
end;
$$;

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
    select jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc)
      from (
        select a.user_id, a.email, a.role, a.plan, a.status, a.credits_balance, a.is_unlimited, a.created_at,
               (select max(ct.created_at) from editcoreai.credit_transactions ct where ct.user_id = a.user_id and ct.kind = 'usage') as last_used_at
          from editcoreai.accounts a
         where v_search = '' or a.email like '%' || v_search || '%'
         order by a.created_at desc
         limit least(greatest(coalesce(p_limit, 100), 1), 500)
      ) t
  ), '[]'::jsonb);
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
        select amount, balance_after, kind, model, description, created_at
          from editcoreai.credit_transactions
         where user_id = uid
         order by created_at desc
         limit least(greatest(coalesce(p_limit, 20), 1), 100)
      ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.editcoreai_admin_overview() from public, anon;
revoke all on function public.editcoreai_admin_list_users(text, integer) from public, anon;
revoke all on function public.editcoreai_my_transactions(integer) from public, anon;

grant execute on function public.editcoreai_admin_overview() to authenticated;
grant execute on function public.editcoreai_admin_list_users(text, integer) to authenticated;
grant execute on function public.editcoreai_my_transactions(integer) to authenticated;
