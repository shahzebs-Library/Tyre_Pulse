import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  Gauge, AlertTriangle, TrendingDown, TrendingUp, Activity,
  Download, Filter, X, Search, RefreshCw, BarChart3, CheckCircle,
  XCircle, Radio, Building2, Thermometer, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { tpms as tpmsApi } from '../lib/api'
import {
  classifyPressure, summarizePressure,
  DEFAULT_TARGET_PRESSURE, DEFAULT_TOLERANCE_PCT,
} from '../lib/tpms'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

// ── Band presentation ─────────────────────────────────────────────────────────
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

// ── KPI tile ──────────────────────────────────────────────────────────────────
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

// ── Select helper ─────────────────────────────────────────────────────────────
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

export default function Tpms() {
  const { activeCountry } = useSettings()

  const [readings, setReadings] = useState([])
  const [dataSource, setDataSource] = useState('baseline') // 'sensor' | 'baseline'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters
  const [bandFilter, setBandFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

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
      setError(e?.message || 'Failed to load TPMS data')
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

  // Apply filters
  const filtered = useMemo(() => {
    let d = readings
    if (bandFilter) d = d.filter(r => r.band === bandFilter)
    if (siteFilter) d = d.filter(r => r.site === siteFilter)
    if (search) {
      const q = search.toLowerCase()
      d = d.filter(r =>
        (r.asset_no || '').toLowerCase().includes(q) ||
        (r.serial || '').toLowerCase().includes(q) ||
        (r.site || '').toLowerCase().includes(q) ||
        (r.position || '').toLowerCase().includes(q))
    }
    return d
  }, [readings, bandFilter, siteFilter, search])

  const summary = useMemo(() => summarizePressure(filtered), [filtered])

  // Alerts = under / over / critical, worst first
  const alertRows = useMemo(() => {
    const rank = { critical: 0, under: 1, over: 2 }
    return filtered
      .filter(r => r.band === 'under' || r.band === 'over' || r.band === 'critical')
      .sort((a, b) => (rank[a.band] ?? 9) - (rank[b.band] ?? 9) || (b.date || '') > (a.date || '') ? 1 : -1)
  }, [filtered])

  // Charts
  const doughnutData = useMemo(() => {
    const order = ['optimal', 'under', 'over', 'critical']
    return {
      labels: order.map(b => BAND_META[b].label),
      datasets: [{
        data: order.map(b => summary.bands[b]),
        backgroundColor: order.map(b => BAND_META[b].color),
        borderColor: 'rgba(17,24,39,0.9)',
        borderWidth: 2,
      }],
    }
  }, [summary])

  const siteBarData = useMemo(() => {
    const rows = summary.bySite.slice(0, 12)
    return {
      labels: rows.map(r => r.site),
      datasets: [
        { label: 'Optimal',  data: rows.map(r => r.optimal),  backgroundColor: BAND_META.optimal.color, stack: 's' },
        { label: 'Under',    data: rows.map(r => r.under),     backgroundColor: BAND_META.under.color, stack: 's' },
        { label: 'Over',     data: rows.map(r => r.over),      backgroundColor: BAND_META.over.color, stack: 's' },
        { label: 'Critical', data: rows.map(r => r.critical),  backgroundColor: BAND_META.critical.color, stack: 's' },
      ],
    }
  }, [summary])

  const compliancePct = summary.total > 0
    ? ((summary.bands.optimal / summary.total) * 100).toFixed(1)
    : '0.0'

  // Export
  const exportExcel = useCallback(async () => {
    const XLSX = await import('xlsx')
    const rows = filtered.map(r => ({
      'Asset No': r.asset_no || '',
      'Serial': r.serial || '',
      'Position': r.position || '',
      'Size': r.size || '',
      'Pressure (bar)': r.pressure ?? '',
      'Target (bar)': r.target,
      'Temp (°C)': r.temperature ?? '',
      'Status': BAND_META[r.band]?.label ?? r.band,
      'Site': r.site || '',
      'Country': r.country || '',
      'Recorded': r.date || '',
      'Source': r.source,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0] || { a: 1 }).map(k => ({ wch: Math.max(k.length + 2, 12) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'TPMS Readings')
    XLSX.writeFile(wb, `tpms_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [filtered])

  const hasFilter = bandFilter || siteFilter || search

  return (
    <div className="text-gray-100 space-y-5">
      <PageHeader
        title="TPMS — Tyre Pressure Monitoring"
        subtitle={`Live pressure & temperature monitoring with under/over-inflation alerts${summary.total > 0 ? ` · ${summary.total.toLocaleString()} readings` : ''}`}
        icon={Radio}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button onClick={exportExcel} disabled={filtered.length === 0} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40">
              <Download size={13} /> Excel
            </button>
          </div>
        }
      />

      {/* Data source banner */}
      <div className={`rounded-xl border px-4 py-2.5 flex items-center gap-2 text-xs ${dataSource === 'sensor' ? 'border-blue-700/40 bg-blue-950/20 text-blue-300' : 'border-gray-700/50 bg-gray-900/40 text-gray-400'}`}>
        <Info size={13} className="shrink-0" />
        {dataSource === 'sensor'
          ? <span>Live source: <strong className="text-blue-200">TPMS sensor readings</strong> (tpms_readings). Bands computed against a {DEFAULT_TARGET_PRESSURE.toFixed(1)} bar target ±{DEFAULT_TOLERANCE_PCT}%.</span>
          : <span>No live sensor readings yet — showing <strong className="text-gray-200">tyre-record pressure baseline</strong> (tyre_records.pressure_reading). Bands computed against a {DEFAULT_TARGET_PRESSURE.toFixed(1)} bar target ±{DEFAULT_TOLERANCE_PCT}%. Ingest sensor data to enable live monitoring.</span>}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={13} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-400">Filters</span>
          {hasFilter && (
            <button onClick={() => { setBandFilter(''); setSiteFilter(''); setSearch('') }} className="ml-auto flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
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
          <div className="relative sm:col-span-2 md:col-span-2">
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
        <div className="bg-red-950/30 border border-red-700/40 rounded-xl p-4 flex items-center gap-3">
          <XCircle size={16} className="text-red-400" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {summary.total === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <Gauge size={40} className="text-gray-700" />
              <p className="text-gray-500 text-sm">No pressure readings found for the selected filters.</p>
              {hasFilter && (
                <button onClick={() => { setBandFilter(''); setSiteFilter(''); setSearch('') }} className="btn-secondary text-xs px-3 py-1.5">Clear filters</button>
              )}
            </div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">

              {/* KPI tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiTile title="Readings" value={summary.total.toLocaleString()} sub={`${compliancePct}% optimal`} icon={Activity} tone="blue" />
                <KpiTile title="Under-Inflated" value={summary.bands.under} sub="Below target band" icon={TrendingDown} tone={summary.bands.under > 0 ? 'orange' : 'green'} />
                <KpiTile title="Over-Inflated" value={summary.bands.over} sub="Above target band" icon={TrendingUp} tone={summary.bands.over > 0 ? 'amber' : 'green'} />
                <KpiTile title="Critical" value={summary.bands.critical} sub="Severe under-inflation" icon={AlertTriangle} tone={summary.bands.critical > 0 ? 'red' : 'green'} alert={summary.bands.critical > 0} />
                <KpiTile title="Avg Pressure" value={summary.avgPressure != null ? `${summary.avgPressure.toFixed(1)} bar` : 'N/A'} sub={`Target ${DEFAULT_TARGET_PRESSURE.toFixed(1)} bar`} icon={Gauge} tone="blue" />
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={14} className="text-blue-400" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Pressure Band Split</h3>
                    <span className="ml-auto text-xs text-gray-500">{summary.total} readings</span>
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
                    <Building2 size={14} className="text-purple-400" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Readings by Site</h3>
                    <span className="ml-auto text-xs text-gray-500">Top {Math.min(12, summary.bySite.length)} sites</span>
                  </div>
                  {summary.bySite.length === 0 ? (
                    <div className="flex items-center justify-center h-64 text-gray-600 text-sm">No site data</div>
                  ) : (
                    <div className="h-64">
                      <Bar
                        data={siteBarData}
                        options={{
                          responsive: true, maintainAspectRatio: false,
                          plugins: { legend: { labels: { color: '#9ca3af', font: { size: 10 } } }, tooltip: chartTooltip },
                          scales: {
                            x: { stacked: true, grid: { color: 'rgba(31,41,55,0.8)' }, ticks: { color: '#9ca3af', font: { size: 9 } } },
                            y: { stacked: true, grid: { color: 'rgba(31,41,55,0.8)' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
                          },
                        }}
                      />
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
                  <span className="sm:ml-auto text-xs text-gray-500">Under / over / critical readings, worst first</span>
                </div>

                {alertRows.length === 0 ? (
                  <div className="flex flex-col items-center py-12 gap-2">
                    <CheckCircle size={28} className="text-green-500" />
                    <p className="text-gray-400 text-sm">No inflation alerts — all readings within the target band.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-700/60">
                          {['Asset', 'Position', 'Serial', 'Pressure', 'Target', 'Temp', 'Status', 'Site', 'Recorded'].map(h => (
                            <th key={h} className="text-left text-gray-500 pb-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {alertRows.slice(0, 200).map((r, i) => (
                          <tr key={r.id ?? i} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                            <td className="py-2 pr-3 text-white font-medium">{r.asset_no || '-'}</td>
                            <td className="py-2 pr-3 text-gray-300">{r.position || '-'}</td>
                            <td className="py-2 pr-3 text-gray-400 font-mono">{r.serial || '-'}</td>
                            <td className={`py-2 pr-3 font-bold ${BAND_META[r.band]?.text ?? ''}`}>{r.pressure != null ? `${r.pressure.toFixed(1)} bar` : '-'}</td>
                            <td className="py-2 pr-3 text-gray-400">{r.target.toFixed(1)} bar</td>
                            <td className="py-2 pr-3 text-gray-400">{r.temperature != null ? `${r.temperature.toFixed(0)}°C` : '-'}</td>
                            <td className="py-2 pr-3"><BandChip band={r.band} /></td>
                            <td className="py-2 pr-3 text-gray-400">{r.site || '-'}</td>
                            <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{r.date ? String(r.date).slice(0, 10) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {alertRows.length > 200 && (
                      <p className="text-xs text-gray-500 mt-3">Showing first 200 of {alertRows.length} alerts — refine filters or export for the full set.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Site breakdown strip */}
              {summary.bySite.length > 0 && (
                <div className="card">
                  <div className="flex items-center gap-2 mb-3">
                    <Thermometer size={14} className="text-amber-400" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Compliance by Site</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {summary.bySite.slice(0, 9).map(s => {
                      const pct = s.total > 0 ? ((s.optimal / s.total) * 100).toFixed(0) : '0'
                      const tone = Number(pct) >= 90 ? 'text-green-400' : Number(pct) >= 75 ? 'text-amber-400' : 'text-red-400'
                      return (
                        <div key={s.site} className="bg-gray-800/40 rounded-xl p-3 border border-gray-700/40">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-400 truncate">{s.site}</p>
                            <span className={`text-sm font-bold ${tone}`}>{pct}%</span>
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
