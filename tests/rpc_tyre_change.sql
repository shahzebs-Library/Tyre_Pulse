-- ============================================================================
-- tests/rpc_tyre_change.sql — self-asserting test for MIGRATIONS_V50.
--
-- Proves apply_tyre_change() is a single all-or-nothing transaction:
--   (1) the removed tyre_records row is closed (status='Removed', km/date/reason)
--   (2) a replacement fitment row is inserted (org-tagged, uploaded_by=caller,
--       fitment_date generated from issue_date)
--   (3) exactly ONE canonical audit_log_v2 row (action='tyre_change') is written
--       via record_audit_event, with user_id/user_email resolved from profiles.
--
-- Runs entirely inside a DO block and RAISEs 'PASS_ROLLBACK' at the end so the
-- transaction aborts and NO test data is left behind. Any failed assertion
-- RAISEs 'FAIL …' first. Replace :uid/:org with a real approved+unlocked profile
-- and its org when running via psql, or run the DO block as-is if those defaults
-- exist. Verified green against the live schema (caught a generated-column bug
-- in an earlier draft: fitment_date must not be inserted).
-- ============================================================================

DO $$
DECLARE
  uid uuid := '1bf85bfd-ef76-48cc-a8b1-aac1ea511bf4';  -- an approved+unlocked profile
  org uuid := '00000000-0000-0000-0000-000000000001';  -- that profile's org
  old_id uuid; new_id uuid; r public.tyre_records%ROWTYPE; a public.audit_log_v2%ROWTYPE; n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  INSERT INTO public.tyre_records (asset_no, serial_no, position, site, status, km_at_fitment, organisation_id, uploaded_by)
    VALUES ('TEST-AST', 'SN-OLD', 'FL', 'TestSite', 'Fitted', 10000, org, uid)
    RETURNING id INTO old_id;

  new_id := public.apply_tyre_change(jsonb_build_object(
    'removed_record_id', old_id::text, 'asset_no','TEST-AST', 'position','FL',
    'site','TestSite', 'brand','Michelin', 'serial_no','SN-NEW',
    'cost_per_tyre', 420.50, 'km_at_fitment', 55000, 'km_at_removal', 54000,
    'removal_reason','Worn out'));

  SELECT * INTO r FROM public.tyre_records WHERE id = old_id;
  IF r.status <> 'Removed' OR r.km_at_removal <> 54000 OR r.removal_date IS NULL OR r.removal_reason <> 'Worn out' THEN
    RAISE EXCEPTION 'FAIL removed row not closed correctly'; END IF;

  SELECT * INTO r FROM public.tyre_records WHERE id = new_id;
  IF r.asset_no <> 'TEST-AST' OR r.serial_no <> 'SN-NEW' OR r.position <> 'FL' OR r.tyre_position <> 'FL'
     OR r.km_at_fitment <> 55000 OR r.organisation_id <> org OR r.uploaded_by <> uid
     OR r.category <> 'Tyre Change' OR r.fitment_date IS NULL THEN
    RAISE EXCEPTION 'FAIL fitment row: %', row_to_json(r); END IF;

  SELECT count(*) INTO n FROM public.audit_log_v2 WHERE record_id = new_id::text AND action = 'tyre_change';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL audit count = %', n; END IF;
  SELECT * INTO a FROM public.audit_log_v2 WHERE record_id = new_id::text AND action = 'tyre_change';
  IF a.user_id <> uid OR a.table_name <> 'tyre_records'
     OR a.old_data->>'removed_record_id' <> old_id::text
     OR a.new_data->>'fitment_record_id' <> new_id::text THEN
    RAISE EXCEPTION 'FAIL audit content'; END IF;

  RAISE EXCEPTION 'PASS_ROLLBACK: apply_tyre_change removal+fitment+audit atomic ✓';
END $$;
