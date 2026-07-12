import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, hoursRemaining, elapsedHours, resolutionHours,
  breachStatus, summariseSla, byType, AT_RISK_FRACTION,
} from '../lib/slaRecords'

// Fixed clock so every time-dependent assertion is deterministic.
const NOW = Date.parse('2026-07-12T12:00:00Z')
const H = 3_600_000
const iso = (msFromNow) => new Date(NOW + msFromNow).toISOString()

describe('slaRecords — toFiniteNumber', () => {
  it('parses numbers and numeric strings, rejects junk', () => {
    expect(toFiniteNumber(24)).toBe(24)
    expect(toFiniteNumber('48')).toBe(48)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('slaRecords — hoursRemaining', () => {
  it('is positive when due in the future', () => {
    expect(hoursRemaining({ due_at: iso(5 * H) }, NOW)).toBeCloseTo(5)
  })
  it('is negative when overdue', () => {
    expect(hoursRemaining({ due_at: iso(-3 * H) }, NOW)).toBeCloseTo(-3)
  })
  it('returns null when due_at is missing or invalid', () => {
    expect(hoursRemaining({ due_at: null }, NOW)).toBeNull()
    expect(hoursRemaining({ due_at: 'nonsense' }, NOW)).toBeNull()
    expect(hoursRemaining({}, NOW)).toBeNull()
  })
})

describe('slaRecords — elapsedHours', () => {
  it('measures hours since started_at, never negative', () => {
    expect(elapsedHours({ started_at: iso(-6 * H) }, NOW)).toBeCloseTo(6)
    expect(elapsedHours({ started_at: iso(2 * H) }, NOW)).toBe(0)
  })
  it('returns null without a valid started_at', () => {
    expect(elapsedHours({}, NOW)).toBeNull()
  })
})

describe('slaRecords — resolutionHours', () => {
  it('computes resolved_at − started_at in hours', () => {
    expect(resolutionHours({ started_at: iso(-10 * H), resolved_at: iso(-4 * H) })).toBeCloseTo(6)
  })
  it('returns null when a timestamp is missing', () => {
    expect(resolutionHours({ started_at: iso(-10 * H) })).toBeNull()
    expect(resolutionHours({ resolved_at: iso(-4 * H) })).toBeNull()
  })
  it('returns null when resolution precedes the start', () => {
    expect(resolutionHours({ started_at: iso(-4 * H), resolved_at: iso(-10 * H) })).toBeNull()
  })
})

describe('slaRecords — breachStatus branches', () => {
  it("'met' when resolved on or before due", () => {
    expect(breachStatus({ due_at: iso(-2 * H), resolved_at: iso(-3 * H) }, NOW)).toBe('met')
  })
  it("'breached' when resolved after due", () => {
    expect(breachStatus({ due_at: iso(-5 * H), resolved_at: iso(-2 * H) }, NOW)).toBe('breached')
  })
  it("'breached' when still open and overdue", () => {
    expect(breachStatus({ due_at: iso(-1 * H), target_hours: 24 }, NOW)).toBe('breached')
  })
  it("'at_risk' when open with less than 20% of target remaining", () => {
    // target 10h, remaining 1h → 10% < 20%
    expect(breachStatus({ due_at: iso(1 * H), target_hours: 10 }, NOW)).toBe('at_risk')
  })
  it("'on_track' when open with comfortable time remaining", () => {
    // target 10h, remaining 8h → 80% > 20%
    expect(breachStatus({ due_at: iso(8 * H), target_hours: 10 }, NOW)).toBe('on_track')
  })
  it("'on_track' when open with time remaining but no target_hours", () => {
    expect(breachStatus({ due_at: iso(3 * H) }, NOW)).toBe('on_track')
  })
  it("'met' when status flagged met without timestamps", () => {
    expect(breachStatus({ status: 'met' }, NOW)).toBe('met')
  })
  it("'unknown' when cancelled", () => {
    expect(breachStatus({ status: 'cancelled', due_at: iso(-5 * H) }, NOW)).toBe('unknown')
  })
  it("'unknown' when open without a due time", () => {
    expect(breachStatus({ target_hours: 12 }, NOW)).toBe('unknown')
    expect(breachStatus(null, NOW)).toBe('unknown')
  })
  it('honours the 20% at-risk boundary exactly', () => {
    expect(AT_RISK_FRACTION).toBe(0.2)
    // remaining exactly 20% is NOT yet at risk (strict less-than)
    expect(breachStatus({ due_at: iso(2 * H), target_hours: 10 }, NOW)).toBe('on_track')
    // just under 20% is at risk
    expect(breachStatus({ due_at: iso(1.9 * H), target_hours: 10 }, NOW)).toBe('at_risk')
  })
})

describe('slaRecords — summariseSla', () => {
  it('returns zeroed shape for empty / non-array input', () => {
    expect(summariseSla([], NOW)).toEqual({
      totalRecords: 0, metCount: 0, breachedCount: 0, atRiskCount: 0,
      complianceRate: 0, avgResolutionHours: null,
    })
    expect(summariseSla(undefined, NOW)).toEqual({
      totalRecords: 0, metCount: 0, breachedCount: 0, atRiskCount: 0,
      complianceRate: 0, avgResolutionHours: null,
    })
  })

  it('counts statuses, compliance rate and average resolution', () => {
    const rows = [
      { due_at: iso(-2 * H), resolved_at: iso(-3 * H), started_at: iso(-9 * H) }, // met, 6h
      { due_at: iso(-2 * H), resolved_at: iso(-3 * H), started_at: iso(-5 * H) }, // met, 2h
      { due_at: iso(-5 * H), resolved_at: iso(-2 * H), started_at: iso(-10 * H) }, // breached, 8h
      { due_at: iso(1 * H), target_hours: 10 }, // at_risk
      { due_at: iso(8 * H), target_hours: 10 }, // on_track
    ]
    const s = summariseSla(rows, NOW)
    expect(s.totalRecords).toBe(5)
    expect(s.metCount).toBe(2)
    expect(s.breachedCount).toBe(1)
    expect(s.atRiskCount).toBe(1)
    // met/(met+breached) = 2/3 = 66.7
    expect(s.complianceRate).toBe(66.7)
    // avg of 6, 2, 8 = 5.3
    expect(s.avgResolutionHours).toBeCloseTo(5.3, 1)
  })

  it('compliance is 0 when nothing is decided', () => {
    const s = summariseSla([{ due_at: iso(8 * H), target_hours: 10 }], NOW)
    expect(s.complianceRate).toBe(0)
    expect(s.avgResolutionHours).toBeNull()
  })
})

describe('slaRecords — byType', () => {
  it('groups by type with per-type compliance, sorted by breached desc', () => {
    const rows = [
      { sla_type: 'breakdown', due_at: iso(-5 * H), resolved_at: iso(-1 * H) }, // breached
      { sla_type: 'breakdown', due_at: iso(-5 * H), resolved_at: iso(-1 * H) }, // breached
      { sla_type: 'breakdown', due_at: iso(-5 * H), resolved_at: iso(-6 * H) }, // met
      { sla_type: 'delivery', due_at: iso(-5 * H), resolved_at: iso(-6 * H) }, // met
      { sla_type: 'delivery', due_at: iso(-5 * H), resolved_at: iso(-1 * H) }, // breached
    ]
    const out = byType(rows, NOW)
    expect(out).toHaveLength(2)
    // breakdown has 2 breached → sorts first
    expect(out[0].sla_type).toBe('breakdown')
    expect(out[0].total).toBe(3)
    expect(out[0].breached).toBe(2)
    // breakdown compliance = 1 met / (1+2) = 33.3
    expect(out[0].complianceRate).toBe(33.3)
    expect(out[1].sla_type).toBe('delivery')
    expect(out[1].breached).toBe(1)
    expect(out[1].complianceRate).toBe(50)
  })

  it('buckets missing sla_type under "other"', () => {
    const out = byType([{ due_at: iso(-5 * H), resolved_at: iso(-6 * H) }], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].sla_type).toBe('other')
    expect(out[0].total).toBe(1)
  })

  it('returns [] for empty input', () => {
    expect(byType([], NOW)).toEqual([])
  })
})
