/**
 * MaintenanceCostBoard (route /maintenance-cost-board) - a customizable board
 * over maintenance cost + tasks.
 *
 * Mirrors BoardOverview: headline KPIs, then spend breakdowns, top tasks and
 * actions, site and asset spend, and a 12-month spend trend. Each section has an
 * on/off toggle (persisted). All numbers come from the server aggregate
 * `get_maintenance_snapshot` (work_orders + line items) via
 * maintenanceAnalytics.js and are shaped by the pure maintenanceBoard.js engine
 * (no fabrication; an empty snapshot renders an honest empty state). Colours use
 * the shared palette (reportColors) so it reads as one system.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  Wrench, Wallet, ListChecks, TrendingUp, PieChart, Building2, Truck,
  Download, RefreshCw, Eye, EyeOff, FileSpreadsheet,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { getMaintenanceSnapshot } from '../lib/api/maintenanceAnalytics'
import {
  mtkpis, taskChart, actionChart, workTypeSpendChart, siteSpendChart,
  assetSpendChart, monthlySpendChart, buildMaintenanceRecommendations,
} from '../lib/maintenanceBoard'
import { stylize, ACCENTS } from '../lib/reportColors'
import { reportFileName, reportDateLabel, exportToExcel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Filler, Title, Tooltip, Legend,
)

const LS_KEY = 'maintenanceBoard.sections.v1'
const SECTIONS = [
  ['kpis', 'KPIs', Wallet],
  ['spend', 'Spend', PieChart],
  ['tasks', 'Tasks', ListChecks],
  ['sites', 'Sites', Building2],
  ['assets', 'Assets', Truck],
  ['trend', 'Trend', TrendingUp],
]
const SECTION_DEFAULTS = { kpis: true, spend: true, tasks: true, sites: true, assets: true, trend: true }

const chartBase = (legend = false, horizontal = false) => ({
  indexAxis: horizontal ? 'y' : 'x',
  responsive: true,
  maintainAspectRatio: false,
  layout: { padding: { top: 8 } },
  plugins: {
    legend: { display: legend, labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: 'var(--panel-2)', titleColor: 'var(--panel-ink)', bodyColor: '#9ca3af', borderColor: 'var(--hairline)', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.12)' }, beginAtZero: true },
    y: { ticks: { color: '#6b7280', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.12)' }, beginAtZero: true },
  },
})

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

function ChartCard({ title, children, refCb, height = 240 }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
      <div style={{ height }} ref={refCb}>{children}</div>
    </div>
  )
}

export default function MaintenanceCostBoard() {
  const { activeCountry, appSettings, activeCurrency } = useSettings()
  const [snapshot, setSnapshot] = useState(null)
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

  const money0 = useCallback((v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : formatCurrency(Number(v), activeCurrency, 0)), [activeCurrency])
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString('en-US'))

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const snap = await getMaintenanceSnapshot({ country: activeCountry })
      setSnapshot(snap && snap.ok !== false ? snap : { ok: false })
      setUpdatedAt(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the maintenance board.'))
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const hasData = !!(snapshot && snapshot.ok !== false)
  const k = useMemo(() => mtkpis(snapshot), [snapshot])
  const charts = useMemo(() => ({
    tasks: taskChart(snapshot),
    actions: actionChart(snapshot),
    workType: workTypeSpendChart(snapshot),
    sites: siteSpendChart(snapshot),
    assets: assetSpendChart(snapshot),
    monthly: monthlySpendChart(snapshot),
  }), [snapshot])
  const recs = useMemo(() => buildMaintenanceRecommendations(snapshot), [snapshot])

  const hasAny = hasData && (k.jobCards || k.lineItems || k.totalSpend)

  // Build the PDF doc. Mirrors BoardOverview.buildBoardDoc (chart capture on paper).
  async function buildBoardDoc() {
    if (!hasData) return null
    const { captureChartOnPaper } = await import('../lib/chartCapture')
    const { default: jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    const M = 12
    const company = appSettings?.company_name || 'TyrePulse'
    const scope = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
    doc.setFontSize(16); doc.setTextColor(15, 23, 42)
    doc.text(`${company} - Maintenance Cost & Tasks`, M, 16)
    doc.setFontSize(9); doc.setTextColor(100, 116, 139)
    doc.text(`${scope}  |  ${reportDateLabel(new Date())}`, M, 22)

    const tiles = [
      ['Job cards', num(k.jobCards)], ['Line items', num(k.lineItems)],
      ['Total spend', money0(k.totalSpend)], ['Avg job cost', money0(k.avgJobCost)],
      ['Tyre-related lines', num(k.tyreLines)], ['Open jobs', num(k.openJobs)],
    ]
    let y = 30
    doc.setFontSize(8)
    tiles.forEach((tl, i) => {
      const col = i % 3, row = Math.floor(i / 3)
      const x = M + col * ((W - 2 * M) / 3)
      const yy = y + row * 16
      doc.setTextColor(15, 23, 42); doc.setFontSize(11); doc.text(String(tl[1]), x, yy + 6)
      doc.setTextColor(100, 116, 139); doc.setFontSize(7.5); doc.text(String(tl[0]), x, yy + 11)
    })
    y += 40

    const order = ['workType', 'monthly', 'tasks', 'actions', 'sites', 'assets']
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
      let rowY = y + Math.floor(placed / 2) * (ch + 6)
      if (rowY + ch > doc.internal.pageSize.getHeight() - 10) { doc.addPage('a4', 'landscape'); y = 14; placed = 0; rowY = y }
      const x = M + col * (cw + 8)
      const yy = y + Math.floor(placed / 2) * (ch + 6)
      doc.addImage(img, 'PNG', x, yy, cw, ch)
      placed += 1
    }
    return { doc, company }
  }

  async function exportPdf() {
    if (!hasData) return
    setExporting(true)
    try {
      const built = await buildBoardDoc()
      if (built) built.doc.save(`${reportFileName(built.company, 'Maintenance Cost Tasks', reportDateLabel())}.pdf`)
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    } finally {
      setExporting(false)
    }
  }

  async function exportExcel() {
    if (!hasData) return
    try {
      const company = appSettings?.company_name || 'TyrePulse'
      const taskRows = (snapshot.top_tasks || []).map((r) => ({ task: String(r?.label ?? ''), occurrences: Number(r?.n) || 0 }))
      const siteRows = (snapshot.spend_by_site || []).map((r) => ({ site: String(r?.label ?? ''), jobs: Number(r?.jobs) || 0, spend: Number(r?.spend) || 0 }))
      const rows = [
        ...taskRows.map((r) => ({ section: 'Top task', name: r.task, jobs: '', occurrences: r.occurrences, spend: '' })),
        ...siteRows.map((r) => ({ section: 'Site spend', name: r.site, jobs: r.jobs, occurrences: '', spend: r.spend })),
      ]
      await exportToExcel(
        rows,
        ['section', 'name', 'jobs', 'occurrences', 'spend'],
        ['Section', 'Name', 'Jobs', 'Occurrences', 'Spend'],
        reportFileName(company, 'Maintenance Cost Tasks', reportDateLabel()),
        'Maintenance',
        { title: `${company} - Maintenance Cost & Tasks`, currency: activeCurrency },
      )
    } catch (e) {
      setError(toUserMessage(e, 'Export failed. Please try again.'))
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Maintenance Cost & Tasks" subtitle="Job cards, spend and the most common tasks across the fleet" icon={Wrench} />

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
          <button onClick={exportExcel} disabled={!hasAny} className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <FileSpreadsheet size={14} /> Export Excel
          </button>
          <button onClick={exportPdf} disabled={exporting || !hasAny} className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download size={14} /> {exporting ? 'Preparing...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {error && <div className="card border border-red-700/50 text-red-300 text-sm">{error}</div>}
      {loading ? (
        <div className="card text-center text-[var(--text-muted)] py-10">Loading the maintenance board...</div>
      ) : !hasAny ? (
        <div className="card text-center text-[var(--text-muted)] py-10">No maintenance data yet for the selected scope. Work orders will appear here as they are captured.</div>
      ) : (
        <>
          {/* KPIs */}
          {sections.kpis && (
            <section className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label="Job cards" value={num(k.jobCards)} accent={ACCENTS.primary} />
                <Kpi label="Line items" value={num(k.lineItems)} accent={ACCENTS.info} />
                <Kpi label="Total spend" value={money0(k.totalSpend)} accent={ACCENTS.watch} />
                <Kpi label="Avg job cost" value={money0(k.avgJobCost)} accent={ACCENTS.good} />
                <Kpi label="Tyre-related lines" value={num(k.tyreLines)} accent={ACCENTS.info} />
                <Kpi label="Open jobs" value={num(k.openJobs)} accent={ACCENTS.risk} />
              </div>
            </section>
          )}

          {/* Spend breakdowns */}
          {sections.spend && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><PieChart size={15} /> Spend by work type</h2>
              <div className="grid grid-cols-1 gap-4">
                <ChartCard title="Spend by work type" refCb={setRef('workType')}>
                  <Bar data={stylize(charts.workType, 'bar')} options={chartBase(false)} />
                </ChartCard>
              </div>
            </section>
          )}

          {/* Top tasks + actions */}
          {sections.tasks && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><ListChecks size={15} /> Top tasks and actions</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Top maintenance tasks" refCb={setRef('tasks')} height={360}>
                  <Bar data={stylize(charts.tasks, 'bar')} options={chartBase(false, true)} />
                </ChartCard>
                <ChartCard title="Top corrective actions" refCb={setRef('actions')} height={360}>
                  <Bar data={stylize(charts.actions, 'bar')} options={chartBase(false, true)} />
                </ChartCard>
              </div>
              <div className="card overflow-x-auto">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Top tasks</h3>
                {(snapshot.top_tasks || []).length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">No task data for the selected scope.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
                        <th className="py-2 pr-3 font-semibold">#</th>
                        <th className="py-2 pr-3 font-semibold">Task</th>
                        <th className="py-2 pr-3 font-semibold text-right">Occurrences</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(snapshot.top_tasks || []).map((r, i) => (
                        <tr key={i} className="border-b border-[var(--hairline)]/50">
                          <td className="py-1.5 pr-3 text-[var(--text-dim)]">{i + 1}</td>
                          <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{String(r?.label ?? '') || 'N/A'}</td>
                          <td className="py-1.5 pr-3 text-right text-[var(--text-primary)]">{num(r?.n)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          {/* Sites */}
          {sections.sites && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Building2 size={15} /> Spend by site</h2>
              <div className="grid grid-cols-1 gap-4">
                <ChartCard title="Spend by site" refCb={setRef('sites')} height={300}>
                  <Bar data={stylize(charts.sites, 'bar')} options={chartBase(false)} />
                </ChartCard>
              </div>
            </section>
          )}

          {/* Assets */}
          {sections.assets && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Truck size={15} /> Spend by asset</h2>
              <div className="grid grid-cols-1 gap-4">
                <ChartCard title="Highest-spend assets" refCb={setRef('assets')} height={360}>
                  <Bar data={stylize(charts.assets, 'bar')} options={chartBase(false, true)} />
                </ChartCard>
              </div>
            </section>
          )}

          {/* Trend */}
          {sections.trend && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><TrendingUp size={15} /> Maintenance spend, last 12 months</h2>
              <div className="grid grid-cols-1 gap-4">
                <ChartCard title="Monthly spend" refCb={setRef('monthly')} height={280}>
                  <Line data={stylize(charts.monthly, 'area')} options={chartBase(false)} />
                </ChartCard>
              </div>
            </section>
          )}

          {/* Recommendations */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><ListChecks size={15} /> Recommendations</h2>
            {recs.length === 0 ? (
              <div className="card text-sm text-[var(--text-muted)]">No cost anomalies stand out this period. Keep preventive maintenance on schedule and monitor the trend above.</div>
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
        </>
      )}
    </div>
  )
}
