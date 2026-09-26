import { describe, it, expect } from 'vitest'
import { buildApprovalCoverage, approvalCoverageKpis, coverageFor, isLive, filterGaps, gapExportRows } from '../lib/approvalCoverageAnalytics'

const NOW = new Date('2026-09-26').getTime()
const policies = [
  { entity_type: 'inspection', state: 'published', match_country: 'KSA' },
  { entity_type: 'checklist', state: 'published', match_country: 'KSA', match_site: 'NHC', match_role: 'Driver' },
  { entity_type: 'work_order', state: 'published', match_site: 'NHC', effective_at: '2027-01-01' },
  { entity_type: 'work_order', state: 'draft' },
  { entity_type: 'tyre_change', state: 'retired' },
]
const sites = [{ name: 'NHC', country: 'KSA', region: 'Central' }, { name: 'JED', country: 'KSA' }, { name: 'DXB', country: 'UAE' }, { name: 'OLD', country: 'KSA', active: false }]

describe('approvalCoverageAnalytics', () => {
  it('only counts rules in force', () => {
    expect(isLive(policies[2], NOW)).toBe(false)
    expect(isLive(policies[0], NOW)).toBe(true)
  })
  it('classifies covered, partial and none', () => {
    expect(coverageFor(policies, 'inspection', { country: 'KSA', site: 'JED' }, NOW)).toBe('covered')
    expect(coverageFor(policies, 'checklist', { country: 'KSA', site: 'NHC' }, NOW)).toBe('partial')
    expect(coverageFor(policies, 'checklist', { country: 'KSA', site: 'JED' }, NOW)).toBe('none')
  })
  it('builds the matrix and gaps', () => {
    const cov = buildApprovalCoverage({ policies, sites, countries: ['KSA', 'UAE'], now: NOW })
    const insp = cov.matrix.find(r => r.entityType === 'inspection')
    expect(insp.cells.KSA.status).toBe('covered')
    expect(insp.cells.UAE.status).toBe('none')
    expect(cov.matrix.find(r => r.entityType === 'checklist').cells.KSA).toMatchObject({ status: 'partial', gapSites: 1, partialSites: 1 })
    const wo = cov.matrix.find(r => r.entityType === 'work_order')
    expect(wo).toMatchObject({ drafts: 1, scheduled: 1 })
    expect(cov.gaps.some(g => g.site === 'OLD')).toBe(false)
    const k = approvalCoverageKpis(policies, cov, NOW)
    expect(k).toMatchObject({ published: 2, scheduled: 1, drafts: 1, retired: 1, typesWithoutRule: 2 })
    expect(filterGaps(cov.gaps, { entityType: 'inspection' }).map(g => g.site)).toEqual(['DXB'])
    expect(gapExportRows([{ entityType: 'inspection', country: 'UAE', site: 'DXB', state: 'none' }], { inspection: 'Inspection' })[0]).toMatchObject({ type: 'Inspection', region: 'N/A', coverage: 'No published rule' })
  })
})
