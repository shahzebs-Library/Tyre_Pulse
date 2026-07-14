-- V226: Country-visibility audit + close gaps (applied live 2026-07-14, jhssdmeruxtrlqnwfksc).
-- Any user WITH access sees their own country's data (profiles.country[]); admins/super see all;
-- rows with no country stay visible to all (app_can_see_country is null-safe both ways).

-- (1) accidents was the ONLY table where a PERMISSIVE role gate defeated country sharing:
-- active_select_accidents required role IN (admin,manager,director,inspector) so Reporter/Tyre Man/
-- Data Monitor saw ZERO accidents even in their own country. Widen to any ACTIVE user (like
-- inspections/tyre_records); RESTRICTIVE accidents_country_isolation + accidents_org_isolation still
-- scope every read by country and org.
DROP POLICY IF EXISTS active_select_accidents ON public.accidents;
CREATE POLICY active_select_accidents ON public.accidents
  FOR SELECT USING (public.app_is_active());

-- (2) RESTRICTIVE country isolation added to operational fleet BASE TABLES that browse country data
-- but lacked it (tyre_changes excluded: it is a VIEW). RESTRICTIVE => ANDs (narrows, never widens).
DO $$
DECLARE t text;
  tbls text[] := ARRAY[
    'insurance_claims','incident_reports','retread_claims','drivers',
    'tyre_service_events','tyre_pool','checklist_submissions',
    'dvir_reports','handover_reports','breakdown_callouts','service_requests',
    'odometer_logs','engine_hours_logs','fitment_validations','goods_receipts','requisitions'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_country_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT USING (public.app_can_see_country(country))',
      t||'_country_isolation', t);
  END LOOP;
END $$;
