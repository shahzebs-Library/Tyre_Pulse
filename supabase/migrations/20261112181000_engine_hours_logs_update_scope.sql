-- engine_hours_logs: a signed-in user can no longer update every reading.
--
-- FINDING: RLS-10 partial (P2), follow-up to 20261112154000  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (catalog): engine_hours_logs_update USING was
--   "auth.uid() is not null", so any account could rewrite all 3,820 readings
--   in its country. Engine hours feed tyre running life and cost per hour.
--
-- WHAT THIS DOES (USING only; WITH CHECK and the restrictive org / country /
-- active-account policies are untouched)
--   row creator, Admin/Manager/Director, super admin, or a holder of
--   odometer_logs:view (the rule vehicle_meter_permissions() uses for
--   canCorrect) or of engine_hours:view (the web Engine Hours page).
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- How clients update the table:
--   Expo recordQueue.ts ENGINE_HOURS_LOG and Flutter engineHoursLog: insert only.
--   web save_vehicle_meter_readings (INVOKER): inserts, then updates the row it
--     just inserted (creator = caller) - passes.
--   web engineHours.updateEngineHours (Engine Hours page): direct update - covered
--     by the engine_hours:view arm (Fleet Supervisor, Data Monitor Officer) and
--     the elevated arm.
--   pmPrograms.recordPmService: insert only.
--   Triggers on the table (updated_at, regression flag, asset normalise) do not
--     depend on the caller.
--   Data: 5,691 rows; creators Driver 1,152, Fleet Supervisor 62, Admin 8,
--     Workshop Supervisor 1; 4,468 have no creator (telematics / file loads).
-- Data loss: none (one ALTER POLICY).
-- Client behaviour that changes: a field user can only change their own engine
--   hour reading. Nothing the apps offer today is removed.
-- Rollback: at the foot.

alter policy engine_hours_logs_update on public.engine_hours_logs
  using (
    (select auth.uid()) is not null
    and (
      created_by = (select auth.uid())
      or (select public.app_is_elevated())
      or (select public.is_super_admin())
      or (select public.app_user_can('odometer_logs', 'view'))
      or (select public.app_user_can('engine_hours', 'view'))
    )
  );

-- ------------------------------------------------------------------------ VERIFY
-- (run 2026-11-12, rolled back; rows counted with UPDATE ... RETURNING)
--   Driver with 50 own readings   -> 50 updated, all own (was every visible row)
--   Tyre Man                      -> 0
--   Fleet Supervisor              -> 3,820
--   KSA Manager                   -> 3,820
--
-- ---------------------------------------------------------------------- ROLLBACK
--   alter policy engine_hours_logs_update on public.engine_hours_logs using (auth.uid() is not null);
