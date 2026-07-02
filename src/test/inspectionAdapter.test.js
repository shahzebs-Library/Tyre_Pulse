/**
 * Import Center - inspection adapter test matrix (Phase 4).
 *
 * Exercises the REAL pure pipeline functions for the inspection module: Arabic
 * header mapping, required-field validation, event-level duplicate/conflict
 * classification, and natural-key derivation. Date cells are routed through
 * transformRow first so values are coerced exactly as the real pipeline does
 * (mirrors adapters.test.js / accidentAdapter.test.js).
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

/** Build a transformed inspection row from raw header-keyed cells + a mapping. */
function buildInspectionRow(rawRow, mapping) {
  const { transformed } = transformRow(rawRow, mapping, { module: 'inspection' })
  return transformed
}

describe('inspection adapter - Arabic header mapping', () => {
  it('resolves Arabic inspection headers via exactAlias', () => {
    expect(exactAlias('رقم المعدة', 'inspection')).toBe('asset_no')
    expect(exactAlias('تاريخ الفحص', 'inspection')).toBe('inspection_date')
    expect(exactAlias('نوع الفحص', 'inspection')).toBe('inspection_type')
    expect(exactAlias('المفتش', 'inspection')).toBe('inspector')
  })

  it('auto-maps Arabic headers end-to-end through suggestMapping', () => {
    const out = suggestMapping({
      columns: ['رقم المعدة', 'تاريخ الفحص', 'نوع الفحص', 'المفتش'],
      module: 'inspection',
    })
    const byHeader = Object.fromEntries(out.map((m) => [m.sourceHeader, m]))

    expect(byHeader['رقم المعدة'].target).toBe('asset_no')
    expect(byHeader['رقم المعدة'].action).toBe('auto')

    expect(byHeader['تاريخ الفحص'].target).toBe('inspection_date')
    expect(byHeader['تاريخ الفحص'].action).toBe('auto')

    expect(byHeader['نوع الفحص'].target).toBe('inspection_type')
    expect(byHeader['نوع الفحص'].action).toBe('auto')

    expect(byHeader['المفتش'].target).toBe('inspector')
    expect(byHeader['المفتش'].action).toBe('auto')
  })
})

describe('inspection adapter - required-field validation (validateRow)', () => {
  const baseMapping = [
    { sourceHeader: 'Asset No', target: 'asset_no' },
    { sourceHeader: 'Inspection Date', target: 'inspection_date' },
    { sourceHeader: 'Inspection Type', target: 'inspection_type' },
    { sourceHeader: 'Inspector', target: 'inspector' },
  ]

  it('missing required asset_no → error REQUIRED_MISSING', () => {
    const row = buildInspectionRow(
      { 'Inspection Date': '12/01/2024', 'Inspection Type': 'Routine', Inspector: 'Ali' },
      baseMapping,
    )
    const res = validateRow(row, 'inspection')
    expect(res.status).toBe('error')
    expect(
      res.issues.some((i) => i.code === 'REQUIRED_MISSING' && i.field === 'asset_no'),
    ).toBe(true)
  })

  it('missing required inspection_date → error REQUIRED_MISSING', () => {
    const row = buildInspectionRow(
      { 'Asset No': 'V-1', 'Inspection Type': 'Routine', Inspector: 'Ali' },
      baseMapping,
    )
    const res = validateRow(row, 'inspection')
    expect(res.status).toBe('error')
    expect(
      res.issues.some((i) => i.code === 'REQUIRED_MISSING' && i.field === 'inspection_date'),
    ).toBe(true)
  })

  it('both required fields present → ready (no required-field errors)', () => {
    const row = buildInspectionRow(
      { 'Asset No': 'V-1', 'Inspection Date': '12/01/2024', 'Inspection Type': 'Routine', Inspector: 'Ali' },
      baseMapping,
    )
    const res = validateRow(row, 'inspection')
    expect(res.issues.some((i) => i.code === 'REQUIRED_MISSING')).toBe(false)
    expect(res.status).toBe('ready')
  })
})

describe('inspection adapter - duplicate classification (event-scoped)', () => {
  // Natural key = country + asset_no + inspection_type + inspection_date + inspector.
  const mapping = [
    { sourceHeader: 'Asset No', target: 'asset_no' },
    { sourceHeader: 'Inspection Date', target: 'inspection_date' },
    { sourceHeader: 'Inspection Type', target: 'inspection_type' },
    { sourceHeader: 'Inspector', target: 'inspector' },
    { sourceHeader: 'Status', target: 'status' },
    { sourceHeader: 'Severity', target: 'severity' },
    { sourceHeader: 'Findings', target: 'findings' },
  ]
  const make = (over) =>
    buildInspectionRow(
      {
        'Asset No': 'V-1',
        'Inspection Date': '12/01/2024',
        'Inspection Type': 'Routine',
        Inspector: 'Ali',
        Status: 'Done',
        Severity: 'Low',
        Findings: 'OK',
        ...over,
      },
      mapping,
    )

  it('two identical inspection events in same country → duplicate', () => {
    const rows = [
      { country: 'KSA', ...make({}) },
      { country: 'KSA', ...make({}) },
    ]
    const out = classifyDuplicates(rows, 'inspection')
    expect(out.every((r) => r.dup_status === 'duplicate')).toBe(true)
  })

  it('same event key but disagreeing conflict field (findings) → conflict', () => {
    const rows = [
      { country: 'KSA', ...make({ Findings: 'OK' }) },
      { country: 'KSA', ...make({ Findings: 'Cracked sidewall' }) },
    ]
    const out = classifyDuplicates(rows, 'inspection')
    expect(out.every((r) => r.dup_status === 'conflict')).toBe(true)
  })

  it('same event key but disagreeing conflict field (status/severity) → conflict', () => {
    const rows = [
      { country: 'KSA', ...make({ Status: 'Done', Severity: 'Low' }) },
      { country: 'KSA', ...make({ Status: 'In Progress', Severity: 'High' }) },
    ]
    const out = classifyDuplicates(rows, 'inspection')
    expect(out.every((r) => r.dup_status === 'conflict')).toBe(true)
  })

  it('different inspector → distinct event → none (not a duplicate)', () => {
    const rows = [
      { country: 'KSA', ...make({ Inspector: 'Ali' }) },
      { country: 'KSA', ...make({ Inspector: 'Omar' }) },
    ]
    const out = classifyDuplicates(rows, 'inspection')
    expect(out.every((r) => r.dup_status === 'none')).toBe(true)
  })

  it('same event key across different countries → none (country-scoped)', () => {
    const rows = [
      { country: 'KSA', ...make({}) },
      { country: 'UAE', ...make({}) },
    ]
    const out = classifyDuplicates(rows, 'inspection')
    expect(out.every((r) => r.dup_status === 'none')).toBe(true)
  })
})

describe('inspection adapter - natural key', () => {
  const mapping = [
    { sourceHeader: 'Asset No', target: 'asset_no' },
    { sourceHeader: 'Inspection Date', target: 'inspection_date' },
    { sourceHeader: 'Inspection Type', target: 'inspection_type' },
    { sourceHeader: 'Inspector', target: 'inspector' },
  ]
  const raw = {
    'Asset No': 'V-1',
    'Inspection Date': '12/01/2024',
    'Inspection Type': 'Routine',
    Inspector: 'Ali',
  }

  it('is stable and identical for two identical rows', () => {
    const a = naturalKey({ country: 'KSA', ...buildInspectionRow(raw, mapping) }, 'inspection')
    const b = naturalKey({ country: 'KSA', ...buildInspectionRow(raw, mapping) }, 'inspection')
    expect(a).not.toBeNull()
    expect(a).toBe(b)
  })

  it('changes when the inspector differs (distinct event)', () => {
    const a = naturalKey({ country: 'KSA', ...buildInspectionRow(raw, mapping) }, 'inspection')
    const b = naturalKey(
      { country: 'KSA', ...buildInspectionRow({ ...raw, Inspector: 'Omar' }, mapping) },
      'inspection',
    )
    expect(a).not.toBe(b)
  })
})
