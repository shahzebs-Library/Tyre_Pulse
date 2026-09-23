import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration=await readFile(new URL('../migrations/20260910185443_verify_import_destination_scope.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('landing verification never counts foreign tenant/country destinations or accepts foreign staging',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`CREATE SCHEMA auth;CREATE ROLE authenticated;CREATE ROLE anon;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT '${id(1)}'::uuid$$;
   CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql AS $$SELECT '${id(10)}'::uuid$$;
   CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.active',true)='true'$$;
   CREATE FUNCTION import_user_can_commit_country(text) RETURNS boolean LANGUAGE sql AS $$SELECT $1='KSA'$$;
   CREATE FUNCTION import_target_table(text) RETURNS text LANGUAGE sql AS $$SELECT 'tyre_records'::text$$;
   CREATE TABLE import_batches(id uuid PRIMARY KEY,organisation_id uuid,country text,module text,import_status text);
   CREATE TABLE import_rows(id uuid PRIMARY KEY,organisation_id uuid,batch_id uuid,target_record_id text);
   CREATE TABLE tyre_records(id uuid PRIMARY KEY,organisation_id uuid,country text);
   INSERT INTO import_batches VALUES('${id(20)}','${id(10)}','KSA','tyre','committed'),('${id(21)}','${id(11)}','KSA','tyre','committed');
   INSERT INTO tyre_records VALUES('${id(30)}','${id(10)}','KSA'),('${id(31)}','${id(11)}','KSA'),('${id(32)}','${id(10)}','UAE');
   INSERT INTO import_rows VALUES('${id(40)}','${id(10)}','${id(20)}','${id(30)}'),('${id(41)}','${id(10)}','${id(20)}','${id(31)}'),('${id(42)}','${id(10)}','${id(20)}','${id(32)}'),('${id(43)}','${id(10)}','${id(20)}','${id(33)}'),('${id(44)}','${id(10)}','${id(20)}','${id(30)}');
  `);
  await db.exec(migration);await db.exec("SET ROLE authenticated;SET test.active='true'");
  const verify=async n=>(await db.query('SELECT import_verify_landing($1) AS result',[id(n)])).rows[0].result;
  const result=await verify(20);assert.equal(result.expected_distinct,4);assert.equal(result.landed_distinct,1);assert.equal(result.dangling,3);assert.equal(result.scope_verified,true);
  await assert.rejects(verify(21),e=>e.code==='42501');
  await db.exec("SET test.active='false'");await assert.rejects(verify(20),e=>e.code==='42501');
  await db.exec(`RESET ROLE;UPDATE import_rows SET organisation_id='${id(11)}' WHERE id='${id(44)}';SET ROLE authenticated;SET test.active='true'`);
  await assert.rejects(verify(20),e=>e.code==='42501');
  await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(verify(20),e=>e.code==='42501');
 } finally {await db.close();}
});
