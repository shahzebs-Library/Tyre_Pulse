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
 * Extract every text item of a PDF with its page and position.
 * @param {File|ArrayBuffer} fileOrBuffer
 * @returns {Promise<Array<{page:number, x:number, y:number, str:string}>>}
 */
export async function extractPdfItems(fileOrBuffer) {
  const pdfjs = await getPdfjs()
  const buf = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  const items = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    for (const it of content.items) {
      if (!it.str || !String(it.str).trim()) continue
      items.push({ page: p, x: Math.round(it.transform[4]), y: Math.round(it.transform[5]), str: it.str })
    }
  }
  return items
}

/**
 * Fold positioned text items into visual lines (grouped by y, left to right,
 * page order). Pure so it can be unit-tested without a browser.
 * @param {Array<{page?:number, x:number, y:number, str:string}>} items
 * @returns {string[]}
 */
export function pdfItemsToLines(items) {
  const out = []
  const pages = [...new Set((items || []).map((i) => i.page || 1))].sort((a, b) => a - b)
  for (const p of pages) {
    const byY = new Map()
    for (const it of items) {
      if ((it.page || 1) !== p) continue
      if (!byY.has(it.y)) byY.set(it.y, [])
      byY.get(it.y).push(it)
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      const line = byY.get(y).sort((a, b) => a.x - b.x).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()
      if (line) out.push(line)
    }
  }
  return out
}

/**
 * Extract text from a PDF as an array of visual lines (items grouped by y-position,
 * left-to-right). @param {File|ArrayBuffer} fileOrBuffer @returns {Promise<string[]>}
 */
export async function extractPdfLines(fileOrBuffer) {
  return pdfItemsToLines(await extractPdfItems(fileOrBuffer))
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

/* ------------------------------------------------------------------ *
 * SANY proforma PER-MACHINE LINE TABLE
 *
 * The table is drawn as 6 columns:
 *   Machinery | Charge Standard | Activation Date | Units | Details | Total Amount (USD)
 * but the text is heavily fragmented: one logical row is split across many
 * y-positions, ordinal suffixes ("st", "nd", "rd", "th") sit on their own
 * baseline, and a single amount can arrive as three items ("$161" "," "916.31").
 * Row-by-row parsing on y alone therefore does not work.
 *
 * The reliable anchor is the AMOUNT: every table row ends in a $N,NNN.NN token
 * in the rightmost column. Each amount defines one line; the tight columns
 * (activation date / units / details) sit within a few points of it, so they are
 * read by y-proximity. The Machinery and Charge Standard cells are frequently
 * MERGED across several rows (one machine, several contract years), so their
 * text is attributed by block, and a row that a block does not cover inherits
 * the block above it. Anything that cannot be read confidently stays null.
 * ------------------------------------------------------------------ */

// Column left edges when the header row cannot be read (points, from the real files).
const SANY_COL_FALLBACK = { machinery: 33, charge: 186, activation: 265, units: 342, details: 390, amount: 506 }
const SANY_COL_ORDER = ['machinery', 'charge', 'activation', 'units', 'details', 'amount']
// A gap larger than this (points) between visual lines starts a new cell block.
const SANY_BLOCK_GAP = 14
// Items within this many points share one visual line (superscripts sit ~3pt up).
const SANY_LINE_TOL = 4
// How far from the amount a same-row value may sit.
const SANY_NEAR_TOL = 8
const SANY_PCT_TOL = 10

const tidyCell = (s) => String(s || '')
  .replace(/\s+/g, ' ')
  // Superscripts arrive as their own text item on their own baseline, so they land
  // with a space either side ("SANY240m 3 /h", "3 rd Year") - close those up.
  .replace(/\s*([²³°])\s*/g, '$1')
  .replace(/(\d)\s+(st|nd|rd|th)\b/gi, '$1$2')
  .trim()

/** Group items of one column into visual lines, top to bottom. */
function sanyVisualLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y)
  const groups = []
  let cur = null
  for (const it of sorted) {
    if (cur && cur.y - it.y <= SANY_LINE_TOL) cur.items.push(it)
    else { cur = { y: it.y, items: [it] }; groups.push(cur) }
  }
  return groups.map((g) => ({
    y: g.y,
    text: tidyCell(g.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(' ')),
    raw: g.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(''),
  }))
}

/** Split visual lines into cell blocks wherever the vertical gap is large. */
function sanyBlocks(lines) {
  const blocks = []
  let cur = null
  for (const l of lines) {
    if (cur && cur.bottom - l.y <= SANY_BLOCK_GAP) { cur.lines.push(l); cur.bottom = l.y }
    else { cur = { top: l.y, bottom: l.y, lines: [l] }; blocks.push(cur) }
  }
  return blocks
}

const sanyBlockText = (b) => (b ? tidyCell(b.lines.map((l) => l.text).join(' ')) : null)

/** A model code is an all-caps/digit token line ("SY412C-8", "HZS240C8H"). */
const isModelLine = (s) => /^[A-Z]{2,4}[0-9][A-Z0-9-]*(\s+[A-Z0-9.\-/]+)*$/.test(String(s || '').trim())

function sanyMachineryFields(block) {
  if (!block) return { machinery: null, model: null }
  const texts = block.lines.map((l) => l.text).filter(Boolean)
  const modelIdx = texts.map((t, i) => (isModelLine(t) ? i : -1)).filter((i) => i >= 0)
  // Only claim a model when exactly ONE line looks like a code; a merged cell that
  // lists two codes cannot be split per row, so the text stays whole and model null.
  if (modelIdx.length !== 1) return { machinery: tidyCell(texts.join(' ')) || null, model: null }
  const model = texts[modelIdx[0]]
  const rest = texts.filter((_, i) => i !== modelIdx[0])
  return { machinery: tidyCell(rest.join(' ')) || null, model: model || null }
}

/** Pick the contract-year phrase that matches this row's applied percentage. */
function sanyContractYear(chargeText, appliedPct) {
  if (!chargeText) return null
  const re = /((?:\d(?:st|nd|rd|th)?)(?:\s*(?:&|and)\s*\d(?:st|nd|rd|th)?)?\s*(?:th)?\s*Year)\s*(?:Annually)?\s*(\d{1,2})\s*%/gi
  const segs = []
  let m
  while ((m = re.exec(chargeText)) !== null) segs.push({ year: tidyCell(m[1]), pct: Number(m[2]) })
  if (!segs.length) return null
  if (appliedPct != null) {
    const hits = segs.filter((s) => s.pct === appliedPct)
    if (hits.length === 1) return hits[0].year
    if (hits.length > 1) return null
  }
  return segs.length === 1 ? segs[0].year : null
}

function sanyIsoDate(raw) {
  const t = String(raw || '').replace(/\s+/g, '')
  const m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?-([A-Za-z]{3,9})-(\d{4})$/i)
  if (!m) return null
  const mm = MONTHS[m[2].slice(0, 3).toLowerCase()]
  return mm ? `${m[3]}-${mm}-${String(m[1]).padStart(2, '0')}` : null
}

// Word boundaries are load bearing: a bare /vat/ matches "Exca(vat)or" and would
// cut the table short, silently dropping every machine line below an excavator.
const SANY_SUMMARY_RE = /\b(total\s*(net\s*)?amount|deduction|discount|vat)\b|^\s*say\s*:/i

/**
 * Parse the per-machine line table of a SANY service-contract proforma from
 * positioned text items.
 *
 * @param {Array<{page?:number, x:number, y:number, str:string}>} items
 * @returns {{lines: Array<object>, total_usd: number|null}}
 */
export function parseSanyProformaLineItems(items) {
  const all = (Array.isArray(items) ? items : []).filter((i) => i && i.str != null && Number.isFinite(i.x) && Number.isFinite(i.y))
  if (!all.length) return { lines: [], total_usd: null }

  // ---- column boundaries (from the header row, else the known template) ----
  let lefts = { ...SANY_COL_FALLBACK }
  let headerPage = null
  let headerY = null
  const machItem = all.find((i) => /^machinery$/i.test(String(i.str).trim()))
  if (machItem) {
    headerPage = machItem.page || 1
    // Only the header page may define the columns: "Date" also appears in the
    // signature block, and a stray match there would move a boundary.
    const onHeaderPage = all.filter((i) => (i.page || 1) === headerPage)
    const pick = (re) => {
      const hit = onHeaderPage.filter((i) => re.test(String(i.str).trim()))
      return hit.length ? Math.min(...hit.map((i) => i.x)) : null
    }
    const cand = {
      machinery: machItem.x,
      charge: pick(/^(charge|standard)$/i),
      activation: pick(/^(activation|date)$/i),
      units: pick(/^units$/i),
      details: pick(/^details$/i),
      amount: pick(/^(total amount|\(usd\))$/i),
    }
    const complete = SANY_COL_ORDER.every((k) => cand[k] != null)
    const ordered = SANY_COL_ORDER.every((k, i) => i === 0 || cand[SANY_COL_ORDER[i - 1]] < cand[k])
    // A partial or out-of-order header cannot be trusted; keep the template edges.
    if (complete && ordered) lefts = cand
    const hdrYs = onHeaderPage
      .filter((i) => /^(machinery|charge|standard|activation|units|details|total amount|\(usd\))$/i.test(String(i.str).trim()))
      .map((i) => i.y)
    if (hdrYs.length) headerY = Math.min(...hdrYs)
  }
  const bounds = []
  for (let k = 0; k < SANY_COL_ORDER.length - 1; k++) {
    bounds.push((lefts[SANY_COL_ORDER[k]] + lefts[SANY_COL_ORDER[k + 1]]) / 2)
  }
  const colOf = (x) => {
    for (let k = 0; k < bounds.length; k++) if (x < bounds[k]) return SANY_COL_ORDER[k]
    return 'amount'
  }

  const out = []
  let carriedMachinery = null
  let carriedCharge = null
  const pages = [...new Set(all.map((i) => i.page || 1))].sort((a, b) => a - b)

  for (const p of pages) {
    let pageItems = all.filter((i) => (i.page || 1) === p)
    // Drop anything above the column header (the "Involved Equipment" summary).
    if (headerY != null && p === headerPage) pageItems = pageItems.filter((i) => i.y < headerY - 2)
    // Drop the totals / deductions / bank block below the table. The header cell
    // is also called "Total Amount" - it sits in the amount column, so only a
    // label OUTSIDE that column ends the table.
    const cutYs = pageItems.filter((i) => SANY_SUMMARY_RE.test(String(i.str).trim()) && colOf(i.x) !== 'amount').map((i) => i.y)
    const cutY = cutYs.length ? Math.max(...cutYs) : null
    if (cutY != null) pageItems = pageItems.filter((i) => i.y > cutY + 2)
    if (!pageItems.length) continue

    const byCol = {}
    for (const k of SANY_COL_ORDER) byCol[k] = pageItems.filter((i) => colOf(i.x) === k)

    // ---- amounts = the row anchors ----
    const anchors = []
    for (const l of sanyVisualLines(byCol.amount)) {
      const t = l.raw.replace(/\s+/g, '')
      const m = t.match(/^(-)?\$?(-)?([\d,]+\.\d{2})$/)
      if (!m) continue
      if (m[1] || m[2]) continue // a negative figure is a deduction, never a line
      anchors.push({ y: l.y, amount: Number(m[3].replace(/,/g, '')) })
    }
    if (!anchors.length) continue
    anchors.sort((a, b) => b.y - a.y)

    const gaps = anchors.slice(1).map((a, i) => anchors[i].y - a.y).filter((g) => g > 0).sort((a, b) => a - b)
    const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 50

    // ---- merged Machinery / Charge cells ----
    // The two columns share row spans in this template, but only the charge column
    // separates cleanly on vertical gaps (the machinery cell has a blank line
    // between the description and the model code). So the charge blocks define the
    // boundaries and the machinery text is partitioned on the same cuts.
    const chargeBlocks = sanyBlocks(sanyVisualLines(byCol.charge))
    const cuts = []
    for (let k = 0; k < chargeBlocks.length - 1; k++) cuts.push((chargeBlocks[k].bottom + chargeBlocks[k + 1].top) / 2)
    const machLines = sanyVisualLines(byCol.machinery)
    const machBlocks = chargeBlocks.map((_, k) => {
      const hi = k === 0 ? Infinity : cuts[k - 1]
      const lo = k === cuts.length ? -Infinity : cuts[k]
      const ls = machLines.filter((l) => l.y <= hi && l.y > lo)
      return ls.length ? { top: ls[0].y, bottom: ls[ls.length - 1].y, lines: ls } : null
    })

    // A row above the first block (plus half a row of slack) continues a cell that
    // started on the previous page.
    const firstTop = chargeBlocks.length ? chargeBlocks[0].top + pitch / 2 : -Infinity
    const blockIndexFor = (y) => {
      if (!chargeBlocks.length || y > firstTop) return -1
      for (let k = 0; k < cuts.length; k++) if (y > cuts[k]) return k
      return chargeBlocks.length - 1
    }

    const near = (col, y, tol) => tidyCell(byCol[col].filter((i) => Math.abs(i.y - y) <= tol).sort((a, b) => a.x - b.x).map((i) => i.str).join(' '))

    for (const a of anchors) {
      const bi = blockIndexFor(a.y)
      if (bi >= 0) {
        const ct = sanyBlockText(chargeBlocks[bi])
        if (ct) carriedCharge = ct
        const mf = sanyMachineryFields(machBlocks[bi])
        if (mf.machinery || mf.model) carriedMachinery = mf
      }
      const detail = near('details', a.y, SANY_NEAR_TOL)
      const detailWide = near('details', a.y, SANY_PCT_TOL)
      const pctM = detailWide.match(/(\d{1,2})\s*%/)
      const usageM = detail.match(/(\d[\d,]*)\s*(KM|KMS|HRS?|HOURS?)\b/i)
      const unitsRaw = near('units', a.y, SANY_NEAR_TOL).replace(/\s+/g, '')
      const actRaw = near('activation', a.y, SANY_NEAR_TOL).replace(/\s+/g, '')
      const chargeText = carriedCharge

      out.push({
        line_no: out.length + 1,
        machinery: carriedMachinery ? carriedMachinery.machinery : null,
        model: carriedMachinery ? carriedMachinery.model : null,
        charge_standard: chargeText || null,
        contract_year: sanyContractYear(chargeText, pctM ? Number(pctM[1]) : null),
        activation_date: /^-*$/.test(actRaw) ? null : (sanyIsoDate(actRaw) || actRaw || null),
        units: /^\d{1,4}$/.test(unitsRaw) ? Number(unitsRaw) : null,
        usage_detail: usageM ? `${usageM[1]} ${usageM[2].toUpperCase()}` : null,
        amount_usd: a.amount,
      })
    }
  }

  const total = out.length ? Math.round(out.reduce((s, l) => s + l.amount_usd, 0) * 100) / 100 : null
  return { lines: out, total_usd: total }
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
 * When positioned text items are supplied (`opts.items`) the per-machine line
 * table is extracted too: `lines`, `lines_total_usd` and `lines_reconcile`.
 * `lines_reconcile` is LOAD BEARING - a partial extraction that silently dropped
 * a machine line would understate the cost while looking complete, so the caller
 * must be able to tell that the line sum does not equal the stated gross.
 *
 * @param {string[]|string} linesOrText
 * @param {{items?: Array<{page?:number,x:number,y:number,str:string}>}} [opts]
 * @returns {object|null}
 */
export function parseSanyProformaPdf(linesOrText, opts = {}) {
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

  // Reference number (Ref. No. SYDU202 504 15 -> SYDU20250415). A continuation
  // token is only part of the split ref if it carries a DIGIT - otherwise the
  // following prose ("Service Merchant ...") glues onto the number.
  const refM = text.match(/Ref\.?\s*No\.?\s*:?\s*([A-Z0-9]+(?:\s+[A-Z0-9]+){0,2})/i)
  let invoiceNo = ''
  if (refM) {
    const toks = refM[1].split(/\s+/)
    const kept = [toks[0]]
    for (const t of toks.slice(1)) { if (/\d/.test(t)) kept.push(t); else break }
    invoiceNo = kept.join('')
  }
  if (!invoiceNo) {
    const scM = text.match(/Service\s*Contract\s*NO\.?\s*:?\s*([A-Z0-9]+)/i)
    invoiceNo = scM ? scM[1] : `SANY-${grossUsd}`
  }

  // Service period from YYYY-Mon-DD tokens (digits are fragmented, so match against
  // the whitespace-stripped text). The FIRST TWO dates are the PI Duration (period
  // start/end); the invoice date = the period END, never the document's last date -
  // the signature page carries a hand-typed date SANY has shipped with the wrong
  // YEAR ("2025-Apr-15th" on a 2026 invoice), which used to pull the row a year back.
  const compact = text.replace(/\s+/g, '')
  const dre = /(\d{4})-([A-Za-z]{3})[a-z]*-(\d{1,2})/g
  const isoDates = []
  let dt
  while ((dt = dre.exec(compact)) !== null) {
    const mm = MONTHS[dt[2].toLowerCase()]
    if (mm) isoDates.push(`${dt[1]}-${mm}-${String(dt[3]).padStart(2, '0')}`)
  }
  const startDate = isoDates[0] || null
  const invoiceDate = isoDates[1] || startDate
  const periodMonth = invoiceDate ? `${invoiceDate.slice(0, 7)}-01` : null

  const periodText = startDate && invoiceDate ? `${startDate} to ${invoiceDate}` : (invoiceDate || '')
  const grossSar = Math.round(grossUsd * fxRate * 100) / 100

  // Per-machine line table (only available when positioned items were supplied).
  const { lines: lineItems, total_usd: linesTotal } = Array.isArray(opts && opts.items)
    ? parseSanyProformaLineItems(opts.items)
    : { lines: [], total_usd: null }
  const linesReconcile = linesTotal != null && Math.abs(linesTotal - grossUsd) < 0.005

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
    lines: lineItems,
    lines_total_usd: linesTotal,
    lines_reconcile: linesReconcile,
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
  const items = await extractPdfItems(file)
  const lines = pdfItemsToLines(items)
  // Prefer the service-contract proforma; fall back to the region/date/amount summary.
  const proforma = parseSanyProformaPdf(lines, { items })
  if (proforma) {
    const { __period_month, ...row } = proforma
    if (__period_month) row.Date = row.Date || __period_month
    return [row]
  }
  const rows = parseSanyPdfRows(lines)
  if (!rows.length) throw new Error('No SANY invoice rows found in this PDF. Use the service-contract proforma, or the summary (Region / Date / Quotation No / Amount) list.')
  return rows
}
