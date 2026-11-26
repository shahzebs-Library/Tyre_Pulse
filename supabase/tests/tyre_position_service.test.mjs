import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

// SQL mirror of src/lib/tyrePositionService.js, replayed over the SAME fixture the JS
// test reads (src/test/fixtures/tyrePositionCases.json). The JS test proves the fixture's
// generated matrix is what the JS returns; this proves the SQL returns the same, row for row.
// The draft is loaded as written, from supabase/pending_migrations (it is NOT applied anywhere).

const SQL = readFileSync(new URL('../pending_migrations/20261116090000_tyre_position_service.sql', import.meta.url), 'utf8')
const fixture = JSON.parse(readFileSync(new URL('../../src/test/fixtures/tyrePositionCases.json', import.meta.url), 'utf8'))

const TABLES = readFileSync(new URL('../pending_migrations/20261116085000_tyre_layout_versions_and_position_mappings.sql', import.meta.url), 'utf8')
// The shared tyre map's pump codes and aliases (applied after the drafts, as on the live database).
const SPEC_ALIASES = readFileSync(new URL('../migrations/20261126181000_tyre_position_erp_spec_aliases.sql', import.meta.url), 'utf8')

async function createDb () {
  const db = new PGlite()
  // Minimal platform stubs; the drafts themselves are loaded exactly as written.
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; create schema anum_integration;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function public.app_current_org() returns uuid language sql stable as $$ select nullif(current_setting('test.org', true), '')::uuid $$;
    create function public.app_is_active() returns boolean language sql stable as $$ select true $$;
    create function public.app_is_org_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), '') = 'on' $$;
    create function anum_integration.apply_reader_policies() returns void language sql as $$ select $$;
    create table public.vehicle_fleet (id uuid primary key default gen_random_uuid(), organisation_id uuid not null,
      asset_no text not null, country text, vehicle_type text, axle_count smallint);
    create table public.vehicle_diagram_configs (id uuid primary key default gen_random_uuid(), organisation_id uuid not null,
      vehicle_type text not null, config jsonb not null, active boolean not null default true, created_by uuid,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());`)
  await db.exec(TABLES)
  await db.exec(SQL)
  await db.exec(SPEC_ALIASES)
  return db
}

// Verified mappings ride on the layout exactly as tyre_type_layout attaches them.
const layoutSql = `(public.tyre_layout_for($1, $2, $3::integer, $4::jsonb, $5::date, $6::date)
  || case when $7::jsonb is null then '{}'::jsonb else jsonb_build_object('mappings', $7::jsonb) end)`
const layoutArgs = d => [d.vehicleType ?? null, d.assetNo ?? null, d.axleCount ?? null,
  d.custom ? JSON.stringify(d.custom) : null, d.customChanged ?? null, d.asOf ?? null,
  d.mappings ? JSON.stringify(d.mappings.map(m => ({ code: String(m.erp_code).toUpperCase().replace(/\s+/g, ''), slot: m.slot }))) : null]

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
    await db.query(`insert into lay select $8, ${layoutSql}`, [...layoutArgs(d), d.id])
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
    const r = (await db.query(`select public.tyre_position_resolve(${layoutSql}, $8, $9) v`,
      [...layoutArgs(byId[c.layout]), c.token, c.kind])).rows[0].v
    const label = `${c.layout} ${JSON.stringify(c.token)} ${c.kind}`
    assert.equal(r.status, c.expect.status, label)
    assert.equal(r.canonical ?? null, c.expect.canonical, label)
    if (c.expect.reason) assert.equal(r.reason, c.expect.reason, label)
  }
  for (const c of fixture.compare) {
    const r = (await db.query(`select public.tyre_position_compare(${layoutSql}, $8, $9) v`,
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
  // ---- layout versions: an edit opens a new version, an old record keeps its old layout.
  const cfg = n => JSON.stringify({ axles: [{ kind: 'steer' }, ...Array.from({ length: n }, () => ({ kind: 'drive', dual: true }))], spare: 0 })
  await db.exec(`insert into public.vehicle_diagram_configs (organisation_id, vehicle_type, config) values ('${ORG}', 'tr-mixer', '${cfg(1)}')`)
  await db.exec(`update public.vehicle_diagram_configs set config = '${cfg(2)}' where organisation_id = '${ORG}'`)
  await db.exec(`update public.vehicle_diagram_configs set updated_at = now() where organisation_id = '${ORG}'`) // no layout change: no version
  const vers = (await db.query(`select count(*)::int n, count(valid_to)::int closed from public.vehicle_diagram_config_versions`)).rows[0]
  assert.deepEqual(vers, { n: 2, closed: 1 }, 'an edit opens a new version and closes the old one')
  await assert.rejects(db.exec(`update public.vehicle_diagram_config_versions set config = '{}'`), /append-only/)
  await assert.rejects(db.exec(`delete from public.vehicle_diagram_config_versions`), /append-only/)
  // Place the two versions in time (test set-up only: the guard is bypassed as a replica).
  await db.exec(`set session_replication_role = replica;
    update public.vehicle_diagram_config_versions set valid_from = '2026-01-10', valid_to = '2026-06-01' where valid_to is not null;
    update public.vehicle_diagram_config_versions set valid_from = '2026-06-01' where valid_to is null;
    set session_replication_role = origin;`)
  const at = async d => (await db.query(`select public.tyre_asset_layout($1, 'KSA', 'TM001', null, $2::date) v`, [ORG, d])).rows[0].v
  assert.equal((await at('2026-03-01')).wheels.length, 6, 'an old inspection resolves on the layout in force then')
  assert.equal((await at('2026-07-01')).wheels.length, 10, 'a new one on the current layout')
  assert.equal((await at(null)).wheels.length, 10)
  assert.equal((await at('2026-06-01')).changed_after_record, true, 'edited on the record day: not trusted')
  assert.equal((await at('2025-12-01')).key, 'Tri-mixer', 'before the admin layout existed: built-in layout')
  await db.exec(`set session_replication_role = replica;
    update public.vehicle_diagram_config_versions set basis = 'backfill' where valid_from = '2026-01-10';
    set session_replication_role = origin;`)
  const before = await at('2025-12-01')
  assert.equal(before.changed_after_record, true, 'before a backfilled version nothing is known')
  assert.equal((await db.query(`select public.tyre_position_resolve($1::jsonb, 'F1L', 'slot') v`, [JSON.stringify(before)])).rows[0].v.status, 'ambiguous')
  assert.equal((await key(OTHER, 'KSA', 'TM001')).key, 'Pickup', 'another tenant never sees our layout versions')

  // ---- verified per-layout mappings: empty by default, data not code.
  const res = async (asset, token) => (await db.query(
    `select public.tyre_position_resolve(public.tyre_asset_layout($1, 'KSA', $2, null, null), $3, 'erp') v`, [ORG, asset, token])).rows[0].v
  assert.equal((await db.query(`select count(*)::int n from public.tyre_layout_position_mappings`)).rows[0].n, 0)
  await db.exec(`insert into public.vehicle_fleet (organisation_id, asset_no, country, vehicle_type, axle_count) values ('${ORG}', 'MP005', 'KSA', 'PUMPS', 5)`)
  assert.equal((await res('MP005', 'LHR3-O')).reason, 'erp_spelling_not_verified', 'a pump rear spelling the tyre map does not name stays pending with no mapping')
  await db.exec(`insert into public.tyre_layout_position_mappings (organisation_id, layout_key, erp_code, slot, evidence, verified_by)
    values ('${ORG}', 'Concrete pump', 'LHR3-O', 'R1Lo', 'Checked against the axle diagram and two known replacements', '${ORG}')`)
  assert.equal((await res('MP005', 'LHRCO')).reason, 'tyre_map_code', 'the shared tyre map names LHRCO on the pump')
  const mapped = await res('MP005', 'LHR3-O')
  assert.deepEqual([mapped.status, mapped.reason, mapped.slot], ['resolved', 'verified_mapping', 'R1Lo'])
  assert.equal((await res('MP001', 'LHR3-O')).status, 'ambiguous', 'the 4 axle build is another layout: no leak')
  await assert.rejects(db.exec(`update public.tyre_layout_position_mappings set slot = 'R2Lo'`), /cannot be rewritten/)
  await db.exec(`update public.tyre_layout_position_mappings set active = false`)
  assert.equal((await res('MP005', 'LHR3-O')).status, 'ambiguous', 'switched off: pending again')
  await db.close()
})
