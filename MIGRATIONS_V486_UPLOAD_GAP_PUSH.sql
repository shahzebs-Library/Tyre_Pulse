-- V486 - a missed upload now also reaches a phone, and the morning alert
--        watches every registered feed.
-- STATUS: APPLIED LIVE (project jhssdmeruxtrlqnwfksc) + verified rolled back:
--   3 new-feed gaps detected, 3 pushes queued 'pending' with the right token,
--   second run 0/0 (dedupe holds), switch off -> 0 pushes with the bell intact.
--
-- V486a: _upload_coverage_for_org (which the 05:30 UTC cron reads) is now built
-- from public.upload_feeds, like the console panel. The panel and the alert MUST
-- read the same feed list, or the page would flag a stale table the alert never
-- mentions. Full body: select pg_get_functiondef(
--   'public._upload_coverage_for_org(uuid,integer,text)'::regprocedure);
--
-- V486b: cron_check_upload_gaps additionally queues a PUSH on the SAME dedupe
-- key (upload_gap_notices), so it is one push per new gap, not a daily nag. It
-- reuses the whole existing delivery chain unchanged - workflow_notifications ->
-- the V119 pg_cron deliverer -> the workflow-notify edge function - by passing a
-- pre-rendered push {title, body}, which that function already supports.
-- NO EDGE FUNCTION REDEPLOY IS NEEDED.
--
-- Two switches, both honoured without any code change:
--   system_config.upload_gap_push    = 'false' turns off just this alert
--   system_config.push_notifications = 'false' turns off ALL push (edge fn)
--
-- ALSO FIXED HERE: the bell insert called notify_elevated_users(), which is not
-- org scoped, so every Admin/Manager/Director in EVERY organisation was told
-- about every other organisation's missing upload. This caller now inserts an
-- org scoped row itself. Single tenant today, so no visible change now, but it
-- would have cross-notified the moment a second company was added.
--
-- ROLLBACK: re-apply the previous cron_check_upload_gaps body (which called
-- notify_elevated_users and queued no push) and the V389c body of
-- _upload_coverage_for_org.

insert into public.system_config (key, value)
values ('upload_gap_push', 'true')
on conflict (key) do nothing;

revoke all on function public._upload_coverage_for_org(uuid, integer, text)
  from public, anon, authenticated;
