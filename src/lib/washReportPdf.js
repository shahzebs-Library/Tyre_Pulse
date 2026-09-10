import { loadPdf } from './pdfEngine'
import { applyExportPolicy, resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme } from './exportUtils'
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

export async function exportVehicleWashPdf(rows, { company = '', branding, currency = '', filename = 'vehicle-washing', save = true, loadPhoto = photoData, onProgress = () => {} } = {}) {
  const allowed = applyExportPolicy(rows)
  if (allowed.length !== rows.length) throw new Error('This selection exceeds the export limit. Narrow the filters to include every selected record.')
  if (!allowed.length) throw new Error('No wash records match this selection.')
  const { jsPDF, autoTable } = await loadPdf()
  const logo = branding?.logo_url || await getCompanyLogo()
  const brand = await resolvePdfBrand({ ...branding, logo_url: logo })
  if (!brand.logoData) throw new Error('Company logo could not be loaded. Check Console > Report Colors and try again.')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const groups = groupVehicleWashes(allowed)
  const generated = new Date().toISOString().slice(0, 10)
  const title = 'Vehicle Washing Report'
  const header = subtitle => pdfHeader(doc, title, subtitle, company, brand, { logoSize: 18, hideEyebrow: true })
  const dates = allowed.map(r => r.wash_date).filter(Boolean).sort()
  const range = dates.length ? `${dates[0]} to ${dates.at(-1)}` : 'Dates not recorded'
  const summary = `${groups.length} vehicles | ${allowed.length} records | ${range} | Generated ${generated}`
  header(summary)
  autoTable(doc, {
    ...pdfTableTheme(brand.accent), startY: 32, margin: { top: 32, bottom: 17, left: 14, right: 14 },
    head: [['Vehicle', 'Type', 'Country', 'Sites', 'Records', 'Completed', 'Latest wash record', 'Photos']],
    body: groups.map(records => {
      const first = records[0]
      return [shown(first.asset_no), shown(first.vehicle_type), shown(first.country), [...new Set(records.map(r => shown(r.site)))].join(', '), records.length, records.filter(r => r.status === 'Completed').length, shown(first.wash_date), records.reduce((n, r) => n + (Array.isArray(r.photos) ? r.photos.length : 0), 0)]
    }),
    didDrawPage: () => header(summary),
  })
  let missingPhotos = 0, processed = 0
  const totalPhotos = allowed.reduce((n, r) => n + (Array.isArray(r.photos) ? r.photos.length : 0), 0)
  for (const records of groups) {
    for (const row of records) {
      const refs = Array.isArray(row.photos) ? row.photos : []
      // Four photographs per landscape page, retaining every original picture.
      for (let offset = 0; offset < Math.max(1, refs.length); offset += 4) {
        doc.addPage()
        header(`${shown(row.asset_no)} | ${shown(row.wash_date)} ${row.wash_time || ''} | ${shown(row.site)} | Record ${row.id}`)
        autoTable(doc, {
          ...pdfTableTheme(brand.accent), startY: 30, margin: { left: 14, right: 14, bottom: 17 },
          head: [['Vehicle type', 'Wash type', 'Status', 'Operator', 'Odometer', `Cost ${currency}`]],
          body: [[shown(row.vehicle_type), shown(row.wash_type), shown(row.status), shown(row.washed_by), row.odometer_km == null ? 'Not recorded' : `${row.odometer_km} km`, formatWashCost(row.cost)]],
        })
        if (!refs.length) { doc.setFontSize(11); doc.text('No photos recorded for this wash.', 14, 75) }
        for (let i = 0; i < Math.min(4, refs.length - offset); i++) {
          const x = 14 + (i % 2) * 137, y = 58 + Math.floor(i / 2) * 68
          doc.setDrawColor(220); doc.rect(x, y, 132, 59)
          try {
            const photo = await loadPhoto(refs[offset + i])
            const scale = Math.min(130 / photo.width, 57 / photo.height)
            const w = photo.width * scale, h = photo.height * scale
            doc.addImage(photo.data, 'JPEG', x + (132 - w) / 2, y + (59 - h) / 2, w, h)
          } catch { missingPhotos++; doc.setFontSize(10); doc.text('Photo unavailable', x + 5, y + 30) }
          doc.setFontSize(8); doc.setTextColor(70)
          doc.text(`Photo ${offset + i + 1} of ${refs.length}`, x, y + 63)
          onProgress(++processed, totalPhotos)
        }
      }
      if (row.notes || row.area || row.bay) {
        doc.addPage(); header(`${shown(row.asset_no)} | ${shown(row.wash_date)} | Additional details`)
        autoTable(doc, { ...pdfTableTheme(brand.accent), startY: 32, margin: { top: 32, bottom: 17, left: 14, right: 14 }, head: [['Field', 'Recorded detail']], body: [['Area', shown(row.area)], ['Wash bay', shown(row.bay)], ['Notes', shown(row.notes)]], didDrawPage: () => header(`${shown(row.asset_no)} | Additional details`) })
      }
    }
  }
  const pages = doc.internal.getNumberOfPages()
  for (let page = 1; page <= pages; page++) { doc.setPage(page); pdfFooter(doc, page, pages, company, brand) }
  if (save) doc.save(`${filename}.pdf`)
  return { doc, missingPhotos, totalPhotos, vehicles: groups.length }
}
