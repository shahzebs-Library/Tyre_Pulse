/**
 * Import Center - granularity / "wrong module" heuristic.
 *
 * When an uploaded file has a very high duplicate ratio against the module's
 * NATURAL KEY, the file is almost always at a FINER granularity than the module
 * expects (e.g. a parts-consumption ledger with many line-items per work order
 * imported as Work Orders). Committing it would collapse/discard the line detail
 * onto a handful of existing keys.
 *
 * This module exposes pure, testable helpers the wizard uses to raise a
 * NON-BLOCKING warning on the Validate step. It intentionally lives outside
 * validate.js so the row-grading engine stays untouched.
 *
 * @module import/granularity
 */

import { MODULE_FIELDS } from './synonyms.js'

/**
 * Default ratio above which a file is deemed likely mis-targeted.
 * 0.6 (60%) of keyed rows collapsing to an existing key is the trigger.
 */
export const WRONG_MODULE_THRESHOLD = 0.6

/**
 * Natural-key field lists per module - kept in lockstep with the NATURAL_KEY
 * extractors in validate.js. Used only to render a human-readable key label;
 * the actual keying is done by validate.naturalKey().
 * @type {Record<string, string[]>}
 */
const NATURAL_KEY_FIELDS = {
  fleet: ['country', 'asset_no'],
  tyre: ['country', 'serial_no'],
  stock: ['country', 'site', 'description'],
  accident: ['country', 'insurance_claim_no'],
  inspection: ['country', 'asset_no', 'inspection_type', 'inspection_date', 'inspector'],
  workorder: ['country', 'work_order_no'],
  warranty: ['country', 'serial_number', 'claim_no'],
  gatepass: ['country', 'asset_no', 'pass_date'],
  supplier: ['country', 'supplier_code'],
  driver: ['country', 'driver_id'],
}

/** Prettify a field key when no MODULE_FIELDS label exists. */
function prettify(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\bno\b/i, 'No.')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Human-readable description of a module's natural key, e.g.
 *   workorder → "Country + Work Order No."
 * Returns null when the module has no meaningful natural key.
 *
 * @param {string} module
 * @returns {string|null}
 */
export function naturalKeyLabel(module) {
  const keys = NATURAL_KEY_FIELDS[module]
  if (!keys || keys.length === 0) return null
  const fields = MODULE_FIELDS[module] || []
  const labelByKey = new Map(fields.map((f) => [f.key, f.label]))
  return keys.map((k) => labelByKey.get(k) || prettify(k)).join(' + ')
}

/**
 * True when a module has a natural key worth checking against. Single-part keys
 * that are effectively just "country" carry no identifying component, so they
 * are treated as no-key (skip the warning).
 *
 * @param {string} module
 * @returns {boolean}
 */
export function hasNaturalKey(module) {
  const keys = NATURAL_KEY_FIELDS[module]
  if (!keys || keys.length === 0) return false
  // Needs at least one identifying component beyond the country scope.
  return keys.some((k) => k !== 'country')
}

/**
 * Fraction of KEYED rows that collapse onto an existing/repeated key
 * (in-batch duplicates + conflicts + already-live duplicates), out of the rows
 * that actually produced a usable natural key. Returns 0 when no rows are keyed.
 *
 * @param {{ duplicate?:number, conflict?:number, liveDuplicate?:number, keyed?:number }} counts
 * @returns {number} ratio in [0, 1]
 */
export function duplicateRatio(counts) {
  const c = counts || {}
  const keyed = Number(c.keyed) || 0
  if (keyed <= 0) return 0
  const collapsed =
    (Number(c.duplicate) || 0) + (Number(c.conflict) || 0) + (Number(c.liveDuplicate) || 0)
  const ratio = collapsed / keyed
  if (ratio < 0) return 0
  return ratio > 1 ? 1 : ratio
}

/**
 * Decide whether to show the "wrong module / finer granularity" warning.
 * Non-blocking: the caller still lets the user proceed.
 *
 * @param {{ duplicate?:number, conflict?:number, liveDuplicate?:number, keyed?:number }} counts
 * @param {string} module
 * @param {number} [threshold=WRONG_MODULE_THRESHOLD]
 * @returns {null | { ratio:number, pct:number, keyLabel:string, collapsed:number, keyed:number }}
 */
export function wrongModuleWarning(counts, module, threshold = WRONG_MODULE_THRESHOLD) {
  if (!hasNaturalKey(module)) return null
  const keyLabel = naturalKeyLabel(module)
  if (!keyLabel) return null
  const c = counts || {}
  const keyed = Number(c.keyed) || 0
  if (keyed <= 0) return null
  const ratio = duplicateRatio(c)
  if (ratio <= threshold) return null
  const collapsed =
    (Number(c.duplicate) || 0) + (Number(c.conflict) || 0) + (Number(c.liveDuplicate) || 0)
  return {
    ratio,
    pct: Math.round(ratio * 100),
    keyLabel,
    collapsed,
    keyed,
  }
}

export { NATURAL_KEY_FIELDS }
