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
  Download, RefreshCw, Eye, EyeOff, FileSpreadsheet, AlertTriangle,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import FilterBar from '../components/ui/FilterBar'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useFilterState } from '../hooks/useFilterState'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import { getMaintenanceSnapshot } from '../lib/api/maintenanceAnalytics'
import useLatestRequest from '../lib/useLatestRequest'
import {
  mtkpis, taskChart, actionChart, workTypeSpendChart, siteSpendChart,
  assetSpendChart, monthlySpendChart, buildMaintenanceRecommendations,
} from '../lib/maintenanceBoard'
import {
  buildDetailRows, detailSiteOptions, filterDetails, boardInsights, DETAIL_TYPES, DETAIL_TYPE_LABEL,
} from '../lib/maintenanceCostBoardAnalytics'
import { compareValues } from '../lib/consoleTable'
import { stylize, ACCENTS } from '../lib/reportColors'
import { reportFileName, reportDateLabel, exportToExcel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Filler, Title, Tooltip, Legend,
)

const LS_KEY = 'maintenanceBoard.sections.v1'
const FILTER_DEFAULTS = { q: '', rowType: '', site: '', from: '', to: '' }
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
    tooltip: { backgroundColor: 'var(--panel-2)', titleColor: 'var(--panel-ink)', bodyColor: 'var(--text-secondary)', borderColor: 'var(--hairline)', borderWidth: 1 },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.12)' }, beginAtZero: true },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.12)' }, beginAtZero: true },
  },
})

// Sort by the value, blanks last whatever the direction (consoleTable rules).
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blankToUndef = (v) => (v === null || v === undefined || v === '' ? undefined : v)

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

function ChartCard({ title, children, refCb, height = 240, empty = false }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
      {empty ? (
        <div style={{ height }} className="flex items-center justify-center text-sm text-[var(--text-muted)]" role="status">
          No data for this breakdown in the selected scope.
        </div>
      ) : (
        <div style={{ height }} ref={refCb} role="img" aria-label={title}>{children}</div>
      )}
    </div>
  )
}

const pct = (v) => (v == null ? 'N/A' : `${v.toFixed(1)}%`)

export default function MaintenanceCostBoard() {
  const [filters, setFilter, resetFilters, hasActiveFilters] = useFilterState(FILTER_DEFAULTS)
  const { activeCountry, appSettings, activeCurrency } = useSettings()
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [exporting, setExporting] = useState(false)
  // URL-backed date range keeps a board scope bookmarkable and shareable.
  const fromDate = filters.from
  const toDate = filters.to

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

  // Moving the date range starts a new snapshot before the old one returns. If
  // the earlier answer lands last it repaints the PREVIOUS window's spend under
  // the new dates - wrong money, no error, and a refresh appears to fix it.
  const latestLoad = useLatestRequest()

  const load = useCallback(async () => {
    const stale = latestLoad.begin()
    setRefreshing(true); setError('')
    try {
      const snap = await getMaintenanceSnapshot({
        country: activeCountry,
        from: fromDate || undefined,
        to: toDate || undefined,
      })
      if (stale()) return
      setSnapshot(snap && snap.ok !== false ? snap : { ok: false })
      setUpdatedAt(new Date())
    } catch (e) {
      // A superseded load must not raise a banner over data that loaded fine.
      if (!stale()) setError(toUserMessage(e, 'Could not load the maintenance board.'))
    } finally {
      // Clearing these from a stale load would make the newer one look finished.
      if (!stale()) { setLoading(false); setRefreshing(false) }
    }
  }, [activeCountry, fromDate, toDate, latestLoad])

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
  const insights = useMemo(() => boardInsights(snapshot), [snapshot])
  const detailRows = useMemo(() => buildDetailRows(snapshot), [snapshot])
  const siteOptions = useMemo(() => detailSiteOptions(detailRows), [detailRows])
  const filteredDetails = useMemo(
    () => filterDetails(detailRows, { q: filters.q, rowType: filters.rowType, site: filters.site }),
    [detailRows, filters.q, filters.rowType, filters.site],
  )

  const detailColumns = useMemo(() => [
    {
      id: 'type', header: 'Type', accessorFn: (r) => DETAIL_TYPE_LABEL[r.type] || r.type, size: 140, sortingFn: valueSort,
      cell: ({ getValue }) => <span className="text-[var(--text-secondary)]">{getValue()}</span>,
    },
    {
      id: 'name', header: 'Name', accessorFn: (r) => blankToUndef(r.name), size: 260, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="text-[var(--text-primary)] font-medium">{getValue() ?? 'N/A'}</span>,
    },
    {
      id: 'jobs', header: 'Jobs', accessorFn: (r) => blankToUndef(r.jobs), size: 100, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="tabular-nums">{num(getValue())}</span>,
      meta: { align: 'right', exportValue: (r) => (r.jobs == null ? 'N/A' : r.jobs) },
    },
    {
      id: 'occurrences', header: 'Occurrences', accessorFn: (r) => blankToUndef(r.occurrences), size: 120, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="tabular-nums">{num(getValue())}</span>,
      meta: { align: 'right', exportValue: (r) => (r.occurrences == null ? 'N/A' : r.occurrences) },
    },
    {
      id: 'spend', header: 'Spend', accessorFn: (r) => blankToUndef(r.spend), size: 140, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="tabular-nums">{money0(getValue())}</span>,
      meta: { align: 'right', exportValue: (r) => (r.spend == null ? 'N/A' : r.spend) },
    },
    {
      id: 'share', header: 'Share of spend', accessorFn: (r) => blankToUndef(r.sharePct), size: 150, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => {
        const v = getValue()
        if (v == null) return <span className="text-[var(--text-muted)]">N/A</span>
        return (
          <div className="flex items-center gap-2 justify-end">
            <div className="w-16 h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, v)}%` }} />
            </div>
            <span className="tabular-nums">{pct(v)}</span>
          </div>
        )
      },
      meta: { align: 'right', exportValue: (r) => (r.sharePct == null ? 'N/A' : r.sharePct) },
    },
  ], [money0])

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
      if (rowY + ch > doc.internal.pageSize.getHeight() - 10) { doc.addPage('a4', 'landscape'); y = 14; placed = 0 }
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
      const actionRows = (snapshot.top_actions || []).map((r) => ({ section: 'Corrective action', name: String(r?.label ?? ''), jobs: '', occurrences: Number(r?.n) || 0, spend: '' }))
      const typeRows = (snapshot.by_work_type || []).map((r) => ({ section: 'Work type spend', name: String(r?.label ?? ''), jobs: r?.jobs ?? '', occurrences: '', spend: Number(r?.spend) || 0 }))
      const assetRows = (snapshot.spend_by_asset || []).map((r) => ({ section: 'Asset spend', name: String(r?.label ?? ''), jobs: r?.jobs ?? '', occurrences: '', spend: Number(r?.spend) || 0 }))
      const rows = [
        ...taskRows.map((r) => ({ section: 'Top task', name: r.task, jobs: '', occurrences: r.occurrences, spend: '' })),
        ...actionRows,
        ...typeRows,
        ...siteRows.map((r) => ({ section: 'Site spend', name: r.site, jobs: r.jobs, occurrences: '', spend: r.spend })),
        ...assetRows,
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

      <FilterBar
        search={filters.q}
        onSearch={(value) => setFilter('q', value)}
        searchLabel="Search maintenance task and site details"
        placeholder="Search task or site"
        selects={[
          { key: 'rowType', value: filters.rowType, onChange: (value) => setFilter('rowType', value), placeholder: 'All detail types', ariaLabel: 'Filter maintenance details by type', options: DETAIL_TYPES },
          { key: 'site', value: filters.site, onChange: (value) => setFilter('site', value), placeholder: 'All sites', ariaLabel: 'Filter maintenance details by site', options: siteOptions.map((value) => ({ value, label: value })) },
        ]}
        resultCount={filteredDetails.length}
        onClearAll={hasActiveFilters ? resetFilters : undefined}
      >
        <DateField value={fromDate} onChange={(value) => setFilter('from', value)} placeholder="From date" ariaLabel="Maintenance data from date" max={toDate || undefined} />
        <DateField value={toDate} onChange={(value) => setFilter('to', value)} placeholder="To date" ariaLabel="Maintenance data to date" min={fromDate || undefined} />
      </FilterBar>

      {/* Section toggles + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {SECTIONS.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              aria-pressed={!!sections[key]}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 min-h-[44px] rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${sections[key] ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}
            >
              <Icon size={13} aria-hidden="true" /> {label} {sections[key] ? <Eye size={12} aria-hidden="true" /> : <EyeOff size={12} aria-hidden="true" />}
              <span className="sr-only">{sections[key] ? '(shown)' : '(hidden)'}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {updatedAt && <span className="text-[11px] text-[var(--text-muted)]">Updated {updatedAt.toLocaleTimeString()}</span>}
          <button type="button" onClick={load} disabled={refreshing} className="btn-secondary text-sm px-3 min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button type="button" onClick={exportExcel} disabled={!hasAny} className="btn-secondary text-sm px-3 min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-50">
            <FileSpreadsheet size={14} /> Export Excel
          </button>
          <button type="button" onClick={exportPdf} disabled={exporting || !hasAny} className="btn-primary text-sm px-3 min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download size={14} /> {exporting ? 'Preparing...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="card border border-red-700/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">The maintenance board could not be loaded.</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm px-3 min-h-[44px] inline-flex items-center gap-1.5">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}
      {loading ? (
        <div className="card text-center text-[var(--text-muted)] py-10" role="status">Loading the maintenance board...</div>
      ) : error && !hasData ? null : !hasAny ? (
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
                <Kpi label="Open jobs" value={num(k.openJobs)} accent={ACCENTS.risk} sub={insights.openJobSharePct == null ? undefined : `${pct(insights.openJobSharePct)} of job cards`} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Kpi label="Repair share of spend" value={pct(insights.repairSharePct)} accent={ACCENTS.watch} sub="Repair work types against all work type spend" />
                <Kpi label="Tyre share of line items" value={pct(insights.tyreLineSharePct)} accent={ACCENTS.info} sub="Tyre-related lines against all line items" />
                <Kpi label="Highest-spend site" value={insights.topSite || 'N/A'} accent={ACCENTS.primary} sub={insights.topSiteSharePct == null ? 'No site spend recorded' : `${pct(insights.topSiteSharePct)} of site spend`} />
              </div>
            </section>
          )}

          {/* Spend breakdowns */}
          {sections.spend && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><PieChart size={15} /> Spend by work type</h2>
              <div className="grid grid-cols-1 gap-4">
                <ChartCard title="Spend by work type" refCb={setRef('workType')} empty={!charts.workType.labels.length}>
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
                <ChartCard title="Top maintenance tasks" refCb={setRef('tasks')} height={360} empty={!charts.tasks.labels.length}>
                  <Bar data={stylize(charts.tasks, 'bar')} options={chartBase(false, true)} />
                </ChartCard>
                <ChartCard title="Top corrective actions" refCb={setRef('actions')} height={360} empty={!charts.actions.labels.length}>
                  <Bar data={stylize(charts.actions, 'bar')} options={chartBase(false, true)} />
                </ChartCard>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Maintenance breakdown register</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Every task, corrective action, work type, site and asset from the snapshot in one sortable register.
                  Share of spend compares a row with the others of the same type.
                </p>
                <EnterpriseTable
                  columns={detailColumns}
                  data={filteredDetails}
                  getRowId={(r) => r.id}
                  enableGlobalFilter={false}
                  enableColumnFilters={false}
                  initialPageSize={25}
                  exportFileName={reportFileName(appSettings?.company_name || 'TyrePulse', 'Maintenance Breakdown', reportDateLabel())}
                  reportMeta={{ title: 'Maintenance breakdown register', company: appSettings?.company_name, currency: activeCurrency }}
                  emptyMessage={detailRows.length === 0
                    ? 'No task, action, work type, site or asset data exists for the selected scope.'
                    : 'No maintenance details match these filters. Clear or change the search, type, or site.'}
                />
              </div>
            </section>
          )}

          {/* Sites */}
          {sections.sites && (
            <section className="space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2"><Building2 size={15} /> Spend by site</h2>
              <div className="grid grid-cols-1 gap-4">
                <ChartCard title="Spend by site" refCb={setRef('sites')} height={300} empty={!charts.sites.labels.length}>
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
                <ChartCard title="Highest-spend assets" refCb={setRef('assets')} height={360} empty={!charts.assets.labels.length}>
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
                <ChartCard title="Monthly spend" refCb={setRef('monthly')} height={280} empty={!charts.monthly.labels.length}>
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
