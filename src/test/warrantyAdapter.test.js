/**
 * Import Center - warranty-claim adapter test matrix (Phase 4).
 *
 * Exercises the REAL pure pipeline functions for the warranty module: Arabic/EN
 * header mapping, fitment/removal lifecycle validation (km + date), required-field
 * enforcement, and serial+claim duplicate/conflict classification. Date/number
 * cells are routed through transformRow first so values are coerced exactly as the
 * real pipeline does (mirrors adapters.test.js / accidentAdapter.test.js).
 *
 * Kept separate from adapters.test.js / accidentAdapter.test.js to avoid merge conflicts.
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

/** Build a transformed warranty row from raw header-keyed cells + a mapping. */
function buildWarrantyRow(rawRow, mapping) {
  const { transformed } = transformRow(rawRow, mapping, { module: 'warranty' })
  return transformed
}

describe('warranty adapter - Arabic/EN header mapping', () => {
  it('resolves Arabic + English warranty headers via exactAlias', () => {
    expect(exactAlias('رقم الإطار', 'warranty')).toBe('serial_number')
    expect(exactAlias('رقم المطالبة', 'warranty')).toBe('claim_no')
    expect(exactAlias('Serial Number', 'warranty')).toBe('serial_number')
    expect(exactAlias('Failure Type', 'warranty')).toBe('failure_type')
  })

  it('auto-maps mixed Arabic/English headers end-to-end through suggestMapping', () => {
    const out = suggestMapping({
      columns: ['رقم الإطار', 'رقم المطالبة', 'Brand', 'Failure Type', 'Credit Amount'],
      module: 'warranty',
    })
    const byHeader = Object.fromEntries(out.map((m) => [m.sourceHeader, m]))

    expect(byHeader['رقم الإطار'].target).toBe('serial_number')
    expect(byHeader['رقم الإطار'].action).toBe('auto')

    expect(byHeader['رقم المطالبة'].target).toBe('claim_no')
    expect(byHeader['رقم المطالبة'].action).toBe('auto')

    expect(byHeader['Brand'].target).toBe('brand')
    expect(byHeader['Brand'].action).toBe('auto')

    expect(byHeader['Failure Type'].target).toBe('failure_type')
    expect(byHeader['Failure Type'].action).toBe('auto')

    expect(byHeader['Credit Amount'].target).toBe('credit_amount')
    expect(byHeader['Credit Amount'].action).toBe('auto')
  })
})

describe('warranty adapter - lifecycle + required validation (validateRow)', () => {
  const baseMapping = [
    { sourceHeader: 'Serial Number', target: 'serial_number' },
    { sourceHeader: 'Claim No', target: 'claim_no' },
    { sourceHeader: 'Fitment Date', target: 'fitment_date' },
    { sourceHeader: 'Removal Date', target: 'removal_date' },
    { sourceHeader: 'KM at Fitment', target: 'km_at_fitment' },
    { sourceHeader: 'KM at Removal', target: 'km_at_removal' },
  ]

  it('km_at_removal < km_at_fitment → error REMOVAL_BEFORE_FITMENT', () => {
    const row = buildWarrantyRow(
      {
        'Serial Number': 'SN-1',
        'Claim No': 'WAR-1',
        'KM at Fitment': '50000',
        'KM at Removal': '20000',
      },
      baseMapping,
    )
    const res = validateRow(row, 'warranty')
    expect(res.status).toBe('error')
    expect(
      res.issues.some((i) => i.code === 'REMOVAL_BEFORE_FITMENT' && i.field === 'km_at_removal'),
    ).toBe(true)
  })

  it('removal_date < fitment_date → warning REMOVAL_DATE_BEFORE_FITMENT', () => {
    const row = buildWarrantyRow(
      {
        'Serial Number': 'SN-2',
        'Claim No': 'WAR-2',
        'Fitment Date': '15/06/2024',
        'Removal Date': '10/06/2024',
      },
      baseMapping,
    )
    const res = validateRow(row, 'warranty')
    expect(res.status).toBe('warning')
    expect(
      res.issues.some((i) => i.code === 'REMOVAL_DATE_BEFORE_FITMENT' && i.field === 'removal_date'),
    ).toBe(true)
  })

  it('missing required serial_number → error REQUIRED_MISSING', () => {
    const row = buildWarrantyRow(
      { 'Claim No': 'WAR-3', 'KM at Fitment': '1000', 'KM at Removal': '2000' },
      baseMapping,
    )
    const res = validateRow(row, 'warranty')
    expect(res.status).toBe('error')
    expect(
      res.issues.some((i) => i.code === 'REQUIRED_MISSING' && i.field === 'serial_number'),
    ).toBe(true)
  })
})

describe('warranty adapter - duplicate classification', () => {
  it('same country + serial_number + claim_no → duplicate', () => {
    const rows = [
      { country: 'KSA', serial_number: 'SN-100', claim_no: 'WAR-100', claim_status: 'Approved', credit_amount: 500, asset_no: 'V-1' },
      { country: 'KSA', serial_number: 'SN-100', claim_no: 'WAR-100', claim_status: 'Approved', credit_amount: 500, asset_no: 'V-1' },
    ]
    const out = classifyDuplicates(rows, 'warranty')
    expect(out.map((r) => r.dup_status)).toEqual(['none', 'duplicate'])
  })

  it('same key but disagreeing claim_status → conflict', () => {
    const rows = [
      { country: 'KSA', serial_number: 'SN-200', claim_no: 'WAR-200', claim_status: 'Approved' },
      { country: 'KSA', serial_number: 'SN-200', claim_no: 'WAR-200', claim_status: 'Rejected' },
    ]
    const out = classifyDuplicates(rows, 'warranty')
    expect(out.map((r) => r.dup_status)).toEqual(['none', 'conflict'])
  })

  it('same key but disagreeing credit_amount → conflict', () => {
    const rows = [
      { country: 'KSA', serial_number: 'SN-300', claim_no: 'WAR-300', credit_amount: 500 },
      { country: 'KSA', serial_number: 'SN-300', claim_no: 'WAR-300', credit_amount: 999 },
    ]
    const out = classifyDuplicates(rows, 'warranty')
    expect(out.map((r) => r.dup_status)).toEqual(['none', 'conflict'])
  })

  it('same key but disagreeing asset_no → conflict', () => {
    const rows = [
      { country: 'KSA', serial_number: 'SN-400', claim_no: 'WAR-400', asset_no: 'V-1' },
      { country: 'KSA', serial_number: 'SN-400', claim_no: 'WAR-400', asset_no: 'V-2' },
    ]
    const out = classifyDuplicates(rows, 'warranty')
    expect(out.map((r) => r.dup_status)).toEqual(['none', 'conflict'])
  })

  it('different claim_no on same serial → distinct keys, none', () => {
    const rows = [
      { country: 'KSA', serial_number: 'SN-500', claim_no: 'WAR-500A' },
      { country: 'KSA', serial_number: 'SN-500', claim_no: 'WAR-500B' },
    ]
    const out = classifyDuplicates(rows, 'warranty')
    expect(out.every((r) => r.dup_status === 'none')).toBe(true)
  })

  it('same serial + claim across different countries → none (country-scoped)', () => {
    const rows = [
      { country: 'KSA', serial_number: 'SN-600', claim_no: 'WAR-600' },
      { country: 'UAE', serial_number: 'SN-600', claim_no: 'WAR-600' },
    ]
    const out = classifyDuplicates(rows, 'warranty')
    expect(out.every((r) => r.dup_status === 'none')).toBe(true)
  })
})

describe('warranty adapter - natural key', () => {
  it('builds a key from country + serial_number + claim_no', () => {
    expect(naturalKey({ country: 'KSA', serial_number: 'SN-1', claim_no: 'WAR-1' }, 'warranty')).not.toBeNull()
  })

  it('returns null when all identifying parts are blank', () => {
    expect(naturalKey({ country: '', serial_number: '', claim_no: '' }, 'warranty')).toBeNull()
  })
})
