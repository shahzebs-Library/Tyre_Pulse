import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../migrations/20261025153000_enforce_approve_capability.sql', import.meta.url), 'utf8');
const baseline = await readFile(new URL('./fixtures/approval_legacy_baseline.sql', import.meta.url), 'utf8');
const gates = await readFile(new URL('../migrations/20260910185625_approval_pre_execution_gates.sql', import.meta.url), 'utf8');
const v242 = await readFile(new URL('../../MIGRATIONS_V242.sql', import.meta.url), 'utf8');
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const org = uuid(1);
const U = { admin: uuid(2), insp: uuid(3), insp2: uuid(4), granted: uuid(5), sub: uuid(6), revoked: uuid(7), plain: uuid(8) };

// execution_decide copied verbatim from the real migration (one statement).
const execDecide = gates.match(/CREATE FUNCTION approval_private\.execution_decide[\s\S]*?END \$\$;/)[0];
const SIGS = `ARRAY['decide_checklist_approval(uuid,text,text,text)','decide_inspection_approval(uuid,text,text,text)','approval_private.execution_decide(text,uuid,text,text,text)','approve_accident_closure(uuid)','reject_accident_closure(uuid,text)']`;

async function setup() {
  const db = new PGlite();
  await db.exec(`
   CREATE SCHEMA auth; CREATE SCHEMA approval_private; CREATE ROLE authenticated; CREATE ROLE anon;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
   CREATE TABLE profiles(id uuid PRIMARY KEY,org_id uuid,organisation_id uuid,role text,approved boolean DEFAULT true,locked boolean DEFAULT false,
    full_name text,username text,email text,is_super_admin boolean DEFAULT false);
   CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT org_id FROM profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT role FROM profiles WHERE id=auth.uid() AND approved AND NOT locked $$;
   CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
   CREATE FUNCTION checklist_is_supervisor() RETURNS boolean LANGUAGE sql AS $$ SELECT get_my_role()=ANY(ARRAY['Admin','Maintenance Supervisor','PMV Manager']) $$;
   CREATE FUNCTION checklist_is_area_manager() RETURNS boolean LANGUAGE sql AS $$ SELECT get_my_role()=ANY(ARRAY['Admin','PMV Manager']) $$;
   CREATE TABLE user_access_grants(user_id uuid,module_key text,capability text,effect text,expires_at timestamptz);
   CREATE TABLE checklist_templates(id uuid PRIMARY KEY,require_area_manager boolean DEFAULT false,option_sets jsonb,fields jsonb,name text);
   CREATE TABLE checklist_submissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,template_id uuid,template_name text,country text,site text,
    asset_no text,title text,approval_status text DEFAULT 'pending',status text DEFAULT 'submitted',answers jsonb,photos jsonb,signature_data text,
    submitted_by uuid,submitted_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
    supervisor_by uuid,supervisor_name text,supervisor_signature text,supervisor_at timestamptz,
    approved_by uuid,approver_name text,approver_signature text,approved_at timestamptz,review_note text,locked boolean DEFAULT false);
   CREATE TABLE inspections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,country text,site text,asset_no text,title text,
    findings text,created_by uuid,created_at timestamptz DEFAULT now(),approval_status text DEFAULT 'pending_approval',status text DEFAULT 'In Progress',
    approved_by uuid,approver_email text,approver_signature text,approved_at timestamptz,locked boolean DEFAULT false,locked_at timestamptz);
   CREATE TABLE inspection_audit_log(id bigint GENERATED ALWAYS AS IDENTITY,inspection_id uuid,changed_by uuid,action text,new_values jsonb);
   CREATE TABLE approval_execution_requests(id uuid PRIMARY KEY,entity_type text,organisation_id uuid,approval_status text,approved_by uuid,approved_at timestamptz,
    approver_signature text,approver_name text,review_note text);
   INSERT INTO profiles(id,org_id,role,full_name) VALUES
    ('${U.admin}','${org}','Admin','Admin'),('${U.insp}','${org}','PMV Manager','Approver'),('${U.insp2}','${org}','PMV Manager','Approver Two'),
    ('${U.granted}','${org}','Reporter','Granted'),('${U.sub}','${org}','Tyre Data Collector','Submitter'),
    ('${U.revoked}','${org}','PMV Manager','Revoked'),('${U.plain}','${org}','Reporter','Plain');
  `);
  await db.exec(baseline);
  // Real V242 helper.
  await db.exec(v242.match(/CREATE OR REPLACE FUNCTION public\.app_cap_revoked[\s\S]*?\$\$;/)[0]);
  await db.exec(execDecide);
  // Stand-ins with the same shape (DECLARE/BEGIN body) as the accident closure writers.
  await db.exec(`
   CREATE FUNCTION public.approve_accident_closure(p_accident_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
   DECLARE v int;
   BEGIN
     PERFORM 1;
   END;
   $f$;
   CREATE FUNCTION public.reject_accident_closure(p_accident_id uuid, p_reason text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
   BEGIN
     PERFORM 1;
   END;
   $f$;`);
  await db.exec(migration);
  await db.exec(`GRANT USAGE ON SCHEMA auth,approval_private TO authenticated;
   GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
   GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA approval_private TO authenticated;`);
  return db;
}

test('approve capability: revoke blocks, normal approver unaffected, grant adds', async t => {
  const db = await setup();
  try {
    const as = id => db.exec(`RESET ROLE; SET test.actor='${id}'; SET ROLE authenticated;`);
    const call = sql => db.query(sql);
    const defs = async () => (await call(`SELECT pg_get_functiondef(to_regprocedure(x)) d FROM unnest(${SIGS}) x`)).rows.map(r => r.d);
    await db.exec(`
      INSERT INTO checklist_templates VALUES('${uuid(20)}',false,'{}','[]','Safety');
      INSERT INTO checklist_submissions(id,organisation_id,template_id,approval_status) VALUES
       ('${uuid(30)}','${org}','${uuid(20)}','pending'),('${uuid(31)}','${org}','${uuid(20)}','pending'),('${uuid(32)}','${org}','${uuid(20)}','pending'),('${uuid(33)}','${org}','${uuid(20)}','pending');
      INSERT INTO inspections(id,organisation_id,approval_status) VALUES
       ('${uuid(40)}','${org}','pending_approval'),('${uuid(41)}','${org}','pending_approval'),('${uuid(42)}','${org}','pending_approval'),('${uuid(43)}','${org}','pending_approval');
      INSERT INTO approval_execution_requests VALUES('${uuid(50)}','work_order','${org}','pending',null,null,null,null,null),
       ('${uuid(51)}','work_order','${org}','pending',null,null,null,null,null);
      INSERT INTO user_access_grants VALUES
       ('${U.revoked}','checklists','approve','revoke',null),('${U.revoked}','inspections','approve','revoke',null),('${U.revoked}','work_orders','approve','revoke',null),
       ('${U.revoked}','accidents','approve','revoke',null),
       ('${U.granted}','checklists','approve','grant',null),('${U.granted}','inspections','approve','grant',null);`);

    await t.test('guard marker placed in every patched function; migration idempotent', async () => {
      const before = await defs();
      for (const d of before) assert.match(d, /cap-guard:approve/);
      await db.exec(migration);
      assert.deepEqual(await defs(), before);
    });

    await t.test('normal approver (no revoke) still approves checklist, inspection, execution', async () => {
      await as(U.insp);
      assert.equal((await call(`SELECT decide_checklist_approval('${uuid(30)}','approved','ok','sig') r`)).rows[0].r.ok, true);
      assert.equal((await call(`SELECT decide_inspection_approval('${uuid(40)}','approved','ok','sig') r`)).rows[0].r.ok, true);
      assert.equal((await call(`SELECT approval_private.execution_decide('work_order','${uuid(50)}','approved',null,'sig') r`)).rows[0].r.ok, true);
      await call(`SELECT approve_accident_closure('${uuid(60)}')`);
    });

    await t.test('revoked approver is blocked on every writer with 42501 and nothing changes', async () => {
      await as(U.revoked);
      for (const sql of [
        `SELECT decide_checklist_approval('${uuid(31)}','approved','x','sig')`,
        `SELECT decide_inspection_approval('${uuid(41)}','approved','x','sig')`,
        `SELECT approval_private.execution_decide('work_order','${uuid(51)}','approved',null,'sig')`,
        `SELECT approve_accident_closure('${uuid(60)}')`,
        `SELECT reject_accident_closure('${uuid(60)}','no')`,
      ]) await assert.rejects(call(sql), e => e.code === '42501', sql);
      await db.exec('RESET ROLE');
      assert.equal((await call(`SELECT approval_status s FROM checklist_submissions WHERE id='${uuid(31)}'`)).rows[0].s, 'pending');
      assert.equal((await call(`SELECT approval_status s FROM inspections WHERE id='${uuid(41)}'`)).rows[0].s, 'pending_approval');
    });

    await t.test('a revoke on one module does not block another module', async () => {
      await db.exec(`RESET ROLE; DELETE FROM user_access_grants WHERE user_id='${U.revoked}' AND module_key<>'checklists'`);
      await as(U.revoked);
      assert.equal((await call(`SELECT decide_inspection_approval('${uuid(42)}','approved','ok','sig') r`)).rows[0].r.ok, true);
      await assert.rejects(call(`SELECT decide_checklist_approval('${uuid(32)}','approved','x','sig')`), e => e.code === '42501');
    });

    await t.test('user outside the role gate is refused without a grant and allowed with one', async () => {
      await as(U.plain);
      await assert.rejects(call(`SELECT decide_inspection_approval('${uuid(43)}','approved','x','sig')`), /Only an area manager/);
      await assert.rejects(call(`SELECT decide_checklist_approval('${uuid(33)}','approved','x','sig')`), /Only an approver/);
      await as(U.granted);
      assert.equal((await call(`SELECT decide_inspection_approval('${uuid(43)}','approved','ok','sig') r`)).rows[0].r.ok, true);
      assert.equal((await call(`SELECT decide_checklist_approval('${uuid(33)}','approved','ok','sig') r`)).rows[0].r.ok, true);
    });

    await t.test('an expired revoke does not block; a revoke beats a grant', async () => {
      await db.exec(`RESET ROLE; DELETE FROM user_access_grants WHERE user_id='${U.insp2}';
        INSERT INTO user_access_grants VALUES('${U.insp2}','checklists','approve','revoke', now() - interval '1 day');
        INSERT INTO checklist_submissions(id,organisation_id,template_id,approval_status) VALUES('${uuid(34)}','${org}','${uuid(20)}','pending');`);
      await as(U.insp2);
      assert.equal((await call(`SELECT decide_checklist_approval('${uuid(34)}','approved','ok','sig') r`)).rows[0].r.ok, true);
      await db.exec(`RESET ROLE; INSERT INTO user_access_grants VALUES('${U.granted}','checklists','approve','revoke',null);
        INSERT INTO checklist_submissions(id,organisation_id,template_id,approval_status) VALUES('${uuid(35)}','${org}','${uuid(20)}','pending');`);
      await as(U.granted);
      await assert.rejects(call(`SELECT decide_checklist_approval('${uuid(35)}','approved','x','sig')`), e => e.code === '42501');
    });
  } finally { await db.close(); }
});
