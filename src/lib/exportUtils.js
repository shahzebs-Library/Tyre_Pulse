import { formatCurrencyCompact, formatDate } from './formatters.js'

// ── Lazy-loaded heavy libraries ────────────────────────────────────────────────
// xlsx (~420 KB), jspdf (~400 KB) and pptxgenjs (~385 KB) must never ship with a
// page's initial chunk - they load on the first export click and are then
// memoised. Module-level bindings keep every internal helper working unchanged;
// each public export awaits the loader for the engine(s) it needs.
let XLSX, jsPDF, autoTable, pptxgen

async function ensureXlsx() {
  if (!XLSX) XLSX = await import('xlsx')
  return XLSX
}
async function ensurePdf() {
  if (!jsPDF) {
    const [j, a] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    jsPDF = j.default
    autoTable = a.default
  }
  return { jsPDF, autoTable }
}
async function ensurePptx() {
  if (!pptxgen) pptxgen = (await import('pptxgenjs')).default
  return pptxgen
}

// ── Brand palette - deep slate + indigo + gold (no green/AI references) ────────
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

  // Status - rich, not neon
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

// ── Tenant branding helpers ──────────────────────────────────────────────────
// Reports accept an optional `branding` object (from TenantContext / V68):
// { primary_color, secondary_color, accent_color, logo_url, footer_text,
//   disclaimer, report_theme }. These helpers normalise it safely so a missing
// or malformed value always falls back to the default design — branding can
// never break report generation.

/** Normalise a #RRGGBB brand colour to a bare 6-hex string (for pptx/jsPDF). */
function brandHex(hex, fallback) {
  if (typeof hex === 'string' && /^#?[0-9A-Fa-f]{6}$/.test(hex.trim())) {
    return hex.trim().replace(/^#/, '').toUpperCase()
  }
  return fallback
}

/** Hex → [r,g,b] for jsPDF setFillColor/setTextColor; falls back to a palette. */
function hexToRgb(hex, fallback = [79, 70, 229]) {
  const h = brandHex(hex, null)
  if (!h) return fallback
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/**
 * Fetch an image URL to a base64 data URI. Returns null on any failure (network,
 * CORS, non-image, oversized) so a missing/blocked tenant logo never aborts a
 * report. Guarded to ≤2 MB.
 */
async function fetchImageDataUri(url) {
  if (!url || typeof url !== 'string') return null
  if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return null
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith('image/') || blob.size > 2_000_000) return null
    return await new Promise((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch { return null }
}

// ── Executive intelligence derivation (business meaning, not raw data) ───────────
// These convert the report data object into narrative, business insights, and a
// forward-looking outlook so every report leads with decisions, not tables.
function _deriveNarrative(data) {
  const totalT = data.totalTyres || 0
  const crit   = data.criticalTyres || 0
  const warn   = data.warningTyres || 0
  const good   = data.goodTyres || 0
  const comp   = data.pressureCompliance ?? (totalT ? Math.round((good / totalT) * 100) : 0)
  const critShare = totalT ? Math.round((crit / totalT) * 100) : 0
  const actions   = data.openActions?.length || 0
  const highAct   = (data.openActions || []).filter(a => /crit|high/i.test(a.priority || '')).length
  const vAlert    = data.vehiclesWithAlerts || 0
  const vTotal    = data.totalVehicles || 0
  const spend     = data.monthlySpend || 0
  const insp      = pct(data.inspectionsCompleted, data.inspectionsScheduled)

  const tone   = (critShare >= 15 || comp < 70) ? 'crit'
               : (critShare >= 5  || comp < 85) ? 'warn' : 'good'
  const status = tone === 'crit' ? 'Requires Immediate Attention'
               : tone === 'warn' ? 'Stable - Monitoring Advised'
               : 'Healthy - Within Target'

  const p1 = `The fleet ${tone === 'crit' ? 'requires immediate attention' : tone === 'warn' ? 'is stable but warrants close monitoring' : 'is healthy and operating within target parameters'}. `
    + `Of ${totalT.toLocaleString()} monitored tyre records, ${good.toLocaleString()} (${comp}%) sit within safe operating limits, `
    + `while ${crit.toLocaleString()} (${critShare}%) are classified critical and ${warn.toLocaleString()} show elevated wear. `
    + (vTotal ? `${vAlert} of ${vTotal} vehicles currently carry one or more active alerts.` : '')

  const money = spend > 0
    ? ` Tyre spend for the period totals ${fmtCurr(spend)}${data.ytdSpend ? `, with ${fmtCurr(data.ytdSpend)} year to date` : ''}.`
    : ''
  const p2 = `${actions} corrective action${actions === 1 ? '' : 's'} ${actions === 1 ? 'is' : 'are'} open`
    + `${highAct ? `, including ${highAct} high priority` : ''}.`
    + money
    + ` Inspection completion stands at ${insp || 0}%.`

  const action = crit > 0
    ? `Replace ${crit} critical tyre${crit === 1 ? '' : 's'} before next deployment and resolve ${highAct} high-priority action${highAct === 1 ? '' : 's'}.`
    : comp < 85
      ? `Raise pressure and tread compliance from ${comp}% toward the 90% target through scheduled inspections.`
      : `Sustain the preventive inspection cadence to hold compliance above 90%.`

  return { status, tone, paragraphs: [p1, p2], action }
}

function _deriveBusinessInsights(data) {
  const out = []
  const sites = data.siteBreakdown || []
  if (sites.length) {
    const worst = [...sites].sort((a, b) => (b.alerts || 0) - (a.alerts || 0))[0]
    if (worst && (worst.alerts || 0) > 0)
      out.push({ label: 'Highest-Risk Site', value: worst.name, sub: `${worst.alerts} alerts · ${worst.compliance ?? 0}% compliant`, tone: 'crit' })
    const best = [...sites].filter(s => s.compliance != null).sort((a, b) => (b.compliance || 0) - (a.compliance || 0))[0]
    if (best) out.push({ label: 'Most Reliable Site', value: best.name, sub: `${best.compliance}% compliance`, tone: 'good' })
  }
  const defs = data.topDefects || []
  if (defs.length) out.push({ label: 'Top Defect Pattern', value: String(defs[0].type).slice(0, 24), sub: `${defs[0].count} occurrences`, tone: 'warn' })
  const totalT = data.totalTyres || 1
  if ((data.criticalTyres || 0) > 0)
    out.push({ label: 'Critical Exposure', value: `${data.criticalTyres} tyres`, sub: `${Math.round((data.criticalTyres / totalT) * 100)}% of fleet`, tone: 'crit' })
  if ((data.monthlySpend || 0) > 0)
    out.push({ label: 'Period Tyre Spend', value: fmtCurr(data.monthlySpend), sub: data.ytdSpend ? `${fmtCurr(data.ytdSpend)} YTD` : 'current period', tone: 'info' })
  const acts = data.openActions || []
  if (acts.length) {
    const hi = acts.filter(a => /crit|high/i.test(a.priority || '')).length
    out.push({ label: 'Action Backlog', value: `${acts.length} open`, sub: hi ? `${hi} high priority` : 'all routine', tone: hi ? 'warn' : 'info' })
  }
  return out.slice(0, 6)
}

function _deriveForecast(data) {
  const out = []
  const ytd = data.ytdSpend || 0
  const monthIdx = (new Date()).getMonth() + 1
  if (ytd > 0) {
    const runRate = ytd / monthIdx
    out.push({ label: 'Next-Month Spend', value: fmtCurr(runRate), conf: 'Medium', note: 'YTD run-rate' })
    out.push({ label: 'Projected Annual', value: fmtCurr(runRate * 12), conf: 'Medium', note: 'Linear extrapolation' })
  } else if ((data.monthlySpend || 0) > 0) {
    out.push({ label: 'Projected Annual', value: fmtCurr(data.monthlySpend * 12), conf: 'Low', note: 'From current month' })
  }
  const repl = (data.criticalTyres || 0) + Math.round((data.warningTyres || 0) * 0.5)
  if (repl > 0) out.push({ label: 'Replacements Due', value: `~${repl} tyres`, conf: 'High', note: 'Critical + 50% high-risk' })
  const comp = data.pressureCompliance ?? 0
  out.push({ label: 'Compliance Outlook', value: comp < 85 ? 'Below target' : 'On target', conf: 'Medium', note: `Currently ${comp}%` })
  return out.slice(0, 4)
}

const _TONE_RGB = { crit: P.crimson, warn: P.scarlet, good: P.emerald, info: P.indigo }

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
// Design system: clean corporate light theme. 14 mm side margins, header band
// ends at 23 mm (content starts >= 28 mm), footer rule at page-height − 10 mm.
// opts (all optional, backward-compatible): { accent:[r,g,b], logoData, footerText }
const MX = 14              // global side margin (mm)
const HEADER_BOTTOM = 23   // header band ends here; content starts at >= 28
const FOOTER_SPACE = 12    // keep-clear zone above the page bottom
const SECTION_MIN_SPACE = 25 // never start a section within 25 mm of page end

function _pageHeader(doc, title, subtitle, company = '', opts = {}) {
  const pw = doc.internal.pageSize.width
  const accent = opts.accent || P.indigo
  const hasLogo = !!opts.logoData
  const tx = hasLogo ? 33 : MX   // shift text right when a logo is present

  // Clean corporate band: brand accent bar + white field + hairline base rule
  doc.setFillColor(...P.white)
  doc.rect(0, 0, pw, HEADER_BOTTOM, 'F')
  doc.setFillColor(...accent)
  doc.rect(0, 0, pw, 2.5, 'F')

  // Tenant logo (best-effort)
  if (hasLogo) {
    const fmt = /image\/jpe?g/i.test(opts.logoData) ? 'JPEG' : 'PNG'
    try { doc.addImage(opts.logoData, fmt, MX, 5.5, 14, 14, undefined, 'FAST') } catch { /* ignore */ }
  }

  // Company name - small uppercase eyebrow
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...P.ghost)
  doc.text((company || 'FLEET OPERATIONS').toUpperCase(), tx, 9, { charSpace: 0.5 })

  // Report title - large bold ink
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...P.ink)
  doc.text(title, tx, 17)

  // Period/subtitle + generated date - right column
  if (subtitle) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...P.iron)
    doc.text(subtitle, pw - MX, 10, { align: 'right' })
  }
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...P.mist)
  doc.text(`Generated ${nowStr()}`, pw - MX, subtitle ? 15.5 : 12, { align: 'right' })

  // Short accent underline beneath the title + full-width hairline base rule
  doc.setDrawColor(...accent)
  doc.setLineWidth(0.9)
  doc.line(tx, 20.2, tx + 26, 20.2)
  doc.setDrawColor(...P.silver)
  doc.setLineWidth(0.25)
  doc.line(0, HEADER_BOTTOM, pw, HEADER_BOTTOM)
}

function _pageFooter(doc, page, total, company = '', opts = {}) {
  const pw = doc.internal.pageSize.width
  const ph = doc.internal.pageSize.height
  // Thin top rule only - no filled band
  doc.setDrawColor(...P.silver)
  doc.setLineWidth(0.25)
  doc.line(MX, ph - 10, pw - MX, ph - 10)
  doc.setFontSize(6.8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...P.ghost)
  const left = opts.footerText || `${company || 'Fleet Operations Report'}  ·  Confidential — for internal distribution only`
  doc.text(left, MX, ph - 5.5)
  doc.text(total ? `Page ${page} of ${total}` : `Page ${page}`, pw - MX, ph - 5.5, { align: 'right' })
}

// Resolve a tenant-branding object into PDF drawing inputs (accent rgb + logo
// data URI + footer text). Safe: returns defaults when branding is absent.
async function _pdfBrand(branding) {
  const b = branding || {}
  return {
    accent: hexToRgb(b.primary_color, P.indigo),
    logoData: await fetchImageDataUri(b.logo_url),
    footerText: b.footer_text || null,
    disclaimer: b.disclaimer || null,
  }
}

// A professional, centred "no data" panel so an empty dataset never renders as a
// bare table. Draws within the current page under the header.
function _emptyStatePanel(doc, message, sub) {
  const pw = doc.internal.pageSize.width
  const ph = doc.internal.pageSize.height
  const cy = ph / 2 - 6
  // Soft panel
  doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver); doc.setLineWidth(0.3)
  doc.roundedRect(pw / 2 - 70, cy - 16, 140, 34, 3, 3, 'FD')
  // Icon dot
  doc.setFillColor(...P.silver); doc.circle(pw / 2, cy - 6, 3, 'F')
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.steel)
  doc.text(message || 'No records for this period', pw / 2, cy + 3, { align: 'center' })
  if (sub) {
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
    doc.text(sub, pw / 2, cy + 10, { align: 'center' })
  }
}

// Section heading: 12.5 pt bold ink with a short accent underline + hairline
// rule across the content width. Same geometry contract as before (returns
// the y where section content should begin).
function _sectionBar(doc, title, y, mx = MX, accent = P.indigo) {
  const pw = doc.internal.pageSize.width
  doc.setFontSize(12.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...P.ink)
  doc.text(String(title), mx, y + 2)
  // Thin accent underline beneath the heading, extended by a light hairline
  doc.setDrawColor(...accent)
  doc.setLineWidth(0.8)
  doc.line(mx, y + 4.4, mx + 18, y + 4.4)
  doc.setDrawColor(...P.silver)
  doc.setLineWidth(0.25)
  doc.line(mx + 18, y + 4.4, pw - mx, y + 4.4)
  return y + 9
}

// KPI stat tile: light gray fill, thin border, left accent bar, big number,
// small uppercase label. Value size adapts so long currency strings fit.
function _kpiBox(doc, x, y, w, h, value, label, subtext, accentRgb) {
  const [r, g, b] = accentRgb
  const v = String(value ?? '-')
  // Card background - very light gray with a thin neutral border
  doc.setFillColor(...P.offWhite)
  doc.setDrawColor(...P.silver)
  doc.setLineWidth(0.3)
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD')
  // Left accent bar
  doc.setFillColor(r, g, b)
  doc.roundedRect(x, y, 1.4, h, 0.7, 0.7, 'F')
  // Label - small uppercase, top
  doc.setFontSize(6.3)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...P.ghost)
  doc.text(String(label ?? '').toUpperCase(), x + 5, y + 6.5, { charSpace: 0.4 })
  // Value - big bold number in a deepened accent tone; shrink to fit width
  const vSize = v.length > 14 ? 10.5 : v.length > 10 ? 12.5 : v.length > 7 ? 15 : 18
  doc.setFontSize(vSize)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(Math.round(r * 0.72), Math.round(g * 0.72), Math.round(b * 0.72))
  doc.text(v, x + 5, y + h - (subtext ? 10.5 : 5.5))
  if (subtext) {
    doc.setFontSize(6)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...P.mist)
    doc.text(String(subtext), x + 5, y + h - 4)
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

  // Body - very dark slate
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
    // Rim - risk coloured
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
export async function exportToExcel(rows, columns, headers, filename = 'export', sheetName = 'Data', opts = {}) {
  await ensureXlsx()
  rows = Array.isArray(rows) ? rows : []
  const currency = opts.currency || 'SAR'
  const wb = XLSX.utils.book_new()

  // ── Sheet 1: Summary (analytical, built from the loaded/filtered rows) ──
  if (rows.length > 0) {
    const aoa = []
    aoa.push([opts.title || filename])
    aoa.push(['Generated', nowStr()])
    if (opts.dateRange) aoa.push(['Date range', opts.dateRange])
    if (opts.company)   aoa.push(['Organisation', opts.company])
    if (opts.meta) Object.entries(opts.meta).forEach(([k, v]) => aoa.push([k, v]))
    aoa.push(['Total records', rows.length])
    aoa.push([])

    const riskKey = columns.find(k => /risk/i.test(k))
    const catPriority = ['site', 'branch', 'country', 'brand', 'category', 'type', 'vendor', 'supplier',
      'workshop', 'liab', 'stage', 'status', 'severity', 'responsible', 'owner', 'position']
    let catKey = null
    for (const p of catPriority) { catKey = columns.find(k => k.toLowerCase().includes(p)); if (catKey) break }
    const numKeys = columns.filter(k => _colIsNumeric(rows, k))

    if (riskKey) {
      aoa.push(['Risk Distribution']); aoa.push(['Level', 'Count', '% of total'])
      _countBy(rows, riskKey).forEach(([k, c]) => aoa.push([k, c, `${pct(c, rows.length)}%`]))
      aoa.push([])
    }
    if (catKey && catKey !== riskKey) {
      const hdr = headers[columns.indexOf(catKey)] || catKey
      aoa.push([`${hdr} Breakdown (Top 15)`]); aoa.push([hdr, 'Count', '% of total'])
      _countBy(rows, catKey).slice(0, 15).forEach(([k, c]) => aoa.push([k, c, `${pct(c, rows.length)}%`]))
      aoa.push([])
    }
    if (numKeys.length) {
      aoa.push(['Numeric Summary']); aoa.push(['Metric', 'Total', 'Average'])
      numKeys.slice(0, 8).forEach(k => {
        const hdr = headers[columns.indexOf(k)] || k
        const tot = _sumBy(rows, k)
        const isMoney = /cost|amount|price|spend|value|budget|claim|deduct|recover/i.test(k)
        const fm = v => isMoney ? `${currency} ${Math.round(v).toLocaleString()}` : Math.round(v * 100) / 100
        aoa.push([hdr, fm(tot), fm(tot / rows.length)])
      })
      aoa.push([])
    }

    const wsSum = XLSX.utils.aoa_to_sheet(aoa)
    wsSum['!cols'] = [{ wch: 34 }, { wch: 22 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, wsSum, 'Summary')
  }

  // ── Sheet 2: Data (frozen header + auto-filter) ──
  const displayRows = rows.map(r => Object.fromEntries(columns.map((col, i) => [headers[i], r[col] ?? ''])))
  const ws = XLSX.utils.json_to_sheet(displayRows, { header: headers })
  ws['!cols'] = headers.map((h) => {
    const maxLen = Math.max(h.length, ...displayRows.map(r => String(r[h] ?? '').length))
    return { wch: Math.min(maxLen + 2, 44) }
  })
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, displayRows.length), c: Math.max(0, headers.length - 1) } }) }
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' }
  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ── Data analysis helpers (auto-summarise any tabular dataset) ──────────────────
function _parseNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v == null) return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
function _colIsNumeric(rows, key) {
  let num = 0, seen = 0
  for (const r of rows) {
    const v = r[key]
    if (v === '' || v == null) continue
    seen++
    if (_parseNum(v) != null) num++
    if (seen >= 60) break
  }
  return seen > 0 && num / seen >= 0.75
}
function _countBy(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const v = r[key]
    if (v === '' || v == null) continue
    const s = String(v).trim()
    if (!s) continue
    m.set(s, (m.get(s) || 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
function _sumBy(rows, key) { return rows.reduce((s, r) => s + (_parseNum(r[key]) || 0), 0) }
function _sumByGroup(rows, groupKey, valKey) {
  const m = new Map()
  for (const r of rows) {
    const g = r[groupKey]
    if (g === '' || g == null) continue
    const k = String(g).trim(); if (!k) continue
    m.set(k, (m.get(k) || 0) + (_parseNum(r[valKey]) || 0))
  }
  return [...m.entries()].filter(e => e[1] > 0).sort((a, b) => b[1] - a[1])
}
const _RISK_RGB_PDF = { critical: P.crimson, high: P.scarlet, medium: P.gold, low: P.emerald, none: P.ghost }

// Clean horizontal bar chart (vector - crisp at any zoom). entries: [[label, value]]
function _hBarChart(doc, x, y, w, h, entries, accentRgb, fmt) {
  if (!entries.length) return
  const max   = Math.max(...entries.map(e => e[1]), 1)
  const rowH  = Math.min(10, h / entries.length)
  const labelW = Math.min(46, w * 0.36)
  const barX  = x + labelW
  const valW  = 20
  const barMaxW = w - labelW - valW
  entries.forEach((e, i) => {
    const by = y + i * rowH
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.steel)
    doc.text(String(e[0]).slice(0, 24), x, by + rowH / 2 + 1)
    doc.setFillColor(...P.cloud)
    doc.roundedRect(barX, by + rowH * 0.18, barMaxW, rowH * 0.6, 1, 1, 'F')
    const bw = Math.max(1.5, barMaxW * (e[1] / max))
    const rgb = typeof accentRgb === 'function' ? accentRgb(e[0], i) : accentRgb
    doc.setFillColor(...rgb)
    doc.roundedRect(barX, by + rowH * 0.18, bw, rowH * 0.6, 1, 1, 'F')
    doc.setFontSize(6.8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ghost)
    doc.text(fmt ? fmt(e[1]) : e[1].toLocaleString(), barX + barMaxW + 2, by + rowH / 2 + 1)
  })
}

// ── PDF Report Export - auto KPI summary + charts, then the data table ───────────
export async function exportToPdf(rows, columns, title, filename = 'report', orientation = 'landscape', company = '', opts = {}) {
  await ensurePdf()
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const PW  = doc.internal.pageSize.width
  rows = Array.isArray(rows) ? rows : []
  const currency = opts.currency || 'SAR'
  const brand = await _pdfBrand(opts.branding)
  const hdrOpts = { accent: brand.accent, logoData: brand.logoData }
  const ftrOpts = { footerText: brand.footerText }

  // ── EMPTY STATE: never emit a bare table ──
  if (rows.length === 0) {
    _pageHeader(doc, title, `0 records · ${nowStr()}`, company, hdrOpts)
    _emptyStatePanel(doc, 'No records for the selected filters',
      opts.emptyHint || 'Adjust the date range or country filter and export again.')
    _pageFooter(doc, 1, 1, company, ftrOpts)
    doc.save(`${filename}.pdf`)
    return
  }

  // ── Detect dataset structure ──
  const riskCol = columns.find(c => /risk/i.test(c.header || '') || /risk/i.test(c.key || ''))
  const catPriority = ['site', 'branch', 'depot', 'location', 'country', 'brand', 'make', 'manufacturer',
    'category', 'type', 'vendor', 'supplier', 'workshop', 'position', 'axle', 'status', 'severity', 'driver']
  let catCol = null
  for (const p of catPriority) {
    catCol = columns.find(c => (c.key || '').toLowerCase().includes(p) || (c.header || '').toLowerCase().includes(p))
    if (catCol) break
  }
  const numCols = columns.filter(c => _colIsNumeric(rows, c.key))
  const costCol = numCols.find(c => /cost|amount|price|sar|spend|value|total|budget|expense/i.test((c.key || '') + (c.header || ''))) || numCols[0]

  const showSummary = rows.length > 0 && (riskCol || catCol || costCol)

  // ── PAGE 1: ANALYTICAL SUMMARY ──
  if (showSummary) {
    _pageHeader(doc, title, `${rows.length.toLocaleString()} records · ${nowStr()}`, company, hdrOpts)
    let y = 30

    // KPI cards
    const cards = [{ v: rows.length.toLocaleString(), l: 'Total Records', rgb: P.indigo }]
    let critN = 0, highN = 0
    if (riskCol) {
      const rc  = _countBy(rows, riskCol.key)
      const get = lvl => rc.find(([k]) => k.toLowerCase() === lvl)?.[1] || 0
      critN = get('critical'); highN = get('high')
      cards.push({ v: critN, l: 'Critical', rgb: P.crimson })
      cards.push({ v: highN, l: 'High Risk', rgb: P.scarlet })
    }
    if (catCol) cards.push({ v: _countBy(rows, catCol.key).length, l: `Distinct ${catCol.header}`, rgb: P.violet })
    if (costCol) {
      const tot = _sumBy(rows, costCol.key)
      cards.push({ v: fmtCurr(tot, currency), l: `Total ${costCol.header}`, rgb: P.gold })
      cards.push({ v: fmtCurr(tot / Math.max(1, rows.length), currency), l: `Avg ${costCol.header}`, rgb: P.emerald })
    }
    const cardsRow = cards.slice(0, 6)
    const cw = (PW - 28 - (cardsRow.length - 1) * 4) / cardsRow.length
    cardsRow.forEach((c, i) => _kpiBox(doc, 14 + i * (cw + 4), y, cw, 26, c.v, c.l, null, c.rgb))
    y += 33

    // Charts - two columns
    const half = (PW - 28 - 8) / 2
    const chartY = y + 6
    const chartH = 74

    // Left chart: category breakdown
    if (catCol) {
      const cats = _countBy(rows, catCol.key).slice(0, 8)
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
      doc.text(`${catCol.header} Breakdown (Top ${cats.length})`, 14, y)
      _hBarChart(doc, 14, chartY, half, chartH, cats, P.indigo)
    }
    // Right chart: risk distribution, else cost-by-category, else numeric top contributors
    const rx = 14 + half + 8
    if (riskCol) {
      const order = ['Critical', 'High', 'Medium', 'Low']
      const rc = _countBy(rows, riskCol.key)
      const entries = order.map(o => [o, rc.find(([k]) => k.toLowerCase() === o.toLowerCase())?.[1] || 0]).filter(e => e[1] > 0)
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
      doc.text('Risk Distribution', rx, y)
      _hBarChart(doc, rx, chartY, half, chartH, entries, lbl => _RISK_RGB_PDF[String(lbl).toLowerCase()] || P.ghost)
    } else if (costCol && catCol) {
      const byCat = _sumByGroup(rows, catCol.key, costCol.key).slice(0, 8)
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
      doc.text(`${costCol.header} by ${catCol.header} (Top ${byCat.length})`, rx, y)
      _hBarChart(doc, rx, chartY, half, chartH, byCat, P.gold, v => fmtCurr(v, currency))
    } else if (numCols.length > 1) {
      const alt = numCols.find(c => c.key !== costCol?.key)
      if (alt && catCol) {
        const byCat = _sumByGroup(rows, catCol.key, alt.key).slice(0, 8)
        doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
        doc.text(`${alt.header} by ${catCol.header}`, rx, y)
        _hBarChart(doc, rx, chartY, half, chartH, byCat, P.violet)
      }
    }

    // Auto narrative
    let ny = chartY + chartH + 8
    const bits = [`Dataset contains ${rows.length.toLocaleString()} records.`]
    if (riskCol && (critN + highN) > 0) bits.push(`${critN} critical and ${highN} high-risk items require attention (${pct(critN + highN, rows.length)}% of total).`)
    if (catCol) {
      const top = _countBy(rows, catCol.key)[0]
      if (top) bits.push(`${top[0]} leads ${catCol.header.toLowerCase()} with ${top[1]} records (${pct(top[1], rows.length)}%).`)
    }
    if (costCol) bits.push(`Total ${costCol.header.toLowerCase()} is ${fmtCurr(_sumBy(rows, costCol.key), currency)}.`)
    const narr = doc.splitTextToSize(bits.join(' '), PW - 36)
    doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver); doc.setLineWidth(0.3)
    doc.roundedRect(14, ny, PW - 28, narr.length * 4.4 + 8, 2, 2, 'FD')
    doc.setFillColor(...brand.accent); doc.roundedRect(14, ny, 3, narr.length * 4.4 + 8, 1.5, 1.5, 'F')
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.steel)
    doc.text(narr, 20, ny + 6)

    _pageFooter(doc, 1, null, company, ftrOpts)
    doc.addPage()
  }

  // ── DATA TABLE (operational detail) ──
  const usableW = orientation === 'landscape' ? 269 : 182
  const colW = columns.map(c => {
    const k = (c.key ?? '').toLowerCase(), h = (c.header ?? '').toLowerCase()
    if (k.includes('id') || k === 'qty')                                            return 22
    if (k.includes('risk') || h.includes('risk'))                                   return 28
    if (k.includes('remark') || k.includes('note') || k.includes('description'))    return 50
    if (k.includes('date') || k.includes('month'))                                  return 28
    if (k.includes('cost') || k.includes('sar'))                                    return 30
    if (k.includes('site') || k.includes('brand'))                                  return 32
    return 30
  })
  const rawTotal = colW.reduce((s, w) => s + w, 0)
  const sf = usableW / rawTotal
  const scaledW = colW.map(w => Math.round(w * sf * 10) / 10)
  const riskIdx = columns.findIndex(c => /risk/i.test(c.header ?? '') || /risk_level/i.test(c.key ?? ''))

  // Right-align numeric columns; thousands-format money/quantity columns while
  // leaving identifiers (id/serial/asset/year/date/phone) untouched.
  const numColIdx = new Set(numCols.map(c => columns.indexOf(c)))
  const isIdLike = c => /(^|_)(id|serial|asset|year|date|month|phone|plate|no)$|serial|asset_no/i.test((c.key || '') + '|' + (c.header || ''))
  const fmtColIdx = new Set(columns.map((c, i) => (numColIdx.has(i) && !isIdLike(c)) ? i : -1).filter(i => i >= 0))

  autoTable(doc, {
    ..._tableTheme(brand.accent),
    startY: showSummary ? 30 : 28,
    margin: { left: MX, right: MX, top: 28 },
    head: [columns.map(c => c.header)],
    body: rows.map(r => columns.map((c, i) => {
      const v = r[c.key]
      if (fmtColIdx.has(i) && v !== '' && v != null && _parseNum(v) != null) return _fmtThousands(v)
      return String(v ?? '')
    })),
    columnStyles: Object.fromEntries(scaledW.map((w, i) => [i, { cellWidth: w, ...(numColIdx.has(i) ? { halign: 'right' } : {}) }])),
    didParseCell: riskIdx >= 0 ? (data) => {
      if (data.section !== 'body' || data.column.index !== riskIdx) return
      const v = String(data.cell.raw ?? '').trim().toLowerCase()
      if (v === 'critical') { data.cell.styles.fillColor = P.rCream; data.cell.styles.textColor = P.crimson; data.cell.styles.fontStyle = 'bold' }
      else if (v === 'high') { data.cell.styles.fillColor = P.oCream; data.cell.styles.textColor = P.scarlet }
      else if (v === 'medium') { data.cell.styles.fillColor = P.yCream; data.cell.styles.textColor = P.ochre }
      else if (v === 'low') { data.cell.styles.fillColor = P.eCream; data.cell.styles.textColor = P.emerald }
    } : undefined,
    didDrawPage: () => {
      _pageHeader(doc, title, `${rows.length.toLocaleString()} records · ${nowStr()}`, company, hdrOpts)
      _pageFooter(doc, doc.internal.getNumberOfPages(), null, company, ftrOpts)
    },
  })

  doc.save(`${filename}.pdf`)
}

// ── Inspection Detail PDF - captures DOM SVG if provided ──────────────────────
/**
 * @param {Object}  row          - inspection record
 * @param {Object}  [opts]
 * @param {Element} [opts.svgEl] - live SVG DOM element from VehicleTyreDiagram
 * @param {string}  [opts.company]
 */
export async function exportInspectionDetailPdf(row, opts = {}) {
  await ensurePdf()
  const doc     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw      = doc.internal.pageSize.width
  const ph      = doc.internal.pageSize.height
  const company = opts.company || ''
  const mx      = 14
  const brand   = await _pdfBrand(opts.branding)
  const hdr     = { accent: brand.accent, logoData: brand.logoData }
  const ftr     = { footerText: brand.footerText }

  // ── PAGE 1 ─────────────────────────────────────────────────────────────────
  _pageHeader(doc, 'Vehicle Inspection Report', `Asset: ${row.asset_no || '-'}`, company, hdr)
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
  doc.text(`${row.inspection_type || '-'}  ·  ${row.status || '-'}`, mx + 8, y + 13)
  // Severity badge
  doc.setFillColor(...sevRgb)
  doc.roundedRect(pw - mx - 32, y + 4, 30, 8, 2, 2, 'F')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...P.white)
  doc.text((row.severity || 'MEDIUM').toUpperCase(), pw - mx - 17, y + 9.5, { align: 'center' })
  y += 21

  // Meta grid - 2-col, 4 rows
  const metaL = [
    ['Scheduled Date', row.scheduled_date || '-'],
    ['Site',           row.site || '-'],
    ['Inspector',      row.inspector || row.attendees || '-'],
    ['Company',        company || '-'],
  ]
  const metaR = [
    ['Asset No.',      row.asset_no || '-'],
    ['Vehicle Type',   row.vehicle_type || '-'],
    ['Status',         row.status || '-'],
    ['Findings Count', String(Object.keys(row.tyre_conditions || {}).length || '-')],
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
  y = _sectionBar(doc, 'Vehicle Tyre Condition Map', y, mx, brand.accent) + 3

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

      // Legend - right side
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
    const chipBg = { good: P.eCream, warning: P.oCream, critical: P.rCream, none: P.cloud }
    Object.entries(RISK_RGB).forEach(([key, rgb], i) => {
      const cnt = riskCounts[key] ?? 0
      const [r, g, b] = rgb
      const cx = mx + i * (chipW + 3)
      doc.setFillColor(...(chipBg[key] || P.cloud))
      doc.setDrawColor(...P.silver)
      doc.setLineWidth(0.3)
      doc.roundedRect(cx, y, chipW, 10, 2, 2, 'FD')
      doc.setFillColor(r, g, b)
      doc.circle(cx + 5, y + 5, 2.2, 'F')
      doc.setFontSize(7.5); doc.setFont('helvetica','bold')
      doc.setTextColor(r, g, b)
      doc.text(`${RISK_LABEL[key]}: ${cnt}`, cx + 10, y + 6.3)
    })
    y += 15
  }

  // ── Tyre condition table ───────────────────────────────────────────────────
  const tyreEntries = Object.entries(normTc)
  if (tyreEntries.length > 0) {
    if (y > ph - 70) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company, hdr); y = 30 }
    y = _sectionBar(doc, 'Detailed Tyre Analysis', y, mx, brand.accent) + 3

    autoTable(doc, {
      ..._tableTheme(brand.accent),
      startY: y,
      head: [['Position', 'Pressure', 'Tread', 'Condition', 'Risk', 'Notes']],
      body: tyreEntries.map(([pos, d]) => [
        pos,
        d.pressure ? `${d.pressure} PSI` : '-',
        d.tread    ? `${d.tread} mm`     : '-',
        d.condition ?? RISK_LABEL[d.risk] ?? '-',
        RISK_LABEL[d.risk] ?? 'Unknown',
        d.notes ?? '-',
      ]),
      margin: { left: mx, right: mx },
      columnStyles: {
        0: { cellWidth: 18, fontStyle: 'bold' },
        1: { cellWidth: 22, halign: 'right' }, 2: { cellWidth: 20, halign: 'right' },
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
    if (y > ph - 50) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company, hdr); y = 30 }
    y = _sectionBar(doc, 'Risk Distribution', y, mx, brand.accent) + 6
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
    if (y > ph - 40) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company, hdr); y = 30 }
    y = _sectionBar(doc, 'Findings & Observations', y, mx, brand.accent) + 4
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...P.ink)
    const fl = doc.splitTextToSize(row.findings, pw - mx * 2)
    doc.text(fl, mx, y); y += fl.length * 4.5 + 6
  }

  // ── Notes ──────────────────────────────────────────────────────────────────
  if (row.notes) {
    if (y > ph - 35) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company, hdr); y = 30 }
    y = _sectionBar(doc, 'Additional Notes', y, mx, brand.accent) + 4
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...P.ink)
    const nl = doc.splitTextToSize(row.notes, pw - mx * 2)
    doc.text(nl, mx, y); y += nl.length * 4.5 + 6
  }

  // ── Auto-recommendations ────────────────────────────────────────────────────
  const recs = _buildRecommendations(riskCounts, totalT, row)
  if (recs.length > 0) {
    if (y > ph - 60) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company, hdr); y = 30 }
    y = _sectionBar(doc, 'Recommended Actions', y, mx, brand.accent) + 4
    recs.forEach(rec => {
      if (y > ph - 20) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company, hdr); y = 30 }
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
  if (y + 34 > ph - FOOTER_SPACE - 2) { doc.addPage(); _pageHeader(doc, 'Inspection Report', '', company, hdr); y = 30 }
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
    _pageFooter(doc, p, totalPages, company || 'Fleet Operations', ftr)
  }

  const safe = (row.title || 'inspection').replace(/[^a-z0-9]/gi, '_').slice(0, 40)
  doc.save(`Inspection_${safe}.pdf`)
}

/* ── Public branded-PDF helper API ───────────────────────────────────────────
   Page-local jsPDF generators import these to get a consistent tenant-branded
   header/footer, empty-state and table theme without duplicating design code.

   Usage in a page:
     import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme }
       from '../lib/exportUtils'
     const brand = await resolvePdfBrand(branding)     // branding from useTenant()
     pdfHeader(doc, 'Report Title', subtitle, company, brand)
     if (!rows.length) { pdfEmptyState(doc, 'No records'); pdfFooter(doc,1,1,company,brand); doc.save(...); return }
     autoTable(doc, { ...pdfTableTheme(brand.accent), startY, head, body })
     pdfFooter(doc, page, total, company, brand)
*/
export async function resolvePdfBrand(branding) { return _pdfBrand(branding) }
export function pdfHeader(doc, title, subtitle = '', company = '', brand = {}) {
  _pageHeader(doc, title, subtitle, company, { accent: brand.accent, logoData: brand.logoData })
}
export function pdfFooter(doc, page, total, company = '', brand = {}) {
  _pageFooter(doc, page, total, company, { footerText: brand.footerText })
}
export function pdfEmptyState(doc, message, sub) { _emptyStatePanel(doc, message, sub) }
export function pdfTableTheme(accent) { return _tableTheme(accent) }

// Shared light autoTable theme for a professional, consistent look across every
// tabular report: dark slate header with white bold text and a thin tenant-
// accent rule beneath it, very light alternating stripes (#F8FAFC), #E2E8F0
// grid lines, generous cell padding, header repeated on every page break.
function _tableTheme(accent = P.indigo) {
  return {
    theme: 'grid',
    styles: {
      font: 'helvetica', fontSize: 8, cellPadding: 2.6, overflow: 'linebreak',
      textColor: P.iron, lineColor: P.silver, lineWidth: 0.15, valign: 'middle',
    },
    headStyles: {
      fillColor: P.slate, textColor: P.white, fontStyle: 'bold', fontSize: 8,
      cellPadding: 2.8, lineColor: P.slate, lineWidth: 0.15, valign: 'middle',
    },
    alternateRowStyles: { fillColor: P.offWhite },
    margin: { left: MX, right: MX },
    showHead: 'everyPage',
    didDrawCell: (d) => {
      // Thin tenant-accent rule under the header row (branding hook)
      if (d.section === 'head' && d.doc) {
        d.doc.setDrawColor(...accent)
        d.doc.setLineWidth(0.7)
        d.doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height)
      }
    },
  }
}

// Thousands-separated display for numeric cell values (currency & counts).
// Leaves identifiers (serials, asset numbers, years) untouched via caller checks.
function _fmtThousands(v) {
  const n = _parseNum(v)
  if (n == null) return String(v ?? '')
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/**
 * Branded Daily Operations Briefing PDF (used by the Daily Ops screen).
 * @param {Object} data  { date, kpis:{tyreChanges,inspections,workOrders,alerts,cost},
 *                         priorityQueue:[{severity,type,asset,description}], siteActivity:[[site,count]] }
 * @param {Object} opts  { company, branding, currency, filename }
 */
export async function exportDailyOpsBriefingPdf(data = {}, opts = {}) {
  await ensurePdf()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const PW  = doc.internal.pageSize.width
  const company  = opts.company || 'Fleet Operations'
  const currency = opts.currency || 'SAR'
  const brand    = await _pdfBrand(opts.branding)
  const hdr = { accent: brand.accent, logoData: brand.logoData }
  const ftr = { footerText: brand.footerText }
  const k   = data.kpis || {}
  const pq  = data.priorityQueue || []
  const sa  = data.siteActivity || []
  const theme = _tableTheme(brand.accent)

  _pageHeader(doc, 'Daily Operations Briefing', data.date || nowStr(), company, hdr)

  // KPI strip
  let y = 30
  const cards = [
    { v: (k.tyreChanges ?? 0).toLocaleString(), l: 'Tyre Changes', rgb: P.indigo },
    { v: (k.inspections ?? 0).toLocaleString(), l: 'Inspections',  rgb: P.emerald },
    { v: (k.workOrders  ?? 0).toLocaleString(), l: 'Work Orders',  rgb: P.violet },
    { v: (k.alerts      ?? 0).toLocaleString(), l: 'Alerts Raised', rgb: P.crimson },
    { v: fmtCurr(k.cost ?? 0, currency),        l: "Today's Cost",  rgb: P.gold },
  ]
  const cw = (PW - 28 - (cards.length - 1) * 4) / cards.length
  cards.forEach((c, i) => _kpiBox(doc, 14 + i * (cw + 4), y, cw, 26, c.v, c.l, null, c.rgb))
  y += 34

  const totalActivity = (k.tyreChanges || 0) + (k.inspections || 0) + (k.workOrders || 0) + (k.alerts || 0)
  if (totalActivity === 0 && pq.length === 0 && sa.length === 0) {
    _emptyStatePanel(doc, 'No operational activity recorded for this day',
      'Tyre changes, inspections, work orders and alerts will appear here as they are logged.')
    _pageFooter(doc, 1, 1, company, ftr)
    doc.save(`${opts.filename || 'DailyOps'}.pdf`)
    return
  }

  // Priority action queue
  if (pq.length > 0) {
    y = _sectionBar(doc, 'Priority Action Queue', y + 2, MX, brand.accent) + 1
    autoTable(doc, {
      ...theme, startY: y,
      head: [['Severity', 'Type', 'Asset', 'Description']],
      body: pq.slice(0, 15).map(i => [i.severity || '-', i.type || '-', i.asset || '-', i.description || '-']),
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 30 }, 2: { cellWidth: 30 } },
      didParseCell: (d) => {
        if (d.section !== 'body' || d.column.index !== 0) return
        const v = String(d.cell.raw ?? '').toLowerCase()
        if (v === 'critical') { d.cell.styles.textColor = P.crimson; d.cell.styles.fontStyle = 'bold' }
        else if (v === 'high') { d.cell.styles.textColor = P.scarlet }
      },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Site activity
  if (sa.length > 0) {
    if (y > doc.internal.pageSize.height - SECTION_MIN_SPACE - 15) { doc.addPage(); _pageHeader(doc, 'Daily Operations Briefing', data.date || nowStr(), company, hdr); y = 30 }
    y = _sectionBar(doc, 'Site Activity', y + 2, MX, brand.accent) + 1
    autoTable(doc, {
      ...theme, startY: y, tableWidth: 100,
      head: [['Site', 'Events']],
      body: sa.map(([s, c]) => [s, String(c)]),
    })
  }

  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) { doc.setPage(p); _pageFooter(doc, p, totalPages, company, ftr) }
  doc.save(`${opts.filename || 'DailyOps'}.pdf`)
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
  if (critPos.length)  recs.push({ urgent: true,  text: `IMMEDIATE: ${critPos.length} tyre(s) in critical condition at ${critPos.join(', ')} - remove vehicle from service until replaced.` })
  if (warnPos.length)  recs.push({ urgent: false, text: `Schedule replacement within 7 days for position(s) ${warnPos.join(', ')} showing abnormal wear or damage.` })
  if (lowPsiPos.length) recs.push({ urgent: true, text: `${lowPsiPos.length} tyre(s) below 80 PSI at ${lowPsiPos.join(', ')} - re-inflate to specification and inspect for slow leaks.` })
  if (row.severity === 'Critical' || row.severity === 'High') recs.push({ urgent: true, text: 'Escalate to Fleet Manager and issue corrective action work order before next deployment.' })
  if (!recs.length && totalT > 0) recs.push({ urgent: false, text: 'All positions checked. Maintain standard weekly pressure monitoring and monthly tread depth checks.' })
  return recs
}

// ── Daily Executive Operations Report PDF ─────────────────────────────────────
/**
 * @param {Object} data
 * @param {string} [filename]
 */
export async function exportDailyExecutivePdf(data, filename) {
  await ensurePdf()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const PW  = doc.internal.pageSize.width   // 297
  const PH  = doc.internal.pageSize.height  // 210

  const company   = data.company   || 'Fleet Operations'
  const date      = data.date      || nowStr()
  const period    = data.reportPeriod || 'Daily'
  const siteLabel = data.site      || 'All Sites'

  // Tenant branding (V68): primary colour drives the accent; logo + footer/
  // disclaimer are applied where present. All fall back to the base design.
  const brand    = data.branding || {}
  const ACCENT   = hexToRgb(brand.primary_color, P.indigo)
  const logoData = await fetchImageDataUri(brand.logo_url)
  const footerLeft = brand.footer_text || `${company}  ·  Fleet Operations Report  ·  Confidential`

  // landscape header/footer helpers - clean corporate band matching _pageHeader
  function lsHeader(title, accentRgb = ACCENT) {
    doc.setFillColor(...P.white)
    doc.rect(0, 0, PW, HEADER_BOTTOM, 'F')
    doc.setFillColor(...accentRgb)
    doc.rect(0, 0, PW, 2.5, 'F')
    if (logoData) {
      const fmt = /image\/jpe?g/i.test(logoData) ? 'JPEG' : 'PNG'
      try { doc.addImage(logoData, fmt, PW - MX - 14, 5, 14, 14, undefined, 'FAST') } catch { /* ignore */ }
    }
    doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ghost)
    doc.text(company.toUpperCase(), MX, 9, { charSpace: 0.5 })
    doc.setFontSize(15); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
    doc.text(title, MX, 17)
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...P.iron)
    doc.text(`${date}  ·  ${period}  ·  ${siteLabel}`, PW - MX - (logoData ? 18 : 0), 12, { align: 'right' })
    doc.setDrawColor(...accentRgb); doc.setLineWidth(0.9)
    doc.line(MX, 20.2, MX + 26, 20.2)
    doc.setDrawColor(...P.silver); doc.setLineWidth(0.25)
    doc.line(0, HEADER_BOTTOM, PW, HEADER_BOTTOM)
  }
  function lsFooter(page, total) {
    doc.setDrawColor(...P.silver); doc.setLineWidth(0.25)
    doc.line(MX, PH - 10, PW - MX, PH - 10)
    doc.setFontSize(6.8); doc.setFont('helvetica','normal'); doc.setTextColor(...P.ghost)
    doc.text(footerLeft, MX, PH - 5.5)
    doc.text(date, PW / 2, PH - 5.5, { align: 'center' })
    doc.text(`Page ${page} of ${total}`, PW - MX, PH - 5.5, { align: 'right' })
  }

  // ── PAGE 1: COVER ──────────────────────────────────────────────────────────
  {
    // Deep navy field with a restrained corporate composition: top accent bar,
    // left-aligned title block with accent underline, bottom hairline band.
    doc.setFillColor(...P.ink)
    doc.rect(0, 0, PW, PH, 'F')
    doc.setFillColor(...ACCENT)
    doc.rect(0, 0, PW, 3, 'F')
    doc.setDrawColor(...P.iron); doc.setLineWidth(0.3)
    doc.line(28, PH - 24, PW - 28, PH - 24)
    doc.setFillColor(...ACCENT)
    doc.rect(0, PH - 6, PW, 2, 'F')

    // Tenant logo (best-effort; format detected from the data URI)
    if (logoData) {
      const fmt = /image\/jpe?g/i.test(logoData) ? 'JPEG' : 'PNG'
      try { doc.addImage(logoData, fmt, 28, 18, 18, 18, undefined, 'FAST') } catch { /* ignore unsupported image */ }
    }

    // Company + title
    doc.setFontSize(9); doc.setFont('helvetica','bold')
    doc.setTextColor(...P.mist)
    doc.text(company.toUpperCase() + '  ·  FLEET OPERATIONS', 28, 48, { charSpace: 0.8 })
    doc.setFontSize(34); doc.setFont('helvetica','bold'); doc.setTextColor(...P.white)
    doc.text('Operations Report', 28, 74)
    // Accent underline beneath the title
    doc.setFillColor(...ACCENT)
    doc.rect(28, 80, 44, 1.4, 'F')
    doc.setFontSize(14); doc.setFont('helvetica','normal'); doc.setTextColor(...P.mist)
    doc.text(`${period} Intelligence Summary`, 28, 93)
    doc.setFontSize(10); doc.setTextColor(...P.ghost)
    doc.text(date + (data.generatedBy ? `  ·  Prepared by: ${data.generatedBy}` : ''), 28, 103)
    // Footer meta line on the cover
    doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(...P.ghost)
    doc.text(`${siteLabel}  ·  Confidential — for internal distribution only`, 28, PH - 16)

    // Right-side KPI tiles
    const kpis = [
      { v: data.totalVehicles ?? 0, l: 'Vehicles',      rgb: P.indigo },
      { v: data.totalTyres ?? 0,    l: 'Tyres',         rgb: [...P.emerald] },
      { v: data.criticalTyres ?? 0, l: 'Critical',      rgb: [...P.crimson] },
      { v: data.openActions?.length ?? 0, l: 'Actions', rgb: [...P.gold] },
    ]
    kpis.forEach((k, i) => _kpiBox(doc, PW - 195 + i * 47, 30, 42, 38, k.v, k.l, null, k.rgb))
  }

  // ── PAGE 2: EXECUTIVE SUMMARY (narrative-first, 60-second read) ─────────────
  doc.addPage()
  {
    const narrative = data.narrative || _deriveNarrative(data)
    const biz       = data.businessInsights || _deriveBusinessInsights(data)
    const forecast  = data.forecast || _deriveForecast(data)
    const toneRgb   = _TONE_RGB[narrative.tone] || P.indigo

    lsHeader('Executive Summary', ACCENT)
    let y = 32

    // Status banner
    doc.setFillColor(toneRgb[0] * 0.12 + 224, toneRgb[1] * 0.12 + 224, toneRgb[2] * 0.12 + 224)
    doc.setDrawColor(...toneRgb); doc.setLineWidth(0.4)
    doc.roundedRect(14, y, PW - 28, 13, 2, 2, 'FD')
    doc.setFillColor(...toneRgb)
    doc.roundedRect(14, y, 3.5, 13, 1.5, 1.5, 'F')
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ghost)
    doc.text('FLEET STATUS', 22, y + 5)
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...toneRgb)
    doc.text(narrative.status.toUpperCase(), 22, y + 10.5)
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
    doc.text(`${period} · ${siteLabel} · ${date}`, PW - 18, y + 8, { align: 'right' })
    y += 18

    // Narrative ("what happened / why / what matters")
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
    doc.text('Situation Overview', 14, y); y += 4
    const narrLines = []
    ;(narrative.paragraphs || []).forEach(p => { doc.splitTextToSize(p, PW - 36).forEach(l => narrLines.push(l)) })
    const narrH = narrLines.length * 4.4 + 9
    doc.setFillColor(...P.offWhite); doc.setDrawColor(...P.silver); doc.setLineWidth(0.3)
    doc.roundedRect(14, y, PW - 28, narrH, 2, 2, 'FD')
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.steel)
    doc.text(narrLines, 20, y + 6)
    y += narrH + 6

    // Business insights (decisions, not raw data)
    if (biz.length) {
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
      doc.text('Business Insights', 14, y); y += 4
      const cols = Math.min(3, biz.length)
      const rows = Math.ceil(biz.length / cols)
      const bw = (PW - 28 - (cols - 1) * 4) / cols
      const bh = 22
      biz.forEach((b, i) => {
        const r = Math.floor(i / cols), c = i % cols
        const bx = 14 + c * (bw + 4), by = y + r * (bh + 4)
        const rgb = _TONE_RGB[b.tone] || P.indigo
        doc.setFillColor(...P.white); doc.setDrawColor(...P.silver); doc.setLineWidth(0.3)
        doc.roundedRect(bx, by, bw, bh, 2, 2, 'FD')
        doc.setFillColor(...rgb); doc.roundedRect(bx, by, 3, bh, 1.5, 1.5, 'F')
        doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ghost)
        doc.text(String(b.label).toUpperCase(), bx + 6, by + 6)
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...rgb)
        doc.text(doc.splitTextToSize(String(b.value), bw - 10)[0], bx + 6, by + 13)
        doc.setFontSize(6.8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
        doc.text(doc.splitTextToSize(String(b.sub || ''), bw - 10)[0] || '', bx + 6, by + 18.5)
      })
      y += rows * (bh + 4) + 4
    }

    // Predictive outlook + priority action (two columns)
    const colW = (PW - 28 - 6) / 2
    const fy = y
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
    doc.text('Predictive Outlook', 14, fy)
    let py = fy + 4
    ;(forecast || []).slice(0, 4).forEach(f => {
      doc.setFillColor(...P.cloud); doc.roundedRect(14, py, colW, 9.5, 1.5, 1.5, 'F')
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.ghost)
      doc.text(String(f.label), 18, py + 6)
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.steel)
      doc.text(String(f.value), 14 + colW - 28, py + 6, { align: 'right' })
      doc.setFontSize(5.6); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.indigo)
      doc.text(String(f.conf || '').toUpperCase(), 14 + colW - 4, py + 6, { align: 'right' })
      py += 11.5
    })

    // Priority action callout (right column)
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...P.ink)
    doc.text('Priority Action', 14 + colW + 6, fy)
    const actX = 14 + colW + 6
    const actLines = doc.splitTextToSize(narrative.action || '', colW - 12)
    const actH = Math.max(20, actLines.length * 4.6 + 10)
    doc.setFillColor(Math.round(toneRgb[0] * 0.12 + 224), Math.round(toneRgb[1] * 0.12 + 224), Math.round(toneRgb[2] * 0.12 + 224))
    doc.setDrawColor(...toneRgb); doc.setLineWidth(0.4)
    doc.roundedRect(actX, fy + 4, colW, actH, 2, 2, 'FD')
    doc.setFillColor(...toneRgb); doc.roundedRect(actX, fy + 4, 3, actH, 1.5, 1.5, 'F')
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...P.steel)
    doc.text(actLines, actX + 7, fy + 11)
  }

  // ── PAGE 3: KPI COMMAND CENTER ─────────────────────────────────────────────
  doc.addPage()
  {
    lsHeader('KPI Command Center', ACCENT)
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
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
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
      { l: 'Cost / km',       v: data.costPerKm ? `SAR ${data.costPerKm.toFixed(3)}` : '-', rgb: [...P.gold] },
      { l: 'Budget Variance', v: (data.monthlyBudget && data.monthlySpend) ? fmtCurr(Math.abs(data.monthlyBudget - data.monthlySpend)) : '-', rgb: [...P.emerald] },
      { l: 'Vehicles w/ Alerts', v: data.vehiclesWithAlerts ?? 0, rgb: [...P.scarlet] },
    ]
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
    doc.text('Financial & Fleet Snapshot', 14, y)
    y += 5
    const fcw = (PW - 28 - (costKpis.length - 1) * 4) / costKpis.length
    costKpis.forEach((k, i) => _kpiBox(doc, 14 + i * (fcw + 4), y, fcw, 30, k.v, k.l, null, k.rgb))
  }

  // ── PAGE 3: TYRE HEALTH + SITE MATRIX ─────────────────────────────────────
  doc.addPage()
  {
    lsHeader('Tyre Health & Site Analysis', ACCENT)
    let y = 32

    // Top defects (left half)
    if (data.topDefects?.length) {
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
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
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
      doc.text('Site Performance Matrix', PW / 2 + 4, 32)
      autoTable(doc, {
        ..._tableTheme(ACCENT),
        startY: 37,
        head: [['Site', 'Vehicles', 'Alerts', 'Compliance', 'Status']],
        body: data.siteBreakdown.map(s => [
          s.name, s.vehicles ?? '-', s.alerts ?? '-',
          s.compliance ? `${s.compliance}%` : '-',
          s.compliance >= 90 ? '✓ Good' : s.compliance >= 70 ? '⚠ Monitor' : '✗ Action',
        ]),
        margin: { left: PW / 2 + 4, right: 14 },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
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
    lsHeader('Inspections & Critical Alerts', ACCENT)
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
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
      doc.text(`Critical Alerts (${alerts.length})`, 14, y)
      autoTable(doc, {
        ..._tableTheme(ACCENT),
        startY: y + 4,
        head: [['#', 'Alert', 'Asset', 'Site', 'Severity']],
        body: alerts.slice(0, 12).map((a, i) => [i + 1, a.message, a.asset ?? '-', a.site ?? '-', a.severity ?? 'High']),
        margin: { left: 14, right: PW / 2 + 2 },
        columnStyles: { 0: { cellWidth: 8, halign: 'right' }, 4: { cellWidth: 20 } },
        didParseCell: (d) => {
          if (d.section === 'body' && d.column.index === 4) {
            const v = String(d.cell.raw ?? '').toLowerCase()
            if (v === 'critical') { d.cell.styles.fillColor = P.rCream; d.cell.styles.textColor = P.crimson; d.cell.styles.fontStyle = 'bold' }
            else if (v === 'high') { d.cell.styles.fillColor = P.oCream; d.cell.styles.textColor = P.scarlet }
          }
        },
      })
    }

    // Actions table (right)
    const actions = data.openActions ?? []
    if (actions.length > 0) {
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
      doc.text(`Open Actions (${actions.length})`, PW / 2 + 4, y)
      autoTable(doc, {
        ..._tableTheme(ACCENT),
        startY: y + 4,
        head: [['Action', 'Priority', 'Site', 'Assignee']],
        body: actions.slice(0, 12).map(a => [a.title, a.priority ?? 'Medium', a.site ?? '-', a.assignee ?? 'Unassigned']),
        margin: { left: PW / 2 + 4, right: 14 },
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
    // Light theme page consistent with the rest of the report
    lsHeader('Strategic Insights & Recommended Actions', ACCENT)

    // Insights (left)
    const insights = data.insights ?? []
    if (insights.length > 0) {
      let iy = 36
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
      doc.text('Operational Intelligence', 14, iy)
      doc.setDrawColor(...ACCENT); doc.setLineWidth(0.8)
      doc.line(14, iy + 2.2, 32, iy + 2.2)
      iy += 8
      insights.forEach((ins) => {
        if (iy > PH - SECTION_MIN_SPACE + 5) return
        const ilines = doc.splitTextToSize(ins, PW / 2 - 36)
        const ih = ilines.length * 4.5 + 10
        doc.setFillColor(...P.offWhite)
        doc.setDrawColor(...P.silver)
        doc.setLineWidth(0.3)
        doc.roundedRect(14, iy - 3, PW / 2 - 22, ih, 2, 2, 'FD')
        doc.setFillColor(...ACCENT)
        doc.roundedRect(14, iy - 3, 1.6, ih, 0.8, 0.8, 'F')
        doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(...P.iron)
        doc.text(ilines, 20, iy + 3)
        iy += ih + 5
      })
    }

    // Recommendations (right)
    const recs = data.recommendations ?? []
    if (recs.length > 0) {
      let ry = 36
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...P.ink)
      doc.text('Priority Action Plan', PW / 2 + 10, ry)
      doc.setDrawColor(...ACCENT); doc.setLineWidth(0.8)
      doc.line(PW / 2 + 10, ry + 2.2, PW / 2 + 28, ry + 2.2)
      ry += 8
      const priColors = { Critical: P.crimson, High: P.scarlet, Medium: P.ochre, Low: P.emerald }
      const priCreams = { Critical: P.rCream, High: P.oCream, Medium: P.yCream, Low: P.eCream }
      recs.forEach(rec => {
        if (ry > PH - SECTION_MIN_SPACE + 5) return
        const priRgb = priColors[rec.priority] ?? P.indigo
        const [r, g, b] = priRgb
        const rlines = doc.splitTextToSize(rec.text, PW / 2 - 40)
        const rh = rlines.length * 4.5 + 12
        doc.setFillColor(...(priCreams[rec.priority] ?? P.offWhite))
        doc.setDrawColor(...P.silver)
        doc.setLineWidth(0.3)
        doc.roundedRect(PW / 2 + 10, ry - 3, PW / 2 - 24, rh, 2, 2, 'FD')
        // Priority pill
        doc.setFillColor(r, g, b)
        doc.roundedRect(PW / 2 + 12, ry - 1, 26, 6, 1, 1, 'F')
        doc.setFontSize(6); doc.setFont('helvetica','bold'); doc.setTextColor(...P.white)
        doc.text((rec.priority ?? 'Medium').toUpperCase(), PW / 2 + 25, ry + 3.5, { align: 'center' })
        doc.setFontSize(7.5); doc.setFont('helvetica','normal'); doc.setTextColor(...P.iron)
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

// ── PowerPoint Export - light executive theme, native editable charts ─────────
export async function exportToPptx(data, filename = 'TyrePulse_Report') {
  const pptx = await buildPptxDeck(data)
  await pptx.writeFile({ fileName: `${filename}.pptx` })
}

/**
 * Build the full executive deck and return the pptxgen instance WITHOUT saving.
 * Exported so integrity tests can serialise it (`pptx.write('arraybuffer')`) and
 * validate the real ZIP/XML — the corrupt-file class of bug is invisible when
 * pptxgenjs is mocked.
 */
export async function buildPptxDeck(data) {
  await ensurePptx()
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' }

  // Light, corporate-executive palette (high readability on white)
  const BG     = 'F6F8FC'   // slide background
  const CARD   = 'FFFFFF'   // panels / tiles
  const PANEL  = 'F1F5F9'   // soft fills
  const BORDER = 'E2E8F0'
  const INK    = '0F172A'   // primary text
  const SUBTLE = '475569'   // secondary text
  const MUTED  = '94A3B8'   // tertiary text
  // pptxgenjs MUTATES the shadow options object it is given (re-scaling blur/
  // offset to EMU on every use). Reusing one shared object made the values
  // explode exponentially (blurRad ~1e+58) into invalid OOXML - PowerPoint then
  // reports the file as corrupt. Always hand each shape a FRESH object.
  const SHADOW = () => ({ type: 'outer', color: 'C7D0DE', blur: 7, offset: 2, angle: 90, opacity: 0.45 })

  // Brand accents (saturated, AA-contrast on white). The primary + secondary
  // accents follow the tenant branding when supplied (V68); GOLD stays fixed as
  // the semantic KPI-highlight colour for readability.
  const brand  = data.branding || {}
  const INDIGO = brandHex(brand.primary_color, '4F46E5')
  const VIOLET = brandHex(brand.accent_color, '7C3AED')
  const GOLD   = 'D97706'
  const EMER   = '059669'
  const CRIM   = 'DC2626'
  const SCAR   = 'EA580C'
  const SKY    = '0284C7'
  const TEAL   = '0D9488'
  const SLATE  = '334155'
  const CHART_COLORS = [INDIGO, EMER, GOLD, SKY, VIOLET, TEAL, SCAR, CRIM]

  const company  = data.company || 'Fleet Operations'
  const period   = data.period || 'Management Summary'
  const currency = data.currency || 'SAR'

  const rect = pptx.ShapeType.rect
  function header(slide, title, subtitle, accent = INDIGO) {
    slide.background = { color: BG }
    slide.addShape(rect, { x: 0, y: 0, w: 13.33, h: 1.02, fill: { color: CARD } })
    slide.addShape(rect, { x: 0, y: 1.02, w: 13.33, h: 0.045, fill: { color: accent } })
    slide.addShape(rect, { x: 0, y: 0, w: 0.14, h: 1.02, fill: { color: accent } })
    slide.addText(company.toUpperCase(), { x: 0.4, y: 0.14, w: 9, h: 0.3, fontSize: 9, bold: true, color: accent, charSpacing: 2 })
    slide.addText(title, { x: 0.4, y: 0.4, w: 9.5, h: 0.55, fontSize: 21, bold: true, color: INK })
    if (subtitle) slide.addText(subtitle, { x: 10.0, y: 0.2, w: 2.9, h: 0.3, fontSize: 8.5, color: MUTED, align: 'right' })
    slide.addText(`${period}  ·  ${nowStr()}`, { x: 10.0, y: 0.5, w: 2.9, h: 0.4, fontSize: 8.5, color: MUTED, align: 'right' })
  }
  const footerText = brand.footer_text || `${company}  ·  Fleet Operations Report  ·  Confidential`
  function footer(slide, idx) {
    slide.addText(footerText, { x: 0.4, y: 7.15, w: 11.8, h: 0.3, fontSize: 7.5, color: MUTED })
    slide.addText(String(idx), { x: 12.4, y: 7.15, w: 0.6, h: 0.3, fontSize: 7.5, color: MUTED, align: 'right' })
  }
  function kpiTile(slide, x, y, w, label, value, color, sub) {
    slide.addShape(rect, { x, y, w, h: 1.55, fill: { color: CARD }, line: { color: BORDER, width: 1 }, rounding: true, shadow: SHADOW() })
    slide.addShape(rect, { x, y, w, h: 0.09, fill: { color } })
    slide.addText(String(label).toUpperCase(), { x: x + 0.18, y: y + 0.2, w: w - 0.36, h: 0.3, fontSize: 9, bold: true, color: MUTED, charSpacing: 1 })
    slide.addText(String(value ?? '-'), { x: x + 0.18, y: y + 0.46, w: w - 0.36, h: 0.62, fontSize: 27, bold: true, color })
    if (sub) slide.addText(String(sub), { x: x + 0.18, y: y + 1.1, w: w - 0.36, h: 0.35, fontSize: 9, color: SUBTLE })
  }
  function sectionTitle(slide, x, y, text, color = INK) {
    slide.addText(text, { x, y, w: 6.5, h: 0.4, fontSize: 13, bold: true, color })
  }
  const cOpts = (extra = {}) => ({
    showLegend: false, showTitle: false, chartColors: CHART_COLORS, chartColorsOpacity: 95,
    catAxisLabelColor: SUBTLE, catAxisLabelFontSize: 9, catAxisLabelFontFace: 'Arial',
    valAxisLabelColor: MUTED, valAxisLabelFontSize: 9, valAxisLabelFontFace: 'Arial',
    valGridLine: { color: BORDER, size: 0.5 }, catGridLine: { style: 'none' },
    dataLabelColor: INK, dataLabelFontSize: 9, dataLabelFontBold: true, dataLabelFontFace: 'Arial',
    ...extra,
  })

  // ── Chart safety layer ──────────────────────────────────────────────────────
  // PowerPoint refuses to open a deck if any chart cell is NaN/Infinity or a
  // label is empty/null (invalid OOXML). Coerce every value to a finite number
  // and every label to a non-empty string, keep series aligned, and substitute a
  // clean "no data" note rather than emit a broken chart.
  function cleanSeries(series) {
    return (series || []).map(s => {
      const rawLabels = Array.isArray(s.labels) ? s.labels : []
      const rawValues = Array.isArray(s.values) ? s.values : []
      const len = Math.max(rawLabels.length, rawValues.length)
      const labels = []
      const values = []
      for (let i = 0; i < len; i++) {
        const lbl = rawLabels[i]
        const n = Number(rawValues[i])
        labels.push(lbl == null || String(lbl).trim() === '' ? '-' : String(lbl))
        values.push(Number.isFinite(n) ? n : 0)
      }
      return { ...s, labels, values }
    })
  }
  function safeChart(slide, type, series, opts) {
    const clean = cleanSeries(series)
    const hasData = clean.some(s => s.values.length && s.values.some(v => v !== 0))
    if (!hasData) {
      slide.addText('No data available for this period', {
        x: opts.x, y: opts.y, w: opts.w, h: Math.min(opts.h, 0.6),
        fontSize: 11, italic: true, color: MUTED, align: 'center', valign: 'middle',
      })
      return
    }
    slide.addChart(type, clean, opts)
  }

  // Derived metrics
  const totalT   = data.totalTyres || 0
  const high     = data.highRisk || 0
  const good     = Math.max(0, totalT - high)
  const highShare = totalT ? Math.round((high / totalT) * 100) : 0
  const compliance = totalT ? Math.round((good / totalT) * 100) : 0
  const acts     = typeof data.openActions === 'number' ? data.openActions : (data.openActions?.length || 0)
  const tone     = highShare >= 15 ? CRIM : highShare >= 5 ? SCAR : EMER
  const statusTxt = highShare >= 15 ? 'Requires Immediate Attention'
                  : highShare >= 5  ? 'Stable - Monitoring Advised'
                  : 'Healthy - Within Target'
  const trend    = data.monthlyTrend || []
  const trendDelta = trend.length >= 2 ? trend[trend.length - 1].count - trend[0].count : 0
  const trendDir = trendDelta > 0 ? 'rising' : trendDelta < 0 ? 'easing' : 'flat'
  let slideNo = 0

  // Tenant logo (best-effort; null if missing/blocked — never breaks the deck).
  const logoData = await fetchImageDataUri(brand.logo_url)

  // ── Slide 1: Cover ─────────────────────────────────────────────────────────
  const s1 = pptx.addSlide()
  s1.background = { color: CARD }
  s1.addShape(rect, { x: 0, y: 0, w: 4.55, h: 7.5, fill: { color: 'F1F4FB' } })
  s1.addShape(rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: INDIGO } })
  s1.addShape(rect, { x: 4.55, y: 0, w: 0.03, h: 7.5, fill: { color: BORDER } })
  if (logoData) s1.addImage({ data: logoData, x: 0.6, y: 0.5, w: 1.05, h: 1.05, sizing: { type: 'contain', w: 1.05, h: 1.05 } })
  s1.addText(company.toUpperCase(), { x: 0.6, y: 1.5, w: 8, h: 0.5, fontSize: 12, bold: true, color: INDIGO, charSpacing: 2 })
  s1.addText('Fleet Operations Report', { x: 0.58, y: 2.1, w: 9, h: 1.6, fontSize: 42, bold: true, color: INK })
  s1.addText(period, { x: 0.6, y: 3.75, w: 8.5, h: 0.6, fontSize: 18, color: SLATE })
  s1.addShape(rect, { x: 0.62, y: 4.5, w: 1.6, h: 0.06, fill: { color: GOLD } })
  s1.addText(`Generated ${nowStr()}${data.generatedBy ? `   ·   Prepared by ${data.generatedBy}` : ''}`, { x: 0.6, y: 4.7, w: 8.5, h: 0.4, fontSize: 11, color: MUTED })
  s1.addText('CONFIDENTIAL - FOR MANAGEMENT REVIEW', { x: 0.6, y: 6.7, w: 8, h: 0.3, fontSize: 9, bold: true, color: MUTED, charSpacing: 1 })
  if (brand.disclaimer) s1.addText(String(brand.disclaimer).slice(0, 220), { x: 0.6, y: 7.0, w: 3.7, h: 0.45, fontSize: 6.5, color: MUTED, italic: true })
  const coverKpis = [
    { l: 'Vehicles', v: (data.totalVehicles ?? 0).toLocaleString(), c: INDIGO },
    { l: 'Tyres',    v: totalT.toLocaleString(),                     c: EMER },
    { l: 'Critical', v: high.toLocaleString(),                       c: CRIM },
    { l: 'Actions',  v: String(acts),                                c: GOLD },
  ]
  coverKpis.forEach((k, i) => kpiTile(s1, 9.35, 0.85 + i * 1.62, 3.4, k.l, k.v, k.c))

  // ── Slide 2: Executive Summary (narrative-first) ───────────────────────────
  {
    const se = pptx.addSlide(); slideNo++
    header(se, 'Executive Summary', '60-second read', tone)
    se.addShape(rect, { x: 0.4, y: 1.3, w: 12.55, h: 0.95, fill: { color: CARD }, line: { color: tone, width: 1.25 }, rounding: true, shadow: SHADOW() })
    se.addShape(rect, { x: 0.4, y: 1.3, w: 0.1, h: 0.95, fill: { color: tone } })
    se.addText('FLEET STATUS', { x: 0.65, y: 1.4, w: 4, h: 0.3, fontSize: 9, bold: true, color: MUTED, charSpacing: 1 })
    se.addText(statusTxt, { x: 0.65, y: 1.67, w: 9, h: 0.45, fontSize: 18, bold: true, color: tone })
    se.addText(`Compliance ${compliance}%`, { x: 9.5, y: 1.55, w: 3.2, h: 0.5, fontSize: 16, bold: true, color: compliance >= 85 ? EMER : SCAR, align: 'right' })

    sectionTitle(se, 0.4, 2.5, 'Situation Overview')
    const bullets = [
      { text: `${totalT.toLocaleString()} tyre records monitored; ${good.toLocaleString()} (${compliance}%) within safe limits, ${high.toLocaleString()} (${highShare}%) high-risk or critical.`, options: { bullet: { code: '2022' }, color: SLATE, fontSize: 12.5, paraSpaceAfter: 10 } },
      { text: `${acts} corrective action${acts === 1 ? '' : 's'} open and awaiting resolution.`, options: { bullet: { code: '2022' }, color: SLATE, fontSize: 12.5, paraSpaceAfter: 10 } },
      { text: trend.length >= 2 ? `Issue volume is ${trendDir} (${trendDelta > 0 ? '+' : ''}${trendDelta}) across the last ${trend.length} periods.` : `Period tyre cost totals ${fmtCurr(data.totalCost, currency)}.`, options: { bullet: { code: '2022' }, color: SLATE, fontSize: 12.5, paraSpaceAfter: 10 } },
      { text: highShare >= 5 ? `Priority: action ${high} high-risk tyres and clear the ${acts}-item backlog.` : `Priority: sustain preventive inspections to hold risk below 5%.`, options: { bullet: { code: '2022' }, color: GOLD, fontSize: 12.5, bold: true } },
    ]
    se.addText(bullets, { x: 0.55, y: 2.95, w: 7.0, h: 3.6, valign: 'top' })

    sectionTitle(se, 8.0, 2.5, 'Business Insights')
    const topSite = (data.topSites || [])[0]
    const topCat  = (data.categoryBreakdown || [])[0]
    const chips = [
      topSite ? { l: 'Highest-Volume Site', v: topSite.site, s: `${topSite.count} records`, c: SCAR } : null,
      topCat  ? { l: 'Top Category', v: topCat.category, s: `${topCat.count} records`, c: INDIGO } : null,
      { l: 'Period Tyre Cost', v: fmtCurr(data.totalCost, currency), s: period, c: VIOLET },
      { l: 'Critical Exposure', v: `${high} tyres`, s: `${highShare}% of fleet`, c: tone },
    ].filter(Boolean)
    chips.forEach((ch, i) => {
      const cy = 2.95 + i * 0.95
      se.addShape(rect, { x: 8.0, y: cy, w: 4.95, h: 0.82, fill: { color: CARD }, line: { color: BORDER, width: 1 }, rounding: true, shadow: SHADOW() })
      se.addShape(rect, { x: 8.0, y: cy, w: 0.08, h: 0.82, fill: { color: ch.c } })
      se.addText(String(ch.l).toUpperCase(), { x: 8.2, y: cy + 0.08, w: 4.6, h: 0.25, fontSize: 8, bold: true, color: MUTED, charSpacing: 1 })
      se.addText(String(ch.v), { x: 8.2, y: cy + 0.32, w: 3.3, h: 0.42, fontSize: 15, bold: true, color: ch.c })
      se.addText(String(ch.s), { x: 11.3, y: cy + 0.34, w: 1.55, h: 0.4, fontSize: 8.5, color: SUBTLE, align: 'right' })
    })
    footer(se, slideNo)
  }

  // ── Slide 3: KPI Command Center (tiles + condition doughnut) ───────────────
  {
    const s = pptx.addSlide(); slideNo++
    header(s, 'KPI Command Center', 'Performance at a glance', INDIGO)
    const kpis = [
      { l: 'Total Tyres', v: totalT.toLocaleString(), c: INDIGO, s: 'all positions' },
      { l: 'Total Cost',  v: fmtCurr(data.totalCost, currency), c: VIOLET, s: period },
      { l: 'High Risk',   v: high.toLocaleString(), c: CRIM, s: `${highShare}% of fleet` },
      { l: 'Compliance',  v: `${compliance}%`, c: compliance >= 85 ? EMER : SCAR, s: 'within spec' },
      { l: 'Open Actions',v: String(acts), c: GOLD, s: 'pending' },
    ]
    const kw = (12.55 - 4 * 0.25) / 5
    kpis.forEach((k, i) => kpiTile(s, 0.4 + i * (kw + 0.25), 1.35, kw, k.l, k.v, k.c, k.s))

    sectionTitle(s, 0.4, 3.3, 'Fleet Condition')
    safeChart(s, pptx.ChartType.doughnut,
      [{ name: 'Condition', labels: ['Within Spec', 'High Risk'], values: [good, high] }],
      cOpts({ x: 0.4, y: 3.75, w: 5.2, h: 3.0, holeSize: 62, chartColors: [EMER, CRIM], showLegend: true, legendPos: 'r', legendColor: SLATE, legendFontSize: 10, showValue: true, dataLabelFormatCode: '#,##0', showPercent: false }))

    if (data.riskBreakdown?.length) {
      sectionTitle(s, 6.4, 3.3, 'Risk Distribution')
      const rColors = { Critical: CRIM, High: SCAR, Medium: GOLD, Low: EMER }
      safeChart(s, pptx.ChartType.bar,
        [{ name: 'Tyres', labels: data.riskBreakdown.map(r => r.level), values: data.riskBreakdown.map(r => r.count) }],
        cOpts({ x: 6.4, y: 3.75, w: 6.55, h: 3.0, barDir: 'bar', showValue: true,
          chartColors: data.riskBreakdown.map(r => rColors[r.level] || SLATE) }))
    }
    footer(s, slideNo)
  }

  // ── Slide 4: Consumption Trend (native area/line) ──────────────────────────
  if (trend.length) {
    const s = pptx.addSlide(); slideNo++
    header(s, 'Consumption & Trend Analysis', 'Volume over time', VIOLET)
    // Data-honest tiles: any non-finite (missing/NaN) value renders as an em
    // dash rather than the literal string "NaN" on an executive slide.
    const safeN = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US') : '\u2014')
    const counts = trend.map((m) => Number(m.count)).filter(Number.isFinite)
    const avg = counts.length ? Math.round(counts.reduce((a, n) => a + n, 0) / counts.length) : null
    kpiTile(s, 0.4, 1.35, 2.9, 'Latest Period', safeN(trend[trend.length - 1].count), INDIGO, String(trend[trend.length - 1].month ?? '\u2014'))
    kpiTile(s, 3.45, 1.35, 2.9, 'Period Average', safeN(avg), VIOLET, `${trend.length} periods`)
    kpiTile(s, 6.5, 1.35, 2.9, 'Trend', Number.isFinite(Number(trendDelta)) ? `${trendDelta > 0 ? '+' : ''}${trendDelta}` : '\u2014', trendDelta > 0 ? CRIM : EMER, `${trendDir} vs first`)
    kpiTile(s, 9.55, 1.35, 3.4, 'Peak Period', counts.length ? Math.max(...counts).toLocaleString('en-US') : '\u2014', GOLD, 'highest volume')
    safeChart(s, pptx.ChartType.area,
      [{ name: 'Tyre Issues', labels: trend.map(m => m.month), values: trend.map(m => m.count) }],
      cOpts({ x: 0.4, y: 3.25, w: 12.55, h: 3.55, chartColors: [INDIGO], chartColorsOpacity: 35,
        lineSize: 2.5, lineSmooth: true, showValue: true,
        valAxisMinVal: 0, dataLabelPosition: 't' }))
    footer(s, slideNo)
  }

  // ── Slide 5: Sites & Categories ────────────────────────────────────────────
  if (data.topSites?.length || data.categoryBreakdown?.length) {
    const s = pptx.addSlide(); slideNo++
    header(s, 'Sites & Category Analysis', 'Where consumption concentrates', SKY)
    if (data.topSites?.length) {
      sectionTitle(s, 0.4, 1.25, 'Top Sites by Consumption')
      const top = data.topSites.slice(0, 8)
      safeChart(s, pptx.ChartType.bar,
        [{ name: 'Tyres', labels: top.map(t => t.site), values: top.map(t => t.count) }],
        cOpts({ x: 0.4, y: 1.7, w: 7.1, h: 5.0, barDir: 'bar', showValue: true, chartColors: [SKY] }))
    }
    if (data.categoryBreakdown?.length) {
      sectionTitle(s, 7.9, 1.25, 'Category Mix')
      const cats = data.categoryBreakdown.slice(0, 6)
      safeChart(s, pptx.ChartType.doughnut,
        [{ name: 'Categories', labels: cats.map(c => c.category), values: cats.map(c => c.count) }],
        cOpts({ x: 7.7, y: 1.7, w: 5.3, h: 5.0, holeSize: 55, showLegend: true, legendPos: 'b', legendColor: SLATE, legendFontSize: 9, showPercent: true, showValue: false, dataLabelColor: 'FFFFFF', dataLabelFontSize: 9 }))
    }
    footer(s, slideNo)
  }

  // ── Slide 6: Cost & Brand Performance ──────────────────────────────────────
  if (data.topBrands?.length || data.costBySite?.length) {
    const s = pptx.addSlide(); slideNo++
    header(s, 'Cost & Vendor Performance', 'Spend concentration', GOLD)
    if (data.costBySite?.length) {
      sectionTitle(s, 0.4, 1.25, `Cost by Site (${currency})`)
      const cs = data.costBySite.slice(0, 8)
      safeChart(s, pptx.ChartType.bar,
        [{ name: 'Cost', labels: cs.map(c => c.site), values: cs.map(c => Math.round(Number(c.cost) || 0)) }],
        cOpts({ x: 0.4, y: 1.7, w: 7.1, h: 5.0, barDir: 'bar', showValue: true, chartColors: [VIOLET],
          dataLabelFormatCode: '#,##0' }))
    }
    if (data.topBrands?.length) {
      sectionTitle(s, 7.9, 1.25, 'Brand Performance')
      const tb = data.topBrands.slice(0, 8)
      safeChart(s, pptx.ChartType.bar,
        [{ name: 'Tyres', labels: tb.map(b => b.brand), values: tb.map(b => b.count) }],
        cOpts({ x: 7.7, y: 1.7, w: 5.3, h: 5.0, barDir: 'bar', showValue: true, chartColors: [GOLD] }))
    }
    footer(s, slideNo)
  }

  // ── Slide 7: Open Actions (light table) ────────────────────────────────────
  if (data.recentActions?.length) {
    const s = pptx.addSlide(); slideNo++
    header(s, 'Open Corrective Actions', `${data.recentActions.length} tracked`, SCAR)
    const priCol = { Critical: CRIM, High: SCAR, Medium: GOLD, Low: EMER }
    const head = ['Action', 'Site', 'Priority', 'Status'].map(t => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: SLATE }, fontSize: 11, align: 'left' } }))
    const rows = data.recentActions.slice(0, 14).map((a, i) => ([
      { text: a.title || '-', options: { color: INK, fontSize: 10, fill: { color: i % 2 ? PANEL : CARD } } },
      { text: a.site || '-', options: { color: SUBTLE, fontSize: 10, fill: { color: i % 2 ? PANEL : CARD } } },
      { text: a.priority || '-', options: { color: priCol[a.priority] || SUBTLE, bold: true, fontSize: 10, fill: { color: i % 2 ? PANEL : CARD } } },
      { text: a.status || '-', options: { color: SUBTLE, fontSize: 10, fill: { color: i % 2 ? PANEL : CARD } } },
    ]))
    s.addTable([head, ...rows], { x: 0.4, y: 1.35, w: 12.55, colW: [6.8, 2.6, 1.7, 1.45], border: { type: 'solid', color: BORDER, pt: 0.5 }, rowH: 0.34, valign: 'middle' })
    footer(s, slideNo)
  }

  // ── Slide 8: Insights & Recommendations ────────────────────────────────────
  if (data.insights?.length || data.recommendations?.length) {
    const s = pptx.addSlide(); slideNo++
    header(s, 'Insights & Recommended Actions', 'What to do next', INDIGO)
    if (data.insights?.length) {
      sectionTitle(s, 0.4, 1.25, 'Operational Intelligence', INDIGO)
      data.insights.slice(0, 4).forEach((ins, i) => {
        const y = 1.75 + i * 1.18
        s.addShape(rect, { x: 0.4, y, w: 6.1, h: 1.0, fill: { color: CARD }, line: { color: BORDER, width: 1 }, rounding: true, shadow: SHADOW() })
        s.addShape(rect, { x: 0.4, y, w: 0.08, h: 1.0, fill: { color: INDIGO } })
        s.addText(ins, { x: 0.62, y: y + 0.1, w: 5.75, h: 0.8, fontSize: 10, color: SLATE, valign: 'middle' })
      })
    }
    if (data.recommendations?.length) {
      const priCol = { Critical: CRIM, High: SCAR, Medium: GOLD, Low: EMER }
      sectionTitle(s, 6.9, 1.25, 'Priority Action Plan', GOLD)
      data.recommendations.slice(0, 4).forEach((rec, i) => {
        const y = 1.75 + i * 1.18
        const col = priCol[rec.priority] || INDIGO
        s.addShape(rect, { x: 6.9, y, w: 6.05, h: 1.0, fill: { color: CARD }, line: { color: col, width: 1 }, rounding: true, shadow: SHADOW() })
        s.addShape(rect, { x: 6.9, y, w: 1.0, h: 0.3, fill: { color: col }, rounding: true })
        s.addText((rec.priority || 'Medium').toUpperCase(), { x: 6.9, y: y + 0.03, w: 1.0, h: 0.25, fontSize: 7.5, bold: true, color: 'FFFFFF', align: 'center' })
        s.addText(rec.text, { x: 8.0, y: y + 0.08, w: 4.85, h: 0.85, fontSize: 9.5, color: SLATE, valign: 'middle' })
      })
    }
    footer(s, slideNo)
  }

  return pptx
}
