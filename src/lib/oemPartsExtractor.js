import { analyzePageGeometry, pageInfo } from './oemCatalog/pageGeometry'

/** Deterministic extraction of OEM parts tables from selectable-text PDFs. */
const PART_NO_RE = /^[A-Z0-9][A-Z0-9._/-]{5,}$/i

function groupPdfLines(items = []) {
  const lines = []
  for (const item of items) {
    const text = String(item?.str || '').trim()
    if (!text) continue
    const x = Number(item.transform?.[4] || 0)
    const y = Number(item.transform?.[5] || 0)
    let line = lines.find((candidate) => Math.abs(candidate.y - y) < 2)
    if (!line) {
      line = { y, cells: [] }
      lines.push(line)
    }
    line.cells.push({ x, width: Number(item.width || 0), text })
  }
  return lines.map((line) => ({
    y: line.y,
    cells: line.cells.sort((a, b) => a.x - b.x),
    text: line.cells.sort((a, b) => a.x - b.x).map((c) => c.text).join(' ').trim(),
  })).sort((a, b) => b.y - a.y)
}

function columnText(cells, min, max) {
  return cells.filter((cell) => cell.x >= min - 0.5 && cell.x < max - 0.5).map((cell) => cell.text).join(' ').trim()
}

function parseQuantity(value) {
  const match = String(value || '').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function finishRow(row) {
  if (!row) return null
  for (const key of ['description', 'remark', 'source_line']) row[key] = String(row[key] || '').replace(/\s+/g, ' ').trim()
  if (!row.part_no || !row.description) return null
  row.row_type = row.parent_index ? 'variant' : 'catalog_item'
  return row
}

/** Parse one page using OEM column positions (index, part no, description, remark, qty, see page). */
export function extractOemPartsPage(items, pdfPage) {
  const lines = groupPdfLines(items)
  const allText = items.map((item) => String(item?.str || '')).join(' ')
  const instructionalPage = /preface|page header with parts code|to be used along with/i.test(allText)
  const headerAt = lines.findIndex(({ text }) => /INDEX/i.test(text) && /PART\s*NO/i.test(text) && /DESCRIPTION/i.test(text))
  const printedPage = lines.filter((line) => line.y < 100).flatMap((line) => line.cells)
    .find((cell) => /^\d{1,4}-\d{1,4}$/.test(cell.text))?.text || ''
  const titleLine = lines.find((line) => line.y < 100 && line.cells.some((cell) => cell.x >= 390 && cell.x < 500))
  const pageHeading = titleLine?.cells.filter((cell) => cell.x >= 390 && cell.x < 500).map((cell) => cell.text).join(' ').trim() || ''
  const captionLine = lines.find((line) => line.y > 770 && line.cells.some((cell) => cell.x >= 390 && cell.x < 550))
  const heading = captionLine?.cells.filter((cell) => cell.x >= 390 && cell.x < 550).map((cell) => cell.text).join(' ').trim() || pageHeading
  if (instructionalPage || headerAt < 0 || !printedPage) return { rows: [], heading, printedPage, instructional: instructionalPage }

  const header = lines[headerAt]
  const cols = header.cells
  const indexX = cols.find((c) => /^INDEX$/i.test(c.text))?.x ?? 64
  const partX = cols.find((c) => /^PART\s*NO\.?$/i.test(c.text))?.x ?? 99
  const descX = cols.find((c) => /^DESCRIPTION$/i.test(c.text))?.x ?? 198
  // OEM PDFs center the word "Remark" inside its column, while remark values
  // are left-aligned at its left edge. Move back from the header text start.
  const remarkHeaderX = cols.find((c) => /^REMARK$/i.test(c.text))?.x ?? 424
  const remarkX = remarkHeaderX - 31
  const qtyX = cols.find((c) => /^QTY$/i.test(c.text))?.x ?? 494
  const seeX = cols.find((c) => /^SEE$/i.test(c.text))?.x ?? 537

  const rows = []
  const dataLines = lines.slice(headerAt + 1).filter((line) => line.y >= 100)
  const candidates = dataLines.map((line) => {
    const partText = columnText(line.cells, partX, descX - 1)
    const partNo = partText.split(/\s+/).find((token) => PART_NO_RE.test(token))
    if (!partNo) return null
    const indexText = columnText(line.cells, indexX, partX - 1)
    return { line, partNo, index: /^\d{1,3}$/.test(indexText) ? indexText : '', assigned: [] }
  }).filter(Boolean).sort((a, b) => b.line.y - a.line.y)

  // OEM text runs sometimes put a wrapped description several points above or
  // below its part-number baseline. Assign every nearby line to the nearest
  // part-number anchor so a wrapped row cannot be attached to the previous part.
  for (const line of dataLines) {
    const closest = candidates
      .map((candidate) => ({ candidate, distance: Math.abs(candidate.line.y - line.y) }))
      .sort((a, b) => a.distance - b.distance)[0]
    if (closest && closest.distance <= 10.5) closest.candidate.assigned.push(line)
  }

  let parentIndex = ''
  for (const candidate of candidates) {
    if (candidate.index) parentIndex = candidate.index
    const assigned = candidate.assigned.sort((a, b) => b.y - a.y)
    const combine = (min, max) => assigned.map((line) => columnText(line.cells, min, max)).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    const indexText = combine(indexX, partX - 1)
    const directIndex = indexText.split(/\s+/).find((value) => /^\d{1,3}$/.test(value)) || candidate.index
    const qtyText = combine(qtyX, seeX - 1)
    const seeText = combine(seeX, Infinity).replace(/\s+/g, '')
    const row = finishRow({
      source_pdf_page: pdfPage,
      index_no: directIndex || null,
      parent_index: directIndex ? null : (parentIndex || null),
      part_no: candidate.partNo,
      description: combine(descX, remarkX - 1),
      remark: combine(remarkX, qtyX - 1),
      quantity: parseQuantity(qtyText),
      see_page: /^\d{1,4}-\d{1,4}$/.test(seeText) ? seeText : null,
      source_line: [...new Set(assigned.map((line) => line.text))].join(' '),
    })
    if (row) rows.push({ ...row, row_order: rows.length + 1 })
  }

  return { rows, heading, printedPage }
}

/** Iterate every PDF page; records pages with no selectable parts table for review. */
export async function extractOemPartsDocument(pdfDoc, onProgress = () => {}, { ops } = {}) {
  const rows = []
  const parsedPages = []
  const skippedPages = []
  const reviewPages = []
  const imageOnlyPages = []
  const printedPageMap = new Map()
  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
    const page = await pdfDoc.getPage(pageNumber)
    const content = await page.getTextContent()
    const parsed = extractOemPartsPage(content.items, pageNumber)
    if (parsed.printedPage && !printedPageMap.has(parsed.printedPage)) printedPageMap.set(parsed.printedPage, pageNumber)
    if (parsed.rows.length) {
      parsedPages.push(pageNumber)
      for (const row of parsed.rows) rows.push({ ...row, assembly_heading: parsed.heading, printed_page: parsed.printedPage })
    } else {
      skippedPages.push(pageNumber)
      const text = content.items.map((item) => String(item?.str || '')).join(' ')
      if (!text.trim()) imageOnlyPages.push(pageNumber)
      else if (!parsed.instructional && /INDEX/i.test(text) && /PART\s*NO/i.test(text) && /DESCRIPTION/i.test(text)) reviewPages.push(pageNumber)
    }
    onProgress({ pageNumber, pageCount: pdfDoc.numPages, rowCount: rows.length })
  }
  for (const row of rows) {
    const pageParts = String(row.printed_page || '').match(/^(\d+)-(\d+)$/)
    const assemblyFigure = pageParts && Number(pageParts[2]) > 1
      ? `${pageParts[1]}-${Number(pageParts[2]) - 1}`
      : ''
    row.illustration_pdf_page = (row.see_page && printedPageMap.get(row.see_page))
      || (assemblyFigure && printedPageMap.get(assemblyFigure))
      || null
  }
  // Callout numbers printed on each linked illustration page (text layer only).
  // Image-only figures give none; the pipeline then skips orphan-callout checks.
  const calloutsByPage = {}
  const geometryByPage = {}
  for (const page of new Set(rows.map((r) => r.illustration_pdf_page).filter(Boolean))) {
    const pdfPage = await pdfDoc.getPage(page)
    const content = await pdfPage.getTextContent()
    if (ops && pdfPage.getOperatorList) {
      try {
        geometryByPage[page] = analyzePageGeometry({ opList: await pdfPage.getOperatorList(), OPS: ops, items: content.items, info: pageInfo(pdfPage) })
      } catch { /* geometry is best effort; rows without it go to review as unverified */ }
    }
    const found = new Set()
    for (const item of content.items) {
      const s = String(item?.str || '').trim()
      if (/^\d{1,3}$/.test(s) && Number(s) > 0) found.add(String(Number(s)))
    }
    if (found.size) calloutsByPage[page] = [...found]
  }
  return { rows, parsedPages, skippedPages, reviewPages, imageOnlyPages, calloutsByPage, geometryByPage, pageCount: pdfDoc.numPages, printedPageMap: Object.fromEntries(printedPageMap) }
}

/** Read common OEM identity labels from the cover/title pages; the import form stays editable for confirmation. */
export async function extractOemIdentity(pdfDoc, fileName = '') {
  const pageTexts = []
  for (let pageNumber = 1; pageNumber <= Math.min(pdfDoc.numPages, 5); pageNumber += 1) {
    const page = await pdfDoc.getPage(pageNumber)
    const content = await page.getTextContent()
    pageTexts.push(content.items.map((item) => String(item?.str || '')).join(' '))
  }
  const text = `${pageTexts.join(' ')} ${fileName}`
  const brands = [
    ['SANY', /\bSany\b/i], ['Caterpillar', /\bCaterpillar\b/i], ['CAT', /\bCAT\b/i],
    ['Komatsu', /\bKomatsu\b/i], ['Volvo', /\bVolvo(?:\s+CE)?\b/i], ['JCB', /\bJCB\b/i],
    ['XCMG', /\bXCMG\b/i], ['LiuGong', /\bLiuGong\b/i], ['SDLG', /\bSDLG\b/i],
    ['Shantui', /\bShantui\b/i], ['Hitachi', /\bHitachi\b/i], ['Develon', /\bDevelon\b/i],
    ['Doosan', /\bDoosan\b/i], ['Hyundai', /\bHyundai\b/i], ['John Deere', /\bJohn Deere\b/i],
    ['Liebherr', /\bLiebherr\b/i], ['Zoomlion', /\bZoomlion\b/i], ['Kubota', /\bKubota\b/i],
    ['Kobelco', /\bKobelco\b/i], ['Mercedes-Benz', /\bMercedes(?:-Benz)?\b/i], ['MAN', /\bMAN\b/i],
    ['Scania', /\bScania\b/i], ['Shacman', /\bShacman\b/i], ['Sinotruk', /\bSinotruk\b/i],
    ['HOWO', /\bHOWO\b/i], ['Isuzu', /\bIsuzu\b/i], ['Hino', /\bHino\b/i],
    ['Tata', /\bTata\b/i], ['Ashok Leyland', /\bAshok Leyland\b/i], ['DAF', /\bDAF\b/i],
  ]
  const manufacturer = brands.find(([, pattern]) => pattern.test(text))?.[0] || ''
  const equipmentNo = text.match(/Equipment\s*(?:No\.?|Number)\s*[:#]?\s*([A-Z0-9-]{6,})/i)?.[1] || ''
  const modelCode = text.match(/\b[A-Z]{1,5}\d[A-Z0-9]*(?:[-/][A-Z0-9]+)*\b/)?.[0] || ''
  const model = modelCode || ''
  const fileEquipmentNo = String(fileName).match(/\b[A-Z0-9]{8,}\b/i)?.[0] || ''
  return { manufacturer, model, modelCode, equipmentNo: equipmentNo || fileEquipmentNo }
}

export function normalizePartNumber(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}
