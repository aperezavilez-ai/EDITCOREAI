-- EditCoreAI: actividad de cada usuario para el panel de administración.
-- La app envía un latido cada 2 minutos mientras está abierta con sesión (última vez visto y versión).

alter table editcoreai.accounts add column if not exists last_seen_at timestamptz;
alter table editcoreai.accounts add column if not exists app_version text;

create or replace function public.editcoreai_heartbeat(p_version text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := editcoreai.require_uid();
begin
  perform editcoreai.ensure_account(uid);
  update editcoreai.accounts
     set last_seen_at = now(),
         app_version = coalesce(left(nullif(btrim(p_version), ''), 20), app_version)
   where user_id = uid;
end;
$$;

revoke all on function public.editcoreai_heartbeat(text) from public, anon;
grant execute on function public.editcoreai_heartbeat(text) to authenticated;

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
               (select max(ct.created_at) from editcoreai.credit_transactions ct where ct.user_id = a.user_id and ct.kind = 'usage') as last_used_at
          from editcoreai.accounts a
         where v_search = '' or a.email like '%' || v_search || '%'
         order by a.last_seen_at desc nulls last, a.created_at desc
         limit least(greatest(coalesce(p_limit, 100), 1), 500)
      ) t
  ), '[]'::jsonb);
end;
$$;
