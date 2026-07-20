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
  LayoutDashboard, TrendingUp, PieChart, Lightbulb, Download, RefreshCw, Eye, EyeOff, Wallet,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
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
import { loadCostSplit } from '../lib/api/costSummary'
import { stylize, ACCENTS } from '../lib/reportColors'
import { reportFileName, reportDateLabel } from '../lib/exportUtils'
import EmailPdfButton from '../components/EmailPdfButton'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Filler, Title, Tooltip, Legend,
)

const LS_KEY = 'boardOverview.sections.v1'
const SECTIONS = [
  ['kpis', 'KPIs', LayoutDashboard],
  ['trends', 'Trends', TrendingUp],
  ['charts', 'Charts', PieChart],
  ['costSplit', 'Tyres vs Maintenance', Wallet],
  ['recommendations', 'Recommendations', Lightbulb],
]
const SECTION_DEFAULTS = { kpis: true, trends: true, charts: true, costSplit: true, recommendations: true }

/** 'YYYY-MM' -> 'Mon YY' month label (passthrough for non date keys). */
const monthLabel = (key) => {
  const s = String(key || '')
  if (!/^\d{4}-\d{2}/.test(s)) return s
  const [y, m] = s.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
}

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString('en-US'))
const money = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrency(Number(v)))
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
        fetchAllPages((from, to) => listKpiTyreRecords({ country: activeCountry, from, to })),
        fetchAllPages((from, to) => listKpiInspections({ country: activeCountry, from, to })),
        listKpiCorrectiveActions({ country: activeCountry }),
        listKpiFleet(),
        listAllAccidentsForPage({ country: activeCountry }),
        listWorkOrdersForPage({ country: activeCountry }).catch(() => []),
        listStockRecords({ country: activeCountry }).catch(() => []),
      ])
      const tyres = tyresRes.data ?? []
      const inspections = inspRes.data ?? []
      const actions = actionsQ?.data ?? []
      const fleetSize = (fleetQ?.data ?? []).length
      const accidents = accRes?.data ?? []
      const now = new Date()
      setData({
        kpis: buildBoardKpis({ tyres, inspections, actions, fleetSize, accidents, workOrders: workOrders || [], stock: stock || [], now }),
        trends: buildTrends({ tyres, accidents, inspections, now }),
        breakdowns: buildBreakdowns({ accidents, tyres }),
      })
      setUpdatedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the board overview.'))
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
    loadCostSplit({ country: activeCountry })
      .then((res) => { if (!cancelled) setCost(res) })
      .catch((e) => { if (!cancelled) setCostError(toUserMessage(e, 'Could not load the cost split.')) })
      .finally(() => { if (!cancelled) setCostLoading(false) })
    return () => { cancelled = true }
  }, [activeCountry])

  const costTotals = useMemo(() => splitTotals(cost?.byMonth || []), [cost])
  const costHeadline = useMemo(() => pickCost(costMode, costTotals), [costMode, costTotals])
  const costChart = useMemo(() => {
    const rows = cost?.byMonth || []
    return {
      labels: rows.map((r) => monthLabel(r.month)),
      datasets: [{ label: `${costModeLabel(costMode)} spend`, data: pickMonthly(costMode, rows).map((m) => m.value) }],
    }
  }, [cost, costMode])

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
        ['Fleet avg CPK', money(k.fleetAvgCpk)], ['Tyre spend', money(k.tyreSpend)],
        ['Accidents', num(k.accidents)], ['Open accidents', num(k.openAccidents)],
        ['Claims value', money(k.claimed)], ['Recovered', money(k.recovered)],
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
          {/* KPIs */}
          {sections.kpis && k && (
            <section className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <Kpi label="Fleet vehicles" value={num(k.fleetSize)} accent={ACCENTS.primary} />
                <Kpi label="Tyres tracked" value={num(k.tyresTracked)} accent={ACCENTS.info} />
                <Kpi label="Fleet avg CPK" value={money(k.fleetAvgCpk)} accent={ACCENTS.good} />
                <Kpi label="Tyre spend" value={money(k.tyreSpend)} accent={ACCENTS.watch} />
                <Kpi label="Failure rate" value={pct(k.failureRatePct)} accent={ACCENTS.risk} />
                <Kpi label="Accidents" value={num(k.accidents)} accent={ACCENTS.risk} sub={`${num(k.openAccidents)} open`} />
                <Kpi label="Claims value" value={money(k.claimed)} accent={ACCENTS.primary} sub={`${money(k.recovered)} recovered`} />
                <Kpi label="Net exposure" value={money(k.netExposure)} accent={ACCENTS.watch} />
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
