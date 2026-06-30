/**
 * Import Center — workbook/CSV parser.
 *
 * Pure, browser-friendly parsing engine for the Data Intake Center. Accepts an
 * ArrayBuffer, a Uint8Array, a string, or a Blob/File and returns a normalised,
 * multi-sheet structure with:
 *   - smart header-row detection (densest, label-heavy row),
 *   - Excel serial-date awareness (cellDates),
 *   - CSV/TSV/PSV delimiter sniffing,
 *   - NO dropping of unknown columns,
 *   - row objects keyed by (de-duplicated) header.
 *
 * Also exports content/row hashing helpers for de-duplication:
 *   - sha256OfArrayBuffer  → file-level dedupe key (Web Crypto).
 *   - rowFingerprint       → stable per-row hash of normalised values.
 *
 * @module import/parseWorkbook
 */

import * as XLSX from 'xlsx'

/**
 * @typedef {Object} ParsedColumn
 * @property {number} index  Zero-based column index within the header row.
 * @property {string} header De-duplicated, trimmed header label.
 */

/**
 * @typedef {Object} ParsedSheet
 * @property {string} name                     Sheet name (CSV → "Sheet1").
 * @property {number} sheetOrder               Zero-based position in the workbook.
 * @property {number} headerRow                Zero-based index of the detected header row.
 * @property {ParsedColumn[]} columns          Ordered columns.
 * @property {Array<Record<string,*>>} rows    Row objects keyed by header.
 */

/**
 * @typedef {Object} ParsedWorkbook
 * @property {ParsedSheet[]} sheets
 */

const TEXT_EXT_HINT = /\.(csv|tsv|txt|psv)$/i

/* ── Low-level coercion helpers ─────────────────────────────────────────────── */

const NUMERIC_RE = /^-?[\d,]+(\.\d+)?$/
const DATEISH_RE = /^\d{1,4}[/\-.]\d{1,2}([/\-.]\d{1,4})?/

/** True for a non-empty text cell that is not purely numeric/date-like. */
function isLabelCell(v) {
  if (v === null || v === undefined) return false
  const s = String(v).trim()
  if (!s) return false
  if (NUMERIC_RE.test(s.replace(/\s/g, ''))) return false
  if (DATEISH_RE.test(s)) return false
  return true
}

/**
 * Detect the most likely header row in an array-of-arrays.
 * Headers are densely filled with short, unique text labels and are followed by
 * populated data rows. Returns a zero-based row index.
 *
 * @param {Array<Array<*>>} aoa
 * @returns {number}
 */
export function detectHeaderRow(aoa) {
  if (!aoa || aoa.length === 0) return 0
  const scan = Math.min(aoa.length, 25)
  const width = Math.max(1, ...aoa.slice(0, scan).map((r) => (r ? r.length : 0)))
  let best = { idx: 0, score: -Infinity }

  for (let r = 0; r < scan; r++) {
    const row = aoa[r] || []
    const cells = row.map((c) => (c == null ? '' : String(c).trim()))
    const nonEmpty = cells.filter((c) => c !== '').length
    if (nonEmpty < 2) continue

    const labels = cells.filter(isLabelCell).length
    const uniq = new Set(cells.filter(Boolean)).size
    const avgLen = cells.filter(Boolean).reduce((a, c) => a + c.length, 0) / nonEmpty

    let below = 0
    for (let k = r + 1; k < Math.min(aoa.length, r + 8); k++) {
      const fc = (aoa[k] || []).filter((c) => c != null && String(c).trim() !== '').length
      if (fc >= Math.max(2, nonEmpty * 0.5)) below++
    }
    if (below === 0) continue

    const labelRatio = labels / nonEmpty
    const density = nonEmpty / width
    const uniqRatio = uniq / nonEmpty
    const lenPenalty = avgLen > 40 ? -1.5 : 0

    const score =
      labelRatio * 3 + density * 2 + uniqRatio * 1.5 + Math.min(below, 5) * 0.2 + lenPenalty - r * 0.05
    if (score > best.score) best = { idx: r, score }
  }
  return best.idx
}

/**
 * Clean a header array: blanks → "Column N", de-duplicate collisions so every
 * column key is unique (row objects stay lossless even with repeated headers).
 *
 * @param {Array<*>} arr
 * @returns {string[]}
 */
export function cleanHeaders(arr) {
  /** @type {Record<string, number>} */
  const seen = {}
  return (arr || []).map((h, i) => {
    let name = h == null ? '' : String(h).trim()
    if (!name) name = `Column ${i + 1}`
    if (seen[name] != null) {
      seen[name] += 1
      name = `${name} (${seen[name]})`
    } else {
      seen[name] = 0
    }
    return name
  })
}

/**
 * Sniff the delimiter of delimited text (comma, semicolon, tab, pipe).
 * @param {string} text
 * @returns {string}
 */
export function sniffDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '') || ''
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 }
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && ch in counts) counts[ch] += 1
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return n > 0 ? best : ','
}

/**
 * Parse delimited text → array-of-arrays, honouring quoted fields and escaped
 * quotes. Robust to semicolon/tab/pipe files that a naive CSV reader collapses.
 *
 * @param {string} text
 * @returns {Array<string[]>}
 */
export function parseDelimitedText(text) {
  const delim = sniffDelimiter(text)
  /** @type {Array<string[]>} */
  const aoa = []
  for (const line of text.split(/\r?\n/)) {
    if (line === '') {
      aoa.push([])
      continue
    }
    const out = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"'
            i++
          } else q = false
        } else cur += ch
      } else if (ch === '"') q = true
      else if (ch === delim) {
        out.push(cur)
        cur = ''
      } else cur += ch
    }
    out.push(cur)
    aoa.push(out)
  }
  return aoa
}

/* ── Sheet extraction ───────────────────────────────────────────────────────── */

/**
 * Build a normalised sheet from an array-of-arrays.
 *
 * @param {Array<Array<*>>} aoa
 * @param {string} name
 * @param {number} sheetOrder
 * @param {number|null} [forcedHeaderRow]
 * @returns {ParsedSheet}
 */
export function sheetFromAoa(aoa, name, sheetOrder, forcedHeaderRow = null) {
  const safeAoa = Array.isArray(aoa) ? aoa : []
  const firstPopulated = safeAoa.findIndex((r) => (r || []).some((c) => c != null && String(c).trim() !== ''))

  let headerRow = forcedHeaderRow != null ? forcedHeaderRow : detectHeaderRow(safeAoa)

  const build = (idx) => {
    const headers = cleanHeaders(safeAoa[idx] || [])
    const dataRows = safeAoa
      .slice(idx + 1)
      .filter((r) => (r || []).some((c) => c !== '' && c != null && String(c).trim() !== ''))
      .map((r) => {
        /** @type {Record<string,*>} */
        const obj = {}
        headers.forEach((h, ci) => {
          const v = r ? r[ci] : undefined
          obj[h] = v === undefined ? '' : v
        })
        return obj
      })
    return { headers, dataRows }
  }

  let { headers, dataRows } = build(headerRow)

  // Fallback 1 — detection yielded no data rows: use first populated row.
  if (forcedHeaderRow == null && dataRows.length === 0 && firstPopulated >= 0 && firstPopulated !== headerRow) {
    headerRow = firstPopulated
    ;({ headers, dataRows } = build(headerRow))
  }
  // Fallback 2 — still nothing: take the densest of the first 30 rows.
  if (forcedHeaderRow == null && dataRows.length === 0 && firstPopulated >= 0) {
    let densest = firstPopulated
    let max = -1
    for (let i = 0; i < Math.min(safeAoa.length, 30); i++) {
      const n = (safeAoa[i] || []).filter((c) => c != null && String(c).trim() !== '').length
      if (n > max) {
        max = n
        densest = i
      }
    }
    headerRow = densest
    ;({ headers, dataRows } = build(headerRow))
  }

  const columns = headers.map((header, index) => ({ index, header }))
  return { name, sheetOrder, headerRow, columns, rows: dataRows }
}

/* ── Input normalisation ────────────────────────────────────────────────────── */

/**
 * Coerce any accepted input into an ArrayBuffer.
 * @param {ArrayBuffer|Uint8Array|string|Blob} input
 * @returns {Promise<ArrayBuffer>}
 */
async function toArrayBuffer(input) {
  if (input == null) throw new Error('parseWorkbook: empty input')
  if (input instanceof ArrayBuffer) return input
  if (typeof input === 'string') return new TextEncoder().encode(input).buffer
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
  }
  if (typeof input.arrayBuffer === 'function') return input.arrayBuffer()
  throw new Error('parseWorkbook: unsupported input type')
}

/** Heuristic: does this buffer look like delimited text rather than a workbook? */
function looksLikeText(bytes) {
  // XLSX/XLS magic numbers: PK (zip) or D0 CF 11 E0 (OLE2).
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return false
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return false
  }
  // Sample the first chunk for control bytes that indicate binary content.
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096))
  let suspicious = 0
  for (const b of sample) {
    if (b === 0) return false
    if (b < 9 || (b > 13 && b < 32)) suspicious++
  }
  return suspicious / Math.max(1, sample.length) < 0.05
}

/* ── Public API ─────────────────────────────────────────────────────────────── */

/**
 * Parse a workbook or delimited-text file into a normalised, multi-sheet object.
 * Never drops unknown columns; every source column is preserved verbatim.
 *
 * @param {ArrayBuffer|Uint8Array|string|Blob|File} arrayBufferOrFile
 * @param {{ fileName?: string }} [opts]
 * @returns {Promise<ParsedWorkbook>}
 */
export async function parseWorkbook(arrayBufferOrFile, opts = {}) {
  const fileName = opts.fileName || (arrayBufferOrFile && arrayBufferOrFile.name) || ''
  const buf = await toArrayBuffer(arrayBufferOrFile)
  const bytes = new Uint8Array(buf)

  const extHintsText = TEXT_EXT_HINT.test(fileName)
  const preferText = extHintsText || (!fileName && looksLikeText(bytes))

  /** Parse as delimited text → single-sheet workbook. */
  const asText = () => {
    const text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
    if (!text.trim()) throw new Error('no text content')
    const aoa = parseDelimitedText(text)
    return { sheets: [sheetFromAoa(aoa, 'Sheet1', 0)] }
  }

  /** Parse as binary workbook → multi-sheet. */
  const asBinary = () => {
    const wb = XLSX.read(bytes, { type: 'array', cellDates: true, raw: false })
    if (!wb.SheetNames || wb.SheetNames.length === 0) throw new Error('workbook has no sheets')
    const sheets = wb.SheetNames.map((name, sheetOrder) => {
      const ws = wb.Sheets[name]
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: true })
      return sheetFromAoa(aoa, name, sheetOrder)
    })
    return { sheets }
  }

  // Try the preferred path first, fall back to the other so a mislabelled file
  // (.csv that is really .xlsx, or vice-versa) still imports.
  if (preferText) {
    try {
      return asText()
    } catch {
      return asBinary()
    }
  }
  try {
    return asBinary()
  } catch {
    return asText()
  }
}

/* ── Hashing helpers ────────────────────────────────────────────────────────── */

/**
 * Convert raw bytes to lowercase hex.
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {string}
 */
function toHex(buf) {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0')
  return out
}

/**
 * SHA-256 of a file/buffer for content-level dedupe. Uses Web Crypto when
 * available (browser + Node 20+ globalThis.crypto.subtle).
 *
 * @param {ArrayBuffer|Uint8Array|string} buf
 * @returns {Promise<string>} lowercase hex digest
 */
export async function sha256OfArrayBuffer(buf) {
  let data
  if (typeof buf === 'string') data = new TextEncoder().encode(buf)
  else if (buf instanceof Uint8Array) data = buf
  else data = new Uint8Array(buf)

  const subtle = globalThis.crypto && globalThis.crypto.subtle
  if (subtle && typeof subtle.digest === 'function') {
    const digest = await subtle.digest('SHA-256', data)
    return toHex(digest)
  }
  // Deterministic non-crypto fallback (FNV-1a 64-bit) for environments without
  // Web Crypto — still stable for dedupe within a session.
  return fnv1a64Hex(data)
}

/**
 * FNV-1a 64-bit over bytes → 16-char hex. Deterministic, dependency-free.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function fnv1a64Hex(bytes) {
  // Use BigInt to avoid precision loss across 64 bits.
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i])
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * Normalise a single cell value for fingerprinting: dates → ISO date, numbers →
 * trimmed numeric string, everything else → lowercased trimmed string.
 * @param {*} v
 * @returns {string}
 */
function normaliseValueForHash(v) {
  if (v == null) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  return String(v).trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Stable fingerprint of a raw row object: sorts keys, normalises values, and
 * hashes the canonical "key=value" stream. Order-independent and whitespace/
 * case-insensitive so trivially-different copies collide.
 *
 * Synchronous (non-crypto FNV-1a) so it can be used in tight loops over many
 * rows without awaiting; use sha256OfArrayBuffer for cryptographic file keys.
 *
 * @param {Record<string,*>} rawRowObj
 * @returns {string} 16-char hex digest
 */
export function rowFingerprint(rawRowObj) {
  if (!rawRowObj || typeof rawRowObj !== 'object') return fnv1a64Hex(new Uint8Array())
  const keys = Object.keys(rawRowObj).sort()
  const parts = []
  for (const k of keys) {
    const val = normaliseValueForHash(rawRowObj[k])
    if (val === '') continue
    parts.push(`${k.toLowerCase()}=${val}`)
  }
  return fnv1a64Hex(new TextEncoder().encode(parts.join('')))
}
