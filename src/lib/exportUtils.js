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

  // Column widths — auto-size up to 40 chars
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

  // Header
  doc.setFillColor(17, 24, 39)          // gray-900
  doc.rect(0, 0, doc.internal.pageSize.width, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('TyrePulse — Tyre Intelligence Platform', 14, 10)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(title, 14, 17)

  doc.setTextColor(150, 150, 150)
  doc.setFontSize(8)
  doc.text(`Generated: ${nowStr()}  |  ${rows.length} records`, doc.internal.pageSize.width - 14, 17, { align: 'right' })

  autoTable(doc, {
    startY: 26,
    head: [columns.map(c => c.header)],
    body: rows.map(r => columns.map(c => String(r[c.key] ?? '—'))),
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
      columns.map((c, i) => [i, { cellWidth: c.width ?? 'auto' }])
    ),
    margin: { left: 14, right: 14 },
    didDrawPage: (data) => {
      // Footer on every page
      doc.setFontSize(7)
      doc.setTextColor(150)
      doc.text(
        `Page ${data.pageNumber}`,
        doc.internal.pageSize.width / 2,
        doc.internal.pageSize.height - 6,
        { align: 'center' }
      )
    },
  })

  doc.save(`${filename}.pdf`)
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
  s1.addText(`Management Summary Report — ${data.period}`, { x: 0.6, y: 3.1, w: 12, h: 0.5, fontSize: 16, color: '9CA3AF', fontFace: 'Arial' })
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
      { text: a.site ?? '—', options: { color: '9CA3AF', fontSize: 10 } },
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
