-- ============================================================================
-- tests/rpc_all_modules_commit.sql — self-asserting test for MIGRATIONS_V56.
-- Proves a minimal realistic row for EVERY one of the 10 intake modules commits
-- via import_commit_batch (10/10). Guards the NOT-NULL-default fix: without V56,
-- driver/accident/warranty/workorder/inspection fail on NOT-NULL columns the
-- intake can't always map. RAISEs PASS/FAIL and rolls back (no data left).
-- ============================================================================
DO $$
DECLARE
  uid uuid := '1bf85bfd-ef76-48cc-a8b1-aac1ea511bf4';  -- approved+unlocked profile
  mods jsonb := jsonb_build_object(
    'fleet', jsonb_build_object('asset_no','FLEET-1'),
    'tyre', jsonb_build_object('serial_no','SN-1','asset_no','A-1'),
    'stock', jsonb_build_object('site','S1','description','D1','stock_qty',5),
    'accident', jsonb_build_object('asset_no','A-1','incident_date','2026-02-01'),
    'inspection', jsonb_build_object('asset_no','A-1','inspection_date','2026-02-01'),
    'workorder', jsonb_build_object('work_order_no','WO-1','asset_no','A-1'),
    'warranty', jsonb_build_object('serial_number','SN-1'),
    'gatepass', jsonb_build_object('asset_no','A-1'),
    'supplier', jsonb_build_object('supplier_name','ACME'),
    'driver', jsonb_build_object('driver_name','John Doe'));
  m text; td jsonb; fid uuid; bid uuid; res jsonb; okc int := 0; fails text := '';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  FOR m, td IN SELECT key, value FROM jsonb_each(mods) LOOP
    BEGIN
      INSERT INTO import_files (country,storage_bucket,storage_path,original_filename,created_by) VALUES ('KSA','import-files','p/'||gen_random_uuid()||'/f','f',uid) RETURNING id INTO fid;
      INSERT INTO import_batches (country,module,file_id,uploader,created_by,approval_status,import_status) VALUES ('KSA',m,fid,uid,uid,'approved','staged') RETURNING id INTO bid;
      INSERT INTO import_rows (batch_id,source_row_no,raw_source_data,mapped_data,transformed_data,validation_status,dup_status,action) VALUES (bid,1,'{}','{}',td,'ready','none','insert');
      res := public.import_commit_batch(bid);
      IF (res->>'inserted')::int = 1 THEN okc := okc + 1; ELSE fails := fails || m || '(skipped) '; END IF;
    EXCEPTION WHEN others THEN fails := fails || m || ':' || SQLERRM || ' '; END;
  END LOOP;
  IF okc <> 10 THEN RAISE EXCEPTION 'FAIL: only % / 10 modules commit. fails=[%]', okc, fails; END IF;
  RAISE EXCEPTION 'PASS_ROLLBACK: all 10 modules commit a minimal row.';
END $$;
