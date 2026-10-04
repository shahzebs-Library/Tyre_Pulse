/**
 * Pure coverage maths for the Vehicle Designer: how many vehicles each fleet
 * type has, which types have a design, the share of vehicles on an active
 * custom design, the biggest gaps first, and a wheel-count check against the
 * tyre positions actually recorded for that type.
 */

/** Count vehicles per canonical type from rows of { vehicle_type }. */
export function countByType(rows = [], canon = (v) => String(v || '').trim().toUpperCase()) {
  const out = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = canon(r?.vehicle_type)
    if (t) out[t] = (out[t] || 0) + 1
  }
  return out
}

/**
 * Share of vehicles whose type has an ACTIVE custom design.
 * designs: [{ vehicle_type, active }] (vehicle_type already canonical).
 * Returns { covered, total, pct } with pct null when total is 0.
 */
export function vehicleCoverage(counts = {}, designs = []) {
  const active = new Set((designs || []).filter((d) => d && d.active !== false).map((d) => d.vehicle_type))
  let covered = 0; let total = 0
  for (const [t, n] of Object.entries(counts || {})) {
    total += n
    if (active.has(t)) covered += n
  }
  return { covered, total, pct: total ? Math.round((covered / total) * 100) : null }
}

/** Fleet types with no design at all, most vehicles first. */
export function biggestGaps(counts = {}, designs = [], limit = 5) {
  const designed = new Set((designs || []).map((d) => d?.vehicle_type))
  return Object.entries(counts || {})
    .filter(([t]) => !designed.has(t))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([vehicle_type, vehicles]) => ({ vehicle_type, vehicles }))
}

/** Distinct normalised positions per type from rows of { vehicle_type, tyre_position }. */
export function positionsByType(rows = [], canon = (v) => String(v || '').trim().toUpperCase()) {
  const sets = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = canon(r?.vehicle_type)
    const p = String(r?.tyre_position || '').trim().toUpperCase()
    if (!t || !p) continue
    ;(sets[t] ||= new Set()).add(p)
  }
  const out = {}
  for (const [t, s] of Object.entries(sets)) out[t] = s.size
  return out
}

/**
 * Compare a design's wheel slots with positions seen in tyre records.
 * Returns { state: 'unknown'|'ok'|'short'|'extra', text }.
 */
export function wheelCheck(designTyres, positionsSeen) {
  if (positionsSeen == null) return { state: 'unknown', text: 'N/A' }
  if (designTyres == null) return { state: 'unknown', text: `${positionsSeen} seen` }
  if (designTyres < positionsSeen) return { state: 'short', text: `${positionsSeen - designTyres} fewer slots than positions recorded` }
  if (designTyres > positionsSeen) return { state: 'extra', text: `${designTyres - positionsSeen} slots never recorded` }
  return { state: 'ok', text: 'Matches' }
}
