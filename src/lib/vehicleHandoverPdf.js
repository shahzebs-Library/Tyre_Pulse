/**
 * One-handover PDF, built in the inspection-report house style: a branded header
 * with the company logo, a Vehicle Details card beside the vehicle picture, a
 * condition summary, the marked five-view board (the asset's own pictures with
 * the numbered damage markers drawn on them), a damages table, the handover
 * photos, THREE signature boxes (driver, fleet supervisor, fleet incharge) and a
 * verification QR in the footer.
 *
 * The drawing half needs a browser canvas; `pinGeometry` and `handoverPdfRows`
 * are pure so they can be tested.
 *
 * Shared look with the inspection report: the section bar, the status pill, the
 * date formatter and the brand palette come from exportUtils (pdfInspectionKit /
 * PDF_COLORS / resolvePdfBrand) so a handover reads as the same product.
 */
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

const _section = pdfInspectionKit.section
const _date = pdfInspectionKit.date
const _pill = pdfInspectionKit.pill

const TYPE_LABEL = { checkout: 'Check-out', checkin: 'Check-in' }

const STATUS_META = {
  approved: { word: 'Closed', tone: 'good' },
  rejected: { word: 'Sent back', tone: 'critical' },
  pending_incharge: { word: 'Awaiting fleet incharge', tone: 'warning' },
  pending_supervisor: { word: 'Awaiting supervisor', tone: 'warning' },
  draft: { word: 'Draft', tone: 'none' },
}

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

/** Label/value rows for the details block. Blank = N/A, never a fabricated 0. */
export function handoverPdfRows(row = {}) {
  const km = row.odometer_km == null || row.odometer_km === '' ? null : Number(row.odometer_km)
  const fuel = row.fuel_level_pct == null || row.fuel_level_pct === '' ? null : Number(row.fuel_level_pct)
  return [
    ['Asset', row.asset_no || 'N/A'],
    ['Report no', row.report_no || 'N/A'],
    ['Type', TYPE_LABEL[row.handover_type] || 'N/A'],
    ['Handover at', fmtWhen(row.handover_at)],
    ['From driver', row.from_driver || 'N/A'],
    ['To driver', row.to_driver || 'N/A'],
    ['Odometer', Number.isFinite(km) ? `${km.toLocaleString('en-US')} km` : 'N/A'],
    ['Fuel level', Number.isFinite(fuel) ? `${fuel}%` : 'N/A'],
    ['Condition', row.condition_rating ? String(row.condition_rating).replace(/^./, (c) => c.toUpperCase()) : 'N/A'],
    ['Cleanliness', row.cleanliness ? String(row.cleanliness).replace(/^./, (c) => c.toUpperCase()) : 'N/A'],
  ]
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
 * Build and save the PDF for one handover row.
 * @param {object} row  handover_reports row
 * @param {{ company?:string, branding?:object, verifyUrl?:string, save?:boolean }} [opts]
 */
export async function exportHandoverPdf(row = {}, opts = {}) {
  const fileBase = reportFileName('TyrePulse Vehicle Handover', row.asset_no || null, reportDateLabel())
  applyExportPolicy([], fileBase)
  const { jsPDF } = await loadPdf()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const company = opts.company || ''
  const mx = 14
  const W = pw - mx * 2
  const brand = await resolvePdfBrand(opts.branding)
  const accent = brand.logoData ? brand.accent : P.green
  const TITLE = 'Vehicle Handover Report'
  const BOTTOM = ph - 20
  const docNo = row.document_no
    || `HND-${String(row.id || '').replace(/-/g, '').slice(0, 8).toUpperCase() || 'DRAFT'}`
  const handoverDay = _date(row.handover_at)
  const genDay = _date(new Date().toISOString())
  const status = STATUS_META[String(row.approval_status || '').toLowerCase()] || null

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
    doc.text(`Generated: ${genDay}`, pw - mx, 9, { align: 'right' })
    doc.text(`Document No: ${docNo}`, pw - mx, 13.2, { align: 'right' })
    doc.text(`Handover Date: ${handoverDay}`, pw - mx, 17.4, { align: 'right' })
    doc.setDrawColor(...accent); doc.setLineWidth(0.8)
    doc.line(mx, 22.5, pw - mx, 22.5)
  }
  const newPage = () => { doc.addPage(); header(); return 31 }
  const ensure = (y, h) => (y + h > BOTTOM ? newPage() : y)

  header()
  let y = 32

  const { marks: rawMarks, stem } = marksFromDamages(row.damages)
  const marks = numberMarks(rawMarks)

  // ── Vehicle Details ────────────────────────────────────────────────────────
  y = _section(doc, 'Vehicle Details', y, mx, accent) + 1
  const details = handoverPdfRows(row)
  const vPhoto = opts.vehiclePhotoUrl ? (await fetchImageDataUrl(opts.vehiclePhotoUrl))?.dataUrl : null
  const rowsN = details.length + 1 // +1 for the status row
  const cardH = rowsN * 7 + 4
  const listW = vPhoto ? W * 0.64 : W
  doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver); doc.setLineWidth(0.25)
  doc.roundedRect(mx, y, listW, cardH, 2, 2, 'FD')
  const detailRows = [...details, ['Sign-off status', null]]
  detailRows.forEach(([lbl, val], i) => {
    const ry = y + 2 + i * 7
    doc.setFillColor(...accent); doc.circle(mx + 4.5, ry + 3.6, 0.9, 'F')
    doc.setFontSize(7.2); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
    doc.text(lbl, mx + 8, ry + 4.6)
    const vx = mx + 38
    if (val === null) {
      const meta = status || { word: 'No sign-off', tone: 'none' }
      _pill(doc, vx, ry + 1.4, Math.max(22, doc.getTextWidth(meta.word) + 8), 4.6, meta.word, meta.tone)
    } else {
      doc.setFontSize(8.2); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
      doc.text(doc.splitTextToSize(String(val), listW - 42)[0], vx, ry + 4.6)
    }
    if (i < detailRows.length - 1) {
      doc.setDrawColor(...P.silver); doc.setLineWidth(0.15)
      doc.line(mx + 3, ry + 7, mx + listW - 3, ry + 7)
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

  // ── Condition summary tiles ────────────────────────────────────────────────
  y = ensure(y, 24)
  y = _section(doc, 'Condition Summary', y, mx, accent) + 1
  const refs = photoRefsFor(row, marks)
  const tiles = [
    [row.condition_rating ? String(row.condition_rating).replace(/^./, (c) => c.toUpperCase()) : 'N/A', 'Overall condition'],
    [row.cleanliness ? String(row.cleanliness).replace(/^./, (c) => c.toUpperCase()) : 'N/A', 'Cleanliness'],
    [String(marks.length), marks.length === 1 ? 'Damage mark' : 'Damage marks'],
    [String(refs.length), refs.length === 1 ? 'Photo attached' : 'Photos attached'],
  ]
  const tw = (W - 3 * 3) / 4, th = 16
  tiles.forEach(([val, label], i) => {
    const tx = mx + i * (tw + 3)
    doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver); doc.setLineWidth(0.2)
    doc.roundedRect(tx, y, tw, th, 2, 2, 'FD')
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
    doc.text(String(val), tx + tw / 2, y + 7.6, { align: 'center' })
    doc.setFontSize(6.6); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.iron)
    doc.text(label, tx + tw / 2, y + 12.6, { align: 'center' })
  })
  y += th + 8

  // ── Damage marked on the vehicle (the asset's own five-view board) ─────────
  const order = handoverViewsFor({ asset_no: row.asset_no, vehicle_type: row.vehicle_type })
  const placedViews = viewsWithPlacedMarks(marks, order)
  const boardViews = placedViews.length ? placedViews : marks.length ? order.slice(0, 2) : []
  y = ensure(y, 12)
  y = _section(doc, 'Damage marked on the vehicle', y, mx, accent)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
  doc.text(`${marks.length} marked`, mx + 3.4, y + 0.6)
  y += 4
  if (!marks.length) {
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.iron)
    doc.text('No damage was marked on this handover.', mx + 3, y + 4); y += 10
  } else {
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
    // Legend (severity tones)
    y = ensure(y, 8)
    const legend = [['minor', 'Minor'], ['moderate', 'Moderate'], ['severe', 'Major']]
    doc.setFontSize(7.2); doc.setFont('helvetica', 'normal')
    let lx = mx + 3
    legend.forEach(([lvl, label]) => {
      const col = _hexToRgb(levelTone(lvl))
      doc.setFillColor(...col); doc.circle(lx + 1.6, y - 1.1, 1.6, 'F')
      doc.setTextColor(...P.iron); doc.text(label, lx + 5, y)
      lx += 6 + doc.getTextWidth(label) + 7
    })
    y += 6

    // Damage table
    const { autoTable } = await loadPdf()
    y = ensure(y, 20)
    autoTable(doc, {
      startY: y,
      head: [['No', 'Side', 'Damage', 'Level', 'Note', 'Photo']],
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

  // ── Handover photos ────────────────────────────────────────────────────────
  if (refs.length) {
    const urlMap = await resolveStorageUrlMap(refs)
    const MAX = 12
    const toRender = refs.slice(0, MAX)
    const omitted = Math.max(0, refs.length - MAX)
    y = ensure(y, 50)
    y = _section(doc, `Handover photos (${omitted ? `${toRender.length} of ${refs.length}` : refs.length})`, y, mx, accent) + 1
    const cols = 4, gap = 3.5
    const boxW = (W - gap * (cols - 1)) / cols
    const imgH = boxW * 1.0
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
        doc.text('Could not load', x + boxW / 2, rowTop + imgH / 2, { align: 'center' })
      }
      col += 1
      if (col === cols) { col = 0; y = rowTop + imgH + gap }
    }
    if (col !== 0) y = rowTop + imgH + gap
  }

  // ── Sign-off: driver + fleet supervisor + fleet incharge ───────────────────
  y = ensure(y, 44)
  y = _section(doc, 'Sign-off', y, mx, accent) + 1
  const driverSig = await signatureImage(row.signature_url)
  const supSig = await signatureImage(row.supervisor_signature)
  const incSig = await signatureImage(row.incharge_signature)
  const approved = String(row.approval_status || '').toLowerCase() === 'approved'
  const sigW = (W - 2 * 5) / 3, sigH = 36
  const drawSig = (x, title, png, name, sub) => {
    doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver); doc.setLineWidth(0.2)
    doc.roundedRect(x, y, sigW, sigH, 2, 2, 'FD')
    doc.setFontSize(7.6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
    doc.text(title, x + 4, y + 6)
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
      doc.text(sub || 'Pending', x + 6, y + 15.5)
    }
    doc.setFontSize(7.6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
    doc.text(doc.splitTextToSize(name || 'Not recorded', sigW - 8)[0], x + 4, y + 27)
    doc.setFontSize(6.6); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
    doc.text(sub || '', x + 4, y + 31.4)
  }
  drawSig(mx, 'Driver', driverSig, row.from_driver || row.to_driver || null,
    row.signature_url ? `Handover: ${handoverDay}` : 'Not signed')
  drawSig(mx + sigW + 5, 'Fleet Supervisor', supSig, row.supervisor_name || null,
    row.supervisor_at ? `Checked: ${_date(row.supervisor_at)}` : 'Checked: pending')
  drawSig(mx + (sigW + 5) * 2, 'Fleet Incharge', incSig, row.incharge_name || null,
    approved ? `Approved: ${_date(row.incharge_at)}` : 'Approval pending')
  y += sigH + 4

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
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...P.silver); doc.setLineWidth(0.25)
    doc.line(mx, ph - 14, pw - mx - (qr ? 32 : 0), ph - 14)
    doc.setFontSize(6.8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
    doc.text(brand.footerText || `${TITLE}${company ? `  |  ${company}` : ''}`, mx, ph - 9.5)
    doc.text(`Page ${p} of ${totalPages}`, pw - mx - (qr ? 34 : 0), ph - 9.5, { align: 'right' })
    if (qr) {
      try { doc.addImage(qr, 'PNG', pw - mx - 30, ph - 17, 11, 11, undefined, 'FAST') } catch { /* text only */ }
      doc.setFontSize(5.8); doc.setTextColor(...P.ghost)
      doc.text('Scan to verify', pw - mx - 17.5, ph - 12.4)
      doc.text('this report', pw - mx - 17.5, ph - 9.6)
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
