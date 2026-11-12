-- action_items / odometer_logs: a signed-in user can no longer update every row.
--
-- FINDING: RLS-10 partial (P2)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (reproduced live as a Driver, rolled back, rows counted with
-- UPDATE ... RETURNING):
--   update action_items   -> 161 rows (all of them)
--   update odometer_logs  -> 2,416 rows (every reading in the country; 2 were
--                            the driver's own). Odometer logs feed
--                            vehicle_fleet.current_km and tyre running life.
--   Both UPDATE policies were "auth.uid() is not null".
--
-- WHAT THIS DOES (USING only; WITH CHECK and every restrictive org / country /
-- active-account policy are untouched)
--   action_items_update   row creator, assigned user (assigned_user_id),
--                         Admin/Manager/Director, super admin, or a holder of
--                         the Daily Operations module (daily_ops:view).
--   odometer_logs_update  row creator, Admin/Manager/Director, super admin, or a
--                         holder of odometer_logs:view - the same rule
--                         vehicle_meter_permissions() uses for canCorrect.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- How the clients update these tables (read before choosing the rule):
--   action_items
--     web ActionCenter.jsx (route is Admin only)      updateActionItem -> direct update
--     web DailyOps.jsx (module daily_ops)             transition_action_item, a
--         SECURITY INVOKER RPC, so it obeys this policy. Roles with the module
--         today: Admin, Manager, Director, Inspector, Data Monitor Officer,
--         PMV Manager, Tire Planning Engineer, Tyre Data Collector, Workshop
--         Area Manager, Workshop Maintenance Area Manager.
--     Flutter team_action_dialog.dart                 tp_employee_action_transition
--         (SECURITY DEFINER, own assignee check) - not affected.
--     corrective_actions <-> action_items sync        SECURITY DEFINER triggers - not affected.
--     Data: 161 rows, 149 with no creator (system / sync), 7 with an assigned user.
--   odometer_logs
--     Expo recordQueue.ts          upsert on client_uuid with ignoreDuplicates
--         (ON CONFLICT DO NOTHING) - never updates.
--     web save_vehicle_meter_readings (INVOKER)  inserts then updates the row it
--         just inserted (creator = caller) - passes.
--     web correct_vehicle_meter_reading (INVOKER) corrects other people's
--         readings for holders of odometer_logs:view (Fleet Supervisor, Tyre Data
--         Collector, Data Monitor Officer) - passes through the capability arm.
--     web odometerLogs.updateOdometerLog  direct update - same rule.
--     process_daily_km, sync_ksa_kms_to_meter  SECURITY DEFINER - not affected.
--     Data: 2,888 rows; creators are Driver 1,733, Fleet Supervisor 58, Admin 8,
--     Workshop Supervisor 1; 1,088 have no creator (telematics / file loads).
-- Data loss: none (two ALTER POLICY).
-- Client behaviour that changes: a user without the Daily Operations module can
--   only change an action they created or are assigned; a field user can only
--   change their own meter reading (any day). Nothing the apps offer today is
--   removed.
-- Not covered: engine_hours_logs has the same blanket update policy
--   (correct_vehicle_meter_reading writes it too) - same fix, left for a
--   follow-up so its clients are read first. Other tables in RLS-10 untouched.
-- Rollback: at the foot.

alter policy action_items_update on public.action_items
  using (
    (select auth.uid()) is not null
    and (
      created_by = (select auth.uid())
      or assigned_user_id = (select auth.uid())
      or (select public.app_is_elevated())
      or (select public.is_super_admin())
      or (select public.app_user_can('daily_ops', 'view'))
    )
  );

alter policy odometer_logs_update on public.odometer_logs
  using (
    (select auth.uid()) is not null
    and (
      created_by = (select auth.uid())
      or (select public.app_is_elevated())
      or (select public.is_super_admin())
      or (select public.app_user_can('odometer_logs', 'view'))
    )
  );

-- ------------------------------------------------------------------------ VERIFY
-- (run 2026-11-12, rolled back; rows counted with UPDATE ... RETURNING)
--                        action_items  odometer_logs      transition_action_item  correct another user's reading
--   Driver                 0 (161)       2 = own (2,416)   refused P0002           refused (no capability, as before)
--   Tyre Man               0             0                 refused P0002           refused
--   Inspector (daily_ops)  161           0                 accepted                refused
--   Tyre Data Collector    161           2,416             accepted                accepted
--   Fleet Supervisor       0             2,416             refused P0002           accepted
--   KSA Manager            161           2,416             accepted                refused (canCorrect is capability based, as before)
--   Driver: insert a new reading, then update it  -> 1 row updated (control)
--
-- ---------------------------------------------------------------------- ROLLBACK
--   alter policy action_items_update on public.action_items using (auth.uid() is not null);
--   alter policy odometer_logs_update on public.odometer_logs using (auth.uid() is not null);
