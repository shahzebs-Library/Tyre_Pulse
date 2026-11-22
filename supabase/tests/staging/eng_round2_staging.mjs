// Engineering round 2: the SQL drafts 20261113120000 to 125000, EXECUTED on the
// local staging database (real PostgreSQL 16, the production schema, synthetic
// companies). Never production. Every script ends in ROLLBACK.
//
//   supabase/tests/staging/eng_apply_drafts.sh          (rebuild tp_eng, apply drafts in order)
//   node --test supabase/tests/staging/eng_round2_staging.mjs
//
// Two databases are read:
//   BEFORE  tyrepulse_staging  the untouched baseline (function text = production)
//   AFTER   tp_eng             a copy of it with the six drafts applied
// The file is not named *.test.mjs on purpose: `npm run test:database` (PGlite, CI)
// must not pick it up, because CI has no staging cluster. With no cluster reachable
// every test here is skipped, not failed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIXTURE as fx, DB_AFTER, DB_BEFORE, psql, reachable, parseEmits, emit, asUser, HASH_SQL, num, fitId,
} from './eng_staging_lib.mjs'
import { goldenScript } from './eng_golden_sql.mjs'

const UP = reachable(DB_AFTER) && reachable(DB_BEFORE)
const t = (name, fn) => test(name, { skip: UP ? false : 'local staging cluster not reachable' }, fn)

const run = (db, sql) => {
  const r = psql(db, sql)
  assert.ok(r.ok, `psql failed on ${db}: ${r.err.slice(0, 2000)}`)
  return parseEmits(r.out)
}

// Synthetic users of the seeded company Alpha (non super admin Admin) and of the empty company Gamma.
const ALPHA_ADMIN = 'af52a86f-2c24-5ce2-a00d-7ac6ca5d715f'
const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const CURRENCY = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }
const PERIOD = ['2025-11-01', '2026-10-31']

let _golden
const golden = () => (_golden ||= {
  after: run(DB_AFTER, goldenScript({ withBreakdown: true })),
  before: run(DB_BEFORE, goldenScript({ withBreakdown: false })),
})

const callersScript = () => {
  let s = 'begin;\n' + asUser(ALPHA_ADMIN)
  for (const c of COUNTRIES) {
    s += emit(`fleet_${c}`, `public.get_fleet_cpk('${c}', '${PERIOD[0]}', '${PERIOD[1]}')`)
    s += emit(`overview_${c}`, `public.get_cost_cpk_overview('${c}', null, '${PERIOD[0]}', '${PERIOD[1]}') - 'generated_at'`)
    s += emit(`life_${c}`, `public.get_tyre_running_life('${c}', null, 0, null, false) - 'generated_at'`)
    s += emit(`kmsum_${c}`, `select jsonb_build_object('km', coalesce(sum(km_run), 0), 'assets', count(*))
        from public.fleet_km_by_asset('00000000-0000-0000-0000-000000000001'::uuid, '${c}', '${PERIOD[0]}', '${PERIOD[1]}')`)
  }
  s += emit('fleet_all', `public.get_fleet_cpk(null, '${PERIOD[0]}', '${PERIOD[1]}')`)
  s += emit('overview_all', `public.get_cost_cpk_overview(null, null, '${PERIOD[0]}', '${PERIOD[1]}') - 'generated_at'`)
  s += emit('lifetime_all', `public.get_tyre_lifetime_cpk(null, null, null, null)`)
  return s + 'rollback;\n'
}
let _callers
const callers = () => (_callers ||= { after: run(DB_AFTER, callersScript()), before: run(DB_BEFORE, callersScript()) })

// ── 1. The drafts ran, in order, on real Postgres ───────────────────────────
t('drafts 120000 to 125000 are applied on the staging copy and each saved the definition it replaced', () => {
  const r = run(DB_AFTER, `begin;
    ${emit('bak', `select jsonb_agg(fn order by fn) from _bak.fn_defs_eng_20261113`)}
    ${emit('marks', `select jsonb_build_object(
      'fleet', position('legacy_total_per_tyre_km' in pg_get_functiondef('public.get_fleet_cpk(text,date,date,text)'::regprocedure)) > 0,
      'overview', position('c_matched_tyre' in pg_get_functiondef('public.get_cost_cpk_overview(text,text,date,date)'::regprocedure)) > 0,
      'life', position('a.km_at_fitment = 0' in pg_get_functiondef('public.get_tyre_running_life(text,integer,integer,text,boolean)'::regprocedure)) > 0,
      'calc', position('tyre_km_life' in pg_get_functiondef('public.calc_cpk(numeric,numeric,numeric)'::regprocedure)) > 0,
      'unit', position('tractor head' in pg_get_functiondef('public.cpk_unit_for_asset_type(text)'::regprocedure)) > 0,
      'warranty', position('warrenty' in pg_get_functiondef('public.tyre_price_is_warranty(text)'::regprocedure)) > 0,
      'breakdown', to_regprocedure('public.get_tyre_spend_breakdown(text,date,date)') is not null,
      'vehicle_km', position('t.km_at_fitment > 1' in pg_get_functiondef('public.fleet_km_by_asset(uuid,text,date,date)'::regprocedure)) > 0)`)}
    ${emit('grants', `select jsonb_build_object(
      'anon', has_function_privilege('anon', 'public.get_tyre_spend_breakdown(text,date,date)', 'execute'),
      'auth', has_function_privilege('authenticated', 'public.get_tyre_spend_breakdown(text,date,date)', 'execute'),
      'definer', (select prosecdef from pg_proc where oid = 'public.get_tyre_spend_breakdown(text,date,date)'::regprocedure))`)}
    rollback;`)
  assert.deepEqual(r.bak, ['calc_cpk', 'cpk_unit_for_asset_type', 'fleet_km_by_asset', 'get_cost_cpk_overview(text,text,date,date)',
    'get_fleet_cpk(text,date,date,text)', 'get_tyre_running_life', 'metric_registry.fleet_cpk', 'tyre_price_is_warranty'])
  for (const [k, v] of Object.entries(r.marks)) assert.equal(v, true, `draft marker missing: ${k}`)
  assert.deepEqual(r.grants, { anon: false, auth: true, definer: false })
})

t('the baseline the drafts were executed on holds the production function text (md5 read from production, SELECT only, 2026-11-15)', () => {
  const r = run(DB_BEFORE, emit('md5', `select jsonb_build_object(
      'km', md5(pg_get_functiondef('public.fleet_km_by_asset(uuid,text,date,date)'::regprocedure)),
      'fleet', md5(pg_get_functiondef('public.get_fleet_cpk(text,date,date,text)'::regprocedure)),
      'overview', md5(pg_get_functiondef('public.get_cost_cpk_overview(text,text,date,date)'::regprocedure)),
      'life', md5(pg_get_functiondef('public.get_tyre_running_life(text,integer,integer,text,boolean)'::regprocedure)),
      'unit', md5(pg_get_functiondef('public.cpk_unit_for_asset_type(text)'::regprocedure)),
      'warranty', md5(pg_get_functiondef('public.tyre_price_is_warranty(text)'::regprocedure)))`))
  // calc_cpk is left out: production stores it with CRLF line ends, the baseline with LF. Same text otherwise;
  // the draft anchor sits on one line and was counted once on the production text.
  assert.deepEqual(r.md5, {
    km: 'b9caf48b4c5d4d34fb49cb7f7bde52c0', fleet: 'a94b6042000fe17f23bae5a299d3ccde',
    overview: '37bcd146906af0a8bbcbdf56afa04777', life: '9ae17c2e6a019930580a829169ab12c4',
    unit: '2894967636f8a3f49c22a445e39cb72c', warranty: 'e599a8eefb86ad3d3c322b872d5f7c36',
  })
})

// ── 2. No stored row changed ────────────────────────────────────────────────
t('no existing row changes: every public table hashes the same before and after (registry tables aside)', () => {
  const a = run(DB_AFTER, `begin;\n${HASH_SQL}\nrollback;`).hash
  const b = run(DB_BEFORE, `begin;\n${HASH_SQL}\nrollback;`).hash
  const tables = Object.keys(b)
  assert.ok(tables.length > 400, 'expected the whole public schema')
  assert.ok(tables.filter((k) => b[k][0] > 0).length >= 25, 'expected seeded tables with rows')
  assert.deepEqual(Object.keys(a).sort(), tables.sort())
  const changed = tables.filter((k) => a[k][0] !== b[k][0] || a[k][1] !== b[k][1])
  assert.deepEqual(changed, [])
})

t('the only table writes are the metric registry: one row renamed, four added, one version added', () => {
  const q = `begin;
    ${emit('reg', `select jsonb_object_agg(metric_id, name) from public.metric_registry`)}
    ${emit('ver', `select jsonb_agg(metric_id || ':' || version order by version) from public.metric_versions where metric_id = 'fleet_cpk'`)}
    rollback;`
  const a = run(DB_AFTER, q); const b = run(DB_BEFORE, q)
  const added = Object.keys(a.reg).filter((k) => !(k in b.reg)).sort()
  assert.deepEqual(added, ['maintenance_cost_per_vehicle_km', 'operating_cost_per_vehicle_km', 'tyre_cost_per_vehicle_km', 'tyre_cpk_lifetime'].sort())
  const renamed = Object.keys(b.reg).filter((k) => a.reg[k] !== b.reg[k])
  assert.deepEqual(renamed, ['fleet_cpk'])
  assert.match(a.reg.fleet_cpk, /^Tyre spend ratio/)
  assert.deepEqual(b.ver, ['fleet_cpk:1'])
  assert.deepEqual(a.ver, ['fleet_cpk:1', 'fleet_cpk:2'])
})

// ── 3. Old callers ──────────────────────────────────────────────────────────
// Walk two payloads; report every path whose value differs or is missing after.
function diffs(b, a, path = '') {
  const out = []
  if (Array.isArray(b) && Array.isArray(a) && b.length === a.length) {
    b.forEach((x, i) => out.push(...diffs(x, a[i], `${path}/#`)))
  } else if (b && a && typeof b === 'object' && typeof a === 'object' && !Array.isArray(b) && !Array.isArray(a)) {
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (!(k in a)) out.push(`${path}/${k} REMOVED`)
      else if (!(k in b)) out.push(`${path}/${k} ADDED`)
      else out.push(...diffs(b[k], a[k], `${path}/${k}`))
    }
  } else if (JSON.stringify(b) !== JSON.stringify(a)) out.push(`${path} CHANGED`)
  return out
}

t('get_fleet_cpk: an old caller keeps every key and every value except cpk_total on km rows (now null, old value kept beside it)', () => {
  const { before, after } = callers()
  for (const c of COUNTRIES) {
    const b = before[`fleet_${c}`]; const a = after[`fleet_${c}`]
    const kinds = new Set(diffs(b, a))
    assert.ok(![...kinds].some((d) => d.endsWith('REMOVED')), `${c}: a key was removed`)
    const allowed = new Set([
      '/fleet/#/km/cpk_total CHANGED', '/fleet/#/km/legacy_total_per_tyre_km ADDED', '/fleet/#/km/metric ADDED', '/fleet/#/km/km_basis ADDED',
      '/by_type/#/cpk_total CHANGED', '/by_type/#/legacy_total_per_tyre_km ADDED', '/by_type/#/rate_metric ADDED',
      '/per_vehicle/#/cpk_total CHANGED', '/per_vehicle/#/legacy_total_per_tyre_km ADDED', '/per_vehicle/#/rate_metric ADDED',
    ])
    assert.deepEqual([...kinds].filter((d) => !allowed.has(d)), [], `${c}: unexpected change`)

    // row by row: km rows moved the old figure to the legacy key; hour rows are untouched
    const pair = (bRows, aRows) => bRows.forEach((br, i) => {
      const ar = aRows[i]
      assert.equal(ar.cpk_tyre, br.cpk_tyre)
      if (br.unit === 'km') {
        assert.equal(ar.cpk_total, null)
        assert.equal(ar.legacy_total_per_tyre_km, br.cpk_total)
        assert.equal(ar.rate_metric, 'tyre_spend_ratio')
      } else {
        assert.equal(ar.cpk_total, br.cpk_total)
        assert.equal(ar.legacy_total_per_tyre_km, null)
        assert.equal(ar.rate_metric, 'operating_cost_per_engine_hour')
      }
    })
    pair(b.per_vehicle, a.per_vehicle); pair(b.by_type, a.by_type)
    assert.ok(b.per_vehicle.some((r) => r.unit === 'km' && r.cpk_total != null), `${c}: the seed must exercise a km row`)
    const fb = b.fleet[0]; const fa = a.fleet[0]
    assert.equal(fa.km.cpk_total, null)
    assert.equal(fa.km.legacy_total_per_tyre_km, fb.km.cpk_total)
    assert.equal(fa.km.cpk_tyre, fb.km.cpk_tyre)
    assert.equal(fa.km.metric, 'tyre_spend_ratio')
    assert.deepEqual(fa.hours, fb.hours)
    assert.equal(fa.currency, CURRENCY[c])
  }
})

t('get_cost_cpk_overview: every old key survives; everything outside the cpk block is identical; the split adds up', () => {
  const { before, after } = callers()
  for (const c of COUNTRIES) {
    const b = before[`overview_${c}`]; const a = after[`overview_${c}`]
    const d = diffs(b, a)
    assert.ok(!d.some((x) => x.endsWith('REMOVED')), `${c}: a key was removed`)
    // Outside `cpk` nothing moves. Inside it draft 125000 may lower km (placeholder readings) and what follows from km.
    assert.deepEqual(d.filter((x) => !x.startsWith('/cpk/')), [], `${c}: change outside cpk`)
    for (const w of ['current', 'previous', 'last_year']) {
      const x = a.cpk[w]; const y = b.cpk[w]
      assert.equal(x.spend_total, y.spend_total)
      assert.ok(x.km <= y.km, 'vehicle km can only fall when placeholder readings are refused')
      assert.equal(x.metric, 'operating_cost_per_vehicle_km')
      assert.equal(x.spend_matched_tyre + x.spend_matched_maintenance, x.spend_matched)
      if (x.km > 0) {
        assert.equal(x.cpk, Math.round((x.spend_matched / x.km) * 1000) / 1000)
        assert.equal(x.cpk_tyre, Math.round((x.spend_matched_tyre / x.km) * 1000) / 1000)
        assert.equal(x.cpk_maintenance, Math.round((x.spend_matched_maintenance / x.km) * 1000) / 1000)
      } else {
        // NULL, never 0, when nothing is measurable
        assert.equal(x.cpk, null); assert.equal(x.cpk_tyre, null); assert.equal(x.cpk_maintenance, null)
      }
    }
    // the overview km is the vehicle km function, to the km
    assert.equal(a.cpk.current.km, num(after[`kmsum_${c}`].km))
    assert.equal(a.cpk.current.assets_measured, num(after[`kmsum_${c}`].assets))
  }
})

t('get_tyre_running_life: same tyres and same keys for an old caller', () => {
  const { before, after } = callers()
  for (const c of COUNTRIES) {
    const b = before[`life_${c}`]; const a = after[`life_${c}`]
    assert.equal(a.total, b.total)
    const keyset = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r)))].sort()
    assert.deepEqual(keyset(a.rows), keyset(b.rows))
    assert.deepEqual(a.rows.map((r) => r.serial_no).sort(), b.rows.map((r) => r.serial_no).sort())
  }
})

t('currency is never blended: the all countries call returns one row per country, each in its own currency, and no fleet wide scalar', () => {
  const { after } = callers()
  const f = after.fleet_all.fleet
  assert.deepEqual(f.map((r) => `${r.country}:${r.currency}`).sort(), ['Egypt:EGP', 'KSA:SAR', 'UAE:AED'])
  for (const r of f) {
    const one = after[`fleet_${r.country}`].fleet[0]
    assert.equal(r.km.cpk_tyre, one.km.cpk_tyre) // the all view is the per country figure, not a blend
    assert.equal(r.km.cpk_total, null)
  }
  for (const k of ['cpk_tyre', 'cpk_total', 'tyre_cost', 'total_cost']) assert.equal(after.fleet_all[k], undefined)
  for (const r of after.fleet_all.per_vehicle) assert.equal(r.currency, CURRENCY[r.country])
  assert.deepEqual(after.lifetime_all.countries.map((x) => x.country).sort(), ['Egypt', 'KSA', 'UAE'])
  assert.equal(after.lifetime_all.cpk_purchase, undefined)
  // the overview refuses a currency when more than one country is in scope
  assert.equal(after.overview_all.currency ?? null, null)
})

// ── 4. Golden fixture: hand answers, SQL side ───────────────────────────────
t('golden: km of each fitment by the single rule (placeholder, factory zero, class caps)', () => {
  const g = golden().after
  for (const f of fx.fitments.filter((x) => x.expect)) {
    assert.equal(num(g.fit[fitId(f.n)].km), f.expect.km, f.tag)
  }
  assert.deepEqual(g.pure_km.map(num), fx.pure.km_life.map((c) => c.km))
  // the km rule itself needed no draft: identical on the baseline
  assert.deepEqual(golden().before.pure_km.map(num), fx.pure.km_life.map((c) => c.km))
})

t('golden: Tyre CPK (lifetime) is weighted, one price per tyre, overlap adds no km, per country', () => {
  for (const g of [golden().after, golden().before]) {
    const by = Object.fromEntries(g.lifetime.countries.map((c) => [c.country, c.final]))
    for (const c of ['KSA', 'UAE']) {
      const e = fx.expected.lifetime[c]
      assert.equal(by[c].tyres, e.final_tyres)
      assert.equal(by[c].measurable, e.measurable)
      assert.equal(num(by[c].purchase_cost), e.purchase_cost)
      assert.equal(num(by[c].km), e.km)
      assert.equal(num(by[c].cpk_purchase), e.cpk_purchase)
    }
    assert.notEqual(num(by.KSA.cpk_purchase), fx.expected.lifetime.mean_of_fitment_ratios_KSA)
    for (const [key, e] of Object.entries(fx.expected.lifetime.per_tyre)) {
      const v = g.tyres[key]
      assert.equal(num(v.cost), e.cost, key); assert.equal(num(v.km), e.km, key)
      assert.equal(v.fitments, e.fitments, key); assert.equal(v.status, e.status, key); assert.equal(v.coverage, e.coverage, key)
    }
  }
})

t('golden: C29 and fitment CPK. calc_cpk refuses the placeholder after draft 122000, and gave 0.0098 before', () => {
  const { after, before } = golden()
  assert.deepEqual(after.pure_cpk.map(num), fx.pure.calc_cpk.map((c) => c.cpk))
  assert.equal(num(before.pure_cpk[1]), 0.0098) // C29 reproduced on the production text
  assert.equal(num(before.pure_cpk[5]), 0.0164) // over the cap, also priced before
  // on stored rows: the placeholder row loses its row CPK, the others keep theirs
  assert.equal(num(before.fit[fitId(3)].calc_cpk), 0.025)
  assert.equal(after.fit[fitId(3)].calc_cpk, null)
  for (const n of [1, 2, 4, 6, 11, 13, 16]) assert.equal(after.fit[fitId(n)].calc_cpk, before.fit[fitId(n)].calc_cpk)
})

t('golden: C20b. road vehicles with a plant word are km after draft 123000; hour machines stay on hours', () => {
  const { after, before } = golden()
  assert.deepEqual(after.pure_unit, fx.pure.unit.map((c) => c.unit))
  const idx = (ty) => fx.pure.unit.findIndex((c) => c.type === ty)
  for (const ty of ['WATER TANKER', 'LOW LOADER TRAILER', 'CONCRETE MIXER TRUCK']) assert.equal(before.pure_unit[idx(ty)], 'engine_hours')
  for (const ty of ['TR-MIXER', 'PUMPS', 'WHEEL LOADER', 'GENERATOR', 'TRAILER', 'PICKUP']) assert.equal(before.pure_unit[idx(ty)], after.pure_unit[idx(ty)])
})

t('golden: C23b, warranty zero and repair is not a price (draft 124000)', () => {
  const { after, before } = golden()
  fx.pure.lines.forEach((l, i) => {
    assert.equal(after.pure_lines[i].warranty, l.warranty, l.text)
    assert.equal(after.pure_lines[i].repair, l.repair, l.text)
  })
  assert.equal(before.pure_lines[2].warranty, false) // WARRENTY missed on the production text
  assert.equal(before.pure_lines[3].warranty, false)
  assert.deepEqual(after.line_kinds, fx.expense_lines.map((l) => l.expect_kind))

  const e = fx.expected.price_backfill_dry_run_KSA
  assert.equal(after.backfill.dry_run, true)
  assert.equal(after.backfill.rows, e.rows)
  for (const [serial, x] of Object.entries(e.by_serial)) {
    assert.equal(num(after.backfill_rows[serial].new_cost), x.new_cost, serial)
    assert.equal(after.backfill_rows[serial].source, x.source, serial)
  }
  for (const serial of e.not_filled) assert.equal(after.backfill_rows[serial], undefined)
  // before: the misspelt warranty tyre was priced from a comparable tyre instead of a confirmed zero
  assert.equal(num(before.backfill_rows.GLD10008.new_cost), e.before_draft_GLD10008.new_cost)
  assert.equal(before.backfill_rows.GLD10008.source, e.before_draft_GLD10008.source)
  // money per country only
  assert.deepEqual(Object.keys(after.backfill.by_country), ['KSA'])
})

t('golden: tyre spend breakdown splits purchase from repair, tube and service, per country and currency', () => {
  const rows = golden().after.breakdown
  const got = {}
  for (const r of rows) { (got[r.country] ||= { currency: r.currency })[r.kind] = num(r.amount) }
  assert.deepEqual(got, fx.expected.tyre_spend_breakdown)
  assert.equal(rows.filter((r) => r.kind === 'warranty').length, 0) // a zero line is not spend
})

t('golden: running life bands for km and hours, whichever runs out first (draft 121000)', () => {
  const { after, before } = golden()
  const rows = Object.fromEntries(after.running.rows.map((r) => [r.serial_no, r]))
  for (const [serial, e] of Object.entries(fx.expected.running_life.rows)) {
    const r = rows[serial]
    assert.ok(r, serial)
    for (const k of ['km_run', 'expected_life_km', 'remaining_km', 'life_used_pct', 'hours_run', 'expected_life_hours', 'remaining_hours', 'hours_used_pct']) {
      if (k in e) assert.equal(num(r[k]), e[k], `${serial} ${k}`)
    }
    if (e.unit) assert.equal(r.unit, e.unit)
    if (e.life_basis) { assert.equal(r.life_basis, e.life_basis); assert.equal(num(r.life_sample), e.life_sample) }
  }
  assert.deepEqual(after.due.rows.map((r) => r.serial_no).sort(), fx.expected.running_life.due_serials)
  assert.equal(after.due.total, fx.expected.running_life.due_serials.length)
  // before the draft: the baseline swallowed the placeholder and over cap rows, and the factory zero tyre had no km run
  const b = Object.fromEntries(before.running.rows.map((r) => [r.serial_no, r]))
  assert.equal(num(b.GLA30007.expected_life_km), fx.expected.running_life.baseline_before_draft)
  assert.equal(b.GLA30006.km_run, null)
  assert.equal(b.GLA30005.km_run, null) // the placeholder is unknown both before and after
  assert.equal(rows.GLA30005.remaining_km, null) // NULL, not 0
})

t('golden: two active tyres on one wheel are flagged, and only those', () => {
  assert.deepEqual(golden().after.double, fx.expected.double_active.serials)
})

t('golden: named cost per vehicle km. placeholder odometer refused (draft 125000), split adds up, unmeasurable is NULL', () => {
  const { after, before } = golden()
  const e = fx.expected.vehicle_km_cost
  const a = after.overview.cpk.current; const b = before.overview.cpk.current
  assert.equal(b.km, e.km_live_with_placeholder) // defect R2-D1 reproduced on the production text
  assert.equal(b.cpk, e.cpk_live)
  assert.equal(b.cpk_tyre, undefined) // the split does not exist before draft 120000
  assert.equal(a.km, e.km_honest)
  assert.equal(num(after.kmspan.GTM01), 85000); assert.equal(num(before.kmspan.GTM01), 94999)
  assert.equal(a.spend_total, e.spend_total); assert.equal(a.spend_matched, e.spend_matched)
  assert.equal(a.spend_matched_tyre, e.spend_matched_tyre); assert.equal(a.spend_matched_maintenance, e.spend_matched_maintenance)
  assert.equal(a.cpk, e.cpk_honest); assert.equal(a.cpk_tyre, e.cpk_tyre_honest); assert.equal(a.cpk_maintenance, e.cpk_maintenance_honest)
  assert.equal(a.metric, 'operating_cost_per_vehicle_km')
  // 2024 has no reading at all: NULL, never 0
  const p = after.overview.cpk.previous
  assert.equal(p.km, 0); assert.equal(p.cpk, null); assert.equal(p.cpk_tyre, null); assert.equal(p.cpk_maintenance, null)
})

t('golden: tyre spend ratio keeps its value under its own name; the km total is withheld; hours unchanged', () => {
  const { after, before } = golden()
  const a = after.fleet.fleet[0]; const b = before.fleet.fleet[0]
  assert.equal(a.km.cpk_tyre, 0.011); assert.equal(b.km.cpk_tyre, 0.011) // 3812 / 345200
  assert.equal(num(a.km.total_km), 345200)
  assert.equal(b.km.cpk_total, 0.0134); assert.equal(a.km.cpk_total, null); assert.equal(a.km.legacy_total_per_tyre_km, 0.0134)
  assert.equal(a.hours.cpk_total, fx.expected.fleet_cpk.hours_cpk_total); assert.equal(num(a.hours.total_hours), fx.expected.fleet_cpk.hours_total)
  assert.deepEqual(a.hours, b.hours)
  // the pump has spend and no hour span: its rate is NULL, not 0
  const pump = after.fleet.per_vehicle.find((r) => r.asset_no === 'GMP01')
  assert.equal(pump.cpk_total, null); assert.equal(pump.cpk_tyre, null)
  // two countries, two currencies, no blend
  assert.deepEqual(after.fleet_all.fleet.map((r) => `${r.country}:${r.currency}:${r.km.cpk_tyre}`).sort(), ['KSA:SAR:0.011', 'UAE:AED:0.03'])
})

// ── 5. Write paths, with the real triggers on ───────────────────────────────
const writeScript = (body) => `begin;
  set local session_replication_role = replica;
  insert into public.vehicle_fleet (organisation_id, country, asset_no, vehicle_type, current_km, status)
    values ('${fx.org}', 'KSA', 'GTM09', 'TR-MIXER', 80000, 'Active');
  set local session_replication_role = origin;
  ${asUser(fx.user)}
  ${body}
  rollback;`

t('double active wheel: the database refuses a second active tyre on the same wheel for a signed in user', () => {
  const r = run(DB_AFTER, writeScript(`
    insert into public.tyre_records (organisation_id, country, asset_no, tyre_position, serial_no, vehicle_type, issue_date, km_at_fitment, status)
      values ('${fx.org}', 'KSA', 'GTM09', 'LHF1', 'GLW70001', 'TR-MIXER', '2026-03-01', 40000, 'Active');
    do $$ begin
      insert into public.tyre_records (organisation_id, country, asset_no, tyre_position, serial_no, vehicle_type, issue_date, km_at_fitment, status)
        values ('${fx.org}', 'KSA', 'GTM09', 'LHF1', 'GLW70002', 'TR-MIXER', '2026-04-01', 45000, 'Active');
      perform set_config('eng.r', 'accepted', true);
    exception when unique_violation then perform set_config('eng.r', 'refused 23505', true); end $$;
    ${emit('second', `to_jsonb(current_setting('eng.r', true))`)}
    ${emit('active', `select count(*) from public.tyre_records where asset_no = 'GTM09' and tyre_position = 'LHF1' and status = 'Active'`)}`))
  assert.equal(r.second, 'refused 23505')
  assert.equal(r.active, 1)
})

t('one price per tyre: a refit of a priced serial is stored with no price, and the offered price is kept as a note', () => {
  const r = run(DB_AFTER, writeScript(`
    insert into public.tyre_records (organisation_id, country, asset_no, tyre_position, serial_no, vehicle_type, size, issue_date, removal_date, km_at_fitment, km_at_removal, status, cost_per_tyre)
      values ('${fx.org}', 'KSA', 'GTM09', 'LHR1', 'GLW70010', 'TR-MIXER', '315/80R22.5', '2026-01-01', '2026-03-01', 10000, 30000, 'Removed', 1800);
    insert into public.tyre_records (organisation_id, country, asset_no, tyre_position, serial_no, vehicle_type, size, issue_date, km_at_fitment, status, cost_per_tyre)
      values ('${fx.org}', 'KSA', 'GTM09', 'RHR1', 'GLW70010', 'TR-MIXER', '315/80R22.5', '2026-03-05', 31000, 'Active', 1800);
    ${emit('rows', `select jsonb_agg(jsonb_build_object('cost', cost_per_tyre, 'note', extra_fields->>'repeat_purchase_price') order by issue_date)
        from public.tyre_records where serial_no = 'GLW70010'`)}
    ${emit('life', `select jsonb_build_object('cost', purchase_cost, 'status', purchase_cost_status, 'fitments', fitments) from public.v_tyre_lifetime where serial_no = 'GLW70010'`)}`))
  assert.equal(num(r.rows[0].cost), 1800)
  assert.equal(r.rows[1].cost, null)
  assert.equal(num(r.rows[1].note), 1800)
  assert.deepEqual({ cost: num(r.life.cost), status: r.life.status, fitments: r.life.fitments }, { cost: 1800, status: 'ACTUAL', fitments: 2 })
})

t('C22: a later fitment closes the tyre on the wheel through the real import path; same day lower meter is held; undo restores', () => {
  const recon = (rows, dry) => `public.tyre_import_reconcile('${JSON.stringify(rows)}'::jsonb, 'KSA', ${dry})`
  const NEW = [{ asset_no: 'GTM09', tyre_position: 'LHF1', serial_no: 'GLW80002', issue_date: '2026-06-01', km_at_fitment: 62000 }]
  const LATE = [{ asset_no: 'GTM09', tyre_position: 'LHF1', serial_no: 'GLW80003', issue_date: '2026-06-01', km_at_fitment: 39000 }]
  const old = `select jsonb_build_object('status', status, 'removed', removal_date, 'km_rem', km_at_removal, 'total', total_km,
      'by', extra_fields->>'replaced_by_serial') from public.tyre_records where serial_no = 'GLW80001'`
  const r = run(DB_AFTER, writeScript(`
    insert into public.tyre_records (organisation_id, country, asset_no, tyre_position, serial_no, vehicle_type, issue_date, km_at_fitment, status)
      values ('${fx.org}', 'KSA', 'GTM09', 'LHF1', 'GLW80001', 'TR-MIXER', '2026-03-01', 40000, 'Active');
    ${emit('dry', recon(NEW, true))}
    ${emit('old_after_dry', old)}
    ${emit('log_after_dry', `select count(*) from public.tyre_replacement_log where asset_no = 'GTM09'`)}
    ${emit('real', recon(NEW, false))}
    ${emit('old_after_real', old)}
    ${emit('log_after_real', `select jsonb_agg(jsonb_build_object('before', old_values->>'status', 'after', new_values->>'status')) from public.tyre_replacement_log where asset_no = 'GTM09'`)}
    insert into public.tyre_records (organisation_id, country, asset_no, tyre_position, serial_no, vehicle_type, issue_date, km_at_fitment, status)
      values ('${fx.org}', 'KSA', 'GTM09', 'LHF1', 'GLW80002', 'TR-MIXER', '2026-06-01', 62000, 'Active');
    ${emit('late', recon(LATE, false))}
    ${emit('new_after_late', `select status from public.tyre_records where serial_no = 'GLW80002'`)}
    ${emit('log_after_late', `select count(*) from public.tyre_replacement_log where asset_no = 'GTM09'`)}
    ${emit('life', `select jsonb_build_object('km', km_known, 'active', is_active) from public.v_tyre_lifetime where serial_no = 'GLW80001'`)}
    update public.tyre_records set status = 'Removed', removal_date = '2026-06-02' where serial_no = 'GLW80002';
    ${emit('undo', `select public.tyre_replacement_undo((select batch_id from public.tyre_replacement_log where asset_no = 'GTM09' limit 1))`)}
    ${emit('old_after_undo', old)}`))
  assert.deepEqual(r.dry.counts, { would_close: 1 })
  assert.equal(r.old_after_dry.status, 'Active'); assert.equal(r.log_after_dry, 0)
  assert.deepEqual(r.real.counts, { closed: 1 })
  assert.deepEqual({ ...r.old_after_real, km_rem: num(r.old_after_real.km_rem), total: num(r.old_after_real.total) },
    { status: 'Removed', removed: '2026-06-01', km_rem: 62000, total: 22000, by: 'GLW80002' })
  assert.deepEqual(r.log_after_real, [{ before: 'Active', after: 'Removed' }])
  assert.deepEqual(r.late.counts, { ambiguous_same_day_stale: 1 })
  assert.equal(r.late.review_total, 1)
  assert.equal(r.new_after_late, 'Active'); assert.equal(r.log_after_late, 1)
  assert.deepEqual({ km: num(r.life.km), active: r.life.active }, { km: 22000, active: false })
  assert.equal(r.old_after_undo.status, 'Active'); assert.equal(r.old_after_undo.removed, null); assert.equal(r.old_after_undo.km_rem, null)
})

// ── 6. Production shaped cases (synthetic rows that mirror the shape, never copied) ──
t('C20b on stored rows: a WATER TANKER, a LOW LOADER TRAILER and a CONCRETE MIXER TRUCK are measured per km by get_fleet_cpk', () => {
  const types = { GWT01: 'WATER TANKER', GLL01: 'LOW LOADER TRAILER', GCM01: 'CONCRETE MIXER TRUCK', GCP01: 'CONCRETE PUMP TRUCK' }
  // Tyre life per asset. The low loader trailer is given 12,000 km on purpose: tyre_life_km_cap() reads the word
  // LOADER and applies the 15,000 km wheel loader cap to it (defect R2-D2, listed, not fixed here), so a longer
  // life would be refused and hide the unit rule this case is about.
  const life = { GWT01: 30000, GLL01: 12000, GCM01: 30000, GCP01: 30000 }
  let load = 'set local session_replication_role = replica;\n'
  Object.entries(types).forEach(([a, ty], i) => {
    load += `insert into public.vehicle_fleet (organisation_id, country, asset_no, vehicle_type, current_km, status) values ('${fx.org}', 'KSA', '${a}', '${ty}', 60000, 'Active');
      insert into public.tyre_records (organisation_id, country, asset_no, tyre_position, serial_no, vehicle_type, issue_date, removal_date, km_at_fitment, km_at_removal, total_km, status, cost_per_tyre)
        values ('${fx.org}', 'KSA', '${a}', 'LHF1', 'GLS9000${i}', '${ty}', '2025-02-01', '2025-09-01', 20000, ${20000 + life[a]}, ${life[a]}, 'Removed', 1500);
      insert into public.tyre_records (organisation_id, country, asset_no, tyre_position, serial_no, vehicle_type, issue_date, km_at_fitment, status, cost_per_tyre)
        values ('${fx.org}', 'KSA', '${a}', 'RHF1', 'GLS9100${i}', '${ty}', '2025-09-01', 50000, 'Active', 1500);
      insert into public.parts_consumption (organisation_id, country, currency, work_order_no, asset_code, event_date, item_description, qty, tyre_cost, spare_cost, oil_cost, line_cost)
        values ('${fx.org}', 'KSA', 'SAR', 'GJC-S${i}', '${a}', '2025-03-01', 'TYRE 315/80R22.5', '1', 1500, 0, 0, 1500);\n`
  })
  load += 'set local session_replication_role = origin;\n'
  const script = `begin;\n${load}${asUser(fx.user)}
    ${emit('pv', `select jsonb_object_agg(r->>'asset_no', jsonb_build_object('unit', r->>'unit', 'cpk_tyre', r->'cpk_tyre', 'km', r->'distance_or_hours'))
        from jsonb_array_elements(public.get_fleet_cpk('KSA', '2025-01-01', '2025-12-31')->'per_vehicle') r`)}
    ${emit('life', `select jsonb_object_agg(r->>'asset_no', r->>'unit') from jsonb_array_elements(public.get_tyre_running_life('KSA', null, 0, null, false)->'rows') r`)}
    ${emit('r2d2', `select jsonb_build_object('cap', public.tyre_life_km_cap('LOW LOADER TRAILER'), 'km', public.tyre_km_life(20000, 50000, null, 'LOW LOADER TRAILER'))`)}
    rollback;`
  const a = run(DB_AFTER, script); const b = run(DB_BEFORE, script)
  for (const asset of ['GWT01', 'GLL01', 'GCM01']) {
    assert.equal(b.pv[asset].unit, 'engine_hours', `${asset} before`) // FAILS on the production text: tyre km ignored, no rate
    assert.equal(b.pv[asset].cpk_tyre, null)
    assert.equal(a.pv[asset].unit, 'km', `${asset} after`)
    assert.equal(num(a.pv[asset].km), life[asset])
    assert.equal(num(a.pv[asset].cpk_tyre), 1500 / life[asset]) // 0.05, 0.125, 0.05
    assert.equal(a.life[asset], 'km')
  }
  // KNOWN DEFECT R2-D2 (open): a road trailer whose type contains LOADER gets the wheel loader life cap.
  // Pinned so the day it is fixed this line fails and the note is removed. No such type exists in production today.
  assert.deepEqual({ cap: num(a.r2d2.cap), km: a.r2d2.km }, { cap: 15000, km: null })
  // a truck mounted pump stays an hour machine both before and after
  assert.equal(a.pv.GCP01.unit, 'engine_hours'); assert.equal(b.pv.GCP01.unit, 'engine_hours')
})

t('C29 on stored rows: the tyre master view and the country KPI stop pricing a placeholder fitment', () => {
  const script = `begin;
    set local session_replication_role = replica;
    insert into public.tyre_records (id, organisation_id, country, asset_no, tyre_position, serial_no, vehicle_type, issue_date, removal_date, km_at_fitment, km_at_removal, total_km, status, cost_per_tyre, qty)
      values ('${fitId(901)}', '${fx.org}', 'KSA', 'GTM09', 'LHF1', 'GLS95001', 'TR-MIXER', '2025-02-01', '2025-09-01', 1, 184300, 184299, 'Removed', 1800, 1),
             ('${fitId(902)}', '${fx.org}', 'KSA', 'GTM09', 'RHF1', 'GLS95002', 'TR-MIXER', '2025-02-01', '2025-09-01', 10000, 40000, 30000, 'Removed', 1800, 1);
    set local session_replication_role = origin;
    ${asUser(fx.user)}
    ${emit('master', `select jsonb_object_agg(serial_no, cpk) from public.v_tyre_master where serial_no like 'GLS9500%'`)}
    rollback;`
  const a = run(DB_AFTER, script); const b = run(DB_BEFORE, script)
  assert.equal(num(b.master.GLS95001), 0.0098) // 1800 over the whole odometer of the vehicle
  assert.equal(a.master.GLS95001, null) // N/A, not 0
  assert.equal(num(a.master.GLS95002), 0.06); assert.equal(num(b.master.GLS95002), 0.06)
})
