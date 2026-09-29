/** Formatters shared by the Size Optimizer page, its tabs and its exports. */
export function fmtCpk(v, currency) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${currency} ${v.toFixed(4)}/km`
}
export function fmtKm(v) {
  if (v == null || !Number.isFinite(v) || v === 0) return 'N/A'
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k km`
  return `${Math.round(v)} km`
}
export function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${v.toFixed(1)}%`
}
export function fmtMoney(v, currency) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${currency} ${Math.round(v).toLocaleString()}`
}
export function fmtSigned(v, suffix = '%') {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}${suffix}`
}

export function opTitle(op) {
  if (op.type === 'eliminate') return `Eliminate size ${op.size}`
  if (op.type === 'standardize') return `Standardize ${op.size} on ${op.best.brand}`
  return `Review specification for ${op.size}`
}
export function opDesc(op, currency) {
  if (op.type === 'eliminate') return `Used by only 1 vehicle (${op.vehicle || 'unknown'}). Consider eliminating it to reduce procurement complexity.`
  if (op.type === 'standardize') {
    return `${op.best.brand} CPK ${currency} ${op.best.avgCpk.toFixed(4)} vs ${op.worst.brand} CPK ${currency} ${op.worst.avgCpk.toFixed(4)}. Switch ${op.worst.count} tyres to ${op.best.brand}.`
  }
  return `Average CPK of ${currency} ${op.avgCpk.toFixed(4)}/km is over twice the fleet average. Investigate the root cause and consider an alternative specification.`
}
