import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../migrations/20260910183846_admin_atomic_data_cleaning.sql', import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-000000000001';
const actor = '00000000-0000-0000-0000-000000000002';
const first = '00000000-0000-0000-0000-000000000003';
const second = '00000000-0000-0000-0000-000000000004';
const foreign = '00000000-0000-0000-0000-000000000005';
const initial = { category:null, risk_level:null, remarks_cleaned:null, cleaned:false, description:'Puncture', remarks:null };
const classified = { category:'Puncture',risk_level:'Medium',remarks_cleaned:'Puncture',cleaned:true };

test('data cleaning transactions, audit retention, stale edits and scope', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${actor}'::uuid $$;
      CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql AS $$ SELECT '${org}'::uuid $$;
      CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.active')::boolean $$;
      CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role') $$;
      CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      SET test.active='true'; SET test.role='Admin';
      CREATE TABLE tyre_records(id uuid PRIMARY KEY,organisation_id uuid,country text,site text,description text,remarks text,
        category text,risk_level text,remarks_cleaned text,cleaned boolean DEFAULT false,tyre_serial text,km_at_fitment numeric,km_at_removal numeric);
      CREATE TABLE cleaning_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),original_text text,cleaned_text text,category text,
        tyre_record_id uuid,cleaned_by_model text);
      CREATE TABLE audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),table_name text,record_id uuid,action text,
        old_data jsonb,new_data jsonb,changed_by uuid,organisation_id uuid,details jsonb CHECK(current_setting('test.audit')='true'));
      SET test.audit='true';
      INSERT INTO tyre_records(id,organisation_id,country,site,description,tyre_serial,km_at_fitment,km_at_removal) VALUES
        ('${first}','${org}','KSA','A','Puncture','REAL-SERIAL',100,200),
        ('${second}','${org}','UAE','B','Puncture','OTHER-SERIAL',100,200),
        ('${foreign}','00000000-0000-0000-0000-000000000099','KSA','A','Puncture','FOREIGN-SERIAL',100,200);
      ALTER TABLE tyre_records ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON tyre_records TO authenticated USING(organisation_id=app_current_org()) WITH CHECK(organisation_id=app_current_org());
      ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON audit_log TO authenticated USING(organisation_id=app_current_org()) WITH CHECK(organisation_id=app_current_org());
      ALTER TABLE cleaning_log ENABLE ROW LEVEL SECURITY;
      CREATE POLICY readable ON cleaning_log FOR SELECT TO authenticated USING(true);
      CREATE POLICY append ON cleaning_log FOR INSERT TO authenticated WITH CHECK(true);
      GRANT SELECT,UPDATE ON tyre_records TO authenticated;
      GRANT SELECT,INSERT ON audit_log,cleaning_log TO authenticated;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      BEGIN; ${migration} COMMIT; SET ROLE authenticated;
    `);
    const change = (id=first,patch=classified,expected=initial) => ({id,patch,expected});
    const correct = (changes,country='KSA',site='A',action='classify') => db.query('SELECT admin_clean_tyre_records($1,$2,$3,$4) result',[JSON.stringify(changes),country,site,action]);
    const count = async table => (await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;

    await t.test('ordinary/inactive/anonymous callers are denied', async () => {
      await db.exec("SET test.role='Driver'");
      await assert.rejects(correct([change()]),e=>e.code==='42501');
      await db.exec("SET test.role='Admin'; SET test.active='false'");
      await assert.rejects(correct([change()]),e=>e.code==='42501');
      await db.exec("SET test.active='true'; RESET ROLE; SET ROLE anon");
      await assert.rejects(correct([change()]),e=>e.code==='42501');
      await db.exec('RESET ROLE; SET ROLE authenticated');
    });
    await t.test('mixed scope batches roll back every row', async () => {
      await assert.rejects(correct([change(),change(second)]),e=>e.code==='42501');
      await assert.rejects(correct([change(foreign)]),e=>e.code==='42501');
      await assert.rejects(correct([change()], 'KSA','B'),e=>e.code==='42501');
      assert.equal(await count('audit_log'),0);
      assert.equal((await db.query('SELECT cleaned FROM tyre_records WHERE id=$1',[first])).rows[0].cleaned,false);
    });
    await t.test('an audit failure rolls back the operational record and cleaning log', async () => {
      await db.exec("SET test.audit='false'");
      await assert.rejects(correct([change()]),e=>e.code==='23514');
      assert.equal(await count('cleaning_log'),0);
      assert.equal((await db.query('SELECT cleaned FROM tyre_records WHERE id=$1',[first])).rows[0].cleaned,false);
      await db.exec("SET test.audit='true'");
    });
    await t.test('classification and retry return confirmed IDs with one audit entry', async () => {
      assert.deepEqual((await correct([change()])).rows[0].result.ids,[first]);
      await correct([change()]);
      assert.equal(await count('audit_log'),1); assert.equal(await count('cleaning_log'),1);
      const audit=(await db.query('SELECT * FROM audit_log')).rows[0];
      assert.equal(audit.changed_by,actor); assert.equal(audit.old_data.cleaned,false); assert.equal(audit.new_data.cleaned,true);
    });
    await t.test('stale snapshots and privilege-field injection are rejected', async () => {
      await assert.rejects(correct([change(first,{...classified,category:'Other'})]),e=>e.code==='40001');
      await assert.rejects(correct([change(first,{organisation_id:org},{organisation_id:org})]),e=>e.code==='22023');
      await assert.rejects(correct([change(),change()]),e=>e.code==='22023');
      await assert.rejects(correct([change(first,classified,{...classified})]),e=>e.code==='22023');
    });
    await t.test('undo appends a reversal and never deletes original history', async () => {
      await correct([change(first,{category:null,risk_level:null,remarks_cleaned:null,cleaned:false},{...initial,...classified})],'KSA','A','undo');
      assert.equal(await count('cleaning_log'),1); assert.equal(await count('audit_log'),2);
      const audit=(await db.query("SELECT * FROM audit_log WHERE details->>'operation'='undo'")).rows[0];
      assert.equal(audit.old_data.cleaned,true); assert.equal(audit.new_data.cleaned,false);
    });
    await t.test('numeric validation and stale odometers fail without writes', async () => {
      await assert.rejects(correct([change(first,{km_at_removal:50},{km_at_removal:200})],'KSA','A','odometer'),e=>e.code==='22023');
      await correct([change(first,{km_at_removal:250},{km_at_fitment:100,km_at_removal:200})],'KSA','A','odometer');
      await assert.rejects(correct([change(first,{km_at_removal:300},{km_at_removal:200})],'KSA','A','odometer'),e=>e.code==='40001');
    });
    await t.test('selected organisation can explicitly process another country without crossing tenant', async () => {
      await correct([change(second)],null,null);
      assert.equal((await db.query('SELECT cleaned FROM tyre_records WHERE id=$1',[second])).rows[0].cleaned,true);
    });
  } finally { await db.close(); }
});
