/**
 * importCostPreview.js - wires the tyre cost audit rules (tyreCostAudit.js) into the
 * ERP import preview. Pure, no I/O: the price index is loaded by the caller
 * (src/lib/api/tyreCostAudit.js loadPriceIndex) and passed in.
 *
 * Two upload kinds are previewed before commit:
 *   - 'grid'          : the parts / expense grid (parts_consumption)
 *   - 'monthly_tyres' : the Monthly Tyres Consumption report (tyre_records)
 *
 * Rules kept here, NOT in the rule engine:
 *   - Proposed prices are SHOWN, never written. Writing a recovered price goes through
 *     the Tyre Cost Audit approval flow; the uploaded values are imported as they are.
 *   - Only rows the rule engine calls 'invalid' or 'duplicate' are held back. Every
 *     other row imports (cost pending, review and warranty rows included).
 *   - Expense lines with a distinct ERP line number ('#') are never duplicates of each
 *     other: genuine repeated lines carry different line numbers (V365 rule), so the
 *     line number is folded into the duplicate key.
 *   - Monthly tyre rows carry no price and no item code. Tyre cost comes from the
 *     separate expense grid, never per serial from this file, and the index never
 *     prices them (size alone must not match two products). So a monthly-tyre row
 *     whose only flag is a missing price previews as VALID - a complete fitment -
 *     not as Cost Pending Verification. Genuine invalid / duplicate rows are still
 *     held. (The grid and manual/intake tyre paths keep cost_pending: there a
 *     missing price is a real gap to chase.)
 */
import { parseDate } from './erpIntake'
import { toNum } from './partsExpense'
import { isTyreWarranty } from './tyrePriceRules'
import { validateUploadRows, importReconciliation, buildPriceIndex, monthKey, COST_PENDING_LABEL } from './tyreCostAudit'

export const PREVIEW_KINDS = Object.freeze(['grid', 'monthly_tyres', 'intake_tyre'])
export const EXCLUDED_RESULTS = Object.freeze(['invalid', 'duplicate'])

export const RESULT_LABELS = Object.freeze({
  valid: 'Valid',
  price_proposed: 'Price proposed',
  cost_pending: COST_PENDING_LABEL,
  warranty: 'Warranty',
  review: 'Needs review',
  invalid: 'Invalid, not imported',
  duplicate: 'Duplicate, not imported',
})

const str = (v) => (v == null ? '' : String(v)).trim()

/** Expense grid rows (rowsFromSheet output) -> rule-engine upload rows. */
export function gridRowsToAudit(rows = []) {
  return rows.map((r, i) => {
    const line = str(r.source_row)
    return {
      line: line || i + 1,
      description: str(r.item_description),
      itemCode: str(r.item_code),
      date: parseDate(r.txn_date) || null,
      qty: toNum(r.qty),
      value: toNum(r.value_amount),
      jobCard: str(r.work_order_no),
      // The ERP line number separates genuine repeated lines (see header).
      serial: line ? `#${line}` : '',
    }
  })
}

/** Monthly tyre rows (mapMonthlyTyres output) -> rule-engine upload rows. */
export function tyreRowsToAudit(rows = []) {
  return rows.map((r, i) => ({
    line: i + 1,
    description: `TYRE ${str(r.size)}`.trim(),
    // A tyre record has no ERP item code; the row's own identifiers stand in so the
    // check is about a missing identity, not a column this report never carries.
    itemCode: str(r.size) || str(r.serial_no) || str(r.asset_no),
    date: r.issue_date || r.removal_date || null,
    qty: 1,
    value: null,
    jobCard: str(r.job_card),
    serial: `${str(r.serial_no)}@${str(r.asset_no)}@${str(r.position)}`,
    brand: r.brand || null,
    size: r.size || null,
  }))
}

/**
 * Data Intake Center 'tyre' module rows (transformed) -> rule-engine upload rows.
 * Advisory only: that page keeps its own error/duplicate handling and commit flow.
 */
export function intakeTyreRowsToAudit(rows = []) {
  return rows.map((t, i) => {
    const qty = toNum(t?.qty)
    const unit = toNum(t?.cost_per_tyre)
    const lineTotal = toNum(t?.line_total)
    const q = qty != null && qty > 0 ? qty : 1
    const value = lineTotal != null ? lineTotal : (unit != null ? Math.round(unit * q * 100) / 100 : null)
    return {
      line: i + 1,
      description: `TYRE ${str(t?.size)} ${str(t?.brand)}`.trim(),
      itemCode: str(t?.item_code) || str(t?.size) || str(t?.serial_no) || str(t?.asset_no),
      date: t?.issue_date || t?.fitment_date || t?.removal_date || null,
      qty: q,
      value,
      jobCard: str(t?.job_card),
      serial: `${str(t?.serial_no)}@${str(t?.asset_no)}@${str(t?.position || t?.tyre_position)}`,
      warranty: t?.warranty === true,
    }
  })
}

/** Distinct 'YYYY-MM' months present in the audit rows. */
export function monthsInRows(auditRows = []) {
  return [...new Set(auditRows.map((r) => monthKey(r.date)).filter(Boolean))].sort()
}

/** The file's own lines in the shape buildPriceIndex reads. */
export function fileLinesForIndex(auditRows = [], country = null) {
  return auditRows.map((r, i) => ({
    id: `file:${r.line ?? i + 1}`, country, itemCode: r.itemCode, date: r.date,
    description: r.description, value: r.value, qty: r.qty,
  }))
}

/**
 * Build the whole preview for one sheet.
 * @param {'grid'|'monthly_tyres'} kind
 * @param {object[]} rows      mapped rows that would be committed
 * @param {{ dbLines?:object[], country?:string, currency?:string, indexError?:string|null }} opts
 */
export function buildImportPreview(kind, rows = [], opts = {}) {
  if (!PREVIEW_KINDS.includes(kind)) return null
  const country = opts.country || null
  const audit = kind === 'grid' ? gridRowsToAudit(rows)
    : kind === 'intake_tyre' ? intakeTyreRowsToAudit(rows) : tyreRowsToAudit(rows)
  // Grid: same item code, same month, from stored lines PLUS this file's own priced
  // lines (both are real store-issue transactions). Tyres: never priced from the index.
  const priceIndex = kind === 'grid'
    ? buildPriceIndex([...(opts.dbLines || []), ...fileLinesForIndex(audit, country)])
    : null
  const checks = validateUploadRows(audit, { priceIndex, country, currency: opts.currency })
  const rowsOut = checks.map((c, i) => {
    // The Monthly Tyres Consumption report carries NO price by design: tyre cost
    // comes from the separate expense grid, never per serial from this file. A row
    // whose ONLY flag is "cost pending" is a complete fitment record, so for this
    // kind it imports as Valid and must not read as pending. Genuine problems
    // (invalid / duplicate) are left exactly as the engine classified them. The grid
    // and manual/intake tyre paths keep cost_pending, where a missing price is real.
    const result = kind === 'monthly_tyres' && c.result === 'cost_pending' ? 'valid' : c.result
    return {
      ...c, result, index: i, description: audit[i].description, itemCode: audit[i].itemCode,
      date: audit[i].date, label: RESULT_LABELS[result] || result,
    }
  })
  const counts = {}
  for (const c of rowsOut) counts[c.result] = (counts[c.result] || 0) + 1
  const excluded = rowsOut.filter((c) => EXCLUDED_RESULTS.includes(c.result))
  const excludedValue = Math.round(excluded.reduce((a, c) => a + (toNum(rows[c.index]?.value_amount) ?? 0), 0) * 100) / 100
  return {
    kind,
    rows: rowsOut,
    counts,
    total: rowsOut.length,
    excludedIndexes: new Set(excluded.map((c) => c.index)),
    excludedCount: excluded.length,
    excludedValue: kind === 'grid' ? excludedValue : null,
    proposedCount: counts.price_proposed || 0,
    reconciliation: kind === 'grid' ? importReconciliation(audit) : null,
    advisory: kind === 'intake_tyre',
    indexError: opts.indexError || null,
  }
}

/** Rows that may be committed: everything except invalid and duplicate rows. */
export function committableRows(rows = [], preview) {
  if (!preview?.excludedIndexes?.size) return rows
  return rows.filter((_, i) => !preview.excludedIndexes.has(i))
}

/** Rows that need the operator's attention (anything not plainly valid). */
export function needsAttention(previewRow) {
  return previewRow?.result !== 'valid'
}

/**
 * Manual tyre entry: a blank or zero cost on a tyre that is not a warranty replacement
 * is saved as-is (never blocked) but labelled Cost Pending Verification.
 * Warranty is read from the record's own words (description, remarks, category).
 * @returns {string|null} the warning text, or null when no warning applies
 */
export function manualTyreCostWarning({ cost, description, remarks, category, warranty } = {}) {
  const n = cost == null || String(cost).trim() === '' ? null : Number(cost)
  if (n != null && Number.isFinite(n) && n > 0) return null
  if (warranty === true || isTyreWarranty([description, remarks, category].map(str).join(' '))) return null
  return n === 0
    ? `Cost is 0 and this tyre is not marked as warranty. The cost audit treats it as ${COST_PENDING_LABEL} until the real price is entered.`
    : `No cost entered. This tyre will be shown as ${COST_PENDING_LABEL} until the real price is entered.`
}
