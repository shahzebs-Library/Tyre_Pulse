-- ============================================================================
-- MIGRATIONS_V194 — Developer Portal (API Keys + Webhook Endpoints)
-- ============================================================================
-- Backs the Developer Portal module (/developer-portal). Lets integrators and
-- platform admins manage the credentials and delivery targets that external
-- systems use to talk to Tyre Pulse:
--
--   • api_keys           — issued API credentials (metadata only)
--   • webhook_endpoints  — outbound event-delivery targets
--
-- SECURITY — CREDENTIAL HANDLING:
-- This schema never stores raw API secrets. `api_keys` keeps only a display
-- hint (`key_prefix`, e.g. "tp_live_9f3c…") and a human label (`key_name`); the
-- real secret is shown once at generation time by the issuing service and then
-- discarded. `webhook_endpoints` stores only whether a signing secret is set
-- (`secret_set` boolean) — never the secret value itself. This keeps the
-- database safe to back up, replicate, and export without leaking credentials.
--
-- Both tables are org-isolated (RESTRICTIVE RLS) and country-scoped. Depends on
-- V42 helpers: app_current_org(), set_updated_at(). Idempotent and safe to
-- re-run.
-- ============================================================================

-- ============================================================================
-- (a) api_keys — issued API credential metadata
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.developer_api_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  key_name         text NOT NULL,
  key_prefix       text,
  scopes           text,
  environment      text
                     CHECK (environment IN ('sandbox','production')),
  status           text
                     CHECK (status IN ('active','revoked','expired')),
  rate_limit       integer,
  last_used_at     timestamptz,
  expires_at       timestamptz,
  created_label    text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_developer_api_keys_org    ON public.developer_api_keys (organisation_id);
CREATE INDEX IF NOT EXISTS idx_developer_api_keys_status ON public.developer_api_keys (status);

DROP TRIGGER IF EXISTS set_updated_at_developer_api_keys ON public.developer_api_keys;
CREATE TRIGGER set_updated_at_developer_api_keys BEFORE UPDATE ON public.developer_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read, issue (insert), rotate/edit (update), and revoke (delete)
-- API key records for their own org.
ALTER TABLE public.developer_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS developer_api_keys_org_isolation ON public.developer_api_keys;
CREATE POLICY developer_api_keys_org_isolation ON public.developer_api_keys
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS developer_api_keys_read ON public.developer_api_keys;
CREATE POLICY developer_api_keys_read ON public.developer_api_keys FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS developer_api_keys_insert ON public.developer_api_keys;
CREATE POLICY developer_api_keys_insert ON public.developer_api_keys FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS developer_api_keys_update ON public.developer_api_keys;
CREATE POLICY developer_api_keys_update ON public.developer_api_keys FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS developer_api_keys_delete ON public.developer_api_keys;
CREATE POLICY developer_api_keys_delete ON public.developer_api_keys FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.developer_api_keys FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.developer_api_keys TO authenticated;

-- ============================================================================
-- (b) webhook_endpoints — outbound event-delivery targets
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  endpoint_name    text NOT NULL,
  url              text,
  event_types      text,
  status           text
                     CHECK (status IN ('active','paused','failing','disabled')),
  last_delivery_at timestamptz,
  failure_count    integer,
  secret_set       boolean DEFAULT false,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org    ON public.webhook_endpoints (organisation_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_status ON public.webhook_endpoints (status);

DROP TRIGGER IF EXISTS set_updated_at_webhook_endpoints ON public.webhook_endpoints;
CREATE TRIGGER set_updated_at_webhook_endpoints BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read, register (insert), edit (update), and remove (delete)
-- webhook endpoints for their own org.
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_endpoints_org_isolation ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_org_isolation ON public.webhook_endpoints
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS webhook_endpoints_read ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_read ON public.webhook_endpoints FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS webhook_endpoints_insert ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_insert ON public.webhook_endpoints FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS webhook_endpoints_update ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_update ON public.webhook_endpoints FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS webhook_endpoints_delete ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_delete ON public.webhook_endpoints FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.webhook_endpoints FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_endpoints TO authenticated;

-- ============================================================================
-- Reversible:
--   DROP TABLE public.webhook_endpoints;
--   DROP TABLE public.developer_api_keys;
-- ============================================================================
