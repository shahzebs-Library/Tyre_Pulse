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
}

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
 * dropping any whose suggested brand does not survive cleaning (honest).
 * @returns {Array<{serialKey,serialNo,country,rows,brand,source,sourceLabel}>}
 */
export function shapeSuggestions(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => {
      const brand = normalizeBrandToken(r.suggested_brand)
      if (!brand) return null
      return {
        serialKey: r.serial_key ?? r.serialKey ?? '',
        serialNo: r.serial_no ?? r.serialNo ?? r.serial_key ?? '',
        country: r.country ?? null,
        rows: Number(r.rows) || 0,
        brand,
        source: r.source || 'master',
        sourceLabel: SOURCE_LABEL[r.source] || 'Suggested',
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.rows - a.rows)
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
