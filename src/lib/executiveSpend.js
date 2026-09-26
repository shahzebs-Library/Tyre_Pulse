/**
 * Executive report tyre SPEND total - which number to show, and when to show none.
 *
 * The authoritative tyre spend is the expense grid (parts_consumption, via the
 * governed cost split). Summing tyre_records.cost_per_tyre understates it, because
 * a large share of fitments carry no price. The per-tyre sum is kept ONLY as a
 * fallback for a scope where the grid holds nothing.
 *
 * Money is never summed across currencies: a grid answer flagged `blended`
 * (several countries in scope) is refused, and so is a per-tyre sum over rows
 * from more than one country. The honest result is then `null` (render N/A),
 * never a zero and never a SAR+AED+EGP total.
 */

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * @param {object} args
 * @param {{amount:number|null, blended?:boolean, source?:string}|null} args.grid
 * @param {number|null} args.legacy        per-tyre sum over the period's records
 * @param {number} args.legacyCountries    distinct countries in those records
 * @returns {{amount:number|null, source:'grid'|'tyre_records'|'none', reason:string|null}}
 */
export function resolveReportTyreSpend({ grid, legacy, legacyCountries = 0 } = {}) {
  if (grid && !grid.blended && finite(grid.amount) && grid.amount > 0) {
    return { amount: grid.amount, source: 'grid', reason: null }
  }
  const legacyUsable = finite(legacy) && legacy > 0 && legacyCountries <= 1
  if (legacyUsable) return { amount: legacy, source: 'tyre_records', reason: null }
  if (grid?.blended || legacyCountries > 1) return { amount: null, source: 'none', reason: 'mixed_currency' }
  return { amount: null, source: 'none', reason: 'no_data' }
}

/** A share of a spend total, or null when the total is unknown. */
export function spendShare(amount, factor) {
  return finite(amount) ? amount * factor : null
}

/**
 * Date window for the grid read. `bounds` is the report's server bounds
 * ({from, toExclusive}) or null for "all time"; for all time the window is the
 * span of the loaded records' dates. Returns {from, to} (inclusive, YYYY-MM-DD)
 * or null when nothing defines a window.
 */
export function spendWindow(bounds, records = [], dateField = 'issue_date') {
  if (bounds && (bounds.from || bounds.toExclusive)) {
    let to = null
    if (bounds.toExclusive) {
      const d = new Date(`${bounds.toExclusive}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() - 1)
      to = d.toISOString().slice(0, 10)
    }
    return { from: bounds.from || null, to }
  }
  const dates = (Array.isArray(records) ? records : [])
    .map((r) => (r && r[dateField] ? String(r[dateField]).slice(0, 10) : null))
    .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
  if (!dates.length) return null
  return { from: dates[0], to: dates[dates.length - 1] }
}

/** Distinct non-empty country values in a row set. */
export function distinctCountries(rows = []) {
  const s = new Set()
  for (const r of Array.isArray(rows) ? rows : []) if (r?.country) s.add(r.country)
  return s.size
}
