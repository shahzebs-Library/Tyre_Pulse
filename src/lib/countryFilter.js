/**
 * Null-safe country filtering for Supabase queries.
 *
 * `.eq('country', X)` silently drops rows where country IS NULL, which hides
 * legitimately-uncategorised records from dashboards/reports/lists. This helper
 * matches the selected country OR rows with no country set, so nothing vanishes.
 */
export function applyCountry(query, country) {
  if (!country || country === 'All') return query
  // Strip PostgREST filter metacharacters — country is normally a fixed enum
  // (KSA/UAE/…) but it is persisted in localStorage, so treat it as untrusted
  // before interpolating into the or() filter string.
  const c = String(country).replace(/[,()\\*]/g, '').trim()
  if (!c) return query
  // PostgREST or() - match the country, or rows with no country assigned.
  return query.or(`country.eq.${c},country.is.null`)
}

/** Client-side equivalent for already-loaded arrays. */
export function matchesCountry(row, country) {
  if (!country || country === 'All') return true
  return row?.country == null || row.country === country
}
