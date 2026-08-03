/**
 * tyreLearning.js - PURE helpers for the Tyre Data Learning layer (V471).
 *
 * The learning model: a human CONFIRMS a fact once (this serial is brand X, or
 * the raw token "TRAINGLE" means "TRIANGLE") and the server (a) fills every
 * matching CURRENT row and (b) auto-applies it to FUTURE inserts/updates via a
 * BEFORE trigger. These pure helpers normalize tokens and shape suggestions; the
 * service (src/lib/api/tyreLearning.js) calls the RPCs.
 *
 * ASCII only; honest (a rejected/blank token returns null, never a fabricated
 * value). NEVER touches cost.
 */

export const MATCH_TYPES = {
  serial: 'By serial number',
  alias: 'Normalize a brand spelling',
}
export const TARGET_FIELDS = {
  brand: 'Brand',
  size: 'Size',
  removal_reason: 'Removal reason',
}

// Fields the server can serial-recover a suggestion for. removal_reason is
// normalize-only (there is no serial-recoverable source for it).
export const SUGGESTABLE_FIELDS = ['brand', 'size']

// Tokens the master files use as a blank placeholder (V468 rule) - never a value.
const BLANK_TOKENS = new Set(['', 'NULL', 'N/A', 'NA', '-', 'NONE', 'UNKNOWN'])

/**
 * Clean a raw brand token: strip tabs/newlines, collapse spaces, uppercase, and
 * reject the master files' literal blank placeholders. Returns null when the
 * token carries no real value.
 */
export function normalizeBrandToken(raw) {
  if (raw == null) return null
  const s = String(raw).replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
  if (BLANK_TOKENS.has(s)) return null
  return s
}

/** True when a value is a real, non-placeholder string. */
export function hasValue(v) {
  return normalizeBrandToken(v) != null
}

export const SOURCE_LABEL = {
  self: 'Recovered from another row of the same serial',
  master: 'Found in the master upload',
  manual: 'Confirmed manually',
}

/**
 * Normalize the suggestions array from tyre_learn_suggestions into display rows,
 * dropping any whose suggested value does not survive cleaning (honest).
 * The suggested value is a generic token (brand or size); `brand` is kept as a
 * back-compat alias of `value`.
 * @returns {Array<{serialKey,serialNo,country,rows,value,brand,source,sourceLabel}>}
 */
export function shapeSuggestions(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => {
      const value = normalizeBrandToken(r.suggested_value ?? r.suggested_brand ?? r.value)
      if (!value) return null
      return {
        serialKey: r.serial_key ?? r.serialKey ?? '',
        serialNo: r.serial_no ?? r.serialNo ?? r.serial_key ?? '',
        country: r.country ?? null,
        rows: Number(r.rows) || 0,
        value,
        brand: value,
        source: r.source || 'master',
        sourceLabel: SOURCE_LABEL[r.source] || 'Suggested',
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.rows - a.rows)
}

/** Round a percentage honestly (null when the denominator is 0). */
function pctOf(part, total) {
  const t = Number(total) || 0
  if (t <= 0) return null
  return Math.round((Number(part) || 0) / t * 100)
}

/**
 * Shape get_tyre_gap_overview into display rows. pct = filled percentage
 * ((total-blank)/total), honestly null when total is 0.
 * @returns {Array<{field,label,total,blank,recoverable,pct}>}
 */
export function shapeGapOverview(json) {
  if (!json || json.ok !== true || !Array.isArray(json.fields)) return []
  return json.fields.map((f) => {
    const total = Number(f.total) || 0
    const blank = Number(f.blank) || 0
    return {
      field: f.field,
      label: f.label ?? TARGET_FIELDS[f.field] ?? f.field,
      total,
      blank,
      recoverable: f.recoverable == null ? null : Number(f.recoverable) || 0,
      pct: pctOf(total - blank, total),
    }
  })
}

/**
 * Shape get_master_file_completeness into a per-column report sorted by ord.
 * pct = filled/total (null on zero total); blank = total - filled.
 * @returns {{total,columns:Array<{column,filled,blank,pct}>}}
 */
export function shapeMasterCompleteness(json) {
  if (!json || json.ok !== true || !Array.isArray(json.columns)) return { total: 0, columns: [] }
  const total = Number(json.total) || 0
  const columns = json.columns
    .slice()
    .sort((a, b) => (Number(a.ord) || 0) - (Number(b.ord) || 0))
    .map((c) => {
      const filled = Number(c.filled) || 0
      return {
        column: c.column,
        filled,
        blank: total - filled,
        pct: pctOf(filled, total),
      }
    })
  return { total, columns }
}

/** Summary tiles for the suggestions set. */
export function suggestionSummary(shaped) {
  const rows = Array.isArray(shaped) ? shaped : []
  return {
    serials: rows.length,
    rows: rows.reduce((s, r) => s + (r.rows || 0), 0),
    fromSelf: rows.filter((r) => r.source === 'self').length,
    fromMaster: rows.filter((r) => r.source === 'master').length,
  }
}
