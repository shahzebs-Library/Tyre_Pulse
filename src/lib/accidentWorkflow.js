/**
 * Accident workflow engine - THE single source of truth for the accident
 * lifecycle, department routing preview, recipient resolution and the accident
 * dashboard KPI set. Consumed by the web Accidents page + dashboard, the detail
 * modal, admin routing config and (via mirrored vocab) mobile.
 *
 * The lifecycle is a single ordered stage machine (mirrors the DB
 * chk_accident_workflow_stage constraint + accident_stage_from_status /
 * accident_status_from_stage in MIGRATIONS_V301). Legacy status/current_status/
 * case_stage columns are mapped, never re-invented - do NOT add a competing
 * lifecycle list elsewhere.
 *
 * Pure & deterministic (inject `now` for tests). Honest maths only - a value
 * that cannot be computed stays null/0, never fabricated. Claim/recovery maths
 * are delegated to claimsAnalytics (the single claims calc source) - not
 * duplicated here.
 */

import { analyzeClaims, hasClaim, isClosed as claimIsClosed, isDelayed } from './claimsAnalytics'

// ── the single lifecycle ──────────────────────────────────────────────────────
export const WORKFLOW_STAGES = [
  { key: 'reported',            label: 'Reported',            dept: 'Site Management',   tone: 'slate'  },
  { key: 'initial_review',      label: 'Initial Review',      dept: 'Operations',        tone: 'blue'   },
  { key: 'hse_investigation',   label: 'HSE Investigation',   dept: 'HSE / Safety',      tone: 'amber'  },
  { key: 'workshop_assessment', label: 'Workshop Assessment', dept: 'Workshop',          tone: 'blue'   },
  { key: 'insurance_claim',     label: 'Insurance Claim',     dept: 'Insurance',         tone: 'purple' },
  { key: 'repair_approval',     label: 'Repair Approval',     dept: 'Fleet / PMV',       tone: 'amber'  },
  { key: 'repair_in_progress',  label: 'Repair In Progress',  dept: 'Workshop',          tone: 'blue'   },
  { key: 'final_inspection',    label: 'Final Inspection',    dept: 'Workshop',          tone: 'blue'   },
  { key: 'vehicle_release',     label: 'Vehicle Release',     dept: 'Operations',        tone: 'green'  },
  { key: 'cost_recovery',       label: 'Cost Recovery',       dept: 'Finance',           tone: 'green'  },
  { key: 'closed',              label: 'Closed',              dept: 'Site Management',   tone: 'green'  },
  { key: 'cancelled',           label: 'Cancelled',           dept: 'Operations',        tone: 'slate'  },
]

export const STAGE_KEYS = WORKFLOW_STAGES.map((s) => s.key)
// The ordered "happy path" (excludes the terminal cancelled branch).
export const STAGE_FLOW = STAGE_KEYS.filter((k) => k !== 'cancelled')
const STAGE_BY_KEY = Object.fromEntries(WORKFLOW_STAGES.map((s) => [s.key, s]))

export const CLOSED_STAGES = ['closed', 'cancelled']
const REPAIR_DONE_STAGES = ['final_inspection', 'vehicle_release', 'cost_recovery', 'closed']

export function stageLabel(key) { return STAGE_BY_KEY[key]?.label || labelize(key) }
export function stageTone(key) { return STAGE_BY_KEY[key]?.tone || 'slate' }
export function stageDept(key) { return STAGE_BY_KEY[key]?.dept || null }
export function stageIndex(key) { return STAGE_FLOW.indexOf(key) }
export function isClosedStage(key) { return CLOSED_STAGES.includes(key) }
export function isOpenStage(key) { return !isClosedStage(key) }

/** The stage a row is actually at (falls back to deriving from legacy status). */
export function stageOf(r) {
  const st = String(r?.workflow_stage || '').trim()
  if (st && STAGE_BY_KEY[st]) return st
  return stageFromStatus(r?.status)
}

/** Allowed next stages: forward one step, or jump to closed/cancelled. Admins can
 *  still set any stage (this only drives the guided "advance" control). */
export function nextStages(key) {
  const i = stageIndex(key)
  const out = []
  if (i >= 0 && i < STAGE_FLOW.length - 1) out.push(STAGE_FLOW[i + 1])
  if (key !== 'closed') out.push('closed')
  if (key !== 'cancelled') out.push('cancelled')
  return [...new Set(out)]
}

// ── legacy <-> stage mapping (byte-mirror of MIGRATIONS_V301 SQL) ─────────────
export function stageFromStatus(status) {
  switch (String(status || '').trim()) {
    case 'reported': return 'reported'
    case 'under_review': return 'initial_review'
    case 'awaiting_approval': return 'repair_approval'
    case 'awaiting_parts': return 'repair_in_progress'
    case 'repair_in_progress': return 'repair_in_progress'
    case 'insurance_claim': return 'insurance_claim'
    case 'released': return 'vehicle_release'
    case 'closed': return 'closed'
    default: return 'reported'
  }
}
export function statusFromStage(stage) {
  switch (String(stage || '').trim()) {
    case 'reported': return 'reported'
    case 'initial_review': return 'under_review'
    case 'hse_investigation': return 'under_review'
    case 'workshop_assessment': return 'under_review'
    case 'insurance_claim': return 'insurance_claim'
    case 'repair_approval': return 'awaiting_approval'
    case 'repair_in_progress': return 'repair_in_progress'
    case 'final_inspection': return 'repair_in_progress'
    case 'vehicle_release': return 'released'
    case 'cost_recovery': return 'released'
    case 'closed': return 'closed'
    case 'cancelled': return 'closed'
    default: return 'reported'
  }
}

// ── severity token labels (mirror accident_severity_label SQL) ────────────────
export const SEVERITY_TOKENS = ['minor', 'moderate', 'severe', 'fatal']
export function severityLabel(token) {
  switch (String(token || '').trim()) {
    case 'minor': return 'Minor'
    case 'moderate': return 'Moderate'
    case 'severe': return 'Major'
    case 'fatal': return 'Fatal'
    default: return token || '-'
  }
}
export function isCritical(r) {
  const sev = String(r?.severity || '').toLowerCase()
  return sev === 'severe' || sev === 'fatal' || truthy(r?.injuries) || N(r?.injury_count) > 0
}

// ── the 12 standard departments (fallback list; the org's own live in DB) ─────
export const DEFAULT_DEPARTMENTS = [
  'Site Management', 'Operations', 'Fleet / PMV', 'Workshop', 'HSE / Safety',
  'Insurance', 'Finance', 'HR', 'Legal', 'Procurement', 'Security', 'Senior Management',
]

// ── routing preview (mirrors consume_event_accident_notify rule matching) ─────
/**
 * Evaluate active routing rules against an accident to preview which departments
 * + recipient roles it routes to. Pure - used for the admin "who gets notified"
 * preview and the accident detail routing panel.
 * @param {object[]} rules accident_routing_rules rows
 * @param {object} acc accident record
 * @param {string|null} [eventKey] restrict to rules for this event (null = any)
 */
export function evaluateRouting(rules, acc, eventKey = null) {
  const cost = N(acc?.estimated_damage_cost) || N(acc?.final_amount) || N(acc?.repair_cost) || 0
  const sev = String(acc?.severity || '').toLowerCase()
  const type = String(acc?.accident_type || '')
  const site = String(acc?.site || '')
  const country = acc?.country == null ? null : String(acc.country)

  const matched = (rules || []).filter((r) => {
    if (!r || r.active === false) return false
    if (eventKey && r.event_key && r.event_key !== eventKey) return false
    if (nonEmpty(r.match_severities) && !r.match_severities.includes(sev)) return false
    if (nonEmpty(r.match_types) && !r.match_types.includes(type)) return false
    if (nonEmpty(r.match_sites) && !r.match_sites.includes(site)) return false
    if (nonEmpty(r.match_countries) && (country == null || !r.match_countries.includes(country))) return false
    if (r.min_cost != null && r.min_cost !== '' && cost < N(r.min_cost)) return false
    if (r.require_injury && !(truthy(acc?.injuries) || N(acc?.injury_count) > 0)) return false
    if (r.require_vor && !truthy(acc?.vor)) return false
    if (r.require_third_party && !truthy(acc?.third_party_involved)) return false
    return true
  })

  return {
    departments: uniq(matched.flatMap((r) => arr(r.departments))),
    toRoles: uniq(matched.flatMap((r) => arr(r.to_roles))),
    ccRoles: uniq(matched.flatMap((r) => arr(r.cc_roles))),
    escalateRoles: uniq(matched.flatMap((r) => arr(r.escalate_roles))),
    matched: matched.map((r) => r.id).filter(Boolean),
  }
}

/**
 * Resolve which profiles would actually receive a notification, given the roles
 * and the accident's site/country. Mirrors the consumer's profile filter. The
 * caller should pass profiles already scoped to the accident's organisation.
 */
export function resolveRecipients(profiles, roles, acc) {
  const roleSet = new Set((roles || []).map((x) => String(x)))
  const accSite = String(acc?.site || '').toUpperCase()
  const accCountry = acc?.country == null ? null : String(acc.country)
  return (profiles || []).filter((p) => {
    if (!p) return false
    if (p.locked === true) return false
    if (p.approved === false) return false
    if (!roleSet.has(String(p.role))) return false
    const pSite = String(p.site || '').trim().toUpperCase()
    const pSites = arr(p.sites).map((x) => String(x).toUpperCase())
    const siteOk = !pSite || pSite === accSite || pSites.includes(accSite)
    if (!siteOk) return false
    const pCountry = arr(p.country)
    const countryOk = pCountry.length === 0 || accCountry == null || pCountry.map(String).includes(accCountry)
    return countryOk
  })
}

// ── dashboard KPIs (the single calc source for the accident dashboard) ────────
/**
 * @param {object[]} rows accident records
 * @param {{ now?: Date|string, vorSlaDays?: number }} [opts]
 */
export function buildAccidentKpis(rows, { now, vorSlaDays = 7 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const today = (now ? new Date(now) : new Date()).toISOString().slice(0, 10)
  const claims = analyzeClaims(list, { now })

  let total = list.length
  let open = 0, critical = 0, injuryCases = 0, vor = 0, vorOverSla = 0
  let pendingPolice = 0, repairInProgress = 0, repairCompleted = 0
  let totalRepairCost = 0, closedDays = 0, closedCount = 0

  const bySite = new Map(), byDriver = new Map(), byAssetType = new Map(), byRootCause = new Map(), byStage = new Map()

  for (const r of list) {
    const stage = stageOf(r)
    inc(byStage, stageLabel(stage))
    const openFlag = isOpenStage(stage)
    if (openFlag) open++
    if (isCritical(r)) critical++
    if (truthy(r.injuries) || N(r.injury_count) > 0) injuryCases++
    if (truthy(r.vor)) {
      vor++
      const days = daysSince(r.vor_since, today)
      if (days != null && days > vorSlaDays) vorOverSla++
    }
    if (openFlag && !String(r.police_report_no || '').trim()) pendingPolice++
    if (stage === 'repair_in_progress') repairInProgress++
    if (REPAIR_DONE_STAGES.includes(stage)) repairCompleted++
    totalRepairCost += N(r.repair_cost) || N(r.final_amount) || 0
    totalRepairCost += N(r.parts_cost)

    if (isClosedStage(stage)) {
      const d = daysBetween(r.incident_date, r.release_date || (stage === 'closed' ? (r.closure_approved_at || today) : today))
      if (d != null && d >= 0) { closedDays += d; closedCount++ }
    }

    inc(bySite, label(r.site))
    inc(byDriver, label(r.driver_name))
    inc(byAssetType, label(r.vehicle_type))
    inc(byRootCause, label(r.root_cause))
  }

  const pendingClaims = list.filter((r) => hasClaim(r) && !claimIsClosed(r)).length
  const claimsDelayed = list.filter((r) => isDelayed(r, today)).length
  const insuranceRecovery = claims.recovered
  const unrecoveredCost = claims.netExposure

  return {
    today,
    total,
    open,
    closed: total - open,
    critical,
    injuryCases,
    vor,
    vorOverSla,
    pendingPolice,
    pendingClaims,
    claimsDelayed,
    repairInProgress,
    repairCompleted,
    avgClosureDays: closedCount ? Math.round(closedDays / closedCount) : null,
    totalRepairCost,
    insuranceRecovery,
    unrecoveredCost,
    byStage: topN(byStage),
    bySite: topN(bySite),
    byDriver: topN(byDriver),
    byAssetType: topN(byAssetType),
    byRootCause: topN(byRootCause),
    claims,
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
function N(v) { return Number.isFinite(Number(v)) ? Number(v) : 0 }
function truthy(v) { return v === true || v === 'true' || v === 1 || v === '1' }
function arr(v) { return Array.isArray(v) ? v : [] }
function nonEmpty(v) { return Array.isArray(v) && v.length > 0 }
function uniq(a) { return [...new Set((a || []).filter((x) => x != null && x !== ''))] }
function labelize(k) { return String(k || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }
function label(v) { const s = String(v ?? '').trim(); return s || '(none)' }
function inc(map, key) { map.set(key, (map.get(key) || 0) + 1) }
function topN(map, n = 12) {
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, n)
}
function daysBetween(a, b) {
  const da = a ? new Date(a) : null, db = b ? new Date(b) : null
  if (!da || !db || Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null
  return Math.round((db.getTime() - da.getTime()) / 86_400_000)
}
function daysSince(a, today) { return a ? daysBetween(String(a).slice(0, 10), today) : null }
