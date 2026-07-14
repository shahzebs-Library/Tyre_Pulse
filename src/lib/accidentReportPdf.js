/**
 * Accident Report PDF renderer — turns a builder config ({ blocks, orientation })
 * plus a live accident record set into a branded, paginated A4 PDF.
 *
 * Used by BOTH surfaces (single implementation, never duplicated):
 *   1. the Accident Report Builder tab (which passes `chartImageFor` so charts
 *      are rasterised from the live on-screen canvases — exact WYSIWYG), and
 *   2. Scheduled Reports "Generate now" / saved-layout generation, which runs
 *      headless: charts are rendered on an offscreen canvas with the same data
 *      + paper-theme options, so the output matches the builder preview.
 *
 * jspdf / jspdf-autotable / chart.js are imported lazily so neither page pays
 * the bundle cost until an export actually runs.
 */
import {
  CHARTS, KPIS, TABLE_COLS, CHART_OPTS, CHART_JS_TYPE, VALUE_LABELS_PLUGIN,
  buildReportContext, buildInsights, fmtCell, cellValue, normalizeConfig, summarizeChartData,
} from './accidentReport'
import { formatCurrencyCompact } from './formatters'
import { reportFileName, reportDateLabel } from './exportUtils'

/** Render one chart block offscreen and return a PNG data URL (null on failure). */
async function renderOffscreenChart(block, ctx) {
  const def = CHARTS[block.chart]
  if (!def) return null
  const data = def.build(ctx)
  if (!data?.labels?.length) return null
  try {
    const { Chart, registerables } = await import('chart.js')
    Chart.register(...registerables)
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = Math.max(240, Math.min(420, (block.height || 240) * 1.3))
    const chart = new Chart(canvas.getContext('2d'), {
      type: CHART_JS_TYPE[def.kind],
      data,
      options: { ...CHART_OPTS[def.kind], responsive: false, animation: false, devicePixelRatio: 2 },
      plugins: [VALUE_LABELS_PLUGIN],
    })
    const img = canvas.toDataURL('image/png')
    chart.destroy()
    return img
  } catch {
    return null
  }
}

/**
 * Build (and by default save) the PDF.
 * @param {object} opts
 * @param {object} opts.config        builder config { blocks, orientation }
 * @param {Array}  opts.records       live accident rows the report covers
 * @param {string} opts.company       company name for header/footer branding
 * @param {string} opts.currency      display currency code
 * @param {function} [opts.chartImageFor] (block) => dataURL — live-canvas override
 * @param {string} [opts.filename]    file name without extension
 * @param {string} [opts.subtitle]    extra context line (e.g. coverage window)
 * @returns {Promise<{doc: object, pages: number, filename: string}>}
 */
export async function renderAccidentReportPdf({
  config, records = [], company = 'TyrePulse', currency = 'SAR',
  chartImageFor = null, filename = null, subtitle = '', save = true,
}) {
  const { blocks, orientation } = normalizeConfig(config)
  const ctx = buildReportContext(records, currency)
  const money = (v) => (v == null || v === '' ? 'N/A' : formatCurrencyCompact(v, currency))

  const [{ default: JsPDF }, auto] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = auto.default
  const doc = new JsPDF({ orientation, unit: 'mm', format: 'a4' })
  const PW = doc.internal.pageSize.width, PH = doc.internal.pageSize.height
  const MX = 14
  let y = 16

  const ensure = (h) => { if (y + h > PH - 14) { doc.addPage(); y = 16 } }
  const stamp = new Date().toISOString().slice(0, 10)

  for (const b of blocks) {
    if (b.type === 'pagebreak') { doc.addPage(); y = 16; continue }

    if (b.type === 'header') {
      if (b.logo) { try { doc.addImage(b.logo, 'PNG', MX, y, 22, 22, undefined, 'FAST') } catch { /* ignore */ } }
      const tx = b.logo ? MX + 28 : MX
      doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
      doc.text(b.title || 'Report', tx, y + 8)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(71, 85, 105)
      const sub = [b.subtitle, subtitle, company, b.showDate ? `Generated ${stamp}` : ''].filter(Boolean).join('  |  ')
      if (sub) doc.text(sub, tx, y + 15)
      y += 26
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.4); doc.line(MX, y, PW - MX, y); y += 6
      continue
    }

    if (b.type === 'kpis') {
      const items = (b.items || []).filter((k) => KPIS[k])
      if (!items.length) continue
      const perRow = orientation === 'landscape' ? 6 : 3
      const gap = 3, cw = (PW - MX * 2 - gap * (perRow - 1)) / perRow, ch = 20
      items.forEach((k, i) => {
        const col = i % perRow
        if (col === 0) ensure(ch + gap)
        const x = MX + col * (cw + gap)
        const cy = y
        const def = KPIS[k]; const raw = def.get(ctx); const val = def.money ? money(raw) : String(raw)
        doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3)
        doc.roundedRect(x, cy, cw, ch, 1.5, 1.5, 'FD')
        doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
        doc.text(val, x + 3, cy + 9)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139)
        doc.text(def.label.toUpperCase(), x + 3, cy + 15)
        if (col === perRow - 1 || i === items.length - 1) y += ch + gap
      })
      y += 2
      continue
    }

    if (b.type === 'chart') {
      const img = (chartImageFor && chartImageFor(b)) || await renderOffscreenChart(b, ctx)
      const cw = PW - MX * 2
      const ch = Math.min(orientation === 'landscape' ? 95 : 80, (b.height || 240) * 0.32)
      ensure(ch + 10)
      const title = b.title || CHARTS[b.chart]?.label
      if (title) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15, 23, 42); doc.text(title, MX, y + 4); y += 6 }
      if (img) { try { doc.addImage(img, 'PNG', MX, y, cw, ch, undefined, 'FAST') } catch { /* ignore */ } }
      else { doc.setFontSize(9); doc.setTextColor(148, 163, 184); doc.text('No data for this chart in the covered period.', MX, y + 6) }
      y += ch + 2
      // Numeric digest under the chart so figures survive print/greyscale.
      const digest = summarizeChartData(CHARTS[b.chart] ? CHARTS[b.chart].build(ctx) : null)
      if (img && digest) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(100, 116, 139); doc.text(digest, MX, y + 3); y += 5 }
      y += 4
      continue
    }

    if (b.type === 'insights') {
      const lines = buildInsights(ctx)
      ensure(16)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 23, 42)
      doc.text(b.title || 'Key findings', MX, y + 4); y += 7
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(51, 65, 85)
      if (!lines.length) { ensure(6); doc.setTextColor(148, 163, 184); doc.text('No incidents in the covered period. Nothing to report.', MX, y + 4); y += 8; continue }
      for (const ln of lines) {
        const wrapped = doc.splitTextToSize(ln, PW - MX * 2 - 5)
        ensure(wrapped.length * 5.2 + 2)
        doc.setFillColor(234, 88, 12); doc.circle(MX + 1.2, y + 2.6, 0.9, 'F')
        wrapped.forEach((w, i) => { doc.text(w, MX + 5, y + 4); y += 5.2; if (i < wrapped.length - 1) ensure(6) })
        y += 1
      }
      y += 3
      continue
    }

    if (b.type === 'text') {
      ensure(16)
      if (b.title) { doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 23, 42); doc.text(b.title, MX, y + 4); y += 6 }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(51, 65, 85)
      const lines = doc.splitTextToSize(b.body || '', PW - MX * 2)
      lines.forEach((ln) => { ensure(6); doc.text(ln, MX, y + 4); y += 5.2 })
      y += 4
      continue
    }

    if (b.type === 'divider') {
      ensure(12)
      doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.4)
      if (b.label) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(100, 116, 139)
        doc.text(String(b.label).toUpperCase(), MX, y + 4)
        const tw = doc.getTextWidth(String(b.label).toUpperCase())
        doc.line(MX + tw + 4, y + 2.8, PW - MX, y + 2.8)
      } else {
        doc.line(MX, y + 2.8, PW - MX, y + 2.8)
      }
      y += 9
      continue
    }

    if (b.type === 'table') {
      const cols = (b.columns || []).filter((c) => TABLE_COLS[c])
      if (!cols.length) continue
      const rows = records.slice(0, Math.max(1, b.limit || 25)).map((r) => cols.map((c) => fmtCell(c, cellValue(c, r), money)))
      if (b.title) { ensure(8); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 23, 42); doc.text(b.title, MX, y + 4); y += 6 }
      autoTable(doc, {
        startY: y, margin: { left: MX, right: MX }, theme: 'grid',
        head: [cols.map((c) => TABLE_COLS[c])],
        body: rows.length ? rows : [cols.map(() => 'N/A')],
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, textColor: [51, 65, 85], lineColor: [226, 232, 240], lineWidth: 0.1 },
        headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      })
      y = doc.lastAutoTable.finalY + 6
      continue
    }
  }

  // Footer page numbers
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(8); doc.setTextColor(148, 163, 184)
    doc.text(`${company}  |  Accident Report`, MX, PH - 8)
    doc.text(`Page ${p} / ${pages}`, PW - MX, PH - 8, { align: 'right' })
  }

  const cleanBase = filename
    ? reportFileName(filename)
    : reportFileName('TyrePulse Accident Report', reportDateLabel())
  const fname = `${cleanBase}.pdf`
  if (save) doc.save(fname)
  return { doc, pages, filename: fname }
}
