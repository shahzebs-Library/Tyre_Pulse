-- V394 (+V394b, +V394c): upload coverage per COUNTRY and per AREA.
--
-- APPLIED LIVE 2026-07-28 as v394_upload_coverage_by_country_and_site,
-- v394b_coverage_cadence_from_long_baseline, v394c_quiet_only_for_non_daily_feeds.
-- The full function body lives in the database; this file records WHY it is
-- shaped the way it is, because every rule in it was corrected at least once by
-- running it against real data.
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────
-- V389 aggregated every country into one row per source, so a country that
-- stops uploading is invisible behind the ones that did not. Measured before
-- writing anything: KSA job cards last arrived 7 Jul with data on 7 of 30 days,
-- while Egypt and UAE both ran to 22 Jul. The panel reported the newest of the
-- three and called the feed healthy. A twenty-day hole read as green.
--
-- ── AREA IS REAL DATA, NOT A DERIVATION ──────────────────────────────────────
-- `site` is populated on effectively every row of all four sources: expenses
-- 216,792/216,792, job cards 86,539/86,539, tyre records 7,498/7,504,
-- production 5,699/5,699. KSA carries 19-24 distinct sites, Egypt 4-15, UAE
-- 3-18. So the per-area breakdown reports what is there rather than guessing.
--
-- ── THREE RULES, EACH CORRECTED BY MEASUREMENT ───────────────────────────────
--
-- 1. CADENCE COMES FROM A 180-DAY BASELINE, NOT THE WINDOW ON SCREEN (V394b).
--    The first cut derived "is this daily" from the same 30 days being
--    displayed. A feed silent for three weeks therefore falls under the 50% bar,
--    is reclassified "occasional", and stops being alarmed about - precisely
--    when it matters most. Six months of history cannot be erased by three
--    weeks of silence.
--
-- 2. A NON-DAILY FEED IS JUDGED AGAINST ITS OWN GAP, NOT A FIXED THRESHOLD.
--    Measured over 180 days: Egypt job cards have a 90th-percentile gap of 1 day
--    and are 6 days quiet - abnormal. KSA job cards have a p90 gap of 22 days
--    because they arrive as bulk uploads, and are 21 days quiet - entirely
--    normal for that feed. Any fixed "silent for N days" rule calls KSA broken
--    and Egypt fine, which is wrong on both counts.
--
-- 3. THE TWO SIGNALS ARE DISJOINT (V394c). V394b flagged "gone quiet" on any
--    feed silent longer than its typical gap. For a daily feed that gap is 1, so
--    every weekend tripped it and nine of ten sources came back quiet - a flag
--    that is almost always on carries no information. It was also double
--    counting: a daily feed already reports exactly which days it skipped.
--      missed days   DAILY feeds only, which days were skipped
--      gone quiet    NON-DAILY feeds only, silent beyond their own p90 gap
--
-- ── AREA RULE ────────────────────────────────────────────────────────────────
-- A site is judged ONLY on days its own country and source actually received
-- something. "On 14 July KSA expenses arrived for ten sites but not QID-UP-ST"
-- is actionable; "QID-UP-ST sent nothing on a day nobody sent anything" is
-- noise. A site with nothing across the whole recent half of the window is
-- reported as dormant, never as missing - a closed site must not alarm forever.
--
-- ── WEEKENDS ─────────────────────────────────────────────────────────────────
-- A gap only counts on weekdays that feed historically carries (>= 30% hit rate
-- over the baseline), so a Fri/Sat weekend does not generate two false alarms a
-- week. Today is never counted: the day is not over.
--
-- ── LIVE RESULT AT BUILD TIME (455 ms, 30-day window) ────────────────────────
--   Egypt  Expenses daily, 2 missed · Job cards daily, 5 missed
--          Tyre records batch, p90 gap 15, 40 days quiet -> flagged
--   KSA    Expenses daily, 3 missed · Tyre records daily, 24 missed (26 quiet)
--          Job cards batch, p90 gap 22, 21 days quiet -> correctly NOT flagged
--          Production m3 batch, p90 gap 2, 19 days quiet -> flagged
--   UAE    Expenses daily, 2 missed · Job cards daily, 5 missed
--          Tyre records daily, 26 missed
--   Worst area found: KSA expenses QID-UP-ST missed 23 of the days the rest of
--   KSA expenses arrived.
--
-- ── FILES ────────────────────────────────────────────────────────────────────
-- import_files holds only 8 rows for this org, because the staging and Table
-- Editor paths write no file record. The response carries what is genuinely on
-- record and the UI says outright that most loads will never appear there, so
-- an empty list is never mistaken for "nothing was uploaded".
--
-- ── SECURITY ─────────────────────────────────────────────────────────────────
-- `_upload_coverage_detail_for_org` takes an org id and is therefore REVOKED
-- from authenticated (the V378 cross-tenant lesson). The entry point
-- `get_upload_coverage_detail` takes no org, resolves it from the session, and
-- self-gates on app_is_elevated().
--
-- V389's `get_upload_coverage` is KEPT: the morning cron notice reads it, and
-- the alert must not disagree with itself mid-change. Its client-side wrapper
-- was deleted because nothing in the UI calls it any more.

-- The disjoint gone-quiet test, extracted so the rule has one home.
create or replace function public._coverage_quiet(
  p_expect_daily boolean, p_days_since_last integer, p_typical_gap integer)
returns boolean language sql immutable set search_path to 'public' as $fn$
  select coalesce(
    not coalesce(p_expect_daily, false)
    and p_days_since_last is not null
    and p_days_since_last > greatest(coalesce(p_typical_gap, 1), 1),
  false);
$fn$;

comment on function public._coverage_quiet(boolean, integer, integer) is
  'Gone-quiet test for a NON-daily feed only. A daily feed reports its missed days instead, and flagging both would double count every weekend.';

-- Session-scoped entry point. Takes NO org: a DEFINER helper that accepts an
-- org id must never be reachable by `authenticated`.
create or replace function public.get_upload_coverage_detail(
  p_days integer default 30, p_country text default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $fn$
begin
  if not public.app_is_elevated() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  return public._upload_coverage_detail_for_org(
    public.app_current_org(), p_days,
    case when coalesce(btrim(p_country), '') in ('', 'All') then null else btrim(p_country) end);
end $fn$;

revoke all on function public.get_upload_coverage_detail(integer, text) from public, anon;
grant execute on function public.get_upload_coverage_detail(integer, text) to authenticated;

comment on function public.get_upload_coverage_detail(integer, text) is
  'Upload coverage per country and per site, with the days each one missed. A site is only judged on days its own country and source actually received data. Elevated only, org from the session.';

-- NOTE: the body of _upload_coverage_detail_for_org(uuid, integer, text) is
-- long and lives in the database as applied. Recover it with:
--   select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = '_upload_coverage_detail_for_org';
-- It must stay REVOKED from authenticated.
