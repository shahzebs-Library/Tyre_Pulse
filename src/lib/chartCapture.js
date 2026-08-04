/**
 * chartCapture — turn a live Chart.js instance into a clean, print-ready PNG.
 *
 * WHY THIS EXISTS
 * The app's on-screen charts use a DARK UI theme (light ticks/labels on a
 * transparent canvas). `chart.toBase64Image()` keeps that transparency, so the
 * exported PNG:
 *   - renders BLACK when composited into a PDF (transparent → black in several
 *     PDF viewers), and
 *   - shows invisible light text when opened on a white background.
 *
 * `captureChartOnPaper()` re-renders the same data offscreen on a white canvas
 * with dark "paper" ink, producing a PNG that is readable everywhere. It is
 * fully synchronous and shares the global Chart.js registry (the Chart class is
 * taken from the live instance), so no controllers need re-registering.
 *
 * Single source of truth for chart image export — reused by the Accidents
 * analytics PDF and the shared ChartModal "Download PNG" action.
 */
import { makeValueLabelsPlugin } from './accidentReport'

const PAPER_INK = '#0f172a'
const PAPER_MUTED = '#475569'
const PAPER_GRID = 'rgba(15,23,42,0.10)'

// Dark-ink value labels for the white-paper capture.
const PAPER_VALUE_LABELS = makeValueLabelsPlugin(PAPER_INK)

// Paint a solid white backdrop before the chart draws so the PNG is never
// transparent. `destination-over` puts the fill behind everything already drawn.
export const WHITE_BG_PLUGIN = {
  id: 'tpWhiteBg',
  beforeDraw(chart) {
    const { ctx } = chart
    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, chart.width, chart.height)
    ctx.restore()
  },
}

// Deep-clone chart options while preserving function references (callbacks,
// generateLabels, tick formatters), then flip every text/grid colour from the
// dark UI theme to dark-on-white paper ink.
/**
 * Font sizes the capture should aim for ON PAPER, in points. These are the
 * numbers that decide whether a legend can be read, and they are the whole
 * reason this function takes a scale.
 */
export const PAPER_FONT_PT = Object.freeze({
  legend: 9,
  tick: 8,
  pointLabel: 8,
  title: 10,
  valueLabel: 8,
})

/**
 * @param {object} opts   the live chart's options
 * @param {number} scale  canvas pixels per PDF point. A font that must read as
 *                        9pt on paper is therefore 9 * scale pixels here.
 */
export function toPaperOptions(opts, scale = 1) {
  const clone = (v) => {
    if (Array.isArray(v)) return v.map(clone)
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = clone(v[k]); return o }
    return v // primitives + functions passed by reference
  }
  const px = (pt) => Math.max(8, Math.round(pt * scale))
  const o = clone(opts || {})
  o.responsive = false
  o.maintainAspectRatio = false
  o.animation = false
  // The canvas is already sized in device pixels by the caller, so a second
  // multiplier here would only inflate the bitmap without adding detail.
  o.devicePixelRatio = 1
  o.plugins = o.plugins || {}
  // The value-label plugin reads its own size from here (default 10px), which at
  // a 3x canvas would print at about 3pt.
  o.plugins.valueLabels = {
    ...(o.plugins.valueLabels || {}),
    color: PAPER_INK,
    size: px(PAPER_FONT_PT.valueLabel),
  }
  if (o.plugins.legend) {
    o.plugins.legend.labels = {
      ...(o.plugins.legend.labels || {}),
      color: PAPER_INK,
      // THE BUG THIS FIXES: the on-screen options carry a ~12px legend font,
      // sized for a small canvas. Rendered at 1000px and then placed into a
      // 135mm cell, that 12px lands at about 4.6pt on paper - which is what
      // "legends are so small" meant. Sizing in points and scaling up to the
      // canvas is the only way the printed size is predictable.
      font: { ...(o.plugins.legend.labels?.font || {}), size: px(PAPER_FONT_PT.legend) },
      boxWidth: Math.round(9 * scale),
      boxHeight: Math.round(9 * scale),
      padding: Math.round(6 * scale),
    }
  }
  if (o.plugins.title) {
    o.plugins.title = {
      ...o.plugins.title, color: PAPER_INK,
      font: { ...(o.plugins.title.font || {}), size: px(PAPER_FONT_PT.title) },
    }
  }
  if (o.scales) {
    for (const ax of Object.keys(o.scales)) {
      const s = o.scales[ax]
      if (!s || typeof s !== 'object') continue
      s.ticks = {
        ...(s.ticks || {}), color: PAPER_MUTED,
        font: { ...(s.ticks?.font || {}), size: px(PAPER_FONT_PT.tick) },
      }
      s.grid = { ...(s.grid || {}), color: PAPER_GRID, lineWidth: Math.max(1, Math.round(scale * 0.5)) }
      if (s.angleLines) s.angleLines = { ...s.angleLines, color: PAPER_GRID }
      if (s.pointLabels) {
        s.pointLabels = {
          ...s.pointLabels, color: PAPER_MUTED,
          font: { ...(s.pointLabels?.font || {}), size: px(PAPER_FONT_PT.pointLabel) },
        }
      }
      if (s.title) {
        s.title = {
          ...s.title, color: PAPER_INK,
          font: { ...(s.title?.font || {}), size: px(PAPER_FONT_PT.title) },
        }
      }
    }
  }
  // Lines and points need to grow with the canvas too, or a 3x bitmap draws
  // hairlines that vanish in print.
  o.elements = o.elements || {}
  o.elements.line = { ...(o.elements.line || {}), borderWidth: Math.max(1, Math.round(1.5 * scale)) }
  o.elements.point = { ...(o.elements.point || {}), radius: Math.max(2, Math.round(2 * scale)) }
  return o
}

// Light-theme "report mode" ink for ON-SCREEN charts. Kept in lock-step with the
// offscreen paper capture (toPaperOptions) so a chart shown in report view looks
// identical to its exported PNG.
const REPORT_INK = '#0f172a'
const REPORT_TICK = '#334155'
const REPORT_GRID = '#e5e7eb'

/**
 * Return a deep clone of the given Chart.js options recoloured for a WHITE
 * "report view": dark ink legend/title, slate ticks, light grid lines. Function
 * references (callbacks, formatters) are preserved. `responsive:true` is forced
 * so the on-screen chart still fits its flex container. Non-mutating: the source
 * dark options object is untouched.
 */
export function paperChartOptions(base) {
  const clone = (v) => {
    if (Array.isArray(v)) return v.map(clone)
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = clone(v[k]); return o }
    return v // primitives + functions passed by reference
  }
  const o = clone(base || {})
  o.responsive = true
  o.plugins = o.plugins || {}
  if (o.plugins.legend && o.plugins.legend.display !== false) {
    o.plugins.legend.labels = { ...(o.plugins.legend.labels || {}), color: REPORT_INK }
  }
  if (o.plugins.title) o.plugins.title = { ...o.plugins.title, color: REPORT_INK }
  if (o.scales) {
    for (const ax of Object.keys(o.scales)) {
      const s = o.scales[ax]
      if (!s || typeof s !== 'object') continue
      s.ticks = { ...(s.ticks || {}), color: REPORT_TICK }
      s.grid = { ...(s.grid || {}), color: REPORT_GRID }
      if (s.angleLines) s.angleLines = { ...s.angleLines, color: REPORT_GRID }
      if (s.pointLabels) s.pointLabels = { ...s.pointLabels, color: REPORT_TICK }
      if (s.title) s.title = { ...s.title, color: REPORT_INK }
    }
  }
  return o
}

/**
 * Re-render a live Chart.js instance onto an offscreen white canvas with paper
 * ink and return a PNG data URL, or null on any failure (caller may fall back
 * to the raw capture).
 */
/**
 * Pixels per point. 2 is retina-equivalent (144 DPI once placed) and 3 is
 * comfortably print quality (216 DPI). Above 3 the file grows with no visible
 * gain, which is the other half of "the PDF is too big".
 */
export const PRINT_SCALE = 3

/**
 * Re-render a live Chart.js instance onto an offscreen white canvas with paper
 * ink and return a PNG data URL, or null on any failure (caller may fall back
 * to the raw capture).
 *
 * @param {object} live
 * @param {object} [opt]
 * @param {number} [opt.widthPt]  the width in PDF points the image will occupy.
 *   Passing it is what makes the text size predictable: the canvas is sized to
 *   widthPt * scale and the fonts to their point size * scale, so a 9pt legend
 *   really is 9pt on the page. Without it the old fixed 1000px canvas is used
 *   and text lands at whatever the on-screen font happened to be, which is how
 *   legends ended up at roughly 4.6pt.
 * @param {number} [opt.scale=PRINT_SCALE]
 * @param {number} [opt.aspect]  height/width override
 */
export function captureChartOnPaper(live, opt = {}) {
  try {
    if (!live || !live.canvas || typeof live.constructor !== 'function') return null
    const Chart = live.constructor
    const type = live.config?.type || 'bar'
    const liveAspect = live.height && live.width ? live.height / live.width : 0.6
    const aspect = Number.isFinite(opt.aspect) && opt.aspect > 0 ? opt.aspect : liveAspect
    const scale = Number.isFinite(opt.scale) && opt.scale > 0 ? opt.scale : PRINT_SCALE
    // No widthPt means a caller that just wants a PNG (the on-screen download),
    // so keep the previous fixed canvas and a neutral font scale for it.
    const sized = Number.isFinite(opt.widthPt) && opt.widthPt > 0
    const width = sized ? Math.round(opt.widthPt * scale) : 1000
    const fontScale = sized ? scale : 2
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.max(Math.round(width * 0.42), Math.round(width * aspect))
    const src = live.config?.data || { labels: [], datasets: [] }
    const data = {
      labels: src.labels ? [...src.labels] : src.labels,
      datasets: (src.datasets || []).map(({ _meta, ...ds }) => ({ ...ds })),
    }
    // Doughnut/pie/polar carry their counts in the legend already - don't
    // double-print via the value-label plugin.
    const radial = type === 'doughnut' || type === 'pie' || type === 'polarArea'
    const plugins = radial ? [WHITE_BG_PLUGIN] : [WHITE_BG_PLUGIN, PAPER_VALUE_LABELS]
    const inst = new Chart(canvas.getContext('2d'), {
      type,
      data,
      options: toPaperOptions(live.config?.options, fontScale),
      plugins,
    })
    const img = inst.toBase64Image('image/png', 1)
    inst.destroy()
    return img
  } catch {
    return null
  }
}

/** Trigger a browser download of a live chart as a clean white-background PNG. */
export function downloadChartPng(live, filename = 'chart') {
  if (!live) return false
  const url = captureChartOnPaper(live) || (typeof live.toBase64Image === 'function' ? live.toBase64Image('image/png', 1) : null)
  if (!url) return false
  const safe = String(filename).replace(/[^A-Za-z0-9 _()-]+/g, ' ').trim() || 'chart'
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  return true
}
