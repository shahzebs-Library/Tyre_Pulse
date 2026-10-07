/**
 * workshopStatus/excelParser.js - parse the daily workshop morning-update Excel
 * into a structured, validated PREVIEW. NO database writes, NO UI.
 *
 * The real file (docs/workshop-status/EXCEL_MAPPING.md) is not a flat table:
 *   - a title band (company, "JOB CARD ENTRY", report date),
 *   - then SECTIONS, each = one merged title row + its own header row + data rows,
 *   - header text varies between sections (odd spacing, blank K/L headers),
 *   - the last section "JOB CARD CLOSED DETAILS" lists released vehicles, which
 *     are NOT active.
 * So columns are matched by normalised alias per section, never by position.
 *
 * Rules (derived from the file, see EXCEL_MAPPING.md):
 *   - Active beats closed: an asset listed in an open section is active even if
 *     it also appears under closed details (the closed row gets a warning).
 *   - Duplicates are counted only among ACTIVE rows; repeats inside the closed
 *     section are normal (a vehicle can be released twice in a day).
 *   - Dates are DAY-FIRST. Month-first parsing has corrupted this codebase twice
 *     (coerceDate, erp_parse_date); never read 07/09/2026 as 9 July.
 *   - Days Down is COMPUTED from the breakdown date; the typed DOWN DAYS is kept
 *     for comparison only, so a stale number in the file is detectable.
 *
 * parseWorkshopSheet / parseWorkshopWorkbook are pure. parseWorkshopFile reads a
 * File/Blob (dynamic import of the shared workbook parser) and hashes it.
 */

import { normHeader } from '../import/headerDiff.js'

// ── Field catalogue ───────────────────────────────────────────────────────────

/**
 * Canonical fields with their header aliases. Aliases are compared on a compact
 * key (normHeader, then every non-alphanumeric removed) so "Workshop/Fleet  Production
 * Account" and "Workshop /Fleet  Production  Account" are the same header. The
 * misspellings "COMPLIANT" and "reelase" are the file's own and are kept verbatim.
 */
export const WORKSHOP_FIELDS = Object.freeze([
  { key: 'sr_no', label: 'Sr. No.', aliases: ['SR.NO', 'SR NO', 'S.NO', 'S NO', 'Serial', 'Serial No', 'No.'] },
  {
    key: 'asset_no', label: 'Vehicle number', required: true,
    aliases: ['ASSET NO.', 'Asset No', 'Asset Number', 'Asset Code', 'Vehicle No.', 'Vehicle Number',
      'Unit No.', 'Unit Number', 'Fleet No.', 'Fleet Number', 'Equipment No.', 'Equipment Number'],
  },
  { key: 'reg_no', label: 'Registration', aliases: ['REG. NO.', 'Reg No', 'Registration', 'Registration No', 'Plate', 'Plate No', 'Plate Number'] },
  { key: 'job_card_ref', label: 'Job card', aliases: ['JOB CARD NO.', 'Job Card', 'Job Card Number', 'JC No'] },
  { key: 'site', label: 'Location', aliases: ['LOCATION', 'Site', 'Site Name'] },
  {
    key: 'complaint', label: 'Complaint',
    aliases: ['PRODUCTION / FLEET COMPLIANT', 'PRODUCTION / FLEET COMPLAINT', 'Production / Fleet Complaint',
      'Complaint', 'Complaints', 'Fleet Complaint', 'Production Complaint'],
  },
  { key: 'diagnostics', label: 'Diagnostics', aliases: ['DIAGNOSTICS', 'Diagnostic', 'Diagnosis'] },
  {
    key: 'ooc_since', label: 'Breakdown date', type: 'date',
    aliases: ['BREAKDOWN DATE', 'Break Down Date', 'OOC Since', 'Out of Service Date', 'Out Of Service Since', 'Reported Date'],
  },
  { key: 'excel_down_days', label: 'Down days (file)', type: 'int', aliases: ['DOWN DAYS', 'Days Down', 'Down Day'] },
  {
    key: 'department', label: 'Account',
    aliases: ['Workshop/Fleet Production Account', 'Workshop Fleet Production Account', 'Workshop/Fleet Account',
      'Production Account', 'Account', 'Department', 'Dept'],
  },
  {
    key: 'excel_expected_release', label: 'Expected release (file)',
    aliases: ['expected time to reelase', 'expected time to release', 'Expected Release', 'Expected Release Date', 'ETR'],
  },
  { key: 'excel_status_note', label: 'Status note (file)', aliases: ['current status note', 'Current Status', 'Status Note'] },
  { key: 'source_remarks', label: 'Remarks', aliases: ['REMARKS', 'Remark', 'Comments'] },
])

/** Compact matching key: case, NBSP, spacing and punctuation folded away. */
export function headerKey(h) {
  return normHeader(h).replace(/[^a-z0-9]/g, '')
}

const ALIAS_INDEX = (() => {
  const m = new Map()
  for (const f of WORKSHOP_FIELDS) {
    for (const a of [f.key, f.label, ...f.aliases]) {
      const k = headerKey(a)
      if (k && !m.has(k)) m.set(k, f.key)
    }
  }
  return m
})()

/** Field key for a header text, or null when it is not a known workshop column. */
export function fieldForHeader(h) {
  const k = headerKey(h)
  return k ? ALIAS_INDEX.get(k) ?? null : null
}

// ── Cell helpers ──────────────────────────────────────────────────────────────

/** Trim, NBSP -> space, collapse internal whitespace. Non-strings become text. */
export function cleanCell(v) {
  if (v == null) return ''
  if (v instanceof Date) return v
  return String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

/** Canonical asset number: upper case, every whitespace removed. */
export function normaliseAssetNo(v) {
  return String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, '').toUpperCase()
}

const pad = (n) => String(n).padStart(2, '0')
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

function validYmd(y, m, d) {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const fullYear = (y) => (y < 100 ? 2000 + y : y)

/** Excel serial day number -> ISO (1900 date system, Lotus leap bug included). */
function serialToIso(n) {
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000
  const dt = new Date(ms)
  return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}
// 1955-01-01 .. 2119: a plausible window, so a stray number is not read as a date.
const SERIAL_MIN = 20090
const SERIAL_MAX = 80000

/**
 * Parse a workshop date. Accepts a JS Date, an Excel serial (number or 5-digit
 * text), yyyy-mm-dd, dd-mm-yyyy, dd/mm/yyyy, dd.mm.yyyy, dd-Mon-yy and
 * "dd Mon yyyy". Numeric forms are ALWAYS day-first. Two-digit years pivot to
 * 2000. Returns { value: 'yyyy-mm-dd' | null, error: string | null }; a blank
 * cell is { value: null, error: null }.
 */
export function parseWorkshopDate(v) {
  if (v == null || v === '') return { value: null, error: null }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { value: null, error: 'Invalid date' }
    // Local getters on purpose: toISOString() is UTC and rolls the day back east of GMT.
    return { value: isoOf(v.getFullYear(), v.getMonth() + 1, v.getDate()), error: null }
  }
  if (typeof v === 'number') {
    if (Number.isFinite(v) && v >= SERIAL_MIN && v <= SERIAL_MAX) return { value: serialToIso(v), error: null }
    return { value: null, error: `Invalid date: ${v}` }
  }
  const s = cleanCell(v)
  if (!s) return { value: null, error: null }
  const bad = { value: null, error: `Invalid date: ${s}` }
  let m
  // ISO first: unambiguous. Allows a trailing time part.
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]]
    return validYmd(y, mo, d) ? { value: isoOf(y, mo, d), error: null } : bad
  }
  // Day-first numeric: dd-mm-yyyy, dd/mm/yy, dd.mm.yyyy.
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T].*)?$/))) {
    const [d, mo, y] = [+m[1], +m[2], fullYear(+m[3])]
    return validYmd(y, mo, d) ? { value: isoOf(y, mo, d), error: null } : bad
  }
  // dd-Mon-yy / dd Mon yyyy / dd-Sept-2026.
  if ((m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/., ]+(\d{2}|\d{4})$/))) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)]
    const [d, y] = [+m[1], fullYear(+m[3])]
    return mo && validYmd(y, mo, d) ? { value: isoOf(y, mo, d), error: null } : bad
  }
  // Mon dd, yyyy (month written as a word, so not ambiguous).
  if ((m = s.match(/^([A-Za-z]{3,9})[ .-]+(\d{1,2}),?[ ]+(\d{2}|\d{4})$/))) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 3)]
    const [d, y] = [+m[2], fullYear(+m[3])]
    return mo && validYmd(y, mo, d) ? { value: isoOf(y, mo, d), error: null } : bad
  }
  // Excel serial that arrived as text.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (n >= SERIAL_MIN && n <= SERIAL_MAX) return { value: serialToIso(n), error: null }
  }
  return bad
}

/** Integer or null. "6", "6.0", "6 days" -> 6; anything else -> null with ok:false. */
function parseInt0(v) {
  const s = cleanCell(v)
  if (s === '') return { value: null, ok: true }
  const m = String(s).replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)(?:\s*days?)?$/i)
  if (!m) return { value: null, ok: false }
  return { value: Math.round(Number(m[1])), ok: true }
}

function daysBetween(fromIso, toIso) {
  const [y1, m1, d1] = fromIso.split('-').map(Number)
  const [y2, m2, d2] = toIso.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

function todayIso(today) {
  if (typeof today === 'string') {
    const p = parseWorkshopDate(today)
    if (p.value) return p.value
  }
  const d = today instanceof Date ? today : new Date()
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

function colLetter(i) {
  let s = ''
  let n = i + 1
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

const isBlankRow = (row) => !row || row.every((c) => cleanCell(c) === '')
const nonEmptyCells = (row) => (row || []).map((c, i) => [i, cleanCell(c)]).filter(([, c]) => c !== '')
const FOOTER_RE = /^(grand\s*total|sub\s*total|total|printed\s*(by|on|date)|prepared\s*by|approved\s*by|page\s+\d+)/i
const CLOSED_RE = /closed/i

/**
 * Header mapping for a row: { columns: {field: colIndex}, headerMap: {field: headerText},
 * unmapped: [headerText] } or null when the row is not a header (needs asset_no
 * plus at least 2 other workshop fields).
 */
function headerMapping(row) {
  const columns = {}
  const headerMap = {}
  const unmapped = []
  for (const [i, text] of nonEmptyCells(row)) {
    if (text instanceof Date) return null
    const f = fieldForHeader(text)
    if (f && columns[f] == null) { columns[f] = i; headerMap[f] = text } else if (!f) unmapped.push(text)
  }
  if (columns.asset_no == null || Object.keys(columns).length < 3) return null
  return { columns, headerMap, unmapped }
}

// ── Sheet parser ──────────────────────────────────────────────────────────────

/**
 * Parse one sheet (array of arrays) into the workshop preview structure.
 * @param {Array<Array<*>>} aoa
 * @param {{ sheetName?: string, today?: Date|string }} [opts]
 */
export function parseWorkshopSheet(aoa, { sheetName = '', today } = {}) {
  const rowsIn = Array.isArray(aoa) ? aoa : []
  const sections = []
  const rows = []
  const unmappedSet = new Set()
  const headerMapAll = {}
  let reportDate = null
  let current = null
  let seenHeader = false

  for (let idx = 0; idx < rowsIn.length; idx++) {
    const row = rowsIn[idx] || []
    if (isBlankRow(row)) continue
    const mapping = headerMapping(row)

    if (mapping) {
      seenHeader = true
      // The non-empty single-cell row right above a header is the section title.
      let title = null
      for (let p = idx - 1; p >= 0; p--) {
        if (isBlankRow(rowsIn[p])) continue
        const cells = nonEmptyCells(rowsIn[p])
        if (cells.length === 1 && !(cells[0][1] instanceof Date) && !parseWorkshopDate(cells[0][1]).value) title = String(cells[0][1])
        break
      }
      for (const u of mapping.unmapped) unmappedSet.add(u)
      for (const [f, h] of Object.entries(mapping.headerMap)) if (headerMapAll[h] == null) headerMapAll[h] = f
      if (!title && current) {
        // A repeated header inside the same section: refresh the map, keep the section.
        current.columns = mapping.columns
        current.headerMap = mapping.headerMap
        current.headers = row.map((c) => cleanCell(c))
        continue
      }
      current = {
        title: title || sheetName || 'Vehicles',
        closed: CLOSED_RE.test(title || ''),
        headerRow: idx + 1,
        headerMap: mapping.headerMap,
        columns: mapping.columns,
        headers: row.map((c) => cleanCell(c)),
        rowCount: 0,
      }
      sections.push(current)
      continue
    }

    if (!seenHeader) {
      // Title band: the first date-like cell is the report date.
      if (!reportDate) {
        for (const [, c] of nonEmptyCells(row)) {
          if (c instanceof Date || /[a-z]{3}|[-/.]/i.test(c) || /^\d{5}$/.test(c)) {
            const p = parseWorkshopDate(c)
            if (p.value) { reportDate = p.value; break }
          }
        }
      }
      continue
    }

    const cells = nonEmptyCells(row)
    const assetCol = current.columns.asset_no
    const assetText = cleanCell(row[assetCol])
    // A lone text cell with no vehicle number is a section title reusing the
    // current headers (or a footer). It is never a data row.
    if (!assetText && cells.length === 1) {
      const t = String(cells[0][1])
      if (FOOTER_RE.test(t) || /^\d+$/.test(t)) continue
      const next = rowsIn.slice(idx + 1).find((r) => !isBlankRow(r))
      if (next && headerMapping(next)) continue // the header loop picks it up as a title
      current = { ...current, title: t, closed: CLOSED_RE.test(t), headerRow: idx + 1, rowCount: 0 }
      sections.push(current)
      continue
    }
    if (!assetText && cells.every(([, c]) => FOOTER_RE.test(String(c)))) continue

    rows.push(buildRow(row, idx + 1, current))
    current.rowCount++
  }

  // Days down needs the report date, which is known by now.
  const asOf = reportDate || todayIso(today)
  for (const r of rows) finishDates(r, asOf)
  classify(rows)

  const pick = (s) => rows.filter((r) => r.status === s)
  const active = pick('active')
  const closed = pick('closed')
  const invalid = pick('invalid')
  const duplicates = pick('duplicate')
  return {
    sheetName,
    reportDate,
    sections: sections.map(({ title, closed: c, headerRow, headerMap, columns, rowCount }) => ({
      title, closed: c, headerRow, headerMap, columns, rowCount,
    })),
    rows,
    active,
    closed,
    invalid,
    duplicates,
    unmappedHeaders: [...unmappedSet],
    headerMap: headerMapAll,
    summary: {
      totalRows: rows.length,
      active: active.length,
      closed: closed.length,
      invalid: invalid.length,
      duplicate: duplicates.length,
      sections: sections.length,
    },
  }
}

function buildRow(row, rowNumber, section) {
  const data = {}
  const raw = {}
  const errors = []
  const warnings = []
  row.forEach((c, i) => {
    const v = cleanCell(c)
    if (v === '') return
    const h = section.headers[i] || `Column ${colLetter(i)}`
    raw[h in raw ? `${h} (${colLetter(i)})` : h] = v instanceof Date ? parseWorkshopDate(v).value : v
  })
  for (const f of WORKSHOP_FIELDS) {
    const col = section.columns[f.key]
    const v = col == null ? '' : cleanCell(row[col])
    if (f.key === 'asset_no') { data.asset_no = v ? normaliseAssetNo(v) : null; continue }
    if (f.type === 'date') {
      const p = parseWorkshopDate(v)
      data[f.key] = p.value
      if (p.error) errors.push(`Invalid breakdown date: ${v instanceof Date ? 'unreadable' : v}`)
      continue
    }
    if (f.type === 'int') {
      const p = parseInt0(v)
      data[f.key] = p.value
      if (!p.ok) warnings.push(`Down days is not a number: ${v}`)
      continue
    }
    data[f.key] = v === '' ? null : String(v)
  }
  if (!data.asset_no) errors.unshift('Missing vehicle number')
  data.vehicle_category = section.closed ? null : section.title
  return {
    rowNumber,
    section: section.title,
    closed: section.closed,
    status: section.closed ? 'closed' : 'active',
    asset_no: data.asset_no,
    data,
    raw,
    errors,
    warnings,
  }
}

function finishDates(r, asOf) {
  const d = r.data
  d.days_down = null
  d.down_days_mismatch = false
  if (!d.ooc_since) return
  const n = daysBetween(d.ooc_since, asOf)
  if (n < 0) { r.warnings.push('Breakdown date is after the report date'); return }
  d.days_down = n
  if (d.excel_down_days != null && Math.abs(n - d.excel_down_days) > 1) {
    d.down_days_mismatch = true
    r.warnings.push(`Down days in the file (${d.excel_down_days}) differs from the breakdown date (${n})`)
  }
}

function classify(rows) {
  // Invalid first: no vehicle number, or (on an open row) an unreadable date.
  for (const r of rows) {
    if (!r.asset_no) { r.status = 'invalid'; continue }
    if (!r.closed && r.errors.length) r.status = 'invalid'
    // A closed row with a bad date is still closed evidence; the error becomes a warning.
    if (r.closed && r.errors.length) { r.warnings.push(...r.errors); r.errors = [] }
  }
  // Duplicates only among active rows; the first occurrence stays active.
  const seen = new Set()
  for (const r of rows) {
    if (r.status !== 'active') continue
    if (seen.has(r.asset_no)) { r.status = 'duplicate'; r.errors.push(`${r.asset_no} appeared more than once`) } else seen.add(r.asset_no)
  }
  // Active beats closed.
  const openAssets = new Set(rows.filter((r) => !r.closed && r.asset_no && (r.status === 'active' || r.status === 'duplicate')).map((r) => r.asset_no))
  for (const r of rows) {
    if (r.status === 'closed' && openAssets.has(r.asset_no)) r.warnings.push('Also listed as active')
  }
}

// ── Workbook + file ───────────────────────────────────────────────────────────

/**
 * Pick the best sheet of a parseWorkbookRaw result ({ sheets: [{ name, aoa }] })
 * and return its preview. Throws a clear Error for an empty or unrecognised file.
 */
export function parseWorkshopWorkbook(parsed, opts = {}) {
  const sheets = (parsed && Array.isArray(parsed.sheets) ? parsed.sheets : [])
    .filter((s) => !opts.sheetName || s.name === opts.sheetName)
  if (opts.sheetName && sheets.length === 0) throw new Error(`Sheet "${opts.sheetName}" was not found in the file.`)
  const hasContent = sheets.some((s) => (s.aoa || []).some((r) => !isBlankRow(r)))
  if (!hasContent) throw new Error('No workshop vehicle rows found. The file is empty.')

  let best = null
  let anyHeader = false
  for (const s of sheets) {
    const p = parseWorkshopSheet(s.aoa || [], { sheetName: s.name, today: opts.today })
    if (p.sections.length) anyHeader = true
    const score = p.summary.active + p.summary.closed
    if (!best || score > best.score) best = { score, preview: p }
  }
  if (!anyHeader) {
    throw new Error('The file has no vehicle number column. Expected a header such as ASSET NO. or Vehicle No. with the other workshop columns.')
  }
  if (!best || best.preview.summary.totalRows === 0) {
    throw new Error('No workshop vehicle rows found under the header rows.')
  }
  return best.preview
}

export const MAX_WORKSHOP_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_EXT = /\.(xlsx|xls|csv)$/i

/**
 * Read and parse an uploaded File/Blob. Returns { preview, fileHash, fileName,
 * fileSize }. Throws a clear Error for a wrong type, an empty or oversized file,
 * or a workbook with no workshop rows.
 */
export async function parseWorkshopFile(file, opts = {}) {
  if (!file) throw new Error('Choose a file to upload.')
  const name = file.name || ''
  if (!ALLOWED_EXT.test(name)) throw new Error('Only Excel (.xlsx, .xls) or CSV files can be uploaded.')
  if (!file.size) throw new Error('The file is empty.')
  if (file.size > MAX_WORKSHOP_FILE_BYTES) throw new Error('The file is larger than 10 MB.')
  const { parseWorkbookRaw, sha256OfArrayBuffer } = await import('../import/parseWorkbook.js')
  const buf = await file.arrayBuffer()
  let parsed
  try {
    parsed = await parseWorkbookRaw(buf, { fileName: name })
  } catch {
    throw new Error('The file could not be read. Save it again as .xlsx and retry.')
  }
  const preview = parseWorkshopWorkbook(parsed, opts)
  const fileHash = await sha256OfArrayBuffer(buf)
  return { preview, fileHash, fileName: name, fileSize: file.size }
}
