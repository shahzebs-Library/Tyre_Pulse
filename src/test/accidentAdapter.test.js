/**
 * Import Center — accident & insurance adapter test matrix (Phase 3).
 *
 * Exercises the REAL pure pipeline functions for the accident module: Arabic
 * header mapping, financial-integrity validation, claim/police-report dedup, and
 * natural-key derivation. Date/number cells are routed through transformRow first
 * so values are coerced exactly as the real pipeline does (mirrors adapters.test.js).
 *
 * Kept separate from adapters.test.js / import.test.js to avoid merge conflicts.
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

/** Build a transformed accident row from raw header-keyed cells + a mapping. */
function buildAccidentRow(rawRow, mapping) {
  const { transformed } = transformRow(rawRow, mapping, { module: 'accident' })
  return transformed
}

describe('accident adapter — Arabic header mapping', () => {
  it('resolves Arabic accident headers via exactAlias', () => {
    expect(exactAlias('رقم المطالبة', 'accident')).toBe('insurance_claim_no')
    expect(exactAlias('تاريخ الحادث', 'accident')).toBe('incident_date')
    expect(exactAlias('رقم المعدة', 'accident')).toBe('asset_no')
  })

  it('auto-maps Arabic headers end-to-end through suggestMapping', () => {
    const out = suggestMapping({
      columns: ['رقم المطالبة', 'تاريخ الحادث', 'رقم المعدة'],
      module: 'accident',
    })
    const byHeader = Object.fromEntries(out.map((m) => [m.sourceHeader, m]))

    expect(byHeader['رقم المطالبة'].target).toBe('insurance_claim_no')
    expect(byHeader['رقم المطالبة'].action).toBe('auto')

    expect(byHeader['تاريخ الحادث'].target).toBe('incident_date')
    expect(byHeader['تاريخ الحادث'].action).toBe('auto')

    expect(byHeader['رقم المعدة'].target).toBe('asset_no')
    expect(byHeader['رقم المعدة'].action).toBe('auto')
  })
})

describe('accident adapter — financial integrity (validateRow)', () => {
  const baseMapping = [
    { sourceHeader: 'Asset No', target: 'asset_no' },
    { sourceHeader: 'Incident Date', target: 'incident_date' },
    { sourceHeader: 'Claim Amount', target: 'claim_amount' },
    { sourceHeader: 'Approved Amount', target: 'claim_approved_amount' },
    { sourceHeader: 'Recovered Amount', target: 'recovered_amount' },
    { sourceHeader: 'Repair Cost', target: 'repair_cost' },
    { sourceHeader: 'Estimated Cost', target: 'estimated_damage_cost' },
    { sourceHeader: 'Claim No', target: 'insurance_claim_no' },
  ]

  it('recovered_amount > claim_amount → error RECOVERY_GT_CLAIM', () => {
    const row = buildAccidentRow(
      {
        'Asset No': 'V-1',
        'Incident Date': '12/01/2024',
        'Claim Amount': '1000',
        'Recovered Amount': '1500',
        'Estimated Cost': '900',
        'Claim No': 'CL-1',
      },
      baseMapping,
    )
    const res = validateRow(row, 'accident')
    expect(res.status).toBe('error')
    expect(
      res.issues.some((i) => i.code === 'RECOVERY_GT_CLAIM' && i.field === 'recovered_amount'),
    ).toBe(true)
  })

  it('repair_cost > claim_approved_amount → warning ACTUAL_GT_APPROVED', () => {
    const row = buildAccidentRow(
      {
        'Asset No': 'V-1',
        'Incident Date': '12/01/2024',
        'Claim Amount': '5000',
        'Approved Amount': '3000',
        'Repair Cost': '4000',
        'Estimated Cost': '3200',
        'Claim No': 'CL-2',
      },
      baseMapping,
    )
    const res = validateRow(row, 'accident')
    expect(res.status).toBe('warning')
    expect(
      res.issues.some((i) => i.code === 'ACTUAL_GT_APPROVED' && i.field === 'repair_cost'),
    ).toBe(true)
  })

  it('claim_amount present but estimated_damage_cost blank → warning ESTIMATE_MISSING', () => {
    const row = buildAccidentRow(
      {
        'Asset No': 'V-1',
        'Incident Date': '12/01/2024',
        'Claim Amount': '2500',
        'Claim No': 'CL-3',
      },
      baseMapping,
    )
    const res = validateRow(row, 'accident')
    expect(res.status).toBe('warning')
    expect(
      res.issues.some((i) => i.code === 'ESTIMATE_MISSING' && i.field === 'estimated_damage_cost'),
    ).toBe(true)
  })

  it('both insurance_claim_no and police_report_no blank → warning NO_IDENTIFIER', () => {
    const row = buildAccidentRow(
      {
        'Asset No': 'V-1',
        'Incident Date': '12/01/2024',
        'Claim Amount': '1000',
        'Estimated Cost': '900',
      },
      baseMapping,
    )
    const res = validateRow(row, 'accident')
    expect(
      res.issues.some((i) => i.code === 'NO_IDENTIFIER' && i.field === 'insurance_claim_no'),
    ).toBe(true)
  })

  it('missing required asset_no → error REQUIRED_MISSING', () => {
    const row = buildAccidentRow(
      { 'Incident Date': '12/01/2024', 'Claim No': 'CL-4', 'Estimated Cost': '900' },
      baseMapping,
    )
    const res = validateRow(row, 'accident')
    expect(res.status).toBe('error')
    expect(
      res.issues.some((i) => i.code === 'REQUIRED_MISSING' && i.field === 'asset_no'),
    ).toBe(true)
  })

  it('missing required incident_date → error REQUIRED_MISSING', () => {
    const row = buildAccidentRow(
      { 'Asset No': 'V-1', 'Claim No': 'CL-5', 'Estimated Cost': '900' },
      baseMapping,
    )
    const res = validateRow(row, 'accident')
    expect(res.status).toBe('error')
    expect(
      res.issues.some((i) => i.code === 'REQUIRED_MISSING' && i.field === 'incident_date'),
    ).toBe(true)
  })
})

describe('accident adapter — duplicate classification', () => {
  it('same country + same claim_no → duplicate', () => {
    const rows = [
      { country: 'KSA', insurance_claim_no: 'CL-100', asset_no: 'V-1', incident_date: '2024-01-12', claim_amount: 1000 },
      { country: 'KSA', insurance_claim_no: 'CL-100', asset_no: 'V-1', incident_date: '2024-01-12', claim_amount: 1000 },
    ]
    const out = classifyDuplicates(rows, 'accident')
    expect(out.every((r) => r.dup_status === 'duplicate')).toBe(true)
  })

  it('same country + same claim_no but disagreeing claim_amount → conflict', () => {
    const rows = [
      { country: 'KSA', insurance_claim_no: 'CL-200', asset_no: 'V-1', claim_amount: 1000 },
      { country: 'KSA', insurance_claim_no: 'CL-200', asset_no: 'V-1', claim_amount: 9999 },
    ]
    const out = classifyDuplicates(rows, 'accident')
    expect(out.every((r) => r.dup_status === 'conflict')).toBe(true)
  })

  it('claim_no on one row and identical police_report_no fallback on the other still group', () => {
    // Accident identity = insurance_claim_no || police_report_no. When one row
    // carries the value under claim_no and another carries the SAME value under
    // police_report_no, both resolve to the same natural key and group together.
    const rows = [
      { country: 'KSA', insurance_claim_no: 'REF-7', asset_no: 'V-1' },
      { country: 'KSA', police_report_no: 'REF-7', asset_no: 'V-1' },
    ]
    const out = classifyDuplicates(rows, 'accident')
    expect(out.every((r) => r.dup_status === 'duplicate')).toBe(true)
  })

  it('same claim_no across different countries → none (country-scoped)', () => {
    const rows = [
      { country: 'KSA', insurance_claim_no: 'CL-300', asset_no: 'V-1' },
      { country: 'UAE', insurance_claim_no: 'CL-300', asset_no: 'V-1' },
    ]
    const out = classifyDuplicates(rows, 'accident')
    expect(out.every((r) => r.dup_status === 'none')).toBe(true)
  })
})

describe('accident adapter — natural key', () => {
  it('uses claim_no when present', () => {
    expect(naturalKey({ country: 'KSA', insurance_claim_no: 'CL-1' }, 'accident')).not.toBeNull()
  })

  it('falls back to police_report_no when claim_no blank', () => {
    const withClaim = naturalKey({ country: 'KSA', insurance_claim_no: 'REF-9' }, 'accident')
    const withPolice = naturalKey({ country: 'KSA', police_report_no: 'REF-9' }, 'accident')
    expect(withPolice).toBe(withClaim)
  })

  it('returns null when both identifiers are blank', () => {
    expect(naturalKey({ country: 'KSA', asset_no: 'V-1', incident_date: '2024-01-12' }, 'accident')).toBeNull()
    expect(naturalKey({ country: 'KSA', insurance_claim_no: '', police_report_no: '' }, 'accident')).toBeNull()
  })
})
