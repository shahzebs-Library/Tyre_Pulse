-- ============================================================================
-- MIGRATIONS_V203 — Approval Delegation / Acting Approver
-- ============================================================================
-- Additive extension of the V95 approval-workflow engine (enterprise plan §6:
-- acting managers, leave delegation, backup approvers, temporary delegation).
-- Non-breaking: the existing engine (workflow_definitions / workflow_instances /
-- workflow_step_events + RPCs) is untouched. This table records that one user
-- (delegator) has authorised another (delegate) to act on approvals on their
-- behalf, optionally scoped to an entity_type and a time window.
--
-- A delegate's inbox surfaces delegated pending approvals via the
-- `myDelegatedApprovals()` service function, which reads this table defensively
-- (missing table → no delegated items, original behaviour preserved).
--
-- Org-scoped. Depends on V42 helpers: app_current_org(), set_updated_at(), and
-- the RBAC helper get_my_role(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.approval_delegations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  -- The person delegating their approval authority (defaults to the caller).
  delegator_id     uuid NOT NULL DEFAULT auth.uid(),
  -- The person authorised to act on the delegator's behalf.
  delegate_id      uuid NOT NULL,
  -- Optional scope: NULL = every approval type; else a specific entity_type
  -- (e.g. 'purchase_order','accident') matching workflow_definitions.entity_type.
  entity_type      text,
  reason           text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_delegations_not_self CHECK (delegate_id <> delegator_id),
  CONSTRAINT approval_delegations_window CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at
  )
);

CREATE INDEX IF NOT EXISTS idx_approval_delegations_org
  ON public.approval_delegations (organisation_id);
CREATE INDEX IF NOT EXISTS idx_approval_delegations_delegator
  ON public.approval_delegations (delegator_id);
CREATE INDEX IF NOT EXISTS idx_approval_delegations_delegate
  ON public.approval_delegations (delegate_id);
CREATE INDEX IF NOT EXISTS idx_approval_delegations_active
  ON public.approval_delegations (active);

DROP TRIGGER IF EXISTS set_updated_at_approval_delegations ON public.approval_delegations;
CREATE TRIGGER set_updated_at_approval_delegations BEFORE UPDATE ON public.approval_delegations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Within the org, any
-- authenticated member may read delegations (so a delegate can see that they
-- are named). Writes are restricted: a user manages their OWN delegations
-- (delegator_id = auth.uid()); Admin / Manager / Director may manage any.
ALTER TABLE public.approval_delegations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approval_delegations_org_isolation ON public.approval_delegations;
CREATE POLICY approval_delegations_org_isolation ON public.approval_delegations
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS approval_delegations_read ON public.approval_delegations;
CREATE POLICY approval_delegations_read ON public.approval_delegations FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS approval_delegations_insert ON public.approval_delegations;
CREATE POLICY approval_delegations_insert ON public.approval_delegations FOR INSERT
  WITH CHECK (
    delegator_id = auth.uid()
    OR public.get_my_role() IN ('Admin','Manager','Director')
  );

DROP POLICY IF EXISTS approval_delegations_update ON public.approval_delegations;
CREATE POLICY approval_delegations_update ON public.approval_delegations FOR UPDATE
  USING (
    delegator_id = auth.uid()
    OR public.get_my_role() IN ('Admin','Manager','Director')
  )
  WITH CHECK (
    delegator_id = auth.uid()
    OR public.get_my_role() IN ('Admin','Manager','Director')
  );

DROP POLICY IF EXISTS approval_delegations_delete ON public.approval_delegations;
CREATE POLICY approval_delegations_delete ON public.approval_delegations FOR DELETE
  USING (
    delegator_id = auth.uid()
    OR public.get_my_role() IN ('Admin','Manager','Director')
  );

REVOKE ALL ON public.approval_delegations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_delegations TO authenticated;

-- Reversible:
--   DROP TABLE public.approval_delegations;
