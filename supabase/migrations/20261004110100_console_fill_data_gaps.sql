-- Console "give all the data" pass (2026-10-04).
-- Two read-only super-admin aggregates for values that exist in the database
-- but no console screen could reach:
--   admin_org_storage()            file count + bytes per organisation, derived
--                                  from storage.objects.owner -> profiles.org_id
--                                  (files with no owning profile are returned as
--                                  an unattributed bucket, never guessed).
--   admin_user_signin_facts(uuid)  successful sign-ins (auth audit log) and the
--                                  lockout counter's last failed burst for one
--                                  person (login_attempts keeps only the latest
--                                  window per identifier; full failure history
--                                  is not kept, and the result says so).
-- Additive only. DEFINER, search_path pinned, is_super_admin() gate in body,
-- revoke PUBLIC then anon, grant authenticated.
-- Rollback:
--   drop function if exists public.admin_org_storage();
--   drop function if exists public.admin_user_signin_facts(uuid);

create or replace function public.admin_org_storage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  with f as (
    select o.bucket_id, coalesce((o.metadata->>'size')::bigint, 0) as bytes,
           coalesce(p.org_id, p.organisation_id) as org_id
      from storage.objects o
      left join public.profiles p on p.id = o.owner
  )
  select jsonb_build_object(
    'orgs', coalesce((select jsonb_agg(jsonb_build_object('org_id', s.org_id, 'files', s.n, 'bytes', s.b, 'by_bucket', s.bb))
      from (select x.org_id, sum(x.nb)::bigint n, sum(x.sb)::bigint b, jsonb_object_agg(x.bucket_id, x.nb) bb
              from (select org_id, bucket_id, count(*) nb, sum(bytes) sb from f where org_id is not null group by 1, 2) x
             group by x.org_id) s), '[]'::jsonb),
    'unattributed_files', (select count(*) from f where org_id is null),
    'unattributed_bytes', (select coalesce(sum(bytes), 0) from f where org_id is null),
    'total_files', (select count(*) from f),
    'total_bytes', (select coalesce(sum(bytes), 0) from f)
  ) into v;
  return v;
end;
$$;

create or replace function public.admin_user_signin_facts(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_username text; v_email text; v_emp text; v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select lower(username), lower(email), lower(employee_id) into v_username, v_email, v_emp
    from public.profiles where id = p_user;
  select jsonb_build_object(
    'logins_30d', (select count(*) from auth.audit_log_entries a
                    where a.payload->>'action' = 'login' and a.payload->>'actor_id' = p_user::text
                      and a.created_at >= now() - interval '30 days'),
    'logins_all', (select count(*) from auth.audit_log_entries a
                    where a.payload->>'action' = 'login' and a.payload->>'actor_id' = p_user::text),
    'first_login_logged', (select min(a.created_at) from auth.audit_log_entries a
                    where a.payload->>'action' = 'login' and a.payload->>'actor_id' = p_user::text),
    'mfa_checks_30d', (select count(*) from auth.audit_log_entries a
                    where a.payload->>'action' = 'verification_attempted' and a.payload->>'actor_id' = p_user::text
                      and a.created_at >= now() - interval '30 days'),
    'failed_burst', (select jsonb_build_object('attempts', la.attempt_count, 'started_at', la.window_started_at,
                            'locked_until', la.locked_until, 'locked_now', coalesce(la.locked_until > now(), false))
                       from public.login_attempts la
                      where lower(la.identifier) in (v_username, v_email, v_emp)
                      order by la.window_started_at desc nulls last limit 1)
  ) into v;
  return v;
end;
$$;

revoke all on function public.admin_org_storage() from public;
revoke all on function public.admin_org_storage() from anon;
grant execute on function public.admin_org_storage() to authenticated;
revoke all on function public.admin_user_signin_facts(uuid) from public;
revoke all on function public.admin_user_signin_facts(uuid) from anon;
grant execute on function public.admin_user_signin_facts(uuid) to authenticated;
