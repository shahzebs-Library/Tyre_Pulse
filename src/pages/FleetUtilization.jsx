/**
 * FleetUtilization (route /fleet-utilization) — Fleet Utilization & Telematics.
 *
 * Surfaces the telematics snapshot loaded into `asset_utilization` (V406): per
 * asset how hard it worked (utilization %), how far it ran (distance km), how
 * much it sat (idle %), working hours, max speed and the latest odometer, which
 * also feeds each asset's current km. Real data only, honest empty/error states,
 * never fabricated. All maths live in the pure `src/lib/fleetUtilization.js`
 * engine; `src/lib/api/assetUtilization.js` is the only Supabase seam.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Activity, Gauge, Truck, TrendingUp, Timer, Search, X, FileSpreadsheet,
  FileText, RefreshCcw, ArrowUpDown, MapPin, AlertTriangle, Link2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listAssetUtilization } from '../lib/api/assetUtilization'
import {
  summarizeUtilization, filterUtilization, bandDistribution, byCountry,
  topBy, bandOf, idlePct, secondsToHours, num,
} from '../lib/fleetUtilization'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { colorAt, withAlpha } from '../lib/reportColors'
import { listAssetOptions } from '../lib/api/assetHistory'
import {
  attachRegister, siteComparison, telematicsCoverage, captureTimeline, filterByRegister, NO_SITE, NO_TYPE,
} from '../lib/fleetUtilizationAnalytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const fmtNum = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString())
const fmtKm = (v) => (num(v) == null ? 'N/A' : `${Number(v).toLocaleString()} km`)
const fmtPct = (v) => (num(v) == null ? 'N/A' : `${Math.round(Number(v) * 10) / 10}%`)
const fmtHrs = (v) => (num(v) == null ? 'N/A' : `${Number(v).toLocaleString()} h`)
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

function trendChartData(timeline) {
  if (!timeline?.trendable) return null
  return {
    labels: timeline.points.map((p) => p.date),
    datasets: [{ label: 'Avg utilization %', data: timeline.points.map((p) => (p.avgUtilization == null ? null : Math.round(p.avgUtilization * 10) / 10)), backgroundColor: withAlpha(colorAt(0), 0.85) }],
  }
}

const BAND_TONE = { High: '#16a34a', Medium: '#f59e0b', Low: '#ef4444', Unknown: '#94a3b8' }

function Stat({ icon: Icon, label, value, sub, tone = 'text-slate-100' }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className="rounded-lg bg-white/5 p-2"><Icon className="w-5 h-5 text-emerald-400" /></div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
        <div className={`text-xl font-semibold ${tone}`}>{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

const SORTS = {
  utilization_pct: (r) => num(r.utilization_pct),
  distance_km: (r) => num(r.distance_km),
  idle: (r) => idlePct(r),
  current_km: (r) => num(r.current_km),
  working: (r) => secondsToHours(r.working_seconds),
  asset_no: (r) => String(r.asset_no || ''),
}

export default function FleetUtilization() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [band, setBand] = useState('All')
  const [linkedOnly, setLinkedOnly] = useState(false)
  const [idleHeavy, setIdleHeavy] = useState(false)
  const [sortKey, setSortKey] = useState('utilization_pct')
  const [sortDir, setSortDir] = useState('desc')
  const [fleet, setFleet] = useState([])
  const [fleetError, setFleetError] = useState('')
  const [site, setSite] = useState('')
  const [vehicleType, setVehicleType] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(''); setFleetError('')
    const [util, reg] = await Promise.allSettled([
      listAssetUtilization({ country: activeCountry }),
      listAssetOptions({ country: activeCountry }),
    ])
    if (util.status === 'fulfilled') setRows(util.value)
    else setError(toUserMessage(util.reason))
    if (reg.status === 'fulfilled' && reg.value?.ok) setFleet(reg.value.rows || [])
    else { setFleet([]); setFleetError('The fleet register could not be read, so site, vehicle type and the coverage gap are unavailable.') }
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const enriched = useMemo(() => attachRegister(rows, fleet), [rows, fleet])
  const filtered = useMemo(
    () => filterByRegister(filterUtilization(enriched, {
      search, band, linkedOnly, minIdle: idleHeavy ? 50 : null,
    }), { site, vehicleType }),
    [enriched, search, band, linkedOnly, idleHeavy, site, vehicleType],
  )
  const siteOptions = useMemo(() => [...new Set(enriched.map((r) => r.site || NO_SITE))].sort(), [enriched])
  const typeOptions = useMemo(() => [...new Set(enriched.map((r) => r.vehicle_type || NO_TYPE))].sort(), [enriched])
  const sites = useMemo(() => siteComparison(filtered), [filtered])
  const coverage = useMemo(() => (fleet.length ? telematicsCoverage(rows, fleet) : null), [rows, fleet])
  const timeline = useMemo(() => captureTimeline(rows), [rows])

  const sorted = useMemo(() => {
    const fn = SORTS[sortKey] || SORTS.utilization_pct
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = fn(a), bv = fn(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') return dir * av.localeCompare(bv)
      return dir * (av - bv)
    })
  }, [filtered, sortKey, sortDir])
  const utilizationPager = usePagedRows(sorted)

  const kpis = useMemo(() => summarizeUtilization(filtered), [filtered])
  const bands = useMemo(() => bandDistribution(filtered), [filtered])
  const countries = useMemo(() => byCountry(filtered), [filtered])
  const topIdle = useMemo(() => topBy(filtered, 'idleHours', 10), [filtered])

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const exportCols = ['asset_no', 'country', 'site', 'vehicle_type', 'make', 'model', 'utilization_pct', 'distance_km', 'idle', 'working', 'max_speed', 'current_km', 'captured_at']
  const exportHeaders = ['Asset', 'Country', 'Site', 'Vehicle type', 'Make', 'Model', 'Utilization %', 'Distance km', 'Idle %', 'Working h', 'Max speed', 'Current km', 'Captured']
  function exportGap(kind) {
    if (!coverage?.uncovered.length) return
    const cols = ['asset_no', 'country', 'site', 'vehicle_type']
    const heads = ['Asset', 'Country', 'Site', 'Vehicle type']
    const out = coverage.uncovered.map((u) => ({ ...u, site: u.site || NO_SITE, vehicle_type: u.vehicle_type || NO_TYPE }))
    if (kind === 'excel') exportToExcel(out, cols, heads, 'Telematics Coverage Gap')
    else exportToPdf(out, cols.map((k, i) => ({ key: k, header: heads[i] })), 'Telematics coverage gap', 'Telematics Coverage Gap', 'portrait')
  }
  const siteChart = {
    labels: sites.slice(0, 15).map((x) => x.site),
    datasets: [{ label: 'Avg utilization %', data: sites.slice(0, 15).map((x) => (x.avgUtilization == null ? null : Math.round(x.avgUtilization * 10) / 10)), backgroundColor: withAlpha(colorAt(1), 0.85) }],
  }

  function exportRows() {
    return sorted.map((r) => ({
      asset_no: r.asset_no, country: r.country, site: r.site || NO_SITE, vehicle_type: r.vehicle_type || NO_TYPE, make: r.make, model: r.model,
      utilization_pct: num(r.utilization_pct), distance_km: num(r.distance_km),
      idle: idlePct(r), working: secondsToHours(r.working_seconds),
      max_speed: num(r.max_speed), current_km: num(r.current_km), captured_at: r.captured_at,
    }))
  }

  const bandChart = {
    labels: bands.map((b) => b.band),
    datasets: [{ data: bands.map((b) => b.count), backgroundColor: bands.map((b) => BAND_TONE[b.band]), borderWidth: 0 }],
  }
  const countryChart = {
    labels: countries.map((c) => c.country),
    datasets: [
      { label: 'Assets', data: countries.map((c) => c.assets), backgroundColor: withAlpha(colorAt(0), 0.85), yAxisID: 'y' },
      { label: 'Avg utilization %', data: countries.map((c) => (c.avgUtilization == null ? null : Math.round(c.avgUtilization * 10) / 10)), backgroundColor: withAlpha(colorAt(2), 0.85), yAxisID: 'y1' },
    ],
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fleet Utilization"
        subtitle="Telematics: how hard each asset works, how far it runs, how much it sits idle, and its current km."
        icon={Activity}
        actions={
          <div className="flex gap-2">
            <button onClick={load} className="btn-ghost" title="Refresh"><RefreshCcw className="w-4 h-4" /></button>
            <button onClick={() => exportToExcel(exportRows(), exportCols, exportHeaders, 'Fleet Utilization')}
              disabled={!sorted.length} className="btn-ghost gap-1"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
            <button onClick={() => exportToPdf(exportRows(), exportCols.map((k, i) => ({ key: k, header: exportHeaders[i] })), 'Fleet Utilization', 'Fleet Utilization', 'landscape')}
              disabled={!sorted.length} className="btn-ghost gap-1"><FileText className="w-4 h-4" /> PDF</button>
          </div>
        }
      />

      {error && (
        <div className="card p-4 border border-red-500/40 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-300"><AlertTriangle className="w-4 h-4" /> {error}</div>
          <button onClick={load} className="btn-ghost">Retry</button>
        </div>
      )}

      {fleetError && <div className="card p-3 text-sm text-amber-300 flex items-center justify-between gap-2"><span>{fleetError}</span><button onClick={load} className="btn-ghost">Retry</button></div>}
      {!loading && timeline.points.length > 0 && (
        <p className="text-xs text-slate-400">
          {timeline.trendable
            ? `${timeline.points.length} telematics captures loaded, from ${timeline.points[0].date} to ${timeline.points[timeline.points.length - 1].date}.`
            : `One telematics capture is loaded (${timeline.points[0].date}). Figures are a snapshot; a utilization trend appears once further captures are loaded.`}
        </p>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon={Truck} label="Assets tracked" value={fmtNum(kpis.assets)} sub={`${fmtNum(kpis.linked)} linked to fleet`} />
        <Stat icon={Gauge} label="Avg utilization" value={fmtPct(kpis.avgUtilization)} />
        <Stat icon={TrendingUp} label="Total distance" value={fmtKm(kpis.totalDistanceKm)} />
        <Stat icon={Timer} label="Working hours" value={fmtHrs(kpis.totalWorkingHours)} sub={`${fmtHrs(kpis.totalIdleHours)} idle`} />
        <Stat icon={AlertTriangle} label="High idle assets" value={fmtNum(kpis.highIdle)} sub="idle >= 50%" tone={kpis.highIdle ? 'text-amber-300' : 'text-slate-100'} />
        <Stat icon={MapPin} label="With current km" value={fmtNum(kpis.withCurrentKm)} />
      </div>

      {/* Charts */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="text-sm font-medium text-slate-200 mb-3">Utilization bands</div>
            <div className="h-56"><Doughnut data={bandChart} options={{ maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#cbd5e1' } } } }} /></div>
          </div>
          <div className="card p-4">
            <div className="text-sm font-medium text-slate-200 mb-3">By country</div>
            <div className="h-56">
              <Bar data={countryChart} options={{
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#cbd5e1' } } },
                scales: {
                  x: { ticks: { color: '#94a3b8' }, grid: { color: 'var(--panel-2)' } },
                  y: { position: 'left', ticks: { color: '#94a3b8' }, grid: { color: 'var(--panel-2)' }, title: { display: true, text: 'Assets', color: '#94a3b8' } },
                  y1: { position: 'right', ticks: { color: '#94a3b8' }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Avg util %', color: '#94a3b8' }, min: 0, max: 100 },
                },
              }} />
            </div>
          </div>
        </div>
      )}

      {!loading && trendChartData(timeline) && (
        <div className="card p-4">
          <div className="text-sm font-medium text-slate-200 mb-3">Utilization by capture</div>
          <div className="h-56"><Bar data={trendChartData(timeline)} options={{ maintainAspectRatio: false, plugins: { legend: { labels: { color: '#cbd5e1' } } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: 'var(--panel-2)' } }, y: { min: 0, max: 100, ticks: { color: '#94a3b8' }, grid: { color: 'var(--panel-2)' } } } }} /></div>
        </div>
      )}

      {!loading && fleet.length > 0 && sites.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="text-sm font-medium text-slate-200 mb-3">Site comparison</div>
            <div className="h-56"><Bar data={siteChart} options={{ maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100, ticks: { color: '#94a3b8' }, grid: { color: 'var(--panel-2)' } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'var(--panel-2)' } } } }} /></div>
            <div className="overflow-x-auto max-h-56 overflow-y-auto mt-3">
              <table className="w-full text-xs">
                <thead className="text-slate-400"><tr>{['Site', 'Assets', 'Avg util', 'Avg idle', 'Distance', 'Idle h', 'High idle'].map((h) => <th key={h} className="text-left px-2 py-1">{h}</th>)}</tr></thead>
                <tbody>{sites.map((x) => (
                  <tr key={x.site} className="border-t border-white/5">
                    <td className="px-2 py-1 text-slate-200">{x.site}</td><td className="px-2 py-1">{x.assets}</td>
                    <td className="px-2 py-1">{fmtPct(x.avgUtilization)}</td><td className="px-2 py-1">{fmtPct(x.avgIdlePct)}</td>
                    <td className="px-2 py-1">{fmtKm(x.distanceKm)}</td><td className="px-2 py-1">{fmtHrs(x.idleHours)}</td><td className="px-2 py-1">{x.highIdle}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </div>
          {coverage && (
            <div className="card p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-medium text-slate-200">Telematics coverage gap</div>
                <div className="flex gap-1">
                  <button onClick={() => exportGap('excel')} disabled={!coverage.uncovered.length} className="btn-ghost gap-1 text-xs"><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</button>
                  <button onClick={() => exportGap('pdf')} disabled={!coverage.uncovered.length} className="btn-ghost gap-1 text-xs"><FileText className="w-3.5 h-3.5" /> PDF</button>
                </div>
              </div>
              <p className="text-xs text-slate-500 mb-3">Active fleet-register assets with no telematics row in this scope. {coverage.unregistered > 0 ? `${coverage.unregistered} telematics row(s) name an asset the register does not hold.` : ''}</p>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div><div className="text-xs text-slate-400">Active assets</div><div className="text-lg font-semibold text-slate-100">{fmtNum(coverage.activeAssets)}</div></div>
                <div><div className="text-xs text-slate-400">With telematics</div><div className="text-lg font-semibold text-slate-100">{fmtNum(coverage.covered)}</div></div>
                <div><div className="text-xs text-slate-400">Coverage</div><div className="text-lg font-semibold text-slate-100">{fmtPct(coverage.coveragePct)}</div></div>
              </div>
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-400"><tr>{['Site', 'Active', 'Tracked', 'Gap', 'Coverage'].map((h) => <th key={h} className="text-left px-2 py-1">{h}</th>)}</tr></thead>
                  <tbody>{coverage.bySite.map((x) => (
                    <tr key={x.site} className="border-t border-white/5">
                      <td className="px-2 py-1 text-slate-200">{x.site}</td><td className="px-2 py-1">{x.active}</td><td className="px-2 py-1">{x.covered}</td>
                      <td className="px-2 py-1 text-amber-300">{x.gap}</td><td className="px-2 py-1">{fmtPct(x.coveragePct)}</td>
                    </tr>))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset, make, model..."
            className="input pl-9 w-full" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"><X className="w-4 h-4" /></button>}
        </div>
        <select value={band} onChange={(e) => setBand(e.target.value)} className="input">
          <option value="All">All bands</option>
          <option value="High">High (&gt;=75%)</option>
          <option value="Medium">Medium (40-75%)</option>
          <option value="Low">Low (&lt;40%)</option>
          <option value="Unknown">Unknown</option>
        </select>
        {fleet.length > 0 && (
          <>
            <select aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)} className="input">
              <option value="">All sites</option>
              {siteOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select aria-label="Vehicle type" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className="input">
              <option value="">All vehicle types</option>
              {typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </>
        )}
        <label className="flex items-center gap-1.5 text-sm text-slate-300 px-2">
          <input type="checkbox" checked={linkedOnly} onChange={(e) => setLinkedOnly(e.target.checked)} /> <Link2 className="w-3.5 h-3.5" /> Linked only
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-300 px-2">
          <input type="checkbox" checked={idleHeavy} onChange={(e) => setIdleHeavy(e.target.checked)} /> Idle &gt;= 50%
        </label>
        <span className="text-xs text-slate-500 ml-auto">{sorted.length} of {rows.length}</span>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-400">Loading utilization…</div>
        ) : sorted.length === 0 ? (
          <div className="p-10 text-center text-slate-400">
            {rows.length === 0
              ? 'No telematics utilization has been loaded for this scope yet.'
              : 'No assets match the current filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-slate-400">
                <tr>
                  {[
                    ['asset_no', 'Asset'], ['utilization_pct', 'Utilization'], ['distance_km', 'Distance'],
                    ['idle', 'Idle'], ['working', 'Working'], ['current_km', 'Current km'],
                  ].map(([k, label]) => (
                    <th key={k} className="text-left px-3 py-2 cursor-pointer select-none" onClick={() => toggleSort(k)}>
                      <span className="inline-flex items-center gap-1">{label} <ArrowUpDown className="w-3 h-3 opacity-50" /></span>
                    </th>
                  ))}
                  <th className="text-left px-3 py-2">Max speed</th>
                  <th className="text-left px-3 py-2">Captured</th>
                </tr>
              </thead>
              <tbody>
                {utilizationPager.pageRows.map((r) => (
                  <tr key={r.id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-100">{r.asset_no}</div>
                      <div className="text-xs text-slate-500">
                        {[r.make, r.model].filter(Boolean).join(' ') || 'N/A'}
                        {r.country ? ` · ${r.country}` : ''}
                        {r.site ? ` · ${r.site}` : ''}
                        {!r.linked_to_fleet && <span className="text-amber-400"> · unregistered</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: withAlpha(BAND_TONE[bandOf(r)], 0.18), color: BAND_TONE[bandOf(r)] }}>
                        {fmtPct(r.utilization_pct)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{fmtKm(r.distance_km)}</td>
                    <td className="px-3 py-2">{fmtPct(idlePct(r))}</td>
                    <td className="px-3 py-2">{fmtHrs(secondsToHours(r.working_seconds))}</td>
                    <td className="px-3 py-2">{fmtKm(r.current_km)}</td>
                    <td className="px-3 py-2">{num(r.max_speed) == null ? 'N/A' : `${r.max_speed} km/h`}</td>
                    <td className="px-3 py-2 text-slate-400">{fmtDate(r.captured_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination {...utilizationPager} />
          </div>
        )}
      </div>

      {/* Top idle */}
      {!loading && topIdle.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-medium text-slate-200 mb-3 flex items-center gap-2"><Timer className="w-4 h-4 text-amber-400" /> Most idle time</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {topIdle.map((r) => (
              <div key={r.id} className="rounded-lg bg-white/5 p-3">
                <div className="font-medium text-slate-100 text-sm">{r.asset_no}</div>
                <div className="text-amber-300 text-lg font-semibold">{fmtHrs(r._v)}</div>
                <div className="text-xs text-slate-500">idle {fmtPct(idlePct(r))} · util {fmtPct(r.utilization_pct)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
