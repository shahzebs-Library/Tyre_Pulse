import { loadPdf } from './pdfEngine'
import { applyExportPolicy, resolvePdfBrand, pdfFooter, pdfTableTheme } from './exportUtils'
import { resolveStorageUrl } from './storageRefs'
import { getCompanyLogo } from './api/brandLogo'
import { formatWashCost } from './washAnalytics'

const shown = value => value == null || value === '' ? 'Not recorded' : String(value)
export const washVehicleKey = row => JSON.stringify([row.organisation_id ?? null, row.country ?? null, String(row.asset_no || '').trim().toUpperCase()])
export function groupVehicleWashes(rows) {
  const groups = new Map()
  for (const row of rows) {
    // Never combine unidentified records into an invented vehicle.
    const key = row.asset_no ? washVehicleKey(row) : `unknown:${row.id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.values()].map(records => records.sort((a, b) => String(b.wash_date || '').localeCompare(String(a.wash_date || '')) || String(b.wash_time || '').localeCompare(String(a.wash_time || ''))))
    .sort((a, b) => String(a[0].asset_no || '').localeCompare(String(b[0].asset_no || ''), undefined, { numeric: true }))
}

async function photoData(ref) {
  const url = await resolveStorageUrl(ref)
  if (!url) throw new Error('Photo access unavailable')
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error('Photo download failed')
  const blob = await response.blob()
  if (!blob.type.startsWith('image/') || blob.size > 20 * 1024 * 1024) throw new Error('Unsupported photo')
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return { data: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height }
  } finally { bitmap.close() }
}

export function washDateLabel(value) {
  if (!value) return 'Not recorded'
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? shown(value) : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
export function washFilterLabel(filters = {}) {
  const labels = { from: 'From', to: 'To', site: 'Site', area: 'Area', status: 'Status', type: 'Wash type', assetNo: 'Vehicle' }
  const parts = Object.entries(labels).filter(([k]) => filters[k] && filters[k] !== 'All').map(([k, label]) => `${label}: ${k === 'from' || k === 'to' ? washDateLabel(filters[k]) : filters[k]}`)
  return parts.length ? parts.join(' | ') : 'All accessible wash records'
}

export async function exportVehicleWashPdf(rows, { company = '', branding, currency = '', filters = {}, filename = 'vehicle-washing', save = true, loadPhoto = photoData, onProgress = () => {} } = {}) {
  const allowed = applyExportPolicy(rows)
  if (allowed.length !== rows.length) throw new Error('This selection exceeds the export limit. Narrow the filters to include every selected record.')
  if (!allowed.length) throw new Error('No wash records match this selection.')
  const { jsPDF, autoTable } = await loadPdf()
  const logo = branding?.logo_url || await getCompanyLogo()
  const brand = await resolvePdfBrand({ ...branding, logo_url: logo })
  if (!brand.logoData) throw new Error('Company logo could not be loaded. Check Console > Report Colors and try again.')
  brand.footerText = brand.footerText?.replace(/confidinetial/gi, 'Confidential')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const groups = groupVehicleWashes(allowed)
  const pageRefs = new Map()
  const header = (title, subtitle) => {
    doc.setFillColor(255); doc.rect(0, 0, 297, 26, 'F')
    doc.setFillColor(...brand.accent); doc.rect(0, 0, 297, 2, 'F')
    try {
      const img = doc.getImageProperties(brand.logoData)
      const scale = Math.min(24 / img.width, 19 / img.height)
      doc.addImage(brand.logoData, 14, 4, img.width * scale, img.height * scale)
    } catch { /* resolvePdfBrand already validates the configured logo */ }
    doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
    doc.text(title, 43, 12)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.text(doc.splitTextToSize(subtitle, 235), 43, 18)
    doc.setDrawColor(220); doc.line(14, 27, 283, 27)
  }
  const table = options => autoTable(doc, { ...pdfTableTheme(brand.accent), margin: { top: 32, bottom: 23, left: 14, right: 14 }, ...options })
  const dates = allowed.map(r => r.wash_date).filter(Boolean).sort()
  const range = dates.length ? `${washDateLabel(dates[0])} to ${washDateLabel(dates.at(-1))}` : 'Dates not recorded'
  const summary = `${groups.length} vehicle${groups.length === 1 ? '' : 's'} | ${allowed.length} wash record${allowed.length === 1 ? '' : 's'} | Recorded period: ${range}`
  if (groups.length > 1) {
    table({ startY: 33, head: [['Vehicle / type', 'Country / site / current region', 'Washes', 'Latest wash', 'Latest type / status', 'Attachments']],
      body: groups.map(records => { const r = records[0]; return [ `${shown(r.asset_no)} / ${shown(r.vehicle_type)}`, `${shown(r.country)} / ${[...new Set(records.map(r => shown(r.site)))].join(', ')} / ${shown(r.region)}`, records.length, washDateLabel(r.wash_date), `${shown(r.wash_type)} / ${shown(r.status)}`, records.reduce((n,r) => n + (r.photos?.length || 0), 0) ] }),
      didDrawPage: () => header('Vehicle Washing Report', summary),
    })
    table({ startY: doc.lastAutoTable.finalY + 5, head: [['Export selection']], body: [[washFilterLabel(filters)], ['Attachments are supplied by the uploader; their presence does not verify wash completion.']], didDrawPage: () => header('Vehicle Washing Report', summary) })
  }
  let missingPhotos = 0, processed = 0, firstDetail = true
  const totalPhotos = allowed.reduce((n, r) => n + (Array.isArray(r.photos) ? r.photos.length : 0), 0)
  for (const records of groups) for (const row of records) {
    const refs = Array.isArray(row.photos) ? row.photos : []
    const subtitle = `${washDateLabel(row.wash_date)}${row.wash_time ? `, ${row.wash_time} (${shown(row.country)} local time)` : ''} | ${shown(row.site)} | ${shown(row.status)}`
    for (let offset = 0; offset < Math.max(1, refs.length); offset += 3) {
      if (groups.length > 1 || !firstDetail) doc.addPage()
      firstDetail = false
      header(`Vehicle Washing - ${shown(row.asset_no)}`, subtitle)
      pageRefs.set(doc.internal.getNumberOfPages(), row.id)
      table({ startY: 32, head: [['Type / plate', 'Country / site / current region', 'Wash type', 'Operator', 'Meter / cost']], body: [[`${shown(row.vehicle_type)} / ${shown(row.registration_no)}`, `${shown(row.country)} / ${shown(row.site)} / ${shown(row.region)}`, shown(row.wash_type), shown(row.washed_by), `${row.odometer_km == null ? 'Meter not recorded' : `${Number(row.odometer_km).toLocaleString('en-GB')} km`} / ${formatWashCost(row.cost)}${row.cost == null ? '' : ` ${currency}`}`]] })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(65)
      doc.text('Uploaded attachments - review image content; attachment count does not verify washing.', 14, 56)
      if (!refs.length) doc.text('No photos recorded for this wash.', 14, 85)
      for (let i = 0; i < Math.min(3, refs.length - offset); i++) {
        const x = 14 + i * 91, y = 60, boxW = 87, boxH = 100
        doc.setDrawColor(220); doc.rect(x, y, boxW, boxH)
        try {
          const photo = await loadPhoto(refs[offset + i])
          const scale = Math.min((boxW - 2) / photo.width, (boxH - 2) / photo.height)
          const w = photo.width * scale, h = photo.height * scale
          doc.addImage(photo.data, 'JPEG', x + (boxW - w) / 2, y + (boxH - h) / 2, w, h)
        } catch { missingPhotos++; doc.setFontSize(10); doc.text('Photo unavailable', x + 5, y + 50) }
        doc.setFontSize(8); doc.setTextColor(70); doc.text(`Attachment ${offset + i + 1} of ${refs.length}`, x, 165)
        onProgress(++processed, totalPhotos)
      }
      if (offset + 3 >= refs.length) {
        const details = [row.area && `Area: ${row.area}`, row.bay && `Bay: ${row.bay}`, row.notes && `Notes: ${row.notes}`].filter(Boolean)
        table({ startY: 170, head: [], body: [[washFilterLabel(filters)], ...details.map(d => [d])], didDrawPage: () => { header(`Vehicle Washing - ${shown(row.asset_no)}`, subtitle); pageRefs.set(doc.internal.getNumberOfPages(), row.id) } })
      }
    }
  }
  const pages = doc.internal.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFontSize(7); doc.setTextColor(90)
    doc.text(`Generated ${washDateLabel(new Date().toISOString())}${pageRefs.has(page) ? ` | Record: ${pageRefs.get(page)}` : ''}`, 14, 195)
    pdfFooter(doc, page, pages, company, brand)
  }
  if (save) await doc.save(`${filename}.pdf`, { returnPromise: true })
  return { doc, missingPhotos, totalPhotos, vehicles: groups.length }
}
