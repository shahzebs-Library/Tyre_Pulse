/**
 * Null-safe country filtering for Supabase queries.
 *
 * `.eq('country', X)` silently drops rows where country IS NULL, which hides
 * legitimately-uncategorised records from dashboards/reports/lists. This helper
 * matches the selected country OR rows with no country set, so nothing vanishes.
 */
export function applyCountry(query, country) {
  if (!country || country === 'All') return query
  // PostgREST or() — match the country, or rows with no country assigned.
  return query.or(`country.eq.${country},country.is.null`)
}

/** Client-side equivalent for already-loaded arrays. */
export function matchesCountry(row, country) {
  if (!country || country === 'All') return true
  return row?.country == null || row.country === country
}
