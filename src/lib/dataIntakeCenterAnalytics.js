/**
 * dataIntakeCenterAnalytics - pure helpers behind src/pages/DataIntakeCenter.jsx
 * (the single import wizard: upload -> map -> validate -> approve/commit).
 *
 * No I/O, deterministic. Nothing here changes import semantics: the live-copy
 * comparison (`isExactLiveMatch`) was moved out of the page verbatim so it can
 * be tested; staging and commit still run through lib/api/imports.
 *
 * Honesty rules:
 *   - A figure that was never recorded is null (renders N/A), never 0.
 *   - The recent-imports strip states how many batches it covers; it is a
 *     window of the latest uploads, not all history.
 *   - Batch outcome is NOT re-derived here: it comes from
 *     dataIntakeHistoryAnalytics (importRowOutcome), the one place that decides
 *     what "0 imported" means.
 */
import { MODULE_FIELDS } from './import'
import { enrichBatches, summarizeIntake } from './dataIntakeHistoryAnalytics'

const NUMERIC_TYPES = ['number', 'integer', 'currency', 'pressure', 'distance', 'mass']

export function hasValue(v) {
  return v != null && String(v).trim() !== ''
}

/** Normalise a value for an equality test, by field type. */
export function comparableValue(v, type) {
  if (!hasValue(v)) return ''
  if (NUMERIC_TYPES.includes(type)) {
    const n = Number(String(v).replace(/,/g, ''))
    return Number.isFinite(n) ? String(n) : String(v).trim().toLowerCase()
  }
  if (type === 'date') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? String(v).trim().toLowerCase() : d.toISOString().slice(0, 10)
  }
  return String(v).trim().toLowerCase()
}

/**
 * True when every field the upload actually supplied (including an explicitly
 * blank cell) equals the live record. Fields absent from the file are not
 * evidence that the live record differs.
 */
export function isExactLiveMatch(transformed, live, module, fieldsByModule = MODULE_FIELDS) {
  if (!transformed || !live) return false
  const fields = fieldsByModule[module] || []
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(transformed, f.key)) continue
    if (comparableValue(transformed[f.key], f.type) !== comparableValue(live[f.key], f.type)) return false
  }
  return true
}

// ── Mapping step ─────────────────────────────────────────────────────────────

/** One row per source column with its first non-blank sample value. */
export function mappingRows(mapping = [], sheetRows = []) {
  return (mapping || []).map((m) => {
    const hit = (sheetRows || []).find((r) => r && hasValue(r[m.sourceHeader]))
    return { ...m, id: m.sourceHeader, sample: hit ? String(hit[m.sourceHeader]) : '' }
  })
}

/**
 * Mapping coverage: how many columns map to a field, how many are kept as
 * custom, and which REQUIRED module fields no column maps to yet.
 */
export function mappingSummary(mapping = [], targetOptions = []) {
  const mappedTargets = new Set((mapping || []).map((m) => m.target).filter(Boolean))
  const required = (targetOptions || []).filter((t) => t.required)
  const missingRequired = required.filter((t) => !mappedTargets.has(t.key)).map((t) => t.label || t.key)
  const mapped = (mapping || []).filter((m) => m.target).length
  const lowConfidence = (mapping || []).filter((m) => m.target && Number(m.confidence) < 60).length
  return {
    columns: (mapping || []).length,
    mapped,
    custom: (mapping || []).length - mapped,
    lowConfidence,
    requiredTotal: required.length,
    missingRequired,
  }
}

export function confidenceBand(m) {
  if (!m?.target) return { label: 'Custom', tone: 'quiet' }
  const c = Number(m.confidence)
  if (!Number.isFinite(c)) return { label: 'Manual', tone: 'quiet' }
  if (c >= 90) return { label: `${c}% high`, tone: 'good' }
  if (c >= 60) return { label: `${c}% medium`, tone: 'warning' }
  return { label: `${c}% low`, tone: 'danger' }
}

// ── Validate step ────────────────────────────────────────────────────────────

/** Plain-language duplicate state for a staged row. */
export function dupLabel(r) {
  if (!r) return 'None'
  if (r.liveDuplicate) return 'Exact live copy'
  if (r.dupStatus === 'duplicate') return 'Exact copy in file'
  if (r.dupStatus === 'conflict') return 'Key conflict'
  return 'None'
}

/** All issue messages for a row, or a clear "None". */
export function issuesText(r) {
  const msgs = (r?.issues || []).map((i) => i?.message).filter(Boolean)
  return msgs.length ? msgs.join('; ') : 'None'
}

// ── Evidence package (accident) ──────────────────────────────────────────────

export function attachmentSummary(items = []) {
  const list = Array.isArray(items) ? items : []
  return {
    total: list.length,
    uploaded: list.filter((i) => i.status === 'uploaded').length,
    matched: list.filter((i) => i.matchedBy).length,
    failed: list.filter((i) => i.status === 'failed').length,
  }
}

export function matchedByLabel(matchedBy) {
  if (!matchedBy) return 'Unmatched'
  if (matchedBy === 'claim_no') return 'Claim no'
  if (matchedBy === 'police_report_no') return 'Police report'
  if (matchedBy === 'asset_no') return 'Asset no'
  return String(matchedBy)
}

/** Size in KB, or N/A when unknown. */
export function fileSizeLabel(bytes) {
  const n = Number(bytes)
  if (bytes == null || !Number.isFinite(n) || n <= 0) return 'N/A'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024)).toLocaleString()} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ── Recent imports strip ─────────────────────────────────────────────────────

/**
 * KPI strip over the latest batches and uploaded files. Reuses the history
 * engine for outcome + row totals so the two pages can never disagree.
 */
export function recentImportsKpis(batches = [], files = [], { now } = {}) {
  const enriched = enrichBatches(batches, [], { now })
  const s = summarizeIntake(enriched)
  const times = enriched.map((b) => new Date(b.created_at).getTime()).filter(Number.isFinite)
  return {
    batches: s.total,
    imported: s.byOutcome.done,
    unfinished: s.byOutcome.unfinished,
    undone: s.byOutcome.undone,
    nothing: s.byOutcome.nothing,
    rowsRead: s.rowsRead,
    rowsImported: s.rowsImported,
    importRate: s.importRate,
    staleUnfinished: s.staleUnfinished,
    orphanFiles: (files || []).filter((f) => f?.orphan).length,
    lastImportAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  }
}

/** Enriched batches (outcome + label) for the recent-imports table. */
export function recentImportRows(batches = [], { now } = {}) {
  return enrichBatches(batches, [], { now })
}
