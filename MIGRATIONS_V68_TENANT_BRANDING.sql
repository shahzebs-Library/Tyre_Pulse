-- ============================================================================
-- MIGRATIONS_V68_TENANT_BRANDING
-- Multi-tenant branding foundation for the Report Center.
--
-- Stores per-organisation branding (legal name, colours, logo, report theme,
-- footer, disclaimer, contact block) inside organisations.settings->'branding'.
-- Reads are open to any authenticated user for their own org (needed by
-- TenantContext + report generation). Writes are gated to org admins /
-- super admins via SECURITY DEFINER RPCs with server-side validation.
--
-- Additive & backward-compatible: no columns dropped, existing rows keep {} .
-- ============================================================================

-- ── Branding schema (documented) ───────────────────────────────────────────
-- settings->'branding' = {
--   "legal_name":      text,   -- registered legal entity name (report cover / footer)
--   "display_name":    text,   -- short brand name shown in the app header
--   "primary_color":   "#RRGGBB",
--   "secondary_color": "#RRGGBB",
--   "accent_color":    "#RRGGBB",
--   "logo_url":        text,   -- public/signed logo URL (mirrored to organisations.logo_url)
--   "report_theme":    "light" | "dark",
--   "footer_text":     text,
--   "disclaimer":      text,
--   "address":         text,
--   "contact_email":   text,   -- mirrored to organisations.contact_email
--   "contact_phone":   text,
--   "website":         text,
--   "updated_at":      timestamptz (server-stamped),
--   "updated_by":      uuid     (server-stamped)
-- }

-- ── Helper: validate a #RRGGBB hex colour (nullable passes) ────────────────
CREATE OR REPLACE FUNCTION public._is_hex_color(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT p IS NULL OR p ~ '^#[0-9A-Fa-f]{6}$';
$$;

-- ── get_org_branding(p_org_id) ─────────────────────────────────────────────
-- Returns the branding jsonb for an org. Defaults to the caller's current org.
-- Super admin / org admin may read any org; a normal user may only read their own.
CREATE OR REPLACE FUNCTION public.get_org_branding(p_org_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org    uuid;
  v_result jsonb;
BEGIN
  v_org := COALESCE(p_org_id, public.app_current_org());
  IF v_org IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Scope guard: only elevated roles may read a different org's branding.
  -- IS DISTINCT FROM treats a NULL current-org (anon / no-org caller) as
  -- "different", so an unauthenticated caller can never read another org.
  IF v_org IS DISTINCT FROM public.app_current_org() AND NOT public.app_is_org_admin() THEN
    RAISE EXCEPTION 'Not authorised to read branding for another organisation';
  END IF;

  SELECT jsonb_build_object(
           'org_id',        o.id,
           'name',          o.name,
           'logo_url',      COALESCE(o.settings->'branding'->>'logo_url', o.logo_url),
           'contact_email', COALESCE(o.settings->'branding'->>'contact_email', o.contact_email)
         ) || COALESCE(o.settings->'branding', '{}'::jsonb)
    INTO v_result
    FROM public.organisations o
   WHERE o.id = v_org;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ── set_org_branding(p_org_id, p_branding) ─────────────────────────────────
-- Merges validated branding into organisations.settings->'branding'.
-- Gated to org admins / super admins. Mirrors logo_url + contact_email to the
-- top-level columns. Writes an audit event. Returns the merged branding.
CREATE OR REPLACE FUNCTION public.set_org_branding(p_org_id uuid, p_branding jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org     uuid;
  v_old     jsonb;
  v_clean   jsonb;
  v_theme   text;
  v_merged  jsonb;
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN
    RAISE EXCEPTION 'Account not approved or is locked';
  END IF;
  IF NOT public.app_is_org_admin() THEN
    RAISE EXCEPTION 'Only an organisation admin or super admin may edit branding';
  END IF;

  v_org := COALESCE(p_org_id, public.app_current_org());
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No target organisation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organisations WHERE id = v_org) THEN
    RAISE EXCEPTION 'Organisation % does not exist', v_org;
  END IF;

  p_branding := COALESCE(p_branding, '{}'::jsonb);

  -- Validate colours.
  IF NOT public._is_hex_color(p_branding->>'primary_color')
     OR NOT public._is_hex_color(p_branding->>'secondary_color')
     OR NOT public._is_hex_color(p_branding->>'accent_color') THEN
    RAISE EXCEPTION 'Colours must be #RRGGBB hex values';
  END IF;

  -- Validate report theme.
  v_theme := p_branding->>'report_theme';
  IF v_theme IS NOT NULL AND v_theme NOT IN ('light','dark') THEN
    RAISE EXCEPTION 'report_theme must be light or dark';
  END IF;

  -- Whitelist the allowed keys (drop anything unexpected).
  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'legal_name',      NULLIF(trim(p_branding->>'legal_name'), ''),
    'display_name',    NULLIF(trim(p_branding->>'display_name'), ''),
    'primary_color',   p_branding->>'primary_color',
    'secondary_color', p_branding->>'secondary_color',
    'accent_color',    p_branding->>'accent_color',
    'logo_url',        NULLIF(trim(p_branding->>'logo_url'), ''),
    'report_theme',    v_theme,
    'footer_text',     NULLIF(trim(p_branding->>'footer_text'), ''),
    'disclaimer',      NULLIF(trim(p_branding->>'disclaimer'), ''),
    'address',         NULLIF(trim(p_branding->>'address'), ''),
    'contact_email',   NULLIF(trim(p_branding->>'contact_email'), ''),
    'contact_phone',   NULLIF(trim(p_branding->>'contact_phone'), ''),
    'website',         NULLIF(trim(p_branding->>'website'), '')
  ));

  SELECT settings->'branding' INTO v_old FROM public.organisations WHERE id = v_org;

  v_merged := v_clean
              || jsonb_build_object('updated_at', now(), 'updated_by', auth.uid());

  UPDATE public.organisations
     SET settings      = jsonb_set(COALESCE(settings, '{}'::jsonb), '{branding}', v_merged, true),
         logo_url      = COALESCE(v_clean->>'logo_url', logo_url),
         contact_email = COALESCE(v_clean->>'contact_email', contact_email),
         updated_at    = now()
   WHERE id = v_org;

  -- Best-effort audit (never block the write on audit failure).
  BEGIN
    PERFORM public.record_audit_event(
      'org_branding_update', 'organisations', v_org::text,
      COALESCE(v_old, '{}'::jsonb), v_merged);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_merged;
END;
$$;

-- Authenticated-only surfaces. REVOKE FROM PUBLIC does not remove Supabase's
-- default anon grant, so revoke anon explicitly as well.
REVOKE ALL ON FUNCTION public.get_org_branding(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_org_branding(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_org_branding(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_org_branding(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._is_hex_color(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_org_branding(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_org_branding(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public._is_hex_color(text) TO authenticated;
