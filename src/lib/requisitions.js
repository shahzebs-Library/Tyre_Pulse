/**
 * Pure, framework-free helpers for the Purchase Requisitions module. Kept
 * side-effect free and dependency-free so they are trivially unit-testable and
 * reusable by both the page (KPI tiles) and any reporting layer.
 */

export const REQUISITION_STATUS_ORDER = ['draft', 'submitted', 'approved', 'rejected', 'ordered']

function toCost(v) {
  if (v === '' || v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Summarize a set of requisition rows for the page header / KPI tiles.
 *
 * "Pending" = requisitions awaiting an approval decision (draft or submitted).
 *
 * @param {Array<{status?:string, est_cost?:number|string, quantity?:number|string}>} rows
 * @returns {{
 *   total: number,
 *   byStatus: { draft:number, submitted:number, approved:number, rejected:number, ordered:number },
 *   totalEstCost: number,
 *   pending: number,
 *   approved: number,
 * }}
 */
export function summarizeRequisitions(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { draft: 0, submitted: 0, approved: 0, rejected: 0, ordered: 0 }
  let totalEstCost = 0

  for (const r of list) {
    const status = r?.status
    if (byStatus[status] != null) byStatus[status] += 1
    totalEstCost += toCost(r?.est_cost)
  }

  return {
    total: list.length,
    byStatus,
    totalEstCost: Math.round(totalEstCost * 100) / 100,
    pending: byStatus.draft + byStatus.submitted,
    approved: byStatus.approved,
  }
}
