import { describe, it, expect } from 'vitest'
import {
  computeFleetAvailability, groupVehiclesBySite, computeTyreAttention,
  computeMonthlyTyreCost, computePressureCompliancePct, countTodaysInspections,
  summariseAlerts, nextBoardIndex, formatCountdown, formatCompactMoney,
} from '../lib/displayBoard'

describe('computeFleetAvailability', () => {
  it('returns zeros for empty/undefined input', () => {
    expect(computeFleetAvailability()).toEqual({ total: 0, available: 0, pct: 0 })
    expect(computeFleetAvailability([])).toEqual({ total: 0, available: 0, pct: 0 })
  })

  it('counts Active and missing-status vehicles as available', () => {
    const r = computeFleetAvailability([
      { status: 'Active' },
      { status: 'Inactive' },
      { status: null },
      {},
    ])
    expect(r).toEqual({ total: 4, available: 3, pct: 75 })
  })
})

describe('groupVehiclesBySite', () => {
  it('groups, sorts descending, and buckets empty sites as Unassigned', () => {
    const r = groupVehiclesBySite([
      { site: 'Jeddah' }, { site: 'Jeddah' }, { site: 'Riyadh' },
      { site: '' }, { site: null },
    ])
    expect(r).toEqual([
      { site: 'Jeddah', count: 2 },
      { site: 'Unassigned', count: 2 },
      { site: 'Riyadh', count: 1 },
    ])
  })

  it('caps at the limit', () => {
    const rows = ['A', 'B', 'C', 'D'].map(site => ({ site }))
    expect(groupVehiclesBySite(rows, 2)).toHaveLength(2)
  })
})

describe('computeTyreAttention', () => {
  it('counts critical + high as attention', () => {
    const r = computeTyreAttention([
      { risk_level: 'Critical' }, { risk_level: 'High' },
      { risk_level: 'Medium' }, { risk_level: 'Low' }, {},
    ])
    expect(r).toEqual({ total: 5, critical: 1, high: 1, attention: 2 })
  })

  it('handles empty input', () => {
    expect(computeTyreAttention()).toEqual({ total: 0, critical: 0, high: 0, attention: 0 })
  })
})

describe('computeMonthlyTyreCost', () => {
  const now = new Date('2026-07-15T12:00:00')

  it('sums cost_per_tyre × qty only for the current calendar month', () => {
    const r = computeMonthlyTyreCost([
      { issue_date: '2026-07-01', cost_per_tyre: 100, qty: 2 },  // 200
      { issue_date: '2026-07-30', cost_per_tyre: 50 },           // qty defaults to 1 → 50
      { issue_date: '2026-06-30', cost_per_tyre: 999, qty: 5 },  // previous month — excluded
      { issue_date: null, cost_per_tyre: 999 },                  // no date — excluded
      { issue_date: '2026-07-10' },                              // no cost → 0, qty 1
    ], now)
    expect(r).toEqual({ cost: 250, tyreCount: 4 })
  })

  it('ignores invalid dates and non-numeric costs', () => {
    const r = computeMonthlyTyreCost([
      { issue_date: 'not-a-date', cost_per_tyre: 100 },
      { issue_date: '2026-07-05', cost_per_tyre: 'abc', qty: 3 },
    ], now)
    expect(r).toEqual({ cost: 0, tyreCount: 3 })
  })
})

describe('computePressureCompliancePct', () => {
  it('matches the kpiEngine proxy: Done with findings, excluding Cancelled', () => {
    const r = computePressureCompliancePct([
      { status: 'Done', findings: 'PSI ok' },
      { status: 'Done', findings: '  ' },        // blank findings — not compliant
      { status: 'Scheduled' },
      { status: 'Cancelled', findings: 'x' },    // excluded entirely
    ])
    expect(r).toEqual({ pct: 33, compliant: 1, total: 3 })
  })

  it('returns zeros for empty input', () => {
    expect(computePressureCompliancePct([])).toEqual({ pct: 0, compliant: 0, total: 0 })
  })
})

describe('countTodaysInspections', () => {
  it('splits today rows into done/pending/overdue', () => {
    const r = countTodaysInspections([
      { scheduled_date: '2026-07-07', status: 'Done' },
      { scheduled_date: '2026-07-07', status: 'Scheduled' },
      { scheduled_date: '2026-07-07', status: 'Overdue' },
      { scheduled_date: '2026-07-06', status: 'Done' },      // not today
      { scheduled_date: '2026-07-07T08:00:00', status: 'Done' }, // timestamp form
    ], '2026-07-07')
    expect(r).toEqual({ total: 4, done: 2, pending: 1, overdue: 1 })
  })
})

describe('summariseAlerts', () => {
  it('buckets known severities and defaults unknown/null to Info', () => {
    const r = summariseAlerts([
      { severity: 'Critical' }, { severity: 'High' }, { severity: 'High' },
      { severity: 'weird' }, {},
    ])
    expect(r.total).toBe(5)
    expect(r.bySeverity).toEqual({ Critical: 1, High: 2, Medium: 0, Low: 0, Info: 2 })
  })
})

describe('nextBoardIndex', () => {
  it('cycles and wraps', () => {
    expect(nextBoardIndex(0, 3)).toBe(1)
    expect(nextBoardIndex(2, 3)).toBe(0)
  })

  it('is safe for zero/invalid length', () => {
    expect(nextBoardIndex(1, 0)).toBe(0)
    expect(nextBoardIndex(1, NaN)).toBe(0)
  })
})

describe('formatCountdown', () => {
  it('formats mm:ss and clamps negatives', () => {
    expect(formatCountdown(60)).toBe('01:00')
    expect(formatCountdown(9)).toBe('00:09')
    expect(formatCountdown(-5)).toBe('00:00')
  })
})

describe('formatCompactMoney', () => {
  it('scales into K/M and rounds small values', () => {
    expect(formatCompactMoney(940)).toBe('940')
    expect(formatCompactMoney(12400)).toBe('12.4K')
    expect(formatCompactMoney(1_250_000)).toBe('1.3M')
    expect(formatCompactMoney('junk')).toBe('0')
  })
})
