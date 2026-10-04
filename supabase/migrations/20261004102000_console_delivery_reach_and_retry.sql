-- 20261004102000_console_delivery_reach_and_retry.sql
--
-- Console Delivery page (super admin only), two additive RPCs:
--
--   1. admin_delivery_reach()      push reach split by app. A token that starts
--      'ExponentPushToken' belongs to the RETIRED Expo app (read only); any other
--      token is a Firebase Cloud Messaging (FCM) token from the Flutter app.
--      user_devices RLS lets a user read only their own rows, so the console
--      cannot count devices without a DEFINER read.
--   2. admin_retry_failed_notifications(p_ids, p_reason)  put FAILED push
--      deliveries back in the queue (status pending, attempts 0, due now). The
--      existing deliver_workflow_notifications cron picks them up on its next
--      minute. Only rows still in 'failed' are touched; reason >= 5 chars;
--      at most 500 ids; written to console_sessions via log_console_event.
--      workflow_notifications has no client UPDATE policy, hence DEFINER.
--
-- Both: SECURITY DEFINER, search_path pinned, is_super_admin() gate in body,
-- EXECUTE revoked from PUBLIC then anon, granted to authenticated.
--
-- Rollback:
--   drop function public.admin_delivery_reach();
--   drop function public.admin_retry_failed_notifications(bigint[], text);

create or replace function public.admin_delivery_reach()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read delivery reach' using errcode = '42501';
  end if;
  with d as (
    select user_id, last_seen_at, app_version,
           (push_token like 'ExponentPushToken%') as is_expo
      from public.user_devices
     where not coalesce(revoked, false)
       and nullif(btrim(push_token), '') is not null
  )
  select jsonb_build_object(
    'ok', true,
    'flutter_devices', count(*) filter (where not is_expo),
    'flutter_people', count(distinct user_id) filter (where not is_expo),
    'flutter_seen_7d', count(*) filter (where not is_expo and last_seen_at >= now() - interval '7 days'),
    'retired_devices', count(*) filter (where is_expo),
    'retired_people', count(distinct user_id) filter (where is_expo),
    'total_devices', count(*),
    'total_people', count(distinct user_id)
  ) into v from d;
  return v;
end
$$;

create or replace function public.admin_retry_failed_notifications(p_ids bigint[], p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can retry deliveries' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Choose at least one failed delivery.' using errcode = '22023';
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Retry at most 500 deliveries at a time.' using errcode = '22023';
  end if;
  update public.workflow_notifications
     set status = 'pending', attempts = 0, next_attempt_at = now(),
         request_id = null, last_error = null
   where id = any(p_ids) and status = 'failed';
  get diagnostics n = row_count;
  perform public.log_console_event('push_retry_failed', null, 'workflow_notifications',
    jsonb_build_object('requested', cardinality(p_ids), 'requeued', n, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'requeued', n, 'requested', cardinality(p_ids));
end
$$;

revoke execute on function public.admin_delivery_reach() from public;
revoke execute on function public.admin_delivery_reach() from anon;
grant execute on function public.admin_delivery_reach() to authenticated;
revoke execute on function public.admin_retry_failed_notifications(bigint[], text) from public;
revoke execute on function public.admin_retry_failed_notifications(bigint[], text) from anon;
grant execute on function public.admin_retry_failed_notifications(bigint[], text) to authenticated;
