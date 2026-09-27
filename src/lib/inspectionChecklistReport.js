/**
 * The "Daily Tyre Inspection Report" PDF for a saved checklist.
 *
 * Moved out of src/pages/Inspections.jsx, where it was a 400-line closure over
 * twenty pieces of component state. The layout, wording and order are
 * unchanged; the summary-strip arithmetic now comes from
 * inspectionsAnalytics.checklistReadingStats so the numbers on the report are
 * the same numbers the tested engine produces.
 *
 * Returns the jsPDF document. The caller decides whether to save it or preview
 * it, which is the one piece of UI state this used to reach into.
 */
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from './exportUtils'
import { loadAutoTable } from './pdfEngine'
import { checklistPdfModel } from './inspectionChecklistPdf'
import { getTyreRunningLife } from './api/tyreRunningLife'
import { shapeRunningLife, measureFor } from './tyreRunningLife'
import { getCompanyLogo, getDiagramBg } from './api/brandLogo'
import { formatDate } from './formatters'
import { checklistReadingStats, pressureDeviationLabel, conditionBucket } from './inspectionsAnalytics'

/**
 * Report logo: tenant branding wins; otherwise fall back to the org-wide company
 * logo set in Console -> Report Colors (system_config.company_logo).
 */
export async function brandingForPdf(branding) {
  if (branding?.logo_url) return branding
  try {
    const logo = await getCompanyLogo()
    return logo ? { ...(branding || {}), logo_url: logo } : branding
  } catch { return branding }
}

/** File name used for both the direct download and the preview's download link. */
export function checklistReportFileName(assetNo) {
  return `TyrePulse_Checklist_${assetNo || 'report'}.pdf`
}

// Muted corporate tones: small dots + dark text, never large coloured fills.
const MUTED = { Good: [22, 101, 52], Wear: [146, 64, 14], Damage: [153, 27, 27], 'No data': [100, 116, 139] }

async function embedDiagram(doc, svgEl, { x, y, width, background }) {
  if (!svgEl) return y
  try {
    const svgStr = new XMLSerializer().serializeToString(svgEl)
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    return await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const scale = 2
        const canvas = document.createElement('canvas')
        const svgW = svgEl.viewBox?.baseVal?.width || svgEl.clientWidth || 400
        const svgH = svgEl.viewBox?.baseVal?.height || svgEl.clientHeight || 300
        canvas.width = svgW * scale
        canvas.height = svgH * scale
        const ctx = canvas.getContext('2d')
        ctx.scale(scale, scale)
        ctx.fillStyle = background
        ctx.fillRect(0, 0, svgW, svgH)
        ctx.drawImage(img, 0, 0, svgW, svgH)
        URL.revokeObjectURL(url)
        const imgData = canvas.toDataURL('image/png')
        const diagH = width * svgH / svgW
        doc.addImage(imgData, 'PNG', x, y, width, diagH)
        resolve(y + diagH + 6)
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(y) }
      img.src = url
    })
  } catch {
    return y // fall through to the table if SVG capture fails
  }
}

/**
 * @param {object} p
 * @param {object} p.saved          the saved inspection row (required)
 * @param {string} [p.asset]        asset typed on the form (falls back to saved.asset_no)
 * @param {object} [p.fleetInfo]    resolved fleet row ({ vehicle_type })
 * @param {string} [p.site]
 * @param {string} [p.inspector]
 * @param {string} [p.odometer]
 * @param {string} [p.hourMeter]
 * @param {string} [p.notes]
 * @param {string[]} [p.photos]     data URLs captured on the form
 * @param {string} [p.signature]    inspector signature data URL
 * @param {string} [p.approverEmail]
 * @param {string} [p.country]      scope for the expected-life lookup
 * @param {Element} [p.svgEl]       the rendered tyre map (svg[data-tyre-map])
 * @param {object} [p.branding]     tenant branding
 * @param {string} [p.company]
 */
export async function buildChecklistReportPdf(p) {
  const {
    saved, asset, fleetInfo, site, inspector, odometer, hourMeter, notes,
    photos: formPhotos = [], signature, approverEmail, country, svgEl, branding, company,
  } = p
  if (!saved) throw new Error('Save the checklist before exporting it.')
  const { default: jsPDF } = await import('jspdf')
  const autoTable = await loadAutoTable()
  const report = checklistPdfModel(saved)
  const tyreData = report.rows
  const assetNo = asset || saved.asset_no

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.width
  const ph = doc.internal.pageSize.height
  const mx = 14

  const brand = await resolvePdfBrand(await brandingForPdf(branding))
  pdfHeader(doc, 'Daily Tyre Inspection Report', `Asset: ${assetNo || 'N/A'}`, company, brand)

  if (!tyreData.length) {
    pdfEmptyState(doc, 'No tyre positions recorded for this checklist')
    pdfFooter(doc, 1, 1, company, brand)
    return doc
  }

  // ── Asset info grid ───────────────────────────────────────────────────────
  let y = 28
  const infoItems = [
    ['Asset No', assetNo || 'N/A'],
    ['Vehicle Type', fleetInfo?.vehicle_type || saved.vehicle_type || 'N/A'],
    ['Site', site || saved.site || 'N/A'],
    ['Inspector', inspector || saved.inspector || 'N/A'],
    ['Date', report.inspectionDate || 'N/A'],
    ['Tyre Count', String(tyreData.length)],
    ['Odometer (km)', odometer || saved.odometer_km || 'N/A'],
    ['Hour Meter', hourMeter || saved.hour_meter || 'N/A'],
  ]
  const colW = (pw - mx * 2) / 3
  infoItems.forEach(([label, value], i) => {
    const ix = mx + (i % 3) * colW
    const iy = y + Math.floor(i / 3) * 12
    doc.setFontSize(7)
    doc.setTextColor(107, 114, 128)
    doc.setFont('helvetica', 'normal')
    doc.text(label, ix, iy)
    doc.setFontSize(9)
    doc.setTextColor(31, 41, 55)
    doc.setFont('helvetica', 'bold')
    doc.text(String(value), ix, iy + 5)
  })
  y += Math.ceil(infoItems.length / 3) * 12 + 6

  // ── Inspection summary strip - recorded readings only, honest N/A ─────────
  const stats = checklistReadingStats(tyreData)
  const one = (v) => Math.round(v * 10) / 10
  {
    const stripW = pw - mx * 2
    const stripH = 15
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.roundedRect(mx, y, stripW, stripH, 1.5, 1.5, 'FD')
    doc.setFillColor(...brand.accent)
    doc.roundedRect(mx, y, 1.4, stripH, 0.7, 0.7, 'F')
    doc.setFontSize(6.3)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 116, 139)
    doc.text('INSPECTION SUMMARY', mx + 5, y + 4.4, { charSpace: 0.4 })
    let cx = mx + 5
    const l1y = y + 8.6
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(8, 12, 28)
    const lead = `Positions checked: ${tyreData.length}`
    doc.text(lead, cx, l1y)
    cx += doc.getTextWidth(lead) + 7
    doc.setFont('helvetica', 'normal')
    ;['Good', 'Wear', 'Damage', 'No data'].forEach((label) => {
      const txt = `${label} ${stats.counts[label]}`
      doc.setFillColor(...MUTED[label])
      doc.circle(cx + 1.2, l1y - 1.1, 1.1, 'F')
      doc.setTextColor(8, 12, 28)
      doc.text(txt, cx + 3.4, l1y)
      cx += doc.getTextWidth(txt) + 10
    })
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(51, 65, 85)
    doc.text([
      `Avg pressure: ${stats.avgPsi != null ? `${one(stats.avgPsi)} PSI` : 'N/A'}`,
      ...(report.includeTread ? [
        `Avg tread: ${stats.avgTread != null ? `${one(stats.avgTread)} mm` : 'N/A'}`,
        `Lowest tread: ${stats.lowestTread ? `${stats.lowestTread.pos} (${one(stats.lowestTread.value)} mm)` : 'N/A'}`,
      ] : []),
    ].join('   |   '), mx + 5, y + 13)
    y += stripH + 5
  }

  // ── The same tyre map the operator saw ────────────────────────────────────
  const diagramBg = (await getDiagramBg().catch(() => '')) || '#000000'
  y = await embedDiagram(doc, svgEl, { x: mx, y, width: pw - mx * 2, background: diagramBg })

  // Colour legend
  let lx = mx
  for (const label of ['Good', 'Wear', 'Damage', 'No data']) {
    doc.setFillColor(...MUTED[label])
    doc.circle(lx + 2, y, 1.4, 'F')
    doc.setTextColor(51, 65, 85)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text(label, lx + 5, y + 1)
    lx += 26
  }
  y += 8

  // ── Tyre data table ───────────────────────────────────────────────────────
  const flagOn = stats.flagPressure
  const tblHead = ['Position', 'Pressure (PSI)', 'Condition']
  if (report.includeTread) tblHead.push('Tread Depth (mm)')
  if (flagOn) tblHead.push('Pressure vs median')
  const theme = pdfTableTheme(brand.accent)
  autoTable(doc, {
    ...theme,
    styles: { ...theme.styles, fontSize: 7, textColor: [8, 12, 28] },
    startY: y,
    head: [tblHead],
    body: tyreData.map((row) => {
      const cells = [
        row.position || 'N/A',
        row.pressure ? `${row.pressure} PSI` : 'N/A',
        row.condition || 'N/A',
      ]
      if (report.includeTread) cells.push(row.treadDepth != null ? `${row.treadDepth} mm` : 'N/A')
      if (flagOn) cells.push(pressureDeviationLabel(row.pressure, stats.medianPsi))
      return cells
    }),
    margin: { left: mx, right: mx },
    didParseCell(data) {
      if (data.section !== 'body') return
      if (data.column.index === 2) {
        data.cell.styles.cellPadding = { left: 6, right: 2.6, top: 2.6, bottom: 2.6 }
        data.cell.styles.textColor = [8, 12, 28]
      }
      if (flagOn && data.column.index === tblHead.length - 1 && /^Check/.test(String(data.cell.raw))) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.textColor = MUTED.Damage
      }
    },
    didDrawCell(data) {
      theme.didDrawCell?.(data)
      if (data.section !== 'body' || data.column.index !== 2) return
      doc.setFillColor(...MUTED[conditionBucket(data.cell.raw)])
      doc.circle(data.cell.x + 3.2, data.cell.y + data.cell.height / 2, 1.1, 'F')
    },
  })

  let finalY = (doc.lastAutoTable?.finalY ?? (y + 40)) + 8

  // ── Expected tyre life (km AND hours), best-effort ────────────────────────
  try {
    if (assetNo) {
      const payload = await getTyreRunningLife({ country, asset: assetNo })
      const lifeRows = shapeRunningLife(payload).rows.slice(0, 16)
      if (lifeRows.length) {
        if (finalY + 30 > ph - 20) { doc.addPage(); finalY = 20 }
        doc.setTextColor(8, 12, 28)
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.text('Expected Tyre Life', mx, finalY)
        finalY += 3
        const n = (v) => (v == null ? 'N/A' : Math.round(v).toLocaleString('en-US'))
        const both = (km, hrs) => (km == null && hrs == null ? 'N/A'
          : [km != null ? `${n(km)} km` : null, hrs != null ? `${n(hrs)} hrs` : null].filter(Boolean).join(' / '))
        autoTable(doc, {
          ...pdfTableTheme(brand.accent),
          startY: finalY,
          margin: { left: mx, right: mx },
          head: [['Position', 'Serial', 'Brand', 'Km run', 'Hours run', 'Current km', 'Expected life', 'Remaining', 'Remaining days', 'Life used']],
          body: lifeRows.map((lr) => {
            const used = measureFor(lr).used
            return [
              lr.position || 'N/A', lr.serial || 'N/A', lr.brand || 'N/A',
              n(lr.kmRun), n(lr.hoursRun), n(lr.currentKm),
              both(lr.expectedLifeKm, lr.expectedLifeHours),
              both(lr.remainingKm, lr.remainingHours),
              n(lr.remainingDays),
              used != null ? `${used}%` : 'N/A',
            ]
          }),
        })
        finalY = (doc.lastAutoTable?.finalY ?? finalY) + 8
      }
    }
  } catch { /* best-effort - the checklist report never blocks on lifecycle data */ }

  if (notes) {
    doc.setTextColor(8, 12, 28)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Notes', mx, finalY)
    finalY += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    const lines = doc.splitTextToSize(notes, pw - mx * 2)
    doc.text(lines, mx, finalY)
    finalY += lines.length * 4.5 + 6
  }

  // ── Photos ────────────────────────────────────────────────────────────────
  const photos = formPhotos.length > 0 ? formPhotos : (saved.photo_data ? [saved.photo_data] : [])
  if (photos.length > 0) {
    if (finalY + 60 > ph - 20) { doc.addPage(); finalY = 20 }
    doc.setTextColor(8, 12, 28)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Photos', mx, finalY)
    finalY += 5
    const photoW = 40
    const photoH = 30
    const photoCols = Math.floor((pw - mx * 2) / (photoW + 4))
    const shown = Math.min(photos.length, 6)
    for (let pi = 0; pi < shown; pi++) {
      const px = mx + (pi % photoCols) * (photoW + 4)
      const py = finalY + Math.floor(pi / photoCols) * (photoH + 4)
      try {
        doc.addImage(photos[pi], 'JPEG', px, py, photoW, photoH)
        doc.setDrawColor(209, 213, 219)
        doc.setLineWidth(0.3)
        doc.rect(px, py, photoW, photoH)
      } catch { /* skip bad image */ }
    }
    finalY += Math.ceil(shown / photoCols) * (photoH + 4) + 6
  }

  // ── Signatures ────────────────────────────────────────────────────────────
  const sigH = 24
  const sigW = 70
  if (finalY + sigH + 20 > ph - 15) { doc.addPage(); finalY = 20 }
  finalY += 4
  doc.setTextColor(8, 12, 28)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Signatures', mx, finalY)
  finalY += 5

  const sig = signature || saved.inspector_signature
  if (sig) {
    doc.setDrawColor(209, 213, 219)
    doc.setLineWidth(0.3)
    doc.rect(mx, finalY, sigW, sigH)
    try { doc.addImage(sig, 'PNG', mx, finalY, sigW, sigH) } catch { /* skip */ }
    doc.setFontSize(7)
    doc.setTextColor(107, 114, 128)
    doc.setFont('helvetica', 'normal')
    doc.text(`Inspector: ${inspector || saved.inspector || ''}`, mx, finalY + sigH + 4)
    doc.text(report.inspectionDate ? formatDate(report.inspectionDate) : 'Not recorded', mx + sigW - 1, finalY + sigH + 4, { align: 'right' })
  } else {
    doc.setDrawColor(156, 163, 175)
    doc.setLineWidth(0.5)
    doc.line(mx, finalY + sigH, mx + sigW, finalY + sigH)
    doc.setFontSize(7.5)
    doc.setTextColor(107, 114, 128)
    doc.setFont('helvetica', 'normal')
    doc.text('Inspector Signature', mx, finalY + sigH + 4)
  }

  const approverX = mx + sigW + 15
  doc.setDrawColor(209, 213, 219)
  doc.setLineWidth(0.3)
  doc.rect(approverX, finalY, sigW, sigH)
  doc.setFontSize(8)
  doc.setTextColor(156, 163, 175)
  doc.text('Approver Signature', approverX + 2, finalY + 10)
  doc.setFontSize(7)
  doc.text(approverEmail ? `Sent to: ${approverEmail}` : 'Pending', approverX + 2, finalY + 16)
  doc.setFont('helvetica', 'normal')
  doc.text('Approved by / التوقيع', approverX, finalY + sigH + 4)

  const totalPages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    pdfFooter(doc, i, totalPages, company, brand)
  }
  return doc
}
