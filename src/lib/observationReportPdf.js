/**
 * Observation-only audit PDF. Never calls or modifies the approved inspection PDF.
 * Report reference remains tied to the immutable source inspection ID.
 * The revision label is a source timestamp, not a claim of stored PDF history.
 */
import { resolveStorageUrl } from './storageRefs'
import { safeImageSrc } from './safeUrl'
import { shrinkImageForPdf } from './pdfImage'
import { applyExportPolicy } from './exportUtils'

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
    const image = await shrinkImageForPdf(raw, blob.type === 'image/png' ? 'PNG' : 'JPEG')
    return image
  } catch { return null }
}

export async function downloadObservationReport(inspection, findings = []) {
  if (!inspection?.id) throw new Error('A saved inspection is required for the observation report.')
  const approved = applyExportPolicy(findings, `Observation PDF ${observationReportId(inspection)}`)
  if (approved.length !== findings.length) throw new Error('This observation exceeds the configured export row limit. Ask your administrator for a complete export.')
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const stamp = new Date().toISOString()
  const ref = observationReportId(inspection)
  const sourceRevision = observationRevision(inspection)
  let y = 17
  const pageHeight = 297
  const pageBreak = (height = 12) => {
    if (y + height > pageHeight - 20) { doc.addPage(); y = 18 }
  }
  const write = (label, value) => {
    pageBreak(9)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(75, 85, 99)
    doc.text(`${label}: `, 15, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(22, 30, 44)
    const lines = doc.splitTextToSize(printable(value), 142)
    doc.text(lines, 53, y)
    y += Math.max(7, lines.length * 4.5 + 2)
  }
  doc.setFillColor(255, 255, 255); doc.rect(0, 0, 210, 26, 'F')
  doc.setDrawColor(22, 101, 52); doc.setLineWidth(0.8); doc.line(15, 24, 195, 24)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(22, 30, 44)
  doc.text('TYRE PULSE | OBSERVATION REPORT', 15, 13)
  doc.setFontSize(9); doc.setTextColor(100, 116, 139); doc.text('Source-linked audit copy | Template v1.0', 15, 20)
  y = 36
  write('Report ID', ref)
  write('Source revision', sourceRevision)
  write('Generated (UTC)', stamp)
  write('Inspection ID', inspection.id)
  write('Asset', inspection.asset_no)
  write('Inspection date', inspection.inspection_date || inspection.completed_date || inspection.created_at)
  write('Site', inspection.site)
  write('Inspector', inspection.inspector)
  write('Inspection type', inspection.inspection_type)
  write('Approval', inspection.approval_status || inspection.status)
  pageBreak(13)
  doc.setDrawColor(210, 218, 228); doc.line(15, y, 195, y); y += 8
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(19, 44, 74)
  doc.text(`OBSERVATIONS (${findings.length})`, 15, y); y += 9
  for (let index = 0; index < findings.length; index++) {
    const f = findings[index]
    pageBreak(32)
    doc.setFillColor(240, 244, 249); doc.roundedRect(14, y - 5, 182, 9, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(19, 44, 74)
    doc.text(`${index + 1}. ${printable(f.position || 'General observation')} - ${printable(f.text)}`.slice(0, 102), 17, y + 1)
    y += 10
    write('Severity', f.severity)
    write('Remarks', f.remarks || 'No remarks')
    if (f.kind === 'tyre') {
      write('Pressure', f.pressure == null ? 'Not recorded' : `${f.pressure} PSI`)
      write('Tread', f.tread == null ? 'Not recorded' : `${f.tread} mm`)
      write('Tyre status', f.tyreNow?.state || 'Not verified')
    }
    write('Action', f.actionRecord ? `${f.actionRecord.id} (${f.actionRecord.status})` : 'No action linked')
    if (f.photo) {
      const data = await photoData(f.photo)
      if (data) {
        pageBreak(57)
        try { doc.addImage(data.dataUrl, data.fmt, 15, y, 87, 53); y += 59 }
        catch { write('Evidence', 'Photo stored but could not be embedded') }
      } else write('Evidence', 'Photo stored but unavailable for PDF export')
    } else if (f.kind === 'tyre') write('Evidence', 'No photo recorded')
    y += 4
  }
  const pages = doc.internal.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor(100, 116, 139)
    doc.text(`Observation report ${ref} | Template v1.0 | page ${page} of ${pages}`, 15, 287)
  }
  doc.save(`Tyre Observation ${filePart(inspection.asset_no)} ${filePart(String(inspection.inspection_date || '').slice(0, 10))} ${filePart(inspection.id)}.pdf`)
}
