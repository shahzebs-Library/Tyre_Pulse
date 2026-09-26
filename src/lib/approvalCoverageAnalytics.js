/**
 * approvalCoverageAnalytics - which approval types, countries and sites have NO
 * published routing rule.
 *
 * Pure: it reads the policy list the Approval Matrix already loaded plus the
 * site register, and never guesses who would approve. The simulator (the server
 * `approval_policy_simulate`) remains the authority for a specific case; this is
 * the coverage map that tells an administrator where to look.
 *
 * A policy is "unconditional" for a place when it matches on country / region /
 * site only (or nothing). A policy that also requires a role or a named person
 * covers only part of the submissions, so it counts as PARTIAL coverage.
 */

export const APPROVAL_ENTITY_TYPES = ['inspection', 'checklist', 'work_order', 'tyre_change']

const norm = v => String(v ?? '').trim().toUpperCase()

/** A published policy in force now (effective_at unset or already passed). */
export function isLive(policy, now = Date.now()) {
  if (policy?.state !== 'published') return false
  if (!policy.effective_at) return true
  const t = new Date(policy.effective_at).getTime()
  return !Number.isFinite(t) || t <= now
}

/** Does this policy's place match (country, region, site)? Blank = any. */
export function placeMatches(policy, { country, region, site }) {
  if (policy.match_country && norm(policy.match_country) !== norm(country)) return false
  if (policy.match_region && norm(policy.match_region) !== norm(region)) return false
  if (policy.match_site && norm(policy.match_site) !== norm(site)) return false
  return true
}

const unconditional = p => !p.match_role && !p.match_user_id

/**
 * Classify coverage for one place and type.
 * @returns {'covered'|'partial'|'none'}
 */
export function coverageFor(policies, entityType, place, now = Date.now()) {
  const live = policies.filter(p => p.entity_type === entityType && isLive(p, now) && placeMatches(p, place))
  if (!live.length) return 'none'
  return live.some(unconditional) ? 'covered' : 'partial'
}

/**
 * Coverage matrix (type x country) and per-site gaps.
 * @param {{policies:Array, sites:Array, countries:string[], entityTypes?:string[], now?:number}} input
 */
export function buildApprovalCoverage({ policies = [], sites = [], countries = [], entityTypes = APPROVAL_ENTITY_TYPES, now = Date.now() } = {}) {
  const activeSites = sites.filter(s => s && s.active !== false && s.name)
  const matrix = entityTypes.map(type => {
    const cells = {}
    for (const country of countries) {
      const siteRows = activeSites.filter(s => s.country === country)
      const countryLevel = coverageFor(policies, type, { country, region: '', site: '' }, now)
      const siteStates = siteRows.map(s => coverageFor(policies, type, { country, region: s.region || '', site: s.name }, now))
      const gaps = siteStates.filter(x => x === 'none').length
      const partial = siteStates.filter(x => x === 'partial').length
      let status
      if (siteRows.length) status = gaps === siteRows.length ? 'none' : gaps || partial ? 'partial' : 'covered'
      else status = countryLevel
      cells[country] = { status, sites: siteRows.length, gapSites: gaps, partialSites: partial }
    }
    const drafts = policies.filter(p => p.entity_type === type && p.state === 'draft').length
    const scheduled = policies.filter(p => p.entity_type === type && p.state === 'published' && !isLive(p, now)).length
    return { entityType: type, cells, drafts, scheduled }
  })
  const gaps = []
  for (const type of entityTypes) {
    for (const s of activeSites) {
      if (countries.length && !countries.includes(s.country)) continue
      const state = coverageFor(policies, type, { country: s.country, region: s.region || '', site: s.name }, now)
      if (state !== 'covered') gaps.push({ entityType: type, country: s.country, region: String(s.region || '').trim() || null, site: s.name, state })
    }
  }
  return { matrix, gaps }
}

/** Headline counts. */
export function approvalCoverageKpis(policies = [], coverage = { matrix: [], gaps: [] }, now = Date.now()) {
  return {
    published: policies.filter(p => isLive(p, now)).length,
    scheduled: policies.filter(p => p.state === 'published' && !isLive(p, now)).length,
    drafts: policies.filter(p => p.state === 'draft').length,
    retired: policies.filter(p => p.state === 'retired').length,
    typesWithoutRule: coverage.matrix.filter(r => Object.values(r.cells).every(c => c.status === 'none')).length,
    siteGaps: coverage.gaps.filter(g => g.state === 'none').length,
    partialSites: coverage.gaps.filter(g => g.state === 'partial').length,
  }
}

export function filterGaps(gaps = [], { entityType = 'all', state = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return gaps.filter(g => (entityType === 'all' || g.entityType === entityType)
    && (state === 'all' || g.state === state)
    && (!q || `${g.site} ${g.region || ''} ${g.country}`.toLowerCase().includes(q)))
}

export function gapExportRows(gaps = [], labels = {}) {
  return gaps.map(g => ({
    type: labels[g.entityType] || g.entityType,
    country: g.country || 'N/A',
    region: g.region || 'N/A',
    site: g.site,
    coverage: g.state === 'none' ? 'No published rule' : 'Only role or person specific rules',
  }))
}
