import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  Trash2, AlertTriangle, TrendingDown, TrendingUp, Minus,
  Search, Filter, FileText, FileSpreadsheet,
  RefreshCw, CheckCircle, DollarSign,
  BarChart3, Building2, Tag, Layers, Info,
  ChevronUp, ArrowRight, X,
  Recycle, AlertOctagon, Flame, Activity, Lock, ShieldCheck,
} from 'lucide-react'
import { SkeletonTable } from '../components/ui/Skeleton'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import ScrappedRegister from '../components/tyre/ScrappedRegister'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import * as scrapApi from '../lib/api/tyreScrap'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { formatMonthYear } from '../lib/formatters'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/EmptyState'
import { toUserMessage } from '../lib/safeError'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { categorical, colorAt, withAlpha } from '../lib/reportColors'
import {
  DATE_RANGE_OPTS, REMOVAL_REASONS, RETREAD_SHARE, RETREAD_SAVING,
  isScrap, kmLife, tyreCost, serialOf, refDate, dataAnchor as anchorOf, cutoffFor,
  fleetAvgKmLife as fleetAvgOf, scrapKpis, monthlyScrapTrend, reasonBreakdown,
  positionBreakdown, earlyScrap as earlyScrapOf, retreadOpportunity, brandScrapAnalysis,
  siteScrapAnalysis, siteMonthlySeries, brandSiteMatrix, heatLevel,
  filterDisposalLog, disposalSummary,
} from '../lib/tyreScrapManagementAnalytics'

// exportUtils carries the PDF/Excel engines; load it on first click only.
const loadExportUtils = () => import('../lib/exportUtils')

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ─────────────────────────────────────────────────────────────────

// "Scrapped Register" is first because it is the literal answer to "show me the
// scrapped tyres". Every other tab on this page works off the isScrap heuristic
// (risk_level Critical / category Scrap, see tyreScrapManagementAnalytics.js),
// which is an ANALYSIS of tyres that look scrap-worthy - it is not the list of
// tyres anybody actually scrapped, and it never was.
const TABS = ['Scrapped Register', 'Overview', 'By Brand', 'By Site', 'Disposal Log']

const NA = 'N/A'

const DISPOSAL_STATUSES = {
  Pending:   { text: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700' },
  Disposed:  { text: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700' },
  Retreaded: { text: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700' },
  Unknown:   { text: 'text-[var(--text-muted)]', bg: 'bg-[var(--input-bg)]', border: 'border-[var(--input-border)]' },
}

const BAND_META = {
  review:  { label: 'High scrap, review', cls: 'text-red-400 bg-red-900/30 border-red-700', text: 'text-red-400' },
  watch:   { label: 'Watch', cls: 'text-orange-400 bg-orange-900/30 border-orange-700', text: 'text-orange-400' },
  normal:  { label: 'Normal performance', cls: 'text-green-400 bg-green-900/20 border-green-700/50', text: 'text-green-400' },
  unknown: { label: 'Not measurable', cls: 'text-[var(--text-muted)] bg-[var(--input-bg)] border-[var(--input-border)]', text: 'text-[var(--text-muted)]' },
}

const HEAT_META = {
  none:   { cls: 'bg-[var(--input-bg)] text-[var(--text-dim)]', label: 'None' },
  low:    { cls: 'bg-yellow-900/60 text-white', label: 'Low' },
  medium: { cls: 'bg-orange-500 text-white', label: 'Medium' },
  high:   { cls: 'bg-red-600 text-white', label: 'High' },
}

const FIELD_CLS = 'min-h-[44px] px-3 py-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500'
const BTN_CLS = 'inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50'

// ── Chart defaults (tokens resolve through chartVarPlugin) ────────────────────

const TOOLTIP = {
  backgroundColor: 'var(--panel)',
  borderColor: 'var(--hairline)',
  borderWidth: 1,
  titleColor: 'var(--text-primary)',
  bodyColor: 'var(--text-secondary)',
}
const TICK = { color: 'var(--text-muted)', font: { size: 11 } }

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 } } },
    tooltip: TOOLTIP,
  },
  scales: {
    x: { ticks: TICK, grid: { color: 'var(--panel-2)' } },
    y: { ticks: TICK, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}

const CHART_OPTS_NO_SCALES = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom', labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 } } },
    tooltip: TOOLTIP,
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n, decimals = 0) {
  if (n == null || Number.isNaN(Number(n))) return NA
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtCurrency(n, currency) {
  if (n == null || Number.isNaN(Number(n))) return NA
  return `${currency} ${fmt(n, 0)}`
}

const fmtPct = (v, d = 1) => (v == null ? NA : `${Number(v).toFixed(d)}%`)

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color = 'text-[var(--text-primary)]', warn = false, badge }) {
  return (
    <div
      className={`bg-[var(--surface-1)] border ${warn ? 'border-red-700/60' : 'border-[var(--input-border)]'} rounded-xl p-4 flex items-start gap-3 min-w-0`}
    >
      <div className={`p-2 rounded-lg bg-[var(--input-bg)] shrink-0 ${color}`} aria-hidden="true">
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[var(--text-muted)] text-xs leading-none">{label}</p>
        <p className={`text-2xl font-bold mt-1 tabular-nums ${color} break-words`}>{value}</p>
        {sub && <p className="text-[var(--text-muted)] text-xs mt-0.5 leading-tight">{sub}</p>}
        {badge && (
          <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>
    </div>
  )
}

function TrendCell({ trend }) {
  const map = {
    up: { Icon: TrendingUp, cls: 'text-red-400', label: 'Rising' },
    down: { Icon: TrendingDown, cls: 'text-green-400', label: 'Improving' },
    stable: { Icon: Minus, cls: 'text-[var(--text-muted)]', label: 'Stable' },
    unknown: { Icon: Minus, cls: 'text-[var(--text-dim)]', label: NA },
  }
  const m = map[trend] || map.unknown
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${m.cls}`}>
      <m.Icon size={14} aria-hidden="true" /> {m.label}
    </span>
  )
}

function Badge({ label, cfg }) {
  const c = cfg ?? DISPOSAL_STATUSES.Unknown
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-semibold ${c.text} ${c.bg} ${c.border}`}>
      {label}
    </span>
  )
}

function Panel({ icon: Icon, iconCls = 'text-blue-400', title, note, children, pad = true }) {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl">
      <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2 flex-wrap">
        {Icon && <Icon className={iconCls} size={15} aria-hidden="true" />}
        <h2 className="font-semibold text-[var(--text-secondary)] text-sm">{title}</h2>
        {note && <span className="text-[var(--text-dim)] text-xs">{note}</span>}
      </div>
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

/** EnterpriseTable over the shared paging contract (usePagedRows + TablePagination). */
function PagedTable({ columns, pager, emptyMessage, getRowId = (r) => String(r.id), maxHeight = 520 }) {
  return (
    <div className="space-y-2">
      <EnterpriseTable
        columns={columns}
        data={pager.pageRows}
        getRowId={getRowId}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableSorting={false}
        enableExport={false}
        virtual
        maxHeight={maxHeight}
        emptyMessage={emptyMessage}
      />
      <TablePagination {...pager} />
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-xs flex-col gap-2" role="status">
      <BarChart3 size={24} aria-hidden="true" />
      No data available for current filters
    </div>
  )
}

function LoadFailed({ message, onRetry }) {
  return (
    <div role="alert" className="bg-[var(--surface-1)] border border-red-700/60 rounded-xl p-6 flex flex-col items-center text-center gap-3">
      <AlertOctagon className="text-red-400" size={26} aria-hidden="true" />
      <p className="text-[var(--text-secondary)] font-medium">The scrap analysis could not be loaded.</p>
      <p className="text-sm text-[var(--text-muted)] max-w-md">{message} Nothing below is shown until it loads, so an empty chart is never mistaken for a fleet with no scrap.</p>
      <button onClick={onRetry} className={BTN_CLS}><RefreshCw size={14} /> Retry</button>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function TyreScrapManagement() {
  const { appSettings, activeCurrency, activeCountry } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  // ── State ───────────────────────────────────────────────────────────────────
  const [allTyres,   setAllTyres]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [truncated,  setTruncated]  = useState(false)
  const [loaded,     setLoaded]     = useState(false)
  const [activeTab,  setActiveTab]  = useState('Overview')

  // Filters
  const [dateRangeIdx, setDateRangeIdx] = useState(2)          // 180 days default
  const [filterSite,   setFilterSite]   = useState('All')
  const [filterBrand,  setFilterBrand]  = useState('All')
  const [filterReason, setFilterReason] = useState('All')

  // Disposal log search
  const [logSearch,    setLogSearch]    = useState('')
  const [logBrand,     setLogBrand]     = useState('All')
  const [logSite,      setLogSite]      = useState('All')
  const [logDateFrom,  setLogDateFrom]  = useState('')
  const [logDateTo,    setLogDateTo]    = useState('')

  // Disposal statuses persisted in tyre_disposals (V62) - shared across the
  // team instead of one browser's localStorage.
  const [disposals, setDisposals] = useState({})
  const [disposalError, setDisposalError] = useState('')
  // A failed read of the statuses must not render every tyre as "Pending",
  // and a status button must not overwrite a value we could not read.
  const [disposalLoadError, setDisposalLoadError] = useState('')

  // ── Approval & Workflow Engine (per disposal-log record) ──────────────────────
  // The open record hosts <EntityApprovalPanel/>. While that record's workflow is
  // active (pending/in_review/returned) or locked (approved), its scrap-status
  // mutation (markDisposed) is disabled. Only one record is open at a time, so a
  // single wfLocked flag is reset whenever a different record opens.
  const [expandedId, setExpandedId] = useState(null)
  const [wfLocked, setWfLocked] = useState(false)

  const toggleExpanded = useCallback((id) => {
    setExpandedId((prev) => {
      const next = prev === id ? null : id
      setWfLocked(false)   // reset lock when a different record opens/closes
      return next
    })
  }, [])

  const loadDisposals = useCallback(async () => {
    setDisposalLoadError('')
    try {
      const { data, error: err } = await scrapApi.listTyreDisposals()
      if (err) throw err
      setDisposals(Object.fromEntries((data || []).map((d) => [d.tyre_record_id, d.status])))
    } catch (e) {
      setDisposalLoadError(toUserMessage(e, 'Disposal statuses could not be loaded.'))
    }
  }, [])

  useEffect(() => { loadDisposals() }, [loadDisposals])

  // ── Load data ────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Bounded read: cap at 50,000 rows with a stable id tiebreak so paging
      // never drops/repeats a row at a boundary. Surface the cap honestly.
      const { data, error: err, truncated: tr } = await fetchAllPages(
        (from, to) => scrapApi.listScrapTyreRecords({ from, to }).order('id'),
        { max: 50000 },
      )
      if (err) throw err
      setAllTyres(data ?? [])
      setTruncated(!!tr)
      setLoaded(true)
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load tyre data.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const refreshAll = useCallback(() => { loadData(); loadDisposals() }, [loadData, loadDisposals])

  // A failed first read is shown as a failure, never as "no scrap".
  const analysisFailed = !!error && !loaded

  // ── Derived: data anchor ─────────────────────────────────────────────────────
  // Anchor every "last N days / months" window to the data's latest activity
  // date (removal or issue, fallback: today) so historic imports still
  // populate charts and KPIs (matches Dashboard's dataAnchor pattern).
  const dataAnchor = useMemo(() => anchorOf(allTyres), [allTyres])

  // ── Derived: filter window ────────────────────────────────────────────────────
  const cutoffDate = useMemo(
    () => cutoffFor(DATE_RANGE_OPTS[dateRangeIdx].days, dataAnchor),
    [dateRangeIdx, dataAnchor],
  )

  // ── Derived: country-filtered base ────────────────────────────────────────────
  const countryFiltered = useMemo(() => {
    if (!activeCountry || activeCountry === 'All') return allTyres
    return allTyres.filter(t => t.country === activeCountry)
  }, [allTyres, activeCountry])

  // ── Derived: apply date + site + brand filters ─────────────────────────────────
  const filtered = useMemo(() => {
    return countryFiltered.filter(t => {
      if (filterSite !== 'All' && t.site !== filterSite) return false
      if (filterBrand !== 'All' && t.brand !== filterBrand) return false
      if (filterReason !== 'All') {
        const reason = (t.removal_reason ?? '').toLowerCase()
        if (!reason.includes(filterReason.toLowerCase())) return false
      }
      if (cutoffDate) {
        const ref = refDate(t)
        if (!ref || new Date(ref) < cutoffDate) return false
      }
      return true
    })
  }, [countryFiltered, filterSite, filterBrand, filterReason, cutoffDate])

  // ── Scrapped subset ───────────────────────────────────────────────────────────
  const scrapped = useMemo(() => filtered.filter(isScrap), [filtered])
  const allScrapped = useMemo(() => countryFiltered.filter(isScrap), [countryFiltered])

  /**
   * The base for the 12-month trend: site, brand and reason apply, the DATE
   * cutoff does not.
   *
   * Holding out the date is the point - the chart reports on time, so narrowing
   * it by the period filter would just truncate the series it exists to show.
   * The other three used to be held out as well, which left a fleet-wide trend
   * sitting directly beneath KPI tiles narrowed to one site.
   */
  const trendScrapped = useMemo(() => (
    countryFiltered.filter(t => {
      if (!isScrap(t)) return false
      if (filterSite !== 'All' && t.site !== filterSite) return false
      if (filterBrand !== 'All' && t.brand !== filterBrand) return false
      if (filterReason !== 'All') {
        const reason = (t.removal_reason ?? '').toLowerCase()
        if (!reason.includes(filterReason.toLowerCase())) return false
      }
      return true
    })
  ), [countryFiltered, filterSite, filterBrand, filterReason])

  // ── Unique options for dropdowns ──────────────────────────────────────────────
  const siteOptions = useMemo(() => {
    const s = [...new Set(countryFiltered.map(t => t.site).filter(Boolean))].sort()
    return ['All', ...s]
  }, [countryFiltered])

  const brandOptions = useMemo(() => {
    const b = [...new Set(countryFiltered.map(t => t.brand).filter(Boolean))].sort()
    return ['All', ...b]
  }, [countryFiltered])

  const filtersActive = dateRangeIdx !== 2 || filterSite !== 'All' || filterBrand !== 'All' || filterReason !== 'All'
  const clearFilters = () => { setDateRangeIdx(2); setFilterSite('All'); setFilterBrand('All'); setFilterReason('All') }

  // ── Engine outputs ────────────────────────────────────────────────────────────
  const fleetAvgKmLife = useMemo(() => fleetAvgOf(allTyres), [allTyres])
  const kpis = useMemo(() => scrapKpis(filtered, scrapped), [filtered, scrapped])
  const monthlyTrend = useMemo(
    () => monthlyScrapTrend(trendScrapped, dataAnchor, 12, formatMonthYear),
    [trendScrapped, dataAnchor],
  )
  const reasons = useMemo(() => reasonBreakdown(scrapped), [scrapped])
  const positions = useMemo(() => positionBreakdown(scrapped), [scrapped])
  const earlyScrap = useMemo(() => earlyScrapOf(scrapped, fleetAvgKmLife), [scrapped, fleetAvgKmLife])
  const retreatOpportunity = useMemo(() => retreadOpportunity(allScrapped, dataAnchor), [allScrapped, dataAnchor])
  const brandAnalysis = useMemo(() => brandScrapAnalysis(filtered, fleetAvgKmLife), [filtered, fleetAvgKmLife])
  const siteAnalysis = useMemo(() => siteScrapAnalysis(filtered), [filtered])
  const siteSeries = useMemo(
    () => siteMonthlySeries(siteAnalysis, dataAnchor, 6, 5, formatMonthYear),
    [siteAnalysis, dataAnchor],
  )
  const heatMap = useMemo(
    () => brandSiteMatrix(scrapped, brandAnalysis.slice(0, 6).map(b => b.brand), siteAnalysis.slice(0, 6).map(s => s.site)),
    [scrapped, brandAnalysis, siteAnalysis],
  )
  const disposalLog = useMemo(
    () => filterDisposalLog(allScrapped, { search: logSearch, brand: logBrand, site: logSite, from: logDateFrom, to: logDateTo }),
    [allScrapped, logSearch, logBrand, logSite, logDateFrom, logDateTo],
  )
  const disposalCounts = useMemo(() => disposalSummary(disposalLog, disposals), [disposalLog, disposals])
  const brandPager = usePagedRows(brandAnalysis)
  const sitePager = usePagedRows(siteAnalysis)
  const disposalPager = usePagedRows(disposalLog)

  const statusOf = useCallback(
    (id) => (disposalLoadError ? 'Unknown' : (disposals[id] ?? 'Pending')),
    [disposals, disposalLoadError],
  )

  // ── Mark as disposed ──────────────────────────────────────────────────────────
  const markDisposed = useCallback((id, status = 'Disposed') => {
    // Block the mutation while this record is mid-approval / approved-locked,
    // and while the current statuses are unknown.
    if (id === expandedId && wfLocked) return
    if (disposalLoadError) return
    setDisposalError('')
    let prevStatus
    setDisposals(prev => {
      prevStatus = prev[id]
      return { ...prev, [id]: status }
    })
    scrapApi.upsertTyreDisposal(id, status)
      .then(({ error: err }) => {
        if (err) {
          setDisposals(prev => ({ ...prev, [id]: prevStatus ?? 'Pending' }))
          setDisposalError(toUserMessage(err, 'Could not save the disposal status.'))
        }
      })
  }, [expandedId, wfLocked, disposalLoadError])

  // ── Chart data (colours follow the report palette) ────────────────────────────
  const trendChartData = useMemo(() => {
    const countColor = colorAt(0)
    const costColor = colorAt(1)
    return {
      labels: monthlyTrend.map(m => m.label),
      datasets: [
        {
          label: 'Scrap count',
          data: monthlyTrend.map(m => m.count),
          borderColor: countColor,
          backgroundColor: withAlpha(countColor, 0.12),
          fill: true,
          tension: 0.4,
          yAxisID: 'y',
        },
        {
          label: `Cost (${activeCurrency})`,
          data: monthlyTrend.map(m => Math.round(m.cost)),
          borderColor: costColor,
          backgroundColor: withAlpha(costColor, 0.08),
          fill: false,
          tension: 0.4,
          yAxisID: 'y1',
        },
      ],
    }
  }, [monthlyTrend, activeCurrency])

  const trendChartOpts = useMemo(() => ({
    ...CHART_OPTS,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { ticks: { ...TICK, font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
      y: {
        position: 'left',
        beginAtZero: true,
        ticks: { ...TICK, font: { size: 10 } },
        grid: { color: 'var(--panel-2)' },
        title: { display: true, text: 'Count', color: 'var(--text-muted)', font: { size: 10 } },
      },
      y1: {
        position: 'right',
        beginAtZero: true,
        ticks: { ...TICK, font: { size: 10 }, callback: v => `${activeCurrency} ${fmt(v)}` },
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'Cost', color: 'var(--text-muted)', font: { size: 10 } },
      },
    },
  }), [activeCurrency])

  const doughnutOf = (items) => ({
    labels: items.map(i => i.label),
    datasets: [{ data: items.map(i => i.count), backgroundColor: categorical(items.length), borderWidth: 0 }],
  })
  const reasonDonut = useMemo(() => doughnutOf(reasons), [reasons])
  const positionDonut = useMemo(() => doughnutOf(positions), [positions])

  const brandChartData = useMemo(() => {
    const top = brandAnalysis.filter(b => b.scrapRate != null).slice(0, 10)
    return {
      labels: top.map(b => b.brand),
      datasets: [{
        label: 'Scrap rate %',
        data: top.map(b => +b.scrapRate.toFixed(1)),
        // Semantic band colours; the table beside the chart states the band in words.
        backgroundColor: top.map(b => (b.band === 'review' ? '#ef4444' : b.band === 'watch' ? '#f97316' : '#22c55e')),
      }],
    }
  }, [brandAnalysis])

  const siteBarData = useMemo(() => ({
    labels: siteSeries.labels,
    datasets: siteSeries.series.map((s, idx) => ({ label: s.site, data: s.data, backgroundColor: colorAt(idx) })),
  }), [siteSeries])

  // ── Table columns ─────────────────────────────────────────────────────────────
  const earlyColumns = useMemo(() => [
    { id: 'serial', header: 'Serial', accessorFn: r => serialOf(r) ?? NA,
      cell: ({ getValue }) => <span className="font-mono text-blue-300">{getValue()}</span> },
    { accessorKey: 'brand', header: 'Brand', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'position', header: 'Position', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'site', header: 'Site', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'life', header: 'km life', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="text-red-400 font-semibold tabular-nums">{fmt(getValue())}</span> },
    { accessorKey: 'pctOfAvg', header: '% of avg', meta: { align: 'right' },
      cell: ({ getValue }) => {
        const v = getValue()
        return v == null ? NA : <span className={`font-bold tabular-nums ${v < 30 ? 'text-red-400' : 'text-yellow-400'}`}>{v.toFixed(0)}%</span>
      } },
    { accessorKey: 'removal_reason', header: 'Reason', cell: ({ getValue }) => getValue() || NA },
  ], [])

  const brandColumns = useMemo(() => [
    { accessorKey: 'brand', header: 'Brand',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2 font-medium text-[var(--text-secondary)]">
          {row.original.band === 'review' && <AlertTriangle size={12} className="text-red-400 shrink-0" aria-label="High scrap" />}
          {row.original.brand}
        </span>
      ) },
    { accessorKey: 'total', header: 'Total', meta: { align: 'right' } },
    { accessorKey: 'scrap', header: 'Scrapped', meta: { align: 'right' },
      cell: ({ getValue }) => <span className={getValue() > 0 ? 'text-red-400 font-semibold' : ''}>{getValue()}</span> },
    { accessorKey: 'scrapRate', header: 'Scrap rate', meta: { align: 'right' },
      cell: ({ row }) => {
        const b = row.original
        if (b.scrapRate == null) return NA
        const bar = b.band === 'review' ? 'bg-red-500' : b.band === 'watch' ? 'bg-orange-500' : 'bg-green-500'
        return (
          <span className="inline-flex items-center justify-end gap-2">
            <span className="w-14 h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden" aria-hidden="true">
              <span className={`block h-full rounded-full ${bar}`} style={{ width: `${Math.min(b.scrapRate, 100)}%` }} />
            </span>
            <span className={`text-xs font-bold tabular-nums ${BAND_META[b.band].text}`}>{fmtPct(b.scrapRate)}</span>
          </span>
        )
      } },
    { accessorKey: 'avgKm', header: 'Avg km life', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() != null ? `${fmt(getValue())} km` : NA) },
    { accessorKey: 'avgCPK', header: 'Avg CPK', meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() != null ? getValue().toFixed(4) : NA) },
    { accessorKey: 'earlyPct', header: 'Early scrap %', meta: { align: 'right' },
      cell: ({ getValue }) => {
        const v = getValue()
        return v == null ? NA : <span className={v > 30 ? 'text-red-400 font-bold' : ''}>{v.toFixed(0)}%</span>
      } },
    { accessorKey: 'rec', header: 'Recommendation',
      cell: ({ row }) => {
        const m = BAND_META[row.original.band === 'watch' ? 'normal' : row.original.band]
        return <span className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-semibold ${m.cls}`}>{row.original.rec}</span>
      } },
  ], [])

  const siteColumns = useMemo(() => [
    { accessorKey: 'site', header: 'Site', cell: ({ getValue }) => <span className="font-medium text-[var(--text-secondary)]">{getValue()}</span> },
    { accessorKey: 'scrap', header: 'Total scrapped', meta: { align: 'right' },
      cell: ({ getValue }) => <span className={getValue() > 0 ? 'text-red-400 font-semibold' : ''}>{getValue()}</span> },
    { accessorKey: 'cost', header: 'Scrap cost', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{fmtCurrency(getValue(), activeCurrency)}</span> },
    { accessorKey: 'scrapRate', header: 'Scrap rate', meta: { align: 'right' },
      cell: ({ row }) => <span className={`font-bold text-xs tabular-nums ${BAND_META[row.original.band].text}`}>{fmtPct(row.original.scrapRate)}</span> },
    { accessorKey: 'worstBrand', header: 'Worst brand', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'trend', header: 'Trend', meta: { align: 'center' }, cell: ({ getValue }) => <TrendCell trend={getValue()} /> },
  ], [activeCurrency])

  const heatColumns = useMemo(() => [
    { accessorKey: 'brand', header: 'Brand / site', cell: ({ getValue }) => <span className="font-medium text-[var(--text-secondary)]">{getValue()}</span> },
    ...heatMap.sites.map(site => ({
      id: `site_${site}`,
      header: site,
      accessorFn: r => r[site],
      meta: { align: 'center' },
      cell: ({ getValue }) => {
        const v = getValue() || 0
        const lvl = heatLevel(v, heatMap.maxVal)
        return (
          <span className={`inline-flex min-w-[2.5rem] justify-center px-2 py-1 rounded font-bold ${HEAT_META[lvl].cls}`}
            title={`${HEAT_META[lvl].label}: ${v} scrapped`}>
            {v > 0 ? v : 0}
          </span>
        )
      },
    })),
  ], [heatMap])

  const disposalColumns = useMemo(() => [
    { id: 'approval', header: 'Approval',
      cell: ({ row }) => {
        const t = row.original
        const isOpen = expandedId === t.id
        return (
          <button
            onClick={() => toggleExpanded(t.id)}
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--input-bg)] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label={isOpen ? `Hide scrap approval for ${serialOf(t) || t.asset_no || 'this tyre'}` : `Open scrap approval for ${serialOf(t) || t.asset_no || 'this tyre'}`}
            aria-expanded={isOpen}
          >
            {isOpen ? <ChevronUp size={16} /> : <ShieldCheck size={16} />}
          </button>
        )
      } },
    { id: 'serial', header: 'Serial no', accessorFn: r => serialOf(r) ?? NA,
      cell: ({ getValue }) => <span className="font-mono text-blue-300 text-xs">{getValue()}</span> },
    { accessorKey: 'brand', header: 'Brand', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'size', header: 'Size', cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || NA}</span> },
    { accessorKey: 'position', header: 'Position', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'asset_no', header: 'Asset', cell: ({ getValue }) => getValue() || NA },
    { accessorKey: 'site', header: 'Site', cell: ({ getValue }) => getValue() || NA },
    { id: 'removed', header: 'Date removed', accessorFn: r => refDate(r) ?? NA },
    { id: 'life', header: 'km life', meta: { align: 'right' }, accessorFn: r => kmLife(r),
      cell: ({ getValue }) => {
        const life = getValue()
        if (life == null) return <span className="text-[var(--text-dim)]">{NA}</span>
        const early = fleetAvgKmLife != null && life < fleetAvgKmLife * 0.5
        return <span className={early ? 'text-red-400 font-semibold' : ''}>{fmt(life)} km{early ? ' (early)' : ''}</span>
      } },
    { id: 'cost', header: 'Cost', meta: { align: 'right' }, accessorFn: r => tyreCost(r),
      cell: ({ getValue }) => <span className="tabular-nums">{fmtCurrency(getValue(), activeCurrency)}</span> },
    { accessorKey: 'removal_reason', header: 'Removal reason', cell: ({ getValue }) => getValue() || NA },
    { id: 'status', header: 'Disposal status', meta: { align: 'center' },
      cell: ({ row }) => {
        const s = statusOf(row.original.id)
        return <Badge label={s} cfg={DISPOSAL_STATUSES[s]} />
      } },
    { id: 'action', header: 'Action', meta: { align: 'center' },
      cell: ({ row }) => {
        const t = row.original
        const status = statusOf(t.id)
        const rowLocked = expandedId === t.id && wfLocked
        if (rowLocked) {
          return <span className="inline-flex items-center gap-1 text-xs text-amber-400"><Lock size={12} aria-hidden="true" /> Locked, in approval</span>
        }
        if (status === 'Unknown') return <span className="text-xs text-[var(--text-dim)]">Unavailable</span>
        const small = 'min-h-[36px] px-2.5 rounded text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
        return status === 'Pending' ? (
          <span className="inline-flex items-center justify-center gap-1.5">
            <button onClick={() => markDisposed(t.id, 'Disposed')} className={`${small} bg-green-900/30 hover:bg-green-900/60 border border-green-700/50 text-green-400`}>Dispose</button>
            <button onClick={() => markDisposed(t.id, 'Retreaded')} className={`${small} bg-blue-900/30 hover:bg-blue-900/60 border border-blue-700/50 text-blue-400`}>Retread</button>
          </span>
        ) : (
          <button onClick={() => markDisposed(t.id, 'Pending')} className={`${small} bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] text-[var(--text-muted)]`}>Reset to pending</button>
        )
      } },
  ], [expandedId, wfLocked, toggleExpanded, markDisposed, statusOf, fleetAvgKmLife, activeCurrency])

  const expandedRecord = useMemo(
    () => (expandedId ? disposalLog.find(t => t.id === expandedId) || null : null),
    [expandedId, disposalLog],
  )

  // ── Exports ───────────────────────────────────────────────────────────────────
  const disposalExportRows = () => disposalLog.map(t => ({
    serial: serialOf(t) ?? NA,
    brand: t.brand ?? NA,
    size: t.size ?? NA,
    position: t.position ?? NA,
    asset_no: t.asset_no ?? NA,
    site: t.site ?? NA,
    removed: refDate(t) ?? NA,
    life: kmLife(t) != null ? fmt(kmLife(t)) : NA,
    cost: fmtCurrency(tyreCost(t), activeCurrency),
    reason: t.removal_reason ?? NA,
    status: statusOf(t.id),
  }))
  const DISPOSAL_KEYS = ['serial', 'brand', 'size', 'position', 'asset_no', 'site', 'removed', 'life', 'cost', 'reason', 'status']
  const DISPOSAL_HEADERS = ['Serial no', 'Brand', 'Size', 'Position', 'Asset', 'Site', 'Date removed', 'km life', 'Cost', 'Removal reason', 'Disposal status']

  async function exportDisposalPdf() {
    const { exportToPdf, reportFileName } = await loadExportUtils()
    await exportToPdf(
      disposalExportRows(),
      DISPOSAL_KEYS.map((key, i) => ({ key, header: DISPOSAL_HEADERS[i] })),
      'Tyre Scrap Disposal Manifest',
      reportFileName('TyrePulse Scrap Disposal Manifest'),
      'landscape',
      company,
    )
  }

  async function exportDisposalExcel() {
    const { exportSheetsToExcel, reportFileName } = await loadExportUtils()
    const logRows = disposalLog.map(t => ({
      serial: serialOf(t) ?? '',
      brand: t.brand ?? '',
      size: t.size ?? '',
      position: t.position ?? '',
      asset_no: t.asset_no ?? '',
      site: t.site ?? '',
      country: t.country ?? '',
      removed: refDate(t) ?? '',
      km_fit: t.km_at_fitment ?? '',
      km_rem: t.km_at_removal ?? '',
      life: kmLife(t) ?? '',
      cost: tyreCost(t) ?? '',
      reason: t.removal_reason ?? '',
      risk: t.risk_level ?? '',
      category: t.category ?? '',
      status: statusOf(t.id),
    }))
    const brandRows = brandAnalysis.map(b => ({
      brand: b.brand,
      total: b.total,
      scrap: b.scrap,
      rate: b.scrapRate != null ? +b.scrapRate.toFixed(1) : '',
      avgKm: b.avgKm != null ? Math.round(b.avgKm) : '',
      cpk: b.avgCPK != null ? +b.avgCPK.toFixed(4) : '',
      early: b.earlyPct != null ? +b.earlyPct.toFixed(1) : '',
      rec: b.rec,
    }))
    const siteRows = siteAnalysis.map(s => ({
      site: s.site, total: s.total, scrap: s.scrap,
      cost: s.cost ?? '', rate: s.scrapRate != null ? +s.scrapRate.toFixed(1) : '',
      worst: s.worstBrand ?? '', trend: s.trend,
    }))
    await exportSheetsToExcel([
      {
        name: 'Scrap Log', rows: logRows,
        columns: ['serial', 'brand', 'size', 'position', 'asset_no', 'site', 'country', 'removed', 'km_fit', 'km_rem', 'life', 'cost', 'reason', 'risk', 'category', 'status'],
        headers: ['Serial no', 'Brand', 'Size', 'Position', 'Asset no', 'Site', 'Country', 'Date removed', 'km at fitment', 'km at removal', 'km life', `Cost (${activeCurrency})`, 'Removal reason', 'Risk level', 'Category', 'Disposal status'],
        note: 'Tyres the heuristic flags as scrap (risk Critical or category Scrap), with the disposal log filters applied.',
      },
      {
        name: 'Brand Analysis', rows: brandRows,
        columns: ['brand', 'total', 'scrap', 'rate', 'avgKm', 'cpk', 'early', 'rec'],
        headers: ['Brand', 'Total tyres', 'Total scrapped', 'Scrap rate %', 'Avg km life', 'Avg CPK', 'Early scrap %', 'Recommendation'],
        note: 'Over the page filters. Blank = not measurable.',
      },
      {
        name: 'Site Analysis', rows: siteRows,
        columns: ['site', 'total', 'scrap', 'cost', 'rate', 'worst', 'trend'],
        headers: ['Site', 'Total tyres', 'Scrapped', `Scrap cost (${activeCurrency})`, 'Scrap rate %', 'Worst brand', 'Trend'],
        note: 'Over the page filters.',
      },
    ], reportFileName('TyrePulse Scrap Management'), {
      title: 'Tyre Scrap Management', company,
      dateRange: DATE_RANGE_OPTS[dateRangeIdx].label,
      notes: [
        'Scrap here is the analysis heuristic, not the Scrapped Register of tyres somebody marked.',
        `Retread figures are estimates: ${Math.round(RETREAD_SHARE * 100)}% of scrap assumed retreadable at ${Math.round(RETREAD_SAVING * 100)}% lower cost.`,
      ],
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const rateTone = kpis.scrapRate == null ? 'text-[var(--text-muted)]'
    : kpis.scrapRate > 25 ? 'text-red-400'
    : kpis.scrapRate > 15 ? 'text-orange-400'
    : kpis.scrapRate > 8 ? 'text-yellow-400'
    : 'text-green-400'

  return (
    <div className="space-y-6">

      <PageHeader
        title="Tyre Scrap Management"
        subtitle="Record and analyse tyre scrap events and root causes"
        icon={Trash2}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={exportDisposalPdf} disabled={analysisFailed} className={BTN_CLS}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button onClick={exportDisposalExcel} disabled={analysisFailed} className={BTN_CLS}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button onClick={refreshAll} disabled={loading} className={BTN_CLS}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
          </div>
        }
      />

      {/* ── Refresh error (data already on screen stays, but it may be stale) ── */}
      {error && loaded && (
        <div role="alert" className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <AlertOctagon className="text-red-400 shrink-0" size={18} aria-hidden="true" />
          <p className="text-red-300 text-sm flex-1">{error} The figures below are from the previous load.</p>
          <button onClick={loadData} className={BTN_CLS}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {/* ── Global filter bar ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2 items-end" role="group" aria-label="Scrap analysis filters">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Period
          <select value={dateRangeIdx} onChange={e => setDateRangeIdx(Number(e.target.value))} className={FIELD_CLS}>
            {DATE_RANGE_OPTS.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Site
          <select value={filterSite} onChange={e => setFilterSite(e.target.value)} className={FIELD_CLS}>
            {siteOptions.map(s => <option key={s} value={s}>{s === 'All' ? 'All sites' : s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Brand
          <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)} className={FIELD_CLS}>
            {brandOptions.map(b => <option key={b} value={b}>{b === 'All' ? 'All brands' : b}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
          Removal reason
          <select value={filterReason} onChange={e => setFilterReason(e.target.value)} className={FIELD_CLS}>
            {REMOVAL_REASONS.map(r => <option key={r} value={r}>{r === 'All' ? 'All reasons' : r}</option>)}
          </select>
        </label>
        {filtersActive && (
          <button onClick={clearFilters} className={BTN_CLS}><X size={14} aria-hidden="true" /> Clear filters</button>
        )}
        <div className="flex items-center gap-2 lg:ml-auto text-xs text-[var(--text-muted)] min-h-[44px]" aria-live="polite">
          <Filter size={12} aria-hidden="true" />
          <span>{scrapped.length} flagged as scrap of {filtered.length} tyres</span>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-dim)] flex items-start gap-1.5">
        <Info size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          The figures and the Overview, By Brand, By Site and Disposal Log tabs are a scrap-rate analysis: a tyre counts
          when it is rated Critical or categorised Scrap. The Scrapped Register tab lists the tyres somebody actually marked as scrap.
        </span>
      </p>

      {/* ── Capped view note ── */}
      {truncated && (
        <div className="flex items-center gap-2 text-xs text-amber-400">
          <Info size={12} className="shrink-0" aria-hidden="true" />
          <span>Capped view: showing the first 50,000 tyre records. Narrow the date range or filters for the full set.</span>
        </div>
      )}

      {/* ── KPI Cards ── */}
      {loading && !loaded ? (
        <SkeletonTable rows={2} cols={5} />
      ) : !analysisFailed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <KpiCard
            icon={Trash2}
            label="Flagged as scrap"
            value={fmt(kpis.scrapCount)}
            sub={DATE_RANGE_OPTS[dateRangeIdx].label}
            color="text-red-400"
            warn={kpis.scrapCount > 0}
          />
          <KpiCard
            icon={DollarSign}
            label="Scrap cost"
            value={fmtCurrency(kpis.totalCost, activeCurrency)}
            sub={kpis.scrapCount ? `Priced on ${kpis.costedCount} of ${kpis.scrapCount} tyres` : 'No scrap in the window'}
            color="text-orange-400"
          />
          <KpiCard
            icon={Activity}
            label="Avg km life at scrap"
            value={kpis.avgKmLife != null ? `${fmt(kpis.avgKmLife)} km` : NA}
            sub={fleetAvgKmLife != null ? `Fleet avg: ${fmt(fleetAvgKmLife)} km` : 'Fleet avg: N/A'}
            color={
              fleetAvgKmLife == null || kpis.avgKmLife == null ? 'text-[var(--text-muted)]'
                : kpis.avgKmLife < fleetAvgKmLife * 0.6 ? 'text-red-400'
                : kpis.avgKmLife < fleetAvgKmLife * 0.8 ? 'text-yellow-400'
                : 'text-green-400'
            }
          />
          <KpiCard
            icon={BarChart3}
            label="Scrap rate"
            value={fmtPct(kpis.scrapRate)}
            sub={`${kpis.scrapCount} of ${filtered.length} tyres`}
            color={rateTone}
            badge={
              kpis.scrapRate == null ? null
                : kpis.scrapRate > 25
                ? { label: 'Critical, investigate', cls: 'text-red-400 bg-red-900/30 border-red-700' }
                : kpis.scrapRate > 15
                ? { label: 'Elevated, monitor', cls: 'text-orange-400 bg-orange-900/30 border-orange-700' }
                : null
            }
          />
          <KpiCard
            icon={Recycle}
            label="Potential retread savings"
            value={fmtCurrency(kpis.retreadSavings, activeCurrency)}
            sub={`Estimate: about ${kpis.retreadCandidates} units retreadable`}
            color="text-blue-400"
          />
        </div>
      )}

      {/* ── Tabs ── */}
      <div role="tablist" aria-label="Scrap management views" className="flex gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={activeTab === t}
            onClick={() => setActiveTab(t)}
            className={`min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              activeTab === t
                ? 'bg-[var(--input-bg-hover)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          Tab: Scrapped Register - the tyres someone actually marked scrap.
          Independent of the heuristic read, so it works even if that failed.
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'Scrapped Register' && (
        <ScrappedRegister country={activeCountry} currency={activeCurrency} />
      )}

      {activeTab !== 'Scrapped Register' && loading && !loaded && <SkeletonTable rows={8} cols={6} />}
      {activeTab !== 'Scrapped Register' && analysisFailed && <LoadFailed message={error} onRetry={loadData} />}

      {activeTab !== 'Scrapped Register' && loaded && (
        <>
          {/* ══ Tab: Overview ══ */}
          {activeTab === 'Overview' && (
            <div className="space-y-5">

              {retreatOpportunity.count > 0 && (
                <div className="bg-blue-900/30 border border-blue-700 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Recycle className="text-blue-400 shrink-0" size={20} aria-hidden="true" />
                    <div>
                      <p className="font-bold text-blue-300 text-sm">
                        {retreatOpportunity.count} tyre{retreatOpportunity.count !== 1 ? 's' : ''} this month may qualify for retreading
                      </p>
                      <p className="text-blue-400/80 text-xs">
                        Estimated savings: {fmtCurrency(retreatOpportunity.savings, activeCurrency)}, assuming retreading costs {Math.round(RETREAD_SAVING * 100)}% less than a new tyre
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="text-blue-400 shrink-0" size={18} aria-hidden="true" />
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 min-w-0">
                  <h3 className="text-xs text-[var(--text-muted)] font-medium mb-3 flex items-center gap-2">
                    <TrendingDown className="text-red-400" size={13} aria-hidden="true" /> Monthly scrap trend, last 12 months
                  </h3>
                  {/* The trend follows the site, brand and reason filters; it
                      deliberately ignores the period filter, which would only
                      truncate the twelve months it exists to show. */}
                  {trendScrapped.length !== allScrapped.length && (
                    <p className="text-[11px] text-[var(--text-dim)] -mt-2 mb-2">
                      Covers the {trendScrapped.length} scrapped {trendScrapped.length === 1 ? 'tyre' : 'tyres'} matching
                      your site, brand and reason filters, of {allScrapped.length} in total. The period filter is not applied.
                    </p>
                  )}
                  <div className="h-52" role="img" aria-label={`Monthly scrap count and cost over 12 months, ${monthlyTrend.reduce((s, m) => s + m.count, 0)} tyres in total`}>
                    {monthlyTrend.some(m => m.count > 0)
                      ? <Line data={trendChartData} options={trendChartOpts} />
                      : <EmptyChart />}
                  </div>
                </div>

                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 min-w-0">
                  <h3 className="text-xs text-[var(--text-muted)] font-medium mb-3">Scrap by removal reason</h3>
                  <div className="h-52" role="img" aria-label={`Scrap by removal reason: ${reasons.slice(0, 3).map(r => `${r.label} ${r.count}`).join(', ') || 'no data'}`}>
                    {reasons.length > 0 ? <Doughnut data={reasonDonut} options={CHART_OPTS_NO_SCALES} /> : <EmptyChart />}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 min-w-0">
                  <h3 className="text-xs text-[var(--text-muted)] font-medium mb-3">Scrap by tyre position</h3>
                  <div className="h-52" role="img" aria-label={`Scrap by position: ${positions.slice(0, 3).map(r => `${r.label} ${r.count}`).join(', ') || 'no data'}`}>
                    {positions.length > 0 ? <Doughnut data={positionDonut} options={CHART_OPTS_NO_SCALES} /> : <EmptyChart />}
                  </div>
                </div>

                <div className="lg:col-span-2 min-w-0">
                  <Panel
                    icon={AlertTriangle}
                    iconCls="text-yellow-400"
                    title={`Early scrap analysis${earlyScrap.length ? ` (${earlyScrap.length} tyres)` : ''}`}
                    note="Scrapped below 50% of the fleet average km life"
                  >
                    {fleetAvgKmLife == null ? (
                      <p className="text-sm text-[var(--text-muted)] py-6 text-center">
                        Not measurable: no tyre has both a fitment and a removal odometer reading, so there is no fleet average to compare against.
                      </p>
                    ) : earlyScrap.length === 0 ? (
                      <div className="flex items-center justify-center py-8 text-[var(--text-muted)] text-sm flex-col gap-2">
                        <CheckCircle size={28} className="text-green-600" aria-hidden="true" />
                        No early scrap detected in current filter window
                      </div>
                    ) : (
                      <EnterpriseTable
                        columns={earlyColumns}
                        data={earlyScrap}
                        getRowId={(r) => String(r.id)}
                        enableColumnFilters={false}
                        enableExport={false}
                        enableColumnVisibility={false}
                        initialPageSize={8}
                        pageSizeOptions={[8, 25, 50]}
                        searchPlaceholder="Search early scrap"
                        emptyMessage="No early scrap matches"
                      />
                    )}
                  </Panel>
                </div>
              </div>

              {scrapped.length === 0 && (
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl">
                  <EmptyState
                    illustration="module/tyres"
                    icon={CheckCircle}
                    title="No tyres flagged as scrap"
                    description="No tyre in this window is rated Critical or categorised Scrap. Try a wider period or clear the filters."
                    action={filtersActive ? { label: 'Clear filters', onClick: clearFilters } : null}
                  />
                </div>
              )}
            </div>
          )}

          {/* ══ Tab: By Brand ══ */}
          {activeTab === 'By Brand' && (
            <div className="space-y-5">

              {brandAnalysis.filter(b => b.scrap > 0).length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {brandAnalysis.filter(b => b.scrap > 0).slice(0, 3).map((b, i) => {
                    const tone = i === 0 ? { t: 'text-red-400', bd: 'border-red-700/70', bar: 'bg-red-500' }
                      : i === 1 ? { t: 'text-orange-400', bd: 'border-orange-700/60', bar: 'bg-orange-500' }
                      : { t: 'text-yellow-400', bd: 'border-yellow-700/50', bar: 'bg-yellow-500' }
                    return (
                      <div key={b.brand} className={`bg-[var(--surface-1)] border rounded-xl p-4 ${tone.bd}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-xs font-bold ${tone.t}`}>#{i + 1} highest scrap rate</span>
                          <Flame size={14} className={tone.t} aria-hidden="true" />
                        </div>
                        <p className="font-bold text-[var(--text-secondary)] text-lg">{b.brand}</p>
                        <p className={`text-3xl font-extrabold mt-0.5 tabular-nums ${tone.t}`}>{fmtPct(b.scrapRate)}</p>
                        <p className="text-[var(--text-muted)] text-xs mt-0.5">scrap rate, {b.scrap} of {b.total}</p>
                        <div className="mt-2 h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden" aria-hidden="true">
                          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(b.scrapRate ?? 0, 100)}%` }} />
                        </div>
                        <p className="text-[var(--text-muted)] text-xs mt-2">
                          Avg km life: <span className="text-[var(--text-secondary)] font-semibold">{b.avgKm != null ? `${fmt(b.avgKm)} km` : NA}</span>
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <h3 className="text-xs text-[var(--text-muted)] font-medium mb-3">Scrap rate by brand (top 10)</h3>
                <div className="h-56" role="img" aria-label="Scrap rate by brand. Red is above 20 percent, orange above 10 percent, green otherwise; the table below states each band in words.">
                  {brandChartData.labels.length > 0
                    ? <Bar data={brandChartData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
                    : <EmptyChart />}
                </div>
              </div>

              <Panel icon={Tag} title="Brand scrap performance" note={`${brandAnalysis.length} brands. Early scrap = removed below 50% of fleet average km life.`} pad={false}>
                {brandAnalysis.length === 0 ? (
                  <EmptyState icon={Tag} title="No brand data" description="No tyres match the current filters." compact />
                ) : (
                  <div className="p-2">
                    <PagedTable columns={brandColumns} pager={brandPager} getRowId={(r) => r.brand} emptyMessage="No brand data" />
                  </div>
                )}
              </Panel>
            </div>
          )}

          {/* ══ Tab: By Site ══ */}
          {activeTab === 'By Site' && (
            <div className="space-y-5">

              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <h3 className="text-xs text-[var(--text-muted)] font-medium mb-3 flex items-center gap-2">
                  <Building2 size={13} className="text-blue-400" aria-hidden="true" /> Scrap count by site, last 6 months
                </h3>
                <div className="h-56" role="img" aria-label={`Monthly scrap count for the top ${siteSeries.series.length} sites`}>
                  {siteSeries.series.length > 0 ? <Bar data={siteBarData} options={CHART_OPTS} /> : <EmptyChart />}
                </div>
              </div>

              <Panel icon={Building2} title="Site scrap analysis" pad={false}>
                {siteAnalysis.length === 0 ? (
                  <EmptyState icon={Building2} title="No site data" description="No tyres match the current filters." compact />
                ) : (
                  <div className="p-2">
                    <PagedTable columns={siteColumns} pager={sitePager} getRowId={(r) => r.site} emptyMessage="No site data" />
                  </div>
                )}
              </Panel>

              {heatMap.brands.length > 0 && heatMap.sites.length > 0 && (
                <Panel icon={Layers} iconCls="text-purple-400" title="Brand by site scrap heat map" note="Count of tyres flagged as scrap, top 6 brands and sites">
                  <EnterpriseTable
                    columns={heatColumns}
                    data={heatMap.rows}
                    getRowId={(r) => r.brand}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableExport={false}
                    enableColumnVisibility={false}
                    pageSizeOptions={[10]}
                    initialPageSize={10}
                    emptyMessage="No overlap between top brands and sites"
                  />
                  <p className="text-[var(--text-dim)] text-xs mt-2 flex flex-wrap items-center gap-2">
                    Scale:
                    {['low', 'medium', 'high'].map(l => (
                      <span key={l} className={`px-2 py-0.5 rounded ${HEAT_META[l].cls}`}>{HEAT_META[l].label}</span>
                    ))}
                    <span>relative to the busiest cell ({heatMap.maxVal})</span>
                  </p>
                </Panel>
              )}
            </div>
          )}

          {/* ══ Tab: Disposal Log ══ */}
          {activeTab === 'Disposal Log' && (
            <div className="space-y-4">

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2 items-end" role="group" aria-label="Disposal log filters">
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)] lg:flex-1 lg:min-w-[220px]">
                  Search
                  <span className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} aria-hidden="true" />
                    <input
                      value={logSearch}
                      onChange={e => setLogSearch(e.target.value)}
                      placeholder="Serial, brand, asset or site"
                      className={`${FIELD_CLS} w-full pl-8`}
                    />
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  Brand
                  <select value={logBrand} onChange={e => setLogBrand(e.target.value)} className={FIELD_CLS}>
                    {brandOptions.map(b => <option key={b} value={b}>{b === 'All' ? 'All brands' : b}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  Site
                  <select value={logSite} onChange={e => setLogSite(e.target.value)} className={FIELD_CLS}>
                    {siteOptions.map(s => <option key={s} value={s}>{s === 'All' ? 'All sites' : s}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  From
                  <input type="date" value={logDateFrom} onChange={e => setLogDateFrom(e.target.value)} className={FIELD_CLS} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  To
                  <input type="date" value={logDateTo} onChange={e => setLogDateTo(e.target.value)} className={FIELD_CLS} />
                </label>
                <div className="flex gap-2 lg:ml-auto">
                  <button onClick={exportDisposalExcel} className={BTN_CLS}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                  <button onClick={exportDisposalPdf} className={BTN_CLS}><FileText size={14} aria-hidden="true" /> Manifest PDF</button>
                </div>
              </div>

              {disposalLoadError && (
                <div role="alert" className="text-sm text-amber-300 bg-amber-900/20 border border-amber-700/60 rounded-lg p-2.5 flex items-center gap-3 flex-wrap">
                  <span className="flex-1">{disposalLoadError} Statuses show as Unknown and cannot be changed until they load.</span>
                  <button onClick={loadDisposals} className={BTN_CLS}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
                </div>
              )}
              {disposalError && (
                <p role="alert" className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5">{disposalError}</p>
              )}

              <Panel
                icon={Trash2}
                iconCls="text-red-400"
                title={`Disposal log (${disposalLog.length} records)`}
                note={disposalLoadError ? 'Statuses unavailable' : `${disposalCounts.Disposed} disposed, ${disposalCounts.Retreaded} retreaded, ${disposalCounts.Pending} pending`}
                pad={false}
              >
                <div className="p-2">
                  <PagedTable
                    columns={disposalColumns}
                    pager={disposalPager}
                    emptyMessage="No disposal records match the current filters. Adjust the search or date range."
                  />
                </div>
              </Panel>

              {expandedRecord && (
                <section className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 space-y-2" aria-label="Scrap approval">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-[var(--text-secondary)]">
                      Scrap approval for <span className="font-mono">{serialOf(expandedRecord) || expandedRecord.asset_no || expandedRecord.id}</span>
                    </p>
                    <button onClick={() => toggleExpanded(expandedRecord.id)} className={BTN_CLS}>
                      <X size={14} aria-hidden="true" /> Close approval
                    </button>
                  </div>
                  <EntityApprovalPanel
                    entityType="tyre_scrap"
                    entityId={expandedRecord.id}
                    entityLabel={serialOf(expandedRecord) || expandedRecord.asset_no || expandedRecord.id}
                    context={{
                      scrap_cost: tyreCost(expandedRecord),
                      reason: expandedRecord.removal_reason ?? null,
                      brand: expandedRecord.brand ?? null,
                      quantity: Number(expandedRecord.qty) || 1,
                      site: expandedRecord.site ?? null,
                      position: expandedRecord.position ?? null,
                      risk_level: expandedRecord.risk_level ?? null,
                    }}
                    onStateChange={({ isActive, isLocked }) => {
                      const locked = !!(isActive || isLocked)
                      setWfLocked((prev) => (prev === locked ? prev : locked))
                    }}
                    title="Scrap Approval"
                  />
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
