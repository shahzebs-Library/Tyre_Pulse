/**
 * PresentationStudio - turn any page's data into a presentation.
 *
 * A reusable "build your own chart" studio: the host page passes a CATALOG of
 * chart sources (each already reduced to labels + values), and the studio gives
 * the user chart type, palette, sort, top-N, data labels, a % option, an
 * editable slide title and a numbers table - then Download PNG, Copy to
 * clipboard, Add to deck and Export PowerPoint (native editable .pptx, one slide
 * per chart). All client-side; no query. This is the SINGLE presentation surface
 * reused across Expenses, Board Overview, Cost per M3, CPK - do not fork it.
 *
 * A catalog source is one of:
 *   { key, label, kind:'flat',   rows:[{ label, value }] }
 *   { key, label, kind:'series', labels:[...], series:[{ name, data:[...] }],
 *       allowTotal?:bool }               // multi-series (e.g. monthly split)
 *
 * Props:
 *   catalog    Array<Source>            required
 *   currency   string                   e.g. 'SAR' (shown on the slide)
 *   money      (v:number)=>string       value formatter (defaults to currency)
 *   scope      string                   e.g. 'KSA' or 'All countries'
 *   company    string                   slide footer
 *   filePrefix string                   export file-name prefix
 *   note       string                   optional caption under the heading
 */
import { useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  BarChart3, Search, Image as ImageIcon, Copy, Plus, Presentation, Trash2, Save, FileSpreadsheet,
} from 'lucide-react'
import { PRESETS, PRESET_KEYS, PRESET_LABELS } from '../../lib/reportColors'
import { makeValueLabelsPlugin } from '../../lib/accidentReport'
import { reportFileName, exportToExcel } from '../../lib/exportUtils'
import { formatCurrency } from '../../lib/formatters'

// Idempotent - safe even if the host page already registered these.
ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Filler, Title, Tooltip, Legend,
)

const TYPES = [
  { key: 'bar', label: 'Bar' },
  { key: 'hbar', label: 'Horizontal bar' },
  { key: 'line', label: 'Line' },
  { key: 'doughnut', label: 'Doughnut' },
]
const TOPN = [10, 15, 20, 30, 50]
const SORTS = [
  { key: 'desc', label: 'High to low' },
  { key: 'asc', label: 'Low to high' },
  { key: 'none', label: 'As loaded' },
]
const LABEL_PLUGIN = makeValueLabelsPlugin('#94a3b8')

// Calibri body font (Carlito = its open, metric-compatible substitute).
const FONT_FAMILY = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif'
// Trim a long axis label so it does not overflow; the full name stays in the table.
const shortLabel = (v) => { const s = String(v ?? ''); return s.length > 16 ? `${s.slice(0, 15)}…` : s }

function themeInk() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim()
    return v || '#e5e7eb'
  } catch { return '#e5e7eb' }
}
function paletteColors(n, presetKey) {
  const p = PRESETS[presetKey] || PRESETS.vivid
  return Array.from({ length: Math.max(0, n | 0) }, (_, i) => p[i % p.length])
}
const chartBase = (legend) => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: !!legend, labels: { color: themeInk() } } },
  scales: {
    x: { ticks: { color: themeInk() }, grid: { display: false } },
    y: { ticks: { color: themeInk() }, grid: { color: 'rgba(148,163,184,0.15)' } },
  },
})

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      {children}
    </div>
  )
}
function Sel({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2.5 py-1.5 text-sm text-[var(--text-primary)]"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export default function PresentationStudio({
  catalog = [], currency = 'SAR', money, scope = '', company = 'TyrePulse',
  filePrefix = 'Chart', note = '', showInsights = false,
}) {
  const sources = (catalog || []).filter((s) => s && (s.kind === 'series' ? (s.labels || []).length : (s.rows || []).length))
  const fmtMoney = money || ((v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrency(Number(v), currency, 0)))

  const [st, setSt] = useState({
    dim: sources[0]?.key || '', type: 'bar', topN: 15, sort: 'desc', pct: false,
    palette: 'vivid', labels: true, legend: false, search: '', measure: 'split', title: '',
    stack: 'stacked',
  })
  const set = (patch) => setSt((s) => ({ ...s, ...patch }))
  const ref = useRef(null)
  const chartInst = useRef(null)   // live Chart.js instance (react-chartjs-2 ref)
  const [deck, setDeck] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // Saved reports: the studio config only (dimension/type/style), so the SAME
  // report re-runs on whatever data is loaded now. Persisted per page (filePrefix).
  const SAVE_KEY = `presentStudio.saved.${filePrefix}.v1`
  const [saved, setSaved] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
  })
  const persistSaved = (list) => { setSaved(list); try { localStorage.setItem(SAVE_KEY, JSON.stringify(list)) } catch { /* ignore */ } }

  const src = sources.find((s) => s.key === st.dim) || sources[0]
  const isSeries = src?.kind === 'series'
  // Measures for a series source: split (all), total (sum), or one series by name.
  const measureOpts = useMemo(() => {
    if (!isSeries) return []
    const names = (src.series || []).map((s) => ({ value: s.name, label: s.name }))
    const base = names.length > 1 ? [{ value: 'split', label: 'Split (all)' }] : []
    const total = src.allowTotal && names.length > 1 ? [{ value: 'total', label: 'Total' }] : []
    return [...base, ...total, ...names]
  }, [isSeries, src])
  const measure = isSeries
    ? (measureOpts.some((m) => m.value === st.measure) ? st.measure : (measureOpts[0]?.value || 'split'))
    : 'total'
  const isSplit = isSeries && measure === 'split'

  const dimLabel = src?.label || 'chart'
  const pctSuffix = st.pct && !isSeries && (src?.valueKind || 'money') === 'money'
  const autoTitle = isSeries
    ? `${dimLabel}${isSplit ? ' split' : measure === 'total' ? ' total' : ` (${measure})`}`
    : `By ${dimLabel.toLowerCase()}${pctSuffix ? ' (share %)' : ''}`
  const title = st.title.trim() || autoTitle

  const chart = useMemo(() => {
    if (!src) return { labels: [], datasets: [] }
    if (isSeries) {
      const labels = src.labels || []
      const series = src.series || []
      if (measure === 'split') {
        return { labels, datasets: series.map((s) => ({ label: s.name, data: (s.data || []).map((v) => Number(v) || 0) })) }
      }
      if (measure === 'total') {
        const data = labels.map((_, i) => series.reduce((a, s) => a + (Number(s.data?.[i]) || 0), 0))
        return { labels, datasets: [{ label: 'Total', data }] }
      }
      const one = series.find((s) => s.name === measure) || series[0]
      return { labels, datasets: [{ label: one?.name || 'Value', data: (one?.data || []).map((v) => Number(v) || 0) }] }
    }
    // Flat: filter -> sort -> top-N -> optional % (only when the source is money).
    const kind = src?.valueKind || 'money'
    const doPct = st.pct && kind === 'money'
    const q = st.search.trim().toLowerCase()
    let rows = (q ? src.rows.filter((r) => String(r.label || '').toLowerCase().includes(q)) : src.rows.slice())
      .map((r) => ({ label: r.label, v: Number(r.value) || 0 }))
    if (st.sort === 'desc') rows.sort((a, b) => b.v - a.v)
    else if (st.sort === 'asc') rows.sort((a, b) => a.v - b.v)
    rows = rows.slice(0, st.topN)
    if (doPct) {
      const tot = rows.reduce((s, r) => s + r.v, 0) || 1
      rows = rows.map((r) => ({ label: r.label, v: Math.round((r.v / tot) * 1000) / 10 }))
    }
    return { labels: rows.map((r) => r.label), datasets: [{ label: doPct ? 'Share %' : 'Value', data: rows.map((r) => r.v) }] }
  }, [src, isSeries, measure, st.search, st.sort, st.topN, st.pct])

  const data = useMemo(() => {
    const labels = chart.labels || []
    if (isSplit) {
      const cols = paletteColors((chart.datasets || []).length, st.palette)
      return { labels, datasets: (chart.datasets || []).map((ds, i) => ({ ...ds, backgroundColor: cols[i], borderColor: cols[i], fill: false })) }
    }
    const ds = chart.datasets?.[0] || { data: [] }
    if (st.type === 'line') {
      const c = paletteColors(1, st.palette)[0]
      return { labels, datasets: [{ ...ds, borderColor: c, backgroundColor: c, pointRadius: 3, tension: 0.25, fill: false }] }
    }
    const cols = paletteColors(labels.length, st.palette)
    return { labels, datasets: [{ ...ds, backgroundColor: cols, borderColor: cols, borderWidth: st.type === 'doughnut' ? 0 : 1 }] }
  }, [chart, isSplit, st.type, st.palette])

  const valueKind = src?.valueKind || 'money'   // 'money' | 'count' | 'percent' | 'rate'
  const srcFormat = typeof src?.format === 'function' ? src.format : null
  // % share only makes sense for money magnitudes (not counts/rates/percents).
  const canPct = !isSeries && valueKind === 'money'
  const usePct = st.pct && canPct
  const fmtCell = (v) => {
    if (usePct) return `${Number(v).toFixed(1)}%`
    if (srcFormat) return srcFormat(Number(v))
    if (valueKind === 'percent') return `${Number(v).toFixed(1)}%`
    if (valueKind === 'count') return Number(v).toLocaleString('en-US')
    if (valueKind === 'rate') return `${currency} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 })}`
    return fmtMoney(v)
  }
  const headerLabel = usePct ? 'Share %'
    : valueKind === 'percent' ? '%'
    : valueKind === 'count' ? (src?.unitLabel || 'Count')
    : valueKind === 'rate' ? (src?.unitLabel || 'Rate')
    : (src?.unitLabel || 'Value')

  const options = useMemo(() => {
    const stacked = isSplit && st.stack === 'stacked' && (st.type === 'bar' || st.type === 'hbar')
    const showLabels = st.labels && st.type !== 'doughnut'
    const showLegend = st.legend || isSplit || st.type === 'doughnut'
    const catTick = {
      color: themeInk(),
      font: { family: FONT_FAMILY, size: 14, weight: '600' },
      autoSkip: true,
      autoSkipPadding: 10,
      maxRotation: st.type === 'hbar' ? 0 : 50,
      minRotation: 0,
      callback(value) {
        // On the category axis chart.js passes the tick index; resolve to the label.
        const raw = this.getLabelForValue ? this.getLabelForValue(value) : value
        return st.type === 'hbar' ? shortLabel(raw) : shortLabel(raw)
      },
    }
    const valTick = { color: themeInk(), font: { family: FONT_FAMILY, size: 13 } }
    return {
      ...chartBase(showLegend),
      font: { family: FONT_FAMILY },
      indexAxis: st.type === 'hbar' ? 'y' : 'x',
      layout: { padding: { top: showLabels ? 18 : 6, right: st.type === 'hbar' ? 28 : 8 } },
      scales: st.type === 'doughnut' ? {} : {
        x: { stacked, ticks: st.type === 'hbar' ? valTick : catTick, grid: { display: false } },
        y: { stacked, beginAtZero: true, ticks: st.type === 'hbar' ? catTick : valTick, grid: { color: 'rgba(148,163,184,0.15)' } },
      },
      plugins: {
        legend: { display: showLegend, labels: { color: themeInk(), font: { family: FONT_FAMILY, size: 13 } } },
        tooltip: {
          enabled: true, bodyFont: { family: FONT_FAMILY, size: 13 }, titleFont: { family: FONT_FAMILY, size: 13 },
          // Tooltip shows the FULL label + formatted value (the axis is trimmed).
          callbacks: { label: (c) => `${c.dataset?.label || ''}: ${fmtCell(Number(c.parsed?.y ?? c.parsed?.x ?? c.parsed) || 0)}` },
        },
        valueLabels: { enabled: showLabels, color: themeInk(), size: 14, family: FONT_FAMILY },
      },
    }
    // st.dim included so a source switch rebuilds the tooltip's format closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSplit, st.type, st.labels, st.legend, st.pct, valueKind, st.dim, st.stack])

  const Comp = st.type === 'doughnut' ? Doughnut : (st.type === 'line' ? Line : Bar)
  const hasData = (chart.datasets || []).some((d) => (d.data || []).some((v) => Number(v)))
  // Give a crowded horizontal bar / long category list more room so labels breathe.
  const chartHeight = st.type === 'hbar'
    ? Math.min(720, Math.max(340, (chart.labels || []).length * 30))
    : 380

  const valueHeaders = isSplit ? (chart.datasets || []).map((d) => d.label) : [headerLabel]
  const tableRows = useMemo(() => {
    const labels = chart.labels || []
    if (isSplit) {
      const ds = chart.datasets || []
      return labels.map((lb, i) => ({ label: lb, cells: ds.map((d) => Number(d.data?.[i]) || 0) }))
    }
    const ds = chart.datasets?.[0]
    return labels.map((lb, i) => ({ label: lb, cells: [Number(ds?.data?.[i]) || 0] }))
  }, [chart, isSplit])

  // Presentation-quality PNG: re-render the live Chart INSTANCE onto white paper
  // at high resolution (2560px wide) with Calibri ink, so slides are crisp and
  // the text is never invisible-on-white. Falls back to the raw canvas.
  async function png() {
    try {
      const { captureChartOnPaper } = await import('../../lib/chartCapture')
      const inst = chartInst.current
      const hd = inst ? captureChartOnPaper(inst, { widthPt: 1280, scale: 2 }) : null
      if (hd) return hd
    } catch { /* fall through */ }
    const canvas = ref.current?.querySelector?.('canvas')
    return canvas ? canvas.toDataURL('image/png', 1) : null
  }
  async function downloadPng() {
    const img = await png(); if (!img) return
    const a = document.createElement('a')
    a.href = img
    a.download = `${reportFileName(filePrefix, dimLabel, scope || 'All')}.png`
    document.body.appendChild(a); a.click(); a.remove()
  }
  async function copyPng() {
    setMsg('')
    try {
      if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
        setMsg('Copy is not supported in this browser. Use Download PNG.'); return
      }
      const img = await png()
      if (!img) { setMsg('Could not read the chart.'); return }
      const blob = await (await fetch(img)).blob()   // the HD white-paper image
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
      setMsg('Chart copied. Paste it into your slide.')
    } catch { setMsg('Copy failed. Use Download PNG.') }
  }
  // Short, honest talking points derived from the CURRENT chart - a caption the
  // user can copy onto a slide. Enabled per-page via `showInsights`.
  const insights = useMemo(() => {
    if (!showInsights) return []
    const labels = chart.labels || []
    if (!labels.length) return []
    const pts = []
    if (isSplit) {
      const sums = (chart.datasets || []).map((d) => ({ name: d.label, total: (d.data || []).reduce((a, b) => a + (Number(b) || 0), 0) }))
      const grand = sums.reduce((a, s) => a + s.total, 0)
      const top = sums.slice().sort((a, b) => b.total - a.total)[0]
      pts.push(`${title}: ${fmtCell(grand)} in total across ${labels.length} months.`)
      if (top && grand) pts.push(`${top.name} is the biggest share at ${fmtCell(top.total)} (${Math.round((top.total / grand) * 100)}%).`)
    } else {
      const vals = (chart.datasets?.[0]?.data || []).map((v) => Number(v) || 0)
      const total = vals.reduce((a, b) => a + b, 0)
      if (isSeries) {
        let pk = 0; vals.forEach((v, i) => { if (v > vals[pk]) pk = i })
        pts.push(`Peak was ${labels[pk]} at ${fmtCell(vals[pk])}.`)
        const firstI = vals.findIndex((v) => v !== 0)
        const lastI = vals.length - 1 - [...vals].reverse().findIndex((v) => v !== 0)
        if (firstI >= 0 && lastI >= 0 && vals[firstI] !== 0 && firstI !== lastI) {
          const ch = Math.round(((vals[lastI] - vals[firstI]) / Math.abs(vals[firstI])) * 100)
          pts.push(`${ch >= 0 ? 'Up' : 'Down'} ${Math.abs(ch)}% from ${labels[firstI]} to ${labels[lastI]}.`)
        }
        if (valueKind === 'money') pts.push(`Total over the period: ${fmtCell(total)}.`)
      } else {
        const ranked = labels.map((l, i) => ({ l, v: vals[i] })).sort((a, b) => b.v - a.v)
        const top = ranked[0]
        if (top && total && valueKind === 'money') pts.push(`${top.l} leads at ${fmtCell(top.v)} (${Math.round((top.v / total) * 100)}% of the ${labels.length} shown).`)
        else if (top) pts.push(`Highest is ${top.l} at ${fmtCell(top.v)}.`)
        if (valueKind === 'money' && !usePct) pts.push(`Total shown: ${fmtCell(total)} across ${labels.length} ${dimLabel.toLowerCase()}s.`)
      }
    }
    return pts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInsights, chart, isSplit, isSeries, valueKind, usePct, title, dimLabel])

  // The copy-able block: title, talking points, AND the underlying numbers, so a
  // paste into a slide carries the figures, not just the prose.
  function insightsText() {
    const dataLines = tableRows.slice(0, 15).map((r) => {
      const vals = r.cells.map((c) => fmtCell(c)).join('  |  ')
      return `${r.label ?? 'N/A'}: ${vals}`
    })
    const head = valueHeaders.length > 1 ? `Item  |  ${valueHeaders.join('  |  ')}` : ''
    return [
      title,
      ...insights.map((p) => `- ${p}`),
      '',
      'Data:',
      ...(head ? [head] : []),
      ...dataLines,
    ].join('\n')
  }
  // Save the current setup as a reusable template (config only, no data), so the
  // same report re-runs on whatever is loaded now. Name = the slide title.
  function saveReport() {
    const name = (st.title.trim() || autoTitle).slice(0, 60)
    const config = {
      dim: st.dim, type: st.type, palette: st.palette, sort: st.sort, topN: st.topN,
      pct: st.pct, measure: st.measure, labels: st.labels, legend: st.legend, title: st.title,
    }
    persistSaved([...saved.filter((s) => s.name !== name), { name, config }])
    setMsg(`Saved "${name}".`)
  }
  function loadReport(name) {
    if (!name) return
    const r = saved.find((s) => s.name === name)
    if (!r) return
    const cfg = r.config || {}
    const dimOk = sources.some((s) => s.key === cfg.dim) ? cfg.dim : (sources[0]?.key || '')
    setSt((s) => ({ ...s, ...cfg, dim: dimOk }))
    setMsg(`Loaded "${name}". It now shows the current data.`)
  }
  function deleteReport(name) {
    persistSaved(saved.filter((s) => s.name !== name))
    setMsg(`Deleted "${name}".`)
  }

  async function copyInsights() {
    try {
      await navigator.clipboard.writeText(insightsText())
      setMsg('Talking points + data copied.')
    } catch { setMsg('Copy failed.') }
  }

  // Download the chart's underlying numbers as a formatted Excel sheet.
  function downloadExcel() {
    if (!tableRows.length) { setMsg('No numbers to export yet.'); return }
    const keys = ['label', ...valueHeaders.map((_, i) => `c${i}`)]
    const headers = [dimLabel, ...valueHeaders.map((h) => String(h))]
    const rows = tableRows.map((r) => {
      const o = { label: r.label ?? 'N/A' }
      r.cells.forEach((c, i) => { o[`c${i}`] = fmtCell(c) })
      return o
    })
    exportToExcel(rows, keys, headers, `${reportFileName(filePrefix, dimLabel, scope || 'All')}.xlsx`)
    setMsg('Excel downloaded.')
  }

  function slide(img) {
    // Pre-format cells so the .pptx table shows money / count / % correctly.
    const rows = tableRows.map((r) => ({ label: r.label, cells: r.cells.map(fmtCell) }))
    return { title, subtitle: `${scope || 'All'}  |  ${currency}`, img, rows, headers: valueHeaders, caption: insights.join('  ') }
  }
  async function addToDeck() {
    setMsg(''); const img = await png()
    if (!img) { setMsg('Nothing to add yet.'); return }
    setDeck((d) => [...d, slide(img)]); setMsg('Added to deck.')
  }
  async function downloadPptx() {
    let slides = deck
    if (!slides.length) { const img = hasData ? await png() : null; slides = img ? [slide(img)] : [] }
    if (!slides.length || slides.some((s) => !s.img)) { setMsg('No chart to export yet.'); return }
    setBusy(true); setMsg('')
    try {
      const { default: PptxGen } = await import('pptxgenjs')
      const pptx = new PptxGen()
      pptx.defineLayout({ name: 'TP16x9', width: 13.33, height: 7.5 }); pptx.layout = 'TP16x9'
      for (const s of slides) {
        const sl = pptx.addSlide(); sl.background = { color: 'FFFFFF' }
        sl.addText(String(s.title || 'Chart'), { x: 0.5, y: 0.35, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: '0F172A' })
        sl.addText(`${company}  |  ${s.subtitle}`, { x: 0.5, y: 0.95, w: 12.3, h: 0.35, fontSize: 12, color: '64748B' })
        sl.addImage({ data: s.img, x: 0.5, y: 1.4, w: 8.2, h: 5.6 })
        const head = [{ text: 'Item', options: { bold: true, fill: 'F1F5F9' } },
          ...s.headers.map((h) => ({ text: String(h), options: { bold: true, fill: 'F1F5F9', align: 'right' } }))]
        const body = s.rows.slice(0, 12).map((r) => ([
          { text: String(r.label ?? 'N/A'), options: { align: 'left' } },
          ...r.cells.map((c) => ({ text: String(c), options: { align: 'right' } })),
        ]))
        sl.addTable([head, ...body], { x: 9.0, y: 1.4, w: 3.8, fontSize: 9, color: '0F172A', border: { type: 'solid', color: 'E2E8F0', pt: 0.5 }, valign: 'middle' })
        // Talking-points caption under the chart (expenses only; empty elsewhere).
        if (s.caption) sl.addText(s.caption, { x: 0.5, y: 7.05, w: 8.2, h: 0.4, fontSize: 10, italic: true, color: '475569' })
      }
      await pptx.writeFile({ fileName: `${reportFileName(filePrefix, 'Presentation', scope || 'All')}.pptx` })
      setMsg(`PowerPoint exported (${slides.length} slide${slides.length === 1 ? '' : 's'}).`)
    } catch { setMsg('Could not build the PowerPoint file.') } finally { setBusy(false) }
  }

  if (!sources.length) {
    return <div className="card text-sm text-[var(--text-muted)]">No data to chart for the current selection.</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <BarChart3 size={15} className="text-[var(--accent)] mt-0.5 shrink-0" />
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">Chart builder</h2>
          <p className="text-xs text-[var(--text-tertiary)]">{note || `Present your own data. Style it, then copy, download a PNG, or export a PowerPoint deck. Values in ${currency}.`}</p>
        </div>
      </div>

      <div className="card space-y-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Slide title</span>
          <input value={st.title} onChange={(e) => set({ title: e.target.value })} placeholder={autoTitle}
            className="mt-1 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)]" />
        </div>

        {/* Saved templates: reuse the same report; it fills with the current data. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Saved reports</span>
          <select
            value=""
            onChange={(e) => { loadReport(e.target.value); e.target.value = '' }}
            className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2.5 py-1.5 text-sm text-[var(--text-primary)]"
            disabled={!saved.length}
          >
            <option value="">{saved.length ? 'Load a saved report...' : 'No saved reports yet'}</option>
            {saved.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
          <button type="button" onClick={saveReport} disabled={!hasData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><Save size={14} /> Save this report</button>
          {saved.length > 0 && (
            <button type="button" onClick={() => deleteReport(st.title.trim() || autoTitle)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]" title="Delete the saved report with this title"><Trash2 size={13} /> Delete this title</button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Chart">
            <Sel value={st.dim} onChange={(v) => set({ dim: v })} options={sources.map((s) => ({ value: s.key, label: s.label }))} />
          </Field>
          {isSeries && measureOpts.length > 1 && (
            <Field label="Measure"><Sel value={measure} onChange={(v) => set({ measure: v })} options={measureOpts} /></Field>
          )}
          <Field label="Type"><Sel value={st.type} onChange={(v) => set({ type: v })} options={TYPES.map((t) => ({ value: t.key, label: t.label }))} /></Field>
          <Field label="Colours"><Sel value={st.palette} onChange={(v) => set({ palette: v })} options={PRESET_KEYS.map((k) => ({ value: k, label: PRESET_LABELS[k] || k }))} /></Field>
          {!isSeries && (
            <Field label="Sort"><Sel value={st.sort} onChange={(v) => set({ sort: v })} options={SORTS.map((s) => ({ value: s.key, label: s.label }))} /></Field>
          )}
          {!isSeries && (
            <Field label="Show top"><Sel value={String(st.topN)} onChange={(v) => set({ topN: Number(v) })} options={TOPN.map((n) => ({ value: String(n), label: String(n) }))} /></Field>
          )}
          {!isSeries && (
            <Field label="Filter">
              <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input value={st.search} onChange={(e) => set({ search: e.target.value })} placeholder="name contains..."
                  className="w-44 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] pl-7 pr-2.5 py-1.5 text-sm text-[var(--text-primary)]" />
              </div>
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
            <input type="checkbox" checked={st.labels} onChange={(e) => set({ labels: e.target.checked })} className="accent-[var(--accent)]" /> Data labels
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
            <input type="checkbox" checked={st.legend} onChange={(e) => set({ legend: e.target.checked })} className="accent-[var(--accent)]" /> Legend
          </label>
          {isSplit && (st.type === 'bar' || st.type === 'hbar') && (
            <span className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
              Bars
              <span className="inline-flex overflow-hidden rounded-lg border border-[var(--input-border)]">
                {['stacked', 'grouped'].map((mode) => (
                  <button key={mode} type="button" onClick={() => set({ stack: mode })}
                    className={`px-2.5 py-1 text-xs capitalize ${st.stack === mode ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'}`}>
                    {mode}
                  </button>
                ))}
              </span>
            </span>
          )}
          {canPct && (
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
              <input type="checkbox" checked={st.pct} onChange={(e) => set({ pct: e.target.checked })} className="accent-[var(--accent)]" /> Show as % share
            </label>
          )}
        </div>

        <div className="rounded-lg border border-[var(--hairline)] p-3">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">{title}</p>
          <div ref={ref} style={{ height: chartHeight }}>
            {hasData ? (
              <Comp ref={chartInst} data={data} options={options} plugins={[LABEL_PLUGIN]} />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No data for this selection.</div>
            )}
          </div>
        </div>

        {/* Talking points - short copy-able explanation for a slide (expenses only). */}
        {showInsights && hasData && insights.length > 0 && (
          <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-2,rgba(148,163,184,0.06))] p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Talking points for your slide</span>
              <button type="button" onClick={copyInsights}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--input-border)] px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"><Copy size={12} /> Copy</button>
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-sm text-[var(--text-secondary)]">
              {insights.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={downloadPng} disabled={!hasData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><ImageIcon size={14} /> Download PNG</button>
          <button type="button" onClick={copyPng} disabled={!hasData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><Copy size={14} /> Copy chart</button>
          <button type="button" onClick={downloadExcel} disabled={!hasData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><FileSpreadsheet size={14} /> Download Excel</button>
          <button type="button" onClick={addToDeck} disabled={!hasData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><Plus size={14} /> Add to deck{deck.length ? ` (${deck.length})` : ''}</button>
          <button type="button" onClick={downloadPptx} disabled={busy || (!hasData && !deck.length)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"><Presentation size={14} /> {busy ? 'Building...' : (deck.length ? `Download PowerPoint (${deck.length})` : 'Download PowerPoint')}</button>
          {deck.length > 0 && (
            <button type="button" onClick={() => { setDeck([]); setMsg('Deck cleared.') }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"><Trash2 size={14} /> Clear deck</button>
          )}
          {msg && <span className="text-xs text-[var(--text-tertiary)]">{msg}</span>}
        </div>

        {hasData && (
          <details className="rounded-lg border border-[var(--hairline)]">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-[var(--text-secondary)]">Show the numbers</summary>
            <div className="max-h-72 overflow-auto px-3 pb-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
                    <th className="py-1.5 pr-3 font-semibold">{dimLabel}</th>
                    {valueHeaders.map((h) => <th key={h} className="py-1.5 px-3 font-semibold text-right">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r, i) => (
                    <tr key={`${r.label}-${i}`} className="border-b border-[var(--hairline)]/40">
                      <td className="py-1.5 pr-3 text-[var(--text-primary)]">{r.label ?? 'N/A'}</td>
                      {r.cells.map((c, ci) => <td key={ci} className="py-1.5 px-3 text-right text-[var(--text-secondary)] tabular-nums">{fmtCell(c)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
