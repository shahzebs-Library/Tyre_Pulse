/**
 * approvalMatrixAnalytics - pure helpers behind the Approval Matrix page.
 *
 * The coverage map lives in approvalCoverageAnalytics; this module owns the
 * policy REGISTER: the scope filter, the plain-language scope label, the draft
 * validation rule, the site-register region lookups and the KPI strip. No I/O,
 * `now` is injectable. Routing for a specific case is NEVER decided here - the
 * server simulation (approval_policy_simulate / resolve_approvers) stays the
 * authority, this only describes what is stored.
 */
import { isLive } from './approvalCoverageAnalytics'

export const POLICY_STATES = ['draft', 'published', 'retired']
export const MAX_STAGES = 5
export const MAX_PRIORITY = 10000
export const MAX_SLA_HOURS = 8760

const txt = v => String(v ?? '').trim()

/** Region is recorded once on the site register; compared upper-cased. */
export const regionOf = site => txt(site?.region).toUpperCase()

/** Distinct regions of the active sites in a country (all countries when blank). */
export function regionOptions(sites = [], country = '') {
  return [...new Set((sites || [])
    .filter(s => s && s.active !== false && (!country || s.country === country))
    .map(regionOf)
    .filter(Boolean))].sort()
}

/** Active sites of one country, optionally narrowed to a region. A blank country offers nothing. */
export function siteOptions(sites = [], country = '', region = '') {
  if (!country) return []
  return (sites || []).filter(s => s && s.country === country && s.active !== false && (!region || regionOf(s) === region))
}

/** The region a named site belongs to, or '' when the register does not place it. */
export function siteRegion(sites = [], country = '', name = '') {
  return regionOf((sites || []).find(s => s && s.country === country && s.name === name))
}

/** Policy register filter: country scope (policies with no country apply everywhere), state and free text. */
export function filterPolicies(policies = [], { scope = '', state = '', search = '' } = {}) {
  const q = txt(search).toLowerCase()
  return (policies || []).filter(p => p
    && (!scope || !p.match_country || p.match_country === scope)
    && (!state || p.state === state)
    && (!q || [p.name, p.entity_type, p.match_region, p.match_site, p.match_country, p.match_role]
      .join(' ').toLowerCase().includes(q)))
}

/** "KSA / CENTRAL / NHC / Manager / Named person" or the any-scope label. */
export function policyScopeLabel(policy, usersById = {}, anyLabel = 'Any') {
  if (!policy) return anyLabel
  const parts = [policy.match_country, policy.match_region, policy.match_site, policy.match_role,
    usersById?.[policy.match_user_id]?.full_name].map(txt).filter(Boolean)
  return parts.length ? parts.join(' / ') : anyLabel
}

const isInt = v => v !== '' && v != null && Number.isInteger(Number(v))

/**
 * The server rejects these too; checking first gives a plain message instead of
 * a refused write. Returns true when the draft is savable.
 */
export function validatePolicyDraft(form) {
  if (!form) return false
  if (!txt(form.name) || !txt(form.change_reason)) return false
  const priority = Number(form.priority)
  if (!isInt(form.priority) || priority < 0 || priority > MAX_PRIORITY) return false
  const stages = Array.isArray(form.stages) ? form.stages : []
  if (!stages.length || stages.length > MAX_STAGES) return false
  return stages.every(s => {
    if (!txt(s?.name)) return false
    // Exactly one of role or named person.
    if (Boolean(s.approver_role) === Boolean(s.approver_user_id)) return false
    if (s.sla_hours == null) return true
    const h = Number(s.sla_hours)
    return isInt(s.sla_hours) && h >= 1 && h <= MAX_SLA_HOURS
  })
}

function isScheduled(p, now) {
  if (p?.state !== 'published' || !p.effective_at) return false
  const t = new Date(p.effective_at).getTime()
  return Number.isFinite(t) && t > now
}

/**
 * KPI strip over the policies in view. The SLA average is null (N/A) when no
 * stage carries one - an unset SLA is not a zero-hour SLA.
 */
export function policyKpis(policies = [], now = Date.now()) {
  const list = (policies || []).filter(Boolean)
  const slas = []
  let multiStage = 0
  for (const p of list) {
    const stages = Array.isArray(p.stages) ? p.stages : []
    if (stages.length > 1) multiStage += 1
    for (const s of stages) {
      const h = Number(s?.sla_hours)
      if (s?.sla_hours != null && Number.isFinite(h) && h > 0) slas.push(h)
    }
  }
  return {
    total: list.length,
    live: list.filter(p => isLive(p, now)).length,
    scheduled: list.filter(p => isScheduled(p, now)).length,
    drafts: list.filter(p => p.state === 'draft').length,
    retired: list.filter(p => p.state === 'retired').length,
    multiStage,
    avgSlaHours: slas.length ? Math.round((slas.reduce((a, b) => a + b, 0) / slas.length) * 10) / 10 : null,
  }
}

/** Flat rows for the policy register table and its export. */
export function policyRows(policies = [], { usersById = {}, anyLabel = 'Any', now = Date.now() } = {}) {
  // The source policy is carried untouched in `policy`, so an edit or clone
  // never sends a display-only field back to the writer.
  return (policies || []).filter(Boolean).map(p => ({
    id: p.id,
    policy: p,
    scopeLabel: policyScopeLabel(p, usersById, anyLabel),
    stageCount: Array.isArray(p.stages) ? p.stages.length : 0,
    scheduled: isScheduled(p, now),
  }))
}

/**
 * Region coverage summary from the server's region read. Vehicles with no
 * published route are counted; an unreadable vehicle count stays out of the sum
 * rather than being read as zero.
 */
export function regionCoverageSummary(coverage) {
  const regions = Array.isArray(coverage?.regions) ? coverage.regions : []
  let vehiclesUnrouted = 0
  let vehiclesKnown = 0
  for (const r of regions) {
    const v = Number(r?.vehicles)
    if (!Number.isFinite(v)) continue
    vehiclesKnown += v
    if (r.route_status !== 'matched') vehiclesUnrouted += v
  }
  return {
    regions: regions.length,
    matched: regions.filter(r => r?.route_status === 'matched').length,
    ambiguous: regions.filter(r => r?.route_status === 'ambiguous').length,
    unrouted: regions.filter(r => r && r.route_status !== 'matched' && r.route_status !== 'ambiguous').length,
    vehiclesKnown,
    vehiclesUnrouted,
    unmappedSites: Array.isArray(coverage?.unmapped_sites) ? coverage.unmapped_sites.length : 0,
  }
}
