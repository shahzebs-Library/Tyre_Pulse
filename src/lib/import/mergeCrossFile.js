/**
 * Import Center - cross-file merge (cost-of-record wins).
 *
 * Some business records are described across MORE THAN ONE source file. The
 * canonical Gulf example is a Job Card that appears in both:
 *   - "Vehicle Complaints History"  → the complaint / operational detail, but
 *     NO cost columns are ever written to cost fields (see docs/imports/README).
 *   - "Work Order Details"          → the COST OF RECORD (the qty-calculated
 *     `Trye` amount, summed per work order).
 *
 * Committing these 1:1 yields two rows for the same natural key, and the legacy
 * behaviour classifies the second as a duplicate and SKIPS it - so whichever
 * file lands second is silently discarded. The correct behaviour is a field
 * level MERGE where the file that carries the cost of record WINS:
 *
 *   1. The cost row's fields take precedence on conflict.
 *   2. Fields the cost row leaves blank are enriched from the other file(s).
 *   3. Cost fields are NEVER pulled from a non-cost file (the cost-of-record
 *      rule: cost lives in exactly one source), so a blank cost stays blank
 *      rather than being back-filled with a foreign amount.
 *   4. Every source line from every contributing file is preserved verbatim in
 *      custom_data.line_items (audit), and line_count / issues / worst
 *      validation status are rolled up.
 *
 * mergeCrossFileRows() is a PURE, deterministic function over annotated wizard
 * rows (the same shape aggregateStagedRows produces/consumes). It keys strictly
 * by the module's NATURAL KEY - the definitions in validate.js are the single
 * source of truth and are left unchanged. Rows without a usable key pass through
 * untouched and in place.
 *
 * Pipeline position: run AFTER aggregateStagedRows (per-file line-item collapse)
 * and BEFORE classifyDuplicates, so the batch presents ONE enriched record per
 * key and the live-dedup skip never fires for a cross-file pair.
 *
 * @module import/mergeCrossFile
 */

import { naturalKey } from './validate.js'

/**
 * Fields whose presence marks a row as the COST OF RECORD for its module. The
 * row carrying the most populated cost fields wins the merge; these fields are
 * also protected from back-fill by non-cost files. Kept deliberately narrow -
 * only genuine spend columns, never operational quantities.
 * @type {Record<string, string[]>}
 */
const COST_FIELDS = {
  workorder: ['tyre_cost', 'total_cost', 'parts_cost', 'labour_cost'],
  tyre: ['cost_per_tyre', 'line_total', 'amount_original'],
  warranty: ['credit_amount'],
  accident: ['claim_amount', 'claim_approved_amount', 'repair_cost'],
}

const STATUS_RANK = { error: 3, warning: 2, ready: 1 }

/** Empty if null/undefined/blank string. Zero and false are real values. */
function isEmpty(v) {
  return v == null || (typeof v === 'string' && v.trim() === '')
}

/** Number of populated cost fields on an annotated row's transformed view. */
function costScore(row, costFields) {
  const t = (row && row.transformed) || {}
  let n = 0
  for (const f of costFields) if (!isEmpty(t[f])) n += 1
  return n
}

/** Line items already captured on a row (per-file aggregation), else its raw. */
function lineItemsOf(row) {
  const c = (row && row.custom) || {}
  if (Array.isArray(c.line_items) && c.line_items.length) return c.line_items
  return row && row.raw != null ? [row.raw] : []
}

/**
 * Merge one group of 2+ annotated rows that share a natural key into a single
 * record, with the cost row winning on conflict and the others enriching blanks.
 * Never mutates its inputs.
 *
 * @param {Array<Object>} group
 * @param {string[]} costFields
 * @returns {Object} merged annotated row
 */
function mergeGroup(group, costFields) {
  // Pick the cost row: the one with the most populated cost fields. Ties (incl.
  // the "no file has cost" case) resolve to the first occurrence - deterministic.
  let costRow = group[0]
  let best = costScore(group[0], costFields)
  for (let i = 1; i < group.length; i += 1) {
    const s = costScore(group[i], costFields)
    if (s > best) { best = s; costRow = group[i] }
  }
  const costFieldSet = new Set(costFields)

  // Base = a shallow-cloned copy of the cost row so its fields win by default.
  const merged = {
    ...costRow,
    transformed: { ...costRow.transformed },
    mapped: { ...(costRow.mapped || {}) },
    custom: { ...(costRow.custom || {}) },
    issues: [...(costRow.issues || [])],
  }

  // Enrich from the other contributors: fill blanks the cost row left empty.
  for (const r of group) {
    if (r === costRow) continue
    const t = (r && r.transformed) || {}
    for (const [k, v] of Object.entries(t)) {
      // Cost fields are owned by the cost row - never back-filled from elsewhere.
      if (costFieldSet.has(k)) continue
      if (isEmpty(merged.transformed[k]) && !isEmpty(v)) merged.transformed[k] = v
    }
    for (const [k, v] of Object.entries((r && r.mapped) || {})) {
      if (costFieldSet.has(k)) continue
      if (isEmpty(merged.mapped[k]) && !isEmpty(v)) merged.mapped[k] = v
    }
    for (const [k, v] of Object.entries((r && r.custom) || {})) {
      if (k === 'line_items' || k === 'line_count') continue
      if (isEmpty(merged.custom[k]) && !isEmpty(v)) merged.custom[k] = v
    }
    for (const iss of (r && r.issues) || []) {
      if (!merged.issues.some((e) => e.code === iss.code && e.field === iss.field)) {
        merged.issues.push(iss)
      }
    }
    if ((STATUS_RANK[r.validationStatus] || 0) > (STATUS_RANK[merged.validationStatus] || 0)) {
      merged.validationStatus = r.validationStatus
    }
  }

  // Roll up every source line from every file (audit) - preserving order.
  const lineItems = []
  for (const r of group) lineItems.push(...lineItemsOf(r))
  merged.custom.line_items = lineItems
  merged.custom.line_count = lineItems.length
  // Provenance: how many source rows fed this record, and whether a genuine
  // cross-file merge occurred (more than one contributor).
  merged.custom.merged_row_count = group.length
  merged.mergedFrom = group.length
  merged.crossFileMerged = true
  return merged
}

/**
 * Collapse annotated wizard rows so that rows sharing a module natural key across
 * files become ONE cost-of-record-wins record. Rows without a usable key, and
 * keys with a single contributor, pass through unchanged and in original order.
 *
 * @param {Array<Object>} rows   Annotated rows (raw/mapped/transformed/custom/
 *   issues/validationStatus/...), typically post-aggregateStagedRows.
 * @param {'fleet'|'tyre'|'stock'|'workorder'|string} module
 * @param {{ cost?: string[] }} [cfg]  Optional override of the cost-defining
 *   fields (defaults to the module's COST_FIELDS).
 * @returns {Array<Object>} merged rows, one per natural key (order preserved by
 *   first occurrence); side-effect-free.
 */
export function mergeCrossFileRows(rows, module, cfg = {}) {
  if (!Array.isArray(rows) || rows.length < 2) return rows
  const costFields = Array.isArray(cfg.cost) && cfg.cost.length
    ? cfg.cost
    : (COST_FIELDS[module] || [])

  /** @type {Map<string, Object[]>} */
  const groups = new Map()
  /** @type {Map<string, number>} */
  const slot = new Map()
  const out = []

  for (const r of rows) {
    let key = null
    try {
      key = naturalKey(r?.transformed || r, module)
    } catch {
      key = null
    }
    if (key == null) { out.push(r); continue }
    if (!groups.has(key)) {
      groups.set(key, [])
      slot.set(key, out.length)
      out.push(null) // reserve the first-occurrence position
    }
    groups.get(key).push(r)
  }

  for (const [key, group] of groups) {
    out[slot.get(key)] = group.length === 1 ? group[0] : mergeGroup(group, costFields)
  }
  return out
}

export { COST_FIELDS }

export default mergeCrossFileRows
