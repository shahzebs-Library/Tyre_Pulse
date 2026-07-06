/**
 * tableExport - client-side CSV export helpers (no dependencies).
 *
 * Used by EnterpriseTable but written as pure functions so they are
 * unit-testable and reusable by any module that needs CSV output.
 */

/** UTF-8 byte-order mark so Excel opens Arabic/accented text correctly. */
const UTF8_BOM = String.fromCharCode(0xfeff)

/**
 * Escape a single CSV cell.
 * - null/undefined become empty strings
 * - Dates serialize as ISO strings
 * - quotes/commas/newlines are RFC 4180 quoted
 * - Cells that a spreadsheet would interpret as a formula (=, @, or +/-
 *   followed by a non-numeric character) are prefixed with a single quote
 *   to neutralise CSV-injection payloads.
 */
export function escapeCsvValue(value) {
  if (value === null || value === undefined) return ''
  let s = value instanceof Date ? value.toISOString() : String(value)

  // Formula-injection guard (keeps plain negative numbers like -12.5 intact).
  if (/^[=@]/.test(s) || (/^[+-]/.test(s) && !/^[+-]?\d*\.?\d+([eE][+-]?\d+)?$/.test(s))) {
    s = `'${s}`
  }

  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Build a CSV string from a header row and data rows.
 * Prepends a UTF-8 BOM so Excel detects the encoding.
 *
 * @param {Array<string>} headers - column header labels
 * @param {Array<Array<*>>} rows  - row-major cell values
 * @returns {string} CSV document
 */
export function buildCsv(headers, rows) {
  const lines = [headers.map(escapeCsvValue).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeCsvValue).join(','))
  }
  return UTF8_BOM + lines.join('\r\n')
}

/**
 * Trigger a browser download of a CSV string.
 *
 * @param {string} csv      - CSV document (from buildCsv)
 * @param {string} filename - target file name ('.csv' appended if missing)
 */
export function downloadCsv(csv, filename) {
  const name = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
