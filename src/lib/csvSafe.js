/**
 * csvSafe - the ONE spreadsheet formula-injection defence for every Excel / CSV
 * writer in the web app.
 *
 * A text cell whose first character is one of = + - @ (or a leading TAB / CR)
 * is read as a formula by Excel, Google Sheets and LibreOffice when the file
 * is opened, which allows data exfiltration or command execution
 * (`=HYPERLINK(...)`, `=cmd|'/c calc'!A1`). Free text typed by a field user
 * (remarks, notes, description, serial) reaches exports, so every writer must
 * neutralise it. Prefixing the value with one apostrophe makes the spreadsheet
 * treat it as literal text.
 *
 * RULES
 * - Only STRINGS are touched. Numbers, booleans, Dates, null stay as they are,
 *   so a real negative number (-45.2 as a number) is still a number cell.
 * - Every page or lib that builds a sheet or CSV text goes through this file
 *   (or exportUtils / tableExport, which use it). `src/test/exportSafeScan.test.js`
 *   fails the build when a file calls XLSX `*_to_sheet` directly.
 *
 * Pure module: no imports, no I/O.
 */

// = 0x3D, + 0x2B, - 0x2D, @ 0x40, TAB 0x09, CR 0x0D
function startsLikeFormula(s) {
  const c = s.charCodeAt(0)
  return c === 0x3D || c === 0x2B || c === 0x2D || c === 0x40 || c === 0x09 || c === 0x0D
}

const PLAIN_NUMBER = /^[+-]?\d*\.?\d+([eE][+-]?\d+)?$/

/** Neutralise one typed spreadsheet cell. Non-strings pass through untouched. */
export function sanitizeCell(v) {
  if (typeof v !== 'string' || v.length === 0) return v
  return startsLikeFormula(v) ? `'${v}` : v
}

/**
 * Neutralise CSV text. CSV has no cell types, so every value is already a
 * string; a plain signed number ("-12.5") is left alone because a spreadsheet
 * reads it as a number, not a formula. Anything else that starts like a
 * formula is prefixed.
 */
export function sanitizeCsvText(s) {
  if (typeof s !== 'string' || s.length === 0) return s
  if (!startsLikeFormula(s)) return s
  if ((s.charCodeAt(0) === 0x2B || s.charCodeAt(0) === 0x2D) && PLAIN_NUMBER.test(s)) return s
  return `'${s}`
}

/** One RFC 4180 CSV cell with the formula guard applied. */
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  let s
  if (value instanceof Date) s = value.toISOString()
  else if (Array.isArray(value)) s = value.join(';')
  else s = String(value)
  s = sanitizeCsvText(s)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Sanitise every string value of an array of plain-object rows (new objects). */
export function safeRows(rows) {
  return (rows || []).map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row
    const out = {}
    for (const k of Object.keys(row)) out[k] = sanitizeCell(row[k])
    return out
  })
}

/** Sanitise every cell of an array-of-arrays sheet (new arrays). */
export function safeAoa(aoa) {
  return (aoa || []).map((row) => (Array.isArray(row) ? row.map(sanitizeCell) : row))
}

/** Drop-in for XLSX.utils.json_to_sheet(rows, opts) with the guard applied. */
export function safeJsonToSheet(XLSX, rows, opts) {
  return XLSX.utils.json_to_sheet(safeRows(rows), opts)
}

/** Drop-in for XLSX.utils.aoa_to_sheet(aoa, opts) with the guard applied. */
export function safeAoaToSheet(XLSX, aoa, opts) {
  return XLSX.utils.aoa_to_sheet(safeAoa(aoa), opts)
}
