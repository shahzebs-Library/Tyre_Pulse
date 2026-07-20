/**
 * workOrderStatus.js - the SINGLE source of truth for the work-order status
 * vocabulary. The legacy Work Orders page (Title Case) and the Workshop Live
 * kanban (which used lowercase_underscore tokens) both speak this one language.
 *
 * Canonical values are human Title Case, matching the rest of the app + reports.
 * `work_orders.status` has NO DB CHECK, so this module normalises anything read
 * back (lowercase_underscore tokens, Title Case, spacing / hyphen variants) to a
 * canonical value, and every write goes out as a canonical value.
 *
 * Pure + deterministic: no I/O, no Date usage. `woKanbanColumn` takes an explicit
 * `overdue` flag so callers own the target-time comparison.
 */

// ── Canonical vocabulary ────────────────────────────────────────────────────────

/** The canonical Title Case status set (single source of truth). */
export const WO_STATUSES = Object.freeze([
  'New',
  'Awaiting Assignment',
  'Assigned',
  'In Progress',
  'Waiting for Parts',
  'Waiting for Approval',
  'Quality Inspection',
  'Completed',
  'Overdue',
  'Cancelled',
  'On Hold',
])

/** Display label per canonical status (identity today; keeps callers stable). */
export const WO_STATUS_LABEL = Object.freeze(
  WO_STATUSES.reduce((acc, s) => { acc[s] = s; return acc }, {}),
)

// ── Normalisation ───────────────────────────────────────────────────────────────

/** Reduce any raw status to a comparison key: lowercase, non-alphanumeric -> "_". */
function statusKey(raw) {
  return String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * Map of normalised keys -> canonical Title Case. Folds BOTH the engine's
 * lowercase_underscore tokens AND the legacy Title Case values AND common
 * spacing / hyphen / synonym variants.
 */
const KEY_TO_CANONICAL = Object.freeze({
  // New / freshly opened
  new: 'New',
  open: 'New',
  created: 'New',
  raised: 'New',
  // Awaiting assignment
  awaiting_assignment: 'Awaiting Assignment',
  unassigned: 'Awaiting Assignment',
  pending_assignment: 'Awaiting Assignment',
  // Assigned
  assigned: 'Assigned',
  allocated: 'Assigned',
  // In progress
  in_progress: 'In Progress',
  inprogress: 'In Progress',
  started: 'In Progress',
  working: 'In Progress',
  wip: 'In Progress',
  // Waiting for parts
  waiting_for_parts: 'Waiting for Parts',
  waiting_parts: 'Waiting for Parts',
  awaiting_parts: 'Waiting for Parts',
  parts: 'Waiting for Parts',
  // Waiting for approval
  waiting_for_approval: 'Waiting for Approval',
  waiting_approval: 'Waiting for Approval',
  awaiting_approval: 'Waiting for Approval',
  pending_approval: 'Waiting for Approval',
  approval: 'Waiting for Approval',
  // Quality inspection
  quality_inspection: 'Quality Inspection',
  qc: 'Quality Inspection',
  qc_inspection: 'Quality Inspection',
  quality_check: 'Quality Inspection',
  inspection: 'Quality Inspection',
  awaiting_inspection: 'Quality Inspection',
  // Completed (closed / done fold here per the unification decision)
  completed: 'Completed',
  complete: 'Completed',
  done: 'Completed',
  closed: 'Completed',
  finished: 'Completed',
  // Overdue (usually a derived display bucket)
  overdue: 'Overdue',
  // Cancelled
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  void: 'Cancelled',
  voided: 'Cancelled',
  // On hold
  on_hold: 'On Hold',
  hold: 'On Hold',
  paused: 'On Hold',
  suspended: 'On Hold',
})

/**
 * Normalise any raw status to a canonical Title Case value.
 * Unknown values pass through trimmed (never crash, never lose data).
 * @param {*} raw
 * @returns {string}
 */
export function normalizeWoStatus(raw) {
  const trimmed = String(raw == null ? '' : raw).trim()
  if (!trimmed) return ''
  return KEY_TO_CANONICAL[statusKey(trimmed)] || trimmed
}

// ── Kanban bucketing ─────────────────────────────────────────────────────────────

/** Ordered kanban columns (canonical statuses that form the board columns). */
export const KANBAN_COLUMNS = Object.freeze([
  'New',
  'Awaiting Assignment',
  'Assigned',
  'In Progress',
  'Waiting for Parts',
  'Waiting for Approval',
  'Quality Inspection',
  'Completed',
  'Overdue',
])

const KANBAN_SET = new Set(KANBAN_COLUMNS)

/**
 * The kanban column a job belongs to.
 * Overdue wins when `overdue` is true and the job is not Completed/Cancelled.
 * Statuses without a dedicated column (Cancelled, On Hold, unknown) fall back to
 * 'Awaiting Assignment' so a job is never dropped off the board.
 * @param {*} status
 * @param {{ overdue?: boolean }} [opts]
 * @returns {string} a value from KANBAN_COLUMNS
 */
export function woKanbanColumn(status, { overdue = false } = {}) {
  const canonical = normalizeWoStatus(status)
  if (overdue && canonical !== 'Completed' && canonical !== 'Cancelled') return 'Overdue'
  if (KANBAN_SET.has(canonical)) return canonical
  return 'Awaiting Assignment'
}

// ── Open / closed predicates ─────────────────────────────────────────────────────

const CLOSED = new Set(['Completed', 'Cancelled'])

/** True when the status is a terminal / closed state (Completed or Cancelled). */
export function isClosedWoStatus(status) {
  return CLOSED.has(normalizeWoStatus(status))
}

/** True when the status is an open (non-terminal) state. Empty -> open. */
export function isOpenWoStatus(status) {
  return !isClosedWoStatus(status)
}
