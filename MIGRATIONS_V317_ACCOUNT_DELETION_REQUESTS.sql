-- =============================================================================
-- MIGRATION V317 — Account & Data Deletion Requests
-- STATUS: NOT YET APPLIED  (write-only; do not auto-apply. Apply live via the
--         Supabase MCP / dashboard after review, then record in schema_migrations.)
-- =============================================================================
--
-- Purpose
--   Records in-app, self-service account/data deletion REQUESTS for admin action
--   (Google Play / privacy compliance: an in-app deletion REQUEST path, not a
--   client-side hard delete). Submitting a request NEVER deletes auth/user or
--   business data — an administrator verifies and actions each request offline.
--
-- Model
--   - A user can INSERT and SELECT their OWN request.
--   - Admin / super-admin can SELECT and UPDATE requests within their org
--     (to move status pending -> processing -> completed/rejected).
--   - Org isolation via app_current_org(); no destructive cascade here.
--
-- Consumed by: src/lib/api/accountDeletion.js (requestAccountDeletion /
--   listMyDeletionRequests). The service degrades gracefully (friendly
--   "not available yet" message / empty list) until this migration is applied.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL DEFAULT auth.uid()
                              REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id uuid        DEFAULT public.app_current_org(),
  email           text,
  reason          text,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  processed_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  processed_at    timestamptz
);

COMMENT ON TABLE public.account_deletion_requests IS
  'Self-service account/data deletion requests (V317). Records intent for admin action; never deletes data itself.';

-- Helpful lookup indexes (admin queue + per-user history).
CREATE INDEX IF NOT EXISTS account_deletion_requests_user_idx
  ON public.account_deletion_requests (user_id);
CREATE INDEX IF NOT EXISTS account_deletion_requests_org_status_idx
  ON public.account_deletion_requests (organisation_id, status);
CREATE INDEX IF NOT EXISTS account_deletion_requests_requested_at_idx
  ON public.account_deletion_requests (requested_at DESC);

-- =============================================================================
-- Row Level Security
-- =============================================================================
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests FORCE ROW LEVEL SECURITY;

-- Clean re-run safety.
DROP POLICY IF EXISTS adr_insert_own      ON public.account_deletion_requests;
DROP POLICY IF EXISTS adr_select_own      ON public.account_deletion_requests;
DROP POLICY IF EXISTS adr_select_admin    ON public.account_deletion_requests;
DROP POLICY IF EXISTS adr_update_admin    ON public.account_deletion_requests;

-- A user can file a request for THEMSELVES only.
CREATE POLICY adr_insert_own
  ON public.account_deletion_requests
  FOR INSERT
  TO authenticated
  WITH CHECK ( user_id = (select auth.uid()) );

-- A user can read their OWN requests.
CREATE POLICY adr_select_own
  ON public.account_deletion_requests
  FOR SELECT
  TO authenticated
  USING ( user_id = (select auth.uid()) );

-- Admin / super-admin can read requests within their org.
CREATE POLICY adr_select_admin
  ON public.account_deletion_requests
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR ( public.get_my_role() = 'Admin'
         AND organisation_id = public.app_current_org() )
  );

-- Admin / super-admin can update status/processing fields within their org.
CREATE POLICY adr_update_admin
  ON public.account_deletion_requests
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR ( public.get_my_role() = 'Admin'
         AND organisation_id = public.app_current_org() )
  )
  WITH CHECK (
    public.is_super_admin()
    OR ( public.get_my_role() = 'Admin'
         AND organisation_id = public.app_current_org() )
  );

-- No DELETE policy: requests are an immutable audit trail (admins resolve via status).

-- =============================================================================
-- END V317 — remember to REVOKE default anon access is already handled globally
-- by V281 (anon holds no table grants); authenticated access is governed by the
-- policies above.
-- =============================================================================
