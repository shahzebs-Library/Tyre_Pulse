import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration = await readFile(new URL('../migrations/20260910200001_atomic_expense_imports.sql', import.meta.url), 'utf8');
const org='00000000-0000-0000-0000-000000000001';
const actor='00000000-0000-0000-0000-000000000002';
const id='00000000-0000-0000-0000-000000000003';
const fields=['issue_number','work_order_no','txn_date','asset_code','asset_description','asset_type','store_code','cost_center','item_code','qty','item_description','value_amount','spare_parts_amount','tyre_amount','oil_amount','total_amount','source_row'];
test('expense staging, replacement, retries and authorization', async t=>{
 const db=new PGlite();
 try {
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${actor}'::uuid $$;
 CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.org')::uuid $$;
 CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.active')::boolean $$;
 CREATE FUNCTION app_is_elevated() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.admin')::boolean $$;
 CREATE FUNCTION app_can_admin_delete() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.admin')::boolean $$;
 CREATE FUNCTION app_write_country_ok(text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='KSA' $$;
 SET test.org='${org}'; SET test.active='true'; SET test.admin='true';
 CREATE TABLE parts_consumption(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,country text,${fields.map(f=>f+' text').join(',')}, CHECK(value_amount IS DISTINCT FROM 'INVALID'));
 INSERT INTO parts_consumption(organisation_id,country,item_description,value_amount) VALUES('${org}','KSA','Original','10'),('${org}','UAE','Other country','20'),('00000000-0000-0000-0000-000000000009','KSA','Other org','30');
 ${migration}
 SET ROLE authenticated;`);
 const begin=(key=id,replace=true,count=1)=>db.query('SELECT begin_expense_import($1,$2,$3,1,$4) r',[key,'KSA',replace,count]);
 const stage=(rows,key=id)=>db.query('SELECT stage_expense_import($1,0,$2::jsonb) r',[key,JSON.stringify(rows)]);
 const commit=(key=id)=>db.query('SELECT commit_expense_import($1) r',[key]);
 await t.test('empty or wrong count replacement is refused',async()=>{
  await assert.rejects(begin(id,true,9),e=>e.code==='40001');
 });
 await begin();
 await t.test('incomplete staging never clears originals',async()=>{
  await assert.rejects(commit(),e=>e.code==='22023');
 });
 const rows=[{item_description:'Replacement',country:'KSA',value_amount:'12'}];
 await t.test('cross-country row and altered chunk retry rejected',async()=>{
  await assert.rejects(stage([{...rows[0],country:'UAE'}]),e=>e.code==='22023');
  await stage(rows); await stage(rows);
  await assert.rejects(stage([{...rows[0],value_amount:'13'}]),e=>e.code==='22023');
 });
 await t.test('commit and retry return same receipt with one import',async()=>{
  const first=(await commit()).rows[0].r;
  assert.equal(first.inserted,1); assert.equal(first.replaced,1);
  assert.deepEqual((await commit()).rows[0].r,first);
  await db.exec('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int n FROM parts_consumption')).rows[0].n,3);
  assert.equal((await db.query('SELECT row_data->>\'item_description\' description FROM administration_imports.expense_archive')).rows[0].description,'Original');
  assert.equal((await db.query("SELECT count(*)::int n FROM parts_consumption WHERE item_description IN ('Other country','Other org')")).rows[0].n,2);
  await db.exec('SET ROLE authenticated');
 });
 const failed='00000000-0000-0000-0000-000000000004';
 await t.test('destination constraint failure rolls back deletion and archive',async()=>{
  await begin(failed);await stage([{...rows[0],value_amount:'INVALID'}],failed);
  await assert.rejects(commit(failed),e=>e.code==='23514');
  await db.exec('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int n FROM parts_consumption')).rows[0].n,3);
  assert.equal((await db.query('SELECT count(*)::int n FROM administration_imports.expense_archive WHERE batch_id=$1',[failed])).rows[0].n,0);
  await db.exec('SET ROLE authenticated');
 });
 const stale='00000000-0000-0000-0000-000000000005';
 await t.test('same-count concurrent edits reject replacement',async()=>{
  await begin(stale); await stage(rows,stale);
  await db.exec(`RESET ROLE; UPDATE parts_consumption SET value_amount='99' WHERE organisation_id='${org}' AND country='KSA'; SET ROLE authenticated;`);
  await assert.rejects(commit(stale),e=>e.code==='40001');
 });
 await t.test('inactive/non-admin actors and another tenant cannot replay',async()=>{
  await db.exec("SET test.active='false'");await assert.rejects(commit(),e=>e.code==='42501');
  await db.exec("SET test.active='true'; SET test.admin='false'");await assert.rejects(begin(),e=>e.code==='42501');
  await db.exec("SET test.admin='true'; SET test.org='00000000-0000-0000-0000-000000000009'");await assert.rejects(commit(),e=>e.code==='42501');
 });
 await t.test('clients cannot mutate receipts or call functions anonymously',async()=>{
  await assert.rejects(db.query('SELECT * FROM administration_imports.expense_batches'),e=>e.code==='42501');
  await db.exec('RESET ROLE; SET ROLE anon');await assert.rejects(commit(),e=>e.code==='42501');
 });
 } finally {await db.close();}
});
