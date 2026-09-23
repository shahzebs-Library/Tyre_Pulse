import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration=await readFile(new URL('../migrations/20260910184920_administration_state_and_user_guards.sql',import.meta.url),'utf8');
const baseline=await readFile(new URL('./fixtures/admin_mobile_authorization_baseline.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('reviewed staging and mobile administration reject privilege bypass and stale cleanup',async t=>{
 const db=new PGlite();
 try {
  await db.exec(`CREATE SCHEMA auth;CREATE ROLE authenticated;CREATE ROLE anon;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
   CREATE TABLE profiles(id uuid PRIMARY KEY,org_id uuid,role text,is_super_admin boolean DEFAULT false,approved boolean DEFAULT true,locked boolean DEFAULT false,updated_at timestamptz);
   INSERT INTO profiles(id,org_id,role,is_super_admin) VALUES('${id(1)}','${id(10)}','Admin',true),('${id(2)}','${id(10)}','Admin',false),('${id(3)}','${id(10)}','User',false),('${id(4)}','${id(11)}','Admin',false),('${id(5)}','${id(10)}','Admin',true);
   CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$SELECT org_id FROM profiles WHERE id=auth.uid()$$;
   CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT approved AND NOT locked FROM profiles WHERE id=auth.uid()$$;
   CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT coalesce((SELECT is_super_admin FROM profiles WHERE id=auth.uid() AND NOT locked),false)$$;
   CREATE FUNCTION access_audit_actor_email() RETURNS text LANGUAGE sql AS $$SELECT 'test@example.invalid'$$;
   CREATE TABLE access_audit(actor uuid,actor_email text,action text,target_user uuid,entity text,before jsonb,after jsonb,reason text);
   CREATE TABLE user_access_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid,user_id uuid,module_key text,capability text,effect text,granted_by uuid,note text,expires_at timestamptz,created_at timestamptz DEFAULT now(),UNIQUE(user_id,module_key,capability,effect));
   CREATE TABLE import_batches(id uuid PRIMARY KEY,organisation_id uuid,country text,module text,approval_status text DEFAULT 'draft',import_status text DEFAULT 'staged');
   CREATE TABLE import_rows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid,mapped_data jsonb,processed_at timestamptz);
   CREATE FUNCTION import_user_can_commit_country(text) RETURNS boolean LANGUAGE sql AS $$SELECT $1='KSA'$$;
   INSERT INTO import_batches VALUES('${id(20)}','${id(10)}','KSA','tyres','draft','staged'),('${id(21)}','${id(10)}','KSA','tyres','draft','committed');
  `);
  await db.exec(baseline);await db.exec(migration);
  await db.exec(`GRANT USAGE ON SCHEMA auth TO authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON import_batches,import_rows TO authenticated;SET ROLE authenticated;SET test.actor='${id(1)}';`);
  const actor=async n=>db.exec(`SET test.actor='${id(n)}'`);
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  const action=(target,kind,role=null)=>scalar('SELECT admin_mobile_user_action($1,$2,$3,$4)',[id(target),kind,'Regression check',role]);
  const denied=p=>assert.rejects(p,e=>e.code==='42501');
  await t.test('missing-profile and deactivated/locked super callers are denied',async()=>{
   await actor(99);await denied(action(3,'lock'));
   await db.exec(`RESET ROLE;UPDATE profiles SET locked=true WHERE id='${id(5)}';SET ROLE authenticated`);await actor(5);await denied(action(3,'lock'));
   await db.exec(`RESET ROLE;UPDATE profiles SET locked=false,approved=false WHERE id='${id(5)}';SET ROLE authenticated`);await denied(action(3,'lock'));await actor(1);
  });
  await t.test('user operations retain tenant/self/last-admin constraints and audit atomically',async()=>{
   await actor(2);await denied(action(4,'lock'));await denied(action(2,'deactivate'));await denied(action(3,'set_role','Admin'));
   assert.equal((await action(3,'lock')).success,true);await actor(1);
   await denied(action(4,'deactivate'));
   const definition=await scalar("SELECT pg_get_functiondef('admin_mobile_user_action(uuid,text,text,text)'::regprocedure)");
   assert.match(definition,/pg_advisory_xact_lock\(821746013\)/);assert.match(definition,/p_user_id FOR UPDATE/);
   await db.exec('RESET ROLE');assert.equal(await scalar("SELECT count(*)::int FROM access_audit WHERE entity='mobile_lock'"),1);await db.exec('SET ROLE authenticated');
  });
  const grant=(effect,key='mobile:tyres')=>scalar('SELECT set_user_access_grant($1,$2,$3,$4,$5,$6)',[id(3),key,'view',effect,'mobile',null]);
  await t.test('mobile override replaces atomically with fresh ID; stale client cleanup cannot remove new decision',async()=>{
   const first=await grant('grant');const second=await grant('revoke');assert.notEqual(first,second);
   await scalar('SELECT revoke_user_access_grant($1)',[first]);
   await db.exec('RESET ROLE');assert.equal(await scalar("SELECT count(*)::int FROM user_access_grants WHERE module_key='mobile:tyres'"),1);assert.equal(await scalar("SELECT effect FROM user_access_grants WHERE module_key='mobile:tyres'"),'revoke');await db.exec('SET ROLE authenticated');
   const third=await grant('revoke');assert.notEqual(second,third);
   const web=await grant('grant','tyres');assert.equal(await grant('grant','tyres'),web);
   await actor(5);await denied(grant('grant'));await denied(scalar('SELECT revoke_user_access_grant($1)',[third]));await actor(1);
  });
  await t.test('reviewed data/context cannot be rewritten, including finalized legacy draft history and inter-batch moves',async()=>{
   await db.exec(`INSERT INTO import_rows(id,batch_id,mapped_data) VALUES('${id(30)}','${id(20)}','{}')`);
   await denied(db.exec(`INSERT INTO import_rows(batch_id) VALUES('${id(21)}')`));
   await denied(db.exec(`UPDATE import_batches SET module='stock' WHERE id='${id(21)}'`));
   await denied(db.exec(`UPDATE import_rows SET batch_id='${id(21)}' WHERE id='${id(30)}'`));
   await db.exec(`UPDATE import_batches SET approval_status='approved' WHERE id='${id(20)}'`);
   await denied(db.exec(`INSERT INTO import_rows(batch_id) VALUES('${id(20)}')`));
   await denied(db.exec(`UPDATE import_rows SET mapped_data='{"qty":100}' WHERE id='${id(30)}'`));
   await denied(db.exec(`DELETE FROM import_rows WHERE id='${id(30)}'`));
   await denied(db.exec(`UPDATE import_batches SET module='stock' WHERE id='${id(20)}'`));
   // Definer privilege must not let an unrelated RPC rewrite reviewed data.
   await db.exec(`RESET ROLE; CREATE FUNCTION unsafe_import_process() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$UPDATE import_rows SET mapped_data='{"processed":true}' WHERE id='${id(30)}'$$; CREATE FUNCTION trusted_import_process() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$UPDATE import_rows SET processed_at=now() WHERE id='${id(30)}'$$;SET ROLE authenticated;`);
   await denied(db.exec('SELECT unsafe_import_process()'));
   await db.exec('SELECT trusted_import_process()');
   assert.ok(await scalar(`SELECT processed_at FROM import_rows WHERE id='${id(30)}'`));
  });
 } finally {await db.close();}
});
