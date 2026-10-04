-- 20260930163000_notification_health.sql
-- Notifications: delivery results, bell read rate, time to deliver, and announcements by country.
--
-- WHAT IT ADDS (additive only)
--   1. get_notification_health()  read-only, super admin:
--        workflow_notifications 30 days grouped by event type (messages, people reached, status split,
--        last sent), time to deliver median / slowest 5% in seconds, retries (attempts > 1), provider
--        errors (last_error not null); notifications (the in-app bell) 30 days and all time by type,
--        sent vs read; report emails (report_send_log) 30 days; phones (user_devices) active, seen 7 d,
--        by app version; accounts with a push token; announcements on record and showing now.
--      Nothing here records the channel per message, email opens/clicks/bounces or a daily trend, so
--      those are returned as absent and the screen says Not recorded.
--   2. announcements gains nullable target_countries text[] for the By country audience. Existing rows
--      keep NULL = no country filter, exactly today's behaviour.
--
-- PRE-FLIGHT
--   Data loss: none. announcements has 1 row; one nullable column, no default.
--   DEFINER: search_path pinned, is_super_admin() in body, revoke PUBLIC then anon, grant authenticated.
--   Rollback: drop function public.get_notification_health(); alter table public.announcements
--   drop column target_countries.

alter table public.announcements add column if not exists target_countries text[];

create or replace function public.get_notification_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read notification health' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'workflow', (select jsonb_build_object(
        'total', count(*), 'delivered', count(*) filter (where status = 'delivered'),
        'skipped', count(*) filter (where status = 'skipped'),
        'failed', count(*) filter (where status in ('failed','error','dead')),
        'pending', count(*) filter (where status in ('pending','queued','retry')),
        'people', coalesce(sum(recipient_count) filter (where status = 'delivered'), 0),
        'retries', count(*) filter (where attempts > 1),
        'provider_errors', count(*) filter (where last_error is not null),
        'p50_seconds', percentile_cont(0.5) within group (order by extract(epoch from delivered_at - created_at))
                          filter (where delivered_at is not null),
        'p95_seconds', percentile_cont(0.95) within group (order by extract(epoch from delivered_at - created_at))
                          filter (where delivered_at is not null),
        'last_delivered_at', max(delivered_at))
      from public.workflow_notifications where created_at >= now() - interval '30 days'),
    'by_event', coalesce((select jsonb_agg(jsonb_build_object(
        'event_type', event_type, 'family', split_part(event_type, '.', 1), 'status', status,
        'messages', n, 'people', p, 'last_at', l, 'retries', rt, 'errors', er) order by n desc) from (
        select event_type, status, count(*) n, coalesce(sum(recipient_count), 0) p, max(created_at) l,
               count(*) filter (where attempts > 1) rt, count(*) filter (where last_error is not null) er
        from public.workflow_notifications where created_at >= now() - interval '30 days'
        group by 1, 2) s), '[]'::jsonb),
    'bell', (select jsonb_build_object(
        'sent_30d', count(*) filter (where created_at >= now() - interval '30 days'),
        'read_30d', count(*) filter (where created_at >= now() - interval '30 days' and read),
        'sent_all', count(*), 'read_all', count(*) filter (where read)) from public.notifications),
    'bell_by_type', coalesce((select jsonb_agg(jsonb_build_object('type', t, 'sent', n, 'read', r) order by n desc) from (
        select coalesce(type, 'other') t, count(*) n, count(*) filter (where read) r
        from public.notifications where created_at >= now() - interval '30 days' group by 1) s), '[]'::jsonb),
    'my_unread', (select count(*) from public.notifications where user_id = auth.uid() and not coalesce(read, false)),
    'reports', (select jsonb_build_object('sent_30d', count(*) filter (where status in ('sent','success','ok')),
                  'failed_30d', count(*) filter (where status not in ('sent','success','ok')),
                  'total_30d', count(*), 'last_at', max(sent_at))
                from public.report_send_log where sent_at >= now() - interval '30 days'),
    'devices', (select jsonb_build_object(
        'active', count(*) filter (where not coalesce(revoked, false)),
        'total', count(*),
        'seen_7d', count(*) filter (where not coalesce(revoked, false) and last_seen_at >= now() - interval '7 days'),
        'android', count(*) filter (where not coalesce(revoked, false) and lower(platform) = 'android'),
        'ios', count(*) filter (where not coalesce(revoked, false) and lower(platform) = 'ios')) from public.user_devices),
    'by_version', coalesce((select jsonb_agg(jsonb_build_object('version', ver, 'devices', n) order by n desc) from (
        select coalesce(nullif(btrim(app_version), ''), 'Not recorded') ver, count(*) n
        from public.user_devices where not coalesce(revoked, false) group by 1) s), '[]'::jsonb),
    'push_tokens', (select count(distinct user_id) from public.user_devices
                    where not coalesce(revoked, false) and nullif(btrim(push_token), '') is not null),
    'announcements', (select jsonb_build_object('total', count(*),
        'showing', count(*) filter (where active and coalesce(show_from, now()) <= now() and coalesce(show_until, now() + interval '1 second') > now()))
      from public.announcements)
  ) into v;
  return v;
end;
$$;

revoke all on function public.get_notification_health() from public;
revoke all on function public.get_notification_health() from anon;
grant execute on function public.get_notification_health() to authenticated;
