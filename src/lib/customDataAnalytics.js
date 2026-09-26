/**
 * Custom Data analytics - pure helpers for `src/pages/CustomData.jsx`.
 *
 * Custom data is every uploaded column that did not match a standard field; it
 * lands in tyre_records.extra_fields. This module rolls up the per-key stats
 * the page reads (get_extra_field_stats) against the permanent synonyms, and
 * flattens rows for export. No I/O, no clock.
 */

const lower = (v) => String(v ?? '').trim().toLowerCase()
const n = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** custom_name (lower-cased) -> synonym row. */
export function synonymIndex(synonyms = []) {
  const m = new Map()
  for (const s of synonyms || []) if (s?.custom_name) m.set(lower(s.custom_name), s)
  return m
}

/**
 * Headline figures. `fieldValues` is the sum of per-key counts, i.e. how many
 * custom values were captured - it is NOT a record count, because one record
 * can carry several custom keys. The distinct record count comes from a server
 * count and is passed through untouched (null when unknown).
 */
export function summarizeCustomData({ fieldStats = [], synonyms = [], recordCount = null } = {}) {
  const idx = synonymIndex(synonyms)
  let mapped = 0
  let fieldValues = 0
  for (const f of fieldStats || []) {
    fieldValues += n(f?.record_count)
    if (idx.has(lower(f?.field_key))) mapped += 1
  }
  const uniqueFields = (fieldStats || []).length
  return {
    uniqueFields,
    mappedFields: mapped,
    unmappedFields: uniqueFields - mapped,
    mappedShare: uniqueFields ? mapped / uniqueFields : null,
    fieldValues,
    recordCount: recordCount == null ? null : n(recordCount),
    synonyms: (synonyms || []).length,
    autoMapped: (synonyms || []).reduce((s, x) => s + n(x?.use_count), 0),
  }
}

/** Filter field stats by search text and mapping state ('all'|'mapped'|'unmapped'). */
export function filterFieldStats(fieldStats = [], { search = '', mapping = 'all', synonyms = [] } = {}) {
  const q = lower(search)
  const idx = synonymIndex(synonyms)
  return (fieldStats || []).filter((f) => {
    const key = lower(f?.field_key)
    if (q && !key.includes(q)) return false
    if (mapping === 'mapped') return idx.has(key)
    if (mapping === 'unmapped') return !idx.has(key)
    return true
  })
}

/** Filter synonyms by text on the column name or target field. */
export function filterSynonyms(synonyms = [], search = '') {
  const q = lower(search)
  if (!q) return synonyms || []
  return (synonyms || []).filter((s) => lower(s?.custom_name).includes(q) || lower(s?.maps_to).includes(q))
}

export const EXPORT_BASE_COLUMNS = Object.freeze(['id', 'asset_no', 'serial_no', 'issue_date', 'site', 'brand', 'country'])

/**
 * Flatten records for export: the standard columns followed by every custom key
 * seen across the set, in first-seen order. A missing custom value is ''.
 */
export function flattenForExport(records = []) {
  const keys = []
  const seen = new Set()
  for (const r of records || []) {
    for (const k of Object.keys(r?.extra_fields || {})) if (!seen.has(k)) { seen.add(k); keys.push(k) }
  }
  const rows = (records || []).map((r) => {
    const out = {}
    for (const c of EXPORT_BASE_COLUMNS) out[c] = r?.[c] ?? ''
    for (const k of keys) out[`x_${k}`] = r?.extra_fields?.[k] ?? ''
    return out
  })
  return {
    rows,
    columns: [...EXPORT_BASE_COLUMNS, ...keys.map((k) => `x_${k}`)],
    headers: [...EXPORT_BASE_COLUMNS, ...keys],
  }
}

/** Page count for a server-paged list; 0 when nothing is there. */
export function pageCount(total, pageSize) {
  const t = n(total), p = n(pageSize)
  return p > 0 ? Math.ceil(t / p) : 0
}
