import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { isStrongSerial, withOnePricePerTyre } from '../lib/tyreLifetime'
import { computeFleetTyreLife, computeCostTrend, computeScrapRate } from '../lib/kpiEngine'
import { exceptionRows, exceptionCounts } from '../lib/tyreExceptions'

/**
 * Hardening after PR #470 (migration 20261109150000).
 */

// Expected values were read back from the LIVE SQL tyre_serial_is_strong() on
// 2026-11-09 (dry run of 20261109150000). JS must give the same answers.
const SQL_VERIFIED = {
  'FEB-62': false, '195 R 15': false, '24R1321500': true, 'YMA30018, YLZ08348': false,
  '111111': false, '123456': false, YMM36599: true, K507B403860: true, '26C0004819': true,
}

describe('isStrongSerial mirrors SQL tyre_serial_is_strong', () => {
  it.each(Object.entries(SQL_VERIFIED))('%s -> %s', (serial, expected) => {
    expect(isStrongSerial(serial)).toBe(expected)
  })
  it('refuses month codes, sizes with spaces, two serials in one cell, repeated digits', () => {
    for (const s of ['JAN-52', 'APR-51', '11 R 22.5', '12.00R24', '195R15C 106/104R', 'A123456;B654321', '000000', '1234567'])
      expect(isStrongSerial(s)).toBe(false)
  })
  it('the migration carries the same new patterns', () => {
    const sql = readFileSync('supabase/migrations/20261109150000_tyre_stale_upload_guard_serial_rules_exceptions.sql', 'utf8')
    expect(sql).toContain("'^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[- /]?[0-9]{2,4}$'")
    expect(sql).toContain("'^[0-9]{2,3}(\\.[0-9]+)?\\s*R\\s*[0-9]{2}(\\.[0-9])?($|[^0-9])'")
    expect(sql).toContain("'[,;&]'")
    expect(sql).toContain("'^([0-9])\\1+$'")
  })
})

describe('withOnePricePerTyre', () => {
  const rows = [
    { serial_no: 'YMA55312', country: 'KSA', issue_date: '2026-04-01', cost_per_tyre: 1200, qty: 1 },
    { serial_no: 'YMA55312', country: 'KSA', issue_date: '2026-01-01', cost_per_tyre: 1100, qty: 1 },
    { serial_no: 'DOT18E56', country: 'KSA', issue_date: '2026-01-01', cost_per_tyre: 900, qty: 2 },
    { serial_no: 'DOT18E56', country: 'KSA', issue_date: '2026-02-01', cost_per_tyre: 900, qty: 2 },
    { serial_no: 'YMA55312', country: 'UAE', issue_date: '2026-05-01', cost_per_tyre: 700, qty: 1 },
  ]
  it('keeps the earliest price of a real serial, drops the refit price, leaves weak serials alone', () => {
    const out = withOnePricePerTyre(rows)
    expect(out[1].cost_per_tyre).toBe(1100)
    expect(out[0].cost_per_tyre).toBeNull()
    expect(out[0]._refit_price_dropped).toBe(true)
    expect(out[2].cost_per_tyre).toBe(900)
    expect(out[3].cost_per_tyre).toBe(900)
    expect(out[4].cost_per_tyre).toBe(700) // other country = other tyre
    expect(rows[0].cost_per_tyre).toBe(1200) // input not mutated
  })
})

describe('kpiEngine functions that were still per fitment row', () => {
  const thisMonth = new Date().toISOString().slice(0, 7)
  const refit = [
    { serial_no: 'YMA55312', country: 'KSA', issue_date: `${thisMonth}-01`, km_at_fitment: 1000, km_at_removal: 21000, removal_date: `${thisMonth}-02`, cost_per_tyre: 1200, vehicle_type: 'TR-MIXER' },
    { serial_no: 'YMA55312', country: 'KSA', issue_date: `${thisMonth}-03`, km_at_fitment: 50000, km_at_removal: 60000, removal_date: `${thisMonth}-04`, cost_per_tyre: 1200, vehicle_type: 'TR-MIXER' },
  ]
  it('fleet tyre life is cumulative per physical tyre', () => {
    expect(computeFleetTyreLife(refit).avgKm).toBe(30000)
  })
  it('cost trend counts the purchase once', () => {
    const t = computeCostTrend(refit)
    expect(t.byMonth.reduce((s, m) => s + m.totalCost, 0)).toBe(1200)
  })
  it('scrap cost counts the purchase once', () => {
    const scrapped = refit.map((r) => ({ ...r, category: 'Scrap' }))
    expect(computeScrapRate(scrapped).estimatedScrapCost).toBe(1200)
  })
})

describe('tyreExceptions shaping', () => {
  const payload = {
    counts: { rotation_not_closed: 1, same_day_double_entry: 1, serial_priced_twice: 1, weak_serial_active: 2, serial_with_remark: 0, import_reviews_open: 0 },
    same_vehicle: [
      { country: 'KSA', asset: 'TM424', serial: 'YMM36599', kind: 'rotation_not_closed', rows: [{ position: 'LHF2', date: '2026-02-03' }, { position: 'LHRI', date: '2026-03-12' }] },
      { country: 'KSA', asset: 'BH024', serial: 'AAY4625', kind: 'same_day_double_entry', rows: [{ position: 'RHF1', date: '2026-07-26' }, { position: 'LHF2', date: '2026-07-26' }] },
    ],
    priced_twice: [{ country: 'KSA', serial: 'K507B403860', rows: [{ asset: 'MP111', cost: 950 }, { asset: 'TM676', cost: 766 }] }],
    weak_serials: [{ country: 'KSA', serial: 'FEB-62', rows: 2 }],
    serials_with_remark: [],
  }
  it('flattens every kind with an action', () => {
    const rows = exceptionRows(payload)
    expect(rows.map((r) => r.kind)).toEqual(['rotation_not_closed', 'same_day_double_entry', 'serial_priced_twice', 'weak_serial'])
    expect(rows.every((r) => r.action && r.label)).toBe(true)
    expect(rows[0].detail).toContain('LHF2 / LHRI')
  })
  it('missing counts are null, never zero', () => {
    expect(exceptionCounts({}).rotation_not_closed).toBeNull()
    expect(exceptionCounts(payload).weak_serial).toBe(2)
    expect(exceptionRows(null)).toEqual([])
  })
})

// ── ERP intake: reconciliation cannot be bypassed ────────────────────────────
const h = vi.hoisted(() => {
  const state = { inserted: [], rpc: null }
  function from() {
    const b = {
      select() { return b }, eq() { return b }, in() { return b }, order() { return b },
      range() { return Promise.resolve({ data: [], error: null }) },
      insert(rows) { state.inserted.push(...rows); return Promise.resolve({ error: null, data: null }) },
      then(onF, onR) { return Promise.resolve({ data: [], error: null }).then(onF, onR) },
    }
    return b
  }
  const rpc = async (_n, args) => ({ data: state.rpc ? state.rpc(args) : { ok: true, counts: {}, review: [] }, error: null })
  return { state, supabase: { from, rpc } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))
const intake = await import('../lib/api/erpIntake')

describe('ERP tyre intake', () => {
  beforeEach(() => { h.state.inserted = []; h.state.rpc = null })
  const current = (i) => ({ serial_no: `YMA5${String(i).padStart(4, '0')}`, asset_no: `TM${i}`, tyre_position: 'LHF1', issue_date: '2026-11-01', country: 'KSA' })

  it('refuses current fitments without a country instead of skipping the check', async () => {
    await expect(intake.insertTyreRecords([current(1)], {})).rejects.toThrow(/country/i)
    expect(h.state.inserted).toHaveLength(0)
  })

  it('withholds EVERY held row, including those past the 200-row display cap', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => current(i + 1))
    h.state.rpc = (args) => {
      const held = args.p_rows.map((r) => ({ asset_no: r.asset_no, position: r.position, serial_no: r.serial_no, status: 'ambiguous_same_day_stale' }))
      return { ok: true, counts: { ambiguous_same_day_stale: 250 }, review: held.slice(0, 200), review_total: 250, held }
    }
    const res = await intake.insertTyreRecords(rows, { country: 'KSA' })
    expect(h.state.inserted).toHaveLength(0)
    expect(res.replacement.reviewTotal).toBe(250)
  })
})
