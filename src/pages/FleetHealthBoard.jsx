import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import {
  Activity, AlertTriangle, CheckCircle, RefreshCw,
  Search, X, ChevronRight, Grid, List,
  Truck, MapPin, Globe, Shield, Circle,
  ExternalLink, Wrench, Clock, TrendingUp,
  BarChart2, Filter, Download, FileText,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toUserMessage } from '../lib/safeError'
import { fetchAllPages } from '../lib/fetchAll'
import { formatDate } from '../lib/formatters'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { compareValues } from '../lib/consoleTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import { useSettings } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import SectionTabs, { FLEET_TABS } from '../components/ui/SectionTabs'
import { useLanguage } from '../contexts/LanguageContext'
import {
  RISK_LEVELS, groupVehicles, enrichVehicle, matchesRiskFilter, matchesSearch, isVehicleHealthy,
  fleetHealthSummary, latestIssueDate, monthlyHealthTrend, criticalVehicles as buildCriticalList,
  assetRiskTrend, daysSince, vehicleExportRows, isRated,
} from '../lib/fleetHealthBoardAnalytics'

ChartJS.register(
  CategoryScale, LinearScale,
  LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
)

const TOUCH = 'min-h-[44px]'
const GRID_PAGE = 60

// ── Risk helpers (semantic colours: the colour carries the risk meaning) ──────
function riskColor(level) {
  return { Critical: '#dc2626', High: '#ea580c', Medium: '#ca8a04', Low: '#16a34a' }[level] ?? 'var(--text-dim)'
}

function riskBgClass(level) {
  return {
    Critical: 'bg-red-900/40 text-red-300 border-red-800/50',
    High:     'bg-orange-900/40 text-orange-300 border-orange-800/50',
    Medium:   'bg-yellow-900/40 text-yellow-300 border-yellow-800/50',
    Low:      'bg-green-900/40 text-green-300 border-green-800/50',
  }[level] ?? 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
}

function scoreColor(score) {
  if (score == null) return 'var(--text-muted)'
  if (score >= 80) return '#16a34a'
  if (score >= 60) return '#ca8a04'
  if (score >= 40) return '#ea580c'
  return '#dc2626'
}

function scoreBorderClass(score) {
  if (score == null) return 'border-[var(--border-bright)]'
  if (score >= 80) return 'border-green-700/40'
  if (score >= 60) return 'border-yellow-700/40'
  if (score >= 40) return 'border-orange-700/40'
  return 'border-red-700/40'
}

function fmtDate(d) {
  if (!d) return 'N/A'
  return formatDate(d, 'All', { day: '2-digit', month: 'short', year: 'numeric' })
}

function sortNullLast(rowA, rowB, id) {
  const a = rowA.getValue(id)
  const b = rowB.getValue(id)
  const ba = a == null || a === ''
  const bb = b == null || b === ''
  if (ba && bb) return 0
  if (ba) return 1
  if (bb) return -1
  return compareValues(a, b)
}

// ── Tyre position mini-diagram ────────────────────────────────────────────────
function TyrePositionDot({ tyre, position }) {
  const { t } = useLanguage()
  const [showTip, setShowTip] = useState(false)
  const label = tyre
    ? `${position}: ${tyre.risk_level ?? 'not rated'}, ${t('fleethealth.card.tread', { value: tyre.tread_depth != null ? `${tyre.tread_depth}mm` : 'N/A' })}`
    : `${position}: no tyre recorded`
  return (
    <div className="relative flex items-center justify-center">
      <div
        role="img"
        aria-label={label}
        title={label}
        className="w-4 h-4 rounded-full"
        style={{ backgroundColor: tyre ? riskColor(tyre.risk_level) : 'var(--text-dim)', opacity: tyre ? 1 : 0.35 }}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
      />
      {showTip && tyre && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 bg-[var(--surface-1)] border border-[var(--border-bright)] rounded-lg p-2 text-xs whitespace-nowrap shadow-xl pointer-events-none" aria-hidden="true">
          <p className="text-[var(--text-primary)] font-semibold">{position}</p>
          <p className="text-[var(--text-secondary)]">{t('fleethealth.card.tread', { value: tyre.tread_depth != null ? `${tyre.tread_depth}mm` : 'N/A' })}</p>
          <p style={{ color: riskColor(tyre.risk_level) }}>{tyre.risk_level ?? 'Not rated'}</p>
        </div>
      )}
    </div>
  )
}

function MiniTyreDiagram({ tyres }) {
  const frontLeft  = tyres.find(t => /FL|F1|steer.*l|left.*front/i.test(t.position ?? ''))
  const frontRight = tyres.find(t => /FR|F2|steer.*r|right.*front/i.test(t.position ?? ''))
  const rearSlots  = tyres.filter(t => !/FL|FR|F1|F2|steer/i.test(t.position ?? '')).slice(0, 4)
  while (rearSlots.length < 4) rearSlots.push(null)
  const posLabels = ['RL', 'RLO', 'RR', 'RRO']
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-4">
        <TyrePositionDot tyre={frontLeft} position={frontLeft?.position ?? 'FL'} />
        <TyrePositionDot tyre={frontRight} position={frontRight?.position ?? 'FR'} />
      </div>
      <div className="flex gap-1.5">
        {rearSlots.map((t, i) => <TyrePositionDot key={i} tyre={t} position={t?.position ?? posLabels[i]} />)}
      </div>
    </div>
  )
}

function HealthCircle({ score, size = 56 }) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const fill = ((score ?? 0) / 100) * circ
  const color = scoreColor(score)
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}
      role="img" aria-label={score == null ? 'Health not assessed' : `Health ${score} of 100`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--surface-2)' }} strokeWidth="4" />
        {score != null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4"
            strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.6s ease' }} />
        )}
      </svg>
      <span className="absolute text-xs font-bold" style={{ color }}>{score == null ? 'N/A' : score}</span>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="card animate-pulse" aria-hidden="true">
      <div className="flex items-start justify-between mb-3">
        <div className="h-5 w-24 bg-[var(--surface-2)] rounded" />
        <div className="h-4 w-16 bg-[var(--surface-2)] rounded-full" />
      </div>
      <div className="h-14 bg-[var(--surface-2)] rounded mt-2" />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FleetHealthBoard() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { activeCountry } = useSettings()

  const [rawRecords, setRawRecords]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [exportError, setExportError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [refreshing, setRefreshing]   = useState(false)
  // True when either read hit the 50,000-row ceiling (millions-row safety cap).
  const [capped, setCapped]           = useState(false)

  const [siteFilter, setSiteFilter]     = useState('All')
  const [countryFilter, setCountryFilter] = useState('All')
  const [riskFilter, setRiskFilter]     = useState('All')
  const [search, setSearch]             = useState('')
  const [viewMode, setViewMode]         = useState('grid')
  const [gridLimit, setGridLimit]       = useState(GRID_PAGE)

  const [selectedVehicle, setSelectedVehicle] = useState(null)
  const [drawerOpen, setDrawerOpen]           = useState(false)
  const [trendData, setTrendData]   = useState([])
  const reqIdRef = useRef(0)

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    const myReq = ++reqIdRef.current
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      // Active tyres (no removal km). Country scoped SERVER-SIDE, bounded by a
      // 50,000-row ceiling and a stable order so paging never drops a row.
      const { data, error: err, truncated: mainTruncated } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,asset_no,serial_number:serial_no,position,tread_depth,pressure_reading,risk_level,issue_date,km_at_fitment,km_at_removal,site,country,brand,size')
          .is('km_at_removal', null)
          .order('id', { ascending: false })
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      }, { max: 50000 })
      if (myReq !== reqIdRef.current) return
      if (err) throw err

      setRawRecords(data ?? [])
      setLastUpdated(new Date())

      // Anchor the 12-month trend to the data's latest issue_date (fallback today).
      const anchor = latestIssueDate(data ?? []) ?? new Date()
      const since = new Date(anchor.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const { data: trendRaw, error: trendErr, truncated: trendTruncated } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('issue_date,risk_level,asset_no')
          .gte('issue_date', since)
          .order('issue_date', { ascending: false })
          .order('id')
          .range(from, to)
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q
      }, { max: 50000 })
      if (myReq !== reqIdRef.current) return
      if (trendErr) throw trendErr
      setTrendData(trendRaw ?? [])
      setCapped(Boolean(mainTruncated) || Boolean(trendTruncated))
    } catch (e) {
      if (myReq === reqIdRef.current) setError(toUserMessage(e, 'Failed to load fleet data'))
    } finally {
      if (myReq === reqIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Escape, backdrop press and focus handling for the detail dialog live in
  // the shared Modal shell.

  // ── Derived ─────────────────────────────────────────────────────────────────
  const vehicleMap = useMemo(() => groupVehicles(rawRecords), [rawRecords])
  const vehicles = useMemo(() => [...vehicleMap.values()].map(enrichVehicle), [vehicleMap])

  const sites     = useMemo(() => ['All', ...[...new Set(vehicles.map(v => v.site).filter(Boolean))].sort()], [vehicles])
  const countries = useMemo(() => ['All', ...[...new Set(vehicles.map(v => v.country).filter(Boolean))].sort()], [vehicles])

  /**
   * THE VEHICLES EVERY FILTER EXCEPT THE RISK ONE LEAVES. Two KPI tiles report
   * on the risk dimension, so computed over the risk-filtered set they would
   * restate the board's own count. Site, country and search narrow both.
   */
  const scopedVehicles = useMemo(() => {
    return vehicles.filter(v => {
      if (siteFilter !== 'All' && v.site !== siteFilter) return false
      if (countryFilter !== 'All' && v.country !== countryFilter) return false
      return matchesSearch(v, search)
    })
  }, [vehicles, siteFilter, countryFilter, search])

  const filtered = useMemo(() => {
    return scopedVehicles
      .filter(v => matchesRiskFilter(v.worst, riskFilter))
      .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity) || String(a.asset_no).localeCompare(String(b.asset_no)))
  }, [scopedVehicles, riskFilter])

  useEffect(() => { setGridLimit(GRID_PAGE) }, [siteFilter, countryFilter, riskFilter, search])

  const scopeActive = siteFilter !== 'All' || countryFilter !== 'All' || riskFilter !== 'All' || !!search

  // ── KPIs: the scoped vehicles and their own tyres ─────────────────────────
  const kpis = useMemo(() => {
    const total = scopedVehicles.length
    const criticalVehicles = scopedVehicles.filter(v => v.tyres.some(t => t.risk_level === 'Critical')).length
    const scopedTyres = scopedVehicles.flatMap(v => v.tyres)
    const healthyVehicles = scopedVehicles.filter(v => isVehicleHealthy(v) === true).length
    const ratedVehicles = scopedVehicles.filter(v => isVehicleHealthy(v) != null).length
    return fleetHealthSummary({ total, criticalVehicles, healthyVehicles, ratedVehicles, scopedTyres })
  }, [scopedVehicles])

  // ── Trend ─────────────────────────────────────────────────────────────────
  const trend = useMemo(() => monthlyHealthTrend(trendData, latestIssueDate(trendData) ?? new Date()), [trendData])
  const trendHasData = trend.values.some(v => v != null)
  const trendChartData = useMemo(() => {
    const c = colorAt(1)
    return {
      labels: trend.months.map(m => {
        const [y, mo] = m.split('-')
        return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' })
      }),
      datasets: [{
        label: t('fleethealth.trend.seriesLabel'),
        data: trend.values,
        borderColor: c,
        backgroundColor: withAlpha(c, 0.12),
        fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: c, spanGaps: true,
      }],
    }
  }, [trend, t])

  const TICK = { color: 'var(--text-muted)', font: { size: 10 } }
  const GRID = { color: 'var(--panel-2)' }
  const trendOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1,
        titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)',
        callbacks: { label: ctx => ` ${ctx.parsed.y ?? 'N/A'}% of rated vehicles healthy` },
      },
    },
    scales: {
      x: { ticks: TICK, grid: GRID },
      y: { ticks: { ...TICK, callback: v => `${v}%` }, grid: GRID, min: 0, max: 100 },
    },
  }

  const criticalList = useMemo(() => buildCriticalList(scopedVehicles), [scopedVehicles])

  // ── Drawer ─────────────────────────────────────────────────────────────────
  const drawerVehicle = useMemo(() => {
    if (!selectedVehicle) return null
    const v = vehicles.find(x => x.asset_no === selectedVehicle)
    if (!v) return null
    return { ...v, tyres: [...v.tyres].sort((a, b) => String(a.position ?? '').localeCompare(String(b.position ?? ''))) }
  }, [selectedVehicle, vehicles])

  const drawerTrend = useMemo(() => (selectedVehicle ? assetRiskTrend(trendData, selectedVehicle) : []), [selectedVehicle, trendData])
  const drawerTrendData = useMemo(() => {
    if (drawerTrend.length < 2) return null
    const c = colorAt(2)
    return {
      labels: drawerTrend.map(p => p.date),
      datasets: [{ label: t('fleethealth.drawer.riskIndexSeriesLabel'), data: drawerTrend.map(p => p.value), borderColor: c, backgroundColor: withAlpha(c, 0.1), fill: true, tension: 0.35, pointRadius: 3 }],
    }
  }, [drawerTrend, t])

  function openDrawer(assetNo) {
    setSelectedVehicle(assetNo)
    setDrawerOpen(true)
  }

  function clearFilters() {
    setSiteFilter('All'); setCountryFilter('All'); setRiskFilter('All'); setSearch('')
  }

  // ── Exports ─────────────────────────────────────────────────────────────────
  const EXPORT_COLS = [
    { key: 'asset_no', header: 'Asset' }, { key: 'site', header: 'Site' }, { key: 'country', header: 'Country' },
    { key: 'health', header: 'Health score' }, { key: 'worst', header: 'Worst risk' },
    { key: 'critical', header: 'Critical' }, { key: 'high', header: 'High' }, { key: 'medium', header: 'Medium' },
    { key: 'low', header: 'Low' }, { key: 'unrated', header: 'Not rated' }, { key: 'tyres', header: 'Active tyres' },
    { key: 'avgTread', header: 'Avg tread (mm)' }, { key: 'lastIssue', header: 'Last tyre fitted' },
  ]
  const scopeLabel = [activeCountry !== 'All' ? activeCountry : 'All countries', siteFilter !== 'All' ? siteFilter : null, riskFilter !== 'All' ? `${riskFilter} risk` : null].filter(Boolean).join(' ')

  async function doExport(kind) {
    setExportError('')
    try {
      const rows = vehicleExportRows(filtered)
      const file = reportFileName('TyrePulse Fleet Health', scopeLabel)
      if (kind === 'excel') await exportToExcel(rows, EXPORT_COLS.map(c => c.key), EXPORT_COLS.map(c => c.header), file)
      else await exportToPdf(rows, EXPORT_COLS, `Fleet Health Board: ${scopeLabel}`, file, 'landscape')
    } catch (e) {
      setExportError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // ── List view columns ───────────────────────────────────────────────────────
  const countCell = (level) => ({ row }) => {
    const n = row.original.counts[level]
    return n > 0
      ? <span className={`badge border ${riskBgClass(level)}`}>{n}</span>
      : <span className="text-[var(--text-dim)]">0</span>
  }
  const listColumns = [
    { id: 'asset_no', header: t('fleethealth.list.columns.asset'), accessorFn: v => v.asset_no, size: 120, sortingFn: sortNullLast,
      cell: ({ row }) => <span className="font-semibold text-[var(--text-primary)]">{row.original.asset_no}</span> },
    { id: 'site', header: t('fleethealth.list.columns.site'), accessorFn: v => v.site ?? undefined, sortUndefined: 'last', size: 120, cell: ({ getValue }) => getValue() ?? 'N/A' },
    { id: 'country', header: t('fleethealth.list.columns.country'), accessorFn: v => v.country ?? undefined, sortUndefined: 'last', size: 100, cell: ({ getValue }) => getValue() ?? 'N/A' },
    { id: 'score', header: t('fleethealth.list.columns.health'), accessorFn: v => v.score ?? undefined, sortUndefined: 'last', size: 100,
      meta: { align: 'right', exportValue: v => v.score ?? 'Not assessed' },
      cell: ({ row }) => <span className="font-bold tabular-nums" style={{ color: scoreColor(row.original.score) }}>{row.original.score == null ? 'Not assessed' : `${row.original.score}%`}</span> },
    { id: 'worst', header: 'Worst risk', accessorFn: v => v.worst ?? undefined, sortUndefined: 'last', size: 110,
      meta: { exportValue: v => v.worst ?? 'Not rated' },
      cell: ({ row }) => row.original.worst
        ? <span className={`badge border text-xs ${riskBgClass(row.original.worst)}`}>{row.original.worst}</span>
        : <span className="text-[var(--text-muted)] text-xs">Not rated</span> },
    { id: 'critical', header: t('fleethealth.list.columns.critical'), accessorFn: v => v.counts.Critical, size: 90, meta: { align: 'right' }, cell: countCell('Critical') },
    { id: 'high', header: t('fleethealth.list.columns.high'), accessorFn: v => v.counts.High, size: 80, meta: { align: 'right' }, cell: countCell('High') },
    { id: 'medium', header: t('fleethealth.list.columns.medium'), accessorFn: v => v.counts.Medium, size: 90, meta: { align: 'right' }, cell: countCell('Medium') },
    { id: 'low', header: t('fleethealth.list.columns.low'), accessorFn: v => v.counts.Low, size: 80, meta: { align: 'right' }, cell: countCell('Low') },
    { id: 'avgTread', header: t('fleethealth.list.columns.avgTread'), accessorFn: v => v.avgTread ?? undefined, sortUndefined: 'last', size: 110,
      meta: { align: 'right', exportValue: v => (v.avgTread == null ? 'N/A' : v.avgTread.toFixed(1)) },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)]">{row.original.avgTread == null ? 'N/A' : `${row.original.avgTread.toFixed(1)}mm`}</span> },
    { id: 'lastIssue', header: t('fleethealth.list.columns.lastTyre'), accessorFn: v => v.lastIssue ?? undefined, sortUndefined: 'last', size: 130,
      cell: ({ row }) => <span className="text-xs text-[var(--text-muted)]">{fmtDate(row.original.lastIssue)}</span> },
  ]

  const tyreColumns = [
    { id: 'position', header: t('fleethealth.drawer.tyreColumns.position'), accessorFn: r => r.position ?? undefined, sortUndefined: 'last', size: 90,
      cell: ({ getValue }) => <span className="font-mono">{getValue() ?? 'N/A'}</span> },
    { id: 'serial', header: t('fleethealth.drawer.tyreColumns.serial'), accessorFn: r => r.serial_number ?? undefined, sortUndefined: 'last', size: 120,
      cell: ({ getValue }) => <span className="font-mono">{getValue() ?? 'N/A'}</span> },
    { id: 'brand', header: t('fleethealth.drawer.tyreColumns.brand'), accessorFn: r => r.brand ?? undefined, sortUndefined: 'last', size: 100, cell: ({ getValue }) => getValue() ?? 'N/A' },
    { id: 'size', header: t('fleethealth.drawer.tyreColumns.size'), accessorFn: r => r.size ?? undefined, sortUndefined: 'last', size: 110, cell: ({ getValue }) => getValue() ?? 'N/A' },
    { id: 'tread', header: t('fleethealth.drawer.tyreColumns.tread'), accessorFn: r => (r.tread_depth == null ? undefined : Number(r.tread_depth)), sortUndefined: 'last', size: 80,
      meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? 'N/A' : `${getValue()}mm`) },
    { id: 'pressure', header: t('fleethealth.drawer.tyreColumns.pressure'), accessorFn: r => (r.pressure_reading == null ? undefined : Number(r.pressure_reading)), sortUndefined: 'last', size: 90,
      meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? 'N/A' : getValue()) },
    { id: 'risk', header: t('fleethealth.drawer.tyreColumns.risk'), accessorFn: r => r.risk_level ?? undefined, sortUndefined: 'last', size: 100,
      cell: ({ row }) => isRated(row.original)
        ? <span className={`badge border text-xs ${riskBgClass(row.original.risk_level)}`}>{row.original.risk_level}</span>
        : <span className="text-[var(--text-muted)] text-xs">Not rated</span> },
    { id: 'fitted', header: t('fleethealth.drawer.tyreColumns.fitted'), accessorFn: r => daysSince(r.issue_date, new Date()) ?? undefined, sortUndefined: 'last', size: 90,
      meta: { align: 'right', exportValue: r => daysSince(r.issue_date, new Date()) ?? 'N/A' },
      cell: ({ getValue }) => <span className="text-[var(--text-muted)] inline-flex items-center gap-1"><Clock size={10} aria-hidden="true" />{getValue() == null ? 'N/A' : `${getValue()}d`}</span> },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <SectionTabs tabs={FLEET_TABS} />
        <PageHeader title={t('fleethealth.header.title')} subtitle={t('fleethealth.header.loading')} icon={Activity} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="card animate-pulse h-24" />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <SectionTabs tabs={FLEET_TABS} />
        <PageHeader title={t('fleethealth.header.title')} icon={Activity} />
        <div role="alert" className="card flex flex-col items-center justify-center min-h-64 gap-4 text-center">
          <AlertTriangle size={40} className="text-red-400" aria-hidden="true" />
          <p className="text-red-300 font-medium">{error}</p>
          <button type="button" onClick={() => load()} className={`btn-primary flex items-center gap-2 px-4 ${TOUCH}`}>
            <RefreshCw size={14} aria-hidden="true" /> {t('fleethealth.actions.retry')}
          </button>
        </div>
      </div>
    )
  }

  const fmtPctOrNA = (v) => (v == null ? 'N/A' : `${v}%`)

  return (
    <div className="space-y-6">
      <SectionTabs tabs={FLEET_TABS} />
      <PageHeader
        title={t('fleethealth.header.title')}
        subtitle={`${t('fleethealth.header.subtitle')}${lastUpdated ? t('fleethealth.header.updated', { time: lastUpdated.toLocaleTimeString() }) : ''}`}
        icon={Activity}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} disabled={!filtered.length}
              className={`btn-secondary flex items-center gap-1.5 text-sm px-3 ${TOUCH} disabled:opacity-40`}>
              <Download size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} disabled={!filtered.length}
              className={`btn-secondary flex items-center gap-1.5 text-sm px-3 ${TOUCH} disabled:opacity-40`}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={() => load(true)} disabled={refreshing}
              className={`btn-secondary flex items-center gap-2 text-sm px-3 ${TOUCH}`}>
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
              {t('fleethealth.actions.refresh')}
            </button>
          </div>
        }
      />

      {exportError && <p role="alert" className="text-sm text-red-400">{exportError}</p>}

      {/* ── KPI Bar ── */}
      <section aria-label="Fleet health KPIs" className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={t('fleethealth.kpi.fleetHealthScore')}
          value={fmtPctOrNA(kpis.fleetHealth)}
          sub={kpis.fleetHealth == null ? `No rated tyres on ${kpis.total} vehicles` : `${kpis.ratedVehicles} of ${kpis.total} vehicles rated`}
          icon={Shield}
          color={kpis.fleetHealth == null ? 'neutral' : kpis.fleetHealth >= 70 ? 'green' : kpis.fleetHealth >= 40 ? 'yellow' : 'red'}
        />
        <KpiCard
          label={t('fleethealth.kpi.criticalVehicles')}
          value={kpis.ratedVehicles === 0 ? 'N/A' : kpis.criticalVehicles}
          sub={kpis.ratedVehicles === 0 ? 'No risk ratings recorded' : t('fleethealth.kpi.criticalVehiclesSub')}
          icon={AlertTriangle}
          color={kpis.ratedVehicles === 0 ? 'neutral' : kpis.criticalVehicles > 0 ? 'red' : 'green'}
        />
        <KpiCard
          label={t('fleethealth.kpi.atRiskTyres')}
          value={kpis.atRiskCount == null ? 'N/A' : kpis.atRiskCount}
          sub={kpis.atRiskCount == null ? `0 of ${kpis.tyreCount} tyres rated` : `${t('fleethealth.kpi.atRiskTyresSub')}, ${kpis.ratedTyres} rated`}
          icon={Circle}
          color={kpis.atRiskCount == null ? 'neutral' : kpis.atRiskCount > 0 ? 'orange' : 'green'}
        />
        <KpiCard
          label={t('fleethealth.kpi.avgTreadDepth')}
          value={kpis.avgTread == null ? 'N/A' : `${kpis.avgTread}mm`}
          sub={kpis.avgTread == null ? 'No tread depth recorded' : `${kpis.treadCount} of ${kpis.tyreCount} tyres measured`}
          icon={BarChart2}
          color={kpis.avgTread == null ? 'neutral' : 'blue'}
        />
      </section>
      {scopeActive && (
        <p className="text-xs text-[var(--text-muted)] -mt-2">
          These figures cover the {kpis.total} vehicle{kpis.total === 1 ? '' : 's'} matching your filters, of {vehicles.length} in this view. The risk filter is held out so the risk tiles stay a target you can aim at.
        </p>
      )}

      {capped && (
        <div role="status" className="card py-2.5 flex items-center gap-2 border-yellow-700/40 bg-yellow-950/15">
          <AlertTriangle size={14} className="text-yellow-400 shrink-0" aria-hidden="true" />
          <p className="text-xs text-yellow-200/80">
            Capped view: showing the most recent 50,000 tyre records for this country. Narrow the country for the full dataset.
          </p>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ── Board ── */}
        <div className="flex-1 min-w-0 space-y-4">
          <section aria-label="Filters" className="card">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-3 lg:items-center">
              <div className="relative sm:col-span-2 lg:flex-1 lg:min-w-48">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search vehicles"
                  className={`input pl-8 w-full text-sm ${TOUCH}`}
                  placeholder={t('fleethealth.filters.searchPlaceholder')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button type="button" aria-label="Clear search" onClick={() => setSearch('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </div>
              <label className="flex items-center gap-1.5">
                <MapPin size={13} className="text-[var(--text-muted)]" aria-hidden="true" />
                <span className="sr-only">Site</span>
                <select className={`input text-sm w-full ${TOUCH}`} value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
                  {sites.map(s => <option key={s} value={s}>{s === 'All' ? 'All sites' : s}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <Globe size={13} className="text-[var(--text-muted)]" aria-hidden="true" />
                <span className="sr-only">Country</span>
                <select className={`input text-sm w-full ${TOUCH}`} value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
                  {countries.map(c => <option key={c} value={c}>{c === 'All' ? 'All countries' : c}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <Filter size={13} className="text-[var(--text-muted)]" aria-hidden="true" />
                <span className="sr-only">Risk</span>
                <select className={`input text-sm w-full ${TOUCH}`} value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
                  {['All', ...RISK_LEVELS, 'Unrated'].map(r => (
                    <option key={r} value={r}>{r === 'All' ? 'All risk levels' : r === 'Unrated' ? 'Not rated' : `${r}${r === 'Low' ? '' : ' or worse'}`}</option>
                  ))}
                </select>
              </label>
              <div className="flex bg-[var(--surface-2)] rounded-lg border border-[var(--border-bright)] overflow-hidden lg:ml-auto w-fit" role="group" aria-label="View">
                <button type="button" aria-label="Card view" aria-pressed={viewMode === 'grid'} onClick={() => setViewMode('grid')}
                  className={`w-11 h-11 flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-green-700 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                  <Grid size={14} aria-hidden="true" />
                </button>
                <button type="button" aria-label="List view" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}
                  className={`w-11 h-11 flex items-center justify-center transition-colors ${viewMode === 'list' ? 'bg-green-700 text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                  <List size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            {scopeActive && (
              <p className="text-xs text-green-500 mt-2" role="status">
                {t('fleethealth.filters.matchingCount', { filtered: filtered.length, total: vehicles.length })}
              </p>
            )}
          </section>

          {filtered.length === 0 && (
            <div className="card flex flex-col items-center justify-center py-16 gap-3 text-center">
              <Truck size={40} className="text-[var(--text-dim)]" aria-hidden="true" />
              <p className="text-[var(--text-secondary)] font-medium">
                {vehicles.length === 0 ? 'No active tyres recorded for this country' : t('fleethealth.empty.noMatch')}
              </p>
              {vehicles.length > 0 && (
                <>
                  <p className="text-[var(--text-muted)] text-sm">{t('fleethealth.empty.tryAdjusting')}</p>
                  <button type="button" onClick={clearFilters} className={`btn-secondary text-sm px-4 ${TOUCH}`}>{t('fleethealth.empty.clearFilters')}</button>
                </>
              )}
            </div>
          )}

          {viewMode === 'grid' && filtered.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <AnimatePresence mode="popLayout">
                  {filtered.slice(0, gridLimit).map(v => (
                    <motion.div key={v.asset_no} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                      <VehicleCard vehicle={v} onClick={() => openDrawer(v.asset_no)} isSelected={selectedVehicle === v.asset_no && drawerOpen} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              {filtered.length > gridLimit && (
                <div className="flex flex-col items-center gap-1">
                  <button type="button" onClick={() => setGridLimit(n => n + GRID_PAGE)} className={`btn-secondary text-sm px-4 ${TOUCH}`}>
                    Show {Math.min(GRID_PAGE, filtered.length - gridLimit)} more
                  </button>
                  <p className="text-xs text-[var(--text-muted)]">Showing {gridLimit} of {filtered.length}. The list view pages and sorts the whole set.</p>
                </div>
              )}
            </>
          )}

          {viewMode === 'list' && filtered.length > 0 && (
            <div className="card">
              <EnterpriseTable
                columns={listColumns}
                data={filtered}
                getRowId={v => String(v.asset_no)}
                enableColumnFilters={false}
                enableGlobalFilter={false}
                initialPageSize={25}
                onRowClick={v => openDrawer(v.asset_no)}
                exportFileName={reportFileName('TyrePulse Fleet Health', scopeLabel)}
                reportMeta={{ title: 'Fleet health board' }}
                emptyMessage={t('fleethealth.empty.noMatch')}
              />
            </div>
          )}

          <section aria-labelledby="fhb-trend-h" className="card">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <TrendingUp size={16} className="text-green-400" aria-hidden="true" />
              <h2 id="fhb-trend-h" className="text-base font-semibold text-[var(--text-primary)]">{t('fleethealth.trend.title')}</h2>
              <span className="text-xs text-[var(--text-muted)]">Share of rated vehicles with no High or Critical tyre</span>
            </div>
            {trendHasData ? (
              <div className="h-48">
                <Line data={trendChartData} options={trendOpts} role="img" aria-label="Line chart of the monthly share of rated vehicles with no high or critical tyre" />
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)] py-10 text-center">Not measured: no tyre in the last 12 months carries a risk level.</p>
            )}
          </section>
        </div>

        {/* ── Critical alerts ── */}
        <aside aria-labelledby="fhb-crit-h" className="lg:w-64 xl:w-72 shrink-0">
          <div className="card lg:max-h-[calc(100vh-12rem)] overflow-y-auto">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={15} className="text-red-400" aria-hidden="true" />
              <h2 id="fhb-crit-h" className="text-sm font-semibold text-[var(--text-primary)]">{t('fleethealth.sidebar.criticalAlerts')}</h2>
              {criticalList.length > 0 && (
                <span className="ml-auto bg-red-900/50 text-red-300 text-xs px-2 py-0.5 rounded-full border border-red-800/50">{criticalList.length}</span>
              )}
            </div>
            {kpis.ratedVehicles === 0 ? (
              <p className="text-xs text-[var(--text-muted)] py-6 text-center">No tyre in this view carries a risk level, so no critical alert can be raised.</p>
            ) : criticalList.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle size={28} className="text-green-500" aria-hidden="true" />
                <p className="text-green-400 text-sm font-medium">{t('fleethealth.sidebar.noCriticalAlerts')}</p>
                <p className="text-[var(--text-muted)] text-xs">{t('fleethealth.sidebar.allSafe')}</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {criticalList.map(v => (
                  <li key={v.asset_no}>
                    <button type="button" onClick={() => openDrawer(v.asset_no)}
                      className="w-full text-left bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2.5 hover:border-red-700/60 transition-colors group focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500">
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--text-primary)] font-semibold text-sm">{v.asset_no}</span>
                        <ChevronRight size={12} className="text-[var(--text-dim)] group-hover:text-[var(--text-primary)]" aria-hidden="true" />
                      </div>
                      <p className="text-[var(--text-secondary)] text-xs mt-0.5">{v.site ?? 'N/A'}, {v.country ?? 'N/A'}</p>
                      <p className="text-red-400 text-xs mt-1">
                        {v.worstTread != null
                          ? t('fleethealth.sidebar.treadAt', { mm: v.worstTread, position: v.worstPos ?? t('fleethealth.sidebar.na') })
                          : `Critical tyre at ${v.worstPos ?? 'unknown position'}, tread not recorded`}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {/* ── Detail dialog ── */}
      <Modal
        open={!!(drawerOpen && drawerVehicle)}
        onClose={() => setDrawerOpen(false)}
        size="lg"
        title={drawerVehicle ? (
          <span className="flex items-center gap-2">
            <Truck size={18} className="text-green-400" aria-hidden="true" />
            {drawerVehicle.asset_no}
          </span>
        ) : null}
        subtitle={drawerVehicle ? `${drawerVehicle.site ?? 'N/A'}, ${drawerVehicle.country ?? 'N/A'}. ${drawerVehicle.rated} of ${drawerVehicle.tyres.length} tyres rated.` : null}
        headerExtra={drawerVehicle ? <HealthCircle score={drawerVehicle.score} size={52} /> : null}
      >
        {drawerVehicle && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">{t('fleethealth.drawer.activeTyres')}</h3>
                  <EnterpriseTable
                    columns={tyreColumns}
                    data={drawerVehicle.tyres}
                    getRowId={r => String(r.id)}
                    enableColumnFilters={false}
                    enableGlobalFilter={false}
                    enableColumnVisibility={false}
                    initialPageSize={25}
                    exportFileName={reportFileName('TyrePulse Active Tyres', drawerVehicle.asset_no)}
                    reportMeta={{ title: `Active tyres ${drawerVehicle.asset_no}` }}
                    emptyMessage="No active tyre recorded."
                  />
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-2">{t('fleethealth.drawer.riskIndexTrend')}</h3>
                  {drawerTrendData ? (
                    <div className="bg-[var(--surface-1)] rounded-lg border border-[var(--border-dim)] p-3 h-36">
                      <Line
                        data={drawerTrendData}
                        role="img"
                        aria-label={`Risk index trend for ${drawerVehicle.asset_no}`}
                        options={{
                          responsive: true, maintainAspectRatio: false,
                          plugins: { legend: { display: false } },
                          scales: {
                            x: { ticks: { color: 'var(--text-muted)', font: { size: 9 } }, grid: GRID },
                            y: {
                              ticks: {
                                color: 'var(--text-muted)', font: { size: 9 },
                                callback: v => (v === 0 ? t('fleethealth.drawer.riskAxis.critical') : v === 33 ? t('fleethealth.drawer.riskAxis.high') : v === 66 ? t('fleethealth.drawer.riskAxis.medium') : t('fleethealth.drawer.riskAxis.low')),
                              },
                              grid: GRID, min: 0, max: 100,
                            },
                          },
                        }}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--text-muted)]">Fewer than two rated readings in the last 12 months.</p>
                  )}
                </div>

                <div className="space-y-3 pt-1">
                  <button type="button" onClick={() => navigate(`/asset-management/${encodeURIComponent(drawerVehicle.asset_no)}`)}
                    className={`w-full btn-primary flex items-center justify-center gap-2 text-sm ${TOUCH}`}>
                    <Truck size={13} aria-hidden="true" /> {t('assetmgmt.detail.openAssetProfile')}
                  </button>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button type="button" onClick={() => navigate(`/vehicle-history?asset=${encodeURIComponent(drawerVehicle.asset_no)}`)}
                      className={`flex-1 btn-secondary flex items-center justify-center gap-2 text-sm ${TOUCH}`}>
                      <ExternalLink size={13} aria-hidden="true" /> {t('fleethealth.drawer.viewInTyreRecords')}
                    </button>
                    <button type="button" onClick={() => navigate(`/work-orders?asset=${encodeURIComponent(drawerVehicle.asset_no)}`)}
                      className={`flex-1 btn-secondary flex items-center justify-center gap-2 text-sm ${TOUCH}`}>
                      <Wrench size={13} aria-hidden="true" /> {t('fleethealth.drawer.createWorkOrder')}
                    </button>
                  </div>
                </div>
              </div>
        )}
      </Modal>
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color }) {
  const colors = {
    green:   { value: 'text-green-400',  bg: 'bg-green-900/20' },
    yellow:  { value: 'text-yellow-400', bg: 'bg-yellow-900/20' },
    red:     { value: 'text-red-400',    bg: 'bg-red-900/20' },
    orange:  { value: 'text-orange-400', bg: 'bg-orange-900/20' },
    blue:    { value: 'text-blue-400',   bg: 'bg-blue-900/20' },
    neutral: { value: 'text-[var(--text-primary)]', bg: 'bg-[var(--surface-2)]' },
  }
  const c = colors[color] ?? colors.neutral
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[var(--text-secondary)] text-xs uppercase tracking-wide font-medium">{label}</p>
          <p className={`text-2xl font-bold mt-1 tabular-nums ${c.value}`}>{value}</p>
          {sub && <p className="text-[var(--text-muted)] text-xs mt-0.5">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg ${c.bg}`}>
          <Icon size={18} className={c.value} aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}

// ── Vehicle Card ──────────────────────────────────────────────────────────────
function VehicleCard({ vehicle, onClick, isSelected }) {
  const { t } = useLanguage()
  const { asset_no, site, country, tyres, score, worst, lastIssue } = vehicle
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${asset_no}, health ${score == null ? 'not assessed' : `${score} of 100`}, worst risk ${worst ?? 'not rated'}. Open details`}
      className={`card w-full text-left transition-all duration-200 border ${scoreBorderClass(score)} ${isSelected ? 'ring-1 ring-green-500/50' : ''} focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-500`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[var(--text-primary)] font-bold text-base leading-tight">{asset_no}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {site && <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)] bg-[var(--surface-2)] rounded px-1.5 py-0.5"><MapPin size={9} aria-hidden="true" />{site}</span>}
            {country && <span className="flex items-center gap-1 text-xs text-[var(--text-muted)] bg-[var(--surface-2)] rounded px-1.5 py-0.5"><Globe size={9} aria-hidden="true" />{country}</span>}
          </div>
        </div>
        <HealthCircle score={score} size={48} />
      </div>
      {tyres.length > 0 ? (
        <div className="flex justify-center py-2"><MiniTyreDiagram tyres={tyres} /></div>
      ) : (
        <div className="flex items-center justify-center py-4"><span className="text-[var(--text-muted)] text-xs">{t('fleethealth.card.noTyreData')}</span></div>
      )}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border-dim)] gap-2">
        <span className="text-[var(--text-muted)] text-xs">{t('fleethealth.card.tyresCount', { count: tyres.length })}</span>
        {worst
          ? <span className={`badge border text-xs ${riskBgClass(worst)}`}>{worst}</span>
          : <span className="text-[var(--text-muted)] text-xs">Not rated</span>}
        <span className="text-[var(--text-muted)] text-xs">{lastIssue ? formatDate(lastIssue, 'All', { day: '2-digit', month: 'short' }) : 'N/A'}</span>
      </div>
      <div className="flex items-center justify-end mt-2 gap-1 text-[var(--text-muted)]">
        <span className="text-xs">{t('fleethealth.card.details')}</span>
        <ChevronRight size={11} aria-hidden="true" />
      </div>
    </button>
  )
}
