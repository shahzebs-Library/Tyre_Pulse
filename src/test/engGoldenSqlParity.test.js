// @vitest-environment node
/**
 * JS engine against SQL RPC, on the same rows, compared directly.
 *
 * Runs only when the LOCAL staging database is reachable (PostgreSQL on
 * 127.0.0.1, synthetic companies, see supabase/tests/staging). In CI there is
 * no cluster and every case here is skipped, not failed. Nothing is written:
 * each script ends in ROLLBACK. Never production.
 *
 * A mismatch here is a defect in one of the two engines. Known, listed
 * differences are asserted as such (and named) so a silent third one cannot
 * hide behind them.
 */
import { describe, it, expect } from 'vitest'
import {
  FIXTURE as fx, DB_AFTER, DB_BEFORE, psql, reachable, parseEmits, emit, asUser, num,
} from '../../supabase/tests/staging/eng_staging_lib.mjs'
import { goldenScript } from '../../supabase/tests/staging/eng_golden_sql.mjs'
import lineFixture from './fixtures/tyreCostLineKinds.json'
import { tyreKmAssessment } from '../lib/tyreKm'
import * as T from '../lib/tyreLifetime'
import * as R from '../lib/tyreRunningLife'
import * as P from '../lib/tyrePriceRules'
import * as A from '../lib/tyreCostAudit'
import { cpkUnitForAssetType } from '../lib/costIntelligence'
import { sanitizeFleetCpk } from '../lib/cpkMetrics'

const UP = reachable(DB_AFTER) && reachable(DB_BEFORE)
const d = UP ? describe : describe.skip
const run = (db, sql) => {
  const r = psql(db, sql)
  if (!r.ok) throw new Error(r.err.slice(0, 2000))
  return parseEmits(r.out)
}
const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const nlit = (v) => (v === null || v === undefined ? 'null::numeric' : `${v}::numeric`)
const r6 = (v) => (v == null ? null : Math.round(v * 1e6) / 1e6)
const r4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4)
const ALPHA_ADMIN = 'af52a86f-2c24-5ce2-a00d-7ac6ca5d715f'

d('JS against SQL: pure rules on a generated grid', () => {
  const fits = [null, 0, 1, 2, 5000, 90000]
  const rems = [null, 0, 1, 40000, 60000, 200000]
  const totals = [null, 0, 1, 15000, 15001, 56000, 56001, 80000, 80001, 100000, 100001]
  const types = [null, '', 'TR-MIXER', 'PUMPS', 'WHEEL LOADER', 'TRAILER', 'LOW LOADER TRAILER', 'bus', 'Skid loader', 'CONCRETE MIXER TRUCK']
  const grid = []
  for (const f of fits) for (const r of rems) for (const t of totals) for (const ty of types) grid.push([f, r, t, ty])

  it(`tyre km rule: ${fits.length * rems.length * totals.length * types.length} combinations of fitment, removal, total and class`, () => {
    const values = grid.map((g, i) => `(${i}, ${nlit(g[0])}, ${nlit(g[1])}, ${nlit(g[2])}, ${lit(g[3])}::text)`).join(',')
    const sql = run(DB_AFTER, emit('km', `select jsonb_agg(public.tyre_km_life(c.f, c.r, c.t, c.ty) order by c.i) from (values ${values}) c(i, f, r, t, ty)`)).km.map(num)
    const mismatches = []
    grid.forEach((g, i) => {
      const a = tyreKmAssessment({ km_at_fitment: g[0], km_at_removal: g[1], total_km: g[2], vehicle_type: g[3] })
      const js = a.status === 'measured' || a.status === 'factory' ? a.km : null
      if (js !== sql[i]) mismatches.push({ fit: g[0], rem: g[1], total: g[2], type: g[3], js, sql: sql[i] })
    })
    expect(mismatches).toEqual([])
  })

  it('fitment CPK: JS fitmentCpk against SQL calc_cpk where no class is known', () => {
    const costs = [null, 0, 1800]
    const g2 = []
    for (const c of costs) for (const f of fits) for (const r of rems) g2.push([c, f, r])
    const values = g2.map((g, i) => `(${i}, ${nlit(g[0])}, ${nlit(g[1])}, ${nlit(g[2])})`).join(',')
    const sql = run(DB_AFTER, emit('c', `select jsonb_agg(public.calc_cpk(c.c, c.f, c.r) order by c.i) from (values ${values}) c(i, c, f, r)`)).c.map(num)
    const mismatches = []
    g2.forEach((g, i) => {
      const js = r4(T.fitmentCpk({ cost_per_tyre: g[0], km_at_fitment: g[1], km_at_removal: g[2] }))
      if (js !== sql[i]) mismatches.push({ cost: g[0], fit: g[1], rem: g[2], js, sql: sql[i] })
    })
    expect(mismatches).toEqual([])
  })

  it('unit rule (km or engine hours) on 59 vehicle type names', () => {
    const names = ['TR-MIXER', 'TRANSIT MIXER', 'MIXER', 'CONCRETE MIXER TRUCK', 'GROUT MIXER', 'PUMPS', 'LINE PUMP', 'SPIDER PUMP', 'STATIONARY PUMP',
      'CONCRETE PUMP', 'CONCRETE PUMP TRUCK', 'BOOM PUMP TRUCK', 'WATER PUMP TRAILER', 'WHEEL LOADER', 'WHEEL_LOADER', 'SKID LOADER', 'BACKHOE LOADER',
      'LOW LOADER TRAILER', 'LOW BED', 'LOWBED TRAILER', 'TRAILER', 'WATER TANKER', 'SLURRY TANKER', 'FUEL TANKER', 'GENERATOR', 'GENSET', 'GEN SET TRAILER',
      'GENERATOR TRAILER', 'COMPRESSOR', 'COMPRESSOR TRAILER', 'EXCAVATOR', 'GRADER', 'MOTOR GRADER', 'DOZER', 'BULLDOZER', 'FORKLIFT', 'FORKLIFT TRUCK',
      'MOBILE CRANE', 'CRANE TRUCK', 'ROLLER', 'BUS', 'MINIBUS', 'VAN', 'CAR', 'SUV', 'PICKUP', 'PICK UP', 'PICK-UP', 'PRIME MOVER', 'TRACTOR HEAD',
      'DUMP TRUCK', 'TIPPER', 'LORRY', 'BATCHING PLANT', 'WATER TREATMENT PLANT', 'PLASTER MACHINE', 'TELEHANDLER', '', null]
    const values = names.map((n, i) => `(${i}, ${lit(n)}::text)`).join(',')
    const sql = run(DB_AFTER, emit('u', `select jsonb_agg(public.cpk_unit_for_asset_type(c.t) order by c.i) from (values ${values}) c(i, t)`)).u
    const mismatches = names.map((n, i) => ({ type: n, js: cpkUnitForAssetType(n), sql: sql[i] })).filter((x) => x.js !== x.sql)
    expect(mismatches).toEqual([])
  })

  it('warranty, repair and line kind on the shared line fixture plus the golden lines', () => {
    const texts = [...new Set([...lineFixture.cases.map((c) => c.description ?? c.text ?? c[0]), ...fx.pure.lines.map((l) => l.text),
      ...fx.expense_lines.map((l) => l.item_description),
      'TYRE 315/80R22.5 WARANTY', 'TYRE GAURANTEE CLAIM', 'TYRE 12.00R24 FREE ISSUE', 'WARRANTYLESS TYRE 315/80R22.5', 'TYRE REMOULD 315/80R22.5',
      'PUNCTURE', 'TYRE PATCHES', 'RETREADING CHARGES', 'FOC TYRE', 'TYRE 315/80R22.5 UNDER CLAIM', '', 'TUBE 12.00R24 WITH FLAP'])].filter((x) => x != null)
    const values = texts.map((t, i) => `(${i}, ${lit(t)}::text)`).join(',')
    const sql = run(DB_AFTER, emit('l', `select jsonb_agg(jsonb_build_object('w', public.tyre_price_is_warranty(c.t), 'r', public.tyre_price_is_repair(c.t),
        'k', public.tyre_cost_line_kind(c.t)) order by c.i) from (values ${values}) c(i, t)`)).l
    const mismatches = texts.map((t, i) => ({ text: t, js: { w: P.isTyreWarranty(t), r: P.isTyreRepair(t), k: A.lineKind(t) }, sql: sql[i] }))
      .filter((x) => x.js.w !== x.sql.w || x.js.r !== x.sql.r || x.js.k !== x.sql.k)
    expect(texts.length).toBeGreaterThan(50)
    expect(mismatches).toEqual([])
  })

  it('real serial test on 30 shapes', () => {
    const serials = ['YMA55312', 'GLD10001', 'FEB-62', '315/80R22.5', '1.25121E+11', '111111', 'NO SERIAL', '12345', '123456', '195 R 15', 'DOT18E56',
      'N/A', 'NULL', '-', 'ABC', 'A1B2C3', 'k507B403590', 'YMM33047, YMM15600', 'YMA1 & YMA2', '12.00R24', '2436326847', 'NEW TYRE', '#NAME?', 'NOT CLEAR',
      'JAN 2025', '1234567890', '000000', 'EP060420711', ' ymn50625 ', '']
    const values = serials.map((s, i) => `(${i}, ${lit(s)}::text)`).join(',')
    const sql = run(DB_AFTER, emit('s', `select jsonb_agg(public.tyre_serial_is_strong(c.t) order by c.i) from (values ${values}) c(i, t)`)).s
    const mismatches = serials.map((s, i) => ({ serial: s, js: T.isStrongSerial(s), sql: sql[i] })).filter((x) => x.js !== x.sql)
    expect(mismatches).toEqual([])
  })
})

d('JS against SQL: the golden fixture rows', () => {
  const g = UP ? run(DB_AFTER, goldenScript({ withBreakdown: true })) : {}
  const rows = fx.fitments.map((f) => ({ ...f, id: `00000000-0000-4000-9000-${String(f.n).padStart(12, '0')}` }))

  it('km of every fitment', () => {
    const mismatches = rows.map((r) => ({ tag: r.tag, js: T.fitmentKm(r), sql: num(g.fit[r.id].km) })).filter((x) => x.js !== x.sql)
    expect(mismatches).toEqual([])
  })

  it('every physical tyre: price once, validated km, fitments, cost status, coverage, quantity, active', () => {
    const js = T.toLifetimeTyres(rows)
    expect(js.length).toBe(Object.keys(g.tyres).length)
    const mismatches = []
    for (const t of js) {
      const s = g.tyres[t._key]
      const a = { cost: t._cost, km: t._life_km, fitments: t._fitments, status: t._cost_status, coverage: t._km_coverage, qty: t._qty, active: t._active }
      const b = s && { cost: num(s.cost), km: num(s.km), fitments: s.fitments, status: s.status, coverage: s.coverage, qty: s.qty, active: s.active }
      if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push({ key: t._key, js: a, sql: b })
    }
    expect(mismatches).toEqual([])
  })

  it('Tyre CPK (lifetime) per country, final tyres', () => {
    const { final } = T.splitFinalProvisional(T.toLifetimeTyres(rows))
    for (const c of g.lifetime.countries) {
      const s = T.lifetimeSummary(final.filter((t) => t.country === c.country))
      expect({ country: c.country, tyres: final.filter((t) => t.country === c.country).length, measurable: s.measurable, cost: s.purchaseCost, km: s.km, cpk: r6(s.cpkPurchase) })
        .toEqual({ country: c.country, tyres: c.final.tyres, measurable: c.final.measurable, cost: num(c.final.purchase_cost), km: num(c.final.km), cpk: num(c.final.cpk_purchase) })
    }
  })

  it('running life: the JS band of every SQL row gives the same due set as the SQL due filter', () => {
    const jsDue = g.running.rows.filter((r) => R.isDueRow(R.shapeRow(r))).map((r) => r.serial_no).sort()
    expect(jsDue).toEqual(g.due.rows.map((r) => r.serial_no).sort())
    for (const r of g.running.rows) {
      const e = fx.expected.running_life.rows[r.serial_no]
      expect(R.bandFor(R.shapeRow(r)), r.serial_no).toBe(e.band)
    }
  })

  it('tyre spend by kind: JS split of the lines equals the SQL breakdown, per country', () => {
    for (const country of ['KSA', 'UAE']) {
      const s = A.splitTyreSpend(fx.expense_lines.filter((l) => l.country === country).map((l) => ({ description: l.item_description, amount: l.tyre_cost })))
      const sql = Object.fromEntries(g.breakdown.filter((b) => b.country === country).map((b) => [b.kind, num(b.amount)]))
      expect({ tyre: s.purchase.amount, repair: s.repair.amount, tube: s.accessory.amount, service: s.service.amount })
        .toEqual({ tyre: sql.tyre || 0, repair: sql.repair || 0, tube: sql.tube || 0, service: sql.service || 0 })
    }
  })

  it('price ladder: the SQL dry run agrees with the JS rules line by line', () => {
    for (const [serial, x] of Object.entries(g.backfill_rows)) {
      const tyre = fx.fitments.find((f) => f.serial_no === serial)
      const lines = fx.expense_lines.filter((l) => l.work_order_no === tyre.job_card && l.asset_code === tyre.asset_no)
      const warranty = lines.some((l) => P.isTyreWarranty(l.item_description))
      const buy = lines.filter((l) => l.tyre_cost > 0 && !P.isTyreRepair(l.item_description) && !P.isTyreWarranty(l.item_description))
      const js = warranty ? { source: 'warranty', new_cost: 0 }
        : buy.length ? { source: 'own_jobcard', new_cost: P.unitPrice(buy.reduce((a, l) => a + l.tyre_cost, 0), buy.reduce((a, l) => a + Number(l.qty), 0)) }
          : null
      expect(js, serial).toEqual({ source: x.source, new_cost: num(x.new_cost) })
    }
  })
})

d('JS against SQL: the web gate today equals the SQL draft tomorrow', () => {
  it('sanitizeFleetCpk over the UNPATCHED get_fleet_cpk gives the figures the patched function returns (seeded company, three countries)', () => {
    const script = (c) => `begin;\n${asUser(ALPHA_ADMIN)}${emit('f', `public.get_fleet_cpk('${c}', '2025-11-01', '2026-10-31')`)}rollback;\n`
    for (const c of ['KSA', 'UAE', 'Egypt']) {
      const before = run(DB_BEFORE, script(c)).f
      const after = run(DB_AFTER, script(c)).f
      const gated = sanitizeFleetCpk({ perVehicle: before.per_vehicle, byType: before.by_type, fleet: before.fleet })
      const pick = (r) => ({ unit: r.unit, cpk_tyre: r.cpk_tyre, cpk_total: r.cpk_total, legacy: r.legacy_total_per_tyre_km ?? null })
      expect(gated.perVehicle.map(pick)).toEqual(after.per_vehicle.map(pick))
      expect(gated.byType.map(pick)).toEqual(after.by_type.map(pick))
      expect(gated.fleet.map((f) => ({ t: f.km.cpk_tyre, total: f.km.cpk_total, legacy: f.km.legacy_total_per_tyre_km, h: f.hours.cpk_total })))
        .toEqual(after.fleet.map((f) => ({ t: f.km.cpk_tyre, total: f.km.cpk_total, legacy: f.km.legacy_total_per_tyre_km, h: f.hours.cpk_total })))
      expect(after.per_vehicle.length).toBeGreaterThan(5)
    }
  })

  it('running life on the seeded company: JS due set equals the SQL due filter, three countries', () => {
    for (const c of ['KSA', 'UAE', 'Egypt']) {
      const r = run(DB_AFTER, `begin;\n${asUser(ALPHA_ADMIN)}${emit('all', `public.get_tyre_running_life('${c}', null, 0, null, false)`)}${emit('due', `public.get_tyre_running_life('${c}', null, 0, null, true)`)}rollback;\n`)
      const jsDue = r.all.rows.filter((x) => R.isDueRow(R.shapeRow(x))).map((x) => x.serial_no).sort()
      expect(r.all.rows.length).toBeGreaterThan(20)
      expect(jsDue).toEqual(r.due.rows.map((x) => x.serial_no).sort())
    }
  })

  it('lifetime CPK on the seeded company: JS collapse of the stored fitments equals the SQL view, three countries', () => {
    const r = run(DB_AFTER, `begin;\n${asUser(ALPHA_ADMIN)}${emit('rows', `select jsonb_agg(to_jsonb(t) - 'extra_fields') from (select id, country, serial_no, asset_no, status, qty, vehicle_type,
        issue_date, removal_date, km_at_fitment, km_at_removal, total_km, cost_per_tyre from public.tyre_records) t`)}${emit('life', `public.get_tyre_lifetime_cpk(null, null, null, null)`)}rollback;\n`)
    expect(r.rows.length).toBeGreaterThan(400)
    const { final } = T.splitFinalProvisional(T.toLifetimeTyres(r.rows))
    for (const c of r.life.countries) {
      const s = T.lifetimeSummary(final.filter((t) => t.country === c.country))
      expect({ country: c.country, measurable: s.measurable, cost: Math.round(s.purchaseCost * 100) / 100, km: s.km, cpk: r6(s.cpkPurchase) })
        .toEqual({ country: c.country, measurable: c.final.measurable, cost: num(c.final.purchase_cost), km: num(c.final.km), cpk: num(c.final.cpk_purchase) })
    }
  })
})
