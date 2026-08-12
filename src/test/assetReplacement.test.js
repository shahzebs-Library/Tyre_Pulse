import { describe, it, expect } from 'vitest'
import {
  shapeBenchmarks,
  benchmarkFor,
  lastCompleteYearSpend,
  replacementEconomics,
  replacementTotals,
  replacementRanking,
  replacementFindings,
  replacementExportRows,
  benchmarkStatusMeta,
} from '../lib/assetReplacement'

const NOW = Date.UTC(2026, 7, 12) // 2026-08-12

const sanyQuote = {
  id: 'q1',
  asset_type: 'PUMPS',
  label: 'Truck-mounted concrete pump 47m (new)',
  supplier: 'SANY Automobile Manufacturing Co., Ltd.',
  model: 'SYG5360THB 470C-10',
  unit_price: 1120000,
  vat_pct: 15,
  vat_amount: 168000,
  total_price: 1288000,
  currency: 'SAR',
  quote_date: '2026-07-24',
  valid_until: '2026-08-10',
  source_file: 'SANY_quotation_for_pump_47m0724.pdf',
  active: true,
}

const pump = (over = {}) => ({
  asset_no: 'MP049',
  asset_type: 'PUMPS',
  reliability: { spend: 560000, spend_by_year: { 2024: 90000, 2025: 224000, 2026: 40000 } },
  ...over,
})

describe('shapeBenchmarks', () => {
  it('keeps the ex-VAT price as the cost basis, not the VAT-inclusive total', () => {
    const b = shapeBenchmarks([sanyQuote], { now: NOW }).list[0]
    expect(b.cost).toBe(1120000)
    expect(b.totalPrice).toBe(1288000)
  })

  it('marks a quotation past its validity as lapsed rather than dropping it', () => {
    const b = shapeBenchmarks([sanyQuote], { now: NOW }).list[0]
    expect(b.status).toBe('expired')
    expect(b.cost).toBe(1120000)
    expect(benchmarkStatusMeta(b.status).tone).toBe('warning')
  })

  it('calls a quotation current while it is still inside its validity', () => {
    const b = shapeBenchmarks([sanyQuote], { now: Date.UTC(2026, 7, 1) }).list[0]
    expect(b.status).toBe('current')
  })

  it('says a quotation with no validity date cannot be aged', () => {
    const b = shapeBenchmarks([{ ...sanyQuote, valid_until: null }], { now: NOW }).list[0]
    expect(b.status).toBe('undated')
  })

  it('drops inactive rows so a retired quotation cannot resurface', () => {
    expect(shapeBenchmarks([{ ...sanyQuote, active: false }], { now: NOW }).list).toHaveLength(0)
  })

  it('keeps the newest quotation per class and reports the one it replaced', () => {
    const older = { ...sanyQuote, id: 'q0', unit_price: 990000, quote_date: '2025-01-01' }
    const r = shapeBenchmarks([older, sanyQuote], { now: NOW })
    expect(r.list).toHaveLength(1)
    expect(r.list[0].cost).toBe(1120000)
    expect(r.superseded.map((s) => s.id)).toEqual(['q0'])
  })

  it('refuses a row with no price', () => {
    expect(shapeBenchmarks([{ ...sanyQuote, unit_price: null }], { now: NOW }).list).toHaveLength(0)
  })
})

describe('benchmarkFor', () => {
  it('matches the asset class exactly, ignoring case and spacing', () => {
    const b = shapeBenchmarks([sanyQuote], { now: NOW })
    expect(benchmarkFor(' pumps ', b)?.cost).toBe(1120000)
  })

  it('does NOT price a different class that merely shares a word', () => {
    const b = shapeBenchmarks([sanyQuote], { now: NOW })
    expect(benchmarkFor('SPIDER PUMP', b)).toBeNull()
    expect(benchmarkFor('STATIONARY PUMP', b)).toBeNull()
    expect(benchmarkFor('GENERATOR', b)).toBeNull()
  })

  // The real defect the owner caught: the SANY quotation was obtained for MP049
  // and priced MP042, a Putzmeister of different spec, as well.
  it('a quotation naming one machine does NOT price another of the same class', () => {
    const b = shapeBenchmarks([{ ...sanyQuote, asset_no: 'MP049' }], { now: NOW })
    expect(benchmarkFor('PUMPS', b, { assetNo: 'MP049' })?.cost).toBe(1120000)
    expect(benchmarkFor('PUMPS', b, { assetNo: 'MP042' })).toBeNull()
    expect(benchmarkFor('PUMPS', b)).toBeNull()
  })

  it('a machine quotation outranks a class quotation for that machine only', () => {
    const classWide = { ...sanyQuote, id: 'cls', asset_no: null, unit_price: 900000 }
    const mine = { ...sanyQuote, id: 'mine', asset_no: 'MP049', unit_price: 1120000 }
    const b = shapeBenchmarks([classWide, mine], { now: NOW })
    expect(benchmarkFor('PUMPS', b, { assetNo: 'MP049' })?.cost).toBe(1120000)
    expect(benchmarkFor('PUMPS', b, { assetNo: 'MP042' })?.cost).toBe(900000)
  })

  it('accepts a whole register row as well as a bare class', () => {
    const b = shapeBenchmarks([{ ...sanyQuote, asset_no: 'MP049' }], { now: NOW })
    expect(benchmarkFor({ asset_no: 'MP049', asset_type: 'PUMPS' }, b)?.cost).toBe(1120000)
    expect(benchmarkFor({ asset_no: 'MP042', asset_type: 'PUMPS' }, b)).toBeNull()
  })

  it('keeps the newest quotation per machine independently of the class list', () => {
    const older = { ...sanyQuote, id: 'a', asset_no: 'MP049', unit_price: 1, quote_date: '2025-01-01' }
    const newer = { ...sanyQuote, id: 'b', asset_no: 'MP049', unit_price: 2, quote_date: '2026-07-24' }
    const cls = { ...sanyQuote, id: 'c', asset_no: null, unit_price: 3 }
    const b = shapeBenchmarks([older, newer, cls], { now: NOW })
    expect(benchmarkFor('PUMPS', b, { assetNo: 'MP049' })?.cost).toBe(2)
    expect(b.superseded.map((s) => s.id)).toEqual(['a'])
  })
})

describe('lastCompleteYearSpend', () => {
  it('ignores the year in progress so a part year cannot read as a fall', () => {
    expect(lastCompleteYearSpend(pump(), { now: NOW })).toEqual({ year: 2025, spend: 224000 })
  })

  it('returns null when the only year on record is the one in progress', () => {
    const row = pump({ reliability: { spend: 40000, spend_by_year: { 2026: 40000 } } })
    expect(lastCompleteYearSpend(row, { now: NOW })).toBeNull()
  })
})

describe('replacementEconomics', () => {
  const benchmarks = shapeBenchmarks([sanyQuote], { now: NOW })

  it('states spend as a share of a new machine', () => {
    const e = replacementEconomics(pump(), benchmarks, { now: NOW })
    expect(e.covered).toBe(true)
    expect(e.replacementCost).toBe(1120000)
    expect(e.spendPctOfNew).toBe(50) // 560000 / 1120000
  })

  it('states how many years of the last complete year buys a new machine', () => {
    const e = replacementEconomics(pump(), benchmarks, { now: NOW })
    expect(e.yearsOfSpendPerNewMachine).toBe(5) // 1120000 / 224000
  })

  it('returns the machine with a reason when its class has no quotation', () => {
    const e = replacementEconomics({ asset_no: 'GN074', asset_type: 'GENERATOR' }, benchmarks, { now: NOW })
    expect(e.covered).toBe(false)
    expect(e.replacementCost).toBeNull()
    expect(e.reason).toContain('GENERATOR')
  })

  it('says whether the price was quoted for this machine or for its class', () => {
    const forOne = shapeBenchmarks([{ ...sanyQuote, asset_no: 'MP049' }], { now: NOW })
    const mine = replacementEconomics(pump(), forOne, { now: NOW })
    expect(mine.basis).toBe('asset')
    expect(mine.basisNote).toContain('MP049')

    const cls = replacementEconomics(pump(), benchmarks, { now: NOW })
    expect(cls.basis).toBe('class')
    expect(cls.basisNote).toContain('not for MP049 specifically')
  })

  it('MP042 has no price once the quotation names MP049', () => {
    const forOne = shapeBenchmarks([{ ...sanyQuote, asset_no: 'MP049' }], { now: NOW })
    const e = replacementEconomics({ asset_no: 'MP042', asset_type: 'PUMPS' }, forOne, { now: NOW })
    expect(e.covered).toBe(false)
    expect(e.replacementCost).toBeNull()
    expect(e.reason).toContain('MP042')
  })

  it('gives no ratio rather than 0% when nothing has been spent', () => {
    const e = replacementEconomics(pump({ reliability: { spend: 0, spend_by_year: {} } }), benchmarks, { now: NOW })
    expect(e.spendPctOfNew).toBeNull()
    expect(e.yearsOfSpendPerNewMachine).toBeNull()
  })
})

describe('replacementTotals', () => {
  const benchmarks = shapeBenchmarks([sanyQuote], { now: NOW })
  const rows = [pump(), pump({ asset_no: 'MP042', reliability: { spend: 1400000, spend_by_year: { 2025: 200000 } } }), { asset_no: 'GN074', asset_type: 'GENERATOR' }]

  it('sums only the machines it can price and says how many it could not', () => {
    const t = replacementTotals(rows, benchmarks, { now: NOW })
    expect(t.coveredCount).toBe(2)
    expect(t.uncoveredCount).toBe(1)
    expect(t.exposure.total).toBe(2240000)
    expect(t.exposure.currency).toBe('SAR')
    expect(t.uncoveredTypes).toEqual(['GENERATOR'])
    expect(t.unpricedNote).toContain('1 of 3')
  })

  it('every asset appears, priced or not, so the uncovered half cannot vanish', () => {
    expect(replacementTotals(rows, benchmarks, { now: NOW }).rows).toHaveLength(3)
  })

  it('counts the prices resting on a lapsed quotation', () => {
    expect(replacementTotals(rows, benchmarks, { now: NOW }).expiredCount).toBe(2)
  })
})

describe('replacementRanking + findings', () => {
  const benchmarks = shapeBenchmarks([sanyQuote], { now: NOW })
  const rows = [pump(), pump({ asset_no: 'MP042', reliability: { spend: 1400000, spend_by_year: { 2025: 200000 } } })]

  it('ranks by share of a new machine and leaves unmeasurable machines out', () => {
    const r = replacementRanking([...rows, { asset_no: 'X1', asset_type: 'PUMPS' }], benchmarks, { now: NOW })
    expect(r.map((p) => p.assetNo)).toEqual(['MP042', 'MP049'])
  })

  it('calls out a machine that has cost more than a new one', () => {
    const f = replacementFindings(rows, benchmarks, { now: NOW })
    const top = f.find((x) => x.key === 'spend_vs_new')
    expect(top.priority).toBe('critical')
    expect(top.title).toContain('more in repairs than a new machine')
  })

  it('says plainly when nothing on the list can be priced', () => {
    const f = replacementFindings([{ asset_no: 'GN074', asset_type: 'GENERATOR' }], benchmarks, { now: NOW })
    expect(f).toHaveLength(1)
    expect(f[0].key).toBe('no_benchmark')
  })
})

describe('replacementExportRows', () => {
  it('leaves a cell blank rather than writing 0 for something not measured', () => {
    const benchmarks = shapeBenchmarks([sanyQuote], { now: NOW })
    const rows = replacementExportRows([{ asset_no: 'GN074', asset_type: 'GENERATOR' }], benchmarks, { now: NOW })
    expect(rows[0].replacement_ex_vat).toBe('')
    expect(rows[0].spend_pct_of_new).toBe('')
    expect(rows[0].note).toContain('No supplier quotation')
  })
})
