// Device ingest migration (20261127120000) in PGlite with stub base tables.
// Run: node --test supabase/tests/device_ingest.test.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../migrations/20261127120000_device_ingest.sql', import.meta.url), 'utf8')
const ORG = '00000000-0000-0000-0000-000000000001'
const OTHER = '00000000-0000-0000-0000-000000000099'
const ADMIN = '00000000-0000-0000-0000-0000000000a1'
const MANAGER = '00000000-0000-0000-0000-0000000000a2'
const STORE = '00000000-0000-0000-0000-0000000000a3'

async function setup() {
  const db = new PGlite()
  await db.exec(`
    CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role, anon;
    CREATE TABLE profiles(id uuid PRIMARY KEY, org_id uuid, organisation_id uuid, role text, is_super_admin boolean DEFAULT false,
      approved boolean DEFAULT true, locked boolean DEFAULT false);
    INSERT INTO profiles VALUES ('${ADMIN}','${ORG}','${ORG}','Admin',false,true,false),
      ('${MANAGER}','${ORG}','${ORG}','Manager',false,true,false),('${STORE}','${ORG}','${ORG}','Store Keeper',false,true,false);
    GRANT SELECT ON profiles TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
    CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT org_id FROM profiles WHERE id = auth.uid() $$;
    CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT is_super_admin FROM profiles WHERE id = auth.uid()), false) $$;
    CREATE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT lower(replace(coalesce(role,'reporter'),' ','_')) FROM profiles WHERE id = auth.uid() $$;
    CREATE FUNCTION app_is_org_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT is_super_admin() OR app_role() = 'admin' $$;
    CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, body text,
      entity_type text, entity_id uuid, read boolean, created_at timestamptz DEFAULT now());
    CREATE TABLE vehicle_fleet(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, asset_no text, country text, site text,
      vin text, chassis_no text, registration_no text, current_km numeric, latitude double precision, longitude double precision,
      location_updated_at timestamptz, gps_source text);
    INSERT INTO vehicle_fleet(organisation_id, asset_no, country, site, vin, registration_no) VALUES
      ('${ORG}','TM514','KSA','NHC','VIN514','1234 ABC'),
      ('${ORG}','GN103','KSA','NHC',null,null), ('${ORG}','GN103','UAE','JEB',null,null),
      ('${OTHER}','TM999','KSA','X',null,null);
    CREATE TABLE telematics_devices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text, device_id text,
      asset_no text, status text DEFAULT 'active', last_seen_at timestamptz);
    INSERT INTO telematics_devices(organisation_id, country, device_id, asset_no) VALUES ('${ORG}','UAE','IMEI-GN103-UAE','GN103');
    CREATE TABLE gps_positions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text, asset_no text NOT NULL,
      latitude numeric, longitude numeric, speed_kmh numeric, heading numeric, altitude_m numeric, ignition boolean, odometer_km numeric,
      recorded_at timestamptz, notes text);
    CREATE TABLE odometer_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text, asset_no text NOT NULL,
      odometer_km numeric, reading_date date, source text, site text, notes text, client_uuid text UNIQUE);
    CREATE FUNCTION sync_km() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      UPDATE vehicle_fleet SET current_km = NEW.odometer_km WHERE organisation_id = NEW.organisation_id AND asset_no = NEW.asset_no
        AND country IS NOT DISTINCT FROM NEW.country AND (current_km IS NULL OR NEW.odometer_km >= current_km); RETURN NEW; END $$;
    CREATE TRIGGER trg_sync AFTER INSERT ON odometer_logs FOR EACH ROW EXECUTE FUNCTION sync_km();
    CREATE TABLE engine_hours_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text, asset_no text NOT NULL,
      engine_hours numeric, reading_date date, source text, site text, notes text, client_uuid text UNIQUE);
    CREATE TABLE tpms_readings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text, site text, asset_no text,
      tyre_position text, tyre_serial text, pressure numeric, temperature numeric, target_pressure numeric,
      status text CHECK (status IN ('optimal','under','over','critical')), recorded_at timestamptz, source text, notes text);
    CREATE TABLE fuel_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text, asset_no text,
      site text, station text, txn_at timestamptz, litres numeric CHECK (litres >= 0), amount numeric, currency text, odometer_km numeric,
      receipt_no text, notes text);
    CREATE TABLE dtc_codes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text, asset_no text NOT NULL,
      code text, description text, system text, severity text, detected_at date, status text, site text, notes text);
    CREATE TABLE rfid_tags(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, tag_id text, last_scanned_at timestamptz);
    CREATE TABLE rfid_tag_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text, tag_row_id uuid,
      tag_id text, action text NOT NULL, to_asset_no text, to_site text, actor_name text, created_at timestamptz DEFAULT now(),
      CONSTRAINT rfid_tag_events_action_check CHECK (action IN ('registered')));
    CREATE TABLE dashcam_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, country text, asset_no text,
      driver_name text, event_type text, severity text, event_at timestamptz, location text, speed_kmh numeric, video_url text, notes text);
  `)
  await db.exec(migration)
  return db
}

const as = async (db, uid, role = 'authenticated') => db.exec(`RESET ROLE; SET test.uid='${uid}'; SET ROLE ${role}`)
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0]

test('device ingest: admin-only management, idempotent ingest, quarantine, alerts', async (t) => {
  const db = await setup()

  await t.test('Manager and Store Keeper cannot mint keys or read the feed', async () => {
    for (const uid of [MANAGER, STORE]) {
      await as(db, uid)
      await assert.rejects(db.query(`SELECT device_ingest_key_create('x', array['gps'])`), (e) => e.code === '42501')
      await assert.rejects(db.query(`SELECT device_ingest_overview()`), (e) => e.code === '42501')
      await assert.rejects(db.query(`SELECT * FROM device_ingest_keys_list()`), (e) => e.code === '42501')
      await assert.rejects(db.query(`SELECT device_ingest_dry_run('[]'::jsonb)`), (e) => e.code === '42501')
      await assert.rejects(db.query(`SELECT count(*) FROM device_ingest_keys`), (e) => e.code === '42501')
      assert.equal((await one(db, `SELECT count(*)::int n FROM device_ingest_messages`)).n, 0)
    }
  })

  let keyId
  await t.test('Admin mints a hashed key; plaintext is never stored', async () => {
    await as(db, ADMIN)
    const r = (await one(db, `SELECT device_ingest_key_create('Fleet feed', array['gps','odometer','tpms','dtc','engine_hours']) k`)).k
    assert.match(r.key, /^tpd_[0-9a-f]{10}\.[0-9a-f]{64}$/)
    keyId = r.id
    await db.exec('RESET ROLE')
    const row = await one(db, `SELECT key_hash, key_prefix FROM device_ingest_keys WHERE id = $1`, [keyId])
    assert.equal(row.key_prefix, r.prefix)
    assert.notEqual(row.key_hash, r.key)
    const h = await one(db, `SELECT encode(sha256(convert_to($1,'UTF8')),'hex') h`, [r.key])
    assert.equal(row.key_hash, h.h)
  })

  await t.test('authenticated users cannot call the service-only ingest RPCs', async () => {
    await as(db, ADMIN)
    await assert.rejects(db.query(`SELECT device_ingest_submit($1, '[]'::jsonb)`, [keyId]), (e) => e.code === '42501')
    await assert.rejects(db.query(`SELECT device_ingest_key_lookup('tpd_x')`), (e) => e.code === '42501')
  })

  const submit = async (msgs) => {
    await as(db, '', 'service_role')
    return (await one(db, `SELECT device_ingest_submit($1, $2::jsonb) r`, [keyId, JSON.stringify(msgs)])).r
  }

  await t.test('odometer lands as telematics and moves current_km; retry is a duplicate', async () => {
    const msg = { type: 'odometer', message_id: 'm1', asset: { asset_no: 'tm 514' }, data: { odometer_km: 150000 } }
    const r1 = await submit([msg])
    assert.equal(r1.results[0].status, 'accepted')
    const r2 = await submit([msg])
    assert.equal(r2.results[0].status, 'duplicate')
    await db.exec('RESET ROLE')
    const o = await one(db, `SELECT count(*)::int n, max(source) s FROM odometer_logs`)
    assert.deepEqual(o, { n: 1, s: 'telematics' })
    assert.equal(Number((await one(db, `SELECT current_km FROM vehicle_fleet WHERE asset_no='TM514'`)).current_km), 150000)
  })

  await t.test('same code in two countries is quarantined, never guessed; registered IMEI resolves it', async () => {
    const r = await submit([{ type: 'gps', message_id: 'g1', asset: { asset_no: 'GN103' }, data: { lat: 24.7, lon: 46.6 } }])
    assert.equal(r.results[0].status, 'quarantined')
    assert.equal(r.results[0].reason, 'ambiguous')
    const r2 = await submit([{ type: 'gps', message_id: 'g2', device_id: 'imei-gn103-uae', data: { lat: 25.0, lon: 55.1 } }])
    assert.equal(r2.results[0].status, 'accepted')
    await db.exec('RESET ROLE')
    assert.equal((await one(db, `SELECT country FROM gps_positions`)).country, 'UAE')
    assert.equal((await one(db, `SELECT count(*)::int n FROM device_ingest_unmatched WHERE status='open'`)).n, 1)
  })

  await t.test('another org\'s asset is unknown, and an admin can match an unmatched reading', async () => {
    const r = await submit([{ type: 'gps', message_id: 'g3', asset: { asset_no: 'TM999' }, data: { lat: 1, lon: 1 } }])
    assert.equal(r.results[0].reason, 'unknown')
    await as(db, ADMIN)
    const list = (await db.query(`SELECT * FROM device_ingest_unmatched_list(50)`)).rows
    assert.equal(list.length, 2)
    const ambiguous = list.find((x) => x.reason === 'ambiguous_asset')
    await db.exec('RESET ROLE')
    const ksa = await one(db, `SELECT id FROM vehicle_fleet WHERE asset_no='GN103' AND country='KSA'`)
    await as(db, ADMIN)
    const res = (await one(db, `SELECT device_ingest_resolve_unmatched($1,$2) r`, [ambiguous.id, ksa.id])).r
    assert.equal(res.status, 'accepted')
    await as(db, MANAGER)
    await assert.rejects(db.query(`SELECT device_ingest_resolve_unmatched($1,$2)`, [list[0].id, ksa.id]), (e) => e.code === '42501')
  })

  await t.test('type outside the key scope and malformed values are rejected without blocking a retry', async () => {
    const r = await submit([{ type: 'dashcam', asset: { asset_no: 'TM514' }, data: {} }, { type: 'gps', _rejected: 'lat_required' }])
    assert.deepEqual(r.results.map((x) => x.status), ['rejected', 'rejected'])
    const bad = await submit([{ type: 'odometer', message_id: 'm9', asset: { asset_no: 'TM514' }, data: { odometer_km: 'abc' } }])
    assert.equal(bad.results[0].status, 'rejected')
    const good = await submit([{ type: 'odometer', message_id: 'm9', asset: { asset_no: 'TM514' }, data: { odometer_km: 150100 } }])
    assert.equal(good.results[0].status, 'accepted')
  })

  await t.test('low TPMS and critical DTC alert admins once; an active DTC is not duplicated', async () => {
    const low = { type: 'tpms', asset: { asset_no: 'TM514' }, data: { position: 'LHF1', pressure_psi: 80, target_psi: 120 } }
    await submit([{ ...low, message_id: 't1' }, { ...low, message_id: 't2' }])
    const dtc = { type: 'dtc', asset: { vin: 'vin514' }, data: { code: 'P0217', severity: 'critical' } }
    const d = await submit([{ ...dtc, message_id: 'd1' }, { ...dtc, message_id: 'd2' }])
    assert.deepEqual(d.results.map((x) => x.status), ['accepted', 'duplicate'])
    await db.exec('RESET ROLE')
    assert.equal((await one(db, `SELECT status FROM tpms_readings LIMIT 1`)).status, 'critical')
    const n = (await db.query(`SELECT user_id, type FROM notifications`)).rows
    assert.deepEqual(n.map((x) => x.user_id), [ADMIN, ADMIN])
    assert.deepEqual(n.map((x) => x.type).sort(), ['dtc_alert', 'tpms_alert'])
  })

  await t.test('revoked key refuses everything', async () => {
    await as(db, ADMIN)
    await db.query(`SELECT device_ingest_key_revoke($1, 'lost device')`, [keyId])
    const r = await submit([{ type: 'gps', asset: { asset_no: 'TM514' }, data: { lat: 1, lon: 1 } }])
    assert.equal(r.ok, false)
    assert.equal(r.error, 'invalid_key')
  })

  await t.test('dry run writes nothing', async () => {
    await db.exec('RESET ROLE')
    const before = (await one(db, `SELECT count(*)::int n FROM device_ingest_messages`)).n
    await as(db, ADMIN)
    const r = (await one(db, `SELECT device_ingest_dry_run($1::jsonb) r`, [JSON.stringify([
      { type: 'gps', asset: { registration_no: '1234abc' }, data: { lat: 1, lon: 1 } }])])).r
    assert.equal(r.results[0].asset_no, 'TM514')
    await db.exec('RESET ROLE')
    assert.equal((await one(db, `SELECT count(*)::int n FROM device_ingest_messages`)).n, before)
  })

  await db.close()
})
