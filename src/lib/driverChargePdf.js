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

const NOTICE_LANGUAGES = Object.keys(spec.driver_notice.text)

/**
 * The driver's language for the notice box: the language of his latest
 * signature, else the app language, else English.
 */
export function noticeLanguage(detail, appLanguage = 'en') {
  const signed = (Array.isArray(detail?.signatures) ? detail.signatures : [])
    .filter(s => ['driver_acceptance', 'driver_dispute'].includes(s?.kind) && NOTICE_LANGUAGES.includes(s?.statement_language))
  if (signed.length) return signed[signed.length - 1].statement_language
  return NOTICE_LANGUAGES.includes(appLanguage) ? appLanguage : 'en'
}

/** The plain-language box in the driver's language. Pure. */
export function buildDriverNotice(detail, language) {
  const text = spec.driver_notice.text[language] || spec.driver_notice.text.en
  const c = detail.charge || {}
  const amount = Number(c.amount)
  const amountText = Number.isFinite(amount) && c.amount !== null && c.amount !== '' ? `${c.currency || ''} ${amount.toFixed(2)}`.trim() : MISSING
  const rule = detail.settings?.country_rule
  const days = Number(detail.settings?.appeal_window_days)
  const window = rule?.statutory ? text.window_statutory : text.window_days.replace('{days}', Number.isFinite(days) ? String(days) : MISSING)
  const lastDay = detail.settings?.objection_last_day
  const deadline = lastDay ? String(lastDay).slice(0, 10) : text.deadline_pending
  return {
    language,
    dir: text.dir,
    title: text.title,
    lines: text.lines.map(line => line.replace('{amount}', amountText).replace('{window}', window).replace('{deadline}', deadline)),
  }
}

/** Pure: spec + detail payload -> document model. */
export function buildChargeDocument(detail, { generatedAt = new Date().toISOString(), language: appLanguage = 'en' } = {}) {
  if (!detail?.charge) throw new Error('Charge details are unavailable.')
  const documentNumber = interpolate(spec.document_number.format, detail)
  const ctx = { ...detail, document_number: documentNumber, generated_at: generatedAt }
  const sections = spec.sections.map(section => {
    const base = { id: section.id, title: section.title, type: section.type }
    if (section.when && !getPath(detail, section.when)) return { ...base, type: 'text', text: section.empty || MISSING }
    if (section.type === 'text') return { ...base, text: formatValue(getPath(detail, section.key)) }
    if (section.type === 'photos') {
      const list = Array.isArray(getPath(detail, section.rows)) ? getPath(detail, section.rows) : []
      const photos = list.filter(item => item?.kind === section.kind && item[section.image_key])
        .map(item => ({ ref: String(item[section.image_key]), caption: item[section.caption_key] ? String(item[section.caption_key]) : MISSING }))
      return { ...base, photos, empty: photos.length ? null : section.empty || MISSING, imageMissing: section.image_missing }
    }
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
    language: s[sig.block.statement_language_key] || 'en',
    imageMissing: sig.block.image_missing,
    rows: sig.block.fields.map(field => [field.label, formatField(field, s, detail)]),
  }))
  const language = noticeLanguage(detail, appLanguage)
  return {
    title: spec.title,
    documentNumber,
    language,
    driverNotice: buildDriverNotice(detail, language),
    headerLines: spec.header.lines.map(line => interpolate(line, ctx)),
    sections,
    signatureTitle: sig.title,
    signatureEmpty: sig.empty,
    signatures,
    footerLines: spec.footer.lines,
    pageNumber: spec.footer.page_number,
  }
}

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/
export const hasArabicScript = text => ARABIC_SCRIPT.test(String(text || ''))

/**
 * Arabic and Urdu need text shaping, which jsPDF's built-in fonts cannot do.
 * The browser can: draw the paragraph on a canvas (right to left, wrapped)
 * and place it as an image. Returns { dataUrl, widthMm, heightMm } or null.
 */
export function browserScriptTextToPng(text, { widthMm = 180, fontPx = 26, rtl = true } = {}) {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext?.('2d')
  if (!ctx) return null
  const pxPerMm = 8
  const width = Math.round(widthMm * pxPerMm)
  const font = `${fontPx}px "Noto Naskh Arabic", "Noto Nastaliq Urdu", Tahoma, Arial, sans-serif`
  ctx.font = font
  const lines = []
  for (const para of String(text || '').split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > width - 8 && line) { lines.push(line); line = word } else line = next
    }
    lines.push(line)
  }
  const lineHeight = Math.round(fontPx * 1.6)
  canvas.width = width
  canvas.height = Math.max(lineHeight, lines.length * lineHeight + 8)
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#111827'; ctx.font = font; ctx.textBaseline = 'top'
  ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left'
  lines.forEach((l, i) => ctx.fillText(l, rtl ? width - 4 : 4, 4 + i * lineHeight))
  return { dataUrl: canvas.toDataURL('image/png'), widthMm, heightMm: canvas.height / pxPerMm }
}

/** Resolve a tp-storage photo ref to a data URL jsPDF can embed. */
export async function defaultPhotoToDataUrl(ref) {
  const { resolveStorageUrl } = await import('./storageRefs')
  const url = await resolveStorageUrl(ref)
  if (!url) return null
  const response = await fetch(url)
  if (!response.ok) return null
  const blob = await response.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

const imageFormat = dataUrl => (/^data:image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG')

export async function renderDriverChargePdf(detail, {
  generatedAt, save = true, signatureToPng, language = 'en',
  photoToDataUrl = defaultPhotoToDataUrl, scriptTextToPng = browserScriptTextToPng,
} = {}) {
  const model = buildChargeDocument(detail, { generatedAt, language })
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ unit: spec.page.unit, format: spec.page.size.toLowerCase(), orientation: spec.page.orientation })
  const margin = spec.page.margin
  const width = doc.internal.pageSize.getWidth(); const height = doc.internal.pageSize.getHeight()
  const ensure = (y, need) => { if (y + need > height - 28) { doc.addPage(); return 18 } return y }
  // Writes a paragraph; Arabic-script text becomes a shaped image when the
  // browser can draw it, otherwise it is printed as text (never dropped).
  const paragraph = (text, y, { size = 9, rtl = false } = {}) => {
    if (hasArabicScript(text) && scriptTextToPng) {
      const img = scriptTextToPng(text, { widthMm: width - margin * 2, rtl })
      if (img?.dataUrl) {
        y = ensure(y, img.heightMm + 2)
        doc.addImage(img.dataUrl, 'PNG', margin, y, img.widthMm, img.heightMm, undefined, 'FAST')
        return y + img.heightMm + 2
      }
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size)
    const lines = doc.splitTextToSize(String(text), width - margin * 2)
    y = ensure(y, lines.length * (size * 0.42) + 2)
    doc.text(lines, margin, y + size * 0.4)
    return y + lines.length * (size * 0.42) + 2
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(model.title, margin, 16)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  model.headerLines.forEach((line, i) => doc.text(line, margin, 22 + i * 5))
  let y = 24 + model.headerLines.length * 5
  // The plain-language box for the driver, in his language.
  const notice = model.driverNotice
  doc.setDrawColor(21, 128, 61); doc.setLineWidth(0.4)
  const noticeTop = y
  y = paragraph(notice.title, y + 2, { size: 10, rtl: notice.dir === 'rtl' })
  for (const line of notice.lines) y = paragraph(`- ${line}`, y, { size: 9, rtl: notice.dir === 'rtl' })
  if (y > noticeTop) doc.rect(margin - 2, noticeTop, width - margin * 2 + 4, y - noticeTop + 1)
  y += 4
  for (const section of model.sections) {
    y = ensure(y, 16)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(section.title, margin, y); y += 3
    if (section.type === 'text') {
      y = paragraph(section.text, y + 1) + 2
    } else if (section.type === 'photos') {
      if (section.empty) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(section.empty, margin, y + 4); y += 9; continue }
      const cell = (width - margin * 2 - 8) / 3; let col = 0
      for (const photo of section.photos) {
        if (col === 0) y = ensure(y, cell * 0.75 + 10)
        const x = margin + col * (cell + 4)
        let data = null
        try { data = await photoToDataUrl(photo.ref) } catch { data = null }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
        if (data) {
          try { doc.addImage(data, imageFormat(data), x, y + 1, cell, cell * 0.75, undefined, 'FAST') } catch { doc.text(section.imageMissing, x, y + 6) }
        } else doc.text(section.imageMissing, x, y + 6)
        doc.text(doc.splitTextToSize(photo.caption, cell).slice(0, 2), x, y + cell * 0.75 + 4)
        col += 1
        if (col === 3) { col = 0; y += cell * 0.75 + 10 }
      }
      if (col !== 0) y += cell * 0.75 + 10
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
    y = ensure(y, 40)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(s.heading, margin, y + 3); y += 5
    // The exact words signed, in the language signed.
    y = paragraph(s.statement, y, { size: 8, rtl: s.language === 'ar' || s.language === 'ur' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(`(${s.statementVersion})`, margin, y + 2); y += 4
    y = ensure(y, 24)
    if (s.image && signatureToPng) {
      try { doc.addImage(await signatureToPng(s.image), 'PNG', margin, y, 65, 20, undefined, 'FAST') } catch { doc.text(s.imageMissing, margin, y + 5) }
    } else { doc.text(s.imageMissing, margin, y + 5) }
    y += 22
    autoTable(doc, { startY: y, body: s.rows, theme: 'grid', styles: { fontSize: 7.5, cellPadding: 1.5 }, columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' } }, margin: { left: margin, right: margin } })
    y = doc.lastAutoTable.finalY + 6
  }
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
    const footer = doc.splitTextToSize(model.footerLines.join(' '), width - margin * 2)
    doc.text(footer, margin, height - 22)
    doc.text(model.pageNumber.replace('{page}', page).replace('{pages}', pages), width - margin, height - 6, { align: 'right' })
    doc.text(model.documentNumber, margin, height - 6)
  }
  if (save) doc.save(`Driver Charge ${detail.charge.charge_no}.pdf`)
  return doc
}
