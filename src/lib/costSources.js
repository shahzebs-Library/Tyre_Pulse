/**
 * costSources.js — pure helpers (no I/O) for a one-click Tyres vs Maintenance
 * cost switch. A single cost view can carry a { tyre, maintenance } split (a
 * total and/or a per-month series) and flip between Combined / Tyres /
 * Maintenance without re-querying. Reused across every cost surface so the mode
 * behaves identically everywhere. Non-finite inputs coerce to 0 (honest zero,
 * never NaN).
 */

export const COST_MODES = [
  { key: 'combined', label: 'Combined' },
  { key: 'tyres', label: 'Tyres' },
  { key: 'maintenance', label: 'Maintenance' },
]

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0)

/**
 * Pick the cost for a mode from a { tyre, maintenance } split:
 *   'tyres'       -> tyre
 *   'maintenance' -> maintenance
 *   'combined' (default / unknown) -> tyre + maintenance
 */
export function pickCost(mode, split = {}) {
  const tyre = num(split?.tyre)
  const maintenance = num(split?.maintenance)
  if (mode === 'tyres') return tyre
  if (mode === 'maintenance') return maintenance
  return tyre + maintenance
}

/** The display label for a cost mode (defaults to 'Combined' for unknown). */
export function costModeLabel(mode) {
  return (COST_MODES.find((m) => m.key === mode) || COST_MODES[0]).label
}

/**
 * Project a per-month split series to [{ month, value }] for the given mode.
 * byMonth = [{ month:'YYYY-MM', tyre:number, maintenance:number }].
 */
export function pickMonthly(mode, byMonth = []) {
  const list = Array.isArray(byMonth) ? byMonth : []
  return list.map((row) => ({ month: row?.month, value: pickCost(mode, row) }))
}

/**
 * Sum a per-month split series into { tyre, maintenance, combined } totals
 * (convenience for KPI tiles beside the switch).
 */
export function splitTotals(byMonth = []) {
  const list = Array.isArray(byMonth) ? byMonth : []
  let tyre = 0
  let maintenance = 0
  for (const row of list) {
    tyre += num(row?.tyre)
    maintenance += num(row?.maintenance)
  }
  return { tyre, maintenance, combined: tyre + maintenance }
}
