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
import { withAlpha } from './reportColors'
import { PAPER_FONT_PT, PRINT_SCALE } from './chartCapture'
import { loadPdf } from './pdfEngine'
import { reportFileName, reportDateLabel } from './exportUtils'
import {
  PAGE, BODY_FONT, TITLE_FONT, BRAND, BRAND_RGB, TONE, PRIORITY_TONE, rgb,
  COVER, SLIDE, TYPE, BASIS_STYLE, CHART_SERIES, coverMeta,
} from './brandDeckTheme'

// ── Lazy engine loaders ──────────────────────────────────────────────────────
let _pptxgen
async function ensurePptx() {
  if (!_pptxgen) _pptxgen = (await import('pptxgenjs')).default
  return _pptxgen
}

// ── One document palette for both renderers, taken from the house style ──────
// Every colour below resolves to brandDeckTheme, which was measured from the
// company's own deck. Nothing here invents a colour: the old local palette is
// gone so a slide the app builds cannot drift from a slide the office builds.
const BG = BRAND.surface
const CARD = BRAND.card
const BORDER = BRAND.border
const INK = BRAND.ink
const SUBTLE = BRAND.secondary
const MUTED = BRAND.muted
const ACCENT = BRAND.green
const WARN = BRAND.amber
const HEAD_FILL = BRAND.navy

const RGB = {
  ink: BRAND_RGB.ink, subtle: BRAND_RGB.secondary, muted: BRAND_RGB.muted,
  border: BRAND_RGB.border, head: BRAND_RGB.navy, zebra: BRAND_RGB.surface,
  accent: BRAND_RGB.green, warn: BRAND_RGB.amber,
  good: rgb(TONE.good), watch: rgb(TONE.watch), bad: rgb(TONE.bad),
}

// Band tones for a reliability cell. A cell with no band renders in the ordinary
// body ink: an unbanded figure must not read as a judged one. They come from
// TONE rather than BRAND because a band is a JUDGEMENT - borrowing the identity
// green would make a merely average figure read as company approved.
const BAND_HEX = { good: TONE.good, watch: TONE.watch, bad: TONE.bad }
const BAND_RGB = { good: RGB.good, watch: RGB.watch, bad: RGB.bad }

// Priority tones for the recommendation slide. The LABEL comes off the resolved
// slide (the reliability engine owns that vocabulary); these are the fallbacks
// for a slide built before the label was carried.
const PRIORITY_HEX = {
  critical: PRIORITY_TONE.critical, high: PRIORITY_TONE.high, medium: PRIORITY_TONE.medium,
  low: PRIORITY_TONE.low, info: PRIORITY_TONE.info,
}
const PRIORITY_RGB = Object.fromEntries(
  Object.entries(PRIORITY_HEX).map(([k, v]) => [k, rgb(v)]),
)
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

// 16:9 geometry (inches), straight off the theme so the two renderers and the
// cover composition cannot drift apart.
const PAGE_W = PAGE.w
const PAGE_H = PAGE.h
const MX = SLIDE.mx
const CONTENT_W = SLIDE.contentW

/**
 * Fallback for a colour we could not parse. DELIBERATELY not a brand colour: an
 * unreadable colour should look wrong on the slide rather than quietly pass as
 * house style, and every caller that means the brand green passes it explicitly.
 */
const HEX_FALLBACK = '4F46E5'

/**
 * Row height (and the font that fits it) for a table that must finish above
 * `bottom`. The engine paginates a register at up to 26 rows a slide, so a fixed
 * row height ran the longest tables off the bottom of the page; this shrinks the
 * rows to fit instead. Nothing is ever dropped.
 */
/**
 * Rough wrapped-line count for `text` at `fontPt` across `widthIn` inches. Used
 * to size a card to its content: a card stretched to the page bottom around
 * three bullets reads as a slide with something missing from it.
 */
export function estLines(text, widthIn, fontPt) {
  const s = String(text || '')
  if (!s) return 0
  const perLine = Math.max(12, Math.floor((widthIn * 144) / Math.max(1, fontPt)))
  return Math.max(1, Math.ceil(s.length / perLine))
}

export function fitRows(count, top, bottom, baseRowH, baseFont = 9) {
  const n = Math.max(1, Number(count) || 1)
  const room = Math.max(0.6, bottom - top)
  const rowH = Math.max(0.19, Math.min(baseRowH, room / n))
  const font = rowH >= baseRowH ? baseFont : Math.max(6.5, Math.min(baseFont, rowH * 34))
  return { rowH, fs: Math.round(font * 10) / 10 }
}

/** Normalise any css colour to the bare 6 hex digits pptxgen expects. */
export function hex6(c, fallback = HEX_FALLBACK) {
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
 * The house chart palette, cycled to however many points a slide has. Taken
 * from the theme rather than the configurable report palette, because this deck
 * has to look like the company's own deck whatever an admin picked for the
 * dashboards.
 */
export function deckSeriesColors(n) {
  const count = Math.max(1, Number(n) || 1)
  return Array.from({ length: count }, (_, i) => CHART_SERIES[i % CHART_SERIES.length])
}
const deckSeriesCss = (n) => deckSeriesColors(n).map((h) => `#${h}`)

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
  const colors = perPoint ? deckSeriesCss(labels.length) : `#${CHART_SERIES[0]}`
  const ink = paper ? `#${BRAND.ink}` : '#e2e8f0'
  const tick = paper ? `#${BRAND.secondary}` : '#94a3b8'
  const grid = paper ? 'rgba(16,24,40,0.10)' : 'rgba(148,163,184,0.18)'
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

/**
 * The company logo, if we were handed one we can actually draw.
 *
 * Only a `data:image/...` URI is accepted. The stored logo may be an http URL
 * (see api/brandLogo.js), but jsPDF cannot fetch one and pptxgenjs would fail
 * mid-write, so the caller resolves it to bytes first. Anything else returns
 * null and the cover renders without it - never a broken image box.
 */
export function usableLogo(src) {
  if (typeof src !== 'string') return null
  const s = src.trim()
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(s) ? s : null
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
 * @param {string}   [opts.logo]          company logo as a data:image URI
 * @param {boolean}  [opts.save]          write the file (default true)
 * @returns {Promise<{ pptx, slides:Array, filename:string }>}
 */
export async function renderDisposalDeckPptx({
  deck: deckIn = null, config = null, ctx = null,
  company = null, country = null, filename = null,
  chartImageFor = null, logo = null, save = true,
} = {}) {
  const deck = resolveDeck(deckIn, config, ctx)
  const comp = company || deck.company || 'TyrePulse'
  const ctry = country || deck.country || ''
  const currency = deck.currency || 'SAR'
  const stamp = reportDateLabel()
  const logoSrc = usableLogo(logo)

  const PptxGen = await ensurePptx()
  const pptx = new PptxGen()
  // The theme geometry is 13.333 wide; define that canvas so a cover measured in
  // those inches lands exactly, and fall back to the stock wide layout if an
  // older build will not take a custom one.
  let laidOut = false
  try {
    pptx.defineLayout({ name: 'TP_WIDE', width: PAGE_W, height: PAGE_H })
    pptx.layout = 'TP_WIDE'
    laidOut = true
  } catch { laidOut = false }
  if (!laidOut) pptx.layout = 'LAYOUT_WIDE'
  pptx.theme = { headFontFace: TITLE_FONT, bodyFontFace: BODY_FONT }
  const ChartType = pptx.ChartType || {}
  const rect = (pptx.ShapeType && pptx.ShapeType.rect) || 'rect'
  const stepShape = (pptx.ShapeType && pptx.ShapeType.flowChartManualInput) || null

  const out = []
  const newSlide = () => { const s = pptx.addSlide(); s.background = { color: BG }; return s }
  const footer = (s) => {
    const n = out.length + 1
    s.addText(footerLine(deck), { x: MX, y: SLIDE.footerY, w: 9.5, h: 0.3, fontSize: SLIDE.footerSize, fontFace: BODY_FONT, color: MUTED })
    s.addText(`Slide ${n}`, { x: PAGE_W - MX - 1.4, y: SLIDE.footerY, w: 1.4, h: 0.3, fontSize: SLIDE.footerSize, fontFace: BODY_FONT, color: MUTED, align: 'right' })
  }
  /**
   * The section heading: a small green eyebrow over a navy title, on the open
   * page. No rule, no bar - the house motif is the stepped panel and the tinted
   * callout, and an accent stripe under a title is exactly the filler this deck
   * must not look like.
   */
  const eyebrowText = [comp, ctry].filter((v) => v && String(v).trim()).join('  |  ').toUpperCase()
  const header = (s, title, sub) => {
    s.addText(eyebrowText, {
      x: MX, y: SLIDE.headingY - 0.28, w: CONTENT_W, h: 0.26, margin: 0,
      fontSize: SLIDE.eyebrowSize, fontFace: BODY_FONT, bold: true, color: BRAND.green, charSpacing: 1.5,
    })
    s.addText(String(title || ''), {
      x: MX, y: SLIDE.headingY, w: CONTENT_W, h: 0.52, margin: 0,
      fontSize: SLIDE.headingSize, fontFace: TITLE_FONT, bold: true, color: BRAND.navy, valign: 'top',
    })
    if (sub) {
      s.addText(String(sub), {
        x: MX, y: SLIDE.subheadY, w: CONTENT_W, h: 0.3, margin: 0,
        fontSize: TYPE.small, fontFace: BODY_FONT, color: SUBTLE, valign: 'top',
      })
    }
  }
  const emptyNote = (s, text) => {
    s.addText(String(text || 'No data for this slide.'), {
      x: MX + 1.2, y: 3.0, w: CONTENT_W - 2.4, h: 0.9, fontSize: TYPE.subhead, fontFace: BODY_FONT,
      italic: true, color: MUTED, align: 'center', valign: 'middle',
    })
  }
  /** A quiet card, the one container this deck uses to group content. */
  const card = (s, x, y, w, h, fill = CARD) => {
    s.addShape(rect, { x, y, w, h, fill: { color: fill }, line: { color: BORDER, width: 1 } })
  }
  /**
   * A headline callout. This is the house motif on a content slide - a tinted
   * card, never an edge bar - and the tint says whether the line states a
   * finding (blue) or the limit that bounds it (amber).
   */
  const headlineCallout = (s, y, text, tone) => {
    const str = String(text || '')
    const lines = Math.max(1, Math.ceil(str.length / 130))
    const h = 0.36 + 0.2 * (lines - 1)
    const limit = tone === 'limit'
    card(s, MX, y, CONTENT_W, h, limit ? BRAND.tintAmber : BRAND.tintBlue)
    s.addText(str, {
      x: MX + 0.16, y, w: CONTENT_W - 0.32, h, margin: 0,
      fontSize: TYPE.body, fontFace: BODY_FONT, color: limit ? WARN : BRAND.navy, valign: 'middle',
    })
    return y + h + 0.12
  }
  /**
   * The three white steps that make the company cover's soft edge. In PowerPoint
   * they are flowChartManualInput shapes turned a quarter turn; the geometry in
   * COVER.steps is the FOOTPRINT after that turn, so the pre-rotation box has
   * its width and height swapped about the same centre.
   */
  const drawSteps = (s) => {
    for (const st of COVER.steps) {
      if (!stepShape) {
        s.addShape(rect, { x: st.x, y: st.y, w: st.w, h: st.h, fill: { color: BRAND.panelWhite } })
        continue
      }
      const cx = st.x + st.w / 2
      const cy = st.y + st.h / 2
      s.addShape(stepShape, {
        x: cx - st.h / 2, y: cy - st.w / 2, w: st.h, h: st.w,
        rotate: 270, flipH: true, fill: { color: BRAND.panelWhite },
      })
    }
  }
  /** The company cover. Renders whole with or without a logo. */
  const coverSlide = (title, subtitle, assetCount, showDate) => {
    const s = pptx.addSlide()
    s.background = { color: BRAND.panelWhite }
    s.addShape(rect, { x: COVER.panel.x, y: COVER.panel.y, w: COVER.panel.w, h: COVER.panel.h, fill: { color: BRAND.panelTint } })
    drawSteps(s)
    // The green panel carries the one figure the whole deck is about, rather
    // than decoration standing in for the company illustration we do not have.
    s.addText(String(assetCount), {
      x: COVER.art.x + 0.3, y: COVER.art.y + 0.5, w: COVER.art.w - 0.6, h: 1.9, margin: 0,
      fontSize: 96, fontFace: TITLE_FONT, bold: true, color: BRAND.greenDeep, valign: 'bottom',
    })
    s.addText('assets proposed for disposal', {
      x: COVER.art.x + 0.3, y: COVER.art.y + 2.45, w: COVER.art.w - 0.6, h: 0.4, margin: 0,
      fontSize: 16, fontFace: BODY_FONT, color: BRAND.greenDeep, valign: 'top',
    })
    if (logoSrc) {
      try {
        s.addImage({
          data: logoSrc, x: COVER.logo.x, y: COVER.logo.y, w: COVER.logo.maxW, h: COVER.logo.maxH,
          sizing: { type: 'contain', w: COVER.logo.maxW, h: COVER.logo.maxH },
        })
      } catch { /* a cover without a logo is still a cover */ }
    }
    s.addText(String(title || 'Asset Disposal Proposal'), {
      x: COVER.title.x, y: COVER.title.y, w: COVER.title.w, h: 0.52, margin: 0,
      fontSize: COVER.title.size, fontFace: TITLE_FONT, bold: true, color: BRAND.green, valign: 'top',
    })
    const sub = [subtitle, ctry].filter((v) => v && String(v).trim()).join('  |  ')
    if (sub) {
      s.addText(sub, {
        x: COVER.subtitle.x, y: COVER.subtitle.y, w: COVER.subtitle.w, h: 0.36, margin: 0,
        fontSize: COVER.subtitle.size, fontFace: BODY_FONT, color: SUBTLE, valign: 'top',
      })
    }
    let cy = COVER.subtitle.y + 0.52
    const cav = valuationCaveat(deck)
    if (cav) {
      s.addText(cav, {
        x: COVER.title.x, y: cy, w: COVER.title.w, h: 0.72, margin: 0,
        fontSize: TYPE.caption, fontFace: BODY_FONT, italic: true, color: WARN, valign: 'top',
      })
      cy += 0.78
    }
    const reg = registerCaveat(deck)
    if (reg && cy < COVER.meta.y - 0.7) {
      s.addText(reg, {
        x: COVER.title.x, y: cy, w: COVER.title.w, h: 0.6, margin: 0,
        fontSize: TYPE.caption, fontFace: BODY_FONT, italic: true, color: WARN, valign: 'top',
      })
    }
    s.addText(coverMeta({ company: comp, country: ctry, generated: showDate ? `Prepared ${stamp}` : null }), {
      x: COVER.meta.x, y: COVER.meta.y, w: COVER.meta.w, h: 0.3, margin: 0,
      fontSize: COVER.meta.size, fontFace: BODY_FONT, color: MUTED, valign: 'top',
    })
    return s
  }

  const imageFor = (slide) => {
    try { return (chartImageFor && chartImageFor(slide)) || null } catch { return null }
  }

  // Every deck opens on the company cover. A deck whose own first block is a
  // title slide uses that block's wording; one that has no title block gets a
  // cover from the deck's own title, so the pack never opens mid-argument.
  if (deck.slides[0]?.kind !== 'title') {
    out.push(coverSlide(deck.title || 'Asset Disposal', '', deck.assetCount || 0, true))
  }

  for (const slide of deck.slides) {
    // ── Title / cover ──
    if (slide.kind === 'title') {
      out.push(coverSlide(slide.title, slide.subtitle, slide.assetCount, slide.showDate))
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
      // Size the card to what it holds, then centre the grid in the body. A card
      // stretched to fill the page around one figure reads as a slide that lost
      // something.
      const noteLines = items.reduce((m, k) => Math.max(m, estLines(k.note, cardW - 0.36, TYPE.caption - 1)), 0)
      const avail = PAGE_H - 1.15 - SLIDE.bodyTop
      // Fit to content, then to the page: three rows of full-height cards would
      // otherwise run under the basis line.
      const cardH = Math.min(1.72, 1.05 + (noteLines ? 0.18 + 0.16 * noteLines : 0), (avail - gap * (rows - 1)) / rows)
      const gridH = rows * cardH + gap * (rows - 1)
      const gridTop = SLIDE.bodyTop + Math.max(0, (avail - gridH) / 2)
      items.forEach((k, i) => {
        const col = i % perRow
        const r = Math.floor(i / perRow)
        const x = MX + col * (cardW + gap)
        const y = gridTop + r * (cardH + gap)
        const soft = k.unmeasured || isUnmeasured(k.value)
        // The tint carries what kind of figure this is: amber where a valuation
        // is missing, the quiet page grey where nothing could be measured, the
        // house green tint for a figure that rests on real data.
        const tint = soft ? BRAND.surface : (k.valuation ? BRAND.tintAmber : BRAND.tintGreen)
        card(s, x, y, cardW, cardH, tint)
        s.addText(String(k.label).toUpperCase(), {
          x: x + 0.18, y: y + 0.14, w: cardW - 0.36, h: 0.28, margin: 0,
          fontSize: TYPE.statLabel, fontFace: BODY_FONT, bold: true, color: SUBTLE, charSpacing: 1,
        })
        s.addText(String(k.value), {
          x: x + 0.18, y: y + 0.44, w: cardW - 0.36, h: 0.58, margin: 0,
          fontSize: k.valuation || soft ? 20 : TYPE.stat, fontFace: TITLE_FONT, bold: true,
          italic: soft, valign: 'top',
          color: soft ? MUTED : (k.valuation ? WARN : BRAND.navy),
        })
        if (k.note) {
          s.addText(String(k.note), {
            x: x + 0.18, y: y + 1.0, w: cardW - 0.36, h: Math.max(0.22, cardH - 1.06), margin: 0,
            fontSize: TYPE.caption - 1, fontFace: BODY_FONT, color: SUBTLE, valign: 'top',
          })
        }
      })
      // Reliability slides carry their own basis; everything else carries the
      // standing valuation caveat. A basis line stays quiet; a caveat does not.
      const kNotes = Array.isArray(slide.notes) ? slide.notes.filter(Boolean) : []
      const bottom = kNotes.length ? kNotes.join('  ') : valuationCaveat(deck)
      if (bottom) {
        s.addText(String(bottom), {
          x: MX, y: PAGE_H - 0.98, w: CONTENT_W, h: 0.52, margin: 0, valign: 'top',
          fontSize: BASIS_STYLE.size, fontFace: BODY_FONT, italic: BASIS_STYLE.italic,
          color: kNotes.length ? BASIS_STYLE.color : WARN,
        })
      }
      footer(s); out.push(s)
      continue
    }

    // ── Recommendations, grouped by priority ──
    if (slide.kind === 'recommendations') {
      const s = newSlide()
      header(s, slide.title, `${slide.count} recommendation${slide.count === 1 ? '' : 's'} in all, each one carrying the figures it rests on`)
      if (slide.empty) { emptyNote(s, slide.emptyNote); footer(s); out.push(s); continue }
      let y = SLIDE.bodyTop
      const recBottom = PAGE_H - 0.72
      for (const g of slide.groups) {
        if (y > recBottom - 0.5) break
        const w = Math.max(1.1, 0.09 * priorityText(g).length + 0.3)
        s.addShape(rect, { x: MX, y, w, h: 0.26, fill: { color: PRIORITY_HEX[g.priority] || SUBTLE } })
        s.addText(priorityText(g), {
          x: MX + 0.05, y, w: w - 0.1, h: 0.26, margin: 0, fontSize: 8, fontFace: BODY_FONT,
          bold: true, color: 'FFFFFF', charSpacing: 1, valign: 'middle',
        })
        y += 0.34
        for (const it of g.items) {
          if (y > recBottom - 0.3) break
          const titleH = 0.28 * estLines(it.title, CONTENT_W - 0.16, TYPE.body)
          s.addText(String(it.title), {
            x: MX + 0.08, y, w: CONTENT_W - 0.16, h: titleH, margin: 0,
            fontSize: TYPE.body, fontFace: BODY_FONT, bold: true, color: BRAND.navy, valign: 'top',
          })
          y += titleH
          if (it.detail) {
            const detH = Math.min(0.78, 0.2 + 0.135 * Math.ceil(String(it.detail).length / 150))
            s.addText(String(it.detail), {
              x: MX + 0.2, y, w: CONTENT_W - 0.3, h: detH, margin: 0,
              fontSize: TYPE.small, fontFace: BODY_FONT, color: SUBTLE, valign: 'top',
            })
            y += detH
          }
          const ev = Array.isArray(it.evidence) ? it.evidence.filter(Boolean) : (it.evidence ? [it.evidence] : [])
          if (slide.showEvidence && ev.length && y < recBottom - 0.2) {
            const evH = Math.min(0.6, 0.16 + 0.14 * ev.length)
            s.addText(ev.map((t) => ({ text: String(t), options: { bullet: { code: '2022' }, fontSize: TYPE.caption, fontFace: BODY_FONT, color: MUTED, paraSpaceAfter: 1 } })), {
              x: MX + 0.32, y, w: CONTENT_W - 0.42, h: evH, valign: 'top', margin: 0,
            })
            y += evH
          }
          y += 0.1
        }
        y += 0.08
      }
      footer(s); out.push(s)
      continue
    }

    // ── This list against the rest of the fleet ──
    if (slide.kind === 'comparison') {
      const s = newSlide()
      header(s, slide.title, slide.country ? `Country: ${slide.country}` : '')
      if (slide.empty) { emptyNote(s, 'The fleet baseline was not supplied, so this comparison could not be produced.'); footer(s); out.push(s); continue }
      let y = SLIDE.bodyTop
      for (const h of slide.headlines) y = headlineCallout(s, y, h.text, h.tone)
      y += 0.08
      const head2 = ['Measure', slide.onLabel, slide.restLabel, 'Ratio'].map((t, i) => ({
        text: t,
        options: { bold: true, color: 'FFFFFF', fill: { color: HEAD_FILL }, fontSize: 9, fontFace: BODY_FONT, align: i ? 'right' : 'left' },
      }))
      const body2 = slide.metrics.map((m) => {
        const tag = m.trust ? '  (read this one)' : (m.confounded ? '  (confounded)' : '')
        const tone = m.confounded ? MUTED : (m.trust ? BRAND.navy : SUBTLE)
        return [
          { text: `${m.label}${tag}`, options: { fontSize: 9, fontFace: BODY_FONT, color: tone, bold: !!m.trust } },
          { text: String(m.onList), options: { fontSize: 9, fontFace: BODY_FONT, color: tone, align: 'right', bold: !!m.trust } },
          { text: String(m.rest), options: { fontSize: 9, fontFace: BODY_FONT, color: tone, align: 'right' } },
          { text: String(m.ratio || ''), options: { fontSize: 9, fontFace: BODY_FONT, color: m.trust ? WARN : SUBTLE, align: 'right', bold: !!m.trust } },
        ]
      })
      const cFit = fitRows(body2.length + 1, y, PAGE_H - 1.6, 0.3)
      s.addTable([head2, ...body2], {
        x: MX, y, w: CONTENT_W, colW: [CONTENT_W * 0.42, CONTENT_W * 0.2, CONTENT_W * 0.2, CONTENT_W * 0.18],
        border: { type: 'solid', color: BORDER, pt: 0.5 }, rowH: cFit.rowH, valign: 'middle', autoPage: false,
      })
      y += cFit.rowH * (body2.length + 1) + 0.18
      if (slide.confound && y < PAGE_H - 1.2) {
        card(s, MX, y, CONTENT_W, 0.72, BRAND.tintAmber)
        s.addText(String(slide.confound), {
          x: MX + 0.16, y, w: CONTENT_W - 0.32, h: 0.72, margin: 0,
          fontSize: TYPE.small, fontFace: BODY_FONT, color: WARN, valign: 'middle',
        })
      }
      footer(s); out.push(s)
      continue
    }

    // ── What a new machine costs ──
    if (slide.kind === 'replacement') {
      const s = newSlide()
      header(s, slide.title)
      if (slide.empty) { emptyNote(s, slide.emptyNote); footer(s); out.push(s); continue }
      let y = SLIDE.bodyTop
      // The exposure line and the line that bounds it, in that order. A board
      // shown the total without the unpriced count reads it as the whole bill.
      for (const h of slide.headlines) y = headlineCallout(s, y, h.text, h.tone)
      y += 0.08
      const cols = slide.columns
      const totalW = cols.reduce((a, c) => a + (c.width || 1), 0) || 1
      const colW = cols.map((c) => (CONTENT_W * (c.width || 1)) / totalW)
      const rTableBottom = PAGE_H - 1.45
      const rFit = fitRows(slide.rows.length + 1, y, rTableBottom, 0.29, 8.5)
      const head2 = cols.map((c) => ({
        text: c.header,
        options: { bold: true, color: 'FFFFFF', fill: { color: HEAD_FILL }, fontSize: rFit.fs, fontFace: BODY_FONT, align: c.align === 'right' ? 'right' : 'left' },
      }))
      const body2 = slide.rows.map((r, ri) => r.map((cell, ci) => ({
        text: String(cell),
        options: {
          fontSize: rFit.fs, fontFace: BODY_FONT, valign: 'middle', align: cols[ci]?.align === 'right' ? 'right' : 'left',
          color: cellTone(cell).hex, italic: isUnmeasured(cell),
          fill: { color: ri % 2 ? BRAND.surface : CARD },
        },
      })))
      s.addTable([head2, ...body2], {
        x: MX, y, w: CONTENT_W, colW,
        border: { type: 'solid', color: BORDER, pt: 0.5 }, rowH: rFit.rowH, valign: 'middle', autoPage: false,
      })
      y += rFit.rowH * (body2.length + 1) + 0.12
      const rnotes = Array.isArray(slide.notes) ? slide.notes.filter(Boolean) : []
      if (rnotes.length && y < PAGE_H - 1.0) {
        s.addText(rnotes.join('  '), {
          x: MX, y, w: CONTENT_W, h: Math.min(0.7, 0.2 + 0.19 * rnotes.length), margin: 0,
          fontSize: BASIS_STYLE.size, fontFace: BODY_FONT, italic: BASIS_STYLE.italic, color: BASIS_STYLE.color, valign: 'top',
        })
      }
      s.addText(String(slide.caption || ''), {
        x: MX, y: PAGE_H - 0.78, w: CONTENT_W, h: 0.3, margin: 0,
        fontSize: TYPE.caption, fontFace: BODY_FONT, color: MUTED,
      })
      footer(s); out.push(s)
      continue
    }

    // ── Findings ──
    if (slide.kind === 'findings') {
      const s = newSlide()
      header(s, slide.title)
      if (slide.empty) emptyNote(s, slide.emptyNote)
      else {
        // Sized to the bullets, capped at the page.
        const lines = slide.bullets.reduce((n, t) => n + estLines(t, CONTENT_W - 0.9, TYPE.subhead), 0)
        const bodyH = Math.min(PAGE_H - 0.72 - SLIDE.bodyTop, 0.5 + lines * 0.29 + slide.bullets.length * 0.14)
        card(s, MX, SLIDE.bodyTop, CONTENT_W, bodyH)
        s.addText(slide.bullets.map((t) => ({
          text: String(t),
          options: { bullet: { code: '2022' }, color: SUBTLE, fontSize: TYPE.subhead, fontFace: BODY_FONT, paraSpaceAfter: 10 },
        })), { x: MX + 0.3, y: SLIDE.bodyTop + 0.2, w: CONTENT_W - 0.6, h: bodyH - 0.4, valign: 'top', margin: 0 })
      }
      footer(s); out.push(s)
      continue
    }

    // ── Chart (one per slide, deliberately) ──
    if (slide.kind === 'chart') {
      const s = newSlide()
      header(s, slide.title, slide.note)
      if (slide.empty) { emptyNote(s, slide.emptyNote); footer(s); out.push(s); continue }
      const top = SLIDE.bodyTop
      const h = (slide.digest ? PAGE_H - 1.15 : PAGE_H - 0.8) - top
      card(s, MX, top, CONTENT_W, h)
      let drew = false
      const img = imageFor(slide)
      if (img) {
        try { s.addImage({ data: img, x: MX + 0.12, y: top + 0.12, w: CONTENT_W - 0.24, h: h - 0.24, sizing: { type: 'contain', w: CONTENT_W - 0.24, h: h - 0.24 } }); drew = true } catch { drew = false }
      }
      if (!drew) {
        // Native, editable pptx chart: the right output for a headless caller.
        const colors = deckSeriesColors(slide.labels.length)
        const series = [{ name: slide.title || 'Value', labels: slide.labels.map((l) => String(l || 'N/A')), values: slide.values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)) }]
        const isDoughnut = slide.viz === 'doughnut'
        try {
          s.addChart(
            isDoughnut ? ChartType.doughnut : (slide.viz === 'line' ? ChartType.line : ChartType.bar),
            series,
            {
              x: MX + 0.16, y: top + 0.16, w: CONTENT_W - 0.32, h: h - 0.32,
              chartColors: colors,
              showLegend: isDoughnut, legendPos: 'r', legendColor: SUBTLE, legendFontSize: 9, legendFontFace: BODY_FONT,
              showValue: true, dataLabelColor: BRAND.navy, dataLabelFontSize: 9, dataLabelFontBold: true, dataLabelFontFace: BODY_FONT,
              catAxisLabelColor: SUBTLE, catAxisLabelFontSize: 9, catAxisLabelFontFace: BODY_FONT,
              valAxisLabelColor: MUTED, valAxisLabelFontSize: 9, valAxisLabelFontFace: BODY_FONT,
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
          head.map((t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: HEAD_FILL }, fontSize: 10, fontFace: BODY_FONT } })),
          ...body.slice(0, 12).map((r) => r.map((t) => ({ text: t, options: { fontSize: 10, fontFace: BODY_FONT, color: SUBTLE } }))),
        ], { x: MX + 0.2, y: top + 0.2, w: CONTENT_W * 0.6, colW: [CONTENT_W * 0.38, CONTENT_W * 0.22], border: { type: 'solid', color: BORDER, pt: 0.5 }, rowH: 0.3 })
      }
      if (slide.digest) {
        s.addText(String(slide.digest), {
          x: MX, y: top + h + 0.1, w: CONTENT_W, h: 0.3, margin: 0,
          fontSize: BASIS_STYLE.size, fontFace: BODY_FONT, italic: BASIS_STYLE.italic, color: BASIS_STYLE.color,
        })
      }
      footer(s); out.push(s)
      continue
    }

    // ── Table (already paginated by the engine) ──
    if (slide.kind === 'table') {
      const s = newSlide()
      header(s, slide.title)
      if (slide.empty) {
        emptyNote(s, slide.emptyNote)
        s.addText(String(slide.caption || ''), { x: MX, y: PAGE_H - 0.78, w: CONTENT_W, h: 0.3, margin: 0, fontSize: TYPE.caption, fontFace: BODY_FONT, color: MUTED })
        footer(s); out.push(s); continue
      }
      const cols = slide.columns
      const totalW = cols.reduce((a, c) => a + (c.width || 1), 0) || 1
      const colW = cols.map((c) => (CONTENT_W * (c.width || 1)) / totalW)
      const compact = slide.density === 'compact'
      // The caveats a reliability table must never travel without.
      const notes = Array.isArray(slide.notes) ? slide.notes.filter(Boolean) : []
      const noteH = notes.length ? Math.min(0.86, 0.2 + 0.19 * notes.length) : 0
      const tTop = SLIDE.bodyTop - 0.2
      const tFit = fitRows(slide.rows.length + 1, tTop, PAGE_H - 0.92 - noteH, compact ? 0.3 : 0.34, compact ? 8 : 9)
      const fs = tFit.fs
      const head = cols.map((c) => ({ text: c.header, options: { bold: true, color: 'FFFFFF', fill: { color: HEAD_FILL }, fontSize: fs, fontFace: BODY_FONT, align: 'center', valign: 'middle' } }))
      const body = slide.rows.map((r, ri) => r.map((cell, ci) => {
        // A row for a machine that is not in the register is flagged in place, a
        // figure that could not be measured is toned back, and a banded
        // reliability cell takes its band's tone.
        const tone = cellTone(cell, slide.cellBands?.[ri]?.[ci])
        return {
          text: String(cell),
          options: {
            fontSize: fs, fontFace: BODY_FONT, valign: 'middle', align: cols[ci]?.align === 'right' ? 'right' : 'left',
            color: tone.hex, bold: tone.bold,
            italic: isUnmeasured(cell),
            fill: { color: ri % 2 ? BRAND.surface : CARD },
          },
        }
      }))
      s.addTable([head, ...body], {
        x: MX, y: tTop, w: CONTENT_W, colW,
        border: { type: 'solid', color: BORDER, pt: 0.5 },
        rowH: tFit.rowH, valign: 'middle', autoPage: false,
      })
      if (notes.length) {
        s.addText(notes.join('  '), {
          x: MX, y: PAGE_H - 0.82 - noteH, w: CONTENT_W, h: noteH, margin: 0,
          fontSize: BASIS_STYLE.size, fontFace: BODY_FONT, italic: BASIS_STYLE.italic, color: BASIS_STYLE.color, valign: 'top',
        })
      }
      s.addText(String(slide.caption || ''), { x: MX, y: PAGE_H - 0.78, w: CONTENT_W, h: 0.3, margin: 0, fontSize: TYPE.caption, fontFace: BODY_FONT, color: MUTED })
      footer(s); out.push(s)
      continue
    }

    // ── One machine per slide ──
    if (slide.kind === 'asset') {
      const s = newSlide()
      header(s, slide.title, slide.subtitle)
      let y = SLIDE.bodyTop
      if (slide.flags.length) {
        const fh = 0.34
        card(s, MX, y, CONTENT_W, fh, BRAND.tintAmber)
        s.addText(slide.flags.join('   |   '), {
          x: MX + 0.16, y, w: CONTENT_W - 0.32, h: fh, margin: 0,
          fontSize: TYPE.small, fontFace: BODY_FONT, bold: true, color: WARN, valign: 'middle',
        })
        y += fh + 0.14
      }
      // Facts, two columns of label/value pairs on the house card.
      const half = Math.ceil(slide.facts.length / 2)
      const colGap = 0.4
      const colW = (CONTENT_W - colGap) / 2
      const factsH = half * 0.29 + 0.3
      card(s, MX, y, CONTENT_W, factsH)
      const fTop = y + 0.15
      slide.facts.forEach((f, i) => {
        const col = i < half ? 0 : 1
        const rowI = i < half ? i : i - half
        const x = MX + 0.16 + col * (colW + colGap)
        const fy = fTop + rowI * 0.29
        s.addText(String(f.label), { x, y: fy, w: colW * 0.44, h: 0.27, margin: 0, fontSize: 9, fontFace: BODY_FONT, color: MUTED, valign: 'middle' })
        s.addText(String(f.value), {
          x: x + colW * 0.44, y: fy, w: colW * 0.52, h: 0.27, margin: 0, fontSize: 9.5, fontFace: BODY_FONT, bold: true,
          valign: 'middle', color: f.value === 'Not valued' ? WARN : BRAND.navy,
        })
      })
      let by = y + factsH + 0.2
      // The machine's own reliability record, with the caveats it rests on.
      const relList = Array.isArray(slide.reliability) ? slide.reliability : []
      const sectionLabel = (text, ly) => {
        s.addText(String(text), {
          x: MX, y: ly, w: CONTENT_W, h: 0.26, margin: 0,
          fontSize: TYPE.caption, fontFace: BODY_FONT, bold: true, color: BRAND.green, charSpacing: 1,
        })
      }
      if (relList.length && by < 5.9) {
        sectionLabel('RELIABILITY RECORD', by)
        by += 0.28
        s.addText(
          relList.map((f, i) => ([
            { text: `${f.label}: `, options: { fontSize: 9, fontFace: BODY_FONT, color: MUTED } },
            { text: String(f.value), options: { fontSize: 9, fontFace: BODY_FONT, bold: !isUnmeasured(f.value), color: isUnmeasured(f.value) ? MUTED : BRAND.navy, italic: isUnmeasured(f.value) } },
            ...(i < relList.length - 1 ? [{ text: '   |   ', options: { fontSize: 9, fontFace: BODY_FONT, color: BORDER } }] : []),
          ])).flat(),
          { x: MX, y: by, w: CONTENT_W, h: 0.44, valign: 'top', margin: 0 },
        )
        by += 0.48
        const rn = Array.isArray(slide.reliabilityNotes) ? slide.reliabilityNotes.filter(Boolean) : []
        if (rn.length && by < 6.2) {
          s.addText(rn.join('  '), {
            x: MX, y: by, w: CONTENT_W, h: 0.34, margin: 0,
            fontSize: BASIS_STYLE.size, fontFace: BODY_FONT, italic: BASIS_STYLE.italic, color: BASIS_STYLE.color, valign: 'top',
          })
          by += 0.38
        }
      } else if (slide.reliabilityNote && by < 6.2) {
        s.addText(String(slide.reliabilityNote), {
          x: MX, y: by, w: CONTENT_W, h: 0.28, margin: 0,
          fontSize: TYPE.small, fontFace: BODY_FONT, italic: true, color: MUTED,
        })
        by += 0.32
      }
      // Committee remarks, verbatim.
      if (slide.remarks.length && by < 6.2) {
        sectionLabel('COMMITTEE REMARKS', by)
        by += 0.28
        const remH = Math.min(1.5, 0.22 * slide.remarks.length + 0.1)
        s.addText(slide.remarks.map((t) => ({ text: String(t), options: { bullet: { code: '2022' }, fontSize: 10, fontFace: BODY_FONT, color: SUBTLE, paraSpaceAfter: 2 } })), { x: MX + 0.08, y: by, w: CONTENT_W - 0.16, h: remH, valign: 'top', margin: 0 })
        by += remH + 0.1
      }
      // Tyres still fitted.
      if (slide.tyres.length && by < 6.1) {
        sectionLabel(`TYRES STILL FITTED (${slide.tyres.length})`, by)
        by += 0.28
        const shown = slide.tyres.slice(0, Math.max(1, Math.min(6, Math.floor((PAGE_H - 0.9 - by) / 0.26) - 1)))
        const th = [['Serial', 'Position', 'Brand', 'Size', 'Km'].map((t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: HEAD_FILL }, fontSize: 8, fontFace: BODY_FONT } }))]
        const tb = shown.map((t) => [t.serial, t.position, t.brand, t.size, t.km].map((v) => ({ text: String(v), options: { fontSize: 8, fontFace: BODY_FONT, color: SUBTLE } })))
        s.addTable([...th, ...tb], { x: MX, y: by, w: CONTENT_W * 0.72, colW: [CONTENT_W * 0.22, CONTENT_W * 0.14, CONTENT_W * 0.16, CONTENT_W * 0.12, CONTENT_W * 0.08], border: { type: 'solid', color: BORDER, pt: 0.5 }, rowH: 0.26 })
        if (slide.tyres.length > shown.length) {
          s.addText(`and ${slide.tyres.length - shown.length} more, see the tyre recovery list`, {
            x: MX, y: Math.min(PAGE_H - 0.78, by + 0.26 * (shown.length + 1) + 0.05), w: CONTENT_W, h: 0.26, margin: 0,
            fontSize: 8, fontFace: BODY_FONT, italic: true, color: MUTED,
          })
        }
      } else if (!slide.tyres.length && by < 6.6) {
        s.addText(slide.tyreNote, { x: MX, y: by, w: CONTENT_W, h: 0.28, margin: 0, fontSize: 9, fontFace: BODY_FONT, italic: true, color: MUTED })
      }
      s.addText(`Asset ${slide.index} of ${slide.count}`, { x: PAGE_W - MX - 3, y: SLIDE.footerY, w: 1.6, h: 0.3, margin: 0, fontSize: SLIDE.footerSize, fontFace: BODY_FONT, color: MUTED, align: 'right' })
      footer(s); out.push(s)
      continue
    }

    // ── Free text ──
    if (slide.kind === 'text') {
      const s = newSlide()
      header(s, slide.title)
      const textH = Math.min(
        PAGE_H - 0.72 - SLIDE.bodyTop,
        0.5 + estLines(slide.body, CONTENT_W - 0.6, TYPE.subhead) * 0.3,
      )
      card(s, MX, SLIDE.bodyTop, CONTENT_W, textH)
      s.addText(String(slide.body || 'N/A'), {
        x: MX + 0.3, y: SLIDE.bodyTop + 0.22, w: CONTENT_W - 0.6, h: textH - 0.44, margin: 0,
        fontSize: TYPE.subhead, fontFace: BODY_FONT, color: SUBTLE, valign: 'top',
      })
      footer(s); out.push(s)
      continue
    }

    // ── Divider ──
    if (slide.kind === 'divider') {
      // The cover's stepped panel again, at section scale - the house motif,
      // rather than a rule across the page.
      const s = pptx.addSlide()
      s.background = { color: BRAND.panelTint }
      drawSteps(s)
      s.addText(eyebrowText, {
        x: MX, y: 3.05, w: 5.5, h: 0.3, margin: 0,
        fontSize: SLIDE.eyebrowSize, fontFace: BODY_FONT, bold: true, color: BRAND.greenDeep, charSpacing: 1.5,
      })
      s.addText(String(slide.label || '').toUpperCase(), {
        x: MX, y: 3.4, w: 5.5, h: 0.7, margin: 0,
        fontSize: 26, fontFace: TITLE_FONT, bold: true, color: BRAND.greenDeep, valign: 'top',
      })
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
  chartImageFor = null, logo = null, save = true,
} = {}) {
  const deck = resolveDeck(deckIn, config, ctx)
  const comp = company || deck.company || 'TyrePulse'
  const ctry = country || deck.country || ''
  const stamp = reportDateLabel()
  const logoSrc = usableLogo(logo)

  const { jsPDF, autoTable } = await loadPdf()
  const orientation = deck.orientation === 'portrait' ? 'portrait' : 'landscape'
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true })
  const PW = doc.internal.pageSize.width
  const PH = doc.internal.pageSize.height
  const M = 14
  const CW = PW - M * 2
  // The theme's cover is measured on a 13.333 x 7.5 canvas; A4 is a different
  // shape, so each axis is scaled on its own. The stepped panel survives that;
  // a logo is fitted by its real aspect instead (see coverPage).
  const sx = PW / PAGE.w
  const sy = PH / PAGE.h

  let first = true
  const page = () => { if (!first) doc.addPage(); first = false }
  const setInk = (c) => doc.setTextColor(c[0], c[1], c[2])
  const fill = (c) => doc.setFillColor(c[0], c[1], c[2])

  /** The section heading: green eyebrow over a navy title, no rule. */
  const eyebrowText = [comp, ctry].filter((v) => v && String(v).trim()).join('  |  ').toUpperCase()
  const heading = (title, sub) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setInk(BRAND_RGB.green)
    doc.text(eyebrowText, M, 11)
    doc.setFontSize(15); setInk(BRAND_RGB.navy)
    doc.text(doc.splitTextToSize(String(title || ''), CW)[0], M, 18.5)
    if (sub) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); setInk(RGB.subtle)
      doc.text(doc.splitTextToSize(String(sub), CW)[0], M, 24)
      return 31
    }
    return 27
  }
  const emptyAt = (y, text) => {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(11); setInk(RGB.muted)
    doc.text(doc.splitTextToSize(String(text || 'No data for this slide.'), CW - 40), M + 20, y + 14)
  }
  /** The house card. */
  const cardAt = (x, y, w, h, colorHex) => {
    fill(colorHex ? rgbOf(colorHex) : [255, 255, 255])
    doc.setDrawColor(...RGB.border); doc.setLineWidth(0.3)
    doc.rect(x, y, w, h, 'FD')
  }
  /** A headline callout, the tinted card the pptx side draws. */
  const calloutAt = (y, text, tone) => {
    const limit = tone === 'limit'
    const lines = doc.splitTextToSize(String(text), CW - 8)
    const h = lines.length * 4.4 + 4
    cardAt(M, y, CW, h, limit ? BRAND.tintAmber : BRAND.tintBlue)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    setInk(limit ? RGB.warn : BRAND_RGB.navy)
    lines.forEach((ln, i) => doc.text(ln, M + 4, y + 5.5 + i * 4.4))
    return y + h + 3
  }

  const imageFor = async (slide) => {
    try {
      const live = chartImageFor && chartImageFor(slide)
      if (live) return live
    } catch { /* fall through to the offscreen render */ }
    return renderOffscreenChart(slide, { widthPt: Math.round(CW * 2.4), aspect: 0.46 })
  }

  /** The company cover, the same composition the pptx draws. */
  const coverPage = (title, subtitle, assetCount, showDate) => {
    fill([255, 255, 255]); doc.rect(0, 0, PW, PH, 'F')
    fill(rgbOf(BRAND.panelTint))
    doc.rect(COVER.panel.x * sx, COVER.panel.y * sy, COVER.panel.w * sx, COVER.panel.h * sy, 'F')
    // jsPDF has no rotated flow-chart shape, so the three steps are the same
    // three rectangles: the step is the only part a reader notices.
    fill([255, 255, 255])
    for (const st of COVER.steps) doc.rect(st.x * sx, st.y * sy, st.w * sx, st.h * sy, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(60); setInk(BRAND_RGB.greenDeep)
    doc.text(String(assetCount), (COVER.art.x + 0.3) * sx, (COVER.art.y + 1.9) * sy)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12)
    doc.text('assets proposed for disposal', (COVER.art.x + 0.3) * sx, (COVER.art.y + 2.7) * sy)
    if (logoSrc) {
      try {
        const props = doc.getImageProperties(logoSrc)
        const boxW = COVER.logo.maxW * sx
        const boxH = COVER.logo.maxH * sy
        const k = Math.min(boxW / props.width, boxH / props.height)
        doc.addImage(logoSrc, COVER.logo.x * sx, COVER.logo.y * sy, props.width * k, props.height * k)
      } catch { /* a cover without a logo is still a cover */ }
    }
    const tx = COVER.title.x * sx
    const tw = COVER.title.w * sx
    doc.setFont('helvetica', 'bold'); doc.setFontSize(19); setInk(BRAND_RGB.green)
    doc.text(doc.splitTextToSize(String(title || 'Asset Disposal Proposal'), tw), tx, COVER.title.y * sy)
    const sub = [subtitle, ctry].filter((v) => v && String(v).trim()).join('  |  ')
    let cy = COVER.subtitle.y * sy
    if (sub) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); setInk(RGB.subtle)
      doc.text(doc.splitTextToSize(sub, tw), tx, cy)
      cy += 8
    }
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); setInk(RGB.warn)
    const cav = valuationCaveat(deck)
    if (cav) {
      const lines = doc.splitTextToSize(cav, tw)
      lines.forEach((ln, i) => doc.text(ln, tx, cy + i * 3.6))
      cy += lines.length * 3.6 + 4
    }
    const reg = registerCaveat(deck)
    if (reg && cy < COVER.meta.y * sy - 12) {
      doc.splitTextToSize(reg, tw).slice(0, 3).forEach((ln, i) => doc.text(ln, tx, cy + i * 3.6))
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setInk(RGB.muted)
    doc.text(coverMeta({ company: comp, country: ctry, generated: showDate ? `Prepared ${stamp}` : null }), tx, COVER.meta.y * sy)
  }

  // Every pack opens on the company cover, exactly as the PowerPoint does.
  if (deck.slides[0]?.kind !== 'title') {
    page()
    coverPage(deck.title || 'Asset Disposal', '', deck.assetCount || 0, true)
  }

  for (const slide of deck.slides) {
    page()

    if (slide.kind === 'title') {
      coverPage(slide.title, slide.subtitle, slide.assetCount, slide.showDate)
      continue
    }

    if (slide.kind === 'kpis') {
      let y = heading(slide.title)
      if (slide.empty || !slide.items.length) { emptyAt(y, slide.emptyNote); continue }
      const items = slide.items.slice(0, 9)
      const perRow = items.length <= 4 ? items.length : 3
      const gap = 4
      const cw = (CW - gap * (perRow - 1)) / perRow
      const rowCount = Math.ceil(items.length / perRow)
      const availH = PH - 30 - y
      const ch = Math.min(26, (availH - gap * (rowCount - 1)) / rowCount)
      // Centre the grid the way the PowerPoint does, so the two packs read alike.
      const gridTop = y + Math.max(0, (availH - (rowCount * ch + gap * (rowCount - 1))) / 2)
      items.forEach((k, i) => {
        const col = i % perRow
        const r = Math.floor(i / perRow)
        const x = M + col * (cw + gap)
        const cy = gridTop + r * (ch + gap)
        const soft = k.unmeasured || isUnmeasured(k.value)
        cardAt(x, cy, cw, ch, soft ? BRAND.surface : (k.valuation ? BRAND.tintAmber : BRAND.tintGreen))
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); setInk(RGB.subtle)
        doc.text(doc.splitTextToSize(String(k.label).toUpperCase(), cw - 6)[0], x + 3, cy + 6)
        doc.setFont('helvetica', soft ? 'bolditalic' : 'bold'); doc.setFontSize(k.valuation || soft ? 11 : 15)
        setInk(soft ? RGB.muted : (k.valuation ? RGB.warn : BRAND_RGB.navy))
        doc.text(doc.splitTextToSize(String(k.value), cw - 6)[0], x + 3, cy + 14)
        if (k.note) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(6); setInk(RGB.subtle)
          doc.splitTextToSize(String(k.note), cw - 6).slice(0, 2).forEach((ln, li) => doc.text(ln, x + 3, cy + 19 + li * 3))
        }
      })
      const kNotes = Array.isArray(slide.notes) ? slide.notes.filter(Boolean) : []
      const bottom = kNotes.length ? kNotes.join('  ') : valuationCaveat(deck)
      if (bottom) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5)
        setInk(kNotes.length ? rgbOf(BASIS_STYLE.color) : RGB.warn)
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
      for (const h of slide.headlines) y = calloutAt(y, h.text, h.tone)
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
          if (m.trust) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = d.column.index === 3 ? RGB.warn : BRAND_RGB.navy }
          if (m.confounded) d.cell.styles.textColor = RGB.muted
        },
      })
      y = (doc.lastAutoTable?.finalY || y) + 5
      if (slide.confound && y < PH - 20) {
        const lines = doc.splitTextToSize(String(slide.confound), CW - 8)
        cardAt(M, y, CW, lines.length * 3.9 + 4, BRAND.tintAmber)
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); setInk(RGB.warn)
        lines.forEach((ln, i) => doc.text(ln, M + 4, y + 5 + i * 3.9))
      }
      continue
    }

    if (slide.kind === 'replacement') {
      let y = heading(slide.title)
      if (slide.empty) { emptyAt(y, slide.emptyNote); continue }
      for (const h of slide.headlines) y = calloutAt(y, h.text, h.tone)
      autoTable(doc, {
        startY: y, margin: { left: M, right: M }, theme: 'grid',
        head: [slide.columns.map((c) => c.header)],
        body: slide.rows,
        styles: {
          font: 'helvetica', fontSize: 8, cellPadding: 1.6, overflow: 'linebreak',
          textColor: RGB.subtle, lineColor: RGB.border, lineWidth: 0.1,
        },
        headStyles: { fillColor: RGB.head, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: RGB.zebra },
        columnStyles: Object.fromEntries(slide.columns.map((c, i) => [i, { halign: c.align === 'right' ? 'right' : 'left' }])),
        didParseCell: (d) => {
          if (d.section !== 'body') return
          const raw = String(d.cell.raw)
          const tone = cellTone(raw)
          d.cell.styles.textColor = tone.rgb
          if (isUnmeasured(raw)) d.cell.styles.fontStyle = 'italic'
        },
      })
      y = (doc.lastAutoTable?.finalY || y) + 5
      const rnotes = Array.isArray(slide.notes) ? slide.notes.filter(Boolean) : []
      if (rnotes.length && y < PH - 18) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); setInk(rgbOf(BASIS_STYLE.color))
        doc.splitTextToSize(rnotes.join('  '), CW).slice(0, 3).forEach((ln, i) => doc.text(ln, M, y + i * 3.4))
      }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setInk(RGB.muted)
      doc.text(doc.splitTextToSize(String(slide.caption || ''), CW)[0], M, PH - 12)
      continue
    }

    if (slide.kind === 'findings') {
      let y = heading(slide.title)
      if (slide.empty) { emptyAt(y, slide.emptyNote); continue }
      // Wrap first so the card is sized to the bullets, not to the page.
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11)
      const wrappedAll = slide.bullets.map((b) => doc.splitTextToSize(String(b), CW - 16))
      const needed = wrappedAll.reduce((n, w) => n + w.length * 5.4 + 3.5, 0) + 8
      cardAt(M, y, CW, Math.min(PH - 16 - y, needed))
      y += 7
      setInk(RGB.subtle)
      for (const wrapped of wrappedAll) {
        if (y + wrapped.length * 5.6 > PH - 20) break
        fill(BRAND_RGB.green); doc.circle(M + 6, y + 1.4, 0.9, 'F')
        setInk(RGB.subtle)
        wrapped.forEach((w, i) => doc.text(w, M + 10, y + 2.6 + i * 5.4))
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
        const fl = doc.splitTextToSize(slide.flags.join('   |   '), CW - 8)
        cardAt(M, y, CW, fl.length * 4.2 + 4, BRAND.tintAmber)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setInk(RGB.warn)
        fl.forEach((ln, i) => doc.text(ln, M + 4, y + 5.4 + i * 4.2))
        y += fl.length * 4.2 + 7
      }
      const half = Math.ceil(slide.facts.length / 2)
      const colW = (CW - 16) / 2
      const factsH = half * 5.2 + 5
      cardAt(M, y, CW, factsH)
      const fTop = y + 6
      doc.setFontSize(8.5)
      slide.facts.forEach((f, i) => {
        const col = i < half ? 0 : 1
        const r = i < half ? i : i - half
        const x = M + 4 + col * (colW + 8)
        const fy = fTop + r * 5.2
        doc.setFont('helvetica', 'normal'); setInk(RGB.muted)
        doc.text(doc.splitTextToSize(String(f.label), colW * 0.44)[0], x, fy)
        doc.setFont('helvetica', 'bold'); setInk(f.value === 'Not valued' ? RGB.warn : BRAND_RGB.navy)
        doc.text(doc.splitTextToSize(String(f.value), colW * 0.52)[0], x + colW * 0.45, fy)
      })
      y += factsH + 5
      const relList = Array.isArray(slide.reliability) ? slide.reliability : []
      if (relList.length && y < PH - 46) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setInk(BRAND_RGB.green)
        doc.text('RELIABILITY RECORD', M, y); y += 4.6
        doc.setFontSize(8)
        const strip = relList.map((f) => `${f.label}: ${f.value}`).join('   |   ')
        doc.setFont('helvetica', 'normal'); setInk(BRAND_RGB.navy)
        const lines = doc.splitTextToSize(strip, CW).slice(0, 3)
        lines.forEach((ln, i) => doc.text(ln, M, y + i * 4))
        y += lines.length * 4 + 2
        const rn = Array.isArray(slide.reliabilityNotes) ? slide.reliabilityNotes.filter(Boolean) : []
        if (rn.length && y < PH - 34) {
          doc.setFont('helvetica', 'italic'); doc.setFontSize(7); setInk(rgbOf(BASIS_STYLE.color))
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
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setInk(BRAND_RGB.green)
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
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11)
      const lines = doc.splitTextToSize(String(slide.body || 'N/A'), CW - 16)
      cardAt(M, y, CW, Math.min(PH - 16 - y, lines.length * 5.4 + 12))
      setInk(RGB.subtle)
      doc.text(lines, M + 8, y + 10)
      continue
    }

    if (slide.kind === 'divider') {
      // The cover's stepped panel again, at section scale.
      fill(rgbOf(BRAND.panelTint)); doc.rect(0, 0, PW, PH, 'F')
      fill([255, 255, 255])
      for (const st of COVER.steps) doc.rect(st.x * sx, st.y * sy, st.w * sx, st.h * sy, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); setInk(BRAND_RGB.greenDeep)
      doc.text(eyebrowText, M, PH / 2 - 8)
      doc.setFontSize(20)
      doc.text(doc.splitTextToSize(String(slide.label || '').toUpperCase(), CW * 0.42), M, PH / 2)
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
