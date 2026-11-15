/**
 * Engineering golden fixture, JS side.
 *
 * supabase/tests/fixtures/eng_golden_fixture.json holds synthetic fitments with
 * answers worked by hand. The JS engines must return those answers here; the SQL
 * RPCs must return the same answers on the same rows in
 * supabase/tests/staging/eng_round2_staging.mjs (local staging database). One
 * fixture, two engines: a difference between them is a defect.
 *
 * The direct engine to engine comparison (JS output against live SQL output) is
 * src/test/engGoldenSqlParity.test.js, which runs when the staging cluster is up.
 */
import { describe, it, expect } from 'vitest'
import fx from '../../supabase/tests/fixtures/eng_golden_fixture.json'
import { tyreKmAssessment } from '../lib/tyreKm'
import * as T from '../lib/tyreLifetime'
import * as R from '../lib/tyreRunningLife'
import * as P from '../lib/tyrePriceRules'
import * as A from '../lib/tyreCostAudit'
import { cpkUnitForAssetType } from '../lib/costIntelligence'
import * as D from '../lib/downtimeTrackerAnalytics'

const r6 = (v) => (v == null ? null : Math.round(v * 1e6) / 1e6)
const r4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4)
const rows = fx.fitments
const ksa = rows.filter((r) => r.country === 'KSA')
const priced = (r) => r.expect && r.expect.fitment_cpk != null

describe('golden: km of one fitment (rule T7)', () => {
  it.each(rows.filter((r) => r.expect).map((r) => [r.tag, r]))('%s', (_tag, r) => {
    expect(T.fitmentKm(r)).toBe(r.expect.km)
    expect(r6(T.fitmentCpk(r))).toBe(r.expect.fitment_cpk)
  })

  it.each(fx.pure.km_life.map((c) => [c.id, c]))('pure %s', (_id, c) => {
    const a = tyreKmAssessment({ km_at_fitment: c.fit, km_at_removal: c.rem, total_km: c.total, vehicle_type: c.type })
    const km = a.status === 'measured' || a.status === 'factory' ? a.km : null
    expect(km).toBe(c.km)
  })

  it.each(fx.pure.calc_cpk.map((c) => [c.id, c]))('fitment CPK %s', (_id, c) => {
    expect(r4(T.fitmentCpk({ cost_per_tyre: c.cost, km_at_fitment: c.fit, km_at_removal: c.rem }))).toBe(c.cpk)
  })

  it('a placeholder, an over cap and an unpriced fitment are null, never 0', () => {
    for (const n of [3, 5, 7]) expect(T.fitmentCpk(rows.find((r) => r.n === n))).toBeNull()
    expect(T.fitmentCpk(rows.find((r) => r.n === 9))).toBeNull()
  })
})

describe('golden: Tyre CPK (lifetime) against per fitment CPK', () => {
  const tyres = T.toLifetimeTyres(ksa)
  const { final } = T.splitFinalProvisional(tyres)
  const s = T.lifetimeSummary(final)
  const e = fx.expected.lifetime

  it('weighted, one price per physical tyre, overlap adds no km', () => {
    expect(final.length).toBe(e.KSA.final_tyres)
    expect(s.measurable).toBe(e.KSA.measurable)
    expect(s.purchaseCost).toBe(e.KSA.purchase_cost)
    expect(s.km).toBe(e.KSA.km)
    expect(r6(s.cpkPurchase)).toBe(e.KSA.cpk_purchase)
  })

  it('is not the mean of the per fitment ratios', () => {
    const ratios = ksa.filter(priced).map((r) => T.fitmentCpk(r))
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length
    expect(ratios.length).toBe(7)
    expect(r6(mean)).toBe(e.mean_of_fitment_ratios_KSA)
    expect(r6(s.cpkPurchase)).not.toBe(r6(mean))
  })

  it.each(Object.entries(e.per_tyre))('%s', (key, x) => {
    const t = tyres.find((y) => y._key === key)
    expect(t._cost).toBe(x.cost)
    expect(t._life_km).toBe(x.km)
    expect(t._fitments).toBe(x.fitments)
    expect(t._cost_status).toBe(x.status)
    expect(t._km_coverage).toBe(x.coverage)
  })

  it('a row with no real serial that stands for two tyres counts twice in cost and km', () => {
    const weak = tyres.find((y) => y.serial_no === 'NO SERIAL')
    expect(weak._qty).toBe(2)
    expect(T.lifetimeCpk(weak)).toBe(0.05)
  })

  it('one price per tyre: the refit keeps no price when money is summed per row', () => {
    const out = T.withOnePricePerTyre(ksa)
    expect(out.find((r) => r.n === 1).cost_per_tyre).toBe(1800)
    expect(out.find((r) => r.n === 2).cost_per_tyre).toBeNull()
    const sum = out.filter((r) => r.status === 'Removed').reduce((a, r) => a + (r.cost_per_tyre || 0), 0)
    expect(sum).toBe(1800 + 1500 + 1900 + 2000 + 1700 + 1600 + 3000 + 2100 + 1000)
  })

  it('two countries are never blended: no scalar, one row per country', () => {
    const all = T.splitFinalProvisional(T.toLifetimeTyres(rows)).final
    const both = T.lifetimeSummary(all)
    expect(both.mixedCurrency).toBe(true)
    expect(both.cpkPurchase).toBeNull()
    const by = Object.fromEntries(both.byCountry.map((c) => [c.country, r6(c.cpk)]))
    expect(by).toEqual({ KSA: e.KSA.cpk_purchase, UAE: e.UAE.cpk_purchase })
    expect(T.weightedCpk(all)).toBeNull()
  })
})

describe('golden: running life bands for km and hours', () => {
  const e = fx.expected.running_life
  // The RPC row the server returns for each tyre, built from the hand answers.
  const rpcRow = (serial, x) => ({
    serial_no: serial, unit: x.unit || 'km',
    km_run: x.km_run ?? null, expected_life_km: x.expected_life_km ?? null,
    remaining_km: x.remaining_km ?? null, life_used_pct: x.life_used_pct ?? null,
    hours_run: x.hours_run ?? null, expected_life_hours: x.expected_life_hours ?? null,
    remaining_hours: x.remaining_hours ?? null, hours_used_pct: x.hours_used_pct ?? null,
  })

  it.each(Object.entries(e.rows))('%s', (serial, x) => {
    const row = R.shapeRow(rpcRow(serial, x))
    expect(R.bandFor(row)).toBe(x.band)
    expect(R.isDueRow(row)).toBe(x.due)
  })

  it('the due set is exactly overdue plus due soon; an unmeasurable tyre is not due', () => {
    const due = Object.entries(e.rows).filter(([s, x]) => R.isDueRow(R.shapeRow(rpcRow(s, x)))).map(([s]) => s).sort()
    expect(due).toEqual(e.due_serials)
  })

  it('a pump with two budgets is judged on the one that runs out first', () => {
    const m = R.measureFor(R.shapeRow(rpcRow('GLP50001', e.rows.GLP50001)))
    expect(m.dimension).toBe('km')
    expect(m.leadingOther).toBe(true)
    expect(m.both).toBe(true)
    expect(m.hours.band).toBe('healthy')
  })

  it('a loader with no odometer is judged on hours and says nothing about distance', () => {
    const m = R.measureFor(R.shapeRow(rpcRow('GLH40001', e.rows.GLH40001)))
    expect(m.dimension).toBe('hours')
    expect(m.km.remaining).toBeNull()
    expect(m.onFallback).toBe(false)
  })
})

describe('golden: unit rule, warranty zero, repair is not a price', () => {
  it.each(fx.pure.unit.map((c) => [String(c.type), c]))('unit of %s', (_t, c) => {
    expect(cpkUnitForAssetType(c.type)).toBe(c.unit)
  })

  it.each(fx.pure.lines.map((l) => [l.text, l]))('%s', (_t, l) => {
    expect(P.isTyreWarranty(l.text)).toBe(l.warranty)
    expect(P.isTyreRepair(l.text)).toBe(l.repair)
  })

  it.each(fx.expense_lines.map((l) => [l.item_description, l]))('line kind of %s', (_t, l) => {
    expect(A.lineKind(l.item_description)).toBe(l.expect_kind)
  })

  it.each(fx.pure.unit_price.map((c, i) => [i, c]))('unit price %s', (_i, c) => {
    expect(P.unitPrice(c.value, c.qty)).toBe(c.unit)
  })

  it('tyre spend split per country: purchase apart from repair, tube and service; a warranty line adds 0', () => {
    const e = fx.expected.tyre_spend_breakdown
    for (const country of ['KSA', 'UAE']) {
      const lines = fx.expense_lines.filter((l) => l.country === country).map((l) => ({ description: l.item_description, amount: l.tyre_cost }))
      const s = A.splitTyreSpend(lines)
      expect(s.purchase.amount).toBe(e[country].tyre)
      expect(s.repair.amount).toBe(e[country].repair || 0)
      expect(s.accessory.amount).toBe(e[country].tube || 0)
      expect(s.service.amount).toBe(e[country].service || 0)
      expect(s.warranty.amount).toBe(0)
      expect(s.purchase.amount + s.nonPurchaseAmount).toBe(s.total)
    }
  })

  it('the price ladder puts a warranty zero ahead of a job card price ahead of a comparable', () => {
    expect(P.SOURCE_ORDER).toEqual(['warranty', 'own_jobcard', 'comparable'])
    const e = fx.expected.price_backfill_dry_run_KSA
    // the two tyres on job card GJC-P1 share one purchase line
    const line = fx.expense_lines.find((l) => l.work_order_no === 'GJC-P1')
    expect(P.unitPrice(line.tyre_cost, line.qty)).toBe(e.by_serial.GLD10011.new_cost)
    // the only line on GJC-R1 is a repair: it can never price the tyre
    expect(P.isTyreRepair(fx.expense_lines.find((l) => l.work_order_no === 'GJC-R1').item_description)).toBe(true)
    // the line on GJC-W1 is a warranty replacement, misspelt as the ERP spells it
    expect(P.isTyreWarranty(fx.expense_lines.find((l) => l.work_order_no === 'GJC-W1').item_description)).toBe(true)
  })
})

describe('golden: downtime measured against assumed', () => {
  const d = fx.downtime
  const now = new Date(d.now)

  it.each(d.work_orders.map((w, i) => [i, w]))('job card %s', (_i, w) => {
    expect(D.workOrderHours(w, { now })).toBe(w.hours)
  })

  it('measured hours come only from job cards; an event with none has null hours and a named assumption', () => {
    const actual = D.actualHoursByAsset(d.work_orders, { now })
    expect(actual.get('GTM01')).toBe(18) // (12 + 24) / 2; the three implausible cards are refused
    expect(actual.has('GTM02')).toBe(false)
    for (const ev of d.events) {
      const h = D.downtimeHours(ev, actual)
      expect(h.hours).toBe(ev.hours)
      expect(h.actual).toBe(ev.actual)
      expect(h.assumedHours).toBe(ev.assumedHours)
    }
    expect(D.DEFAULT_DOWNTIME_RATE).toBeNull() // no cost without an entered rate
  })
})
