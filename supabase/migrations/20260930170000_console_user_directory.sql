-- Control Center, Platform area: Users + User detail (read-only).
--
-- Three SECURITY DEFINER read functions, all super-admin only:
--   admin_user_directory()            per-person sign-in, 2FA, phone and problem signals
--   admin_accounts_without_profile()  sign-in accounts that have no profile row (emails masked)
--   admin_user_health(p_user uuid)    everything the person page needs about one person
--
-- Additive only: no table, column or policy changes, no writes. Every function
-- pins search_path, checks is_super_admin() in its body, is revoked from PUBLIC
-- and anon, and granted to authenticated.
--
-- Rollback:
--   drop function if exists public.admin_user_directory();
--   drop function if exists public.admin_accounts_without_profile();
--   drop function if exists public.admin_user_health(uuid);

-- public._mask_email(text) already exists (earlier migration) and is reused here.

-- ---------------------------------------------------------------------------
create or replace function public.admin_user_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read the user directory' using errcode = '42501';
  end if;

  with dev as (
    select user_id,
           count(*) filter (where not revoked) as phones,
           max(last_seen_at) filter (where not revoked) as last_seen,
           (array_agg(app_version order by last_seen_at desc nulls last) filter (where not revoked))[1] as app_version,
           bool_or(push_token is not null and not revoked) as has_push
      from public.user_devices group by user_id
  ), ret as (
    select user_id, count(*) as returned_unopened
      from public.notifications
     where type = 'approval_decision' and read = false and title ilike '%returned%'
     group by user_id
  ), logs as (
    select user_id, count(*) as web_errors_30d
      from public.system_logs
     where user_id is not null and created_at > now() - interval '30 days'
       and severity in ('error', 'critical')
     group by user_id
  ), rej as (
    select created_by as user_id, count(*) as sent_back_30d
      from public.inspections
     where approval_status = 'rejected' and created_at > now() - interval '30 days'
     group by created_by
  ), iss as (
    select reporter_id as user_id, count(*) as issues_open
      from public.user_issues
     where status not in ('fixed', 'closed', 'wont_fix')
     group by reporter_id
  ), mfa as (
    select user_id, bool_or(status = 'verified') as mfa
      from auth.mfa_factors group by user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'last_sign_in_at', u.last_sign_in_at,
           'auth_created_at', u.created_at,
           'mfa', coalesce(mfa.mfa, false),
           'phones', coalesce(dev.phones, 0),
           'last_seen_at', dev.last_seen,
           'app_version', dev.app_version,
           'has_push', coalesce(dev.has_push, false) or p.push_token is not null,
           'returned_unopened', coalesce(ret.returned_unopened, 0),
           'web_errors_30d', coalesce(logs.web_errors_30d, 0),
           'sent_back_30d', coalesce(rej.sent_back_30d, 0),
           'issues_open', coalesce(iss.issues_open, 0)
         )), '[]'::jsonb)
    into v
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join dev  on dev.user_id  = p.id
    left join ret  on ret.user_id  = p.id
    left join logs on logs.user_id = p.id
    left join rej  on rej.user_id  = p.id
    left join iss  on iss.user_id  = p.id
    left join mfa  on mfa.user_id  = p.id;

  return jsonb_build_object('ok', true, 'generated_at', now(), 'people', v);
end
$$;
revoke all on function public.admin_user_directory() from public;
revoke all on function public.admin_user_directory() from anon;
grant execute on function public.admin_user_directory() to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.admin_accounts_without_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read sign-in accounts' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id,
           'email_masked', public._mask_email(u.email),
           'created_at', u.created_at,
           'last_sign_in_at', u.last_sign_in_at
         ) order by u.created_at desc), '[]'::jsonb)
    into v
    from auth.users u
   where not exists (select 1 from public.profiles p where p.id = u.id);
  return jsonb_build_object('ok', true, 'accounts', v);
end
$$;
revoke all on function public.admin_accounts_without_profile() from public;
revoke all on function public.admin_accounts_without_profile() from anon;
grant execute on function public.admin_accounts_without_profile() to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.admin_user_health(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_out jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read a person''s record' using errcode = '42501';
  end if;
  if p_user is null then
    raise exception 'Choose a person' using errcode = '22023';
  end if;
  select role into v_role from public.profiles where id = p_user;

  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'auth', (select jsonb_build_object(
                'email_masked', public._mask_email(u.email),
                'created_at', u.created_at,
                'last_sign_in_at', u.last_sign_in_at,
                'confirmed', u.email_confirmed_at is not null)
               from auth.users u where u.id = p_user),
    'mfa', (select jsonb_build_object(
                'verified', coalesce(bool_or(status = 'verified'), false),
                'factors', count(*))
              from auth.mfa_factors where user_id = p_user),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', d.id, 'platform', d.platform, 'device_id', d.device_id,
                  'app_version', d.app_version, 'last_seen_at', d.last_seen_at,
                  'created_at', d.created_at, 'revoked', d.revoked,
                  'has_push', d.push_token is not null) order by d.last_seen_at desc nulls last), '[]'::jsonb)
                from public.user_devices d where d.user_id = p_user),
    'records', jsonb_build_object(
        'all_time', (select count(*) from public.inspections where created_by = p_user),
        'last_30d', (select count(*) from public.inspections where created_by = p_user and created_at > now() - interval '30 days'),
        'last_at', (select max(created_at) from public.inspections where created_by = p_user),
        'daily_90d', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d), '[]'::jsonb)
                        from (select (created_at at time zone 'Asia/Riyadh')::date as d, count(*) as n
                                from public.inspections
                               where created_by = p_user and created_at > now() - interval '90 days'
                               group by 1) x),
        'role_rank', (select jsonb_build_object('rank', r.rnk, 'of', r.total)
                        from (select created_by, rank() over (order by count(*) desc) as rnk,
                                     count(*) over () as total
                                from public.inspections i
                                join public.profiles pr on pr.id = i.created_by and pr.role = v_role
                               where i.created_at > now() - interval '30 days'
                               group by created_by) r
                       where r.created_by = p_user)),
    'returned', jsonb_build_object(
        'all_time', (select count(*) from public.inspections where created_by = p_user and approval_status = 'rejected'),
        'last_30d', (select count(*) from public.inspections where created_by = p_user and approval_status = 'rejected' and created_at > now() - interval '30 days'),
        'decided_30d', (select count(*) from public.inspections where created_by = p_user and approval_status in ('rejected', 'approved', 'done') and created_at > now() - interval '30 days'),
        'team_returned_30d', (select count(*) from public.inspections i join public.profiles pr on pr.id = i.created_by and pr.role = v_role
                               where i.approval_status = 'rejected' and i.created_at > now() - interval '30 days'),
        'team_decided_30d', (select count(*) from public.inspections i join public.profiles pr on pr.id = i.created_by and pr.role = v_role
                              where i.approval_status in ('rejected', 'approved', 'done') and i.created_at > now() - interval '30 days'),
        'first_at', (select min(created_at) from public.inspections where created_by = p_user and approval_status = 'rejected'),
        'repeat_assets', (select coalesce(jsonb_agg(jsonb_build_object('asset_no', asset_no, 'n', n) order by n desc, asset_no), '[]'::jsonb)
                            from (select asset_no, count(*) as n from public.inspections
                                   where created_by = p_user and approval_status = 'rejected' and asset_no is not null
                                   group by asset_no) a),
        'recent', (select coalesce(jsonb_agg(jsonb_build_object('at', created_at, 'asset_no', asset_no) order by created_at desc), '[]'::jsonb)
                     from (select created_at, asset_no from public.inspections
                            where created_by = p_user and approval_status = 'rejected'
                            order by created_at desc limit 25) r)),
    'notices', jsonb_build_object(
        'returned_total', (select count(*) from public.notifications where user_id = p_user and type = 'approval_decision' and title ilike '%returned%'),
        'returned_unread', (select count(*) from public.notifications where user_id = p_user and type = 'approval_decision' and title ilike '%returned%' and read = false),
        'total', (select count(*) from public.notifications where user_id = p_user),
        'unread', (select count(*) from public.notifications where user_id = p_user and read = false),
        'last_read', (select jsonb_build_object('at', created_at, 'type', type, 'title', title)
                        from public.notifications where user_id = p_user and read = true
                        order by created_at desc limit 1),
        'recent_returned', (select coalesce(jsonb_agg(jsonb_build_object('at', created_at, 'title', title, 'body', left(body, 160), 'read', read) order by created_at desc), '[]'::jsonb)
                              from (select created_at, title, body, read from public.notifications
                                     where user_id = p_user and type = 'approval_decision' and title ilike '%returned%'
                                     order by created_at desc limit 25) n)),
    'errors', jsonb_build_object(
        'web_30d', (select count(*) from public.system_logs where user_id = p_user and created_at > now() - interval '30 days' and severity in ('error', 'critical')),
        'recent', (select coalesce(jsonb_agg(jsonb_build_object('at', created_at, 'severity', severity, 'module', module_id, 'platform', platform, 'reference_id', reference_id) order by created_at desc), '[]'::jsonb)
                     from (select created_at, severity, module_id, platform, reference_id from public.system_logs
                            where user_id = p_user and created_at > now() - interval '30 days' and severity in ('error', 'critical')
                            order by created_at desc limit 25) l)),
    'issues', jsonb_build_object(
        'total', (select count(*) from public.user_issues where reporter_id = p_user),
        'open', (select count(*) from public.user_issues where reporter_id = p_user and status not in ('fixed', 'closed', 'wont_fix')),
        'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'at', created_at, 'category', category, 'severity', severity, 'status', status, 'platform', platform) order by created_at desc), '[]'::jsonb)
                     from (select id, created_at, category, severity, status, platform from public.user_issues
                            where reporter_id = p_user order by created_at desc limit 25) i)),
    'deletion_request', (select jsonb_build_object('status', status, 'requested_at', requested_at)
                           from public.account_deletion_requests where user_id = p_user
                           order by requested_at desc limit 1)
  ) into v_out;

  return v_out;
end
$$;
revoke all on function public.admin_user_health(uuid) from public;
revoke all on function public.admin_user_health(uuid) from anon;
grant execute on function public.admin_user_health(uuid) to authenticated;
