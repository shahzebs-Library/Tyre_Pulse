-- ============================================================================
-- MIGRATIONS_V434_CRITICAL_DB_WIRING.sql
--
-- Restores critical database objects referenced by the application:
--   * RFID readers, read events, and alerts
--   * Atomic workspace-owner onboarding
--   * Inspection-finding vector search
--   * Authorized checklist assignment generation
--   * Backwards-compatible console audit target handling
--
-- This migration is additive/hardening-focused and idempotent. It assumes the
-- existing rfid_tags, organisations, profiles, inspections, checklist, and
-- console_sessions objects from the migrations named in each section below.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. RFID wiring
--    App contract: src/pages/RfidRegistry.jsx and src/components/RfidScanner.jsx
--    Depends on: rfid_tags, app_current_org(), app_is_active(),
--    app_is_elevated(), app_is_org_admin(), app_country_scope(),
--    app_sees_all_countries(), is_super_admin(), set_updated_at().
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rfid_readers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL DEFAULT public.app_current_org()
                      REFERENCES public.organisations(id),
  country           text,
  region            text,
  site              text,
  reader_uid        text NOT NULL,
  name              text NOT NULL,
  location          text,
  zone_name         text,
  zone_type         text CHECK (
                      zone_type IS NULL OR zone_type IN
                        ('entry','exit','storage','workshop','vehicle','yard')
                    ),
  latitude          numeric(10,8),
  longitude         numeric(11,8),
  reader_type       text CHECK (
                      reader_type IS NULL OR reader_type IN
                        ('fixed','mobile','handheld')
                    ),
  status            text NOT NULL DEFAULT 'active' CHECK (
                      status IN ('active','inactive','maintenance','offline')
                    ),
  last_heartbeat    timestamptz,
  firmware_version  text,
  created_by        uuid DEFAULT auth.uid()
                      REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfid_readers_org_uid_uniq UNIQUE (organisation_id, reader_uid)
);

CREATE TABLE IF NOT EXISTS public.rfid_read_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL DEFAULT public.app_current_org()
                      REFERENCES public.organisations(id),
  country           text,
  region            text,
  site              text,
  tag_id             uuid REFERENCES public.rfid_tags(id) ON DELETE SET NULL,
  tag_uid            text NOT NULL,
  reader_id          uuid REFERENCES public.rfid_readers(id) ON DELETE SET NULL,
  rssi               smallint,
  read_count         integer NOT NULL DEFAULT 1 CHECK (read_count > 0),
  antenna            smallint,
  zone_name          text,
  latitude           numeric(10,8),
  longitude          numeric(11,8),
  read_at            timestamptz NOT NULL DEFAULT now(),
  created_by         uuid DEFAULT auth.uid()
                      REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rfid_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL DEFAULT public.app_current_org()
                      REFERENCES public.organisations(id),
  country           text,
  region            text,
  site              text,
  tag_id             uuid REFERENCES public.rfid_tags(id) ON DELETE SET NULL,
  tag_uid            text,
  reader_id          uuid REFERENCES public.rfid_readers(id) ON DELETE SET NULL,
  alert_type         text NOT NULL CHECK (
                      alert_type IN (
                        'tag_not_seen','zone_violation','duplicate_read',
                        'low_battery','tamper_detected','unauthorized_move',
                        'lost_tag','reader_offline'
                      )
                    ),
  severity          text NOT NULL DEFAULT 'medium' CHECK (
                      severity IN ('low','medium','high','critical')
                    ),
  message           text NOT NULL,
  current_zone      text,
  expected_zone     text,
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_notes  text,
  created_by        uuid DEFAULT auth.uid()
                      REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfid_alerts_subject_chk CHECK (
    tag_id IS NOT NULL OR reader_id IS NOT NULL OR tag_uid IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_rfid_readers_org
  ON public.rfid_readers (organisation_id);
CREATE INDEX IF NOT EXISTS idx_rfid_readers_country_site
  ON public.rfid_readers (country, site);
CREATE INDEX IF NOT EXISTS idx_rfid_readers_status
  ON public.rfid_readers (status);
CREATE INDEX IF NOT EXISTS idx_rfid_readers_zone
  ON public.rfid_readers (zone_name);
CREATE INDEX IF NOT EXISTS idx_rfid_readers_created_by
  ON public.rfid_readers (created_by);

CREATE INDEX IF NOT EXISTS idx_rfid_read_events_org_read_at
  ON public.rfid_read_events (organisation_id, read_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfid_read_events_country_site
  ON public.rfid_read_events (country, site);
CREATE INDEX IF NOT EXISTS idx_rfid_read_events_tag_id
  ON public.rfid_read_events (tag_id);
CREATE INDEX IF NOT EXISTS idx_rfid_read_events_tag_uid
  ON public.rfid_read_events (tag_uid, read_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfid_read_events_reader_id
  ON public.rfid_read_events (reader_id);
CREATE INDEX IF NOT EXISTS idx_rfid_read_events_created_by
  ON public.rfid_read_events (created_by);

CREATE INDEX IF NOT EXISTS idx_rfid_alerts_org_created
  ON public.rfid_alerts (organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfid_alerts_country_site
  ON public.rfid_alerts (country, site);
CREATE INDEX IF NOT EXISTS idx_rfid_alerts_tag_id
  ON public.rfid_alerts (tag_id);
CREATE INDEX IF NOT EXISTS idx_rfid_alerts_reader_id
  ON public.rfid_alerts (reader_id);
CREATE INDEX IF NOT EXISTS idx_rfid_alerts_open
  ON public.rfid_alerts (organisation_id, severity, created_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rfid_alerts_resolved_by
  ON public.rfid_alerts (resolved_by);
CREATE INDEX IF NOT EXISTS idx_rfid_alerts_created_by
  ON public.rfid_alerts (created_by);

DROP TRIGGER IF EXISTS set_updated_at_rfid_readers ON public.rfid_readers;
CREATE TRIGGER set_updated_at_rfid_readers
  BEFORE UPDATE ON public.rfid_readers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_rfid_alerts ON public.rfid_alerts;
CREATE TRIGGER set_updated_at_rfid_alerts
  BEFORE UPDATE ON public.rfid_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.rfid_readers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_read_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfid_alerts      ENABLE ROW LEVEL SECURITY;

-- Remove the broad policies from the abandoned V122 draft if a partial version
-- of that migration was ever installed.
DROP POLICY IF EXISTS "Auth users full access" ON public.rfid_readers;
DROP POLICY IF EXISTS "Auth users full access" ON public.rfid_read_events;
DROP POLICY IF EXISTS "Auth users full access" ON public.rfid_alerts;

-- Organisation is the hard tenant boundary. True super-admins retain the
-- established cross-organisation support path from V306.
DROP POLICY IF EXISTS rfid_readers_org_isolation ON public.rfid_readers;
CREATE POLICY rfid_readers_org_isolation ON public.rfid_readers
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    organisation_id = (SELECT public.app_current_org())
    OR (SELECT public.is_super_admin())
  )
  WITH CHECK (
    organisation_id = (SELECT public.app_current_org())
    OR (SELECT public.is_super_admin())
  );

DROP POLICY IF EXISTS rfid_read_events_org_isolation ON public.rfid_read_events;
CREATE POLICY rfid_read_events_org_isolation ON public.rfid_read_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    organisation_id = (SELECT public.app_current_org())
    OR (SELECT public.is_super_admin())
  )
  WITH CHECK (
    organisation_id = (SELECT public.app_current_org())
    OR (SELECT public.is_super_admin())
  );

DROP POLICY IF EXISTS rfid_alerts_org_isolation ON public.rfid_alerts;
CREATE POLICY rfid_alerts_org_isolation ON public.rfid_alerts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    organisation_id = (SELECT public.app_current_org())
    OR (SELECT public.is_super_admin())
  )
  WITH CHECK (
    organisation_id = (SELECT public.app_current_org())
    OR (SELECT public.is_super_admin())
  );

-- Country boundary in the V396 InitPlan form. Admins may work across countries
-- inside their own organisation; explicitly scoped users see only their list.
DROP POLICY IF EXISTS rfid_readers_country_isolation ON public.rfid_readers;
CREATE POLICY rfid_readers_country_isolation ON public.rfid_readers
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    country IS NULL
    OR (SELECT public.app_is_org_admin())
    OR (SELECT public.app_sees_all_countries())
    OR lower(btrim(country)) = ANY (
      coalesce((SELECT public.app_country_scope()), '{}'::text[])
    )
  )
  WITH CHECK (
    country IS NULL
    OR (SELECT public.app_is_org_admin())
    OR (SELECT public.app_sees_all_countries())
    OR lower(btrim(country)) = ANY (
      coalesce((SELECT public.app_country_scope()), '{}'::text[])
    )
  );

DROP POLICY IF EXISTS rfid_read_events_country_isolation ON public.rfid_read_events;
CREATE POLICY rfid_read_events_country_isolation ON public.rfid_read_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    country IS NULL
    OR (SELECT public.app_is_org_admin())
    OR (SELECT public.app_sees_all_countries())
    OR lower(btrim(country)) = ANY (
      coalesce((SELECT public.app_country_scope()), '{}'::text[])
    )
  )
  WITH CHECK (
    country IS NULL
    OR (SELECT public.app_is_org_admin())
    OR (SELECT public.app_sees_all_countries())
    OR lower(btrim(country)) = ANY (
      coalesce((SELECT public.app_country_scope()), '{}'::text[])
    )
  );

DROP POLICY IF EXISTS rfid_alerts_country_isolation ON public.rfid_alerts;
CREATE POLICY rfid_alerts_country_isolation ON public.rfid_alerts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    country IS NULL
    OR (SELECT public.app_is_org_admin())
    OR (SELECT public.app_sees_all_countries())
    OR lower(btrim(country)) = ANY (
      coalesce((SELECT public.app_country_scope()), '{}'::text[])
    )
  )
  WITH CHECK (
    country IS NULL
    OR (SELECT public.app_is_org_admin())
    OR (SELECT public.app_sees_all_countries())
    OR lower(btrim(country)) = ANY (
      coalesce((SELECT public.app_country_scope()), '{}'::text[])
    )
  );

DROP POLICY IF EXISTS rfid_readers_read ON public.rfid_readers;
CREATE POLICY rfid_readers_read ON public.rfid_readers
  FOR SELECT TO authenticated
  USING ((SELECT public.app_is_active()));

DROP POLICY IF EXISTS rfid_readers_insert ON public.rfid_readers;
CREATE POLICY rfid_readers_insert ON public.rfid_readers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.app_is_elevated()));

DROP POLICY IF EXISTS rfid_readers_update ON public.rfid_readers;
CREATE POLICY rfid_readers_update ON public.rfid_readers
  FOR UPDATE TO authenticated
  USING ((SELECT public.app_is_elevated()))
  WITH CHECK ((SELECT public.app_is_elevated()));

DROP POLICY IF EXISTS rfid_readers_delete ON public.rfid_readers;
CREATE POLICY rfid_readers_delete ON public.rfid_readers
  FOR DELETE TO authenticated
  USING ((SELECT public.app_is_elevated()));

DROP POLICY IF EXISTS rfid_read_events_read ON public.rfid_read_events;
CREATE POLICY rfid_read_events_read ON public.rfid_read_events
  FOR SELECT TO authenticated
  USING ((SELECT public.app_is_active()));

-- Field users may record scans, but can only stamp themselves as the creator.
-- Corrections/deletions remain elevated operations; service-role ingestion
-- bypasses RLS and must provide organisation_id when it has no user JWT.
DROP POLICY IF EXISTS rfid_read_events_insert ON public.rfid_read_events;
CREATE POLICY rfid_read_events_insert ON public.rfid_read_events
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.app_is_active())
    AND created_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS rfid_read_events_update ON public.rfid_read_events;
CREATE POLICY rfid_read_events_update ON public.rfid_read_events
  FOR UPDATE TO authenticated
  USING ((SELECT public.app_is_elevated()))
  WITH CHECK ((SELECT public.app_is_elevated()));

DROP POLICY IF EXISTS rfid_read_events_delete ON public.rfid_read_events;
CREATE POLICY rfid_read_events_delete ON public.rfid_read_events
  FOR DELETE TO authenticated
  USING ((SELECT public.app_is_elevated()));

DROP POLICY IF EXISTS rfid_alerts_read ON public.rfid_alerts;
CREATE POLICY rfid_alerts_read ON public.rfid_alerts
  FOR SELECT TO authenticated
  USING ((SELECT public.app_is_active()));

DROP POLICY IF EXISTS rfid_alerts_insert ON public.rfid_alerts;
CREATE POLICY rfid_alerts_insert ON public.rfid_alerts
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.app_is_elevated()));

DROP POLICY IF EXISTS rfid_alerts_update ON public.rfid_alerts;
CREATE POLICY rfid_alerts_update ON public.rfid_alerts
  FOR UPDATE TO authenticated
  USING ((SELECT public.app_is_elevated()))
  WITH CHECK ((SELECT public.app_is_elevated()));

DROP POLICY IF EXISTS rfid_alerts_delete ON public.rfid_alerts;
CREATE POLICY rfid_alerts_delete ON public.rfid_alerts
  FOR DELETE TO authenticated
  USING ((SELECT public.app_is_elevated()));

REVOKE ALL ON public.rfid_readers FROM PUBLIC, anon;
REVOKE ALL ON public.rfid_read_events FROM PUBLIC, anon;
REVOKE ALL ON public.rfid_alerts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfid_readers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfid_read_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfid_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfid_readers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfid_read_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfid_alerts TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Atomic self-serve workspace creation
--    Restored from MIGRATIONS_V316_WORKSPACE_ONBOARDING.sql. The implementation
--    preserves its one-transaction owner/member/trial behavior and its targeted
--    bypass of the profile privileged-column guard.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_workspace_owner(
  p_org_name text,
  p_kind     text DEFAULT 'company'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_name      text := btrim(coalesce(p_org_name, ''));
  v_kind      text := lower(btrim(coalesce(p_kind, 'company')));
  v_role      text;
  v_super     boolean;
  v_approved  boolean;
  v_locked    boolean;
  v_owns      boolean;
  v_org_id    uuid;
  v_slug_base text;
  v_slug      text;
  v_email     text;
  v_now       timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to create a workspace.' USING errcode = '28000';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'A workspace name is required.' USING errcode = '22023';
  END IF;
  IF length(v_name) > 120 THEN
    v_name := left(v_name, 120);
  END IF;

  IF v_kind NOT IN ('individual', 'company') THEN
    v_kind := 'company';
  END IF;

  SELECT role, coalesce(is_super_admin, false), coalesce(approved, false),
         coalesce(locked, false), email
    INTO v_role, v_super, v_approved, v_locked, v_email
    FROM public.profiles
   WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your profile is not ready yet. Try again in a moment.'
      USING errcode = 'P0002';
  END IF;

  IF v_super THEN
    RAISE EXCEPTION 'Platform administrators cannot self-serve a workspace.'
      USING errcode = '42501';
  END IF;

  IF v_role = 'Admin' AND v_approved AND NOT v_locked THEN
    RAISE EXCEPTION 'You already own a workspace.' USING errcode = '42710';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.organisation_memberships
     WHERE user_id = v_uid
       AND lower(coalesce(role, '')) = 'owner'
  ) INTO v_owns;

  IF v_owns THEN
    RAISE EXCEPTION 'You already own a workspace.' USING errcode = '42710';
  END IF;

  v_slug_base := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_slug_base := btrim(v_slug_base, '-');
  IF v_slug_base = '' THEN
    v_slug_base := 'workspace';
  END IF;
  v_slug_base := left(v_slug_base, 40);

  LOOP
    v_slug := v_slug_base || '-' ||
      substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    BEGIN
      INSERT INTO public.organisations
        (name, slug, settings, plan, active, contact_email, primary_country,
         created_at, updated_at)
      VALUES
        (v_name,
         v_slug,
         jsonb_build_object(
           'kind', v_kind,
           'created_via', 'self_serve_onboarding'
         ),
         'trial',
         true,
         v_email,
         NULL,
         v_now,
         v_now)
      RETURNING id INTO v_org_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  INSERT INTO public.organisation_memberships
    (user_id, organisation_id, role)
  VALUES
    (v_uid, v_org_id, 'owner')
  ON CONFLICT (user_id, organisation_id) DO UPDATE SET role = 'owner';

  -- The existing guard blocks all non-super-admin organisation changes. As in
  -- V316, disable only that trigger around this single self-promotion. DDL and
  -- the data changes are transactional, so an exception restores the trigger.
  ALTER TABLE public.profiles DISABLE TRIGGER trg_guard_profile_privileged;

  UPDATE public.profiles
     SET org_id           = v_org_id,
         organisation_id  = v_org_id,
         role             = 'Admin',
         approved         = true,
         updated_at       = v_now
   WHERE id = v_uid;

  ALTER TABLE public.profiles ENABLE TRIGGER trg_guard_profile_privileged;

  INSERT INTO public.org_subscriptions
    (organisation_id, plan_code, status, billing_interval, seats,
     trial_ends_at, current_period_start, current_period_end)
  VALUES
    (v_org_id, 'trial', 'trialing', 'monthly', 1,
     v_now + interval '14 days', v_now, v_now + interval '14 days')
  ON CONFLICT (organisation_id) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'organisation_id', v_org_id,
    'slug', v_slug,
    'kind', v_kind,
    'plan_code', 'trial',
    'status', 'trialing'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_workspace_owner(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace_owner(text, text)
  TO authenticated;

COMMENT ON FUNCTION public.create_workspace_owner(text, text) IS
  'Atomically creates an organisation, owner membership, promoted owner profile, and trial subscription for the authenticated caller.';

-- ---------------------------------------------------------------------------
-- 3. Inspection-finding vector search
--    Restored from V13/MASTER_MIGRATION, retaining the app signature while
--    adding explicit tenant/country isolation and secure function privileges.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inspection_embeddings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id  uuid NOT NULL
                   REFERENCES public.inspections(id) ON DELETE CASCADE,
  asset_no       text,
  site           text,
  content        text NOT NULL,
  embedding      vector(1536),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspection_embeddings_inspection
  ON public.inspection_embeddings (inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_embeddings_asset
  ON public.inspection_embeddings (asset_no);
CREATE INDEX IF NOT EXISTS idx_inspection_embeddings_site
  ON public.inspection_embeddings (site);
CREATE INDEX IF NOT EXISTS idx_inspection_embeddings_embedding
  ON public.inspection_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE public.inspection_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inspection_embeddings_tenant_read
  ON public.inspection_embeddings;
CREATE POLICY inspection_embeddings_tenant_read
  ON public.inspection_embeddings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.inspections i
      WHERE i.id = inspection_id
        AND i.organisation_id = (SELECT public.app_current_org())
        AND (
          i.country IS NULL
          OR (SELECT public.app_is_org_admin())
          OR (SELECT public.app_sees_all_countries())
          OR lower(btrim(i.country)) = ANY (
            coalesce((SELECT public.app_country_scope()), '{}'::text[])
          )
        )
    )
  );

REVOKE ALL ON public.inspection_embeddings FROM PUBLIC, anon;
GRANT SELECT ON public.inspection_embeddings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspection_embeddings TO service_role;

CREATE OR REPLACE FUNCTION public.match_inspection_findings(
  query_embedding vector(1536),
  match_count     integer DEFAULT 10,
  filter_site     text DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  inspection_id  uuid,
  asset_no       text,
  site           text,
  content        text,
  similarity     double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    ie.id,
    ie.inspection_id,
    ie.asset_no,
    coalesce(ie.site, i.site) AS site,
    ie.content,
    1 - (ie.embedding OPERATOR(public.<=>) query_embedding) AS similarity
  FROM public.inspection_embeddings ie
  JOIN public.inspections i ON i.id = ie.inspection_id
  WHERE ie.embedding IS NOT NULL
    AND i.organisation_id = (SELECT public.app_current_org())
    AND (
      i.country IS NULL
      OR (SELECT public.app_is_org_admin())
      OR (SELECT public.app_sees_all_countries())
      OR lower(btrim(i.country)) = ANY (
        coalesce((SELECT public.app_country_scope()), '{}'::text[])
      )
    )
    AND (
      filter_site IS NULL
      OR ie.site = filter_site
      OR (ie.site IS NULL AND i.site = filter_site)
    )
  ORDER BY ie.embedding OPERATOR(public.<=>) query_embedding
  LIMIT least(greatest(coalesce(match_count, 10), 1), 100);
$function$;

REVOKE ALL ON FUNCTION public.match_inspection_findings(vector, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_inspection_findings(vector, integer, text)
  TO authenticated;

COMMENT ON FUNCTION public.match_inspection_findings(vector, integer, text) IS
  'Returns tenant- and country-scoped semantic matches from inspection_embeddings for authenticated callers.';

-- ---------------------------------------------------------------------------
-- 4. Checklist assignment generator hardening
--    Authenticated calls require an elevated, active profile and are limited to
--    that organisation. No-JWT execution is retained only for postgres-owned
--    pg_cron and the explicitly granted service_role.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_checklist_assignments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  s             record;
  tpl           record;
  target        text;
  v_uid         uuid := auth.uid();
  v_org         uuid;
  v_made        integer := 0;
  v_rows        integer := 0;
  v_today       date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF NOT public.app_is_elevated() THEN
      RAISE EXCEPTION 'Permission denied: elevated role required'
        USING errcode = '42501';
    END IF;

    v_org := public.app_current_org();
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'Permission denied: organisation is required'
        USING errcode = '42501';
    END IF;
  END IF;

  FOR s IN
    SELECT cs.*
      FROM public.checklist_schedules cs
     WHERE cs.active
       AND cs.next_due <= v_today
       AND (v_uid IS NULL OR cs.organisation_id = v_org)
     ORDER BY cs.next_due, cs.id
     FOR UPDATE SKIP LOCKED
  LOOP
    SELECT ct.id, ct.name, ct.country
      INTO tpl
      FROM public.checklist_templates ct
     WHERE ct.id = s.template_id
       AND ct.organisation_id = s.organisation_id;

    IF tpl.id IS NULL THEN
      CONTINUE;
    END IF;

    IF array_length(s.sites, 1) IS NOT NULL THEN
      FOREACH target IN ARRAY s.sites LOOP
        INSERT INTO public.checklist_assignments
          (organisation_id, country, schedule_id, template_id, template_name,
           site, assignee_role, due_date)
        VALUES
          (s.organisation_id, s.country, s.id, s.template_id, tpl.name,
           target, s.assignee_role, s.next_due)
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_made := v_made + v_rows;
      END LOOP;
    ELSIF array_length(s.asset_nos, 1) IS NOT NULL THEN
      FOREACH target IN ARRAY s.asset_nos LOOP
        INSERT INTO public.checklist_assignments
          (organisation_id, country, schedule_id, template_id, template_name,
           asset_no, assignee_role, due_date)
        VALUES
          (s.organisation_id, s.country, s.id, s.template_id, tpl.name,
           target, s.assignee_role, s.next_due)
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_made := v_made + v_rows;
      END LOOP;
    ELSE
      INSERT INTO public.checklist_assignments
        (organisation_id, country, schedule_id, template_id, template_name,
         assignee_role, due_date)
      VALUES
        (s.organisation_id, s.country, s.id, s.template_id, tpl.name,
         s.assignee_role, s.next_due)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_made := v_made + v_rows;
    END IF;

    UPDATE public.checklist_schedules
       SET next_due = CASE s.cadence
                        WHEN 'daily'   THEN s.next_due + 1
                        WHEN 'weekly'  THEN s.next_due + 7
                        WHEN 'monthly' THEN
                          (s.next_due + interval '1 month')::date
                        ELSE s.next_due
                      END,
           active = CASE
                      WHEN s.cadence = 'once' THEN false
                      ELSE active
                    END
     WHERE id = s.id;
  END LOOP;

  UPDATE public.checklist_assignments ca
     SET status = 'overdue'
   WHERE ca.status = 'pending'
     AND ca.due_date < v_today
     AND (v_uid IS NULL OR ca.organisation_id = v_org);

  RETURN v_made;
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_checklist_assignments()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_checklist_assignments()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.generate_checklist_assignments() IS
  'Materialises due checklist assignments. Authenticated callers must be elevated and are org-scoped; postgres/service-role execution supports the daily cron.';

-- ---------------------------------------------------------------------------
-- 5. Console audit target compatibility
--    console_sessions.target_id is uuid, while the public RPC intentionally
--    accepts text because several console actions have natural text targets.
--    Valid UUID text remains in target_id. Other text is preserved in details
--    instead of causing the entire audit write to fail.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_console_event(
  p_action      text,
  p_target_id   text DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_details     jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_target_text text := nullif(btrim(p_target_id), '');
  v_target_uuid uuid;
  v_details     jsonb := coalesce(p_details, '{}'::jsonb);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super admin required'
      USING errcode = '42501';
  END IF;

  IF v_target_text IS NOT NULL THEN
    BEGIN
      v_target_uuid := v_target_text::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_target_uuid := NULL;
      v_details := v_details ||
        jsonb_build_object('target_id_text', v_target_text);
    END;
  END IF;

  INSERT INTO public.console_sessions
    (admin_id, action, target_id, target_type, details)
  VALUES
    (auth.uid(), p_action, v_target_uuid, p_target_type, v_details);
END;
$function$;

REVOKE ALL ON FUNCTION public.log_console_event(text, text, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_console_event(text, text, text, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.log_console_event(text, text, text, jsonb) IS
  'Writes a server-stamped super-admin console audit event. UUID targets populate target_id; non-UUID targets are retained as details.target_id_text.';
