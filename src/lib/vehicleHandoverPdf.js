/**
 * One-handover PDF: the details, the marked vehicle views (the asset's own
 * five-view pictures with the numbered markers drawn on them), the marker list
 * and the driver signature.
 *
 * The drawing half needs a browser canvas; `pinGeometry` and `handoverPdfRows`
 * are pure so they can be tested.
 */
import { loadPdf } from './pdfEngine'
import {
  marksFromDamages, numberMarks, viewImageUrl, viewName, damageTypeName, levelName,
  viewsWithPlacedMarks, levelTone, handoverViewsFor,
} from './vehicleHandoverMarks'
import { reportFileName, reportDateLabel } from './exportUtils'

const TYPE_LABEL = { checkout: 'Check-out', checkin: 'Check-in' }

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

async function signatureImage(svg) {
  if (typeof svg !== 'string' || !svg.trim().startsWith('<svg')) return null
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const img = await loadImage(src)
  if (!img) return null
  const canvas = document.createElement('canvas')
  canvas.width = 600; canvas.height = 200
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 600, 200)
  ctx.drawImage(img, 0, 0, 600, 200)
  return canvas.toDataURL('image/png')
}

/** Build and save the PDF for one handover row. */
export async function exportHandoverPdf(row, { company = '' } = {}) {
  const { jsPDF, autoTable } = await loadPdf()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 14
  let y = M

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
  doc.text('Vehicle Handover Report', M, y + 4)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100)
  doc.text([company, reportDateLabel()].filter(Boolean).join(' | '), M, y + 10)
  doc.setTextColor(0)
  y += 16

  autoTable(doc, {
    startY: y,
    body: handoverPdfRows(row),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 } },
    margin: { left: M, right: M },
  })
  y = doc.lastAutoTable.finalY + 8

  const { marks, stem } = marksFromDamages(row.damages)
  const numbered = numberMarks(marks)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text('Damage marked on the vehicle', M, y); y += 5

  const order = handoverViewsFor({ asset_no: row.asset_no })
  const views = viewsWithPlacedMarks(numbered, order)
  if (!numbered.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    doc.text('No damage marked.', M, y + 4); y += 10
  } else {
    const cell = (W - M * 2 - 6) / 2
    for (let i = 0; i < views.length; i++) {
      const col = i % 2
      if (col === 0 && y + cell + 8 > H - M) { doc.addPage(); y = M }
      const img = await drawMarkedView(stem, views[i], numbered, 600)
      const x = M + col * (cell + 6)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
      doc.text(viewName(views[i]), x, y + 3)
      if (img) doc.addImage(img, 'JPEG', x, y + 5, cell, cell)
      doc.setDrawColor(210); doc.rect(x, y + 5, cell, cell)
      if (col === 1 || i === views.length - 1) y += cell + 10
    }
    if (y > H - 40) { doc.addPage(); y = M }
    autoTable(doc, {
      startY: y,
      head: [['No', 'Side', 'Damage', 'Level', 'Note', 'Photo']],
      body: numbered.map((m) => [
        String(m.number),
        `${viewName(m.view)}${m.x == null ? ' (position not recorded)' : ''}`,
        damageTypeName(m.type),
        levelName(m.level),
        m.note || '',
        m.photo_url ? 'Link attached' : '',
      ]),
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [31, 41, 55] },
      margin: { left: M, right: M },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  if (y > H - 50) { doc.addPage(); y = M }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text('Driver signature', M, y); y += 4
  const sig = await signatureImage(row.signature_url)
  if (sig) { doc.addImage(sig, 'PNG', M, y, 75, 25); y += 28 } else {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    doc.text(row.signature_url ? 'Signed (signature is stored as a link).' : 'Not signed.', M, y + 5); y += 10
  }
  if (row.notes) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Notes', M, y + 4)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
    doc.text(doc.splitTextToSize(String(row.notes), W - M * 2), M, y + 10)
  }

  doc.save(`${reportFileName('TyrePulse Vehicle Handover', row.asset_no || null, reportDateLabel())}.pdf`)
}
