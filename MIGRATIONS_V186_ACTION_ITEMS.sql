-- ============================================================================
-- MIGRATIONS_V186 — Action Center / Exception Items
-- ============================================================================
-- Backs the Action Center module (/action-center): a unified, prioritised queue
-- of operational exceptions and required actions across the fleet — safety,
-- compliance, maintenance, cost, tyre, inspection, and data-quality issues that
-- demand a human decision. One row is one actionable exception, with a severity,
-- a priority score, an owner, a due date, and a resolution lifecycle.
--
-- This is the operational backbone of the OS's "fleet decision engine" posture:
-- every observation converges here so nothing critical is lost in a per-module
-- silo. Org-isolated, country-scoped, auditable.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.action_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid DEFAULT public.app_current_org(),
  country            text,
  title              text NOT NULL,
  category           text
                       CHECK (category IN ('safety','compliance','maintenance',
                              'cost','tyre','inspection','data_quality','other')),
  source             text,
  asset_no           text,
  severity           text
                       CHECK (severity IN ('info','low','medium','high','critical')),
  priority_score     numeric,
  assigned_to        text,
  due_date           date,
  status             text
                       CHECK (status IN ('open','acknowledged','in_progress',
                              'resolved','dismissed')),
  impact             text,
  recommended_action text,
  resolution         text,
  notes              text,
  created_by         uuid DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Indexes tuned for the Action Center query surface: org scoping, category
-- breakdowns, due-date sorting (overdue detection), status filtering, and
-- priority ordering (worst-first triage).
CREATE INDEX IF NOT EXISTS idx_action_items_org      ON public.action_items (organisation_id);
CREATE INDEX IF NOT EXISTS idx_action_items_category ON public.action_items (category);
CREATE INDEX IF NOT EXISTS idx_action_items_due      ON public.action_items (due_date);
CREATE INDEX IF NOT EXISTS idx_action_items_status   ON public.action_items (status);
CREATE INDEX IF NOT EXISTS idx_action_items_priority ON public.action_items (priority_score DESC);

DROP TRIGGER IF EXISTS set_updated_at_action_items ON public.action_items;
CREATE TRIGGER set_updated_at_action_items BEFORE UPDATE ON public.action_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read, raise, action, and close items —
-- exception triage is a routine cross-functional ops activity.
ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS action_items_org_isolation ON public.action_items;
CREATE POLICY action_items_org_isolation ON public.action_items
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS action_items_read ON public.action_items;
CREATE POLICY action_items_read ON public.action_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS action_items_insert ON public.action_items;
CREATE POLICY action_items_insert ON public.action_items FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS action_items_update ON public.action_items;
CREATE POLICY action_items_update ON public.action_items FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS action_items_delete ON public.action_items;
CREATE POLICY action_items_delete ON public.action_items FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.action_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.action_items TO authenticated;

-- Reversible:
--   DROP TABLE public.action_items;
