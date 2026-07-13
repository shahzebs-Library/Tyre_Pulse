import { describe, it, expect } from 'vitest'
import {
  poolStats, byLocation, replenishment, returnConditionToStatus,
  POOL_ENTRY_STATUSES, POOL_REASONS,
} from '../lib/tyrePool'

describe('tyrePool — poolStats', () => {
  it('counts by status and computes utilisation as deployed/total', () => {
    const s = poolStats([
      { status: 'available' }, { status: 'available' },
      { status: 'deployed' }, { status: 'deployed' }, { status: 'deployed' },
      { status: 'maintenance' },
      { status: 'reserved' },
      { status: 'retired' }, { status: 'retired' },
    ])
    expect(s.total).toBe(9)
    expect(s.available).toBe(2)
    expect(s.deployed).toBe(3)
    expect(s.maintenance).toBe(1)
    expect(s.reserved).toBe(1)
    expect(s.retired).toBe(2)
    // 3/9 = 33.33 → rounded to 1dp
    expect(s.utilisationPct).toBe(33.3)
  })

  it('returns zeroes and 0% utilisation for an empty / non-array input', () => {
    for (const input of [[], null, undefined, 'nope']) {
      const s = poolStats(input)
      expect(s.total).toBe(0)
      expect(s.available).toBe(0)
      expect(s.deployed).toBe(0)
      expect(s.utilisationPct).toBe(0)
    }
  })

  it('reaches 100% utilisation when every entry is deployed', () => {
    expect(poolStats([{ status: 'deployed' }, { status: 'deployed' }]).utilisationPct).toBe(100)
  })

  it('ignores unknown statuses in the named buckets but counts them in total', () => {
    const s = poolStats([{ status: 'available' }, { status: 'ghost' }, {}])
    expect(s.total).toBe(3)
    expect(s.available).toBe(1)
    expect(s.deployed).toBe(0)
    expect(s.utilisationPct).toBe(0)
  })
})

describe('tyrePool — byLocation', () => {
  it('groups ONLY available entries by pool_location, count desc', () => {
    const rows = [
      { status: 'available', pool_location: 'Dubai' },
      { status: 'available', pool_location: 'Dubai' },
      { status: 'available', pool_location: 'Abu Dhabi' },
      { status: 'deployed', pool_location: 'Dubai' },     // excluded (not available)
      { status: 'maintenance', pool_location: 'Sharjah' }, // excluded
    ]
    expect(byLocation(rows)).toEqual([
      { location: 'Dubai', count: 2 },
      { location: 'Abu Dhabi', count: 1 },
    ])
  })

  it('collapses blank locations into Unassigned and tie-breaks by name', () => {
    const rows = [
      { status: 'available', pool_location: '' },
      { status: 'available', pool_location: null },
      { status: 'available', pool_location: 'Zulu' },
      { status: 'available', pool_location: 'Alpha' },
    ]
    const out = byLocation(rows)
    expect(out[0]).toEqual({ location: 'Unassigned', count: 2 })
    // Alpha before Zulu (equal count → alphabetical)
    expect(out.map((o) => o.location)).toEqual(['Unassigned', 'Alpha', 'Zulu'])
  })

  it('returns [] for empty / non-array input', () => {
    expect(byLocation([])).toEqual([])
    expect(byLocation(null)).toEqual([])
  })
})

describe('tyrePool — replenishment', () => {
  it('applies the max(4, round(vehicles*4*0.10)) formula with a floor of 4', () => {
    // 5 vehicles → 5*4*0.10 = 2 → floored to 4
    expect(replenishment(5, 0).recommended).toBe(4)
    // 0 vehicles → floor 4
    expect(replenishment(0, 0).recommended).toBe(4)
    // 100 vehicles → 100*4*0.10 = 40
    expect(replenishment(100, 0).recommended).toBe(40)
    // 25 vehicles → 25*4*0.10 = 10
    expect(replenishment(25, 0).recommended).toBe(10)
  })

  it('rounds the raw recommendation to the nearest integer', () => {
    // 13 vehicles → 13*4*0.10 = 5.2 → round → 5
    expect(replenishment(13, 0).recommended).toBe(5)
    // 14 vehicles → 14*4*0.10 = 5.6 → round → 6
    expect(replenishment(14, 0).recommended).toBe(6)
  })

  it('computes the gap and bands status: adequate → low → critical', () => {
    // recommended 40, available 40 → gap 0 → adequate
    let r = replenishment(100, 40)
    expect(r.gap).toBe(0)
    expect(r.status).toBe('adequate')
    expect(r.advice).toMatch(/adequately stocked/i)
    expect(r.current).toBe(40)

    // recommended 40, available 37 → gap 3 (≤4) → low
    r = replenishment(100, 37)
    expect(r.gap).toBe(3)
    expect(r.status).toBe('low')
    expect(r.advice).toMatch(/Add 3 more tyres/)

    // recommended 40, available 36 → gap 4 (≤4) → still low (boundary)
    expect(replenishment(100, 36).status).toBe('low')

    // recommended 40, available 35 → gap 5 (>4) → critical
    r = replenishment(100, 35)
    expect(r.gap).toBe(5)
    expect(r.status).toBe('critical')
  })

  it('never returns a negative gap when overstocked', () => {
    const r = replenishment(100, 80)
    expect(r.gap).toBe(0)
    expect(r.status).toBe('adequate')
  })

  it('uses singular wording for a gap of one', () => {
    // recommended 4, available 3 → gap 1
    const r = replenishment(0, 3)
    expect(r.gap).toBe(1)
    expect(r.advice).toMatch(/Add 1 more tyre to/)
  })

  it('guards against non-numeric / negative inputs', () => {
    const r = replenishment(-10, -5)
    expect(r.recommended).toBe(4)
    expect(r.current).toBe(0)
    expect(r.gap).toBe(4)
  })
})

describe('tyrePool — returnConditionToStatus', () => {
  it('maps good → available, worn → maintenance, else → retired', () => {
    expect(returnConditionToStatus('good')).toBe('available')
    expect(returnConditionToStatus('worn')).toBe('maintenance')
    expect(returnConditionToStatus('damaged')).toBe('retired')
    expect(returnConditionToStatus('scrapped')).toBe('retired')
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(returnConditionToStatus(' GOOD ')).toBe('available')
    expect(returnConditionToStatus('Worn')).toBe('maintenance')
  })

  it('treats missing / empty condition as retired (fail safe)', () => {
    expect(returnConditionToStatus(null)).toBe('retired')
    expect(returnConditionToStatus('')).toBe('retired')
    expect(returnConditionToStatus(undefined)).toBe('retired')
  })
})

describe('tyrePool — vocabularies', () => {
  it('exposes the status and reason vocabularies used by the UI + DB CHECKs', () => {
    expect(POOL_ENTRY_STATUSES).toEqual(['available', 'reserved', 'deployed', 'maintenance', 'retired'])
    expect(POOL_REASONS).toEqual([
      'hot_spare', 'seasonal_rotation', 'buffer_stock', 'warranty_replacement', 'retreat_return',
    ])
  })
})
