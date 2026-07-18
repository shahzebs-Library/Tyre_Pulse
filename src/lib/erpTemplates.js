/**
 * ERP import template builder.
 *
 * Generates blank .xlsx templates whose sheet headers are the EXACT column
 * labels the ERP importer (src/lib/erpImport.js mapSheetToRows) accepts, so a
 * filled file maps automatically on upload. Every header below normalises to a
 * key or alias in erpImport.js DATASETS, and every sheet name matches a
 * dataset tabAlias so the right tab is auto-detected on upload.
 *
 * Reuses the app's existing lazy xlsx (SheetJS) mechanism (dynamic import, same
 * as src/lib/exportUtils.js) and reportFileName for a clean, ASCII, dash-free
 * download name. No new dependency, no I/O beyond the browser download.
 */
import { DATASETS } from './erpImport'
import { reportFileName, reportDateLabel } from './exportUtils'

/**
 * Header labels per dataset, aligned 1:1 (same order) with the corresponding
 * DATASETS[key].columns. Each label normalises to that column's key or alias.
 * NOTE: licence columns use "Licence Issue" / "Licence Expiry" because those
 * normalise to accepted aliases (licenceissue / licenceexpiry); a "Driver
 * Licence ..." spelling would NOT auto-map.
 */
const LABELS = {
  asset: [
    'Asset No', 'Plate No', 'Asset Type', 'Site', 'Make', 'Model Year', 'Current KM',
    'Hour Meter', 'Status', 'Capacity', 'Shift', 'Operator', 'Second User', 'Insurance Name',
    'Insurance Type', 'Insurance Start', 'Insurance End', 'Operating Card No', 'Card Issue Date',
    'Card Expiry Date', 'Licence Issue', 'Licence Expiry', 'Purchase Value', 'Net Book Value',
    'Monthly Depreciation', 'Age of Asset', 'Operation Start Date', 'Org OU', 'Finance Asset No',
    'Remarks',
  ],
  change: [
    'Asset No', 'Tyre Position', 'Serial No', 'Tyre Size', 'Tyre Brand', 'Fix Date', 'Fix KM',
    'Fix Hour', 'Remove Date', 'Remove KM', 'Remove Hour', 'Total KM', 'Old Serial No',
    'Old Tyre Brand', 'Job Card No', 'Version', 'Site',
  ],
  expense: [
    'Serial No', 'Asset No', 'Job Card No', 'Purchase Date', 'Supplier', 'Unit Cost', 'Currency',
    'Quantity', 'Invoice No', 'PO No', 'Tyre Brand', 'Tyre Size', 'Notes',
  ],
  production: [
    'Site', 'Period', 'm3', 'Source', 'Notes', 'Asset No',
  ],
}

/** Sheet names match each dataset's tabAliases so upload auto-detects the tab. */
const SHEET_NAME = {
  asset: 'Asset Master',
  change: 'Tyre Change Log',
  expense: 'Tyre Expense - Purchase',
  production: 'Production m3',
}

/** Ordered dataset keys for the template workbook + per-dataset downloads. */
export const TEMPLATE_KEYS = ['asset', 'change', 'expense', 'production']

function exampleFor(type) {
  switch (type) {
    case 'date': return '2026-01-31'
    case 'num': return '1000'
    case 'int': return '2020'
    default: return 'Sample'
  }
}

function hintFor(type) {
  switch (type) {
    case 'date': return 'Date YYYY-MM-DD'
    case 'num': return 'Number'
    case 'int': return 'Whole number'
    default: return 'Text'
  }
}

/**
 * Build the three-row content (header, example, format hint) for one dataset.
 * Types come from the erpImport column definitions so hints/examples always
 * match what the importer coerces.
 * @param {string} key one of TEMPLATE_KEYS
 * @returns {{ sheetName:string, headers:string[], example:string[], hint:string[] }}
 */
export function templateSheet(key) {
  const ds = DATASETS[key]
  const cols = ds?.columns || []
  const headers = LABELS[key] || cols.map((c) => c.key)
  const example = cols.map((c) => exampleFor(c.type))
  const hint = cols.map((c) => hintFor(c.type))
  return { sheetName: SHEET_NAME[key] || (ds?.label || key), headers, example, hint }
}

/**
 * Generate and download an .xlsx of ERP import templates.
 *
 * @param {string[]|null} keys datasets to include; null/omitted = all four.
 * @param {string} [filename] base name (no extension); defaults to a clean,
 *   dash-free dated name via reportFileName.
 */
export async function downloadErpTemplates(keys = null, filename) {
  const XLSX = await import('xlsx')
  const wanted = Array.isArray(keys) && keys.length
    ? TEMPLATE_KEYS.filter((k) => keys.includes(k))
    : TEMPLATE_KEYS
  const use = wanted.length ? wanted : TEMPLATE_KEYS

  const wb = XLSX.utils.book_new()
  for (const key of use) {
    const { sheetName, headers, example, hint } = templateSheet(key)
    const ws = XLSX.utils.aoa_to_sheet([headers, example, hint])
    ws['!cols'] = headers.map((h) => ({ wch: Math.min(Math.max(String(h).length + 2, 12), 30) }))
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' }
    // Excel caps sheet names at 31 chars; ours are all shorter.
    XLSX.utils.book_append_sheet(wb, ws, String(sheetName).slice(0, 31))
  }

  const single = use.length === 1 ? (SHEET_NAME[use[0]] || DATASETS[use[0]]?.label) : 'Import Templates'
  const base = filename || reportFileName('TyrePulse ERP', single, reportDateLabel())
  XLSX.writeFile(wb, `${base || 'TyrePulse ERP Import Templates'}.xlsx`)
}
