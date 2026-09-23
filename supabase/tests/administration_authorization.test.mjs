import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../migrations/20260910183922_administration_authorization_guards.sql',import.meta.url),'utf8');
const baseline = await readFile(new URL('./fixtures/admin_import_commit_baseline.sql',import.meta.url),'utf8');
const reverseBaseline = await readFile(new URL('./fixtures/admin_import_reverse_baseline.sql',import.meta.url),'utf8');
const stateMigration = await readFile(new URL('../migrations/20260910184920_administration_state_and_user_guards.sql',import.meta.url),'utf8');
const processingMigration = await readFile(new URL('../migrations/20260910185852_guarded_import_enrichment_and_reprocessing.sql',import.meta.url),'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;

test('Administration guards enforce direct API authorization and atomic imports',async t=>{
 const db=new PGlite();
 try {
  await db.exec(`
   CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
   CREATE TABLE profiles(id uuid PRIMARY KEY,role text,org_id uuid,approved boolean DEFAULT true,locked boolean DEFAULT false);
   INSERT INTO profiles VALUES('${id(1)}','Admin','${id(10)}',true,false),('${id(2)}','User','${id(10)}',true,false),('${id(3)}','Admin','${id(11)}',true,false),('${id(4)}','Admin','${id(10)}',true,true),('${id(5)}','Manager','${id(10)}',true,false);
   CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$SELECT org_id FROM profiles WHERE id=auth.uid()$$;
   CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT approved AND NOT locked FROM profiles WHERE id=auth.uid()$$;
   CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$SELECT role FROM profiles WHERE id=auth.uid()$$;
   CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
   CREATE FUNCTION is_elevated_user() RETURNS boolean LANGUAGE sql AS $$SELECT get_my_role() IN ('Admin','Manager','Director')$$;
   CREATE FUNCTION app_can_admin_delete() RETURNS boolean LANGUAGE sql AS $$SELECT get_my_role()='Admin'$$;
   CREATE FUNCTION is_approved_and_unlocked() RETURNS boolean LANGUAGE sql AS $$SELECT app_is_active()$$;
   CREATE FUNCTION app_write_country_ok(text) RETURNS boolean LANGUAGE sql AS $$SELECT $1='KSA'$$;
   CREATE FUNCTION app_sees_all_sites() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
   CREATE FUNCTION app_site_scope() RETURNS text[] LANGUAGE sql AS $$SELECT ARRAY['JEDDAH']::text[]$$;
   CREATE FUNCTION import_user_can_commit_country(text) RETURNS boolean LANGUAGE sql AS $$SELECT $1='KSA'$$;
   CREATE TABLE ocr_scans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid DEFAULT app_current_org(),country text DEFAULT 'KSA',created_by uuid DEFAULT auth.uid(),created_at timestamptz DEFAULT now(),review_status text DEFAULT 'pending',reviewed_by text,corrected_value text);
   CREATE TABLE onboarding_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid DEFAULT app_current_org(),country text DEFAULT 'KSA',created_by uuid DEFAULT auth.uid(),created_at timestamptz DEFAULT now(),status text DEFAULT 'not_started',completed_at timestamptz);
   CREATE TABLE support_tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid DEFAULT app_current_org(),country text DEFAULT 'KSA',created_by uuid DEFAULT auth.uid(),created_at timestamptz DEFAULT now(),created_by_name text,created_by_email text,status text DEFAULT 'open',admin_response text,responded_by uuid,responded_at timestamptz,resolved_at timestamptz,message text);
   CREATE TABLE import_batches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid DEFAULT app_current_org(),country text DEFAULT 'KSA',created_by uuid DEFAULT auth.uid(),uploader uuid DEFAULT auth.uid(),approver uuid,approved_at timestamptz,approval_status text DEFAULT 'draft',import_status text DEFAULT 'staged',module text DEFAULT 'tyres',imported_rows int DEFAULT 0,skipped_rows int DEFAULT 0,error_rows int DEFAULT 0,completed_at timestamptz);
   CREATE TABLE import_rows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid DEFAULT app_current_org(),batch_id uuid,source_row_no int,action text DEFAULT 'insert',validation_status text DEFAULT 'ready',processed_at timestamptz,transformed_data jsonb,mapped_data jsonb,custom_data jsonb,raw_source_data jsonb,dup_status text,target_module text,target_record_id text);
   CREATE TABLE import_row_issues(row_id uuid,severity text,issue_code text,message text);
   CREATE TABLE import_audit_events(organisation_id uuid,batch_id uuid,actor uuid,action text,detail jsonb);
   CREATE FUNCTION import_target_table(text) RETURNS text LANGUAGE sql AS $$SELECT 'tyre_records'::text$$;
   CREATE FUNCTION import_cost_fields(text) RETURNS text[] LANGUAGE sql AS $$SELECT null::text[]$$;
   CREATE FUNCTION import_merge_key(text,jsonb) RETURNS text LANGUAGE sql AS $$SELECT null::text$$;
   CREATE FUNCTION import_exact_supplied_match(jsonb,jsonb,text[]) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
   CREATE FUNCTION import_natural_key(text,jsonb) RETURNS text LANGUAGE sql AS $$SELECT $2->>'asset_no'$$;
   CREATE FUNCTION import_jsonb_blank(jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT $1 IS NULL OR $1='null'::jsonb OR $1='""'::jsonb$$;
   CREATE TABLE tyre_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,country text,site text,asset_no text,uploaded_by uuid,upload_batch_id uuid,data_source text DEFAULT 'manual' CHECK(data_source IN ('manual','upload','api')),description text,qty int DEFAULT 1 CHECK(qty>0),issue_date date,fitment_date date GENERATED ALWAYS AS(issue_date) STORED,created_at timestamptz DEFAULT now());
   CREATE TABLE stock_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,country text DEFAULT 'KSA',updated_by uuid,description text,stock_qty int DEFAULT 0,min_level int DEFAULT 5);
   CREATE TABLE pending_uploads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,country text,uploaded_by uuid,batch_id uuid,upload_type text,rows jsonb,status text DEFAULT 'pending',reviewed_by uuid,reviewed_at timestamptz,import_status text DEFAULT 'pending',imported_count int,imported_at timestamptz,import_error text);
  `);
  for(const table of ['ocr_scans','onboarding_tasks','support_tickets','import_batches']) {
   await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
    CREATE POLICY existing_access ON ${table} FOR ALL TO authenticated USING(auth.uid() IS NOT NULL) WITH CHECK(auth.uid() IS NOT NULL);
    CREATE POLICY existing_scope ON ${table} AS RESTRICTIVE FOR ALL TO authenticated USING(organisation_id=app_current_org() AND country='KSA') WITH CHECK(organisation_id=app_current_org() AND country='KSA');`);
  }
  await db.exec(baseline);
  await db.exec(reverseBaseline);
  await db.exec(`INSERT INTO import_batches(id,organisation_id,approval_status) VALUES('${id(27)}','${id(10)}',NULL)`);
  await db.exec(migration);
  // Exercise actual commit/enrich/reprocess/reverse together with reviewed-row
  // triggers; the unrelated mobile-user patch has its own integration harness.
  await db.exec(`${stateMigration.split('-- Small guarded changes')[0]}\nCOMMIT;`);
  await db.exec(processingMigration);
  await db.exec(`GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO authenticated; SET ROLE authenticated; SET test.actor='${id(1)}';`);
  const actor=async n=>db.exec(`SET test.actor='${id(n)}'`);
  const rows=async(sql,params=[]) => (await db.query(sql,params)).rows;
  const rpc=async n=>(await rows('SELECT approve_pending_upload($1) AS result',[id(n)]))[0].result;
  const denied=promise=>assert.rejects(promise,e=>e.code==='42501');
  await t.test('ordinary and locked users cannot mutate OCR or onboarding; tenant/country restrictions survive',async()=>{
   await actor(2);
   for(const table of ['ocr_scans','onboarding_tasks']) await denied(db.exec(`INSERT INTO ${table} DEFAULT VALUES`));
   await actor(1); await db.exec(`INSERT INTO ocr_scans(id) VALUES('${id(20)}'); INSERT INTO onboarding_tasks(id) VALUES('${id(21)}');`);
   await denied(db.exec(`INSERT INTO ocr_scans(organisation_id) VALUES('${id(11)}')`));
   await denied(db.exec("INSERT INTO onboarding_tasks(country) VALUES('UAE')"));
   await actor(2); assert.equal((await rows(`UPDATE ocr_scans SET review_status='confirmed' RETURNING id`)).length,0);
   await actor(4); await denied(db.exec('INSERT INTO onboarding_tasks DEFAULT VALUES')); await actor(1);
  });
  await t.test('reviewer and completion timestamps are server-derived and creation identity immutable',async()=>{
   await db.exec(`UPDATE ocr_scans SET review_status='confirmed',reviewed_by='spoof' WHERE id='${id(20)}'`);
   assert.equal((await rows('SELECT reviewed_by FROM ocr_scans'))[0].reviewed_by,id(1));
   await db.exec(`UPDATE onboarding_tasks SET status='completed',completed_at='2000-01-01' WHERE id='${id(21)}'`);
   assert.notEqual(String((await rows('SELECT completed_at FROM onboarding_tasks'))[0].completed_at).slice(0,4),'2000');
   await denied(db.exec(`UPDATE ocr_scans SET created_by='${id(2)}'`));
  });
  await t.test('reporters cannot forge responses, status, identities or resolution; triage stamps trusted identity',async()=>{
   await actor(2); await db.exec(`INSERT INTO support_tickets(id,status,admin_response,created_by) VALUES('${id(22)}','resolved','forged','${id(1)}')`);
   const ticket=(await rows('SELECT * FROM support_tickets'))[0]; assert.equal(ticket.status,'open');assert.equal(ticket.admin_response,null);assert.equal(ticket.created_by,id(2));
   await db.exec("UPDATE support_tickets SET message='extra detail'");
   for(const patch of ["status='resolved'","admin_response='forged'",`responded_by='${id(1)}'`,"resolved_at=now()"])
    await denied(db.exec(`UPDATE support_tickets SET ${patch}`));
   await actor(1);await db.exec(`UPDATE support_tickets SET admin_response='Reviewed',responded_by='${id(2)}',status='resolved',responded_at='2000-01-01'`);
   const saved=(await rows('SELECT * FROM support_tickets'))[0];assert.equal(saved.responded_by,id(1));assert.ok(saved.resolved_at);assert.notEqual(String(saved.responded_at).slice(0,4),'2000');
  });
  await t.test('non-elevated users cannot approve or forge identity; elevated self-approval remains supported',async()=>{
   await actor(2);await db.exec(`INSERT INTO import_batches(id) VALUES('${id(23)}')`);
   await denied(db.exec("UPDATE import_batches SET approval_status='approved'"));
   await denied(db.exec(`UPDATE import_batches SET approver='${id(1)}'`));
   await denied(db.exec("INSERT INTO import_batches(approval_status) VALUES('approved')"));
   await denied(db.exec("INSERT INTO import_batches(approval_status) VALUES(NULL)"));
   await actor(1);await db.exec(`INSERT INTO import_batches(id) VALUES('${id(24)}'); INSERT INTO import_rows(batch_id,source_row_no,mapped_data) VALUES('${id(24)}',1,'{"description":"test","qty":2}'); UPDATE import_batches SET approval_status='approved',approver='${id(2)}',approved_at='2000-01-01' WHERE approval_status='draft'`);
   assert.ok((await rows("SELECT approver FROM import_batches WHERE approval_status='approved'")).every(x=>x.approver===id(1)));
   await assert.rejects(db.exec("UPDATE import_batches SET approval_status='rejected'"),e=>e.code==='23514');
   // Specialist history may still write draft+committed; it does not confer approval.
   await db.exec(`INSERT INTO import_batches(id,import_status) VALUES('${id(25)}','committed')`);
  });
  await t.test('deployed commit runs under a row lock, rejects null/other tenant, and replay adds no rows',async()=>{
   const def=(await rows("SELECT pg_get_functiondef('import_commit_batch(uuid,integer)'::regprocedure) AS def"))[0].def;
   assert.match(def,/WHERE id = p_batch_id FOR UPDATE/);
   const result=(await rows(`SELECT import_commit_batch('${id(24)}',100) AS r`))[0].r;assert.equal(result.inserted,1);
   assert.equal((await rows(`SELECT import_commit_batch('${id(24)}',100) AS r`))[0].r.status,'already_committed');
   await actor(3);await denied(db.exec(`SELECT import_commit_batch('${id(24)}',100)`)); await actor(1);
   await db.exec(`RESET ROLE; INSERT INTO import_batches(id,organisation_id) VALUES('${id(26)}',NULL); SET ROLE authenticated;`);
   await denied(db.exec(`SELECT import_commit_batch('${id(26)}',100)`));
   await assert.rejects(db.exec(`SELECT import_commit_batch('${id(27)}',100)`),/Batch is not approved/);
  });
  await t.test('real enrich RPC rejects unapproved/unprivileged calls and only refreshes matching tenant/country/site',async()=>{
   await db.exec(`INSERT INTO import_batches(id) VALUES('${id(60)}');INSERT INTO import_rows(id,batch_id,action,mapped_data) VALUES('${id(61)}','${id(60)}','update','{"asset_no":"ASSET-A","qty":9,"site":"JEDDAH"}');
    INSERT INTO tyre_records(id,organisation_id,country,site,asset_no,qty) VALUES
     ('${id(70)}',NULL,'KSA','JEDDAH','ASSET-A',3),('${id(71)}','${id(11)}','KSA','JEDDAH','ASSET-A',4),
     ('${id(72)}','${id(10)}','UAE','JEDDAH','ASSET-A',5),('${id(73)}','${id(10)}','KSA','OTHER','ASSET-A',6),('${id(74)}','${id(10)}','KSA','JEDDAH','ASSET-A',2)`);
   await denied(db.exec(`SELECT import_enrich_batch('${id(60)}',100,NULL)`));
   await db.exec(`UPDATE import_batches SET approval_status='approved' WHERE id='${id(60)}'`);
   await actor(2);await denied(db.exec(`SELECT import_enrich_batch('${id(60)}',100,NULL)`));await actor(5);
   const result=(await rows(`SELECT import_enrich_batch('${id(60)}',100,NULL) AS r`))[0].r;assert.equal(result.enriched,1);
   assert.deepEqual((await rows(`SELECT qty FROM tyre_records WHERE asset_no='ASSET-A' ORDER BY id`)).map(r=>r.qty),[3,4,5,6,9]);
   await denied(db.exec(`SELECT import_reprocess_row('${id(61)}')`));await actor(1);
  });
  await t.test('real reprocess locks and checks approval, tenant, country, site and processed state',async()=>{
   await db.exec(`INSERT INTO import_batches(id) VALUES('${id(80)}');INSERT INTO import_rows(id,batch_id,validation_status,mapped_data) VALUES('${id(81)}','${id(80)}','error','{"site":"JEDDAH"}'),('${id(82)}','${id(80)}','error','{"site":"OTHER"}')`);
   await db.exec(`SELECT import_reprocess_row('${id(81)}')`);assert.equal((await rows(`SELECT validation_status FROM import_rows WHERE id='${id(81)}'`))[0].validation_status,'pending');
   await denied(db.exec(`SELECT import_reprocess_row('${id(82)}')`));
   await actor(3);await denied(db.exec(`SELECT import_reprocess_row('${id(81)}')`));await actor(1);
   await db.exec(`UPDATE import_rows SET processed_at=now() WHERE id='${id(81)}'`);await denied(db.exec(`SELECT import_reprocess_row('${id(81)}')`));
  });
  await t.test('commit preflight rejects foreign staging ownership and out-of-scope destination sites',async()=>{
   await db.exec(`INSERT INTO import_batches(id) VALUES('${id(83)}'),('${id(84)}');INSERT INTO import_rows(batch_id,organisation_id,mapped_data) VALUES('${id(83)}','${id(11)}','{}'),('${id(84)}','${id(10)}','{"site":"OTHER"}');UPDATE import_batches SET approval_status='approved' WHERE id IN ('${id(83)}','${id(84)}')`);
   await denied(db.exec(`SELECT import_commit_batch('${id(83)}',100)`));
   await actor(5);await denied(db.exec(`SELECT import_commit_batch('${id(84)}',100)`));
   await denied(db.exec(`SELECT import_enrich_batch('${id(83)}',100,NULL)`));await actor(1);
  });
  await t.test('reverse preserves pre-existing duplicates and foreign scope, and reversed batches cannot resume',async()=>{
   await db.exec(`INSERT INTO import_batches(id) VALUES('${id(85)}');
    INSERT INTO tyre_records(id,organisation_id,country,site) VALUES('${id(86)}','${id(10)}','KSA','JEDDAH'),('${id(87)}','${id(10)}','KSA','JEDDAH'),('${id(88)}','${id(10)}','KSA','OTHER'),('${id(89)}','${id(10)}','UAE','JEDDAH');
    INSERT INTO import_rows(batch_id,target_record_id,dup_status) VALUES('${id(85)}','${id(86)}','new'),('${id(85)}','${id(87)}','duplicate'),('${id(85)}','${id(88)}','new'),('${id(85)}','${id(89)}','new');
    UPDATE import_batches SET approval_status='approved',import_status='committed' WHERE id='${id(85)}'`);
   await actor(4);await denied(db.exec(`SELECT import_reverse_batch('${id(85)}')`));await actor(1);
   const result=(await rows(`SELECT import_reverse_batch('${id(85)}') AS r`))[0].r;assert.equal(result.deleted,1);assert.equal(result.skipped,3);
   assert.equal((await rows(`SELECT id FROM tyre_records WHERE id IN ('${id(87)}','${id(88)}','${id(89)}')`)).length,3);
   await denied(db.exec(`SELECT import_commit_batch('${id(85)}',100)`));
   await denied(db.exec(`SELECT import_enrich_batch('${id(85)}',100,NULL)`));
  });
  const pending=async(n,type,data,org=id(10))=>db.query('INSERT INTO pending_uploads(id,organisation_id,country,uploaded_by,batch_id,upload_type,rows) VALUES($1,$2,$3,$4,$5,$6,$7)',[id(n),org,'KSA',id(2),id(99),type,JSON.stringify(data)]);
  await t.test('pending approval preserves defaults/generated fields, filters identity, and replay is idempotent',async()=>{
   await pending(30,'tyres',[{description:'approved',issue_date:'2026-09-10',fitment_date:'2000-01-01',id:id(55),organisation_id:id(11),uploaded_by:id(3)}]);
   assert.equal((await rpc(30)).imported,1);
   const tyre=(await rows("SELECT * FROM tyre_records WHERE description='approved'"))[0];assert.equal(tyre.qty,1);assert.notEqual(tyre.id,id(55));assert.equal(tyre.uploaded_by,id(2));assert.equal(tyre.organisation_id,id(10));assert.equal(new Date(tyre.fitment_date).toISOString().slice(0,10),'2026-09-10');assert.ok(tyre.created_at);
   assert.equal((await rpc(30)).already_imported,true);
   assert.equal((await rows("SELECT * FROM tyre_records WHERE description='approved'")).length,1);
   await pending(31,'stock',[{description:'stock'}]);await rpc(31);assert.equal((await rows('SELECT min_level FROM stock_records'))[0].min_level,5);
  });
  await t.test('invalid row rolls back approval and all earlier rows; country/tenant/role denials are enforced',async()=>{
   await pending(32,'tyres',[{description:'must rollback'},{qty:-1}]);await assert.rejects(rpc(32),e=>e.code==='23514');
   assert.equal((await rows("SELECT * FROM tyre_records WHERE description='must rollback'")).length,0);
   assert.equal((await rows(`SELECT status FROM pending_uploads WHERE id='${id(32)}'`))[0].status,'pending');
   await pending(33,'tyres',[{country:'UAE'}]);await denied(rpc(33));
   await pending(34,'stock',[{}],id(11));await denied(rpc(34));
   await pending(35,'stock',[{site:'UNASSIGNED-OTHER-SITE'}]);await denied(rpc(35));
   await actor(2);await denied(rpc(32));await actor(4);await denied(rpc(32));
   await db.exec('RESET ROLE;SET ROLE anon;');await denied(rpc(32));
  });
 } finally {await db.close();}
});
