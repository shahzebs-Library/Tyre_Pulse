import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import pptxgen from 'pptxgenjs'

// ── Shared helpers ─────────────────────────────────────────────────────────────
function nowStr() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function nowFull() {
  return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function pct(n, total) {
  if (!total) return 0
  return Math.round((n / total) * 100)
}
function fmtSAR(n) {
  if (!n && n !== 0) return 'SAR —'
  if (n >= 1_000_000) return `SAR ${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `SAR ${(n / 1_000).toFixed(1)}K`
  return `SAR ${n.toLocaleString()}`
}

// ── Excel Export ───────────────────────────────────────────────────────────────
export function exportToExcel(rows, columns, headers, filename = 'export', sheetName = 'Sheet1') {
  const displayRows = rows.map(r =>
    Object.fromEntries(columns.map((col, i) => [headers[i], r[col] ?? '']))
  )
  const ws = XLSX.utils.json_to_sheet(displayRows, { header: headers })
  ws['!cols'] = headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...displayRows.map(r => String(r[h] ?? '').length))
    return { wch: Math.min(maxLen + 2, 40) }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ── PDF Table Export ───────────────────────────────────────────────────────────
export function exportToPdf(rows, columns, title, filename = 'report', orientation = 'landscape') {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height

  doc.setFillColor(22, 101, 52)
  doc.rect(0, 0, pageW, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('TYREPULSE · Tyre Intelligence Platform', 14, 10)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(title, 14, 17)
  doc.setTextColor(150, 150, 150)
  doc.setFontSize(8)
  doc.text(`Generated: ${nowStr()}  |  ${rows.length} records`, pageW - 14, 17, { align: 'right' })

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

  const riskColIdx = columns.findIndex(c => /risk/i.test(c.header ?? '') || /risk_level/i.test(c.key ?? ''))

  autoTable(doc, {
    startY: 26,
    head: [columns.map(c => c.header)],
    body: rows.map(r => columns.map(c => String(r[c.key] ?? ' '))),
    styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak', textColor: [30, 30, 30] },
    headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: Object.fromEntries(scaledWidths.map((w, i) => [i, { cellWidth: w }])),
    margin: { left: 14, right: 14 },
    didParseCell: riskColIdx >= 0 ? (data) => {
      if (data.section === 'body' && data.column.index === riskColIdx) {
        const val = String(data.cell.raw ?? '').trim().toLowerCase()
        if (val === 'critical') { data.cell.styles.fillColor = [127, 29, 29]; data.cell.styles.textColor = [255, 255, 255] }
        else if (val === 'high') { data.cell.styles.fillColor = [124, 45, 18]; data.cell.styles.textColor = [255, 255, 255] }
        else if (val === 'medium') { data.cell.styles.fillColor = [113, 63, 18]; data.cell.styles.textColor = [255, 255, 255] }
        else if (val === 'low') { data.cell.styles.fillColor = [20, 83, 45]; data.cell.styles.textColor = [255, 255, 255] }
      }
    } : undefined,
    didDrawPage: (data) => {
      doc.setFontSize(7)
      doc.setTextColor(107, 114, 128)
      doc.text('Confidential · Internal Use Only | TyrePulse', 14, pageH - 6)
      doc.text(`Page ${data.pageNumber}`, pageW - 14, pageH - 6, { align: 'right' })
    },
  })

  doc.save(`${filename}.pdf`)
}

// ── Tyre Diagram Layouts (PDF coordinates) ─────────────────────────────────────
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
  Bus: {
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
  Tata: {
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
  'Ashok Leyland': {
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

// Normalize vehicle type to layout key
function _resolveLayoutKey(vehicleType) {
  if (!vehicleType) return null
  const vt = vehicleType.trim()
  if (_TYRE_LAYOUTS[vt]) return vt
  // Case-insensitive match
  const lower = vt.toLowerCase()
  const found = Object.keys(_TYRE_LAYOUTS).find(k => k.toLowerCase() === lower)
  if (found) return found
  // Fuzzy
  if (lower.includes('tri') || lower.includes('mixer'))        return 'Tri-mixer'
  if (lower.includes('concrete') || lower.includes('pump'))    return 'Concrete pump'
  if (lower.includes('wheel') && lower.includes('load'))       return 'Wheel loader'
  if (lower.includes('skid'))                                  return 'Skid loader'
  if (lower.includes('canter'))                                return 'Canter'
  if (lower.includes('bus'))                                   return 'Bus'
  if (lower.includes('tata'))                                  return 'Tata'
  if (lower.includes('ashok') || lower.includes('leyland'))    return 'Ashok Leyland'
  return 'Pickup'
}

const _RISK_RGB = {
  good:     [34,  197, 94],
  warning:  [234, 179, 8],
  critical: [239, 68,  68],
  none:     [75,  85,  99],
}
const _RISK_LABEL = { good: 'Good', warning: 'Warning', critical: 'Critical', none: 'No Data' }
const _COND_TO_RISK = { Good: 'good', Wear: 'warning', Damage: 'critical', Puncture: 'critical', None: 'none' }

function _drawTyreDiagram(doc, layout, tyreConditions, originX, originY, scale) {
  const { body, tyres } = layout
  const tc = tyreConditions || {}

  // Vehicle body — dark fill with subtle border
  doc.setFillColor(24, 32, 47)
  doc.setDrawColor(55, 65, 81)
  doc.setLineWidth(0.4)
  doc.roundedRect(
    originX + body.x * scale, originY + body.y * scale,
    body.w * scale, body.h * scale,
    Math.max(0.8, body.rx * scale * 0.45),
    Math.max(0.8, body.rx * scale * 0.45),
    'FD'
  )

  // Cabin area indicator (front)
  const cabinH = body.h * 0.22 * scale
  doc.setFillColor(30, 42, 62)
  doc.roundedRect(
    originX + body.x * scale + 1, originY + body.y * scale + 1,
    body.w * scale - 2, cabinH,
    Math.max(0.8, body.rx * scale * 0.45),
    2, 'F'
  )

  // Axle lines
  const axlePositions = new Set()
  tyres.forEach(t => {
    const centerY = originY + (t.y + t.h / 2) * scale
    axlePositions.add(centerY)
  })
  doc.setDrawColor(45, 55, 72)
  doc.setLineWidth(0.6)
  axlePositions.forEach(ay => {
    doc.line(
      originX + body.x * scale,
      ay,
      originX + (body.x + body.w) * scale,
      ay
    )
  })

  // Tyres — realistic rendering
  tyres.forEach(t => {
    const cond = tc[t.id]
    const risk = cond?.risk ?? (cond?.condition ? (_COND_TO_RISK[cond.condition] ?? 'none') : 'none')
    const [r, g, b] = _RISK_RGB[risk] ?? _RISK_RGB.none
    const tx = originX + t.x * scale
    const ty = originY + t.y * scale
    const tw = t.w * scale
    const th = t.h * scale
    const rx = Math.max(0.5, t.rx * scale * 0.45)
    const cx = tx + tw / 2
    const cy = ty + th / 2

    // Tyre shadow
    doc.setFillColor(10, 10, 15)
    doc.roundedRect(tx + 0.5, ty + 0.5, tw, th, rx, rx, 'F')

    // Black rubber outer
    doc.setFillColor(18, 18, 26)
    doc.setDrawColor(40, 45, 55)
    doc.setLineWidth(0.3)
    doc.roundedRect(tx, ty, tw, th, rx, rx, 'FD')

    // Tread grooves (3 horizontal lines)
    doc.setDrawColor(32, 32, 42)
    doc.setLineWidth(0.5)
    for (let i = 1; i <= 3; i++) {
      const ly = ty + (th / 4) * i
      doc.line(tx + 1, ly, tx + tw - 1, ly)
    }

    // Sidewall ridges
    doc.setDrawColor(30, 30, 38)
    doc.setLineWidth(0.3)
    doc.roundedRect(tx + tw * 0.06, ty + th * 0.08, tw * 0.88, th * 0.84, rx * 0.6, rx * 0.6, 'S')

    // Rim — risk-colored
    doc.setFillColor(r, g, b)
    doc.setDrawColor(Math.max(0, r - 50), Math.max(0, g - 50), Math.max(0, b - 50))
    doc.setLineWidth(0.2)
    const rimW = tw * 0.52
    const rimH = th * 0.52
    doc.roundedRect(cx - rimW / 2, cy - rimH / 2, rimW, rimH, rimW * 0.38, rimH * 0.38, 'FD')

    // Rim spokes (subtle cross)
    doc.setDrawColor(Math.max(0, r - 80), Math.max(0, g - 80), Math.max(0, b - 80))
    doc.setLineWidth(0.15)
    doc.line(cx - rimW * 0.3, cy, cx + rimW * 0.3, cy)
    doc.line(cx, cy - rimH * 0.3, cx, cy + rimH * 0.3)

    // Centre hub
    doc.setFillColor(14, 14, 20)
    const boltR = Math.min(tw, th) * 0.09
    doc.circle(cx, cy, boltR, 'F')

    // Label — white text with shadow
    const fontSize = Math.max(3, tw < 18 ? 3 : tw < 22 ? 4 : 5)
    doc.setFontSize(fontSize)
    doc.setTextColor(200, 200, 200)
    doc.text(t.label, cx, cy, { align: 'center', baseline: 'middle' })
  })
}

// ── Standard PDF helpers ───────────────────────────────────────────────────────
function _addPageHeader(doc, title, subtitle) {
  const pw = doc.internal.pageSize.width
  // Dark header band
  doc.setFillColor(10, 14, 25)
  doc.rect(0, 0, pw, 18, 'F')
  // Green accent line
  doc.setFillColor(22, 163, 74)
  doc.rect(0, 18, pw, 2, 'F')
  // Logo text
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('TYREPULSE', 14, 9)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 160, 120)
  doc.text('Tyre Intelligence Platform', 14, 15)
  // Title on right
  if (title) {
    doc.setFontSize(9)
    doc.setTextColor(200, 220, 200)
    doc.setFont('helvetica', 'bold')
    doc.text(title, pw - 14, 9, { align: 'right' })
  }
  if (subtitle) {
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 140, 130)
    doc.text(subtitle, pw - 14, 15, { align: 'right' })
  }
}

function _addPageFooter(doc, pageNum, totalPages, docTitle) {
  const pw = doc.internal.pageSize.width
  const ph = doc.internal.pageSize.height
  doc.setFillColor(245, 247, 250)
  doc.rect(0, ph - 10, pw, 10, 'F')
  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.3)
  doc.line(0, ph - 10, pw, ph - 10)
  doc.setFontSize(6.5)
  doc.setTextColor(130, 130, 130)
  doc.setFont('helvetica', 'normal')
  doc.text(`Confidential · Internal Use Only  |  TyrePulse  |  Generated: ${nowFull()}`, 14, ph - 4)
  if (docTitle) doc.text(docTitle, pw / 2, ph - 4, { align: 'center' })
  if (totalPages) doc.text(`${pageNum} / ${totalPages}`, pw - 14, ph - 4, { align: 'right' })
  else doc.text(`Page ${pageNum}`, pw - 14, ph - 4, { align: 'right' })
}

function _sectionTitle(doc, text, y, opts = {}) {
  const pw = doc.internal.pageSize.width
  const mx = opts.mx ?? 14
  // Section background pill
  doc.setFillColor(opts.bgR ?? 22, opts.bgG ?? 163, opts.bgB ?? 74, 0.12)
  doc.setDrawColor(opts.bgR ?? 22, opts.bgG ?? 163, opts.bgB ?? 74)
  doc.setLineWidth(0.2)
  doc.roundedRect(mx, y - 4, pw - mx * 2, 9, 1.5, 1.5, 'FD')
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(opts.textR ?? 20, opts.textG ?? 100, opts.textB ?? 46)
  doc.text(text, mx + 4, y + 2)
  return y + 10
}

// ── Enhanced Inspection Detail PDF ────────────────────────────────────────────
/**
 * Export a single inspection record as a comprehensive multi-page PDF
 * with vehicle tyre diagram, full tyre analysis, risk matrix, and recommendations.
 *
 * @param {Object} row - inspection record
 * @param {Object} [opts] - optional overrides { company }
 */
export function exportInspectionDetailPdf(row, opts = {}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height

  // ── Page 1 ─────────────────────────────────────────────────────────────────
  _addPageHeader(doc, 'Inspection Report', `Ref: ${row.asset_no || '—'}`)

  let y = 28

  // Inspection title banner
  const titleSeverity = row.severity ?? 'Medium'
  const sevColors = { Low: [22, 163, 74], Medium: [202, 138, 4], High: [234, 88, 12], Critical: [220, 38, 38] }
  const [sr, sg, sb] = sevColors[titleSeverity] ?? sevColors.Medium
  doc.setFillColor(sr, sg, sb, 0.1)
  doc.setDrawColor(sr, sg, sb)
  doc.setLineWidth(0.4)
  doc.roundedRect(14, y, pageW - 28, 16, 2, 2, 'FD')
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(20, 20, 20)
  doc.text(row.title || 'Tyre Inspection', 18, y + 7)
  // Severity badge
  doc.setFillColor(sr, sg, sb)
  doc.roundedRect(pageW - 50, y + 3, 32, 8, 2, 2, 'F')
  doc.setFontSize(7)
  doc.setTextColor(255, 255, 255)
  doc.text(`${titleSeverity.toUpperCase()} SEVERITY`, pageW - 34, y + 8.5, { align: 'center' })
  y += 22

  // Meta info grid — 3 columns × 3 rows
  const metaFields = [
    ['Inspection Type', row.inspection_type || '—'],
    ['Status',          row.status || '—'],
    ['Site',            row.site || '—'],
    ['Scheduled Date',  row.scheduled_date || '—'],
    ['Asset No.',       row.asset_no || '—'],
    ['Vehicle Type',    row.vehicle_type || '—'],
    ['Inspector',       row.inspector || row.attendees || '—'],
    ['Company',         opts.company || '—'],
  ]
  const metaCols = 3
  const cellW = (pageW - 28) / metaCols
  const cellH = 11
  metaFields.forEach(([lbl, val], idx) => {
    const col = idx % metaCols
    const row_ = Math.floor(idx / metaCols)
    const mx = 14 + col * cellW
    const my = y + row_ * cellH
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(130, 130, 130)
    doc.text(lbl, mx + 1, my)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20, 20, 20)
    const maxW = cellW - 6
    const truncated = doc.splitTextToSize(String(val), maxW)[0] ?? String(val)
    doc.text(truncated, mx + 1, my + 5)
    // Subtle underline
    doc.setDrawColor(230, 230, 230)
    doc.setLineWidth(0.2)
    doc.line(mx, my + 8, mx + cellW - 2, my + 8)
  })
  y += Math.ceil(metaFields.length / metaCols) * cellH + 6

  // ── Tyre Diagram section ───────────────────────────────────────────────────
  const layoutKey = _resolveLayoutKey(row.vehicle_type)
  const layout    = layoutKey ? _TYRE_LAYOUTS[layoutKey] : null

  if (layout) {
    y = _sectionTitle(doc, '  Vehicle Tyre Condition Map', y)

    // Build tyre conditions map (support both {risk} and {condition} formats)
    const tc = row.tyre_conditions || {}
    const normalizedTc = {}
    Object.entries(tc).forEach(([pos, data]) => {
      if (typeof data === 'object') {
        normalizedTc[pos] = {
          risk: data.risk ?? (_COND_TO_RISK[data.condition] ?? 'none'),
          pressure: data.pressure ?? data.psi ?? null,
          tread: data.tread ?? data.tread_depth ?? null,
          condition: data.condition ?? data.risk ?? null,
          notes: data.notes ?? null,
        }
      } else {
        normalizedTc[pos] = { risk: _COND_TO_RISK[data] ?? 'none' }
      }
    })

    // Calculate diagram dimensions — fit within page width, centred
    const maxDiagW = Math.min(pageW - 28, 100)
    const diagramScale = maxDiagW / 200
    const bodyBottom = layout.body.y + layout.body.h
    const diagramH = (bodyBottom + 10) * diagramScale
    const diagramW = maxDiagW
    const originX = (pageW - diagramW) / 2 - layout.tyres.reduce((min, t) => Math.min(min, t.x), 999) * diagramScale + 5
    const originY = y + 4

    // Background card
    const bgX = 14
    const bgW = pageW - 28
    const bgH = diagramH + 20
    doc.setFillColor(16, 22, 36)
    doc.setDrawColor(40, 50, 70)
    doc.setLineWidth(0.4)
    doc.roundedRect(bgX, y, bgW, bgH, 3, 3, 'FD')

    // Grid lines in background
    doc.setDrawColor(25, 35, 55)
    doc.setLineWidth(0.2)
    for (let gx = bgX + 8; gx < bgX + bgW; gx += 12) doc.line(gx, y, gx, y + bgH)
    for (let gy = y + 8; gy < y + bgH; gy += 12) doc.line(bgX, gy, bgX + bgW, gy)

    _drawTyreDiagram(doc, layout, normalizedTc, originX, originY, diagramScale)

    // Risk summary chips beside/below diagram
    const chips = Object.values(_RISK_LABEL).map((lbl, i) => {
      const riskKey = Object.keys(_RISK_LABEL)[i]
      const count = layout.tyres.filter(t => {
        const tc_ = normalizedTc[t.id]
        const r = tc_?.risk ?? 'none'
        return r === riskKey
      }).length
      return { lbl, riskKey, count }
    })

    const chipY = y + bgH + 4
    const chipW = (pageW - 28 - 12) / chips.length
    chips.forEach(({ lbl, riskKey, count }, i) => {
      const [r, g, b] = _RISK_RGB[riskKey]
      const cx = 14 + i * (chipW + 4)
      doc.setFillColor(r, g, b, 0.15)
      doc.setDrawColor(r, g, b)
      doc.setLineWidth(0.3)
      doc.roundedRect(cx, chipY, chipW, 10, 2, 2, 'FD')
      doc.setFillColor(r, g, b)
      doc.circle(cx + 5, chipY + 5, 2.5, 'F')
      doc.setFontSize(7)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(r * 0.6, g * 0.6, b * 0.6)
      doc.text(`${lbl}: ${count}`, cx + 10, chipY + 6)
    })

    y += bgH + 18
  }

  // ── Risk Stats Row ────────────────────────────────────────────────────────
  const tyreEntries = Object.entries(row.tyre_conditions || {})
  if (tyreEntries.length > 0) {
    const riskCounts = { critical: 0, warning: 0, good: 0, none: 0 }
    tyreEntries.forEach(([, d]) => {
      const r = (typeof d === 'object' ? (d.risk ?? _COND_TO_RISK[d.condition] ?? 'none') : _COND_TO_RISK[d] ?? 'none')
      riskCounts[r] = (riskCounts[r] || 0) + 1
    })
    const total = tyreEntries.length
    const barItems = [
      { label: 'Critical', key: 'critical', rgb: _RISK_RGB.critical },
      { label: 'Warning',  key: 'warning',  rgb: _RISK_RGB.warning  },
      { label: 'Good',     key: 'good',     rgb: _RISK_RGB.good     },
      { label: 'No Data',  key: 'none',     rgb: _RISK_RGB.none     },
    ]

    if (y > pageH - 60) { doc.addPage(); _addPageHeader(doc, 'Inspection Report', `Ref: ${row.asset_no || '—'}`); y = 28 }

    y = _sectionTitle(doc, '  Tyre Risk Summary', y)
    const barW = pageW - 28 - 60
    barItems.forEach(({ label, key, rgb: [r, g, b] }) => {
      const count = riskCounts[key] ?? 0
      const fraction = total > 0 ? count / total : 0
      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(50, 50, 50)
      doc.text(label, 14, y + 3.5)
      // Bar background
      doc.setFillColor(230, 230, 230)
      doc.roundedRect(60, y, barW, 6, 1.5, 1.5, 'F')
      // Bar fill
      if (fraction > 0) {
        doc.setFillColor(r, g, b)
        doc.roundedRect(60, y, Math.max(4, barW * fraction), 6, 1.5, 1.5, 'F')
      }
      // Count + pct
      doc.setFontSize(7)
      doc.setTextColor(80, 80, 80)
      doc.text(`${count} (${pct(count, total)}%)`, pageW - 14, y + 4.5, { align: 'right' })
      y += 10
    })
    y += 4
  }

  // Possibly start page 2 if needed
  const needNewPage = y > pageH - 90

  if (needNewPage) {
    doc.addPage()
    _addPageHeader(doc, 'Inspection Report', `Ref: ${row.asset_no || '—'}`)
    y = 28
  }

  // ── Detailed Tyre Conditions Table ────────────────────────────────────────
  if (tyreEntries.length > 0) {
    if (y > pageH - 60) { doc.addPage(); _addPageHeader(doc, 'Inspection Report', `Ref: ${row.asset_no || '—'}`); y = 28 }

    y = _sectionTitle(doc, '  Detailed Tyre Condition Analysis', y)

    const tableBody = tyreEntries.map(([posId, data]) => {
      const d = typeof data === 'object' ? data : { condition: data }
      const risk = d.risk ?? _COND_TO_RISK[d.condition] ?? 'none'
      return [
        posId,
        d.pressure ? `${d.pressure} PSI` : '—',
        d.tread ?? d.tread_depth ? `${d.tread ?? d.tread_depth} mm` : '—',
        d.condition ?? _RISK_LABEL[risk],
        _RISK_LABEL[risk],
        d.notes ?? '—',
      ]
    })

    autoTable(doc, {
      startY: y,
      head: [['Position', 'Pressure', 'Tread Depth', 'Condition', 'Risk Level', 'Notes']],
      body: tableBody,
      margin: { left: 14, right: 14 },
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak', textColor: [25, 25, 25] },
      headStyles: { fillColor: [15, 25, 50], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 18, fontStyle: 'bold' },
        1: { cellWidth: 24 },
        2: { cellWidth: 24 },
        3: { cellWidth: 28 },
        4: { cellWidth: 24 },
        5: { cellWidth: 'auto' },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const val = String(data.cell.raw ?? '').toLowerCase()
          if (val === 'critical') { data.cell.styles.fillColor = [254, 226, 226]; data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold' }
          else if (val === 'warning') { data.cell.styles.fillColor = [254, 249, 195]; data.cell.styles.textColor = [133, 77, 14] }
          else if (val === 'good') { data.cell.styles.fillColor = [220, 252, 231]; data.cell.styles.textColor = [20, 83, 45] }
        }
      },
    })

    y = (doc.lastAutoTable?.finalY ?? y) + 8
  }

  // ── Findings & Observations ───────────────────────────────────────────────
  if (row.findings) {
    if (y > pageH - 50) { doc.addPage(); _addPageHeader(doc, 'Inspection Report', `Ref: ${row.asset_no || '—'}`); y = 28 }
    y = _sectionTitle(doc, '  Findings & Observations', y, { bgR: 234, bgG: 88, bgB: 12 })
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 30)
    const findingsLines = doc.splitTextToSize(row.findings, pageW - 28)
    doc.text(findingsLines, 14, y)
    y += findingsLines.length * 4.5 + 6
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (row.notes) {
    if (y > pageH - 40) { doc.addPage(); _addPageHeader(doc, 'Inspection Report', `Ref: ${row.asset_no || '—'}`); y = 28 }
    y = _sectionTitle(doc, '  Additional Notes', y, { bgR: 99, bgG: 102, bgB: 241 })
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 30, 30)
    const noteLines = doc.splitTextToSize(row.notes, pageW - 28)
    doc.text(noteLines, 14, y)
    y += noteLines.length * 4.5 + 6
  }

  // ── Auto-generated Recommendations ───────────────────────────────────────
  const recommendations = _generateRecommendations(row)
  if (recommendations.length > 0) {
    if (y > pageH - 60) { doc.addPage(); _addPageHeader(doc, 'Inspection Report', `Ref: ${row.asset_no || '—'}`); y = 28 }
    y = _sectionTitle(doc, '  Recommended Actions', y, { bgR: 37, bgG: 99, bgB: 235 })
    recommendations.forEach((rec, i) => {
      if (y > pageH - 20) { doc.addPage(); _addPageHeader(doc, 'Inspection Report', `Ref: ${row.asset_no || '—'}`); y = 28 }
      const [rr, rg, rb] = rec.urgent ? [220, 38, 38] : [37, 99, 235]
      doc.setFillColor(rr, rg, rb)
      doc.circle(18, y + 2.5, 2, 'F')
      doc.setFontSize(7.5)
      doc.setFont('helvetica', rec.urgent ? 'bold' : 'normal')
      doc.setTextColor(20, 20, 20)
      const lines = doc.splitTextToSize(rec.text, pageW - 40)
      doc.text(lines, 24, y + 3)
      y += lines.length * 4.5 + 3
    })
    y += 4
  }

  // ── Signature Block ───────────────────────────────────────────────────────
  if (y + 35 > pageH - 15) { doc.addPage(); _addPageHeader(doc, 'Inspection Report', `Ref: ${row.asset_no || '—'}`); y = 28 }

  y += 6
  doc.setFillColor(248, 250, 252)
  doc.setDrawColor(200, 210, 220)
  doc.setLineWidth(0.3)
  doc.roundedRect(14, y, pageW - 28, 30, 2, 2, 'FD')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(80, 80, 80)
  doc.text('INSPECTOR CERTIFICATION', 20, y + 7)
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 100, 100)
  doc.text('I certify that this inspection was conducted in accordance with TyrePulse standards.', 20, y + 13)

  // Sig lines
  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.4)
  doc.line(20,          y + 26, 90,           y + 26)
  doc.line(120,         y + 26, 190,          y + 26)
  doc.setFontSize(6.5)
  doc.setTextColor(120, 120, 120)
  doc.text('Inspector Signature', 20,  y + 30)
  doc.text(`Name: ${row.inspector || '_______________'}`, 120, y + 30)

  // ── Footers on all pages ──────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  const docTitle = `Inspection · ${row.asset_no || row.title || '—'}`
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    _addPageFooter(doc, p, totalPages, docTitle)
  }

  const safeTitle = (row.title || 'inspection').replace(/[^a-z0-9]/gi, '_').slice(0, 40)
  doc.save(`TyrePulse_Inspection_${safeTitle}.pdf`)
}

// Auto-generate recommendations from tyre conditions
function _generateRecommendations(row) {
  const recs = []
  const tc = row.tyre_conditions || {}
  const criticalTyres = []
  const warningTyres  = []
  let lowPressureCount = 0
  let missingDataCount = 0

  Object.entries(tc).forEach(([pos, data]) => {
    const d = typeof data === 'object' ? data : { condition: data }
    const risk = d.risk ?? _COND_TO_RISK[d.condition] ?? 'none'
    if (risk === 'critical') criticalTyres.push(pos)
    else if (risk === 'warning') warningTyres.push(pos)
    if (d.pressure && Number(d.pressure) < 80) lowPressureCount++
    if (risk === 'none') missingDataCount++
  })

  if (criticalTyres.length > 0) {
    recs.push({ urgent: true, text: `IMMEDIATE ACTION REQUIRED: ${criticalTyres.length} tyre(s) in critical condition at position(s) ${criticalTyres.join(', ')}. Remove from service until replaced.` })
  }
  if (warningTyres.length > 0) {
    recs.push({ urgent: false, text: `Schedule tyre replacement within 7 days for position(s) ${warningTyres.join(', ')} showing wear or damage indicators.` })
  }
  if (lowPressureCount > 0) {
    recs.push({ urgent: true, text: `${lowPressureCount} tyre(s) detected with pressure below 80 PSI. Re-inflate to manufacturer specification immediately and inspect for leaks.` })
  }
  if (row.severity === 'Critical' || row.severity === 'High') {
    recs.push({ urgent: true, text: 'High severity inspection — escalate to Fleet Manager and issue a corrective action work order before next vehicle deployment.' })
  }
  if (missingDataCount > 3) {
    recs.push({ urgent: false, text: `${missingDataCount} tyre positions have incomplete inspection data. Ensure all positions are physically checked on the next inspection cycle.` })
  }
  if (recs.length === 0 && Object.keys(tc).length > 0) {
    recs.push({ urgent: false, text: 'All tyres inspected. Continue standard inspection schedule. Monitor tread depth monthly and pressure weekly.' })
  }
  return recs
}

// ── Daily Executive Presentation PDF ─────────────────────────────────────────
/**
 * Generate a comprehensive daily executive presentation PDF.
 *
 * @param {Object} data
 * @param {string} data.date
 * @param {string} data.company
 * @param {string} data.reportPeriod         // 'Daily' | 'Weekly' | 'Monthly'
 * @param {string} [data.generatedBy]
 * @param {string} [data.site]               // 'All Sites' or specific site name
 *
 * @param {number} data.totalVehicles
 * @param {number} data.activeVehicles
 * @param {number} data.vehiclesWithAlerts
 *
 * @param {number} data.totalTyres
 * @param {number} data.criticalTyres
 * @param {number} data.warningTyres
 * @param {number} data.goodTyres
 * @param {number} [data.avgTreadDepth]
 * @param {number} [data.pressureCompliance] // percentage 0-100
 *
 * @param {number} [data.inspectionsScheduled]
 * @param {number} [data.inspectionsCompleted]
 * @param {number} [data.defectsFound]
 *
 * @param {number} [data.monthlyBudget]
 * @param {number} [data.monthlySpend]
 * @param {number} [data.ytdSpend]
 * @param {number} [data.costPerKm]
 *
 * @param {{message:string, asset:string, site:string, severity:string}[]} [data.criticalAlerts]
 * @param {{title:string, priority:string, site:string, assignee:string}[]} [data.openActions]
 *
 * @param {{type:string, count:number}[]} [data.topDefects]
 * @param {{name:string, vehicles:number, alerts:number, compliance:number}[]} [data.siteBreakdown]
 *
 * @param {string[]} [data.insights]
 * @param {{priority:string, text:string}[]} [data.recommendations]
 *
 * @param {string} [filename]
 */
export function exportDailyExecutivePdf(data, filename) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const PW  = doc.internal.pageSize.width   // 297
  const PH  = doc.internal.pageSize.height  // 210

  const DARK    = [10, 14, 25]
  const ACCENT  = [22, 163, 74]
  const BLUE    = [37, 99, 235]
  const RED     = [220, 38, 38]
  const ORANGE  = [234, 88, 12]
  const AMBER   = [202, 138, 4]
  const PURPLE  = [124, 58, 237]
  const WHITE   = [255, 255, 255]
  const LGRAY   = [248, 250, 252]
  const MGRAY   = [156, 163, 175]

  const reportDate  = data.date || nowStr()
  const company     = data.company || 'TyrePulse Fleet'
  const periodLabel = data.reportPeriod || 'Daily'
  const siteLabel   = data.site || 'All Sites'

  // helper – landscape footer
  function footer(page, total) {
    doc.setFontSize(6.5)
    doc.setTextColor(...MGRAY)
    doc.setFont('helvetica', 'normal')
    doc.text(`Confidential · Internal Use Only  |  ${company}  |  TyrePulse`, 14, PH - 5)
    doc.text(reportDate, PW / 2, PH - 5, { align: 'center' })
    doc.text(`${page} / ${total}`, PW - 14, PH - 5, { align: 'right' })
  }

  // helper – KPI card
  function kpiCard(x, y, w, h, label, value, subtext, rgb, dark = false) {
    const [r, g, b] = rgb
    doc.setFillColor(dark ? r * 0.12 : r * 0.08, dark ? g * 0.12 : g * 0.08, dark ? b * 0.12 : b * 0.08)
    doc.setDrawColor(r * 0.6, g * 0.6, b * 0.6)
    doc.setLineWidth(0.4)
    doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD')
    // Accent top bar
    doc.setFillColor(r, g, b)
    doc.roundedRect(x, y, w, 2.5, 2.5, 0, 'F')
    // Value
    doc.setFontSize(24)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(r * 0.7, g * 0.7, b * 0.7)
    doc.text(String(value ?? '—'), x + w / 2, y + h / 2 + 1, { align: 'center' })
    // Label
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80, 80, 80)
    doc.text(label, x + w / 2, y + h - 9, { align: 'center' })
    // Subtext
    if (subtext) {
      doc.setFontSize(6.5)
      doc.setTextColor(130, 130, 130)
      doc.text(String(subtext), x + w / 2, y + h - 4, { align: 'center' })
    }
  }

  // ── PAGE 1: COVER ──────────────────────────────────────────────────────────
  {
    // Full dark background
    doc.setFillColor(...DARK)
    doc.rect(0, 0, PW, PH, 'F')

    // Decorative grid
    doc.setDrawColor(20, 28, 45)
    doc.setLineWidth(0.3)
    for (let gx = 0; gx < PW; gx += 18) doc.line(gx, 0, gx, PH)
    for (let gy = 0; gy < PH; gy += 18) doc.line(0, gy, PW, gy)

    // Accent diagonal stripe
    doc.setFillColor(...ACCENT)
    doc.triangle(0, PH * 0.55, 0, PH * 0.68, PW * 0.35, PH * 0.55, 'F')
    doc.setFillColor(37, 99, 235, 0.6)
    doc.triangle(0, PH * 0.6, 0, PH * 0.75, PW * 0.28, PH * 0.6, 'F')

    // Company & title
    doc.setFontSize(36)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WHITE)
    doc.text('TYREPULSE', 30, 60)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 180, 130)
    doc.text('Tyre Intelligence Platform', 30, 72)

    doc.setFontSize(26)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(230, 240, 255)
    doc.text(`${periodLabel} Fleet Report`, 30, 100)

    doc.setFontSize(13)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(130, 140, 160)
    doc.text(company, 30, 112)
    doc.text(siteLabel, 30, 121)

    doc.setFontSize(11)
    doc.setTextColor(80, 100, 90)
    doc.text(`Report Date: ${reportDate}`, 30, 135)
    if (data.generatedBy) {
      doc.text(`Prepared by: ${data.generatedBy}`, 30, 143)
    }

    // Right side KPI snapshot
    const snapKpis = [
      { v: data.totalVehicles ?? 0,    l: 'Total Vehicles',    rgb: BLUE },
      { v: data.totalTyres ?? 0,       l: 'Total Tyres',       rgb: ACCENT },
      { v: data.criticalTyres ?? 0,    l: 'Critical Tyres',    rgb: RED },
      { v: data.openActions?.length ?? 0, l: 'Open Actions',   rgb: AMBER },
    ]
    const snapX = PW - 200
    const snapY = 30
    const snapW = 42
    const snapH = 36
    snapKpis.forEach((k, i) => {
      kpiCard(snapX + i * (snapW + 4), snapY, snapW, snapH, k.l, k.v, null, k.rgb, true)
    })

    // Bottom tag
    doc.setFontSize(7)
    doc.setTextColor(40, 50, 40)
    doc.text(`Generated: ${nowFull()}  ·  Confidential - Internal Use Only`, PW / 2, PH - 8, { align: 'center' })
  }

  // ── PAGE 2: EXECUTIVE KPI SUMMARY ─────────────────────────────────────────
  doc.addPage()
  {
    doc.setFillColor(...LGRAY)
    doc.rect(0, 0, PW, PH, 'F')

    // Top header bar
    doc.setFillColor(...DARK)
    doc.rect(0, 0, PW, 24, 'F')
    doc.setFillColor(...ACCENT)
    doc.rect(0, 24, PW, 2, 'F')
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WHITE)
    doc.text('Executive KPI Summary', 14, 15)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120, 160, 130)
    doc.text(`${reportDate}  ·  ${company}  ·  ${siteLabel}`, PW - 14, 15, { align: 'right' })

    // Fleet health KPIs — row 1
    const activeVehicles = data.activeVehicles ?? data.totalVehicles ?? 0
    const vehicleUtil = pct(activeVehicles, data.totalVehicles)
    const pressureComp = data.pressureCompliance ?? pct(data.goodTyres, data.totalTyres)
    const inspecComp   = pct(data.inspectionsCompleted, data.inspectionsScheduled)

    const row1 = [
      { label: 'Total Vehicles',       value: data.totalVehicles ?? 0,    sub: `${activeVehicles} active`,         rgb: BLUE },
      { label: 'Fleet Utilisation',    value: `${vehicleUtil}%`,           sub: `${data.vehiclesWithAlerts ?? 0} with alerts`, rgb: ACCENT },
      { label: 'Total Tyres Tracked',  value: data.totalTyres ?? 0,       sub: 'Across all positions',            rgb: PURPLE },
      { label: 'Pressure Compliance',  value: `${pressureComp}%`,         sub: 'Within spec',                     rgb: pressureComp < 70 ? RED : ACCENT },
      { label: 'Inspection Rate',      value: inspecComp ? `${inspecComp}%` : '—', sub: `${data.inspectionsCompleted ?? 0} of ${data.inspectionsScheduled ?? 0}`, rgb: BLUE },
      { label: 'Open Actions',         value: data.openActions?.length ?? 0, sub: 'Awaiting resolution',          rgb: AMBER },
    ]
    const r1CardW = (PW - 28 - (row1.length - 1) * 5) / row1.length
    row1.forEach((k, i) => kpiCard(14 + i * (r1CardW + 5), 32, r1CardW, 38, k.label, k.value, k.sub, k.rgb))

    // Tyre condition breakdown
    const totalT = data.totalTyres || 1
    const condData = [
      { label: 'Good',     count: data.goodTyres ?? 0,     rgb: ACCENT },
      { label: 'Warning',  count: data.warningTyres ?? 0,  rgb: AMBER },
      { label: 'Critical', count: data.criticalTyres ?? 0, rgb: RED },
    ]

    // Stacked bar
    const sbY = 82
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20, 20, 20)
    doc.text('Tyre Fleet Condition Overview', 14, sbY)
    const barX = 14
    const barY = sbY + 6
    const barW = PW - 28
    const barH = 14
    let barCursor = barX
    condData.forEach(({ label, count, rgb: [r, g, b] }) => {
      const w = (count / totalT) * barW
      if (w > 0) {
        doc.setFillColor(r, g, b)
        doc.rect(barCursor, barY, w, barH, 'F')
        if (w > 18) {
          doc.setFontSize(7.5)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(...WHITE)
          doc.text(`${label} ${count}`, barCursor + w / 2, barY + barH / 2 + 2, { align: 'center' })
        }
        barCursor += w
      }
    })
    doc.setDrawColor(150, 150, 150)
    doc.setLineWidth(0.3)
    doc.rect(barX, barY, barW, barH, 'S')

    // Cost summary row
    const costY = sbY + 30
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20, 20, 20)
    doc.text('Financial Snapshot', 14, costY)

    const costKpis = [
      { label: 'Monthly Budget',   value: fmtSAR(data.monthlyBudget),   rgb: BLUE },
      { label: 'Monthly Spend',    value: fmtSAR(data.monthlySpend),    rgb: data.monthlySpend > data.monthlyBudget ? RED : ACCENT },
      { label: 'YTD Spend',        value: fmtSAR(data.ytdSpend),        rgb: PURPLE },
      { label: 'Cost / Km',        value: data.costPerKm ? `SAR ${data.costPerKm.toFixed(3)}` : '—', rgb: AMBER },
      { label: 'Budget Variance',  value: data.monthlyBudget && data.monthlySpend ? fmtSAR(data.monthlyBudget - data.monthlySpend) : '—', rgb: data.monthlySpend > data.monthlyBudget ? RED : ACCENT },
    ]
    const cCardW = (PW - 28 - (costKpis.length - 1) * 5) / costKpis.length
    costKpis.forEach((k, i) => kpiCard(14 + i * (cCardW + 5), costY + 6, cCardW, 35, k.label, k.value, null, k.rgb))

    // Tread depth gauge (if available)
    if (data.avgTreadDepth !== undefined) {
      const gX = PW - 70
      const gY = sbY - 2
      const gW = 60
      const gH = 25
      doc.setFillColor(240, 245, 240)
      doc.setDrawColor(180, 200, 180)
      doc.setLineWidth(0.3)
      doc.roundedRect(gX, gY, gW, gH, 2, 2, 'FD')
      doc.setFontSize(7)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(60, 80, 60)
      doc.text('Avg Tread Depth', gX + gW / 2, gY + 7, { align: 'center' })
      doc.setFontSize(18)
      doc.setTextColor(...ACCENT)
      doc.text(`${data.avgTreadDepth}mm`, gX + gW / 2, gY + 18, { align: 'center' })
      const treadRisk = data.avgTreadDepth >= 3 ? '✓ SAFE' : '⚠ LOW'
      doc.setFontSize(7)
      doc.setTextColor(data.avgTreadDepth >= 3 ? 22 : 220, data.avgTreadDepth >= 3 ? 163 : 38, data.avgTreadDepth >= 3 ? 74 : 38)
      doc.text(treadRisk, gX + gW / 2, gY + 23, { align: 'center' })
    }
  }

  // ── PAGE 3: TYRE STATUS DETAIL ─────────────────────────────────────────────
  doc.addPage()
  {
    doc.setFillColor(...LGRAY)
    doc.rect(0, 0, PW, PH, 'F')
    doc.setFillColor(...DARK)
    doc.rect(0, 0, PW, 24, 'F')
    doc.setFillColor(...ORANGE)
    doc.rect(0, 24, PW, 2, 'F')
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WHITE)
    doc.text('Tyre Health Analysis', 14, 15)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(200, 150, 100)
    doc.text(`${reportDate}  ·  ${siteLabel}`, PW - 14, 15, { align: 'right' })

    let y3 = 34

    // Top defects
    if (data.topDefects?.length) {
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20, 20, 20)
      doc.text('Top Defect Types', 14, y3)
      y3 += 6

      const totalDef = data.topDefects.reduce((s, d) => s + d.count, 0)
      const defBarW = 100
      data.topDefects.slice(0, 8).forEach((d, i) => {
        const fraction = totalDef > 0 ? d.count / totalDef : 0
        const bx = 14
        const by = y3 + i * 12
        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(30, 30, 30)
        doc.text(d.type, bx, by + 4)
        // bar bg
        doc.setFillColor(220, 220, 220)
        doc.roundedRect(bx + 55, by, defBarW, 7, 2, 2, 'F')
        // bar fill
        const colors = [ORANGE, AMBER, RED, BLUE, PURPLE, ACCENT, [180, 80, 80], [80, 120, 200]]
        const [r, g, b] = colors[i] ?? MGRAY
        doc.setFillColor(r, g, b)
        if (fraction > 0) doc.roundedRect(bx + 55, by, Math.max(4, defBarW * fraction), 7, 2, 2, 'F')
        doc.setFontSize(7)
        doc.setTextColor(80, 80, 80)
        doc.text(`${d.count} (${pct(d.count, totalDef)}%)`, bx + 160, by + 5)
      })
      y3 += data.topDefects.slice(0, 8).length * 12 + 8
    }

    // Site breakdown table
    if (data.siteBreakdown?.length) {
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20, 20, 20)
      doc.text('Site Performance Breakdown', 14, y3)
      y3 += 4

      autoTable(doc, {
        startY: y3,
        head: [['Site', 'Vehicles', 'Tyre Alerts', 'Compliance %', 'Status']],
        body: data.siteBreakdown.map(s => [
          s.name,
          s.vehicles ?? '—',
          s.alerts ?? '—',
          s.compliance ? `${s.compliance}%` : '—',
          s.compliance >= 90 ? 'Good' : s.compliance >= 70 ? 'Monitor' : 'Action Needed',
        ]),
        margin: { left: 14, right: 14 },
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: DARK, textColor: WHITE, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 4) {
            const v = String(data.cell.raw)
            if (v === 'Action Needed') { data.cell.styles.fillColor = [254, 226, 226]; data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold' }
            else if (v === 'Monitor') { data.cell.styles.fillColor = [254, 249, 195]; data.cell.styles.textColor = [133, 77, 14] }
            else if (v === 'Good') { data.cell.styles.fillColor = [220, 252, 231]; data.cell.styles.textColor = [20, 83, 45] }
          }
        },
      })
    }
  }

  // ── PAGE 4: INSPECTIONS & ALERTS ──────────────────────────────────────────
  doc.addPage()
  {
    doc.setFillColor(...LGRAY)
    doc.rect(0, 0, PW, PH, 'F')
    doc.setFillColor(...DARK)
    doc.rect(0, 0, PW, 24, 'F')
    doc.setFillColor(37, 99, 235)
    doc.rect(0, 24, PW, 2, 'F')
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WHITE)
    doc.text('Inspections & Alerts', 14, 15)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(150, 170, 220)
    doc.text(`${reportDate}  ·  ${siteLabel}`, PW - 14, 15, { align: 'right' })

    let y4 = 34

    // Inspection KPIs
    const iKpis = [
      { label: 'Scheduled',   value: data.inspectionsScheduled ?? 0,   rgb: BLUE },
      { label: 'Completed',   value: data.inspectionsCompleted ?? 0,   rgb: ACCENT },
      { label: 'Defects Found', value: data.defectsFound ?? 0,         rgb: RED },
      { label: 'Completion %', value: `${pct(data.inspectionsCompleted, data.inspectionsScheduled)}%`, rgb: AMBER },
    ]
    const iCardW = (PW * 0.5 - 14 - (iKpis.length - 1) * 4) / iKpis.length
    iKpis.forEach((k, i) => kpiCard(14 + i * (iCardW + 4), y4, iCardW, 32, k.label, k.value, null, k.rgb))

    // Critical Alerts
    const alerts = data.criticalAlerts ?? []
    if (alerts.length > 0) {
      y4 += 40
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20, 20, 20)
      doc.text(`Critical Alerts (${alerts.length})`, 14, y4)
      y4 += 4

      autoTable(doc, {
        startY: y4,
        head: [['#', 'Alert', 'Asset', 'Site', 'Severity']],
        body: alerts.slice(0, 12).map((a, i) => [
          i + 1,
          a.message,
          a.asset ?? '—',
          a.site ?? '—',
          a.severity ?? 'High',
        ]),
        margin: { left: 14, right: PW / 2 + 5 },
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: [127, 29, 29], textColor: WHITE, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [254, 242, 242] },
        columnStyles: { 0: { cellWidth: 8 }, 4: { cellWidth: 20 } },
        didParseCell: (d) => {
          if (d.section === 'body' && d.column.index === 4) {
            const v = String(d.cell.raw).toLowerCase()
            if (v === 'critical') { d.cell.styles.fillColor = [254, 226, 226]; d.cell.styles.textColor = [185, 28, 28]; d.cell.styles.fontStyle = 'bold' }
          }
        },
      })
    }

    // Open Actions
    const actions = data.openActions ?? []
    if (actions.length > 0) {
      const actY = y4 + (alerts.length > 0 ? 4 : 40)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20, 20, 20)
      doc.text(`Open Action Items (${actions.length})`, PW / 2 + 5, actY - 4)

      autoTable(doc, {
        startY: actY,
        head: [['Action', 'Priority', 'Site', 'Assignee']],
        body: actions.slice(0, 12).map(a => [
          a.title,
          a.priority ?? 'Medium',
          a.site ?? '—',
          a.assignee ?? 'Unassigned',
        ]),
        margin: { left: PW / 2 + 5, right: 14 },
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: [92, 59, 12], textColor: WHITE, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [255, 251, 235] },
        columnStyles: { 1: { cellWidth: 22 } },
        didParseCell: (d) => {
          if (d.section === 'body' && d.column.index === 1) {
            const v = String(d.cell.raw).toLowerCase()
            if (v === 'critical' || v === 'high') { d.cell.styles.fillColor = [254, 226, 226]; d.cell.styles.textColor = [185, 28, 28]; d.cell.styles.fontStyle = 'bold' }
            else if (v === 'medium') { d.cell.styles.fillColor = [254, 249, 195]; d.cell.styles.textColor = [133, 77, 14] }
          }
        },
      })
    }
  }

  // ── PAGE 5: AI INSIGHTS & RECOMMENDATIONS ─────────────────────────────────
  doc.addPage()
  {
    doc.setFillColor(...DARK)
    doc.rect(0, 0, PW, PH, 'F')
    // Subtle radial glow effect via gradient-like circles
    for (let i = 5; i > 0; i--) {
      doc.setFillColor(20, 50, 30, i * 0.04)
      doc.circle(PW / 2, PH / 2, i * 50, 'F')
    }

    doc.setFillColor(...DARK)
    doc.rect(0, 0, PW, 24, 'F')
    doc.setFillColor(...ACCENT)
    doc.rect(0, 24, PW, 2.5, 'F')
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...WHITE)
    doc.text('AI Insights & Strategic Recommendations', 14, 15)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 180, 130)
    doc.text(`${reportDate}  ·  Powered by TyrePulse AI`, PW - 14, 15, { align: 'right' })

    let y5 = 34

    // Insights
    const insights = data.insights ?? []
    if (insights.length > 0) {
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(100, 220, 150)
      doc.text('AI Fleet Intelligence', 14, y5)
      y5 += 8

      insights.forEach((insight, i) => {
        if (y5 > PH - 20) return
        doc.setFillColor(22, 163, 74, 0.08)
        doc.setDrawColor(40, 120, 70)
        doc.setLineWidth(0.3)
        const iLines = doc.splitTextToSize(insight, PW / 2 - 30)
        const iH = iLines.length * 4.5 + 8
        doc.roundedRect(14, y5 - 3, PW / 2 - 20, iH, 2, 2, 'FD')
        doc.setFontSize(7.5)
        doc.setTextColor(160, 220, 180)
        doc.text(`${i + 1}.`, 20, y5 + 2)
        doc.setFontSize(7.5)
        doc.setTextColor(200, 230, 210)
        doc.text(iLines, 30, y5 + 2)
        y5 += iH + 4
      })
    }

    // Recommendations
    const recs = data.recommendations ?? []
    if (recs.length > 0) {
      let recY = 34
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(150, 180, 255)
      doc.text('Priority Action Plan', PW / 2 + 10, recY)
      recY += 8

      recs.forEach((rec, i) => {
        if (recY > PH - 20) return
        const isUrgent = rec.priority === 'Critical' || rec.priority === 'High' || rec.urgent
        const [r, g, b] = isUrgent ? RED : BLUE
        doc.setFillColor(r, g, b, 0.1)
        doc.setDrawColor(r * 0.6, g * 0.6, b * 0.6)
        doc.setLineWidth(0.3)
        const rLines = doc.splitTextToSize(rec.text, PW / 2 - 35)
        const rH = rLines.length * 4.5 + 10
        doc.roundedRect(PW / 2 + 10, recY - 3, PW / 2 - 24, rH, 2, 2, 'FD')
        // Priority badge
        doc.setFillColor(r, g, b)
        doc.roundedRect(PW / 2 + 12, recY - 1, 28, 6, 1, 1, 'F')
        doc.setFontSize(6)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(...WHITE)
        doc.text((rec.priority ?? 'Medium').toUpperCase(), PW / 2 + 26, recY + 3.5, { align: 'center' })
        doc.setFontSize(7.5)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(200, 210, 230)
        doc.text(rLines, PW / 2 + 45, recY + 2)
        recY += rH + 4
      })
    }
  }

  // ── FOOTERS on all pages ───────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    footer(p, totalPages)
  }

  const safeFilename = filename || `TyrePulse_${periodLabel}_Report_${reportDate.replace(/ /g, '_')}`
  doc.save(`${safeFilename}.pdf`)
}

// ── PowerPoint Export (Enhanced) ──────────────────────────────────────────────
/**
 * @param {{
 *   totalTyres, totalCost, openActions, highRisk,
 *   topSites, topBrands, riskBreakdown, categoryBreakdown,
 *   monthlyTrend, recentActions,
 *   criticalAlerts, siteBreakdown,
 *   avgTreadDepth, pressureCompliance,
 *   totalVehicles, activeVehicles,
 *   insights, recommendations,
 *   period, company,
 * }} data
 */
export async function exportToPptx(data, filename = 'TyrePulse_Report') {
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'   // 13.33" × 7.5"

  const DARK    = '0A0E19'
  const ACCENT  = '16A34A'
  const BLUE    = '2563EB'
  const WHITE   = 'FFFFFF'
  const LGRAY   = 'F3F4F6'
  const RED     = 'DC2626'
  const ORANGE  = 'EA580C'
  const YELLOW  = 'D97706'
  const GREEN   = '16A34A'
  const PURPLE  = '7C3AED'

  const RISK_COLORS = { Critical: RED, High: ORANGE, Medium: YELLOW, Low: GREEN, Good: GREEN, Warning: YELLOW }

  function slideHeader(slide, title, color = ACCENT) {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.1, fill: { color: '1F2937' } })
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.1, w: 13.33, h: 0.04, fill: { color: color } })
    slide.addText(title, { x: 0.4, y: 0.2, w: 9, h: 0.7, fontSize: 20, bold: true, color: WHITE, fontFace: 'Arial' })
    slide.addText('TyrePulse', { x: 11.5, y: 0.3, w: 1.7, h: 0.5, fontSize: 10, color: '4B5563', align: 'right', fontFace: 'Arial' })
    slide.addText(nowStr(), { x: 0.4, y: 0.78, w: 9, h: 0.3, fontSize: 9, color: '6B7280', fontFace: 'Arial' })
  }

  function kpiTile(slide, x, y, w, label, value, sub, color, textColor = WHITE) {
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 1.5, fill: { color: '1F2937' }, line: { color, width: 1 }, rounding: true })
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.08, fill: { color } })
    slide.addText(String(value ?? '—'), { x, y: y + 0.15, w, h: 0.75, fontSize: 26, bold: true, color, align: 'center', fontFace: 'Arial' })
    slide.addText(label, { x, y: y + 0.9, w, h: 0.35, fontSize: 11, color: '9CA3AF', align: 'center', fontFace: 'Arial' })
    if (sub) slide.addText(String(sub), { x, y: y + 1.25, w, h: 0.2, fontSize: 8, color: '6B7280', align: 'center', fontFace: 'Arial' })
  }

  // ── Slide 1: Cover ──────────────────────────────────────────────────────────
  const s1 = pptx.addSlide()
  s1.background = { color: DARK }
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.08, h: 7.5, fill: { color: ACCENT } })
  s1.addText('TYREPULSE', { x: 0.6, y: 1.2, w: 8, h: 1.2, fontSize: 52, bold: true, color: WHITE, fontFace: 'Arial' })
  s1.addText('Tyre Intelligence Platform', { x: 0.6, y: 2.5, w: 8, h: 0.6, fontSize: 20, color: '6EE7B7', fontFace: 'Arial' })
  s1.addText(`${data.period ?? 'Management'} Summary Report`, { x: 0.6, y: 3.2, w: 8, h: 0.7, fontSize: 16, color: '9CA3AF', fontFace: 'Arial' })
  if (data.company) s1.addText(data.company, { x: 0.6, y: 4.0, w: 8, h: 0.5, fontSize: 14, color: '6B7280', fontFace: 'Arial' })
  s1.addText(`Generated: ${nowStr()}`, { x: 0.6, y: 6.8, w: 8, h: 0.35, fontSize: 10, color: '374151', fontFace: 'Arial' })
  // Right summary tiles
  const cover_kpis = [
    { l: 'Total Vehicles', v: data.totalVehicles ?? 0, c: BLUE },
    { l: 'Total Tyres', v: data.totalTyres ?? 0, c: ACCENT },
    { l: 'Critical Tyres', v: data.highRisk ?? 0, c: RED },
    { l: 'Open Actions', v: data.openActions?.length ?? data.openActions ?? 0, c: YELLOW },
  ]
  cover_kpis.forEach((k, i) => {
    const ky = 1.0 + i * 1.6
    s1.addShape(pptx.ShapeType.rect, { x: 9.8, y: ky, w: 3.1, h: 1.35, fill: { color: '111827' }, line: { color: k.c, width: 1 }, rounding: true })
    s1.addText(String(k.v), { x: 9.8, y: ky + 0.1, w: 3.1, h: 0.75, fontSize: 30, bold: true, color: k.c, align: 'center', fontFace: 'Arial' })
    s1.addText(k.l, { x: 9.8, y: ky + 0.85, w: 3.1, h: 0.4, fontSize: 11, color: '9CA3AF', align: 'center', fontFace: 'Arial' })
  })

  // ── Slide 2: Executive KPIs ─────────────────────────────────────────────────
  const s2 = pptx.addSlide()
  s2.background = { color: DARK }
  slideHeader(s2, 'Executive KPI Summary', ACCENT)

  const kpis2 = [
    { l: 'Total Tyre Records', v: data.totalTyres?.toLocaleString() ?? '0', sub: 'Tracked fleet-wide', c: BLUE },
    { l: 'Total Cost (SAR)', v: formatSAR(data.totalCost), sub: 'Cumulative spend', c: PURPLE },
    { l: 'Critical / High Risk', v: data.highRisk?.toLocaleString() ?? '0', sub: 'Require immediate action', c: RED },
    { l: 'Open Actions', v: (typeof data.openActions === 'number' ? data.openActions : data.openActions?.length ?? 0).toLocaleString(), sub: 'Pending resolution', c: YELLOW },
  ]
  kpis2.forEach((k, i) => kpiTile(s2, 0.3 + i * 3.2, 1.3, 3.0, k.l, k.v, k.sub, k.c))

  // Fleet health summary bar
  const totalT2 = data.totalTyres || 1
  const critPct = pct(data.highRisk, totalT2)
  const goodPct = 100 - critPct
  s2.addText('Fleet Tyre Condition', { x: 0.4, y: 3.1, w: 12, h: 0.5, fontSize: 14, bold: true, color: WHITE, fontFace: 'Arial' })
  s2.addShape(pptx.ShapeType.rect, { x: 0.4, y: 3.65, w: 12.5, h: 0.45, fill: { color: '374151' }, rounding: true })
  if (goodPct > 0) s2.addShape(pptx.ShapeType.rect, { x: 0.4, y: 3.65, w: 12.5 * (goodPct / 100), h: 0.45, fill: { color: ACCENT }, rounding: true })
  if (critPct > 0) s2.addShape(pptx.ShapeType.rect, { x: 0.4 + 12.5 * (goodPct / 100), y: 3.65, w: 12.5 * (critPct / 100), h: 0.45, fill: { color: RED } })
  s2.addText(`${goodPct}% Safe`, { x: 0.5, y: 3.65, w: 4, h: 0.45, fontSize: 11, bold: true, color: WHITE, fontFace: 'Arial' })
  s2.addText(`${critPct}% Risk`, { x: 9, y: 3.65, w: 4, h: 0.45, fontSize: 11, bold: true, color: WHITE, align: 'right', fontFace: 'Arial' })

  // Avg tread / pressure row
  const suppKpis = [
    { l: 'Avg Tread Depth', v: data.avgTreadDepth ? `${data.avgTreadDepth}mm` : '—', c: ACCENT },
    { l: 'Pressure Compliance', v: data.pressureCompliance ? `${data.pressureCompliance}%` : '—', c: BLUE },
    { l: 'Active Vehicles', v: data.activeVehicles?.toLocaleString() ?? '—', c: GREEN },
  ]
  suppKpis.forEach((k, i) => kpiTile(s2, 0.3 + i * 3.5, 4.3, 3.3, k.l, k.v, null, k.c))

  // ── Slide 3: Top Sites ──────────────────────────────────────────────────────
  if (data.topSites?.length) {
    const s3 = pptx.addSlide()
    s3.background = { color: DARK }
    slideHeader(s3, 'Top Sites by Tyre Consumption', BLUE)

    const tableRows3 = data.topSites.slice(0, 12).map((s, i) => [
      { text: String(i + 1), options: { color: '9CA3AF', fontSize: 11 } },
      { text: s.site, options: { color: WHITE, fontSize: 11, bold: i < 3 } },
      { text: String(s.count), options: { color: i === 0 ? ACCENT : WHITE, fontSize: 11, bold: i < 3, align: 'right' } },
      { text: fmtSAR(s.cost), options: { color: i === 0 ? YELLOW : '9CA3AF', fontSize: 10, align: 'right' } },
    ])

    s3.addTable(
      [
        [{ text: '#', options: { bold: true, color: WHITE, fill: BLUE } }, { text: 'Site', options: { bold: true, color: WHITE, fill: BLUE } }, { text: 'Tyres', options: { bold: true, color: WHITE, fill: BLUE, align: 'right' } }, { text: 'Est. Cost', options: { bold: true, color: WHITE, fill: BLUE, align: 'right' } }],
        ...tableRows3,
      ],
      { x: 0.5, y: 1.3, w: 7, colW: [0.5, 4, 1.2, 1.3], border: { type: 'none' }, fill: '1F2937', fontSize: 11 }
    )

    // Right side bar chart
    const maxSite = Math.max(...data.topSites.map(s => s.count), 1)
    data.topSites.slice(0, 8).forEach((site, i) => {
      const barH = (site.count / maxSite) * 4
      const bx = 8.0 + i * 0.64
      const by = 5.3 - barH
      s3.addShape(pptx.ShapeType.rect, { x: bx, y: by, w: 0.5, h: barH, fill: { color: i === 0 ? ACCENT : BLUE }, rounding: true })
      s3.addText(String(site.count), { x: bx - 0.05, y: by - 0.3, w: 0.6, h: 0.3, fontSize: 8, color: WHITE, align: 'center', fontFace: 'Arial' })
      s3.addText(site.site.split(' ')[0], { x: bx - 0.1, y: 5.3, w: 0.7, h: 0.4, fontSize: 7, color: '9CA3AF', align: 'center', fontFace: 'Arial' })
    })
  }

  // ── Slide 4: Risk Breakdown ─────────────────────────────────────────────────
  const s4 = pptx.addSlide()
  s4.background = { color: DARK }
  slideHeader(s4, 'Risk Level & Category Breakdown', RED)

  if (data.riskBreakdown?.length) {
    const total4 = data.riskBreakdown.reduce((s, r) => s + r.count, 0)
    let ry = 1.4
    for (const r of data.riskBreakdown) {
      const pctVal = total4 > 0 ? r.count / total4 : 0
      const col = RISK_COLORS[r.level] ?? '6B7280'
      s4.addText(r.level, { x: 0.5, y: ry, w: 2.2, h: 0.38, fontSize: 13, color: col, fontFace: 'Arial' })
      s4.addText(`${Math.round(pctVal * 100)}%`, { x: 2.8, y: ry, w: 1, h: 0.38, fontSize: 11, color: '9CA3AF', align: 'right', fontFace: 'Arial' })
      s4.addShape(pptx.ShapeType.rect, { x: 3.9, y: ry + 0.05, w: 5, h: 0.28, fill: { color: '374151' } })
      if (pctVal > 0) s4.addShape(pptx.ShapeType.rect, { x: 3.9, y: ry + 0.05, w: Math.max(0.05, 5 * pctVal), h: 0.28, fill: { color: col } })
      s4.addText(`${r.count}`, { x: 9.1, y: ry, w: 1, h: 0.38, fontSize: 13, color: WHITE, align: 'right', fontFace: 'Arial' })
      ry += 0.6
    }
  }

  if (data.categoryBreakdown?.length) {
    const catRows4 = data.categoryBreakdown.slice(0, 8).map(c => [
      { text: c.category, options: { color: WHITE, fontSize: 10 } },
      { text: String(c.count), options: { color: '93C5FD', fontSize: 10, align: 'right' } },
    ])
    s4.addTable(
      [
        [{ text: 'Category', options: { bold: true, color: WHITE, fill: BLUE } }, { text: 'Count', options: { bold: true, color: WHITE, fill: BLUE, align: 'right' } }],
        ...catRows4,
      ],
      { x: 10.0, y: 1.3, w: 3.0, colW: [2.3, 0.7], border: { type: 'none' }, fill: '1F2937', fontSize: 10 }
    )
  }

  // ── Slide 5: Monthly Trend ──────────────────────────────────────────────────
  if (data.monthlyTrend?.length) {
    const s5 = pptx.addSlide()
    s5.background = { color: DARK }
    slideHeader(s5, 'Monthly Tyre Issue Trend', PURPLE)

    const maxVal5 = Math.max(...data.monthlyTrend.map(m => m.count), 1)
    const chartH5 = 4.0
    const chartY5 = 1.6
    const availW = 12.5
    const barW5  = availW / data.monthlyTrend.length * 0.65
    const gap5   = availW / data.monthlyTrend.length * 0.35

    data.monthlyTrend.forEach((m, i) => {
      const barH5 = Math.max(0.05, (m.count / maxVal5) * chartH5)
      const x5    = 0.4 + i * (barW5 + gap5)
      const y5    = chartY5 + (chartH5 - barH5)
      s5.addShape(pptx.ShapeType.rect, { x: x5, y: y5, w: barW5, h: barH5, fill: { color: i === data.monthlyTrend.length - 1 ? ACCENT : BLUE }, rounding: true })
      s5.addText(String(m.count), { x: x5, y: y5 - 0.35, w: barW5, h: 0.3, fontSize: 10, color: WHITE, align: 'center', fontFace: 'Arial' })
      s5.addText(m.month, { x: x5, y: chartY5 + chartH5 + 0.08, w: barW5 + 0.2, h: 0.35, fontSize: 9, color: '9CA3AF', align: 'center', fontFace: 'Arial' })
    })

    // Trend line (approximate)
    const avgCount = data.monthlyTrend.reduce((s, m) => s + m.count, 0) / data.monthlyTrend.length
    const avgBarH  = (avgCount / maxVal5) * chartH5
    const avgY     = chartY5 + (chartH5 - avgBarH)
    s5.addShape(pptx.ShapeType.line, { x: 0.4, y: avgY, w: 12.5, h: 0, line: { color: YELLOW, width: 1, dashType: 'dash' } })
    s5.addText(`Avg: ${Math.round(avgCount)}`, { x: 9, y: avgY - 0.3, w: 2, h: 0.3, fontSize: 9, color: YELLOW, fontFace: 'Arial' })
  }

  // ── Slide 6: Brands + Corrective Actions ──────────────────────────────────
  {
    const s6 = pptx.addSlide()
    s6.background = { color: DARK }
    slideHeader(s6, 'Open Actions & Brand Performance', ORANGE)

    if (data.recentActions?.length) {
      const actionRows6 = data.recentActions.slice(0, 10).map(a => [
        { text: a.title, options: { color: WHITE, fontSize: 10 } },
        { text: a.site ?? ' ', options: { color: '9CA3AF', fontSize: 10 } },
        { text: a.priority, options: { color: RISK_COLORS[a.priority] ?? WHITE, fontSize: 10, bold: a.priority === 'High' || a.priority === 'Critical' } },
        { text: a.status, options: { color: '9CA3AF', fontSize: 10 } },
      ])
      s6.addTable(
        [
          [{ text: 'Title', options: { bold: true, color: WHITE, fill: '7C2D12' } }, { text: 'Site', options: { bold: true, color: WHITE, fill: '7C2D12' } }, { text: 'Priority', options: { bold: true, color: WHITE, fill: '7C2D12' } }, { text: 'Status', options: { bold: true, color: WHITE, fill: '7C2D12' } }],
          ...actionRows6,
        ],
        { x: 0.5, y: 1.3, w: 7.5, colW: [3.8, 1.6, 1.2, 0.9], border: { type: 'none' }, fill: '1F2937', fontSize: 10 }
      )
    }

    if (data.topBrands?.length) {
      const maxBrand = Math.max(...data.topBrands.map(b => b.count), 1)
      data.topBrands.slice(0, 8).forEach((brand, i) => {
        const bx = 8.5
        const by = 1.4 + i * 0.65
        const bw = 4 * (brand.count / maxBrand)
        s6.addText(brand.brand.substring(0, 14), { x: bx, y: by, w: 2.2, h: 0.5, fontSize: 10, color: WHITE, fontFace: 'Arial' })
        s6.addShape(pptx.ShapeType.rect, { x: bx + 2.3, y: by + 0.08, w: 4, h: 0.32, fill: { color: '374151' } })
        if (bw > 0) s6.addShape(pptx.ShapeType.rect, { x: bx + 2.3, y: by + 0.08, w: bw, h: 0.32, fill: { color: ACCENT } })
        s6.addText(String(brand.count), { x: bx + 6.5, y: by, w: 0.7, h: 0.5, fontSize: 10, color: '9CA3AF', align: 'right', fontFace: 'Arial' })
      })
    }
  }

  // ── Slide 7: AI Insights (if provided) ─────────────────────────────────────
  if (data.insights?.length || data.recommendations?.length) {
    const s7 = pptx.addSlide()
    s7.background = { color: DARK }
    slideHeader(s7, 'AI Intelligence & Recommendations', ACCENT)

    if (data.insights?.length) {
      s7.addText('Fleet Intelligence', { x: 0.5, y: 1.3, w: 6, h: 0.4, fontSize: 13, bold: true, color: '6EE7B7', fontFace: 'Arial' })
      data.insights.slice(0, 4).forEach((insight, i) => {
        s7.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.8 + i * 1.0, w: 5.8, h: 0.85, fill: { color: '064E3B' }, line: { color: ACCENT, width: 0.5 }, rounding: true })
        s7.addText(insight, { x: 0.7, y: 1.85 + i * 1.0, w: 5.4, h: 0.75, fontSize: 10, color: 'D1FAE5', wrap: true, fontFace: 'Arial' })
      })
    }

    if (data.recommendations?.length) {
      s7.addText('Action Plan', { x: 7.0, y: 1.3, w: 6, h: 0.4, fontSize: 13, bold: true, color: '93C5FD', fontFace: 'Arial' })
      data.recommendations.slice(0, 4).forEach((rec, i) => {
        const isHigh = rec.priority === 'Critical' || rec.priority === 'High' || rec.urgent
        const col = isHigh ? RED : BLUE
        s7.addShape(pptx.ShapeType.rect, { x: 7.0, y: 1.8 + i * 1.0, w: 6.0, h: 0.85, fill: { color: '1E3A5F' }, line: { color: col, width: 0.5 }, rounding: true })
        s7.addText((rec.priority ?? 'Medium').toUpperCase(), { x: 7.1, y: 1.85 + i * 1.0, w: 1.2, h: 0.3, fontSize: 7, bold: true, color: col, fontFace: 'Arial' })
        s7.addText(rec.text, { x: 7.1, y: 2.05 + i * 1.0, w: 5.7, h: 0.55, fontSize: 9, color: 'BFDBFE', wrap: true, fontFace: 'Arial' })
      })
    }
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
  if (!n && n !== 0) return 'SAR —'
  if (n >= 1_000_000) return `SAR ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `SAR ${(n / 1_000).toFixed(0)}K`
  return `SAR ${n.toLocaleString()}`
}
