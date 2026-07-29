/**
 * caseCompletionView.js — the pure view-model for the case Overview's completion
 * panel.
 *
 * It owns NO logic of its own. Route detection, completeness, closure levels and
 * the closure gate all live in the already-committed brain `accidentCase.js`; this
 * file only shapes that engine output into rows/badges/lists a presentational
 * React panel can render without ever touching the engine directly.
 *
 * DESIGN CONTRACT (same as the sibling engines):
 *   - Pure and deterministic. No I/O, no React, no clock read: a `now` is injected
 *     (read from caseData.now) for the closure-gate's overdue-task check.
 *   - Honest nulls. A dimension with nothing in scope renders "Not in scope", never
 *     a flattering 0% or 100%. The engine already returns null for that case; this
 *     file preserves it as a distinct visual state.
 *
 * caseData shape (all optional, tolerant of a bare accidents row):
 *   { record, workstreams, route, now }
 *   - record       accidents row (or pass the bare row as caseData itself)
 *   - workstreams  explicit accident_case_workstreams rows
 *   - route        a route key, def, or buildCaseRoute() result
 *   - now          Date|string|number for the overdue-task check (defaults to now)
 */

import {
  WORKSTREAMS,
  completeness,
  closureLevel,
  canFullyClose,
} from './accidentCase'

// ── shared tone vocabulary (the panel maps these to classes) ──────────────────
// good = done · info = well underway · warning = started · danger = not started ·
// quiet = out of scope / neutral.
export const TONE = Object.freeze({
  GOOD: 'good', INFO: 'info', WARNING: 'warning', DANGER: 'danger', QUIET: 'quiet',
})

/** The five completion dimensions, in display order (overall last, as a summary). */
export const COMPLETION_DIMENSIONS = Object.freeze([
  { key: 'incident',  label: 'Incident & Evidence' },
  { key: 'insurance', label: 'Insurance & Claim' },
  { key: 'repair',    label: 'Repair' },
  { key: 'financial', label: 'Finance & Settlement' },
  { key: 'overall',   label: 'Overall', summary: true },
])

const WS_NAME = Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w.name]))

// ── tolerant unpack of caseData ───────────────────────────────────────────────
function unpack(caseData) {
  const cd = caseData && typeof caseData === 'object' ? caseData : {}
  // Three valid shapes: an explicit { record, workstreams, route } wrapper; the
  // FLATTENED loadCase() result (accident fields at top level + a `workstreams`
  // key + `route_key`); or a bare accidents row. The old check treated "has a
  // workstreams key" as a wrapper and set record to cd.record (undefined) -> {},
  // discarding case_status/documents/approvals and reading a closed case as Open.
  const record = ('record' in cd && cd.record) ? cd.record : cd
  const workstreams = Array.isArray(cd.workstreams) ? cd.workstreams : []
  const route = cd.route ?? cd.route_key // engine defaults to the standard route
  const now = cd.now
  return { record, workstreams, route, now }
}

/**
 * The visual state for a completion percentage. `null` (nothing in scope) is a
 * first-class state, distinct from 0% (in scope, not started).
 * @param {number|null} pct
 * @returns {{ status: string, tone: string, inScope: boolean }}
 */
export function completionState(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) {
    return { status: 'Not in scope', tone: TONE.QUIET, inScope: false }
  }
  const n = Number(pct)
  if (n >= 100) return { status: 'Complete', tone: TONE.GOOD, inScope: true }
  if (n >= 50) return { status: 'In progress', tone: TONE.INFO, inScope: true }
  if (n > 0) return { status: 'Started', tone: TONE.WARNING, inScope: true }
  return { status: 'Not started', tone: TONE.DANGER, inScope: true }
}

/**
 * Five rows — one per completion dimension plus the overall summary — driven by
 * the engine's route-based completeness. A dimension with nothing required renders
 * pct `null` and status "Not in scope"; the panel draws that as an empty track,
 * never a filled bar.
 * @returns {Array<{ key, label, summary?, pct: number|null, status, tone, inScope }>}
 */
export function completionRows(caseData) {
  const { record, workstreams, route } = unpack(caseData)
  const c = completeness(record, workstreams, route)
  return COMPLETION_DIMENSIONS.map((d) => {
    const pct = c[d.key] == null ? null : c[d.key]
    return { key: d.key, label: d.label, summary: !!d.summary, pct, ...completionState(pct) }
  })
}

// ── closure badge ─────────────────────────────────────────────────────────────
const CLOSURE_META = {
  fully_closed:            { label: 'Fully closed',            tone: TONE.GOOD },
  operationally_completed: { label: 'Operationally completed', tone: TONE.INFO },
  financially_open:        { label: 'Financially open',        tone: TONE.WARNING },
  open:                    { label: 'Open',                    tone: TONE.QUIET },
}

/**
 * The closure-level badge. The engine returns `null` while a case is still
 * operationally open; here that becomes the explicit level `'open'` so the badge
 * always has a token to render.
 * @returns {{ level: string, label: string, tone: string }}
 */
export function closureBadge(caseData) {
  const { record, workstreams, route } = unpack(caseData)
  const level = closureLevel(record, workstreams, route) || 'open'
  const meta = CLOSURE_META[level] || CLOSURE_META.open
  return { level, label: meta.label, tone: meta.tone }
}

// ── blocking full closure ─────────────────────────────────────────────────────
const CHECK_LABEL = {
  mandatory_task: 'Mandatory task',
  pending_approval: 'Pending approval',
  required_document: 'Required document',
  closure_review: 'Closure review',
  workshop_qc: 'Workshop quality control',
}

function humanize(key) {
  const k = String(key || '').trim()
  if (!k) return 'Requirement'
  return k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')
}

/**
 * Everything blocking FULL closure, labelled — the authoritative closure-gate set
 * from `canFullyClose` (workstream clauses plus the meta gates: overdue mandatory
 * tasks, pending approvals, missing documents, unapproved closure review). An empty
 * array means the case is ready to close.
 * @returns {Array<{ key: string, kind: 'workstream'|'check', label: string, reason: string }>}
 */
export function blockerList(caseData) {
  const { record, workstreams, route, now } = unpack(caseData)
  const opts = now == null ? undefined : { now }
  const { blockers } = canFullyClose(record, workstreams, route, opts)
  return blockers.map((b) => {
    if (b.workstream) {
      return { key: b.workstream, kind: 'workstream', label: WS_NAME[b.workstream] || humanize(b.workstream), reason: b.reason }
    }
    return { key: b.check, kind: 'check', label: CHECK_LABEL[b.check] || humanize(b.check), reason: b.reason }
  })
}

/** True when nothing blocks full closure — the panel's "Ready to close" state. */
export function readyToClose(caseData) {
  return blockerList(caseData).length === 0
}
