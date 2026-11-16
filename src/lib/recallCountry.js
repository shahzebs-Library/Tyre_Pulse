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

/**
 * Which countries this profile may WRITE a recall under. Mirrors the database
 * write policy `recalls_country_write` exactly:
 *   - a super admin passes for every country;
 *   - a country list holding the 'all' sentinel passes for every country;
 *   - otherwise only the countries in profiles.country (compared lower + trimmed).
 * A plain Admin is NOT exempt in the database, so it is not exempt here either.
 * (The working-context picker treats a plain Admin as seeing every country, which
 * is why it offered countries the save then refused with a 403.)
 *
 * Returns { all: true } or { all: false, countries: [...] }. Returns null when
 * the profile has not loaded yet, so callers keep the old behaviour meanwhile.
 */
export function recallWritableCountries(profile) {
  if (!profile) return null
  if (profile.is_super_admin === true) return { all: true, countries: [] }
  const raw = Array.isArray(profile.country) ? profile.country : [profile.country]
  const seen = new Set()
  const countries = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (!t) continue
    if (t.toLowerCase() === 'all') return { all: true, countries: [] }
    if (seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    countries.push(t)
  }
  return { all: false, countries }
}

/**
 * Countries the user may file a recall under: their allowed context, else the
 * full list, then narrowed to what the database will accept for this profile.
 * Without a profile the narrowing is skipped (backwards compatible).
 */
export function recallCountryChoices(allowedContext, allCountries = [], profile) {
  const fromContext = (Array.isArray(allowedContext) ? allowedContext : [])
    .map(n => normaliseRecallCountry(n?.country))
    .filter(Boolean)
  const list = [...new Set(fromContext.length ? fromContext : allCountries.map(normaliseRecallCountry).filter(Boolean))]
  const writable = recallWritableCountries(profile)
  if (!writable || writable.all) return list
  const allowed = new Set(writable.countries.map(c => c.toLowerCase()))
  const narrowed = list.filter(c => allowed.has(c.toLowerCase()))
  if (narrowed.length) return narrowed
  // The register does not name the user's countries: offer the profile's own.
  return writable.countries.map(normaliseRecallCountry).filter(Boolean)
}

/** True when a signed-in, non-super profile holds no country, so no recall country can be saved. */
export function recallHasNoWritableCountry(profile) {
  const w = recallWritableCountries(profile)
  return !!w && !w.all && w.countries.length === 0
}

/**
 * Decide the country for a recall being saved.
 * Order: what the form holds, the active country (when not "All"), the only allowed country.
 * Returns { country, needsChoice }. needsChoice is true when the user must pick one.
 *
 * A form that already NAMES a country the user cannot save under (editing a recall
 * filed under another country) is never quietly moved to the user's own country:
 * it returns needsChoice with `outOfScope` set to that country, so the page can say
 * so. Only an EMPTY form value falls back to the active / only country.
 */
export function resolveRecallCountry({ formCountry, activeCountry, choices = [] } = {}) {
  const pick = (v) => {
    const c = normaliseRecallCountry(v)
    if (!c) return null
    if (!choices.length) return c
    return choices.find(x => x.toLowerCase() === c.toLowerCase()) ?? null
  }
  const named = normaliseRecallCountry(formCountry)
  if (named && !pick(named)) return { country: null, needsChoice: true, outOfScope: named }
  const country = pick(formCountry) ?? pick(activeCountry) ?? (choices.length === 1 ? choices[0] : null)
  return { country, needsChoice: !country }
}
