/**
 * parsePdf - client-side PDF text extraction (pdf.js, lazy-loaded) + a parser for
 * the SANY summary invoice format:
 *   NO | REGION | DATE | QUOTATION NO | AMOUNT (SAR)   ... TOTAL (SAR)
 *
 * pdf.js is dynamically imported so it never lands in the main bundle. The parser
 * is pure (text -> rows) so it is unit-testable without a browser.
 */

let _pdfjs = null
async function getPdfjs() {
  if (_pdfjs) return _pdfjs
  const pdfjs = await import('pdfjs-dist')
  try {
    // Vite resolves the worker as an asset URL; ignore if unavailable (fake worker).
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  } catch { /* fall back to the main-thread fake worker */ }
  _pdfjs = pdfjs
  return pdfjs
}

/**
 * Extract text from a PDF as an array of visual lines (items grouped by y-position,
 * left-to-right). @param {File|ArrayBuffer} fileOrBuffer @returns {Promise<string[]>}
 */
export async function extractPdfLines(fileOrBuffer) {
  const pdfjs = await getPdfjs()
  const buf = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  const lines = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const byY = new Map()
    for (const it of content.items) {
      if (!it.str) continue
      const y = Math.round(it.transform[5])
      if (!byY.has(y)) byY.set(y, [])
      byY.get(y).push(it)
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      const line = byY.get(y)
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()
      if (line) lines.push(line)
    }
  }
  return lines
}

const isDate = (s) => /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(String(s || '').trim())
const isMoney = (s) => {
  const t = String(s || '').replace(/,/g, '').trim()
  return /^\d+(\.\d+)?$/.test(t)
}

/**
 * Parse SANY summary rows from extracted lines (or a raw text blob). Robust to two
 * layouts: one record per line, OR each field on its own line. Returns row objects
 * keyed by the SANY summary headers so mapImportRows('sany') maps them directly.
 *
 * @param {string[]|string} linesOrText
 * @returns {Array<{Region:string, Date:string, 'Quotation No':string, 'Amount (SAR)':string}>}
 */
export function parseSanyPdfRows(linesOrText) {
  const lines = (Array.isArray(linesOrText) ? linesOrText : String(linesOrText || '').split(/\r?\n/))
    .map((l) => String(l).trim()).filter(Boolean)
  const rows = []
  let region = ''
  let pending = null // { date, quotParts: [] } while waiting for an amount on later lines

  const flush = (amount) => {
    if (!pending) return
    rows.push({
      Region: region ? `${region} Region` : '',
      Date: pending.date,
      'Quotation No': pending.quotParts.join(' ').trim(),
      'Amount (SAR)': amount,
    })
    pending = null
  }

  for (const line of lines) {
    // Track region ("Western Region" / "Central Region").
    const rm = line.match(/([A-Za-z]+)\s+region\b/i)
    if (rm) region = rm[1]

    const parts = line.split(/\s+/)
    const dateIdx = parts.findIndex(isDate)

    if (dateIdx >= 0) {
      // A new record starts; if a previous one was still waiting, drop it (no amount).
      pending = null
      const after = parts.slice(dateIdx + 1)
      // amount = the LAST money token on the line (so a quot like "GCC 10" is not
      // mistaken for the amount); quot = tokens between date and that amount.
      let amtPos = -1
      for (let k = after.length - 1; k >= 0; k--) { if (isMoney(after[k]) && !isDate(after[k])) { amtPos = k; break } }
      if (amtPos >= 0) {
        rows.push({
          Region: region ? `${region} Region` : '',
          Date: parts[dateIdx],
          'Quotation No': after.slice(0, amtPos).join(' ').trim(),
          'Amount (SAR)': after[amtPos],
        })
      } else {
        pending = { date: parts[dateIdx], quotParts: after.slice() }
      }
      continue
    }

    // No date on this line - if a record is pending, this is its quot and/or amount.
    // A standalone money token, or a decimal amount, closes the record; a bare
    // integer that shares a line with other tokens (e.g. quot "GCC 10") is quot.
    if (pending) {
      if (parts.length === 1 && isMoney(parts[0])) { flush(parts[0]); continue }
      const hasDecimal = (s) => /^\d[\d,]*\.\d+$/.test(String(s).trim())
      let amtPos = -1
      for (let k = parts.length - 1; k >= 0; k--) { if (hasDecimal(parts[k])) { amtPos = k; break } }
      if (amtPos >= 0) {
        pending.quotParts.push(...parts.slice(0, amtPos))
        flush(parts[amtPos])
      } else {
        pending.quotParts.push(...parts)
      }
    }
  }
  return rows
}

/**
 * Map a PDF file to import rows for a ledger kind. Only SANY (summary) is supported;
 * other kinds throw a clear message.
 * @param {'sany'} kind @param {File|ArrayBuffer} file
 */
export async function pdfRowsFor(kind, file) {
  if (kind !== 'sany') {
    throw new Error('PDF upload is only supported for SANY invoices. Use .xlsx / .csv for this one.')
  }
  const lines = await extractPdfLines(file)
  const rows = parseSanyPdfRows(lines)
  if (!rows.length) throw new Error('No SANY invoice rows found in this PDF. Check it is the summary (Region / Date / Quotation No / Amount) list.')
  return rows
}
