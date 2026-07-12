import { describe, it, expect } from 'vitest'
import { normalizeTagId, summarizeTags, RFID_STATUSES } from '../lib/rfid'

describe('rfid — normalizeTagId', () => {
  it('trims, uppercases and strips whitespace', () => {
    expect(normalizeTagId('  e2003412 b802 a001  ')).toBe('E2003412B802A001')
  })

  it('uppercases hex tag ids', () => {
    expect(normalizeTagId('abc123def')).toBe('ABC123DEF')
  })

  it('collapses all internal whitespace including tabs/newlines', () => {
    expect(normalizeTagId('AB\t12\n34 56')).toBe('AB123456')
  })

  it('returns empty string for nullish / blank input', () => {
    expect(normalizeTagId(null)).toBe('')
    expect(normalizeTagId(undefined)).toBe('')
    expect(normalizeTagId('')).toBe('')
    expect(normalizeTagId('   ')).toBe('')
  })

  it('coerces non-string input', () => {
    expect(normalizeTagId(12345)).toBe('12345')
  })

  it('is idempotent', () => {
    const once = normalizeTagId('  aa bb cc  ')
    expect(normalizeTagId(once)).toBe(once)
  })
})

describe('rfid — summarizeTags', () => {
  const rows = [
    { status: 'active', tyre_serial: 'TS-1', asset_no: 'V-100' },
    { status: 'active', tyre_serial: null, asset_no: 'V-100' }, // same asset (dedup)
    { status: 'active', tyre_serial: 'TS-2', asset_no: 'V-200' },
    { status: 'unassigned', tyre_serial: null, asset_no: null }, // spare tag
    { status: 'retired', tyre_serial: 'TS-3', asset_no: '' },
  ]

  it('counts by status', () => {
    const s = summarizeTags(rows)
    expect(s.byStatus).toEqual({ active: 3, unassigned: 1, retired: 1 })
  })

  it('reports total', () => {
    expect(summarizeTags(rows).total).toBe(5)
  })

  it('splits assigned vs unassigned by mapping presence (not status)', () => {
    const s = summarizeTags(rows)
    // 4 rows have a serial or asset; 1 row has neither
    expect(s.assigned).toBe(4)
    expect(s.unassigned).toBe(1)
  })

  it('counts distinct assets case-insensitively and ignores blanks', () => {
    const s = summarizeTags(rows)
    // V-100 (x2 -> 1) and V-200 -> 2 distinct
    expect(s.assets).toBe(2)
  })

  it('treats unknown status values without crashing', () => {
    const s = summarizeTags([{ status: 'bogus', asset_no: 'A1' }])
    expect(s.byStatus).toEqual({ active: 0, unassigned: 0, retired: 0 })
    expect(s.total).toBe(1)
    expect(s.assigned).toBe(1)
  })

  it('is defensive against non-array / empty input', () => {
    for (const bad of [null, undefined, {}, 'x', 42]) {
      const s = summarizeTags(bad)
      expect(s).toEqual({
        byStatus: { active: 0, unassigned: 0, retired: 0 },
        total: 0,
        assigned: 0,
        unassigned: 0,
        assets: 0,
      })
    }
    expect(summarizeTags().total).toBe(0)
  })

  it('exposes the canonical status list', () => {
    expect(RFID_STATUSES).toEqual(['active', 'unassigned', 'retired'])
  })
})
