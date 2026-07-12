/**
 * Pure, dependency-free helpers for the Combination Manager. No Supabase, no
 * React — safe to unit-test in isolation. Handles the loose text ↔ array shape
 * of trailer lists and rolls a set of combination rows up into headline KPIs.
 */

/**
 * Normalise a free-text trailer list into a clean array of trailer numbers.
 * Accepts a raw string ("T1, T2 T3") or an array; splits on commas and
 * whitespace, trims, uppercases-agnostically dedupes (case-insensitive, first
 * spelling wins), and drops blanks. Order is preserved.
 *
 * @param {string|string[]|null|undefined} raw
 * @returns {string[]}
 */
export function parseTrailerList(raw) {
  if (raw == null) return []
  const parts = Array.isArray(raw)
    ? raw
    : String(raw).split(/[,\s]+/)
  const out = []
  const seen = new Set()
  for (const p of parts) {
    const t = String(p ?? '').trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/**
 * Roll combination rows up into headline KPIs for the dashboard tiles.
 *   - total     : number of combinations
 *   - active    : combinations with status === 'active'
 *   - inactive  : combinations with any non-active status
 *   - trailers  : total trailers linked across all combinations
 *   - units     : total physical units (prime movers + trailers)
 *
 * @param {Array<{status?:string, trailer_nos?:string[]|string, prime_mover_no?:string}>} rows
 */
export function summarizeCombinations(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let active = 0
  let trailers = 0
  let movers = 0
  for (const r of list) {
    if (r?.status === 'active') active += 1
    const tl = parseTrailerList(r?.trailer_nos)
    trailers += tl.length
    if (String(r?.prime_mover_no ?? '').trim()) movers += 1
  }
  return {
    total: list.length,
    active,
    inactive: list.length - active,
    trailers,
    units: movers + trailers,
  }
}
