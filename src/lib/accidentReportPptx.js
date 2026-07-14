/**
 * Accident Report PowerPoint (.pptx) renderer — the SINGLE pptx renderer for the
 * block-based Accident Report Builder. It mirrors `accidentReportPdf.js` block for
 * block and reuses the exact same catalog engine (buildReportContext, CHARTS,
 * KPIS, TABLE_COLS, tableRows, styleChartData, summarizeChartData, buildInsights,
 * normalizeConfig, ...) so a deck carries the same advanced tooling the PDF does:
 * styled charts with palettes / borders / data labels, KPI slides, filtered and
 * sorted incident tables, and honest auto insights.
 *
 * Two chart paths, matching the PDF's WYSIWYG contract:
 *   1. live-canvas image — when the builder passes `chartImageFor(block)` (a PNG
 *      data URL rasterised from the on-screen chart) it is embedded verbatim, so
 *      the slide == the preview.
 *   2. native editable chart — headless callers (Scheduled Reports) get a REAL,
 *      editable pptx chart built from CHARTS[block.chart].build(ctx) passed through
 *      styleChartData(...) and mapped to the closest pptxgen chart type.
 *
 * pptxgenjs (~385 KB) is imported LAZILY (never statically) so no page pays the
 * bundle cost until an export actually runs. ASCII only: NO em/en dashes, arrows
 * or curly quotes anywhere in deck text (use "N/A", "to", ":", "|", spaces).
 */
import {
  CHARTS, KPIS, TABLE_COLS, PALETTES,
  buildReportContext, buildInsights, fmtCell, cellValue, normalizeConfig,
  summarizeChartData, styleChartData, chartWidthFraction, packChartRows,
  tableRows, tableFilterLabel, isChartEmpty,
} from './accidentReport'
import { formatCurrencyCompact } from './formatters'
import { reportFileName, reportDateLabel } from './exportUtils'

// ── Lazy pptxgenjs loader (memoised). Mirrors exportUtils.ensurePptx so the heavy
// engine never ships in a page's initial chunk. ──
let _pptxgen
async function ensurePptx() {
  if (!_pptxgen) _pptxgen = (await import('pptxgenjs')).default
  return _pptxgen
}

// ── Light executive palette (matches exportUtils.buildPptxDeck for one look) ──
const BG = 'F6F8FC'
const CARD = 'FFFFFF'
const BORDER = 'E2E8F0'
const INK = '0F172A'
const SUBTLE = '475569'
const MUTED = '94A3B8'
const ACCENT = '4F46E5'
const HEAD_FILL = '1E293B'
// 16:9 wide layout geometry (inches)
const PAGE_W = 13.33
const MX = 0.4
const CONTENT_W = PAGE_W - MX * 2

const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * Normalise any chart colour (#rrggbb, rgb()/rgba(), bare hex) to a bare 6-hex
 * string pptxgen accepts; falls back to the accent so a malformed colour never
 * corrupts the OOXML.
 */
export function normalizeHex(c, fallback = ACCENT) {
  if (typeof c !== 'string') return fallback
  const s = c.trim()
  let m = /^#?([0-9a-fA-F]{6})$/.exec(s)
  if (m) return m[1].toUpperCase()
  m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s)
  if (m) {
    const to = (n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0')
    return (to(m[1]) + to(m[2]) + to(m[3])).toUpperCase()
  }
  return fallback
}

// Magnitude of a chart.js data cell: floating bars carry [start, end] pairs whose
// value is |end - start| (the step size); plain values coerce to a finite number.
const cellMagnitude = (v) => (Array.isArray(v) ? Math.abs(N(v[1]) - N(v[0])) : N(v))

/**
 * Map a catalog chart `kind` to the closest native pptxgen chart type + option
 * overrides (bar direction / grouping). Returns { type, extra }. `ChartType` is
 * the pptx instance enum. doughnut/polar collapse to a doughnut; pareto/combo to
 * a grouped bar; waterfall/bar-h/bar-stack to a bar variant.
 */
export function pptxChartKind(ChartType, kind) {
  switch (kind) {
    case 'line': return { type: ChartType.line, extra: {} }
    case 'radar': return { type: ChartType.radar, extra: {} }
    case 'doughnut':
    case 'polar': return { type: ChartType.doughnut, extra: { holeSize: 55, showLegend: true, legendPos: 'r' } }
    case 'bar-h': return { type: ChartType.bar, extra: { barDir: 'bar' } }
    case 'bar-stack': return { type: ChartType.bar, extra: { barDir: 'col', barGrouping: 'stacked' } }
    case 'pareto':
    case 'combo': return { type: ChartType.bar, extra: { barDir: 'col' } }
    case 'waterfall':
    case 'bar':
    default: return { type: ChartType.bar, extra: { barDir: 'col' } }
  }
}

/**
 * Convert a styled chart.js data object into pptxgen series [{ name, labels,
 * values }]. Labels are coerced to non-empty strings and values to finite numbers
 * (mirrors buildPptxDeck.cleanSeries) so PowerPoint never sees NaN/empty and
 * refuses the file. doughnut/polar keep a single series.
 */
export function toPptxSeries(styled, kind) {
  const rawLabels = Array.isArray(styled?.labels) ? styled.labels : []
  const labels = rawLabels.map((l) => (l == null || String(l).trim() === '' ? 'N/A' : String(l)))
  const datasets = Array.isArray(styled?.datasets) ? styled.datasets : []
  const perSlice = kind === 'doughnut' || kind === 'polar'
  const mk = (ds, i) => ({
    name: ds?.label != null && String(ds.label).trim() !== '' ? String(ds.label) : `Series ${i + 1}`,
    labels,
    values: (Array.isArray(ds?.data) ? ds.data : []).map(cellMagnitude),
  })
  if (perSlice) return [mk(datasets[0] || { data: [] }, 0)]
  return datasets.map(mk)
}

/** Chart colour array for a styled chart: per-slice colours for doughnut/polar,
 *  else one colour per dataset; falls back to the block palette. Bare 6-hex. */
export function chartColorsFor(styled, kind, block) {
  const perSlice = kind === 'doughnut' || kind === 'polar'
  if (perSlice) {
    const bg = styled?.datasets?.[0]?.backgroundColor
    if (Array.isArray(bg) && bg.length) return bg.map((c) => normalizeHex(c))
  } else {
    const cols = (styled?.datasets || []).map((ds) => normalizeHex(Array.isArray(ds?.backgroundColor) ? ds.backgroundColor[0] : ds?.backgroundColor))
    if (cols.length) return cols
  }
  return (PALETTES[block?.palette] || PALETTES.default).map((c) => normalizeHex(c))
}

/**
 * Build (and by default save) the PowerPoint deck.
 * @param {object}   opts
 * @param {object}   opts.config          builder config { blocks, orientation }
 * @param {Array}    opts.records         live accident rows the report covers
 * @param {string}   opts.company         company name for cover/footer branding
 * @param {string}   opts.currency        display currency code
 * @param {function} [opts.chartImageFor] (block) => PNG data URL — live-canvas WYSIWYG override
 * @param {string}   [opts.filename]      file name without extension
 * @param {string}   [opts.subtitle]      extra context line (e.g. coverage window)
 * @param {boolean}  [opts.save]          write the file (default true)
 * @returns {Promise<{ pptx: object, slides: Array, filename: string }>}
 */
export async function renderAccidentReportPptx({
  config, records = [], company = 'TyrePulse', currency = 'SAR',
  chartImageFor = null, filename = null, subtitle = '', save = true,
}) {
  const { blocks } = normalizeConfig(config)
  const ctx = buildReportContext(records, currency)
  const money = (v) => (v == null || v === '' ? 'N/A' : formatCurrencyCompact(v, currency))
  const imageFor = (b) => {
    try { return (chartImageFor && chartImageFor(b)) || null } catch { return null }
  }

  const PptxGen = await ensurePptx()
  const pptx = new PptxGen()
  // 16:9 wide deck.
  try { pptx.defineLayout({ name: 'TP_WIDE', width: PAGE_W, height: 7.5 }) } catch { /* older builds lack defineLayout */ }
  pptx.layout = 'LAYOUT_WIDE'
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' }
  const ChartType = pptx.ChartType || {}
  const rect = (pptx.ShapeType && pptx.ShapeType.rect) || 'rect'
  const line = (pptx.ShapeType && pptx.ShapeType.line) || 'line'

  const slides = []
  const stamp = reportDateLabel()

  // Footer on content slides: company + page number (ASCII only).
  const footer = (slide) => {
    const idx = slides.length + 1
    slide.addText(`${company}  |  Accident Report`, { x: MX, y: 7.12, w: 10.5, h: 0.3, fontSize: 7.5, color: MUTED })
    slide.addText(`Page ${idx}`, { x: PAGE_W - MX - 1.2, y: 7.12, w: 1.2, h: 0.3, fontSize: 7.5, color: MUTED, align: 'right' })
  }
  const newSlide = () => {
    const s = pptx.addSlide()
    s.background = { color: BG }
    return s
  }
  const contentHeader = (slide, title) => {
    slide.addShape(rect, { x: 0, y: 0, w: PAGE_W, h: 0.86, fill: { color: CARD } })
    slide.addShape(rect, { x: 0, y: 0.86, w: PAGE_W, h: 0.04, fill: { color: ACCENT } })
    slide.addShape(rect, { x: 0, y: 0, w: 0.12, h: 0.86, fill: { color: ACCENT } })
    slide.addText(String(title || '').toUpperCase(), { x: MX, y: 0.22, w: CONTENT_W, h: 0.45, fontSize: 15, bold: true, color: INK })
  }

  // ── Native / image chart into a rectangle (shared by full + packed layouts) ──
  const renderChartInto = (slide, b, x, y, w, h) => {
    const def = CHARTS[b.chart]
    const title = b.title || def?.label || ''
    const digest = def ? summarizeChartData(def.build(ctx)) : ''
    const titleH = title ? 0.3 : 0
    const digestH = digest ? 0.28 : 0
    if (title) slide.addText(String(title), { x, y, w, h: titleH, fontSize: 11, bold: true, color: INK })
    const bodyY = y + titleH
    const bodyH = Math.max(0.6, h - titleH - digestH)
    const img = imageFor(b)
    let drew = false
    if (img) {
      try { slide.addImage({ data: img, x, y: bodyY, w, h: bodyH, sizing: { type: 'contain', w, h: bodyH } }); drew = true } catch { drew = false }
    }
    if (!drew && def) {
      const styled = styleChartData(def.build(ctx), b)
      if (!isChartEmpty(styled)) {
        const { type, extra } = pptxChartKind(ChartType, def.kind)
        const series = toPptxSeries(styled, def.kind)
        const chartColors = chartColorsFor(styled, def.kind, b)
        try {
          slide.addChart(type, series, {
            x, y: bodyY, w, h: bodyH,
            chartColors,
            showLegend: extra.showLegend != null ? extra.showLegend : (series.length > 1),
            legendPos: extra.legendPos || 'b', legendColor: SUBTLE, legendFontSize: 9,
            showTitle: false,
            showValue: b.showLabels !== false, dataLabelColor: normalizeHex(b.labelColor, INK),
            dataLabelFontSize: Number(b.labelSize) > 0 ? Number(b.labelSize) : 9, dataLabelFontBold: true,
            catAxisLabelColor: SUBTLE, catAxisLabelFontSize: 9,
            valAxisLabelColor: MUTED, valAxisLabelFontSize: 9,
            valGridLine: b.showGrid === false ? { style: 'none' } : { color: BORDER, size: 0.5 },
            barDir: extra.barDir, barGrouping: extra.barGrouping, holeSize: extra.holeSize,
          })
          drew = true
        } catch { drew = false }
      }
    }
    if (!drew) {
      slide.addText('No data for this chart in the covered period.', { x, y: bodyY, w, h: 0.5, fontSize: 10, italic: true, color: MUTED, align: 'center', valign: 'middle' })
    }
    if (digest) slide.addText(digest, { x, y: y + h - digestH, w, h: digestH, fontSize: 8.5, color: SUBTLE })
  }

  // Full-width chart => its own slide.
  const chartSlide = (b) => {
    const s = newSlide()
    renderChartInto(s, b, MX, 1.1, CONTENT_W, 5.6)
    footer(s); slides.push(s)
  }

  // A run of shrinkable charts (half/third/quarter) packed into rows on ONE slide
  // (up to a sensible number of rows; overflow spills onto further slides).
  const chartRunSlides = (run) => {
    const rows = packChartRows(run)
    const ROWS_PER_SLIDE = 3
    for (let i = 0; i < rows.length; i += ROWS_PER_SLIDE) {
      const pageRows = rows.slice(i, i + ROWS_PER_SLIDE)
      const s = newSlide()
      const top = 1.0
      const bottom = 6.85
      const gapY = 0.25
      const rowH = (bottom - top - gapY * (pageRows.length - 1)) / pageRows.length
      pageRows.forEach((row, ri) => {
        const y = top + ri * (rowH + gapY)
        const fracs = row.map((b) => chartWidthFraction(b.width))
        const sumF = fracs.reduce((a, f) => a + f, 0) || 1
        const gapX = 0.2
        const usable = CONTENT_W - gapX * (row.length - 1)
        let x = MX
        row.forEach((b, ci) => {
          const w = (usable * fracs[ci]) / sumF
          renderChartInto(s, b, x, y, w, rowH)
          x += w + gapX
        })
      })
      footer(s); slides.push(s)
    }
  }

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi]

    // ── header => title / cover slide ──
    if (b.type === 'header') {
      const s = newSlide()
      s.background = { color: CARD }
      s.addShape(rect, { x: 0, y: 0, w: 4.4, h: 7.5, fill: { color: 'F1F4FB' } })
      s.addShape(rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: ACCENT } })
      s.addText(String(company).toUpperCase(), { x: 0.6, y: 1.4, w: 8, h: 0.5, fontSize: 13, bold: true, color: ACCENT, charSpacing: 2 })
      s.addText(String(b.title || 'Accident & Claims Report'), { x: 0.58, y: 2.0, w: 9.2, h: 1.7, fontSize: 40, bold: true, color: INK })
      const subLine = [b.subtitle, subtitle].filter((x) => x != null && String(x).trim() !== '').join('  |  ')
      if (subLine) s.addText(subLine, { x: 0.6, y: 3.75, w: 9.2, h: 0.6, fontSize: 16, color: SUBTLE })
      if (b.showDate !== false) s.addText(`Generated ${stamp}`, { x: 0.6, y: 4.5, w: 9, h: 0.4, fontSize: 11, color: MUTED })
      slides.push(s)
      continue
    }

    // ── kpis => grid of cards ──
    if (b.type === 'kpis') {
      const items = (b.items || []).filter((k) => KPIS[k])
      if (!items.length) continue
      const s = newSlide()
      contentHeader(s, 'Key metrics')
      const perRow = 3
      const gap = 0.25
      const cardW = (CONTENT_W - gap * (perRow - 1)) / perRow
      const cardH = 1.5
      const top = 1.25
      items.forEach((k, i) => {
        const col = i % perRow
        const rowI = Math.floor(i / perRow)
        const x = MX + col * (cardW + gap)
        const y = top + rowI * (cardH + gap)
        const def = KPIS[k]
        const raw = def.get(ctx)
        const val = def.money ? money(raw) : (raw == null || raw === '' ? 'N/A' : String(raw))
        s.addShape(rect, { x, y, w: cardW, h: cardH, fill: { color: CARD }, line: { color: BORDER, width: 1 }, rounding: true })
        s.addShape(rect, { x, y, w: cardW, h: 0.08, fill: { color: ACCENT } })
        s.addText(String(def.label).toUpperCase(), { x: x + 0.16, y: y + 0.18, w: cardW - 0.32, h: 0.3, fontSize: 9, bold: true, color: MUTED, charSpacing: 1 })
        s.addText(val, { x: x + 0.16, y: y + 0.5, w: cardW - 0.32, h: 0.7, fontSize: 24, bold: true, color: INK })
      })
      footer(s); slides.push(s)
      continue
    }

    // ── chart => image or native; pack shrinkable charts side by side ──
    if (b.type === 'chart') {
      const isShrinkable = (blk) => blk && blk.type === 'chart' && (blk.width === 'half' || blk.width === 'third' || blk.width === 'quarter')
      if (isShrinkable(b)) {
        const run = []
        while (bi < blocks.length && isShrinkable(blocks[bi])) { run.push(blocks[bi]); bi++ }
        bi-- // outer loop re-increments past the last consumed block
        chartRunSlides(run)
        continue
      }
      chartSlide(b)
      continue
    }

    // ── insights => bullet list ──
    if (b.type === 'insights') {
      const s = newSlide()
      contentHeader(s, b.title || 'Key findings')
      const lines = buildInsights(ctx)
      if (!lines.length) {
        s.addText('No incidents in the covered period. Nothing to report.', { x: MX, y: 1.3, w: CONTENT_W, h: 0.5, fontSize: 12, italic: true, color: MUTED })
      } else {
        s.addText(lines.map((t) => ({ text: String(t), options: { bullet: { code: '2022' }, color: SUBTLE, fontSize: 13, paraSpaceAfter: 8 } })), { x: MX + 0.1, y: 1.25, w: CONTENT_W - 0.2, h: 5.5, valign: 'top' })
      }
      footer(s); slides.push(s)
      continue
    }

    // ── text => free-form section ──
    if (b.type === 'text') {
      const s = newSlide()
      contentHeader(s, b.title || 'Notes')
      s.addText(String(b.body || 'N/A'), { x: MX, y: 1.3, w: CONTENT_W, h: 5.4, fontSize: 13, color: SUBTLE, valign: 'top' })
      footer(s); slides.push(s)
      continue
    }

    // ── divider => thin labelled rule on its own slim slide ──
    if (b.type === 'divider') {
      const s = newSlide()
      if (b.label) s.addText(String(b.label).toUpperCase(), { x: MX, y: 3.35, w: 4, h: 0.4, fontSize: 13, bold: true, color: SUBTLE, charSpacing: 1 })
      s.addShape(line, { x: b.label ? MX + 3.6 : MX, y: 3.6, w: b.label ? CONTENT_W - 3.6 : CONTENT_W, h: 0, line: { color: BORDER, width: 1.25 } })
      footer(s); slides.push(s)
      continue
    }

    // ── pagebreak => force a fresh slide boundary (each block already opens its
    // own slide, so this is a deliberate no-op marker). ──
    if (b.type === 'pagebreak') continue

    // ── table => filtered/sorted rows, paginated across slides ──
    if (b.type === 'table') {
      const cols = (b.columns || []).filter((c) => TABLE_COLS[c])
      if (!cols.length) continue
      const filtered = tableRows(records, b)
      const compact = b.density === 'compact'
      const rowsPerSlide = compact ? 12 : 10
      const total = records.length
      const shown = filtered.length
      const flabel = tableFilterLabel(b)
      const caption = `Showing ${shown} of ${total} incidents${flabel ? ` | filter: ${flabel}` : ''}`
      const cellFont = compact ? 7 : 8
      const colW = cols.map(() => CONTENT_W / cols.length)
      const headRow = cols.map((c) => ({ text: TABLE_COLS[c], options: { bold: true, color: 'FFFFFF', fill: { color: HEAD_FILL }, fontSize: cellFont, align: 'center', valign: 'middle' } }))
      const pages = Math.max(1, Math.ceil(shown / rowsPerSlide))
      for (let p = 0; p < pages; p++) {
        const slice = filtered.slice(p * rowsPerSlide, (p + 1) * rowsPerSlide)
        const body = slice.map((r, ri) => cols.map((c) => ({
          text: fmtCell(c, cellValue(c, r), money),
          options: { fontSize: cellFont, color: SUBTLE, fill: { color: ri % 2 ? 'F8FAFC' : CARD }, valign: 'middle' },
        })))
        const s = newSlide()
        contentHeader(s, `${b.title || 'Incident detail'}${pages > 1 ? ` (${p + 1}/${pages})` : ''}`)
        const rowsForSlide = body.length ? [headRow, ...body] : [headRow, cols.map(() => ({ text: 'N/A', options: { fontSize: cellFont, color: MUTED } }))]
        s.addTable(rowsForSlide, {
          x: MX, y: 1.15, w: CONTENT_W, colW,
          border: { type: 'solid', color: BORDER, pt: 0.5 },
          rowH: compact ? 0.3 : 0.36, valign: 'middle', autoPage: false,
        })
        s.addText(caption, { x: MX, y: 6.8, w: CONTENT_W, h: 0.3, fontSize: 8, color: MUTED })
        footer(s); slides.push(s)
      }
      continue
    }
  }

  // Guarantee a non-empty deck (honest empty state) so writeFile never fails.
  if (!slides.length) {
    const s = newSlide()
    contentHeader(s, company)
    s.addText('No report blocks configured.', { x: MX, y: 1.4, w: CONTENT_W, h: 0.6, fontSize: 13, italic: true, color: MUTED })
    footer(s); slides.push(s)
  }

  const resolvedName = filename
    ? reportFileName(filename)
    : reportFileName(company, 'Accident Report', reportDateLabel())
  const outName = `${resolvedName}.pptx`
  if (save) await pptx.writeFile({ fileName: outName })
  return { pptx, slides, filename: outName }
}

export default renderAccidentReportPptx
