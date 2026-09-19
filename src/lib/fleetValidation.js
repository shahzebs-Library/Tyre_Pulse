/**
 * fleetValidation.js - the "Fleet Validation" case tab checklist (mock M6). Pure, no I/O.
 *
 * The SIX items are the ones the owner's mock prints, declared ONCE in
 * accidentCaseVocab.FLEET_VALIDATION_ITEMS and re-exported here. Each item has
 * two layers:
 *
 *   1. a SUGGESTED state DERIVED from facts the case already records (the fleet
 *      register, the incident row, the marked damage areas, the authority
 *      reports, the assessment workstream) - never a tick nobody has evidence
 *      for;
 *   2. a SAVED state a Fleet Supervisor recorded on
 *      accident_fleet_validation_items (state, counts, note, who, when).
 *
 * `mergeChecklist` puts the saved state in front of the suggested one, so a
 * person's decision always outranks the machine's suggestion, while an item
 * nobody has touched still shows what the data says. The saved-row write goes
 * through src/lib/api/fleetValidationItems.js; the workstream completion write
 * still goes through accidentCase.setWorkstreamStatus.
 */
import { FLEET_VALIDATION_ITEMS, CHECK_STATES, NOTIFY_ROLES } from './accidentCaseVocab'

export { FLEET_VALIDATION_ITEMS, CHECK_STATES }
/** Back-compat alias: older callers import VALIDATION_ITEMS. */
export const VALIDATION_ITEMS = FLEET_VALIDATION_ITEMS

/**
 * Minimum photographs the checklist expects. Raised automatically to the number
 * of marked damage areas (each marked area needs at least one photo), and
 * overridden by a saved count_required when a supervisor recorded one. A
 * constant, not a per-case invention, so the rule is inspectable.
 */
export const MIN_REQUIRED_PHOTOS = 4

/** Authority documents the "Police / Najm documents" item counts. */
export const AUTHORITY_DOCS = [
  { key: 'police', label: 'Police report' },
  { key: 'najm', label: 'Najm report' },
]

/** Which case tab each item jumps to (the chevron on the row). */
export const ITEM_TAB = {
  asset_driver_confirmed: 'overview',
  incident_facts_confirmed: 'overview',
  damage_map_reviewed: 'damage_map',
  required_photographs: 'overview',
  police_najm_documents: 'liability',
  workshop_assessment_requested: 'assessment',
}

/** What the notification package to Insurance / Claims carries (mock M6 text). */
export const NOTIFY_PACKAGE_TEXT =
  'Incident report, asset details, damage locations, photos, police / Najm documents'

/** Workstream statuses that mean "the assessment has been requested". */
const ASSESSMENT_REQUESTED = new Set([
  'assigned', 'in_progress', 'waiting_info', 'waiting_approval', 'waiting_external', 'on_hold', 'completed', 'reopened',
])

function present(v) {
  return v != null && String(v).trim() !== ''
}

/** Photos on the incident row - `photos` is jsonb: an array or an object of arrays. */
export function photoCount(acc) {
  const p = acc?.photos
  if (Array.isArray(p)) return p.filter(Boolean).length
  if (p && typeof p === 'object') return Object.values(p).reduce((n, v) => n + (Array.isArray(v) ? v.filter(Boolean).length : v ? 1 : 0), 0)
  return 0
}

/** Marked damage areas on the assessment (damage_areas jsonb array). */
export function markedAreaCount(damageAssessment) {
  const a = damageAssessment?.damage_areas
  return Array.isArray(a) ? a.length : 0
}

/** Injuries line: "No injuries" / "N injured" / "Not set". */
export function injuriesLabel(acc) {
  const n = Number(acc?.injury_count)
  if (Number.isFinite(n) && n > 0) return `${n} injured`
  const raw = acc?.injuries
  if (raw === true) return 'Injuries reported'
  if (raw === false || n === 0) return 'No injuries'
  if (present(raw)) {
    const s = String(raw).trim().toLowerCase()
    if (['no', 'none', 'false', '0'].includes(s)) return 'No injuries'
    if (['yes', 'true'].includes(s)) return 'Injuries reported'
    return String(raw).trim()
  }
  return 'Not set'
}

/** Third party line: "Third party involved" / "No third party" / "Not set". */
export function thirdPartyLabel(acc) {
  const v = acc?.third_party_involved
  if (v === true) return 'Third party involved'
  if (v === false) return 'No third party'
  if (present(v)) {
    const s = String(v).trim().toLowerCase()
    if (['yes', 'true', '1'].includes(s)) return 'Third party involved'
    if (['no', 'false', '0', 'none'].includes(s)) return 'No third party'
  }
  return 'Not set'
}

/** Authority documents (police/najm) that are NOT received. */
export function missingAuthorityDocs(authorityReports = []) {
  return AUTHORITY_DOCS.filter((d) => {
    const row = (authorityReports || []).find((r) => r?.authority_type === d.key)
    return !(row && row.report_status === 'available')
  })
}

/** The mock's warning sentence, or '' when nothing is missing. */
export function authorityWarning(authorityReports = []) {
  const missing = missingAuthorityDocs(authorityReports)
  if (!missing.length) return ''
  return `${missing.map((d) => d.label).join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing. Claim registration cannot start.`
}

/**
 * The derived (suggested) checklist.
 * @param {{acc?:object, asset?:object|null, authorityReports?:object[], damageAssessment?:object|null,
 *   workstreams?:object[]}} p
 * @returns {{key,label,countable,suggested,countDone,countRequired,detail,tab}[]}
 */
export function deriveChecklist({ acc = {}, asset = null, authorityReports = [], damageAssessment = null, workstreams = [] } = {}) {
  const photos = photoCount(acc)
  const areas = markedAreaCount(damageAssessment)
  const photosRequired = Math.max(MIN_REQUIRED_PHOTOS, areas)
  const missingDocs = missingAuthorityDocs(authorityReports)
  const docsDone = AUTHORITY_DOCS.length - missingDocs.length
  const assessmentWs = (workstreams || []).find((w) => (w.workstream_key || w.workstream || w.key) === 'assessment') || null
  const assessmentRequested = !!damageAssessment || ASSESSMENT_REQUESTED.has(assessmentWs?.status)

  const factsMissing = ['incident_date', 'site', 'accident_type'].filter((k) => !present(acc[k]))
  const anyFact = ['incident_date', 'site', 'accident_type', 'description'].some((k) => present(acc[k]))

  const byKey = {
    asset_driver_confirmed: {
      suggested: asset && present(acc.driver_name) ? 'done' : (present(acc.asset_no) && (!asset || !present(acc.driver_name))) ? 'attention' : 'pending',
      detail: asset
        ? `${asset.asset_no || acc.asset_no}${present(acc.driver_name) ? ` with ${acc.driver_name}` : ', driver not set'}`
        : present(acc.asset_no) ? `${acc.asset_no} is not in the fleet register` : 'Asset not set',
    },
    incident_facts_confirmed: {
      suggested: factsMissing.length === 0 && present(acc.description) ? 'done' : anyFact ? 'attention' : 'pending',
      detail: factsMissing.length ? `Not set: ${factsMissing.map((k) => k.replace(/_/g, ' ')).join(', ')}` : present(acc.description) ? 'Date, site, type and description recorded' : 'Description not set',
    },
    damage_map_reviewed: {
      suggested: areas > 0 ? 'done' : damageAssessment ? 'attention' : 'pending',
      detail: areas > 0 ? `${areas} marked damage area${areas === 1 ? '' : 's'}` : damageAssessment ? 'Assessment started, no areas marked' : 'No damage map yet',
    },
    required_photographs: {
      suggested: photos >= photosRequired ? 'done' : photos > 0 ? 'attention' : 'pending',
      countDone: photos,
      countRequired: photosRequired,
      detail: `${photos} photo${photos === 1 ? '' : 's'} attached`,
    },
    police_najm_documents: {
      suggested: docsDone === AUTHORITY_DOCS.length ? 'done' : docsDone > 0 || (authorityReports || []).length ? 'attention' : 'pending',
      countDone: docsDone,
      countRequired: AUTHORITY_DOCS.length,
      detail: missingDocs.length ? `${missingDocs.map((d) => d.label).join(', ')} not received` : 'Police and Najm reports received',
    },
    workshop_assessment_requested: {
      suggested: assessmentRequested ? 'done' : 'pending',
      detail: assessmentRequested ? (damageAssessment ? 'Assessment recorded' : 'Assessment workstream started') : 'Pending',
    },
  }

  return FLEET_VALIDATION_ITEMS.map((it) => ({
    key: it.key,
    label: it.label,
    countable: !!it.countable,
    tab: ITEM_TAB[it.key] || 'overview',
    suggested: byKey[it.key]?.suggested || 'pending',
    countDone: byKey[it.key]?.countDone ?? null,
    countRequired: byKey[it.key]?.countRequired ?? null,
    detail: byKey[it.key]?.detail || '',
  }))
}

/**
 * Saved rows (accident_fleet_validation_items) laid over the derived list. A
 * saved state wins; a saved count_required wins; the derived count_done is
 * always the live figure (it comes from the photos / reports themselves).
 */
export function mergeChecklist(derived, savedRows = []) {
  const saved = Object.fromEntries((savedRows || []).filter((r) => r?.item_key).map((r) => [r.item_key, r]))
  return derived.map((d) => {
    const s = saved[d.key]
    const state = s && CHECK_STATES.includes(s.state) ? s.state : d.suggested
    const countRequired = Number.isFinite(Number(s?.count_required)) && s?.count_required != null ? Number(s.count_required) : d.countRequired
    return {
      ...d,
      state,
      saved: !!s,
      countRequired,
      checkedAt: s?.checked_at || null,
      checkedByName: s?.checked_by_name || null,
      note: s?.note || '',
      passed: state === 'done' || state === 'not_applicable',
    }
  })
}

/**
 * "7 of 7" / "1 missing" / "Pending" / "N/A" / ''
 * countRequired is a MINIMUM: once met, the label prints the attached count on
 * both sides ("7 of 7"), since more evidence than the minimum is not a gap.
 */
export function countLabel(item) {
  if (item.state === 'not_applicable') return 'N/A'
  if (item.countable && item.countRequired != null) {
    const done = Number(item.countDone) || 0
    const req = Number(item.countRequired) || 0
    if (done >= req && req > 0) return `${done} of ${Math.max(done, req)}`
    const missing = Math.max(0, req - done)
    return missing ? `${missing} missing` : `${done} of ${req}`
  }
  if (item.state === 'pending') return 'Pending'
  if (item.state === 'attention') return 'Attention'
  return ''
}

/**
 * One-call convenience: derive + merge. Back-compat name.
 * @returns items carrying `state` + `passed`
 */
export function buildValidationChecklist({ savedRows = [], ...p } = {}) {
  return mergeChecklist(deriveChecklist(p), savedRows)
}

/** Summary counts - never divides by zero. `complete` = every item done or N/A. */
export function validationSummary(items) {
  const total = items.length
  const passed = items.filter((i) => i.passed || i.state === 'done' || i.state === 'not_applicable').length
  const attention = items.filter((i) => i.state === 'attention').length
  return { total, passed, missing: total - passed, attention, complete: total > 0 && passed === total }
}

/** The next state when a row is clicked: done <-> pending (N/A and attention -> done). */
export function toggleState(state) {
  return state === 'done' ? 'pending' : 'done'
}

/**
 * Resolve the person / role a notify block addresses.
 * @param {{workstreams?:object[], profiles?:object[], workstreamKey:string, roleKey:string}} p
 * @returns {{name:string|null, role:string, label:string}}
 */
export function resolveRecipient({ workstreams = [], profiles = [], workstreamKey, roleKey } = {}) {
  const roleDef = NOTIFY_ROLES.find((r) => r.key === roleKey) || null
  const ws = (workstreams || []).find((w) => (w.workstream_key || w.workstream || w.key) === workstreamKey) || null
  const byId = ws?.owner_id ? (profiles || []).find((p) => p.id === ws.owner_id) : null
  if (byId) {
    const name = byId.full_name || byId.username || null
    return { name, role: ws.owner_role || byId.role || roleDef?.label || '', label: name || ws.owner_role || roleDef?.label || 'Not set' }
  }
  if (ws?.owner_role) return { name: null, role: ws.owner_role, label: ws.owner_role }
  const roleHolder = roleDef ? (profiles || []).find((p) => roleDef.roles.includes(p.role) && p.approved !== false) : null
  if (roleHolder) {
    const name = roleHolder.full_name || roleHolder.username || null
    return { name, role: roleHolder.role, label: name || roleHolder.role }
  }
  return { name: null, role: roleDef?.label || '', label: roleDef?.label || 'Not set' }
}
