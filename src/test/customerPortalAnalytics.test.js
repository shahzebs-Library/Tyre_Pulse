import { describe, it, expect } from 'vitest'
import {
  filterAccounts, accountKpis, tierBreakdown, attentionList, attentionReasons,
  accountExport, countryOptions,
} from '../lib/customerPortalAnalytics'

const rows = [
  { id: 1, company_name: 'Zeta', status: 'active', tier: 'enterprise', portal_enabled: true, open_requests: 7, assets_linked: 10, sla_hours: 24, email: 'a@b.co', country: 'KSA' },
  { id: 2, company_name: 'Alpha', status: 'onboarding', tier: '', portal_enabled: false, email: 'broken', country: 'UAE' },
  { id: 3, company_name: 'Mid', status: 'suspended', tier: 'standard', portal_enabled: 'true', open_requests: 1, sla_hours: 12 },
]

describe('customerPortalAnalytics', () => {
  it('filters and sorts by company', () => {
    expect(filterAccounts(rows).map((r) => r.id)).toEqual([2, 3, 1])
    expect(filterAccounts(rows, { portal: 'on' }).map((r) => r.id)).toEqual([3, 1])
    expect(filterAccounts(rows, { portal: 'off' }).map((r) => r.id)).toEqual([2])
    expect(filterAccounts(rows, { tier: 'unspecified' }).map((r) => r.id)).toEqual([2])
    expect(filterAccounts(rows, { status: 'active', search: 'zet' }).map((r) => r.id)).toEqual([1])
    expect(countryOptions(rows)).toEqual(['KSA', 'UAE'])
  })

  it('computes honest KPIs', () => {
    const k = accountKpis(rows)
    expect(k).toMatchObject({ total: 3, active: 1, onboarding: 1, suspended: 1, portalEnabled: 2, adoptionPct: 67, openRequests: 8, linkedAssets: 10, avgSlaHours: 18, slaCoverage: 2, backlogged: 1, invalidEmail: 1, noContact: 1, attention: 3 })
    const e = accountKpis([])
    expect(e.adoptionPct).toBeNull()
    expect(e.avgSlaHours).toBeNull()
  })

  it('explains attention and tiers', () => {
    expect(attentionReasons(rows[0])).toEqual(['7 open requests'])
    expect(attentionReasons(rows[1])).toEqual(['Still onboarding', 'Email looks invalid'])
    expect(attentionList(rows)[0]._reasons.length).toBeGreaterThan(0)
    const t = tierBreakdown(rows)
    expect(t.every((x) => x.pct === 100)).toBe(true)
  })

  it('exports N/A for unrecorded numbers', () => {
    const x = accountExport(rows)
    expect(x.rows[1].open_requests).toBe('N/A')
    expect(x.rows[1].tier).toBe('Unspecified')
    expect(x.rows[2].portal_enabled).toBe('Enabled')
  })
})
