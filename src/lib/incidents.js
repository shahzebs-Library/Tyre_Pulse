/**
 * Pure, deterministic helpers for the Incident Reports module. No I/O, no clock
 * reads inside the functions — `now` is always injected so results are stable
 * and unit-testable. Consumed by the IncidentReports page and its tests.
 */

export const INCIDENT_STATUSES = ['open', 'investigating', 'resolved', 'closed']
export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical']
export const INCIDENT_TYPES = ['near_miss', 'damage', 'breakdown', 'safety', 'theft', 'other']

/**
 * Aggregate a set of incident rows into headline counts: by status, by severity,
 * total, and the open-work count (open + investigating). Null-safe: unknown
 * status/severity values are ignored in the per-bucket tallies but still counted
 * in `total`.
 *
 * @param {Array<{status?:string, severity?:string}>} rows
 * @returns {{
 *   total:number, open:number,
 *   byStatus:{open:number,investigating:number,resolved:number,closed:number},
 *   bySeverity:{low:number,medium:number,high:number,critical:number}
 * }}
 */
export function summarizeIncidents(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { open: 0, investigating: 0, resolved: 0, closed: 0 }
  const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 }
  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    if (bySeverity[r?.severity] != null) bySeverity[r.severity] += 1
  }
  return {
    total: list.length,
    open: byStatus.open + byStatus.investigating,
    byStatus,
    bySeverity,
  }
}

/**
 * Whole-day age of an incident, measured from its `incident_date` (falling back
 * to `created_at`) up to the injected `now` (ms epoch). Returns null when no
 * usable date is present, and clamps future-dated incidents to 0.
 *
 * @param {{incident_date?:string, created_at?:string}} incident
 * @param {number} now  reference clock as ms since epoch
 * @returns {number|null}
 */
export function incidentAgeDays(incident, now) {
  const raw = incident?.incident_date || incident?.created_at
  if (!raw) return null
  const t = new Date(raw).getTime()
  if (!Number.isFinite(t) || !Number.isFinite(now)) return null
  const days = Math.floor((now - t) / 86_400_000)
  return days < 0 ? 0 : days
}
