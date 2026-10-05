import { describe, it, expect } from 'vitest'
import {
  inferValueType, registryRows, filterRegistry, lineageRows, conflictTotal, scopeBatches, usageBars,
} from '../lib/customDataView'

describe('customDataView', () => {
  it('reads a type from the samples only', () => {
    expect(inferValueType(['12', '1,250.5', '-3'])).toBe('Number')
    expect(inferValueType(['2026-09-01', '07/09/2026'])).toBe('Date')
    expect(inferValueType(['Bridgestone', '12'])).toBe('Text')
    expect(inferValueType([])).toBeNull()
    expect(inferValueType([null, ''])).toBeNull()
  })
  it('builds the registry with mapped state from synonyms', () => {
    const rows = registryRows(
      [{ field_key: 'b_col', record_count: '5', sample_vals: ['x'] }, { field_key: 'A_col', record_count: 9, sample_vals: [] }],
      [{ custom_name: 'a_col', maps_to: 'brand', use_count: 3 }],
    )
    expect(rows.map((r) => r.key)).toEqual(['A_col', 'b_col'])
    expect(rows[0]).toMatchObject({ status: 'mapped', mappedTo: 'brand', records: 9, type: null })
    expect(rows[1]).toMatchObject({ status: 'unmapped', mappedTo: null, records: 5, type: 'Text' })
    expect(filterRegistry(rows, { status: 'unmapped' }).map((r) => r.key)).toEqual(['b_col'])
    expect(filterRegistry(rows, { search: 'brand' }).map((r) => r.key)).toEqual(['A_col'])
  })
  it('shapes lineage honestly', () => {
    const [ok, review, failed, draft, rejected] = lineageRows([
      { id: 1, import_status: 'committed', total_rows: 10, imported_rows: 10, conflict_rows: 0, import_files: { original_filename: 'a.xlsx' } },
      { id: 2, import_status: 'committed', total_rows: 0, imported_rows: 0, conflict_rows: 2 },
      { id: 3, import_status: 'failed' },
      { id: 4, approval_status: 'draft', import_status: 'staged' },
      { id: 5, approval_status: 'rejected', import_status: 'staged' },
    ])
    expect(ok).toMatchObject({ file: 'a.xlsx', share: 100, label: 'Imported', tone: 'good' })
    expect(review).toMatchObject({ share: null, label: 'Review', tone: 'warn' })
    expect(failed.label).toBe('Failed')
    expect(draft.label).toBe('Never approved')
    expect(rejected.label).toBe('Rejected')
  })
  it('totals conflicts and scopes by country', () => {
    expect(conflictTotal(null)).toBeNull()
    expect(conflictTotal([{ conflict_rows: 2 }, { conflict_rows: null }, { conflict_rows: 5 }])).toBe(7)
    const b = [{ country: 'KSA' }, { country: 'UAE' }, { country: null }]
    expect(scopeBatches(b, 'KSA')).toHaveLength(2)
    expect(scopeBatches(b, 'All')).toHaveLength(3)
    expect(scopeBatches(null, 'KSA')).toBeNull()
  })
  it('ranks usage bars against the largest', () => {
    const bars = usageBars([{ key: 'a', records: 50, status: 'mapped' }, { key: 'b', records: 100, status: 'unmapped' }])
    expect(bars.map((x) => [x.key, x.pct])).toEqual([['b', 100], ['a', 50]])
  })
})
