/**
 * Work order cost ledger: pure rules (no I/O).
 *
 * The stored cost of a work order (work_orders.parts_cost and total_cost) is the
 * IMPORTED BASELINE and is never changed by a form. Extra costs are entries on a
 * ledger (draft: supabase/pending_migrations/20261115142000_wo_cost_entries_ledger.sql).
 * Only APPROVED entries are money spent:
 *   calculated total = imported + approved additional + approved adjustments - approved refunds
 * Unapproved entries are shown apart and are never part of any total.
 * MIRROR of the view v_work_order_cost_totals. Change both.
 */
export const COST_STATUSES = Object.freeze(['draft', 'pending_reconciliation', 'pending_approval', 'approved', 'rejected', 'reversed'])
export const COST_UNAPPROVED = Object.freeze(['draft', 'pending_reconciliation', 'pending_approval'])
export const COST_KINDS = Object.freeze(['additional', 'adjustment', 'refund'])
export const COST_SOURCES = Object.freeze(['manual', 'store_issue', 'supplier_invoice', 'erp_follow_up', 'other'])

export const COST_STATUS_LABEL = Object.freeze({
  draft: 'Draft',
  pending_reconciliation: 'Waiting for reconciliation',
  pending_approval: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  reversed: 'Reversed',
})
export const COST_RECON_LABEL = Object.freeze({
  not_in_import: 'Not in the imported amount',
  possible_duplicate: 'May already be in the imported amount',
  cannot_tell: 'Cannot be checked against the imported amount',
})
export const COST_SOURCE_LABEL = Object.freeze({
  manual: 'Entered by hand', store_issue: 'Store issue', supplier_invoice: 'Supplier invoice',
  erp_follow_up: 'ERP follow-up', other: 'Other',
})
export const COST_LEDGER_UNAVAILABLE =
  'Adding costs is not available yet. The stored cost of this work order was not changed.'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const round2 = (n) => Math.round(n * 100) / 100

/**
 * The four figures of a work order.
 *
 * @param {object} row      the work order (imported baseline: total_cost, parts_cost)
 * @param {object[]|null} entries  ledger entries; null = the ledger could not be read
 * @returns {{imported:number|null, importedParts:number|null, additionalApproved:number|null,
 *   adjustmentsApproved:number|null, refundsApproved:number|null, calculatedTotal:number|null,
 *   unapprovedAmount:number|null, unapprovedCount:number|null, known:boolean}}
 *   When entries is null the ledger figures are null (never zero) and the calculated
 *   total is the imported total alone, flagged known:false.
 */
export function summarizeWorkOrderCosts(row, entries) {
  const imported = num(row?.total_cost)
  const importedParts = num(row?.parts_cost)
  if (!Array.isArray(entries)) {
    return {
      imported, importedParts, additionalApproved: null, adjustmentsApproved: null, refundsApproved: null,
      calculatedTotal: imported, unapprovedAmount: null, unapprovedCount: null, known: false,
    }
  }
  let add = 0; let adj = 0; let ref = 0; let pend = 0; let pendCount = 0
  for (const e of entries) {
    const amount = num(e?.amount)
    if (amount === null) continue
    if (e.status === 'approved') {
      if (e.entry_kind === 'refund') ref += amount
      else if (e.entry_kind === 'adjustment') adj += amount
      else add += amount
    } else if (COST_UNAPPROVED.includes(e.status)) {
      pend += amount; pendCount += 1
    }
  }
  return {
    imported, importedParts,
    additionalApproved: round2(add), adjustmentsApproved: round2(adj), refundsApproved: round2(ref),
    calculatedTotal: imported === null ? null : round2(imported + add + adj - ref),
    unapprovedAmount: round2(pend), unapprovedCount: pendCount, known: true,
  }
}

/** Is this entry approved money? Only then may any report count it. */
export const isApprovedCost = (e) => e?.status === 'approved'

/** Turn a parts line typed in the job card form into the arguments of a draft entry. */
export function costEntryFromPartLine(line, { reason } = {}) {
  const quantity = parseInt(line?.quantity, 10) || 1
  const unitCost = Number(line?.unit_cost) || 0
  return {
    kind: 'additional', category: 'parts',
    itemCode: String(line?.part_no ?? line?.item_code ?? '').trim() || null,
    description: String(line?.part_name ?? '').trim(),
    quantity, unitCost, amount: round2(quantity * unitCost),
    source: 'manual', reason: reason || 'Part entered on the job card form',
  }
}
