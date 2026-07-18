import { describe, it, expect } from 'vitest'
import {
  parseDate,
  daysBetween,
  nextDueDate,
  daysToNextDue,
  verificationBand,
  isCompliant,
  nonComplianceReason,
  summarizeSpeedLimiters,
  setSpeedDistribution,
  bySiteCoverage,
  nonCompliantList,
  sortByExpiry,
  filterSpeedLimiters,
  toNumber,
  DEFAULT_REVERIFY_DAYS,
  DEFAULT_EXPIRING_SOON_DAYS,
  VERIFICATION_BANDS,
} from './speedLimiterAnalytics'

// Fixed reference so every band computation is deterministic.
const ASOF = new Date('2026-07-18T00:00:00Z')
const opts = { asOf: ASOF }

// helper: an ISO date N days before ASOF
function daysAgo(n) {
  return new Date(ASOF.getTime() - n * 86400000).toISOString().slice(0, 10)
}

describe('toNumber / parseDate / daysBetween', () => {
  it('coerces numbers and rejects junk', () => {
    expect(toNumber('80')).toBe(80)
    expect(toNumber(80)).toBe(80)
    expect(toNumber('')).toBeNull()
    expect(toNumber(null)).toBeNull()
    expect(toNumber('abc')).toBeNull()
  })
  it('parses date-only and full timestamps, rejects invalid', () => {
    expect(parseDate('2026-01-01')?.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(parseDate(new Date('2026-01-01'))).toBeInstanceOf(Date)
    expect(parseDate('')).toBeNull()
    expect(parseDate('not-a-date')).toBeNull()
    expect(parseDate(null)).toBeNull()
  })
  it('computes whole-day difference', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30)
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30)
    expect(daysBetween('bad', '2026-01-01')).toBeNull()
  })
})

describe('nextDueDate / daysToNextDue', () => {
  it('derives next-due = last_verified_at + interval', () => {
    const due = nextDueDate({ last_verified_at: '2026-01-01' }, 365)
    expect(due?.toISOString().slice(0, 10)).toBe('2027-01-01')
  })
  it('returns null when never verified', () => {
    expect(nextDueDate({ last_verified_at: null })).toBeNull()
    expect(daysToNextDue({ last_verified_at: '' }, opts)).toBeNull()
  })
  it('is negative when overdue', () => {
    // verified 400 days ago, 365-day interval => 35 days overdue
    const d = daysToNextDue({ last_verified_at: daysAgo(400) }, opts)
    expect(d).toBe(-35)
  })
  it('honours a custom re-verify interval', () => {
    const d = daysToNextDue({ last_verified_at: daysAgo(100) }, { asOf: ASOF, reverifyDays: 180 })
    expect(d).toBe(80)
  })
})

describe('verificationBand', () => {
  it('unverified when no date', () => {
    expect(verificationBand({ last_verified_at: null }, opts)).toBe('unverified')
  })
  it('valid when recently verified', () => {
    expect(verificationBand({ last_verified_at: daysAgo(10) }, opts)).toBe('valid')
  })
  it('expiring within the soon window', () => {
    // verified 350 days ago => 15 days to due (<=30)
    expect(verificationBand({ last_verified_at: daysAgo(350) }, opts)).toBe('expiring')
  })
  it('expired when past due', () => {
    expect(verificationBand({ last_verified_at: daysAgo(400) }, opts)).toBe('expired')
  })
  it('respects a tunable expiringSoonDays', () => {
    // 15 days to due but soon window is 7 => still valid
    expect(
      verificationBand({ last_verified_at: daysAgo(350) }, { asOf: ASOF, expiringSoonDays: 7 }),
    ).toBe('valid')
  })
  it('exposes the canonical band list', () => {
    expect(VERIFICATION_BANDS).toEqual(['valid', 'expiring', 'expired', 'unverified'])
  })
})

describe('isCompliant / nonComplianceReason', () => {
  it('active + valid verification is compliant', () => {
    expect(isCompliant({ status: 'active', last_verified_at: daysAgo(10) }, opts)).toBe(true)
  })
  it('active + expiring is still compliant', () => {
    expect(isCompliant({ status: 'active', last_verified_at: daysAgo(350) }, opts)).toBe(true)
  })
  it('fault is never compliant', () => {
    expect(isCompliant({ status: 'fault', last_verified_at: daysAgo(1) }, opts)).toBe(false)
    expect(nonComplianceReason({ status: 'fault', last_verified_at: daysAgo(1) }, opts)).toBe('Limiter in fault')
  })
  it('disabled is non-compliant', () => {
    expect(nonComplianceReason({ status: 'disabled', last_verified_at: daysAgo(1) }, opts)).toBe('Limiter disabled')
  })
  it('active but overdue verification is non-compliant', () => {
    expect(isCompliant({ status: 'active', last_verified_at: daysAgo(400) }, opts)).toBe(false)
    expect(nonComplianceReason({ status: 'active', last_verified_at: daysAgo(400) }, opts)).toBe('Verification overdue')
  })
  it('active but never verified is non-compliant', () => {
    expect(nonComplianceReason({ status: 'active', last_verified_at: null }, opts)).toBe('Never verified')
  })
  it('compliant record has no reason', () => {
    expect(nonComplianceReason({ status: 'active', last_verified_at: daysAgo(5) }, opts)).toBeNull()
  })
})

describe('summarizeSpeedLimiters', () => {
  const rows = [
    { status: 'active', limit_kph: 80, last_verified_at: daysAgo(10), site: 'A', device_id: 'D1' },
    { status: 'active', limit_kph: 90, last_verified_at: daysAgo(350), site: 'A', device_id: 'D2' }, // expiring
    { status: 'active', limit_kph: 100, last_verified_at: daysAgo(400), site: 'B', device_id: 'D3' }, // expired
    { status: 'fault', limit_kph: 80, last_verified_at: daysAgo(5), site: 'B', device_id: 'D4' },
    { status: 'disabled', limit_kph: null, last_verified_at: null, site: 'A', device_id: null },
  ]
  const s = summarizeSpeedLimiters(rows, opts)

  it('counts totals and statuses', () => {
    expect(s.total).toBe(5)
    expect(s.byStatus).toEqual({ active: 3, disabled: 1, fault: 1 })
    expect(s.faults).toBe(1)
    expect(s.disabled).toBe(1)
  })
  it('averages present limits only', () => {
    // (80+90+100+80)/4 = 87.5
    expect(s.avgLimit).toBe(87.5)
  })
  it('buckets verification bands', () => {
    expect(s.byBand.valid).toBe(2) // active/10d + fault/5d
    expect(s.byBand.expiring).toBe(1)
    expect(s.byBand.expired).toBe(1)
    expect(s.byBand.unverified).toBe(1)
  })
  it('computes compliance rate honestly', () => {
    // compliant = active+valid or active+expiring = rows 0 and 1 => 2/5 = 40%
    expect(s.compliant).toBe(2)
    expect(s.nonCompliant).toBe(3)
    expect(s.complianceRate).toBe(40)
  })
  it('counts distinct sites and devices', () => {
    expect(s.sites).toBe(2)
    expect(s.devices).toBe(4)
  })
  it('degrades to zeros / null on empty', () => {
    const e = summarizeSpeedLimiters([], opts)
    expect(e.total).toBe(0)
    expect(e.avgLimit).toBeNull()
    expect(e.complianceRate).toBeNull()
  })
})

describe('setSpeedDistribution', () => {
  it('groups and sorts by limit, nulls last', () => {
    const d = setSpeedDistribution([
      { limit_kph: 80 }, { limit_kph: 80 }, { limit_kph: 60 }, { limit_kph: null }, { limit_kph: '' },
    ])
    expect(d).toEqual([
      { limit: 60, count: 1 },
      { limit: 80, count: 2 },
      { limit: null, count: 2 },
    ])
  })
})

describe('bySiteCoverage', () => {
  const limiters = [
    { asset_no: 'A1', status: 'active', site: 'North' },
    { asset_no: 'A2', status: 'fault', site: 'North' },
    { asset_no: 'A3', status: 'active', site: 'South' },
  ]
  const fleet = [
    { asset_no: 'A1', site: 'North' },
    { asset_no: 'A2', site: 'North' },
    { asset_no: 'A4', site: 'North' }, // no limiter at all
    { asset_no: 'A3', site: 'South' },
  ]

  it('computes per-site active coverage vs fleet', () => {
    const c = bySiteCoverage(limiters, fleet)
    expect(c.hasFleet).toBe(true)
    const north = c.bySite.find((b) => b.site === 'North')
    expect(north.fleet).toBe(3)
    expect(north.registered).toBe(2) // A1, A2
    expect(north.active).toBe(1)     // only A1 active
    expect(north.uncovered).toBe(2)
    expect(north.coverage).toBe(33.3)
    const south = c.bySite.find((b) => b.site === 'South')
    expect(south.coverage).toBe(100)
  })
  it('overall coverage and missing-limiter list', () => {
    const c = bySiteCoverage(limiters, fleet)
    expect(c.overall.fleet).toBe(4)
    expect(c.overall.active).toBe(2) // A1, A3
    expect(c.overall.coverage).toBe(50)
    expect(c.missingLimiter).toEqual(['A4'])
  })
  it('sorts worst coverage first', () => {
    const c = bySiteCoverage(limiters, fleet)
    expect(c.bySite[0].site).toBe('North') // 33.3 < 100
  })
  it('honest null coverage when no fleet supplied', () => {
    const c = bySiteCoverage(limiters, [])
    expect(c.hasFleet).toBe(false)
    expect(c.overall.coverage).toBeNull()
    expect(c.bySite.every((b) => b.coverage === null)).toBe(true)
    // still groups registered limiters by their own site
    expect(c.bySite.find((b) => b.site === 'North').registered).toBe(2)
  })
})

describe('nonCompliantList', () => {
  const rows = [
    { asset_no: 'OK', status: 'active', last_verified_at: daysAgo(5) },
    { asset_no: 'OVERDUE', status: 'active', last_verified_at: daysAgo(400) },
    { asset_no: 'FAULT', status: 'fault', last_verified_at: daysAgo(1) },
    { asset_no: 'NEVER', status: 'active', last_verified_at: null },
  ]
  it('excludes compliant, tags reasons, faults first', () => {
    const list = nonCompliantList(rows, opts)
    expect(list.map((x) => x.row.asset_no)).toEqual(['FAULT', 'OVERDUE', 'NEVER'])
    expect(list[0].reason).toBe('Limiter in fault')
    expect(list.find((x) => x.row.asset_no === 'NEVER').reason).toBe('Never verified')
  })
})

describe('sortByExpiry', () => {
  it('overdue first, never-verified last', () => {
    const rows = [
      { asset_no: 'NEVER', last_verified_at: null },
      { asset_no: 'SOON', last_verified_at: daysAgo(350) }, // +15
      { asset_no: 'OVERDUE', last_verified_at: daysAgo(400) }, // -35
      { asset_no: 'FRESH', last_verified_at: daysAgo(1) }, // +364
    ]
    const sorted = sortByExpiry(rows, opts)
    expect(sorted.map((r) => r.asset_no)).toEqual(['OVERDUE', 'SOON', 'FRESH', 'NEVER'])
  })
  it('does not mutate the input', () => {
    const rows = [{ asset_no: 'A', last_verified_at: daysAgo(1) }, { asset_no: 'B', last_verified_at: daysAgo(400) }]
    const copy = [...rows]
    sortByExpiry(rows, opts)
    expect(rows).toEqual(copy)
  })
})

describe('filterSpeedLimiters', () => {
  const rows = [
    { asset_no: 'TRK-1', status: 'active', site: 'North', device_id: 'SL-1', last_verified_at: '2025-01-10', notes: 'annual' },
    { asset_no: 'TRK-2', status: 'fault', site: 'South', device_id: 'SL-2', last_verified_at: '2026-06-20', notes: '' },
    { asset_no: 'TRK-3', status: 'disabled', site: 'North', device_id: 'SL-3', last_verified_at: null, notes: '' },
  ]
  it('filters by status', () => {
    expect(filterSpeedLimiters(rows, { status: 'fault' }).map((r) => r.asset_no)).toEqual(['TRK-2'])
  })
  it('filters by site', () => {
    expect(filterSpeedLimiters(rows, { site: 'North' }).length).toBe(2)
  })
  it('filters by verification band', () => {
    const overdue = filterSpeedLimiters(rows, { band: 'expired', asOf: ASOF })
    expect(overdue.map((r) => r.asset_no)).toEqual(['TRK-1']) // 2025-01-10 + 365 already past
    const unverified = filterSpeedLimiters(rows, { band: 'unverified', asOf: ASOF })
    expect(unverified.map((r) => r.asset_no)).toEqual(['TRK-3'])
  })
  it('searches asset, device, site and notes', () => {
    expect(filterSpeedLimiters(rows, { search: 'annual' }).map((r) => r.asset_no)).toEqual(['TRK-1'])
    expect(filterSpeedLimiters(rows, { search: 'sl-2' }).map((r) => r.asset_no)).toEqual(['TRK-2'])
  })
  it('filters by last_verified_at date range', () => {
    const r = filterSpeedLimiters(rows, { from: '2026-05-01', to: '2026-12-31' })
    expect(r.map((x) => x.asset_no)).toEqual(['TRK-2']) // TRK-3 has no date => excluded
  })
  it('returns all with default filters', () => {
    expect(filterSpeedLimiters(rows, {}).length).toBe(3)
  })
})

describe('defaults', () => {
  it('exposes tunable defaults', () => {
    expect(DEFAULT_REVERIFY_DAYS).toBe(365)
    expect(DEFAULT_EXPIRING_SOON_DAYS).toBe(30)
  })
})
