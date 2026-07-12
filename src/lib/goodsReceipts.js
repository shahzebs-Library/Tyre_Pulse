/**
 * Goods Receipts — pure helpers (no I/O) for the GRN module.
 *
 * Derives the per-line shortfall between what was ordered and what was received,
 * and rolls a list of receipts up into status counts, total received units,
 * an outstanding (partial/pending) count, and a total shortfall. Functions are
 * deterministic and take no ambient state, so they are fully unit-testable.
 */

export const GOODS_RECEIPT_STATUSES = ['pending', 'partial', 'received', 'rejected']

export const GOODS_RECEIPT_STATUS_META = {
  pending: { label: 'Pending', tone: 'amber' },
  partial: { label: 'Partial', tone: 'amber' },
  received: { label: 'Received', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
}

export const GOODS_RECEIPT_CONDITIONS = ['good', 'damaged', 'partial', 'rejected']

/** Coerce a value to a finite number, or null. */
function toNumber(value) {
  if (value === '' || value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * The line shortfall: qty_ordered − qty_received, but only when BOTH quantities
 * are present and numeric. Returns null when either is missing (so an unknown
 * order quantity is never reported as a shortfall). May be negative when more
 * was received than ordered (an over-delivery).
 */
export function receiptShortfall(row) {
  const ordered = toNumber(row?.qty_ordered)
  const received = toNumber(row?.qty_received)
  if (ordered == null || received == null) return null
  return ordered - received
}

/**
 * Roll a list of goods receipts up into { total, byStatus, totalReceived,
 * outstanding, shortfallUnits }.
 *   • byStatus       — count per lifecycle bucket.
 *   • totalReceived  — sum of qty_received across all rows.
 *   • outstanding    — rows whose status is 'partial' or 'pending'.
 *   • shortfallUnits — sum of positive line shortfalls (short deliveries only;
 *                      over-deliveries do not offset the total).
 */
export function summarizeGoodsReceipts(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { pending: 0, partial: 0, received: 0, rejected: 0 }
  let totalReceived = 0
  let outstanding = 0
  let shortfallUnits = 0

  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    if (r?.status === 'partial' || r?.status === 'pending') outstanding += 1
    const received = toNumber(r?.qty_received)
    if (received != null) totalReceived += received
    const shortfall = receiptShortfall(r)
    if (shortfall != null && shortfall > 0) shortfallUnits += shortfall
  }

  return {
    total: list.length,
    byStatus,
    totalReceived,
    outstanding,
    shortfallUnits,
  }
}
