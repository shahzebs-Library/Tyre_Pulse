/**
 * Pure, unit-testable helpers for Vehicle Check In/Out.
 *
 * Kept free of Supabase/React so the summary logic can be exercised in
 * isolation. `summarizeCheckInOut` powers the page KPI tiles: counts by
 * direction, the number of vehicles currently checked out, and the count of
 * distinct assets seen across the log.
 */

export const DIRECTIONS = ['out', 'in']
export const STATUSES = ['open', 'closed']

/**
 * Aggregate a list of check-in/out rows into headline counters.
 *
 * @param {Array<{direction?:string,status?:string,asset_no?:string}>} rows
 * @returns {{
 *   total:number, out:number, in:number,
 *   currentlyOut:number, returned:number, assets:number
 * }}
 */
export function summarizeCheckInOut(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const assets = new Set()
  let out = 0
  let inbound = 0
  let currentlyOut = 0

  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const dir = r.direction === 'in' ? 'in' : 'out'
    if (dir === 'in') inbound += 1
    else out += 1
    // "Currently out" = a check-OUT event still open (not yet returned/closed).
    if (dir === 'out' && r.status !== 'closed') currentlyOut += 1
    const asset = typeof r.asset_no === 'string' ? r.asset_no.trim() : ''
    if (asset) assets.add(asset.toLowerCase())
  }

  return {
    total: list.length,
    out,
    in: inbound,
    currentlyOut,
    returned: inbound,
    assets: assets.size,
  }
}
