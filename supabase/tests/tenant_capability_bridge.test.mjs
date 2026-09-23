import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const legacy = await read('20260830073937_access_control_atomic_save.sql');
const configuration = await read('20260910184011_tenant_administration_configuration.sql');
const migration = await read('20260912091451_bridge_tenant_capability_configuration.sql');
const definition = name => legacy.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

test('capability rollout preserves effective policy, isolates saves and retains legacy settings', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT current_setting('test.actor')::uuid$$;
      CREATE TABLE profiles(id uuid PRIMARY KEY,org_id uuid,role text,approved boolean DEFAULT true,locked boolean DEFAULT false,is_super_admin boolean DEFAULT false);
      INSERT INTO profiles(id,org_id,role) VALUES('${id(1)}','${id(10)}','Admin'),('${id(2)}','${id(10)}','Operator'),('${id(3)}','${id(20)}','Operator');
      CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql AS $$SELECT org_id FROM profiles WHERE id=auth.uid()$$;
      CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql AS $$SELECT role FROM profiles WHERE id=auth.uid()$$;
      CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql AS $$SELECT approved AND NOT locked FROM profiles WHERE id=auth.uid()$$;
      CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
      CREATE FUNCTION access_audit_actor_email() RETURNS text LANGUAGE sql AS $$SELECT 'test@example.invalid'$$;
      CREATE TABLE organisations(id uuid PRIMARY KEY,settings jsonb,updated_at timestamptz);
      INSERT INTO organisations VALUES('${id(10)}','{"branding":{"logo":"keep"}}',now()),('${id(20)}','{}',now());
      CREATE TABLE app_settings(key text PRIMARY KEY,value text,description text,updated_by uuid,updated_at timestamptz);
      INSERT INTO app_settings(key,value) VALUES('permission_overrides','{"overrides":{"Operator":{"work_orders":{"create":true}}}}'),('feature_flags','{"ai_tools":false}'),('private_config','private');
      CREATE TABLE settings(key text,value jsonb,updated_by uuid);
      INSERT INTO settings VALUES('company_name','"Company A"','${id(1)}'),('unknown_setting','"do not copy"',null);
      CREATE TABLE audit_log(table_name text,record_id uuid,action text,old_data jsonb,new_data jsonb,organisation_id uuid,changed_by uuid,details jsonb);
      CREATE TABLE module_permissions(module_key text,role text,org_id uuid,enabled boolean,updated_by uuid,updated_at timestamptz);
      CREATE TABLE access_audit(actor uuid,actor_email text,action text,entity text,before jsonb,after jsonb);
      CREATE TABLE user_access_grants(user_id uuid,module_key text,capability text,effect text,expires_at timestamptz);
      SET test.actor='${id(1)}';
      ${definition('save_access_control_matrix')}
      ${definition('app_user_can')}
      ${configuration}
      ${migration}
    `);
    const scalar = async (sql, args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
    const actor = n => db.exec(`SET test.actor='${id(n)}'`);
    for (const n of [2,3]) {
      await actor(n);
      assert.equal(await scalar("SELECT app_user_can('work_orders','create')"),true);
      assert.equal(await scalar("SELECT value FROM get_organisation_configuration('app_settings','feature_flags')"),'{"ai_tools":false}');
      assert.equal(await scalar("SELECT count(*)::int FROM get_organisation_configuration('app_settings','private_config')"),0);
    }
    await actor(1);
    assert.equal(await scalar("SELECT value FROM get_organisation_configuration('settings','company_name')"),'"Company A"');
    assert.equal(await scalar("SELECT count(*)::int FROM get_organisation_configuration('settings','unknown_setting')"),0);
    const envelope = '{"overrides":{"Operator":{"work_orders":{"create":false}}}}';
    await db.query('SELECT save_access_control_matrix($1,$2,$3)',['[]',envelope,'Reviewed']);
    assert.equal(await scalar("SELECT value FROM get_organisation_configuration('app_settings','permission_overrides')"),envelope);
    await actor(2);
    assert.equal(await scalar("SELECT app_user_can('work_orders','create')"),false);
    await actor(3);
    assert.equal(await scalar("SELECT app_user_can('work_orders','create')"),true);
    await assert.rejects(db.query('SELECT save_access_control_matrix($1,$2,$3)',['[]',envelope,'denied']),e=>e.code==='42501');
    assert.equal(await scalar("SELECT value FROM app_settings WHERE key='permission_overrides'"),'{"overrides":{"Operator":{"work_orders":{"create":true}}}}');
    assert.equal(await scalar('SELECT settings->\'branding\'->>\'logo\' FROM organisations WHERE id=$1',[id(10)]),'keep');
    await actor(1);
    await db.exec("CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'audit unavailable'; END$$; CREATE TRIGGER reject_audit BEFORE INSERT ON access_audit FOR EACH ROW EXECUTE FUNCTION reject_audit();");
    await assert.rejects(db.query('SELECT save_access_control_matrix($1,$2,$3)',['[]','{"overrides":{}}','fail']));
    assert.equal(await scalar("SELECT value FROM get_organisation_configuration('app_settings','permission_overrides')"),envelope);
  } finally { await db.close(); }
});
