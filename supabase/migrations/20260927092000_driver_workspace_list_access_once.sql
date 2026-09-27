-- 20260927092000_driver_workspace_list_access_once
--
-- PURPOSE
--   driver_workspace(null, offset) -> private.driver_workspace_read lists the
--   drivers a user may see. It called private.driver_workspace_access(drv.id)
--   in the WHERE for every driver in the organisation (674) and again in the
--   select list, and each call re-ran ~10 profile lookups (app_is_active,
--   app_current_org, is_super_admin, country/site scope, app_user_can x2,
--   finance-reviewer). So the list cost ~2 s even when it returned nothing
--   (pg_stat_statements: 208 calls, mean 2.4 s, max 7.8 s against the 8 s
--   authenticated statement_timeout).
--
--   The list branch now evaluates the per-user parts of the SAME decision once
--   into variables and keeps the per-driver parts (country, site, the user's
--   own link, an active supervisor/manager assignment) per row, in the same
--   order as driver_workspace_access: driver > (out of scope -> none) >
--   manager > supervisor > finance > viewer > none. NULLs are coalesced to
--   false exactly where the plpgsql IFs treated NULL as not taken.
--   driver_workspace_access() itself is unchanged and still used by the
--   single-driver branch. Applied by anchored replacement of the LIVE body;
--   each anchor must occur exactly once or the migration aborts.
--
-- VERIFY (done live before applying, candidate vs live function)
--   67 real approved users covering every role in the org (Admin, Manager,
--   Director-less set, Fleet Supervisor, Inspector, Driver with and without an
--   account link, Tyre Man, Reporter, Store Keeper, ...): offset 0 payload
--   byte-identical 67/67 (14 users see drivers, one sees a full 101-row page);
--   offsets 100 and 600 identical for the full-page user. Errors identical
--   (none). Mean 2,013 ms -> 17 ms per call.
--   NOT exercised by data: the supervisor branch (driver_team_assignments has
--   0 rows) - it is a verbatim copy of the EXISTS in driver_workspace_access.
--
-- ROLLBACK
--   Re-create private.driver_workspace_read from its previous definition
--   (list branch: WHERE ... AND private.driver_workspace_access(drv.id)<>'none'
--   and 'access',private.driver_workspace_access(drv.id)).

do $do$
declare
  d text := pg_get_functiondef('private.driver_workspace_read(uuid,integer)'::regprocedure);
  a1 text := 'DECLARE result jsonb; access_mode text; d public.drivers%ROWTYPE; page_size integer:=100;';
  r1 text := a1 || E'\n  -- per-call invariants of the access decision, evaluated once for the list\n  v_uid uuid; v_super boolean; v_allc boolean; v_cs text[]; v_alls boolean; v_ss text[];\n  v_mgr boolean; v_fin boolean; v_view boolean;';
  a2 text := E'  IF p_driver_id IS NULL THEN\n';
  r2 text := a2 || E'    -- The list used to call private.driver_workspace_access() twice per driver,\n    -- and each call re-ran about ten profile lookups, so the list cost ~3 ms\n    -- per driver in the organisation even when it returned nothing. The same\n    -- decision is evaluated here with the per-user parts computed once; the\n    -- per-driver parts (country, site, own link, active assignment) stay per row.\n    v_uid := auth.uid(); v_super := public.is_super_admin(); v_allc := public.app_sees_all_countries();\n    v_cs := public.app_country_scope(); v_alls := public.app_sees_all_sites(); v_ss := public.app_site_scope();\n    v_mgr := public.app_user_can(''fleet_master'',''edit''); v_fin := private.driver_workspace_is_finance_reviewer();\n    v_view := public.app_user_can(''driver_workspace'',''view'');\n';
  a3 text := '''access'',private.driver_workspace_access(drv.id),';
  r3 text := '''access'',acc.mode,';
  a4 text := E'      FROM public.drivers drv LEFT JOIN public.driver_account_links l ON l.driver_id=drv.id\n      WHERE drv.organisation_id=public.app_current_org() AND private.driver_workspace_access(drv.id)<>''none''';
  r4 text := E'      FROM public.drivers drv LEFT JOIN public.driver_account_links l ON l.driver_id=drv.id\n      CROSS JOIN LATERAL (SELECT CASE\n        WHEN coalesce(v_super OR v_allc OR lower(btrim(drv.country))=ANY(v_cs),false)\n          AND EXISTS(SELECT 1 FROM public.driver_account_links dl WHERE dl.driver_id=drv.id\n            AND dl.user_id=v_uid AND dl.organisation_id=drv.organisation_id) THEN ''driver''\n        WHEN NOT coalesce((v_super OR v_allc OR lower(btrim(drv.country))=ANY(v_cs))\n          AND (v_super OR v_alls OR upper(btrim(drv.site))=ANY(v_ss)),false) THEN ''none''\n        WHEN coalesce(v_mgr,false) THEN ''manager''\n        WHEN EXISTS(SELECT 1 FROM public.driver_team_assignments a WHERE a.driver_id=drv.id AND a.organisation_id=drv.organisation_id\n          AND a.starts_at<=now() AND (a.ends_at IS NULL OR a.ends_at>now()) AND v_uid IN (a.supervisor_id,a.manager_id)) THEN ''supervisor''\n        WHEN coalesce(v_fin,false) THEN ''finance''\n        WHEN coalesce(v_view,false) THEN ''viewer''\n        ELSE ''none'' END AS mode) acc\n      WHERE drv.organisation_id=public.app_current_org() AND acc.mode<>''none''';
begin
  if (length(d)-length(replace(d,a1,'')))/length(a1) <> 1 then raise exception 'anchor a1 not found exactly once'; end if;
  if (length(d)-length(replace(d,a2,'')))/length(a2) <> 1 then raise exception 'anchor a2 not found exactly once'; end if;
  if (length(d)-length(replace(d,a3,'')))/length(a3) <> 1 then raise exception 'anchor a3 not found exactly once'; end if;
  if (length(d)-length(replace(d,a4,'')))/length(a4) <> 1 then raise exception 'anchor a4 not found exactly once'; end if;
  execute replace(replace(replace(replace(d,a1,r1),a2,r2),a3,r3),a4,r4);
end $do$;
