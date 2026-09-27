import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  AlertTriangle, Clock, DollarSign, Activity,
  RefreshCw, Loader2, FileSpreadsheet, FileText,
  Search, X, Zap, CheckCircle2, XCircle, AlertCircle, BarChart2, Gauge,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  DEFAULT_DOWNTIME_RATE, SHIFT_HOURS, TARGET_AVAILABILITY, RISK_LEVELS, PERIOD_PRESETS, CAUSES,
  presetStart, actualHoursByAsset, filterEvents, filterWorkOrders, downtimeKpis, availabilityTrend,
  siteBreakdown, causeBreakdown, monthlyCost, vehicleRows, heatmap, recommendations,
  eventExportRows, EVENT_EXPORT_KEYS, EVENT_EXPORT_HEADERS,
} from '../lib/downtimeTrackerAnalytics'
import StatCard from '../components/StatCard'
import PageHeader from '../components/ui/PageHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import { exportToExcel, reportFileName, resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../lib/exportUtils'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import { toUserMessage } from '../lib/safeError'
import { loadAutoTable } from '../lib/pdfEngine'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Presentation constants (maths lives in downtimeTrackerAnalytics) ─────────
const BUDGET_THRESHOLD = 50000 // monthly budget reference shown under the cost chart

// Ceiling on the work-order fetch. KSA alone holds 60,099, and paging every one
// into the browser to average them is the wrong shape for this page - the right
// fix is a server-side aggregate, which is a larger change than this. So the
// ceiling is generous, the period filter runs server-side so only the all-time
// view can approach it, and hitting it is SAID rather than hidden.
const WORK_ORDER_CEILING = 20000

const CAUSE_KEY_MAP = {
  'Critical Failure': 'criticalFailure',
  'Wear-Related': 'wearRelated',
  'Pressure Issue': 'pressureIssue',
  'Routine Replacement': 'routineReplacement',
  'Unknown': 'unknown',
}
// Semantic: the cause colour carries meaning (critical red ... routine green).
const CAUSE_COLORS = {
  'Critical Failure': '#ef4444',
  'Wear-Related': '#f97316',
  'Pressure Issue': '#eab308',
  'Routine Replacement': '#22c55e',
  'Unknown': '#6b7280',
}

// Theme tokens (resolved per theme by chartVarPlugin) so charts read in light mode.
const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', font: { size: 11 }, boxWidth: 12 } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      titleColor: 'var(--text-primary)',
      bodyColor: 'var(--text-secondary)',
      borderColor: 'var(--input-border)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 11 } } },
    y: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 11 } } },
  },
}

const INPUT = 'min-h-[44px] px-3 bg-[var(--surface-2)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-green-600'

function fmtCurrency(val, sym) {
  if (val == null || !Number.isFinite(val)) return 'N/A'
  if (val >= 1_000_000) return `${sym} ${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `${sym} ${(val / 1_000).toFixed(1)}K`
  return `${sym} ${Math.round(val).toLocaleString()}`
}

function fmtHours(h) {
  if (h == null || !Number.isFinite(h)) return 'N/A'
  if (h >= 1000) return `${(h / 1000).toFixed(1)}K h`
  return `${h.toFixed(1)} h`
}

function monthLabel(ym) {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' })
}

function heatColor(hours) {
  if (!hours) return 'bg-[var(--surface-2)] text-[var(--text-muted)]'
  if (hours <= 4) return 'bg-yellow-500/30 text-[var(--text-primary)]'
  if (hours <= 8) return 'bg-orange-500/40 text-[var(--text-primary)]'
  return 'bg-red-500/40 text-[var(--text-primary)]'
}

function ChartCard({ title, children, summary }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4">{title}</h3>
      <div role="img" aria-label={summary || title}>{children}</div>
    </div>
  )
}

function SeverityBadge({ level, t }) {
  const map = { critical: 'bg-red-500/20 text-red-400', high: 'bg-orange-500/20 text-orange-400', medium: 'bg-yellow-500/20 text-yellow-500', low: 'bg-green-500/20 text-green-500' }
  return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${map[level] || map.low}`}>{t(`downtime.severity.${level}`)}</span>
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DowntimeTracker() {
  const { activeCurrency, activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const { t } = useLanguage()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  // Cost/hour assumption - overridable via the `downtime_rate` setting key.
  const downtimeRate = useMemo(() => {
    const v = Number(appSettings?.downtime_rate)
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_DOWNTIME_RATE
  }, [appSettings])
  const rateIsCustom = downtimeRate !== DEFAULT_DOWNTIME_RATE

  const [tyreRecords, setTyreRecords] = useState([])
  const [tyreTruncated, setTyreTruncated] = useState(false)
  const [workOrders, setWorkOrders] = useState([])
  const [woError, setWoError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [exportError, setExportError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  // Filters
  const [period, setPeriod] = useState('All')
  const [woTruncated, setWoTruncated] = useState(false)
  const [siteFilter, setSiteFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [riskFilter, setRiskFilter] = useState('')
  const [causeFilter, setCauseFilter] = useState('')
  const [assetSearch, setAssetSearch] = useState('')

  const sym = activeCurrency

  // Guards against a slow earlier response overwriting a newer one after the
  // active country changes (fetch-race cancellation).
  const reqIdRef = useRef(0)

  // Period cutoff, used for BOTH the server-side work-order window and the
  // client-side event filter.
  const cutoff = useMemo(() => presetStart(period, now), [period, now])

  const load = useCallback(async (isRefresh = false) => {
    const myReq = ++reqIdRef.current
    // Server-side work-order window, from the clock at load time (the page's
    // `now` is set FROM this load, so depending on it would loop).
    const woCutoff = presetStart(period, Date.now())
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      // BOUNDED tyre pull: country-scoped, newest-first, capped at 50,000 rows so
      // it can never page a millions-row table into the browser. A server date
      // window is deliberately NOT applied here (unlike the work-order pull below):
      // the availability trend and its distinct-vehicle denominator read the full
      // country set, and the period toggle is applied client-side in `filtered`, so
      // narrowing the fetch by date would change a displayed availability figure.
      // Under the cap the result is identical to before.
      const { data: tyreData, error: tyreErr, truncated: tyreTrunc } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,asset_no,serial_number:serial_no,risk_level,issue_date,km_at_fitment,km_at_removal,cost_per_tyre,site,country,brand,position,reason_for_removal')
          .order('issue_date', { ascending: false })
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      }, { max: 50000 })
      if (myReq !== reqIdRef.current) return
      if (tyreErr) throw tyreErr
      setTyreRecords(tyreData || [])
      setTyreTruncated(!!tyreTrunc)

      // Try work_orders (may be empty). opened_at/completed_at give ACTUAL
      // downtime duration; created_at retained for period filtering.
      //
      // PAGED AND SCOPED, exactly like the tyre query above. This one was neither,
      // which is how a page about downtime came to compute its KPIs from 1,000 of
      // 86,539 work orders - 1.2% - and blend every country into one figure.
      //
      // The period cutoff is applied SERVER-SIDE now instead of only in the
      // client filter below. It was always being applied; doing it here as well
      // means a 30-day view fetches thirty days of rows rather than fetching the
      // newest thousand of all time and then discarding most of them.
      const { data: woData, error: woErr, truncated: woTruncated } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('work_orders')
          .select('id,asset_no,work_type,created_at,opened_at,completed_at,status,priority,total_cost,site')
          .order('created_at', { ascending: false })
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        if (woCutoff) q = q.gte('created_at', woCutoff)
        return q.range(from, to)
      }, { max: WORK_ORDER_CEILING })
      if (myReq !== reqIdRef.current) return
      if (woErr) {
        // Say so: a failed work-order read otherwise reads as "no actual
        // hours exist" and every figure silently falls back to estimates.
        setWorkOrders([])
        setWoError(toUserMessage(woErr, 'Work orders could not be read, so every downtime figure below is an estimate.'))
      } else {
        setWoError('')
        setWorkOrders(woData || [])
        // A ceiling that is hit SILENTLY is the bug this whole change is about.
        setWoTruncated(!!woTruncated)
      }
      setNow(Date.now())
    } catch (e) {
      if (myReq === reqIdRef.current) setError(toUserMessage(e, 'Failed to load data'))
    } finally {
      if (myReq === reqIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [activeCountry, period])

  useEffect(() => { load() }, [load])

  // ── Derived (all maths in downtimeTrackerAnalytics) ─────────────────────────
  const filtered = useMemo(
    () => filterEvents(tyreRecords, { cutoff, site: siteFilter, country: countryFilter, risk: riskFilter, cause: causeFilter, search: assetSearch }),
    [tyreRecords, cutoff, siteFilter, countryFilter, riskFilter, causeFilter, assetSearch],
  )
  const filteredWO = useMemo(() => filterWorkOrders(workOrders, { cutoff, site: siteFilter }), [workOrders, cutoff, siteFilter])
  const actualByAsset = useMemo(() => actualHoursByAsset(filteredWO), [filteredWO])
  const usingActual = actualByAsset.size > 0
  const sites = useMemo(() => [...new Set(tyreRecords.map((r) => r.site).filter(Boolean))].sort(), [tyreRecords])
  const countries = useMemo(() => [...new Set(tyreRecords.map((r) => r.country).filter(Boolean))].sort(), [tyreRecords])

  const kpis = useMemo(() => downtimeKpis(filtered, { cutoff, now, actualByAsset, rate: downtimeRate }), [filtered, cutoff, now, actualByAsset, downtimeRate])
  const trend = useMemo(() => availabilityTrend(tyreRecords, { now, actualByAsset }), [tyreRecords, now, actualByAsset])
  const sitesBd = useMemo(() => siteBreakdown(filtered, { actualByAsset }), [filtered, actualByAsset])
  const causes = useMemo(() => causeBreakdown(filtered), [filtered])
  const costRows = useMemo(() => monthlyCost(filtered, { now, actualByAsset, rate: downtimeRate }), [filtered, now, actualByAsset, downtimeRate])
  const vehicles = useMemo(() => vehicleRows(filtered, { cutoff, now, actualByAsset, rate: downtimeRate }), [filtered, cutoff, now, actualByAsset, downtimeRate])
  const heat = useMemo(() => heatmap(filtered, { now, actualByAsset }), [filtered, now, actualByAsset])
  const recs = useMemo(() => recommendations(filtered, vehicles, kpis), [filtered, vehicles, kpis])

  const recText = (r) => {
    const base = `downtime.recommendations.${r.key}`
    const params = r.key === 'site' ? { ...r.params, pct: r.params.pct == null ? t('downtime.na') : r.params.pct } : r.params
    return { message: t(`${base}Message`, params), action: t(`${base}Action`) }
  }

  const hasFilters = !!(siteFilter || countryFilter || riskFilter || causeFilter || assetSearch || period !== 'All')
  const clearFilters = () => { setSiteFilter(''); setCountryFilter(''); setRiskFilter(''); setCauseFilter(''); setAssetSearch(''); setPeriod('All') }

  // ── Charts ──────────────────────────────────────────────────────────────────
  const trendHasData = trend.values.some((v) => v != null)
  const availabilityTrendData = {
    labels: trend.months.map(monthLabel),
    datasets: [
      {
        label: t('downtime.charts.availabilitySeries'),
        data: trend.values,
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.08)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: trend.values.map((v) => (v != null && v >= TARGET_AVAILABILITY ? '#22c55e' : '#ef4444')),
        pointStyle: trend.values.map((v) => (v != null && v >= TARGET_AVAILABILITY ? 'circle' : 'triangle')),
        pointRadius: 4,
        spanGaps: false,
      },
      {
        label: t('downtime.charts.targetSeries', { pct: TARGET_AVAILABILITY }),
        data: trend.months.map(() => TARGET_AVAILABILITY),
        borderColor: '#6366f1',
        borderDash: [6, 3],
        pointRadius: 0,
        borderWidth: 1.5,
        fill: false,
      },
    ],
  }
  const trendMin = Math.min(...trend.values.filter((v) => v != null), TARGET_AVAILABILITY)
  const availOpts = {
    ...CHART_BASE,
    scales: {
      ...CHART_BASE.scales,
      y: { ...CHART_BASE.scales.y, min: Math.max(0, Math.floor(trendMin) - 5), max: 100, ticks: { ...CHART_BASE.scales.y.ticks, callback: (v) => `${v}%` } },
    },
  }

  const siteData = {
    labels: sitesBd.map((e) => e.site),
    datasets: [
      { label: t('downtime.charts.unplannedHours'), data: sitesBd.map((e) => +e.unplanned.toFixed(1)), backgroundColor: '#ef4444', borderRadius: 4 },
      { label: t('downtime.charts.plannedHours'), data: sitesBd.map((e) => +e.planned.toFixed(1)), backgroundColor: '#3b82f6', borderRadius: 4 },
    ],
  }
  const siteBarOpts = {
    ...CHART_BASE,
    indexAxis: 'y',
    scales: {
      x: { stacked: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 11 } } },
      y: { stacked: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 }, maxTicksLimit: 14 } },
    },
  }

  const causeData = {
    labels: causes.map((c) => t(`downtime.causes.${CAUSE_KEY_MAP[c.cause] ?? 'unknown'}`)),
    datasets: [{
      data: causes.map((c) => c.count),
      backgroundColor: causes.map((c) => CAUSE_COLORS[c.cause] || '#6b7280'),
      borderColor: 'var(--panel)',
      borderWidth: 2,
    }],
  }
  const doughnutOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: 'var(--text-muted)', font: { size: 11 }, boxWidth: 12 } },
      tooltip: CHART_BASE.plugins.tooltip,
    },
  }

  const monthlyCostData = {
    labels: costRows.map((r) => monthLabel(r.month)),
    datasets: [
      { label: t('downtime.charts.unplannedCost'), data: costRows.map((r) => r.unplanned), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4, stack: 'costs', yAxisID: 'y' },
      { label: t('downtime.charts.plannedCost'), data: costRows.map((r) => r.planned), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4, stack: 'costs', yAxisID: 'y' },
      { label: t('downtime.charts.cumulative'), data: costRows.map((r) => r.cumulative), type: 'line', borderColor: '#22c55e', borderWidth: 2, pointRadius: 3, fill: false, tension: 0.3, yAxisID: 'y2' },
    ],
  }
  const costBarOpts = {
    ...CHART_BASE,
    scales: {
      x: { stacked: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 11 } } },
      y: { stacked: true, grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 11 }, callback: (v) => fmtCurrency(v, sym) } },
      y2: { position: 'right', grid: { display: false }, ticks: { color: 'var(--text-muted)', font: { size: 11 }, callback: (v) => fmtCurrency(v, sym) } },
    },
  }

  // ── Vehicles table ──────────────────────────────────────────────────────────
  const vehicleColumns = [
    {
      id: 'asset', header: t('downtime.table.columns.asset'), accessorFn: (v) => v.asset, size: 150,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2 flex-wrap">
          <span className={`font-semibold ${row.original.isHigh ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>{row.original.asset}</span>
          {row.original.isHigh && <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold">{t('downtime.table.highRisk')}</span>}
        </span>
      ),
    },
    { id: 'site', header: t('downtime.table.columns.site'), accessorFn: (v) => v.site, size: 120 },
    { id: 'events', header: t('downtime.table.columns.events'), accessorFn: (v) => v.eventCount, size: 90, meta: { align: 'right' }, cell: ({ row }) => <span className={`font-bold tabular-nums ${row.original.eventCount >= 5 ? 'text-red-400' : row.original.eventCount >= 3 ? 'text-orange-400' : 'text-[var(--text-secondary)]'}`}>{row.original.eventCount}</span> },
    { id: 'hours', header: t('downtime.table.columns.totalHours'), accessorFn: (v) => v.totalHours, size: 110, meta: { align: 'right', exportValue: (v) => +v.totalHours.toFixed(1) }, cell: ({ row }) => <span className="tabular-nums">{row.original.totalHours.toFixed(1)} h</span> },
    { id: 'cost', header: t('downtime.table.columns.totalCost'), accessorFn: (v) => v.totalCost, size: 120, meta: { align: 'right', exportValue: (v) => Math.round(v.totalCost) }, cell: ({ row }) => <span className="tabular-nums">{fmtCurrency(row.original.totalCost, sym)}</span> },
    { id: 'between', header: t('downtime.table.columns.avgBetweenEvents'), accessorFn: (v) => (v.avgBetween == null ? -1 : v.avgBetween), size: 140, meta: { align: 'right', exportValue: (v) => (v.avgBetween == null ? 'N/A' : Math.round(v.avgBetween)) }, cell: ({ row }) => (row.original.avgBetween == null ? 'N/A' : `${row.original.avgBetween.toFixed(0)} days`) },
    {
      id: 'risk', header: t('downtime.table.columns.riskScore'), accessorFn: (v) => v.riskScore, size: 110, meta: { align: 'right' },
      cell: ({ row }) => {
        const s = row.original.riskScore
        return <span className={`font-bold tabular-nums ${s >= 3 ? 'text-red-400' : s >= 1.5 ? 'text-orange-400' : s >= 0.5 ? 'text-yellow-500' : 'text-green-500'}`}>{s.toFixed(2)}</span>
      },
    },
    { id: 'basis', header: 'Hours basis', accessorFn: (v) => v.basis, size: 110 },
  ]

  // ── Exports (full filtered set) ─────────────────────────────────────────────
  async function handleExportPdf() {
    setExportError('')
    try {
      const { default: jsPDF } = await import('jspdf')
      const autoTable = await loadAutoTable()
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(branding)
      const periodText = period === 'All' ? 'All time' : period
      pdfHeader(doc, 'Fleet Downtime and Availability Report', `Period: ${periodText}. ${usingActual ? 'Actual and estimated' : 'Estimated'} data`, company, brand)

      if (vehicles.length === 0) {
        pdfEmptyState(doc, 'No vehicle downtime data for the selected period')
        pdfFooter(doc, 1, 1, company, brand)
        doc.save(`${reportFileName('Downtime Report')}.pdf`)
        return
      }

      // Dark ink on the white page (the old light-grey ink was unreadable on paper).
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(21, 128, 61)
      doc.text('KEY PERFORMANCE INDICATORS', 14, 30)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(40, 40, 40)
      doc.setFontSize(9)
      const kpiText = [
        `Fleet Availability: ${kpis.availability != null ? kpis.availability.toFixed(2) + '%' : 'N/A'}`,
        `Downtime Events: ${kpis.totalEvents.toLocaleString()} (${kpis.uniqueVehicles} vehicles)`,
        `Downtime Hours: ${kpis.totalHours.toFixed(1)} h`,
        `Downtime Cost: ${sym} ${Math.round(kpis.totalCost).toLocaleString()}`,
        `Mean time between events: ${kpis.mtbeHours != null ? Math.round(kpis.mtbeHours) + ' h' : 'N/A'}`,
        `Unplanned share: ${kpis.unplannedPct != null ? kpis.unplannedPct + '%' : 'N/A'}`,
      ]
      kpiText.forEach((line, i) => doc.text(line, 14 + (i % 3) * 90, 37 + Math.floor(i / 3) * 7))
      doc.setTextColor(90, 90, 90)
      doc.setFontSize(7.5)
      doc.text(
        `Basis: downtime hours are ${usingActual ? 'actual (work order open to complete) where available, otherwise ' : ''}estimated per severity (Critical 4h, High 3h, Medium and Low 2h). Cost at ${sym} ${downtimeRate}/hr${rateIsCustom ? ' (configured)' : ' (default assumption)'}.`,
        14, 37 + Math.ceil(kpiText.length / 3) * 7 + 2, { maxWidth: 269 },
      )

      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 60,
        head: [['Asset', 'Site', 'Events', 'Total Hours', 'Total Cost', 'Avg Between Events', 'Risk Score', 'Basis']],
        body: vehicles.map((v) => [
          v.asset, v.site, v.eventCount, v.totalHours.toFixed(1),
          `${sym} ${Math.round(v.totalCost).toLocaleString()}`,
          v.avgBetween != null ? `${v.avgBetween.toFixed(0)} days` : 'N/A',
          v.riskScore, v.basis,
        ]),
      })

      let y = (doc.lastAutoTable?.finalY || 100) + 10
      if (y > 180) { doc.addPage(); y = 25 }
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(21, 128, 61)
      doc.text('RECOMMENDATIONS', 14, y)
      doc.setFontSize(9)
      recs.forEach((r, i) => {
        const ry = y + 8 + i * 12
        if (ry > 190) return
        const txt = recText(r)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(40, 40, 40)
        doc.text(`${i + 1}. ${txt.message}`, 14, ry, { maxWidth: 269 })
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(90, 90, 90)
        doc.text(`   Action: ${txt.action}`, 14, ry + 5, { maxWidth: 269 })
      })

      const totalPages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
      doc.save(`${reportFileName('Downtime Report')}.pdf`)
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  async function handleExportExcel() {
    setExportError('')
    try {
      const rows = eventExportRows(filtered, { actualByAsset, rate: downtimeRate })
      await exportToExcel(
        rows, EVENT_EXPORT_KEYS,
        EVENT_EXPORT_HEADERS.map((h) => (h === 'Downtime Cost' ? `Downtime Cost (${sym})` : h)),
        reportFileName('Downtime Events'), 'Downtime Events',
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" role="status">
        <Loader2 size={28} className="animate-spin text-green-500" aria-hidden="true" />
        <span className="ml-3 text-[var(--text-secondary)]">{t('downtime.loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center h-64 gap-3 text-center px-4">
        <AlertTriangle size={32} className="text-red-400" aria-hidden="true" />
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={() => load()} className="btn-primary text-sm min-h-[44px]">{t('downtime.error.retry')}</button>
      </div>
    )
  }

  const hoursSub = `${(kpis.totalHours / SHIFT_HOURS).toFixed(1)} shift-days, ${kpis.actualPct == null ? 'no events' : `${kpis.actualPct}% measured from work orders`}`

  return (
    <div className="space-y-6 pb-10">
      {tyreTruncated && (
        <div className="px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-[var(--text-secondary)]">
          This view reached its limit of 50,000 tyre records, so the figures below cover
          the most recent ones for the selected country rather than the whole history.
          Choose a single country to see a complete picture of it.
        </div>
      )}
      {woTruncated && (
        <div className="px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-[var(--text-secondary)]">
          This view reached its limit of {WORK_ORDER_CEILING.toLocaleString()} work orders, so the figures
          below cover the most recent ones rather than the whole history. Choose a shorter period to see a
          complete picture of it.
        </div>
      )}
      {woError && (
        <div role="alert" className="px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-[var(--text-secondary)] flex flex-wrap items-center gap-2">
          <AlertCircle size={14} className="text-amber-500 shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-[200px]">{woError}</span>
          <button onClick={() => load(true)} className="btn-secondary text-xs min-h-[44px]">Retry</button>
        </div>
      )}

      <PageHeader
        title={t('downtime.title')}
        subtitle={<>
          {usingActual ? t('downtime.subtitle.actual') : t('downtime.subtitle.estimated')}
          <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/15 text-yellow-600 text-[10px] rounded font-semibold">
            {usingActual ? t('downtime.badge.actualEstimated') : t('downtime.badge.estimated')}
          </span>
        </>}
        icon={AlertTriangle}
        actions={<div className="flex flex-wrap items-center gap-2">
          <button onClick={() => load(true)} disabled={refreshing} className="btn-secondary inline-flex items-center gap-1.5 text-sm min-h-[44px]">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            {t('downtime.actions.refresh')}
          </button>
          <button onClick={handleExportPdf} disabled={!filtered.length} className="btn-secondary inline-flex items-center gap-1.5 text-sm min-h-[44px]">
            <FileText size={13} aria-hidden="true" />{t('downtime.actions.pdf')}
          </button>
          <button onClick={handleExportExcel} disabled={!filtered.length} className="btn-primary inline-flex items-center gap-1.5 text-sm min-h-[44px]">
            <FileSpreadsheet size={13} aria-hidden="true" />{t('downtime.actions.excel')}
          </button>
        </div>}
      />

      {exportError && <p role="alert" className="text-sm text-red-400">{exportError}</p>}

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-2 items-center">
          <SegmentedControl
            ariaLabel={t('downtime.filters.periodAriaLabel')}
            size="sm"
            value={period}
            onChange={setPeriod}
            options={PERIOD_PRESETS.map((p) => ({ value: p.label, label: t(`downtime.periods.${p.label}`) }))}
          />
          <select aria-label="Site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className={INPUT}>
            <option value="">{t('downtime.filters.allSites')}</option>
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {countries.length > 1 && (
            <select aria-label="Country" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} className={INPUT}>
              <option value="">{t('downtime.filters.allCountries')}</option>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select aria-label="Risk level" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className={INPUT}>
            <option value="">{t('downtime.filters.allRiskLevels')}</option>
            {RISK_LEVELS.map((r) => <option key={r} value={r}>{t(`downtime.riskLevels.${r.toLowerCase()}`)}</option>)}
            <option value="unrated">Not rated</option>
          </select>
          <select aria-label="Cause" value={causeFilter} onChange={(e) => setCauseFilter(e.target.value)} className={INPUT}>
            <option value="">All causes</option>
            {CAUSES.map((c) => <option key={c} value={c}>{t(`downtime.causes.${CAUSE_KEY_MAP[c]}`)}</option>)}
          </select>
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              type="text"
              aria-label="Search events"
              placeholder={t('downtime.filters.searchPlaceholder')}
              value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)}
              className={`${INPUT} pl-8 pr-9 w-full`}
            />
            {assetSearch && (
              <button onClick={() => setAssetSearch('')} className="absolute right-0 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Clear search">
                <X size={12} />
              </button>
            )}
          </div>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear</button>}
          <span className="ml-auto text-xs text-[var(--text-muted)]" aria-live="polite">{t('downtime.filters.eventsCount', { count: filtered.length.toLocaleString() })}</span>
        </div>
      </div>

      {/* Estimation basis banner */}
      <div className="flex items-start gap-2.5 bg-yellow-500/5 border border-yellow-500/20 rounded-2xl px-4 py-3">
        <AlertCircle size={15} className="text-yellow-600 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          <span className="text-yellow-600 font-semibold">{t('downtime.banner.title')}</span>{' '}
          {t(usingActual ? 'downtime.banner.bodyActual' : 'downtime.banner.bodyEstimated', {
            rate: `${sym} ${downtimeRate.toLocaleString()}`,
            basis: rateIsCustom ? t('downtime.banner.basisConfigured') : t('downtime.banner.basisDefault'),
            shiftHours: SHIFT_HOURS,
          })}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          label={t('downtime.kpi.availability')}
          value={kpis.availability != null ? `${kpis.availability.toFixed(2)}%` : 'N/A'}
          sub={kpis.availability == null
            ? 'Not measured'
            : kpis.availability >= TARGET_AVAILABILITY
              ? t('downtime.kpi.availabilityAbove', { pct: TARGET_AVAILABILITY })
              : t('downtime.kpi.availabilityBelow', { pct: TARGET_AVAILABILITY })}
          icon={Activity}
          color={kpis.availability == null ? 'blue' : kpis.availability >= TARGET_AVAILABILITY ? 'green' : 'red'}
        />
        <StatCard label={t('downtime.kpi.events')} value={kpis.totalEvents} sub={t('downtime.kpi.eventsSub', { count: kpis.uniqueVehicles })} icon={AlertTriangle} color="orange" />
        <StatCard label={t('downtime.kpi.hours')} value={fmtHours(kpis.totalHours)} sub={hoursSub} icon={Clock} color="yellow" />
        <StatCard
          label={t('downtime.kpi.cost')}
          value={fmtCurrency(kpis.totalCost, sym)}
          sub={t('downtime.kpi.costSub', {
            rate: `${sym} ${downtimeRate.toLocaleString()}`,
            basis: rateIsCustom ? t('downtime.kpi.costBasisConfigured') : t('downtime.kpi.costBasisAssumed'),
          })}
          icon={DollarSign}
          color="red"
        />
        <StatCard label="Mean time between events" value={kpis.mtbeHours != null ? `${Math.round(kpis.mtbeHours)} h` : 'N/A'} sub={t('downtime.kpi.mttrSub')} icon={BarChart2} color="blue" />
        <StatCard label="Unplanned share" value={kpis.unplannedPct != null ? `${kpis.unplannedPct}%` : 'N/A'} sub={`${kpis.unplannedEvents} critical or high events`} icon={Gauge} color="purple" />
      </div>

      {filtered.length === 0 && (
        <div className="card text-center text-sm text-[var(--text-muted)] py-8">
          {tyreRecords.length === 0 ? 'No tyre removal events are recorded for this country yet, so downtime cannot be measured.' : 'No downtime events match these filters. Widen the period or clear filters.'}
        </div>
      )}

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ChartCard title={t('downtime.charts.availabilityTrend')} summary={`Availability over the last 12 months against the ${TARGET_AVAILABILITY}% target`}>
            {trendHasData ? (
              <div className="h-56"><Line data={availabilityTrendData} options={availOpts} /></div>
            ) : (
              <div className="h-56 flex items-center justify-center text-[var(--text-muted)] text-sm">Not measured: no vehicles in scope.</div>
            )}
          </ChartCard>
        </div>
        <ChartCard title={t('downtime.charts.byCause')} summary={causes.map((c) => `${c.cause} ${c.count}`).join(', ')}>
          {causes.length > 0 ? (
            <div className="h-56"><Doughnut data={causeData} options={doughnutOpts} /></div>
          ) : (
            <div className="h-56 flex items-center justify-center text-[var(--text-muted)] text-sm">{t('downtime.charts.noData')}</div>
          )}
        </ChartCard>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title={t('downtime.charts.bySite')} summary={sitesBd.slice(0, 5).map((s) => `${s.site} ${s.total.toFixed(1)} h`).join(', ')}>
          {sitesBd.length > 0 ? (
            <div className="h-64"><Bar data={siteData} options={siteBarOpts} /></div>
          ) : (
            <div className="h-64 flex items-center justify-center text-[var(--text-muted)] text-sm">{t('downtime.charts.noData')}</div>
          )}
        </ChartCard>
        <ChartCard title={t('downtime.charts.monthlyCost')}>
          {costRows.some((r) => r.planned || r.unplanned) ? (
            <div className="h-64"><Bar data={monthlyCostData} options={costBarOpts} /></div>
          ) : (
            <div className="h-64 flex items-center justify-center text-[var(--text-muted)] text-sm">{t('downtime.charts.noData')}</div>
          )}
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">{t('downtime.charts.budgetThreshold', { value: fmtCurrency(BUDGET_THRESHOLD, sym) })}</p>
        </ChartCard>
      </div>

      {/* Downtime Heatmap */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4">{t('downtime.heatmap.heading')}</h3>
        {heat.rows.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] text-sm py-8">{t('downtime.heatmap.empty')}</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-max">
              <div className="flex items-center gap-1 mb-1 ml-28">
                {heat.months.map((m) => (
                  <div key={m} className="w-10 text-center text-[10px] text-[var(--text-muted)] font-medium">{monthLabel(m)}</div>
                ))}
              </div>
              {heat.rows.map(({ asset, cells }) => (
                <div key={asset} className="flex items-center gap-1 mb-1">
                  <div className="w-28 text-[11px] text-[var(--text-secondary)] truncate font-medium pr-2 text-right">{asset}</div>
                  {cells.map((h, i) => (
                    <div
                      key={i}
                      title={`${asset}, ${heat.months[i]}: ${h.toFixed(1)} h`}
                      aria-label={`${asset}, ${monthLabel(heat.months[i])}: ${h.toFixed(1)} hours`}
                      className={`w-10 h-7 rounded text-[10px] flex items-center justify-center font-medium ${heatColor(h)}`}
                    >
                      {h > 0 ? h.toFixed(0) : ''}
                    </div>
                  ))}
                </div>
              ))}
              <div className="flex items-center gap-3 mt-3 ml-28">
                <span className="text-[10px] text-[var(--text-muted)]">{t('downtime.heatmap.hoursLabel')}</span>
                {[{ label: '0', cls: 'bg-[var(--surface-2)]' }, { label: '1 to 4', cls: 'bg-yellow-500/30' }, { label: '5 to 8', cls: 'bg-orange-500/40' }, { label: '8+', cls: 'bg-red-500/40' }].map(({ label, cls }) => (
                  <span key={label} className="flex items-center gap-1">
                    <span className={`w-4 h-4 rounded ${cls} inline-block`} />
                    <span className="text-[10px] text-[var(--text-muted)]">{label} h</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Vehicles Table (every vehicle, sortable) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-secondary)]">Vehicles by downtime</h3>
          <span className="text-xs text-[var(--text-muted)]">{vehicles.length} vehicles, most downtime first</span>
        </div>
        <EnterpriseTable
          columns={vehicleColumns}
          data={vehicles}
          getRowId={(v) => v.asset}
          enableGlobalFilter
          searchPlaceholder="Search vehicle or site"
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={t('downtime.table.empty')}
        />
      </div>

      {/* Recommendations */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={15} className="text-yellow-600" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-[var(--text-secondary)]">{t('downtime.recommendations.heading')}</h3>
          <span className="ml-auto text-xs text-[var(--text-muted)]">{t('downtime.recommendations.insightsCount', { count: recs.length })}</span>
        </div>
        {recs.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No recommendations: there are no downtime events in this view to analyse.</p>
        ) : (
          <div className="space-y-3">
            {recs.map((r, i) => {
              const txt = recText(r)
              const iconMap = { critical: <XCircle size={15} className="text-red-400 shrink-0 mt-0.5" aria-hidden="true" />, high: <AlertCircle size={15} className="text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />, medium: <AlertTriangle size={15} className="text-yellow-600 shrink-0 mt-0.5" aria-hidden="true" />, low: <CheckCircle2 size={15} className="text-green-500 shrink-0 mt-0.5" aria-hidden="true" /> }
              const borderMap = { critical: 'border-l-red-500/50', high: 'border-l-orange-500/50', medium: 'border-l-yellow-500/50', low: 'border-l-green-500/50' }
              return (
                <div key={i} className={`flex gap-3 p-3 bg-[var(--surface-2)] rounded-xl border-l-2 ${borderMap[r.severity]}`}>
                  {iconMap[r.severity]}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--text-primary)] font-medium leading-snug">{txt.message}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{t('downtime.recommendations.actionPrefix', { action: txt.action })}</p>
                  </div>
                  <SeverityBadge level={r.severity} t={t} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
