import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  Truck, Download, FileText, AlertTriangle,
  TrendingUp, TrendingDown, DollarSign, Clock, Activity,
  Filter, RefreshCw, ExternalLink, Award, Zap, Target,
  Shield, Search, Mail,
} from 'lucide-react'
import EmailReportModal from '../components/EmailReportModal'
import { supabase } from '../lib/supabase'
import { toUserMessage } from '../lib/safeError'
import { fetchAllPages } from '../lib/fetchAll'
import { applyCountry } from '../lib/countryFilter'
import PageHeader from '../components/ui/PageHeader'
import SectionTabs, { FLEET_TABS } from '../components/ui/SectionTabs'
import PeriodFilter, { filterByPeriodValue, periodLabel } from '../components/ui/PeriodFilter'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { compareValues } from '../lib/consoleTable'
import {
  HOURS_PER_CHANGE, indexFleetMaster, buildVehicleMetrics, fleetAggregates,
  availabilityTimeline as buildAvailabilityTimeline, costBySite as buildCostBySite,
  costTrend as buildCostTrend, attentionVehicles as buildAttention, cpkBenchmarks,
  filterRegister, registerExportRows, REGISTER_EXPORT_COLS, REGISTER_EXPORT_HEADERS,
} from '../lib/fleetIntelligenceAnalytics'
import { categorical, withAlpha, colorAt } from '../lib/reportColors'
import { useSettings } from '../contexts/SettingsContext'
import { formatDate, formatMonthYear } from '../lib/formatters'
import { useLanguage } from '../contexts/LanguageContext'

// ── Chart.js global registration ─────────────────────────────────────────────
ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ─────────────────────────────────────────────────────────────────
// Scale guard: cap the row-level analytics pulls so this page never streams a
// whole multi-million-row table into the browser. Country is applied server-side;
// the period picker (below) needs the full country set to populate its year list,
// so the cap is the bound. Beyond this many rows the newest ones are used and a
// "capped view" note is shown. Every figure here is derived client-side from the
// same rows, so under the cap (today's data) values are unchanged.
const ROW_CAP = 50000

const CHART_THEME = {
  textColor: 'var(--text-secondary)',
  gridColor: 'var(--panel-2)',
  tooltipBg: 'var(--panel)',
  tooltipBorder: 'var(--hairline)',
  tooltipTitle: 'var(--panel-ink)',
  tooltipBody: 'var(--text-secondary)',
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(n, dec = 0) {
  if (n == null || isNaN(n)) return 'N/A'
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })
}

function fmtCurrency(n, currency) {
  if (n == null || isNaN(n)) return 'N/A'
  if (n >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${currency} ${(n / 1_000).toFixed(0)}K`
  return `${currency} ${fmt(n, 0)}`
}

function fmtDate(d) {
  return formatDate(d)
}

function fmtCpk(n, dec = 4) {
  if (n == null || isNaN(n) || !isFinite(n)) return 'N/A'
  return Number(n).toFixed(dec)
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function monthLabel(key) {
  if (!key) return ''
  const [y, m] = key.split('-')
  return formatMonthYear(new Date(Number(y), Number(m) - 1, 1))
}

/** Null-last sort for EnterpriseTable columns. */
function nullLastSort(rowA, rowB, id) {
  const a = rowA.getValue(id)
  const b = rowB.getValue(id)
  const ba = a == null || a === ''
  const bb = b == null || b === ''
  if (ba && bb) return 0
  if (ba) return 1
  if (bb) return -1
  return compareValues(a, b)
}

// ── Chart options factories ───────────────────────────────────────────────────
function makeLineOpts(currency, yLabel = '') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: CHART_THEME.textColor, font: { size: 11 }, boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: CHART_THEME.tooltipBg,
        borderColor: CHART_THEME.tooltipBorder,
        borderWidth: 1,
        titleColor: CHART_THEME.tooltipTitle,
        bodyColor: CHART_THEME.tooltipBody,
        callbacks: {
          label: ctx => {
            const v = ctx.raw
            if (yLabel === 'pct') return ` ${Number(v).toFixed(1)}%`
            if (yLabel === 'cost') return ` ${currency} ${fmt(v, 0)}`
            return ` ${fmt(v, 0)}`
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: CHART_THEME.gridColor },
        ticks: { color: CHART_THEME.textColor, font: { size: 10 } },
      },
      y: {
        grid: { color: CHART_THEME.gridColor },
        ticks: {
          color: CHART_THEME.textColor,
          font: { size: 10 },
          callback: v => {
            if (yLabel === 'pct') return `${v}%`
            if (yLabel === 'cost') return fmtCurrency(v, currency)
            return fmt(v, 0)
          },
        },
        beginAtZero: true,
        max: yLabel === 'pct' ? 100 : undefined,
      },
    },
  }
}

function makeBarOpts(currency, yLabel = '') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: CHART_THEME.textColor, font: { size: 11 }, boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: CHART_THEME.tooltipBg,
        borderColor: CHART_THEME.tooltipBorder,
        borderWidth: 1,
        titleColor: CHART_THEME.tooltipTitle,
        bodyColor: CHART_THEME.tooltipBody,
        callbacks: {
          label: ctx => {
            if (yLabel === 'cost') return ` ${currency} ${fmt(ctx.raw, 0)}`
            return ` ${fmt(ctx.raw, 0)}`
          },
        },
      },
    },
    scales: {
      x: {
        stacked: yLabel === 'stacked',
        grid: { color: CHART_THEME.gridColor },
        ticks: {
          color: CHART_THEME.textColor,
          font: { size: 9 },
          maxRotation: 45,
        },
      },
      y: {
        stacked: yLabel === 'stacked',
        grid: { color: CHART_THEME.gridColor },
        ticks: {
          color: CHART_THEME.textColor,
          font: { size: 10 },
          callback: v => yLabel === 'cost' || yLabel === 'stacked' ? fmtCurrency(v, currency) : fmt(v, 0),
        },
        beginAtZero: true,
      },
    },
  }
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'blue', loading, trend }) {
  const colorMap = {
    red:    { wrap: 'bg-red-900/20 border-red-800/40',    icon: 'text-red-400',    val: 'text-red-300' },
    amber:  { wrap: 'bg-amber-900/20 border-amber-800/40', icon: 'text-amber-400',  val: 'text-amber-300' },
    green:  { wrap: 'bg-green-900/20 border-green-800/40', icon: 'text-green-400',  val: 'text-green-300' },
    blue:   { wrap: 'bg-blue-900/20 border-blue-800/40',  icon: 'text-blue-400',   val: 'text-blue-300' },
    purple: { wrap: 'bg-purple-900/20 border-purple-800/40', icon: 'text-purple-400', val: 'text-purple-300' },
    cyan:   { wrap: 'bg-cyan-900/20 border-cyan-800/40',  icon: 'text-cyan-400',   val: 'text-cyan-300' },
  }
  const c = colorMap[color] || colorMap.blue
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className={`border rounded-xl p-4 flex gap-3 items-start ${c.wrap}`}
    >
      <div className={`mt-0.5 shrink-0 ${c.icon}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--text-muted)] leading-tight">{label}</p>
        {loading
          ? <div className="h-6 w-24 skeleton rounded mt-1" />
          : <p className={`text-lg font-bold leading-tight mt-0.5 ${c.val}`}>{value}</p>
        }
        {sub && !loading && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-1">
            {trend === 'up' && <TrendingUp size={10} className="text-red-400" />}
            {trend === 'down' && <TrendingDown size={10} className="text-green-400" />}
            {sub}
          </p>
        )}
      </div>
    </motion.div>
  )
}

// ── Availability Status Badge ─────────────────────────────────────────────────
function AvailBadge({ status }) {
  const { t } = useLanguage()
  if (status === 'Critical')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-900/40 text-red-300 border border-red-800/50">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />{t('fleetintel.avail.critical')}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-900/20 text-green-400 border border-green-800/40">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />{t('fleetintel.avail.available')}
    </span>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════════
export default function FleetIntelligence() {
  const { t } = useLanguage()
  const { activeCurrency, activeCountry } = useSettings()

  // ── State ─────────────────────────────────────────────────────────────────
  const [records, setRecords]         = useState([])
  const [fleetMaster, setFleetMaster] = useState([])
  const [inspections, setInspections] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [fleetMasterAvail, setFleetMasterAvail] = useState(true)
  const [capped, setCapped]           = useState(false)

  const [period, setPeriod]           = useState({ mode: 'all' })
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [siteFilter, setSiteFilter]   = useState('all')
  const [typeFilter, setTypeFilter]   = useState('all')
  const [availFilter, setAvailFilter] = useState('all')
  const [searchAsset, setSearchAsset] = useState('')
  const [computedAt, setComputedAt]   = useState(() => new Date())

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setCapped(false)
    try {
      const { data: tyreData, error: tyreErr, truncated: tyreTrunc } = await fetchAllPages((from, to) => applyCountry(supabase
        .from('tyre_records')
        .select('id,asset_no,site,brand,position,risk_level,category,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,tread_depth')
        .order('issue_date', { ascending: false }), activeCountry)
        .range(from, to), { max: ROW_CAP })

      if (tyreErr) throw tyreErr
      setRecords(tyreData || [])
      let truncated = !!tyreTrunc

      // Fleet master - graceful. Paged: a bare .select caps at 1000 and the fleet
      // is ~1523, so under All ~523 assets silently lacked fleet-master enrichment.
      try {
        const { data: fleetData, error: fleetErr, truncated: fleetTrunc } = await fetchAllPages(
          (from, to) => applyCountry(supabase
            .from('vehicle_fleet')
            .select('asset_no,site,vehicle_type,current_km,expected_km_per_tyre,monthly_tyre_budget,registration_date')
            .order('id', { ascending: true }).range(from, to), activeCountry),
          { max: 20000 },
        )
        if (fleetErr) {
          setFleetMaster([])
          setFleetMasterAvail(false)
        } else {
          setFleetMaster(fleetData || [])
          setFleetMasterAvail(true)
          truncated = truncated || !!fleetTrunc
        }
      } catch {
        setFleetMaster([])
        setFleetMasterAvail(false)
      }

      // Inspections - graceful
      try {
        const { data: inspData, truncated: inspTrunc } = await fetchAllPages((from, to) => applyCountry(supabase
          .from('inspections')
          .select('asset_no,site,status,scheduled_date,completed_date'), activeCountry)
          .range(from, to), { max: ROW_CAP })
        setInspections(inspData || [])
        truncated = truncated || !!inspTrunc
      } catch {
        setInspections([])
      }

      setCapped(truncated)
      setComputedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load fleet intelligence data'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { loadData() }, [loadData])

  // ── Period-filtered records (top of the derived-data chain) ──────────────
  const periodRecords = useMemo(
    () => filterByPeriodValue(records, period, 'issue_date'),
    [records, period]
  )

  // ── Unique sites & vehicle types ──────────────────────────────────────────
  const allSites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return ['all', ...Array.from(s).sort()]
  }, [records])

  const allVehicleTypes = useMemo(() => {
    const t = new Set(fleetMaster.map(f => f.vehicle_type).filter(Boolean))
    return ['all', ...Array.from(t).sort()]
  }, [fleetMaster])

  // ── Derived data (pure engine: fleetIntelligenceAnalytics) ───────────────
  const fleetMasterMap = useMemo(() => indexFleetMaster(fleetMaster), [fleetMaster])
  const vehicleMetrics = useMemo(
    () => buildVehicleMetrics(periodRecords, fleetMasterMap, { now: computedAt }),
    [periodRecords, fleetMasterMap, computedAt],
  )
  const fleetAggs = useMemo(() => fleetAggregates(vehicleMetrics, periodRecords), [vehicleMetrics, periodRecords])
  const availabilityTimeline = useMemo(
    () => buildAvailabilityTimeline(periodRecords, { now: computedAt }).map((d) => ({ ...d, label: monthLabel(d.month) })),
    [periodRecords, computedAt],
  )
  const downtimeTop15 = useMemo(
    () => [...vehicleMetrics].sort((a, b) => b.downtime_hours - a.downtime_hours).slice(0, 15),
    [vehicleMetrics],
  )
  const costBySite = useMemo(() => buildCostBySite(periodRecords, fleetMasterMap), [periodRecords, fleetMasterMap])
  const costTrendData = useMemo(() => {
    const tr = buildCostTrend(periodRecords, { now: computedAt })
    return {
      ...tr,
      labels: [...tr.keys.map(monthLabel), `${monthLabel(tr.forecastKey)} (forecast)`],
      actual: [...tr.actual, null],
      regression: [...tr.regression, tr.forecastCost],
    }
  }, [periodRecords, computedAt])
  const filteredRegister = useMemo(
    () => filterRegister(vehicleMetrics, { site: siteFilter, type: typeFilter, avail: availFilter, search: searchAsset }),
    [vehicleMetrics, siteFilter, typeFilter, availFilter, searchAsset],
  )
  const attentionVehicles = useMemo(() => buildAttention(periodRecords, { now: computedAt }), [periodRecords, computedAt])
  const benchmarks = useMemo(() => cpkBenchmarks(vehicleMetrics, fleetAggs), [vehicleMetrics, fleetAggs])
  const topByCost = useMemo(
    () => [...vehicleMetrics].sort((a, b) => b.total_tyre_cost - a.total_tyre_cost).slice(0, 20),
    [vehicleMetrics],
  )
  const filtersActive = siteFilter !== 'all' || typeFilter !== 'all' || availFilter !== 'all' || !!searchAsset
  const clearFilters = () => { setSiteFilter('all'); setTypeFilter('all'); setAvailFilter('all'); setSearchAsset('') }

  // ── Register + attention columns ─────────────────────────────────────────
  const registerColumns = useMemo(() => [
    { id: 'asset_no', header: t('fleetintel.register.columns.assetNo'), accessorFn: (v) => v.asset_no, size: 130, sortingFn: nullLastSort,
      cell: ({ getValue }) => <span className="font-mono font-semibold text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'site', header: t('fleetintel.register.columns.site'), accessorFn: (v) => v.site, size: 120, sortingFn: nullLastSort, cell: ({ getValue }) => getValue() ?? 'N/A' },
    { id: 'vehicle_type', header: t('fleetintel.register.columns.type'), accessorFn: (v) => v.vehicle_type, size: 130, sortingFn: nullLastSort, cell: ({ getValue }) => getValue() ?? 'N/A' },
    { id: 'total_tyre_changes', header: t('fleetintel.register.columns.changes'), accessorFn: (v) => v.total_tyre_changes, size: 90, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue())}</span> },
    { id: 'total_tyre_cost', header: t('fleetintel.register.columns.totalCost'), accessorFn: (v) => v.total_tyre_cost, size: 120, sortingFn: nullLastSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums font-semibold">{fmtCurrency(getValue(), activeCurrency)}</span> },
    { id: 'avg_cpk', header: t('fleetintel.register.columns.avgCpk'), accessorFn: (v) => v.avg_cpk, size: 100, sortingFn: nullLastSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className={getValue() == null ? 'text-[var(--text-dim)]' : 'tabular-nums'}>{fmtCpk(getValue())}</span> },
    { id: 'high_risk_count', header: t('fleetintel.register.columns.highRisk'), accessorFn: (v) => v.high_risk_count, size: 90, meta: { align: 'right' },
      cell: ({ getValue }) => (getValue() > 0
        ? <span className="px-1.5 py-0.5 bg-red-900/40 text-red-300 rounded text-xs font-bold">{getValue()}</span>
        : <span className="text-[var(--text-dim)]">0</span>) },
    { id: 'availability_status', header: t('fleetintel.register.columns.status'), accessorFn: (v) => v.availability_status, size: 120,
      meta: { filterVariant: 'select' }, cell: ({ getValue }) => <AvailBadge status={getValue()} /> },
    { id: 'monthly_cost', header: t('fleetintel.register.columns.monthlyCost'), accessorFn: (v) => v.monthly_cost, size: 120, sortingFn: nullLastSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums text-[var(--text-muted)]">{fmtCurrency(getValue(), activeCurrency)}</span> },
    { id: 'last_change_date', header: t('fleetintel.register.columns.lastChange'), accessorFn: (v) => v.last_change_date, size: 120, sortingFn: nullLastSort,
      cell: ({ getValue }) => <span className="whitespace-nowrap text-[var(--text-muted)]">{fmtDate(getValue())}</span> },
    { id: 'action', header: t('fleetintel.register.columns.action'), enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <a
          href={`/vehicle-history?asset=${encodeURIComponent(row.original.asset_no)}`}
          className="inline-flex items-center gap-1 min-h-[44px] text-blue-400 hover:text-blue-300 transition-colors text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
          aria-label={`${t('fleetintel.register.viewInHistory')}: ${row.original.asset_no}`}
        >
          <ExternalLink size={11} aria-hidden="true" />
          {t('fleetintel.register.history')}
        </a>
      ) },
  ], [t, activeCurrency])

  const attentionColumns = useMemo(() => [
    { id: 'asset_no', header: t('fleetintel.attention.columns.assetNo'), accessorFn: (v) => v.asset_no, sortingFn: nullLastSort,
      cell: ({ getValue }) => <span className="font-mono font-semibold text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'site', header: t('fleetintel.attention.columns.site'), accessorFn: (v) => v.site, sortingFn: nullLastSort, cell: ({ getValue }) => getValue() ?? 'N/A' },
    { id: 'risk_level', header: t('fleetintel.attention.columns.riskLevel'), accessorFn: (v) => (v.risk_level === 'Critical' ? 0 : 1),
      meta: { exportValue: (v) => v.risk_level },
      cell: ({ row }) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${
          row.original.risk_level === 'Critical' ? 'bg-red-900/40 text-red-300 border-red-800/50' : 'bg-amber-900/40 text-amber-300 border-amber-800/50'
        }`}>{row.original.risk_level}</span>
      ) },
    { id: 'issue_date', header: t('fleetintel.attention.columns.issueDate'), accessorFn: (v) => v.issue_date, sortingFn: nullLastSort, cell: ({ getValue }) => fmtDate(getValue()) },
    { id: 'position', header: t('fleetintel.attention.columns.position'), accessorFn: (v) => v.position, sortingFn: nullLastSort, cell: ({ getValue }) => getValue() ?? 'N/A' },
    { id: 'brand', header: t('fleetintel.attention.columns.brand'), accessorFn: (v) => v.brand, sortingFn: nullLastSort, cell: ({ getValue }) => getValue() ?? 'N/A' },
    { id: 'count', header: t('fleetintel.attention.columns.records'), accessorFn: (v) => v.count, meta: { align: 'right' } },
  ], [t])

  // ── Export handlers ───────────────────────────────────────────────────────
  const handleExcelExport = useCallback(() => {
    if (!filteredRegister.length) return
    exportToExcel(
      registerExportRows(filteredRegister),
      REGISTER_EXPORT_COLS,
      REGISTER_EXPORT_HEADERS.map((h) => (/Cost/.test(h) ? `${h} (${activeCurrency})` : h)),
      reportFileName('TyrePulse Fleet Intelligence', reportDateLabel()),
      'Fleet Asset Register',
    )
  }, [filteredRegister, activeCurrency])

  const handlePdfExport = useCallback(() => {
    if (!topByCost.length) return
    const rows = registerExportRows(topByCost)
    exportToPdf(
      rows,
      REGISTER_EXPORT_COLS.filter((k) => k !== 'avg_km_per_tyre' && k !== 'monthly_cost')
        .map((k) => ({ key: k, header: REGISTER_EXPORT_HEADERS[REGISTER_EXPORT_COLS.indexOf(k)] })),
      `Fleet Management Intelligence: Top 20 Vehicles by Cost (${activeCurrency})`,
      reportFileName('TyrePulse Fleet Intelligence Top 20', reportDateLabel()),
      'landscape',
    )
  }, [topByCost, activeCurrency])

  // ── Chart datasets ────────────────────────────────────────────────────────
  const availabilityChartData = useMemo(() => ({
    labels: availabilityTimeline.map(d => d.label),
    datasets: [
      {
        label: t('fleetintel.availability.seriesLabel'),
        data: availabilityTimeline.map(d => d.pct),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: availabilityTimeline.map(d =>
          d.pct == null ? 'transparent' : d.pct < 90 ? '#ef4444' : d.pct < 95 ? '#f59e0b' : '#3b82f6'
        ),
        spanGaps: false,
        pointRadius: 5,
      },
      {
        label: t('fleetintel.availability.targetSeriesLabel'),
        data: availabilityTimeline.map(() => 95),
        borderColor: 'rgba(16,185,129,0.7)',
        borderDash: [6, 4],
        borderWidth: 1.5,
        backgroundColor: 'transparent',
        pointRadius: 0,
        tension: 0,
      },
    ],
  }), [availabilityTimeline, t])

  const downtimeChartData = useMemo(() => ({
    labels: downtimeTop15.map(v => v.asset_no),
    datasets: [{
      label: t('fleetintel.downtime.seriesLabel'),
      data: downtimeTop15.map(v => v.downtime_hours),
      backgroundColor: downtimeTop15.map(v =>
        v.downtime_hours > 20 ? 'rgba(239,68,68,0.7)' : 'rgba(59,130,246,0.6)'
      ),
      borderColor: downtimeTop15.map(v =>
        v.downtime_hours > 20 ? '#ef4444' : '#3b82f6'
      ),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [downtimeTop15, t])

  const siteCostChartData = useMemo(() => {
    const { sites, vtypes } = costBySite
    const colors = categorical(Math.max(vtypes.length, 1))

    if (!fleetMasterAvail || vtypes.length <= 1) {
      return {
        labels: sites.map(s => s.site),
        datasets: [{
          label: t('fleetintel.siteCost.totalSeriesLabel'),
          data: sites.map(s => s.total),
          backgroundColor: withAlpha(colorAt(0), 0.65),
          borderColor: colorAt(0),
          borderWidth: 1,
          borderRadius: 4,
        }],
      }
    }

    return {
      labels: sites.map(s => s.site),
      datasets: vtypes.map((vt, i) => ({
        label: vt,
        data: sites.map(s => s.byType[vt] || 0),
        backgroundColor: withAlpha(colors[i % colors.length], 0.75),
        borderColor: colors[i % colors.length],
        borderWidth: 1,
        stack: 'stack',
      })),
    }
  }, [costBySite, fleetMasterAvail, t])

  const costTrendChartData = useMemo(() => ({
    labels: costTrendData.labels,
    datasets: [
      {
        label: t('fleetintel.costTrend.seriesLabel', { currency: activeCurrency }),
        data: costTrendData.actual,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#3b82f6',
        spanGaps: false,
      },
      {
        label: t('fleetintel.costTrend.trendLineLabel'),
        data: costTrendData.regression,
        borderColor: 'rgba(107,114,128,0.6)',
        borderDash: [5, 4],
        borderWidth: 1.5,
        backgroundColor: 'transparent',
        pointRadius: (ctx) => ctx.dataIndex === costTrendData.regression.length - 1 ? 6 : 0,
        pointBackgroundColor: '#f59e0b',
        tension: 0,
      },
    ],
  }), [costTrendData, activeCurrency, t])

  // ── KPI derived values ────────────────────────────────────────────────────
  const availColor = fleetAggs.availability_pct == null ? 'blue' : fleetAggs.availability_pct >= 95 ? 'green' : fleetAggs.availability_pct >= 90 ? 'amber' : 'red'

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface-1)] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-[var(--text-muted)] text-sm">{t('fleetintel.states.loading')}</p>
        </div>
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-[var(--surface-1)] flex items-center justify-center">
        <div className="bg-[var(--surface-1)] border border-red-800/50 rounded-xl p-8 max-w-md text-center space-y-3">
          <AlertTriangle className="text-red-400 mx-auto" size={32} />
          <p className="text-red-300 font-semibold">{t('fleetintel.states.errorTitle')}</p>
          <p className="text-[var(--text-muted)] text-sm">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
          >
            {t('fleetintel.states.retry')}
          </button>
        </div>
      </div>
    )
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (records.length === 0) {
    return (
      <div className="min-h-screen bg-[var(--surface-1)] flex items-center justify-center">
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-12 text-center max-w-md">
          <Truck className="text-[var(--text-dim)] mx-auto mb-3" size={40} />
          <p className="text-[var(--text-secondary)] font-semibold">{t('fleetintel.states.noRecordsTitle')}</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            {t('fleetintel.states.noRecordsDesc')}
          </p>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="text-[var(--text-secondary)] space-y-6">

      <SectionTabs tabs={FLEET_TABS} />
      {/* ── 1. Header ──────────────────────────────────────────────────────── */}
      <PageHeader
        title={t('fleetintel.header.title')}
        subtitle={t('fleetintel.header.subtitle')}
        icon={Truck}
        actions={<>
          {!fleetMasterAvail && (
            <span className="text-xs text-amber-400 border border-amber-800/40 bg-amber-900/20 px-2 py-1 rounded-lg">
              {t('fleetintel.header.fleetMasterUnavailable')}
            </span>
          )}
          <button
            onClick={loadData}
            className="p-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg transition-colors text-[var(--text-secondary)]"
            title={t('fleetintel.header.refresh')}
            aria-label={t('fleetintel.header.refresh')}
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={handleExcelExport}
            disabled={!filteredRegister.length}
            className="disabled:opacity-50 min-h-[44px] flex items-center gap-2 px-3 py-2 bg-green-700/80 hover:bg-green-600/80 border border-green-700 rounded-lg text-sm transition-colors text-white font-medium"
          >
            <Download size={14} />{t('fleetintel.header.excel')}
          </button>
          <button
            onClick={handlePdfExport}
            disabled={!topByCost.length}
            className="disabled:opacity-50 min-h-[44px] flex items-center gap-2 px-3 py-2 bg-blue-700/80 hover:bg-blue-600/80 border border-blue-700 rounded-lg text-sm transition-colors text-white font-medium"
          >
            <FileText size={14} />{t('fleetintel.header.pdf')}
          </button>
          <button
            onClick={() => setEmailModalOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-sm transition-colors text-[var(--text-secondary)] font-medium"
          >
            <Mail size={14} />{t('fleetintel.header.emailReport')}
          </button>
        </>}
      />

      {/* ── 2. Filters ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-[var(--text-muted)]" />
          <span className="text-sm font-medium text-[var(--text-secondary)]">{t('fleetintel.filters.heading')}</span>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          {/* Period */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)]">{t('fleetintel.filters.period')}</label>
            <PeriodFilter records={records} value={period} onChange={setPeriod} />
          </div>

          {/* Site */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)]">{t('fleetintel.filters.site')}</label>
            <select
              aria-label={t('fleetintel.filters.site')}
              value={siteFilter}
              onChange={e => setSiteFilter(e.target.value)}
              className="bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 min-w-32"
            >
              {allSites.map(s => (
                <option key={s} value={s}>{s === 'all' ? t('fleetintel.filters.allSites') : s}</option>
              ))}
            </select>
          </div>

          {/* Vehicle type */}
          {allVehicleTypes.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-muted)]">{t('fleetintel.filters.vehicleType')}</label>
              <select
                aria-label={t('fleetintel.filters.vehicleType')}
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 min-w-32"
              >
                {allVehicleTypes.map(vt => (
                  <option key={vt} value={vt}>{vt === 'all' ? t('fleetintel.filters.allTypes') : vt}</option>
                ))}
              </select>
            </div>
          )}

          {/* Availability */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)]">{t('fleetintel.filters.availability')}</label>
            <select
              aria-label={t('fleetintel.filters.availability')}
              value={availFilter}
              onChange={e => setAvailFilter(e.target.value)}
              className="bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="all">{t('fleetintel.filters.all')}</option>
              <option value="Available">{t('fleetintel.filters.available')}</option>
              <option value="Critical">{t('fleetintel.filters.critical')}</option>
            </select>
          </div>

          {/* Result count */}
          <div className="flex flex-col gap-1 ml-auto">
            <p className="text-xs text-[var(--text-muted)] text-right">{t('fleetintel.filters.assets')}</p>
            <p className="text-sm font-bold text-[var(--text-secondary)] text-right">{fmt(filteredRegister.length)} / {fmt(fleetAggs.fleet_size)}</p>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="text-xs text-[var(--accent)] underline min-h-[44px] self-end">
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Capped-view note: shown only when the country holds more rows than the cap. */}
      {capped && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-900/20 px-4 py-2 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Capped view: this country holds more than {fmt(ROW_CAP)} tyre records. Showing the most recent {fmt(ROW_CAP)} for performance. Narrow the period for complete detail.
          </span>
        </div>
      )}

      {/* ── 3. Fleet Health KPI Cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard
          icon={Shield}
          label={t('fleetintel.kpi.fleetAvailability')}
          value={fleetAggs.availability_pct == null ? 'N/A' : `${fleetAggs.availability_pct.toFixed(1)}%`}
          sub={t('fleetintel.kpi.fleetAvailabilitySub', { available: fleetAggs.available_count, total: fleetAggs.fleet_size })}
          color={availColor}
        />
        <KpiCard
          icon={AlertTriangle}
          label={t('fleetintel.kpi.criticalVehicles')}
          value={fmt(fleetAggs.critical_count)}
          sub={t('fleetintel.kpi.criticalVehiclesSub')}
          color={fleetAggs.critical_count > 0 ? 'red' : 'green'}
        />
        <KpiCard
          icon={Clock}
          label={t('fleetintel.kpi.totalDowntime')}
          value={`${fmt(fleetAggs.total_downtime_hours)} hrs`}
          sub={t('fleetintel.kpi.totalDowntimeSub', { hours: HOURS_PER_CHANGE })}
          color="amber"
        />
        <KpiCard
          icon={DollarSign}
          label={t('fleetintel.kpi.monthlyCost')}
          value={fmtCurrency(fleetAggs.monthly_fleet_cost, activeCurrency)}
          sub={t('fleetintel.kpi.monthlyCostSub')}
          color="blue"
        />
        <KpiCard
          icon={Activity}
          label={t('fleetintel.kpi.fleetAvgCpk')}
          value={fmtCpk(fleetAggs.fleetAvgCpk)}
          sub={t('fleetintel.kpi.fleetAvgCpkSub', { currency: activeCurrency })}
          color="purple"
        />
        <KpiCard
          icon={Truck}
          label={t('fleetintel.kpi.avgCostPerVehicle')}
          value={fmtCurrency(fleetAggs.avg_cost_per_vehicle, activeCurrency)}
          sub={t('fleetintel.kpi.avgCostPerVehicleSub', { count: fleetAggs.fleet_size })}
          color="cyan"
        />
      </div>

      {/* ── 4. Availability Timeline ─────────────────────────────────────────── */}
      <div className="card">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('fleetintel.availability.title')}</h2>
          <p className="text-xs text-[var(--text-muted)]">{t('fleetintel.availability.subtitle')}</p>
        </div>
        <div style={{ height: 240 }}>
          <Line data={availabilityChartData} options={makeLineOpts(activeCurrency, 'pct')} />
        </div>
      </div>

      {/* ── 5 & 6. Downtime + Site Cost ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Downtime */}
        <div className="card">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('fleetintel.downtime.title')}</h2>
            <p className="text-xs text-[var(--text-muted)]">{t('fleetintel.downtime.subtitle')}</p>
          </div>
          {downtimeTop15.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-[var(--text-dim)] text-sm">{t('fleetintel.downtime.noData')}</div>
          ) : (
            <div style={{ height: 280 }}>
              <Bar data={downtimeChartData} options={makeBarOpts(activeCurrency)} />
            </div>
          )}
        </div>

        {/* Site Cost */}
        <div className="card">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('fleetintel.siteCost.title')}</h2>
            <p className="text-xs text-[var(--text-muted)]">
              {t('fleetintel.siteCost.subtitle')}{fleetMasterAvail ? t('fleetintel.siteCost.stackedSuffix') : ''}
            </p>
          </div>
          {costBySite.sites.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-[var(--text-dim)] text-sm">{t('fleetintel.siteCost.noData')}</div>
          ) : (
            <div style={{ height: 280 }}>
              <Bar
                data={siteCostChartData}
                options={makeBarOpts(activeCurrency, fleetMasterAvail ? 'stacked' : 'cost')}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── 7. Cost Trend ────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('fleetintel.costTrend.title')}</h2>
            <p className="text-xs text-[var(--text-muted)]">{t('fleetintel.costTrend.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {costTrendData.direction === 'worsening' ? (
              <span className="flex items-center gap-1 text-red-400 border border-red-800/40 bg-red-900/20 px-2 py-1 rounded-lg">
                <TrendingUp size={11} /> {t('fleetintel.costTrend.worsening')}
              </span>
            ) : costTrendData.direction === 'improving' ? (
              <span className="flex items-center gap-1 text-green-400 border border-green-800/40 bg-green-900/20 px-2 py-1 rounded-lg">
                <TrendingDown size={11} /> {t('fleetintel.costTrend.improving')}
              </span>
            ) : (
              <span className="text-[var(--text-muted)] border border-[var(--input-border)] px-2 py-1 rounded-lg">{t('fleetintel.costTrend.stable')}</span>
            )}
            <span className="text-[var(--text-muted)]">
              {t('fleetintel.costTrend.forecast', { value: fmtCurrency(costTrendData.forecastCost, activeCurrency) })}
            </span>
          </div>
        </div>
        <div style={{ height: 240 }}>
          <Line data={costTrendChartData} options={makeLineOpts(activeCurrency, 'cost')} />
        </div>
      </div>

      {/* ── 8. Fleet Asset Register ──────────────────────────────────────────── */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('fleetintel.register.title')}</h2>
            <p className="text-xs text-[var(--text-muted)]">
              {fmt(filteredRegister.length)} of {fmt(vehicleMetrics.length)} assets. Click a column header to sort.
            </p>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            <input
              value={searchAsset}
              onChange={e => setSearchAsset(e.target.value)}
              placeholder={t('fleetintel.register.searchPlaceholder')}
              aria-label={t('fleetintel.register.searchPlaceholder')}
              className="pl-8 pr-3 min-h-[44px] bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] rounded-lg text-sm focus:outline-none focus:border-blue-500 w-48"
            />
          </div>
        </div>

        <EnterpriseTable
          columns={registerColumns}
          data={filteredRegister}
          getRowId={(v) => String(v.asset_no)}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={t('fleetintel.register.noMatch')}
        />
      </div>

      {/* ── 9. Vehicles Needing Attention ───────────────────────────────────── */}
      {attentionVehicles.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="text-red-400 shrink-0" size={16} />
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('fleetintel.attention.title')}</h2>
              <p className="text-xs text-[var(--text-muted)]">
                {t('fleetintel.attention.subtitle', { count: attentionVehicles.length })}
              </p>
            </div>
          </div>
          <EnterpriseTable
            columns={attentionColumns}
            data={attentionVehicles}
            getRowId={(v) => String(v.asset_no)}
            enableColumnFilters={false}
            enableExport={false}
            searchPlaceholder="Search assets"
            initialPageSize={25}
            emptyMessage="No vehicles need attention"
          />
        </div>
      )}

      {/* ── 10. Fleet Efficiency Benchmarks ─────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Best CPK */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.05 }}
          className="bg-green-900/10 border border-green-800/30 rounded-xl p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-green-900/30 rounded-lg">
              <Award className="text-green-400" size={16} />
            </div>
            <span className="text-xs font-semibold text-green-400 uppercase tracking-wide">{t('fleetintel.benchmarks.bestCpkVehicle')}</span>
          </div>
          {benchmarks.best ? (
            <>
              <div>
                <p className="text-2xl font-bold text-green-300">{fmtCpk(benchmarks.best.avg_cpk)}</p>
                <p className="text-xs text-[var(--text-muted)]">{t('fleetintel.benchmarks.perKm', { currency: activeCurrency })}</p>
              </div>
              <div className="bg-[var(--input-bg)]/50 rounded-lg p-3">
                <p className="font-mono text-sm font-bold text-[var(--text-primary)]">{benchmarks.best.asset_no}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{t('fleetintel.benchmarks.changesTotal', { count: benchmarks.best.total_tyre_changes, cost: fmtCurrency(benchmarks.best.total_tyre_cost, activeCurrency) })}</p>
              </div>
              <p className="text-xs text-[var(--text-muted)]">{t('fleetintel.benchmarks.bestDesc')}</p>
            </>
          ) : (
            <p className="text-[var(--text-muted)] text-sm">{t('fleetintel.benchmarks.insufficientBest')}</p>
          )}
        </motion.div>

        {/* Worst CPK */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.1 }}
          className="bg-red-900/10 border border-red-800/30 rounded-xl p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-red-900/30 rounded-lg">
              <Zap className="text-red-400" size={16} />
            </div>
            <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">{t('fleetintel.benchmarks.worstCpkVehicle')}</span>
          </div>
          {benchmarks.worst ? (
            <>
              <div>
                <p className="text-2xl font-bold text-red-300">{fmtCpk(benchmarks.worst.avg_cpk)}</p>
                <p className="text-xs text-[var(--text-muted)]">{t('fleetintel.benchmarks.perKm', { currency: activeCurrency })}</p>
              </div>
              <div className="bg-[var(--input-bg)]/50 rounded-lg p-3">
                <p className="font-mono text-sm font-bold text-[var(--text-primary)]">{benchmarks.worst.asset_no}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{t('fleetintel.benchmarks.changesTotal', { count: benchmarks.worst.total_tyre_changes, cost: fmtCurrency(benchmarks.worst.total_tyre_cost, activeCurrency) })}</p>
              </div>
              <p className="text-xs text-[var(--text-muted)]">{t('fleetintel.benchmarks.worstDesc')}</p>
            </>
          ) : (
            <p className="text-[var(--text-muted)] text-sm">{t('fleetintel.benchmarks.insufficientWorst')}</p>
          )}
        </motion.div>

        {/* Improvement potential */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.15 }}
          className="bg-blue-900/10 border border-blue-800/30 rounded-xl p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-900/30 rounded-lg">
              <Target className="text-blue-400" size={16} />
            </div>
            <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">{t('fleetintel.benchmarks.improvementPotential')}</span>
          </div>
          <div>
            <p className="text-2xl font-bold text-blue-300">{fmtCurrency(benchmarks.annualSavings, activeCurrency)}</p>
            {benchmarks.annualSavings != null && (
              <p className="text-[11px] text-[var(--text-dim)]">Worst {benchmarks.worstCohort} vehicles by CPK priced at the fleet average over their measured tyre km, annualised.</p>
            )}
            <p className="text-xs text-[var(--text-muted)]">{t('fleetintel.benchmarks.estimatedSavings')}</p>
          </div>
          <div className="bg-[var(--input-bg)]/50 rounded-lg p-3 space-y-1.5">
            <p className="text-xs text-[var(--text-secondary)]">
              {t('fleetintel.benchmarks.fleetAvgCpkLabel')} <span className="font-mono font-semibold text-blue-300">{fmtCpk(benchmarks.fleetAvgCpk)}</span>
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {t('fleetintel.benchmarks.improvementDesc')}
            </p>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            {t('fleetintel.benchmarks.actionDesc')}
          </p>
        </motion.div>
      </div>

      <EmailReportModal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        reportTitle="Fleet Management Intelligence Report"
        pdfColumns={['Asset No', 'Site', 'Type', 'Changes', 'Total Cost', 'Avg CPK', 'High Risk', 'Status']}
        pdfRows={topByCost
          .map(v => [
            v.asset_no,
            v.site ?? 'N/A',
            v.vehicle_type ?? 'N/A',
            String(v.total_tyre_changes),
            fmtCurrency(v.total_tyre_cost, activeCurrency),
            fmtCpk(v.avg_cpk),
            String(v.high_risk_count),
            v.availability_status,
          ])}
        kpiSummary={{
          'Fleet Size': fmt(fleetAggs.fleet_size),
          'Fleet Availability': fleetAggs.availability_pct == null ? 'N/A' : `${fleetAggs.availability_pct.toFixed(1)}%`,
          'Available Vehicles': fmt(fleetAggs.available_count),
          'Total Downtime Hours': `${fmt(fleetAggs.total_downtime_hours)} hrs`,
          'Monthly Fleet Tyre Cost': fmtCurrency(fleetAggs.monthly_fleet_cost, activeCurrency),
          'Fleet Avg CPK': fmtCpk(fleetAggs.fleetAvgCpk),
          'Avg Cost per Vehicle': fmtCurrency(fleetAggs.avg_cost_per_vehicle, activeCurrency),
          'Potential Annual Savings': fmtCurrency(benchmarks.annualSavings, activeCurrency),
        }}
        period={`Period: ${periodLabel(period)}`}
      />
    </div>
  )
}
