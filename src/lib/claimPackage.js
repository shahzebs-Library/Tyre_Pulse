/**
 * claimPackage.js - pure engine behind the "Register insurance claim" case tab
 * (mock M4). No I/O. Every input is a row the case already loaded; every output
 * is what the tab prints, so the panel, its PDF (later) and the Flutter screen
 * cannot disagree about "7 of 8 required documents" or the derived money.
 *
 * Document package: one line per CLAIM_PACKAGE_DOCS entry. A document is
 * "received" when at least one `accident_evidence` row carries its
 * `requirement_key` (matched by key alone - the eight keys are distinct and a
 * document uploaded from another tab still counts; it is the same file).
 * Countable docs (damage photographs) print "N received".
 *
 * Money: `netClaimable` and `outstanding` return null (never 0) when the
 * figure cannot be derived - "Not set" beats a fabricated zero on a claim.
 */
import { CLAIM_PACKAGE_DOCS, NOTIFY_ROLES } from './accidentCaseVocab'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Received/Missing/"N received" per document + the package totals. */
export function buildClaimPackage(evidenceRows = [], docs = CLAIM_PACKAGE_DOCS) {
  const rows = Array.isArray(evidenceRows) ? evidenceRows : []
  const items = docs.map((d) => {
    const matches = rows.filter((r) => r && r.requirement_key === d.key)
    const count = matches.length
    const received = count > 0
    let statusLabel = received ? 'Received' : 'Missing'
    if (d.countable && received) statusLabel = `${count} received`
    const latest = matches.reduce((acc, r) => {
      const t = r.uploaded_at || r.created_at || null
      return !acc || (t && t > acc) ? t : acc
    }, null)
    return { ...d, count, received, statusLabel, latestAt: latest, rows: matches }
  })
  const required = items.filter((i) => i.required)
  const requiredReceived = required.filter((i) => i.received).length
  const missingRequired = required.filter((i) => !i.received)
  const complete = required.length > 0 && missingRequired.length === 0
  return {
    items,
    requiredTotal: required.length,
    requiredReceived,
    counterLabel: `${requiredReceived} of ${required.length} required documents`,
    missingRequired,
    complete,
    canRegister: complete,
  }
}

/** Claim amount less the deductible, floored at 0; null when no claim amount. */
export function netClaimable(claimAmount, deductible) {
  const claim = num(claimAmount)
  if (claim == null) return null
  const ded = num(deductible) ?? 0
  return Math.max(0, claim - ded)
}

/**
 * What is still owed: the insurer's approved amount (when decided) else the
 * claim amount, less what has actually been recovered. null when neither base
 * figure exists.
 */
export function outstanding(claimAmount, approvedAmount, recovered) {
  const base = num(approvedAmount) ?? num(claimAmount)
  if (base == null) return null
  return Math.max(0, base - (num(recovered) ?? 0))
}

/** Statuses whose amount has genuinely come back (a pending recovery is not money). */
export const COUNTED_RECOVERY_STATUSES = ['recovered', 'partial']

/** Sum of recovery rows that actually recovered money; null when there are none. */
export function recoveredTotal(recoveries = []) {
  const rows = (Array.isArray(recoveries) ? recoveries : []).filter(
    (r) => r && COUNTED_RECOVERY_STATUSES.includes(r.status) && num(r.amount) != null,
  )
  if (rows.length === 0) return null
  return rows.reduce((s, r) => s + num(r.amount), 0)
}

/** The most recent timestamp across the claim row and its recoveries, or null. */
export function lastUpdatedAt(claim, recoveries = []) {
  const stamps = []
  if (claim?.updated_at) stamps.push(claim.updated_at)
  if (claim?.created_at) stamps.push(claim.created_at)
  for (const r of Array.isArray(recoveries) ? recoveries : []) {
    if (r?.updated_at) stamps.push(r.updated_at)
    else if (r?.created_at) stamps.push(r.created_at)
  }
  if (stamps.length === 0) return null
  return stamps.reduce((a, b) => (b > a ? b : a))
}

// ── liability (accident_liability_assessments) ──────────────────────────────
export const LIABILITY_LABEL = {
  our_driver_full: 'Our driver / GCC',
  third_party_full: 'Other party',
  shared: 'Shared fault',
  under_investigation: 'Under investigation',
  not_applicable: 'Not applicable',
  our_driver_partial: 'Our driver, partial',
  disputed: 'Disputed',
  hit_and_run: 'Hit and run',
  no_third_party: 'No third party',
}
export const liabilityLabel = (assessment) =>
  (assessment?.liability_type && LIABILITY_LABEL[assessment.liability_type]) || ''
export const gccLiabilityPct = (assessment) => num(assessment?.our_liability_pct)

// ── repair route ────────────────────────────────────────────────────────────
const EXTERNAL_ROUTES = ['external', 'insurer_approved']
const EXTERNAL_WORKSHOPS = ['external', 'insurer_approved', 'dealer', 'specialist']
/** True when the repair is (or is recommended to be) handled outside our workshop. */
export function isExternalRepairRoute(repairOrder, assessment) {
  if (repairOrder) {
    if (EXTERNAL_ROUTES.includes(repairOrder.repair_route)) return true
    if (EXTERNAL_WORKSHOPS.includes(repairOrder.workshop_type)) return true
    if (repairOrder.external_workshop === true) return true
    if (repairOrder.repair_route && repairOrder.repair_route !== 'none') return false
  }
  return assessment?.recommended_route === 'external'
}

// ── notify chips (NOTIFY_ROLES -> resolved owner) ───────────────────────────
const ROLE_TEAM = { fleet: 'fleet', workshop: 'workshop', insurance: 'insurance', command_center: 'command center' }
const norm = (s) => String(s || '').trim().toLowerCase()
const personName = (p) => (p ? p.full_name || p.username || p.email || null : null)

/**
 * For each notify role, the person who owns a matching workstream on this case
 * (by team), else the role label. `visibilityOnly` roles keep the role label.
 * @returns {{key,label,name:string|null,display:string,visibilityOnly:boolean}[]}
 */
export function resolveNotifyPeople(workstreams = [], profiles = [], roles = NOTIFY_ROLES) {
  const byId = new Map((Array.isArray(profiles) ? profiles : []).map((p) => [p.id, p]))
  const rows = Array.isArray(workstreams) ? workstreams : []
  return roles
    .filter((r) => r.key !== 'insurance')
    .map((r) => {
      let name = null
      if (!r.visibilityOnly) {
        const team = ROLE_TEAM[r.key]
        const ws = rows.find((w) => w?.owner_id && norm(w.team) === team)
        name = ws ? personName(byId.get(ws.owner_id)) : null
      }
      return { key: r.key, label: r.label, name, display: name || r.label, visibilityOnly: !!r.visibilityOnly }
    })
}

/** The Command Center owner's name for the footer, or null when unknown. */
export function commandCenterOwner(workstreams = [], profiles = []) {
  return resolveNotifyPeople(workstreams, profiles).find((p) => p.key === 'command_center')?.name || null
}
