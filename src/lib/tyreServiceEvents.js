/**
 * Pure, unit-testable analytics for Tyre Service Events. No I/O, no Supabase —
 * takes an array of service-event rows and derives the summary used by the page
 * KPI tiles and the by-type doughnut. Kept side-effect free so the reducers can
 * be tested in isolation and reused server-side.
 */

export const EVENT_TYPES = ['rotation', 'repair', 'inflation', 'inspection', 'replacement', 'other']

export const EVENT_TYPE_META = {
  rotation:    { label: 'Rotation',    color: '#3b82f6' },
  repair:      { label: 'Repair',      color: '#ef4444' },
  inflation:   { label: 'Inflation',   color: '#22c55e' },
  inspection:  { label: 'Inspection',  color: '#8b5cf6' },
  replacement: { label: 'Replacement', color: '#f59e0b' },
  other:       { label: 'Other',       color: '#64748b' },
}

const toNumber = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Summarize service-event rows.
 * @param {Array<object>} rows
 * @returns {{
 *   total:number,
 *   totalCost:number,
 *   tyresServiced:number,
 *   byType:Record<string,number>,
 *   mostCommonType:string|null
 * }}
 */
export function summarizeServiceEvents(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byType = EVENT_TYPES.reduce((acc, t) => { acc[t] = 0; return acc }, {})
  const serials = new Set()
  let totalCost = 0

  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const type = EVENT_TYPES.includes(r.event_type) ? r.event_type : 'other'
    byType[type] += 1
    totalCost += toNumber(r.cost)
    const serial = r.tyre_serial != null ? String(r.tyre_serial).trim() : ''
    if (serial) serials.add(serial)
  }

  let mostCommonType = null
  let mostCommonCount = -1
  for (const t of EVENT_TYPES) {
    if (byType[t] > mostCommonCount) { mostCommonCount = byType[t]; mostCommonType = t }
  }
  if (list.length === 0) mostCommonType = null

  return {
    total: list.length,
    totalCost: Math.round(totalCost * 100) / 100,
    tyresServiced: serials.size,
    byType,
    mostCommonType,
  }
}
