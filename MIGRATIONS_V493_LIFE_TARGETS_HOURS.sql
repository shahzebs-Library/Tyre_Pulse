-- V493 - LIFE TARGETS IN ENGINE HOURS (km, hours, or both for the same vehicle)
-- STATUS: APPLIED LIVE 2026-08-10 (project jhssdmeruxtrlqnwfksc) via apply_migration
-- (v493_life_targets_hours).
--
-- OWNER ASK: "for same vehicle we should be able to put threshold target km and
-- hours meter both way, plus this all data should be linked to the inspection
-- sheet applied there directly."
--
-- WHAT:
-- * tyre_life_targets += target_hours numeric; target_km now nullable;
--   CHECK (target_km or target_hours set). A target row can carry km, hours,
--   or both - matched by the same V492 precedence (size+type > type > size,
--   size spelling ignored via tyre_size_key).
-- * get_tyre_running_life emits per row: expected_life_hours (the matched
--   target's hours), remaining_hours = greatest(target_hours - hours_run, 0),
--   hours_used_pct. hours_run promoted to a real CTE column (hours_calc).
--   Hours expectations are MANUAL-TARGET ONLY - there is no measured hours
--   baseline (removed tyres carry km lives, not hour lives); never fabricate one.
--
-- CLIENT (same commit):
-- * shapeRow += expectedLifeHours/remainingHours/hoursUsedPct; bandFor and the
--   summary tiles now judge an hour-metered tyre against its hours target when
--   it has no km reading (hour-only plant is no longer 'Not measurable');
--   tiles and row badges share bandFor so they can never disagree.
-- * Running & Remaining table: Expected life / Remaining render
--   "60,000 km / 8,000 hrs" (lifeDisplay); Life targets modal gains a
--   "Target life (hour meter)" input - km, hours, or both (at least one).
-- * BOTH inspection reports (detail PDF life table in exportUtils +
--   the checklist PDF's Expected Tyre Life table) show the same combined
--   km/hrs Expected + Remaining and fall back to hours_used_pct - the targets
--   apply to the inspection sheet directly through the shared
--   getTyreRunningLife source (single calc service, no parallel math).
--
-- VERIFIED LIVE (rolled back): an hours-only SKID LOADER target of 8,000 h ->
-- SL012 hours_run 476 reads expected 8,000 / remaining 7,524 / 6% used.
--
-- ROLLBACK: drop the CHECK, drop target_hours, set target_km not null,
-- restore the V492 function body.

alter table public.tyre_life_targets add column if not exists target_hours numeric;
alter table public.tyre_life_targets alter column target_km drop not null;
alter table public.tyre_life_targets drop constraint if exists tyre_life_targets_value_chk;
alter table public.tyre_life_targets add constraint tyre_life_targets_value_chk
  check (target_km is not null or target_hours is not null);

-- get_tyre_running_life: see v493_life_targets_hours in supabase_migrations for
-- the full applied body (adds hours_calc CTE + expected_life_hours /
-- remaining_hours / hours_used_pct to each row).
