import { describe, it, expect } from 'vitest'
import {
  pick, num, normalizeOrphan, normalizeDupe, normalizeMovement,
  filterOrphans, filterDupes, filterMovements, countriesOf, reconSummary, daysSince,
} from '../lib/dataReconciliationAnalytics'

describe('field accessors', () => {
  it('pick skips null and empty values', () => {
    expect(pick({ a: '', b: null, c: 'x' }, ['a', 'b', 'c'])).toBe('x')
    expect(pick(null, ['a'], 'fb')).toBe('fb')
  })
  it('num honours a null fallback and rejects junk', () => {
    expect(num({ n: '4' }, ['n'])).toBe(4)
    expect(num({ n: 'abc' }, ['n'], null)).toBeNull()
    expect(num({}, ['n'], null)).toBeNull()
  })
})

describe('normalizers accept every drifted field name', () => {
  it('orphan', () => {
    const o = normalizeOrphan({ assetNo: 'TM1', vehicle_type: 'MIXER', country_code: 'KSA', tyre_count: '6' })
    expect(o).toMatchObject({ assetNo: 'TM1', type: 'MIXER', country: 'KSA', tyres: 6 })
    expect(normalizeOrphan({ asset_no: 'X' }).tyres).toBeNull()
  })
  it('dupe counts removable copies from ids or copies - 1', () => {
    expect(normalizeDupe({ serial_no: 'S', count: 3 }).removable).toBe(2)
    expect(normalizeDupe({ serial: 'S', remove_ids: ['a'] }).removable).toBe(1)
    expect(normalizeDupe({ serial: 'S' }).copies).toBe(2)
  })
  it('movement reads placements, first and last seen', () => {
    const m = normalizeMovement({ serial: 'S1', movements: [
      { asset_no: 'A', fitted_at: '2026-03-02T10:00:00Z' },
      { vehicle: 'B', date: '2026-01-10' },
      { asset_no: 'A', date: '2026-05-01' },
    ] })
    expect(m.vehicles).toBe(3)
    expect(m.distinctAssets).toBe(2)
    expect(m.firstSeen).toBe('2026-01-10')
    expect(m.lastSeen).toBe('2026-05-01')
  })
  it('movement falls back to a reported count when no list is present', () => {
    expect(normalizeMovement({ serial: 'S', vehicle_count: 4 }).vehicles).toBe(4)
  })
})

describe('filters', () => {
  const orphans = [normalizeOrphan({ asset_no: 'TM1', country: 'KSA' }), normalizeOrphan({ asset_no: 'TM2', country: 'UAE' })]
  const moves = [
    normalizeMovement({ serial: 'S1', vehicles: [{ asset_no: 'A', date: '2026-01-10' }] }),
    normalizeMovement({ serial: 'S2', vehicles: [{ asset_no: 'B', date: '2026-06-10' }] }),
  ]
  it('orphans by country and search', () => {
    expect(filterOrphans(orphans, { country: 'UAE' }).map(r => r.assetNo)).toEqual(['TM2'])
    expect(filterOrphans(orphans, { q: 'tm1' })).toHaveLength(1)
    expect(countriesOf(orphans)).toEqual(['KSA', 'UAE'])
  })
  it('dupes by search', () => {
    expect(filterDupes([normalizeDupe({ serial: 'ABC' })], { q: 'xyz' })).toHaveLength(0)
  })
  it('movements match when any placement falls in the window', () => {
    expect(filterMovements(moves, { from: '2026-05-01' }).map(r => r.serial)).toEqual(['S2'])
    expect(filterMovements(moves, { to: '2026-02-01' }).map(r => r.serial)).toEqual(['S1'])
    expect(filterMovements(moves, {})).toHaveLength(2)
  })
})

describe('reconSummary', () => {
  const ok = (rows) => ({ loading: false, error: null, rows })
  it('reports null, not zero, for a section that failed or is loading', () => {
    const s = reconSummary({
      orphans: { loading: false, error: 'boom', rows: [] },
      dupes: { loading: true, error: null, rows: [] },
      movements: ok([]),
    })
    expect(s.orphanAssets).toBeNull()
    expect(s.dupeGroups).toBeNull()
    expect(s.movedSerials).toBe(0)
    expect(s.complete).toBe(false)
  })
  it('totals tyres and removable copies, null when never reported', () => {
    const s = reconSummary({
      orphans: ok([normalizeOrphan({ asset_no: 'A', tyres: 4 }), normalizeOrphan({ asset_no: 'B' })]),
      dupes: ok([normalizeDupe({ serial: 'S', copies: 3 })]),
      movements: ok([normalizeMovement({ serial: 'M', vehicles: [{}, {}] })]),
    })
    expect(s.orphanTyres).toBe(4)
    expect(s.removableCopies).toBe(2)
    expect(s.placements).toBe(2)
    expect(s.complete).toBe(true)
    expect(reconSummary({ orphans: ok([normalizeOrphan({ asset_no: 'A' })]), dupes: ok([]), movements: ok([]) }).orphanTyres).toBeNull()
  })
})

describe('daysSince', () => {
  it('counts whole days and returns null for junk', () => {
    expect(daysSince('2026-01-01', new Date('2026-01-11T12:00:00Z'))).toBe(10)
    expect(daysSince('nope')).toBeNull()
    expect(daysSince(null)).toBeNull()
  })
})
