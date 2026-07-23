/**
 * ExpenseReport (route /expense-report) - customizable maintenance & parts expense report.
 *
 * Sourced ONLY from the maintenance/parts expense grid (parts_consumption) via the
 * authoritative get_parts_expense_snapshot RPC (tyre/spare/oil split, by asset, store,
 * item and month). Mirrors BoardOverview: headline KPIs, breakdown charts and a 12-month
 * trend, each behind a persisted on/off section toggle. Nothing is fabricated - when the
 * backend has no data the page shows an honest empty state linking to Expense Import.
 * Colours use the single shared palette (reportColors) so it reads as one system.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Wallet, TrendingUp, PieChart, Download, RefreshCw, Eye, EyeOff, Boxes, Building2, Truck, Package,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings, COUNTRY_CURRENCY } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { getPartsExpenseSnapshot, getExpenseByCountry } from '../lib/api/partsConsumption'
import { stylize, ACCENTS } from '../lib/reportColors'
import { reportFileName, reportDateLabel, exportToExcel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Filler, Title, Tooltip, Legend,
)

const LS_KEY = 'expenseReport.sections.v1'
const SECTIONS = [
  ['kpis', 'KPIs', Wallet],
  ['categories', 'Categories', PieChart],
  ['sites', 'Stores', Building2],
  ['assets', 'Assets', Truck],
  ['items', 'Top Items', Package],
  ['trend', 'Trend', TrendingUp],
]
const SECTION_DEFAULTS = { kpis: true, categories: true, sites: true, assets: true, items: true, trend: true }

/** 'YYYY-MM' -> 'Mon YY' month label (passthrough for non date keys). */
const monthLabel = (key) => {
  const s = String(key || '')
  if (!/^\d{4}-\d{2}/.test(s)) return s
  const [y, m] = s.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
}

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString('en-US'))

const chartBase = (legend = false) => ({
  responsive: true,
  maintainAspectRatio: false,
  layout: { padding: { top: 8 } },
  plugins: {
    legend: { display: legend, labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: 'var(--panel-2)', titleColor: 'var(--panel-ink)', bodyColor: '#9ca3af', borderColor: 'var(--hairline)', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.12)' } },
    y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.12)' }, beginAtZero: true },
  },
})
const H_BAR_OPTS = { ...chartBase(false), indexAxis: 'y' }
const DOUGHNUT_OPTS = {
  responsive: true, maintainAspectRatio: false, cutout: '58%',
  plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
}

/** Colourful KPI tile. */
function Kpi({ label, value, accent = ACCENTS.primary, sub }) {
  return (
    <div className="card" style={{ borderTop: `3px solid ${accent}` }}>
      <p className="text-2xl font-bold" style={{ color: accent }}>{value}</p>
      <p className="text-xs text-[var(--text-muted)] mt-1">{label}</p>
      {sub ? <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p> : null}
    </div>
  )
}

function ChartCard({ title, children, refCb }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
      <div style={{ height: 240 }} ref={refCb}>{children}</div>
    </div>
  )
}

export default function ExpenseReport() {
  const { activeCountry, appSettings, activeCurrency } = useSettings()
  const [snap, setSnap] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [byCountry, setByCountry] = useState([])
  const isAll = !activeCountry || activeCountry === 'All'

  const [sections, setSections] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
      return { ...SECTION_DEFAULTS, ...(raw || {}) }
    } catch { return { ...SECTION_DEFAULTS } }
  })
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(sections)) } catch { /* ignore */ } }, [sections])
  const toggle = (key) => setSections((s) => ({ ...s, [key]: !s[key] }))

  const chartRefs = useRef({})
  const setRef = (key) => (el) => { chartRefs.current[key] = el }

  const money = useCallback((v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrency(Number(v), activeCurrency, 0)), [activeCurrency])

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const res = await getPartsExpenseSnapshot({
        country: activeCountry && activeCountry !== 'All' ? activeCountry : undefined,
        from: from || undefined,
        to: to || undefined,
      })
      setSnap(res && res.ok ? res : { ok: false })
      // On the "All countries" view, also load each country's total in its OWN
      // currency (SAR / AED / EGP) so they are shown side by side, never blended.
      if (isAll) {
        const rows = await getExpenseByCountry({ from: from || undefined, to: to || undefined }).catch(() => [])
        setByCountry(rows)
      } else {
        setByCountry([])
      }
      setUpdatedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the expense report.'))
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [activeCountry, from, to])

  useEffect(() => { load() }, [load])

  const k = snap?.ok ? snap.kpis : null

  // ── Chart data (built from the snapshot, styled with the shared palette) ─────
  const categoryChart = useMemo(() => {
    const rows = snap?.ok ? (snap.by_category || []) : []
    return { labels: rows.map((r) => r.label), datasets: [{ label: 'Spend', data: rows.map((r) => Number(r.spend) || 0) }] }
  }, [snap])

  const storeChart = useMemo(() => {
    const rows = (snap?.ok ? (snap.by_store || []) : []).slice(0, 15)
    return { labels: rows.map((r) => r.label), datasets: [{ label: 'Spend', data: rows.map((r) => Number(r.spend) || 0) }] }
  }, [snap])

  const assetChart = useMemo(() => {
    const rows = (snap?.ok ? (snap.by_asset || []) : []).slice(0, 15)
    return { labels: rows.map((r) => r.label), datasets: [{ label: 'Spend', data: rows.map((r) => Number(r.spend) || 0) }] }
  }, [snap])

  const itemChart = useMemo(() => {
    const rows = (snap?.ok ? (snap.top_items || []) : []).slice(0, 15)
    return { labels: rows.map((r) => r.label), datasets: [{ label: 'Spend', data: rows.map((r) => Number(r.spend) || 0) }] }
  }, [snap])

  const trendChart = useMemo(() => {
    const rows = snap?.ok ? (snap.monthly || []) : []
    return {
      labels: rows.map((r) => monthLabel(r.m)),
      datasets: [
        { label: 'Tyres', data: rows.map((r) => Number(r.tyre) || 0) },
        { label: 'Spare Parts', data: rows.map((r) => Number(r.spare) || 0) },
        { label: 'Oil', data: rows.map((r) => Number(r.oil) || 0) },
      ],
    }
  }, [snap])

  // Build the Expense Report PDF doc (mirrors BoardOverview.buildBoardDoc).
  async function buildExpenseDoc() {
    if (!snap?.ok) return null
    const { captureChartOnPaper } = await import('../lib/chartCapture')
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    const M = 12
    const company = appSettings?.company_name || 'TyrePulse'
    const scope = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
    doc.setFontSize(16); doc.setTextColor(15, 23, 42)
    doc.text(`${company} - Expense Report`, M, 16)
    doc.setFontSize(9); doc.setTextColor(100, 116, 139)
    doc.text(`${scope}  |  ${reportDateLabel(new Date())}`, M, 22)

    const tiles = [
      ['Total expense', money(k.total_expense)], ['Tyres', money(k.tyre_expense)],
      ['Spare parts', money(k.spare_expense)], ['Oil', money(k.oil_expense)],
      ['Lines', num(k.lines)], ['Tyres issued', num(k.tyres_issued)],
    ]
    let y = 30
    tiles.forEach((tl, i) => {
      const col = i % 6
      const x = M + col * ((W - 2 * M) / 6)
      doc.setTextColor(15, 23, 42); doc.setFontSize(11); doc.text(String(tl[1]), x, y + 6)
      doc.setTextColor(100, 116, 139); doc.setFontSize(7.5); doc.text(String(tl[0]), x, y + 11)
    })
    y += 20

    const order = ['category', 'store', 'asset', 'item', 'trend']
    let placed = 0
    for (const key of order) {
      const el = chartRefs.current[key]
      const canvas = el?.querySelector?.('canvas')
      if (!canvas) continue
      const img = captureChartOnPaper(canvas) || canvas.toDataURL('image/png', 1)
      if (!img) continue
      const cw = (W - 2 * M - 8) / 2
      const ch = 55
      const col = placed % 2
      const rowY = y + Math.floor(placed / 2) * (ch + 6)
      if (rowY + ch > doc.internal.pageSize.getHeight() - 10) { doc.addPage('a4', 'landscape'); y = 14; placed = 0 }
      const x = M + col * (cw + 8)
      const yy = y + Math.floor(placed / 2) * (ch + 6)
      doc.addImage(img, 'PNG', x, yy, cw, ch)
      placed += 1
    }
    return { doc, company }
  }

  async function exportPdf() {
    if (!snap?.ok) return
    setExporting(true)
    try {
      const built = await buildExpenseDoc()
      if (built) built.doc.save(`${reportFileName(built.company, 'Expense Report', reportDateLabel())}.pdf`)
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  async function exportExcel() {
    if (!snap?.ok) return
    setExporting(true)
    try {
      const company = appSettings?.company_name || 'TyrePulse'
      const rows = []
      ;(snap.by_store || []).forEach((r) => rows.push({ section: 'Store', name: r.label, spend: Number(r.spend) || 0, count: '' }))
      ;(snap.top_items || []).forEach((r) => rows.push({ section: 'Top Item', name: r.label, spend: Number(r.spend) || 0, count: Number(r.n) || '' }))
      ;(snap.monthly || []).forEach((r) => rows.push({ section: 'Month', name: monthLabel(r.m), spend: Number(r.total) || 0, count: '' }))
      await exportToExcel(
        rows,
        ['section', 'name', 'spend', 'count'],
        ['Section', 'Name', 'Spend', 'Count'],
        reportFileName(company, 'Expense Report', reportDateLabel()),
        'Expenses',
        { currency: activeCurrency, company, title: `${company} Expense Report` },
      )
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  const hasAny = !!(k && (Number(k.total_expense) || Number(k.lines)))

  return (
    <div className="space-y-5">
      <PageHeader title="Expense Report" subtitle="Maintenance and parts expense: tyres, spare parts and oil" icon={Wallet} />

      {/* Section toggles + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {SECTIONS.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${sections[key] ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}
            >
              <Icon size={13} /> {label} {sections[key] ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs px-2 py-1.5 text-[var(--text-secondary)]"
            aria-label="From date"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs px-2 py-1.5 text-[var(--text-secondary)]"
            aria-label="To date"
          />
          {updatedAt && <span className="text-[11px] text-[var(--text-muted)]">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button onClick={load} disabled={refreshing} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={exportPdf} disabled={exporting || !hasAny} className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download size={14} /> {exporting ? 'Preparing...' : 'Export PDF'}
          </button>
          <button onClick={exportExcel} disabled={exporting || !hasAny} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Boxes size={14} /> Export Excel
          </button>
        </div>
      </div>

      {error && <div className="card border border-red-700/50 text-red-300 text-sm">{error}</div>}
      {loading ? (
        <div className="card text-center text-[var(--text-muted)] py-10">Loading the expense report...</div>
      ) : !hasAny ? (
        <div className="card text-center text-[var(--text-muted)] py-10">
          <p>No expense data yet. Import your grid file from <Link to="/expense-import" className="text-[var(--accent)] font-semibold hover:underline">Expense Import</Link>.</p>
        </div>
      ) : (
        <>
          {/* KPIs - hidden on the All-countries view (the per-country panel below
              shows each currency separately instead of a blended total). */}
          {sections.kpis && k && !isAll && (
            <section className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label="Total expense" value={money(k.total_expense)} accent={ACCENTS.primary} />
                <Kpi label="Tyres" value={money(k.tyre_expense)} accent={ACCENTS.info} />
                <Kpi label="Spare parts" value={money(k.spare_expense)} accent={ACCENTS.watch} />
                <Kpi label="Oil" value={money(k.oil_expense)} accent={ACCENTS.good} />
                <Kpi label="Lines" value={num(k.lines)} accent={ACCENTS.neutral} />
                <Kpi label="Tyres issued" value={num(k.tyres_issued)} accent={ACCENTS.risk} sub={`${num(k.reassigned_tyres)} reassigned`} />
              </div>
            </section>
          )}

          {/* Per-country totals in each own currency (All-countries view only, so
              SAR / AED / EGP are never blended into one meaningless sum). */}
          {isAll && byCountry.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
                <Wallet size={15} /> By country (own currency)
              </h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Each country is shown in its own currency and is not summed together (SAR, AED and EGP are different currencies).
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {byCountry.map((c) => {
                  const cur = COUNTRY_CURRENCY[c.country] || 'SAR'
                  const fmt = (v) => formatCurrency(Number(v) || 0, cur, 0)
                  return (
                    <div key={c.country} className="card p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{c.country}</p>
                        <span className="text-xs px-2 py-0.5 rounded bg-[var(--surface-2,#1e293b)] text-[var(--text-secondary)]">{cur}</span>
                      </div>
                      <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">{fmt(c.total)}</p>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--text-secondary)]">
                        <div><span className="block text-[var(--text-tertiary)]">Tyres</span>{fmt(c.tyre)}</div>
                        <div><span className="block text-[var(--text-tertiary)]">Spare</span>{fmt(c.spare)}</div>
                        <div><span className="block text-[var(--text-tertiary)]">Oil</span>{fmt(c.oil)}</div>
                      </div>
                      <p className="mt-2 text-xs text-[var(--text-tertiary)]">{num(c.lines)} lines</p>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Categories */}
          {sections.categories && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><PieChart size={15} /> Spend by category</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Tyres vs Spare Parts vs Oil" refCb={setRef('category')}><Doughnut data={stylize(categoryChart, 'doughnut')} options={DOUGHNUT_OPTS} /></ChartCard>
              </div>
            </section>
          )}

          {/* Stores + Assets */}
          {(sections.sites || sections.assets) && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Building2 size={15} /> Spend by store and asset</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {sections.sites && <ChartCard title="Top stores by spend" refCb={setRef('store')}><Bar data={stylize(storeChart, 'bar')} options={chartBase(false)} /></ChartCard>}
                {sections.assets && <ChartCard title="Top assets by spend" refCb={setRef('asset')}><Bar data={stylize(assetChart, 'bar')} options={chartBase(false)} /></ChartCard>}
              </div>
            </section>
          )}

          {/* Top Items */}
          {sections.items && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Package size={15} /> Top items</h2>
              <div className="grid grid-cols-1 gap-4">
                <ChartCard title="Top items by spend" refCb={setRef('item')}><Bar data={stylize(itemChart, 'bar')} options={H_BAR_OPTS} /></ChartCard>
              </div>
            </section>
          )}

          {/* Trend */}
          {sections.trend && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><TrendingUp size={15} /> Monthly expense trend</h2>
              <div className="grid grid-cols-1 gap-4">
                <ChartCard title="Tyres, spare parts and oil by month" refCb={setRef('trend')}><Line data={stylize(trendChart, 'line')} options={chartBase(true)} /></ChartCard>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
