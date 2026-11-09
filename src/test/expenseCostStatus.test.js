import { describe, it, expect } from 'vitest'
import {
  classifyExpenseLines, summarizeExpenseStatuses, shapeExpenseStatusSummary, expenseStatusExportRows,
  erpAmountOf, isWarrantyLine, COST_STATUS, COST_STATUS_ORDER, COST_STATUS_LABEL,
} from '../lib/expenseCostStatus'

const base = {
  country: 'KSA', currency: 'SAR', issue_number: 'GC/MIS/0004/1026', work_order_no: 'GCKR/JC/1/1026', txn_date: '2026-10-01',
  asset_code: 'TM514', store_code: 'NHC-ST', cost_center: 'CC1', item_code: '223707-O', qty: '1.00',
  item_description: 'TIRE 315/80 R22.5 - RR99 DOUBLECOIN', spare_parts_amount: null, oil_amount: null,
}
const line = (over) => ({
  ...base, value_amount: '841.00', total_amount: '841.00', tyre_amount: '841.00', line_cost: 841, filled_cost: null,
  source_row: '8', created_at: '2026-10-04T06:34:00Z', ...over,
})

describe('erpAmountOf / isWarrantyLine', () => {
  it('reads Values, then Total, then the largest split, else null', () => {
    expect(erpAmountOf({ value_amount: '10', total_amount: '20' })).toBe(10)
    expect(erpAmountOf({ value_amount: '0', total_amount: '20' })).toBe(20)
    expect(erpAmountOf({ value_amount: '0', total_amount: '0', tyre_amount: '920' })).toBe(920)
    expect(erpAmountOf({ value_amount: '-0.01' })).toBe(-0.01)
    expect(erpAmountOf({ value_amount: '0.00', total_amount: '' })).toBeNull()
    expect(erpAmountOf(null)).toBeNull()
  })
  it('matches the ERP misspellings of warranty', () => {
    expect(isWarrantyLine('TIRE -WARRENTY -315/80 R 22.5')).toBe(true)
    expect(isWarrantyLine('free of charge filter')).toBe(true)
    expect(isWarrantyLine('BRAKE PAD')).toBe(false)
  })
})

describe('classifyExpenseLines - single-line statuses', () => {
  it('ACTUAL, ESTIMATED, CONFIRMED_ZERO, MISSING and credits', () => {
    const out = classifyExpenseLines([
      line({ id: 'a1', source_row: '1' }),
      line({ id: 'a2', source_row: '2', item_code: 'X1', value_amount: '0', total_amount: '0', tyre_amount: '0', line_cost: 12, filled_cost: 12 }),
      line({ id: 'a3', source_row: '3', item_description: 'TIRE -WARRENTY -315/80', value_amount: '0', total_amount: '0', tyre_amount: '0', line_cost: 0 }),
      line({ id: 'a4', source_row: '4', item_code: 'X2', value_amount: '0', total_amount: '0', tyre_amount: '0', line_cost: 0 }),
      line({ id: 'a5', source_row: '5', item_code: 'X3', value_amount: '-0.01', total_amount: '-0.01', tyre_amount: null, line_cost: -0.01 }),
    ])
    expect(out.map((r) => r.cost_status)).toEqual(['ACTUAL', 'ESTIMATED', 'CONFIRMED_ZERO', 'MISSING', 'ACTUAL'])
    expect(out[4].is_credit).toBe(true)
    expect(out[0].is_credit).toBe(false)
  })
  it('an estimate never wins when the ERP sent an amount', () => {
    const [r] = classifyExpenseLines([line({ id: 'b1', filled_cost: 999 })])
    expect(r.cost_status).toBe(COST_STATUS.ACTUAL)
  })
  it('does not mutate its input', () => {
    const src = [line({ id: 'c1' })]
    classifyExpenseLines(src)
    expect(src[0].cost_status).toBeUndefined()
  })
})

describe('classifyExpenseLines - repeated uploads', () => {
  it('a later upload of the same content is DISPUTED; the earliest stays ACTUAL', () => {
    const first = line({ id: 'd1', source_row: '8', created_at: '2026-10-04T06:34:00Z' })
    const again = line({ id: 'd2', source_row: '296', created_at: '2026-10-15T05:34:00Z' })
    const out = classifyExpenseLines([again, first])
    const byId = Object.fromEntries(out.map((r) => [r.id, r]))
    expect(byId.d1.cost_status).toBe('ACTUAL')
    expect(byId.d2.cost_status).toBe('DISPUTED')
    expect(byId.d2.dispute_reason).toBe('cross_load_copy')
  })
  it('two identical lines inside ONE upload are genuine and both stay ACTUAL', () => {
    const out = classifyExpenseLines([
      line({ id: 'e1', source_row: '10', created_at: '2026-10-04T06:34:00Z' }),
      line({ id: 'e2', source_row: '11', created_at: '2026-10-04T06:35:10Z' }),
    ])
    expect(out.every((r) => r.cost_status === 'ACTUAL')).toBe(true)
  })
  it('a later upload carrying both genuine copies disputes exactly those two', () => {
    const out = classifyExpenseLines([
      line({ id: 'f1', source_row: '10', created_at: '2026-10-04T06:00:00Z' }),
      line({ id: 'f2', source_row: '11', created_at: '2026-10-04T06:01:00Z' }),
      line({ id: 'f3', source_row: '50', created_at: '2026-10-15T05:00:00Z' }),
      line({ id: 'f4', source_row: '51', created_at: '2026-10-15T05:00:30Z' }),
      line({ id: 'f5', source_row: '52', created_at: '2026-10-15T05:00:40Z' }),
    ])
    const s = Object.fromEntries(out.map((r) => [r.id, r.cost_status]))
    expect(s).toEqual({ f1: 'ACTUAL', f2: 'ACTUAL', f3: 'DISPUTED', f4: 'DISPUTED', f5: 'ACTUAL' })
  })
  it('same ERP line uploaded with a different value: every row DISPUTED (conflicting revision)', () => {
    const out = classifyExpenseLines([
      line({ id: 'g1', value_amount: '0.00', total_amount: '0.00', tyre_amount: '0.00', line_cost: 0, created_at: '2026-10-04T05:49:00Z' }),
      line({ id: 'g2', created_at: '2026-10-04T06:34:00Z' }),
    ])
    expect(out.map((r) => r.dispute_reason)).toEqual(['conflicting_revision', 'conflicting_revision'])
  })
})

describe('summaries', () => {
  it('summarizeExpenseStatuses keeps each country in its own currency', () => {
    const out = summarizeExpenseStatuses(classifyExpenseLines([
      line({ id: 'h1' }),
      line({ id: 'h2', country: 'UAE', currency: 'AED', source_row: '3', line_cost: 100, value_amount: '100' }),
    ]))
    expect(out.map((c) => [c.country, c.currency, c.total])).toEqual([['KSA', 'SAR', 841], ['UAE', 'AED', 100]])
    expect(out[0].statuses.ACTUAL.lines).toBe(1)
  })
  it('shapeExpenseStatusSummary fills missing statuses and never fakes a share', () => {
    const shaped = shapeExpenseStatusSummary({
      ok: true,
      countries: [
        { country: 'KSA', currency: 'SAR', lines: 3, total: 1000, statuses: { ACTUAL: { lines: 2, amount: 900 }, DISPUTED: { lines: 1, amount: 100 } },
          disputed: { cross_load_copy: { lines: 1, amount: 100 } } },
        { country: 'UAE', currency: 'AED', lines: 0, total: 0, statuses: {} },
      ],
    })
    expect(shaped.ok).toBe(true)
    expect(shaped.countries[0].statuses.ESTIMATED).toEqual({ lines: 0, amount: 0, tyreLines: 0, tyreAmount: 0 })
    expect(shaped.countries[0].solidShare).toBeCloseTo(0.9)
    expect(shaped.countries[0].copy).toEqual({ lines: 1, amount: 100 })
    expect(shaped.countries[1].solidShare).toBeNull()
    expect(shapeExpenseStatusSummary(null)).toEqual({ ok: false, countries: [] })
  })
  it('export rows: one per country and status, labelled', () => {
    const rows = expenseStatusExportRows(shapeExpenseStatusSummary({ ok: true, countries: [{ country: 'KSA', currency: 'SAR', total: 1, statuses: {} }] }))
    expect(rows).toHaveLength(COST_STATUS_ORDER.length)
    expect(rows.map((r) => r.status)).toEqual(COST_STATUS_ORDER.map((s) => COST_STATUS_LABEL[s]))
  })
})
