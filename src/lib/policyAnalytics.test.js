import { describe, it, expect } from 'vitest'
import {
  toDate, daysUntil, parseAmount, policyPremium, policyInsurer,
  policyExpiry, expiryBands, statusDistribution, renewalPipeline,
  groupBy, byCoverageType, byOwner, byInsurer, premiumSummary,
  sortByExpiry, filterPolicies, summarizePolicyPortfolio,
  POLICY_STATUSES, DEFAULT_WARN_DAYS,
} from './policyAnalytics'

const NOW = new Date('2026-07-18T00:00:00Z').getTime()
const day = (offset) => new Date(NOW + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const rows = [
  { id: '1', title: 'Third Party Liability', category: 'Liability', owner: 'Fleet Ops', status: 'active', review_date: day(5), premium: 12000, insurer: 'GCC Insure' },
  { id: '2', title: 'Comprehensive Motor', category: 'Motor', owner: 'Fleet Ops', status: 'active', review_date: day(90), premium: '8,500', insurer: 'Najm' },
  { id: '3', title: 'Cargo Cover', category: 'Cargo', owner: 'Logistics', status: 'active', review_date: day(-3), premium: null, insurer: 'GCC Insure' },
  { id: '4', title: 'Old Fire Policy', category: 'Property', owner: 'Logistics', status: 'archived', review_date: day(-40) },
  { id: '5', title: 'Draft Health', category: 'Health', owner: '', status: 'draft', review_date: null },
  { id: '6', title: 'Under Review GL', category: 'Liability', owner: 'Fleet Ops', status: 'under_review', review_date: day(20), premium: 4000 },
]

describe('primitives', () => {
  it('toDate parses and rejects', () => {
    expect(toDate('2026-01-01')).toBeInstanceOf(Date)
    expect(toDate('nope')).toBeNull()
    expect(toDate(null)).toBeNull()
  })
  it('daysUntil future is positive, past negative', () => {
    expect(daysUntil(day(10), NOW)).toBe(10)
    expect(daysUntil(day(-4), NOW)).toBe(-4)
    expect(daysUntil(null, NOW)).toBeNull()
  })
  it('parseAmount strips symbols and rejects junk', () => {
    expect(parseAmount('8,500')).toBe(8500)
    expect(parseAmount(1200)).toBe(1200)
    expect(parseAmount('SAR 3,000.50')).toBe(3000.5)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })
})

describe('policyPremium / policyInsurer', () => {
  it('reads premium where present, null otherwise', () => {
    expect(policyPremium(rows[0])).toBe(12000)
    expect(policyPremium(rows[1])).toBe(8500)
    expect(policyPremium(rows[2])).toBeNull()
    expect(policyPremium(rows[4])).toBeNull()
  })
  it('reads insurer where present, null otherwise', () => {
    expect(policyInsurer(rows[0])).toBe('GCC Insure')
    expect(policyInsurer(rows[5])).toBeNull()
  })
  it('supports alternate field names', () => {
    expect(policyPremium({ annual_premium: 500 })).toBe(500)
    expect(policyInsurer({ provider: 'Tawuniya' })).toBe('Tawuniya')
  })
})

describe('policyExpiry', () => {
  it('classifies bands off review_date', () => {
    expect(policyExpiry(rows[0], NOW).band).toBe('expiring') // +5d
    expect(policyExpiry(rows[1], NOW).band).toBe('valid')    // +90d
    expect(policyExpiry(rows[2], NOW).band).toBe('expired')  // -3d
    expect(policyExpiry(rows[4], NOW).band).toBe('none')     // no date
  })
  it('archived is never actionable', () => {
    const e = policyExpiry(rows[3], NOW)
    expect(e.band).toBe('expired')
    expect(e.expired).toBe(false)
    expect(e.actionable).toBe(false)
  })
  it('warnDays is tunable', () => {
    expect(policyExpiry(rows[6 - 1], NOW, { warnDays: 10 }).band).toBe('valid') // +20d, warn 10
    expect(policyExpiry(rows[5], NOW, { warnDays: 30 }).band).toBe('expiring')  // +20d, warn 30
  })
})

describe('expiryBands', () => {
  it('counts governed bands and excludes archived from bands', () => {
    const b = expiryBands(rows, NOW)
    expect(b.total).toBe(6)
    expect(b.archived).toBe(1)
    expect(b.governed).toBe(5)
    expect(b.expiring).toBe(2) // rows 1 (+5) and 6 (+20)
    expect(b.expired).toBe(1)  // row 3 (-3), archived row4 excluded
    expect(b.valid).toBe(1)    // row 2 (+90)
    expect(b.none).toBe(1)     // row 5
  })
})

describe('statusDistribution', () => {
  it('counts per known vocab', () => {
    const s = statusDistribution(rows)
    expect(s.total).toBe(6)
    expect(s.byStatus.active).toBe(3)
    expect(s.byStatus.archived).toBe(1)
    expect(s.byStatus.draft).toBe(1)
    expect(s.byStatus.under_review).toBe(1)
  })
  it('folds unknown status', () => {
    const s = statusDistribution([{ status: 'weird' }])
    expect(s.byStatus.unknown).toBe(1)
    expect(s.list.some((x) => x.status === 'unknown')).toBe(true)
  })
  it('POLICY_STATUSES vocab intact', () => {
    expect(POLICY_STATUSES).toEqual(['draft', 'active', 'under_review', 'archived'])
  })
})

describe('renewalPipeline', () => {
  it('buckets upcoming reviews by month and counts overdue', () => {
    const p = renewalPipeline(rows, NOW, { months: 6 })
    expect(p.buckets.length).toBe(6)
    // total upcoming (non-archived, dated, not past) = rows 1(+5),2(+90),6(+20) = 3
    const upcoming = p.buckets.reduce((a, b) => a + b.count, 0)
    expect(upcoming).toBe(3)
    expect(p.overdue).toBe(1) // row 3 (-3), archived excluded
  })
  it('sums premium only where present', () => {
    const p = renewalPipeline(rows, NOW, { months: 2 })
    const jul = p.buckets[0]
    expect(jul.premiumPresent).toBe(true)
    expect(jul.premium).toBe(12000) // row 1 (+5d) lands in July; row 6 (+20d) is August
    const aug = p.buckets[1]
    expect(aug.premium).toBe(4000) // row 6 (4000)
  })
})

describe('groupBy / breakdowns', () => {
  it('byCoverageType groups by category with premium where present', () => {
    const g = byCoverageType(rows)
    const liability = g.find((x) => x.key === 'Liability')
    expect(liability.count).toBe(2) // rows 1 and 6
    expect(liability.premium).toBe(16000)
    const cargo = g.find((x) => x.key === 'Cargo')
    expect(cargo.premium).toBeNull() // no premium on cargo row
  })
  it('byOwner folds blank owner to Unspecified', () => {
    const g = byOwner(rows)
    expect(g.find((x) => x.key === 'Unspecified').count).toBe(1)
    expect(g.find((x) => x.key === 'Fleet Ops').count).toBe(3)
  })
  it('byInsurer only counts rows with an insurer', () => {
    const g = byInsurer(rows)
    const gcc = g.find((x) => x.key === 'GCC Insure')
    expect(gcc.count).toBe(2)
    // rows without insurer land in Unspecified
    expect(g.find((x) => x.key === 'Unspecified').count).toBe(3)
  })
  it('groupBy sorts by count desc', () => {
    const g = groupBy(rows, (r) => r.owner)
    expect(g[0].count).toBeGreaterThanOrEqual(g[g.length - 1].count)
  })
})

describe('premiumSummary', () => {
  it('sums present premiums and reports missing', () => {
    const p = premiumSummary(rows)
    expect(p.hasAny).toBe(true)
    expect(p.total).toBe(24500) // 12000 + 8500 + 4000
    expect(p.present).toBe(3)
    expect(p.missing).toBe(3)
    expect(p.average).toBeCloseTo(24500 / 3)
  })
  it('null total when no premium anywhere (never faked 0)', () => {
    const p = premiumSummary([{ title: 'x' }, { title: 'y' }])
    expect(p.hasAny).toBe(false)
    expect(p.total).toBeNull()
    expect(p.average).toBeNull()
  })
})

describe('sortByExpiry', () => {
  it('sorts soonest first, nulls last, non-mutating', () => {
    const sorted = sortByExpiry(rows)
    expect(sorted[0].id).toBe('4') // -40 archived earliest date
    expect(sorted[sorted.length - 1].review_date).toBeNull()
    expect(rows[0].id).toBe('1') // original untouched
  })
  it('desc reverses dated order', () => {
    const sorted = sortByExpiry(rows, 'desc')
    expect(sorted[0].id).toBe('2') // +90 latest
  })
})

describe('filterPolicies', () => {
  it('filters by status', () => {
    expect(filterPolicies(rows, { status: 'active' }, NOW).length).toBe(3)
    expect(filterPolicies(rows, { status: 'all' }, NOW).length).toBe(6)
  })
  it('filters by band', () => {
    expect(filterPolicies(rows, { band: 'expiring' }, NOW).length).toBe(2)
    expect(filterPolicies(rows, { band: 'expired' }, NOW).length).toBe(1) // archived excluded from band
  })
  it('filters by category, owner, insurer', () => {
    expect(filterPolicies(rows, { category: 'Liability' }, NOW).length).toBe(2)
    expect(filterPolicies(rows, { owner: 'Logistics' }, NOW).length).toBe(2)
    expect(filterPolicies(rows, { insurer: 'Najm' }, NOW).length).toBe(1)
  })
  it('search matches title/category/owner/insurer', () => {
    expect(filterPolicies(rows, { search: 'cargo' }, NOW).length).toBe(1)
    expect(filterPolicies(rows, { search: 'najm' }, NOW).length).toBe(1)
  })
  it('date range bounds review_date and drops undated', () => {
    const res = filterPolicies(rows, { from: day(0), to: day(30) }, NOW)
    expect(res.map((r) => r.id).sort()).toEqual(['1', '6'])
  })
})

describe('summarizePolicyPortfolio', () => {
  it('composes KPIs and breakdowns', () => {
    const s = summarizePolicyPortfolio(rows, NOW)
    expect(s.total).toBe(6)
    expect(s.kpis.active).toBe(3)
    expect(s.kpis.expiringSoon).toBe(2)
    expect(s.kpis.expired).toBe(1)
    expect(s.kpis.noRenewalDate).toBe(1)
    expect(s.kpis.premiumTotal).toBe(24500)
    expect(s.hasInsurer).toBe(true)
    expect(s.warnDays).toBe(DEFAULT_WARN_DAYS)
    expect(s.coverage.length).toBeGreaterThan(0)
  })
  it('premiumTotal is null when no premiums (honest N/A)', () => {
    const s = summarizePolicyPortfolio([{ status: 'active', review_date: day(5) }], NOW)
    expect(s.kpis.premiumTotal).toBeNull()
    expect(s.hasInsurer).toBe(false)
  })
  it('handles empty input', () => {
    const s = summarizePolicyPortfolio([], NOW)
    expect(s.total).toBe(0)
    expect(s.kpis.active).toBe(0)
    expect(s.bands.governed).toBe(0)
  })
})
