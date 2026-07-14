/**
 * accidentTimeline.js — pure case-timeline engine (no I/O).
 *
 * Derives "days spent in each status step" for one accident from the status
 * transitions the existing `log_accident_change()` audit trigger records in
 * `accident_audit_log` (action = 'status_change', changed_at, old/new status).
 *
 * HONEST rules:
 *  - Intermediate steps are NEVER fabricated: only recorded transitions create
 *    boundaries. With no audit rows, the timeline is a single step for the
 *    accident's current status spanning incident_date → now (→ release_date
 *    when the case is closed).
 *  - The first step starts at incident_date (fallback created_at, then the
 *    first transition's timestamp). Each subsequent step starts at its
 *    transition timestamp. The open (last) step ends at `now` and carries
 *    `current: true`; a closed case ends at the closing transition (or the
 *    recorded release_date when that is later).
 *  - Durations are whole days, clamped >= 0 (defends against back-dated
 *    incident dates / clock skew).
 */

const DAY_MS = 86_400_000

/** Canonical status token → human label (mirrors the detail view vocabulary). */
export const STATUS_LABELS = {
  reported: 'Reported',
  under_review: 'Under Investigation',
  under_investigation: 'Under Investigation',
  repair_in_progress: 'Repair In Progress',
  awaiting_parts: 'Awaiting Parts',
  awaiting_approval: 'Awaiting Approval',
  insurance_claim: 'Insurance Claim',
  closed: 'Closed',
}

/** Lowercase snake_case status token ('' when empty). */
export function normalizeStatus(status) {
  return String(status ?? '').trim().toLowerCase().replace(/\s+/g, '_')
}

/** Human label for a status token; unknown tokens pass through verbatim. */
export function statusLabel(status) {
  const key = normalizeStatus(status)
  return STATUS_LABELS[key] || (status ? String(status) : '')
}

/** Epoch ms for a date-ish value (ISO / YYYY-MM-DD / Date / ms), or null. */
function parseTs(value) {
  if (value == null || value === '') return null
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(t) ? null : t
}

/** Whole days between two epochs, clamped to >= 0. */
function wholeDays(fromTs, toTs) {
  return Math.max(0, Math.floor((toTs - fromTs) / DAY_MS))
}

/**
 * Extract a status transition from one audit row, tolerating both shapes:
 *  - lean API projection: { changed_at, old_status, new_status }
 *  - raw audit row:       { changed_at, old_values: {...}, new_values: {...} }
 * Returns { from, to, at } (normalized tokens + epoch ms) or null when the row
 * is not a real status transition (no new status, unparseable timestamp, or a
 * no-op where old === new). Rows carrying an `action` other than
 * 'status_change' are ignored.
 */
function transitionOf(row) {
  if (!row) return null
  if (row.action != null && row.action !== 'status_change') return null
  const at = parseTs(row.changed_at)
  if (at == null) return null
  const rawFrom = row.old_status ?? row.old_values?.status ?? null
  const rawTo = row.new_status ?? row.new_values?.status ?? null
  const to = normalizeStatus(rawTo)
  if (!to) return null
  const from = normalizeStatus(rawFrom)
  if (from === to) return null
  return { from, to, at }
}

/**
 * Build the ordered case timeline for one accident.
 *
 * @param {object}  accident  accidents row (uses status, incident_date,
 *                            created_at, release_date)
 * @param {Array}   auditRows accident_audit_log rows for this accident (any
 *                            order; lean or raw shape — see transitionOf)
 * @param {Date|number} [now] clock override for tests; defaults to Date.now()
 * @returns {Array<{step:string,label:string,from:string,to:string,days:number,current:boolean}>}
 *          ordered steps; `from`/`to` are ISO strings, `days` whole days >= 0,
 *          `current: true` only on the still-open last step.
 */
export function buildCaseTimeline(accident, auditRows, now = Date.now()) {
  if (!accident) return []
  const nowTs = parseTs(now) ?? Date.now()

  const transitions = (Array.isArray(auditRows) ? auditRows : [])
    .map(transitionOf)
    .filter(Boolean)
    .sort((a, b) => a.at - b.at)

  const anchor =
    parseTs(accident.incident_date) ??
    parseTs(accident.created_at) ??
    (transitions.length ? transitions[0].at : nowTs)

  const releaseTs = parseTs(accident.release_date)
  const mkStep = (step, fromTs, toTs, current) => ({
    step,
    label: statusLabel(step),
    from: new Date(fromTs).toISOString(),
    to: new Date(toTs).toISOString(),
    days: wholeDays(fromTs, toTs),
    current: Boolean(current),
  })

  // No recorded transitions — a single honest step for the current status.
  if (transitions.length === 0) {
    const status = normalizeStatus(accident.status) || 'reported'
    const closed = status === 'closed'
    const endTs = closed && releaseTs != null && releaseTs >= anchor
      ? releaseTs
      : (closed ? Math.max(anchor, parseTs(accident.updated_at) ?? anchor) : nowTs)
    return [mkStep(status, anchor, Math.max(anchor, endTs), !closed)]
  }

  const steps = []
  let cursorTs = Math.min(anchor, transitions[0].at)
  let currentStatus = transitions[0].from || 'reported'

  for (const t of transitions) {
    const at = Math.max(t.at, cursorTs)
    steps.push(mkStep(currentStatus, cursorTs, at, false))
    cursorTs = at
    currentStatus = t.to
  }

  if (currentStatus === 'closed') {
    // Terminal marker: the case stopped moving at the closing transition; use
    // the recorded release_date as the end when it falls after the closure.
    const endTs = releaseTs != null && releaseTs >= cursorTs ? releaseTs : cursorTs
    steps.push(mkStep('closed', cursorTs, endTs, false))
  } else {
    steps.push(mkStep(currentStatus, cursorTs, Math.max(cursorTs, nowTs), true))
  }
  return steps
}
