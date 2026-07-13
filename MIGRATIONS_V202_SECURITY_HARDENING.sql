-- ============================================================================
-- MIGRATIONS_V202 — Security hardening (audit remediation)
-- ============================================================================
-- Closes cross-tenant leaks and privilege gaps found in the pre-launch audit.
-- Every change is additive/idempotent and validated against the live schema:
--   • Storage objects: org-scoped by UPLOADER (owner) — non-breaking because
--     100% of live objects have owner set and paths are not org-prefixed.
--   • RAG: match_knowledge_documents now filters by org (defaulted param so the
--     user-JWT client path needs no change; service-role callers pass filter_org).
--   • Audit / ai-usage / email RPC: org isolation + role gating.
--   • Privileged write tables: role-gated (were auth-only).
--   • profiles privileged-column guard trigger: committed to source (was live-only).
-- Tables inspection_embeddings / tyre_record_embeddings / tyre_records_archive
-- from the audit DO NOT EXIST in this database — intentionally not addressed.
-- Depends on: app_current_org(), get_my_role(), app_is_active(), set_updated_at().
-- ============================================================================

-- ── C1. Storage objects: org isolation by uploader ──────────────────────────
CREATE OR REPLACE FUNCTION public.storage_object_in_my_org(p_owner uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public.app_current_org() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = p_owner AND p.organisation_id = public.app_current_org()
     );
$$;
REVOKE ALL ON FUNCTION public.storage_object_in_my_org(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.storage_object_in_my_org(uuid) TO authenticated;

DROP POLICY IF EXISTS tyre_photos_read ON storage.objects;
CREATE POLICY tyre_photos_read ON storage.objects FOR SELECT
  USING (bucket_id = 'tyre-photos' AND public.app_is_active() AND public.storage_object_in_my_org(owner));

DROP POLICY IF EXISTS inspection_photos_read ON storage.objects;
CREATE POLICY inspection_photos_read ON storage.objects FOR SELECT
  USING (bucket_id = 'inspection-photos' AND public.app_is_active() AND public.storage_object_in_my_org(owner));

DROP POLICY IF EXISTS accident_photos_auth_read ON storage.objects;
CREATE POLICY accident_photos_auth_read ON storage.objects FOR SELECT
  USING (bucket_id = 'accident-photos' AND public.app_is_active() AND public.storage_object_in_my_org(owner));

DROP POLICY IF EXISTS import_files_auth_read ON storage.objects;
CREATE POLICY import_files_auth_read ON storage.objects FOR SELECT
  USING (bucket_id = 'import-files' AND public.app_is_active() AND public.storage_object_in_my_org(owner));

DROP POLICY IF EXISTS vehicle_photos_read ON storage.objects;
CREATE POLICY vehicle_photos_read ON storage.objects FOR SELECT
  USING (bucket_id = 'vehicle-photos' AND public.app_is_active() AND public.storage_object_in_my_org(owner));

-- M4. vehicle-photos: enforce size + mime like the other photo buckets
UPDATE storage.buckets
   SET file_size_limit = 20971520,
       allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic']
 WHERE id = 'vehicle-photos';

-- ── C2. RAG retrieval: org-scoped ───────────────────────────────────────────
-- Adds a defaulted filter_org. User-JWT callers (client) omit it → app_current_org().
-- Service-role callers (edge orchestrator) MUST pass filter_org. Null org → no rows.
DROP FUNCTION IF EXISTS public.match_knowledge_documents(vector, integer, text, text);
CREATE OR REPLACE FUNCTION public.match_knowledge_documents(
  query_embedding vector, match_count integer DEFAULT 5,
  filter_doc_type text DEFAULT NULL, filter_site text DEFAULT NULL,
  filter_org uuid DEFAULT NULL)
RETURNS TABLE(id uuid, title text, content text, doc_type text, site text, similarity double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT kd.id, kd.title, kd.content, kd.doc_type, kd.site,
         1 - (kd.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_documents kd
  WHERE kd.embedding IS NOT NULL
    AND kd.organisation_id = COALESCE(filter_org, public.app_current_org())
    AND (filter_doc_type IS NULL OR kd.doc_type = filter_doc_type)
    AND (filter_site     IS NULL OR kd.site     = filter_site)
  ORDER BY kd.embedding <=> query_embedding
  LIMIT greatest(match_count, 1);
$$;
REVOKE ALL ON FUNCTION public.match_knowledge_documents(vector, integer, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_documents(vector, integer, text, text, uuid) TO authenticated, service_role;

-- ── C5. Email lookup RPC: same-org only ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_email_by_id(user_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = auth, public AS $$
  SELECT u.email
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE u.id = user_id
    AND p.organisation_id = public.app_current_org()
  LIMIT 1;
$$;

-- ── C4. Audit trails: org isolation ─────────────────────────────────────────
-- audit_log_v2 already has org_id — add RESTRICTIVE isolation + backfill + tighten insert.
UPDATE public.audit_log_v2 a SET org_id = p.organisation_id
  FROM public.profiles p WHERE a.org_id IS NULL AND p.id = a.user_id;
DROP POLICY IF EXISTS audit_log_v2_org_isolation ON public.audit_log_v2;
CREATE POLICY audit_log_v2_org_isolation ON public.audit_log_v2
  AS RESTRICTIVE FOR ALL
  USING (org_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (org_id IS NOT DISTINCT FROM public.app_current_org());
DROP POLICY IF EXISTS audit_v2_insert ON public.audit_log_v2;
CREATE POLICY audit_v2_insert ON public.audit_log_v2 FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- audit_log: add org column + backfill + RESTRICTIVE + elevated read
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS organisation_id uuid;
UPDATE public.audit_log a SET organisation_id = p.organisation_id
  FROM public.profiles p WHERE a.organisation_id IS NULL AND p.id = COALESCE(a.user_id, a.changed_by);
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON public.audit_log (organisation_id);
DROP POLICY IF EXISTS audit_log_org_isolation ON public.audit_log;
CREATE POLICY audit_log_org_isolation ON public.audit_log
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());
DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
DROP POLICY IF EXISTS "Auth users full access" ON public.audit_log;
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT
  USING (public.get_my_role() = ANY (ARRAY['Admin','Manager','Director']));

-- inspection_audit_log: add org column + backfill from parent inspection + RESTRICTIVE
ALTER TABLE public.inspection_audit_log ADD COLUMN IF NOT EXISTS organisation_id uuid;
UPDATE public.inspection_audit_log l SET organisation_id = i.organisation_id
  FROM public.inspections i WHERE l.organisation_id IS NULL AND i.id = l.inspection_id;
CREATE INDEX IF NOT EXISTS idx_inspection_audit_log_org ON public.inspection_audit_log (organisation_id);
DROP POLICY IF EXISTS inspection_audit_log_org_isolation ON public.inspection_audit_log;
CREATE POLICY inspection_audit_log_org_isolation ON public.inspection_audit_log
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());
DROP POLICY IF EXISTS insp_audit_select ON public.inspection_audit_log;
CREATE POLICY insp_audit_select ON public.inspection_audit_log FOR SELECT
  USING (public.get_my_role() = ANY (ARRAY['Admin','Manager','Director']));

-- ── M8. ai_token_logs: org isolation ────────────────────────────────────────
ALTER TABLE public.ai_token_logs ADD COLUMN IF NOT EXISTS organisation_id uuid;
UPDATE public.ai_token_logs a SET organisation_id = p.organisation_id
  FROM public.profiles p WHERE a.organisation_id IS NULL AND p.id = a.user_id;
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_org ON public.ai_token_logs (organisation_id);
DROP POLICY IF EXISTS atl_org_isolation ON public.ai_token_logs;
CREATE POLICY atl_org_isolation ON public.ai_token_logs
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());
DROP POLICY IF EXISTS atl_insert ON public.ai_token_logs;
CREATE POLICY atl_insert ON public.ai_token_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- ── M7. organisation_memberships: scope the elevated read branch ────────────
DROP POLICY IF EXISTS org_memberships_read ON public.organisation_memberships;
CREATE POLICY org_memberships_read ON public.organisation_memberships FOR SELECT
  USING (user_id = auth.uid()
         OR (public.app_is_elevated() AND organisation_id = public.app_current_org()));

-- ── M6. app_settings: reads for elevated/integration roles only ─────────────
DROP POLICY IF EXISTS app_settings_select ON public.app_settings;
CREATE POLICY app_settings_select ON public.app_settings FOR SELECT
  USING (public.get_my_role() = ANY (ARRAY['Admin','Manager','Director','Integration Admin','Automation']));

-- ── H2. profiles privileged-column guard: commit live trigger to source ─────
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_cols()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_my_role() IS DISTINCT FROM 'Admin' THEN
    IF NEW.role           IS DISTINCT FROM OLD.role
       OR NEW.approved    IS DISTINCT FROM OLD.approved
       OR NEW.locked      IS DISTINCT FROM OLD.locked
       OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
       OR NEW.country     IS DISTINCT FROM OLD.country
       OR NEW.site        IS DISTINCT FROM OLD.site THEN
      RAISE EXCEPTION 'Not authorized to change role, approval, lock, country, or site.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_profile_privileged ON public.profiles;
CREATE TRIGGER trg_guard_profile_privileged BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_cols();

-- ── H1. Role-gate writes on privileged / revenue / customer tables ──────────
-- Field-operational telemetry stays auth-only by design; only sensitive tables here.
DO $$
DECLARE
  t text;
  dev  text[] := ARRAY['developer_api_keys','webhook_endpoints'];
  biz  text[] := ARRAY['taas_subscriptions','customer_accounts','marketplace_listings',
                       'marketplace_rfqs','insurance_claims','retread_claims'];
BEGIN
  FOREACH t IN ARRAY dev LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_delete', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.get_my_role() = ANY(ARRAY['Admin','Manager','Director','Integration Admin']))$f$, t||'_insert', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR UPDATE USING (public.get_my_role() = ANY(ARRAY['Admin','Manager','Director','Integration Admin'])) WITH CHECK (public.get_my_role() = ANY(ARRAY['Admin','Manager','Director','Integration Admin']))$f$, t||'_update', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR DELETE USING (public.get_my_role() = ANY(ARRAY['Admin','Manager','Director','Integration Admin']))$f$, t||'_delete', t);
  END LOOP;
  FOREACH t IN ARRAY biz LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_delete', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.get_my_role() = ANY(ARRAY['Admin','Manager','Director']))$f$, t||'_insert', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR UPDATE USING (public.get_my_role() = ANY(ARRAY['Admin','Manager','Director'])) WITH CHECK (public.get_my_role() = ANY(ARRAY['Admin','Manager','Director']))$f$, t||'_update', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR DELETE USING (public.get_my_role() = ANY(ARRAY['Admin','Manager','Director']))$f$, t||'_delete', t);
  END LOOP;
END $$;

-- Note: the two marketplace policies use the historical prefix mkt_listings_/mkt_rfqs_.
DROP POLICY IF EXISTS mkt_listings_insert ON public.marketplace_listings;
DROP POLICY IF EXISTS mkt_listings_update ON public.marketplace_listings;
DROP POLICY IF EXISTS mkt_listings_delete ON public.marketplace_listings;
DROP POLICY IF EXISTS mkt_rfqs_insert ON public.marketplace_rfqs;
DROP POLICY IF EXISTS mkt_rfqs_update ON public.marketplace_rfqs;
DROP POLICY IF EXISTS mkt_rfqs_delete ON public.marketplace_rfqs;
