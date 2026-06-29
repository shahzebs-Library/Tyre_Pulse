-- ─────────────────────────────────────────────────────────────────────────────
-- Data Intake Center commit-framework test (MIGRATIONS_V46).
--
-- Proves import_commit_batch / import_reverse_batch are safe and correct:
--   commit a ready row → live tyre_records row created + org/country/uploader
--   stamped + source row linked; second commit is idempotent; reverse deletes
--   exactly the created row. Self-asserting; rolled back (leaves no data).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/rpc_import_commit.sql
--
-- Verified passing on 2026-06-29.
-- ─────────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  uid uuid;
  bid uuid;
  res jsonb;
  cnt int;
  org uuid;
BEGIN
  -- act as a real approved+unlocked user in the default org
  SELECT id INTO uid FROM public.profiles
    WHERE COALESCE(approved,false) AND NOT COALESCE(locked,false) LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'no approved profile to test with'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  org := public.app_current_org();

  INSERT INTO public.import_batches (organisation_id, country, module, approval_status, import_status, created_by)
    VALUES (org, 'KSA', 'tyre', 'approved', 'ready', uid) RETURNING id INTO bid;
  INSERT INTO public.import_rows (organisation_id, batch_id, source_row_no, transformed_data, validation_status, action)
    VALUES (org, bid, 1, '{"serial_no":"IMP_COMMIT_TEST","brand":"TestBrand","site":"Riyadh"}'::jsonb, 'ready', 'insert');

  res := public.import_commit_batch(bid);
  IF (res->>'inserted')::int <> 1 THEN RAISE EXCEPTION 'commit inserted=% expected 1 (%)', res->>'inserted', res; END IF;

  SELECT count(*) INTO cnt FROM public.tyre_records
    WHERE serial_no='IMP_COMMIT_TEST' AND organisation_id=org AND uploaded_by=uid AND country='KSA';
  IF cnt <> 1 THEN RAISE EXCEPTION 'live row not created/tagged (count=%)', cnt; END IF;

  SELECT count(*) INTO cnt FROM public.import_rows WHERE batch_id=bid AND target_record_id IS NOT NULL;
  IF cnt <> 1 THEN RAISE EXCEPTION 'import_row not linked to target (count=%)', cnt; END IF;

  res := public.import_commit_batch(bid);
  IF res->>'status' <> 'already_committed' THEN RAISE EXCEPTION 'expected already_committed, got %', res; END IF;

  res := public.import_reverse_batch(bid);
  SELECT count(*) INTO cnt FROM public.tyre_records WHERE serial_no='IMP_COMMIT_TEST';
  IF cnt <> 0 THEN RAISE EXCEPTION 'reverse left the imported row (count=%)', cnt; END IF;

  RAISE NOTICE 'import commit framework test PASSED (commit/idempotent/reverse)';
END $$;
ROLLBACK;
