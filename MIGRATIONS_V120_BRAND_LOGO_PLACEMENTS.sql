-- ============================================================================
-- MIGRATIONS_V120_BRAND_LOGO_PLACEMENTS
-- Per-organisation logo placements for the Brand Logo Studio.
--
-- Extends V68 branding with a validated `logos` map inside
-- organisations.settings->'branding'->'logos':
--   { "<slot>": "<library-asset-id | https URL | /relative path>", ... }
--
-- Slots (client: src/lib/brand/library.js → LOGO_SLOTS):
--   app_icon | login | favicon | report_cover | email_header |
--   mobile_splash | pdf_watermark
--
-- Design notes
--   • Additive & backward-compatible — no columns dropped, existing rows keep
--     their current branding; `logos` defaults to {}.
--   • Full backward compat with the existing colour/report editor: when a
--     caller does NOT send `logos`, the previously-stored map is PRESERVED
--     (the old function replaced the whole branding object, which would have
--     silently wiped placements). When `logos` IS sent, it fully replaces the
--     stored map after server-side validation.
--   • report_cover is mirrored into the legacy `logo_url` so existing report
--     generation (which reads branding.logo_url) picks up the selection with
--     no code change — unless the caller also sends an explicit logo_url.
--   • Writes remain gated to org admins / super admins; values are validated
--     and length-capped server-side. Idempotent (CREATE OR REPLACE).
-- ============================================================================

-- ── Validate & normalise a logos map ───────────────────────────────────────
-- Drops unknown slots, trims values, rejects anything that is not a known
-- shape (asset id  ^[a-z0-9-]{1,64}$  |  http(s):// URL  |  /relative path),
-- and caps value length at 512 chars. Returns a clean jsonb object ({} if none).
CREATE OR REPLACE FUNCTION public._clean_brand_logos(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'app_icon','login','favicon','report_cover',
    'email_header','mobile_splash','pdf_watermark'
  ];
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_val text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p) LOOP
    CONTINUE WHEN NOT (v_key = ANY (v_allowed));
    IF jsonb_typeof(p->v_key) <> 'string' THEN CONTINUE; END IF;

    v_val := btrim(p->>v_key);
    CONTINUE WHEN v_val IS NULL OR v_val = '';
    IF length(v_val) > 512 THEN
      RAISE EXCEPTION 'Logo value for % is too long', v_key;
    END IF;

    IF v_val ~ '^[a-z0-9-]{1,64}$'          -- library asset id
       OR v_val ~ '^https?://'              -- absolute URL
       OR v_val ~ '^/[^ ]*$' THEN           -- root-relative path
      v_out := v_out || jsonb_build_object(v_key, v_val);
    ELSE
      RAISE EXCEPTION 'Invalid logo value for %: must be an asset id, URL or /path', v_key;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

-- ── set_org_branding(p_org_id, p_branding) — logos-aware replacement ────────
CREATE OR REPLACE FUNCTION public.set_org_branding(p_org_id uuid, p_branding jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_old      jsonb;
  v_clean    jsonb;
  v_theme    text;
  v_logos    jsonb;
  v_logo_url text;
  v_merged   jsonb;
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

  SELECT settings->'branding' INTO v_old FROM public.organisations WHERE id = v_org;
  v_old := COALESCE(v_old, '{}'::jsonb);

  -- Logos: replace with the validated payload when supplied, otherwise carry
  -- the existing map forward so non-placement editors never wipe it.
  IF p_branding ? 'logos' THEN
    v_logos := public._clean_brand_logos(p_branding->'logos');
  ELSE
    v_logos := COALESCE(v_old->'logos', '{}'::jsonb);
  END IF;

  -- report_cover placement mirrors into logo_url (legacy report path) unless an
  -- explicit logo_url is provided in this call.
  v_logo_url := NULLIF(btrim(p_branding->>'logo_url'), '');
  IF v_logo_url IS NULL AND (v_logos ? 'report_cover') THEN
    v_logo_url := CASE
      WHEN (v_logos->>'report_cover') ~ '^[a-z0-9-]{1,64}$'
        THEN '/brand/library/' || (v_logos->>'report_cover') || '.png'
      ELSE v_logos->>'report_cover'
    END;
  END IF;

  -- Whitelist the allowed keys (drop anything unexpected).
  v_clean := jsonb_strip_nulls(jsonb_build_object(
    'legal_name',      NULLIF(trim(p_branding->>'legal_name'), ''),
    'display_name',    NULLIF(trim(p_branding->>'display_name'), ''),
    'primary_color',   p_branding->>'primary_color',
    'secondary_color', p_branding->>'secondary_color',
    'accent_color',    p_branding->>'accent_color',
    'logo_url',        v_logo_url,
    'report_theme',    v_theme,
    'footer_text',     NULLIF(trim(p_branding->>'footer_text'), ''),
    'disclaimer',      NULLIF(trim(p_branding->>'disclaimer'), ''),
    'address',         NULLIF(trim(p_branding->>'address'), ''),
    'contact_email',   NULLIF(trim(p_branding->>'contact_email'), ''),
    'contact_phone',   NULLIF(trim(p_branding->>'contact_phone'), ''),
    'website',         NULLIF(trim(p_branding->>'website'), '')
  ));

  -- Attach the logos map (kept even when empty so the shape is stable).
  v_merged := v_clean
              || jsonb_build_object('logos', v_logos)
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

-- Authenticated-only surface (mirror V68 grants for the new helper).
REVOKE ALL     ON FUNCTION public._clean_brand_logos(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._clean_brand_logos(jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public._clean_brand_logos(jsonb) TO authenticated;

REVOKE ALL     ON FUNCTION public.set_org_branding(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_org_branding(uuid, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_org_branding(uuid, jsonb) TO authenticated;
