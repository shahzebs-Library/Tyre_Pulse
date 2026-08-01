import { describe, expect, it } from 'vitest'
import { duplicateComparable, isExactSuppliedRow } from '../lib/import/exactDuplicate'

describe('exact duplicate upload policy', () => {
  const live = {
    id: 'live-id', organisation_id: 'org-id', serial_no: 'TY-133', asset_no: 'KSA-10',
    issue_date: '2026-08-01T00:00:00Z', brand: 'Michelin', total_km: 1500,
    extra_fields: { source: 'ERP', line: 7 },
  }

  it('drops a normalized field-for-field supplied copy', () => {
    expect(isExactSuppliedRow({
      serial_no: ' ty-133 ', asset_no: 'ksa-10', issue_date: '2026-08-01',
      brand: 'MICHELIN', total_km: 1500,
      extra_fields: { line: 7, source: 'ERP' },
    }, live)).toBe(true)
  })

  it('does not drop a same-key row when any supplied value changed', () => {
    expect(isExactSuppliedRow({ serial_no: 'TY-133', asset_no: 'KSA-10', brand: 'Bridgestone' }, live)).toBe(false)
  })

  it('ignores server identity fields but compares supplied blanks', () => {
    expect(isExactSuppliedRow({ id: 'new-id', serial_no: 'TY-133', brand: '' }, live)).toBe(false)
    expect(duplicateComparable(null)).toBe(duplicateComparable('  '))
  })
})
