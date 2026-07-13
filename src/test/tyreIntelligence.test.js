// ─────────────────────────────────────────────────────────────────────────────
// tyreIntelligence.test.js - Unit tests for the tyre-engineering intelligence
// engine. Covers null/NaN guards, divide-by-zero safety, ordering guarantees and
// deterministic predictive output with an injected clock.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  lifeKm,
  cpk,
  isRemoved,
  summariseIntelligence,
  rootCauseBreakdown,
  cpkByBrand,
  cpkByVendor,
  positionIntelligence,
  predictiveRemovals,
} from '../lib/tyreIntelligence'

const NOW = Date.UTC(2026, 6, 13) // injected, deterministic

// ── toFiniteNumber ────────────────────────────────────────────────────────────

describe('toFiniteNumber', () => {
  it('returns null for null/undefined/NaN/empty', () => {
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber(NaN)).toBeNull()
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })

  it('passes finite numbers through and rejects Infinity/booleans', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber(-3.5)).toBe(-3.5)
    expect(toFiniteNumber(Infinity)).toBeNull()
    expect(toFiniteNumber(true)).toBeNull()
  })

  it('parses numeric strings with currency/thousand noise', () => {
    expect(toFiniteNumber('1,250')).toBe(1250)
    expect(toFiniteNumber('SAR 900')).toBe(900)
  })
})

// ── lifeKm ────────────────────────────────────────────────────────────────────

describe('lifeKm', () => {
  it('uses removal - fitment when both present and positive', () => {
    expect(lifeKm({ km_at_fitment: 10000, km_at_removal: 60000 })).toBe(50000)
  })

  it('falls back to total_km when delta is not positive or missing', () => {
    expect(lifeKm({ km_at_fitment: 60000, km_at_removal: 10000, total_km: 45000 })).toBe(45000)
    expect(lifeKm({ total_km: 30000 })).toBe(30000)
  })

  it('returns null when nothing usable', () => {
    expect(lifeKm({})).toBeNull()
    expect(lifeKm(null)).toBeNull()
    expect(lifeKm({ total_km: 0 })).toBeNull()
  })
})

// ── cpk ───────────────────────────────────────────────────────────────────────

describe('cpk', () => {
  it('computes cost per km', () => {
    expect(cpk({ cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 50000 })).toBeCloseTo(0.02)
  })

  it('returns null when life is unknown or zero (no divide-by-zero)', () => {
    expect(cpk({ cost_per_tyre: 1000 })).toBeNull()
    expect(cpk({ cost_per_tyre: 1000, total_km: 0 })).toBeNull()
    expect(cpk({ km_at_fitment: 0, km_at_removal: 50000 })).toBeNull() // no cost
  })
})

// ── isRemoved ─────────────────────────────────────────────────────────────────

describe('isRemoved', () => {
  it('detects removal via status', () => {
    expect(isRemoved({ status: 'Scrapped' })).toBe(true)
    expect(isRemoved({ status: 'removed' })).toBe(true)
    expect(isRemoved({ status: 'Active' })).toBe(false)
  })

  it('detects removal via removal_date or reason', () => {
    expect(isRemoved({ removal_date: '2026-01-01' })).toBe(true)
    expect(isRemoved({ reason_for_removal: 'Blowout' })).toBe(true)
    expect(isRemoved({ removal_reason: 'Wear' })).toBe(true)
  })

  it('handles blanks / null safely', () => {
    expect(isRemoved({ removal_date: '  ', reason_for_removal: '' })).toBe(false)
    expect(isRemoved(null)).toBe(false)
    expect(isRemoved({})).toBe(false)
  })
})

// ── summariseIntelligence ─────────────────────────────────────────────────────

describe('summariseIntelligence', () => {
  it('returns zeroed/null-safe shape for empty input', () => {
    const s = summariseIntelligence([])
    expect(s.totalTyres).toBe(0)
    expect(s.removalRate).toBe(0)
    expect(s.avgLifeKm).toBeNull()
    expect(s.fleetAvgCpk).toBeNull()
    expect(s.avgTreadDepth).toBeNull()
    expect(s.criticalCount).toBe(0)
  })

  it('computes removal rate, fleet CPK, avg life and critical count', () => {
    const rows = [
      { status: 'Removed', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 50000, tread_depth: 2, risk_level: 'Critical' },
      { status: 'Active', cost_per_tyre: 2000, km_at_fitment: 0, km_at_removal: 50000, tread_depth: 8, risk_level: 'Low' },
    ]
    const s = summariseIntelligence(rows)
    expect(s.totalTyres).toBe(2)
    expect(s.removedCount).toBe(1)
    expect(s.removalRate).toBe(50)
    // total cost 3000 / total known life 100000 = 0.03
    expect(s.fleetAvgCpk).toBeCloseTo(0.03)
    expect(s.avgLifeKm).toBe(50000)
    expect(s.avgTreadDepth).toBe(5)
    expect(s.criticalCount).toBe(1)
  })

  it('never divides by zero when no life data present', () => {
    const s = summariseIntelligence([{ cost_per_tyre: 1000 }])
    expect(s.fleetAvgCpk).toBeNull()
    expect(s.avgLifeKm).toBeNull()
  })
})

// ── rootCauseBreakdown ────────────────────────────────────────────────────────

describe('rootCauseBreakdown', () => {
  it('normalises blanks to Unspecified and sorts by count desc', () => {
    const rows = [
      { reason_for_removal: 'Blowout' },
      { reason_for_removal: 'Blowout' },
      { removal_reason: 'Wear' },
      { reason_for_removal: '  ' },
    ]
    const out = rootCauseBreakdown(rows)
    expect(out[0]).toMatchObject({ reason: 'Blowout', count: 2 })
    expect(out[0].pct).toBeCloseTo(50)
    expect(out.find(x => x.reason === 'Unspecified').count).toBe(1)
  })

  it('returns [] for empty input', () => {
    expect(rootCauseBreakdown([])).toEqual([])
  })
})

// ── cpkByBrand / cpkByVendor ──────────────────────────────────────────────────

describe('cpkByBrand', () => {
  it('ranks brands by avgCpk ascending (best first), blank → Unknown', () => {
    const rows = [
      { brand: 'Michelin', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 100000 }, // 0.01
      { brand: 'Cheapo', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 20000 },     // 0.05
      { brand: '', cost_per_tyre: 500, km_at_fitment: 0, km_at_removal: 50000 },            // Unknown 0.01
    ]
    const out = cpkByBrand(rows)
    expect(out[0].brand).toBe('Michelin')
    expect(out[out.length - 1].brand).toBe('Cheapo')
    expect(out.some(x => x.brand === 'Unknown')).toBe(true)
  })

  it('sinks null-CPK brands to the end', () => {
    const rows = [
      { brand: 'NoLife', cost_per_tyre: 1000 },
      { brand: 'Real', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 50000 },
    ]
    const out = cpkByBrand(rows)
    expect(out[0].brand).toBe('Real')
    expect(out[1].brand).toBe('NoLife')
    expect(out[1].avgCpk).toBeNull()
  })
})

describe('cpkByVendor', () => {
  it('groups by supplier under a supplier key', () => {
    const rows = [
      { supplier: 'VendorA', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 50000 },
      { supplier: 'VendorA', cost_per_tyre: 1000, km_at_fitment: 0, km_at_removal: 50000 },
    ]
    const out = cpkByVendor(rows)
    expect(out[0].supplier).toBe('VendorA')
    expect(out[0].tyres).toBe(2)
    expect(out[0].avgCpk).toBeCloseTo(0.02)
  })
})

// ── positionIntelligence ──────────────────────────────────────────────────────

describe('positionIntelligence', () => {
  it('computes per-position removal rate and sorts desc', () => {
    const rows = [
      { tyre_position: 'Steer', status: 'Removed' },
      { tyre_position: 'Steer', status: 'Active' },
      { position: 'Drive', status: 'Removed' },
    ]
    const out = positionIntelligence(rows)
    expect(out[0].position).toBe('Drive')
    expect(out[0].removalRate).toBe(100)
    const steer = out.find(x => x.position === 'Steer')
    expect(steer.removalRate).toBe(50)
    expect(steer.tyres).toBe(2)
  })

  it('returns [] for empty input', () => {
    expect(positionIntelligence([])).toEqual([])
  })
})

// ── predictiveRemovals ────────────────────────────────────────────────────────

describe('predictiveRemovals', () => {
  it('flags low tread on fitted tyres only', () => {
    const rows = [
      { brand: 'X', tyre_position: 'Steer', tread_depth: 2, status: 'Active' },
      { brand: 'X', tyre_position: 'Drive', tread_depth: 2, status: 'Removed' }, // excluded
      { brand: 'X', tyre_position: 'Trailer', tread_depth: 9, status: 'Active' }, // healthy
    ]
    const out = predictiveRemovals(rows, NOW)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ position: 'Steer', tread_depth: 2 })
    expect(out[0].note).toMatch(/tread/i)
  })

  it('flags tyres near their brand average life', () => {
    const rows = [
      { brand: 'Y', cost_per_tyre: 1, km_at_fitment: 0, km_at_removal: 100000, status: 'Removed' }, // sets avg 100k
      { brand: 'Y', tyre_position: 'Drive', km_at_fitment: 0, total_km: 95000, status: 'Active' },   // 95% → near EOL
    ]
    const out = predictiveRemovals(rows, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].position).toBe('Drive')
  })

  it('includes asset_no only when present and returns [] on insufficient data', () => {
    expect(predictiveRemovals([], NOW)).toEqual([])
    const out = predictiveRemovals([{ brand: 'Z', asset_no: 'A100', tread_depth: 1, status: 'Active' }], NOW)
    expect(out[0].asset_no).toBe('A100')
    // no signal at all → skipped
    expect(predictiveRemovals([{ brand: 'Z', status: 'Active' }], NOW)).toEqual([])
  })

  it('is deterministic for a fixed injected clock', () => {
    const rows = [{ brand: 'D', tyre_position: 'Steer', tread_depth: 3, status: 'Active' }]
    expect(predictiveRemovals(rows, NOW)).toEqual(predictiveRemovals(rows, NOW))
  })
})
