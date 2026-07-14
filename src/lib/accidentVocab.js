/**
 * accidentVocab.js — THE single source of truth for every accident / claim
 * vocabulary in the app (option lists, alias maps, DB token converters).
 *
 * History: Accidents.jsx (inline create/edit form) and AccidentDetailModal.jsx
 * (detail tabs) each carried their own copies of these lists, and a few lists
 * had drifted into near-duplicates (e.g. two "current status" vocabularies).
 * This module consolidates them into ONE canonical set. Do NOT re-declare any
 * of these in a component — import from here.
 *
 * DB RULE (V222): accidents.severity / status / accident_type are
 * CHECK-constrained lowercase tokens. NEVER write a UI label straight to those
 * columns — always convert through toDbSeverity / toDbStatus / toDbAccidentType.
 */

import { severityFromAccidentDamage, SEVERITY_META } from './severity'

// ── Core display option lists (UI labels) ────────────────────────────────────
export const SEVERITIES = ['Minor', 'Major', 'Total Loss']

export const STATUSES = [
  'Reported',
  'Under Investigation',
  'Repair In Progress',
  'Awaiting Parts',
  'Awaiting Approval',
  'Insurance Claim',
  'Closed',
]

export const ACCIDENT_TYPE_OPTS = [
  'Collision', 'Rollover', 'Rear-end', 'Side-swipe', 'Reversing', 'Fire',
  'Vandalism', 'Weather', 'Tyre failure', 'Mechanical', 'Near miss',
  'Property damage', 'Other',
]

// ── GCC accident case-management vocabularies (V219) ─────────────────────────
export const DAMAGE_CLASS_OPTS    = ['Major', 'Minor']
export const FAULT_STATUS_OPTS    = ['Faulty', 'Non-faulty', 'Under review']
export const NAJM_STATUS_OPTS     = ['Najm report', 'No Najm']
export const NAJM_FAULT_OPTS      = ['Faulty', 'Non-faulty', 'N/A']
export const TAQDEER_STATUS_OPTS  = ['Taqdeer report', 'No Taqdeer']
export const LIABILITY_RATIO_OPTS = [0, 50, 100]
export const REPAIR_TYPE_OPTS     = ['Internal', 'External']

// ── Insurance claim lifecycle (lowercase DB values + display labels) ─────────
export const CLAIM_STATUS_OPTS = ['none', 'filed', 'approved', 'rejected', 'settled']
export const CLAIM_STATUS_LABELS = {
  none: 'No Claim', filed: 'Filed', approved: 'Approved', rejected: 'Rejected', settled: 'Settled',
}

// ── Cost recovery (lowercase DB values + display labels) ─────────────────────
export const RECOVERY_SOURCE_OPTS = ['none', 'insurer', 'third_party', 'driver', 'warranty']
export const RECOVERY_SOURCE_LABELS = {
  none: 'None', insurer: 'Insurer', third_party: 'Third Party', driver: 'Driver', warranty: 'Warranty',
}
export const RECOVERY_STATUS_OPTS = ['pending', 'partial', 'recovered', 'written_off']
export const RECOVERY_STATUS_LABELS = {
  pending: 'Pending', partial: 'Partial', recovered: 'Recovered', written_off: 'Written Off',
}

// ── Case tracker vocabularies ─────────────────────────────────────────────────
// Suggested values for free-text tracker fields (rendered as datalists so a
// common value is one click away but bespoke entries are still allowed).
export const CASE_STAGE_OPTS = [
  'Reported', 'Internal Report Preparation', 'Under Investigation', 'Insurance Filed',
  'Awaiting Assessment', 'Under Repair', 'Awaiting Parts', 'Repair Completed',
  'Claim Settlement', 'Closed',
]
export const DAMAGE_CONDITION_OPTS = ['Minor', 'Moderate', 'Major Repair', 'Total Loss', 'Cosmetic', 'Structural']

// The ONE canonical workflow-stage list for accidents.current_status. This is
// the reconciled union of the two lists that used to live in the detail view
// (Tracker's CURRENT_STATUS_OPTIONS and Repair & Insurance's WORKFLOW_STAGES),
// ordered by case lifecycle; the synonym 'In repair' was merged into
// 'Under Repair'.
export const WORKFLOW_STAGE_OPTS = [
  'Reported',
  'Under Investigation',
  'Under assessment',
  'Waiting insurance approval',
  'Insurance approved',
  'Under Repair',
  'Awaiting Parts',
  'Awaiting Approval',
  'Insurance Claim',
  'Repair Completed',
  'Waiting release',
  'Released',
  'Closed',
]

// Terminal stages — a case at/after these is NOT delayed and needs no next step.
export const TERMINAL_STAGES = ['released', 'closed']

// A workflow stage that implies a claim_status so the two stay in lockstep on save.
export const STAGE_TO_CLAIM_STATUS = {
  'waiting insurance approval': 'filed',
  'insurance approved': 'approved',
  'closed': 'settled',
}

// ── Read-side canonicalisation ────────────────────────────────────────────────
// Mobile writes lowercase values (minor/severe, reported/closed); the web form
// writes title-case. Canonicalise both vocabularies so badges & stats agree.
export const SEVERITY_ALIAS = {
  minor: 'Minor', moderate: 'Major', major: 'Major',
  severe: 'Total Loss', fatal: 'Total Loss', 'total loss': 'Total Loss',
}
export const STATUS_ALIAS = {
  reported: 'Reported', under_review: 'Under Investigation', under_investigation: 'Under Investigation',
  repair_in_progress: 'Repair In Progress', awaiting_parts: 'Awaiting Parts',
  awaiting_approval: 'Awaiting Approval', insurance_claim: 'Insurance Claim', closed: 'Closed',
}
export const canonSeverity = (s) => SEVERITY_ALIAS[String(s || '').toLowerCase()] || s || ''
export const canonStatus = (s) => STATUS_ALIAS[String(s || '').toLowerCase().replace(/\s+/g, '_')] || s || ''

// ── Write-side reverse maps (DB CHECK-constraint tokens) ─────────────────────
export const toDbSeverity = (s) => {
  const v = String(s || '').toLowerCase().trim()
  return ({ minor: 'minor', major: 'moderate', moderate: 'moderate', 'total loss': 'severe', severe: 'severe', fatal: 'fatal' })[v] || 'minor'
}
export const toDbStatus = (s) => {
  const v = String(s || '').toLowerCase().trim().replace(/\s+/g, '_')
  return ({
    reported: 'reported', under_investigation: 'under_review', under_review: 'under_review',
    repair_in_progress: 'repair_in_progress', awaiting_parts: 'awaiting_parts',
    awaiting_approval: 'awaiting_approval', insurance_claim: 'insurance_claim', closed: 'closed',
  })[v] || 'reported'
}

// accidents.chk_accident_type (V222) stores lowercase snake_case tokens; the
// form shows friendly labels. Map both directions like severity/status above —
// saving a label verbatim ('Collision', 'Rear-end') violates the DB CHECK.
export const ACCIDENT_TYPE_LABEL = {
  collision: 'Collision', rollover: 'Rollover', rear_end: 'Rear-end', side_swipe: 'Side-swipe',
  reversing: 'Reversing', fire: 'Fire', vandalism: 'Vandalism', weather: 'Weather',
  tyre_failure: 'Tyre failure', mechanical: 'Mechanical', near_miss: 'Near miss',
  property_damage: 'Property damage', other: 'Other',
}
const accTypeKey = (s) => String(s || '').toLowerCase().trim().replace(/[\s-]+/g, '_')
export const canonAccidentType = (s) => ACCIDENT_TYPE_LABEL[accTypeKey(s)] || s || ''
export const toDbAccidentType = (s) => {
  if (!s) return null
  const k = accTypeKey(s)
  return ACCIDENT_TYPE_LABEL[k] ? k : 'other'
}

// ── Case-field canonicalisation ──────────────────────────────────────────────
// The GCC / fault / repair fields are stored as free-form display strings but
// the list badges + filters key off the exact option label. Fold a stray-case
// value ('faulty', 'NAJM REPORT') back onto its canonical option so it still
// matches; an unknown value passes through unchanged (honest, never dropped).
const matchOpt = (value, opts) => {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return ''
  return opts.find((o) => String(o).toLowerCase() === v) ?? value
}
export const canonFaultStatus   = (v) => matchOpt(v, FAULT_STATUS_OPTS)
export const canonNajmStatus    = (v) => matchOpt(v, NAJM_STATUS_OPTS)
export const canonNajmFault     = (v) => matchOpt(v, NAJM_FAULT_OPTS)
export const canonTaqdeerStatus = (v) => matchOpt(v, TAQDEER_STATUS_OPTS)
export const canonRepairType    = (v) => matchOpt(v, REPAIR_TYPE_OPTS)
export const canonDamageClass   = (v) => matchOpt(v, DAMAGE_CLASS_OPTS)

// ── Presentation pills (THE single source for accident list + detail badges) ──
// One helper per axis so the register table and the /accidents/:id detail page
// render identical colours (no more drifting per-file SEVERITY_BADGE/STATUS_BADGE
// maps). Each returns { label, className }; an empty/unknown value yields an
// empty label so callers can render the 'N/A' token themselves.

// Consistent status palette (theme-friendly, mirrors severity.js badge style).
export const STATUS_PILL_CLASS = {
  'Reported':              'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  'Under Investigation':   'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  'Repair In Progress':    'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  'Awaiting Parts':        'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  'Awaiting Approval':     'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  'Insurance Claim':       'bg-red-500/15 text-red-400 border border-red-500/30',
  'Closed':                'bg-green-500/15 text-green-400 border border-green-500/30',
}
const PILL_FALLBACK = 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]'

/** Severity pill — folds accident damage (Minor/Major/Total Loss) onto the
 *  operational ladder so colours match every other severity surface. */
export function accidentSeverityPill(value) {
  const label = canonSeverity(value)
  if (!label) return { label: '', className: '' }
  const op = severityFromAccidentDamage(label, 'Medium')
  return { label, className: SEVERITY_META[op]?.badge ?? SEVERITY_META.Medium.badge }
}

/** Status pill — consistent colour per workflow status. */
export function accidentStatusPill(value) {
  const label = canonStatus(value)
  if (!label) return { label: '', className: '' }
  return { label, className: STATUS_PILL_CLASS[label] ?? PILL_FALLBACK }
}
