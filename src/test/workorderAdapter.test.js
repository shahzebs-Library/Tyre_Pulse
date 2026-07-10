/**
 * Import Center - work order adapter test matrix (Phase 4).
 *
 * Exercises the REAL pure pipeline functions for the workorder module: Arabic +
 * English header mapping (incl. "job card"), cost-integrity validation
 * (TOTAL_LT_COMPONENTS), required-field validation, and WO-number duplicate
 * classification. Number/currency cells are routed through transformRow first so
 * values are coerced exactly as the real pipeline does (mirrors adapters.test.js).
 *
 * Kept separate from the other adapter test files to avoid merge conflicts.
 */
import { describe, it, expect } from 'vitest'
import {
  suggestMapping,
  exactAlias,
  transformRow,
  validateRow,
  classifyDuplicates,
  naturalKey,
} from '../lib/import'

/** Build a transformed workorder row from raw header-keyed cells + a mapping. */
function buildWorkOrderRow(rawRow, mapping) {
  const { transformed } = transformRow(rawRow, mapping, { module: 'workorder' })
  return transformed
}

describe('workorder adapter - Arabic/English header mapping', () => {
  it('resolves headers via exactAlias', () => {
    expect(exactAlias('رقم أمر العمل', 'workorder')).toBe('work_order_no')
    expect(exactAlias('job card', 'workorder')).toBe('work_order_no')
    expect(exactAlias('job no', 'workorder')).toBe('work_order_no')
    expect(exactAlias('تكلفة العمالة', 'workorder')).toBe('labour_cost')
    expect(exactAlias('التكلفة الإجمالية', 'workorder')).toBe('total_cost')
  })

  it('auto-maps mixed Arabic/English headers end-to-end through suggestMapping', () => {
    const out = suggestMapping({
      columns: ['رقم أمر العمل', 'Total Cost', 'تكلفة قطع الغيار', 'تكلفة العمالة'],
      module: 'workorder',
    })
    const byHeader = Object.fromEntries(out.map((m) => [m.sourceHeader, m]))

    expect(byHeader['رقم أمر العمل'].target).toBe('work_order_no')
    expect(byHeader['رقم أمر العمل'].action).toBe('auto')

    expect(byHeader['Total Cost'].target).toBe('total_cost')
    expect(byHeader['Total Cost'].action).toBe('auto')

    expect(byHeader['تكلفة قطع الغيار'].target).toBe('parts_cost')
    expect(byHeader['تكلفة قطع الغيار'].action).toBe('auto')

    expect(byHeader['تكلفة العمالة'].target).toBe('labour_cost')
    expect(byHeader['تكلفة العمالة'].action).toBe('auto')
  })

  it('auto-maps the English "job card" alias to work_order_no', () => {
    const out = suggestMapping({ columns: ['job card'], module: 'workorder' })
    expect(out[0].target).toBe('work_order_no')
    expect(out[0].action).toBe('auto')
  })
})

describe('workorder adapter - cost-integrity & required validation (validateRow)', () => {
  const baseMapping = [
    { sourceHeader: 'WO No', target: 'work_order_no' },
    { sourceHeader: 'Labour Cost', target: 'labour_cost' },
    { sourceHeader: 'Parts Cost', target: 'parts_cost' },
    { sourceHeader: 'Total Cost', target: 'total_cost' },
  ]

  it('total_cost < labour + parts → warning TOTAL_LT_COMPONENTS', () => {
    const row = buildWorkOrderRow(
      { 'WO No': 'WO-1', 'Labour Cost': '600', 'Parts Cost': '600', 'Total Cost': '1000' },
      baseMapping,
    )
    const res = validateRow(row, 'workorder')
    expect(res.status).toBe('warning')
    expect(
      res.issues.some((i) => i.code === 'TOTAL_LT_COMPONENTS' && i.field === 'total_cost'),
    ).toBe(true)
  })

  it('total_cost >= labour + parts → no TOTAL_LT_COMPONENTS issue', () => {
    const row = buildWorkOrderRow(
      { 'WO No': 'WO-1', 'Labour Cost': '600', 'Parts Cost': '400', 'Total Cost': '1000' },
      baseMapping,
    )
    const res = validateRow(row, 'workorder')
    expect(res.issues.some((i) => i.code === 'TOTAL_LT_COMPONENTS')).toBe(false)
  })

  it('missing required work_order_no → error REQUIRED_MISSING', () => {
    const row = buildWorkOrderRow(
      { 'Labour Cost': '600', 'Parts Cost': '400', 'Total Cost': '1000' },
      baseMapping,
    )
    const res = validateRow(row, 'workorder')
    expect(res.status).toBe('error')
    expect(
      res.issues.some((i) => i.code === 'REQUIRED_MISSING' && i.field === 'work_order_no'),
    ).toBe(true)
  })
})

describe('workorder adapter - duplicate classification (WO-number identity)', () => {
  // Natural key = country + work_order_no.
  const mapping = [
    { sourceHeader: 'WO No', target: 'work_order_no' },
    { sourceHeader: 'Asset No', target: 'asset_no' },
    { sourceHeader: 'Status', target: 'status' },
    { sourceHeader: 'Total Cost', target: 'total_cost' },
  ]
  const make = (over) =>
    buildWorkOrderRow(
      { 'WO No': 'WO-100', 'Asset No': 'V-1', Status: 'Open', 'Total Cost': '1000', ...over },
      mapping,
    )

  it('same country + same work_order_no → duplicate', () => {
    const rows = [
      { country: 'KSA', ...make({}) },
      { country: 'KSA', ...make({}) },
    ]
    const out = classifyDuplicates(rows, 'workorder')
    expect(out.map((r) => r.dup_status)).toEqual(['none', 'duplicate'])
  })

  it('same WO across different countries → none (country-scoped)', () => {
    const rows = [
      { country: 'KSA', ...make({}) },
      { country: 'UAE', ...make({}) },
    ]
    const out = classifyDuplicates(rows, 'workorder')
    expect(out.every((r) => r.dup_status === 'none')).toBe(true)
  })

  it('same WO + same country but disagreeing conflict field (status) → conflict', () => {
    const rows = [
      { country: 'KSA', ...make({ Status: 'Open' }) },
      { country: 'KSA', ...make({ Status: 'Closed' }) },
    ]
    const out = classifyDuplicates(rows, 'workorder')
    expect(out.map((r) => r.dup_status)).toEqual(['none', 'conflict'])
  })
})

describe('workorder adapter - natural key', () => {
  it('is stable and identical for two rows sharing country + work_order_no', () => {
    const a = naturalKey({ country: 'KSA', work_order_no: 'WO-7' }, 'workorder')
    const b = naturalKey({ country: 'KSA', work_order_no: 'WO-7' }, 'workorder')
    expect(a).not.toBeNull()
    expect(a).toBe(b)
  })

  it('returns null when work_order_no is blank', () => {
    expect(naturalKey({ country: 'KSA', work_order_no: '' }, 'workorder')).toBeNull()
  })
})
