import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const migration=await readFile(new URL('../migrations/20260910200002_atomic_legacy_upload_reversal.sql',import.meta.url),'utf8');
const org='00000000-0000-0000-0000-000000000001',actor='00000000-0000-0000-0000-000000000002',batch='00000000-0000-0000-0000-000000000003',row='00000000-0000-0000-0000-000000000004';
test('atomic legacy upload reversal',async t=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT '${actor}'::uuid$$;
 CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql AS $$SELECT '${org}'::uuid$$;
 CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.active')::boolean$$;
 CREATE FUNCTION app_can_admin_delete() RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.admin')::boolean$$;
 CREATE FUNCTION app_write_country_ok(text) RETURNS boolean LANGUAGE sql AS $$SELECT $1='KSA'$$;
 CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE TABLE profiles(id uuid PRIMARY KEY,organisation_id uuid);
 CREATE TABLE upload_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid,uploaded_by uuid,country text);
 ALTER TABLE upload_history ENABLE ROW LEVEL SECURITY;
 CREATE POLICY read_history ON upload_history FOR SELECT TO authenticated USING(true);
 GRANT SELECT ON upload_history,profiles TO authenticated;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 CREATE TABLE tyre_records(id uuid PRIMARY KEY,organisation_id uuid,country text,upload_batch_id uuid,item text);
 CREATE TABLE cleaning_log(tyre_record_id uuid REFERENCES tyre_records(id) ON DELETE CASCADE);
 CREATE TABLE tyre_disposals(tyre_record_id uuid REFERENCES tyre_records(id) ON DELETE CASCADE);
 CREATE TABLE audit_log_v2(user_id uuid,action text,table_name text,record_id text,org_id uuid,country text,record_count integer,new_values jsonb);
 CREATE FUNCTION audit_gate() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF current_setting('test.audit')='fail' THEN RAISE EXCEPTION 'audit unavailable'; END IF;RETURN NEW;END$$;
 CREATE TRIGGER gate BEFORE INSERT ON audit_log_v2 FOR EACH ROW EXECUTE FUNCTION audit_gate();
 INSERT INTO profiles VALUES('${actor}','${org}'),('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009');
 INSERT INTO upload_history(batch_id,uploaded_by,country) VALUES('${batch}','${actor}','KSA'),('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008','KSA');
 INSERT INTO tyre_records VALUES('${row}','${org}','KSA','${batch}','Tyre');
 SET test.active='true';SET test.admin='true';SET test.audit='ok';
 ${migration}
 SET ROLE authenticated;`);
 const reverse=()=>db.query('SELECT reverse_legacy_upload($1,$2) r',[batch,'Incorrect upload']);
 await t.test('history is tenant isolated and ordinary actors cannot reverse',async()=>{
  assert.equal((await db.query('SELECT count(*)::int n FROM upload_history')).rows[0].n,1);
  await db.exec("SET test.admin='false'");await assert.rejects(reverse(),e=>e.code==='42501');
  await db.exec("SET test.admin='true';SET test.active='false'");await assert.rejects(reverse(),e=>e.code==='42501');
  await db.exec("SET test.active='true'");
 });
 await t.test('dependent work prevents destructive cascade',async()=>{
  await db.exec(`RESET ROLE;INSERT INTO cleaning_log VALUES('${row}');SET ROLE authenticated;`);
  await assert.rejects(reverse(),e=>e.code==='23503');
  await db.exec('RESET ROLE;DELETE FROM cleaning_log;SET ROLE authenticated;');
 });
 await t.test('failed audit rolls back removal, archive and history markers',async()=>{
  await db.exec("SET test.audit='fail'");await assert.rejects(reverse(),/audit unavailable/);
  await db.exec('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int n FROM tyre_records')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM administration_imports.upload_reversals')).rows[0].n,0);
  await db.exec("SET test.audit='ok';SET ROLE authenticated;");
 });
 await t.test('successful reversal retains history and originals and retries once',async()=>{
  const receipt=(await reverse()).rows[0].r;assert.equal(receipt.removed,1);
  assert.deepEqual((await reverse()).rows[0].r,receipt);
  await db.exec('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int n FROM tyre_records')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM upload_history WHERE reversed_at IS NOT NULL')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM administration_imports.upload_reversal_rows')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_log_v2')).rows[0].n,1);
 });
 }finally{await db.close()}
});
