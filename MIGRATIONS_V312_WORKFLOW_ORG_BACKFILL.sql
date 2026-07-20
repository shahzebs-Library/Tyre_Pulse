-- MIGRATIONS_V312_WORKFLOW_ORG_BACKFILL.sql
-- NOT YET APPLIED. To be applied by the parent session after review.
-- Purpose: backfill organisation_id on the workflow/event/notification tables that V310 left
--   with a permissive `(organisation_id IS NULL OR organisation_id = app_current_org())` branch
--   because they held null-org rows, then TIGHTEN the RLS SELECT policy (drop the null-org branch,
--   keep the existing role gate) ONLY on tables where every row becomes org-stamped.
-- Design: additive + reversible. Backfills touch ONLY rows currently NULL and only where a source
--   exists; truly underivable rows are left NULL. Policy changes are DROP+CREATE (rollback = restore
--   the original qual, preserved in comments beside each policy).
--
-- READ-ONLY investigation summary (live counts at authoring time, project jhssdmeruxtrlqnwfksc):
--   workflow_definitions   25 rows, 25 null-org  -> NO source (created_by all NULL, no FK to org)         -> NOT tightened
--   workflow_instances     37 rows, 37 null-org  -> started_by -> profiles.org_id (37/37, single org)     -> TIGHTENED
--   workflow_step_events   82 rows, 82 null-org  -> instance_id -> workflow_instances.organisation_id     -> TIGHTENED
--   workflow_notifications 38 rows, 24 null-org  -> instance_id -> workflow_instances.organisation_id     -> TIGHTENED
--   domain_events        2550 rows, 82 null-org  -> actor_id -> profiles.org_id (62/82; 20 have no actor) -> backfill only, NOT tightened
--   rule_executions         0 rows,  0 null-org  -> rule_id -> business_rules.organisation_id (vacuous)   -> TIGHTENED
--   report_send_log       158 rows,158 null-org  -> schedule_id -> report_schedules.org_id but that col
--                                                   is NULL for all 6 schedules -> NO derivable source    -> NOT tightened

BEGIN;

-- ============================================================================
-- 1. BACKFILLS (only WHERE organisation_id IS NULL AND a source exists)
-- ============================================================================

-- 1a. workflow_instances <- profiles.org_id via started_by (definition_id.org is itself NULL, so
--     the actor's org is the reliable source). All 37 null rows resolve to a single org.
UPDATE public.workflow_instances wi
SET organisation_id = p.org_id
FROM public.profiles p
WHERE wi.organisation_id IS NULL
  AND wi.started_by = p.id
  AND p.org_id IS NOT NULL;

-- 1b. workflow_step_events <- workflow_instances.organisation_id (parent now stamped by 1a).
UPDATE public.workflow_step_events se
SET organisation_id = wi.organisation_id
FROM public.workflow_instances wi
WHERE se.organisation_id IS NULL
  AND se.instance_id = wi.id
  AND wi.organisation_id IS NOT NULL;

-- 1c. workflow_notifications <- workflow_instances.organisation_id (parent now stamped by 1a).
UPDATE public.workflow_notifications wn
SET organisation_id = wi.organisation_id
FROM public.workflow_instances wi
WHERE wn.organisation_id IS NULL
  AND wn.instance_id = wi.id
  AND wi.organisation_id IS NOT NULL;

-- 1d. domain_events <- profiles.org_id via actor_id. PARTIAL: ~62 of 82 null rows resolve; the
--     remaining ~20 have no actor_id and no other org source, so they stay NULL by design.
--     (Because null rows remain, the SELECT policy is NOT tightened below.)
UPDATE public.domain_events de
SET organisation_id = p.org_id
FROM public.profiles p
WHERE de.organisation_id IS NULL
  AND de.actor_id = p.id
  AND p.org_id IS NOT NULL;

-- 1e. rule_executions <- business_rules.organisation_id via rule_id. Currently 0 rows (no-op today);
--     included so any rows inserted before this migration would also be stamped.
UPDATE public.rule_executions re
SET organisation_id = br.organisation_id
FROM public.business_rules br
WHERE re.organisation_id IS NULL
  AND re.rule_id = br.id
  AND br.organisation_id IS NOT NULL;

-- workflow_definitions: intentionally NOT backfilled. All 25 rows have created_by NULL and there is
--   no FK to an org-bearing parent, so no source exists. Left NULL; policy NOT tightened.
-- report_send_log: intentionally NOT backfilled. schedule_id -> report_schedules exists for 130/158
--   rows, but report_schedules.org_id is NULL for every schedule, so nothing derivable. It is a pure
--   delivery log. Left NULL; policy NOT tightened.

-- ============================================================================
-- 2. TIGHTEN RLS SELECT POLICIES (drop the `organisation_id IS NULL` branch, keep the role gate)
--    Only on tables confirmed 0 null-org after step 1.
-- ============================================================================

-- 2a. workflow_instances (no role gate in original; org branch only)
--     ROLLBACK qual: ((organisation_id IS NULL) OR (organisation_id = (SELECT app_current_org())))
DROP POLICY IF EXISTS workflow_instances_select ON public.workflow_instances;
CREATE POLICY workflow_instances_select ON public.workflow_instances
  FOR SELECT
  USING (organisation_id = (SELECT app_current_org()));

-- 2b. workflow_step_events (no role gate in original; org branch only)
--     ROLLBACK qual: ((organisation_id IS NULL) OR (organisation_id = (SELECT app_current_org())))
DROP POLICY IF EXISTS workflow_step_events_select ON public.workflow_step_events;
CREATE POLICY workflow_step_events_select ON public.workflow_step_events
  FOR SELECT
  USING (organisation_id = (SELECT app_current_org()));

-- 2c. workflow_notifications (role gate = is_elevated_user())
--     ROLLBACK qual: (is_elevated_user() AND ((organisation_id IS NULL) OR (organisation_id = (SELECT app_current_org()))))
DROP POLICY IF EXISTS workflow_notifications_select ON public.workflow_notifications;
CREATE POLICY workflow_notifications_select ON public.workflow_notifications
  FOR SELECT
  USING (
    (SELECT is_elevated_user())
    AND organisation_id = (SELECT app_current_org())
  );

-- 2d. rule_executions (role gate = is_elevated_user()) -- 0 rows, vacuously safe
--     ROLLBACK qual: (is_elevated_user() AND ((organisation_id IS NULL) OR (organisation_id = (SELECT app_current_org()))))
DROP POLICY IF EXISTS rule_executions_select ON public.rule_executions;
CREATE POLICY rule_executions_select ON public.rule_executions
  FOR SELECT
  USING (
    (SELECT is_elevated_user())
    AND organisation_id = (SELECT app_current_org())
  );

-- NOT TIGHTENED (null-org rows remain by design):
--   * workflow_definitions  -- 25 underivable rows (no created_by, no org FK). Keep the null-org
--                              branch so seeded/global definitions stay visible.
--   * domain_events         -- ~20 rows have no actor_id and no derivable org after backfill.
--   * report_send_log       -- 158 rows, no derivable org (report_schedules.org_id is itself NULL).
--   Their original V310-era SELECT policies are left unchanged.

COMMIT;

-- Optional verification after apply (should each return 0 for the tightened tables):
--   SELECT count(*) FROM public.workflow_instances    WHERE organisation_id IS NULL;
--   SELECT count(*) FROM public.workflow_step_events   WHERE organisation_id IS NULL;
--   SELECT count(*) FROM public.workflow_notifications WHERE organisation_id IS NULL;
--   SELECT count(*) FROM public.rule_executions        WHERE organisation_id IS NULL;
