-- Report Sharing, owner review required: org-safe branding and site-scope parity.
-- Status: prepared in PR #609 ONLY; not applied to production.
-- Source: live get_report_snapshot function reviewed on 2026-11-24.
-- This mutation aborts unless every expected anchor appears once. It retains
-- existing token/password, RLS, aggregation and cost behavior unchanged.
-- Caveat: this fixes filter consistency but DOES NOT grant immutable per-token
-- maximum scopes or correct the governed expense source.
BEGIN;
DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
  v_n integer;
BEGIN
  SELECT pg_get_functiondef('public.get_report_snapshot(text,text,text,text,text,text)'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_report_snapshot overload not found'; END IF;
  v_old := 'SELECT value::text INTO v_company FROM public.settings WHERE key = ''company_name'' LIMIT 1;';
  v_new := 'SELECT name INTO v_company FROM public.organisations WHERE id = v_org LIMIT 1;';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'Report sharing patch anchor 1: expected one occurrence, found %', v_n; end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := 'SELECT coalesce(value_text, value::text) INTO v_logo FROM public.system_config WHERE key = ''company_logo'' LIMIT 1;';
  v_new := 'SELECT logo_url INTO v_logo FROM public.organisations WHERE id = v_org LIMIT 1;';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'Report sharing patch anchor 2: expected one occurrence, found %', v_n; end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '      ''accidents_by_site'',(SELECT jsonb_agg(jsonb_build_object(''label'',lbl,''value'',c)) FROM (SELECT coalesce(nullif(btrim(site),''''),''Unassigned'') lbl, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),';
  v_new := '      ''accidents_by_site'',(SELECT jsonb_agg(jsonb_build_object(''label'',lbl,''value'',c)) FROM (SELECT coalesce(nullif(btrim(site),''''),''Unassigned'') lbl, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'Report sharing patch anchor 3: expected one occurrence, found %', v_n; end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := '      ''tyres_by_site'',   (SELECT jsonb_agg(jsonb_build_object(''label'',lbl,''value'',c)) FROM (SELECT coalesce(nullif(btrim(site),''''),''Unassigned'') lbl, count(*) c FROM public.tyre_records WHERE organisation_id=v_org AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR issue_date>=v_from) AND (v_to IS NULL OR issue_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),';
  v_new := '      ''tyres_by_site'',   (SELECT jsonb_agg(jsonb_build_object(''label'',lbl,''value'',c)) FROM (SELECT coalesce(nullif(btrim(site),''''),''Unassigned'') lbl, count(*) c FROM public.tyre_records WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR issue_date>=v_from) AND (v_to IS NULL OR issue_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'Report sharing patch anchor 4: expected one occurrence, found %', v_n; end if;
  v_def := replace(v_def, v_old, v_new);

  EXECUTE v_def;
END;
$patch$;
COMMIT;

-- Post-migration verification (read-only):
-- 1. Inspect pg_get_functiondef for organisation-scoped company/logo lookups.
-- 2. Test a dedicated share in a transaction as a restricted viewer: request a
--    site-specific snapshot and compare both site breakdowns with SQL scoped
--    to exactly that site.
-- 3. Compare per-tenant company and logo with organisations metadata.
-- 4. Recheck SECURITY DEFINER grants, token expiration and password lockout.
-- 5. Run two-tenant and multi-country tests. Do not use production shared links
--    for anonymous probes without the owner's consent.
