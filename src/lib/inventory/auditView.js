/**
 * Physical audit view logic (pure, no I/O).
 *
 * Mirrors the build contract (docs/inventory/07): blind counting, live count
 * with cutoff reconciliation, recount by a DIFFERENT person, segregation of
 * duties (the counter and the creator can never approve the adjustment).
 *
 * The server enforces every one of these rules in the inv_* RPCs. This file
 * decides what the screen offers and computes the reviewer's comparison table
 * from rows the reviewer is allowed to read. It is NEVER used to show expected
 * quantities to a counter: `sanitizeCounterLines` strips them defensively even
 * if an endpoint were ever to return them.
 */
import { sumByCurrency } from './inventoryMoney'

export const AUDIT_TYPES = [
  'full', 'partial', 'cycle', 'category', 'high_value', 'surprise', 'bin', 'tyre_serial', 'vehicle_tyre',
]

export const AUDIT_STATUSES = [
  'draft', 'scheduled', 'assigned', 'in_progress', 'counting_completed', 'reconciliation', 'recount',
  'investigation', 'approval', 'adjustment_posted', 'closed', 'cancelled', 'rejected',
]

export const CLOSED_AUDIT_STATUSES = new Set(['closed', 'cancelled', 'rejected'])

export const AUDIT_STATUS_TONE = {
  draft: 'muted', scheduled: 'info', assigned: 'info', in_progress: 'info',
  counting_completed: 'warning', reconciliation: 'warning', recount: 'warning', investigation: 'warning',
  approval: 'warning', adjustment_posted: 'good', closed: 'good', cancelled: 'muted', rejected: 'bad',
}

export const isOpenAudit = (a) => !!a && !CLOSED_AUDIT_STATUSES.has(a.status)

/** Fields a counter must never see before submitting. */
const EXPECTED_FIELDS = [
  'expected_qty', 'expected_serials', 'expected_cost', 'expected_value', 'book_qty',
  'qty_on_hand', 'unit_cost', 'avg_unit_cost', 'variance', 'variance_qty', 'value_impact',
]

export function sanitizeCounterLines(lines) {
  return (lines || []).map((l) => {
    const copy = { ...l }
    for (const f of EXPECTED_FIELDS) delete copy[f]
    return copy
  })
}

const todayIso = (now) => {
  const d = now instanceof Date ? now : new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Validate the create-audit form. Returns { ok, errors: {field: messageKey} }. */
export function validateAuditDraft(d, { now } = {}) {
  const errors = {}
  if (!AUDIT_TYPES.includes(d?.audit_type)) errors.audit_type = 'inventory.audits.errors.type'
  if (!String(d?.site || '').trim()) errors.site = 'inventory.audits.errors.site'
  if (!d?.counter_id) errors.counter_id = 'inventory.audits.errors.counter'
  if (!d?.reviewer_id) errors.reviewer_id = 'inventory.audits.errors.reviewer'
  if (d?.counter_id && d?.reviewer_id && d.counter_id === d.reviewer_id) {
    errors.reviewer_id = 'inventory.audits.errors.sameReviewer'
  }
  if (!d?.due_at) errors.due_at = 'inventory.audits.errors.due'
  else if (String(d.due_at).slice(0, 10) < todayIso(now)) errors.due_at = 'inventory.audits.errors.duePast'
  if (String(d?.instructions || '').length > 2000) errors.instructions = 'inventory.audits.errors.instructions'
  return { ok: Object.keys(errors).length === 0, errors }
}

/** The roles this user plays on one audit. */
export function auditRolesFor(audit, userId) {
  const roles = new Set()
  if (!audit || !userId) return roles
  if (audit.counter_id === userId) roles.add('counter')
  if (audit.recount_counter_id === userId) roles.add('recounter')
  if (audit.reviewer_id === userId) roles.add('reviewer')
  if (audit.approver_id === userId) roles.add('approver')
  if (audit.created_by === userId) roles.add('creator')
  return roles
}

/**
 * Actions offered to this user on this audit. `can(cap)` is the capability
 * predicate. A counter is never offered approve, reconcile or recount on
 * their own audit, whatever their capabilities say.
 */
export function availableActions(audit, userId, can = () => false) {
  if (!audit) return []
  const roles = auditRolesFor(audit, userId)
  const s = audit.status
  const isCounter = roles.has('counter') || roles.has('recounter')
  const out = []
  if (['draft', 'scheduled', 'assigned'].includes(s) && (can('audit_create') || roles.has('creator'))) out.push('start')
  // Counting is by assignment, not capability: inv_count_submit accepts exactly the
  // audit's counter (round 1) or its approved recounter, whatever they hold. An
  // approved recounter without the 'count' capability had no Count button.
  if (['assigned', 'in_progress'].includes(s) && roles.has('counter')) out.push('count')
  if (s === 'recount' && roles.has('recounter')) out.push('count')
  // Counting ends by the person counting (or the creator / an audit_create holder);
  // without it the audit can never reach reconciliation (server: inv_audit_complete_counting).
  if ((s === 'in_progress' && (roles.has('counter') || roles.has('creator') || can('audit_create')))
    || (s === 'recount' && (roles.has('recounter') || roles.has('creator') || can('audit_create')))) out.push('finish')
  if (['counting_completed', 'reconciliation'].includes(s) && !isCounter && (roles.has('reviewer') || can('discrepancy_review'))) out.push('reconcile')
  if (s === 'reconciliation' && !isCounter && can('recount')) out.push('recount')
  if (s === 'approval' && !isCounter && !roles.has('creator') && can('adjustment_approve')) out.push('approve')
  if (s === 'adjustment_posted' && can('audit_create')) out.push('close')
  if (!CLOSED_AUDIT_STATUSES.has(s) && s !== 'adjustment_posted' && can('audit_create')) out.push('cancel')
  return out
}

/** Approval of an adjustment: never by the counter, recounter or the creator. */
export function canApproveAdjustment({ audit, adjustment, userId, can = () => false }) {
  if (!userId) return { ok: false, reason: 'inventory.approve.noUser' }
  if (!can('adjustment_approve')) return { ok: false, reason: 'inventory.approve.noCapability' }
  const blocked = [audit?.counter_id, audit?.recount_counter_id, audit?.created_by, adjustment?.counted_by, adjustment?.created_by]
  if (blocked.filter(Boolean).includes(userId)) return { ok: false, reason: 'inventory.approve.segregation' }
  return { ok: true, reason: null }
}

const n = (v) => {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

const lineKey = (l) => [l.location_id || '', l.item_id || '', l.serial_no || ''].join('|')

/**
 * The reviewer's comparison: one row per expected or counted line.
 *  - the LATEST round per line wins (round 2 replaces round 1);
 *  - an expected line nobody counted is `not_counted` with variance NULL
 *    (an uncounted line is not a zero count unless `confirmed_zero`);
 *  - a counted line with no expectation is `unexpected`;
 *  - value impact = variance x unit cost, NULL when the cost is unknown.
 */
export function buildReconciliationRows(snapshotLines = [], countLines = []) {
  // Mirror the server (inv_audit_reconcile): within the LATEST round of a line
  // key, every count line is SUMMED (the same item counted twice on one shelf,
  // or by two passes, is one quantity). Earlier rounds are ignored.
  const maxRound = new Map()
  for (const c of countLines || []) {
    const k = lineKey(c)
    const r = Number(c.round) || 1
    if (!maxRound.has(k) || r > maxRound.get(k)) maxRound.set(k, r)
  }
  const latest = new Map()
  for (const c of countLines || []) {
    const k = lineKey(c)
    if ((Number(c.round) || 1) !== maxRound.get(k)) continue
    const qty = c.confirmed_zero ? 0 : n(c.counted_qty)
    const prev = latest.get(k)
    if (!prev) {
      latest.set(k, { ...c, counted_qty: qty, confirmed_zero: false, _lines: 1 })
      continue
    }
    const sum = prev.counted_qty === null && qty === null ? null : (prev.counted_qty ?? 0) + (qty ?? 0)
    const newer = String(c.counted_at || '') > String(prev.counted_at || '')
    latest.set(k, { ...(newer ? c : prev), counted_qty: sum, confirmed_zero: false, _lines: prev._lines + 1 })
  }
  const rows = []
  const seen = new Set()
  for (const s of snapshotLines || []) {
    const k = lineKey(s)
    seen.add(k)
    const c = latest.get(k)
    const expected = n(s.expected_qty) ?? (s.serial_no ? 1 : 0)
    let counted = null
    if (c) counted = c.confirmed_zero ? 0 : n(c.counted_qty)
    const variance = counted === null ? null : counted - expected
    const cost = n(s.expected_cost ?? s.unit_cost)
    rows.push({
      key: k,
      location_id: s.location_id || null,
      location_code: s.location_code || c?.location_code || null,
      item_id: s.item_id || null,
      item_code: s.item_code || c?.item_code || null,
      description: s.description || c?.description || null,
      serial_no: s.serial_no || null,
      expected_qty: expected,
      counted_qty: counted,
      variance,
      unit_cost: cost,
      currency: s.currency || null,
      value_impact: variance === null || cost === null ? null : Math.round(variance * cost * 100) / 100,
      round: c ? Number(c.round) || 1 : null,
      counted_by: c?.counter_id || c?.counted_by || null,
      status: counted === null ? 'not_counted' : variance === 0 ? 'match' : variance > 0 ? 'over' : 'short',
    })
  }
  for (const [k, c] of latest) {
    if (seen.has(k)) continue
    const counted = c.confirmed_zero ? 0 : n(c.counted_qty)
    rows.push({
      key: k,
      location_id: c.location_id || null,
      location_code: c.location_code || null,
      item_id: c.item_id || null,
      item_code: c.item_code || null,
      description: c.description || null,
      serial_no: c.serial_no || null,
      expected_qty: 0,
      counted_qty: counted,
      variance: counted,
      unit_cost: null,
      currency: null,
      value_impact: null,
      round: Number(c.round) || 1,
      counted_by: c.counter_id || c.counted_by || null,
      status: 'unexpected',
    })
  }
  return rows
}

export const DEFAULT_TOLERANCE = { qtyAbs: 1, qtyPct: 0.02, value: 500 }

/**
 * Does this line need a recount? Serialised lines have ZERO tolerance: any
 * missing or extra serial is an exception. Uncounted lines always recount.
 */
export function needsRecount(row, tol = DEFAULT_TOLERANCE) {
  if (!row) return false
  if (row.status === 'not_counted') return true
  if (row.status === 'unexpected') return true
  if (row.variance === null || row.variance === 0) return false
  if (row.serial_no) return true
  const limit = Math.max(tol.qtyAbs ?? 0, Math.abs(row.expected_qty || 0) * (tol.qtyPct ?? 0))
  if (Math.abs(row.variance) > limit) return true
  if (row.value_impact !== null && tol.value != null && Math.abs(row.value_impact) > tol.value) return true
  return false
}

/** Totals for the reviewer header. Money per currency; net AND absolute. */
export function summarizeReconciliation(rows, tol = DEFAULT_TOLERANCE) {
  const byStatus = { match: 0, over: 0, short: 0, not_counted: 0, unexpected: 0 }
  for (const r of rows || []) byStatus[r.status] = (byStatus[r.status] || 0) + 1
  const counted = (rows || []).filter((r) => r.counted_qty !== null)
  const accuracy = counted.length ? Math.round((byStatus.match / counted.length) * 1000) / 10 : null
  return {
    total: (rows || []).length,
    byStatus,
    accuracyPct: accuracy,
    recount: (rows || []).filter((r) => needsRecount(r, tol)).length,
    net: sumByCurrency(rows, (r) => r.value_impact, (r) => r.currency),
    abs: sumByCurrency(rows, (r) => (r.value_impact === null ? null : Math.abs(r.value_impact)), (r) => r.currency),
  }
}

// ── Discrepancies ────────────────────────────────────────────────────────────

/**
 * Discrepancy categories. PROPOSED list pending the owner's final wording; the
 * DB lane's CHECK constraint is authoritative, unknown values render raw.
 */
export const DISCREPANCY_CATEGORIES = [
  'count_error', 'unrecorded_issue', 'unrecorded_receipt', 'wrong_location', 'wrong_item',
  'damaged', 'expired_obsolete', 'theft_suspected', 'supplier_shortage', 'uom_error', 'data_entry', 'unknown',
]

export const DISCREPANCY_STATUSES = ['open', 'investigating', 'proposed', 'approved', 'rejected', 'posted', 'closed']

const DISCREPANCY_FLOW = {
  open: ['investigating'],
  investigating: ['proposed', 'closed'],
  proposed: ['investigating'],
  approved: [],
  rejected: ['investigating'],
  posted: ['closed'],
  closed: [],
}

/** Statuses a reviewer may move to from the investigation drawer. Approval is separate. */
export function nextDiscrepancyStatuses(status) {
  return DISCREPANCY_FLOW[status] || []
}

/**
 * The server stores a discrepancy's proposal as a SIGNED CORRECTION
 * (inventory_discrepancies.proposed_correction_qty, exposed as `proposed_qty`):
 * the quantity the approved adjustment adds to (or, negative, removes from) the
 * balance. People think in the CORRECT quantity on the shelf, so the screen asks
 * for that and converts: correction = correct - expected (expected as of the
 * count cutoff). Sending the correct quantity as if it were the correction posted
 * the wrong stock (found by the client-to-database end-to-end test).
 */
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

/** Correct quantity shown in the form, from the stored correction. '' when none. */
export function correctionToTarget(d) {
  const c = num(d?.proposed_qty)
  if (c === null || !Number.isFinite(c)) return ''
  return String((num(d?.expected_qty) || 0) + c)
}

/** Signed correction to send, from the correct quantity the person entered. null when blank or invalid. */
export function targetToCorrection(d, target) {
  const t = num(target)
  if (t === null || !Number.isFinite(t) || t < 0) return null
  return Math.round((t - (num(d?.expected_qty) || 0)) * 10000) / 10000
}

/** A proposed correction needs a category, a reason and evidence before approval. */
export function discrepancyReadyForApproval(d) {
  const missing = []
  if (!d?.category) missing.push('category')
  if (!String(d?.investigation_notes || d?.notes || '').trim()) missing.push('notes')
  if (d?.proposed_qty === null || d?.proposed_qty === undefined || d?.proposed_qty === '') missing.push('proposed_qty')
  return { ok: missing.length === 0, missing }
}
