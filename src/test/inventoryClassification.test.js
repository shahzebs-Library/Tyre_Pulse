import { describe, it, expect } from 'vitest'
import {
  classifyAbc, classifyFsn, classifyVed, stockDisposition, classifyItems, thresholdsFor, validateThresholds, classificationMatrix,
} from '../lib/inventory/classification'

const now = '2026-11-19'

describe('ABC by value', () => {
  const items = [
    { item_id: 'a', organisation_id: 'o', currency: 'SAR', consumptionValue: 700 },
    { item_id: 'b', organisation_id: 'o', currency: 'SAR', consumptionValue: 200 },
    { item_id: 'c', organisation_id: 'o', currency: 'SAR', consumptionValue: 60 },
    { item_id: 'd', organisation_id: 'o', currency: 'SAR', consumptionValue: 40 },
  ]
  it('applies the default 80/95 Pareto cut, including the crossing item', () => {
    const r = Object.fromEntries(classifyAbc(items).map((x) => [x.item_id, x.abc]))
    expect(r).toEqual({ a: 'A', b: 'A', c: 'B', d: 'C' })
  })
  it('ranks per currency, never across currencies', () => {
    const r = classifyAbc([...items, { item_id: 'x', organisation_id: 'o', currency: 'EGP', consumptionValue: 1 }])
    expect(r.find((x) => x.item_id === 'x').abc).toBe('A')
  })
  it('unknown value or currency is unclassified, not C', () => {
    const r = classifyAbc([{ item_id: 'u', currency: 'SAR', consumptionValue: null }, { item_id: 'v', consumptionValue: 5 }])
    expect(r.map((x) => x.reason)).toEqual(['consumption_value_unknown', 'currency_unknown'])
    expect(r.every((x) => x.abc === 'unclassified')).toBe(true)
  })
  it('honours per-category thresholds', () => {
    const cfg = { byCategory: { tyre: { abc: { a: 0.5, b: 0.9 } } } }
    const tyres = items.map((i) => ({ ...i, category: 'Tyre' }))
    const r = Object.fromEntries(classifyAbc(tyres, { config: cfg }).map((x) => [x.item_id, x.abc]))
    expect(r.b).toBe('B')
  })
  it('zero consumption is C with a reason', () => {
    const r = classifyAbc([{ item_id: 'z', currency: 'SAR', consumptionValue: 0 }])
    expect(r[0]).toMatchObject({ abc: 'C', reason: 'no_consumption_in_period' })
  })
})

describe('thresholds', () => {
  it('most specific scope wins: location > category > company > default', () => {
    const cfg = {
      default: { abc: { a: 0.7 } },
      byCompany: { o: { abc: { a: 0.75 } } },
      byCategory: { tyre: { abc: { a: 0.6 } } },
      byLocation: { L1: { abc: { a: 0.5 } } },
    }
    expect(thresholdsFor({ organisation_id: 'o', category: 'tyre', location_id: 'L1' }, cfg).abc.a).toBe(0.5)
    expect(thresholdsFor({ organisation_id: 'o', category: 'tyre' }, cfg).abc.a).toBe(0.6)
    expect(thresholdsFor({ organisation_id: 'o' }, cfg).abc.a).toBe(0.75)
    expect(thresholdsFor({}, cfg).abc.a).toBe(0.7)
    expect(thresholdsFor({}).abc).toEqual({ a: 0.8, b: 0.95 })
  })
  it('validates', () => {
    expect(validateThresholds({ abc: { a: 0.8, b: 0.95 }, fsn: { fastMonths: 6, windowMonths: 12 } }).ok).toBe(true)
    expect(validateThresholds({ abc: { a: 0.9, b: 0.8 }, fsn: { fastMonths: 13, windowMonths: 12 } }).errors).toHaveLength(2)
  })
})

describe('FSN by movement', () => {
  const ledgerStartAt = '2024-01-01'
  it('fast, slow and non-moving', () => {
    const fast = Array.from({ length: 7 }, (_, i) => `2026-${String(i + 3).padStart(2, '0')}-10`)
    const r = classifyFsn([
      { item_id: 'f', issueDates: fast, createdAt: '2020-01-01' },
      { item_id: 's', issueDates: ['2026-05-02', '2026-05-20'], createdAt: '2020-01-01' },
      { item_id: 'n', issueDates: ['2024-02-01'], createdAt: '2020-01-01' },
    ], { now, ledgerStartAt })
    expect(r.map((x) => x.fsn)).toEqual(['F', 'S', 'N'])
    expect(r[1].activeMonths).toBe(1)
  })
  it('young items and short ledgers are unclassified, not N', () => {
    const r = classifyFsn([
      { item_id: 'y', issueDates: [], createdAt: '2026-06-01' },
      { item_id: 'z', issueDates: [], createdAt: '2020-01-01' },
    ], { now, ledgerStartAt: '2026-06-01' })
    expect(r.map((x) => x.reason)).toEqual(['item_younger_than_window', 'ledger_shorter_than_window'])
  })
  it('requires now', () => {
    expect(classifyFsn([{ item_id: 'q' }], {})[0].reason).toBe('now_required')
  })
})

describe('VED', () => {
  it('maps recorded criticality and never defaults to D', () => {
    expect(classifyVed({ criticality: 'Vital' }).ved).toBe('V')
    expect(classifyVed({ criticality: 'safety-critical' }).ved).toBe('V')
    expect(classifyVed({ criticality: 'essential' }).ved).toBe('E')
    expect(classifyVed({ criticality: 'desirable' }).ved).toBe('D')
    expect(classifyVed({}).ved).toBe('unassessed')
    expect(classifyVed({ criticality: 'banana' }).reason).toBe('criticality_not_recognised')
  })
})

describe('disposition', () => {
  it('a vital non-mover is an insurance spare, not dead stock', () => {
    expect(stockDisposition({ fsn: 'N', ved: 'V' })).toBe('critical_insurance_spare')
    expect(stockDisposition({ fsn: 'S', ved: 'V' })).toBe('critical_slow_mover')
    expect(stockDisposition({ fsn: 'N', ved: 'D' })).toBe('dead_stock_candidate')
    expect(stockDisposition({ fsn: 'N', ved: 'unassessed' })).toBe('dead_stock_candidate')
    expect(stockDisposition({ fsn: 'S', ved: 'E' })).toBe('slow_mover')
    expect(stockDisposition({ fsn: 'unclassified', ved: 'V' })).toBe('insufficient_history')
  })
  it('classifyItems and the matrix', () => {
    const rows = classifyItems([
      { item_id: 'p', currency: 'SAR', consumptionValue: 100, criticality: 'vital', issueDates: [], createdAt: '2020-01-01' },
      { item_id: 'q', currency: 'SAR', consumptionValue: 0, criticality: 'desirable', issueDates: [], createdAt: '2020-01-01' },
    ], { now, ledgerStartAt: '2020-01-01' })
    expect(rows.map((r) => r.disposition)).toEqual(['critical_insurance_spare', 'dead_stock_candidate'])
    const m = classificationMatrix(rows)
    expect(m.matrix).toEqual({ AV: 1, CD: 1 })
    expect(m.counts.fsn.N).toBe(2)
  })
})
