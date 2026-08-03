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
  BarChart3, Search, Image as ImageIcon, Copy, Plus, Presentation, Trash2,
} from 'lucide-react'
import { PRESETS, PRESET_KEYS, PRESET_LABELS } from '../../lib/reportColors'
import { makeValueLabelsPlugin } from '../../lib/accidentReport'
import { reportFileName } from '../../lib/exportUtils'
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
  filePrefix = 'Chart', note = '',
}) {
  const sources = (catalog || []).filter((s) => s && (s.kind === 'series' ? (s.labels || []).length : (s.rows || []).length))
  const fmtMoney = money || ((v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrency(Number(v), currency, 0)))

  const [st, setSt] = useState({
    dim: sources[0]?.key || '', type: 'bar', topN: 15, sort: 'desc', pct: false,
    palette: 'vivid', labels: true, legend: false, search: '', measure: 'split', title: '',
  })
  const set = (patch) => setSt((s) => ({ ...s, ...patch }))
  const ref = useRef(null)
  const [deck, setDeck] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

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
  const autoTitle = isSeries
    ? `${dimLabel}${isSplit ? ' split' : measure === 'total' ? ' total' : ` (${measure})`}`
    : `By ${dimLabel.toLowerCase()}${st.pct ? ' (share %)' : ''}`
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
    // Flat: filter -> sort -> top-N -> optional %.
    const q = st.search.trim().toLowerCase()
    let rows = (q ? src.rows.filter((r) => String(r.label || '').toLowerCase().includes(q)) : src.rows.slice())
      .map((r) => ({ label: r.label, v: Number(r.value) || 0 }))
    if (st.sort === 'desc') rows.sort((a, b) => b.v - a.v)
    else if (st.sort === 'asc') rows.sort((a, b) => a.v - b.v)
    rows = rows.slice(0, st.topN)
    if (st.pct) {
      const tot = rows.reduce((s, r) => s + r.v, 0) || 1
      rows = rows.map((r) => ({ label: r.label, v: Math.round((r.v / tot) * 1000) / 10 }))
    }
    return { labels: rows.map((r) => r.label), datasets: [{ label: st.pct ? 'Share %' : 'Value', data: rows.map((r) => r.v) }] }
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

  const options = useMemo(() => {
    const stacked = isSplit && (st.type === 'bar' || st.type === 'hbar')
    const showLabels = st.labels && st.type !== 'doughnut'
    const showLegend = st.legend || isSplit || st.type === 'doughnut'
    return {
      ...chartBase(showLegend),
      indexAxis: st.type === 'hbar' ? 'y' : 'x',
      scales: st.type === 'doughnut' ? {} : {
        x: { stacked, ticks: { color: themeInk(), autoSkip: st.type !== 'hbar', maxRotation: 60 }, grid: { display: false } },
        y: { stacked, beginAtZero: true, ticks: { color: themeInk() }, grid: { color: 'rgba(148,163,184,0.15)' } },
      },
      plugins: {
        legend: { display: showLegend, labels: { color: themeInk() } },
        tooltip: { enabled: true },
        valueLabels: { enabled: showLabels, color: themeInk(), size: 10 },
      },
    }
  }, [isSplit, st.type, st.labels, st.legend])

  const Comp = st.type === 'doughnut' ? Doughnut : (st.type === 'line' ? Line : Bar)
  const hasData = (chart.datasets || []).some((d) => (d.data || []).some((v) => Number(v)))

  const valueKind = src?.valueKind || 'money'   // 'money' | 'count'
  const valueHeaders = isSplit ? (chart.datasets || []).map((d) => d.label) : [st.pct ? 'Share %' : (valueKind === 'count' ? 'Count' : 'Value')]
  const tableRows = useMemo(() => {
    const labels = chart.labels || []
    if (isSplit) {
      const ds = chart.datasets || []
      return labels.map((lb, i) => ({ label: lb, cells: ds.map((d) => Number(d.data?.[i]) || 0) }))
    }
    const ds = chart.datasets?.[0]
    return labels.map((lb, i) => ({ label: lb, cells: [Number(ds?.data?.[i]) || 0] }))
  }, [chart, isSplit])
  const fmtCell = (v) => {
    if (st.pct) return `${Number(v).toFixed(1)}%`
    if (valueKind === 'count') return Number(v).toLocaleString('en-US')
    return fmtMoney(v)
  }

  async function png() {
    const canvas = ref.current?.querySelector?.('canvas')
    if (!canvas) return null
    try {
      const { captureChartOnPaper } = await import('../../lib/chartCapture')
      return captureChartOnPaper(canvas) || canvas.toDataURL('image/png', 1)
    } catch { return canvas.toDataURL('image/png', 1) }
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
      const canvas = ref.current?.querySelector?.('canvas')
      if (!canvas || !navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
        setMsg('Copy is not supported in this browser. Use Download PNG.'); return
      }
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png', 1))
      if (!blob) { setMsg('Could not read the chart.'); return }
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
      setMsg('Chart copied. Paste it into your slide.')
    } catch { setMsg('Copy failed. Use Download PNG.') }
  }
  function slide(img) {
    // Pre-format cells so the .pptx table shows money / count / % correctly.
    const rows = tableRows.map((r) => ({ label: r.label, cells: r.cells.map(fmtCell) }))
    return { title, subtitle: `${scope || 'All'}  |  ${currency}`, img, rows, headers: valueHeaders }
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
          {!isSeries && (
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
              <input type="checkbox" checked={st.pct} onChange={(e) => set({ pct: e.target.checked })} className="accent-[var(--accent)]" /> Show as % share
            </label>
          )}
        </div>

        <div className="rounded-lg border border-[var(--hairline)] p-3">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">{title}</p>
          <div ref={ref} style={{ height: 360 }}>
            {hasData ? (
              <Comp data={data} options={options} plugins={[LABEL_PLUGIN]} />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No data for this selection.</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={downloadPng} disabled={!hasData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><ImageIcon size={14} /> Download PNG</button>
          <button type="button" onClick={copyPng} disabled={!hasData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"><Copy size={14} /> Copy chart</button>
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
