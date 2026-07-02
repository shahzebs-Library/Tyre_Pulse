/**
 * Import Center - adapter / migration-plan scenarios.
 *
 * Exercises the real pure pipeline functions against the scenarios enumerated in
 * "Data correction.md" §24 and docs/IMPORT_CENTER_TEST_CASES.md. Kept in a
 * separate file from import.test.js to avoid merge conflicts with other agents.
 */
import { describe, it, expect } from 'vitest'
import {
  suggestMapping,
  exactAlias,
  transformRow,
  validateRow,
  classifyDuplicates,
} from '../lib/import'

describe('adapters - Arabic fleet headers', () => {
  it('maps Arabic fleet headers (رقم المعدة, الموقع) to asset_no / site', () => {
    // Direct alias resolution.
    expect(exactAlias('رقم المعدة', 'fleet')).toBe('asset_no')
    expect(exactAlias('الموقع', 'fleet')).toBe('site')

    // End-to-end through the suggester.
    const out = suggestMapping({ columns: ['رقم المعدة', 'الموقع'], module: 'fleet' })
    const byHeader = Object.fromEntries(out.map((m) => [m.sourceHeader, m]))
    expect(byHeader['رقم المعدة'].target).toBe('asset_no')
    expect(byHeader['رقم المعدة'].action).toBe('auto')
    expect(byHeader['الموقع'].target).toBe('site')
    expect(byHeader['الموقع'].action).toBe('auto')
  })
})

describe('adapters - country-scoped natural keys', () => {
  it('same asset_no in two different countries is NOT a duplicate', () => {
    const rows = [
      { country: 'KSA', asset_no: 'V-100' },
      { country: 'UAE', asset_no: 'V-100' },
    ]
    const out = classifyDuplicates(rows, 'fleet')
    expect(out[0].dup_status).toBe('none')
    expect(out[1].dup_status).toBe('none')
  })

  it('same asset_no in the SAME country IS a duplicate', () => {
    const rows = [
      { country: 'KSA', asset_no: 'V-100' },
      { country: 'KSA', asset_no: 'V-100' },
    ]
    const out = classifyDuplicates(rows, 'fleet')
    expect(out.every((r) => r.dup_status === 'duplicate')).toBe(true)
  })
})

describe('adapters - date validation', () => {
  it('an unparseable date in a date field yields a DATE_INVALID issue', () => {
    // Build the transformed row exactly as the pipeline would: transformRow
    // produces issue_date=null with issue_date_original preserved.
    const mapping = [{ sourceHeader: 'Fitment Date', target: 'issue_date' }]
    const { transformed } = transformRow(
      { 'Fitment Date': 'not-a-date' },
      mapping,
      { module: 'tyre' },
    )
    // Required identifiers so we isolate the date issue.
    transformed.serial_no = 'SN1'
    transformed.asset_no = 'A1'
    const res = validateRow(transformed, 'tyre')
    expect(res.status).toBe('error')
    expect(res.issues.some((i) => i.code === 'DATE_INVALID' && i.field === 'issue_date')).toBe(true)
  })

  it('an out-of-range / ambiguous date yields a DATE_AMBIGUOUS warning', () => {
    const res = validateRow(
      { serial_no: 'SN1', asset_no: 'A1', issue_date: '1850-01-01' },
      'tyre',
    )
    expect(res.issues.some((i) => i.code === 'DATE_AMBIGUOUS' && i.field === 'issue_date')).toBe(true)
  })
})

describe('adapters - repeated tyre serial is an event, not a drop', () => {
  it('repeated serial in same country → duplicate (kept as lifecycle event)', () => {
    const rows = [
      { country: 'KSA', serial_no: 'TS-1', asset_no: 'A1' },
      { country: 'KSA', serial_no: 'TS-1', asset_no: 'A1' },
    ]
    const out = classifyDuplicates(rows, 'tyre')
    // Both rows are retained and flagged - nothing is discarded.
    expect(out).toHaveLength(2)
    expect(out.every((r) => r.dup_status === 'duplicate')).toBe(true)
  })

  it('repeated serial with disagreeing conflict field → conflict', () => {
    const rows = [
      { country: 'KSA', serial_no: 'TS-2', asset_no: 'A1' },
      { country: 'KSA', serial_no: 'TS-2', asset_no: 'A2' }, // asset_no is a tyre conflict field
    ]
    const out = classifyDuplicates(rows, 'tyre')
    expect(out).toHaveLength(2)
    expect(out.every((r) => r.dup_status === 'conflict')).toBe(true)
  })
})

describe('adapters - numeric sanity', () => {
  it('negative stock_qty is a NEGATIVE_VALUE error', () => {
    const res = validateRow(
      { site: 'WH1', description: 'Brake pad', stock_qty: -5 },
      'stock',
    )
    expect(res.status).toBe('error')
    expect(res.issues.some((i) => i.code === 'NEGATIVE_VALUE' && i.field === 'stock_qty')).toBe(true)
  })
})

describe('adapters - unknown columns are preserved', () => {
  it('an unmatched column resolves to action preserve_custom (never discarded)', () => {
    const out = suggestMapping({ columns: ['Totally Unknown Column XYZ'], module: 'fleet' })
    expect(out[0].target).toBeNull()
    expect(out[0].action).toBe('preserve_custom')

    // And transformRow keeps its value verbatim in custom.
    const { custom } = transformRow(
      { 'Asset No': 'V-1', 'Totally Unknown Column XYZ': 'keep me' },
      [{ sourceHeader: 'Asset No', target: 'asset_no' }],
      { module: 'fleet' },
    )
    expect(custom['Totally Unknown Column XYZ']).toBe('keep me')
  })
})

describe('adapters - missing required field', () => {
  it('blank fleet asset_no → error REQUIRED_MISSING', () => {
    const res = validateRow({ asset_no: '', make: 'Volvo' }, 'fleet')
    expect(res.status).toBe('error')
    expect(res.issues.some((i) => i.code === 'REQUIRED_MISSING' && i.field === 'asset_no')).toBe(true)
  })
})
