/**
 * Pure DTC diagnostics helpers — no I/O, unit-testable. Summarises a set of
 * diagnostic trouble code rows into the counts the page renders (KPI tiles,
 * severity chart). Kept side-effect free so it can be exercised in isolation
 * and reused by any consumer (page, export, future reporting).
 */

export const DTC_SEVERITIES = ['info', 'warning', 'critical']
export const DTC_STATUSES = ['active', 'acknowledged', 'cleared']

/**
 * Aggregate DTC rows into status/severity counts plus headline figures.
 *
 * @param {Array<{status?:string, severity?:string, asset_no?:string}>} rows
 * @returns {{
 *   total:number,
 *   byStatus:{active:number, acknowledged:number, cleared:number},
 *   bySeverity:{info:number, warning:number, critical:number},
 *   active:number,
 *   criticalActive:number,
 *   assetsAffected:number,
 * }}
 */
export function summarizeDtc(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { active: 0, acknowledged: 0, cleared: 0 }
  const bySeverity = { info: 0, warning: 0, critical: 0 }
  const assets = new Set()
  let criticalActive = 0

  for (const r of list) {
    if (!r) continue
    const status = byStatus[r.status] != null ? r.status : null
    const severity = bySeverity[r.severity] != null ? r.severity : null
    if (status) byStatus[status] += 1
    if (severity) bySeverity[severity] += 1
    if (status === 'active' && severity === 'critical') criticalActive += 1
    const asset = r.asset_no != null ? String(r.asset_no).trim() : ''
    if (asset) assets.add(asset)
  }

  return {
    total: list.length,
    byStatus,
    bySeverity,
    active: byStatus.active,
    criticalActive,
    assetsAffected: assets.size,
  }
}
