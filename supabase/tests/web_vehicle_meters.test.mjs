import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../migrations/20260910102622_web_vehicle_meter_workspace.sql', import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-000000000001';
const actor = '00000000-0000-0000-0000-000000000002';
const vehicleId = '00000000-0000-0000-0000-000000000003';
const request = '00000000-0000-0000-0000-000000000004';

test('web meter transaction, retries, corrections and access isolation', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${actor}'::uuid $$;
      CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql AS $$ SELECT current_setting('test.org')::uuid $$;
      CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.role') $$;
      CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      SET test.org = '${org}'; SET test.role = 'Admin';
      CREATE TABLE vehicle_fleet(id uuid PRIMARY KEY,organisation_id uuid,asset_no text,country text,site text,current_km numeric,current_engine_hours numeric,current_hours numeric,updated_at timestamptz DEFAULT now());
      CREATE TABLE odometer_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,asset_no text,country text,site text,reading_date date,odometer_km numeric,source text,notes text,created_by uuid,client_uuid text UNIQUE,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE engine_hours_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,asset_no text,country text,site text,reading_date date,engine_hours numeric CHECK(engine_hours <> 9999),source text,notes text,created_by uuid,client_uuid text UNIQUE,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),table_name text,record_id uuid,action text,old_data jsonb,new_data jsonb,changed_by uuid,organisation_id uuid,details jsonb);
      CREATE FUNCTION sync_km() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        UPDATE vehicle_fleet SET current_km=NEW.odometer_km WHERE asset_no=NEW.asset_no AND organisation_id=NEW.organisation_id AND country IS NOT DISTINCT FROM NEW.country AND (current_km IS NULL OR NEW.odometer_km>=current_km); RETURN NEW; END $$;
      CREATE TRIGGER km AFTER INSERT OR UPDATE OF odometer_km ON odometer_logs FOR EACH ROW EXECUTE FUNCTION sync_km();
      INSERT INTO vehicle_fleet VALUES ('${vehicleId}','${org}','TM651','KSA','JEDDAH',100,10,NULL,now());
    `);
    for (const table of ['vehicle_fleet','odometer_logs','engine_hours_logs','audit_log']) {
      await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY scoped ON ${table} TO authenticated USING(organisation_id=app_current_org()) WITH CHECK(organisation_id=app_current_org());
        GRANT SELECT,INSERT,UPDATE ON ${table} TO authenticated;`);
    }
    await db.exec(`GRANT USAGE ON SCHEMA auth TO authenticated; BEGIN; ${migration} COMMIT; SET ROLE authenticated;`);
    async function save(km, hours, key = request, expectedKm = 100, expectedHours = 10) {
      return (await db.query('SELECT save_vehicle_meter_readings($1,current_date,$2,$3,$4,$5,$6,NULL) result', [vehicleId, km, hours, key, expectedKm, expectedHours])).rows[0].result;
    }
    await t.test('a failed hours write rolls back kilometres and audit too', async () => {
      await assert.rejects(save(110,9999), e => e.code === '23514');
      assert.equal((await db.query('SELECT count(*)::int n FROM odometer_logs')).rows[0].n,0);
      assert.equal((await db.query('SELECT current_km::int km FROM vehicle_fleet')).rows[0].km,100);
    });
    let result;
    await t.test('both meters commit together, source is automatic, retries do not duplicate', async () => {
      result = await save(110,20);
      assert.equal(result.odometer.source,'Web Manual');
      assert.equal(result.hours.source,'Web Manual');
      assert.equal(result.vehicle.current_km,110);
      assert.equal(result.vehicle.current_engine_hours,20);
      assert.equal((await save(110,20)).odometer.id,result.odometer.id);
      assert.equal((await db.query('SELECT count(*)::int n FROM audit_log')).rows[0].n,2);
    });
    await t.test('stale values and conflicting retry keys are rejected', async () => {
      await assert.rejects(save(120,30,'00000000-0000-0000-0000-000000000005'),e => e.code === '40001');
      await assert.rejects(save(120,30),e => e.code === '22023');
    });
    await t.test('a correction preserves source and records before/after, actor and reason', async () => {
      const row = result.odometer;
      await db.query('SELECT correct_vehicle_meter_reading($1,$2,$3,current_date,$4,$5)', ['km',row.id,115,'Corrected transcription',row.updated_at]);
      const audit = (await db.query("SELECT * FROM audit_log WHERE action='UPDATE'")).rows[0];
      assert.equal(audit.old_data.odometer_km,110); assert.equal(audit.new_data.odometer_km,115);
      assert.equal(audit.changed_by,actor); assert.equal(audit.details.reason,'Corrected transcription');
      assert.equal(audit.new_data.source,'Web Manual');
      await assert.rejects(db.query('SELECT correct_vehicle_meter_reading($1,$2,$3,current_date,$4,$5)', ['km',row.id,116,'Stale correction',row.updated_at]),e => e.code === '40001');
    });
    await t.test('different organisations and non-admin roles cannot save', async () => {
      await db.exec("SET test.org='00000000-0000-0000-0000-000000000099'");
      await assert.rejects(save(120,30), e => e.code === '42501');
      await db.exec(`SET test.org='${org}'; SET test.role='driver'`);
      await assert.rejects(save(120,30), e => e.code === '42501');
      await db.exec("SET test.role='Admin'");
    });
    await t.test('omitting hours creates only a kilometre reading', async () => {
      const next = await save(120,null,'00000000-0000-0000-0000-000000000006',115,20);
      assert.equal(next.odometer.odometer_km,120);
      assert.equal(next.hours.id,null);
      assert.equal((await db.query('SELECT count(*)::int n FROM engine_hours_logs')).rows[0].n,1);
    });
  } finally { await db.close(); }
});
