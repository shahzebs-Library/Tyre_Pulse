-- V77: close the Import Center country-scope gap on the READ path (Phase 2).
--
-- V76 blocked cross-country commits; this blocks cross-country READS too. Adds a
-- RESTRICTIVE SELECT country gate on the data-bearing import_* tables
-- (import_batches, import_files, import_rows), ANDing on top of the existing
-- org isolation. Same predicate as the commit gate
-- (import_user_can_commit_country): allow when the batch has no country, the
-- caller is an org/super admin, the caller is unassigned (country IS NULL =
-- all-country; preserves today's sole admin), or the batch country is in the
-- caller's profiles.country[] (or they hold 'All').
--
-- Verified in a rolled-back probe: a same-org UAE user sees 0 KSA batches/rows;
-- today's NULL-country admin still sees all (3 batches / 18 rows).

-- batch -> country lookup, SECURITY DEFINER so the import_rows policy reads the
-- parent country without RLS recursion (import_rows has no country column).
CREATE OR REPLACE FUNCTION public.import_batch_country(p_batch_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT country FROM public.import_batches WHERE id = p_batch_id
$$;
REVOKE ALL ON FUNCTION public.import_batch_country(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_batch_country(uuid) TO authenticated, service_role;

CREATE POLICY import_batches_country_isolation ON public.import_batches
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ( public.import_user_can_commit_country(country) );

CREATE POLICY import_files_country_isolation ON public.import_files
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ( public.import_user_can_commit_country(country) );

CREATE POLICY import_rows_country_isolation ON public.import_rows
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ( public.import_user_can_commit_country(public.import_batch_country(batch_id)) );
