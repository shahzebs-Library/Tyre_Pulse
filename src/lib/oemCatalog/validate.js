import { normalizePartNumber } from '../oemPartsExtractor'

/** Row-level data quality. error blocks publishing, warn lowers confidence. */
export function validateRow(row, ctx = {}) {
  const issues = []
  const pn = String(row.part_no || '')
  const norm = normalizePartNumber(pn)
  if (norm.length < 6 || norm.length > 24) issues.push({ code: 'part_no_length', severity: 'error', message: `Part number "${pn}" has an unusual length` })
  else if ((norm.match(/\d/g) || []).length < 3) issues.push({ code: 'part_no_shape', severity: 'error', message: `Part number "${pn}" has too few digits to be an OEM number` })
  if (/\s/.test(pn)) issues.push({ code: 'part_no_space', severity: 'warn', message: 'Part number contains whitespace' })
  if (row.quantity == null) issues.push({ code: 'qty_missing', severity: 'warn', message: 'Quantity not read' })
  else if (!(row.quantity > 0) || row.quantity > 9999) issues.push({ code: 'qty_range', severity: 'error', message: `Quantity ${row.quantity} is outside 1 to 9999` })
  const desc = String(row.description || '')
  if (desc.length < 3) issues.push({ code: 'desc_short', severity: 'error', message: 'Description is empty or too short' })
  else if (/^\d+$/.test(desc)) issues.push({ code: 'desc_numeric', severity: 'warn', message: 'Description is only digits (column shift?)' })
  if (!row.illustration_pdf_page) issues.push({ code: 'figure_unlinked', severity: 'warn', message: 'No illustration page linked' })
  if (ctx.calloutIndexes && row.index_no && !ctx.calloutIndexes.has(String(Number(row.index_no)))) {
    issues.push({ code: 'orphan_index', severity: 'warn', message: `Index ${row.index_no} not found as a callout on the figure` })
  }
  return issues
}

/** Duplicate direct indexes within one figure (variants carry parent_index, so they never collide). */
export function duplicateIndexes(rows) {
  const seen = new Map()
  const dup = new Set()
  for (const r of rows) {
    if (!r.index_no) continue
    const k = `${r.figure_id}|${Number(r.index_no)}`
    if (seen.has(k)) { dup.add(r); dup.add(seen.get(k)) } else seen.set(k, r)
  }
  return dup
}

/** Callouts on the figure that no part row explains. */
export function indexesWithoutRows(rows, calloutIndexes) {
  const have = new Set(rows.map((r) => String(Number(r.index_no || r.parent_index))).filter((v) => v !== 'NaN'))
  return [...calloutIndexes].filter((i) => !have.has(i))
}

export function scoreRow(issues) {
  let c = 1
  for (const i of issues) c -= i.severity === 'error' ? 0.45 : 0.12
  return Number(Math.max(0, c).toFixed(2))
}
