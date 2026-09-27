/**
 * tyreAgeComplianceAnalytics - page-level analytics for Tyre Age Compliance.
 *
 * The banding, birth-date resolution and fleet KPIs live in the engine
 * `./tyreAgeCompliance` (assessFleet / assessTyre). This module only adds what
 * the page needs on top, without re-deriving any of that maths:
 *   - one filter predicate for the table, KPIs, charts and exports
 *   - scoped KPIs that HOLD OUT the status band, so the band tiles stay a
 *     target you can aim at instead of echoing the filter just picked
 *   - an age histogram, a date-source mix and a prioritised action list
 *   - export shaping
 *
 * No I/O, no React. `now` is injected.
 */
import {
  assessFleet, AGE_BAND_META, AGE_BANDS, DATE_SOURCE_META, DEFAULT_AGE_POLICY,
  NON_COMPLIANT_BANDS, serialOf, positionOf,
} from './tyreAgeCompliance'

export { AGE_BANDS, AGE_BAND_META, DATE_SOURCE_META, DEFAULT_AGE_POLICY, serialOf, positionOf }

export const DATE_SOURCES = Object.keys(DATE_SOURCE_META)
const lc = (v) => String(v ?? '').trim().toLowerCase()

/** Filter already-assessed rows. Pass `skipBand` to hold out the band filter. */
export function filterAssessed(rows = [], f = {}, { skipBand = false } = {}) {
  const q = lc(f.search)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!skipBand && f.band && f.band !== 'all' && r.ageBand !== f.band) return false
    if (f.site && r.site !== f.site) return false
    if (f.brand && r.brand !== f.brand) return false
    if (f.source && r.dateSource !== f.source) return false
    if (q) {
      const hay = [serialOf(r), r.asset_no, r.brand, r.size, r.site, positionOf(r)].map(lc).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Oldest first; undated tyres sort last. Returns a new array. */
export function sortByAge(rows = [], dir = 'desc') {
  const d = dir === 'asc' ? 1 : -1
  return [...(rows || [])].sort((a, b) => {
    if (a.ageYears == null && b.ageYears == null) return 0
    if (a.ageYears == null) return 1
    if (b.ageYears == null) return -1
    return (a.ageYears - b.ageYears) * d
  })
}

/**
 * Everything the page renders for a scope. `enriched` is the output of
 * assessFleet(...).rows; the scoped summary re-runs assessFleet on the
 * held-out set so KPIs and charts describe exactly what the filters select.
 */
export function buildAgeView(enriched = [], filters = {}, { now = Date.now(), policy = DEFAULT_AGE_POLICY } = {}) {
  const scope = filterAssessed(enriched, filters, { skipBand: true })
  const summary = assessFleet(scope, now, policy)
  const table = sortByAge(filterAssessed(enriched, filters))
  return { scope, summary, table }
}

/** Whole-year age buckets 0 to 7+, plus an Unknown bucket. */
export function ageHistogram(rows = []) {
  const labels = ['0-1', '1-2', '2-3', '3-4', '4-5', '5-6', '6-7', '7+', 'Unknown']
  const counts = new Array(labels.length).fill(0)
  for (const r of rows || []) {
    if (typeof r.ageYears !== 'number') { counts[8] += 1; continue }
    counts[Math.min(7, Math.floor(r.ageYears))] += 1
  }
  return labels.map((label, i) => ({ label, count: counts[i] }))
}

/** How each tyre's birth date was established (data-quality view). */
export function dateSourceMix(rows = []) {
  const m = new Map(DATE_SOURCES.map((k) => [k, 0]))
  for (const r of rows || []) m.set(r.dateSource || 'unknown', (m.get(r.dateSource || 'unknown') || 0) + 1)
  return DATE_SOURCES
    .map((k) => ({ key: k, label: DATE_SOURCE_META[k].label, estimated: DATE_SOURCE_META[k].estimated, count: m.get(k) || 0 }))
    .filter((x) => x.count > 0)
}

/** Non-compliant tyres, oldest first: the removal worklist. */
export function actionList(rows = [], limit = 10) {
  return sortByAge((rows || []).filter((r) => NON_COMPLIANT_BANDS.includes(r.ageBand))).slice(0, limit)
}

export const EXPORT_COLS = ['serial', 'asset_no', 'brand', 'size', 'position', 'site', 'ageYears', 'band', 'birthDate', 'dateSource']
export const EXPORT_HEADERS = ['Serial', 'Asset', 'Brand', 'Size', 'Position', 'Site', 'Age (yrs)', 'Status', 'Birth date', 'Date source']

export function ageExportRows(rows = []) {
  return (rows || []).map((r) => ({
    serial: serialOf(r) || 'N/A',
    asset_no: r.asset_no || 'N/A',
    brand: r.brand || 'N/A',
    size: r.size || 'N/A',
    position: positionOf(r) || 'N/A',
    site: r.site || 'N/A',
    ageYears: r.ageYears ?? 'N/A',
    band: AGE_BAND_META[r.ageBand]?.label || 'N/A',
    birthDate: r.birthDate || 'N/A',
    dateSource: DATE_SOURCE_META[r.dateSource]?.label || 'N/A',
  }))
}
