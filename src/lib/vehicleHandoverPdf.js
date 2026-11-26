/**
 * One-handover PDF: the Vehicle Handover Authorization paper.
 *
 * RENDERED FROM ONE SPEC: docs/document-specs/handover-authorization.json holds
 * the title, the document number rule, the header lines, every section in
 * order, the fields of each section in order, the signature blocks (both
 * drivers, then the fleet supervisor and the fleet incharge) and the footer.
 * This file only knows how to DRAW each section type; what is on the paper and
 * in which order lives in the spec, so the Flutter app can build the same paper
 * from the same file (docs/document-specs/handover-contract.md).
 *
 * The drawing half needs a browser canvas; `pinGeometry`, `handoverPdfRows`,
 * `formatSpecValue` and `signatureBlocks` are pure so they can be tested.
 *
 * Shared look with the inspection report: the section bar, the status pill, the
 * date formatter and the brand palette come from exportUtils (pdfInspectionKit /
 * PDF_COLORS / resolvePdfBrand) so a handover reads as the same product.
 */
import SPEC from '../../docs/document-specs/handover-authorization.json'
import { loadPdf } from './pdfEngine'
import {
  marksFromDamages, numberMarks, viewImageUrl, viewName, damageTypeName, levelName,
  viewsWithPlacedMarks, levelTone, handoverViewsFor,
} from './vehicleHandoverMarks'
import {
  reportFileName, reportDateLabel, applyExportPolicy, resolvePdfBrand,
  PDF_COLORS as P, pdfInspectionKit,
} from './exportUtils'
import { resolveStorageUrlMap } from './storageRefs'
import { rowLocation, formatCoords, openStreetMapUrl } from './handoverAuthorization'

export const HANDOVER_PDF_SPEC = SPEC

const _section = pdfInspectionKit.section
const _date = pdfInspectionKit.date
const _pill = pdfInspectionKit.pill

const STATUS_META = SPEC.status_words

/** Pixel circles for the markers of one view on a square image of `size`. */
export function pinGeometry(marks = [], view, size = 600) {
  const r = Math.max(9, Math.round(size * 0.028))
  return (Array.isArray(marks) ? marks : [])
    .filter((m) => m.view === view && m.x != null && m.y != null)
    .map((m) => ({ number: m.number, cx: (m.x / 100) * size, cy: (m.y / 100) * size, r, color: levelTone(m.level) }))
}

function fmtWhen(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

/** Format one spec value. Blank is N/A, never a fabricated 0. */
export function formatSpecValue(format, v) {
  if (blank(v)) return 'N/A'
  switch (format) {
    case 'date': return _date(v)
    case 'datetime': return fmtWhen(v)
    case 'km': { const n = Number(v); return Number.isFinite(n) ? `${n.toLocaleString('en-US')} km` : 'N/A' }
    case 'hours': { const n = Number(v); return Number.isFinite(n) ? `${n.toLocaleString('en-US')} h` : 'N/A' }
    case 'percent': { const n = Number(v); return Number.isFinite(n) ? `${n}%` : 'N/A' }
    case 'capitalize': return String(v).replace(/^./, (c) => c.toUpperCase())
    case 'handover_type': return SPEC.formats.handover_type[v] || 'N/A'
    case 'status_pill': return STATUS_META[String(v).toLowerCase()]?.word || 'No sign-off'
    default: return String(v)
  }
}

/** The document number as printed (server number, else the legacy fallback). */
export function documentNumber(row = {}) {
  return row.document_no
    || `HND-${String(row.id || '').replace(/-/g, '').slice(0, 8).toUpperCase() || 'DRAFT'}`
}

/** Resolve a spec field against a row and the computed context. */
function fieldValue(row, field, ctx = {}) {
  if (field.source) return ctx[field.source]
  const v = row?.[field.column]
  if (blank(v) && field.fallback_column) return row?.[field.fallback_column]
  return v
}

/**
 * Label/value rows for the details block, in spec order. The status pill row is
 * drawn separately and therefore left out.
 */
export function handoverPdfRows(row = {}) {
  const details = SPEC.sections.find((s) => s.key === 'details')
  const ctx = { document_no: documentNumber(row) }
  return details.fields
    .filter((f) => f.format !== 'status_pill')
    .map((f) => [f.label, formatSpecValue(f.format, fieldValue(row, f, ctx))])
}

/**
 * The signature blocks of a signatures section for a row: title, signature
 * markup, name and the "Signed: <time>" line. A row from before the
 * authorization update falls back to its single legacy driver signature.
 */
export function signatureBlocks(row = {}, section) {
  const legacy = section.legacy_block && !row.from_signature && !row.to_signature && row.signature_url
  const blocks = legacy ? [section.legacy_block] : section.blocks
  return blocks.map((b) => {
    const signature = row[b.signature] || null
    const at = b.at ? row[b.at] : null
    const name = (b.name && !blank(row[b.name]) ? row[b.name] : null) || (b.name_fallback ? row[b.name_fallback] : null) || null
    const sub = at ? `${b.at_label || 'Signed'}: ${fmtWhen(at)}` : (signature ? 'Signed' : (b.pending_text || 'Not signed'))
    return { title: b.title, signature, name, sub }
  })
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return }
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/**
 * Fetch a (possibly signed) remote image into a data URL. CORS, size-capped and
 * timed; any failure returns null so one unreachable photo never blanks the PDF.
 * A local copy rather than editing the un-exported helper in exportUtils.
 */
async function fetchImageDataUrl(url) {
  if (!url || typeof url !== 'string') return null
  if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return null
  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null
    let res
    try { res = await fetch(url, { mode: 'cors', signal: ctrl ? ctrl.signal : undefined }) }
    finally { if (timer) clearTimeout(timer) }
    if (!res || !res.ok) return null
    const blob = await res.blob()
    if (!blob.type || !blob.type.startsWith('image/') || blob.size > 8_000_000) return null
    const fmt = /png/i.test(blob.type) ? 'PNG' : /webp/i.test(blob.type) ? 'WEBP' : 'JPEG'
    const dataUrl = await new Promise((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
    return dataUrl ? { dataUrl, fmt } : null
  } catch { return null }
}

async function drawMarkedView(stem, view, marks, size = 600) {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size)
  const img = await loadImage(viewImageUrl(stem, view))
  if (img) ctx.drawImage(img, 0, 0, size, size)
  else {
    ctx.strokeStyle = '#9ca3af'; ctx.setLineDash([10, 8]); ctx.lineWidth = 3
    ctx.strokeRect(size * 0.12, size * 0.12, size * 0.76, size * 0.76); ctx.setLineDash([])
  }
  for (const p of pinGeometry(marks, view, size)) {
    ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2)
    ctx.fillStyle = p.color; ctx.fill()
    ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff'; ctx.stroke()
    ctx.fillStyle = '#111111'; ctx.font = `bold ${Math.round(p.r * 1.1)}px sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(p.number), p.cx, p.cy + 1)
  }
  return canvas.toDataURL('image/jpeg', 0.85)
}

async function signatureImage(svg, w = 600, h = 200) {
  if (typeof svg !== 'string' || !svg.trim()) return null
  const s = svg.trim()
  let src = null
  if (/^data:image\//i.test(s)) src = s
  else if (s.slice(0, 4).toLowerCase() === '<svg') src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`
  if (!src) return null
  const img = await loadImage(src)
  if (!img) return null
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h)
  // Fit the mark inside the plate without distortion.
  const ar = img.width / img.height || w / h
  let dw = w, dh = w / ar
  if (dh > h) { dh = h; dw = h * ar }
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
  return canvas.toDataURL('image/png')
}

/** Collect the stored photo refs: handover photos first, then marker close-ups. */
function photoRefsFor(row, marks) {
  const refs = []
  const seen = new Set()
  const add = (v) => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (s && !seen.has(s)) { seen.add(s); refs.push(s) }
  }
  if (Array.isArray(row.photos)) for (const r of row.photos) add(r)
  if (row.photo_url) add(row.photo_url)
  for (const m of Array.isArray(marks) ? marks : []) if (m.photo_url) add(m.photo_url)
  return refs
}

/**
 * Build and save the PDF for one handover row, section by section in the order
 * the spec gives.
 * @param {object} row  handover_reports row
 * @param {{ company?:string, branding?:object, verifyUrl?:string, vehiclePhotoUrl?:string, save?:boolean }} [opts]
 */
export async function exportHandoverPdf(row = {}, opts = {}) {
  const fileBase = reportFileName(SPEC.file_name, row.asset_no || null, reportDateLabel())
  applyExportPolicy([], fileBase)
  const { jsPDF } = await loadPdf()
  const doc = new jsPDF({ orientation: SPEC.page.orientation, unit: SPEC.page.unit, format: SPEC.page.size.toLowerCase(), compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const company = opts.company || ''
  const mx = SPEC.page.margin
  const W = pw - mx * 2
  const brand = await resolvePdfBrand(opts.branding)
  const accent = brand.logoData ? brand.accent : P.green
  const TITLE = SPEC.title
  const BOTTOM = ph - 20
  const status = STATUS_META[String(row.approval_status || '').toLowerCase()] || null

  const { marks: rawMarks, stem } = marksFromDamages(row.damages)
  const marks = numberMarks(rawMarks)
  const refs = photoRefsFor(row, marks)
  const ctx = {
    document_no: documentNumber(row),
    generated_at: new Date().toISOString(),
    damage_mark_count: String(marks.length),
    photo_count: String(refs.length),
  }

  // ── Header (every page) ────────────────────────────────────────────────────
  const header = () => {
    doc.setFillColor(...P.white); doc.rect(0, 0, pw, 26, 'F')
    let tx = mx
    if (brand.logoData) {
      const fmt = /image\/jpe?g/i.test(brand.logoData) ? 'JPEG' : 'PNG'
      try { doc.addImage(brand.logoData, fmt, mx, 5, 15, 15, undefined, 'FAST'); tx = mx + 19 } catch { /* text only */ }
    }
    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
    doc.text(TITLE, tx, 13.5)
    if (company && !brand.logoData) {
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
      doc.text(company, tx, 18.5)
    }
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
    SPEC.header.right_lines.forEach((line, i) => {
      const v = formatSpecValue(line.format, fieldValue(row, line, ctx))
      doc.text(`${line.label}: ${v}`, pw - mx, 9 + i * 4.2, { align: 'right' })
    })
    doc.setDrawColor(...accent); doc.setLineWidth(0.8)
    doc.line(mx, 22.5, pw - mx, 22.5)
  }
  const newPage = () => { doc.addPage(); header(); return 31 }
  const ensure = (y, h) => (y + h > BOTTOM ? newPage() : y)

  header()
  let y = 32

  // ── Section drawers, keyed by spec type ────────────────────────────────────
  const drawFields = async (section) => {
    y = _section(doc, section.title, y, mx, accent) + 1
    const vPhoto = section.with_vehicle_photo && opts.vehiclePhotoUrl ? (await fetchImageDataUrl(opts.vehiclePhotoUrl))?.dataUrl : null
    const rows = section.fields.map((f) => [f.label, f.format === 'status_pill' ? null : formatSpecValue(f.format, fieldValue(row, f, ctx))])
    const cardH = rows.length * 6.4 + 4
    y = ensure(y, cardH)
    const listW = vPhoto ? W * 0.64 : W
    doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver); doc.setLineWidth(0.25)
    doc.roundedRect(mx, y, listW, cardH, 2, 2, 'FD')
    rows.forEach(([lbl, val], i) => {
      const ry = y + 2 + i * 6.4
      doc.setFillColor(...accent); doc.circle(mx + 4.5, ry + 3.3, 0.9, 'F')
      doc.setFontSize(7.2); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
      doc.text(lbl, mx + 8, ry + 4.3)
      const vx = mx + 38
      if (val === null) {
        const meta = status || { word: 'No sign-off', tone: 'none' }
        _pill(doc, vx, ry + 1.1, Math.max(22, doc.getTextWidth(meta.word) + 8), 4.6, meta.word, meta.tone)
      } else {
        doc.setFontSize(8.2); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
        doc.text(doc.splitTextToSize(String(val), listW - 42)[0], vx, ry + 4.3)
      }
      if (i < rows.length - 1) {
        doc.setDrawColor(...P.silver); doc.setLineWidth(0.15)
        doc.line(mx + 3, ry + 6.4, mx + listW - 3, ry + 6.4)
      }
    })
    if (vPhoto) {
      const px = mx + listW + 4, pwid = W - listW - 4
      doc.setFillColor(...P.offWhite); doc.roundedRect(px, y, pwid, cardH, 2, 2, 'F')
      try {
        const props = doc.getImageProperties(vPhoto)
        const ar = props.width / props.height
        let dw = pwid - 4, dh = (pwid - 4) / ar
        if (dh > cardH - 4) { dh = cardH - 4; dw = (cardH - 4) * ar }
        const fmt = /image\/jpe?g/i.test(vPhoto) ? 'JPEG' : /image\/webp/i.test(vPhoto) ? 'WEBP' : 'PNG'
        doc.addImage(vPhoto, fmt, px + (pwid - dw) / 2, y + (cardH - dh) / 2, dw, dh, undefined, 'FAST')
      } catch { /* card stays blank */ }
    }
    y += cardH + 8
  }

  const drawTiles = (section) => {
    y = ensure(y, 24)
    y = _section(doc, section.title, y, mx, accent) + 1
    const n = section.tiles.length
    const tw = (W - 3 * (n - 1)) / n, th = 16
    section.tiles.forEach((t, i) => {
      const val = formatSpecValue(t.format, fieldValue(row, t, ctx))
      const tx = mx + i * (tw + 3)
      doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver); doc.setLineWidth(0.2)
      doc.roundedRect(tx, y, tw, th, 2, 2, 'FD')
      doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
      doc.text(String(val), tx + tw / 2, y + 7.6, { align: 'center' })
      doc.setFontSize(6.6); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.iron)
      doc.text(t.label, tx + tw / 2, y + 12.6, { align: 'center' })
    })
    y += th + 8
  }

  const drawDamage = async (section) => {
    const order = handoverViewsFor({ asset_no: row.asset_no, vehicle_type: row.vehicle_type })
    const placedViews = viewsWithPlacedMarks(marks, order)
    const boardViews = placedViews.length ? placedViews : marks.length ? order.slice(0, 2) : []
    y = ensure(y, 12)
    y = _section(doc, section.title, y, mx, accent)
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
    doc.text(`${marks.length} marked`, mx + 3.4, y + 0.6)
    y += 4
    if (!marks.length) {
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.iron)
      doc.text(section.empty_text, mx + 3, y + 4); y += 10
      return
    }
    const cell = (W - 6) / 2
    for (let i = 0; i < boardViews.length; i++) {
      const col = i % 2
      if (col === 0) y = ensure(y, cell + 10)
      const img = await drawMarkedView(stem, boardViews[i], marks, 600)
      const x = mx + col * (cell + 6)
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
      doc.text(viewName(boardViews[i]), x, y + 3)
      if (img) { try { doc.addImage(img, 'JPEG', x, y + 5, cell, cell, undefined, 'FAST') } catch { /* skip */ } }
      doc.setDrawColor(...P.silver); doc.setLineWidth(0.25); doc.rect(x, y + 5, cell, cell)
      if (col === 1 || i === boardViews.length - 1) y += cell + 10
    }
    y = ensure(y, 8)
    const legend = [['minor', 'Minor'], ['moderate', 'Moderate'], ['severe', 'Major']]
    doc.setFontSize(7.2); doc.setFont('helvetica', 'normal')
    let lx = mx + 3
    legend.forEach(([lvl, label]) => {
      const c = _hexToRgb(levelTone(lvl))
      doc.setFillColor(...c); doc.circle(lx + 1.6, y - 1.1, 1.6, 'F')
      doc.setTextColor(...P.iron); doc.text(label, lx + 5, y)
      lx += 6 + doc.getTextWidth(label) + 7
    })
    y += 6
    const { autoTable } = await loadPdf()
    y = ensure(y, 20)
    autoTable(doc, {
      startY: y,
      head: [section.table_columns],
      body: marks.map((m) => [
        String(m.number),
        `${viewName(m.view)}${m.x == null ? ' (position not recorded)' : ''}`,
        damageTypeName(m.type),
        levelName(m.level),
        m.note || '',
        m.photo_url ? 'Attached' : '',
      ]),
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 1.8, textColor: P.iron },
      headStyles: { fillColor: P.steel, textColor: P.white, fontStyle: 'bold' },
      margin: { left: mx, right: mx },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  const drawPhotos = async (section) => {
    if (!refs.length) return
    const urlMap = await resolveStorageUrlMap(refs)
    const toRender = refs.slice(0, section.max)
    const omitted = Math.max(0, refs.length - section.max)
    y = ensure(y, 50)
    y = _section(doc, `${section.title} (${omitted ? `${toRender.length} of ${refs.length}` : refs.length})`, y, mx, accent) + 1
    const cols = section.columns, gap = 3.5
    const boxW = (W - gap * (cols - 1)) / cols
    const imgH = boxW
    let col = 0, rowTop = y
    for (let i = 0; i < toRender.length; i++) {
      if (col === 0) { y = ensure(y, imgH + 2); rowTop = y }
      const x = mx + col * (boxW + gap)
      doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver); doc.setLineWidth(0.2)
      doc.roundedRect(x, rowTop, boxW, imgH, 1.6, 1.6, 'FD')
      const url = urlMap[toRender[i]] || null
      const got = url ? await fetchImageDataUrl(url) : null
      if (got) {
        try {
          const props = doc.getImageProperties(got.dataUrl)
          const ar = props.width / props.height
          let dW = boxW, dH = boxW / ar, ox = x, oy = rowTop
          if (ar > boxW / imgH) { dW = boxW; dH = boxW / ar; oy = rowTop + (imgH - dH) / 2 }
          else { dH = imgH; dW = imgH * ar; ox = x + (boxW - dW) / 2 }
          doc.addImage(got.dataUrl, got.fmt, ox, oy, dW, dH, undefined, 'FAST')
        } catch { /* box stays blank */ }
      } else {
        doc.setFontSize(6.8); doc.setFont('helvetica', 'italic'); doc.setTextColor(...P.mist)
        doc.text(section.missing_text, x + boxW / 2, rowTop + imgH / 2, { align: 'center' })
      }
      col += 1
      if (col === cols) { col = 0; y = rowTop + imgH + gap }
    }
    if (col !== 0) y = rowTop + imgH + gap
  }

  const drawLocation = (section) => {
    y = ensure(y, 22)
    y = _section(doc, section.title, y, mx, accent) + 1
    const loc = rowLocation(row)
    const lines = []
    if (loc) {
      lines.push(`${formatCoords(loc)}${loc.accuracy != null ? ` (within ${Math.round(loc.accuracy)} m)` : ''}`)
      lines.push(`${section.status_text.captured}${row.location_captured_at ? ` at ${fmtWhen(row.location_captured_at)}` : ''}`)
      lines.push(openStreetMapUrl(loc))
    } else {
      lines.push(section.status_text[row.location_status] || 'No location recorded')
    }
    doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver); doc.setLineWidth(0.2)
    const h = lines.length * 5 + 4
    doc.roundedRect(mx, y, W, h, 2, 2, 'FD')
    lines.forEach((l, i) => {
      doc.setFontSize(i === 0 ? 8.4 : 7.2); doc.setFont('helvetica', i === 0 ? 'bold' : 'normal')
      doc.setTextColor(...(i === 0 ? P.ink : P.ghost))
      doc.text(doc.splitTextToSize(l, W - 8)[0], mx + 4, y + 5.4 + i * 5)
    })
    if (loc) {
      try { doc.link(mx, y, W, h, { url: openStreetMapUrl(loc) }) } catch { /* plain text */ }
    }
    y += h + 8
  }

  const drawSignatures = async (section) => {
    const blocks = signatureBlocks(row, section)
    y = ensure(y, 48)
    y = _section(doc, section.title, y, mx, accent) + 1
    if (section.note) {
      doc.setFontSize(6.6); doc.setFont('helvetica', 'italic'); doc.setTextColor(...P.ghost)
      doc.text(section.note, mx + 1, y + 2.5); y += 5
    }
    const n = Math.max(1, blocks.length)
    const sigW = (W - 5 * (n - 1)) / n, sigH = 36
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      const x = mx + i * (sigW + 5)
      const png = await signatureImage(b.signature)
      doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver); doc.setLineWidth(0.2)
      doc.roundedRect(x, y, sigW, sigH, 2, 2, 'FD')
      doc.setFontSize(7.6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
      doc.text(b.title, x + 4, y + 6)
      doc.setFillColor(...P.white); doc.roundedRect(x + 4, y + 8.5, sigW - 8, 13, 1.2, 1.2, 'F')
      if (png) {
        try {
          const props = doc.getImageProperties(png)
          const ar = props.width / props.height
          let dh = 11, dw = dh * ar
          if (dw > sigW - 10) { dw = sigW - 10; dh = dw / ar }
          doc.addImage(png, 'PNG', x + 5, y + 9 + (12 - dh) / 2, dw, dh, undefined, 'FAST')
        } catch { /* box stays blank */ }
      } else {
        doc.setFontSize(6.6); doc.setFont('helvetica', 'italic'); doc.setTextColor(...P.mist)
        doc.text(b.sub, x + 6, y + 15.5)
      }
      doc.setFontSize(7.6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
      doc.text(doc.splitTextToSize(b.name || 'Not recorded', sigW - 8)[0], x + 4, y + 27)
      doc.setFontSize(6.6); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
      doc.text(doc.splitTextToSize(b.sub, sigW - 8)[0], x + 4, y + 31.4)
    }
    y += sigH + 6
  }

  const DRAW = {
    fields: drawFields, tiles: drawTiles, damage_views: drawDamage,
    photos: drawPhotos, location: drawLocation, signatures: drawSignatures,
  }
  for (const section of SPEC.sections) {
    const draw = DRAW[section.type]
    if (draw) await draw(section)
  }

  // ── Footer every page + verification QR ────────────────────────────────────
  let qr = null
  const verifyText = opts.verifyUrl || (typeof window !== 'undefined' && window.location && row.id
    ? `${window.location.origin}/handovers?view=${encodeURIComponent(row.id)}` : null)
  if (verifyText) {
    try {
      const mod = await import('qrcode')
      const QR = mod.default || mod
      qr = await QR.toDataURL(verifyText, { margin: 0, width: 220, errorCorrectionLevel: 'M' })
    } catch { qr = null }
  }
  const lockedNote = row.frozen_at ? `Signed record. Content locked at ${fmtWhen(row.frozen_at)}.` : ''
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...P.silver); doc.setLineWidth(0.25)
    doc.line(mx, ph - 14, pw - mx - (qr ? 32 : 0), ph - 14)
    doc.setFontSize(6.8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
    doc.text(brand.footerText || `${TITLE}${company ? `  |  ${company}` : ''}`, mx, ph - 9.5)
    if (lockedNote) doc.text(lockedNote, mx, ph - 6)
    doc.text(`Page ${p} of ${totalPages}`, pw - mx - (qr ? 34 : 0), ph - 9.5, { align: 'right' })
    if (qr) {
      try { doc.addImage(qr, 'PNG', pw - mx - 30, ph - 17, 11, 11, undefined, 'FAST') } catch { /* text only */ }
      doc.setFontSize(5.8); doc.setTextColor(...P.ghost)
      doc.text(SPEC.footer.qr.caption[0], pw - mx - 17.5, ph - 12.4)
      doc.text(SPEC.footer.qr.caption[1], pw - mx - 17.5, ph - 9.6)
    }
  }

  if (opts.save !== false) doc.save(`${fileBase}.pdf`)
  return doc
}

/** '#rrggbb' -> [r,g,b]; passes an existing rgb triple through. */
function _hexToRgb(v) {
  if (Array.isArray(v)) return v
  const s = String(v || '').trim()
  const m = /^#?([0-9a-f]{6})$/i.exec(s)
  if (!m) return [148, 163, 184]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
