-- ============================================================================
-- MIGRATIONS_V127 — Help Center: Support Tickets
-- ============================================================================
-- Backs the in-app Help Center. Any authenticated member can raise a support
-- ticket ("Report an issue" / ask a question); admins/managers triage and
-- respond. Org-isolated, country-scoped, with a lightweight status lifecycle
-- and threaded admin responses.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  subject          text NOT NULL,
  category         text NOT NULL DEFAULT 'question'
                     CHECK (category IN ('bug','question','feature','data','account','other')),
  severity         text NOT NULL DEFAULT 'medium'
                     CHECK (severity IN ('low','medium','high','critical')),
  message          text NOT NULL,
  page_url         text,
  app_context      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','in_progress','resolved','closed')),
  admin_response   text,
  responded_by     uuid,
  responded_at     timestamptz,
  created_by       uuid DEFAULT auth.uid(),
  created_by_name  text,
  created_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_org     ON public.support_tickets (organisation_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status  ON public.support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_creator ON public.support_tickets (created_by);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON public.support_tickets (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_support_tickets ON public.support_tickets;
CREATE TRIGGER set_updated_at_support_tickets BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: a member
-- sees their OWN tickets; Admin/Manager/Director see all tickets in the org and
-- may triage/respond. Anyone authenticated can raise a ticket.
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_org_isolation ON public.support_tickets;
CREATE POLICY support_tickets_org_isolation ON public.support_tickets
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS support_tickets_read ON public.support_tickets;
CREATE POLICY support_tickets_read ON public.support_tickets FOR SELECT
  USING (
    created_by = auth.uid()
    OR public.get_my_role() IN ('Admin','Manager','Director')
  );

DROP POLICY IF EXISTS support_tickets_insert ON public.support_tickets;
CREATE POLICY support_tickets_insert ON public.support_tickets FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Creator may update their own open ticket (edit details); triage roles may
-- update any ticket in the org (status + response).
DROP POLICY IF EXISTS support_tickets_update ON public.support_tickets;
CREATE POLICY support_tickets_update ON public.support_tickets FOR UPDATE
  USING (
    created_by = auth.uid()
    OR public.get_my_role() IN ('Admin','Manager','Director')
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.get_my_role() IN ('Admin','Manager','Director')
  );

DROP POLICY IF EXISTS support_tickets_delete ON public.support_tickets;
CREATE POLICY support_tickets_delete ON public.support_tickets FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.support_tickets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO authenticated;

-- Reversible:
--   DROP TABLE public.support_tickets;
