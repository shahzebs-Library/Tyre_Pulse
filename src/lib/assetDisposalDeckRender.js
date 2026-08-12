/**
 * assetDisposalDeckRender - the PowerPoint and PDF renderers for the Asset
 * Disposal deck.
 *
 * The deck is the artefact that leaves the building: it goes in front of the
 * disposal committee to write machines off the books. So both renderers walk the
 * SAME pre-resolved slide list from `buildDeck()` in assetDisposalDeck.js - the
 * preview, the pptx and the pdf cannot disagree about what is on a slide or how
 * a table paginated, because none of them decides that.
 *
 * Reused rather than reinvented (see accidentReportPptx.js / accidentReportPdf.js,
 * which do this same job for the accident builder):
 *   - lazy `pptxgenjs` / `jspdf` imports so no page pays the bundle cost until an
 *     export actually runs,
 *   - the WYSIWYG `chartImageFor(slide)` contract: the builder hands over a PNG
 *     rasterised from the live on-screen canvas, so the slide IS the preview;
 *     headless callers fall back to an offscreen render, then to a native pptx
 *     chart, then to a plain numbers table,
 *   - `loadPdf()` from pdfEngine.js for jsPDF + a CALLABLE autoTable. A direct
 *     `import('jspdf-autotable')` resolves to an object under the installed
 *     jsPDF 4 and throws at runtime while the build stays clean,
 *   - `captureChartOnPaper` / `PAPER_FONT_PT` semantics from chartCapture.js:
 *     charts are drawn on WHITE with point-sized fonts scaled to the target
 *     width, or legends print at about 4.6pt and the fill exports black,
 *   - the shared report palette from reportColors.js so the deck follows the
 *     theme the owner picked.
 *
 * ASCII only. The slide text was already folded by the engine; anything added
 * here is written in ASCII by hand ("to" for ranges, "N/A", "|" separators).
 */
import { buildDeck } from './assetDisposalDeck'
import { categorical, colorAt, withAlpha } from './reportColors'
import { PAPER_FONT_PT, PRINT_SCALE } from './chartCapture'
import { loadPdf } from './pdfEngine'
import { reportFileName, reportDateLabel } from './exportUtils'

// ── Lazy engine loaders ──────────────────────────────────────────────────────
let _pptxgen
async function ensurePptx() {
  if (!_pptxgen) _pptxgen = (await import('pptxgenjs')).default
  return _pptxgen
}

// ── One light document palette for both renderers ────────────────────────────
const BG = 'F6F8FC'
const CARD = 'FFFFFF'
const BORDER = 'E2E8F0'
const INK = '0F172A'
const SUBTLE = '475569'
const MUTED = '94A3B8'
const ACCENT = '4F46E5'
const WARN = 'B45309'
const HEAD_FILL = '1E293B'

const RGB = {
  ink: [15, 23, 42], subtle: [71, 85, 105], muted: [148, 163, 184],
  border: [226, 232, 240], head: [30, 41, 59], zebra: [248, 250, 252],
  accent: [79, 70, 229], warn: [180, 83, 9],
  good: [21, 128, 61], watch: [180, 83, 9], bad: [185, 28, 28],
}

// Band tones for a reliability cell. A cell with no band renders in the ordinary
// body ink: an unbanded figure must not read as a judged one.
const BAND_HEX = { good: '15803D', watch: 'B45309', bad: 'B91C1C' }
const BAND_RGB = { good: RGB.good, watch: RGB.watch, bad: RGB.bad }

// Priority tones for the recommendation slide. The LABEL comes off the resolved
// slide (the reliability engine owns that vocabulary); these are the fallbacks
// for a slide built before the label was carried.
const PRIORITY_HEX = { critical: 'B91C1C', high: 'B45309', medium: '4F46E5', low: '475569', info: '475569' }
const PRIORITY_RGB = { critical: RGB.bad, high: RGB.warn, medium: RGB.accent, low: RGB.subtle, info: RGB.subtle }
export const PRIORITY_LABEL = {
  critical: 'ACT NOW', high: 'HIGH', medium: 'MEDIUM', low: 'FOR INFORMATION', info: 'FOR INFORMATION',
}
const priorityText = (g) => String(g?.label || PRIORITY_LABEL[g?.priority] || g?.priority || '').toUpperCase()

/**
 * A figure the deck could not measure. Toned as a caveat, never as a low score:
 * "Not measured" in the same weight as a real reading invites a committee to
 * read it as one.
 */
export const NOT_MEASURED_TEXT = 'Not measured'
const isUnmeasured = (v) => String(v) === NOT_MEASURED_TEXT
const cellTone = (text, band) => {
  if (String(text) === 'NOT IN REGISTER') return { hex: WARN, rgb: RGB.warn, bold: true }
  if (isUnmeasured(text)) return { hex: MUTED, rgb: RGB.muted, bold: false }
  if (band && BAND_HEX[band]) return { hex: BAND_HEX[band], rgb: BAND_RGB[band], bold: band === 'bad' }
  return { hex: SUBTLE, rgb: RGB.subtle, bold: false }
}

// 16:9 geometry (inches)
const PAGE_W = 13.33
const PAGE_H = 7.5
const MX = 0.45
const CONTENT_W = PAGE_W - MX * 2

/** Normalise any css colour to the bare 6 hex digits pptxgen expects. */
export function hex6(c, fallback = ACCENT) {
  if (typeof c !== 'string') return fallback
  const s = c.trim()
  let m = /^#?([0-9a-fA-F]{6})$/.exec(s)
  if (m) return m[1].toUpperCase()
  m = /^#?([0-9a-fA-F]{3})$/.exec(s)
  if (m) return m[1].split('').map((ch) => ch + ch).join('').toUpperCase()
  m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s)
  if (m) {
    const to = (n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0')
    return (to(m[1]) + to(m[2]) + to(m[3])).toUpperCase()
  }
  return fallback
}
const rgbOf = (c) => {
  const h = hex6(c)
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// ── Chart config (shared by the builder preview and both renderers) ──────────
/** chart.js type for a deck viz. */
export const CHART_JS_TYPE = { bar: 'bar', bar_h: 'bar', doughnut: 'doughnut', line: 'line' }

/**
 * Build the chart.js config for one resolved chart slide. The BUILDER PREVIEW
 * renders this exact object, and `chartImageFor` then rasterises that canvas, so
 * what the owner sees on screen is what lands on the slide.
 *
 * `paper` flips the ink to dark-on-white for an export capture; the on-screen
 * dark UI keeps the light ink.
 */
export function slideChartConfig(slide, { paper = false, fontScale = 1 } = {}) {
  const labels = Array.isArray(slide?.labels) ? slide.labels : []
  const values = Array.isArray(slide?.values) ? slide.values : []
  const viz = CHART_JS_TYPE[slide?.viz] ? slide.viz : 'bar'
  const horizontal = viz === 'bar_h'
  const perPoint = viz === 'bar' || viz === 'bar_h' || viz === 'doughnut'
  const colors = perPoint ? categorical(labels.length) : colorAt(0)
  const ink = paper ? '#0f172a' : '#e2e8f0'
  const tick = paper ? '#475569' : '#94a3b8'
  const grid = paper ? 'rgba(15,23,42,0.10)' : 'rgba(148,163,184,0.18)'
  const px = (pt) => Math.max(8, Math.round(pt * (fontScale || 1)))

  const dataset = viz === 'line'
    ? { label: slide?.title || 'Value', data: values, borderColor: colors, backgroundColor: withAlpha(hexify(colors), 0.15), fill: true, tension: 0.35, borderWidth: Math.max(1, Math.round(2 * (fontScale || 1))) }
    : { label: slide?.title || 'Value', data: values, backgroundColor: colors, borderColor: colors, borderWidth: 1 }

  const options = {
    responsive: !paper,
    maintainAspectRatio: false,
    animation: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: {
        display: viz === 'doughnut',
        position: 'right',
        labels: { color: ink, font: { size: px(PAPER_FONT_PT.legend) }, boxWidth: Math.round(9 * (fontScale || 1)), padding: Math.round(6 * (fontScale || 1)) },
      },
      tooltip: { enabled: !paper },
    },
  }
  if (viz !== 'doughnut') {
    options.scales = {
      x: { ticks: { color: tick, font: { size: px(PAPER_FONT_PT.tick) } }, grid: { color: horizontal ? grid : 'transparent' } },
      y: { ticks: { color: tick, font: { size: px(PAPER_FONT_PT.tick) } }, grid: { color: horizontal ? 'transparent' : grid }, beginAtZero: true },
    }
  }
  return { type: CHART_JS_TYPE[viz], data: { labels, datasets: [dataset] }, options }
}

const hexify = (c) => (Array.isArray(c) ? `#${hex6(c[0])}` : `#${hex6(c)}`)

/**
 * Render a chart slide offscreen on a WHITE canvas and return a PNG data URL.
 * Returns null when there is no canvas (a headless test run) so the caller can
 * fall back to printing the numbers rather than dropping the figures.
 */
let _canvasOk = null
/** Probe the 2d context ONCE per run. A headless test environment without the
 *  canvas package logs a "not implemented" notice on every call, so probing per
 *  chart would flood the output for a deck full of them. */
function canvasSupported() {
  if (_canvasOk != null) return _canvasOk
  try {
    const c = document.createElement('canvas')
    _canvasOk = typeof c.getContext === 'function' && !!c.getContext('2d')
  } catch { _canvasOk = false }
  return _canvasOk
}

export async function renderOffscreenChart(slide, { widthPt = 900, aspect = 0.5, scale = PRINT_SCALE } = {}) {
  if (!slide?.labels?.length) return null
  if (typeof document === 'undefined') return null
  if (!canvasSupported()) return null
  try {
    const { Chart, registerables } = await import('chart.js')
    Chart.register(...registerables)
    const canvas = document.createElement('canvas')
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return null
    canvas.width = Math.round(widthPt * scale)
    canvas.height = Math.round(widthPt * scale * aspect)
    const cfg = slideChartConfig(slide, { paper: true, fontScale: scale })
    // Paint white behind everything so the PNG is never transparent (which
    // composites to BLACK in several PDF viewers).
    const whiteBg = {
      id: 'tpDeckWhiteBg',
      beforeDraw(chart) {
        const c = chart.ctx
        c.save(); c.globalCompositeOperation = 'destination-over'
        c.fillStyle = '#ffffff'; c.fillRect(0, 0, chart.width, chart.height); c.restore()
      },
    }
    const inst = new Chart(ctx2d, { ...cfg, options: { ...cfg.options, devicePixelRatio: 1 }, plugins: [whiteBg] })
    const img = canvas.toDataURL('image/png')
    inst.destroy()
    return img && img.startsWith('data:image/png') && img.length > 200 ? img : null
  } catch {
    return null
  }
}

/** Chart figures as a plain two column table, so a slide that could not draw a
 *  chart still carries every number rather than showing an empty frame. */
export function chartFallbackTable(slide) {
  const labels = slide?.labels || []
  const values = slide?.values || []
  const head = ['Group', slide?.money ? `Value (${slide.currency || 'SAR'})` : 'Value']
  const body = labels.map((l, i) => [String(l), Number.isFinite(Number(values[i])) ? Math.round(Number(values[i])).toLocaleString('en-US') : 'N/A'])
  return { head, body }
}

// ── Shared slide resolution ──────────────────────────────────────────────────
/** Accept either an already-built deck or (config + ctx) and return the deck. */
function resolveDeck(deck, config, ctx) {
  if (deck && Array.isArray(deck.slides)) return deck
  return buildDeck(config, ctx || {})
}

const footerLine = (deck) => {
  const bits = [deck.company || 'TyrePulse', 'Asset Disposal']
  if (deck.country) bits.push(deck.country)
  return bits.join('  |  ')
}

/**
 * The standing caveat every deck carries. Nobody has valued this list, so the
 * deck states that plainly instead of leaving a reader to assume the blank
 * valuation columns mean zero.
 */
export function valuationCaveat(deck) {
  if (!deck || !deck.assetCount) return ''
  if (!deck.unvaluedCount) return ''
  if (deck.unvaluedCount >= deck.assetCount) {
    return 'No asset on this list has been valued. No recovery or proceeds figure can be quoted until a valuation is carried out.'
  }
  return `${deck.unvaluedCount} of ${deck.assetCount} assets on this list have not been valued. Any total shown covers only the valued assets.`
}

/** The register gap every deck carries when it exists. */
export function registerCaveat(deck) {
  const list = Array.isArray(deck?.notInRegister) ? deck.notInRegister : []
  if (!list.length) return ''
  return `${list.length} assets have no fleet register record: ${list.join(', ')}. They are included in every count on this deck.`
}

// ═════════════════════════════════════════════════════════════════════════════
// PowerPoint
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Build (and by default save) the disposal deck as a .pptx.
 *
 * @param {object}   opts
 * @param {object}   [opts.deck]          a deck from buildDeck() (preferred)
 * @param {object}   [opts.config]        builder config, when no deck is passed
 * @param {object}   [opts.ctx]           { rows, totals, currency, ... } with config
 * @param {string}   [opts.company]
 * @param {string}   [opts.country]
 * @param {string}   [opts.filename]      base name, no extension
 * @param {function} [opts.chartImageFor] (slide) => PNG data URL, live canvas WYSIWYG
 * @param {boolean}  [opts.save]          write the file (default true)
 * @returns {Promise<{ pptx, slides:Array, filename:string }>}
 */
export async function renderDisposalDeckPptx({
  deck: deckIn = null, config = null, ctx = null,
  company = null, country = null, filename = null,
  chartImageFor = null, save = true,
} = {}) {
  const deck = resolveDeck(deckIn, config, ctx)
  const comp = company || deck.company || 'TyrePulse'
  const ctry = country || deck.country || ''
  const currency = deck.currency || 'SAR'
  const stamp = reportDateLabel()

  const PptxGen = await ensurePptx()
  const pptx = new PptxGen()
  try { pptx.defineLayout({ name: 'TP_WIDE', width: PAGE_W, height: PAGE_H }) } catch { /* older builds */ }
  pptx.layout = 'LAYOUT_WIDE'
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' }
  const ChartType = pptx.ChartType || {}
  const rect = (pptx.ShapeType && pptx.ShapeType.rect) || 'rect'
  const line = (pptx.ShapeType && pptx.ShapeType.line) || 'line'

  const out = []
  const newSlide = () => { const s = pptx.addSlide(); s.background = { color: BG }; return s }
  const footer = (s) => {
    const n = out.length + 1
    s.addText(footerLine(deck), { x: MX, y: PAGE_H - 0.38, w: 9.5, h: 0.3, fontSize: 7.5, color: MUTED })
    s.addText(`Slide ${n}`, { x: PAGE_W - MX - 1.4, y: PAGE_H - 0.38, w: 1.4, h: 0.3, fontSize: 7.5, color: MUTED, align: 'right' })
  }
  const header = (s, title, sub) => {
    s.addShape(rect, { x: 0, y: 0, w: PAGE_W, h: 0.9, fill: { color: CARD } })
    s.addShape(rect, { x: 0, y: 0.9, w: PAGE_W, h: 0.045, fill: { color: ACCENT } })
    s.addShape(rect, { x: 0, y: 0, w: 0.13, h: 0.9, fill: { color: ACCENT } })
    s.addText(String(title || '').toUpperCase(), { x: MX, y: sub ? 0.13 : 0.24, w: CONTENT_W - 1, h: 0.42, fontSize: 15, bold: true, color: INK })
    if (sub) s.addText(String(sub), { x: MX, y: 0.53, w: CONTENT_W - 1, h: 0.3, fontSize: 9.5, color: SUBTLE })
  }
  const emptyNote = (s, text) => {
    s.addText(String(text || 'No data for this slide.'), {
      x: MX, y: 3.0, w: CONTENT_W, h: 0.8, fontSize: 13, italic: true, color: MUTED, align: 'center', valign: 'middle',
    })
  }

  const imageFor = (slide) => {
    try { return (chartImageFor && chartImageFor(slide)) || null } catch { return null }
  }

  for (const slide of deck.slides) {
    // ── Title / cover ──
    if (slide.kind === 'title') {
      const s = pptx.addSlide()
      s.background = { color: CARD }
      s.addShape(rect, { x: 0, y: 0, w: 4.6, h: PAGE_H, fill: { color: 'F1F4FB' } })
      s.addShape(rect, { x: 0, y: 0, w: 0.2, h: PAGE_H, fill: { color: ACCENT } })
      s.addText(String(comp).toUpperCase(), { x: 0.62, y: 1.25, w: 8.5, h: 0.5, fontSize: 13, bold: true, color: ACCENT, charSpacing: 2 })
      s.addText(String(slide.title || 'Asset Disposal Proposal'), { x: 0.6, y: 1.85, w: 9.6, h: 1.7, fontSize: 40, bold: true, color: INK })
      const sub = [slide.subtitle, ctry].filter((v) => v && String(v).trim()).join('  |  ')
      if (sub) s.addText(sub, { x: 0.62, y: 3.6, w: 9.6, h: 0.55, fontSize: 16, color: SUBTLE })
      s.addText(`${slide.assetCount} assets proposed for disposal`, { x: 0.62, y: 4.2, w: 9.6, h: 0.4, fontSize: 13, color: SUBTLE })
      if (slide.showDate) s.addText(`Prepared ${stamp}`, { x: 0.62, y: 4.72, w: 9.6, h: 0.4, fontSize: 11, color: MUTED })
      const cav = valuationCaveat(deck)
      if (cav) s.addText(cav, { x: 0.62, y: 5.35, w: 11.5, h: 0.7, fontSize: 10, italic: true, color: WARN, valign: 'top' })
      out.push(s)
      continue
    }

    // ── KPI grid ──
    if (slide.kind === 'kpis') {
      const s = newSlide()
      header(s, slide.title)
      if (slide.empty || !slide.items.length) { emptyNote(s, slide.emptyNote); footer(s); out.push(s); continue }
      const items = slide.items.slice(0, 9)
      const perRow = items.length <= 4 ? items.length : 3
      const gap = 0.26
      const cardW = (CONTENT_W - gap * (perRow - 1)) / perRow
      const rows = Math.ceil(items.length / perRow)
      const cardH = Math.min(1.75, (5.4 - gap * (rows - 1)) / rows)
      items.forEach((k, i) => {
        const col = i % perRow
        const r = Math.floor(i / perRow)
        const x = MX + col * (cardW + gap)
        const y = 1.25 + r * (cardH + gap)
        s.addShape(rect, { x, y, w: cardW, h: cardH, fill: { color: CARD }, line: { color: BORDER, width: 1 }, rounding: true })
        s.addShape(rect, { x, y, w: cardW, h: 0.08, fill: { color: k.valuation ? WARN : ACCENT } })
        s.addText(String(k.label).toUpperCase(), { x: x + 0.16, y: y + 0.18, w: cardW - 0.32, h: 0.3, fontSize: 9, bold: true, color: MUTED, charSpacing: 1 })
        const soft = k.valuation || k.unmeasured || isUnmeasured(k.value)
        s.addText(String(k.value), {
          x: x + 0.16, y: y + 0.5, w: cardW - 0.32, h: 0.62,
          fontSize: soft ? 19 : 24, bold: true,
          color: k.unmeasured || isUnmeasured(k.value) ? MUTED : (k.valuation ? WARN : INK),
        })
        if (k.note) s.addText(String(k.note), { x: x + 0.16, y: y + cardH - 0.5, w: cardW - 0.32, h: 0.44, fontSize: 7.5, color: SUBTLE, valign: 'top' })
      })
      // Reliability slides carry their own basis; everything else carries the
      // standing valuation caveat.
      const bottom = Array.isArray(slide.notes) && slide.notes.length ? slide.notes.join('  ') : valuationCaveat(deck)
      if (bottom) s.addText(String(bottom), { x: MX, y: PAGE_H - 0.92, w: CONTENT_W, h: 0.5, fontSize: 8, italic: true, color: WARN, valign: 'top' })
      footer(s); out.push(s)
      continue
    }

    // ── Recommendations, grouped by priority ──
    if (slide.kind === 'recommendations') {
      const s = newSlide()
      header(s, slide.title, `${slide.count} recommendation${slide.count === 1 ? '' : 's'} in all, each one carrying the figures it rests on`)
      if (slide.empty) { emptyNote(s, slide.emptyNote); footer(s); out.push(s); continue }
      let y = 1.12
      for (const g of slide.groups) {
        if (y > 6.5) break
        const w = Math.max(1.1, 0.09 * priorityText(g).length + 0.3)
        s.addShape(rect, { x: MX, y, w, h: 0.24, fill: { color: PRIORITY_HEX[g.priority] || SUBTLE } })
        s.addText(priorityText(g), {
          x: MX + 0.05, y, w: w - 0.1, h: 0.24, fontSize: 7.5, bold: true, color: 'FFFFFF', charSpacing: 1, valign: 'middle',
        })
        y += 0.3
        for (const it of g.items) {
          if (y > 6.6) break
          const titleH = String(it.title).length > 92 ? 0.5 : 0.27
          s.addText(String(it.title), { x: MX + 0.08, y, w: CONTENT_W - 0.16, h: titleH, fontSize: 10.5, bold: true, color: INK, valign: 'top' })
          y += titleH
          if (it.detail) {
            const detH = Math.min(0.78, 0.2 + 0.135 * Math.ceil(String(it.detail).length / 150))
            s.addText(String(it.detail), { x: MX + 0.2, y, w: CONTENT_W - 0.3, h: detH, fontSize: 8.5, color: SUBTLE, valign: 'top' })
            y += detH
          }
          const ev = Array.isArray(it.evidence) ? it.evidence.filter(Boolean) : (it.evidence ? [it.evidence] : [])
          if (slide.showEvidence && ev.length && y < 6.6) {
            const evH = Math.min(0.6, 0.16 + 0.14 * ev.length)
            s.addText(ev.map((t) => ({ text: String(t), options: { bullet: { code: '2022' }, fontSize: 7.5, color: MUTED, paraSpaceAfter: 1 } })), {
              x: MX + 0.32, y, w: CONTENT_W - 0.42, h: evH, valign: 'top',
            })
            y += evH
          }
          y += 0.1
        }
        y += 0.06
      }
      footer(s); out.push(s)
      continue
    }

    // ── This list against the rest of the fleet ──
    if (slide.kind === 'comparison') {
      const s = newSlide()
      header(s, slide.title, slide.country ? `Country: ${slide.country}` : '')
      if (slide.empty) { emptyNote(s, 'The fleet baseline was not supplied, so this comparison could not be produced.'); footer(s); out.push(s); continue }
      let y = 1.1
      for (const h of slide.headlines) {
        s.addShape(rect, { x: MX, y, w: 0.06, h: 0.52, fill: { color: h.tone === 'limit' ? WARN : ACCENT } })
        s.addText(String(h.text), { x: MX + 0.16, y, w: CONTENT_W - 0.16, h: 0.52, fontSize: 10.5, color: INK, valign: 'top' })
        y += 0.62
      }
      const rowH = 0.3
      const head2 = ['Measure', slide.onLabel, slide.restLabel, 'Ratio'].map((t, i) => ({
        text: t, options: { bold: true, color: 'FFFFFF', fill: { color: HEAD_FILL }, fontSize: 9, align: i ? 'right' : 'left' },
      }))
      const body2 = slide.metrics.map((m) => {
        const tag = m.trust ? '  (read this one)' : (m.confounded ? '  (confounded)' : '')
        const tone = m.confounded ? MUTED : (m.trust ? INK : SUBTLE)
        return [
          { text: `${m.label}${tag}`, options: { fontSize: 9, color: tone, bold: !!m.trust } },
          { text: String(m.onList), options: { fontSize: 9, color: tone, align: 'right', bold: !!m.trust } },
          { text: String(m.rest), options: { fontSize: 9, color: tone, align: 'right' } },
          { text: String(m.ratio || ''), options: { fontSize: 9, color: m.trust ? WARN : SUBTLE, align: 'right', bold: !!m.trust } },
        ]
      })
      s.addTable([head2, ...body2], {
        x: MX, y, w: CONTENT_W, colW: [CONTENT_W * 0.42, CONTENT_W * 0.2, CONTENT_W * 0.2, CONTENT_W * 0.18],
        border: { type: 'solid', color: BORDER, pt: 0.5 }, rowH, valign: 'middle', autoPage: false,
      })
      y += rowH * (body2.length + 1) + 0.16
      if (slide.confound && y < 6.6) {
        s.addShape(rect, { x: MX, y, w: CONTENT_W, h: 0.72, fill: { color: 'FFF7ED' }, line: { color: WARN, width: 0.75 } })
        s.addText(String(slide.confound), { x: MX + 0.14, y: y + 0.06, w: CONTENT_W - 0.28, h: 0.6, fontSize: 8.5, color: WARN, valign: 'top' })
      }
      footer(s); out.push(s)
      continue
    }

    // ── Findings ──
    if (slide.kind === 'findings') {
      const s = newSlide()
      header(s, slide.title)
      if (slide.empty) emptyNote(s, slide.emptyNote)
      else {
        s.addText(slide.bullets.map((t) => ({
          text: String(t),
          options: { bullet: { code: '2022' }, color: SUBTLE, fontSize: 13, paraSpaceAfter: 10 },
        })), { x: MX + 0.1, y: 1.25, w: CONTENT_W - 0.2, h: 5.3, valign: 'top' })
      }
      footer(s); out.push(s)
      continue
    }

    // ── Chart (one per slide, deliberately) ──
    if (slide.kind === 'chart') {
      const s = newSlide()
      header(s, slide.title, slide.note)
      if (slide.empty) { emptyNote(s, slide.emptyNote); footer(s); out.push(s); continue }
      const top = 1.2
      const h = 4.9
      let drew = false
      const img = imageFor(slide)
      if (img) {
        try { s.addImage({ data: img, x: MX, y: top, w: CONTENT_W, h, sizing: { type: 'contain', w: CONTENT_W, h } }); drew = true } catch { drew = false }
      }
      if (!drew) {
        // Native, editable pptx chart: the right output for a headless caller.
        const colors = categorical(slide.labels.length).map((c) => hex6(c))
        const series = [{ name: slide.title || 'Value', labels: slide.labels.map((l) => String(l || 'N/A')), values: slide.values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)) }]
        const isDoughnut = slide.viz === 'doughnut'
        try {
          s.addChart(
            isDoughnut ? ChartType.doughnut : (slide.viz === 'line' ? ChartType.line : ChartType.bar),
            series,
            {
              x: MX, y: top, w: CONTENT_W, h,
              chartColors: colors,
              showLegend: isDoughnut, legendPos: 'r', legendColor: SUBTLE, legendFontSize: 9,
              showValue: true, dataLabelColor: INK, dataLabelFontSize: 9, dataLabelFontBold: true,
              catAxisLabelColor: SUBTLE, catAxisLabelFontSize: 9,
              valAxisLabelColor: MUTED, valAxisLabelFontSize: 9,
              valGridLine: { color: BORDER, size: 0.5 },
              barDir: slide.viz === 'bar_h' ? 'bar' : 'col',
              holeSize: isDoughnut ? 55 : undefined,
              showTitle: false,
            },
          )
          drew = true
        } catch { drew = false }
      }
      if (!drew) {
        // Last resort: print the figures. An unreadable chart must never cost the
        // committee the numbers behind it.
        const { head, body } = chartFallbackTable(slide)
        s.addTable([
          head.map((t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: HEAD_FILL }, fontSize: 10 } })),
          ...body.slice(0, 12).map((r) => r.map((t) => ({ text: t, options: { fontSize: 10, color: SUBTLE } }))),
        ], { x: MX, y: top, w: CONTENT_W * 0.6, colW: [CONTENT_W * 0.38, CONTENT_W * 0.22], border: { type: 'solid', color: BORDER, pt: 0.5 }, rowH: 0.3 })
      }
      if (slide.digest) s.addText(String(slide.digest), { x: MX, y: top + h + 0.12, w: CONTENT_W, h: 0.3, fontSize: 9, color: SUBTLE })
      footer(s); out.push(s)
      continue
    }

    // ── Table (already paginated by the engine) ──
    if (slide.kind === 'table') {
      const s = newSlide()
      header(s, slide.title)
      if (slide.empty) { emptyNote(s, slide.emptyNote); s.addText(String(slide.caption || ''), { x: MX, y: PAGE_H - 0.78, w: CONTENT_W, h: 0.3, fontSize: 8.5, color: MUTED }); footer(s); out.push(s); continue }
      const cols = slide.columns
      const totalW = cols.reduce((a, c) => a + (c.width || 1), 0) || 1
      const colW = cols.map((c) => (CONTENT_W * (c.width || 1)) / totalW)
      const compact = slide.density === 'compact'
      const fs = compact ? 8 : 9
      const head = cols.map((c) => ({ text: c.header, options: { bold: true, color: 'FFFFFF', fill: { color: HEAD_FILL }, fontSize: fs, align: 'center', valign: 'middle' } }))
      const body = slide.rows.map((r, ri) => r.map((cell, ci) => {
        // A row for a machine that is not in the register is flagged in place, a
        // figure that could not be measured is toned back, and a banded
        // reliability cell takes its band's tone.
        const tone = cellTone(cell, slide.cellBands?.[ri]?.[ci])
        return {
          text: String(cell),
          options: {
            fontSize: fs, valign: 'middle', align: cols[ci]?.align === 'right' ? 'right' : 'left',
            color: tone.hex, bold: tone.bold,
            italic: isUnmeasured(cell),
            fill: { color: ri % 2 ? 'F8FAFC' : CARD },
          },
        }
      }))
      // The caveats a reliability table must never travel without.
      const notes = Array.isArray(slide.notes) ? slide.notes.filter(Boolean) : []
      const noteH = notes.length ? Math.min(0.86, 0.2 + 0.19 * notes.length) : 0
      s.addTable([head, ...body], {
        x: MX, y: 1.12, w: CONTENT_W, colW,
        border: { type: 'solid', color: BORDER, pt: 0.5 },
        rowH: compact ? 0.3 : 0.34, valign: 'middle', autoPage: false,
      })
      if (notes.length) {
        s.addText(notes.join('  '), { x: MX, y: PAGE_H - 0.82 - noteH, w: CONTENT_W, h: noteH, fontSize: 7.5, italic: true, color: WARN, valign: 'top' })
      }
      s.addText(String(slide.caption || ''), { x: MX, y: PAGE_H - 0.78, w: CONTENT_W, h: 0.3, fontSize: 8.5, color: MUTED })
      footer(s); out.push(s)
      continue
    }

    // ── One machine per slide ──
    if (slide.kind === 'asset') {
      const s = newSlide()
      header(s, slide.title, slide.subtitle)
      let y = 1.15
      if (slide.flags.length) {
        s.addText(slide.flags.join('   |   '), { x: MX, y, w: CONTENT_W, h: 0.32, fontSize: 10, bold: true, color: WARN })
        y += 0.4
      }
      // Facts, two columns of label/value pairs.
      const half = Math.ceil(slide.facts.length / 2)
      const colGap = 0.4
      const colW = (CONTENT_W - colGap) / 2
      slide.facts.forEach((f, i) => {
        const col = i < half ? 0 : 1
        const rowI = i < half ? i : i - half
        const x = MX + col * (colW + colGap)
        const fy = y + rowI * 0.29
        s.addText(String(f.label), { x, y: fy, w: colW * 0.44, h: 0.27, fontSize: 9, color: MUTED })
        s.addText(String(f.value), {
          x: x + colW * 0.44, y: fy, w: colW * 0.56, h: 0.27, fontSize: 9.5, bold: true,
          color: f.value === 'Not valued' ? WARN : INK,
        })
      })
      let by = y + half * 0.29 + 0.18
      // The machine's own reliability record, with the caveats it rests on.
      const relList = Array.isArray(slide.reliability) ? slide.reliability : []
      if (relList.length && by < 5.9) {
        s.addText('RELIABILITY RECORD', { x: MX, y: by, w: CONTENT_W, h: 0.26, fontSize: 8.5, bold: true, color: MUTED, charSpacing: 1 })
        by += 0.26
        s.addText(
          relList.map((f, i) => ([
            { text: `${f.label}: `, options: { fontSize: 9, color: MUTED } },
            { text: String(f.value), options: { fontSize: 9, bold: !isUnmeasured(f.value), color: isUnmeasured(f.value) ? MUTED : INK, italic: isUnmeasured(f.value) } },
            ...(i < relList.length - 1 ? [{ text: '   |   ', options: { fontSize: 9, color: BORDER } }] : []),
          ])).flat(),
          { x: MX, y: by, w: CONTENT_W, h: 0.44, valign: 'top' },
        )
        by += 0.48
        const rn = Array.isArray(slide.reliabilityNotes) ? slide.reliabilityNotes.filter(Boolean) : []
        if (rn.length && by < 6.2) {
          s.addText(rn.join('  '), { x: MX, y: by, w: CONTENT_W, h: 0.34, fontSize: 7.5, italic: true, color: WARN, valign: 'top' })
          by += 0.36
        }
      } else if (slide.reliabilityNote && by < 6.2) {
        s.addText(String(slide.reliabilityNote), { x: MX, y: by, w: CONTENT_W, h: 0.28, fontSize: 8.5, italic: true, color: MUTED })
        by += 0.3
      }
      // Committee remarks, verbatim.
      if (slide.remarks.length) {
        s.addText('COMMITTEE REMARKS', { x: MX, y: by, w: CONTENT_W, h: 0.26, fontSize: 8.5, bold: true, color: MUTED, charSpacing: 1 })
        by += 0.28
        const remH = Math.min(1.5, 0.22 * slide.remarks.length + 0.1)
        s.addText(slide.remarks.map((t) => ({ text: String(t), options: { bullet: { code: '2022' }, fontSize: 10, color: SUBTLE, paraSpaceAfter: 2 } })), { x: MX + 0.08, y: by, w: CONTENT_W - 0.16, h: remH, valign: 'top' })
        by += remH + 0.1
      }
      // Tyres still fitted.
      if (slide.tyres.length && by < 6.2) {
        s.addText(`TYRES STILL FITTED (${slide.tyres.length})`, { x: MX, y: by, w: CONTENT_W, h: 0.26, fontSize: 8.5, bold: true, color: MUTED, charSpacing: 1 })
        by += 0.28
        const th = [['Serial', 'Position', 'Brand', 'Size', 'Km'].map((t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: HEAD_FILL }, fontSize: 8 } }))]
        const tb = slide.tyres.slice(0, 6).map((t) => [t.serial, t.position, t.brand, t.size, t.km].map((v) => ({ text: String(v), options: { fontSize: 8, color: SUBTLE } })))
        s.addTable([...th, ...tb], { x: MX, y: by, w: CONTENT_W * 0.72, colW: [CONTENT_W * 0.22, CONTENT_W * 0.14, CONTENT_W * 0.16, CONTENT_W * 0.12, CONTENT_W * 0.08], border: { type: 'solid', color: BORDER, pt: 0.5 }, rowH: 0.26 })
        if (slide.tyres.length > 6) {
          s.addText(`and ${slide.tyres.length - 6} more, see the tyre recovery list`, { x: MX, y: Math.min(6.9, by + 0.26 * 7 + 0.05), w: CONTENT_W, h: 0.26, fontSize: 8, italic: true, color: MUTED })
        }
      } else if (!slide.tyres.length && by < 6.6) {
        s.addText(slide.tyreNote, { x: MX, y: by, w: CONTENT_W, h: 0.28, fontSize: 9, italic: true, color: MUTED })
      }
      s.addText(`Asset ${slide.index} of ${slide.count}`, { x: PAGE_W - MX - 3, y: PAGE_H - 0.38, w: 1.6, h: 0.3, fontSize: 7.5, color: MUTED, align: 'right' })
      footer(s); out.push(s)
      continue
    }

    // ── Free text ──
    if (slide.kind === 'text') {
      const s = newSlide()
      header(s, slide.title)
      s.addText(String(slide.body || 'N/A'), { x: MX, y: 1.25, w: CONTENT_W, h: 5.2, fontSize: 13, color: SUBTLE, valign: 'top' })
      footer(s); out.push(s)
      continue
    }

    // ── Divider ──
    if (slide.kind === 'divider') {
      const s = newSlide()
      s.addText(String(slide.label || '').toUpperCase(), { x: MX, y: 3.3, w: 4.6, h: 0.45, fontSize: 15, bold: true, color: SUBTLE, charSpacing: 2 })
      s.addShape(line, { x: MX + 4.8, y: 3.55, w: CONTENT_W - 4.8, h: 0, line: { color: BORDER, width: 1.5 } })
      footer(s); out.push(s)
      continue
    }
  }

  // A deck with no slides still writes a file, and that file says why.
  if (!out.length) {
    const s = newSlide()
    header(s, comp)
    emptyNote(s, 'No slides are configured for this deck.')
    footer(s); out.push(s)
  }

  const base = filename ? reportFileName(filename) : reportFileName(comp, 'Asset Disposal', ctry, reportDateLabel())
  const outName = `${base}.pptx`
  if (save) await pptx.writeFile({ fileName: outName })
  return { pptx, slides: out, filename: outName, currency }
}

// ═════════════════════════════════════════════════════════════════════════════
// PDF
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Build (and by default save) the same deck as a PDF. One slide per page so the
 * printed pack and the PowerPoint carry the same pagination.
 *
 * Signature mirrors renderDisposalDeckPptx.
 * @returns {Promise<{ doc, pages:number, filename:string }>}
 */
export async function renderDisposalDeckPdf({
  deck: deckIn = null, config = null, ctx = null,
  company = null, country = null, filename = null,
  chartImageFor = null, save = true,
} = {}) {
  const deck = resolveDeck(deckIn, config, ctx)
  const comp = company || deck.company || 'TyrePulse'
  const ctry = country || deck.country || ''
  const stamp = reportDateLabel()

  const { jsPDF, autoTable } = await loadPdf()
  const orientation = deck.orientation === 'portrait' ? 'portrait' : 'landscape'
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true })
  const PW = doc.internal.pageSize.width
  const PH = doc.internal.pageSize.height
  const M = 14
  const CW = PW - M * 2

  let first = true
  const page = () => { if (!first) doc.addPage(); first = false }
  const setInk = (c) => doc.setTextColor(c[0], c[1], c[2])

  const heading = (title, sub) => {
    doc.setFillColor(255, 255, 255)
    doc.rect(0, 0, PW, 22, 'F')
    doc.setFillColor(...RGB.accent)
    doc.rect(0, 22, PW, 0.9, 'F')
    doc.rect(0, 0, 2.2, 22, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); setInk(RGB.ink)
    doc.text(doc.splitTextToSize(String(title || ''), CW)[0], M, sub ? 11 : 14)
    if (sub) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setInk(RGB.subtle)
      doc.text(doc.splitTextToSize(String(sub), CW)[0], M, 17.5)
    }
    return 30
  }
  const emptyAt = (y, text) => {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(11); setInk(RGB.muted)
    doc.text(doc.splitTextToSize(String(text || 'No data for this slide.'), CW), M, y + 12)
  }

  const imageFor = async (slide) => {
    try {
      const live = chartImageFor && chartImageFor(slide)
      if (live) return live
    } catch { /* fall through to the offscreen render */ }
    return renderOffscreenChart(slide, { widthPt: Math.round(CW * 2.4), aspect: 0.46 })
  }

  for (const slide of deck.slides) {
    page()

    if (slide.kind === 'title') {
      doc.setFillColor(241, 244, 251); doc.rect(0, 0, PW, PH, 'F')
      doc.setFillColor(...RGB.accent); doc.rect(0, 0, 3.2, PH, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); setInk(rgbOf(ACCENT))
      doc.text(String(comp).toUpperCase(), M, PH * 0.3)
      doc.setFontSize(26); setInk(RGB.ink)
      doc.text(doc.splitTextToSize(String(slide.title || 'Asset Disposal Proposal'), CW), M, PH * 0.38)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(12); setInk(RGB.subtle)
      const sub = [slide.subtitle, ctry].filter((v) => v && String(v).trim()).join('  |  ')
      if (sub) doc.text(sub, M, PH * 0.48)
      doc.setFontSize(10)
      doc.text(`${slide.assetCount} assets proposed for disposal`, M, PH * 0.54)
      if (slide.showDate) { setInk(RGB.muted); doc.text(`Prepared ${stamp}`, M, PH * 0.59) }
      const cav = valuationCaveat(deck)
      if (cav) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); setInk(RGB.warn)
        doc.text(doc.splitTextToSize(cav, CW), M, PH * 0.68)
      }
      const reg = registerCaveat(deck)
      if (reg) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(9); setInk(RGB.warn)
        doc.text(doc.splitTextToSize(reg, CW), M, PH * 0.76)
      }
      continue
    }

    if (slide.kind === 'kpis') {
      let y = heading(slide.title)
      if (slide.empty || !slide.items.length) { emptyAt(y, slide.emptyNote); continue }
      const items = slide.items.slice(0, 9)
      const perRow = items.length <= 4 ? items.length : 3
      const gap = 4
      const cw = (CW - gap * (perRow - 1)) / perRow
      const ch = 26
      items.forEach((k, i) => {
        const col = i % perRow
        const r = Math.floor(i / perRow)
        const x = M + col * (cw + gap)
        const cy = y + r * (ch + gap)
        doc.setFillColor(255, 255, 255); doc.setDrawColor(...RGB.border); doc.setLineWidth(0.3)
        doc.roundedRect(x, cy, cw, ch, 1.5, 1.5, 'FD')
        const soft = k.unmeasured || isUnmeasured(k.value)
        doc.setFillColor(...(soft ? RGB.muted : (k.valuation ? RGB.warn : RGB.accent))); doc.rect(x, cy, cw, 1.1, 'F')
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); setInk(RGB.muted)
        doc.text(doc.splitTextToSize(String(k.label).toUpperCase(), cw - 6)[0], x + 3, cy + 6)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(k.valuation || soft ? 11 : 14)
        setInk(soft ? RGB.muted : (k.valuation ? RGB.warn : RGB.ink))
        doc.text(doc.splitTextToSize(String(k.value), cw - 6)[0], x + 3, cy + 14)
        if (k.note) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(6); setInk(RGB.subtle)
          doc.splitTextToSize(String(k.note), cw - 6).slice(0, 2).forEach((ln, li) => doc.text(ln, x + 3, cy + 19 + li * 3))
        }
      })
      const bottom = Array.isArray(slide.notes) && slide.notes.length ? slide.notes.join('  ') : valuationCaveat(deck)
      if (bottom) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); setInk(RGB.warn)
        doc.text(doc.splitTextToSize(String(bottom), CW).slice(0, 3), M, PH - 24)
      }
      continue
    }

    if (slide.kind === 'recommendations') {
      let y = heading(slide.title, `${slide.count} recommendation${slide.count === 1 ? '' : 's'} in all, each one carrying the figures it rests on`)
      if (slide.empty) { emptyAt(y, slide.emptyNote); continue }
      for (const g of slide.groups) {
        if (y > PH - 26) break
        const label = priorityText(g)
        doc.setFillColor(...(PRIORITY_RGB[g.priority] || RGB.subtle))
        doc.rect(M, y - 3.4, Math.max(20, label.length * 1.9 + 4), 5, 'F')
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(255, 255, 255)
        doc.text(label, M + 2, y)
        y += 6
        for (const it of g.items) {
          if (y > PH - 22) break
          doc.setFont('helvetica', 'bold'); doc.setFontSize(10); setInk(RGB.ink)
          const t = doc.splitTextToSize(String(it.title), CW - 4)
          t.forEach((ln, i) => doc.text(ln, M + 2, y + i * 4.6))
          y += t.length * 4.6 + 1
          if (it.detail && y < PH - 20) {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setInk(RGB.subtle)
            const d = doc.splitTextToSize(String(it.detail), CW - 10)
            d.forEach((ln, i) => doc.text(ln, M + 6, y + i * 3.6))
            y += d.length * 3.6 + 1
          }
          const ev = Array.isArray(it.evidence) ? it.evidence.filter(Boolean) : (it.evidence ? [it.evidence] : [])
          if (slide.showEvidence && ev.length && y < PH - 18) {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7); setInk(RGB.muted)
            for (const e of ev) {
              const lines = doc.splitTextToSize(`- ${e}`, CW - 14)
              if (y + lines.length * 3.2 > PH - 14) break
              lines.forEach((ln, i) => doc.text(ln, M + 10, y + i * 3.2))
              y += lines.length * 3.2
            }
            y += 1
          }
          y += 2.5
        }
        y += 1.5
      }
      continue
    }

    if (slide.kind === 'comparison') {
      let y = heading(slide.title, slide.country ? `Country: ${slide.country}` : '')
      if (slide.empty) { emptyAt(y, 'The fleet baseline was not supplied, so this comparison could not be produced.'); continue }
      for (const h of slide.headlines) {
        doc.setFillColor(...(h.tone === 'limit' ? RGB.warn : RGB.accent))
        const lines = doc.splitTextToSize(String(h.text), CW - 6)
        doc.rect(M, y - 3.2, 1.2, lines.length * 4.6 + 1.6, 'F')
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setInk(RGB.ink)
        lines.forEach((ln, i) => doc.text(ln, M + 4, y + i * 4.6))
        y += lines.length * 4.6 + 4
      }
      autoTable(doc, {
        startY: y, margin: { left: M, right: M }, theme: 'grid',
        head: [['Measure', slide.onLabel, slide.restLabel, 'Ratio']],
        body: slide.metrics.map((m) => [
          `${m.label}${m.trust ? ' (read this one)' : (m.confounded ? ' (confounded)' : '')}`,
          m.onList, m.rest, m.ratio || '',
        ]),
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, textColor: RGB.subtle, lineColor: RGB.border, lineWidth: 0.1 },
        headStyles: { fillColor: RGB.head, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
        alternateRowStyles: { fillColor: RGB.zebra },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
        didParseCell: (d) => {
          if (d.section !== 'body') return
          const m = slide.metrics[d.row.index]
          if (!m) return
          if (m.trust) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = d.column.index === 3 ? RGB.warn : RGB.ink }
          if (m.confounded) d.cell.styles.textColor = RGB.muted
        },
      })
      y = (doc.lastAutoTable?.finalY || y) + 6
      if (slide.confound && y < PH - 20) {
        const lines = doc.splitTextToSize(String(slide.confound), CW - 8)
        doc.setFillColor(255, 247, 237); doc.setDrawColor(...RGB.warn); doc.setLineWidth(0.3)
        doc.rect(M, y - 3, CW, lines.length * 3.9 + 4, 'FD')
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); setInk(RGB.warn)
        lines.forEach((ln, i) => doc.text(ln, M + 3, y + i * 3.9))
      }
      continue
    }

    if (slide.kind === 'findings') {
      let y = heading(slide.title)
      if (slide.empty) { emptyAt(y, slide.emptyNote); continue }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); setInk(RGB.subtle)
      for (const b of slide.bullets) {
        const wrapped = doc.splitTextToSize(String(b), CW - 6)
        if (y + wrapped.length * 5.6 > PH - 18) break
        doc.setFillColor(...RGB.accent); doc.circle(M + 1.3, y + 1.8, 0.9, 'F')
        wrapped.forEach((w, i) => doc.text(w, M + 5, y + 3 + i * 5.4))
        y += wrapped.length * 5.4 + 3.5
      }
      continue
    }

    if (slide.kind === 'chart') {
      const y = heading(slide.title, slide.note)
      if (slide.empty) { emptyAt(y, slide.emptyNote); continue }
      const img = await imageFor(slide)
      const bodyH = PH - y - 26
      if (img) {
        try { doc.addImage(img, 'PNG', M, y, CW, bodyH, undefined, 'FAST') } catch { /* fall through to figures */ }
      }
      if (!img) {
        // No canvas available: print the numbers instead of an empty frame.
        const { head, body } = chartFallbackTable(slide)
        autoTable(doc, {
          startY: y, margin: { left: M, right: M }, theme: 'grid',
          head: [head], body: body.length ? body : [['N/A', 'N/A']],
          styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, textColor: RGB.subtle, lineColor: RGB.border, lineWidth: 0.1 },
          headStyles: { fillColor: RGB.head, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
          alternateRowStyles: { fillColor: RGB.zebra },
        })
      }
      if (slide.digest) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(RGB.subtle)
        doc.text(doc.splitTextToSize(String(slide.digest), CW)[0], M, PH - 18)
      }
      continue
    }

    if (slide.kind === 'table') {
      const y = heading(slide.title)
      if (slide.empty) {
        emptyAt(y, slide.emptyNote)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setInk(RGB.muted)
        doc.text(String(slide.caption || ''), M, PH - 12)
        continue
      }
      const compact = slide.density === 'compact'
      autoTable(doc, {
        startY: y, margin: { left: M, right: M }, theme: 'grid',
        tableWidth: 'auto', showHead: 'everyPage',
        head: [slide.columns.map((c) => c.header)],
        body: slide.rows,
        styles: {
          font: 'helvetica', fontSize: compact ? 7 : 8, cellPadding: compact ? 1.2 : 1.8,
          overflow: 'linebreak', textColor: RGB.subtle, lineColor: RGB.border, lineWidth: 0.1,
        },
        headStyles: { fillColor: RGB.head, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: compact ? 7 : 8 },
        alternateRowStyles: { fillColor: RGB.zebra },
        columnStyles: Object.fromEntries(slide.columns.map((c, i) => [i, { halign: c.align === 'right' ? 'right' : 'left' }])),
        // A machine with no register record is flagged in the row itself, an
        // unmeasured figure is toned back so it cannot read as a low score, and a
        // banded reliability cell takes its band's tone.
        didParseCell: (d) => {
          if (d.section !== 'body') return
          const raw = String(d.cell.raw)
          const band = slide.cellBands?.[d.row.index]?.[d.column.index]
          const tone = cellTone(raw, band)
          d.cell.styles.textColor = tone.rgb
          if (tone.bold) d.cell.styles.fontStyle = 'bold'
          else if (isUnmeasured(raw)) d.cell.styles.fontStyle = 'italic'
        },
      })
      const tnotes = Array.isArray(slide.notes) ? slide.notes.filter(Boolean) : []
      if (tnotes.length) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(7); setInk(RGB.warn)
        const lines = doc.splitTextToSize(tnotes.join('  '), CW).slice(0, 3)
        lines.forEach((ln, i) => doc.text(ln, M, PH - 17 - (lines.length - 1 - i) * 3.2))
      }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setInk(RGB.muted)
      doc.text(String(slide.caption || ''), M, PH - 12)
      continue
    }

    if (slide.kind === 'asset') {
      let y = heading(slide.title, slide.subtitle)
      if (slide.flags.length) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setInk(RGB.warn)
        doc.text(slide.flags.join('   |   '), M, y + 2)
        y += 8
      }
      const half = Math.ceil(slide.facts.length / 2)
      const colW = (CW - 8) / 2
      doc.setFontSize(8.5)
      slide.facts.forEach((f, i) => {
        const col = i < half ? 0 : 1
        const r = i < half ? i : i - half
        const x = M + col * (colW + 8)
        const fy = y + r * 5.2
        doc.setFont('helvetica', 'normal'); setInk(RGB.muted)
        doc.text(doc.splitTextToSize(String(f.label), colW * 0.44)[0], x, fy)
        doc.setFont('helvetica', 'bold'); setInk(f.value === 'Not valued' ? RGB.warn : RGB.ink)
        doc.text(doc.splitTextToSize(String(f.value), colW * 0.54)[0], x + colW * 0.45, fy)
      })
      y += half * 5.2 + 4
      const relList = Array.isArray(slide.reliability) ? slide.reliability : []
      if (relList.length && y < PH - 46) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setInk(RGB.muted)
        doc.text('RELIABILITY RECORD', M, y); y += 4.2
        doc.setFontSize(8)
        const strip = relList.map((f) => `${f.label}: ${f.value}`).join('   |   ')
        doc.setFont('helvetica', 'normal'); setInk(RGB.ink)
        const lines = doc.splitTextToSize(strip, CW).slice(0, 3)
        lines.forEach((ln, i) => doc.text(ln, M, y + i * 4))
        y += lines.length * 4 + 2
        const rn = Array.isArray(slide.reliabilityNotes) ? slide.reliabilityNotes.filter(Boolean) : []
        if (rn.length && y < PH - 34) {
          doc.setFont('helvetica', 'italic'); doc.setFontSize(7); setInk(RGB.warn)
          const nl = doc.splitTextToSize(rn.join('  '), CW).slice(0, 2)
          nl.forEach((ln, i) => doc.text(ln, M, y + i * 3.4))
          y += nl.length * 3.4 + 2
        }
      } else if (slide.reliabilityNote && y < PH - 38) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); setInk(RGB.muted)
        doc.text(doc.splitTextToSize(String(slide.reliabilityNote), CW)[0], M, y)
        y += 5
      }
      if (slide.remarks.length && y < PH - 40) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setInk(RGB.muted)
        doc.text('COMMITTEE REMARKS', M, y); y += 4.5
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setInk(RGB.subtle)
        for (const t of slide.remarks) {
          const wrapped = doc.splitTextToSize(`- ${t}`, CW - 4)
          if (y + wrapped.length * 4.4 > PH - 30) break
          wrapped.forEach((w, i) => doc.text(w, M + 2, y + i * 4.4))
          y += wrapped.length * 4.4 + 1.2
        }
        y += 3
      }
      if (slide.tyres.length && y < PH - 32) {
        autoTable(doc, {
          startY: y, margin: { left: M, right: M }, theme: 'grid',
          head: [['Tyre serial', 'Position', 'Brand', 'Size', 'Km run']],
          body: slide.tyres.slice(0, 8).map((t) => [t.serial, t.position, t.brand, t.size, t.km]),
          styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.2, textColor: RGB.subtle, lineColor: RGB.border, lineWidth: 0.1 },
          headStyles: { fillColor: RGB.head, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
        })
      } else if (!slide.tyres.length && y < PH - 24) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); setInk(RGB.muted)
        doc.text(String(slide.tyreNote), M, y)
      }
      continue
    }

    if (slide.kind === 'text') {
      const y = heading(slide.title)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); setInk(RGB.subtle)
      doc.text(doc.splitTextToSize(String(slide.body || 'N/A'), CW), M, y + 4)
      continue
    }

    if (slide.kind === 'divider') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); setInk(RGB.subtle)
      doc.text(String(slide.label || '').toUpperCase(), M, PH / 2)
      doc.setDrawColor(...RGB.border); doc.setLineWidth(0.5)
      doc.line(M, PH / 2 + 4, PW - M, PH / 2 + 4)
      continue
    }
  }

  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setInk(RGB.muted)
    doc.text(footerLine(deck), M, PH - 6)
    doc.text(`Page ${p} of ${pages}`, PW - M, PH - 6, { align: 'right' })
  }

  const base = filename ? reportFileName(filename) : reportFileName(comp, 'Asset Disposal', ctry, reportDateLabel())
  const fname = `${base}.pdf`
  if (save) doc.save(fname)
  return { doc, pages, filename: fname }
}

export default renderDisposalDeckPptx
