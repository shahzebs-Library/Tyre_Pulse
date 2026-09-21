import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const sql = await readFile(new URL('../migrations/20260912110325_driver_workspace_fines_and_assignments.sql', import.meta.url), 'utf8');
const storageSql = await readFile(new URL('../migrations/20260912110823_driver_fine_private_evidence_storage.sql', import.meta.url), 'utf8');
const enterpriseSql = await readFile(new URL('../migrations/20260921134725_driver_fine_enterprise_workflows.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('driver workspace enforces ownership, historical assignment and signed case transitions', async t => {
 const db = new PGlite(); let request = 100;
 const command = async (action,payload,key=id(request++)) => (await db.query('select driver_workspace_command($1,$2,$3) r',[action,payload,key])).rows[0].r;
 const read = async driver => (await db.query('select driver_workspace($1,0) r',[driver])).rows[0].r;
 const actor = async n => db.exec(`SET test.actor='${id(n)}'`);
 try {
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
   CREATE TABLE profiles(id uuid PRIMARY KEY,org_id uuid,full_name text,approved boolean DEFAULT true,locked boolean DEFAULT false,employee_id text,role text,username text);
   CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql AS $$ SELECT org_id FROM public.profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql AS $$ SELECT approved AND NOT locked FROM public.profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION app_user_can(k text,c text) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='${id(2)}'::uuid $$;
   CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
   CREATE FUNCTION app_sees_all_countries() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
   CREATE FUNCTION app_sees_all_sites() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
   CREATE FUNCTION app_country_scope() RETURNS text[] LANGUAGE sql AS $$ SELECT ARRAY['ksa'] $$;
   CREATE FUNCTION app_site_scope() RETURNS text[] LANGUAGE sql AS $$ SELECT ARRAY['JEDDAH'] $$;
   CREATE TABLE drivers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),driver_id text,driver_name text,country text,site text,organisation_id uuid,created_by uuid,status text DEFAULT 'active',custom_data jsonb);
   CREATE TABLE vehicle_fleet(id uuid PRIMARY KEY,organisation_id uuid,asset_no text,country text,site text,registration_no text);
   CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text);
   CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
   GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
   CREATE TABLE wo_tasks(id uuid PRIMARY KEY,organisation_id uuid,assignee_user_id uuid,country text,site text,title text,status text,job_id uuid);
   CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,title text,body text,entity_type text,entity_id text);
   CREATE TABLE driver_training(id uuid PRIMARY KEY,organisation_id uuid,country text,driver_name text,course_name text,result text,notes text);
   INSERT INTO profiles(id,org_id,full_name,role) VALUES ('${id(2)}','${id(1)}','Manager','Manager'),('${id(3)}','${id(1)}','Driver A','Driver'),('${id(4)}','${id(1)}','Driver B','Driver'),('${id(5)}','${id(1)}','Supervisor','Supervisor'),('${id(6)}','${id(9)}','Other tenant','Manager'),('${id(10)}','${id(1)}','Finance Reviewer','Finance');
   INSERT INTO vehicle_fleet(id,organisation_id,asset_no,country,site) VALUES ('${id(7)}','${id(1)}','TM1','KSA','JEDDAH'),('${id(8)}','${id(9)}','OTHER','KSA','JEDDAH');
   GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT ON profiles TO authenticated;
   BEGIN; ${sql} ${storageSql} ${enterpriseSql} COMMIT; SET ROLE authenticated;
  `);
  await actor(2);
  const a = (await command('create_driver',{driver_id:'EMP1',driver_name:'Same Name',country:'KSA',site:'JEDDAH'})).driver_id;
  const b = (await command('create_driver',{driver_id:'EMP2',driver_name:'Same Name',country:'KSA',site:'JEDDAH'})).driver_id;
  await command('link_account',{driver_id:a,user_id:id(3),reason:'Verified employee identity'});
  await command('link_account',{driver_id:b,user_id:id(4),reason:'Verified employee identity'});
  await command('assign_team',{driver_id:a,supervisor_id:id(5),vehicle_id:id(7),reason:'Assigned to shift team'});
  let fine;
  await t.test('same-name drivers stay separate; supervisor only sees assigned team',async()=>{
   await actor(3); assert.deepEqual((await read(null)).drivers.map(d=>d.id),[a]);
   await assert.rejects(read(b),e=>e.code==='42501');
   await actor(5); assert.deepEqual((await read(null)).drivers.map(d=>d.id),[a]);
   await assert.rejects(command('link_account',{driver_id:a,user_id:id(5),reason:'Take ownership'}),e=>e.code==='42501');
   await actor(6); await assert.rejects(read(a),e=>e.code==='42501');
  });
  await t.test('pickers require staff access and stay within tenant',async()=>{
   await actor(3); await assert.rejects(db.query("select driver_workspace_options('users','',0)"),e=>e.code==='42501');
   await actor(2); const users=(await db.query("select driver_workspace_options('users','',0) r")).rows[0].r;
   assert.equal(users.length,5); assert.ok(!users.some(u=>u.id===id(6)));
   const vehicles=(await db.query("select driver_workspace_options('vehicles','',0) r")).rows[0].r;
   assert.deepEqual(vehicles.map(v=>v.id),[id(7)]);
  });
  await t.test('supervisor issues a fine; duplicate notice, foreign vehicle and direct writes fail',async()=>{
   await actor(5);
   const payload={driver_id:a,vehicle_id:id(7),notice_reference:'NOTICE1',authority:'Authority',incident_at:'2026-01-01T08:00:00Z',amount:500,currency:'SAR',description:'Official notice description',assignment_reason:'Confirmed shift register'};
   fine=(await command('create_fine',payload)).id;
   await assert.rejects(command('create_fine',payload),e=>e.code==='23505');
   await assert.rejects(command('create_fine',{...payload,notice_reference:'OTHER',vehicle_id:id(8)}),e=>e.code==='42501');
   await assert.rejects(db.query('update driver_fines set amount=1 where id=$1',[fine]),e=>e.code==='42501');
  });
  const signature='data:image/png;base64,'+'A'.repeat(120);
  const response={driver_id:a,fine_id:fine,version:1,acknowledged:true,statement_version:'receipt-v1',resolution:'instalments',explanation:'Request five monthly instalments of SAR 100',signature};
  await t.test('private evidence upload and reading require case access and forbid overwrite',async()=>{
   const path=`${id(1)}/${a}/${fine}/${id(220)}.png`;
   await actor(4); await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner_id) values ('driver-fine-evidence',$1,$2)",[path,id(4)]),e=>e.code==='42501');
   await actor(3); await db.query("insert into storage.objects(bucket_id,name,owner_id) values ('driver-fine-evidence',$1,$2)",[path,id(3)]);
   await command('attach_evidence',{driver_id:a,fine_id:fine,object_path:path,file_name:'receipt.png',kind:'payment'});
   assert.equal((await read(a)).fines[0].evidence.length,1);
   assert.equal((await db.query('update storage.objects set name=name returning id')).rows.length,0);
   assert.equal((await db.query('delete from storage.objects returning id')).rows.length,0);
   await actor(4); assert.equal((await db.query('select * from storage.objects')).rows.length,0);
   await actor(5);
  });
  await t.test('only owner signs; statement and signature required; retry is exactly once',async()=>{
   await assert.rejects(command('respond_fine',response),e=>e.code==='42501');
   await actor(4); await assert.rejects(command('respond_fine',response),e=>e.code==='42501');
   await actor(3);
   await assert.rejects(command('respond_fine',{...response,acknowledged:false}),e=>e.code==='22023');
   await assert.rejects(command('respond_fine',{...response,signature:'<svg><script>alert(1)</script></svg>'}),e=>e.code==='22023');
   const key=id(200); const r=await command('respond_fine',response,key);
   assert.deepEqual(await command('respond_fine',response,key),r);
   await assert.rejects(command('respond_fine',{...response,explanation:'Changed'},key),e=>e.code==='22023');
   const data=await read(a); assert.equal(data.fines[0].responses.length,1); assert.equal(data.fines[0].paid_amount,0); assert.equal(data.fines[0].status,'open');
   assert.equal(data.fines[0].responses[0].notice_snapshot.amount,500);
   await assert.rejects(command('review_fine',{driver_id:a,fine_id:fine,version:2,decision:'approve',reason:'Self approval'}),e=>e.code==='42501');
  });
  await t.test('supervisor and finance approvals are separate; only finance records payment',async()=>{
   await actor(5);
   await command('review_fine',{driver_id:a,fine_id:fine,version:2,decision:'approve',reason:'Arrangement reviewed'});
   assert.equal((await read(a)).fines[0].review_stage,'finance');
   await assert.rejects(command('review_fine',{driver_id:a,fine_id:fine,version:3,decision:'payment',reason:'Supervisor payment',payment_reference:'NO',payment_amount:100}),e=>e.code==='22023');
   await actor(10);
   await command('review_fine',{driver_id:a,fine_id:fine,version:3,decision:'approve',reason:'Finance approved arrangement'});
   assert.equal((await read(a)).fines[0].response_status,'approved');
   await assert.rejects(command('review_fine',{driver_id:a,fine_id:fine,version:3,decision:'payment',reason:'Old update'}),e=>e.code==='40001');
   await command('review_fine',{driver_id:a,fine_id:fine,version:4,decision:'payment',reason:'Verified receipt',payment_reference:'PAY1',payment_amount:100});
   assert.equal((await read(a)).balances[0].outstanding,400);
   await assert.rejects(command('review_fine',{driver_id:a,fine_id:fine,version:5,decision:'payment',reason:'Overpayment',payment_reference:'PAY2',payment_amount:500}),e=>e.code==='22023');
   await command('review_fine',{driver_id:a,fine_id:fine,version:5,decision:'payment',reason:'Verified final receipt',payment_reference:'PAY2',payment_amount:400});
   assert.equal((await read(a)).fines[0].status,'settled');
   assert.deepEqual((await read(a)).fines[0].reviews.map(r=>r.stage),['supervisor','finance','finance','finance']);
  });
  await t.test('signed corrections require acknowledgment again and reassignment preserves the old case',async()=>{
   await actor(5);
   const payload={driver_id:a,vehicle_id:id(7),notice_reference:'NOTICE2',authority:'Authority',incident_at:'2026-01-02T08:00:00Z',amount:300,currency:'SAR',description:'Second official notice',assignment_reason:'Initial assignment evidence'};
   const second=(await command('create_fine',payload)).id;
   await actor(3); await command('respond_fine',{...response,fine_id:second,version:1,resolution:'dispute',explanation:'I was not assigned to this vehicle'});
   await actor(2); await command('correct_fine',{driver_id:a,fine_id:second,version:2,amount:350,reason:'Authority issued a corrected amount'});
   let corrected=(await read(a)).fines.find(x=>x.id===second);
   assert.equal(corrected.amount,350); assert.equal(corrected.response_status,'awaiting_response'); assert.equal(corrected.review_stage,'driver'); assert.equal(corrected.responses.length,1);
   await actor(3); await command('respond_fine',{...response,fine_id:second,version:3,resolution:'dispute',explanation:'Corrected notice still belongs to another driver'});
   await actor(2); const replacement=await command('reassign_fine',{driver_id:a,fine_id:second,version:4,target_driver_id:b,vehicle_id:id(7),reason:'Shift register confirms Driver B'});
   const oldCase=(await read(a)).fines.find(x=>x.id===second); assert.equal(oldCase.status,'cancelled'); assert.equal(oldCase.superseded_by_fine_id,replacement.id);
   const newCase=(await read(b)).fines.find(x=>x.id===replacement.id); assert.equal(newCase.status,'open'); assert.equal(newCase.review_stage,'driver'); assert.equal(newCase.responses.length,0); assert.equal(newCase.supersedes_fine_id,second);
  });
  await t.test('reminders are idempotent and the scoped staff register exposes workflow queues',async()=>{
   const due=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
   await actor(5); await command('create_fine',{driver_id:a,vehicle_id:id(7),notice_reference:'NOTICE3',authority:'Authority',incident_at:'2026-01-03T08:00:00Z',due_date:due,amount:200,currency:'SAR',description:'Reminder test notice',assignment_reason:'Confirmed shift register'});
   await actor(2); const first=(await db.query('select driver_workspace_run_reminders() r')).rows[0].r; assert.ok(first.sent>=1);
   const again=(await db.query('select driver_workspace_run_reminders() r')).rows[0].r; assert.equal(again.sent,0);
   await actor(10); const register=(await db.query("select driver_fine_register('{\"review_stage\":\"driver\"}',0) r")).rows[0].r;
   assert.ok(register.rows.some(row=>row.notice_reference==='NOTICE3')); assert.ok(register.rows.every(row=>row.review_stage==='driver'));
  });
  await t.test('team reassignment removes old access and preserves dated history',async()=>{
   await actor(2); await command('assign_team',{driver_id:a,vehicle_id:id(7),reason:'Supervisor released'});
   const data=await read(a); assert.equal(data.assignments.length,2); assert.equal(data.assignments.filter(x=>x.ends_at===null).length,1);
   await actor(5); await assert.rejects(read(a),e=>e.code==='42501');
  });
  await t.test('record links require explicit identity verification and exclude internal fields',async()=>{
   await db.exec(`RESET ROLE; INSERT INTO driver_training VALUES ('${id(30)}','${id(1)}','KSA','Same Name','Road safety','pass','Private staff notes'); SET ROLE authenticated;`);
   await actor(2); await command('link_record',{driver_id:a,source_type:'driver_training',source_id:id(30),reason:'Matched employee record'});
   await assert.rejects(command('link_record',{driver_id:b,source_type:'driver_training',source_id:id(30),reason:'Duplicate claim'}),e=>e.code==='23505');
   await actor(3); const row=(await read(a)).records[0].record; assert.equal(row.course_name,'Road safety'); assert.equal(row.notes,undefined);
  });
  await t.test('locked and anonymous accounts cannot read or replay writes',async()=>{
   await db.exec(`RESET ROLE; UPDATE profiles SET locked=true WHERE id='${id(3)}'; SET ROLE authenticated;`);
   await assert.rejects(read(a),e=>e.code==='42501');
   await db.exec("SET test.actor=''"); await assert.rejects(read(null),e=>e.code==='42501');
  });
 } finally { await db.close(); }
});
