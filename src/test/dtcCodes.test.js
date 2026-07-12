import { describe, it, expect } from 'vitest'
import { summarizeDtc } from '../lib/dtcCodes'

const rows = [
  { asset_no: 'TRK-01', status: 'active', severity: 'critical' },
  { asset_no: 'TRK-01', status: 'active', severity: 'warning' },
  { asset_no: 'TRK-02', status: 'acknowledged', severity: 'critical' },
  { asset_no: 'TRK-03', status: 'cleared', severity: 'info' },
  { asset_no: ' TRK-01 ', status: 'active', severity: 'critical' }, // dup asset (trimmed)
]

describe('summarizeDtc', () => {
  it('returns zeroed summary for empty / non-array input', () => {
    const empty = summarizeDtc([])
    expect(empty.total).toBe(0)
    expect(empty.byStatus).toEqual({ active: 0, acknowledged: 0, cleared: 0 })
    expect(empty.bySeverity).toEqual({ info: 0, warning: 0, critical: 0 })
    expect(empty.active).toBe(0)
    expect(empty.criticalActive).toBe(0)
    expect(empty.assetsAffected).toBe(0)
    // non-array is tolerated
    expect(summarizeDtc(null).total).toBe(0)
    expect(summarizeDtc(undefined).total).toBe(0)
  })

  it('counts by status', () => {
    const s = summarizeDtc(rows)
    expect(s.total).toBe(5)
    expect(s.byStatus).toEqual({ active: 3, acknowledged: 1, cleared: 1 })
    expect(s.active).toBe(3)
  })

  it('counts by severity', () => {
    const s = summarizeDtc(rows)
    expect(s.bySeverity).toEqual({ info: 1, warning: 1, critical: 3 })
  })

  it('counts active-critical codes only', () => {
    const s = summarizeDtc(rows)
    // two active+critical (TRK-01 and the trimmed dup); TRK-02 critical is acknowledged
    expect(s.criticalActive).toBe(2)
  })

  it('counts distinct affected assets (trimmed)', () => {
    const s = summarizeDtc(rows)
    // TRK-01 (incl. " TRK-01 "), TRK-02, TRK-03 => 3 distinct
    expect(s.assetsAffected).toBe(3)
  })

  it('ignores unknown status/severity values and null rows', () => {
    const s = summarizeDtc([
      { asset_no: 'X', status: 'bogus', severity: 'nope' },
      null,
      { asset_no: '', status: 'active', severity: 'info' },
    ])
    expect(s.total).toBe(3)
    expect(s.byStatus).toEqual({ active: 1, acknowledged: 0, cleared: 0 })
    expect(s.bySeverity).toEqual({ info: 1, warning: 0, critical: 0 })
    expect(s.assetsAffected).toBe(1) // only 'X' (empty asset ignored)
  })
})
