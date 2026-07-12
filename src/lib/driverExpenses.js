/**
 * Pure, framework-free helpers for the Driver Expenses module. Kept side-effect
 * free and dependency-free so they are trivially unit-testable and reusable by
 * both the page (KPI tiles) and any reporting layer.
 */

export const EXPENSE_STATUS_ORDER = ['pending', 'approved', 'rejected', 'reimbursed']

function toAmount(v) {
  if (v === '' || v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Summarize a set of expense-claim rows for the page header / KPI tiles.
 *
 * @param {Array<{status?:string, amount?:number|string, driver_name?:string}>} rows
 * @returns {{
 *   total: number,
 *   byStatus: { pending:number, approved:number, rejected:number, reimbursed:number },
 *   totalAmount: number,
 *   pendingAmount: number,
 *   drivers: number,
 * }}
 */
export function summarizeExpenses(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { pending: 0, approved: 0, rejected: 0, reimbursed: 0 }
  const driverSet = new Set()
  let totalAmount = 0
  let pendingAmount = 0

  for (const r of list) {
    const status = r?.status
    if (byStatus[status] != null) byStatus[status] += 1

    const amt = toAmount(r?.amount)
    totalAmount += amt
    if (status === 'pending') pendingAmount += amt

    const driver = r?.driver_name ? String(r.driver_name).trim() : ''
    if (driver) driverSet.add(driver.toLowerCase())
  }

  return {
    total: list.length,
    byStatus,
    totalAmount: Math.round(totalAmount * 100) / 100,
    pendingAmount: Math.round(pendingAmount * 100) / 100,
    drivers: driverSet.size,
  }
}
