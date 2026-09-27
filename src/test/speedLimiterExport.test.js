import { describe, it, expect } from 'vitest'
import { speedLimiterExportRows, dueLabel, SPEED_LIMITER_EXPORT_COLUMNS } from '../lib/speedLimiterAnalytics'

const asOf = new Date('2026-09-27T00:00:00Z')

describe('speedLimiterAnalytics export rows', () => {
  it('uses the same band and compliance rules as the screen', () => {
    const rows = speedLimiterExportRows([
      { asset_no: 'A', limit_kph: 80, status: 'active', last_verified_at: '2026-01-01' },
      { asset_no: 'B', limit_kph: '', status: 'fault', last_verified_at: null },
      { asset_no: 'C', limit_kph: 90, status: 'active', last_verified_at: '2025-01-01' },
    ], { asOf, reverifyDays: 365, expiringSoonDays: 30 })
    expect(rows[0]).toMatchObject({ compliant: 'Yes', reason: '', next_due: '2027-01-01', limit_kph: 80 })
    expect(rows[1]).toMatchObject({ compliant: 'No', reason: 'Limiter in fault', next_due: 'N/A', limit_kph: '' })
    expect(rows[2]).toMatchObject({ compliant: 'No', reason: 'Verification overdue' })
    expect(Object.keys(rows[0]).sort()).toEqual(SPEED_LIMITER_EXPORT_COLUMNS.map((c) => c[0]).sort())
  })

  it('dueLabel', () => {
    expect(dueLabel(null)).toBe('Not verified')
    expect(dueLabel(-3)).toBe('3d overdue')
    expect(dueLabel(0)).toBe('Due today')
    expect(dueLabel(10)).toBe('In 10d')
  })
})
