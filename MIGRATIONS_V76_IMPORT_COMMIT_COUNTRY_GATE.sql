-- V76: close the Import Center country-scope gap on the commit path.
--
-- import_commit_batch enforced org isolation + approval but NOT country, so a
-- same-org user assigned to Country A could commit a Country B batch to live
-- tables (IMPORT_CENTER_SECURITY_PLAN.md §3, the #1 open item). This adds a
-- server-side country gate ("enforce in the RPC first, then tighten read
-- policies").
--
-- Rule (import_user_can_commit_country): allow when the batch has no country, OR
-- the caller is an org/super admin, OR the caller's profile is unassigned
-- (country IS NULL = all-country; preserves today's sole admin), OR the batch's
-- country is in the caller's profiles.country[] (or they hold 'All').
-- Verified in a rolled-back probe: KSA-user->KSA allowed, KSA-user->UAE denied,
-- NULL-user->any allowed. anon EXECUTE revoked.

CREATE OR REPLACE FUNCTION public.import_user_can_commit_country(p_country text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    p_country IS NULL
    OR public.app_is_org_admin()
    OR EXISTS (
         SELECT 1 FROM public.profiles pr
         WHERE pr.id = auth.uid()
           AND ( pr.country IS NULL OR p_country = ANY(pr.country) OR 'All' = ANY(pr.country) )
       );
$$;
REVOKE ALL ON FUNCTION public.import_user_can_commit_country(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_user_can_commit_country(text) TO authenticated, service_role;

-- Patch import_commit_batch: insert the country gate right after the cross-org
-- check. Done programmatically off the live source so the 200-line body is never
-- retyped; raises if the anchor is missing (fail-closed).
DO $do$
DECLARE src text; newsrc text;
BEGIN
  SELECT pg_get_functiondef('public.import_commit_batch(uuid)'::regprocedure) INTO src;
  newsrc := replace(
    src,
    E'  IF b.organisation_id IS NOT NULL AND b.organisation_id IS DISTINCT FROM v_org THEN\n    RAISE EXCEPTION ''Cross-organisation commit denied.'' USING errcode = ''42501'';\n  END IF;',
    E'  IF b.organisation_id IS NOT NULL AND b.organisation_id IS DISTINCT FROM v_org THEN\n    RAISE EXCEPTION ''Cross-organisation commit denied.'' USING errcode = ''42501'';\n  END IF;\n  IF NOT public.import_user_can_commit_country(b.country) THEN\n    RAISE EXCEPTION ''Cross-country commit denied: you are not assigned to country %.'', b.country USING errcode = ''42501'';\n  END IF;'
  );
  IF newsrc = src THEN
    RAISE EXCEPTION 'V76 patch anchor not found in import_commit_batch — aborting (fail-closed).';
  END IF;
  EXECUTE newsrc;
END $do$;
