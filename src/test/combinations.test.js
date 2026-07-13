import { describe, it, expect } from 'vitest'
import {
  parseTrailerList, summarizeCombinations, normalizePositionClass,
  resolveCombinationMembers, memberTyres, computeCombinationRollup,
  detectDuplicateTrailers, POSITION_CLASSES,
} from '../lib/combinations'

describe('parseTrailerList', () => {
  it('returns [] for nullish input', () => {
    expect(parseTrailerList(null)).toEqual([])
    expect(parseTrailerList(undefined)).toEqual([])
    expect(parseTrailerList('')).toEqual([])
  })

  it('splits on commas and whitespace, trimming blanks', () => {
    expect(parseTrailerList('T1, T2 T3')).toEqual(['T1', 'T2', 'T3'])
    expect(parseTrailerList('  T1 ,,  T2 ')).toEqual(['T1', 'T2'])
  })

  it('dedupes case-insensitively, keeping first spelling and order', () => {
    expect(parseTrailerList('T1, t1, T2, T1')).toEqual(['T1', 'T2'])
  })

  it('accepts an array input', () => {
    expect(parseTrailerList(['A', ' B ', 'a', ''])).toEqual(['A', 'B'])
  })
})

describe('summarizeCombinations', () => {
  it('handles empty / non-array input', () => {
    expect(summarizeCombinations([])).toEqual({ total: 0, active: 0, inactive: 0, trailers: 0, units: 0 })
    expect(summarizeCombinations(undefined)).toEqual({ total: 0, active: 0, inactive: 0, trailers: 0, units: 0 })
  })

  it('counts combinations, active/inactive, trailers and total units', () => {
    const rows = [
      { status: 'active', prime_mover_no: 'PM1', trailer_nos: ['T1', 'T2'] },
      { status: 'inactive', prime_mover_no: 'PM2', trailer_nos: ['T3'] },
      { status: 'active', prime_mover_no: 'PM3', trailer_nos: [] },
    ]
    expect(summarizeCombinations(rows)).toEqual({
      total: 3,
      active: 2,
      inactive: 1,
      trailers: 3, // 2 + 1 + 0
      units: 6,    // 3 movers + 3 trailers
    })
  })

  it('parses string trailer_nos and ignores blank prime movers for unit count', () => {
    const rows = [
      { status: 'active', prime_mover_no: 'PM1', trailer_nos: 'T1, T2' },
      { status: 'active', prime_mover_no: '   ', trailer_nos: 'T3' },
    ]
    const s = summarizeCombinations(rows)
    expect(s.trailers).toBe(3)
    expect(s.units).toBe(4) // 1 mover + 3 trailers
  })
})

// ── Combined-unit intelligence ───────────────────────────────────────────────

describe('normalizePositionClass', () => {
  it('classifies steer / drive / trailer from free text and codes', () => {
    expect(normalizePositionClass('Steer')).toBe('steer')
    expect(normalizePositionClass('front left')).toBe('steer')
    expect(normalizePositionClass('Drive axle 2')).toBe('drive')
    expect(normalizePositionClass('Trailer')).toBe('trailer')
    expect(normalizePositionClass('TR-2')).toBe('trailer')
  })
  it('buckets blanks and unparseable positions as "other" (honest)', () => {
    expect(normalizePositionClass(null)).toBe('other')
    expect(normalizePositionClass('')).toBe('other')
    expect(normalizePositionClass('spare')).toBe('other')
    expect(normalizePositionClass('99XZ')).toBe('other')
  })
})

describe('resolveCombinationMembers', () => {
  const vehicles = [
    { asset_no: 'PM-1', vehicle_type: 'Prime Mover', make: 'Volvo', model: 'FH', status: 'active', is_active: true },
    { asset_no: 'TR-1', vehicle_type: 'Trailer', make: 'Schmitz', model: 'SCB', status: 'active', is_active: true },
  ]
  it('resolves prime mover + trailers case-insensitively and flags unresolved', () => {
    const combo = { prime_mover_no: 'pm-1', trailer_nos: 'TR-1, TR-9' }
    const r = resolveCombinationMembers(combo, vehicles)
    expect(r.members).toHaveLength(3)
    expect(r.members[0]).toMatchObject({ asset_no: 'pm-1', role: 'prime_mover', resolved: true, make: 'Volvo' })
    expect(r.members[1]).toMatchObject({ asset_no: 'TR-1', role: 'trailer', resolved: true })
    expect(r.members[2]).toMatchObject({ asset_no: 'TR-9', role: 'trailer', resolved: false, make: null })
    expect(r.resolvedCount).toBe(2)
    expect(r.unresolvedCount).toBe(1)
    expect(r.unresolved).toEqual(['TR-9'])
    expect(r.assetNos).toEqual(['pm-1', 'TR-1', 'TR-9'])
  })
  it('skips a blank prime mover and handles no fleet data', () => {
    const r = resolveCombinationMembers({ prime_mover_no: '  ', trailer_nos: 'TR-1' }, [])
    expect(r.members).toHaveLength(1)
    expect(r.members[0].role).toBe('trailer')
    expect(r.members[0].resolved).toBe(false)
  })
})

describe('memberTyres', () => {
  it('filters tyre rows to member assets, case-insensitively', () => {
    const tyres = [
      { asset_no: 'PM-1' }, { asset_no: 'tr-1' }, { asset_no: 'OTHER' },
    ]
    expect(memberTyres(['pm-1', 'TR-1'], tyres)).toHaveLength(2)
    expect(memberTyres([], tyres)).toEqual([])
  })
})

describe('computeCombinationRollup', () => {
  const vehicles = [
    { asset_no: 'PM-1', vehicle_type: 'Prime Mover', make: 'Volvo', model: 'FH' },
    { asset_no: 'TR-1', vehicle_type: 'Trailer', make: 'Schmitz', model: 'SCB' },
  ]
  const combo = { prime_mover_no: 'PM-1', trailer_nos: 'TR-1' }

  it('rolls spend, fitted/scrap counts, km and blended CPK across members', () => {
    const tyres = [
      // PM-1 steer: 2 tyres @ 1000 each, 40000 km stint, fitted
      { asset_no: 'PM-1', position: 'Steer', status: 'fitted', cost_per_tyre: 1000, qty: 2, km_at_fitment: 10000, km_at_removal: 50000 },
      // PM-1 drive: 1 tyre @ 1500, total_km 30000, scrapped
      { asset_no: 'PM-1', position: 'Drive', status: 'scrap', cost_per_tyre: 1500, qty: 1, total_km: 30000 },
      // TR-1 trailer: 1 tyre @ 800, 20000 km, fitted
      { asset_no: 'TR-1', position: 'Trailer', status: 'active', cost_per_tyre: 800, qty: 1, km_at_fitment: 0, km_at_removal: 20000 },
      // non-member, ignored
      { asset_no: 'ZZZ', position: 'Drive', status: 'fitted', cost_per_tyre: 999, qty: 1, total_km: 1000 },
    ]
    const r = computeCombinationRollup(combo, tyres, vehicles)
    // spend = 1000*2 + 1500*1 + 800*1 = 4300
    expect(r.totalSpend).toBe(4300)
    // fitted (qty-aware) = 2 (steer) + 1 (trailer) = 3 ; scrap = 1
    expect(r.fittedTyres).toBe(3)
    expect(r.scrapTyres).toBe(1)
    expect(r.tyreCount).toBe(3) // member records only
    // km = 40000 + 30000 + 20000 = 90000 ; cost 4300 → cpk 4300/90000 = 0.0478
    expect(r.totalKm).toBe(90000)
    expect(r.blendedCpk).toBeCloseTo(0.048, 3)
    // canonical CPK is the shared engine's object (per-record mean over valid rows)
    expect(r.canonicalCpk).toHaveProperty('fleetAvgCpk')
  })

  it('guards CPK when there is no usable distance (returns null, not Infinity)', () => {
    const tyres = [
      { asset_no: 'PM-1', position: 'Steer', status: 'fitted', cost_per_tyre: 500, qty: 1 }, // no km
    ]
    const r = computeCombinationRollup(combo, tyres, vehicles)
    expect(r.totalKm).toBe(0)
    expect(r.blendedCpk).toBeNull()
    expect(r.avgTyreLifeKm).toBeNull()
    expect(r.totalSpend).toBe(500)
  })

  it('groups the position breakdown by class with per-class spend + CPK', () => {
    const tyres = [
      { asset_no: 'PM-1', position: 'Steer', status: 'fitted', cost_per_tyre: 1000, qty: 2, km_at_fitment: 0, km_at_removal: 40000 },
      { asset_no: 'PM-1', position: 'weird-code', status: 'fitted', cost_per_tyre: 300, qty: 1, total_km: 5000 },
    ]
    const r = computeCombinationRollup(combo, tyres, vehicles)
    const byClass = Object.fromEntries(r.positionBreakdown.map((p) => [p.positionClass, p]))
    expect(byClass.steer.count).toBe(2)
    expect(byClass.steer.spend).toBe(2000)
    expect(byClass.steer.cpk).toBeCloseTo(0.05, 3) // 2000 / 40000
    expect(byClass.other.count).toBe(1)
    expect(byClass.other.spend).toBe(300)
    // classes are emitted in canonical order
    expect(r.positionBreakdown.map((p) => p.positionClass))
      .toEqual(POSITION_CLASSES.filter((c) => byClass[c]))
  })

  it('produces empty breakdown and zeros when no member tyres exist', () => {
    const r = computeCombinationRollup(combo, [], vehicles)
    expect(r.positionBreakdown).toEqual([])
    expect(r.tyreCount).toBe(0)
    expect(r.totalSpend).toBe(0)
    expect(r.members).toHaveLength(2)
  })
})

describe('detectDuplicateTrailers', () => {
  it('flags a trailer claimed by more than one active combination (case-insensitive)', () => {
    const combos = [
      { id: 1, name: 'A', status: 'active', trailer_nos: 'TR-1, TR-2' },
      { id: 2, name: 'B', status: 'active', trailer_nos: 'tr-1' }, // dup of TR-1
      { id: 3, name: 'C', status: 'inactive', trailer_nos: 'TR-2' }, // inactive → ignored
    ]
    const dups = detectDuplicateTrailers(combos)
    expect(dups).toHaveLength(1)
    expect(dups[0].trailer).toBe('TR-1')
    expect(dups[0].combinations.map((c) => c.id)).toEqual([1, 2])
  })
  it('returns [] when no active trailer is shared', () => {
    expect(detectDuplicateTrailers([
      { id: 1, status: 'active', trailer_nos: 'TR-1' },
      { id: 2, status: 'active', trailer_nos: 'TR-2' },
    ])).toEqual([])
    expect(detectDuplicateTrailers([])).toEqual([])
  })
})
