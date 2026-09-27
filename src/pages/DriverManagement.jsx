import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  User, Users, TrendingUp, TrendingDown, Award, AlertTriangle,
  BarChart2, FileText, FileSpreadsheet, Search, Filter,
  X, ChevronDown, ChevronUp, RefreshCw, Eye, Calendar, Percent, Wallet, ShieldAlert,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useFilterState } from '../hooks/useFilterState'
import { useScrollRestore } from '../hooks/useScrollRestore'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  DATE_PRESETS, applyDatePreset, filterDriverRecords, aggregateDrivers,
  orderDrivers, driverKpis, performanceBand,
} from '../lib/driverManagementAnalytics'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

// ── Constants ──────────────────────────────────────────────────────────────────
// Marks a hand-typed date range in the URL. It cannot be the empty string:
// useFilterState drops a param whose value is blank, which would silently put
// the window back on the default preset.
const CUSTOM_PRESET = 'custom'

// ── Formatting ─────────────────────────────────────────────────────────────────
function fmtCpk(v, currency) {
  if (v == null || !Number.isFinite(v) || v <= 0) return 'N/A'
  return `${currency} ${v.toFixed(4)}`
}
function fmtCurrency(v, currency) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${currency} ${Math.round(v).toLocaleString()}`
}
function fmtKm(v) {
  if (v == null || !Number.isFinite(v) || v === 0) return 'N/A'
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k km`
  return `${Math.round(v).toLocaleString()} km`
}
function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${v.toFixed(1)}%`
}

// Semantic performance colours (meaning-bearing, deliberately not palettized).
const BAND_CLS = {
  excellent: 'bg-green-500/20 text-green-400 border-green-500/30',
  good: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  average: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  poor: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  unrated: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}
function riskScoreColor(score) {
  if (score <= 20) return '#10b981'
  if (score <= 40) return '#3b82f6'
  if (score <= 60) return '#f59e0b'
  if (score <= 80) return '#f97316'
  return '#ef4444'
}
function cpkColor(cpk) {
  if (cpk == null || !Number.isFinite(cpk) || cpk <= 0) return 'text-[var(--text-muted)]'
  if (cpk <= 1.0) return 'text-green-400'
  if (cpk <= 2.0) return 'text-yellow-400'
  return 'text-red-400'
}

const SORT_OPTIONS = [
  { value: 'riskScore', label: 'Risk score' },
  { value: 'avgCpk', label: 'Avg CPK' },
  { value: 'failureRate', label: 'Failure rate' },
  { value: 'totalCost', label: 'Tyre cost' },
  { value: 'totalTyres', label: 'Tyres' },
  { value: 'avgTyreLife', label: 'Avg life' },
  { value: 'name', label: 'Driver name' },
]

function barOptions(horizontal = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
      y: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
    },
  }
}

function KpiCard({ icon: Icon, label, value, sub, tone = 'text-[var(--text-primary)]', loading }) {
  return (
    <div className="card flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-[var(--input-bg)] border border-[var(--input-border)]">
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[var(--text-muted)] mb-0.5">{label}</p>
        {loading
          ? <div className="h-6 w-24 bg-[var(--input-bg)] rounded animate-pulse" />
          : <p className={`text-lg font-bold truncate tabular-nums ${tone}`}>{value}</p>}
        {sub && !loading && <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate" title={sub}>{sub}</p>}
      </div>
    </div>
  )
}

function RiskBar({ score }) {
  if (score == null) return <span className="text-[11px] text-[var(--text-muted)]">Not rated</span>
  const color = riskScoreColor(score)
  return (
    <div className="flex items-center gap-2 min-w-[80px]" aria-label={`Risk score ${score} of 100`}>
      <div className="flex-1 h-1.5 bg-[var(--input-border)] rounded-full overflow-hidden" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-[11px] font-mono tabular-nums" style={{ color }}>{score}</span>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function DriverManagement() {
  const navigate = useNavigate()
  const { activeCurrency, activeCountry } = useSettings()

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [exportError, setExportError] = useState('')

  // Search, site, country, date window and default order live in the URL
  // (useFilterState) so they SURVIVE opening a driver and pressing Back.
  const [filters, setFilter, , , setFilters] = useFilterState({
    search: '', site: 'all', country: 'all',
    preset: '1yr', from: '', to: '',
    sort: 'riskScore', dir: 'asc',
  })
  const searchQuery = filters.search
  const siteFilter = filters.site
  const countryFilter = filters.country
  const datePreset = filters.preset
  // A named preset owns the window, so a restored link shows "the last year"
  // rather than a year frozen to the day it was copied. CUSTOM_PRESET marks a
  // hand-typed range, which uses the stored dates verbatim.
  const presetDef = DATE_PRESETS.find((p) => p.label === datePreset)
  const presetWindow = useMemo(
    () => applyDatePreset(presetDef ? presetDef.days : 365),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datePreset],
  )
  const dateFrom = presetDef ? presetWindow.from : filters.from
  const dateTo = presetDef ? presetWindow.to : filters.to
  const [showFilters, setShowFilters] = useState(
    () => filters.site !== 'all' || filters.country !== 'all' || !presetDef,
  )

  const sortCol = SORT_OPTIONS.some((o) => o.value === filters.sort) ? filters.sort : 'riskScore'
  const sortDir = filters.dir === 'desc' ? 'desc' : 'asc'
  const listRef = useScrollRestore('driver-management', !loading && records.length > 0)
  const reqIdRef = useRef(0)

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      // BOUNDED: tyre_records is a large table. Cap at 20,000 with a stable id
      // order (a paged read without an ORDER can drop/repeat rows) and surface a
      // "capped view" note when the ceiling is hit.
      const { data, error: err, truncated: tr } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select(
            'id,asset_no,asset_number,serial_no,brand,site,country,driver_name,driver_id,' +
            'cost_per_tyre,qty,km_at_fitment,km_at_removal,risk_level,removal_reason,issue_date,category'
          )
          .order('id')
        if (activeCountry && activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      }, { max: 20000 })
      if (myReq !== reqIdRef.current) return
      if (err) throw err
      setRecords(data || [])
      setTruncated(!!tr)
    } catch (e) {
      if (myReq === reqIdRef.current) setError(toUserMessage(e, 'Failed to load driver data'))
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const uniqueSites = useMemo(() => [...new Set(records.map((r) => r.site).filter(Boolean))].sort(), [records])
  const uniqueCountries = useMemo(() => [...new Set(records.map((r) => r.country).filter(Boolean))].sort(), [records])

  const filteredRecords = useMemo(
    () => filterDriverRecords(records, { site: siteFilter, country: countryFilter, from: dateFrom, to: dateTo }),
    [records, siteFilter, countryFilter, dateFrom, dateTo],
  )
  const allDrivers = useMemo(() => aggregateDrivers(filteredRecords), [filteredRecords])
  const visibleDrivers = useMemo(
    () => orderDrivers(allDrivers, { search: searchQuery, sort: sortCol, dir: sortDir }),
    [allDrivers, searchQuery, sortCol, sortDir],
  )
  const kpis = useMemo(() => driverKpis(visibleDrivers, filteredRecords.length), [visibleDrivers, filteredRecords.length])
  const unknown = loading || !!error

  const cpkChartData = useMemo(() => {
    const top10 = allDrivers.filter((d) => d.avgCpk != null && d.avgCpk > 0).sort((a, b) => a.avgCpk - b.avgCpk).slice(0, 10)
    return {
      labels: top10.map((d) => (d.name.length > 14 ? `${d.name.slice(0, 14)}...` : d.name)),
      datasets: [{
        label: `Avg CPK (${activeCurrency})`,
        data: top10.map((d) => Number(d.avgCpk.toFixed(4))),
        backgroundColor: top10.map((_, i) => withAlpha(colorAt(i), 0.8)),
        borderColor: top10.map((_, i) => colorAt(i)),
        borderWidth: 1,
        borderRadius: 4,
      }],
    }
  }, [allDrivers, activeCurrency])

  const failureChartData = useMemo(() => {
    const top = allDrivers.filter((d) => d.failureRate != null && d.ratedTyres >= 2)
      .sort((a, b) => b.failureRate - a.failureRate).slice(0, 12)
    // Semantic thresholds: red >= 30%, amber >= 15%, green below.
    const tone = (v) => (v >= 30 ? '#ef4444' : v >= 15 ? '#f97316' : '#10b981')
    return {
      labels: top.map((d) => (d.name.length > 16 ? `${d.name.slice(0, 16)}...` : d.name)),
      datasets: [{
        label: 'Failure Rate %',
        data: top.map((d) => Number(d.failureRate.toFixed(1))),
        backgroundColor: top.map((d) => withAlpha(tone(d.failureRate), 0.6)),
        borderColor: top.map((d) => tone(d.failureRate)),
        borderWidth: 1,
        borderRadius: 4,
      }],
    }
  }, [allDrivers])

  function handlePreset(preset) {
    setFilters({ preset: preset.label, from: '', to: '' })
  }
  function handleCustomRange(patch) {
    setFilters({ preset: CUSTOM_PRESET, from: dateFrom, to: dateTo, ...patch })
  }

  const exportRows = () => visibleDrivers.map((d) => ({
    rank: d.rank ?? 'N/A',
    name: d.name,
    totalTyres: d.totalTyres,
    avgCpk: fmtCpk(d.avgCpk, activeCurrency),
    totalCost: fmtCurrency(d.totalCost, activeCurrency),
    failureRate: fmtPct(d.failureRate),
    ratedTyres: d.ratedTyres,
    avgTyreLife: fmtKm(d.avgTyreLife),
    riskScore: d.riskScore ?? 'N/A',
    performance: performanceBand(d.riskScore).label,
  }))
  const EXPORT_KEYS = ['rank', 'name', 'totalTyres', 'avgCpk', 'totalCost', 'failureRate', 'ratedTyres', 'avgTyreLife', 'riskScore', 'performance']
  const EXPORT_HEADERS = ['Rank', 'Driver Name', 'Tyres', 'Avg CPK', 'Tyre Cost (priced)', 'Failure Rate', 'Rated Tyres', 'Avg Life', 'Risk Score', 'Performance']

  async function handleExportExcel() {
    setExportError('')
    try {
      const { exportToExcel, reportFileName } = await loadExportUtils()
      await exportToExcel(exportRows(), EXPORT_KEYS, EXPORT_HEADERS, reportFileName('Driver Intelligence Ranking', activeCountry), 'Driver Ranking')
    } catch (e) { setExportError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  async function handleExportPdf() {
    setExportError('')
    try {
      const { exportToPdf, reportFileName } = await loadExportUtils()
      await exportToPdf(
        exportRows(),
        EXPORT_KEYS.map((key, i) => ({ key, header: EXPORT_HEADERS[i] })),
        'Driver Intelligence - Ranking Report',
        reportFileName('Driver Intelligence Ranking', activeCountry),
        'landscape',
      )
    } catch (e) { setExportError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const openDriver = useCallback((name) => navigate(`/driver-management/${encodeURIComponent(name)}`), [navigate])

  const columns = useMemo(() => [
    { id: 'rank', header: 'Rank', accessorFn: (d) => d.rank, sortUndefined: 'last', size: 70,
      cell: ({ row }) => {
        const n = row.original.rank
        if (n == null) return <span className="text-[var(--text-muted)] text-xs">N/A</span>
        const tone = n === 1 ? 'text-yellow-400' : n === 3 ? 'text-amber-600' : 'text-[var(--text-secondary)]'
        return <span className={`text-sm font-bold ${tone}`}>#{n}</span>
      } },
    { id: 'name', header: 'Driver', accessorFn: (d) => d.name, size: 200,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)]">
            {row.original.name[0]?.toUpperCase() ?? 'D'}
          </span>
          <span className="text-[var(--text-primary)] font-medium">{row.original.name}</span>
        </span>
      ) },
    { id: 'totalTyres', header: 'Tyres', accessorFn: (d) => d.totalTyres, size: 80, meta: { align: 'right' } },
    { id: 'avgCpk', header: 'Avg CPK', accessorFn: (d) => d.avgCpk, sortUndefined: 'last', size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className={`font-mono font-semibold ${cpkColor(row.original.avgCpk)}`}>{fmtCpk(row.original.avgCpk, activeCurrency)}</span> },
    { id: 'totalCost', header: 'Tyre cost (priced)', accessorFn: (d) => d.totalCost, sortUndefined: 'last', size: 150, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums" title={`${row.original.pricedTyres} of ${row.original.totalTyres} tyres priced`}>{fmtCurrency(row.original.totalCost, activeCurrency)}</span> },
    { id: 'failureRate', header: 'Failure rate', accessorFn: (d) => d.failureRate, sortUndefined: 'last', size: 120, meta: { align: 'right' },
      cell: ({ row }) => {
        const v = row.original.failureRate
        if (v == null) return <span className="text-[var(--text-muted)]" title="No tyres with a recorded risk level">N/A</span>
        const tone = v >= 30 ? 'text-red-400' : v >= 15 ? 'text-yellow-400' : 'text-green-400'
        return <span className={`font-medium ${tone}`} title={`${row.original.highRiskCount} of ${row.original.ratedTyres} rated tyres high risk`}>{fmtPct(v)}</span>
      } },
    { id: 'avgTyreLife', header: 'Avg life', accessorFn: (d) => d.avgTyreLife, sortUndefined: 'last', size: 110, meta: { align: 'right' },
      cell: ({ row }) => fmtKm(row.original.avgTyreLife) },
    { id: 'riskScore', header: 'Risk score', accessorFn: (d) => d.riskScore, sortUndefined: 'last', size: 140,
      cell: ({ row }) => <RiskBar score={row.original.riskScore} /> },
    { id: 'performance', header: 'Performance', accessorFn: (d) => performanceBand(d.riskScore).label, size: 120,
      cell: ({ row }) => { const b = performanceBand(row.original.riskScore); return <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${BAND_CLS[b.key]}`}>{b.label}</span> } },
    { id: 'actions', header: '', enableSorting: false, size: 120, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); openDriver(row.original.name) }}
          className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px]"
          aria-label={`Open history for ${row.original.name}`}>
          <Eye size={12} aria-hidden="true" /> History
        </button>
      ) },
  ], [activeCurrency, openDriver])

  const kpiCards = [
    { icon: Users, label: 'Drivers identified', value: unknown ? 'N/A' : kpis.totalDrivers.toLocaleString(), sub: `from ${kpis.recordCount.toLocaleString()} tyre records`, tone: 'text-sky-400' },
    { icon: BarChart2, label: 'Fleet average CPK', value: unknown ? 'N/A' : fmtCpk(kpis.fleetAvgCpk, activeCurrency), sub: `${kpis.cpkCoverage} drivers with measurable CPK`, tone: 'text-emerald-400' },
    { icon: TrendingDown, label: 'Highest cost driver', value: unknown || !kpis.highestCost ? 'N/A' : fmtCpk(kpis.highestCost.avgCpk, activeCurrency), sub: kpis.highestCost?.name ?? 'No CPK data', tone: 'text-red-400' },
    { icon: Award, label: 'Best performing driver', value: unknown || !kpis.bestPerformer ? 'N/A' : fmtCpk(kpis.bestPerformer.avgCpk, activeCurrency), sub: kpis.bestPerformer?.name ?? 'No CPK data', tone: 'text-amber-400' },
    { icon: Percent, label: 'Fleet failure rate', value: unknown ? 'N/A' : fmtPct(kpis.fleetFailureRate), sub: `${kpis.ratedTyres.toLocaleString()} tyres with a risk level`, tone: 'text-orange-400' },
    { icon: Wallet, label: 'Tyre cost (priced)', value: unknown ? 'N/A' : fmtCurrency(kpis.totalCost, activeCurrency), sub: 'priced tyres only', tone: 'text-[var(--brand-bright)]' },
    { icon: ShieldAlert, label: 'High-risk drivers', value: unknown ? 'N/A' : kpis.highRiskDrivers, sub: 'risk score 60 or more', tone: 'text-red-400' },
    { icon: User, label: 'Not rated', value: unknown ? 'N/A' : kpis.unratedDrivers, sub: 'no CPK and no rated tyre', tone: 'text-[var(--text-secondary)]' },
  ]

  const hasExtraFilters = siteFilter !== 'all' || countryFilter !== 'all'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Intelligence"
        subtitle="CPK ranking, failure analysis and tyre cost impact by driver"
        icon={Users}
        onRefresh={load}
        refreshing={loading}
        actions={<div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleExportExcel} disabled={unknown || !visibleDrivers.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <FileSpreadsheet size={14} aria-hidden="true" /> Excel
          </button>
          <button type="button" onClick={handleExportPdf} disabled={unknown || !visibleDrivers.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <FileText size={14} aria-hidden="true" /> PDF
          </button>
        </div>}
      />

      {error && (
        <div role="alert" className="card border border-red-800/50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div><p className="text-red-300 font-medium">Could not load driver data.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {exportError && <p role="alert" className="text-sm text-red-300">{exportError}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpiCards.map((k) => <KpiCard key={k.label} {...k} loading={loading} />)}
      </div>

      {truncated && (
        <p className="text-xs text-amber-400">
          Capped view: analysis is based on the first 20,000 tyre records in this scope. Narrow the country or date range for the full set.
        </p>
      )}
      {!unknown && kpis.ratedTyres === 0 && kpis.recordCount > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          No tyre in this window carries a risk level, so failure rates read N/A and the risk score ranks on CPK alone.
        </p>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input
              type="text"
              aria-label="Search drivers"
              placeholder="Search driver..."
              value={searchQuery}
              onChange={(e) => setFilter('search', e.target.value)}
              className="input w-full pl-8 pr-9"
            />
            {searchQuery && (
              <button type="button" onClick={() => setFilter('search', '')} aria-label="Clear search"
                className="absolute right-0 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex gap-1 rounded-lg p-0.5 bg-[var(--input-bg)] border border-[var(--input-border)]" role="group" aria-label="Date window">
            {DATE_PRESETS.map((p) => (
              <button
                type="button"
                key={p.label}
                onClick={() => handlePreset(p)}
                aria-pressed={datePreset === p.label}
                className={`px-3 min-h-[40px] rounded-md text-xs font-medium transition-colors ${
                  datePreset === p.label ? 'bg-[var(--brand)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
            Rank by
            <select className="input py-1" value={sortCol} onChange={(e) => setFilter('sort', e.target.value)} aria-label="Default ranking order">
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setFilter('dir', sortDir === 'asc' ? 'desc' : 'asc')}
            className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[44px]"
            aria-label={`Order ${sortDir === 'asc' ? 'ascending' : 'descending'}, press to reverse`}>
            {sortDir === 'asc' ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
            {sortDir === 'asc' ? 'Ascending' : 'Descending'}
          </button>

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className={`btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[44px] ${showFilters ? 'text-[var(--brand-bright)]' : ''}`}
          >
            <Filter size={12} aria-hidden="true" /> Filters{hasExtraFilters ? ' (active)' : ''} {showFilters ? <ChevronUp size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
          </button>

          <p className="text-xs text-[var(--text-muted)] ml-auto">
            {visibleDrivers.length} driver{visibleDrivers.length !== 1 ? 's' : ''}
          </p>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              className="flex flex-wrap gap-3 pt-1"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}
            >
              <div className="flex items-center gap-2">
                <Calendar size={12} className="text-[var(--text-muted)]" aria-hidden="true" />
                <input type="date" aria-label="From date" value={dateFrom} onChange={(e) => handleCustomRange({ from: e.target.value })} className="input py-1 text-xs" />
                <span className="text-[var(--text-muted)] text-xs">to</span>
                <input type="date" aria-label="To date" value={dateTo} onChange={(e) => handleCustomRange({ to: e.target.value })} className="input py-1 text-xs" />
              </div>
              {uniqueSites.length > 0 && (
                <select value={siteFilter} onChange={(e) => setFilter('site', e.target.value)} className="input py-1 text-xs" aria-label="Site">
                  <option value="all">All Sites</option>
                  {uniqueSites.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
              {uniqueCountries.length > 1 && (
                <select value={countryFilter} onChange={(e) => setFilter('country', e.target.value)} className="input py-1 text-xs" aria-label="Country">
                  <option value="all">All Countries</option>
                  {uniqueCountries.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
              {hasExtraFilters && (
                <button type="button" onClick={() => setFilters({ site: 'all', country: 'all' })} className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[44px]">
                  <X size={11} aria-hidden="true" /> Clear filters
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-blue-400" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Driver comparison: avg CPK (lowest 10)</h3>
          </div>
          <div style={{ height: 220 }} role="img" aria-label={`Average CPK for the ${cpkChartData.labels.length} lowest-CPK drivers`}>
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : error ? <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">Not available until the data loads.</div>
                : cpkChartData.labels.length > 0 ? (
                  <Bar data={cpkChartData} options={{
                    ...barOptions(false),
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `CPK: ${activeCurrency} ${Number(ctx.raw).toFixed(4)}` } } },
                    scales: { ...barOptions(false).scales, y: { ...barOptions(false).scales.y, ticks: { ...barOptions(false).scales.y.ticks, callback: (v) => `${activeCurrency} ${Number(v).toFixed(3)}` } } },
                  }} />
                ) : <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">No driver has a measurable CPK in this window.</div>}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={14} className="text-orange-400" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tyre failure rate by driver (rated tyres)</h3>
          </div>
          <div style={{ height: 220 }} role="img" aria-label={`Failure rate for ${failureChartData.labels.length} drivers with at least 2 rated tyres`}>
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : error ? <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">Not available until the data loads.</div>
                : failureChartData.labels.length > 0 ? (
                  <Bar data={failureChartData} options={{
                    ...barOptions(true),
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `Failure Rate: ${Number(ctx.raw).toFixed(1)}%` } } },
                    scales: { ...barOptions(true).scales, x: { ...barOptions(true).scales.x, ticks: { ...barOptions(true).scales.x.ticks, callback: (v) => `${v}%` } } },
                  }} />
                ) : <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm text-center px-4">No driver has 2 or more tyres with a recorded risk level.</div>}
          </div>
        </div>
      </div>

      {/* Ranking register. The wrapper anchors the scroll-restore hook. */}
      <div ref={listRef} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
            <Users size={14} className="text-[var(--brand-bright)]" aria-hidden="true" /> Driver ranking
          </h3>
          <p className="text-[11px] text-[var(--text-muted)]">Risk score: lower is better. Click a header to re-sort.</p>
        </div>
        <EnterpriseTable
          columns={columns}
          data={visibleDrivers}
          getRowId={(d) => d.name}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableExport={false}
          viewKey="driver-management"
          initialPageSize={25}
          emptyMessage={records.length === 0 ? 'No tyre records carry a driver yet.' : 'No drivers match the current filters. Try adjusting your search or date range.'}
          emptyIcon={<User size={22} className="opacity-60" aria-hidden="true" />}
          onRowClick={(d) => openDriver(d.name)}
        />
      </div>
    </div>
  )
}
