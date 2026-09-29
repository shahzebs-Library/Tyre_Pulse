/**
 * combinationsAnalytics - pure page-side logic for /combinations (the
 * Combination Manager). Zero I/O, framework-free.
 *
 * The combination maths itself (trailer parsing, registry summary, member
 * resolution, the combined-unit CPK rollup, duplicate-trailer detection) lives
 * in src/lib/combinations.js and is REUSED here, never re-derived. This module
 * only owns what the page used to compute inline: filtering, the KPI strip,
 * option lists, the export shape and the honest ratios on the rollup.
 *
 * Honesty rules: a ratio with no denominator is null (rendered "N/A"), never a
 * fabricated 0.
 */
import { parseTrailerList, summarizeCombinations, detectDuplicateTrailers } from './combinations'
import { sortRows } from './consoleTable'

export const POSITION_LABELS = {
  steer: 'Steer', drive: 'Drive', trailer: 'Trailer', other: 'Other / Unclassified',
}

const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10)

/** The text a registry search matches against. */
export function combinationSearchText(r) {
  if (!r) return ''
  return [r.name, r.prime_mover_no, ...parseTrailerList(r.trailer_nos), r.site, r.notes]
    .filter(Boolean).join(' ').toLowerCase()
}

/**
 * Filter the registry. `status` 'all' | a status token; `site` '' | a site;
 * `trailers` 'all' | 'with' | 'without'; `search` free text.
 */
export function filterCombinations(rows = [], { status = 'all', site = '', trailers = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r) return false
    if (status !== 'all' && (r.status || 'inactive') !== status) return false
    if (site && r.site !== site) return false
    const n = parseTrailerList(r.trailer_nos).length
    if (trailers === 'with' && n === 0) return false
    if (trailers === 'without' && n > 0) return false
    if (q && !combinationSearchText(r).includes(q)) return false
    return true
  })
}

/** Distinct, sorted site names carried by the registry. */
export function siteOptions(rows = []) {
  return [...new Set((rows || []).map((r) => r?.site).filter(Boolean))].sort()
}

/**
 * KPI strip for the registry. Extends summarizeCombinations with the checks an
 * operator acts on: combinations with no trailer linked, trailers double-booked
 * across ACTIVE units, and the average trailers per unit (null when empty).
 */
export function combinationKpis(rows = []) {
  const list = (rows || []).filter(Boolean)
  const base = summarizeCombinations(list)
  const withoutTrailer = list.filter((r) => parseTrailerList(r.trailer_nos).length === 0).length
  const duplicates = detectDuplicateTrailers(list)
  const sites = new Set(list.map((r) => r.site).filter(Boolean)).size
  return {
    ...base,
    withoutTrailer,
    duplicateTrailers: duplicates.length,
    sites,
    avgTrailersPerUnit: base.total > 0 ? round1(base.trailers / base.total) : null,
    activePct: base.total > 0 ? round1((base.active / base.total) * 100) : null,
  }
}

/** A registry row decorated with the derived columns the table sorts on. */
export function registryRow(r) {
  const trailers = parseTrailerList(r?.trailer_nos)
  return { ...r, trailers, trailerCount: trailers.length }
}

export const COMBINATION_EXPORT_COLUMNS = [
  { key: 'combination_no', header: 'Combination No' },
  { key: 'name', header: 'Name' },
  { key: 'prime_mover_no', header: 'Prime Mover' },
  { key: 'trailers', header: 'Trailers' },
  { key: 'trailer_count', header: 'Trailer Count' },
  { key: 'combination_type', header: 'Type' },
  { key: 'axle_config', header: 'Axle Config' },
  { key: 'tyre_config', header: 'Tyre Config' },
  { key: 'max_load_tonnes', header: 'Max Load (t)' },
  { key: 'site', header: 'Site' },
  { key: 'status', header: 'Status' },
  { key: 'notes', header: 'Notes' },
]

/** Export shape; blanks read "N/A" so an empty cell is never mistaken for zero. */
export function combinationExportRows(rows = []) {
  return (rows || []).filter(Boolean).map((r) => {
    const trailers = parseTrailerList(r.trailer_nos)
    const tc = r.tyre_config && typeof r.tyre_config === 'object' ? r.tyre_config : {}
    const tyreParts = [['steer', 'Steer'], ['drive', 'Drive'], ['trailer', 'Trailer']]
      .filter(([k]) => Number.isFinite(Number(tc[k])) && tc[k] !== null && tc[k] !== '')
      .map(([k, l]) => `${l} ${Number(tc[k])}`)
    return {
      combination_no: r.combination_no || 'N/A',
      name: r.name || 'N/A',
      prime_mover_no: r.prime_mover_no || 'N/A',
      trailers: trailers.length ? trailers.join(', ') : 'N/A',
      trailer_count: trailers.length,
      combination_type: r.combination_type || 'N/A',
      axle_config: r.axle_config || 'N/A',
      tyre_config: tyreParts.length ? tyreParts.join(', ') : 'N/A',
      max_load_tonnes: r.max_load_tonnes == null ? 'N/A' : Number(r.max_load_tonnes),
      site: r.site || 'N/A',
      status: r.status === 'under_review' ? 'Under review' : (r.status || 'inactive'),
      notes: r.notes || '',
    }
  })
}

/** Scrap share of a rollup (scrapped / (fitted + scrapped)); null when nothing recorded. */
export function scrapSharePct(rollup) {
  if (!rollup) return null
  const fitted = Number(rollup.fittedTyres) || 0
  const scrap = Number(rollup.scrapTyres) || 0
  const denom = fitted + scrap
  return denom > 0 ? Math.round((scrap / denom) * 100) : null
}

/** Position breakdown rows with a label and spend share (null when no spend). */
export function positionRows(rollup) {
  const list = Array.isArray(rollup?.positionBreakdown) ? rollup.positionBreakdown : []
  const total = list.reduce((s, p) => s + (Number(p.spend) || 0), 0)
  const rows = list.map((p) => ({
    ...p,
    label: POSITION_LABELS[p.positionClass] || p.positionClass,
    spendSharePct: total > 0 ? round1(((Number(p.spend) || 0) / total) * 100) : null,
  }))
  return sortRows(rows, { key: 'spend', dir: 'desc' })
}

/** Member-resolution headline: resolved / total, null pct when there are no members. */
export function memberCoverage(rollup) {
  const total = Array.isArray(rollup?.members) ? rollup.members.length : 0
  const resolved = Number(rollup?.resolution?.resolvedCount) || 0
  return { total, resolved, pct: total > 0 ? Math.round((resolved / total) * 100) : null }
}
