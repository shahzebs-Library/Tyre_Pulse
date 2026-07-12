/**
 * Tyre age compliance — pure helpers (no I/O) for the Tyre Age Compliance module
 * (ported from tyre_saas). GCC/RTA guidance treats tyres beyond ~5 years from
 * fitment as non-compliant and 3–5 years as "aging/advisory". Age is measured
 * from the tyre's fitment date, falling back to its issue date.
 *
 * These functions are unit-tested; the page and service consume them so the
 * banding logic lives in exactly one place.
 */

// Default thresholds in YEARS. Overridable from the page.
export const DEFAULT_AGE_THRESHOLDS = { advisory: 3, nonCompliant: 5 }

export const AGE_BANDS = ['non_compliant', 'advisory', 'compliant', 'unknown']

export const AGE_BAND_META = {
  non_compliant: { label: 'Non-compliant', tone: 'red' },
  advisory: { label: 'Advisory', tone: 'amber' },
  compliant: { label: 'Compliant', tone: 'green' },
  unknown: { label: 'No date', tone: 'slate' },
}

/** Parse a tyre record's effective age-anchor date (fitment → issue). */
export function tyreAgeDate(rec) {
  const raw = rec?.fitment_date || rec?.issue_date || null
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Age of a tyre in years (1 decimal) as of `asOf` (default: the injected now).
 * Returns null when there is no usable date. `asOf` is injectable so callers
 * pass a real clock (the module is pure and must not read Date.now itself in a
 * way that breaks determinism in tests — callers pass Date.now()).
 */
export function tyreAgeYears(rec, asOf) {
  const d = tyreAgeDate(rec)
  if (!d) return null
  const now = asOf instanceof Date ? asOf : new Date(asOf)
  if (Number.isNaN(now.getTime())) return null
  const years = (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000)
  if (years < 0) return 0
  return Math.round(years * 10) / 10
}

/** Band a tyre by age against thresholds. */
export function tyreAgeBand(rec, asOf, thresholds = DEFAULT_AGE_THRESHOLDS) {
  const years = tyreAgeYears(rec, asOf)
  if (years == null) return 'unknown'
  const t = { ...DEFAULT_AGE_THRESHOLDS, ...(thresholds || {}) }
  if (years > t.nonCompliant) return 'non_compliant'
  if (years >= t.advisory) return 'advisory'
  return 'compliant'
}

/**
 * Enrich a list of tyre records with { ageYears, ageBand } and return summary
 * counts + the enriched rows. `asOf` is the reference timestamp (ms or Date).
 */
export function summarizeTyreAges(records, asOf, thresholds = DEFAULT_AGE_THRESHOLDS) {
  const rows = (Array.isArray(records) ? records : []).map((r) => ({
    ...r,
    ageYears: tyreAgeYears(r, asOf),
    ageBand: tyreAgeBand(r, asOf, thresholds),
  }))
  const counts = { total: rows.length, non_compliant: 0, advisory: 0, compliant: 0, unknown: 0 }
  let ageSum = 0
  let ageN = 0
  for (const r of rows) {
    counts[r.ageBand] += 1
    if (typeof r.ageYears === 'number') { ageSum += r.ageYears; ageN += 1 }
  }
  const known = counts.total - counts.unknown
  const compliancePct = known > 0 ? Math.round((counts.compliant / known) * 100) : null
  const avgAge = ageN > 0 ? Math.round((ageSum / ageN) * 10) / 10 : null
  return { rows, counts, compliancePct, avgAge }
}
