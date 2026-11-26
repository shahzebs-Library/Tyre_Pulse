// Vehicle handover authorization paper (20261126170000): server-stamped driver
// signatures, freeze after signing, approver is not the signing driver, org
// isolation, per-org document numbers and the append-only audit trail.
//
// Applies the REAL handover migrations in order (V181 table, two-stage sign-off,
// forgery guard, supervisor freeze, this migration) on PGlite with stubbed
// platform helpers, then acts as real roles via auth.uid().
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../../', import.meta.url)
const read = (p) => readFile(new URL(p, root), 'utf8')
const files = [
  'MIGRATIONS_V181_HANDOVER_REPORTS.sql',
  'supabase/migrations/20261112130000_handover_two_stage_signoff.sql',
  'supabase/migrations/20261112143000_handover_signoff_forgery_guard.sql',
  'supabase/migrations/20261112155000_handover_freeze_after_supervisor_sign.sql',
  'supabase/migrations/20261126170000_handover_authorization_paper.sql',
]

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ORG = id(1)
const OTHER_ORG = id(9)
const CAPTURER = id(2)      // Reporter capturing on a tablet
const SUPERVISOR = id(3)    // Fleet Supervisor, not a driver
const DRIVER_SUP = id(4)    // Fleet Supervisor who is ALSO the receiving driver
const INCHARGE = id(5)      // Fleet Incharge
const OUTSIDER = id(6)      // Manager in another org
const TABLET_SUP = id(7)    // Fleet Supervisor collecting signatures on a tablet
const RIYADH_USER = id(8)   // same org, scoped to another site
const UAE_USER = id(11)     // same org, scoped to another country
const FROM_SUP = id(10)     // Fleet Supervisor who is ALSO the handing driver
const DRV_FROM = id(20)
const DRV_TO = id(21)
const DRV_OTHER_ORG = id(22)
const DRV_UAE = id(23)
// The exact shape the web SignatureCapture emits (and the driver charge module accepts).
const SIG = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="130" viewBox="0 0 320 130"><path d="M0 0 L5 5" fill="none" stroke="#111827" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const PNG = 'data:image/png;base64,iVBORw0KGgo='

async function setup() {
  const db = new PGlite()
  await db.exec(`
    CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE profiles(id uuid PRIMARY KEY, org_id uuid, full_name text, username text, role text,
      approved boolean DEFAULT true, locked boolean DEFAULT false, is_super_admin boolean DEFAULT false,
      country text[] DEFAULT ARRAY['ksa'], sites text[] DEFAULT ARRAY['JEDDAH']);
    CREATE TABLE custom_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, name text, description text, active boolean);
    CREATE TABLE drivers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id text, driver_name text, country text, site text, organisation_id uuid, status text DEFAULT 'active');
    CREATE TABLE driver_account_links(driver_id uuid PRIMARY KEY REFERENCES drivers(id), user_id uuid NOT NULL UNIQUE REFERENCES profiles(id), organisation_id uuid NOT NULL);
    CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT org_id FROM public.profiles WHERE id = auth.uid() $$;
    CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
    CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT is_super_admin FROM public.profiles WHERE id = auth.uid()), false) $$;
    CREATE FUNCTION app_is_elevated() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT role IN ('Admin','Manager','Director') FROM public.profiles WHERE id = auth.uid()), false) $$;
    CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT approved AND NOT locked FROM public.profiles WHERE id = auth.uid() $$;
    CREATE FUNCTION app_cap_revoked(k text, c text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION app_cap_granted(k text, c text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION app_write_country_ok(c text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT c IS NULL OR c = 'KSA' $$;
    CREATE FUNCTION app_sees_all_sites() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION app_site_scope() RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT sites FROM public.profiles WHERE id = auth.uid()), '{}') $$;
    CREATE FUNCTION app_sees_all_countries() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION app_country_scope() RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT country FROM public.profiles WHERE id = auth.uid()), '{}') $$;
    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
    GRANT SELECT ON profiles, drivers, driver_account_links TO authenticated;
    INSERT INTO profiles(id, org_id, full_name, role) VALUES
      ('${CAPTURER}', '${ORG}', 'Capture Clerk', 'Reporter'),
      ('${SUPERVISOR}', '${ORG}', 'Sam Supervisor', 'Fleet Supervisor'),
      ('${DRIVER_SUP}', '${ORG}', 'Dana Driver', 'Fleet Supervisor'),
      ('${INCHARGE}', '${ORG}', 'Ivy Incharge', 'Fleet Incharge'),
      ('${OUTSIDER}', '${OTHER_ORG}', 'Other Tenant', 'Manager'),
      ('${TABLET_SUP}', '${ORG}', 'Tara Tablet', 'Fleet Supervisor'),
      ('${FROM_SUP}', '${ORG}', 'Faisal From', 'Fleet Supervisor');
    INSERT INTO profiles(id, org_id, full_name, role, sites, country) VALUES
      ('${RIYADH_USER}', '${ORG}', 'Riyadh Reader', 'Manager', ARRAY['RIYADH'], ARRAY['ksa']),
      ('${UAE_USER}', '${ORG}', 'Uae Reader', 'Manager', ARRAY['JEDDAH'], ARRAY['uae']);
    INSERT INTO drivers(id, driver_id, driver_name, country, site, organisation_id) VALUES
      ('${DRV_FROM}', 'EMP1', 'Faisal From', 'KSA', 'JEDDAH', '${ORG}'),
      ('${DRV_TO}', 'EMP2', 'Dana Driver', 'KSA', 'JEDDAH', '${ORG}'),
      ('${DRV_OTHER_ORG}', 'EMP9', 'Foreign Driver', 'KSA', 'JEDDAH', '${OTHER_ORG}'),
      ('${DRV_UAE}', 'EMP3', 'Umar UAE', 'UAE', 'DUBAI', '${ORG}');
    INSERT INTO driver_account_links(driver_id, user_id, organisation_id) VALUES
      ('${DRV_TO}', '${DRIVER_SUP}', '${ORG}'),
      ('${DRV_FROM}', '${FROM_SUP}', '${ORG}');
  `)
  for (const f of files) await db.exec(await read(f))
  await db.exec('SET ROLE authenticated')
  return db
}

const as = (db, user) => db.exec(`SET test.actor = '${user}'`)
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0]
const rejects = (p, code) => assert.rejects(p, (e) => (code ? e.code === code : true))

async function newHandover(db, extra = {}) {
  const cols = { asset_no: 'TM 514', handover_type: 'checkout', from_driver_id: DRV_FROM, to_driver_id: DRV_TO,
    odometer_km: 1000, country: 'KSA', site: 'JEDDAH', approval_status: 'draft', handover_at: '2026-11-26T08:00:00Z', ...extra }
  const keys = Object.keys(cols)
  const r = await one(db, `insert into handover_reports(${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`, keys.map((k) => cols[k]))
  return r
}

const sign = (db, hid, party, extra = {}) => one(db,
  'select sign_handover($1, $2, $3, $4, $5, $6, $7, $8, $9) r',
  [hid, party, extra.signature ?? SIG, extra.name ?? null, extra.lat ?? null, extra.lng ?? null, extra.acc ?? null, extra.status ?? null, extra.onBehalf ?? false])

// Handing on behalf from the supervisor's tablet, receiving by the driver's own
// account (DRIVER_SUP is linked to DRV_TO). Restores the given actor.
async function signBoth(db, hid, back = CAPTURER) {
  await as(db, TABLET_SUP)
  await sign(db, hid, 'handing', { onBehalf: true })
  await as(db, DRIVER_SUP)
  await sign(db, hid, 'receiving')
  await as(db, back)
}

test('vehicle handover authorization paper', async (t) => {
  const db = await setup()
  try {
    await as(db, CAPTURER)

    await t.test('document number is minted server side per org, asset and year', async () => {
      const a = await newHandover(db, { document_no: 'FORGED-1' })
      const b = await newHandover(db)
      assert.equal(a.document_no, 'HO-TM514-2026-0001')
      assert.equal(b.document_no, 'HO-TM514-2026-0002')
      const c = await newHandover(db, { asset_no: 'pl-077' })
      assert.equal(c.document_no, 'HO-PL-077-2026-0001')
    })

    await t.test('signatures cannot be forged on insert or by a direct update', async () => {
      await rejects(newHandover(db, { from_signed_at: '2020-01-01T00:00:00Z' }), '42501')
      await rejects(newHandover(db, { to_signature: SIG }), '42501')
      await rejects(newHandover(db, { latitude: 21.5, longitude: 39.2 }), '42501')
      const h = await newHandover(db)
      await rejects(db.query('update handover_reports set from_signature = $2, from_signed_at = now() where id = $1', [h.id, SIG]), '42501')
      await rejects(db.query('update handover_reports set latitude = 1, longitude = 1 where id = $1', [h.id]), '42501')
    })

    let signed
    await t.test('signatures are stamped by the server, with the driver register name', async () => {
      const h = await newHandover(db)
      await as(db, TABLET_SUP)
      await rejects(sign(db, h.id, 'receiving', { onBehalf: true }), '22023') // handing signs first
      const before = Date.now()
      const r1 = (await sign(db, h.id, 'handing', { name: 'Typed Name Ignored', status: 'denied', onBehalf: true })).r
      assert.equal(r1.signed_name, 'Faisal From')
      assert.equal(r1.signed_by, TABLET_SUP)
      assert.equal(r1.on_behalf, true)
      const row1 = await one(db, 'select * from handover_reports where id = $1', [h.id])
      assert.ok(Math.abs(new Date(row1.from_signed_at).getTime() - before) < 60000)
      assert.equal(row1.from_signed_by, TABLET_SUP)
      assert.equal(row1.from_on_behalf, true)
      assert.equal(row1.location_status, 'denied')
      assert.equal(row1.approval_status, 'draft')
      await rejects(sign(db, h.id, 'handing', { onBehalf: true }), '22023') // only once
      await as(db, DRIVER_SUP)
      const r2 = (await sign(db, h.id, 'receiving', { lat: 21.4858, lng: 39.1925, acc: 12 })).r
      assert.equal(r2.signed_name, 'Dana Driver')
      assert.equal(r2.on_behalf, false)
      assert.equal(r2.status, 'pending_supervisor')
      await as(db, CAPTURER)
      signed = await one(db, 'select * from handover_reports where id = $1', [h.id])
      assert.equal(signed.to_on_behalf, false)
      assert.equal(signed.to_signed_by, DRIVER_SUP)
      assert.equal(signed.latitude, 21.4858)
      assert.equal(signed.location_status, 'captured')
      assert.equal(signed.approval_status, 'pending_supervisor')
      assert.ok(signed.to_signed_at && signed.frozen_at)
      await as(db, TABLET_SUP)
      await rejects(sign(db, h.id, 'receiving', { lat: 99, lng: 1, onBehalf: true }), '22023')
      await as(db, CAPTURER)
    })

    await t.test('the record is frozen once signed, even for edits of damage and odometer', async () => {
      await rejects(db.query('update handover_reports set odometer_km = 2000 where id = $1', [signed.id]), '42501')
      await rejects(db.query("update handover_reports set damages = '[{\"n\":1}]'::jsonb, damage_count = 1 where id = $1", [signed.id]), '42501')
      await rejects(db.query("update handover_reports set photos = '[\"x\"]'::jsonb where id = $1", [signed.id]), '42501')
      await rejects(db.query('update handover_reports set to_signature = $2 where id = $1', [signed.id, SIG.replace('M0 0', 'M1 1')]), '42501')
      await rejects(db.query('delete from handover_reports where id = $1', [signed.id]), '42501')
      // A half signed record is frozen too.
      const h = await newHandover(db)
      await as(db, TABLET_SUP)
      await sign(db, h.id, 'handing', { onBehalf: true })
      await as(db, CAPTURER)
      await rejects(db.query('update handover_reports set odometer_km = 5 where id = $1', [h.id]), '42501')
      // An unsigned draft is still editable.
      const d = await newHandover(db)
      await db.query('update handover_reports set odometer_km = 1200 where id = $1', [d.id])
    })

    await t.test('approval needs both signatures and cannot be given by a signing driver', async () => {
      const unsigned = await newHandover(db, { approval_status: 'pending_supervisor' })
      await as(db, SUPERVISOR)
      await rejects(db.query('select decide_handover_approval($1, true, $2, null)', [unsigned.id, SIG]), '22023')
      await as(db, DRIVER_SUP)
      await rejects(db.query('select decide_handover_approval($1, true, $2, null)', [signed.id, SIG]), '42501')
      await rejects(db.query("select decide_handover_approval($1, false, null, 'nope')", [signed.id]), '42501')
      await as(db, SUPERVISOR)
      const r = (await one(db, 'select decide_handover_approval($1, true, $2, null) r', [signed.id, SIG])).r
      assert.equal(r.status, 'pending_incharge')
      await as(db, INCHARGE)
      const r2 = (await one(db, 'select decide_handover_approval($1, true, $2, null) r', [signed.id, SIG])).r
      assert.equal(r2.status, 'approved')
      const row = await one(db, 'select * from handover_reports where id = $1', [signed.id])
      assert.equal(row.supervisor_by, SUPERVISOR)
      assert.equal(row.incharge_by, INCHARGE)
      assert.equal(row.odometer_km, '1000')
      await as(db, CAPTURER)
    })

    await t.test('RLS keeps another organisation out', async () => {
      await as(db, OUTSIDER)
      assert.equal((await one(db, 'select count(*)::int n from handover_reports')).n, 0)
      assert.equal((await one(db, 'select count(*)::int n from handover_report_events')).n, 0)
      await rejects(sign(db, signed.id, 'handing', { onBehalf: true }), '22023')
      await rejects(db.query('select decide_handover_approval($1, true, $2, null)', [signed.id, SIG]))
      await as(db, CAPTURER)
    })

    await t.test('only the linked driver or a supervisor on behalf may sign (H4)', async () => {
      const h = await newHandover(db)
      // A plain capture account cannot sign for a driver, with or without the flag.
      await rejects(sign(db, h.id, 'handing'), '42501')
      await rejects(sign(db, h.id, 'handing', { onBehalf: true }), '42501')
      // A supervisor must say it is signing on behalf.
      await as(db, TABLET_SUP)
      await rejects(sign(db, h.id, 'handing'), '42501')
      // A driver on this handover cannot sign on behalf of the other driver.
      await as(db, DRIVER_SUP)
      await rejects(sign(db, h.id, 'handing', { onBehalf: true }), '42501')
      // The handing driver signs with their own account, then cannot sign for the receiver.
      await as(db, FROM_SUP)
      const r1 = (await sign(db, h.id, 'handing')).r
      assert.equal(r1.on_behalf, false)
      await rejects(sign(db, h.id, 'receiving', { onBehalf: true }), '42501')
      await as(db, CAPTURER)
      // One supervisor may collect both signatures only when both are on behalf.
      const both = await newHandover(db)
      await as(db, TABLET_SUP)
      await sign(db, both.id, 'handing', { onBehalf: true })
      const r2 = (await sign(db, both.id, 'receiving', { onBehalf: true })).r
      assert.equal(r2.on_behalf, true)
      await as(db, CAPTURER)
      const ev = (await db.query("select changes from handover_report_events where handover_id = $1 and action = 'signed_handing'", [both.id])).rows[0]
      assert.equal(ev.changes.from_on_behalf.new, true)
    })

    await t.test('signatures must match the strict signature shape', async () => {
      const h = await newHandover(db)
      await as(db, TABLET_SUP)
      await rejects(sign(db, h.id, 'handing', { signature: '<svg onload="alert(1)"></svg>', onBehalf: true }), '22023')
      await rejects(sign(db, h.id, 'handing', { signature: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L5 5"/></svg>', onBehalf: true }), '22023')
      await rejects(sign(db, h.id, 'handing', { signature: 'data:image/svg+xml;base64,PHN2Zz4=', onBehalf: true }), '22023')
      const ok = (await sign(db, h.id, 'handing', { signature: PNG, onBehalf: true })).r
      assert.equal(ok.ok, true)
      await as(db, CAPTURER)
    })

    await t.test('the approver may not be a signer or the creator', async () => {
      await as(db, SUPERVISOR)
      const mine = await newHandover(db)
      await signBoth(db, mine.id, SUPERVISOR)
      await rejects(db.query('select decide_handover_approval($1, true, $2, null)', [mine.id, SIG]), '42501')
      await rejects(db.query("select decide_handover_approval($1, false, null, 'no')", [mine.id]), '42501')
      await as(db, CAPTURER)
      const h = await newHandover(db)
      await signBoth(db, h.id)
      await as(db, TABLET_SUP) // collected the handing signature
      await rejects(db.query('select decide_handover_approval($1, true, $2, null)', [h.id, SIG]), '42501')
      await as(db, CAPTURER)
    })

    await t.test('driver ids must belong to this organisation and country (M5)', async () => {
      await rejects(newHandover(db, { from_driver_id: DRV_OTHER_ORG }), '22023')
      await rejects(newHandover(db, { to_driver_id: DRV_UAE }), '22023')
      await rejects(newHandover(db, { to_driver_id: DRV_FROM }), '22023') // same driver both sides
      const h = await newHandover(db, { to_driver_id: null })
      await rejects(db.query('update handover_reports set to_driver_id = $2 where id = $1', [h.id, DRV_OTHER_ORG]), '22023')
    })

    await t.test('sending back clears the signatures and returns the record to draft (M6)', async () => {
      const h = await newHandover(db)
      await signBoth(db, h.id)
      await as(db, SUPERVISOR)
      const r = (await one(db, "select decide_handover_approval($1, false, null, 'Odometer is wrong') r", [h.id])).r
      assert.equal(r.status, 'draft')
      assert.equal(r.signatures_cleared, true)
      await as(db, CAPTURER)
      const row = await one(db, 'select * from handover_reports where id = $1', [h.id])
      assert.equal(row.approval_status, 'draft')
      assert.equal(row.review_note, 'Odometer is wrong')
      for (const k of ['from_signature', 'from_signed_at', 'from_signed_by', 'from_on_behalf', 'to_signature',
        'to_signed_at', 'to_signed_by', 'frozen_at', 'latitude', 'location_status']) assert.equal(row[k], null, k)
      // Correctable and re-signable.
      await db.query('update handover_reports set odometer_km = 1010 where id = $1', [h.id])
      await signBoth(db, h.id)
      const again = await one(db, 'select approval_status, odometer_km from handover_reports where id = $1', [h.id])
      assert.equal(again.approval_status, 'pending_supervisor')
      assert.equal(again.odometer_km, '1010')
      const ev = (await db.query("select changes from handover_report_events where handover_id = $1 and action = 'sent_back'", [h.id])).rows
      assert.equal(ev.length, 1)
      assert.equal(ev[0].changes.review_note.new, 'Odometer is wrong')
      assert.equal(ev[0].changes.to_signature.old, 'signed')
      assert.equal(ev[0].changes.to_signature.new, null)
      // Sent back after the supervisor signed: the supervisor signature goes too.
      await as(db, SUPERVISOR)
      await db.query('select decide_handover_approval($1, true, $2, null)', [h.id, SIG])
      await as(db, INCHARGE)
      await db.query("select decide_handover_approval($1, false, null, 'Photos missing')", [h.id])
      const row2 = await one(db, 'select approval_status, supervisor_signature, supervisor_by, to_signed_at from handover_reports where id = $1', [h.id])
      assert.equal(row2.approval_status, 'draft')
      assert.equal(row2.supervisor_signature, null)
      assert.equal(row2.supervisor_by, null)
      assert.equal(row2.to_signed_at, null)
      // A signed record waiting for sign-off is still frozen.
      await as(db, CAPTURER)
      await signBoth(db, h.id)
      await rejects(db.query('update handover_reports set odometer_km = 1 where id = $1', [h.id]), '42501')
      // A client cannot clear signatures with a plain update.
      await rejects(db.query('update handover_reports set to_signature = null, to_signed_at = null where id = $1', [h.id]), '42501')
    })

    await t.test('the audit trail keeps the record country and site scope (M2)', async () => {
      const count = async () => (await one(db, 'select count(*)::int n from handover_report_events where handover_id = $1', [signed.id])).n
      await as(db, SUPERVISOR)
      assert.ok((await count()) > 0)
      await as(db, RIYADH_USER)
      assert.equal(await count(), 0)
      await as(db, UAE_USER)
      assert.equal(await count(), 0)
      await as(db, CAPTURER)
    })

    await t.test('site scope applies to reads and writes', async () => {
      await rejects(newHandover(db, { site: 'RIYADH' }))
      const visible = await one(db, "select count(*)::int n from handover_reports where site = 'RIYADH'")
      assert.equal(visible.n, 0)
    })

    await t.test('every change is in an append-only audit trail', async () => {
      const events = (await db.query('select action, actor from handover_report_events where handover_id = $1 order by at, action', [signed.id])).rows
      const actions = events.map((e) => e.action)
      for (const a of ['created', 'signed_handing', 'signed_receiving', 'decision_pending_incharge', 'decision_approved']) {
        assert.ok(actions.includes(a), `missing ${a} in ${actions.join(',')}`)
      }
      await rejects(db.query('delete from handover_report_events'))
      await rejects(db.query("update handover_report_events set action = 'x'"))
      await rejects(db.query("insert into handover_report_events(handover_id, action) values ($1, 'x')", [signed.id]))
    })
  } finally {
    await db.close()
  }
})
