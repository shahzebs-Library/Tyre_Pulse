/**
 * Country handling for the Recall Tracker.
 *
 * `recalls.country` is ONE text value. `profiles.country` is a text ARRAY (the
 * user's country scope). Writing the array into the column stores a JSON string
 * such as '["KSA","UAE"]', which matches no country scope, so the restrictive
 * country policy refuses the row (HTTP 403). These helpers make sure only a
 * single, known country name ever reaches the column.
 */

/** One clean country name, or null. An array is only accepted when it holds exactly one value. */
export function normaliseRecallCountry(value) {
  if (Array.isArray(value)) {
    const clean = value.map(v => normaliseRecallCountry(v)).filter(Boolean)
    return clean.length === 1 ? clean[0] : null
  }
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v || v.toLowerCase() === 'all') return null
  // A stored JSON array string (the old defect) is never a country.
  if (v.startsWith('[') || v.startsWith('{')) return null
  return v
}

/** Countries the user may file a recall under: their allowed context, else the full list. */
export function recallCountryChoices(allowedContext, allCountries = []) {
  const fromContext = (Array.isArray(allowedContext) ? allowedContext : [])
    .map(n => normaliseRecallCountry(n?.country))
    .filter(Boolean)
  const list = fromContext.length ? fromContext : allCountries.map(normaliseRecallCountry).filter(Boolean)
  return [...new Set(list)]
}

/**
 * Decide the country for a recall being saved.
 * Order: what the form holds, the active country (when not "All"), the only allowed country.
 * Returns { country, needsChoice }. needsChoice is true when the user must pick one.
 */
export function resolveRecallCountry({ formCountry, activeCountry, choices = [] } = {}) {
  const pick = (v) => {
    const c = normaliseRecallCountry(v)
    if (!c) return null
    if (!choices.length) return c
    return choices.find(x => x.toLowerCase() === c.toLowerCase()) ?? null
  }
  const country = pick(formCountry) ?? pick(activeCountry) ?? (choices.length === 1 ? choices[0] : null)
  return { country, needsChoice: !country }
}
