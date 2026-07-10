/**
 * Import Center - gate-pass adapter test matrix (Phase 4).
 *
 * Exercises the REAL pure pipeline functions for the gatepass module: Arabic/EN
 * header mapping, required-field enforcement (asset_no + pass_date), and
 * asset+date duplicate/conflict classification. Date cells are routed through
 * transformRow first so values are coerced exactly as the real pipeline does
 * (mirrors adapters.test.js / accidentAdapter.test.js).
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

/** Build a transformed gatepass row from raw header-keyed cells + a mapping. */
function buildGatePassRow(rawRow, mapping) {
  const { transformed } = transformRow(rawRow, mapping, { module: 'gatepass' })
  return transformed
}

describe('gatepass adapter - Arabic/EN header mapping', () => {
  it('resolves Arabic + English gate-pass headers via exactAlias', () => {
    expect(exactAlias('رقم المعدة', 'gatepass')).toBe('asset_no')
    expect(exactAlias('تاريخ التصريح', 'gatepass')).toBe('pass_date')
    expect(exactAlias('pass date', 'gatepass')).toBe('pass_date')
    expect(exactAlias('asset', 'gatepass')).toBe('asset_no')
  })

  it('auto-maps mixed Arabic/English headers end-to-end through suggestMapping', () => {
    const out = suggestMapping({
      columns: ['رقم المعدة', 'تاريخ التصريح', 'Status', 'Denial Reason'],
      module: 'gatepass',
    })
    const byHeader = Object.fromEntries(out.map((m) => [m.sourceHeader, m]))

    expect(byHeader['رقم المعدة'].target).toBe('asset_no')
    expect(byHeader['رقم المعدة'].action).toBe('auto')

    expect(byHeader['تاريخ التصريح'].target).toBe('pass_date')
    expect(byHeader['تاريخ التصريح'].action).toBe('auto')

    expect(byHeader['Status'].target).toBe('status')
    expect(byHeader['Status'].action).toBe('auto')

    expect(byHeader['Denial Reason'].target).toBe('denial_reason')
    expect(byHeader['Denial Reason'].action).toBe('auto')
  })
})

describe('gatepass adapter - required validation (validateRow)', () => {
  const baseMapping = [
    { sourceHeader: 'Asset No', target: 'asset_no' },
    { sourceHeader: 'Pass Date', target: 'pass_date' },
    { sourceHeader: 'Status', target: 'status' },
  ]

  it('missing required asset_no → error REQUIRED_MISSING', () => {
    const row = buildGatePassRow(
      { 'Pass Date': '12/01/2024', 'Status': 'Cleared' },
      baseMapping,
    )
    const res = validateRow(row, 'gatepass')
    expect(res.status).toBe('error')
    expect(
      res.issues.some((i) => i.code === 'REQUIRED_MISSING' && i.field === 'asset_no'),
    ).toBe(true)
  })

  it('missing required pass_date → error REQUIRED_MISSING', () => {
    const row = buildGatePassRow(
      { 'Asset No': 'V-1', 'Status': 'Cleared' },
      baseMapping,
    )
    const res = validateRow(row, 'gatepass')
    expect(res.status).toBe('error')
    expect(
      res.issues.some((i) => i.code === 'REQUIRED_MISSING' && i.field === 'pass_date'),
    ).toBe(true)
  })

  it('asset_no + parsed pass_date present → ready', () => {
    const row = buildGatePassRow(
      { 'Asset No': 'V-1', 'Pass Date': '12/01/2024', 'Status': 'Cleared' },
      baseMapping,
    )
    const res = validateRow(row, 'gatepass')
    expect(res.status).toBe('ready')
  })
})

describe('gatepass adapter - duplicate classification', () => {
  it('same country + asset_no + pass_date → duplicate', () => {
    const rows = [
      { country: 'KSA', asset_no: 'V-1', pass_date: '2024-01-12', site: 'Gate A', status: 'Cleared' },
      { country: 'KSA', asset_no: 'V-1', pass_date: '2024-01-12', site: 'Gate A', status: 'Cleared' },
    ]
    const out = classifyDuplicates(rows, 'gatepass')
    expect(out.map((r) => r.dup_status)).toEqual(['none', 'duplicate'])
  })

  it('differing pass_date → none (distinct keys)', () => {
    const rows = [
      { country: 'KSA', asset_no: 'V-1', pass_date: '2024-01-12' },
      { country: 'KSA', asset_no: 'V-1', pass_date: '2024-01-13' },
    ]
    const out = classifyDuplicates(rows, 'gatepass')
    expect(out.every((r) => r.dup_status === 'none')).toBe(true)
  })

  it('same key but disagreeing site → conflict', () => {
    const rows = [
      { country: 'KSA', asset_no: 'V-1', pass_date: '2024-01-12', site: 'Gate A' },
      { country: 'KSA', asset_no: 'V-1', pass_date: '2024-01-12', site: 'Gate B' },
    ]
    const out = classifyDuplicates(rows, 'gatepass')
    expect(out.map((r) => r.dup_status)).toEqual(['none', 'conflict'])
  })

  it('same key but disagreeing status → conflict', () => {
    const rows = [
      { country: 'KSA', asset_no: 'V-1', pass_date: '2024-01-12', status: 'Cleared' },
      { country: 'KSA', asset_no: 'V-1', pass_date: '2024-01-12', status: 'Denied' },
    ]
    const out = classifyDuplicates(rows, 'gatepass')
    expect(out.map((r) => r.dup_status)).toEqual(['none', 'conflict'])
  })

  it('same asset + date across different countries → none (country-scoped)', () => {
    const rows = [
      { country: 'KSA', asset_no: 'V-1', pass_date: '2024-01-12' },
      { country: 'UAE', asset_no: 'V-1', pass_date: '2024-01-12' },
    ]
    const out = classifyDuplicates(rows, 'gatepass')
    expect(out.every((r) => r.dup_status === 'none')).toBe(true)
  })
})

describe('gatepass adapter - natural key', () => {
  it('builds a key from country + asset_no + pass_date', () => {
    expect(naturalKey({ country: 'KSA', asset_no: 'V-1', pass_date: '2024-01-12' }, 'gatepass')).not.toBeNull()
  })

  it('returns null when all identifying parts are blank', () => {
    expect(naturalKey({ country: '', asset_no: '', pass_date: '' }, 'gatepass')).toBeNull()
  })
})
