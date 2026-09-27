/**
 * erpIntakeAnalytics - pure presentation maths for the ERP Data Intake page
 * (/erp-intake). The parsing, routing and merge semantics live in
 * `src/lib/erpIntake.js`, `src/lib/partsExpense.js` and the loaders in
 * `src/lib/api/erpIntake.js`; this module only COUNTS what they produced so
 * the preview, the result summary and the downloadable import report agree.
 * No I/O.
 */

const n = (v) => Number(v) || 0
export const num = (v) => n(v).toLocaleString('en-US')

/** Per-sheet result counts. `notAdded` = exact duplicates the merge dropped. */
export function resultCounts(row) {
  const source = n(row?.sourceRows ?? row?.rows?.length ?? 0)
  const inserted = n(row?.inserted)
  const updated = n(row?.updated)
  const failed = n(row?.failed)
  const notAdded = Math.max(0, source - inserted - updated - failed)
  const processed = Math.max(0, source - failed)
  return { source, inserted, updated, failed, notAdded, processed }
}

/** One-line plain-English summary of a sheet's import result. */
export function resultSummary(row) {
  const c = resultCounts(row)
  const parts = [`${num(c.processed)} row${c.processed === 1 ? '' : 's'} processed`]
  parts.push(`${num(c.inserted)} new`)
  if (row?.target === 'open_work_orders') parts.push('list replaced')
  else {
    if (c.updated) parts.push(`${num(c.updated)} refreshed`)
    if (c.notAdded) parts.push(`${num(c.notAdded)} exact duplicate(s) dropped`)
  }
  if (c.failed) parts.push(`${num(c.failed)} failed`)
  return parts.join(', ')
}

/** Whole-file reconciliation: every row below each header is accounted for. */
export function reconcile(detected = []) {
  return (Array.isArray(detected) ? detected : []).reduce(
    (acc, d) => {
      const a = d?.accounting || {}
      acc.read += n(a.read)
      acc.mapped += n(a.mapped)
      acc.noKey += n(a.noKey)
      acc.footer += n(a.footer)
      acc.blank += n(a.blank)
      return acc
    },
    { read: 0, mapped: 0, noKey: 0, footer: 0, blank: 0 },
  )
}

/**
 * Preview KPIs. `fresh`/`existing` are only known when every keyed sheet
 * returned a duplicate check; otherwise they are null (never a guessed 0).
 */
export function previewTotals(detected = []) {
  const list = Array.isArray(detected) ? detected : []
  let rows = 0
  let tyreRows = 0
  let dropped = 0
  let fresh = 0
  let existing = 0
  let dupKnown = list.length > 0
  for (const d of list) {
    rows += d?.rows?.length || 0
    tyreRows += Array.isArray(d?.tyreRows) ? d.tyreRows.length : 0
    dropped += n(d?.dropped)
    if (d?.dup && d.dup.keyed) {
      fresh += n(d.dup.fresh)
      existing += n(d.dup.existing)
    } else if ((d?.rows?.length || 0) > 0) {
      dupKnown = false
    }
  }
  return {
    reports: list.length,
    rows,
    tyreRows,
    dropped,
    fresh: dupKnown ? fresh : null,
    existing: dupKnown ? existing : null,
  }
}

/** Totals across completed sheet results. */
export function resultTotals(results = []) {
  return (Array.isArray(results) ? results : []).reduce(
    (acc, r) => {
      const c = resultCounts(r)
      acc.processed += c.processed
      acc.inserted += c.inserted
      acc.updated += c.updated
      acc.notAdded += c.notAdded
      acc.failed += c.failed
      acc.tyresInserted += n(r?.tyresInserted)
      acc.tyresUpdated += n(r?.tyresUpdated)
      return acc
    },
    { processed: 0, inserted: 0, updated: 0, notAdded: 0, failed: 0, tyresInserted: 0, tyresUpdated: 0 },
  )
}

export const REPORT_COLUMNS = [
  { key: 'report', header: 'Report' },
  { key: 'sheet', header: 'Sheet' },
  { key: 'destination', header: 'Destination' },
  { key: 'country', header: 'Country' },
  { key: 'source', header: 'Rows in file' },
  { key: 'inserted', header: 'New' },
  { key: 'updated', header: 'Refreshed' },
  { key: 'duplicates', header: 'Exact duplicates dropped' },
  { key: 'failed', header: 'Failed' },
  { key: 'tyres', header: 'Tyre changes (new / refreshed)' },
]

/** Rows for the downloadable import report (one per sheet). */
export function importReportRows(results = [], country = '') {
  return (Array.isArray(results) ? results : []).map((r) => {
    const c = resultCounts(r)
    return {
      report: r?.label || r?.type || '',
      sheet: r?.sheetName || 'Sheet1',
      destination: r?.targetLabel || r?.target || '',
      country: country || '',
      source: c.source,
      inserted: c.inserted,
      updated: r?.target === 'open_work_orders' ? 'List replaced' : c.updated,
      duplicates: r?.target === 'open_work_orders' ? 'N/A' : c.notAdded,
      failed: c.failed,
      tyres: n(r?.tyresSourceRows) ? `${num(r.tyresInserted)} / ${num(r.tyresUpdated)}` : 'N/A',
    }
  })
}
