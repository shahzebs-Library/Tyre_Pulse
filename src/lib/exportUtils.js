import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import pptxgen from 'pptxgenjs'

// ── Shared helpers ─────────────────────────────────────────────────────────────
function nowStr() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Excel Export ───────────────────────────────────────────────────────────────
/**
 * Export an array of objects to a .xlsx file.
 * @param {Object[]} rows      - Data rows (plain objects)
 * @param {string[]} columns   - Keys to include, in order
 * @param {string[]} headers   - Display headers matching columns
 * @param {string}   filename  - Output filename (no extension needed)
 * @param {string}   sheetName
 */
export function exportToExcel(rows, columns, headers, filename = 'export', sheetName = 'Sheet1') {
  const displayRows = rows.map(r =>
    Object.fromEntries(columns.map((col, i) => [headers[i], r[col] ?? '']))
  )
  const ws = XLSX.utils.json_to_sheet(displayRows, { header: headers })

  // Column widths · auto-size up to 40 chars
  ws['!cols'] = headers.map((h, i) => {
    const maxLen = Math.max(
      h.length,
      ...displayRows.map(r => String(r[h] ?? '').length)
    )
    return { wch: Math.min(maxLen + 2, 40) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ── PDF Export ─────────────────────────────────────────────────────────────────
/**
 * Export a table to a PDF file using jspdf-autotable.
 * @param {Object[]} rows
 * @param {{ key: string, header: string, width?: number }[]} columns
 * @param {string}   title
 * @param {string}   filename
 * @param {'portrait'|'landscape'} orientation
 */
export function exportToPdf(rows, columns, title, filename = 'report', orientation = 'landscape') {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })

  // Header · TyrePulse green band
  doc.setFillColor(22, 101, 52)          // green-800 (#15803d)
  doc.rect(0, 0, doc.internal.pageSize.width, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('TYREPULSE · Tyre Intelligence Platform', 14, 10)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(title, 14, 17)

  doc.setTextColor(150, 150, 150)
  doc.setFontSize(8)
  doc.text(`Generated: ${nowStr()}  |  ${rows.length} records`, doc.internal.pageSize.width - 14, 17, { align: 'right' })

  // Auto-fit column widths to fill usable page width
  const usableWidth = orientation === 'landscape' ? 237 : 170
  const colWidths = columns.map(c => {
    const key = c.key?.toLowerCase() ?? ''
    const hdr = c.header?.toLowerCase() ?? ''
    if (key.includes('id') || key === 'qty' || key === 'no') return 22
    if (key.includes('risk') || hdr.includes('risk')) return 30
    if (key.includes('remark') || key.includes('description') || key.includes('note')) return 55
    if (key.includes('date') || key.includes('month')) return 28
    if (key.includes('cost') || key.includes('sar')) return 30
    if (key.includes('site') || key.includes('brand') || key.includes('category')) return 32
    return 30
  })
  const rawTotal = colWidths.reduce((s, w) => s + w, 0)
  const scaleFactor = usableWidth / rawTotal
  const scaledWidths = colWidths.map(w => Math.round(w * scaleFactor * 10) / 10)

  // Identify risk column index for cell colouring
  const riskColIdx = columns.findIndex(c =>
    /risk/i.test(c.header ?? '') || /risk_level/i.test(c.key ?? '')
  )

  autoTable(doc, {
    startY: 26,
    head: [columns.map(c => c.header)],
    body: rows.map(r => columns.map(c => String(r[c.key] ?? ' '))),
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      overflow: 'linebreak',
      textColor: [30, 30, 30],
    },
    headStyles: {
      fillColor: [37, 99, 235],    // blue-600
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: Object.fromEntries(
      scaledWidths.map((w, i) => [i, { cellWidth: w }])
    ),
    margin: { left: 14, right: 14 },
    didParseCell: riskColIdx >= 0 ? (data) => {
      if (data.section === 'body' && data.column.index === riskColIdx) {
        const val = String(data.cell.raw ?? '').trim().toLowerCase()
        if (val === 'critical') {
          data.cell.styles.fillColor = [127, 29, 29]
          data.cell.styles.textColor = [255, 255, 255]
        } else if (val === 'high') {
          data.cell.styles.fillColor = [124, 45, 18]
          data.cell.styles.textColor = [255, 255, 255]
        } else if (val === 'medium') {
          data.cell.styles.fillColor = [113, 63, 18]
          data.cell.styles.textColor = [255, 255, 255]
        } else if (val === 'low') {
          data.cell.styles.fillColor = [20, 83, 45]
          data.cell.styles.textColor = [255, 255, 255]
        }
      }
    } : undefined,
    didDrawPage: (data) => {
      // Footer on every page
      const pageH = doc.internal.pageSize.height
      const pageW = doc.internal.pageSize.width
      doc.setFontSize(7)
      doc.setTextColor(107, 114, 128)
      doc.text(
        'Confidential · Internal Use Only | TyrePulse',
        14,
        pageH - 6
      )
      doc.text(
        `Page ${data.pageNumber}`,
        pageW - 14,
        pageH - 6,
        { align: 'right' }
      )
    },
  })

  doc.save(`${filename}.pdf`)
}

// ── Inspection Detail PDF ──────────────────────────────────────────────────────
const _TYRE_LAYOUTS = {
  Pickup: {
    body: { x: 60, y: 40, w: 80, h: 200, rx: 8 },
    tyres: [
      { id: 'FL', x: 35,  y: 55,  w: 22, h: 38, rx: 4, label: 'FL' },
      { id: 'FR', x: 143, y: 55,  w: 22, h: 38, rx: 4, label: 'FR' },
      { id: 'RL', x: 35,  y: 185, w: 22, h: 38, rx: 4, label: 'RL' },
      { id: 'RR', x: 143, y: 185, w: 22, h: 38, rx: 4, label: 'RR' },
    ],
  },
  'Wheel loader': {
    body: { x: 60, y: 40, w: 80, h: 200, rx: 8 },
    tyres: [
      { id: 'FL', x: 30,  y: 55,  w: 28, h: 44, rx: 5, label: 'FL' },
      { id: 'FR', x: 142, y: 55,  w: 28, h: 44, rx: 5, label: 'FR' },
      { id: 'RL', x: 30,  y: 185, w: 28, h: 44, rx: 5, label: 'RL' },
      { id: 'RR', x: 142, y: 185, w: 28, h: 44, rx: 5, label: 'RR' },
    ],
  },
  'Skid loader': {
    body: { x: 60, y: 40, w: 80, h: 200, rx: 8 },
    tyres: [
      { id: 'FL', x: 30,  y: 55,  w: 28, h: 44, rx: 5, label: 'FL' },
      { id: 'FR', x: 142, y: 55,  w: 28, h: 44, rx: 5, label: 'FR' },
      { id: 'RL', x: 30,  y: 185, w: 28, h: 44, rx: 5, label: 'RL' },
      { id: 'RR', x: 142, y: 185, w: 28, h: 44, rx: 5, label: 'RR' },
    ],
  },
  Canter: {
    body: { x: 60, y: 30, w: 80, h: 240, rx: 8 },
    tyres: [
      { id: 'FL',  x: 35,  y: 45,  w: 22, h: 36, rx: 4, label: 'FL'  },
      { id: 'FR',  x: 143, y: 45,  w: 22, h: 36, rx: 4, label: 'FR'  },
      { id: 'RLo', x: 22,  y: 175, w: 20, h: 34, rx: 3, label: 'RLo' },
      { id: 'RLi', x: 44,  y: 175, w: 20, h: 34, rx: 3, label: 'RLi' },
      { id: 'RRi', x: 136, y: 175, w: 20, h: 34, rx: 3, label: 'RRi' },
      { id: 'RRo', x: 158, y: 175, w: 20, h: 34, rx: 3, label: 'RRo' },
    ],
  },
  'Tri-mixer': {
    body: { x: 55, y: 20, w: 90, h: 290, rx: 8 },
    tyres: [
      { id: 'F1L',  x: 28,  y: 30,  w: 22, h: 34, rx: 4, label: 'F1L'  },
      { id: 'F1R',  x: 150, y: 30,  w: 22, h: 34, rx: 4, label: 'F1R'  },
      { id: 'F2L',  x: 28,  y: 80,  w: 22, h: 34, rx: 4, label: 'F2L'  },
      { id: 'F2R',  x: 150, y: 80,  w: 22, h: 34, rx: 4, label: 'F2R'  },
      { id: 'R1Lo', x: 16,  y: 170, w: 18, h: 32, rx: 3, label: 'R1Lo' },
      { id: 'R1Li', x: 36,  y: 170, w: 18, h: 32, rx: 3, label: 'R1Li' },
      { id: 'R1Ri', x: 146, y: 170, w: 18, h: 32, rx: 3, label: 'R1Ri' },
      { id: 'R1Ro', x: 166, y: 170, w: 18, h: 32, rx: 3, label: 'R1Ro' },
      { id: 'R2Lo', x: 16,  y: 215, w: 18, h: 32, rx: 3, label: 'R2Lo' },
      { id: 'R2Li', x: 36,  y: 215, w: 18, h: 32, rx: 3, label: 'R2Li' },
      { id: 'R2Ri', x: 146, y: 215, w: 18, h: 32, rx: 3, label: 'R2Ri' },
      { id: 'R2Ro', x: 166, y: 215, w: 18, h: 32, rx: 3, label: 'R2Ro' },
    ],
  },
  'Concrete pump': {
    body: { x: 55, y: 20, w: 90, h: 310, rx: 8 },
    tyres: [
      { id: 'FL',   x: 28,  y: 30,  w: 22, h: 34, rx: 4, label: 'FL'   },
      { id: 'FR',   x: 150, y: 30,  w: 22, h: 34, rx: 4, label: 'FR'   },
      { id: 'R1Lo', x: 16,  y: 130, w: 18, h: 30, rx: 3, label: 'R1Lo' },
      { id: 'R1Li', x: 36,  y: 130, w: 18, h: 30, rx: 3, label: 'R1Li' },
      { id: 'R1Ri', x: 146, y: 130, w: 18, h: 30, rx: 3, label: 'R1Ri' },
      { id: 'R1Ro', x: 166, y: 130, w: 18, h: 30, rx: 3, label: 'R1Ro' },
      { id: 'R2Lo', x: 16,  y: 175, w: 18, h: 30, rx: 3, label: 'R2Lo' },
      { id: 'R2Li', x: 36,  y: 175, w: 18, h: 30, rx: 3, label: 'R2Li' },
      { id: 'R2Ri', x: 146, y: 175, w: 18, h: 30, rx: 3, label: 'R2Ri' },
      { id: 'R2Ro', x: 166, y: 175, w: 18, h: 30, rx: 3, label: 'R2Ro' },
      { id: 'R3Lo', x: 16,  y: 220, w: 18, h: 30, rx: 3, label: 'R3Lo' },
      { id: 'R3Li', x: 36,  y: 220, w: 18, h: 30, rx: 3, label: 'R3Li' },
      { id: 'R3Ri', x: 146, y: 220, w: 18, h: 30, rx: 3, label: 'R3Ri' },
      { id: 'R3Ro', x: 166, y: 220, w: 18, h: 30, rx: 3, label: 'R3Ro' },
    ],
  },
}

const _RISK_RGB = {
  good:     [34,  197, 94],
  warning:  [234, 179, 8],
  critical: [239, 68,  68],
  none:     [75,  85,  99],
}

function _drawTyreDiagram(doc, layout, tyreConditions, originX, originY, scale) {
  const { body, tyres } = layout
  const tc = tyreConditions || {}

  // Vehicle body
  doc.setFillColor(31, 41, 55)
  doc.setDrawColor(55, 65, 81)
  doc.setLineWidth(0.3)
  doc.roundedRect(
    originX + body.x * scale,
    originY + body.y * scale,
    body.w * scale,
    body.h * scale,
    Math.max(0.5, body.rx * scale * 0.4),
    Math.max(0.5, body.rx * scale * 0.4),
    'FD'
  )

  // Tyres
  tyres.forEach(t => {
    const risk = tc[t.id]?.risk ?? 'none'
    const [r, g, b] = _RISK_RGB[risk] ?? _RISK_RGB.none
    doc.setFillColor(r, g, b)
    doc.setDrawColor(Math.max(0, r - 40), Math.max(0, g - 40), Math.max(0, b - 40))
    doc.roundedRect(
      originX + t.x * scale,
      originY + t.y * scale,
      t.w * scale,
      t.h * scale,
      Math.max(0.3, t.rx * scale * 0.4),
      Math.max(0.3, t.rx * scale * 0.4),
      'FD'
    )

    // Label
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(Math.max(3, t.w < 20 ? 3.5 : 4.5))
    doc.text(
      t.label,
      originX + (t.x + t.w / 2) * scale,
      originY + (t.y + t.h / 2) * scale,
      { align: 'center', baseline: 'middle' }
    )
  })
}

/**
 * Export a single inspection record as a detailed PDF with tyre diagram.
 * @param {Object} row - inspection record (includes vehicle_type, tyre_conditions)
 */
export function exportInspectionDetailPdf(row) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width  // 210
  const pageH = doc.internal.pageSize.height // 297

  // Green header band
  doc.setFillColor(22, 101, 52)
  doc.rect(0, 0, pageW, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('TYREPULSE · Tyre Intelligence Platform', 14, 10)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Inspection Report', 14, 17)
  doc.setFontSize(8)
  doc.setTextColor(180, 220, 180)
  doc.text(`Generated: ${nowStr()}`, pageW - 14, 17, { align: 'right' })

  // Section: Inspection Details
  let y = 30
  const label = (txt) => { doc.setFontSize(7); doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.text(txt, 14, y) }
  const value = (txt, x = 14, yOff = 4.5) => { doc.setFontSize(9); doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.text(String(txt || '—'), x, y + yOff) }

  label('Title')
  value(row.title)
  y += 10

  // Two-column info grid
  const col2 = 115
  const fields = [
    [['Type', row.inspection_type], ['Status', row.status]],
    [['Site', row.site], ['Date', row.scheduled_date]],
    [['Asset No', row.asset_no || '—'], ['Severity', row.severity || '—']],
    [['Inspector', row.inspector || row.attendees || '—'], ['Vehicle', row.vehicle_type || '—']],
  ]
  fields.forEach(([left, right]) => {
    label(left[0])
    doc.setFontSize(7); doc.setTextColor(120, 120, 120); doc.text(right[0], col2, y)
    value(left[1])
    doc.setFontSize(9); doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.text(String(right[1] || '—'), col2, y + 4.5)
    y += 10
  })

  // Tyre diagram
  const layout = row.vehicle_type ? _TYRE_LAYOUTS[row.vehicle_type] : null
  if (layout) {
    y += 4
    doc.setFontSize(8)
    doc.setTextColor(60, 60, 60)
    doc.setFont('helvetica', 'bold')
    doc.text('Tyre Condition Diagram', 14, y)
    y += 5

    // Scale diagram to fit ~70mm wide, centred on left half of page
    const diagramW = 70
    const scale = diagramW / 200
    const bodyBottom = layout.body.y + layout.body.h
    const diagramH = bodyBottom * scale + 8
    const originX = 14
    const originY = y

    // Light background box
    doc.setFillColor(245, 247, 250)
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.2)
    doc.roundedRect(originX - 3, originY - 3, diagramW + 6, diagramH + 6, 2, 2, 'FD')

    _drawTyreDiagram(doc, layout, row.tyre_conditions, originX, originY, scale)

    // Legend — beside the diagram
    const legendX = originX + diagramW + 12
    let legendY = originY + 10
    doc.setFontSize(7)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(60, 60, 60)
    doc.text('Legend', legendX, legendY)
    legendY += 5
    const legendItems = [['Good', _RISK_RGB.good], ['Warning', _RISK_RGB.warning], ['Critical', _RISK_RGB.critical], ['No data', _RISK_RGB.none]]
    legendItems.forEach(([lbl, rgb]) => {
      doc.setFillColor(...rgb)
      doc.roundedRect(legendX, legendY - 2.5, 4, 4, 0.5, 0.5, 'F')
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(40, 40, 40)
      doc.text(lbl, legendX + 6, legendY + 0.5)
      legendY += 7
    })

    // Tyre condition table (if any set)
    const conditions = Object.entries(row.tyre_conditions || {})
    if (conditions.length > 0) {
      legendY += 4
      doc.setFontSize(7)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(60, 60, 60)
      doc.text('Tyre Details', legendX, legendY)
      legendY += 4
      conditions.forEach(([tyreId, data]) => {
        doc.setFontSize(6.5)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(40, 40, 40)
        const psi = data.pressure ? ` · ${data.pressure} PSI` : ''
        doc.text(`${tyreId}: ${data.risk ?? 'none'}${psi}`, legendX, legendY)
        legendY += 5
      })
    }

    y = originY + diagramH + 8
  }

  // Findings
  if (row.findings) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(60, 60, 60)
    doc.text('Findings', 14, y)
    y += 4
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 30)
    const lines = doc.splitTextToSize(row.findings, pageW - 28)
    doc.text(lines, 14, y)
    y += lines.length * 4.5 + 4
  }

  // Notes
  if (row.notes) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(60, 60, 60)
    doc.text('Notes', 14, y)
    y += 4
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 30)
    const lines = doc.splitTextToSize(row.notes, pageW - 28)
    doc.text(lines, 14, y)
  }

  // Footer
  doc.setFontSize(7)
  doc.setTextColor(107, 114, 128)
  doc.text('Confidential · Internal Use Only | TyrePulse', 14, pageH - 6)
  doc.text('Page 1', pageW - 14, pageH - 6, { align: 'right' })

  const safeTitle = (row.title || 'inspection').replace(/[^a-z0-9]/gi, '_')
  doc.save(`TyrePulse_Inspection_${safeTitle}.pdf`)
}

// ── PowerPoint Export ──────────────────────────────────────────────────────────
/**
 * Generate a management summary PowerPoint report.
 *
 * @param {{
 *   totalTyres: number,
 *   totalCost: number,
 *   openActions: number,
 *   highRisk: number,
 *   topSites: { site: string, count: number }[],
 *   topBrands: { brand: string, count: number }[],
 *   riskBreakdown: { level: string, count: number }[],
 *   categoryBreakdown: { category: string, count: number }[],
 *   monthlyTrend: { month: string, count: number }[],
 *   recentActions: { title: string, priority: string, site: string, status: string }[],
 *   period: string,
 *   company: string,
 * }} data
 * @param {string} filename
 */
export async function exportToPptx(data, filename = 'TyrePulse_Report') {
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'   // 13.33" × 7.5"

  const DARK   = '111827'  // gray-900
  const ACCENT = '2563EB'  // blue-600
  const WHITE  = 'FFFFFF'
  const LIGHT  = 'F3F4F6'
  const RED    = 'DC2626'
  const ORANGE = 'EA580C'
  const YELLOW = 'D97706'
  const GREEN  = '16A34A'

  const RISK_COLORS = { Critical: RED, High: ORANGE, Medium: YELLOW, Low: GREEN }

  // ── Slide 1: Title ──────────────────────────────────────────────────────────
  const s1 = pptx.addSlide()
  s1.background = { color: DARK }

  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: ACCENT } })

  s1.addText('🔄 TyrePulse', { x: 0.6, y: 1.4, w: 12, h: 1, fontSize: 44, bold: true, color: WHITE, fontFace: 'Arial' })
  s1.addText('Tyre Intelligence Platform', { x: 0.6, y: 2.4, w: 12, h: 0.6, fontSize: 22, color: '93C5FD', fontFace: 'Arial' })
  s1.addText(`Management Summary Report · ${data.period}`, { x: 0.6, y: 3.1, w: 12, h: 0.5, fontSize: 16, color: '9CA3AF', fontFace: 'Arial' })
  if (data.company) {
    s1.addText(data.company, { x: 0.6, y: 3.8, w: 12, h: 0.4, fontSize: 13, color: '6B7280', fontFace: 'Arial' })
  }
  s1.addText(`Generated: ${nowStr()}`, { x: 0.6, y: 6.8, w: 12, h: 0.35, fontSize: 10, color: '4B5563', fontFace: 'Arial' })
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 7.38, w: 13.33, h: 0.12, fill: { color: ACCENT } })

  // ── Slide 2: Executive Summary (4 KPI tiles) ────────────────────────────────
  const s2 = pptx.addSlide()
  s2.background = { color: DARK }
  addSlideHeader(pptx, s2, 'Executive Summary', ACCENT, WHITE)

  const kpis = [
    { label: 'Total Tyre Records', value: data.totalTyres?.toLocaleString() ?? '0', color: ACCENT },
    { label: 'Total Cost (SAR)', value: formatSAR(data.totalCost), color: '7C3AED' },
    { label: 'High Risk Records', value: data.highRisk?.toLocaleString() ?? '0', color: RED },
    { label: 'Open Corrective Actions', value: data.openActions?.toLocaleString() ?? '0', color: YELLOW },
  ]
  kpis.forEach((k, i) => {
    const x = 0.3 + i * 3.2
    s2.addShape(pptx.ShapeType.rect, { x, y: 1.3, w: 3, h: 1.6, fill: { color: '1F2937' }, line: { color: k.color, width: 1 }, rounding: true })
    s2.addText(k.value, { x, y: 1.45, w: 3, h: 0.8, fontSize: 28, bold: true, color: k.color, align: 'center', fontFace: 'Arial' })
    s2.addText(k.label, { x, y: 2.2, w: 3, h: 0.5, fontSize: 11, color: '9CA3AF', align: 'center', fontFace: 'Arial' })
  })

  // ── Slide 3: Top Sites ──────────────────────────────────────────────────────
  if (data.topSites?.length) {
    const s3 = pptx.addSlide()
    s3.background = { color: DARK }
    addSlideHeader(pptx, s3, 'Top Sites by Tyre Consumption', ACCENT, WHITE)

    const tableRows = data.topSites.slice(0, 12).map((s, i) => [
      { text: String(i + 1), options: { color: '9CA3AF', fontSize: 11 } },
      { text: s.site, options: { color: WHITE, fontSize: 11, bold: i === 0 } },
      { text: String(s.count), options: { color: i === 0 ? ACCENT : WHITE, fontSize: 11, bold: i === 0, align: 'right' } },
    ])

    s3.addTable(
      [
        [{ text: '#', options: { bold: true, color: WHITE, fill: ACCENT } }, { text: 'Site', options: { bold: true, color: WHITE, fill: ACCENT } }, { text: 'Tyres', options: { bold: true, color: WHITE, fill: ACCENT, align: 'right' } }],
        ...tableRows,
      ],
      { x: 0.5, y: 1.3, w: 6, colW: [0.5, 4.5, 1], border: { type: 'none' }, fill: '1F2937', fontSize: 11 }
    )
  }

  // ── Slide 4: Risk + Category breakdown ─────────────────────────────────────
  const s4 = pptx.addSlide()
  s4.background = { color: DARK }
  addSlideHeader(pptx, s4, 'Risk Level & Category Breakdown', ACCENT, WHITE)

  if (data.riskBreakdown?.length) {
    const total = data.riskBreakdown.reduce((s, r) => s + r.count, 0)
    let y = 1.4
    for (const r of data.riskBreakdown) {
      const pct = total > 0 ? r.count / total : 0
      const col = RISK_COLORS[r.level] ?? '6B7280'
      s4.addText(r.level, { x: 0.5, y, w: 2.2, h: 0.38, fontSize: 12, color: col, fontFace: 'Arial' })
      s4.addShape(pptx.ShapeType.rect, { x: 2.8, y: y + 0.05, w: 5, h: 0.28, fill: { color: '374151' } })
      s4.addShape(pptx.ShapeType.rect, { x: 2.8, y: y + 0.05, w: 5 * pct, h: 0.28, fill: { color: col } })
      s4.addText(`${r.count}`, { x: 8.0, y, w: 1, h: 0.38, fontSize: 12, color: WHITE, align: 'right', fontFace: 'Arial' })
      y += 0.55
    }
  }

  if (data.categoryBreakdown?.length) {
    const catRows = data.categoryBreakdown.slice(0, 8).map(c => [
      { text: c.category, options: { color: WHITE, fontSize: 10 } },
      { text: String(c.count), options: { color: '93C5FD', fontSize: 10, align: 'right' } },
    ])
    s4.addTable(
      [
        [{ text: 'Category', options: { bold: true, color: WHITE, fill: ACCENT } }, { text: 'Count', options: { bold: true, color: WHITE, fill: ACCENT, align: 'right' } }],
        ...catRows,
      ],
      { x: 9.5, y: 1.3, w: 3.5, colW: [2.8, 0.7], border: { type: 'none' }, fill: '1F2937', fontSize: 10 }
    )
  }

  // ── Slide 5: Monthly Trend ──────────────────────────────────────────────────
  if (data.monthlyTrend?.length) {
    const s5 = pptx.addSlide()
    s5.background = { color: DARK }
    addSlideHeader(pptx, s5, 'Monthly Tyre Issue Trend', ACCENT, WHITE)

    const maxVal = Math.max(...data.monthlyTrend.map(m => m.count), 1)
    const chartH = 3.5
    const chartY = 1.5
    const chartX = 0.8
    const barW = 1.2
    const gap = 0.2

    data.monthlyTrend.forEach((m, i) => {
      const barH = (m.count / maxVal) * chartH
      const x = chartX + i * (barW + gap)
      s5.addShape(pptx.ShapeType.rect, { x, y: chartY + (chartH - barH), w: barW, h: barH, fill: { color: ACCENT } })
      s5.addText(String(m.count), { x, y: chartY + chartH - barH - 0.35, w: barW, h: 0.35, fontSize: 11, color: WHITE, align: 'center', fontFace: 'Arial' })
      s5.addText(m.month, { x, y: chartY + chartH + 0.08, w: barW, h: 0.35, fontSize: 10, color: '9CA3AF', align: 'center', fontFace: 'Arial' })
    })
  }

  // ── Slide 6: Open Corrective Actions ───────────────────────────────────────
  if (data.recentActions?.length) {
    const s6 = pptx.addSlide()
    s6.background = { color: DARK }
    addSlideHeader(pptx, s6, 'Open Corrective Actions', ACCENT, WHITE)

    const actionRows = data.recentActions.slice(0, 10).map(a => [
      { text: a.title, options: { color: WHITE, fontSize: 10 } },
      { text: a.site ?? ' ', options: { color: '9CA3AF', fontSize: 10 } },
      { text: a.priority, options: { color: RISK_COLORS[a.priority] ?? WHITE, fontSize: 10, bold: a.priority === 'High' } },
      { text: a.status, options: { color: '9CA3AF', fontSize: 10 } },
    ])

    s6.addTable(
      [
        [
          { text: 'Title', options: { bold: true, color: WHITE, fill: ACCENT } },
          { text: 'Site', options: { bold: true, color: WHITE, fill: ACCENT } },
          { text: 'Priority', options: { bold: true, color: WHITE, fill: ACCENT } },
          { text: 'Status', options: { bold: true, color: WHITE, fill: ACCENT } },
        ],
        ...actionRows,
      ],
      { x: 0.5, y: 1.3, w: 12.5, colW: [6, 2.5, 1.8, 2.2], border: { type: 'none' }, fill: '1F2937', fontSize: 10 }
    )
  }

  await pptx.writeFile({ fileName: `${filename}.pptx` })
}

// ── Slide header helper ────────────────────────────────────────────────────────
function addSlideHeader(pptx, slide, title, accentColor, textColor) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.1, fill: { color: '1F2937' } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.1, w: 13.33, h: 0.04, fill: { color: accentColor } })
  slide.addText(title, { x: 0.4, y: 0.2, w: 12, h: 0.7, fontSize: 20, bold: true, color: textColor, fontFace: 'Arial' })
  slide.addText('TyrePulse', { x: 11.5, y: 0.3, w: 1.7, h: 0.5, fontSize: 10, color: '4B5563', align: 'right', fontFace: 'Arial' })
}

function formatSAR(n) {
  if (!n) return 'SAR 0'
  if (n >= 1_000_000) return `SAR ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `SAR ${(n / 1_000).toFixed(0)}K`
  return `SAR ${n.toLocaleString()}`
}
