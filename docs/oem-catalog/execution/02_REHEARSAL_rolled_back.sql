-- FILE 02: ROLLED-BACK REHEARSAL (migration sha256 46d2df34de13b7999c334730b4d8a254704223f382e2591e85574310b23b2412).
-- Atomic: explicit begin; first statement; guard aborts before touching anything unless the catalog matches the baseline.
-- It ENDS WITH A DELIBERATE ERROR 'PROBE RESULTS: ...': that error is the success signal and leaves nothing behind.
-- The same assert block as the apply runs before the probes, so the rehearsal fails exactly where the apply would.
-- Then run 02b (it starts with rollback; to clear the aborted transaction).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $guard$
begin
  if (select count(*) from public.oem_parts_manuals) <> 4 or (select count(*) from public.oem_parts_entries) <> 1652 then
    raise exception 'GUARD: expected 4 manuals and 1652 entries, found % and %. Nothing was changed.',
      (select count(*) from public.oem_parts_manuals), (select count(*) from public.oem_parts_entries);
  end if;
  if (select md5(coalesce(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' order by id),'')) from public.oem_parts_entries) <> '4270e1621f940a37d226c538118114e7' then
    raise exception 'GUARD: entries fingerprint differs from the saved baseline. Nothing was changed.';
  end if;
  if to_regproc('public.oem_catalog_admin') is not null or to_regclass('public.oem_figures') is not null then
    raise exception 'GUARD: the migration objects already exist (applied or a previous rehearsal persisted). Nothing was changed.';
  end if;
  if to_regclass('_bak.oem_policies_20261118') is null or (select count(*) from _bak.oem_policies_20261118) <> 22 then
    raise exception 'GUARD: baseline _bak.oem_policies_20261118 (22 rows) is missing. Run file 01 first.';
  end if;
  if to_regclass('_bak.oem_grants_20261118') is null then
    raise exception 'GUARD: baseline _bak.oem_grants_20261118 is missing. Run file 01 first.';
  end if;
end $guard$;

-- OEM catalog, advanced round (figures, review queue, corrections, admin-only import).
-- STATUS: AUTHORED, NOT APPLIED. Needs owner approval. Rollback: 20261118100000_oem_catalog_advanced_ROLLBACK.sql
--
-- Backward compatible by construction:
--   * only ADDS nullable / defaulted columns and NEW tables; no column or row is changed or removed
--   * manual IDs, entry IDs and storage paths are untouched
--   * the only behaviour change is WHO MAY WRITE: import, upload, edit, delete and publish become
--     Admin (or platform super admin) only. Reading stays open to every active member of the
--     same organisation, so a read-only user such as the area manager can browse and select parts.
-- Reconciliation plan: docs/oem-catalog/RECONCILIATION.md (counts and fingerprints before and after).

-- 0. Who is a catalog administrator -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.oem_catalog_admin()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(public.get_my_role() = 'Admin', false) OR coalesce(public.is_super_admin(), false)
$$;
REVOKE ALL ON FUNCTION public.oem_catalog_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oem_catalog_admin() TO authenticated;

-- 1. Additive columns --------------------------------------------------------------------------
ALTER TABLE public.oem_parts_manuals
  ADD COLUMN IF NOT EXISTS revision text,
  ADD COLUMN IF NOT EXISTS document_ref text;

ALTER TABLE public.oem_parts_entries
  ADD COLUMN IF NOT EXISTS figure_id text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS assembly_system text,
  ADD COLUMN IF NOT EXISTS confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'published'
    CHECK (review_status IN ('published','approved','needs_review','rejected')),
  ADD COLUMN IF NOT EXISTS admin_corrected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
-- attributes carries: description_normalized, uom, serial_from/to, supersedes[], superseded_by[],
-- revision, document_ref, callout, validation_status. Added as jsonb so new facts need no migration.

CREATE INDEX IF NOT EXISTS oem_parts_entries_figure_idx ON public.oem_parts_entries (manual_id, figure_id);
CREATE INDEX IF NOT EXISTS oem_parts_entries_review_idx ON public.oem_parts_entries (organisation_id, review_status) WHERE review_status <> 'published';

-- 2. Figures: crop in PDF user space, callouts, match evidence -------------------------------
CREATE TABLE IF NOT EXISTS public.oem_figures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
  manual_id uuid NOT NULL REFERENCES public.oem_parts_manuals(id) ON DELETE CASCADE,
  figure_id text NOT NULL,
  pdf_page integer NOT NULL CHECK (pdf_page > 0),
  printed_page text,
  caption text,
  page_info jsonb NOT NULL DEFAULT '{}'::jsonb,   -- width, height, rotate, landscape
  bbox jsonb,                                      -- drawing extent {x0,y0,x1,y1} in PDF user space
  crop jsonb,                                      -- padded crop, never reaching a neighbour
  callouts jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{index,x,y,status:'estimated'|'verified'}]
  match jsonb NOT NULL DEFAULT '{}'::jsonb,        -- status, score, missing, reason
  match_status text NOT NULL DEFAULT 'estimated' CHECK (match_status IN ('estimated','verified','ambiguous','unavailable')),
  hierarchy jsonb NOT NULL DEFAULT '{}'::jsonb,    -- oem_path + standard category
  admin_adjusted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oem_figures_manual_fig_key UNIQUE (manual_id, figure_id)
);
CREATE INDEX IF NOT EXISTS oem_figures_org_idx ON public.oem_figures (organisation_id, manual_id, pdf_page);

-- 3. Persistent review queue (no cap, paginated by keyset in the client) --------------------
CREATE TABLE IF NOT EXISTS public.oem_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
  manual_id uuid NOT NULL REFERENCES public.oem_parts_manuals(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES public.oem_parts_entries(id) ON DELETE SET NULL,
  figure_id text,
  pdf_page integer,
  part_no text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,      -- the proposed record
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','published')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oem_review_items_unique UNIQUE (manual_id, figure_id, part_no, pdf_page)
);
CREATE INDEX IF NOT EXISTS oem_review_items_queue_idx ON public.oem_review_items (organisation_id, manual_id, status, created_at, id);

-- 4. Append-only correction history -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oem_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
  manual_id uuid REFERENCES public.oem_parts_manuals(id) ON DELETE SET NULL,
  entry_id uuid REFERENCES public.oem_parts_entries(id) ON DELETE SET NULL,
  figure_id text,
  field text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  reason text,
  corrected_by uuid DEFAULT auth.uid(),
  corrected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oem_corrections_entry_idx ON public.oem_corrections (organisation_id, entry_id, corrected_at DESC);

-- 5. Category rules learned from admin corrections, reused on later imports -------------------
CREATE TABLE IF NOT EXISTS public.oem_category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
  heading text NOT NULL,
  heading_key text NOT NULL,
  category text NOT NULL,
  system text CHECK (system IS NULL OR system IN ('chassis','upper','other')),
  scope text NOT NULL DEFAULT 'manufacturer' CHECK (scope IN ('manual','manufacturer','all')),
  manufacturer text NOT NULL DEFAULT '',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oem_category_rules_key UNIQUE (organisation_id, heading_key, scope, manufacturer)
);

-- 6. RLS: org wall for everything, read for active members, write for catalog admins ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['oem_figures','oem_review_items','oem_corrections','oem_category_rules'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_org_isolation', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL USING (organisation_id IS NOT DISTINCT FROM public.app_current_org()) WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org())', t || '_org_isolation', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- figures and category rules are reference data: every active member reads, admins write
DROP POLICY IF EXISTS oem_figures_read ON public.oem_figures;
CREATE POLICY oem_figures_read ON public.oem_figures FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS oem_figures_write ON public.oem_figures;
CREATE POLICY oem_figures_write ON public.oem_figures FOR ALL USING (public.oem_catalog_admin()) WITH CHECK (public.oem_catalog_admin());
DROP POLICY IF EXISTS oem_category_rules_read ON public.oem_category_rules;
CREATE POLICY oem_category_rules_read ON public.oem_category_rules FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS oem_category_rules_write ON public.oem_category_rules;
CREATE POLICY oem_category_rules_write ON public.oem_category_rules FOR ALL USING (public.oem_catalog_admin()) WITH CHECK (public.oem_catalog_admin());

-- the review queue and correction history are admin working data
DROP POLICY IF EXISTS oem_review_items_admin ON public.oem_review_items;
CREATE POLICY oem_review_items_admin ON public.oem_review_items FOR ALL USING (public.oem_catalog_admin()) WITH CHECK (public.oem_catalog_admin());
DROP POLICY IF EXISTS oem_corrections_read ON public.oem_corrections;
CREATE POLICY oem_corrections_read ON public.oem_corrections FOR SELECT USING (public.oem_catalog_admin());
DROP POLICY IF EXISTS oem_corrections_insert ON public.oem_corrections;
CREATE POLICY oem_corrections_insert ON public.oem_corrections FOR INSERT WITH CHECK (public.oem_catalog_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.oem_figures, public.oem_review_items, public.oem_category_rules TO authenticated;
GRANT SELECT, INSERT ON public.oem_corrections TO authenticated; -- append only: no UPDATE or DELETE grant

-- 7. Tighten write access on the existing tables: Admin only (was Admin, Manager, Director) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['oem_parts_manuals','oem_parts_entries'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.oem_catalog_admin())', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (public.oem_catalog_admin()) WITH CHECK (public.oem_catalog_admin())', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (public.oem_catalog_admin())', t || '_delete', t);
  END LOOP;
END $$;

-- storage: the private PDF bucket. Read stays org-scoped; upload, replace and delete are admin only.
DROP POLICY IF EXISTS oem_parts_pdf_insert ON storage.objects;
CREATE POLICY oem_parts_pdf_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'oem-parts-catalogs' AND public.oem_catalog_admin() AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1) AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()));
DROP POLICY IF EXISTS oem_parts_pdf_delete ON storage.objects;
CREATE POLICY oem_parts_pdf_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'oem-parts-catalogs' AND public.oem_catalog_admin() AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1) AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()));
DROP POLICY IF EXISTS oem_parts_pdf_update ON storage.objects;
CREATE POLICY oem_parts_pdf_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'oem-parts-catalogs' AND public.oem_catalog_admin() AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1) AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()))
  WITH CHECK (bucket_id = 'oem-parts-catalogs' AND public.oem_catalog_admin() AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1) AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()));

-- 8. Nothing corrected by an admin is ever deleted or silently overwritten --------------------
CREATE OR REPLACE FUNCTION public.oem_protect_corrected()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.admin_corrected THEN
    RAISE EXCEPTION 'OEM catalog entry % was corrected by an administrator and cannot be deleted', OLD.id USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.admin_corrected AND coalesce(current_setting('oem.allow_corrected_edit', true), '') <> 'on' THEN
    RAISE EXCEPTION 'OEM catalog entry % was corrected by an administrator; use oem_apply_correction' , OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS oem_protect_corrected_trg ON public.oem_parts_entries;
CREATE TRIGGER oem_protect_corrected_trg BEFORE UPDATE OR DELETE ON public.oem_parts_entries
  FOR EACH ROW EXECUTE FUNCTION public.oem_protect_corrected();

-- The one sanctioned way to change an entry: records the old and new value, flags it corrected.
CREATE OR REPLACE FUNCTION public.oem_apply_correction(p_entry uuid, p_field text, p_value text, p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_v text; corr uuid; org uuid;
BEGIN
  IF NOT public.oem_catalog_admin() THEN RAISE EXCEPTION 'Only a catalog administrator can correct OEM records' USING ERRCODE = '42501'; END IF;
  IF p_field NOT IN ('part_no','description','quantity','remark','category','assembly_heading','index_no') THEN
    RAISE EXCEPTION 'Field % cannot be corrected here', p_field USING ERRCODE = '22023';
  END IF;
  SELECT organisation_id INTO org FROM public.oem_parts_entries WHERE id = p_entry;
  IF org IS NULL OR org IS DISTINCT FROM public.app_current_org() THEN RAISE EXCEPTION 'Entry not found' USING ERRCODE = '42501'; END IF;
  EXECUTE format('SELECT %I::text FROM public.oem_parts_entries WHERE id = $1', p_field) INTO old_v USING p_entry;
  PERFORM set_config('oem.allow_corrected_edit', 'on', true);
  IF p_field = 'quantity' THEN
    UPDATE public.oem_parts_entries SET quantity = nullif(p_value, '')::numeric, admin_corrected = true, review_status = 'approved' WHERE id = p_entry;
  ELSE
    EXECUTE format('UPDATE public.oem_parts_entries SET %I = $1, admin_corrected = true, review_status = ''approved'' WHERE id = $2', p_field) USING p_value, p_entry;
  END IF;
  PERFORM set_config('oem.allow_corrected_edit', 'off', true);
  INSERT INTO public.oem_corrections (organisation_id, entry_id, field, old_value, new_value, reason)
    VALUES (org, p_entry, p_field, to_jsonb(old_v), to_jsonb(p_value), p_reason) RETURNING id INTO corr;
  RETURN corr;
END $$;
REVOKE ALL ON FUNCTION public.oem_apply_correction(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oem_apply_correction(uuid, text, text, text) TO authenticated;

-- 9. Manual figure tools: re-assign parts to another figure, merge two figures, split one -----
-- Every change is admin only, org scoped, written to oem_corrections, and flags the touched rows /
-- figure as admin edited so a later reprocess never overwrites it. Nothing is deleted except the
-- emptied figure row of a merge (its parts move to the target; the PDF and entries are untouched).
CREATE OR REPLACE FUNCTION public.oem_reassign_entries(p_manual uuid, p_entry_ids uuid[], p_to_figure text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; n integer := 0; r record;
BEGIN
  IF NOT public.oem_catalog_admin() THEN RAISE EXCEPTION 'Only a catalog administrator can edit the catalog' USING ERRCODE = '42501'; END IF;
  SELECT organisation_id INTO org FROM public.oem_parts_manuals WHERE id = p_manual;
  IF org IS NULL OR org IS DISTINCT FROM public.app_current_org() THEN RAISE EXCEPTION 'Manual not found' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.oem_figures WHERE manual_id = p_manual AND figure_id = p_to_figure) THEN
    RAISE EXCEPTION 'Target figure % does not exist in this manual', p_to_figure USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('oem.allow_corrected_edit', 'on', true);
  FOR r IN SELECT id, figure_id FROM public.oem_parts_entries WHERE manual_id = p_manual AND id = ANY (p_entry_ids) LOOP
    UPDATE public.oem_parts_entries SET figure_id = p_to_figure, admin_corrected = true, review_status = 'approved' WHERE id = r.id;
    INSERT INTO public.oem_corrections (organisation_id, manual_id, entry_id, figure_id, field, old_value, new_value, reason)
      VALUES (org, p_manual, r.id, p_to_figure, 'figure_id', to_jsonb(r.figure_id), to_jsonb(p_to_figure), 'reassigned to another figure');
    n := n + 1;
  END LOOP;
  PERFORM set_config('oem.allow_corrected_edit', 'off', true);
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.oem_figure_merge(p_manual uuid, p_from text, p_into text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; a public.oem_figures; b public.oem_figures; n integer; c jsonb;
BEGIN
  IF NOT public.oem_catalog_admin() THEN RAISE EXCEPTION 'Only a catalog administrator can edit the catalog' USING ERRCODE = '42501'; END IF;
  IF p_from = p_into THEN RAISE EXCEPTION 'Choose two different figures' USING ERRCODE = '22023'; END IF;
  SELECT organisation_id INTO org FROM public.oem_parts_manuals WHERE id = p_manual;
  IF org IS NULL OR org IS DISTINCT FROM public.app_current_org() THEN RAISE EXCEPTION 'Manual not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.oem_figures WHERE manual_id = p_manual AND figure_id = p_from;
  SELECT * INTO b FROM public.oem_figures WHERE manual_id = p_manual AND figure_id = p_into;
  IF a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'Figure not found' USING ERRCODE = '22023'; END IF;
  IF a.pdf_page IS DISTINCT FROM b.pdf_page THEN RAISE EXCEPTION 'Figures on different PDF pages are different drawings and cannot be merged' USING ERRCODE = '22023'; END IF;
  IF a.crop IS NOT NULL AND b.crop IS NOT NULL THEN
    c := jsonb_build_object('x0', least((a.crop->>'x0')::numeric, (b.crop->>'x0')::numeric), 'y0', least((a.crop->>'y0')::numeric, (b.crop->>'y0')::numeric),
                            'x1', greatest((a.crop->>'x1')::numeric, (b.crop->>'x1')::numeric), 'y1', greatest((a.crop->>'y1')::numeric, (b.crop->>'y1')::numeric));
  ELSE c := coalesce(b.crop, a.crop); END IF;
  PERFORM set_config('oem.allow_corrected_edit', 'on', true);
  UPDATE public.oem_parts_entries SET figure_id = p_into, admin_corrected = true, review_status = 'approved' WHERE manual_id = p_manual AND figure_id = p_from;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('oem.allow_corrected_edit', 'off', true);
  UPDATE public.oem_figures SET crop = c, callouts = b.callouts || a.callouts, admin_adjusted = true, updated_at = now() WHERE id = b.id;
  DELETE FROM public.oem_figures WHERE id = a.id;
  INSERT INTO public.oem_corrections (organisation_id, manual_id, figure_id, field, old_value, new_value, reason)
    VALUES (org, p_manual, p_into, 'figure_merge', to_jsonb(p_from), to_jsonb(p_into), n || ' parts moved');
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.oem_figure_split(p_manual uuid, p_figure text, p_new_figure text, p_crop jsonb, p_entry_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; a public.oem_figures; n integer := 0;
BEGIN
  IF NOT public.oem_catalog_admin() THEN RAISE EXCEPTION 'Only a catalog administrator can edit the catalog' USING ERRCODE = '42501'; END IF;
  IF coalesce(btrim(p_new_figure), '') = '' OR p_new_figure = p_figure THEN RAISE EXCEPTION 'Give the new figure a different name' USING ERRCODE = '22023'; END IF;
  SELECT organisation_id INTO org FROM public.oem_parts_manuals WHERE id = p_manual;
  IF org IS NULL OR org IS DISTINCT FROM public.app_current_org() THEN RAISE EXCEPTION 'Manual not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.oem_figures WHERE manual_id = p_manual AND figure_id = p_figure;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Figure not found' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.oem_figures WHERE manual_id = p_manual AND figure_id = p_new_figure) THEN RAISE EXCEPTION 'That figure name is already used' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.oem_figures (organisation_id, manual_id, figure_id, pdf_page, printed_page, caption, page_info, bbox, crop, callouts, match, match_status, hierarchy, admin_adjusted)
    VALUES (org, p_manual, p_new_figure, a.pdf_page, a.printed_page, a.caption, a.page_info, a.bbox, p_crop, '[]'::jsonb, a.match, 'estimated', a.hierarchy, true);
  PERFORM set_config('oem.allow_corrected_edit', 'on', true);
  UPDATE public.oem_parts_entries SET figure_id = p_new_figure, admin_corrected = true, review_status = 'approved' WHERE manual_id = p_manual AND figure_id = p_figure AND id = ANY (p_entry_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('oem.allow_corrected_edit', 'off', true);
  INSERT INTO public.oem_corrections (organisation_id, manual_id, figure_id, field, old_value, new_value, reason)
    VALUES (org, p_manual, p_figure, 'figure_split', to_jsonb(p_figure), to_jsonb(p_new_figure), n || ' parts moved');
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.oem_reassign_entries(uuid, uuid[], text), public.oem_figure_merge(uuid, text, text), public.oem_figure_split(uuid, text, text, jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.oem_reassign_entries(uuid, uuid[], text), public.oem_figure_merge(uuid, text, text), public.oem_figure_split(uuid, text, text, jsonb, uuid[]) TO authenticated;

-- 10. Read-only integration bot policies for the new tables (repo rule: a migration that creates a table ends with this)
DO $$ BEGIN
  IF to_regprocedure('anum_integration.apply_reader_policies()') IS NOT NULL THEN PERFORM anum_integration.apply_reader_policies(); END IF;
END $$;


do $assert$
declare diff int; bad int;
begin
  if (select count(*) from public.oem_parts_manuals) <> 4 or (select count(*) from public.oem_parts_entries) <> 1652 then raise exception 'ASSERT: row counts changed'; end if;
  if (select md5(coalesce(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' order by id),'')) from public.oem_parts_entries) <> '4270e1621f940a37d226c538118114e7' then raise exception 'ASSERT: entries fingerprint changed'; end if;
  if (select count(*) from storage.objects where bucket_id = 'oem-parts-catalogs') <> 2 then raise exception 'ASSERT: storage object count changed'; end if;
  if (select count(*) from public.oem_parts_entries where review_status <> 'published' or admin_corrected) <> 0 then raise exception 'ASSERT: existing entries not all published/uncorrected'; end if;
  if to_regclass('public.oem_figures') is null or to_regclass('public.oem_review_items') is null or to_regclass('public.oem_corrections') is null or to_regclass('public.oem_category_rules') is null then raise exception 'ASSERT: new tables missing'; end if;
  if (select count(*) from pg_proc where proname in ('oem_catalog_admin','oem_apply_correction','oem_reassign_entries','oem_figure_merge','oem_figure_split','oem_protect_corrected') and pronamespace = 'public'::regnamespace) <> 6 then raise exception 'ASSERT: expected 6 functions'; end if;
  if has_function_privilege('anon', 'public.oem_figure_merge(uuid,text,text)', 'execute') then raise exception 'ASSERT: anon can execute the figure tools'; end if;
  select count(*) into bad from pg_policies where schemaname = 'public' and tablename in ('oem_parts_manuals','oem_parts_entries') and cmd in ('INSERT','UPDATE','DELETE')
    and policyname in ('oem_parts_manuals_insert','oem_parts_manuals_update','oem_parts_manuals_delete','oem_parts_entries_insert','oem_parts_entries_update','oem_parts_entries_delete')
    and coalesce(qual,'') || coalesce(with_check,'') not like '%oem_catalog_admin%';
  if bad <> 0 then raise exception 'ASSERT: % write policies do not use oem_catalog_admin()', bad; end if;
  -- read policies (SELECT) of the two tables must be byte-identical to the baseline
  select count(*) into diff from _bak.oem_policies_20261118 b where b.cmd = 'SELECT' and b.schemaname = 'public' and not exists (
    select 1 from pg_policies p where p.schemaname = b.schemaname and p.tablename = b.tablename and p.policyname = b.policyname and p.permissive = b.permissive
      and p.cmd = b.cmd and p.roles::text = b.roles::text and p.qual is not distinct from b.qual and p.with_check is not distinct from b.with_check);
  if diff <> 0 then raise exception 'ASSERT: % read policies differ from the baseline', diff; end if;
  select count(*) into diff from _bak.oem_policies_20261118 b where b.policyname like 'anum_reader%' and not exists (
    select 1 from pg_policies p where p.schemaname = b.schemaname and p.tablename = b.tablename and p.policyname = b.policyname and p.qual is not distinct from b.qual and p.with_check is not distinct from b.with_check);
  if diff <> 0 then raise exception 'ASSERT: % integration reader policies changed', diff; end if;
  select count(*) into diff from _bak.oem_grants_20261118 b where not exists (select 1 from information_schema.table_privileges g where g.table_schema = 'public' and g.table_name = b.table_name and g.grantee = b.grantee and g.privilege_type = b.privilege_type);
  if diff <> 0 then raise exception 'ASSERT: % baseline grants missing', diff; end if;
end $assert$;


-- ---- Synthetic probe data, created by the owner role inside this transaction (rolled back with everything else).
-- Real catalog rows are only ever COUNTED below, never updated or deleted.
do $synth$
declare org uuid; man uuid := '00000000-0000-0000-0000-0000000f0001'; ent uuid := '00000000-0000-0000-0000-0000000f0002'; ent2 uuid := '00000000-0000-0000-0000-0000000f0003';
begin
  select organisation_id into org from public.oem_parts_manuals order by created_at limit 1;
  insert into public.oem_parts_manuals (id, organisation_id, manufacturer, model, source_file_name, source_sha256)
    values (man, org, 'PROBE', 'PROBE', 'probe.pdf', 'probe-sha-rehearsal-only');
  insert into public.oem_parts_entries (id, organisation_id, manual_id, source_pdf_page, row_order, part_no, description, figure_id)
    values (ent, org, man, 9999, 1, 'PROBE-0001', 'probe one', 'PROBE-A'), (ent2, org, man, 9999, 2, 'PROBE-0002', 'probe two', 'PROBE-A');
  insert into public.oem_figures (organisation_id, manual_id, figure_id, pdf_page, crop)
    values (org, man, 'PROBE-A', 9999, '{"x0":0,"y0":0,"x1":10,"y1":10}'), (org, man, 'PROBE-B', 9999, '{"x0":10,"y0":0,"x1":20,"y1":10}');
end $synth$;

do $probe$
declare
  log text := '';
  u record; n int; m int; e int; rc int;
  man uuid := '00000000-0000-0000-0000-0000000f0001'; ent uuid := '00000000-0000-0000-0000-0000000f0002'; ent2 uuid := '00000000-0000-0000-0000-0000000f0003';
begin
  for u in select * from (values
    ('manager','34793423-43df-4b6f-9270-9d1e8be6fa30'),
    ('tyreman','1cd74900-64fe-4f3a-913c-b9060f088ff3'),
    ('vinay','06161659-c666-48ac-82f3-5887b1082dc2'),
    ('admin','58787cc7-818b-4fd5-8b7b-c93e4e01f641')) as v(label,id) loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role','authenticated','aal','aal2')::text, true);
    execute 'set local role authenticated';
    select count(*) into m from public.oem_parts_manuals where id <> man;
    select count(*) into e from public.oem_parts_entries where manual_id <> man;
    log := log || format(E'\n%s realManuals=%s realEntries=%s', u.label, m, e);
    begin select count(*) into n from public.oem_review_items; log := log || format(' review=%s', n); exception when others then log := log || ' review=ERR'; end;
    begin insert into public.oem_parts_manuals (manufacturer, model, source_file_name, source_sha256) values ('PROBE','PROBE','p2.pdf','probe-sha-2-'||u.label); log := log || ' insertManual=ALLOWED'; exception when others then log := log || ' insertManual=blocked'; end;
    begin update public.oem_parts_entries set description = 'probe changed' where id = ent; get diagnostics rc = row_count; log := log || ' updateSynthetic='||rc; exception when others then log := log || ' updateSynthetic=ERR'; end;
    begin perform public.oem_apply_correction(ent, 'remark', 'probe', 'rehearsal'); log := log || ' correction=ALLOWED'; exception when others then log := log || ' correction=blocked'; end;
    begin delete from public.oem_parts_entries where id = ent2; get diagnostics rc = row_count; log := log || ' deleteSynthetic='||rc; exception when others then log := log || ' deleteSynthetic=ERR'; end;
    begin delete from public.oem_parts_entries where id = ent; get diagnostics rc = row_count; log := log || ' deleteCorrectedSynthetic='||rc; exception when others then log := log || ' deleteCorrectedSynthetic=blocked'; end;
    begin perform public.oem_reassign_entries(man, array[ent], 'PROBE-B'); log := log || ' reassign=ALLOWED'; exception when others then log := log || ' reassign=blocked'; end;
    begin perform public.oem_figure_merge(man, 'PROBE-B', 'PROBE-A'); log := log || ' merge=ALLOWED'; exception when others then log := log || ' merge=blocked'; end;
    begin perform public.oem_figure_split(man, 'PROBE-A', 'PROBE-C', '{"x0":0,"y0":0,"x1":5,"y1":5}'::jsonb, array[ent]); log := log || ' split=ALLOWED'; exception when others then log := log || ' split=blocked'; end;
    begin insert into storage.objects (bucket_id, name) values ('oem-parts-catalogs', man::text || '/probe.pdf'); log := log || ' storageInsert=ALLOWED'; exception when others then log := log || ' storageInsert=blocked'; end;
    begin select count(*) into n from public.parts_requests; log := log || ' partsRequestsVisible=' || n; exception when others then log := log || ' partsRequests=ERR'; end;
    begin select count(*) into n from public.oem_figures where manual_id = man; log := log || ' syntheticFiguresVisible=' || n; exception when others then log := log || ' figures=ERR'; end;
    execute 'reset role';
  end loop;
  raise exception 'PROBE RESULTS:%', log;
end $probe$;
