/**
 * Dispatch / Load Planning — pure domain helpers (no I/O, unit-testable).
 *
 * Turns a list of dispatch-load rows into the headline operational counts the
 * page renders: how many loads sit in each status, how many are actively moving
 * (in transit), how many are delivered, and the total planned payload. Keeping
 * this pure means the KPI logic is covered by fast unit tests and reused by
 * exports/charts without touching Supabase.
 */

/** The canonical load lifecycle, in board order. */
export const LOAD_STATUSES = ['planned', 'dispatched', 'in_transit', 'delivered', 'cancelled']

/**
 * Presentation metadata per status: a human label and a themed badge class
 * (mirrors the token-driven badge styling used elsewhere in the app).
 */
export const loadStatusMeta = {
  planned:    { label: 'Planned',    cls: 'bg-slate-700/40 text-slate-300 border border-slate-600/50' },
  dispatched: { label: 'Dispatched', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50' },
  in_transit: { label: 'In transit', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
  delivered:  { label: 'Delivered',  cls: 'bg-green-900/40 text-green-300 border border-green-700/50' },
  cancelled:  { label: 'Cancelled',  cls: 'bg-red-900/40 text-red-300 border border-red-700/50' },
}

/** Coerce a possibly-string numeric field to a finite number (else 0). */
function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (v == null || v === '') return 0
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Summarise dispatch-load rows into headline counts + payload totals.
 *
 * @param {Array<object>} rows
 * @returns {{
 *   byStatus: Record<string, number>,
 *   total: number,
 *   inTransit: number,
 *   delivered: number,
 *   active: number,
 *   totalWeightKg: number,
 *   totalWeightTonnes: number
 * }}
 */
export function summarizeDispatch(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { planned: 0, dispatched: 0, in_transit: 0, delivered: 0, cancelled: 0 }
  let totalWeightKg = 0
  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    totalWeightKg += toNum(r?.weight_kg)
  }
  const total = list.length
  const inTransit = byStatus.in_transit
  const delivered = byStatus.delivered
  // "Active" = in the pipeline but not yet terminal (delivered/cancelled).
  const active = byStatus.planned + byStatus.dispatched + byStatus.in_transit
  const totalWeightTonnes = Math.round((totalWeightKg / 1000) * 100) / 100
  return { byStatus, total, inTransit, delivered, active, totalWeightKg, totalWeightTonnes }
}
