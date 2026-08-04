/**
 * BoardOverview (route /board-overview) - the single management report.
 *
 * ONE colourful, trend-led report that consolidates every module: headline
 * KPIs first, then 12-month TRENDS, then breakdown CHARTS, then honest
 * RECOMMENDATIONS. Each section has an on/off toggle (persisted). All numbers
 * come from the shared engines (kpiEngine, claimsAnalytics) via boardOverview.js
 * - nothing is fabricated; an empty module renders an honest "N/A" / empty state.
 * Colours use the single shared palette (reportColors) so it reads as one system.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  LayoutDashboard, TrendingUp, PieChart, Lightbulb, Download, RefreshCw, Eye, EyeOff, Wallet, BarChart3,
  Gauge, Clock, Layers, AlertTriangle,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import YearlyTrendPanel from '../components/expense/YearlyTrendPanel'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import {
  listKpiTyreRecords, listKpiInspections, listKpiCorrectiveActions, listKpiFleet,
} from '../lib/api/engineeringKpi'
import { listAllAccidentsForPage } from '../lib/api/accidents'
import { listWorkOrdersForPage } from '../lib/api/workOrders'
import { listStockRecords } from '../lib/api/stock'
import {
  buildBoardKpis, buildTrends, buildBreakdowns, buildBoardRecommendations,
} from '../lib/boardOverview'
import { COST_MODES, pickCost, pickMonthly, splitTotals, costModeLabel } from '../lib/costSources'
import { loadGovernedCostSplit } from '../lib/api/governedCost'
import CostValue from '../components/cost/CostValue'
import { getFleetCpk } from '../lib/api/fleetCpk'
import {
  fmtCpkValue, fmtDistance, fmtCoverage, unitSuffix, sortByTypeWorstFirst, fleetTiles,
} from '../lib/fleetCpkView'
import { stylize, ACCENTS } from '../lib/reportColors'
import { reportFileName, reportDateLabel } from '../lib/exportUtils'
import EmailPdfButton from '../components/EmailPdfButton'
import PresentationStudio from '../components/present/PresentationStudio'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Filler, Title, Tooltip, Legend,
)

// Hard row ceilings for the bounded client reads behind the board KPIs/charts.
// The event tables (tyre_records / inspections / corrective_actions) can grow to
// millions of rows, so the reads that feed the client-side engines are capped and
// a truncated read is surfaced as an honest "capped view" note. The fleet register
// read uses a tighter ceiling.
const ROW_CAP = 50000
const FLEET_CAP = 20000

const LS_KEY = 'boardOverview.sections.v1'
const SECTIONS = [
  ['kpis', 'KPIs', LayoutDashboard],
  ['trends', 'Trends', TrendingUp],
  ['yearlyTrend', 'Yearly Expense', TrendingUp],
  ['charts', 'Charts', PieChart],
  ['costSplit', 'Tyres vs Maintenance', Wallet],
  ['fleetCpk', 'Fleet CPK', Gauge],
  ['builder', 'Chart Builder', BarChart3],
  ['recommendations', 'Recommendations', Lightbulb],
]
const SECTION_DEFAULTS = { kpis: true, trends: true, yearlyTrend: true, charts: true, costSplit: true, fleetCpk: true, builder: true, recommendations: true }

/** 'YYYY-MM' -> 'Mon YY' month label (passthrough for non date keys). */
const monthLabel = (key) => {
  const s = String(key || '')
  if (!/^\d{4}-\d{2}/.test(s)) return s
  const [y, m] = s.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
}

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString('en-US'))
// Takes the ACTIVE currency: the fleet spans countries with different currencies
// (KSA SAR, UAE AED, Egypt EGP), so omitting it silently labelled every figure SAR.
const money = (v, currency) => (
  v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrency(Number(v), currency)
)
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : `${Number(v)}%`)

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

export default function BoardOverview() {
  const { activeCountry, appSettings, activeCurrency } = useSettings()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [truncated, setTruncated] = useState(false)

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

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const [tyresRes, inspRes, actionsQ, fleetQ, accRes, workOrders, stock] = await Promise.all([
        fetchAllPages((from, to) => listKpiTyreRecords({ country: activeCountry, from, to }), { max: ROW_CAP }),
        fetchAllPages((from, to) => listKpiInspections({ country: activeCountry, from, to }), { max: ROW_CAP }),
        fetchAllPages((from, to) => listKpiCorrectiveActions({ country: activeCountry, from, to }), { max: ROW_CAP }),
        fetchAllPages((from, to) => listKpiFleet({ country: activeCountry, from, to }), { max: FLEET_CAP }),
        listAllAccidentsForPage({ country: activeCountry }),
        listWorkOrdersForPage({ country: activeCountry }).catch(() => []),
        listStockRecords({ country: activeCountry }).catch(() => []),
      ])
      const tyres = tyresRes.data ?? []
      const inspections = inspRes.data ?? []
      const actions = actionsQ?.data ?? []
      const fleetSize = (fleetQ?.data ?? []).length
      const accidents = accRes?.data ?? []
      setTruncated(Boolean(tyresRes.truncated || inspRes.truncated || actionsQ.truncated || fleetQ.truncated))
      const now = new Date()
      setData({
        kpis: buildBoardKpis({ tyres, inspections, actions, fleetSize, accidents, workOrders: workOrders || [], stock: stock || [], now }),
        trends: buildTrends({ tyres, accidents, inspections, now }),
        breakdowns: buildBreakdowns({ accidents, tyres }),
      })
      setUpdatedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the board overview.'))
      setTruncated(false)
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const recs = useMemo(() => buildBoardRecommendations(data?.kpis), [data])

  // ── Tyres vs Maintenance cost split (own tri-state + cancel guard) ──────────
  const [cost, setCost] = useState(null)      // { tyre, maintenance, byMonth } | null
  const [costLoading, setCostLoading] = useState(true)
  const [costError, setCostError] = useState('')
  const [costMode, setCostMode] = useState('combined')

  useEffect(() => {
    let cancelled = false
    setCostLoading(true); setCostError('')
    loadGovernedCostSplit({ country: activeCountry })
      .then((res) => { if (!cancelled) setCost(res) })
      .catch((e) => { if (!cancelled) setCostError(toUserMessage(e, 'Could not load the cost split.')) })
      .finally(() => { if (!cancelled) setCostLoading(false) })
    return () => { cancelled = true }
  }, [activeCountry])

  const costTotals = useMemo(() => splitTotals(cost?.byMonth || []), [cost])
  const costHeadline = useMemo(() => pickCost(costMode, costTotals), [costMode, costTotals])

  // ── Unit-aware Fleet CPK (cost per km / hour) ───────────────────────────────
  // Server aggregate get_fleet_cpk chooses km for road assets and engine-hours for
  // plant, and keeps each country in its own currency. Windowed to the last 365
  // days (this page has no date-range control).
  const [fleetCpk, setFleetCpk] = useState({ perVehicle: [], byType: [], fleet: [] })
  const [fleetCpkLoading, setFleetCpkLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    setFleetCpkLoading(true)
    const scopedCountry = activeCountry && activeCountry !== 'All' ? activeCountry : undefined
    const p = (n) => String(n).padStart(2, '0')
    const today = new Date()
    const start = new Date(); start.setDate(start.getDate() - 365)
    const iso = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    getFleetCpk({ country: scopedCountry, from: iso(start), to: iso(today) })
      .then((res) => { if (!cancelled) setFleetCpk(res || { perVehicle: [], byType: [], fleet: [] }) })
      .catch(() => { if (!cancelled) setFleetCpk({ perVehicle: [], byType: [], fleet: [] }) })
      .finally(() => { if (!cancelled) setFleetCpkLoading(false) })
    return () => { cancelled = true }
  }, [activeCountry])

  const cpkFleetTiles = useMemo(() => fleetTiles(fleetCpk.fleet), [fleetCpk])
  // Top worst asset-types (highest CPK first). Cap at 6 for a board summary.
  const cpkTopTypes = useMemo(() => sortByTypeWorstFirst(fleetCpk.byType).slice(0, 6), [fleetCpk])
  const cpkHasData = cpkFleetTiles.length > 0 || cpkTopTypes.length > 0

  // AUTHORITATIVE tyre spend = the classified expense grid (loadCostSplit),
  // never a sum of tyre_records.cost_per_tyre: a large share of tyre rows carry
  // no price, so that sum understates real tyre spend several-fold. This page
  // already renders the grid figure in its Tyres-vs-Maintenance panel, so using
  // the engine's cost_per_tyre fallback for the headline KPI put two different
  // numbers for the SAME fact on one screen. Falls back to the engine value only
  // when the grid has nothing for this scope.
  const tyreSpendValue = useMemo(
    () => (costTotals.tyre > 0 ? costTotals.tyre : (data?.kpis?.tyreSpend ?? null)),
    [costTotals, data],
  )
  const costChart = useMemo(() => {
    const rows = cost?.byMonth || []
    return {
      labels: rows.map((r) => monthLabel(r.month)),
      datasets: [{ label: `${costModeLabel(costMode)} spend`, data: pickMonthly(costMode, rows).map((m) => m.value) }],
    }
  }, [cost, costMode])

  // Chart Builder catalog: the board's own breakdowns + trends, ready to present.
  const studioCatalog = useMemo(() => {
    const b = data?.breakdowns
    const t = data?.trends
    const flat = (key, label, chart, valueKind) => {
      const labels = chart?.labels || []
      const d = chart?.datasets?.[0]?.data || []
      return { key, label, kind: 'flat', valueKind, rows: labels.map((l, i) => ({ label: l, value: Number(d[i]) || 0 })) }
    }
    const series = (key, label, chart, valueKind, allowTotal = false) => ({
      key, label, kind: 'series', valueKind, allowTotal,
      labels: chart?.labels || [],
      series: (chart?.datasets || []).map((ds) => ({ name: ds.label || 'Value', data: ds.data || [] })),
    })
    const out = []
    if (b) {
      out.push(flat('acc_site', 'Accidents by site', b.accidentsBySite, 'count'))
      out.push(flat('tyre_site', 'Tyres by site', b.tyresBySite, 'count'))
      out.push(flat('acc_sev', 'Accident severity', b.accidentSeverity, 'count'))
      out.push(flat('claim_status', 'Claim status', b.claimStatus, 'count'))
    }
    if (t) {
      out.push(series('m_tyre', 'Monthly tyre spend', t.tyreSpend, 'money'))
      out.push(series('m_acc', 'Monthly accidents', t.accidents, 'count'))
      out.push(series('m_insp', 'Monthly inspections', t.inspections, 'count'))
      out.push(series('m_claims', 'Monthly claims (claimed vs recovered)', t.claims, 'money', true))
    }
    if ((costChart.labels || []).length) out.push(series('m_cost', `Monthly ${costModeLabel(costMode).toLowerCase()} cost`, costChart, 'money'))
    return out.filter((s) => (s.kind === 'series' ? (s.labels || []).length : (s.rows || []).length))
  }, [data, costChart, costMode])

  // Build the Board Overview PDF doc. Shared by Download + Email so the emailed
  // report is identical to the downloaded one. Returns { doc, company } or null.
  async function buildBoardDoc() {
    if (!data) return null
    const { captureChartOnPaper } = await import('../lib/chartCapture')
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const W = doc.internal.pageSize.getWidth()
      const M = 12
      const company = appSettings?.company_name || 'TyrePulse'
      const scope = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
      doc.setFontSize(16); doc.setTextColor(15, 23, 42)
      doc.text(`${company} - Board Overview`, M, 16)
      doc.setFontSize(9); doc.setTextColor(100, 116, 139)
      doc.text(`${scope}  |  ${reportDateLabel(new Date())}`, M, 22)

      const k = data.kpis
      const tiles = [
        ['Fleet vehicles', num(k.fleetSize)], ['Tyres tracked', num(k.tyresTracked)],
        ['Fleet avg CPK', money(k.fleetAvgCpk, activeCurrency)], ['Tyre spend', money(tyreSpendValue, activeCurrency)],
        ['Accidents', num(k.accidents)], ['Open accidents', num(k.openAccidents)],
        ['Claims value', money(k.claimed, activeCurrency)], ['Recovered', money(k.recovered, activeCurrency)],
        ['Inspections', num(k.inspections)], ['Work orders open', num(k.workOrdersOpen)],
      ]
      let y = 30
      doc.setFontSize(8)
      tiles.forEach((t, i) => {
        const col = i % 5, row = Math.floor(i / 5)
        const x = M + col * ((W - 2 * M) / 5)
        const yy = y + row * 16
        doc.setTextColor(15, 23, 42); doc.setFontSize(11); doc.text(String(t[1]), x, yy + 6)
        doc.setTextColor(100, 116, 139); doc.setFontSize(7.5); doc.text(String(t[0]), x, yy + 11)
      })
      y += 34

      // Fleet CPK summary (text): one line per country tile, each in its own
      // currency. Straightforward text, so it travels with the board PDF.
      if (cpkFleetTiles.length > 0) {
        doc.setTextColor(15, 23, 42); doc.setFontSize(10)
        doc.text('Fleet CPK (cost per km / hour, last 365 days)', M, y)
        y += 6
        doc.setFontSize(8)
        cpkFleetTiles.forEach((tile) => {
          const unitLabel = tile.unit === 'engine_hours' ? 'per hour' : 'per km'
          doc.setTextColor(71, 85, 105)
          doc.text(
            `${tile.country || 'Fleet'} (${unitLabel}): Total ${fmtCpkValue(tile.cpkTotal, tile.currency, tile.unit)}`
              + `  |  Tyre ${fmtCpkValue(tile.cpkTyre, tile.currency, tile.unit)}  |  Coverage ${fmtCoverage(tile.coveragePct)}`,
            M, y,
          )
          y += 5
        })
        y += 4
      }

      const order = ['trendSpend', 'trendAccidents', 'trendClaims', 'trendInspections', 'costSplit', 'sev', 'claimStatus', 'accSite', 'tyreSite']
      let placed = 0
      for (const key of order) {
        const el = chartRefs.current[key]
        const canvas = el?.querySelector?.('canvas')
        if (!canvas) continue
        const img = captureChartOnPaper(canvas) || canvas.toDataURL('image/png', 1)
        if (!img) continue
        const cw = (W - 2 * M - 8) / 2
        const ch = 55
        const col = placed % 2, rowY = y + Math.floor(placed / 2) * (ch + 6)
        if (rowY + ch > doc.internal.pageSize.getHeight() - 10) { doc.addPage('a4', 'landscape'); y = 14; placed = 0 }
        const x = M + col * (cw + 8)
        const yy = y + Math.floor(placed / 2) * (ch + 6)
        doc.addImage(img, 'PNG', x, yy, cw, ch)
        placed += 1
      }
      return { doc, company }
  }

  async function exportPdf() {
    if (!data) return
    setExporting(true)
    try {
      const built = await buildBoardDoc()
      if (built) built.doc.save(`${reportFileName(built.company, 'Board Overview', reportDateLabel())}.pdf`)
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  const k = data?.kpis
  const t = data?.trends
  const b = data?.breakdowns
  const hasAny = k && (k.tyresTracked || k.accidents || k.inspections || k.fleetSize)

  return (
    <div className="space-y-5">
      <PageHeader title="Board Overview" subtitle="One report: KPIs, trends and charts across every module" icon={LayoutDashboard} />

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
        <div className="flex items-center gap-2">
          {updatedAt && <span className="text-[11px] text-[var(--text-muted)]">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button onClick={load} disabled={refreshing} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={exportPdf} disabled={exporting || !hasAny} className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download size={14} /> {exporting ? 'Preparing...' : 'Export PDF'}
          </button>
          <EmailPdfButton
            disabled={!hasAny}
            className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50"
            getPdf={async () => {
              const built = await buildBoardDoc()
              if (!built) throw new Error('No data to send.')
              return {
                base64: built.doc.output('datauristring').split(',')[1],
                filename: `${reportFileName(built.company, 'Board Overview', reportDateLabel())}.pdf`,
                subject: `${built.company} - Board Overview`,
                bodyHtml: `<p>Attached is the ${built.company} Board Overview report.</p>`,
              }
            }}
          />
        </div>
      </div>

      {error && <div className="card border border-red-700/50 text-red-300 text-sm">{error}</div>}
      {loading ? (
        <div className="card text-center text-[var(--text-muted)] py-10">Loading the board overview...</div>
      ) : !hasAny ? (
        <div className="card text-center text-[var(--text-muted)] py-10">No data yet for the selected scope. Records will appear here as they are captured.</div>
      ) : (
        <>
          {truncated && (
            <div className="flex items-center gap-2 text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-2.5">
              <AlertTriangle size={13} />
              Showing a capped view of up to {ROW_CAP.toLocaleString('en-US')} records. KPIs, trends and charts reflect this capped set. Narrow the country scope for full detail.
            </div>
          )}

          {/* KPIs */}
          {sections.kpis && k && (
            <section className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <Kpi label="Fleet vehicles" value={num(k.fleetSize)} accent={ACCENTS.primary} />
                <Kpi label="Tyres tracked" value={num(k.tyresTracked)} accent={ACCENTS.info} />
                <Kpi label="Fleet avg CPK" value={money(k.fleetAvgCpk, activeCurrency)} accent={ACCENTS.good} />
                {/* GOVERNED: renders one figure per currency when the scope
                    spans countries, instead of labelling a blend as SAR. */}
                <Kpi label="Tyre spend"
                  value={costTotals.tyre > 0
                    ? <CostValue split={cost} mode="tyres" />
                    : money(tyreSpendValue, activeCurrency)}
                  accent={ACCENTS.watch}
                  sub={costTotals.tyre > 0 ? 'expense grid, last 12 mo' : 'from tyre records'} />
                <Kpi label="Failure rate" value={pct(k.failureRatePct)} accent={ACCENTS.risk} />
                <Kpi label="Accidents" value={num(k.accidents)} accent={ACCENTS.risk} sub={`${num(k.openAccidents)} open`} />
                <Kpi label="Claims value" value={money(k.claimed, activeCurrency)} accent={ACCENTS.primary} sub={`${money(k.recovered, activeCurrency)} recovered`} />
                <Kpi label="Net exposure" value={money(k.netExposure, activeCurrency)} accent={ACCENTS.watch} />
                <Kpi label="Inspections" value={num(k.inspections)} accent={ACCENTS.info} sub={k.inspectionCompliancePct != null ? `${pct(k.inspectionCompliancePct)} compliant` : undefined} />
                <Kpi label="Work orders open" value={num(k.workOrdersOpen)} accent={ACCENTS.good} sub={`${num(k.workOrdersOverdue)} overdue`} />
              </div>
            </section>
          )}

          {/* Trends */}
          {sections.trends && t && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><TrendingUp size={15} /> Trends, last 12 months</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Tyre spend" refCb={setRef('trendSpend')}><Line data={stylize(t.tyreSpend, 'area')} options={chartBase(false)} /></ChartCard>
                <ChartCard title="Accidents" refCb={setRef('trendAccidents')}><Line data={stylize(t.accidents, 'area')} options={chartBase(false)} /></ChartCard>
                <ChartCard title="Claims: claimed vs recovered" refCb={setRef('trendClaims')}><Line data={stylize(t.claims, 'line')} options={chartBase(true)} /></ChartCard>
                <ChartCard title="Inspections" refCb={setRef('trendInspections')}><Line data={stylize(t.inspections, 'area')} options={chartBase(false)} /></ChartCard>
              </div>
            </section>
          )}

          {/* Yearly expense trend + forecast */}
          {sections.yearlyTrend && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><TrendingUp size={15} /> Yearly expense trend &amp; forecast</h2>
              <YearlyTrendPanel title="Expense by year (tyres / spare / lubricant) + forecast" />
            </section>
          )}

          {/* Charts */}
          {sections.charts && b && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><PieChart size={15} /> Breakdowns</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Accidents by severity" refCb={setRef('sev')}><Doughnut data={stylize(b.accidentSeverity, 'doughnut')} options={DOUGHNUT_OPTS} /></ChartCard>
                <ChartCard title="Claim status" refCb={setRef('claimStatus')}><Doughnut data={stylize(b.claimStatus, 'doughnut')} options={DOUGHNUT_OPTS} /></ChartCard>
                <ChartCard title="Accidents by site" refCb={setRef('accSite')}><Bar data={stylize(b.accidentsBySite, 'bar')} options={chartBase(false)} /></ChartCard>
                <ChartCard title="Tyres by site" refCb={setRef('tyreSite')}><Bar data={stylize(b.tyresBySite, 'bar')} options={chartBase(false)} /></ChartCard>
              </div>
            </section>
          )}

          {/* Tyres vs Maintenance cost split */}
          {sections.costSplit && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Wallet size={15} /> Tyres vs Maintenance</h2>
              <div className="card">
                {costLoading ? (
                  <div className="text-center text-[var(--text-muted)] py-8">Loading the cost split...</div>
                ) : costError ? (
                  <div className="text-sm text-red-300">{costError}</div>
                ) : costTotals.combined === 0 ? (
                  <div className="text-center text-[var(--text-muted)] py-8">No tyre or maintenance spend recorded in the last 12 months for the selected scope.</div>
                ) : (
                  <>
                    <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                      <div>
                        <p className="text-3xl font-bold" style={{ color: ACCENTS.primary }}>{formatCurrency(costHeadline, activeCurrency, 0)}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-1">{costModeLabel(costMode)} spend, last 12 months</p>
                        <div className="flex items-center gap-4 mt-2 text-[11px] text-[var(--text-dim)]">
                          <span>Tyres: {formatCurrency(costTotals.tyre, activeCurrency, 0)}</span>
                          <span>Maintenance: {formatCurrency(costTotals.maintenance, activeCurrency, 0)}</span>
                          <span>Combined: {formatCurrency(costTotals.combined, activeCurrency, 0)}</span>
                        </div>
                      </div>
                      <div className="inline-flex rounded-lg border border-[var(--input-border)] overflow-hidden self-start">
                        {COST_MODES.map((m) => (
                          <button
                            key={m.key}
                            onClick={() => setCostMode(m.key)}
                            className={`text-xs font-semibold px-3 py-1.5 transition-colors ${costMode === m.key ? 'bg-[var(--accent)] text-white' : 'bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ height: 240 }} ref={setRef('costSplit')}>
                      <Bar data={stylize(costChart, 'bar')} options={chartBase(false)} />
                    </div>
                  </>
                )}
              </div>
            </section>
          )}

          {/* Fleet CPK (cost per km / hour). Currency-safe per country. */}
          {sections.fleetCpk && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
                <Gauge size={15} /> Fleet CPK (cost per km / hour)
              </h2>
              <p className="text-xs text-[var(--text-tertiary)]">
                Km for road assets, engine-hours for plant. Currency stays per country. Window: last 365 days.
              </p>
              {fleetCpkLoading ? (
                <div className="card text-center text-[var(--text-muted)] py-8">Computing unit-aware CPK...</div>
              ) : !cpkHasData ? (
                <div className="card text-center text-[var(--text-muted)] py-8">
                  No CPK data for the selected scope. CPK needs measured distance (odometer) or engine-hours plus expense data.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {cpkFleetTiles.map((tile, i) => {
                      const isHours = tile.unit === 'engine_hours'
                      return (
                        <div key={`${tile.country}-${tile.unit}-${i}`} className="card border border-[var(--input-border)] flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isHours ? <Clock size={14} className="text-amber-400 shrink-0" /> : <Gauge size={14} className="text-[var(--accent)] shrink-0" />}
                              <span className="text-xs text-[var(--text-secondary)] font-medium truncate">
                                {tile.country || 'Fleet'} - {isHours ? 'per hour' : 'per km'}
                              </span>
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)] uppercase">{tile.currency}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <p className="text-[10px] text-[var(--text-muted)]">Total CPK</p>
                              <p className="text-base font-bold text-[var(--text-primary)] leading-tight">{fmtCpkValue(tile.cpkTotal, tile.currency, tile.unit)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-[var(--text-muted)]">Tyre CPK</p>
                              <p className="text-base font-bold text-[var(--text-secondary)] leading-tight">{fmtCpkValue(tile.cpkTyre, tile.currency, tile.unit)}</p>
                            </div>
                          </div>
                          <p className="text-[10px] text-[var(--text-muted)]">
                            {fmtDistance(tile.distance, tile.unit)} measured | Coverage {fmtCoverage(tile.coveragePct)}
                          </p>
                        </div>
                      )
                    })}
                  </div>

                  {cpkTopTypes.length > 0 && (
                    <div className="card overflow-x-auto">
                      <div className="flex items-center gap-2 mb-3">
                        <Layers size={15} className="text-[var(--text-muted)]" />
                        <h3 className="text-sm font-medium text-[var(--text-secondary)]">Worst asset types by CPK</h3>
                        <span className="text-xs text-[var(--text-muted)] ml-auto">top {cpkTopTypes.length}</span>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left border-b border-[var(--input-border)]">
                            <th className="table-header pb-2 pr-3">Asset Type</th>
                            <th className="table-header pb-2 pr-3">Unit</th>
                            <th className="table-header pb-2 pr-3 text-right">Distance / Hours</th>
                            <th className="table-header pb-2 text-right">CPK Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cpkTopTypes.map((r, i) => {
                            const cur = r.currency || r.country || ''
                            return (
                              <tr key={`${r.country}-${r.vehicle_type}-${r.unit}-${i}`} className="border-b border-[var(--input-border)]/50">
                                <td className="table-cell py-2 pr-3 text-[var(--text-secondary)] font-medium">
                                  {r.vehicle_type}
                                  {r.country ? <span className="text-[var(--text-muted)]"> - {r.country}</span> : null}
                                </td>
                                <td className="table-cell py-2 pr-3 text-[var(--text-muted)]">{unitSuffix(r.unit).replace('/', '')}</td>
                                <td className="table-cell py-2 pr-3 text-right text-[var(--text-secondary)]">{fmtDistance(r.distance_or_hours, r.unit)}</td>
                                <td className="table-cell py-2 text-right">
                                  <span className={r.cpk_total == null ? 'text-[var(--text-muted)]' : 'font-medium text-[var(--text-primary)]'}>
                                    {fmtCpkValue(r.cpk_total, cur, r.unit)}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* Chart Builder - present any of the board's data as a chart / PowerPoint */}
          {sections.builder && data && studioCatalog.length > 0 && (
            <StudioBoundary>
              <PresentationStudio
                catalog={studioCatalog}
                currency={activeCurrency}
                money={(v) => money(v, activeCurrency)}
                scope={activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'}
                company={appSettings?.company_name || 'TyrePulse'}
                filePrefix="Board"
                note="Present any board figure as a chart, then copy, download a PNG, or export a PowerPoint deck."
              />
            </StudioBoundary>
          )}

          {/* Recommendations */}
          {sections.recommendations && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Lightbulb size={15} /> Recommendations</h2>
              {recs.length === 0 ? (
                <div className="card text-sm text-[var(--text-muted)]">No critical issues stand out this period. Maintain inspection cadence and monitor the trends above.</div>
              ) : (
                <div className="space-y-2">
                  {recs.map((r, i) => {
                    const c = r.level === 'high' ? ACCENTS.risk : r.level === 'medium' ? ACCENTS.watch : ACCENTS.good
                    return (
                      <div key={i} className="card flex items-start gap-3" style={{ borderLeft: `3px solid ${c}` }}>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded" style={{ background: `${c}22`, color: c }}>{r.level}</span>
                        <p className="text-sm text-[var(--text-secondary)]">{r.text}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
