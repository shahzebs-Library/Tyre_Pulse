-- ============================================================================
-- tests/rpc_gate_pass_blockers.sql - self-asserting test for MIGRATIONS_V53.
--
-- Proves gate_pass_blockers() surfaces open critical safety defects and marks
-- the asset blocked, is country-scoped, and excludes resolved items. Seeds a
-- High corrective_action + Critical tyre + Critical (Scheduled) inspection, and
-- a resolved (Done) Critical inspection that must NOT block. RAISEs
-- 'PASS_ROLLBACK' so no test data remains. Verified green against the live
-- schema (caught that inspections.status uses Done/Cancelled, not
-- Completed/Approved).
-- ============================================================================

DO $$
DECLARE
  uid uuid := '1bf85bfd-ef76-48cc-a8b1-aac1ea511bf4';  -- approved+unlocked profile
  org uuid := '00000000-0000-0000-0000-000000000001';
  res jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  -- clean asset with no defects
  res := public.gate_pass_blockers('GATE-CLEAN', 'KSA');
  IF (res->>'blocked')::boolean <> false OR (res->>'total')::int <> 0 THEN RAISE EXCEPTION 'FAIL clean %', res; END IF;

  INSERT INTO public.corrective_actions (title, asset_no, priority, status, site, country, organisation_id, created_by)
    VALUES ('Brake defect','GATE-BAD','High','Open','TestSite','KSA',org,uid);
  INSERT INTO public.tyre_records (asset_no, serial_no, risk_level, site, country, organisation_id, uploaded_by)
    VALUES ('GATE-BAD','SN-CRIT','Critical','TestSite','KSA',org,uid);
  INSERT INTO public.inspections (title, asset_no, severity, status, site, scheduled_date, inspection_date, country, organisation_id, created_by)
    VALUES ('Tyre insp','GATE-BAD','Critical','Scheduled','TestSite', current_date, current_date, 'KSA',org,uid);
  -- a resolved (Done) Critical inspection must NOT block
  INSERT INTO public.inspections (title, asset_no, severity, status, site, scheduled_date, inspection_date, country, organisation_id, created_by)
    VALUES ('Old insp','GATE-BAD','Critical','Done','TestSite', current_date, current_date, 'KSA',org,uid);

  res := public.gate_pass_blockers('GATE-BAD', 'KSA');
  IF (res->>'blocked')::boolean <> true OR (res->>'total')::int <> 3 THEN RAISE EXCEPTION 'FAIL blocked/total %', res; END IF;
  IF jsonb_array_length(res->'inspections') <> 1 THEN RAISE EXCEPTION 'FAIL Done inspection leaked %', res->'inspections'; END IF;

  -- country isolation
  res := public.gate_pass_blockers('GATE-BAD', 'UAE');
  IF (res->>'total')::int <> 0 THEN RAISE EXCEPTION 'FAIL country isolation %', res; END IF;

  RAISE EXCEPTION 'PASS_ROLLBACK: gate_pass_blockers - 3 open blockers, Done excluded, country-scoped ✓';
END $$;
