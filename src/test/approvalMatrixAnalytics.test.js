import { describe, it, expect } from 'vitest'
import {
  regionOf, regionOptions, siteOptions, siteRegion, filterPolicies, policyScopeLabel,
  validatePolicyDraft, policyKpis, policyRows, regionCoverageSummary,
} from '../lib/approvalMatrixAnalytics'

const NOW = Date.parse('2026-09-26T12:00:00Z')
const sites = [
  { id: 1, name: 'NHC', country: 'KSA', region: ' central ' },
  { id: 2, name: 'JED', country: 'KSA', region: 'Western' },
  { id: 3, name: 'OLD', country: 'KSA', region: 'Western', active: false },
  { id: 4, name: 'JEA', country: 'UAE', region: 'Dubai' },
  { id: 5, name: 'NOREG', country: 'KSA' },
]
const stage = (o = {}) => ({ name: 'S1', approver_role: 'Manager', approver_user_id: null, sla_hours: null, ...o })
const draft = (o = {}) => ({ name: 'Rule', change_reason: 'why', priority: 0, stages: [stage()], ...o })

describe('site register lookups', () => {
  it('normalises region and only offers active sites', () => {
    expect(regionOf(sites[0])).toBe('CENTRAL')
    expect(regionOptions(sites, 'KSA')).toEqual(['CENTRAL', 'WESTERN'])
    expect(regionOptions(sites)).toEqual(['CENTRAL', 'DUBAI', 'WESTERN'])
  })
  it('offers no sites until a country is chosen and narrows by region', () => {
    expect(siteOptions(sites, '')).toEqual([])
    expect(siteOptions(sites, 'KSA').map(s => s.name)).toEqual(['NHC', 'JED', 'NOREG'])
    expect(siteOptions(sites, 'KSA', 'WESTERN').map(s => s.name)).toEqual(['JED'])
  })
  it('reports blank region for an unplaced or unknown site', () => {
    expect(siteRegion(sites, 'KSA', 'JED')).toBe('WESTERN')
    expect(siteRegion(sites, 'KSA', 'NOREG')).toBe('')
    expect(siteRegion(sites, 'UAE', 'NHC')).toBe('')
  })
})

describe('policy register', () => {
  const policies = [
    { id: 'a', name: 'KSA inspections', entity_type: 'inspection', state: 'published', match_country: 'KSA', stages: [stage({ sla_hours: 24 }), stage({ sla_hours: 48 })] },
    { id: 'b', name: 'Global checklist', entity_type: 'checklist', state: 'draft', stages: [stage()] },
    { id: 'c', name: 'UAE WO', entity_type: 'work_order', state: 'retired', match_country: 'UAE', stages: [stage()] },
    { id: 'd', name: 'Future', entity_type: 'inspection', state: 'published', effective_at: '2026-12-01T00:00:00Z', match_country: 'KSA', match_site: 'NHC', stages: [stage()] },
  ]
  it('keeps country-less policies in every scope and filters by state and text', () => {
    expect(filterPolicies(policies, { scope: 'KSA' }).map(p => p.id)).toEqual(['a', 'b', 'd'])
    expect(filterPolicies(policies, { state: 'draft' }).map(p => p.id)).toEqual(['b'])
    expect(filterPolicies(policies, { search: 'nhc' }).map(p => p.id)).toEqual(['d'])
  })
  it('labels scope in plain words, falling back to the any label', () => {
    expect(policyScopeLabel(policies[3], {}, 'Any')).toBe('KSA / NHC')
    expect(policyScopeLabel({ match_user_id: 'u1' }, { u1: { full_name: 'Sajid' } }, 'Any')).toBe('Sajid')
    expect(policyScopeLabel(policies[1], {}, 'Any')).toBe('Any')
  })
  it('counts live, scheduled, drafts and averages SLA only where one is set', () => {
    const k = policyKpis(policies, NOW)
    expect(k).toMatchObject({ total: 4, live: 1, scheduled: 1, drafts: 1, retired: 1, multiStage: 1, avgSlaHours: 36 })
    expect(policyKpis([policies[1]], NOW).avgSlaHours).toBeNull()
    expect(policyKpis([], NOW).total).toBe(0)
  })
  it('carries the untouched source policy so edits never send display fields', () => {
    const [row] = policyRows([policies[0]], { anyLabel: 'Any', now: NOW })
    expect(row.policy).toBe(policies[0])
    expect(row).toMatchObject({ id: 'a', scopeLabel: 'KSA', stageCount: 2, scheduled: false })
  })
})

describe('validatePolicyDraft', () => {
  it('accepts a complete draft', () => expect(validatePolicyDraft(draft())).toBe(true))
  it('rejects missing name, reason and bad priority', () => {
    expect(validatePolicyDraft(draft({ name: ' ' }))).toBe(false)
    expect(validatePolicyDraft(draft({ change_reason: '' }))).toBe(false)
    expect(validatePolicyDraft(draft({ priority: 1.5 }))).toBe(false)
    expect(validatePolicyDraft(draft({ priority: -1 }))).toBe(false)
    expect(validatePolicyDraft(draft({ priority: 10001 }))).toBe(false)
  })
  it('requires exactly one reviewer kind and a sane SLA', () => {
    expect(validatePolicyDraft(draft({ stages: [stage({ approver_role: null })] }))).toBe(false)
    expect(validatePolicyDraft(draft({ stages: [stage({ approver_user_id: 'u1' })] }))).toBe(false)
    expect(validatePolicyDraft(draft({ stages: [stage({ sla_hours: 0 })] }))).toBe(false)
    expect(validatePolicyDraft(draft({ stages: [stage({ sla_hours: 8760 })] }))).toBe(true)
    expect(validatePolicyDraft(draft({ stages: [] }))).toBe(false)
    expect(validatePolicyDraft(draft({ stages: Array.from({ length: 6 }, () => stage()) }))).toBe(false)
    expect(validatePolicyDraft(null)).toBe(false)
  })
})

describe('regionCoverageSummary', () => {
  it('counts unrouted vehicles and never reads an unknown count as zero', () => {
    const s = regionCoverageSummary({
      regions: [
        { region: 'CENTRAL', vehicles: 491, route_status: 'matched' },
        { region: 'WESTERN', vehicles: 118, route_status: 'no_route' },
        { region: 'EAST', vehicles: null, route_status: 'ambiguous' },
      ],
      unmapped_sites: [{ site: 'X' }],
    })
    expect(s).toEqual({ regions: 3, matched: 1, ambiguous: 1, unrouted: 1, vehiclesKnown: 609, vehiclesUnrouted: 118, unmappedSites: 1 })
    expect(regionCoverageSummary(null).regions).toBe(0)
  })
})
