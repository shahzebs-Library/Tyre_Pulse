/**
 * Advanced Search — pure, dependency-free domain logic for the Advanced /
 * Global Search module (/advanced-search). Provides the primitives that both
 * the service (`src/lib/api/advancedSearch.js`) and the page
 * (`src/pages/AdvancedSearch.jsx`) build on: term normalisation, row matching,
 * relevance ranking, and saved-search roll-ups.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and unit
 * tested, so the matching and scoring rules live in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Normalise a raw search term to a lowercased, trimmed string. Non-string
 * inputs (numbers, null, undefined) are coerced safely; null/undefined become
 * an empty string so callers never have to null-check.
 *
 * @param {*} s
 * @returns {string}
 */
export function normaliseTerm(s) {
  if (s == null) return ''
  return String(s).trim().toLowerCase()
}

/** Field value → comparable lowercased string ('' for null/undefined). */
function fieldString(v) {
  if (v == null) return ''
  return String(v).toLowerCase()
}

/**
 * True when any of the named string fields on `row` includes the normalised
 * `term`. An empty term matches nothing (avoids "everything matches" noise);
 * a missing/empty field simply never contributes a hit.
 *
 * @param {object} row
 * @param {string} term      raw term (normalised internally)
 * @param {string[]} fields  field names to test
 * @returns {boolean}
 */
export function matchesRow(row, term, fields = []) {
  const t = normaliseTerm(term)
  if (!t) return false
  if (!row || typeof row !== 'object') return false
  const list = Array.isArray(fields) ? fields : []
  for (const f of list) {
    if (fieldString(row[f]).includes(t)) return true
  }
  return false
}

/**
 * Count how many of the named fields on `row` contain the normalised term.
 * Used as the relevance score for ranking.
 *
 * @param {object} row
 * @param {string} term  already-normalised term
 * @param {string[]} fields
 * @returns {number}
 */
function fieldHits(row, term, fields) {
  if (!term || !row || typeof row !== 'object') return 0
  let hits = 0
  for (const f of fields) {
    if (fieldString(row[f]).includes(term)) hits++
  }
  return hits
}

/**
 * Rank rows by how many of the named fields contain the term. Rows with zero
 * hits are dropped; the remainder are sorted by hit count descending (a stable
 * sort preserves the original order among equal scores). Returns the matching
 * rows themselves (not wrappers) so the result is a filtered, ranked list.
 *
 * @param {Array<object>} rows
 * @param {string} term      raw term (normalised internally)
 * @param {string[]} fields
 * @returns {Array<object>}
 */
export function rankMatches(rows = [], term, fields = []) {
  const list = Array.isArray(rows) ? rows : []
  const t = normaliseTerm(term)
  const flds = Array.isArray(fields) ? fields : []
  if (!t) return []
  const scored = []
  for (let i = 0; i < list.length; i++) {
    const row = list[i]
    const score = fieldHits(row, t, flds)
    if (score > 0) scored.push({ row, score, idx: i })
  }
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
  return scored.map((s) => s.row)
}

/**
 * Summarise a set of saved-search rows for the KPI header:
 *   • totalSaved          — number of saved searches
 *   • pinnedCount         — how many are pinned
 *   • distinctEntities    — count of distinct entity values used
 *   • totalResultsIndexed — sum of last-known result_count across all searches
 *
 * @param {Array<object>} rows
 * @returns {{ totalSaved:number, pinnedCount:number,
 *             distinctEntities:number, totalResultsIndexed:number }}
 */
export function summariseSearches(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const entities = new Set()
  let pinnedCount = 0
  let totalResultsIndexed = 0

  for (const r of list) {
    if (r?.pinned === true) pinnedCount++
    const e = r?.entity != null ? String(r.entity).trim() : ''
    if (e) entities.add(e)
    const n = toFiniteNumber(r?.result_count)
    if (n != null && n > 0) totalResultsIndexed += n
  }

  return {
    totalSaved: list.length,
    pinnedCount,
    distinctEntities: entities.size,
    totalResultsIndexed,
  }
}

/**
 * Group saved searches by their `entity`, returning
 * `[{ entity, count }]` sorted by count descending (entity name ascending as a
 * stable tiebreaker). Rows without an entity are bucketed under 'all'.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ entity:string, count:number }>}
 */
export function groupByEntity(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = new Map()
  for (const r of list) {
    const e = (r?.entity != null && String(r.entity).trim()) || 'all'
    counts.set(e, (counts.get(e) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([entity, count]) => ({ entity, count }))
    .sort((a, b) => (b.count - a.count) || a.entity.localeCompare(b.entity))
}
