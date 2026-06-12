import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import pptxgen from 'pptxgenjs'
import { formatCurrencyCompact, formatDate } from './formatters.js'

// ── Brand palette — deep slate + indigo + gold (no green/AI references) ────────
const P = {
  // Darks
  ink:      [8,   12,  28],   // near-black navy
  slate:    [15,  23,  42],   // header backgrounds
  steel:    [30,  41,  59],   // table headers
  iron:     [51,  65,  85],   // secondary elements

  // Accent
  indigo:   [79,  70,  229],  // primary accent
  violet:   [109, 40,  217],  // secondary accent
  gold:     [245, 158, 11],   // KPI values / highlights
  amber:    [180, 83,  9],    // gold-dark

  // Status — rich, not neon
  emerald:  [4,   120, 87],   // good
  crimson:  [153, 27,  27],   // critical
  scarlet:  [194, 65,  12],   // high
  ochre:    [120, 53,  15],   // medium/warning

  // Tints (RGBA backgrounds)
  eCream:   [236, 253, 245],  // good bg
  rCream:   [254, 242, 242],  // critical bg
  oCream:   [255, 247, 237],  // warning bg
  yCream:   [254, 252, 232],  // info bg

  // Neutrals
  white:    [255, 255, 255],
  offWhite: [248, 250, 252],
  silver:   [226, 232, 240],
  cloud:    [241, 245, 249],
  mist:     [148, 163, 184],
  ghost:    [100, 116, 139],
}

// ── Shared helpers ─────────────────────────────────────────────────────────────
function pct(n, total) { return total > 0 ? Math.round((n / total) * 100) : 0 }
const fmtCurr = (n, currency = 'SAR') => formatCurrencyCompact(n, currency)
const nowStr  = () => formatDate(new Date(), 'All')

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// Serialize a DOM SVG element to a PNG data URL at given scale
async function svgToPngDataUrl(svgEl, scale = 2, bgColor = '#0A0F1E') {
  return new Promise((resolve) => {
    try {
      const svgStr  = new XMLSerializer().serializeToString(svgEl)
      const blob    = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
      const url     = URL.createObjectURL(blob)
      const img     = new Image()
      img.onload = () => {
        const svgW = svgEl.viewBox?.baseVal?.width  || svgEl.clientWidth  || 400
        const svgH = svgEl.viewBox?.baseVal?.height || svgEl.clientHeight || 300
        const c    = document.createElement('canvas')
        c.width    = svgW * scale
        c.height   = svgH * scale
        const ctx  = c.getContext('2d')
        ctx.scale(scale, scale)
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, svgW, svgH)
        ctx.drawImage(img, 0, 0, svgW, svgH)
        URL.revokeObjectURL(url)
        resolve({ dataUrl: c.toDataURL('image/png'), w: svgW, h: svgH })
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
      img.src = url
    } catch { resolve(null) }
  })
}

// ── PDF layout helpers ─────────────────────────────────────────────────────────
function _pageHeader(doc, title, subtitle, company = '') {
  const pw = doc.internal.pageSize.width
  // Deep slate header
  doc.setFillColor(...P.slate)
  doc.rect(0, 0, pw, 20, 'F')
  // Indigo accent stripe
  doc.setFillColor(...P.indigo)
  doc.rect(0, 20, pw, 2.5, 'F')

  // Company name — left
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...P.gold)
  doc.text((company || 'FLEET OPERATIONS').toUpperCase(), 14, 8)

  // Title — left
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...P.white)
  doc.text(title, 14, 15)

  // Subtitle + date — right
  if (subtitle) {
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...P.mist)
    doc.text(subtitle, pw - 14, 10, { align: 'right' })
  }
  doc.setFontSize(7)
  doc.setTextColor(...P.ghost)
  doc.text(nowStr(), pw - 14, 16, { align: 'right' })
}

function _pageFooter(doc, page, total, company = '') {
  const pw = doc.internal.pageSize.width
  const ph = doc.internal.pageSize.height
  doc.setFillColor(...P.cloud)
  doc.rect(0, ph - 9, pw, 9, 'F')
  doc.setDrawColor(...P.silver)
  doc.setLineWidth(0.2)
  doc.line(0, ph - 9, pw, ph - 9)
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...P.ghost)
  doc.text(`${company || 'Fleet Operations Report'}  ·  Confidential & Internal`, 14, ph - 3)
  doc.text(`${page}${total ? ` / ${total}` : ''}`, pw - 14, ph - 3, { align: 'right' })
}

function _sectionBar(doc, title, y, mx = 14) {
  const pw = doc.internal.pageSize.width
  doc.setFillColor(...P.steel)
  doc.roundedRect(mx, y - 3.5, pw - mx * 2, 8.5, 1, 1, 'F')
  doc.setFillColor(...P.indigo)
  doc.roundedRect(mx, y - 3.5, 3, 8.5, 1, 1, 'F')
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...P.white)
  doc.text(title, mx + 7, y + 2)
  return y + 9
}

function _kpiBox(doc, x, y, w, h, value, label, subtext, accentRgb) {
  const [r, g, b] = accentRgb
  // Card shadow effect
  doc.setFillColor(r * 0.06, g * 0.06, b * 0.06)
  doc.roundedRect(x + 0.5, y + 0.5, w, h, 2, 2, 'F')
  // Card background
  doc.setFillColor(...P.offWhite)
  doc.setDrawColor(r * 0.6, g * 0.6, b * 0.6)
  doc.setLineWidth(0.4)
  doc.roundedRect(x, y, w, h, 2, 2, 'FD')
  // Top accent bar
  doc.setFillColor(r, g, b)
  doc.roundedRect(x, y, w, 2.5, 2, 0, 'F')
  // Value
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(r * 0.65, g * 0.65, b * 0.65)
  doc.text(String(value ?? '—'), x + w / 2, y + h / 2 + 2, { align: 'center' })
  // Label
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...P.ghost)
  doc.text(label, x + w / 2, y + h - 8, { align: 'center' })
  if (subtext) {
    doc.setFontSize(6)
    doc.setTextColor(...P.mist)
    doc.text(String(subtext), x + w / 2, y + h - 3.5, { align: 'center' })
  }
}

// ── Risk helpers ───────────────────────────────────────────────────────────────
const RISK_RGB = {
  good:     [...P.emerald],
  warning:  [...P.scarlet],
  critical: [...P.crimson],
  none:     [...P.iron],
}
const RISK_LABEL = { good: 'Good', warning: 'Warning', critical: 'Critical', none: 'No Data' }
const COND_TO_RISK = { Good: 'good', Wear: 'warning', Damage: 'critical', Puncture: 'critical', None: 'none' }

// ── Tyre Diagram Layouts ───────────────────────────────────────────────────────
const _TYRE_LAYOUTS = {
  Pickup: {
    body: { x: 60, y: 40, w: 80, h: 200, rx: 8 },
    tyres: [
      { id: 'FL', x: 35, y: 55, w: 22, h: 38, rx: 4 },
      { id: 'FR', x: 143, y: 55, w: 22, h: 38, rx: 4 },
      { id: 'RL', x: 35, y: 185, w: 22, h: 38, rx: 4 },
      { id: 'RR', x: 143, y: 185, w: 22, h: 38, rx: 4 },
    ],
  },
  // Dual-rear-axle layout shared by Canter / Bus / Tata / Ashok Leyland
  ...(function() {
    const _dualRear = {
      body:  { x: 60, y: 30, w: 80, h: 240, rx: 8 },
      tyres: [
        { id: 'FL',  x: 35,  y: 45,  w: 22, h: 36, rx: 4 },
        { id: 'FR',  x: 143, y: 45,  w: 22, h: 36, rx: 4 },
        { id: 'RLo', x: 22,  y: 175, w: 20, h: 34, rx: 3 },
        { id: 'RLi', x: 44,  y: 175, w: 20, h: 34, rx: 3 },
        { id: 'RRi', x: 136, y: 175, w: 20, h: 34, rx: 3 },
        { id: 'RRo', x: 158, y: 175, w: 20, h: 34, rx: 3 },
      ],
    }
    const _loader = {
      body:  { x: 60, y: 40, w: 80, h: 200, rx: 8 },
      tyres: [
        { id: 'FL', x: 30,  y: 55,  w: 28, h: 44, rx: 5 },
        { id: 'FR', x: 142, y: 55,  w: 28, h: 44, rx: 5 },
        { id: 'RL', x: 30,  y: 185, w: 28, h: 44, rx: 5 },
        { id: 'RR', x: 142, y: 185, w: 28, h: 44, rx: 5 },
      ],
    }
    return {
      Canter: _dualRear, Bus: _dualRear, Tata: _dualRear, 'Ashok Leyland': _dualRear,
      'Wheel loader': _loader, 'Skid loader': _loader,
    }
  }()),
  'Tri-mixer': {
    body: { x: 55, y: 20, w: 90, h: 290, rx: 8 },
    tyres: [
      { id: 'F1L', x: 28, y: 30, w: 22, h: 34, rx: 4 },
      { id: 'F1R', x: 150, y: 30, w: 22, h: 34, rx: 4 },
      { id: 'F2L', x: 28, y: 80, w: 22, h: 34, rx: 4 },
      { id: 'F2R', x: 150, y: 80, w: 22, h: 34, rx: 4 },
      { id: 'R1Lo', x: 16, y: 170, w: 18, h: 32, rx: 3 },
      { id: 'R1Li', x: 36, y: 170, w: 18, h: 32, rx: 3 },
      { id: 'R1Ri', x: 146, y: 170, w: 18, h: 32, rx: 3 },
      { id: 'R1Ro', x: 166, y: 170, w: 18, h: 32, rx: 3 },
      { id: 'R2Lo', x: 16, y: 215, w: 18, h: 32, rx: 3 },
      { id: 'R2Li', x: 36, y: 215, w: 18, h: 32, rx: 3 },
      { id: 'R2Ri', x: 146, y: 215, w: 18, h: 32, rx: 3 },
      { id: 'R2Ro', x: 166, y: 215, w: 18, h: 32, rx: 3 },
    ],
  },
  'Concrete pump': {
    body: { x: 55, y: 20, w: 90, h: 310, rx: 8 },
    tyres: [
      { id: 'FL', x: 28, y: 30, w: 22, h: 34, rx: 4 },
      { id: 'FR', x: 150, y: 30, w: 22, h: 34, rx: 4 },
      { id: 'R1Lo', x: 16, y: 130, w: 18, h: 30, rx: 3 },
      { id: 'R1Li', x: 36, y: 130, w: 18, h: 30, rx: 3 },
      { id: 'R1Ri', x: 146, y: 130, w: 18, h: 30, rx: 3 },
      { id: 'R1Ro', x: 166, y: 130, w: 18, h: 30, rx: 3 },
      { id: 'R2Lo', x: 16, y: 175, w: 18, h: 30, rx: 3 },
      { id: 'R2Li', x: 36, y: 175, w: 18, h: 30, rx: 3 },
      { id: 'R2Ri', x: 146, y: 175, w: 18, h: 30, rx: 3 },
      { id: 'R2Ro', x: 166, y: 175, w: 18, h: 30, rx: 3 },
      { id: 'R3Lo', x: 16, y: 220, w: 18, h: 30, rx: 3 },
      { id: 'R3Li', x: 36, y: 220, w: 18, h: 30, rx: 3 },
      { id: 'R3Ri', x: 146, y: 220, w: 18, h: 30, rx: 3 },
      { id: 'R3Ro', x: 166, y: 220, w: 18, h: 30, rx: 3 },
    ],
  },
}

function _resolveLayoutKey(vehicleType) {
  if (!vehicleType) return null
  if (_TYRE_LAYOUTS[vehicleType]) return vehicleType
  const lower = vehicleType.toLowerCase()
  const found = Object.keys(_TYRE_LAYOUTS).find(k => k.toLowerCase() === lower)
  if (found) return found
  if (lower.includes('tri') || lower.includes('mixer'))       return 'Tri-mixer'
  if (lower.includes('concrete') || lower.includes('pump'))  return 'Concrete pump'
  if (lower.includes('wheel') && lower.includes('load'))     return 'Wheel loader'
  if (lower.includes('skid'))                                return 'Skid loader'
  if (lower.includes('canter'))                              return 'Canter'
  if (lower.includes('bus'))                                 return 'Bus'
  if (lower.includes('tata'))                                return 'Tata'
  if (lower.includes('ashok') || lower.includes('leyland'))  return 'Ashok Leyland'
  return 'Pickup'
}

// Draw programmatic tyre diagram (used as fallback)
function _drawTyreDiagram(doc, layout, tyreConditions, originX, originY, scale) {
  const { body, tyres } = layout
  const tc = tyreConditions || {}

  // Body — very dark slate
  doc.setFillColor(10, 16, 32)
  doc.setDrawColor(...P.iron)
  doc.setLineWidth(0.5)
  doc.roundedRect(
    originX + body.x * scale, originY + body.y * scale,
    body.w * scale, body.h * scale,
    clamp(body.rx * scale * 0.4, 0.8, 6),
    clamp(body.rx * scale * 0.4, 0.8, 6),
    'FD'
  )
  // Cabin stripe
  doc.setFillColor(18, 26, 48)
  doc.roundedRect(
    originX + body.x * scale + 2,
    originY + body.y * scale + 2,
    body.w * scale - 4,
    body.h * 0.2 * scale,
    clamp(body.rx * scale * 0.3, 0.5, 4), 2, 'F'
  )
  // Axle lines
  const axleSet = new Set()
  tyres.forEach(t => axleSet.add(Math.round(originY + (t.y + t.h / 2) * scale)))
  doc.setDrawColor(40, 55, 80)
  doc.setLineWidth(0.7)
  axleSet.forEach(ay => {
    doc.line(originX + body.x * scale, ay, originX + (body.x + body.w) * scale, ay)
  })

  // Tyres
  tyres.forEach(t => {
    const cond = tc[t.id]
    const risk = (typeof cond === 'object')
      ? (cond?.risk ?? (cond?.condition ? (COND_TO_RISK[cond.condition] ?? 'none') : 'none'))
      : (COND_TO_RISK[cond] ?? 'none')
    const [r, g, b] = RISK_RGB[risk] ?? RISK_RGB.none
    const tx = originX + t.x * scale
    const ty = originY + t.y * scale
    const tw = t.w * scale
    const th = t.h * scale
    const rx = clamp(t.rx * scale * 0.4, 0.4, 5)
    const cx = tx + tw / 2
    const cy = ty + th / 2

    // Shadow
    doc.setFillColor(0, 0, 0)
    doc.roundedRect(tx + 0.6, ty + 0.6, tw, th, rx, rx, 'F')
    // Rubber outer
    doc.setFillColor(12, 14, 22)
    doc.setDrawColor(35, 42, 58)
    doc.setLineWidth(0.3)
    doc.roundedRect(tx, ty, tw, th, rx, rx, 'FD')
    // Tread grooves
    doc.setDrawColor(22, 26, 38)
    doc.setLineWidth(0.5)
    for (let i = 1; i <= 3; i++) {
      const ly = ty + (th / 4) * i
      doc.line(tx + 1, ly, tx + tw - 1, ly)
    }
    // Sidewall ring
    doc.setDrawColor(28, 34, 52)
    doc.setLineWidth(0.25)
    doc.roundedRect(tx + tw * 0.07, ty + th * 0.07, tw * 0.86, th * 0.86, rx * 0.55, rx * 0.55, 'S')
    // Rim — risk coloured
    doc.setFillColor(r, g, b)
    doc.setDrawColor(clamp(r - 50, 0, 255), clamp(g - 50, 0, 255), clamp(b - 50, 0, 255))
    doc.setLineWidth(0.2)
    const rimW = tw * 0.54
    const rimH = th * 0.54
    doc.roundedRect(cx - rimW / 2, cy - rimH / 2, rimW, rimH, rimW * 0.38, rimH * 0.38, 'FD')
    // Spoke cross
    doc.setDrawColor(clamp(r - 90, 0, 255), clamp(g - 90, 0, 255), clamp(b - 90, 0, 255))
    doc.setLineWidth(0.15)
    doc.line(cx - rimW * 0.28, cy, cx + rimW * 0.28, cy)
    doc.line(cx, cy - rimH * 0.28, cx, cy + rimH * 0.28)
    // Hub
    doc.setFillColor(8, 10, 18)
    doc.circle(cx, cy, clamp(Math.min(tw, th) * 0.09, 0.5, 3), 'F')
    // Label
    doc.setFontSize(clamp(tw < 18 ? 3 : tw < 22 ? 4 : 5, 2.5, 6))
    doc.setTextColor(210, 215, 225)
    doc.text(t.id, cx, cy, { align: 'center', baseline: 'middle' })
  })
}

// ── Excel Export ───────────────────────────────────────────────────────────────
export function exportToExcel(rows, columns, headers, filename = 'export', sheetName = 'Sheet1') {
  const displayRows = rows.map(r => Object.fromEntries(columns.map((col, i) => [headers[i], r[col] ?? ''])))
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
export function exportToPdf(rows, columns, title, filename = 'report', orientation = 'landscape', company = '') {
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.width
  const ph = doc.internal.pageSize.height

  _pageHeader(doc, title, `${rows.length} records`, company)

  const usableW = orientation === 'landscape' ? 237 : 170
  const colW = columns.map(c => {
    const k = (c.key ?? '').toLowerCase(), h = (c.header ?? '').toLowerCase()
    if (k.includes('id') || k === 'qty')                              return 22
    if (k.includes('risk') || h.includes('risk'))                    return 28
    if (k.includes('remark') || k.includes('note') || k.includes('description')) return 50
    if (k.includes('date') || k.includes('month'))                   return 28
    if (k.includes('cost') || k.includes('sar'))                     return 30
    if (k.includes('site') || k.includes('brand'))                   return 32
    return 30
  })
  const rawTotal = colW.reduce((s, w) => s + w, 0)
  const sf = usableW / rawTotal
  const scaledW = colW.map(w => Math.round(w * sf * 10) / 10)
  const riskIdx = columns.findIndex(c => /risk/i.test(c.header ?? '') || /risk_level/i.test(c.key ?? ''))

  autoTable(doc, {
    startY: 28,
    head: [columns.map(c => c.header)],
    body: rows.map(r => columns.map(c => String(r[c.key] ?? ''))),
    styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak', textColor: [20, 20, 30] },
    headStyles: { fillColor: P.steel, textColor: P.white, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: P.cloud },
    columnStyles: Object.fromEntries(scaledW.map((w, i) => [i, { cellWidth: w }])),
    margin: { left: 14, right: 14 },
    didParseCell: riskIdx >= 0 ? (data) => {
      if (data.section !== 'body' || data.column.index !== riskIdx) return
      const v = String(data.cell.raw ?? '').trim().toLowerCase()
      if (v === 'critical') { data.cell.styles.fillColor = P.rCream; data.cell.styles.textColor = P.crimson; data.cell.styles.fontStyle = 'bold' }
      else if (v === 'high') { data.cell.styles.fillColor = P.oCream; data.cell.styles.textColor = P.scarlet }
      else if (v === 'medium') { data.cell.styles.fillColor = P.yCream; data.cell.styles.textColor = P.ochre }
      else if (v === 'low') { data.cell.styles.fillColor = P.eCream; data.cell.styles.textColor = P.emerald }
    } : undefined,
    didDrawPage: (data) => { _pageFooter(doc, data.pageNumber, null, company) },
  })

  doc.save(`${filename}.pdf`)
}

// ── Inspection Detail PDF — captures DOM SVG if provided ──────────────────────
/**
 * @param {Object}  row          - inspection record
 * @param {Object}  [opts]
 * @param {Element} [opts.svgEl] - live SVG DOM element from VehicleTyreDiagram
 * @param {string}  [opts.company]
 */
export async function exportInspectionDetailPdf(row, opts = {}) {
  const doc     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw      = doc.internal.pageSize.width
  const ph      = doc.internal.pageSize.height
  const company = opts.company || ''
  const mx      = 14

  // ── PAGE 1 ─────────────────────────────────────────────────────────────────
  _pageHeader(doc, 'Vehicle Inspection Report', `Asset: ${row.asset_no || '—'}`, company)
  let y = 30

  // Title card with severity ribbon
  const sevColorMap = { Low: P.emerald, Medium: P.ochre, High: P.scarlet, Critical: P.crimson }
  const sevRgb = sevColorMap[row.severity] ?? P.ochre
  doc.setFillColor(...P.offWhite)
  doc.setDrawColor(...P.silver)
  doc.setLineWidth(0.4)
  doc.roundedRect(mx, y, pw - mx * 2, 16, 2, 2, 'FD')
  doc.setFillColor(...sevRgb)
  doc.roundedRect(mx, y, 4, 16, 2, 0, 'F')
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...P.ink)
  doc.text(row.title || 'Inspection Record', mx + 8, y + 7)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...P.ghost)
  doc.text(`${row.inspection_type || '—'}  ·  ${row.status || '—'}`, mx + 8, y + 13)
  // Severity badge
  doc.setFillColor(...sevRgb)
  doc.roundedRect(pw - mx - 32, y + 4, 30, 8, 2, 2, 'F')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...P.white)
  doc.text((row.severity || 'MEDIUM').toUpperCase(), pw - mx - 17, y + 9.5, { align: 'center' })
  y += 21

  // Meta grid — 2-col, 4 rows
  const metaL = [
    ['Scheduled Date', row.scheduled_date || '—'],
    ['Site',           row.site || '—'],
    ['Inspector',      row.inspector || row.attendees || '—'],
    ['Company',        company || '—'],
  ]
  const metaR = [
    ['Asset No.',      row.asset_no || '—'],
    ['Vehicle Type',   row.vehicle_type || '—'],
    ['Status',         row.status || '—'],
    ['Findings Count', String(Object.keys(row.tyre_conditions || {}).length || '—')],
  ]
  const half = (pw - mx * 2) / 2
  metaL.forEach(([lbl, val], i) => {
    const my = y + i * 10
    doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(...P.mist)
    doc.text(lbl, mx, my)
    doc.setFontSize(8.5); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
    doc.text(val, mx, my + 5)
    doc.setDrawColor(...P.silver); doc.setLineWidth(0.2)
    doc.line(mx, my + 7.5, mx + half - 4, my + 7.5)

    doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(...P.mist)
    doc.text(metaR[i][0], mx + half, my)
    doc.setFontSize(8.5); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
    doc.text(metaR[i][1], mx + half, my + 5)
    doc.line(mx + half, my + 7.5, pw - mx, my + 7.5)
  })
  y += 46

  // ── Tyre Diagram section ───────────────────────────────────────────────────
  y = _sectionBar(doc, 'VEHICLE TYRE CONDITION MAP', y, mx) + 3

  // Normalize tyre conditions
  const rawTc = row.tyre_conditions || {}
  const normTc = {}
  Object.entries(rawTc).forEach(([pos, data]) => {
    if (typeof data === 'object' && data !== null) {
      normTc[pos] = {
        risk:      data.risk ?? (COND_TO_RISK[data.condition] ?? 'none'),
        pressure:  data.pressure ?? data.psi ?? null,
        tread:     data.tread ?? data.tread_depth ?? null,
        condition: data.condition ?? null,
        notes:     data.notes ?? null,
      }
    } else {
      normTc[pos] = { risk: COND_TO_RISK[String(data)] ?? 'none' }
    }
  })

  // Try DOM SVG capture first (if svgEl passed from calling component)
  let diagramH = 0
  let diagramPlaced = false

  if (opts.svgEl) {
    const captured = await svgToPngDataUrl(opts.svgEl, 2, '#080C1C')
    if (captured) {
      const maxW = pw - mx * 2 - 55 // leave room for legend
      const aspect = captured.w / captured.h
      const dW  = clamp(maxW, 40, maxW)
      const dH  = dW / aspect
      const bgX = mx
      const bgW = pw - mx * 2
      const bgH = dH + 12

      doc.setFillColor(8, 12, 28)
      doc.setDrawColor(...P.iron)
      doc.setLineWidth(0.3)
      doc.roundedRect(bgX, y, bgW, bgH, 3, 3, 'FD')

      // Subtle dot grid
      doc.setFillColor(20, 28, 48)
      for (let gx = bgX + 6; gx < bgX + bgW - 6; gx += 10)
        for (let gy = y + 6; gy < y + bgH - 3; gy += 10)
          doc.circle(gx, gy, 0.25, 'F')

      doc.addImage(captured.dataUrl, 'PNG', mx + 2, y + 4, dW, dH)
      diagramH = bgH

      // Legend — right side
      const legendX = mx + dW + 8
      let legendY   = y + 8
      doc.setFontSize(6.5); doc.setFont('helvetica','bold'); doc.setTextColor(...P.mist)
      doc.text('LEGEND', legendX, legendY); legendY += 6
      Object.entries(RISK_LABEL).forEach(([key, label]) => {
        const [r, g, b] = RISK_RGB[key]
        doc.setFillColor(r, g, b)
        doc.roundedRect(legendX, legendY - 2, 4, 4, 0.5, 0.5, 'F')
        doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(...P.ink)
        doc.text(label, legendX + 6, legendY + 1.5)
        legendY += 8
      })

      diagramPlaced = true
    }
  }

  // Fallback: programmatic drawing
  if (!diagramPlaced) {
    const layoutKey = _resolveLayoutKey(row.vehicle_type)
    const layout    = layoutKey ? _TYRE_LAYOUTS[layoutKey] : null
    if (layout) {
      const maxDiagW = 90
      const scale    = maxDiagW / 200
      const bodyBtm  = layout.body.y + layout.body.h
      const dH       = (bodyBtm + 10) * scale
      const bgX      = mx, bgW = pw - mx * 2, bgH = dH + 14

      doc.setFillColor(8, 12, 28)
      doc.setDrawColor(...P.iron)
      doc.setLineWidth(0.3)
      doc.roundedRect(bgX, y, bgW, bgH, 3, 3, 'FD')
      for (let gx = bgX + 6; gx < bgX + bgW - 6; gx += 10)
        for (let gy = y + 6; gy < y + bgH - 3; gy += 10)
          doc.circle(gx, gy, 0.25, 'F')

      const minTyreX = layout.tyres.reduce((m, t) => Math.min(m, t.x), 999)
      const originX  = mx + (bgW - maxDiagW) / 2 - minTyreX * scale
      _drawTyreDiagram(doc, layout, normTc, originX, y + 5, scale)

      // Legend
      const legendX = bgX + bgW - 50
      let legendY   = y + 10
      doc.setFontSize(6.5); doc.setFont('helvetica','bold'); doc.setTextColor(...P.mist)
      doc.text('LEGEND', legendX, legendY); legendY += 7
      Object.entries(RISK_LABEL).forEach(([key, label]) => {
        const [r, g, b] = RISK_RGB[key]
        doc.setFillColor(r, g, b)
        doc.roundedRect(legendX, legendY - 2, 4, 4, 0.5, 0.5, 'F')
        doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(...P.ink)
        doc.text(label, legendX + 6, legendY + 1.5)
        legendY += 8
      })

      diagramH = bgH
    }
  }

  y += diagramH + 8

  // ── Risk summary chips ─────────────────────────────────────────────────────
  const riskCounts = { critical: 0, warning: 0, good: 0, none: 0 }
  Object.values(normTc).forEach(d => {
    const r = d?.risk ?? 'none'
    riskCounts[r] = (riskCounts[r] || 0) + 1
  })
  const totalT = Object.keys(normTc).length
  if (totalT > 0) {
    const chipW = (pw - mx * 2 - 9) / 4
    Object.entries(RISK_RGB).forEach(([key, rgb], i) => {
      const cnt = riskCounts[key] ?? 0
      const [r, g, b] = rgb
      const cx = mx + i * (chipW + 3)
      doc.setFillColor(r * 0.08, g * 0.08, b * 0.08)
      doc.setDrawColor(r * 0.5, g * 0.5, b * 0.5)
      doc.setLineWidth(0.3)
      doc.roundedRect(cx, y, chipW, 10, 2, 2, 'FD')
      doc.setFillColor(r, g, b)
      doc.circle(cx + 5, y + 5, 2.5, 'F')
      doc.setFontSize(7.5); doc.setFont('helvetica','bold')
      doc.setTextColor(r * 0.55, g * 0.55, b * 0.55)
      doc.text(`${RISK_LABEL[key]}: ${cnt}`, cx + 10, y + 6)
    })
    y += 15
  }

  // ── Tyre condition table ───────────────────────────────────────────────────
  const tyreEntries = Object.entries(normTc)
  if (tyreEntries.length > 0) {
    if (y > ph - 70) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company); y = 30 }
    y = _sectionBar(doc, 'DETAILED TYRE ANALYSIS', y, mx) + 3

    autoTable(doc, {
      startY: y,
      head: [['Position', 'Pressure', 'Tread', 'Condition', 'Risk', 'Notes']],
      body: tyreEntries.map(([pos, d]) => [
        pos,
        d.pressure ? `${d.pressure} PSI` : '—',
        d.tread    ? `${d.tread} mm`     : '—',
        d.condition ?? RISK_LABEL[d.risk] ?? '—',
        RISK_LABEL[d.risk] ?? 'Unknown',
        d.notes ?? '—',
      ]),
      margin: { left: mx, right: mx },
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak', textColor: P.ink },
      headStyles: { fillColor: P.steel, textColor: P.white, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: P.cloud },
      columnStyles: {
        0: { cellWidth: 18, fontStyle: 'bold' },
        1: { cellWidth: 22 }, 2: { cellWidth: 20 },
        3: { cellWidth: 26 }, 4: { cellWidth: 22 },
        5: { cellWidth: 'auto' },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const v = String(data.cell.raw ?? '').toLowerCase()
          if (v === 'critical') { data.cell.styles.fillColor = P.rCream; data.cell.styles.textColor = P.crimson; data.cell.styles.fontStyle = 'bold' }
          else if (v === 'warning') { data.cell.styles.fillColor = P.oCream; data.cell.styles.textColor = P.scarlet }
          else if (v === 'good') { data.cell.styles.fillColor = P.eCream; data.cell.styles.textColor = P.emerald }
        }
      },
    })
    y = (doc.lastAutoTable?.finalY ?? y) + 8
  }

  // ── Risk progress bars ─────────────────────────────────────────────────────
  if (totalT > 0) {
    if (y > ph - 50) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company); y = 30 }
    y = _sectionBar(doc, 'RISK DISTRIBUTION', y, mx) + 6
    Object.entries(RISK_RGB).forEach(([key, [r, g, b]]) => {
      const cnt = riskCounts[key] ?? 0
      const fraction = totalT > 0 ? cnt / totalT : 0
      const bw = pw - mx * 2 - 60
      doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(...P.ghost)
      doc.text(RISK_LABEL[key], mx, y + 3.5)
      doc.setFillColor(...P.silver)
      doc.roundedRect(mx + 36, y, bw, 6, 1.5, 1.5, 'F')
      if (fraction > 0) {
        doc.setFillColor(r, g, b)
        doc.roundedRect(mx + 36, y, Math.max(3, bw * fraction), 6, 1.5, 1.5, 'F')
      }
      doc.setFontSize(7); doc.setTextColor(...P.ghost)
      doc.text(`${cnt} (${pct(cnt, totalT)}%)`, pw - mx, y + 4.5, { align: 'right' })
      y += 10
    })
    y += 4
  }

  // ── Findings ───────────────────────────────────────────────────────────────
  if (row.findings) {
    if (y > ph - 40) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company); y = 30 }
    y = _sectionBar(doc, 'FINDINGS & OBSERVATIONS', y, mx) + 4
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...P.ink)
    const fl = doc.splitTextToSize(row.findings, pw - mx * 2)
    doc.text(fl, mx, y); y += fl.length * 4.5 + 6
  }

  // ── Notes ──────────────────────────────────────────────────────────────────
  if (row.notes) {
    if (y > ph - 35) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company); y = 30 }
    y = _sectionBar(doc, 'ADDITIONAL NOTES', y, mx) + 4
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...P.ink)
    const nl = doc.splitTextToSize(row.notes, pw - mx * 2)
    doc.text(nl, mx, y); y += nl.length * 4.5 + 6
  }

  // ── Auto-recommendations ────────────────────────────────────────────────────
  const recs = _buildRecommendations(riskCounts, totalT, row)
  if (recs.length > 0) {
    if (y > ph - 60) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company); y = 30 }
    y = _sectionBar(doc, 'RECOMMENDED ACTIONS', y, mx) + 4
    recs.forEach(rec => {
      if (y > ph - 16) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company); y = 30 }
      const [r, g, b] = rec.urgent ? P.crimson : P.indigo
      doc.setFillColor(r, g, b)
      doc.circle(mx + 3, y + 2.5, 2, 'F')
      doc.setFontSize(7.5); doc.setFont('helvetica', rec.urgent ? 'bold' : 'normal')
      doc.setTextColor(...P.ink)
      const rl = doc.splitTextToSize(rec.text, pw - mx * 2 - 12)
      doc.text(rl, mx + 8, y + 3)
      y += rl.length * 4.2 + 4
    })
    y += 4
  }

  // ── Signature block ─────────────────────────────────────────────────────────
  if (y + 34 > ph - 12) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company); y = 30 }
  y += 5
  doc.setFillColor(...P.offWhite)
  doc.setDrawColor(...P.silver)
  doc.setLineWidth(0.3)
  doc.roundedRect(mx, y, pw - mx * 2, 28, 2, 2, 'FD')
  doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ghost)
  doc.text('INSPECTOR CERTIFICATION', mx + 4, y + 7)
  doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(...P.mist)
  doc.text('I certify this inspection was conducted in accordance with operational standards.', mx + 4, y + 13)
  doc.setDrawColor(...P.ghost); doc.setLineWidth(0.4)
  doc.line(mx + 4, y + 23, mx + 74, y + 23)
  doc.line(mx + 84, y + 23, pw - mx - 4, y + 23)
  doc.setFontSize(6.5); doc.setTextColor(...P.mist)
  doc.text('Inspector Signature', mx + 4, y + 27)
  doc.text(`Name: ${row.inspector || '_______________'}`, mx + 84, y + 27)

  // ── Footers ─────────────────────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    _pageFooter(doc, p, totalPages, company || 'Fleet Operations')
  }

  const safe = (row.title || 'inspection').replace(/[^a-z0-9]/gi, '_').slice(0, 40)
  doc.save(`Inspection_${safe}.pdf`)
}

function _buildRecommendations(riskCounts, totalT, row) {
  const recs = []
  const tc = row.tyre_conditions || {}
  const critPos = [], warnPos = [], lowPsiPos = []
  Object.entries(tc).forEach(([pos, d]) => {
    const risk = typeof d === 'object'
      ? (d?.risk ?? COND_TO_RISK[d?.condition] ?? 'none')
      : (COND_TO_RISK[String(d)] ?? 'none')
    if (risk === 'critical') critPos.push(pos)
    if (risk === 'warning')  warnPos.push(pos)
    if (typeof d === 'object' && d?.pressure && Number(d.pressure) < 80) lowPsiPos.push(pos)
  })
  if (critPos.length)  recs.push({ urgent: true,  text: `IMMEDIATE: ${critPos.length} tyre(s) in critical condition at ${critPos.join(', ')} — remove vehicle from service until replaced.` })
  if (warnPos.length)  recs.push({ urgent: false, text: `Schedule replacement within 7 days for position(s) ${warnPos.join(', ')} showing abnormal wear or damage.` })
  if (lowPsiPos.length) recs.push({ urgent: true, text: `${lowPsiPos.length} tyre(s) below 80 PSI at ${lowPsiPos.join(', ')} — re-inflate to specification and inspect for slow leaks.` })
  if (row.severity === 'Critical' || row.severity === 'High') recs.push({ urgent: true, text: 'Escalate to Fleet Manager and issue corrective action work order before next deployment.' })
  if (!recs.length && totalT > 0) recs.push({ urgent: false, text: 'All positions checked. Maintain standard weekly pressure monitoring and monthly tread depth checks.' })
  return recs
}

// ── Daily Executive Operations Report PDF ─────────────────────────────────────
/**
 * @param {Object} data
 * @param {string} [filename]
 */
export function exportDailyExecutivePdf(data, filename) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const PW  = doc.internal.pageSize.width   // 297
  const PH  = doc.internal.pageSize.height  // 210

  const company   = data.company   || 'Fleet Operations'
  const date      = data.date      || nowStr()
  const period    = data.reportPeriod || 'Daily'
  const siteLabel = data.site      || 'All Sites'

  // landscape header/footer helpers
  function lsHeader(title, accentRgb = P.indigo) {
    doc.setFillColor(...P.slate)
    doc.rect(0, 0, PW, 22, 'F')
    doc.setFillColor(...accentRgb)
    doc.rect(0, 22, PW, 2.5, 'F')
    doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(...P.gold)
    doc.text(company.toUpperCase(), 14, 9)
    doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(...P.white)
    doc.text(title, 14, 18)
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...P.mist)
    doc.text(`${date}  ·  ${period}  ·  ${siteLabel}`, PW - 14, 15, { align: 'right' })
  }
  function lsFooter(page, total) {
    doc.setFillColor(...P.cloud)
    doc.rect(0, PH - 8, PW, 8, 'F')
    doc.setDrawColor(...P.silver); doc.setLineWidth(0.2)
    doc.line(0, PH - 8, PW, PH - 8)
    doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(...P.ghost)
    doc.text(`${company}  ·  Fleet Operations Report  ·  Confidential`, 14, PH - 3)
    doc.text(date, PW / 2, PH - 3, { align: 'center' })
    doc.text(`${page} / ${total}`, PW - 14, PH - 3, { align: 'right' })
  }

  // ── PAGE 1: COVER ──────────────────────────────────────────────────────────
  {
    // Deep navy background
    doc.setFillColor(...P.ink)
    doc.rect(0, 0, PW, PH, 'F')
    // Fine dot matrix
    doc.setFillColor(20, 28, 50)
    for (let x = 12; x < PW - 12; x += 16)
      for (let y = 12; y < PH - 12; y += 16)
        doc.circle(x, y, 0.3, 'F')
    // Accent diagonal shapes
    doc.setFillColor(...P.indigo)
    doc.triangle(0, PH * 0.52, 0, PH * 0.64, PW * 0.38, PH * 0.52, 'F')
    doc.setFillColor(79 * 0.5, 70 * 0.5, 229 * 0.5)
    doc.triangle(0, PH * 0.58, 0, PH * 0.72, PW * 0.30, PH * 0.58, 'F')

    // Company + title
    doc.setFontSize(9); doc.setFont('helvetica','bold')
    doc.setTextColor(...P.gold)
    doc.text(company.toUpperCase() + '  ·  FLEET OPERATIONS', 28, 44)
    doc.setFontSize(38); doc.setFont('helvetica','bold'); doc.setTextColor(...P.white)
    doc.text('Operations Report', 28, 76)
    doc.setFontSize(16); doc.setFont('helvetica','normal'); doc.setTextColor(...P.mist)
    doc.text(`${period} Intelligence Summary`, 28, 92)
    doc.setFontSize(11); doc.setTextColor(...P.ghost)
    doc.text(date + (data.generatedBy ? `  ·  Prepared by: ${data.generatedBy}` : ''), 28, 106)

    // Right-side KPI tiles
    const kpis = [
      { v: data.totalVehicles ?? 0, l: 'Vehicles',      rgb: P.indigo },
      { v: data.totalTyres ?? 0,    l: 'Tyres',         rgb: [...P.emerald] },
      { v: data.criticalTyres ?? 0, l: 'Critical',      rgb: [...P.crimson] },
      { v: data.openActions?.length ?? 0, l: 'Actions', rgb: [...P.gold] },
    ]
    kpis.forEach((k, i) => _kpiBox(doc, PW - 195 + i * 47, 30, 42, 38, k.v, k.l, null, k.rgb))
  }

  // ── PAGE 2: EXECUTIVE SUMMARY ──────────────────────────────────────────────
  doc.addPage()
  {
    lsHeader('Executive Summary', P.indigo)
    let y = 32

    const totalT = data.totalTyres || 1
    const activeV = data.activeVehicles ?? data.totalVehicles ?? 0
    const compPct = data.pressureCompliance ?? pct(data.goodTyres, totalT)
    const inspPct = pct(data.inspectionsCompleted, data.inspectionsScheduled)

    // KPI row 1
    const row1 = [
      { l: 'Total Vehicles',      v: data.totalVehicles ?? 0, sub: `${activeV} active`,           rgb: P.indigo },
      { l: 'Tyre Fleet',          v: data.totalTyres ?? 0,    sub: 'all positions',                rgb: [...P.emerald] },
      { l: 'Critical Tyres',      v: data.criticalTyres ?? 0, sub: `${pct(data.criticalTyres, totalT)}% of fleet`, rgb: [...P.crimson] },
      { l: 'Compliance',          v: `${compPct}%`,           sub: 'within spec',                  rgb: compPct < 70 ? [...P.crimson] : [...P.emerald] },
      { l: 'Inspections',         v: `${inspPct || 0}%`,      sub: `${data.inspectionsCompleted ?? 0} of ${data.inspectionsScheduled ?? 0}`, rgb: P.indigo },
      { l: 'Open Actions',        v: data.openActions?.length ?? 0, sub: 'pending resolution',     rgb: [...P.gold] },
    ]
    const cw = (PW - 28 - (row1.length - 1) * 4) / row1.length
    row1.forEach((k, i) => _kpiBox(doc, 14 + i * (cw + 4), y, cw, 34, k.v, k.l, k.sub, k.rgb))
    y += 40

    // Fleet condition bar
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
    doc.text('Fleet Tyre Condition Distribution', 14, y)
    y += 5
    const segments = [
      { v: data.goodTyres ?? 0,     rgb: P.emerald, label: 'Good'     },
      { v: data.warningTyres ?? 0,  rgb: P.scarlet, label: 'Warning'  },
      { v: data.criticalTyres ?? 0, rgb: P.crimson, label: 'Critical' },
    ]
    const barW = PW - 28, barH = 12
    let bx = 14
    segments.forEach(seg => {
      const sw = (seg.v / totalT) * barW
      if (sw <= 0) return
      doc.setFillColor(...seg.rgb)
      doc.rect(bx, y, sw, barH, 'F')
      if (sw > 20) {
        doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(...P.white)
        doc.text(`${seg.label} ${seg.v}`, bx + sw / 2, y + barH / 2 + 2, { align: 'center' })
      }
      bx += sw
    })
    doc.setDrawColor(...P.iron); doc.setLineWidth(0.3)
    doc.rect(14, y, barW, barH, 'S')
    y += barH + 6

    // Cost row
    const costKpis = [
      { l: 'Monthly Spend',   v: fmtCurr(data.monthlySpend),  rgb: data.monthlySpend > (data.monthlyBudget || Infinity) ? [...P.crimson] : [...P.emerald] },
      { l: 'YTD Spend',       v: fmtCurr(data.ytdSpend),      rgb: P.indigo },
      { l: 'Cost / km',       v: data.costPerKm ? `SAR ${data.costPerKm.toFixed(3)}` : '—', rgb: [...P.gold] },
      { l: 'Budget Variance', v: (data.monthlyBudget && data.monthlySpend) ? fmtCurr(Math.abs(data.monthlyBudget - data.monthlySpend)) : '—', rgb: [...P.emerald] },
      { l: 'Vehicles w/ Alerts', v: data.vehiclesWithAlerts ?? 0, rgb: [...P.scarlet] },
    ]
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
    doc.text('Financial & Fleet Snapshot', 14, y)
    y += 5
    const fcw = (PW - 28 - (costKpis.length - 1) * 4) / costKpis.length
    costKpis.forEach((k, i) => _kpiBox(doc, 14 + i * (fcw + 4), y, fcw, 30, k.v, k.l, null, k.rgb))
  }

  // ── PAGE 3: TYRE HEALTH + SITE MATRIX ─────────────────────────────────────
  doc.addPage()
  {
    lsHeader('Tyre Health & Site Analysis', [...P.violet])
    let y = 32

    // Top defects (left half)
    if (data.topDefects?.length) {
      doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
      doc.text('Defect Pattern Analysis', 14, y); y += 5
      const totalDef = data.topDefects.reduce((s, d) => s + d.count, 0)
      data.topDefects.slice(0, 7).forEach((d, i) => {
        const fraction = totalDef > 0 ? d.count / totalDef : 0
        const bw = 88, by = y + i * 13
        doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(...P.ghost)
        doc.text(d.type.slice(0, 28), 14, by + 4)
        doc.setFillColor(...P.cloud)
        doc.roundedRect(14 + 58, by, bw, 7, 1.5, 1.5, 'F')
        const accs = [[79,70,229],[153,27,27],[245,158,11],[4,120,87],[180,83,9],[109,40,217],[30,41,59]]
        const [r, g, b] = accs[i % accs.length]
        doc.setFillColor(r, g, b)
        if (fraction > 0) doc.roundedRect(14 + 58, by, Math.max(3, bw * fraction), 7, 1.5, 1.5, 'F')
        doc.setFontSize(7); doc.setTextColor(...P.ghost)
        doc.text(`${d.count} (${pct(d.count, totalDef)}%)`, 14 + 152, by + 5)
      })
    }

    // Site breakdown table (right half)
    if (data.siteBreakdown?.length) {
      doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
      doc.text('Site Performance Matrix', PW / 2 + 4, 32)
      autoTable(doc, {
        startY: 37,
        head: [['Site', 'Vehicles', 'Alerts', 'Compliance', 'Status']],
        body: data.siteBreakdown.map(s => [
          s.name, s.vehicles ?? '—', s.alerts ?? '—',
          s.compliance ? `${s.compliance}%` : '—',
          s.compliance >= 90 ? '✓ Good' : s.compliance >= 70 ? '⚠ Monitor' : '✗ Action',
        ]),
        margin: { left: PW / 2 + 4, right: 14 },
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: P.steel, textColor: P.white, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: P.cloud },
        didParseCell: (d) => {
          if (d.section === 'body' && d.column.index === 4) {
            const v = String(d.cell.raw)
            if (v.includes('Action'))  { d.cell.styles.fillColor = P.rCream; d.cell.styles.textColor = P.crimson; d.cell.styles.fontStyle = 'bold' }
            else if (v.includes('Monitor')) { d.cell.styles.fillColor = P.oCream; d.cell.styles.textColor = P.scarlet }
            else { d.cell.styles.fillColor = P.eCream; d.cell.styles.textColor = P.emerald }
          }
        },
      })
    }
  }

  // ── PAGE 4: INSPECTIONS + ALERTS ──────────────────────────────────────────
  doc.addPage()
  {
    lsHeader('Inspections & Critical Alerts', [...P.crimson])
    let y = 32

    // Inspection KPIs
    const iKpis = [
      { l: 'Scheduled',      v: data.inspectionsScheduled ?? 0,  rgb: P.indigo },
      { l: 'Completed',      v: data.inspectionsCompleted ?? 0,  rgb: [...P.emerald] },
      { l: 'Defects Found',  v: data.defectsFound ?? 0,          rgb: [...P.crimson] },
      { l: 'Completion %',   v: `${pct(data.inspectionsCompleted, data.inspectionsScheduled)}%`, rgb: [...P.gold] },
    ]
    const ikw = (PW * 0.45 - 14 - 3 * 4) / 4
    iKpis.forEach((k, i) => _kpiBox(doc, 14 + i * (ikw + 4), y, ikw, 30, k.v, k.l, null, k.rgb))
    y += 36

    // Alerts table (left)
    const alerts = data.criticalAlerts ?? []
    if (alerts.length > 0) {
      doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
      doc.text(`Critical Alerts (${alerts.length})`, 14, y)
      autoTable(doc, {
        startY: y + 4,
        head: [['#', 'Alert', 'Asset', 'Site', 'Severity']],
        body: alerts.slice(0, 12).map((a, i) => [i + 1, a.message, a.asset ?? '—', a.site ?? '—', a.severity ?? 'High']),
        margin: { left: 14, right: PW / 2 + 2 },
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: P.crimson, textColor: P.white, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: P.rCream },
        columnStyles: { 0: { cellWidth: 8 }, 4: { cellWidth: 20 } },
      })
    }

    // Actions table (right)
    const actions = data.openActions ?? []
    if (actions.length > 0) {
      doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
      doc.text(`Open Actions (${actions.length})`, PW / 2 + 4, y)
      autoTable(doc, {
        startY: y + 4,
        head: [['Action', 'Priority', 'Site', 'Assignee']],
        body: actions.slice(0, 12).map(a => [a.title, a.priority ?? 'Medium', a.site ?? '—', a.assignee ?? 'Unassigned']),
        margin: { left: PW / 2 + 4, right: 14 },
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: P.steel, textColor: P.white, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: P.cloud },
        columnStyles: { 1: { cellWidth: 22 } },
        didParseCell: (d) => {
          if (d.section === 'body' && d.column.index === 1) {
            const v = String(d.cell.raw).toLowerCase()
            if (v === 'critical' || v === 'high') { d.cell.styles.fillColor = P.rCream; d.cell.styles.textColor = P.crimson; d.cell.styles.fontStyle = 'bold' }
            else if (v === 'medium') { d.cell.styles.fillColor = P.oCream; d.cell.styles.textColor = P.scarlet }
          }
        },
      })
    }
  }

  // ── PAGE 5: STRATEGIC INSIGHTS + RECOMMENDATIONS ──────────────────────────
  doc.addPage()
  {
    // Full dark cover for this page
    doc.setFillColor(...P.slate)
    doc.rect(0, 0, PW, PH, 'F')
    doc.setFillColor(...P.ink)
    doc.rect(0, 0, PW, 24, 'F')
    doc.setFillColor(...P.indigo)
    doc.rect(0, 24, PW, 2.5, 'F')
    doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(...P.gold)
    doc.text(company.toUpperCase(), 14, 9)
    doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(...P.white)
    doc.text('Strategic Insights & Recommended Actions', 14, 18)
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...P.mist)
    doc.text(date, PW - 14, 15, { align: 'right' })

    // Insights (left)
    const insights = data.insights ?? []
    if (insights.length > 0) {
      let iy = 36
      doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...P.gold)
      doc.text('OPERATIONAL INTELLIGENCE', 14, iy); iy += 8
      insights.forEach((ins, i) => {
        if (iy > PH - 16) return
        doc.setFillColor(79, 70, 229, 0.12)
        doc.setDrawColor(...P.indigo)
        doc.setLineWidth(0.3)
        const ilines = doc.splitTextToSize(ins, PW / 2 - 36)
        const ih = ilines.length * 4.5 + 10
        doc.roundedRect(14, iy - 3, PW / 2 - 22, ih, 2, 2, 'FD')
        doc.setFillColor(...P.indigo)
        doc.roundedRect(14, iy - 3, 3, ih, 1.5, 1.5, 'F')
        doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(200, 210, 255)
        doc.text(ilines, 20, iy + 3)
        iy += ih + 5
      })
    }

    // Recommendations (right)
    const recs = data.recommendations ?? []
    if (recs.length > 0) {
      let ry = 36
      doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(...P.gold)
      doc.text('PRIORITY ACTION PLAN', PW / 2 + 10, ry); ry += 8
      const priColors = { Critical: P.crimson, High: P.scarlet, Medium: P.ochre, Low: P.emerald }
      recs.forEach(rec => {
        if (ry > PH - 16) return
        const priRgb = priColors[rec.priority] ?? P.indigo
        const [r, g, b] = priRgb
        const rlines = doc.splitTextToSize(rec.text, PW / 2 - 40)
        const rh = rlines.length * 4.5 + 12
        doc.setFillColor(r * 0.1, g * 0.1, b * 0.1)
        doc.setDrawColor(r * 0.5, g * 0.5, b * 0.5)
        doc.setLineWidth(0.3)
        doc.roundedRect(PW / 2 + 10, ry - 3, PW / 2 - 24, rh, 2, 2, 'FD')
        // Priority pill
        doc.setFillColor(r, g, b)
        doc.roundedRect(PW / 2 + 12, ry - 1, 26, 6, 1, 1, 'F')
        doc.setFontSize(6); doc.setFont('helvetica','bold'); doc.setTextColor(...P.white)
        doc.text((rec.priority ?? 'Medium').toUpperCase(), PW / 2 + 25, ry + 3.5, { align: 'center' })
        doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(210, 218, 240)
        doc.text(rlines, PW / 2 + 42, ry + 3)
        ry += rh + 5
      })
    }
  }

  // All footers
  const total = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    lsFooter(p, total)
  }

  const safeF = filename || `Operations_Report_${date.replace(/\s/g, '_')}`
  doc.save(`${safeF}.pdf`)
}

// ── PowerPoint Export (Enhanced, no AI branding) ──────────────────────────────
export async function exportToPptx(data, filename = 'Operations_Report') {
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'

  const DARK   = '080C1C'
  const SLATE  = '0F1730'
  const STEEL  = '1E2940'
  const INDIGO = '4F46E5'
  const VIOLET = '6D28D9'
  const GOLD   = 'F59E0B'
  const WHITE  = 'FFFFFF'
  const MIST   = '94A3B8'
  const GHOST  = '64748B'
  const CRIM   = '991B1B'
  const SCAR   = 'C2410C'
  const EMER   = '065F46'
  const company = data.company || 'Fleet Operations'

  function header(slide, title, accent = INDIGO) {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.1, fill: { color: SLATE } })
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.1, w: 13.33, h: 0.06, fill: { color: accent } })
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 1.1, fill: { color: accent } })
    slide.addText(company.toUpperCase(), { x: 0.2, y: 0.08, w: 10, h: 0.32, fontSize: 9, bold: true, color: GOLD, fontFace: 'Arial' })
    slide.addText(title, { x: 0.2, y: 0.38, w: 10, h: 0.6, fontSize: 18, bold: true, color: WHITE, fontFace: 'Arial' })
    slide.addText(nowStr(), { x: 11.0, y: 0.4, w: 2.2, h: 0.4, fontSize: 9, color: GHOST, align: 'right', fontFace: 'Arial' })
  }
  function kpiTile(slide, x, y, w, label, value, color) {
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 1.4, fill: { color: STEEL }, line: { color, width: 1 }, rounding: true })
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.07, fill: { color } })
    slide.addText(String(value ?? '—'), { x, y: y + 0.12, w, h: 0.7, fontSize: 26, bold: true, color, align: 'center', fontFace: 'Arial' })
    slide.addText(label, { x, y: y + 0.85, w, h: 0.45, fontSize: 10, color: MIST, align: 'center', fontFace: 'Arial' })
  }

  // Slide 1: Cover
  const s1 = pptx.addSlide()
  s1.background = { color: DARK }
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.09, h: 7.5, fill: { color: INDIGO } })
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 7.41, w: 13.33, h: 0.09, fill: { color: INDIGO } })
  s1.addText(company.toUpperCase() + '  ·  FLEET OPERATIONS', { x: 0.5, y: 1.0, w: 9, h: 0.5, fontSize: 11, bold: true, color: GOLD, fontFace: 'Arial' })
  s1.addText('Operations Report', { x: 0.5, y: 1.6, w: 9, h: 1.5, fontSize: 44, bold: true, color: WHITE, fontFace: 'Arial' })
  s1.addText(data.period ?? 'Management Summary', { x: 0.5, y: 3.2, w: 9, h: 0.7, fontSize: 18, color: MIST, fontFace: 'Arial' })
  s1.addText(`Report Date: ${nowStr()}`, { x: 0.5, y: 6.7, w: 9, h: 0.4, fontSize: 10, color: GHOST, fontFace: 'Arial' })

  const coverKpis = [
    { l: 'Vehicles', v: data.totalVehicles ?? 0, c: INDIGO },
    { l: 'Tyres',    v: data.totalTyres ?? 0,    c: EMER },
    { l: 'Critical', v: data.highRisk ?? 0,       c: CRIM },
    { l: 'Actions',  v: typeof data.openActions === 'number' ? data.openActions : data.openActions?.length ?? 0, c: GOLD },
  ]
  coverKpis.forEach((k, i) => kpiTile(s1, 9.8, 0.8 + i * 1.6, 3.1, k.l, k.v, k.c))

  // Slide 2: KPIs
  const s2 = pptx.addSlide()
  s2.background = { color: DARK }
  header(s2, 'Executive KPI Summary', INDIGO)
  const kpis2 = [
    { l: 'Total Tyres',   v: data.totalTyres?.toLocaleString() ?? '0',  c: INDIGO },
    { l: 'Total Cost',    v: fmtCurr(data.totalCost),                    c: VIOLET },
    { l: 'High Risk',     v: data.highRisk?.toLocaleString() ?? '0',     c: CRIM },
    { l: 'Open Actions',  v: String(typeof data.openActions === 'number' ? data.openActions : data.openActions?.length ?? 0), c: GOLD },
  ]
  kpis2.forEach((k, i) => kpiTile(s2, 0.3 + i * 3.2, 1.3, 3.0, k.l, k.v, k.c))

  const totalT2 = data.totalTyres || 1
  const critPct = pct(data.highRisk, totalT2)
  s2.addText('Fleet Condition', { x: 0.4, y: 3.1, w: 12, h: 0.45, fontSize: 14, bold: true, color: WHITE, fontFace: 'Arial' })
  s2.addShape(pptx.ShapeType.rect, { x: 0.4, y: 3.6, w: 12.5, h: 0.4, fill: { color: '374151' }, rounding: true })
  if (100 - critPct > 0) s2.addShape(pptx.ShapeType.rect, { x: 0.4, y: 3.6, w: 12.5 * ((100 - critPct) / 100), h: 0.4, fill: { color: EMER }, rounding: true })
  if (critPct > 0) s2.addShape(pptx.ShapeType.rect, { x: 0.4 + 12.5 * ((100 - critPct) / 100), y: 3.6, w: 12.5 * (critPct / 100), h: 0.4, fill: { color: CRIM } })

  // Slide 3: Top Sites
  if (data.topSites?.length) {
    const s3 = pptx.addSlide()
    s3.background = { color: DARK }
    header(s3, 'Top Sites by Consumption', INDIGO)
    const rows3 = data.topSites.slice(0, 12).map((s, i) => [
      { text: String(i + 1), options: { color: GHOST, fontSize: 11 } },
      { text: s.site, options: { color: WHITE, fontSize: 11, bold: i < 3 } },
      { text: String(s.count), options: { color: i === 0 ? GOLD : WHITE, fontSize: 11, bold: i < 3, align: 'right' } },
    ])
    s3.addTable(
      [[{ text: '#', options: { bold: true, color: WHITE, fill: STEEL } }, { text: 'Site', options: { bold: true, color: WHITE, fill: STEEL } }, { text: 'Tyres', options: { bold: true, color: WHITE, fill: STEEL, align: 'right' } }], ...rows3],
      { x: 0.5, y: 1.3, w: 7, colW: [0.5, 5, 1.5], border: { type: 'none' }, fill: '111827', fontSize: 11 }
    )
    const maxSite = Math.max(...data.topSites.map(s => s.count), 1)
    data.topSites.slice(0, 8).forEach((s, i) => {
      const bh = (s.count / maxSite) * 4.2
      const bx = 8.1 + i * 0.62
      s3.addShape(pptx.ShapeType.rect, { x: bx, y: 5.3 - bh, w: 0.48, h: bh, fill: { color: i === 0 ? GOLD : INDIGO }, rounding: true })
      s3.addText(String(s.count), { x: bx - 0.05, y: 5.3 - bh - 0.32, w: 0.6, h: 0.3, fontSize: 8, color: WHITE, align: 'center', fontFace: 'Arial' })
      s3.addText(s.site.split(' ')[0], { x: bx - 0.1, y: 5.3, w: 0.7, h: 0.4, fontSize: 7, color: GHOST, align: 'center', fontFace: 'Arial' })
    })
  }

  // Slide 4: Risk Breakdown
  if (data.riskBreakdown?.length) {
    const s4 = pptx.addSlide()
    s4.background = { color: DARK }
    header(s4, 'Risk Level Breakdown', CRIM)
    const total4 = data.riskBreakdown.reduce((s, r) => s + r.count, 0)
    const rColors = { Critical: CRIM, High: SCAR, Medium: GOLD, Low: EMER }
    let ry = 1.4
    data.riskBreakdown.forEach(r => {
      const pctV = total4 > 0 ? r.count / total4 : 0
      const col  = rColors[r.level] ?? GHOST
      s4.addText(r.level, { x: 0.5, y: ry, w: 2.2, h: 0.38, fontSize: 13, color: col, fontFace: 'Arial' })
      s4.addText(`${Math.round(pctV * 100)}%`, { x: 2.8, y: ry, w: 1, h: 0.38, fontSize: 11, color: GHOST, align: 'right', fontFace: 'Arial' })
      s4.addShape(pptx.ShapeType.rect, { x: 3.9, y: ry + 0.05, w: 5.5, h: 0.28, fill: { color: '374151' } })
      if (pctV > 0) s4.addShape(pptx.ShapeType.rect, { x: 3.9, y: ry + 0.05, w: Math.max(0.05, 5.5 * pctV), h: 0.28, fill: { color: col } })
      s4.addText(String(r.count), { x: 9.6, y: ry, w: 1, h: 0.38, fontSize: 13, color: WHITE, align: 'right', fontFace: 'Arial' })
      ry += 0.65
    })
  }

  // Slide 5: Monthly Trend
  if (data.monthlyTrend?.length) {
    const s5 = pptx.addSlide()
    s5.background = { color: DARK }
    header(s5, 'Monthly Consumption Trend', VIOLET)
    const maxV = Math.max(...data.monthlyTrend.map(m => m.count), 1)
    const cH = 4.0, cY = 1.5, cX = 0.4
    const bW = 12.5 / data.monthlyTrend.length * 0.66
    const gap = 12.5 / data.monthlyTrend.length * 0.34
    data.monthlyTrend.forEach((m, i) => {
      const bH = Math.max(0.04, (m.count / maxV) * cH)
      const x  = cX + i * (bW + gap)
      const y  = cY + (cH - bH)
      s5.addShape(pptx.ShapeType.rect, { x, y, w: bW, h: bH, fill: { color: i === data.monthlyTrend.length - 1 ? GOLD : INDIGO }, rounding: true })
      s5.addText(String(m.count), { x: x - 0.05, y: y - 0.32, w: bW + 0.1, h: 0.3, fontSize: 9, color: WHITE, align: 'center', fontFace: 'Arial' })
      s5.addText(m.month, { x: x - 0.1, y: cY + cH + 0.08, w: bW + 0.2, h: 0.35, fontSize: 9, color: GHOST, align: 'center', fontFace: 'Arial' })
    })
    // Average trend line
    const avg = data.monthlyTrend.reduce((s, m) => s + m.count, 0) / data.monthlyTrend.length
    const avgY = cY + cH - (avg / maxV) * cH
    s5.addShape(pptx.ShapeType.line, { x: cX, y: avgY, w: 12.5, h: 0, line: { color: GOLD, width: 1.2, dashType: 'dash' } })
    s5.addText(`Avg ${Math.round(avg)}`, { x: 9.5, y: avgY - 0.3, w: 2, h: 0.3, fontSize: 9, color: GOLD, fontFace: 'Arial' })
  }

  // Slide 6: Open Actions + Brands
  {
    const s6 = pptx.addSlide()
    s6.background = { color: DARK }
    header(s6, 'Open Actions & Brand Performance', SCAR)
    if (data.recentActions?.length) {
      const rows6 = data.recentActions.slice(0, 10).map(a => {
        const priColor = { Critical: CRIM, High: SCAR, Medium: GOLD, Low: EMER }[a.priority] ?? WHITE
        return [
          { text: a.title, options: { color: WHITE, fontSize: 9 } },
          { text: a.site ?? '—', options: { color: GHOST, fontSize: 9 } },
          { text: a.priority ?? '—', options: { color: priColor, fontSize: 9, bold: true } },
          { text: a.status ?? '—', options: { color: GHOST, fontSize: 9 } },
        ]
      })
      s6.addTable(
        [[{ text: 'Title', options: { bold: true, color: WHITE, fill: STEEL } }, { text: 'Site', options: { bold: true, color: WHITE, fill: STEEL } }, { text: 'Priority', options: { bold: true, color: WHITE, fill: STEEL } }, { text: 'Status', options: { bold: true, color: WHITE, fill: STEEL } }], ...rows6],
        { x: 0.4, y: 1.3, w: 7.5, colW: [3.8, 1.5, 1.2, 1.0], border: { type: 'none' }, fill: '111827', fontSize: 9 }
      )
    }
    if (data.topBrands?.length) {
      const maxBrand = Math.max(...data.topBrands.map(b => b.count), 1)
      s6.addText('Brand Performance', { x: 8.2, y: 1.3, w: 5, h: 0.4, fontSize: 12, bold: true, color: WHITE, fontFace: 'Arial' })
      data.topBrands.slice(0, 8).forEach((b, i) => {
        const bx = 8.2, by = 1.8 + i * 0.64
        s6.addText(b.brand.slice(0, 14), { x: bx, y: by, w: 2.0, h: 0.5, fontSize: 10, color: WHITE, fontFace: 'Arial' })
        s6.addShape(pptx.ShapeType.rect, { x: bx + 2.1, y: by + 0.08, w: 3.8, h: 0.32, fill: { color: '374151' } })
        const bw = 3.8 * (b.count / maxBrand)
        if (bw > 0) s6.addShape(pptx.ShapeType.rect, { x: bx + 2.1, y: by + 0.08, w: bw, h: 0.32, fill: { color: INDIGO } })
        s6.addText(String(b.count), { x: bx + 6.2, y: by, w: 0.8, h: 0.5, fontSize: 10, color: GHOST, align: 'right', fontFace: 'Arial' })
      })
    }
  }

  // Slide 7: Insights & Recommendations
  if (data.insights?.length || data.recommendations?.length) {
    const s7 = pptx.addSlide()
    s7.background = { color: DARK }
    header(s7, 'Operational Insights & Actions', INDIGO)
    if (data.insights?.length) {
      s7.addText('INTELLIGENCE', { x: 0.4, y: 1.3, w: 6, h: 0.4, fontSize: 11, bold: true, color: GOLD, fontFace: 'Arial' })
      data.insights.slice(0, 4).forEach((ins, i) => {
        s7.addShape(pptx.ShapeType.rect, { x: 0.4, y: 1.8 + i * 1.1, w: 6, h: 0.95, fill: { color: '1E2940' }, line: { color: INDIGO, width: 0.5 }, rounding: true })
        s7.addShape(pptx.ShapeType.rect, { x: 0.4, y: 1.8 + i * 1.1, w: 0.05, h: 0.95, fill: { color: INDIGO } })
        s7.addText(ins, { x: 0.6, y: 1.85 + i * 1.1, w: 5.6, h: 0.85, fontSize: 9.5, color: 'C7D2FE', wrap: true, fontFace: 'Arial' })
      })
    }
    if (data.recommendations?.length) {
      const priCol = { Critical: CRIM, High: SCAR, Medium: GOLD, Low: EMER }
      s7.addText('ACTION PLAN', { x: 7.0, y: 1.3, w: 6, h: 0.4, fontSize: 11, bold: true, color: GOLD, fontFace: 'Arial' })
      data.recommendations.slice(0, 4).forEach((rec, i) => {
        const col = priCol[rec.priority] ?? INDIGO
        s7.addShape(pptx.ShapeType.rect, { x: 7.0, y: 1.8 + i * 1.1, w: 6.0, h: 0.95, fill: { color: '1E2940' }, line: { color: col, width: 0.5 }, rounding: true })
        s7.addText((rec.priority ?? 'Medium').toUpperCase(), { x: 7.05, y: 1.82 + i * 1.1, w: 1.1, h: 0.28, fontSize: 7, bold: true, color: col, fontFace: 'Arial' })
        s7.addText(rec.text, { x: 7.05, y: 2.05 + i * 1.1, w: 5.8, h: 0.62, fontSize: 9, color: 'BFDBFE', wrap: true, fontFace: 'Arial' })
      })
    }
  }

  await pptx.writeFile({ fileName: `${filename}.pptx` })
}

