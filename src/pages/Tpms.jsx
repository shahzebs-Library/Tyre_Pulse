import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import {
  Gauge, AlertTriangle, TrendingDown, TrendingUp, Activity,
  Download, Filter, X, Search, RefreshCw, BarChart3, CheckCircle,
  XCircle, Radio, Building2, Thermometer, Info, LineChart, Percent,
  ArrowUpDown, Layers, FileText, ShieldAlert,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { tpms as tpmsApi } from '../lib/api'
import { classifyPressure, DEFAULT_TARGET_PRESSURE, DEFAULT_TOLERANCE_PCT } from '../lib/tpms'
import {
  computeKpis, bandDistribution, worstOffenders, complianceTrend,
  siteCompliance, positionBreakdown, underInflationInsights,
} from '../lib/tpmsAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
)

// -- Band presentation ---------------------------------------------------------
const BAND_META = {
  optimal:  { label: 'Optimal',  color: '#22c55e', text: 'text-green-400',  chip: 'bg-green-500/20 text-green-300 border border-green-500/40' },
  under:    { label: 'Under',    color: '#f97316', text: 'text-orange-400', chip: 'bg-orange-500/20 text-orange-300 border border-orange-500/40' },
  over:     { label: 'Over',     color: '#eab308', text: 'text-amber-400',  chip: 'bg-amber-500/20 text-amber-300 border border-amber-500/40' },
  critical: { label: 'Critical', color: '#ef4444', text: 'text-red-400',    chip: 'bg-red-500/20 text-red-300 border border-red-500/40' },
  unknown:  { label: 'Unknown',  color: '#6b7280', text: 'text-gray-400',   chip: 'bg-gray-800 text-gray-400 border border-gray-700' },
}

function BandChip({ band }) {
  const m = BAND_META[band] ?? BAND_META.unknown
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${m.chip}`}>{m.label}</span>
}

// -- KPI tile ------------------------------------------------------------------
function KpiTile({ title, value, sub, icon: Icon, tone = 'blue', alert }) {
  const border = {
    green:  'border-green-700/40 bg-green-950/20',
    red:    'border-red-700/40 bg-red-950/20',
    orange: 'border-orange-700/40 bg-orange-950/20',
    amber:  'border-amber-700/40 bg-amber-950/20',
    blue:   'border-blue-700/40 bg-blue-950/20',
  }[tone] ?? 'border-gray-700/40 bg-gray-900/40'
  const iconColor = { green: 'text-green-400', red: 'text-red-400', orange: 'text-orange-400', amber: 'text-amber-400', blue: 'text-blue-400' }[tone] ?? 'text-gray-400'
  const valueColor = { green: 'text-green-400', red: 'text-red-400', orange: 'text-orange-400', amber: 'text-amber-400', blue: 'text-blue-300' }[tone] ?? 'text-white'
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${border}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} className={iconColor} />
          <span className="text-xs text-gray-400 font-medium">{title}</span>
        </div>
        {alert && <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 font-bold animate-pulse">ALERT</span>}
      </div>
      <p className={`text-2xl font-bold leading-tight ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  )
}

// -- Select helper -------------------------------------------------------------
function Select({ value, onChange, options, placeholder, className = '' }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 ${className}`}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  )
}

const chartTooltip = {
  backgroundColor: 'var(--panel)', titleColor: '#f9fafb', bodyColor: '#d1d5db',
  borderColor: 'var(--hairline)', borderWidth: 1,
}
const axisGrid = { color: 'var(--panel-2)' }
const axisTick = { color: '#9ca3af', font: { size: 10 } }

// Normalize either data source into one reading shape the page renders.
function normalize(row, source) {
  const pressure = source === 'sensor'
    ? Number(row.pressure)
    : Number(row.pressure_reading)
  const target = Number(row.target_pressure) > 0 ? Number(row.target_pressure) : DEFAULT_TARGET_PRESSURE
  const band = classifyPressure(pressure, target, DEFAULT_TOLERANCE_PCT)
  return {
    id: row.id,
    source,
    asset_no: row.asset_no ?? null,
    serial: source === 'sensor' ? (row.tyre_serial ?? null) : (row.serial_no ?? null),
    position: source === 'sensor' ? (row.tyre_position ?? null) : (row.position ?? null),
    size: source === 'sensor' ? null : (row.size ?? null),
    site: row.site ?? null,
    country: row.country ?? null,
    pressure: Number.isFinite(pressure) ? pressure : null,
    temperature: source === 'sensor' && row.temperature != null ? Number(row.temperature) : null,
    target,
    band,
    date: source === 'sensor' ? row.recorded_at : row.issue_date,
  }
}

// Signed deviation for a normalized reading, ready to display.
function devLabel(r) {
  if (r.pressure == null || !(r.target > 0)) return 'N/A'
  const d = ((r.pressure - r.target) / r.target) * 100
  const sign = d > 0 ? '+' : ''
  return `${sign}${d.toFixed(0)}%`
}

const SORTS = {
  worst:    { label: 'Worst first' },
  pressure: { label: 'Pressure low to high' },
  deviation:{ label: 'Deviation high to low' },
  recent:   { label: 'Most recent' },
}
const BAND_RANK = { critical: 0, under: 1, over: 2, optimal: 3, unknown: 4 }

export default function Tpms() {
  const { activeCountry, appSettings } = useSettings()
  const company = appSettings?.company_name || 'TyrePulse'

  const [readings, setReadings] = useState([])
  const [dataSource, setDataSource] = useState('baseline') // 'sensor' | 'baseline'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)

  // Filters
  const [bandFilter, setBandFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [positionFilter, setPositionFilter] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('worst')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const country = activeCountry
      const sensor = await tpmsApi.listTpmsReadings({ country })
      if (Array.isArray(sensor) && sensor.length > 0) {
        setReadings(sensor.map(r => normalize(r, 'sensor')))
        setDataSource('sensor')
      } else {
        // Fall back to the tyre_records pressure baseline so the page is useful now.
        const baseline = await tpmsApi.listTyrePressureBaseline({ country })
        setReadings((baseline || []).map(r => normalize(r, 'baseline')))
        setDataSource('baseline')
      }
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load TPMS data'))
      setReadings([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Filter option lists
  const sites = useMemo(
    () => [...new Set(readings.map(r => r.site).filter(Boolean))].sort(),
    [readings],
  )
  const positions = useMemo(
    () => [...new Set(readings.map(r => r.position).filter(Boolean))].sort(),
    [readings],
  )

  // Apply filters
  const filtered = useMemo(() => {
    let d = readings
    if (bandFilter) d = d.filter(r => r.band === bandFilter)
    if (siteFilter) d = d.filter(r => r.site === siteFilter)
    if (positionFilter) d = d.filter(r => r.position === positionFilter)
    if (search) {
      const q = search.toLowerCase()
      d = d.filter(r =>
        (r.asset_no || '').toLowerCase().includes(q) ||
        (r.serial || '').toLowerCase().includes(q) ||
        (r.site || '').toLowerCase().includes(q) ||
        (r.position || '').toLowerCase().includes(q))
    }
    return d
  }, [readings, bandFilter, siteFilter, positionFilter, search])

  // Analytics engine (single source of truth for all KPIs / charts / tables)
  const kpis = useMemo(() => computeKpis(filtered), [filtered])
  const dist = useMemo(() => bandDistribution(filtered), [filtered])
  const trend = useMemo(() => complianceTrend(filtered, { months: 12 }), [filtered])
  const sitesRank = useMemo(() => siteCompliance(filtered), [filtered])
  const positionRank = useMemo(() => positionBreakdown(filtered), [filtered])
  const offenders = useMemo(() => worstOffenders(filtered, { limit: 0 }), [filtered])
  const insights = useMemo(() => underInflationInsights(filtered), [filtered])

  // Alerts table with a selectable sort. Base set = under / over / critical.
  const alertRows = useMemo(() => {
    const rows = offenders.slice()
    if (sortBy === 'pressure') {
      rows.sort((a, b) => (a.pressure ?? Infinity) - (b.pressure ?? Infinity))
    } else if (sortBy === 'deviation') {
      rows.sort((a, b) => (b.absDeviationPct ?? -1) - (a.absDeviationPct ?? -1))
    } else if (sortBy === 'recent') {
      rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    } else {
      rows.sort((a, b) =>
        (BAND_RANK[a.band] ?? 9) - (BAND_RANK[b.band] ?? 9) ||
        (b.absDeviationPct ?? -1) - (a.absDeviationPct ?? -1))
    }
    return rows
  }, [offenders, sortBy])

  // Charts
  const doughnutData = useMemo(() => ({
    labels: dist.map(d => d.label),
    datasets: [{
      data: dist.map(d => d.count),
      backgroundColor: dist.map(d => BAND_META[d.band]?.color ?? BAND_META.unknown.color),
      borderColor: 'rgba(17,24,39,0.9)',
      borderWidth: 2,
    }],
  }), [dist])

  const siteBarData = useMemo(() => {
    const rows = sitesRank.slice(0, 12)
    return {
      labels: rows.map(r => r.site),
      datasets: [
        { label: 'Optimal',  data: rows.map(r => r.optimal),  backgroundColor: BAND_META.optimal.color, stack: 's' },
        { label: 'Under',    data: rows.map(r => r.under),     backgroundColor: BAND_META.under.color, stack: 's' },
        { label: 'Over',     data: rows.map(r => r.over),      backgroundColor: BAND_META.over.color, stack: 's' },
        { label: 'Critical', data: rows.map(r => r.critical),  backgroundColor: BAND_META.critical.color, stack: 's' },
      ],
    }
  }, [sitesRank])

  const trendData = useMemo(() => ({
    labels: trend.map(m => m.label),
    datasets: [
      {
        type: 'line',
        label: 'Compliance %',
        data: trend.map(m => m.compliancePct),
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.15)',
        fill: true,
        tension: 0.35,
        yAxisID: 'y',
        pointRadius: 3,
      },
      {
        type: 'bar',
        label: 'Under + Critical',
        data: trend.map(m => m.under + m.critical),
        backgroundColor: BAND_META.under.color,
        yAxisID: 'y1',
        barPercentage: 0.6,
      },
    ],
  }), [trend])

  const compliancePct = kpis.compliancePct.toFixed(1)

  // -- Exports -----------------------------------------------------------------
  const exportRows = useMemo(() => filtered.map(r => ({
    asset_no: r.asset_no || 'N/A',
    serial: r.serial || 'N/A',
    position: r.position || 'N/A',
    size: r.size || 'N/A',
    pressure: r.pressure ?? 'N/A',
    target: r.target,
    deviation: devLabel(r),
    temperature: r.temperature ?? 'N/A',
    status: BAND_META[r.band]?.label ?? r.band,
    site: r.site || 'N/A',
    country: r.country || 'N/A',
    recorded: r.date ? String(r.date).slice(0, 10) : 'N/A',
    source: r.source,
  })), [filtered])

  const EXPORT_COLS = ['asset_no', 'serial', 'position', 'size', 'pressure', 'target', 'deviation', 'temperature', 'status', 'site', 'country', 'recorded', 'source']
  const EXPORT_HEADERS = ['Asset No', 'Serial', 'Position', 'Size', 'Pressure (bar)', 'Target (bar)', 'Deviation', 'Temp (C)', 'Status', 'Site', 'Country', 'Recorded', 'Source']

  const exportExcel = useCallback(async () => {
    setExporting(true)
    try {
      await exportToExcel(
        exportRows, EXPORT_COLS, EXPORT_HEADERS,
        reportFileName('TPMS Pressure Compliance'),
        'TPMS Readings',
        {
          title: 'TPMS Pressure Compliance',
          company,
          meta: {
            'Data source': dataSource === 'sensor' ? 'Live sensor (tpms_readings)' : 'Tyre-record baseline',
            'Compliance %': `${compliancePct}%`,
            'Under-inflated': kpis.underInflated,
            'Over-inflated': kpis.overInflated,
            'Critical': kpis.critical,
            'Target (bar)': DEFAULT_TARGET_PRESSURE.toFixed(1),
            'Tolerance %': DEFAULT_TOLERANCE_PCT,
          },
        },
      )
    } catch (e) {
      setError(toUserMessage(e, 'Export failed'))
    } finally {
      setExporting(false)
    }
  }, [exportRows, company, dataSource, compliancePct, kpis])

  const exportPdf = useCallback(async () => {
    setExporting(true)
    try {
      const cols = EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] }))
      await exportToPdf(
        exportRows, cols,
        'TPMS Pressure Compliance',
        reportFileName('TPMS Pressure Compliance'),
        'landscape',
        company,
        {
          emptyHint: 'No pressure readings for the selected filters. Adjust the filters and export again.',
          meta: {
            'Compliance': `${compliancePct}%`,
            'Under-inflated': kpis.underInflated,
            'Critical': kpis.critical,
          },
        },
      )
    } catch (e) {
      setError(toUserMessage(e, 'Export failed'))
    } finally {
      setExporting(false)
    }
  }, [exportRows, company, compliancePct, kpis])

  const clearFilters = () => { setBandFilter(''); setSiteFilter(''); setPositionFilter(''); setSearch('') }
  const hasFilter = bandFilter || siteFilter || positionFilter || search

  return (
    <div className="text-gray-100 space-y-5">
      <PageHeader
        title="TPMS - Tyre Pressure Monitoring"
        subtitle={`Pressure compliance with under and over-inflation alerts${kpis.total > 0 ? ` · ${kpis.total.toLocaleString()} readings` : ''}`}
        icon={Radio}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={exportExcel} disabled={filtered.length === 0 || exporting} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40">
              <Download size={13} /> Excel
            </button>
            <button onClick={exportPdf} disabled={filtered.length === 0 || exporting} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40">
              <FileText size={13} /> PDF
            </button>
          </div>
        }
      />

      {/* Data source banner */}
      <div className={`rounded-xl border px-4 py-2.5 flex items-center gap-2 text-xs ${dataSource === 'sensor' ? 'border-blue-700/40 bg-blue-950/20 text-blue-300' : 'border-gray-700/50 bg-gray-900/40 text-gray-400'}`}>
        <Info size={13} className="shrink-0" />
        {dataSource === 'sensor'
          ? <span>Live source: <strong className="text-blue-200">TPMS sensor readings</strong> (tpms_readings). Bands computed against a {DEFAULT_TARGET_PRESSURE.toFixed(1)} bar target with a {DEFAULT_TOLERANCE_PCT}% tolerance.</span>
          : <span>No live sensor readings yet. Showing the <strong className="text-gray-200">tyre-record pressure baseline</strong> (tyre_records.pressure_reading). Bands computed against a {DEFAULT_TARGET_PRESSURE.toFixed(1)} bar target with a {DEFAULT_TOLERANCE_PCT}% tolerance. Ingest sensor data to enable live monitoring.</span>}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={13} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-400">Filters</span>
          {hasFilter && (
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
              <X size={12} /> Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
          <Select value={bandFilter} onChange={setBandFilter} placeholder="All Statuses"
            options={[
              { value: 'optimal', label: 'Optimal' },
              { value: 'under', label: 'Under-Inflated' },
              { value: 'over', label: 'Over-Inflated' },
              { value: 'critical', label: 'Critical' },
            ]} />
          <Select value={siteFilter} onChange={setSiteFilter} options={sites} placeholder="All Sites" />
          <Select value={positionFilter} onChange={setPositionFilter} options={positions} placeholder="All Positions" />
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search asset, serial, position, site..."
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg pl-7 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={22} className="text-blue-400 animate-spin mr-2" />
          <span className="text-gray-400 text-sm">Loading TPMS data...</span>
        </div>
      )}
      {error && !loading && (
        <div className="bg-red-950/30 border border-red-700/40 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <XCircle size={16} className="text-red-400" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 shrink-0">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {kpis.total === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <Gauge size={40} className="text-gray-700" />
              <p className="text-gray-500 text-sm">No pressure readings found for the selected filters.</p>
              {hasFilter && (
                <button onClick={clearFilters} className="btn-secondary text-xs px-3 py-1.5">Clear filters</button>
              )}
            </div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">

              {/* KPI tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiTile title="Readings" value={kpis.total.toLocaleString()} sub={`${kpis.assessed.toLocaleString()} assessed`} icon={Activity} tone="blue" />
                <KpiTile title="Compliance" value={`${compliancePct}%`} sub="Within target band" icon={Percent} tone={kpis.compliancePct >= 90 ? 'green' : kpis.compliancePct >= 75 ? 'amber' : 'red'} />
                <KpiTile title="Under-Inflated" value={kpis.underInflated.toLocaleString()} sub={`${kpis.underInflatedPct.toFixed(0)}% of assessed`} icon={TrendingDown} tone={kpis.underInflated > 0 ? 'orange' : 'green'} alert={kpis.underInflated > 0} />
                <KpiTile title="Over-Inflated" value={kpis.overInflated.toLocaleString()} sub="Above target band" icon={TrendingUp} tone={kpis.overInflated > 0 ? 'amber' : 'green'} />
                <KpiTile title="Critical" value={kpis.critical.toLocaleString()} sub="Severe under-inflation" icon={AlertTriangle} tone={kpis.critical > 0 ? 'red' : 'green'} alert={kpis.critical > 0} />
                <KpiTile title="Avg Pressure" value={kpis.avgPressure != null ? `${kpis.avgPressure.toFixed(1)} bar` : 'N/A'} sub={`Target ${DEFAULT_TARGET_PRESSURE.toFixed(1)} bar`} icon={Gauge} tone="blue" />
              </div>

              {/* Under-inflation intelligence callout */}
              <div className={`rounded-xl border px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs ${insights.underInflatedCount > 0 ? 'border-orange-700/40 bg-orange-950/20' : 'border-green-800/40 bg-green-950/20'}`}>
                <div className="flex items-center gap-2">
                  <ShieldAlert size={15} className={insights.underInflatedCount > 0 ? 'text-orange-400' : 'text-green-400'} />
                  <span className="font-semibold text-gray-200">Under-Inflation Intelligence</span>
                </div>
                {insights.underInflatedCount > 0 ? (
                  <>
                    <span className="text-gray-300"><strong className="text-orange-300">{insights.underInflatedCount}</strong> under-inflated ({insights.underInflatedPct.toFixed(0)}% of assessed), {insights.criticalCount} critical</span>
                    {insights.avgUnderDeviationPct != null && (
                      <span className="text-gray-400">Avg shortfall <strong className="text-orange-300">{insights.avgUnderDeviationPct.toFixed(0)}%</strong> below target</span>
                    )}
                    <span className="text-gray-400">{insights.sitesAffected} site{insights.sitesAffected === 1 ? '' : 's'} affected</span>
                    {insights.worstSite && (
                      <span className="text-gray-400">Worst site: <strong className="text-orange-300">{insights.worstSite.site}</strong> ({insights.worstSite.underInflated})</span>
                    )}
                    <span className="text-gray-500">Under-inflation raises rolling resistance, fuel burn and blow-out risk. Address critical readings first.</span>
                  </>
                ) : (
                  <span className="text-gray-300">No under-inflated readings in the current view. Every assessed tyre is at or above the target band.</span>
                )}
              </div>

              {/* Charts row 1 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={14} className="text-blue-400" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Pressure Band Split</h3>
                    <span className="ml-auto text-xs text-gray-500">{kpis.total} readings</span>
                  </div>
                  <div className="h-64 flex items-center justify-center">
                    <Doughnut
                      data={doughnutData}
                      options={{
                        responsive: true, maintainAspectRatio: false, cutout: '62%',
                        plugins: {
                          legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10 }, padding: 12 } },
                          tooltip: chartTooltip,
                        },
                      }}
                    />
                  </div>
                </div>

                <div className="card">
                  <div className="flex items-center gap-2 mb-3">
                    <LineChart size={14} className="text-green-400" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Compliance Trend</h3>
                    <span className="ml-auto text-xs text-gray-500">{trend.length ? `Last ${trend.length} month${trend.length === 1 ? '' : 's'}` : 'No dated readings'}</span>
                  </div>
                  {trend.length === 0 ? (
                    <div className="flex items-center justify-center h-64 text-gray-600 text-sm">No dated readings to trend</div>
                  ) : (
                    <div className="h-64">
                      <Line
                        data={trendData}
                        options={{
                          responsive: true, maintainAspectRatio: false,
                          plugins: { legend: { labels: { color: '#9ca3af', font: { size: 10 } } }, tooltip: chartTooltip },
                          scales: {
                            x: { grid: axisGrid, ticks: { ...axisTick, font: { size: 9 } } },
                            y: { position: 'left', min: 0, max: 100, grid: axisGrid, ticks: { ...axisTick, callback: v => `${v}%` }, title: { display: true, text: 'Compliance %', color: '#6b7280', font: { size: 9 } } },
                            y1: { position: 'right', min: 0, grid: { drawOnChartArea: false }, ticks: axisTick, title: { display: true, text: 'Under + Critical', color: '#6b7280', font: { size: 9 } } },
                          },
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Charts row 2 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 size={14} className="text-purple-400" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Readings by Site</h3>
                    <span className="ml-auto text-xs text-gray-500">Top {Math.min(12, sitesRank.length)} sites</span>
                  </div>
                  {sitesRank.length === 0 ? (
                    <div className="flex items-center justify-center h-64 text-gray-600 text-sm">No site data</div>
                  ) : (
                    <div className="h-64">
                      <Bar
                        data={siteBarData}
                        options={{
                          responsive: true, maintainAspectRatio: false,
                          plugins: { legend: { labels: { color: '#9ca3af', font: { size: 10 } } }, tooltip: chartTooltip },
                          scales: {
                            x: { stacked: true, grid: axisGrid, ticks: { ...axisTick, font: { size: 9 } } },
                            y: { stacked: true, grid: axisGrid, ticks: axisTick },
                          },
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Position breakdown table */}
                <div className="card">
                  <div className="flex items-center gap-2 mb-3">
                    <Layers size={14} className="text-blue-400" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Compliance by Position</h3>
                    <span className="ml-auto text-xs text-gray-500">{positionRank.length} position{positionRank.length === 1 ? '' : 's'}</span>
                  </div>
                  {positionRank.length === 0 ? (
                    <div className="flex items-center justify-center h-64 text-gray-600 text-sm">No position data</div>
                  ) : (
                    <div className="overflow-x-auto max-h-64">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-700/60 text-gray-500">
                            {['Position', 'Readings', 'Under', 'Over', 'Critical', 'Compliance'].map(h => (
                              <th key={h} className="text-left pb-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {positionRank.slice(0, 30).map((p, i) => {
                            const tone = p.compliancePct >= 90 ? 'text-green-400' : p.compliancePct >= 75 ? 'text-amber-400' : 'text-red-400'
                            return (
                              <tr key={p.position ?? i} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                                <td className="py-1.5 pr-3 text-gray-200 whitespace-nowrap">{p.position}</td>
                                <td className="py-1.5 pr-3 text-gray-400">{p.total}</td>
                                <td className="py-1.5 pr-3 text-orange-400">{p.under}</td>
                                <td className="py-1.5 pr-3 text-amber-400">{p.over}</td>
                                <td className="py-1.5 pr-3 text-red-400">{p.critical}</td>
                                <td className={`py-1.5 pr-3 font-bold ${tone}`}>{p.compliancePct.toFixed(0)}%</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Alerts table */}
              <div className="card">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-red-400" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Inflation Alerts</h3>
                    <span className="text-xs px-2 py-0.5 bg-red-900/30 text-red-300 border border-red-700/40 rounded-full">{alertRows.length}</span>
                  </div>
                  <div className="sm:ml-auto flex items-center gap-2">
                    <ArrowUpDown size={12} className="text-gray-500" />
                    <Select value={sortBy === 'worst' ? '' : sortBy} onChange={v => setSortBy(v || 'worst')} placeholder="Worst first"
                      options={Object.entries(SORTS).filter(([k]) => k !== 'worst').map(([value, m]) => ({ value, label: m.label }))} />
                  </div>
                </div>

                {alertRows.length === 0 ? (
                  <div className="flex flex-col items-center py-12 gap-2">
                    <CheckCircle size={28} className="text-green-500" />
                    <p className="text-gray-400 text-sm">No inflation alerts. All readings are within the target band.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-700/60">
                          {['Asset', 'Position', 'Serial', 'Pressure', 'Target', 'Deviation', 'Temp', 'Status', 'Site', 'Recorded'].map(h => (
                            <th key={h} className="text-left text-gray-500 pb-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {alertRows.slice(0, 200).map((r, i) => (
                          <tr key={r.id ?? i} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                            <td className="py-2 pr-3 text-white font-medium">{r.asset_no || 'N/A'}</td>
                            <td className="py-2 pr-3 text-gray-300">{r.position || 'N/A'}</td>
                            <td className="py-2 pr-3 text-gray-400 font-mono">{r.serial || 'N/A'}</td>
                            <td className={`py-2 pr-3 font-bold ${BAND_META[r.band]?.text ?? ''}`}>{r.pressure != null ? `${r.pressure.toFixed(1)} bar` : 'N/A'}</td>
                            <td className="py-2 pr-3 text-gray-400">{r.target.toFixed(1)} bar</td>
                            <td className={`py-2 pr-3 font-medium ${BAND_META[r.band]?.text ?? 'text-gray-400'}`}>{devLabel(r)}</td>
                            <td className="py-2 pr-3 text-gray-400">{r.temperature != null ? `${r.temperature.toFixed(0)}C` : 'N/A'}</td>
                            <td className="py-2 pr-3"><BandChip band={r.band} /></td>
                            <td className="py-2 pr-3 text-gray-400">{r.site || 'N/A'}</td>
                            <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{r.date ? String(r.date).slice(0, 10) : 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {alertRows.length > 200 && (
                      <p className="text-xs text-gray-500 mt-3">Showing first 200 of {alertRows.length} alerts. Refine filters or export for the full set.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Site compliance strip */}
              {sitesRank.length > 0 && (
                <div className="card">
                  <div className="flex items-center gap-2 mb-3">
                    <Thermometer size={14} className="text-amber-400" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Compliance by Site</h3>
                    <span className="ml-auto text-xs text-gray-500">Worst first</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sitesRank.slice(0, 9).map(s => {
                      const pct = s.compliancePct
                      const tone = pct >= 90 ? 'text-green-400' : pct >= 75 ? 'text-amber-400' : 'text-red-400'
                      return (
                        <div key={s.site} className="bg-gray-800/40 rounded-xl p-3 border border-gray-700/40">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-400 truncate">{s.site}</p>
                            <span className={`text-sm font-bold ${tone}`}>{pct.toFixed(0)}%</span>
                          </div>
                          <p className="text-xs text-gray-600 mt-1">{s.total} readings · {s.alerts} alert{s.alerts === 1 ? '' : 's'}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}
    </div>
  )
}
