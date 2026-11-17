/**
 * Effective status of a system log, read from the Error Center triage table (error_group_state).
 *
 * system_logs is immutable, so a log row's own `resolved` column never changes. The status a person
 * set lives on the log's error GROUP. MIRRORS the SQL in
 * supabase/pending_migrations/20261117120000_error_center_status_history.sql:
 *   no state row, for_review, reviewed            -> open
 *   fixed_in_code, resolved, ignored, routine     -> closed
 * Change both together.
 */
export const OPEN_STATUSES = Object.freeze(['for_review', 'reviewed'])
export const CLOSED_STATUSES = Object.freeze(['fixed_in_code', 'resolved', 'ignored', 'routine'])

export const STATUS_LABELS = Object.freeze({
  for_review: 'Open',
  reviewed: 'Reviewed',
  fixed_in_code: 'Fixed in code',
  resolved: 'Resolved',
  ignored: 'Ignored',
  routine: 'Routine',
})

/** Minimum reason length; the server refuses anything shorter. */
export const MIN_REASON_LENGTH = 3

/** Effective group status for a log row. Unknown or missing means open (for_review). */
export function effectiveStatus(row) {
  const s = row?.group_status
  if (OPEN_STATUSES.includes(s) || CLOSED_STATUSES.includes(s)) return s
  return 'for_review'
}

export function isOpenStatus(status) {
  return !CLOSED_STATUSES.includes(status)
}

export function isOpenLog(row) {
  return isOpenStatus(effectiveStatus(row))
}

/** The label shown on screen AND written to CSV/Excel, so the two can never disagree. */
export function statusLabel(row) {
  return STATUS_LABELS[effectiveStatus(row)]
}

export function validReason(reason) {
  return String(reason ?? '').trim().length >= MIN_REASON_LENGTH
}
