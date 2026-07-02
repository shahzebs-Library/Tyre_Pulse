/**
 * Import Center - master-data alias rewriting (directive Section 9).
 *
 * Pure, network-free helpers that normalise inconsistent master-data spellings
 * (e.g. "Qiddiya-1" / "QD G1" → "Qiddiya G1", "Bridge Stone" → "Bridgestone")
 * to canonical values during import. Unmatched values pass through EXACTLY as-is
 * - aliases never auto-create master records and never blank a value.
 *
 * A caller loads the org/country aliases once (imports.listAliases), builds an
 * O(1) lookup map per entity_type with buildAliasMap, then rewrites rows with
 * applyAliases - no per-row round-trips.
 *
 * @module import/aliases
 */

import { normaliseToken } from './synonyms.js'

/**
 * Build an O(1) lookup Map keyed by the normalised raw value.
 * @param {Array<{raw_value:string, canonical_value:string, canonical_id?:string}>} aliases
 * @returns {Map<string,{canonical_value:string, canonical_id:string|null}>}
 */
export function buildAliasMap(aliases = []) {
  const map = new Map()
  for (const a of aliases) {
    if (!a || a.raw_value == null || a.canonical_value == null) continue
    const key = normaliseToken(a.raw_value)
    if (!key) continue
    if (!map.has(key)) map.set(key, { canonical_value: a.canonical_value, canonical_id: a.canonical_id ?? null })
  }
  return map
}

/**
 * Rewrite one field on a row to its canonical value when an alias matches.
 * Returns a NEW object only when a rewrite happens; otherwise the same ref.
 * @param {Record<string,*>} row
 * @param {string} field
 * @param {Map<string,{canonical_value:string}>} aliasMap
 * @returns {Record<string,*>}
 */
export function applyAliasesToRow(row, field, aliasMap) {
  if (!row || !aliasMap || row[field] == null || row[field] === '') return row
  const hit = aliasMap.get(normaliseToken(row[field]))
  if (!hit) return row
  if (String(row[field]) === String(hit.canonical_value)) return row
  return { ...row, [field]: hit.canonical_value }
}

/**
 * Rewrite `field` across an array of rows. Returns a NEW array; never mutates
 * inputs; unmatched / blank values are left untouched.
 * @param {Array<Record<string,*>>} rows
 * @param {string} field
 * @param {Map<string,{canonical_value:string}>} aliasMap
 * @returns {Array<Record<string,*>>}
 */
export function applyAliases(rows = [], field, aliasMap) {
  if (!aliasMap || aliasMap.size === 0) return Array.isArray(rows) ? rows.slice() : []
  return (rows || []).map((r) => applyAliasesToRow(r, field, aliasMap))
}
