import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
const migration = await readFile(new URL('../migrations/20261018120550_stock_quick_entry.sql', import.meta.url), 'utf8')
const searchMigration = await readFile(new URL('../migrations/20261018130608_stock_lookup_search_indexes.sql', import.meta.url), 'utf8')
const uuidMigration = await readFile(new URL('../migrations/20261018130855_stock_lookup_uuid_identity.sql', import.meta.url), 'utf8')
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`

test('stock quick entry: source scope, atomic counts, receipts, concurrency and permissions', async t => {
 const db = new PGlite()
 const sql = async (query, args=[]) => (await db.query(query,args)).rows
 try {
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE authenticated; CREATE ROLE anon;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
   CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql AS $$SELECT '${id(10)}'::uuid$$;
   CREATE FUNCTION is_approved_and_unlocked() RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('test.active',true)='yes'$$;
   CREATE FUNCTION app_user_can(m text,c text) RETURNS boolean LANGUAGE sql AS $$SELECT nullif(current_setting('test.cap_'||c,true),'null')='yes'$$;
   CREATE FUNCTION app_write_country_ok(c text) RETURNS boolean LANGUAGE sql AS $$SELECT c='KSA'$$;
   CREATE FUNCTION app_sees_all_sites() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
   CREATE FUNCTION app_site_scope() RETURNS text[] LANGUAGE sql AS $$SELECT ARRAY['SITE-A','SITE-B']$$;
   CREATE TABLE organisations(id uuid PRIMARY KEY); INSERT INTO organisations VALUES('${id(10)}'),('${id(11)}');
   CREATE TABLE profiles(id uuid PRIMARY KEY); INSERT INTO profiles VALUES('${id(1)}'),('${id(2)}');
   CREATE TABLE stock_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,country text,region text,site text,description text,brand text,tyre_size text,stock_qty integer,min_level integer DEFAULT 0,critical_level integer DEFAULT 0,stock_status text,custom_data jsonb,updated_by uuid,updated_at timestamptz DEFAULT now(),last_counted_at timestamptz);
   CREATE TABLE stock_movements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),stock_id uuid,site text,description text,movement_type text CHECK(movement_type IN ('stocktake','receipt','transfer_in','transfer_out')),qty_before integer,qty_change integer,qty_after integer,reason text,reference_no text,created_by uuid,organisation_id uuid);
   CREATE TABLE material_master(id uuid PRIMARY KEY,organisation_id uuid,country text,item_code text,item_name text,category text,brand text,uom text,reviewed boolean);
   CREATE TABLE parts_consumption(id uuid PRIMARY KEY,organisation_id uuid,country text,item_code text,item_description text,issue_number text,txn_date date,cost_center text,store_code text,site text,brand text,uom text);
   CREATE TABLE tyre_records(id uuid PRIMARY KEY,organisation_id uuid,country text,site text,description text,brand text,size text,job_card text,mis_number text,issue_date date,qty integer);
   CREATE TABLE workflow_instances(id uuid DEFAULT gen_random_uuid(),organisation_id uuid,entity_type text,entity_id text,status text);
   CREATE TABLE audits(id uuid DEFAULT gen_random_uuid(),event text,entity text,entity_id text,before_data jsonb,after_data jsonb);
   CREATE FUNCTION record_audit_event(e text,t text,i text,b jsonb,a jsonb) RETURNS void LANGUAGE sql AS $$INSERT INTO audits(event,entity,entity_id,before_data,after_data) VALUES(e,t,i,b,a)$$;
   INSERT INTO material_master VALUES('${id(20)}','${id(10)}','KSA','TY-01','315/80 R22.5 Triangle tyre','tyre','Triangle','PCS',true),('${id(21)}','${id(10)}','UAE','OTHER','315/80 R22.5 tyre','tyre','Triangle','PCS',true),('${id(22)}','${id(11)}','KSA','FOREIGN','315/80 R22.5 tyre','tyre','Triangle','PCS',true);
   INSERT INTO parts_consumption(id,organisation_id,country,item_code,item_description,issue_number,txn_date,cost_center,store_code) VALUES('${id(41)}', '${id(10)}','KSA','RIM-01','22.5 x 8.25 steel rim','MIS-1',CURRENT_DATE,'SITE-A','STORE-A'),('${id(42)}', '${id(10)}','KSA','F-01','Oil filter','MIS-2',CURRENT_DATE,'SITE-A','STORE-A'),('${id(43)}', '${id(10)}','KSA','HIDDEN','22.5 steel rim','MIS-3',CURRENT_DATE,'SITE-C','STORE-C');
   INSERT INTO tyre_records VALUES('${id(30)}','${id(10)}','KSA','SITE-A','12.00 R24 Techking tyre','Techking','12.00 R24','DTR-1','MIS-4',CURRENT_DATE,99),('${id(31)}','${id(10)}','KSA','SITE-C','12.00 R24 tyre','Techking','12.00 R24','DTR-X','MIS-X',CURRENT_DATE,88);`)
  await db.exec(migration)
  await db.exec(searchMigration)
  await db.exec(uuidMigration)
  await db.exec(`SET test.actor='${id(1)}'; SET test.active='yes'; SET test.cap_view='yes'; SET test.cap_create='yes'; SET test.cap_edit='yes';`)
  const reset = async () => db.exec(`TRUNCATE stock_records,stock_movements,stock_entry_requests,workflow_instances,audits; SET test.actor='${id(1)}'; SET test.active='yes'; SET test.cap_view='yes'; SET test.cap_create='yes'; SET test.cap_edit='yes';`)
  const save = async (lines, {requestId=id(100),site='SITE-A',country='KSA',mode='count',reference='',notes=''}={}) => (await sql('SELECT save_stock_entry($1,$2,$3,$4,$5,$6,$7::jsonb) AS result',[requestId,country,site,mode,reference,notes,JSON.stringify(lines)]))[0].result
  const tyre = {source:'material',source_id:id(20),name:'FORGED NAME',code:'FORGED',kind:'tyre',quantity:36,unit:'PCS',condition:'New',bin:'A1'}
  const rim = {source:'mis',source_id:id(41),quantity:6,unit:'PCS',condition:'Serviceable',bin:'B1'}
  const existing = async (record,quantity) => ({stock_id:record.id,quantity,unit:'PCS',expected_qty:record.stock_qty,expected_updated_at:record.updated_at.toISOString()})

  await t.test('lookup exposes only tyre/rim identity within org, country and permitted source sites', async () => {
   const found=(await sql("SELECT stock_item_suggestions('KSA','SITE-A','315') AS items"))[0].items
   assert.equal(found.length,1); assert.equal(found[0].code,'TY-01'); assert.equal(found[0].label,'MIS / ERP catalogue')
   assert.deepEqual((await sql("SELECT stock_item_suggestions('KSA','SITE-A','filter') AS items"))[0].items,[])
   assert.equal((await sql("SELECT stock_item_suggestions('KSA','SITE-A','rim') AS items"))[0].items.length,1)
   await assert.rejects(sql("SELECT stock_item_suggestions('UAE','SITE-A','315')"),e=>e.code==='42501')
   await assert.rejects(sql("SELECT stock_item_suggestions('KSA','SITE-C','315')"),e=>e.code==='42501')
  })
  await t.test('search indexes exclude unrelated ERP items and lookup uses typed primary keys', async () => {
   const indexes=await sql("SELECT indexname,indexdef FROM pg_indexes WHERE indexname LIKE '%stock_lookup_idx'")
   assert.equal(indexes.length,3)
   assert.match(indexes.find(x=>x.indexname==='parts_consumption_stock_lookup_idx').indexdef,/stock_item_kind/)
   assert.match(uuidMigration,/m\.id=p_id::uuid/)
   assert.match(searchMigration,/t\.id=p_id::uuid/)
   assert.equal((await sql("SELECT stock_item_suggestions('KSA','SITE-A','315 / 80 r22.5') AS items"))[0].items.length,1)
  })
  await t.test('count sets final on hand, retains source identity and audits every line atomically', async () => {
   await reset(); await save([tyre,rim]); let rows=await sql('SELECT * FROM stock_records ORDER BY description')
   assert.equal(rows.length,2); assert.equal(rows.find(r=>r.brand==='Triangle').stock_qty,36)
   assert.equal(rows.find(r=>r.brand==='Triangle').description,'315/80 R22.5 Triangle tyre')
   assert.equal(rows.find(r=>r.brand==='Triangle').custom_data.stock_item.code,'TY-01')
   const line=rows.find(r=>r.brand==='Triangle'); const result=await save([await existing(line,24)],{requestId:id(101)})
   assert.equal(result.items[0].qty_before,36); assert.equal(result.items[0].qty_after,24); assert.equal(result.items[0].qty_change,-12)
   assert.equal((await sql('SELECT * FROM stock_movements')).length,3); assert.equal((await sql('SELECT * FROM audits')).length,3)
  })
  await t.test('DTR fills details but its issued quantity never becomes the opening balance', async () => {
   await reset(); await save([{source:'dtr',source_id:id(30),quantity:3,unit:'PCS',condition:'New',bin:''}])
   const row=(await sql('SELECT * FROM stock_records'))[0]; assert.equal(row.stock_qty,3); assert.equal(row.brand,'Techking'); assert.equal(row.custom_data.stock_item.code,'')
   await assert.rejects(save([{source:'dtr',source_id:id(31),quantity:4,unit:'PCS',condition:'New',bin:''}],{requestId:id(101)}),e=>e.code==='42501')
  })
  await t.test('receipt retries are idempotent and changed payloads cannot reuse the identifier', async () => {
   await reset(); const result=await save([tyre],{mode:'receipt',reference:'GRN-1'}); const replay=await save([tyre],{mode:'receipt',reference:'GRN-1'})
   assert.equal(replay.replayed,true); assert.equal(replay.items[0].stock_id,result.items[0].stock_id); assert.equal((await sql('SELECT * FROM stock_movements')).length,1)
   await assert.rejects(save([{...tyre,quantity:37}],{mode:'receipt',reference:'GRN-1'}),e=>e.code==='23505')
   await assert.rejects(save([tyre],{mode:'receipt',requestId:id(102)}),e=>e.code==='22023')
  })
  await t.test('a bad second line rolls back stock, requests, audit and movements', async () => {
   await reset(); await assert.rejects(save([tyre,{...rim,source_id:id(999)}]))
   for(const table of ['stock_records','stock_movements','audits','stock_entry_requests']) assert.equal((await sql(`SELECT * FROM ${table}`)).length,0)
  })
  await t.test('stale balances, duplicates, locked workflows and cross-scope ids cannot post', async () => {
   await reset(); await save([tyre]); const row=(await sql('SELECT * FROM stock_records'))[0]; const draft=await existing(row,40)
   await sql('UPDATE stock_records SET stock_qty=30 WHERE id=$1',[row.id]); await assert.rejects(save([draft],{requestId:id(101)}),e=>e.code==='40001')
   await assert.rejects(save([tyre],{requestId:id(102)}),e=>e.code==='23505')
   row.stock_qty=30; const current=await existing(row,40)
   await sql("INSERT INTO workflow_instances(organisation_id,entity_type,entity_id,status) VALUES($1,'stock_issue',$2,'pending')",[id(10),row.id])
   await assert.rejects(save([current],{requestId:id(103)}),e=>e.code==='PT423')
   await assert.rejects(save([current],{site:'SITE-B',requestId:id(104)}),e=>e.code==='42501')
   assert.equal((await sql('SELECT stock_qty FROM stock_records'))[0].stock_qty,30)
  })
  await t.test('create/edit capabilities, active user, whole quantities and source eligibility are enforced', async () => {
   await reset(); await db.exec("SET test.cap_create='no'"); await assert.rejects(save([tyre]),e=>e.code==='42501')
   await db.exec("SET test.cap_create='yes'"); await assert.rejects(save([{...tyre,quantity:1.5}]),e=>e.code==='22023')
   await assert.rejects(save([{...tyre,unit:''}]),e=>e.code==='22023')
   await assert.rejects(save([{source:'mis',source_id:id(42),quantity:1,unit:'PCS',condition:'New',bin:''}]),e=>e.code==='42501')
   await assert.rejects(save([{...tyre,source:'manual',name:'Oil filter',kind:'tyre'}]),e=>e.code==='22023')
   await save([tyre]); const row=(await sql('SELECT * FROM stock_records'))[0]
   await db.exec("SET test.cap_edit='no'"); await assert.rejects(save([await existing(row,22)],{requestId:id(101)}),e=>e.code==='42501')
   await db.exec("SET test.cap_view='null'"); await assert.rejects(save([tyre],{requestId:id(102)}),e=>e.code==='42501')
   await db.exec("SET test.cap_view='yes'; SET test.active='no'"); await assert.rejects(save([tyre],{requestId:id(102)}),e=>e.code==='42501')
  })
  await t.test('transfers name both matching items and post both legs exactly once', async () => {
   await reset(); await save([tyre]); await save([{...tyre,quantity:10}],{requestId:id(101),site:'SITE-B'})
   const records=await sql('SELECT * FROM stock_records ORDER BY site'); const [from,to]=records
   const transfer=async (requestId=id(102),target=to.id,quantity=4) => (await sql('SELECT transfer_stock_entry($1,$2,$3,$4,$5,$6,$7) AS result',[requestId,from.id,target,quantity,36,10,'Delivery to Site B']))[0].result
   await transfer(); await transfer();
   assert.deepEqual((await sql('SELECT stock_qty FROM stock_records ORDER BY site')).map(r=>r.stock_qty),[32,14])
   assert.equal((await sql("SELECT * FROM stock_movements WHERE movement_type LIKE 'transfer_%'")).length,2)
   await save([rim],{requestId:id(103),site:'SITE-B'}); const wrong=(await sql("SELECT * FROM stock_records WHERE description LIKE '%rim%'"))[0]
   await assert.rejects(transfer(id(104),wrong.id),e=>e.code==='22023')
   assert.equal((await sql('SELECT stock_qty FROM stock_records WHERE id=$1',[from.id]))[0].stock_qty,32)
  })
  await t.test('request records have no direct write access and reads retain tenant/site scope', async () => {
   await reset(); await save([tyre]); await db.exec('SET ROLE authenticated')
   assert.equal((await sql('SELECT * FROM stock_entry_requests')).length,1)
   await assert.rejects(sql('DELETE FROM stock_entry_requests'),e=>e.code==='42501')
   await assert.rejects(sql("INSERT INTO stock_entry_requests(id) VALUES(gen_random_uuid())"),e=>e.code==='42501')
   await assert.rejects(sql("SELECT stock_entry_resolve('material',$1,'KSA','SITE-A')",[id(20)]),e=>e.code==='42501')
   await db.exec("SET test.cap_view='no'"); assert.equal((await sql('SELECT * FROM stock_entry_requests')).length,0)
   await db.exec('RESET ROLE')
  })
 } finally { await db.close() }
})
