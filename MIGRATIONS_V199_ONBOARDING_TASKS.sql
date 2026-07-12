-- ============================================================================
-- MIGRATIONS_V199 — Onboarding Wizard: Tenant Setup Tasks
-- ============================================================================
-- Backs the Onboarding Wizard module (/onboarding). Tracks a guided tenant
-- setup checklist — the tasks a new organisation works through to go live on
-- Tyre Pulse (account setup, data import, configuration, team, integrations,
-- go-live). Each row is one setup task with a lifecycle status, owner, due
-- date, and phase, so a tenant's activation progress is measurable, auditable,
-- and resumable across sessions.
--
-- Progress roll-ups (completion %, per-phase progress, go-live readiness) live
-- in the pure `src/lib/onboarding.js` helpers; this table is the source data.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.onboarding_tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  phase            text NOT NULL
                     CHECK (phase IN ('setup','data_import','configuration','team','integration','go_live')),
  title            text NOT NULL,
  description      text,
  sort_order       integer DEFAULT 0,
  required         boolean NOT NULL DEFAULT true,
  status           text NOT NULL DEFAULT 'not_started'
                     CHECK (status IN ('not_started','in_progress','completed','skipped','blocked')),
  owner            text,
  due_date         date,
  completed_at     timestamptz,
  help_url         text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_org    ON public.onboarding_tasks (organisation_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_phase  ON public.onboarding_tasks (phase);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_status ON public.onboarding_tasks (status);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_sort   ON public.onboarding_tasks (sort_order);

DROP TRIGGER IF EXISTS set_updated_at_onboarding_tasks ON public.onboarding_tasks;
CREATE TRIGGER set_updated_at_onboarding_tasks BEFORE UPDATE ON public.onboarding_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read the checklist and update task
-- progress — onboarding is a shared, collaborative activation activity.
ALTER TABLE public.onboarding_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_tasks_org_isolation ON public.onboarding_tasks;
CREATE POLICY onboarding_tasks_org_isolation ON public.onboarding_tasks
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS onboarding_tasks_read ON public.onboarding_tasks;
CREATE POLICY onboarding_tasks_read ON public.onboarding_tasks FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS onboarding_tasks_insert ON public.onboarding_tasks;
CREATE POLICY onboarding_tasks_insert ON public.onboarding_tasks FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS onboarding_tasks_update ON public.onboarding_tasks;
CREATE POLICY onboarding_tasks_update ON public.onboarding_tasks FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS onboarding_tasks_delete ON public.onboarding_tasks;
CREATE POLICY onboarding_tasks_delete ON public.onboarding_tasks FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.onboarding_tasks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_tasks TO authenticated;

-- Reversible:
--   DROP TABLE public.onboarding_tasks;
