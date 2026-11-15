import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

// SQL mirror of src/lib/tyrePositionService.js, replayed over the SAME fixture the JS
// test reads (src/test/fixtures/tyrePositionCases.json). The JS test proves the fixture's
// generated matrix is what the JS returns; this proves the SQL returns the same, row for row.
// The draft is loaded as written, from supabase/pending_migrations (it is NOT applied anywhere).

const SQL = readFileSync(new URL('../pending_migrations/20261115110000_tyre_position_service.sql', import.meta.url), 'utf8')
const fixture = JSON.parse(readFileSync(new URL('../../src/test/fixtures/tyrePositionCases.json', import.meta.url), 'utf8'))

async function createDb () {
  const db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create table public.vehicle_fleet (id uuid primary key default gen_random_uuid(), organisation_id uuid not null,
      asset_no text not null, country text, vehicle_type text, axle_count smallint);
    create table public.vehicle_diagram_configs (id uuid primary key default gen_random_uuid(), organisation_id uuid not null,
      vehicle_type text not null, config jsonb not null, active boolean not null default true,
      updated_at timestamptz not null default now());`)
  await db.exec(SQL)
  return db
}

const layoutSql = `public.tyre_layout_for($1, $2, $3::integer, $4::jsonb, $5::date, $6::date)`
const layoutArgs = d => [d.vehicleType ?? null, d.assetNo ?? null, d.axleCount ?? null,
  d.custom ? JSON.stringify(d.custom) : null, d.customChanged ?? null, d.asOf ?? null]

test('fixture layouts resolve in SQL as they do in JS', async () => {
  const db = await createDb()
  for (const d of fixture.layouts) {
    const r = (await db.query(`select ${layoutSql} v`, layoutArgs(d))).rows[0].v
    assert.equal(r.status, d.expect.status, d.id)
    assert.equal(r.key ?? null, d.expect.key, d.id)
    assert.equal(r.wheels.length, d.expect.wheels, d.id)
    if (d.expect.reason) assert.equal(r.reason, d.expect.reason, d.id)
  }
  await db.close()
})

test('the whole generated matrix: SQL equals JS, case for case', async () => {
  const db = await createDb()
  assert.ok(fixture.matrix.length > 5000, 'the matrix is present')
  await db.exec(`create temp table lay (id text primary key, layout jsonb);
                 create temp table cases (n int, id text, token text, kind text);`)
  for (const d of fixture.layouts) {
    await db.query(`insert into lay select $7, ${layoutSql}`, [...layoutArgs(d), d.id])
  }
  await db.query(`insert into cases select (o)::int, r->>0, r->>1, r->>2
                  from jsonb_array_elements($1::jsonb) with ordinality as t(r, o)`, [JSON.stringify(fixture.matrix)])
  const got = (await db.query(`
    select c.n, public.tyre_position_resolve(l.layout, c.token, c.kind) v
    from cases c join lay l on l.id = c.id order by c.n`)).rows
  assert.equal(got.length, fixture.matrix.length)
  const diffs = []
  got.forEach((g, i) => {
    const [id, token, kind, status, reason, canonical, slot] = fixture.matrix[i]
    const v = g.v
    if (v.status !== status || v.reason !== reason || (v.canonical ?? null) !== canonical || (v.slot ?? null) !== slot) {
      diffs.push(`${id} ${JSON.stringify(token)} ${kind}: js ${status}/${reason}/${canonical}/${slot} sql ${v.status}/${v.reason}/${v.canonical}/${v.slot}`)
    }
  })
  assert.deepEqual(diffs.slice(0, 20), [], `${diffs.length} rows differ`)
  await db.close()
})

test('hand-pinned positions and comparisons hold in SQL', async () => {
  const db = await createDb()
  const byId = Object.fromEntries(fixture.layouts.map(l => [l.id, l]))
  for (const c of fixture.pinned) {
    const r = (await db.query(`select public.tyre_position_resolve(${layoutSql}, $7, $8) v`,
      [...layoutArgs(byId[c.layout]), c.token, c.kind])).rows[0].v
    const label = `${c.layout} ${JSON.stringify(c.token)} ${c.kind}`
    assert.equal(r.status, c.expect.status, label)
    assert.equal(r.canonical ?? null, c.expect.canonical, label)
    if (c.expect.reason) assert.equal(r.reason, c.expect.reason, label)
  }
  for (const c of fixture.compare) {
    const r = (await db.query(`select public.tyre_position_compare(${layoutSql}, $7, $8) v`,
      [...layoutArgs(byId[c.layout]), c.slot, c.erp])).rows[0].v
    const label = `${c.layout} ${c.slot} vs ${c.erp}`
    assert.equal(r.match ?? null, c.match, label)
    assert.equal(r.status, c.status, label)
    assert.equal(r.canonical ?? null, c.canonical, label)
  }
  await db.close()
})

test('the layout reader is closed to app roles and reads the right machine', async () => {
  const db = await createDb()
  const ORG = '00000000-0000-0000-0000-000000000901'
  const OTHER = '00000000-0000-0000-0000-000000000902'
  await db.exec(`
    insert into public.vehicle_fleet (organisation_id, asset_no, country, vehicle_type, axle_count) values
      ('${ORG}', 'TM001', 'KSA', 'TR-MIXER', null), ('${ORG}', 'MP001', 'KSA', 'PUMPS', 4),
      ('${ORG}', 'DU001', 'KSA', 'PICKUP', null), ('${ORG}', 'DU001', 'UAE', 'TR-MIXER', null),
      ('${OTHER}', 'TM001', 'KSA', 'PICKUP', null);`)
  const priv = (await db.query(`select
    has_function_privilege('anon', 'public.tyre_asset_layout(uuid,text,text,text,date)', 'execute') a,
    has_function_privilege('authenticated', 'public.tyre_asset_layout(uuid,text,text,text,date)', 'execute') b,
    has_function_privilege('anon', 'public.tyre_position_resolve(jsonb,text,text)', 'execute') c`)).rows[0]
  assert.deepEqual(priv, { a: false, b: false, c: false })
  const key = async (org, country, asset, vt = null) =>
    (await db.query(`select public.tyre_asset_layout($1, $2, $3, $4, null) v`, [org, country, asset, vt])).rows[0].v
  assert.equal((await key(ORG, 'KSA', 'TM001')).key, 'Tri-mixer')
  assert.equal((await key(OTHER, 'KSA', 'TM001')).key, 'Pickup', 'another tenant, another machine')
  assert.equal((await key(ORG, 'KSA', 'MP001')).key, 'Concrete pump 4-axle', 'the recorded build wins')
  assert.equal((await key(ORG, 'KSA', 'DU001')).key, 'Pickup')
  assert.equal((await key(ORG, 'UAE', 'DU001')).key, 'Tri-mixer', 'same code abroad is a different machine')
  assert.equal((await key(ORG, null, 'DU001')).reason, 'asset_not_unique')
  assert.equal((await key(ORG, 'KSA', 'ZZ404')).reason, 'unknown_vehicle_type', 'not in the register, no usable prefix')
  // An admin layout edited after the record date is not trusted for that record.
  await db.exec(`insert into public.vehicle_diagram_configs (organisation_id, vehicle_type, config, updated_at)
    values ('${ORG}', 'tr-mixer', '{"axles":[{"kind":"steer"},{"kind":"drive","dual":true}],"spare":1}', '2026-10-01')`)
  const custom = await key(ORG, 'KSA', 'TM001')
  assert.equal(custom.key, 'custom:TR-MIXER')
  assert.equal(custom.wheels.length, 7)
  const dated = (await db.query(`select public.tyre_asset_layout($1, 'KSA', 'TM001', null, '2026-09-01') v`, [ORG])).rows[0].v
  assert.equal(dated.changed_after_record, true)
  assert.equal((await db.query(`select public.tyre_position_resolve($1::jsonb, 'F1L', 'slot') v`, [JSON.stringify(dated)])).rows[0].v.status, 'ambiguous')
  await db.close()
})
