/**
 * Driver Charge Notice PDF, rendered from docs/document-specs/driver-charge-notice.json.
 *
 * buildChargeDocument() turns the spec plus a driver_charge_detail payload into
 * a plain document model (no jsPDF). The Flutter app implements the same
 * function against the same spec, so both clients print identical notices.
 * renderDriverChargePdf() only lays that model out on A4.
 */
import spec from '../../docs/document-specs/driver-charge-notice.json'
import { loadPdf } from './pdfEngine'

const MISSING = spec.formats.missing

export function getPath(source, path) {
  if (!path) return undefined
  return String(path).split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), source)
}

function pad(n) { return String(n).padStart(2, '0') }

export function formatDateTime(value) {
  if (!value) return MISSING
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return MISSING
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = Math.floor(Math.abs(offset) / 60); const minutes = Math.abs(offset) % 60
  const zone = `GMT${sign}${hours}${minutes ? `:${pad(minutes)}` : ''}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${zone}`
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function formatValue(raw, format, row, root) {
  if (raw === null || raw === undefined || raw === '') return MISSING
  if (!format) return String(raw)
  if (format.startsWith('enum:')) return spec.enums[format.slice(5)]?.[raw] || String(raw).replaceAll('_', ' ')
  switch (format) {
    case 'datetime': return formatDateTime(raw)
    case 'date': return String(raw).slice(0, 10)
    case 'month': {
      const m = /^(\d{4})-(\d{2})/.exec(String(raw))
      return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(raw)
    }
    case 'percent': return `${Number(raw)}%`
    case 'boolean': return raw ? 'Yes' : 'No'
    default: return String(raw)
  }
}

function formatField(field, row, root) {
  const raw = getPath(row, field.key)
  if (field.format === 'money') {
    const n = Number(raw)
    if (raw === null || raw === undefined || raw === '' || !Number.isFinite(n)) return MISSING
    const currency = getPath(row, field.currency_key) ?? getPath(root, field.currency_key) ?? ''
    return `${currency} ${n.toFixed(2)}`.trim()
  }
  return formatValue(raw, field.format, row, root)
}

function interpolate(template, ctx) {
  return template.replace(/\{([a-z_.]+)(?::([a-z_]+)(?::([a-z_]+))?)?\}/gi, (_, path, fmt, arg) => {
    const raw = getPath(ctx, path)
    if (fmt === 'enum') return formatValue(raw, `enum:${arg}`)
    if (fmt) return formatValue(raw, fmt)
    return raw === null || raw === undefined ? MISSING : String(raw)
  })
}

/** Pure: spec + detail payload -> document model. */
export function buildChargeDocument(detail, { generatedAt = new Date().toISOString() } = {}) {
  if (!detail?.charge) throw new Error('Charge details are unavailable.')
  const documentNumber = interpolate(spec.document_number.format, detail)
  const ctx = { ...detail, document_number: documentNumber, generated_at: generatedAt }
  const sections = spec.sections.map(section => {
    const base = { id: section.id, title: section.title, type: section.type }
    if (section.when && !getPath(detail, section.when)) return { ...base, type: 'text', text: section.empty || MISSING }
    if (section.type === 'text') return { ...base, text: formatValue(getPath(detail, section.key)) }
    if (section.type === 'fields') {
      return { ...base, rows: section.fields.map(field => [field.label, formatField(field, detail, detail)]) }
    }
    const items = Array.isArray(getPath(detail, section.rows)) ? getPath(detail, section.rows) : []
    return {
      ...base,
      head: section.columns.map(c => c.label),
      body: items.map(item => section.columns.map(c => formatField(c, item, detail))),
      empty: items.length ? null : section.empty || MISSING,
    }
  })
  const sig = spec.signature_blocks
  const signatures = (Array.isArray(detail.signatures) ? detail.signatures : []).map(s => ({
    heading: formatValue(s[sig.block.heading_key], sig.block.heading_format),
    statement: s[sig.block.statement_key] || MISSING,
    statementVersion: s[sig.block.statement_version_key] || MISSING,
    image: s[sig.block.image_key] || null,
    imageMissing: sig.block.image_missing,
    rows: sig.block.fields.map(field => [field.label, formatField(field, s, detail)]),
  }))
  return {
    title: spec.title,
    documentNumber,
    headerLines: spec.header.lines.map(line => interpolate(line, ctx)),
    sections,
    signatureTitle: sig.title,
    signatureEmpty: sig.empty,
    signatures,
    footerLines: spec.footer.lines,
    pageNumber: spec.footer.page_number,
  }
}

export async function renderDriverChargePdf(detail, { generatedAt, save = true, signatureToPng } = {}) {
  const model = buildChargeDocument(detail, { generatedAt })
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ unit: spec.page.unit, format: spec.page.size.toLowerCase(), orientation: spec.page.orientation })
  const margin = spec.page.margin
  const width = doc.internal.pageSize.getWidth(); const height = doc.internal.pageSize.getHeight()
  const ensure = (y, need) => { if (y + need > height - 24) { doc.addPage(); return 18 } return y }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(model.title, margin, 16)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  model.headerLines.forEach((line, i) => doc.text(line, margin, 22 + i * 5))
  let y = 24 + model.headerLines.length * 5
  for (const section of model.sections) {
    y = ensure(y, 16)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(section.title, margin, y); y += 3
    if (section.type === 'text') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      const lines = doc.splitTextToSize(section.text, width - margin * 2)
      y = ensure(y, lines.length * 4 + 4); doc.text(lines, margin, y + 4); y += lines.length * 4 + 6
    } else if (section.type === 'fields') {
      autoTable(doc, { startY: y + 1, body: section.rows, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.8 }, columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' } }, margin: { left: margin, right: margin } })
      y = doc.lastAutoTable.finalY + 6
    } else if (section.empty) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(section.empty, margin, y + 4); y += 9
    } else {
      autoTable(doc, { startY: y + 1, head: [section.head], body: section.body, theme: 'grid', styles: { fontSize: 7.5, cellPadding: 1.6 }, margin: { left: margin, right: margin } })
      y = doc.lastAutoTable.finalY + 6
    }
  }
  y = ensure(y, 16)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(model.signatureTitle, margin, y); y += 4
  if (!model.signatures.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(model.signatureEmpty, margin, y + 2); y += 8 }
  for (const s of model.signatures) {
    const statement = doc.splitTextToSize(`${s.statement} (${s.statementVersion})`, width - margin * 2)
    y = ensure(y, statement.length * 3.6 + 50)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(s.heading, margin, y + 3)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(statement, margin, y + 8); y += statement.length * 3.6 + 9
    if (s.image && signatureToPng) {
      try { doc.addImage(await signatureToPng(s.image), 'PNG', margin, y, 65, 20, undefined, 'FAST') } catch { doc.text(s.imageMissing, margin, y + 5) }
    } else { doc.text(s.imageMissing, margin, y + 5) }
    y += 22
    autoTable(doc, { startY: y, body: s.rows, theme: 'grid', styles: { fontSize: 7.5, cellPadding: 1.5 }, columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' } }, margin: { left: margin, right: margin } })
    y = doc.lastAutoTable.finalY + 6
  }
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    const footer = doc.splitTextToSize(model.footerLines.join(' '), width - margin * 2)
    doc.text(footer, margin, height - 16)
    doc.text(model.pageNumber.replace('{page}', page).replace('{pages}', pages), width - margin, height - 6, { align: 'right' })
    doc.text(model.documentNumber, margin, height - 6)
  }
  if (save) doc.save(`Driver Charge ${detail.charge.charge_no}.pdf`)
  return doc
}
