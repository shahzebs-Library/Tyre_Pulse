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

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }

/**
 * Pull a dollar amount that follows a label. The proforma renders numbers with the
 * digits split across text items ("5 | 34 , 641 . 02"), so we strip ALL whitespace
 * from a window after the label and require a `$` sign so a rate like "3.75" is not
 * mistaken for the amount.
 */
function grabDollar(text, labelRe) {
  const m = text.match(labelRe)
  if (!m) return null
  const window = text.slice(m.index + m[0].length, m.index + m[0].length + 80).replace(/\s+/g, '')
  const mm = window.match(/\$\s*(-?[\d,]+\.\d{2})/)
  return mm ? Number(mm[1].replace(/,/g, '')) : null
}

/**
 * Parse the SANY Service-Contract PROFORMA invoice (a USD document with per-machine
 * service charges and ONE net-of-deductions total) into a single ledger row for the
 * SANY import. Returns null when the text is not that proforma (so pdfRowsFor can
 * fall back to the summary parser).
 *
 * The returned row is keyed by the SANY import HEADERS so mapImportRows('sany', ...)
 * maps it directly. `amount` = gross USD * fx (the SAR figure Cost/M3 uses); the
 * gross/net/fx/deductions are carried through to their own columns for the record.
 *
 * @param {string[]|string} linesOrText
 * @returns {object|null}
 */
export function parseSanyProformaPdf(linesOrText) {
  const lines = Array.isArray(linesOrText) ? linesOrText : String(linesOrText || '').split(/\r?\n/)
  const text = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (!/proforma\s+invoice/i.test(text) || !/total\s+amount\s*\(usd\)/i.test(text)) return null

  const grossUsd = grabDollar(text, /total\s+amount\s*\(usd\)/i)
  if (grossUsd == null) return null
  const netUsd = grabDollar(text, /total\s+net\s+amount\s*\(usd\)/i)

  // FX rate "1 USD = 3.75 SAR".
  const fxM = text.match(/1\s*USD\s*=\s*([\d.]+)\s*SAR/i)
  const fxRate = fxM ? Number(fxM[1]) : 3.75

  // Deductions are the NEGATIVE dollar amounts ("- $ ...") - the only $ figures with
  // a leading minus (gross/net have none). The word "Deduction" is often split across
  // text items ("Deduct ion", "D eduction"), so we anchor on the "-$" amount and take
  // the label from the words after the preceding " of ".
  const deductions = []
  const negRe = /[-–]\s*\$\s*([\d ,]+\.\s*\d{2})/g
  let prevEnd = 0
  let nm
  while ((nm = negRe.exec(text)) !== null) {
    const amt = Number(nm[1].replace(/\s+/g, '').replace(/,/g, ''))
    const seg = text.slice(prevEnd, nm.index)
    const ofIdx = seg.toLowerCase().lastIndexOf(' of ')
    const label = (ofIdx >= 0 ? seg.slice(ofIdx + 4) : seg)
      .replace(/\(currency rate[^)]*\)/i, '')
      .replace(/[^A-Za-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (Number.isFinite(amt) && amt > 0) deductions.push({ label: label || 'Deduction', amount_usd: amt })
    prevEnd = negRe.lastIndex
  }

  // Reference number (Ref. No. SYDU202 504 15 -> SYDU20250415).
  const refM = text.match(/Ref\.?\s*No\.?\s*:?\s*([A-Z0-9]+(?:\s+[A-Z0-9]+){0,2})/i)
  let invoiceNo = refM ? refM[1].replace(/\s+/g, '') : ''
  if (!invoiceNo) {
    const scM = text.match(/Service\s*Contract\s*NO\.?\s*:?\s*([A-Z0-9]+)/i)
    invoiceNo = scM ? scM[1] : `SANY-${grossUsd}`
  }

  // Service period + invoice date from YYYY-Mon-DD tokens (digits are fragmented, so
  // match against the whitespace-stripped text). First = period start, last = invoice date.
  const compact = text.replace(/\s+/g, '')
  const dre = /(\d{4})-([A-Za-z]{3})[a-z]*-(\d{1,2})/g
  const isoDates = []
  let dt
  while ((dt = dre.exec(compact)) !== null) {
    const mm = MONTHS[dt[2].toLowerCase()]
    if (mm) isoDates.push(`${dt[1]}-${mm}-${String(dt[3]).padStart(2, '0')}`)
  }
  const startDate = isoDates[0] || null
  const invoiceDate = isoDates[isoDates.length - 1] || startDate
  const periodMonth = invoiceDate ? `${invoiceDate.slice(0, 7)}-01` : null

  const periodText = startDate && invoiceDate ? `${startDate} to ${invoiceDate}` : (invoiceDate || '')
  const grossSar = Math.round(grossUsd * fxRate * 100) / 100

  return {
    Country: 'KSA',
    'Doc Type': 'proforma',
    'Quotation No': invoiceNo,
    Date: invoiceDate || '',
    'Parts Description': `SANY service contract${periodText ? ' ' + periodText : ''}`,
    'Amount (SAR) / Cost': grossSar,
    Currency: 'USD',
    'Gross Amount (USD)': grossUsd,
    'Net Amount (USD)': netUsd,
    'FX Rate': fxRate,
    Deductions: deductions,
    Remarks: `Gross USD ${grossUsd}, net USD ${netUsd ?? 'N/A'} after ${deductions.length} deduction(s); 1 USD = ${fxRate} SAR.`,
    __period_month: periodMonth,
  }
}

/**
 * Map a PDF file to import rows for a ledger kind. Only SANY is supported (both the
 * service-contract proforma and the summary list); other kinds throw a clear message.
 * @param {'sany'} kind @param {File|ArrayBuffer} file
 */
export async function pdfRowsFor(kind, file) {
  if (kind !== 'sany') {
    throw new Error('PDF upload is only supported for SANY invoices. Use .xlsx / .csv for this one.')
  }
  const lines = await extractPdfLines(file)
  // Prefer the service-contract proforma; fall back to the region/date/amount summary.
  const proforma = parseSanyProformaPdf(lines)
  if (proforma) {
    const { __period_month, ...row } = proforma
    if (__period_month) row.Date = row.Date || __period_month
    return [row]
  }
  const rows = parseSanyPdfRows(lines)
  if (!rows.length) throw new Error('No SANY invoice rows found in this PDF. Use the service-contract proforma, or the summary (Region / Date / Quotation No / Amount) list.')
  return rows
}
