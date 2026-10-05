/**
 * Custom Data Manager view engine - pure shaping for the rebuilt /custom-data
 * page. Sources: get_extra_field_stats (per custom key: record_count and up to
 * a few sample values), field_synonyms (the permanent column mappings) and
 * import_batches (+ import_files) for the preservation and lineage table.
 *
 * Honest limits, stated rather than guessed: the stats carry samples, not every
 * distinct value, so the "looks like" type is read from the samples only; no
 * per-field quality score, source upload or confidence is stored, so none is
 * shown. No I/O.
 */
import { synonymIndex } from './customDataAnalytics'

const lower = (v) => String(v ?? '').trim().toLowerCase()
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null }

const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})([ T].*)?$/
const NUM_RE = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/

/** Type the samples look like: Number, Date, Text, or null when there are none. */
export function inferValueType(samples = []) {
  const vals = (samples || []).map((v) => String(v ?? '').trim()).filter(Boolean)
  if (!vals.length) return null
  if (vals.every((v) => NUM_RE.test(v))) return 'Number'
  if (vals.every((v) => DATE_RE.test(v))) return 'Date'
  return 'Text'
}

/** Registry rows: one per custom key, mapped state from the synonyms. */
export function registryRows(fieldStats = [], synonyms = []) {
  const idx = synonymIndex(synonyms)
  return (fieldStats || [])
    .filter((f) => f?.field_key)
    .map((f) => {
      const syn = idx.get(lower(f.field_key)) || null
      const samples = (f.sample_vals || []).filter((v) => v != null && String(v).trim() !== '')
      return {
        key: f.field_key,
        records: num(f.record_count) ?? 0,
        samples,
        type: inferValueType(samples),
        synonym: syn,
        mappedTo: syn?.maps_to || null,
        status: syn ? 'mapped' : 'unmapped',
      }
    })
    .sort((a, b) => b.records - a.records || a.key.localeCompare(b.key))
}

export function filterRegistry(rows = [], { search = '', status = 'all' } = {}) {
  const q = lower(search)
  return (rows || []).filter((r) => {
    if (q && !lower(r.key).includes(q) && !lower(r.mappedTo).includes(q)) return false
    if (status !== 'all' && r.status !== status) return false
    return true
  })
}

/** Lineage rows from import batches; imported share is null when the total is unknown. */
export function lineageRows(batches = []) {
  return (batches || []).map((b) => {
    const total = num(b.total_rows)
    const imported = num(b.imported_rows)
    const share = total && imported != null ? Math.round((imported / total) * 100) : null
    const conflicts = num(b.conflict_rows) ?? 0
    const errors = num(b.error_rows) ?? 0
    let tone = 'muted'; let label = b.import_status || b.approval_status || 'Not recorded'
    if (b.import_status === 'committed') {
      tone = conflicts || errors ? 'warn' : 'good'
      label = conflicts || errors ? 'Review' : 'Imported'
    } else if (b.import_status === 'failed') { tone = 'bad'; label = 'Failed' }
    else if (b.import_status === 'reversed') { tone = 'muted'; label = 'Undone' }
    else if (b.approval_status === 'rejected') { tone = 'muted'; label = 'Rejected' }
    else if (b.approval_status === 'draft' || b.import_status === 'staged') { tone = 'muted'; label = 'Never approved' }
    return {
      id: b.id,
      file: b.import_files?.original_filename || null,
      module: b.module || null,
      country: b.country || null,
      created: b.created_at || null,
      total, imported, share, conflicts, errors,
      skipped: num(b.skipped_rows) ?? 0,
      duplicates: num(b.duplicate_rows) ?? 0,
      tone, label,
    }
  })
}

/** Conflict total across batches; null when the batches could not be read. */
export function conflictTotal(batches) {
  if (!Array.isArray(batches)) return null
  return batches.reduce((s, b) => s + (num(b?.conflict_rows) ?? 0), 0)
}

/** Keep batches of the active country (and country-less ones), like applyCountry. */
export function scopeBatches(batches, country) {
  if (!Array.isArray(batches)) return batches
  if (!country || country === 'All') return batches
  return batches.filter((b) => !b.country || b.country === country)
}

/** Top-N bars by record count, each with its share of the largest. */
export function usageBars(rows = [], top = 12) {
  const list = (rows || []).slice().sort((a, b) => b.records - a.records).slice(0, top)
  const max = Math.max(1, ...list.map((r) => r.records))
  return list.map((r) => ({ key: r.key, records: r.records, pct: Math.round((r.records / max) * 100), status: r.status }))
}
