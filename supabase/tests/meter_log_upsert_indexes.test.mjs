import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../migrations/20260910095436_fix_meter_log_upsert_indexes.sql', import.meta.url), 'utf8');
const remainingMigration = await readFile(new URL('../migrations/20260910095446_fix_mobile_queue_indexes_and_wash_permissions.sql', import.meta.url), 'utf8');
const tables = ['odometer_logs', 'engine_hours_logs', 'checklist_submissions', 'accidents', 'tech_activity_events'];

test('installed mobile meter upserts accept retries and preserve web/import rows', async () => {
  const db = new PGlite();
  try {
    for (const table of tables) {
      await db.exec(`
        CREATE TABLE ${table} (id serial PRIMARY KEY, client_uuid text, reading numeric);
        CREATE UNIQUE INDEX ${table}_legacy_key ON ${table}(client_uuid)
          WHERE client_uuid IS NOT NULL;
        INSERT INTO ${table}(reading) VALUES (10), (20);
      `);
      await assert.rejects(
        db.query(`INSERT INTO ${table}(client_uuid, reading) VALUES ('reading-key', 30)
          ON CONFLICT (client_uuid) DO NOTHING`),
        error => error.code === '42P10',
      );
    }
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql AS
        $$ SELECT nullif(current_setting('test.role', true), '') $$;
      CREATE TABLE wash_records (id serial PRIMARY KEY, organisation_id text, country text, site text);
      ALTER TABLE wash_records ENABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT ON wash_records TO authenticated;
      GRANT USAGE ON SEQUENCE wash_records_id_seq TO authenticated;
      CREATE POLICY wash_records_insert ON wash_records FOR INSERT TO authenticated
        WITH CHECK (get_my_role() = ANY (ARRAY['Admin','Manager','Director','driver']));
      CREATE POLICY wash_records_select ON wash_records FOR SELECT TO authenticated USING (true);
      CREATE POLICY wash_records_org_isolation ON wash_records AS RESTRICTIVE FOR ALL TO authenticated
        USING (organisation_id = current_setting('test.org')) WITH CHECK (organisation_id = current_setting('test.org'));
      CREATE POLICY wash_records_country_write ON wash_records AS RESTRICTIVE FOR ALL TO authenticated
        USING (country = 'KSA') WITH CHECK (country = 'KSA');
      CREATE POLICY wash_records_site_write ON wash_records AS RESTRICTIVE FOR ALL TO authenticated
        USING (site = 'JEDDAH') WITH CHECK (site = 'JEDDAH');
      SET test.org = 'org-a'; SET test.role = 'Fleet Supervisor'; SET ROLE authenticated;
    `);
    await assert.rejects(db.query("INSERT INTO wash_records(organisation_id,country,site) VALUES ('org-a','KSA','JEDDAH')"), error => error.code === '42501');
    await db.exec(`RESET ROLE; BEGIN; ${migration} ${remainingMigration} COMMIT;`);
    for (const table of tables) {
      await db.exec(`
        INSERT INTO ${table}(client_uuid, reading) VALUES ('reading-key', 30)
          ON CONFLICT (client_uuid) DO NOTHING;
        INSERT INTO ${table}(client_uuid, reading) VALUES ('reading-key', 99)
          ON CONFLICT (client_uuid) DO NOTHING;
        INSERT INTO ${table}(reading) VALUES (40);
      `);
      const { rows } = await db.query(`SELECT client_uuid, reading::int FROM ${table} ORDER BY id`);
      assert.deepEqual(rows, [
        { client_uuid: null, reading: 10 },
        { client_uuid: null, reading: 20 },
        { client_uuid: 'reading-key', reading: 30 },
        { client_uuid: null, reading: 40 },
      ]);
    }
    await db.exec('SET ROLE authenticated');
    for (const role of ['Fleet Supervisor', 'Admin', 'Manager', 'Director', 'driver']) {
      await db.query("SELECT set_config('test.role', $1, false)", [role]);
      await db.query("INSERT INTO wash_records(organisation_id,country,site) VALUES ('org-a','KSA','JEDDAH')");
    }
    await db.exec("SET test.role = 'Fleet Supervisor'");
    for (const values of [['org-b','KSA','JEDDAH'], ['org-a','EGYPT','JEDDAH'], ['org-a','KSA','RIYADH']]) {
      await assert.rejects(db.query('INSERT INTO wash_records(organisation_id,country,site) VALUES ($1,$2,$3)', values), error => error.code === '42501');
    }
    for (const role of ['Reporter', 'Workshop Supervisor', '']) {
      await db.query("SELECT set_config('test.role', $1, false)", [role]);
      await assert.rejects(db.query("INSERT INTO wash_records(organisation_id,country,site) VALUES ('org-a','KSA','JEDDAH')"), error => error.code === '42501');
    }
  } finally {
    await db.close();
  }
});
