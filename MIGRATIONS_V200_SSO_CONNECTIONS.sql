-- ============================================================================
-- MIGRATIONS_V200 — SSO Configuration: Identity-Provider Connections
-- ============================================================================
-- Backs the SSO Configuration module (route /sso-configuration). Stores the
-- tenant's single-sign-on identity-provider connections — SAML / OIDC / OAuth2
-- — so an organisation can federate authentication with its corporate IdP
-- (Okta, Azure AD / Entra, Google Workspace, PingFederate, …).
--
-- Each row is one IdP connection: its protocol, entity/issuer id, SSO endpoint,
-- the email domains it governs, default role and JIT-provisioning behaviour,
-- SSO enforcement, certificate expiry, and a status lifecycle.
--
-- SECURITY: this table NEVER stores private keys, client secrets, or signing
-- material. Only public connection metadata (entity id, SSO URL, public cert
-- expiry date) lives here; secrets belong in a dedicated secrets manager.
--
-- SSO configuration is privileged: any authenticated member may READ the
-- connections in their org, but only Admin / Manager / Director may create,
-- update or delete them. Org isolation is the hard boundary (RESTRICTIVE).
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sso_connections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid DEFAULT public.app_current_org(),
  country           text,
  connection_name   text NOT NULL,
  protocol          text
                      CHECK (protocol IN ('saml','oidc','oauth2')),
  idp_provider      text,
  idp_entity_id     text,
  sso_url           text,
  domains           text,
  default_role      text,
  enforce_sso       boolean NOT NULL DEFAULT false,
  jit_provisioning  boolean NOT NULL DEFAULT false,
  cert_expiry       date,
  status            text
                      CHECK (status IN ('draft','active','disabled','error')),
  last_login_at     timestamptz,
  notes             text,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sso_connections_org      ON public.sso_connections (organisation_id);
CREATE INDEX IF NOT EXISTS idx_sso_connections_protocol ON public.sso_connections (protocol);
CREATE INDEX IF NOT EXISTS idx_sso_connections_status   ON public.sso_connections (status);

DROP TRIGGER IF EXISTS set_updated_at_sso_connections ON public.sso_connections;
CREATE TRIGGER set_updated_at_sso_connections BEFORE UPDATE ON public.sso_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member may read the SSO connections in their org; only Admin/
-- Manager/Director may create, update or delete them (SSO config is privileged).
ALTER TABLE public.sso_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sso_connections_org_isolation ON public.sso_connections;
CREATE POLICY sso_connections_org_isolation ON public.sso_connections
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS sso_connections_read ON public.sso_connections;
CREATE POLICY sso_connections_read ON public.sso_connections FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS sso_connections_insert ON public.sso_connections;
CREATE POLICY sso_connections_insert ON public.sso_connections FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS sso_connections_update ON public.sso_connections;
CREATE POLICY sso_connections_update ON public.sso_connections FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS sso_connections_delete ON public.sso_connections;
CREATE POLICY sso_connections_delete ON public.sso_connections FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.sso_connections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sso_connections TO authenticated;

-- Reversible:
--   DROP TABLE public.sso_connections;
