-- V389 / V389b / V389c. "Did I forget to upload yesterday's file?"
--
-- The daily files are uploaded by hand, so a missed day is silent: the app just
-- shows less data and nothing says why. This makes the gap visible on the
-- console and sends one notification the morning it appears.
--
-- TWO DESIGN CHOICES THAT KEEP IT HONEST, and they matter more than the code:
--
-- 1. Expectation is DERIVED, never assumed. A source is policed only if it has
--    actually arrived on most of the recent days. On live data that correctly
--    watches Job cards (25 of 29 days) and Expenses (29 of 29) while leaving
--    Tyre records (5 of 29) and Production m3 (8 of 29) alone. Flagging an
--    occasional feed every morning trains people to ignore the alert, and then
--    they miss the one that matters.
-- 2. Weekends are derived the same way, per source, from which weekdays
--    historically carry data. Assuming a Mon-Fri week would cry wolf twice a
--    week in a Fri/Sat weekend region.
--
-- The date used is the BUSINESS date of the row, not the insert time, so a gap
-- means "no data covering that day" - the question actually being asked. A file
-- uploaded late still fills its own day and stops being reported as missing.
-- Today is never flagged; the day is not over.
--
-- V389c note on SECURITY: _upload_coverage_for_org takes an org id and is
-- SECURITY DEFINER, so it is revoked from `authenticated` - that is exactly the
-- cross-tenant hole the V378 cost-variance work opened and had to close. The
-- public entry point takes no org argument and resolves it from the session.
-- Both the console page and the cron notice read the SAME function, so the
-- alert can never say something the page disagrees with.
--
-- The full function bodies are applied live under the migration names above;
-- see supabase_migrations for the exact text. Recorded here in summary because
-- three revisions were applied in sequence and the final state is what matters:
--   _upload_coverage_for_org(uuid, int, text)  - shared core, NOT authenticated
--   get_upload_coverage(int, text)             - session-scoped entry point
--   cron_check_upload_gaps()                   - daily notifier
--   upload_gap_notices                         - one notice per gap, not per morning
--
-- Scheduled: pg_cron 'upload-gap-check' at 05:30 UTC = 08:30 Riyadh, so a
-- missed upload is flagged before the day's decisions are made on stale data.
--
-- Verified live: Job cards raised an alert (last data 22 Jul, 5 days ago,
-- 4 empty days); Expenses clean at 29 of 29; the two occasional feeds were
-- correctly NOT flagged. Running the cron twice created 5 notifications the
-- first time (one per elevated user) and 0 the second - the de-duplication in
-- upload_gap_notices holds.

create table if not exists public.upload_gap_notices (
  organisation_id uuid not null,
  src             text not null,
  last_data_date  date,
  notified_at     timestamptz not null default now(),
  primary key (organisation_id, src)
);

alter table public.upload_gap_notices enable row level security;

drop policy if exists upload_gap_notices_read on public.upload_gap_notices;
create policy upload_gap_notices_read on public.upload_gap_notices
  for select to authenticated
  using (organisation_id = (select public.app_current_org()) and (select public.app_is_elevated()));

revoke all on public.upload_gap_notices from anon;
grant select on public.upload_gap_notices to authenticated;

-- select cron.schedule('upload-gap-check', '30 5 * * *',
--   $job$select public.cron_check_upload_gaps();$job$);
