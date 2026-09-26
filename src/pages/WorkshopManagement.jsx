import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { applyCountry } from '../lib/countryFilter'
import { fetchAllPages } from '../lib/fetchAll'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { getMaintenanceSnapshot } from '../lib/api/maintenanceAnalytics'
import { WO_STATUSES, normalizeWoStatus } from '../lib/workOrderStatus'
import {
  WORK_TYPES, filterJobs, workshopKpis, sitePerformance, technicianPerformance,
  workTypeCounts, monthlySeries, costSplit,
} from '../lib/workshopManagementAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'
import { formatDate } from '../lib/formatters'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { usePagedRows, TablePagination } from '../components/ui/TablePagination'
import {
  Wrench, ClipboardList, Clock, CheckCircle, DollarSign, AlertTriangle,
  Search, Filter, X, RefreshCw, FileSpreadsheet, FileText,
  Calendar, User, Building2, BarChart2, Package, Target,
} from 'lucide-react'
import { SkeletonTable } from '../components/ui/Skeleton'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// Chart chrome reads theme tokens (resolved per theme by chartVarPlugin), so the
// charts stay legible in light and dark mode. Series colours come from the
// report palette (reportColors) so they follow the super-admin theme.
const LEGEND = { labels: { color: 'var(--text-muted)', font: { size: 11 }, boxWidth: 12 } }
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: LEGEND,
    tooltip: {
      backgroundColor: 'var(--panel-2)',
      titleColor: 'var(--text-primary)',
      bodyColor: 'var(--text-secondary)',
      borderColor: 'var(--border-subtle)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { beginAtZero: true, ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}
const STACKED = {
  ...CHART_DEFAULTS,
  scales: {
    x: { ...CHART_DEFAULTS.scales.x, stacked: true },
    y: { ...CHART_DEFAULTS.scales.y, stacked: true },
  },
}
const NO_SCALE = {
  ...CHART_DEFAULTS,
  scales: undefined,
  plugins: { ...CHART_DEFAULTS.plugins, legend: { position: 'right', labels: { ...LEGEND.labels, padding: 12 } } },
}

// Status vocabulary comes from workOrderStatus.js (the single source of truth).
// 'Overdue' is a derived display bucket, never a stored status, so the filter
// omits it - same rule as the Work Orders page.
const STATUSES   = WO_STATUSES.filter(s => s !== 'Overdue')
const PRIORITIES = ['Critical','High','Medium','Low']

// work_orders is one of the largest tables in the system (millions of rows at
// scale), so the browser must never pull it all. The grid fetch is bounded two
// ways: a server-side date window (defaulting to the last 12 months when the
// user has not set one, matching the 12-month charts) plus a hard row ceiling.
const WORK_ORDER_CEILING = 20000
const DEFAULT_WINDOW_MONTHS = 12

// First day of the month DEFAULT_WINDOW_MONTHS-1 back, so the default window
// lines up exactly with the 12-month chart buckets (full coverage, no
// half-month at the edge). Returns a YYYY-MM-DD string.
function defaultWindowFrom() {
  const d = new Date()
  const from = new Date(d.getFullYear(), d.getMonth() - (DEFAULT_WINDOW_MONTHS - 1), 1)
  return from.toISOString().slice(0, 10)
}

function windowFromLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d)) return iso
  return d.toLocaleDateString('en', { month: 'short', year: 'numeric' })
}

// ── Formatters (honest: unmeasurable renders N/A, never a fabricated 0) ─────────
function fmtCurrency(v, currency) {
  if (v == null || !isFinite(v)) return 'N/A'
  if (Math.abs(v) >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `${currency} ${(v / 1_000).toFixed(1)}K`
  return `${currency} ${Math.round(v).toLocaleString()}`
}

function fmtHours(h) {
  if (h == null || !isFinite(h) || h < 0) return 'N/A'
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${h.toFixed(1)}h`
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${v.toFixed(1)}%`
}

const fmtDay = (v) => (v ? formatDate(v) : 'N/A')

// Semantic tones. Status carries its label text as well, so colour is never the
// only signal.
const TONE = {
  good:    'bg-green-500/15 text-green-400 border-green-500/30',
  info:    'bg-blue-500/15 text-blue-400 border-blue-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  orange:  'bg-orange-500/15 text-orange-400 border-orange-500/30',
  danger:  'bg-red-500/15 text-red-400 border-red-500/30',
  purple:  'bg-purple-500/15 text-purple-400 border-purple-500/30',
  quiet:   'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

// Keyed on the canonical vocabulary so every stored status gets a meaningful tone.
const STATUS_TONE = {
  'New': 'info',
  'Awaiting Assignment': 'info',
  'Assigned': 'info',
  'In Progress': 'warning',
  'Waiting for Parts': 'orange',
  'Waiting for Approval': 'warning',
  'Quality Inspection': 'purple',
  'Completed': 'good',
  'Overdue': 'danger',
  'Cancelled': 'quiet',
  'On Hold': 'quiet',
}
const PRIORITY_TONE = { critical: 'danger', high: 'orange', medium: 'warning', low: 'quiet' }

function Pill({ tone = 'quiet', children }) {
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border whitespace-nowrap ${TONE[tone] || TONE.quiet}`}>{children}</span>
}

function scoreTone(s) {
  if (s >= 80) return 'good'
  if (s >= 60) return 'warning'
  if (s >= 40) return 'orange'
  return 'danger'
}

function RateBar({ value, good = 80, fair = 60 }) {
  if (value == null) return <span className="text-[var(--text-muted)] text-xs">N/A</span>
  const cls = value >= good ? 'bg-green-500' : value >= fair ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2" role="img" aria-label={fmtPct(value)}>
      <div className="flex-1 bg-[var(--input-bg)] rounded-full h-1.5 min-w-[60px]" aria-hidden="true">
        <div className={`h-1.5 rounded-full ${cls}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-[var(--text-secondary)] text-xs tabular-nums">{fmtPct(value)}</span>
    </div>
  )
}

function applyDatePreset(days) {
  if (!days) return { from: '', to: '' }
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

// ── KPI Card ───────────────────────────────────────────────────────────────────
const KPI_ACCENT = {
  blue: 'text-blue-400 bg-blue-500/10', green: 'text-green-400 bg-green-500/10',
  yellow: 'text-yellow-400 bg-yellow-500/10', orange: 'text-orange-400 bg-orange-500/10',
  red: 'text-red-400 bg-red-500/10', purple: 'text-purple-400 bg-purple-500/10',
}
function KpiCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium truncate">{label}</span>
        <span className={`p-2 rounded-lg shrink-0 ${KPI_ACCENT[color] || KPI_ACCENT.blue}`} aria-hidden="true">
          <Icon className="w-4 h-4" />
        </span>
      </div>
      <div className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[var(--text-muted)]">{sub}</div>}
    </div>
  )
}

// ── Chart Card ─────────────────────────────────────────────────────────────────
function ChartCard({ title, subtitle, children, height = 260, empty, emptyText = 'No data for the selected filters.', summary }) {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 sm:p-5 min-w-0">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
      </div>
      <div style={{ height }} role="img" aria-label={summary || title}>
        {empty
          ? <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm text-center px-4">{emptyText}</div>
          : children}
      </div>
    </section>
  )
}

const btnCls = 'inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] text-[var(--text-secondary)] text-sm transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500'
const fieldCls = 'w-full min-h-[44px] px-3 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40'
const labelCls = 'block text-[11px] font-medium text-[var(--text-muted)] mb-1'

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart2 },
  { id: 'jobs', label: 'Jobs Table', icon: ClipboardList },
  { id: 'sites', label: 'Site Performance', icon: Building2 },
  { id: 'technicians', label: 'Technicians', icon: User },
  { id: 'costs', label: 'Cost Analysis', icon: DollarSign },
]

// ── Main Component ─────────────────────────────────────────────────────────────
export default function WorkshopManagement() {
  const { activeCurrency, activeCountry } = useSettings()
  const navigate = useNavigate()

  const [allOrders, setAllOrders] = useState([])
  const [snapshot, setSnapshot]   = useState(null)
  const [loadMeta, setLoadMeta]   = useState({ truncated: false, totalCount: null, windowFrom: null, windowDefault: false })
  const [loading, setLoading]     = useState(true)
  const [tableExists, setTableExists] = useState(true)
  const [error, setError]         = useState(null)

  // Filters
  const [site, setSite]           = useState('')
  const [workType, setWorkType]   = useState('')
  const [status, setStatus]       = useState('')
  const [priority, setPriority]   = useState('')
  const [techSearch, setTechSearch] = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [search, setSearch]       = useState('')
  const [activeTab, setActiveTab] = useState('overview')

  // Five filters drive this load (site, type, priority and both dates), so two
  // reads are in flight whenever any of them is changed twice quickly. If the
  // earlier one finishes last it paints the PREVIOUS filter's job cards - and
  // its cost tiles - under the new chips, with nothing to show it went wrong.
  const latestLoad = useLatestRequest()

  const fetchData = useCallback(async () => {
    const stale = latestLoad.begin()
    setLoading(true)
    setError(null)
    // The grid is always bounded by a date window. Honour an explicit range;
    // otherwise default to the last 12 months so the browser never scans the
    // whole (potentially millions-row) table. The date controls widen it.
    const windowDefault = !dateFrom
    const effFrom = dateFrom || defaultWindowFrom()

    // Headline financial KPIs come from the server aggregate so they stay
    // correct even when the grid below is capped. The RPC only knows
    // site/country/date, so it is scoped by the explicit date filter only
    // (all-time by default, matching the previous behaviour of these tiles).
    const snapPromise = getMaintenanceSnapshot({
      site: site || null,
      country: activeCountry,
      from: dateFrom || null,
      to: dateTo || null,
    }).catch(() => ({ ok: false }))

    try {
      const { data, error: err, truncated } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('work_orders')
          .select('id,work_order_no,asset_no,status,priority,work_type,site,assigned_to:technician_name,labour_cost,parts_cost,total_cost,created_at,completed_at,scheduled_date:target_completion,description,parts_used')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })

        // Status is deliberately NOT filtered server-side: the stored value can
        // be a legacy token ("Open", "Awaiting Parts", "Closed") that an exact
        // match would miss. It is applied client-side on the canonical value.
        if (site)     q = q.eq('site', site)
        if (workType) q = q.eq('work_type', workType)
        if (priority) q = q.eq('priority', priority)
        q = q.gte('created_at', effFrom)
        if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59')
        q = applyCountry(q, activeCountry)

        return q.range(from, to)
      }, { max: WORK_ORDER_CEILING })

      // A newer filter superseded this read: drop it before any setter runs.
      if (stale()) return

      if (err) {
        if (err.code === '42P01' || err.message?.toLowerCase().includes('does not exist')) {
          setTableExists(false)
          setAllOrders([])
          setSnapshot({ ok: false })
          setLoadMeta({ truncated: false, totalCount: null, windowFrom: effFrom, windowDefault })
          return
        }
        setError(toUserMessage(err, 'Could not load work orders.'))
        return
      }

      setTableExists(true)
      // Canonicalise status at the read boundary (same as the Work Orders
      // page) so every count, chart, badge and filter below speaks the one
      // vocabulary regardless of which loader wrote the row.
      setAllOrders((data || []).map(o => ({ ...o, status: normalizeWoStatus(o.status) })))

      // Only when the fetch hit the ceiling do we count the full selection, so
      // the "showing N of M" note is honest without a count query on every load.
      let totalCount = null
      if (truncated) {
        try {
          let cq = supabase.from('work_orders').select('id', { count: 'exact', head: true })
          if (site)     cq = cq.eq('site', site)
          if (workType) cq = cq.eq('work_type', workType)
          if (priority) cq = cq.eq('priority', priority)
          cq = cq.gte('created_at', effFrom)
          if (dateTo)   cq = cq.lte('created_at', dateTo + 'T23:59:59')
          cq = applyCountry(cq, activeCountry)
          const { count } = await cq
          if (Number.isFinite(count)) totalCount = count
        } catch { /* best-effort: note falls back to "many" */ }
      }

      const snap = await snapPromise
      // Re-checked: the count query and the snapshot above are both awaited, so
      // a newer filter can land between them and the setters below.
      if (stale()) return
      setSnapshot(snap && snap.ok !== false ? snap : { ok: false })
      setLoadMeta({ truncated: !!truncated, totalCount, windowFrom: effFrom, windowDefault })
    } catch (e) {
      // A superseded load must not raise a banner over data that loaded fine.
      if (!stale()) setError(toUserMessage(e, 'Could not load work orders.'))
    } finally {
      // Clearing this from a stale load would make the newer one look finished.
      if (!stale()) setLoading(false)
    }
  }, [site, workType, priority, dateFrom, dateTo, activeCountry, latestLoad])

  useEffect(() => { fetchData() }, [fetchData])


  // ── Derived data (all maths lives in workshopManagementAnalytics) ─────────────
  // Status filter, applied on the canonical value. Everything downstream reads
  // `orders`, so the filter narrows the KPIs, charts and tables exactly as the
  // server-side filter used to.
  const orders = useMemo(() => filterJobs(allOrders, { status }), [allOrders, status])

  const filteredOrders = useMemo(
    () => filterJobs(orders, { techSearch, search }),
    [orders, techSearch, search],
  )

  const kpis = useMemo(() => workshopKpis(orders, new Date()), [orders])

  // Total Cost and Open Jobs are supplied identically by the server aggregate
  // (sum of total_cost, and the open-job count) over the full selection, so we
  // read them from the RPC instead of the capped client rows. The RPC cannot
  // apply the work-type / priority / status filters, so when any of those is
  // active we fall back to the (filter-respecting) client figures.
  const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null)
  const rpcUsable = !workType && !priority && !status && snapshot && snapshot.ok !== false
  const rpcTotalSpend = rpcUsable ? num(snapshot?.kpis?.total_spend) : null
  const rpcOpenJobs   = rpcUsable ? num(snapshot?.kpis?.open_jobs) : null
  const kpiTotalCost  = rpcTotalSpend != null ? rpcTotalSpend : kpis.totalCost
  const kpiOpenJobs   = rpcOpenJobs != null ? rpcOpenJobs : kpis.openJobs

  const sitePerf = useMemo(() => sitePerformance(orders, new Date()), [orders])
  const techPerf = useMemo(() => technicianPerformance(orders), [orders])
  const series   = useMemo(() => monthlySeries(orders, { now: new Date() }), [orders])
  const workTypes = useMemo(() => workTypeCounts(orders), [orders])
  const split    = useMemo(() => costSplit(orders), [orders])

  const siteOptions = useMemo(() => [...new Set(allOrders.map(o => o.site).filter(Boolean))].sort(), [allOrders])

  // ── Chart data (palette-driven) ───────────────────────────────────────────────
  const jobVolumeChart = useMemo(() => ({
    labels: series.labels,
    datasets: series.sites.map((s, i) => ({
      label: s,
      data: series.completedBySite[s],
      backgroundColor: withAlpha(colorAt(i), 0.8),
      borderColor: colorAt(i),
      borderWidth: 1,
      borderRadius: 4,
    })),
  }), [series])

  const workTypeChart = useMemo(() => ({
    labels: workTypes.map(w => w.type),
    datasets: [{
      data: workTypes.map(w => w.count),
      backgroundColor: workTypes.map((_, i) => withAlpha(colorAt(i), 0.8)),
      borderColor: workTypes.map((_, i) => colorAt(i)),
      borderWidth: 1,
    }],
  }), [workTypes])

  const taTrendChart = useMemo(() => {
    const c = colorAt(0)
    return {
      labels: series.labels,
      datasets: [{
        label: 'Avg Turnaround (hrs)',
        data: series.avgTurnaround,
        borderColor: c,
        backgroundColor: withAlpha(c, 0.12),
        fill: true,
        tension: 0.4,
        pointBackgroundColor: c,
        pointRadius: 4,
        spanGaps: true,
      }],
    }
  }, [series])

  const costChart = useMemo(() => ({
    labels: series.labels,
    datasets: [
      { label: 'Labour Cost', data: series.labour, backgroundColor: withAlpha(colorAt(0), 0.8), borderColor: colorAt(0), borderWidth: 1, borderRadius: 4, stack: 'stack' },
      { label: 'Parts Cost', data: series.parts, backgroundColor: withAlpha(colorAt(4), 0.8), borderColor: colorAt(4), borderWidth: 1, borderRadius: 4, stack: 'stack' },
    ],
  }), [series])

  // Paged jobs - the shared pager, 50 a page, so this grid behaves like every
  // other register in the app. The read is still SERVER-bounded (20,000 rows in
  // a 12-month default window, see loadMeta) and the banner above still says so:
  // a page is a reading convenience, it does not make a bounded read complete.
  //
  // `filteredOrders` stays the full filtered set. It is what BOTH exports write
  // and what the "N jobs" caption quotes - never `jobsPager.pageRows`.
  const jobsPager = usePagedRows(filteredOrders)

  // ── Table columns ─────────────────────────────────────────────────────────────
  const jobColumns = useMemo(() => [
    { id: 'work_order_no', header: 'WO No', accessorFn: (j) => j.work_order_no || j.id?.slice(0, 8) || '', size: 130,
      cell: ({ getValue }) => <span className="text-blue-400 font-mono text-xs whitespace-nowrap">{getValue()}</span> },
    { id: 'asset_no', header: 'Asset', accessorFn: (j) => j.asset_no || 'N/A', size: 110 },
    { id: 'site', header: 'Site', accessorFn: (j) => j.site || 'N/A', size: 120 },
    { id: 'work_type', header: 'Type', accessorFn: (j) => j.work_type || 'N/A', size: 120 },
    { id: 'priority', header: 'Priority', accessorFn: (j) => j.priority || '', size: 100,
      cell: ({ row }) => (row.original.priority
        ? <Pill tone={PRIORITY_TONE[String(row.original.priority).toLowerCase()]}>{row.original.priority}</Pill>
        : <span className="text-[var(--text-muted)]">N/A</span>) },
    { id: 'status', header: 'Status', accessorFn: (j) => normalizeWoStatus(j.status), size: 150,
      cell: ({ getValue }) => (getValue() ? <Pill tone={STATUS_TONE[getValue()]}>{getValue()}</Pill> : <span className="text-[var(--text-muted)]">N/A</span>) },
    { id: 'assigned_to', header: 'Assigned To', accessorFn: (j) => j.assigned_to || 'Unassigned', size: 140 },
    { id: 'created_at', header: 'Created', accessorFn: (j) => j.created_at || '', size: 110, cell: ({ row }) => fmtDay(row.original.created_at) },
    { id: 'scheduled_date', header: 'Scheduled', accessorFn: (j) => j.scheduled_date || '', size: 110, cell: ({ row }) => fmtDay(row.original.scheduled_date) },
    { id: 'completed_at', header: 'Completed', accessorFn: (j) => j.completed_at || '', size: 110, cell: ({ row }) => fmtDay(row.original.completed_at) },
    { id: 'total_cost', header: 'Cost', accessorFn: (j) => (j.total_cost == null ? null : Number(j.total_cost)), size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtCurrency(row.original.total_cost == null ? null : Number(row.original.total_cost), activeCurrency)}</span> },
  ], [activeCurrency])

  const siteColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorFn: (s) => s.site, size: 160,
      cell: ({ getValue }) => <span className="inline-flex items-center gap-2 text-[var(--text-primary)] font-medium"><Building2 className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />{getValue()}</span> },
    { id: 'thisMonth', header: 'Jobs (Month)', accessorFn: (s) => s.thisMonth, size: 110, meta: { align: 'right' } },
    { id: 'total', header: 'Jobs (Window)', accessorFn: (s) => s.total, size: 120, meta: { align: 'right' } },
    { id: 'avgTA', header: 'Avg Turnaround', accessorFn: (s) => s.avgTA ?? -1, size: 130, cell: ({ row }) => fmtHours(row.original.avgTA) },
    { id: 'compRate', header: 'Completion %', accessorFn: (s) => s.compRate ?? -1, size: 160, cell: ({ row }) => <RateBar value={row.original.compRate} /> },
    { id: 'totalCost', header: 'Total Cost', accessorFn: (s) => s.totalCost, size: 130, meta: { align: 'right' }, cell: ({ row }) => fmtCurrency(row.original.totalCost, activeCurrency) },
    { id: 'openJobs', header: 'Open Jobs', accessorFn: (s) => s.openJobs, size: 100, meta: { align: 'right' },
      cell: ({ getValue }) => <span className={`font-medium tabular-nums ${getValue() > 10 ? 'text-red-400' : getValue() > 5 ? 'text-yellow-400' : 'text-[var(--text-secondary)]'}`}>{getValue()}</span> },
    { id: 'score', header: 'Score', accessorFn: (s) => s.score, size: 90, meta: { align: 'right' },
      cell: ({ getValue }) => <Pill tone={scoreTone(getValue())}>{getValue()}</Pill> },
  ], [activeCurrency])

  const techColumns = useMemo(() => [
    { id: 'tech', header: 'Technician', accessorFn: (t) => t.tech, size: 180,
      cell: ({ getValue }) => (
        <span className="inline-flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-[var(--input-bg)] flex items-center justify-center text-xs font-bold text-[var(--text-secondary)]" aria-hidden="true">{(getValue() || '?')[0].toUpperCase()}</span>
          <span className="text-[var(--text-primary)] font-medium">{getValue()}</span>
        </span>
      ) },
    { id: 'total', header: 'Jobs', accessorFn: (t) => t.total, size: 80, meta: { align: 'right' } },
    { id: 'completed', header: 'Jobs Completed', accessorFn: (t) => t.completed, size: 130, meta: { align: 'right' } },
    { id: 'avgTA', header: 'Avg Turnaround', accessorFn: (t) => t.avgTA ?? -1, size: 130, cell: ({ row }) => fmtHours(row.original.avgTA) },
    { id: 'labourCost', header: 'Total Labour Cost', accessorFn: (t) => t.labourCost, size: 140, meta: { align: 'right' }, cell: ({ row }) => fmtCurrency(row.original.labourCost, activeCurrency) },
    { id: 'compRate', header: 'Completion Rate', accessorFn: (t) => t.compRate ?? -1, size: 160, cell: ({ row }) => <RateBar value={row.original.compRate} good={85} fair={70} /> },
    { id: 'rating', header: 'Rating', accessorFn: (t) => t.rating.label, size: 150, cell: ({ row }) => <Pill tone={row.original.rating.tone}>{row.original.rating.label}</Pill> },
  ], [activeCurrency])

  const siteCostColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorFn: (s) => s.site, size: 160 },
    { id: 'totalCost', header: 'Total Cost', accessorFn: (s) => s.totalCost, size: 130, meta: { align: 'right' }, cell: ({ row }) => fmtCurrency(row.original.totalCost, activeCurrency) },
    { id: 'labourCost', header: 'Labour Cost', accessorFn: (s) => s.labourCost, size: 130, meta: { align: 'right' }, cell: ({ row }) => fmtCurrency(row.original.labourCost, activeCurrency) },
    { id: 'partsCost', header: 'Parts Cost', accessorFn: (s) => s.partsCost, size: 130, meta: { align: 'right' }, cell: ({ row }) => fmtCurrency(row.original.partsCost, activeCurrency) },
    { id: 'labourPct', header: 'Labour %', accessorFn: (s) => s.labourPct ?? -1, size: 100, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.labourPct) },
    { id: 'avgPerJob', header: 'Avg Cost/Job', accessorFn: (s) => s.avgPerJob ?? -1, size: 130, meta: { align: 'right' }, cell: ({ row }) => fmtCurrency(row.original.avgPerJob, activeCurrency) },
  ], [activeCurrency])

  // ── Export ────────────────────────────────────────────────────────────────────
  function handleExcelExport() {
    exportToExcel(
      filteredOrders,
      ['work_order_no','asset_no','site','work_type','priority','status','assigned_to','created_at','scheduled_date','completed_at','total_cost','labour_cost','parts_cost'],
      ['WO No','Asset','Site','Type','Priority','Status','Assigned To','Created','Scheduled','Completed','Total Cost','Labour Cost','Parts Cost'],
      reportFileName('Workshop Jobs', activeCountry),
      'Work Orders',
    )
  }

  function handlePdfExport() {
    const siteRows = sitePerf.map(s => ({
      ...s,
      avgTA_fmt: fmtHours(s.avgTA),
      compRate_fmt: fmtPct(s.compRate),
      totalCost_fmt: fmtCurrency(s.totalCost, activeCurrency),
    }))
    exportToPdf(
      siteRows,
      [
        { key: 'site', header: 'Site' },
        { key: 'thisMonth', header: 'Jobs (Month)' },
        { key: 'total', header: 'Jobs (Window)' },
        { key: 'avgTA_fmt', header: 'Avg Turnaround' },
        { key: 'compRate_fmt', header: 'Completion %' },
        { key: 'totalCost_fmt', header: 'Total Cost' },
        { key: 'openJobs', header: 'Open Jobs' },
        { key: 'score', header: 'Score' },
      ],
      'Workshop Performance Report',
      reportFileName('Workshop Performance', activeCountry),
      'landscape',
    )
  }

  const hasFilters = !!(site || workType || status || priority || techSearch || dateFrom || dateTo || search)
  function clearFilters() {
    setSite(''); setWorkType(''); setStatus(''); setPriority(''); setTechSearch(''); setDateFrom(''); setDateTo(''); setSearch(''); jobsPager.setPage(0)
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (!tableExists) {
    return (
      <div className="flex items-center justify-center p-4 sm:p-8">
        <div className="max-w-lg w-full bg-[var(--surface-1)] border border-[var(--input-border)] rounded-2xl p-6 sm:p-8 text-center">
          <div className="w-16 h-16 bg-orange-500/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Wrench className="w-8 h-8 text-orange-400" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-3">Work Orders Module Not Configured</h2>
          <p className="text-[var(--text-muted)] text-sm leading-relaxed mb-6">
            The <code className="bg-[var(--input-bg)] px-1.5 py-0.5 rounded text-orange-400 text-xs">work_orders</code> table does not exist in your database.
            Apply <code className="bg-[var(--input-bg)] px-1.5 py-0.5 rounded text-blue-400 text-xs">MIGRATIONS_V16.sql</code> in your Supabase SQL Editor to enable this module.
          </p>
          <button type="button" onClick={fetchData} className={`${btnCls} mx-auto`}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Retry Connection
          </button>
        </div>
      </div>
    )
  }

  const onTimeColor = kpis.onTimePct == null ? 'blue' : kpis.onTimePct >= 80 ? 'green' : kpis.onTimePct >= 60 ? 'yellow' : 'red'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workshop Management"
        subtitle="Track workshop productivity, repairs, and turnaround time"
        icon={Wrench}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={fetchData} disabled={loading} className={btnCls}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </button>
            <button type="button" onClick={handlePdfExport} disabled={loading || sitePerf.length === 0} className={btnCls}>
              <FileText className="w-4 h-4 text-red-400" aria-hidden="true" />
              PDF
            </button>
            <button type="button" onClick={handleExcelExport} disabled={loading || filteredOrders.length === 0} className={btnCls}>
              <FileSpreadsheet className="w-4 h-4 text-green-400" aria-hidden="true" />
              Excel
            </button>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Filters */}
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            <div className="sm:col-span-2 lg:col-span-2">
              <label htmlFor="wm-search" className={labelCls}>Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
                <input
                  id="wm-search"
                  type="search"
                  value={search}
                  onChange={e => { setSearch(e.target.value); jobsPager.setPage(0) }}
                  placeholder="WO no, asset, site, technician"
                  className={`${fieldCls} pl-9`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="wm-site" className={labelCls}>Site</label>
              <select id="wm-site" value={site} onChange={e => { setSite(e.target.value); jobsPager.setPage(0) }} className={fieldCls}>
                <option value="">All Sites</option>
                {siteOptions.map(s => <option key={s} value={s}>{s}</option>)}
                {site && !siteOptions.includes(site) && <option value={site}>{site}</option>}
              </select>
            </div>

            <div>
              <label htmlFor="wm-type" className={labelCls}>Work type</label>
              <select id="wm-type" value={workType} onChange={e => { setWorkType(e.target.value); jobsPager.setPage(0) }} className={fieldCls}>
                <option value="">All Types</option>
                {WORK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="wm-status" className={labelCls}>Status</label>
              <select id="wm-status" value={status} onChange={e => { setStatus(e.target.value); jobsPager.setPage(0) }} className={fieldCls}>
                <option value="">All Statuses</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="wm-priority" className={labelCls}>Priority</label>
              <select id="wm-priority" value={priority} onChange={e => { setPriority(e.target.value); jobsPager.setPage(0) }} className={fieldCls}>
                <option value="">All Priorities</option>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="wm-tech" className={labelCls}>Technician</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
                <input
                  id="wm-tech"
                  value={techSearch}
                  onChange={e => { setTechSearch(e.target.value); jobsPager.setPage(0) }}
                  placeholder="Technician name"
                  className={`${fieldCls} pl-9`}
                />
              </div>
            </div>

            <div>
              <label htmlFor="wm-from" className={labelCls}>Created from</label>
              <input id="wm-from" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); jobsPager.setPage(0) }} className={fieldCls} />
            </div>

            <div>
              <label htmlFor="wm-to" className={labelCls}>Created to</label>
              <input id="wm-to" type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); jobsPager.setPage(0) }} className={fieldCls} />
            </div>

            <div className="sm:col-span-2 lg:col-span-2 flex flex-wrap items-end gap-2">
              <span className="sr-only" id="wm-presets">Quick date ranges</span>
              <div className="flex items-center gap-1 flex-wrap" role="group" aria-labelledby="wm-presets">
                <Calendar className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
                {[{ label: '30d', days: 30, name: 'Last 30 days' }, { label: '90d', days: 90, name: 'Last 90 days' }, { label: '6m', days: 180, name: 'Last 6 months' }, { label: '1yr', days: 365, name: 'Last 12 months' }].map(p => (
                  <button
                    key={p.label}
                    type="button"
                    title={p.name}
                    onClick={() => { const r = applyDatePreset(p.days); setDateFrom(r.from); setDateTo(r.to); jobsPager.setPage(0) }}
                    className="px-3 min-h-[44px] rounded-lg text-xs bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                  <X className="w-4 h-4" aria-hidden="true" />
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Loading */}
        {loading && <SkeletonTable rows={8} cols={6} />}

        {!loading && error && (
          <div role="alert" className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 sm:p-5 text-sm flex flex-wrap items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-red-400">Work orders could not be loaded</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">{error}</p>
            </div>
            <button type="button" onClick={fetchData} className={btnCls}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Scope / bounding note - the grid is always windowed + capped so the
                browser never pulls the whole work_orders table. */}
            {(loadMeta.windowDefault || loadMeta.truncated) && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 text-xs text-[var(--text-secondary)] flex items-start gap-2">
                <Filter className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  {loadMeta.windowDefault && (
                    <p>
                      Showing work orders since {windowFromLabel(loadMeta.windowFrom)} (last {DEFAULT_WINDOW_MONTHS} months).
                      Set a date range above to change the window.
                    </p>
                  )}
                  {loadMeta.truncated && (
                    <p>
                      This selection has more than {WORK_ORDER_CEILING.toLocaleString()} work orders.
                      Showing the most recent {allOrders.length.toLocaleString()}
                      {loadMeta.totalCount != null ? ` of ${loadMeta.totalCount.toLocaleString()}` : ''}.
                      Narrow the filters or date range to see the rest. Total Cost and Open Jobs above still reflect the full selection.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
              <KpiCard icon={ClipboardList} label="Work Orders" value={kpis.totalThisMonth.toLocaleString()} sub="created this month" color="blue" />
              <KpiCard icon={Clock} label="Avg Turnaround" value={fmtHours(kpis.avgTA)} sub="created to completed" color="purple" />
              <KpiCard icon={CheckCircle} label="Completion Rate" value={fmtPct(kpis.completionRate)} sub={`${kpis.completedCount.toLocaleString()} of ${kpis.total.toLocaleString()} completed`} color="green" />
              <KpiCard icon={DollarSign} label="Total Cost" value={fmtCurrency(kpiTotalCost, activeCurrency)} sub="labour + parts" color="yellow" />
              <KpiCard icon={AlertTriangle} label="Open Jobs" value={kpiOpenJobs.toLocaleString()} sub="not completed or cancelled" color={kpiOpenJobs > 20 ? 'red' : kpiOpenJobs > 10 ? 'orange' : 'blue'} />
              <KpiCard icon={Target} label="On-Time Rate" value={fmtPct(kpis.onTimePct)} sub={kpis.onTimePct == null ? 'no completed job has a target date' : 'completed by target date'} color={onTimeColor} />
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1 overflow-x-auto max-w-full" role="tablist" aria-label="Workshop views">
              {TABS.map(tab => {
                const on = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-4 min-h-[44px] rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
                      on ? 'bg-blue-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" aria-hidden="true" />
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5" role="tabpanel" aria-label="Overview">
                <ChartCard
                  title="Job Volume by Site"
                  subtitle={`Completed jobs per month, top ${series.sites.length || 5} sites by volume`}
                  height={280}
                  empty={series.sites.length === 0}
                  summary={`Completed jobs per month for ${series.sites.join(', ') || 'no sites'}`}
                >
                  <Bar data={jobVolumeChart} options={CHART_DEFAULTS} />
                </ChartCard>

                <ChartCard
                  title="Work Type Distribution"
                  subtitle="Breakdown by job category"
                  height={280}
                  empty={workTypes.length === 0}
                  summary={workTypes.map(w => `${w.type} ${w.count}`).join(', ')}
                >
                  <Doughnut data={workTypeChart} options={NO_SCALE} />
                </ChartCard>

                <ChartCard
                  title="Turnaround Time Trend"
                  subtitle="Monthly average hours, lower is better"
                  height={240}
                  empty={!series.hasTurnaround}
                  emptyText="No completed job in the last 12 months has a measurable turnaround."
                >
                  <Line data={taTrendChart} options={{ ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } } }} />
                </ChartCard>

                <ChartCard
                  title="Monthly Cost Analysis"
                  subtitle="Labour vs parts cost per month"
                  height={240}
                  empty={!series.hasCost}
                  emptyText="No labour or parts cost is recorded in the last 12 months."
                >
                  <Bar data={costChart} options={STACKED} />
                </ChartCard>
              </div>
            )}

            {activeTab === 'jobs' && (
              <div className="space-y-4" role="tabpanel" aria-label="Jobs table">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm text-[var(--text-muted)]">
                    {filteredOrders.length.toLocaleString()} job{filteredOrders.length === 1 ? '' : 's'}
                    {filteredOrders.length !== allOrders.length ? ` of ${allOrders.length.toLocaleString()} loaded` : ''}
                  </p>
                  {loadMeta.truncated && (
                    <p className="text-xs text-blue-400">
                      Most recent {allOrders.length.toLocaleString()}
                      {loadMeta.totalCount != null ? ` of ${loadMeta.totalCount.toLocaleString()}` : ''} in this window
                    </p>
                  )}
                </div>

                {filteredOrders.length === 0 ? (
                  <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                    {allOrders.length === 0
                      ? 'No work orders were recorded in this window.'
                      : 'No work orders match the current filters.'}
                    {hasFilters && (
                      <div className="mt-3">
                        <button type="button" onClick={clearFilters} className={`${btnCls} mx-auto`}>Clear filters</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <EnterpriseTable
                      columns={jobColumns}
                      data={jobsPager.pageRows}
                      getRowId={(j) => String(j.id)}
                      enableGlobalFilter={false}
                      enableColumnFilters={false}
                      enableExport={false}
                      virtual
                      maxHeight={640}
                      viewKey="workshop-management-jobs"
                      onRowClick={(job) => navigate(`/workshop/${encodeURIComponent(job.id)}`)}
                      emptyMessage="No work orders on this page."
                    />
                    {/* Pagination - the shared bar (50 a page by default). */}
                    <TablePagination {...jobsPager} />
                  </div>
                )}
              </div>
            )}

            {activeTab === 'sites' && (
              <section className="space-y-2" role="tabpanel" aria-label="Site performance">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Workshop Performance by Site</h3>
                  <span className="text-xs text-[var(--text-muted)]">{sitePerf.length} sites</span>
                </div>
                <EnterpriseTable
                  columns={siteColumns}
                  data={sitePerf}
                  getRowId={(s) => s.site}
                  enableColumnFilters={false}
                  searchPlaceholder="Search sites"
                  exportFileName={reportFileName('Workshop Site Performance', activeCountry)}
                  initialPageSize={50}
                  emptyMessage="No site data for the selected filters."
                />
                <p className="text-[11px] text-[var(--text-muted)]">Score out of 100: completion rate 40, turnaround speed 30, on-time rate 30.</p>
              </section>
            )}

            {activeTab === 'technicians' && (
              <section className="space-y-2" role="tabpanel" aria-label="Technicians">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Technician Performance</h3>
                  <span className="text-xs text-[var(--text-muted)]">{techPerf.length} technicians</span>
                </div>
                <EnterpriseTable
                  columns={techColumns}
                  data={techPerf}
                  getRowId={(t) => t.tech}
                  enableColumnFilters={false}
                  searchPlaceholder="Search technicians"
                  exportFileName={reportFileName('Workshop Technician Performance', activeCountry)}
                  initialPageSize={50}
                  emptyMessage="No technician data for the selected filters."
                />
              </section>
            )}

            {activeTab === 'costs' && (
              <div className="space-y-5" role="tabpanel" aria-label="Cost analysis">
                <ChartCard
                  title="Labour vs Parts Cost"
                  subtitle="Monthly stacked breakdown, identify cost drivers"
                  height={300}
                  empty={!series.hasCost}
                  emptyText="No labour or parts cost is recorded in the last 12 months."
                >
                  <Bar data={costChart} options={STACKED} />
                </ChartCard>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { label: 'Total Labour Cost', value: split.labour, pct: split.labourPct, bar: 'bg-blue-500', icon: User, iconColor: 'text-blue-400' },
                    { label: 'Total Parts Cost', value: split.parts, pct: split.partsPct, bar: 'bg-purple-500', icon: Package, iconColor: 'text-purple-400' },
                    { label: 'Total Workshop Cost', value: split.total, pct: split.total > 0 ? 100 : null, bar: 'bg-green-500', icon: DollarSign, iconColor: 'text-green-400' },
                  ].map(c => (
                    <div key={c.label} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{c.label}</span>
                        <c.icon className={`w-4 h-4 ${c.iconColor}`} aria-hidden="true" />
                      </div>
                      <div className="text-2xl font-bold text-[var(--text-primary)] mb-3 tabular-nums">{fmtCurrency(c.value, activeCurrency)}</div>
                      <div className="bg-[var(--input-bg)] rounded-full h-1.5" aria-hidden="true">
                        <div className={`h-1.5 rounded-full ${c.bar}`} style={{ width: `${c.pct ?? 0}%` }} />
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-1.5">{c.pct == null ? 'Share N/A (no cost recorded)' : `${c.pct.toFixed(1)}% of total`}</p>
                    </div>
                  ))}
                </div>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Cost by Site</h3>
                  <EnterpriseTable
                    columns={siteCostColumns}
                    data={sitePerf}
                    getRowId={(s) => s.site}
                    enableColumnFilters={false}
                    searchPlaceholder="Search sites"
                    exportFileName={reportFileName('Workshop Cost by Site', activeCountry)}
                    initialPageSize={50}
                    emptyMessage="No cost data for the selected filters."
                  />
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
