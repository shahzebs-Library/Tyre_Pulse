/** Printed page numbers in OEM parts books look like "2-14" = chapter 2, page 14. */
export function parsePrintedPage(value) {
  const m = String(value || '').trim().match(/^(\d{1,3})-(\d{1,4})$/)
  return m ? { chapter: Number(m[1]), page: Number(m[2]), label: `${Number(m[1])}-${Number(m[2])}` } : null
}

/** Stable figure id: the printed page when known, otherwise the PDF page. */
export function figureId(printedPage, pdfPage) {
  const p = parsePrintedPage(printedPage)
  return p ? `F${p.label}` : `P${pdfPage}`
}
