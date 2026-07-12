/**
 * CarbonTracker (route /carbon-tracker) — fleet CO2 emissions dashboard.
 *
 * Derived entirely from REAL operational data: fuel burned is estimated from the
 * distance each tyre covered while fitted (the `tyre_records` fitment→removal
 * odometer, the same source FuelEfficiency uses) and converted to CO2 with the
 * IPCC diesel emission factor (carbon.js — single source of truth). No new table,
 * no mock numbers; when there is no usable fuel signal the page says so honestly.
 *
 * Aggregations (by month, by site, by vehicle) and the emission maths live in the
 * pure, unit-tested `src/lib/carbon.js`. This page is presentation + filtering.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Leaf, Gauge, Fuel, Building2, Search, X, Filter, TreePine,
  FileSpreadsheet, FileText, AlertTriangle, Info, Truck,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listFuelUsage } from '../lib/api/carbon'
import { computeCarbon, treesToOffset, DIESEL_KG_PER_L } from '../lib/carbon'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const SITE_PALETTE = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#14b8a6', '#ec4899', '#f97316', '#6366f1', '#84cc16',
]

const PERIODS = [
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '12 months' },
  { value: 0, label: 'All time' },
]

// tonnes, 1 decimal
const asTonnes = (kg) => (kg == null ? 0 : Math.round((kg / 1000) * 10) / 10)
const fmt = (n) => (n == null || !Number.isFinite(n) ? '0' : Math.round(n).toLocaleString())

export default function CarbonTracker() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null) // null = never loaded (skeleton)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [period, setPeriod] = useState(12)
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listFuelUsage({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Could not load fuel usage data.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Period-scoped rows (by date). period=0 → all time.
  const scopedRows = useMemo(() => {
    const all = rows || []
    if (!period) return all
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - period)
    cutoff.setHours(0, 0, 0, 0)
    return all.filter((r) => {
      if (!r.date) return false
      const d = new Date(r.date)
      return !Number.isNaN(d.getTime()) && d >= cutoff
    })
  }, [rows, period])

  const carbon = useMemo(() => computeCarbon(scopedRows), [scopedRows])

  const siteOptions = useMemo(
    () => carbon.bySite.map((s) => s.site).sort((a, b) => a.localeCompare(b)),
    [carbon.bySite],
  )

  // Filtered vehicle table (site + free-text search).
  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase()
    return carbon.byVehicle.filter((v) => {
      if (siteFilter && v.site !== siteFilter) return false
      if (q && !`${v.vehicle} ${v.site}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [carbon.byVehicle, siteFilter, search])

  const hasData = (rows?.length ?? 0) > 0 && carbon.totalCo2 > 0
  const topSite = carbon.bySite[0] || null
  const co2PerVehicle = carbon.vehicleCount ? carbon.totalCo2 / carbon.vehicleCount : 0

  // ── KPI tiles ──────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total CO₂', value: `${asTonnes(carbon.totalCo2)} t`, sub: `${fmt(carbon.totalCo2)} kg`, icon: Leaf, tone: 'text-red-400' },
    { label: 'CO₂ / vehicle', value: `${asTonnes(co2PerVehicle)} t`, sub: `${carbon.vehicleCount} vehicles`, icon: Gauge, tone: 'text-amber-400' },
    { label: 'Total diesel', value: `${fmt(carbon.totalLitres)} L`, sub: `${fmt(carbon.totalDistanceKm)} km driven`, icon: Fuel, tone: 'text-blue-400' },
    { label: 'Top-emitting site', value: topSite ? topSite.site : '—', sub: topSite ? `${asTonnes(topSite.co2)} t CO₂` : 'No sites', icon: Building2, tone: 'text-green-400' },
  ]

  // ── Charts ───────────────────────────────────────────────────────────────
  const chartText = (typeof document !== 'undefined'
    && getComputedStyle(document.documentElement).getPropertyValue('--text-muted')) || '#9ca3af'

  const monthBar = {
    labels: carbon.byMonth.map((m) => m.label),
    datasets: [{
      label: 'CO₂ (kg)',
      data: carbon.byMonth.map((m) => m.co2),
      backgroundColor: '#22c55e',
      borderRadius: 4,
    }],
  }
  const topSites = carbon.bySite.slice(0, 10)
  const siteDoughnut = {
    labels: topSites.map((s) => s.site),
    datasets: [{
      data: topSites.map((s) => s.co2),
      backgroundColor: topSites.map((_, i) => SITE_PALETTE[i % SITE_PALETTE.length]),
      borderWidth: 0,
    }],
  }
  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: chartText, boxWidth: 12 } },
      tooltip: { callbacks: { label: (c) => `${fmt(c.raw)} kg CO₂` } },
    },
    scales: {
      x: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
      y: { ticks: { color: chartText }, grid: { color: 'rgba(148,163,184,0.12)' } },
    },
  }
  const doughnutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '62%',
    plugins: {
      legend: { position: 'bottom', labels: { color: chartText, boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: (c) => `${c.label}: ${asTonnes(c.raw)} t` } },
    },
  }

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['vehicle', 'site', 'distanceKm', 'litres', 'co2Kg', 'co2Tonnes']
  const EXPORT_HEADERS = ['Vehicle', 'Site', 'Distance (km)', 'Diesel (L)', 'CO₂ (kg)', 'CO₂ (t)']
  const exportRows = filteredVehicles.map((v) => ({
    vehicle: v.vehicle,
    site: v.site,
    distanceKm: '',
    litres: v.litres,
    co2Kg: v.co2,
    co2Tonnes: asTonnes(v.co2),
  }))

  const clearFilters = () => { setSiteFilter(''); setSearch('') }
  const hasFilters = siteFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Carbon Tracker"
        subtitle="Fleet CO₂ emissions from real fuel usage — IPCC diesel factor, aggregated by month, site and vehicle."
        icon={Leaf}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <select className="input" value={period} onChange={(e) => setPeriod(Number(e.target.value))} aria-label="Period">
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'carbon_tracker')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filteredVehicles.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Carbon Tracker', 'carbon_tracker', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filteredVehicles.length}>
              <FileText size={14} /> PDF
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load fuel usage.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* Methodology disclosure */}
      <div className="card border border-amber-700/40 bg-amber-900/10 flex items-start gap-3">
        <Info size={16} className="text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          <span className="font-semibold text-amber-300">Estimate.</span>{' '}
          CO₂ is derived from distance travelled per tyre record and the IPCC diesel factor of{' '}
          <span className="font-semibold">{DIESEL_KG_PER_L} kg/L</span>. Distance is real fleet data; the
          litres-per-km conversion uses a fleet-average consumption assumption.
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 truncate ${k.tone}`}>{rows === null ? '—' : k.value}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{rows === null ? '' : k.sub}</p>
            </div>
          )
        })}
      </div>

      {/* Offset banner */}
      {hasData && (
        <div className="card flex items-center gap-3">
          <TreePine size={18} className="text-green-400 shrink-0" />
          <p className="text-sm text-[var(--text-secondary)]">
            Offsetting this period's emissions would take an estimated{' '}
            <span className="font-semibold text-green-400">{treesToOffset(carbon.totalCo2).toLocaleString()}</span>{' '}
            trees absorbing CO₂ for a year.
          </p>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Monthly CO₂ emissions (kg)</h3>
          <div className="h-64">
            {rows === null ? <ChartSkeleton />
              : carbon.byMonth.length ? <Bar data={monthBar} options={barOpts} />
                : <EmptyChart empty="No dated fuel usage in this period." />}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">CO₂ by site (top 10)</h3>
          <div className="h-64">
            {rows === null ? <ChartSkeleton />
              : topSites.length ? <Doughnut data={siteDoughnut} options={doughnutOpts} />
                : <EmptyChart empty="No site emissions to show." />}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search vehicle or site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filteredVehicles.length} of {carbon.byVehicle.length} vehicles</span>
        </div>
      </div>

      {/* Vehicle emissions table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['#', 'Vehicle', 'Site', 'Diesel (L)', 'CO₂ (kg)', 'CO₂ (t)', 'Share'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                ))
              ) : filteredVehicles.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />{hasData ? 'No vehicles match these filters.' : 'No fuel usage data for the selected period.'}</td></tr>
              ) : (
                filteredVehicles.slice(0, 500).map((v, i) => {
                  const share = carbon.totalCo2 ? (v.co2 / carbon.totalCo2) * 100 : 0
                  return (
                    <tr key={v.vehicle} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 text-[var(--text-muted)] font-mono text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5"><Truck size={13} className="text-[var(--text-muted)]" />{v.vehicle}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{v.site}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{fmt(v.litres)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{fmt(v.co2)}</td>
                      <td className="px-4 py-2.5 font-semibold text-red-400 tabular-nums">{asTonnes(v.co2)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)] tabular-nums">{share.toFixed(1)}%</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filteredVehicles.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>
    </div>
  )
}

function EmptyChart({ empty = 'No data.' }) {
  return <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{empty}</div>
}
function ChartSkeleton() {
  return <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
}
