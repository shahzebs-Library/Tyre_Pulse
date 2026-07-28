-- =====================================================================
-- V402 - LET THE COVERAGE WINDOW REACH BACK FURTHER THAN 90 DAYS
-- Applied live 2026-07-28.
-- =====================================================================
--
-- User: "In the daily coverage add a custom date also".
--
-- The panel offered 14/30/60/90 and the function clamped the window to 180.
-- Raising the clamp alone would have been WRONG, and this is the part worth
-- remembering: the base CTE only pulls `current_date - v_base` (180 days) of
-- rows, so a display window longer than the fetch would have shown days with NO
-- DATA purely because those rows were never fetched - inventing gaps that do not
-- exist, on a panel whose entire job is to report gaps truthfully.
--
-- Two surgical changes, applied by rewriting the existing definition rather than
-- retyping 11k characters of carefully-tuned cadence logic:
--   1. the display window may reach 365 days;
--   2. `v_base` becomes `greatest(180, v_n)`, so the fetch always covers the
--      window while the RHYTHM baseline stays at least 180 days.
--
-- That second half is load-bearing. V394b already established that deriving
-- cadence from the window on screen makes a feed silent for three weeks fall
-- under the 50% bar, get reclassified "occasional", and stop being alarmed about
-- precisely when it matters most. Widening the view must not widen the baseline
-- into the same trap, and it must not narrow it either.
--
-- The rewrite GUARDS on the exact text it expects and raises if the function has
-- changed, rather than silently patching something else. A blind replace on a
-- function this size is how a subtle behaviour change ships unnoticed.
--
-- VERIFIED LIVE: 30, 200 and 365 day windows all return all three countries.
--
-- CLIENT SIDE: the window always ends TODAY, because the question this panel
-- answers is "did I forget to upload?", which is about now. A chosen start date
-- is converted to the day count the view already understands, and when the date
-- is further back than 365 days the UI SAYS SO rather than silently clamping -
-- a window that quietly became a different window is how someone concludes a
-- feed is healthy when it is not.

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_upload_coverage_detail_for_org';

  if v_def is null then
    raise exception 'V402: _upload_coverage_detail_for_org not found';
  end if;

  if position('least(greatest(coalesce(p_days, 30), 7), 180)' in v_def) = 0 then
    raise exception 'V402: window clamp not found - the function changed, review before re-running';
  end if;
  v_def := replace(v_def,
    'least(greatest(coalesce(p_days, 30), 7), 180)',
    'least(greatest(coalesce(p_days, 30), 7), 365)');

  if position('v_base int := 180;' in v_def) = 0 then
    raise exception 'V402: baseline declaration not found - review before re-running';
  end if;
  v_def := replace(v_def,
    'v_base int := 180;',
    'v_base int := greatest(180, v_n);');

  execute v_def;
end $$;

comment on function public._upload_coverage_detail_for_org(uuid, integer, text) is
  'V402: display window up to 365 days. v_base always covers the window so a long view cannot invent gaps, while the cadence baseline stays at least 180 days (V394b).';

-- =====================================================================
-- ALSO SHIPPED WITH THIS (code only, no schema change)
--
-- "what file we uploading and with a click we knows where to add those
--  information from it like their headers"
--
-- The coverage panel said "KSA job cards missed 23 days" and stopped there. The
-- reader still had to work out which export that is, which table it goes into
-- and what the headers must say - all of which was ALREADY recorded in
-- IMPORT_TARGETS and simply never shown next to the gap it explains.
--
--   src/lib/coverageSources.js   joins a coverage source to its import target
--                                BY DERIVATION from IMPORT_TARGETS, so adding a
--                                target surfaces it automatically and the two
--                                cannot drift. 18 tests.
--   FeedFileHelp.jsx             the file, the per-country table, the exact
--                                headers with a copy button, the re-import
--                                warning and the gotchas.
--
-- `production_m3` deliberately resolves to NOTHING: production_logs has no
-- staging table, so there is genuinely no file to upload for it - those rows are
-- entered in the app. The panel says that instead of pointing at an export that
-- does not exist.
--
-- The re-import warning names the consequence rather than being polite about it:
-- a `needs-key` file uploaded without its line-number column adds every row a
-- second time. That is the exact path that produced 8,248 duplicate expense rows.
-- =====================================================================
