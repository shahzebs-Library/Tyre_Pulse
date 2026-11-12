/**
 * Observation-only audit PDF. Never calls or modifies the approved inspection PDF.
 * Report reference remains tied to the immutable source inspection ID.
 * The revision label is a source timestamp, not a claim of stored PDF history.
 */
import { resolveStorageUrl } from './storageRefs'
import { safeImageSrc } from './safeUrl'
import { shrinkImageForPdf } from './pdfImage'
import { applyExportPolicy, resolvePdfBrand, pdfInspectionKit } from './exportUtils'
import { brandingForPdf } from './inspectionChecklistReport'

export const observationReportId = (row) => `OBS-${String(row?.id || 'UNKNOWN').toUpperCase()}`
export const observationRevision = (row) => String(row?.updated_at || row?.created_at || row?.inspection_date || 'Not recorded')
const printable = (v) => String(v ?? 'Not recorded').replace(/[^\x20-\x7e]/g, ' ').trim() || 'Not recorded'
const filePart = (v) => String(v || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 50)

async function photoData(ref) {
  if (!ref) return null
  try {
    const url = safeImageSrc(await resolveStorageUrl(ref))
    if (!url) return null
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) return null
    const raw = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    const format = blob.type === 'image/png' ? 'PNG' : blob.type === 'image/webp' ? 'WEBP' : 'JPEG'
    const image = await shrinkImageForPdf(raw, format)
    return image
  } catch { return null }
}

async function vehicleDiagramData(svgEl) {
  if (!svgEl || typeof document === 'undefined') return null
  try {
    const { serializeSvgInlined } = await import('./svgInline')
    const svgText = await serializeSvgInlined(svgEl)
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }))
    try {
      const image = await new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = url
      })
      if (!image) return null
      const canvas = document.createElement('canvas')
      canvas.width = 700
      canvas.height = Math.max(320, Math.round((image.naturalHeight / Math.max(image.naturalWidth, 1)) * 700))
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      return { dataUrl: canvas.toDataURL('image/png'), ratio: canvas.height / canvas.width }
    } finally { URL.revokeObjectURL(url) }
  } catch { return null }
}

export async function downloadObservationReport(inspection, findings = [], { svgEl = null, branding = null, company = '' } = {}) {
  if (!inspection?.id) throw new Error('A saved inspection is required.')
  const allowed = applyExportPolicy(findings, 'Observation PDF ' + observationReportId(inspection))
  if (allowed.length !== findings.length) throw new Error('Export limit would omit inspection findings.')
  const { default: jsPDF } = await import('jspdf')
  const { P, section, pill, glyph } = pdfInspectionKit
  const brand = await resolvePdfBrand(await brandingForPdf(branding))
  const accent = brand.logoData ? brand.accent : P.green
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pw = doc.internal.pageSize.width, ph = doc.internal.pageSize.height
  const mx = 14, W = pw - 28, bottom = ph - 18
  const ref = observationReportId(inspection), generated = new Date().toISOString()
  const day = String(inspection.inspection_date || inspection.completed_date || inspection.created_at || '').slice(0, 10)
  let y = 32
  const header = () => {
    doc.setFillColor(...P.white); doc.rect(0, 0, pw, 26, 'F')
    let x = mx
    if (brand.logoData) {
      try { doc.addImage(brand.logoData, /image\/jpe?g/i.test(brand.logoData) ? 'JPEG' : 'PNG', mx, 5, 15, 15); x += 19 } catch { /* logo is optional */ }
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...P.ink)
    doc.text('Vehicle Tyres Observation Report', x, 13.5)
    if (company && !brand.logoData) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...P.ghost)
      doc.text(company, x, 18.3)
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...P.ghost)
    doc.text('Generated: ' + generated.slice(0, 10), pw - mx, 9, { align: 'right' })
    doc.text('Document No: ' + ref.slice(0, 28), pw - mx, 13.2, { align: 'right' })
    doc.text('Inspection Date: ' + (day || 'N/A'), pw - mx, 17.4, { align: 'right' })
    doc.setDrawColor(...accent); doc.setLineWidth(0.8); doc.line(mx, 22.5, pw - mx, 22.5)
  }
  const newPage = () => { doc.addPage(); header(); return 32 }
  const ensure = (height) => { if (y + height > bottom) y = newPage() }
  const detail = (label, value) => {
    const wrapped = doc.splitTextToSize(printable(value), W - 61)
    const h = Math.max(7, wrapped.length * 4.2 + 2)
    ensure(h + 1)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...P.ghost)
    doc.text(label, mx + 5, y + 4.6)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...P.ink)
    doc.text(wrapped, mx + 54, y + 4.6)
    doc.setDrawColor(...P.silver); doc.setLineWidth(0.15)
    doc.line(mx + 4, y + h, mx + W - 4, y + h)
    y += h + 1
  }
  header()
  y = section(doc, 'Vehicle Details', y, mx, accent) + 2
  doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver)
  doc.roundedRect(mx, y - 4, W, 4, 2, 2, 'FD')
  detail('Asset No.', inspection.asset_no)
  detail('Site', inspection.site)
  detail('Vehicle Type', inspection.vehicle_type)
  detail('Tyreman', inspection.inspector_name || inspection.inspector)
  detail('Inspection Date', day)
  detail('Inspection Type', inspection.inspection_type)
  detail('Approval Status', inspection.approval_status || inspection.status)
  detail('Source Inspection', inspection.id)
  detail('Source Revision', observationRevision(inspection))
  detail('PDF Template', '1.0 / Observation-only document')
  y += 8
  ensure(39)
  y = section(doc, 'Observation Summary', y, mx, accent) + 3
  const tiles = [
    [findings.length, 'Findings', 'none'],
    [findings.filter(f => f.kind === 'tyre').length, 'Tyres Flagged', 'warning'],
    [findings.filter(f => f.tone === 'bad').length, 'Critical', 'critical'],
    [findings.filter(f => !!f.actionRecord).length, 'Actions Raised', 'good'],
  ]
  const tw = (W - 9) / 4
  tiles.forEach(([count, label, tone], i) => {
    const x = mx + i * (tw + 3)
    doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver)
    doc.roundedRect(x, y, tw, 20, 2, 2, 'FD')
    glyph(doc, x + 7, y + 7, 2.5, tone)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...P.ink)
    doc.text(String(count), x + 13, y + 9)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...P.iron)
    doc.text(label, x + tw / 2, y + 16, { align: 'center' })
  })
  y += 28
  const diagram = await vehicleDiagramData(svgEl)
  if (diagram) {
    const h = Math.min(85, 115 * diagram.ratio)
    ensure(h + 18)
    y = section(doc, 'Vehicle Tyre Condition Map', y, mx, accent) + 2
    doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver)
    doc.roundedRect(mx, y, W, h + 8, 2, 2, 'FD')
    try { doc.addImage(diagram.dataUrl, 'PNG', mx + (W - 115) / 2, y + 4, 115, h) } catch { /* report still has details */ }
    y += h + 15
  }
  // These use the EXACT section/pill/glyph primitives exposed by the approved
  // Vehicle Tyres Inspection Report, without changing its implementation.
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i]
    ensure(55)
    y = section(doc, 'Observation ' + (i + 1) + ': ' + printable(f.position || 'General').slice(0, 35), y, mx, accent) + 3
    const tone = f.tone === 'bad' ? 'critical' : f.tone === 'warn' ? 'warning' : 'none'
    pill(doc, mx + 2, y - 2, 26, 6, printable(f.severity || 'Finding').slice(0, 13), tone)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...P.ink)
    const label = doc.splitTextToSize(printable(f.text), W - 35)
    doc.text(label, mx + 33, y + 2)
    y += Math.max(11, label.length * 4.5 + 4)
    detail('Position', f.position || 'General observation')
    if (f.kind === 'tyre') {
      detail('Pressure', f.pressure == null ? 'Not recorded' : f.pressure + ' PSI')
      detail('Tread', f.tread == null ? 'Not recorded' : f.tread + ' mm')
      detail('Tyre Status', f.tyreNow?.state || 'Not verified')
    }
    detail('Remarks', f.remarks || 'No remarks')
    detail('Action', f.actionRecord ? f.actionRecord.id + ' (' + f.actionRecord.status + ')' : 'No action linked')
    y += 6
  }
  // As in the inspection PDF, photographs are grouped AFTER detailed readings.
  const photographed = findings.filter(f => f.kind === 'tyre')
  if (photographed.length) {
    y = newPage()
    y = section(doc, 'Tyre Photo Evidence', y, mx, accent) + 4
    for (const f of photographed) {
      ensure(18)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...P.ink)
      doc.text(printable(f.position || 'Position') + ': ' + printable(f.text).slice(0, 62), mx + 3, y + 4)
      y += 10
      const photo = f.photo ? await photoData(f.photo) : null
      if (photo) {
        ensure(75)
        doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver)
        doc.roundedRect(mx, y, W, 70, 2, 2, 'FD')
        try { doc.addImage(photo.dataUrl, photo.fmt, mx + 4, y + 4, 110, 62, undefined, 'FAST') }
        catch { doc.text('Photo could not be embedded.', mx + 5, y + 12) }
        y += 76
      } else {
        ensure(12)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...P.ghost)
        doc.text(f.photo ? 'Stored photo unavailable for PDF export.' : 'No photo recorded for this tyre.', mx + 3, y + 4)
        y += 12
      }
    }
  }
  const totalPages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setDrawColor(...P.silver); doc.setLineWidth(0.25)
    doc.line(mx, ph - 12, pw - mx, ph - 12)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...P.ghost)
    doc.text('Observation ' + ref.slice(0, 24) + ' | Template v1.0 | ' + generated, mx, ph - 7)
    doc.text('Page ' + i + ' of ' + totalPages, pw - mx, ph - 7, { align: 'right' })
  }
  doc.save('Tyre Observation ' + filePart(inspection.asset_no) + ' ' + filePart(day) + ' ' + filePart(inspection.id) + '.pdf')
}
