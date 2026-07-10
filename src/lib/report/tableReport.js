// ─────────────────────────────────────────────────────────────────────────────
// tableReport.js — state-faithful export engine for EnterpriseTable.
//
// The golden rule (per the report spec): an export must reflect EXACTLY what the
// user is looking at — the same filters, global search, multi-sort, visible
// columns, column order and (optionally) selected rows — never a fresh default
// query. This module reads that live state straight off a TanStack Table
// instance and hands it to the shared renderers in exportUtils, so PDF, Excel
// and CSV all emit the identical dataset.
//
// Three export modes:
//   current   — the rows on the current page (post-pagination view)
//   filtered  — every row matching the current filters/search/sort (all pages)
//   selected  — only the rows the user ticked
// ─────────────────────────────────────────────────────────────────────────────

import { buildCsv, downloadCsv } from '../tableExport'
import { exportToPdf, exportToExcel } from '../exportUtils'

export const EXPORT_MODES = Object.freeze({
  CURRENT: 'current',
  FILTERED: 'filtered',
  SELECTED: 'selected',
})

export const EXPORT_FORMATS = Object.freeze({ PDF: 'pdf', EXCEL: 'excel', CSV: 'csv' })

const MODE_LABEL = {
  current: 'Current View',
  filtered: 'Filtered Report',
  selected: 'Selected Rows',
}
export const modeLabel = (m) => MODE_LABEL[m] || m

/** Visible, exportable, accessor-backed columns in on-screen order. */
export function getExportColumns(table) {
  return table
    .getVisibleLeafColumns()
    .filter((col) => col.columnDef.meta?.export !== false && col.accessorFn)
}

/** Display header for a column, honouring meta.exportHeader. */
export function getColumnHeader(col) {
  const { meta, header } = col.columnDef
  if (meta?.exportHeader) return meta.exportHeader
  return typeof header === 'string' ? header : col.id
}

/** TanStack Row[] for the requested mode (falls back to filtered). */
export function getRowsForMode(table, mode) {
  if (mode === EXPORT_MODES.SELECTED) return table.getSelectedRowModel().rows
  if (mode === EXPORT_MODES.CURRENT) return table.getRowModel().rows
  return table.getPrePaginationRowModel().rows
}

/** Convert TanStack rows → plain objects keyed by column id, using the same
 *  meta.exportValue overrides the CSV path uses (so numbers/dates stay raw). */
function toObjectRows(rows, cols) {
  return rows.map((row) => {
    const out = {}
    for (const col of cols) {
      const override = col.columnDef.meta?.exportValue
      out[col.id] = override ? override(row.original) : row.getValue(col.id)
    }
    return out
  })
}

/** Human-readable snapshot of the active table state, embedded in report meta
 *  so the exported file records exactly which view produced it. */
export function describeTableState(table, mode) {
  const state = table.getState()
  const meta = {}
  meta['Export mode'] = modeLabel(mode)

  const search = (state.globalFilter || '').trim()
  if (search) meta['Search'] = search

  const colFilters = state.columnFilters || []
  if (colFilters.length) {
    meta['Filters'] = colFilters
      .map((f) => `${f.id}=${Array.isArray(f.value) ? f.value.join('|') : f.value}`)
      .join(', ')
  }

  const sorting = state.sorting || []
  if (sorting.length) {
    meta['Sorted by'] = sorting.map((s) => `${s.id} ${s.desc ? '↓' : '↑'}`).join(', ')
  }
  return meta
}

/**
 * Build the portable report-definition payload from live table state — the same
 * contract the server-side Playwright engine (services/report-engine) consumes.
 * Charts are supplied by the caller (canvas → PNG data URL) since the table does
 * not own them.
 */
export function buildReportDefinition({
  table,
  mode = EXPORT_MODES.FILTERED,
  fileName = 'export',
  title = 'Report',
  company = '',
  currency = 'SAR',
  locale = 'en',
  branding,
  dateRange,
  kpis,
  charts,
  orientation = 'landscape',
}) {
  const cols = getExportColumns(table)
  const rows = toObjectRows(getRowsForMode(table, mode), cols)
  return {
    reportType: 'table',
    title,
    company,
    currency,
    locale,
    dateRange,
    exportMode: mode,
    filtersSummary: describeTableState(table, mode),
    columns: cols.map((c) => ({
      key: c.id,
      header: getColumnHeader(c),
      align: c.columnDef.meta?.align || 'left',
    })),
    rows,
    kpis,
    charts,
    branding,
    orientation,
    fileName,
  }
}

/**
 * Run a state-faithful export.
 * @returns {Promise<number>} the number of rows exported (0 = nothing to export)
 */
export async function runTableExport({
  table,
  format = EXPORT_FORMATS.PDF,
  mode = EXPORT_MODES.FILTERED,
  fileName = 'export',
  title = 'Report',
  company = '',
  currency = 'SAR',
  branding,
  dateRange,
  orientation = 'landscape',
  extraMeta,
}) {
  const cols = getExportColumns(table)
  if (cols.length === 0) return 0

  const keys = cols.map((c) => c.id)
  const headers = cols.map(getColumnHeader)
  const rowObjs = toObjectRows(getRowsForMode(table, mode), cols)
  if (rowObjs.length === 0 && format === EXPORT_FORMATS.CSV) {
    // PDF/Excel render a proper empty-state; CSV would be a bare header only.
    downloadCsv(buildCsv(headers, []), `${fileName}_${mode}`)
    return 0
  }

  const meta = { ...describeTableState(table, mode), ...(extraMeta || {}) }
  const stamp = new Date().toISOString().slice(0, 10)
  const fname = `${fileName}_${mode}_${stamp}`

  if (format === EXPORT_FORMATS.CSV) {
    const csvRows = rowObjs.map((o) => keys.map((k) => o[k]))
    downloadCsv(buildCsv(headers, csvRows), fname)
    return rowObjs.length
  }

  if (format === EXPORT_FORMATS.EXCEL) {
    await exportToExcel(rowObjs, keys, headers, fname, 'Data', {
      title, company, currency, dateRange, meta, branding,
    })
    return rowObjs.length
  }

  // PDF (default) — exportToPdf auto-builds the analytical KPI + chart summary.
  const pdfCols = cols.map((c) => ({ key: c.id, header: getColumnHeader(c) }))
  await exportToPdf(rowObjs, pdfCols, title, fname, orientation, company, {
    currency, dateRange, meta, branding,
  })
  return rowObjs.length
}
