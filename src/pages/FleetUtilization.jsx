/**
 * FleetUtilization (route /fleet-utilization) - Fleet Utilization & Telematics.
 *
 * Surfaces the telematics snapshot loaded into `asset_utilization` (V406): per
 * asset how hard it worked (utilization %), how far it ran (distance km), how
 * much it sat (idle %), working hours, max speed and the latest odometer, which
 * also feeds each asset's current km. Real data only, honest empty/error states,
 * never fabricated. Maths live in the pure engines `src/lib/fleetUtilization.js`
 * (bands, idle, summaries) and `src/lib/fleetUtilizationAnalytics.js` (register
 * join, site comparison, coverage gap, sorting, export rows);
 * `src/lib/api/assetUtilization.js` is the only telematics Supabase seam.
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
  FileText, RefreshCcw, MapPin, AlertTriangle, Link2, ChevronUp, ChevronDown, ChevronsUpDown, Radar,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import { listAssetUtilization } from '../lib/api/assetUtilization'
import {
  summarizeUtilization, filterUtilization, bandDistribution, byCountry,
  topBy, bandOf, idlePct, secondsToHours, num,
} from '../lib/fleetUtilization'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { colorAt, withAlpha } from '../lib/reportColors'
import { listAssetOptions } from '../lib/api/assetHistory'
import { nextSort, sortRows } from '../lib/consoleTableSort'
import {
  attachRegister, siteComparison, telematicsCoverage, captureTimeline, filterByRegister, NO_SITE, NO_TYPE,
  UTILIZATION_SORT_ACCESSORS, UTILIZATION_EXPORT_COLS, UTILIZATION_EXPORT_HEADERS, utilizationExportRows,
  COVERAGE_GAP_COLS, COVERAGE_GAP_HEADERS, coverageGapExportRows, readingCoverage,
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

/** Band tones are semantic (the colour carries meaning), so they stay fixed. */
const BAND_TONE = { High: '#16a34a', Medium: '#f59e0b', Low: '#ef4444', Unknown: '#94a3b8' }
const TICK = { color: 'var(--text-muted)' }
const GRID = { color: 'var(--panel-2)' }
const LEGEND = { labels: { color: 'var(--text-secondary)' } }
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-bright,#22c55e)]'
const BTN = `btn-ghost gap-1 min-h-[44px] ${FOCUS}`

function trendChartData(timeline) {
  if (!timeline?.trendable) return null
  return {
    labels: timeline.points.map((p) => p.date),
    datasets: [{ label: 'Avg utilization %', data: timeline.points.map((p) => (p.avgUtilization == null ? null : Math.round(p.avgUtilization * 10) / 10)), backgroundColor: withAlpha(colorAt(0), 0.85) }],
  }
}

function Stat({ icon: Icon, label, value, sub, warn = false }) {
  return (
    <div className="card p-4 flex items-start gap-3 min-w-0">
      <div className="rounded-lg bg-[var(--input-bg)] p-2 shrink-0"><Icon className="w-5 h-5 text-emerald-500" aria-hidden="true" /></div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${warn ? 'text-amber-500' : 'text-[var(--text-primary)]'}`}>{value}</div>
        {sub && <div className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function SortButton({ label, active, dir, onClick, align }) {
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 min-h-[32px] rounded ${FOCUS} ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-[var(--text-primary)]' : ''}`}
      aria-label={`Sort by ${label}${active ? `, currently ${dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
    >
      {label}
      <Icon size={12} aria-hidden="true" />
    </button>
  )
}

/**
 * EnterpriseTable over the shared pager. Sorting runs over the FULL row set
 * before paging, so a column sort never re-orders only the visible page.
 */
function SortedPagedTable({ columns, rows, sort, onSort, getRowId, emptyMessage, loading, error, onRetry, maxHeight = 600 }) {
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === sort?.key)
    return col?.sort ? sortRows(rows, sort, { [col.id]: col.sort }) : rows
  }, [rows, columns, sort])
  const pager = usePagedRows(sorted)
  const tableColumns = useMemo(() => columns.map((c) => ({
    id: c.id,
    accessorFn: c.sort || ((r) => r[c.id]),
    header: c.sort
      ? () => <SortButton label={c.header} align={c.align} active={sort?.key === c.id} dir={sort?.dir} onClick={() => onSort(c.id, c.firstDir || 'desc')} />
      : c.header,
    cell: c.cell ? ({ row }) => c.cell(row.original) : undefined,
    size: c.size,
    enableSorting: false,
    meta: { align: c.align },
  })), [columns, sort, onSort])
  return (
    <div className="space-y-2">
      <EnterpriseTable
        columns={tableColumns}
        data={pager.pageRows}
        getRowId={getRowId}
        loading={loading}
        error={error || null}
        onRetry={onRetry}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableSorting={false}
        enableExport={false}
        virtual
        maxHeight={maxHeight}
        emptyMessage={emptyMessage}
      />
      {!loading && !error && <TablePagination {...pager} />}
    </div>
  )
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
  const [sort, setSort] = useState({ key: 'utilization', dir: 'desc' })
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
    else { setRows([]); setError(toUserMessage(util.reason, 'Telematics utilization could not be loaded.')) }
    if (reg.status === 'fulfilled' && reg.value?.ok) setFleet(reg.value.rows || [])
    else { setFleet([]); setFleetError('The fleet register could not be read, so site, vehicle type and the coverage gap are unavailable.') }
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const failed = !!error
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

  const kpis = useMemo(() => summarizeUtilization(filtered), [filtered])
  const readPct = useMemo(() => readingCoverage(filtered), [filtered])
  const bands = useMemo(() => bandDistribution(filtered), [filtered])
  const countries = useMemo(() => byCountry(filtered), [filtered])
  const topIdle = useMemo(() => topBy(filtered, 'idleHours', 10), [filtered])

  const onSort = useCallback((key, firstDir) => setSort((s) => nextSort(s, key, firstDir)), [])
  const sortedForExport = useMemo(() => {
    const get = UTILIZATION_SORT_ACCESSORS[sort.key]
    return get ? sortRows(filtered, sort, { [sort.key]: get }) : filtered
  }, [filtered, sort])
  const exportRows = useMemo(() => utilizationExportRows(sortedForExport), [sortedForExport])
  const fileBase = reportFileName('Fleet Utilization', activeCountry)

  function exportGap(kind) {
    const out = coverageGapExportRows(coverage)
    if (!out.length) return
    const name = reportFileName('Telematics Coverage Gap', activeCountry)
    if (kind === 'excel') exportToExcel(out, COVERAGE_GAP_COLS, COVERAGE_GAP_HEADERS, name)
    else exportToPdf(out, COVERAGE_GAP_COLS.map((k, i) => ({ key: k, header: COVERAGE_GAP_HEADERS[i] })), 'Telematics coverage gap', name, 'portrait')
  }

  const filtersActive = search || band !== 'All' || linkedOnly || idleHeavy || site || vehicleType
  const clearFilters = () => { setSearch(''); setBand('All'); setLinkedOnly(false); setIdleHeavy(false); setSite(''); setVehicleType('') }

  const siteChart = {
    labels: sites.slice(0, 15).map((x) => x.site),
    datasets: [{ label: 'Avg utilization %', data: sites.slice(0, 15).map((x) => (x.avgUtilization == null ? null : Math.round(x.avgUtilization * 10) / 10)), backgroundColor: withAlpha(colorAt(1), 0.85) }],
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

  const registerColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', sort: UTILIZATION_SORT_ACCESSORS.asset_no, firstDir: 'asc', size: 230,
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-[var(--text-primary)]">{r.asset_no}</div>
          <div className="text-xs text-[var(--text-muted)] truncate">
            {[[r.make, r.model].filter(Boolean).join(' ') || null, r.country, r.site, r.vehicle_type].filter(Boolean).join(', ') || 'N/A'}
            {!r.linked_to_fleet && <span className="text-amber-500">, unregistered</span>}
          </div>
        </div>
      ) },
    { id: 'utilization', header: 'Utilization', sort: UTILIZATION_SORT_ACCESSORS.utilization, align: 'right', size: 140,
      cell: (r) => {
        const b = bandOf(r)
        return (
          <span className="px-2 py-0.5 rounded text-xs font-medium tabular-nums whitespace-nowrap" style={{ background: withAlpha(BAND_TONE[b], 0.18), color: BAND_TONE[b] }}>
            {fmtPct(r.utilization_pct)}{b !== 'Unknown' ? ` ${b}` : ''}
          </span>
        )
      } },
    { id: 'distance', header: 'Distance', sort: UTILIZATION_SORT_ACCESSORS.distance, align: 'right', size: 120, cell: (r) => <span className="tabular-nums">{fmtKm(r.distance_km)}</span> },
    { id: 'idle', header: 'Idle', sort: UTILIZATION_SORT_ACCESSORS.idle, align: 'right', size: 90,
      cell: (r) => { const ip = idlePct(r); return <span className={`tabular-nums ${ip != null && ip >= 50 ? 'text-amber-500 font-medium' : ''}`}>{fmtPct(ip)}</span> } },
    { id: 'working', header: 'Working', sort: UTILIZATION_SORT_ACCESSORS.working, align: 'right', size: 100, cell: (r) => <span className="tabular-nums">{fmtHrs(secondsToHours(r.working_seconds))}</span> },
    { id: 'current_km', header: 'Current km', sort: UTILIZATION_SORT_ACCESSORS.current_km, align: 'right', size: 120, cell: (r) => <span className="tabular-nums">{fmtKm(r.current_km)}</span> },
    { id: 'max_speed', header: 'Max speed', sort: UTILIZATION_SORT_ACCESSORS.max_speed, align: 'right', size: 100, cell: (r) => <span className="tabular-nums">{num(r.max_speed) == null ? 'N/A' : `${r.max_speed} km/h`}</span> },
    { id: 'captured', header: 'Captured', sort: UTILIZATION_SORT_ACCESSORS.captured, size: 110, cell: (r) => <span className="text-[var(--text-muted)] tabular-nums">{fmtDate(r.captured_at)}</span> },
  ], [])

  const siteColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorFn: (x) => x.site, cell: ({ row }) => <span className="text-[var(--text-primary)]">{row.original.site}</span> },
    { id: 'assets', header: 'Assets', accessorFn: (x) => x.assets, meta: { align: 'right' } },
    { id: 'util', header: 'Avg util', accessorFn: (x) => x.avgUtilization, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.avgUtilization) },
    { id: 'idle', header: 'Avg idle', accessorFn: (x) => x.avgIdlePct, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.avgIdlePct) },
    { id: 'distance', header: 'Distance', accessorFn: (x) => x.distanceKm, meta: { align: 'right' }, cell: ({ row }) => fmtKm(row.original.distanceKm) },
    { id: 'idle_h', header: 'Idle h', accessorFn: (x) => x.idleHours, meta: { align: 'right' }, cell: ({ row }) => fmtHrs(row.original.idleHours) },
    { id: 'high', header: 'High idle', accessorFn: (x) => x.highIdle, meta: { align: 'right' } },
  ], [])

  const coverageColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorFn: (x) => x.site, cell: ({ row }) => <span className="text-[var(--text-primary)]">{row.original.site}</span> },
    { id: 'active', header: 'Active', accessorFn: (x) => x.active, meta: { align: 'right' } },
    { id: 'covered', header: 'Tracked', accessorFn: (x) => x.covered, meta: { align: 'right' } },
    { id: 'gap', header: 'Gap', accessorFn: (x) => x.gap, meta: { align: 'right' }, cell: ({ row }) => <span className={row.original.gap ? 'text-amber-500 font-medium' : ''}>{row.original.gap}</span> },
    { id: 'pct', header: 'Coverage', accessorFn: (x) => x.coveragePct, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.coveragePct) },
  ], [])

  const na = (v) => (loading || failed ? 'N/A' : v)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fleet Utilization"
        subtitle="Telematics: how hard each asset works, how far it runs, how much it sits idle, and its current km."
        icon={Activity}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={load} disabled={loading} className={BTN} aria-label="Refresh utilization"><RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
            <button type="button" onClick={() => exportToExcel(exportRows, UTILIZATION_EXPORT_COLS, UTILIZATION_EXPORT_HEADERS, fileBase)}
              disabled={!exportRows.length} className={BTN}><FileSpreadsheet className="w-4 h-4" aria-hidden="true" /> Excel</button>
            <button type="button" onClick={() => exportToPdf(exportRows, UTILIZATION_EXPORT_COLS.map((k, i) => ({ key: k, header: UTILIZATION_EXPORT_HEADERS[i] })), 'Fleet Utilization', fileBase, 'landscape')}
              disabled={!exportRows.length} className={BTN}><FileText className="w-4 h-4" aria-hidden="true" /> PDF</button>
          </div>
        }
      />

      {error && (
        <div className="card p-4 border border-red-500/40 flex flex-wrap items-center justify-between gap-2" role="alert">
          <div className="flex items-center gap-2 text-red-400 min-w-0"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{error} Figures read N/A until it loads.</span></div>
          <button type="button" onClick={load} className={BTN}><RefreshCcw className="w-4 h-4" aria-hidden="true" /> Retry</button>
        </div>
      )}

      {fleetError && (
        <div className="card p-3 text-sm text-amber-500 flex flex-wrap items-center justify-between gap-2" role="status">
          <span className="min-w-0">{fleetError}</span>
          <button type="button" onClick={load} className={BTN}><RefreshCcw className="w-4 h-4" aria-hidden="true" /> Retry</button>
        </div>
      )}
      {!loading && timeline.points.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          {timeline.trendable
            ? `${timeline.points.length} telematics captures loaded, from ${timeline.points[0].date} to ${timeline.points[timeline.points.length - 1].date}.`
            : `One telematics capture is loaded (${timeline.points[0].date}). Figures are a snapshot; a utilization trend appears once further captures are loaded.`}
        </p>
      )}

      {/* KPI strip (follows the filters) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" aria-busy={loading}>
        <Stat icon={Truck} label="Assets tracked" value={na(fmtNum(kpis.assets))} sub={loading || failed ? null : `${fmtNum(kpis.linked)} linked to fleet`} />
        <Stat icon={Gauge} label="Avg utilization" value={na(fmtPct(kpis.avgUtilization))} sub={loading || failed ? null : readPct == null ? 'no readings' : `${fmtPct(readPct)} of assets reporting`} />
        <Stat icon={TrendingUp} label="Total distance" value={na(fmtKm(kpis.totalDistanceKm))} sub={loading || failed ? null : `${fmtNum(kpis.withCurrentKm)} with current km`} />
        <Stat icon={Timer} label="Working hours" value={na(fmtHrs(kpis.totalWorkingHours))} sub={loading || failed ? null : `${fmtHrs(kpis.totalIdleHours)} idle`} />
        <Stat icon={AlertTriangle} label="High idle assets" value={na(fmtNum(kpis.highIdle))} sub="idle at or above 50%" warn={!loading && !failed && kpis.highIdle > 0} />
        <Stat icon={Radar} label="Telematics coverage" value={loading ? 'N/A' : coverage ? fmtPct(coverage.coveragePct) : 'N/A'}
          sub={loading ? null : coverage ? `${fmtNum(coverage.covered)} of ${fmtNum(coverage.activeAssets)} active assets` : 'fleet register unavailable'} />
      </div>

      {/* Filters */}
      <div className="card p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,2fr)_repeat(3,minmax(0,1fr))] gap-2">
          <div className="relative">
            <label htmlFor="util-search" className="sr-only">Search assets</label>
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="util-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset, make, model..."
              className="input pl-9 w-full min-h-[44px]" />
          </div>
          <select aria-label="Utilization band" value={band} onChange={(e) => setBand(e.target.value)} className="input min-h-[44px]">
            <option value="All">All bands</option>
            <option value="High">High (75% and above)</option>
            <option value="Medium">Medium (40 to 75%)</option>
            <option value="Low">Low (below 40%)</option>
            <option value="Unknown">Unknown</option>
          </select>
          <select aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)} className="input min-h-[44px]" disabled={!fleet.length} title={fleet.length ? undefined : 'Needs the fleet register'}>
            <option value="">All sites</option>
            {siteOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select aria-label="Vehicle type" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className="input min-h-[44px]" disabled={!fleet.length} title={fleet.length ? undefined : 'Needs the fleet register'}>
            <option value="">All vehicle types</option>
            {typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] px-2 min-h-[44px] cursor-pointer">
            <input type="checkbox" className="w-4 h-4" checked={linkedOnly} onChange={(e) => setLinkedOnly(e.target.checked)} /> <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Linked to fleet only
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] px-2 min-h-[44px] cursor-pointer">
            <input type="checkbox" className="w-4 h-4" checked={idleHeavy} onChange={(e) => setIdleHeavy(e.target.checked)} /> Idle at or above 50%
          </label>
          {filtersActive && <button type="button" onClick={clearFilters} className={BTN}><X className="w-4 h-4" aria-hidden="true" /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{failed ? 'N/A' : `${filtered.length} of ${rows.length} assets`}</span>
        </div>
      </div>

      {/* Charts */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4 min-w-0">
            <h2 className="text-sm font-medium text-[var(--text-primary)] mb-3">Utilization bands</h2>
            <div className="h-56" role="img" aria-label={`Utilization bands: ${bands.map((b) => `${b.band} ${b.count}`).join(', ')}`}>
              <Doughnut data={bandChart} options={{ maintainAspectRatio: false, plugins: { legend: { position: 'right', ...LEGEND } } }} />
            </div>
          </div>
          <div className="card p-4 min-w-0">
            <h2 className="text-sm font-medium text-[var(--text-primary)] mb-3">By country</h2>
            <div className="h-56" role="img" aria-label={`By country: ${countries.map((c) => `${c.country} ${c.assets} assets`).join(', ')}`}>
              <Bar data={countryChart} options={{
                maintainAspectRatio: false,
                plugins: { legend: LEGEND },
                scales: {
                  x: { ticks: TICK, grid: GRID },
                  y: { position: 'left', ticks: TICK, grid: GRID, title: { display: true, text: 'Assets', ...TICK } },
                  y1: { position: 'right', ticks: TICK, grid: { drawOnChartArea: false }, title: { display: true, text: 'Avg util %', ...TICK }, min: 0, max: 100 },
                },
              }} />
            </div>
          </div>
        </div>
      )}

      {!loading && trendChartData(timeline) && (
        <div className="card p-4">
          <h2 className="text-sm font-medium text-[var(--text-primary)] mb-3">Utilization by capture</h2>
          <div className="h-56" role="img" aria-label="Average utilization per telematics capture"><Bar data={trendChartData(timeline)} options={{ maintainAspectRatio: false, plugins: { legend: LEGEND }, scales: { x: { ticks: TICK, grid: GRID }, y: { min: 0, max: 100, ticks: TICK, grid: GRID } } }} /></div>
        </div>
      )}

      {!loading && fleet.length > 0 && sites.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4 min-w-0">
            <h2 className="text-sm font-medium text-[var(--text-primary)] mb-3">Site comparison</h2>
            <div className="h-56" role="img" aria-label="Average utilization by site, top 15"><Bar data={siteChart} options={{ maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100, ticks: TICK, grid: GRID }, y: { ticks: TICK, grid: GRID } } }} /></div>
            <div className="mt-3">
              <EnterpriseTable
                columns={siteColumns}
                data={sites}
                getRowId={(x) => String(x.site)}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                virtual
                maxHeight={260}
                emptyMessage="No sites in this view."
              />
            </div>
          </div>
          {coverage && (
            <div className="card p-4 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h2 className="text-sm font-medium text-[var(--text-primary)]">Telematics coverage gap</h2>
                <div className="flex gap-1">
                  <button type="button" onClick={() => exportGap('excel')} disabled={!coverage.uncovered.length} className={`${BTN} text-xs`}><FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" /> Excel</button>
                  <button type="button" onClick={() => exportGap('pdf')} disabled={!coverage.uncovered.length} className={`${BTN} text-xs`}><FileText className="w-3.5 h-3.5" aria-hidden="true" /> PDF</button>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3">Active fleet-register assets with no telematics row in this scope. {coverage.unregistered > 0 ? `${coverage.unregistered} telematics row(s) name an asset the register does not hold.` : ''}</p>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div><div className="text-xs text-[var(--text-muted)]">Active assets</div><div className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{fmtNum(coverage.activeAssets)}</div></div>
                <div><div className="text-xs text-[var(--text-muted)]">With telematics</div><div className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{fmtNum(coverage.covered)}</div></div>
                <div><div className="text-xs text-[var(--text-muted)]">Coverage</div><div className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{fmtPct(coverage.coveragePct)}</div></div>
              </div>
              <EnterpriseTable
                columns={coverageColumns}
                data={coverage.bySite}
                getRowId={(x) => String(x.site)}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableExport={false}
                virtual
                maxHeight={260}
                emptyMessage="No active register assets in this scope."
              />
            </div>
          )}
        </div>
      )}

      {/* Register */}
      <section className="card p-2 sm:p-3 min-w-0" aria-labelledby="util-register-h">
        <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
          <h2 id="util-register-h" className="text-sm font-medium text-[var(--text-primary)]">Utilization register</h2>
          <span className="text-xs text-[var(--text-muted)] ml-auto">Sort any column; exports cover every filtered asset in this order.</span>
        </div>
        <SortedPagedTable
          columns={registerColumns}
          rows={filtered}
          sort={sort}
          onSort={onSort}
          getRowId={(r) => String(r.id)}
          loading={loading}
          error={error}
          onRetry={load}
          emptyMessage={rows.length === 0 ? 'No telematics utilization has been loaded for this scope yet.' : 'No assets match the current filters.'}
        />
      </section>

      {/* Top idle */}
      {!loading && topIdle.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2"><Timer className="w-4 h-4 text-amber-500" aria-hidden="true" /> Most idle time</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {topIdle.map((r) => (
              <div key={r.id} className="rounded-lg bg-[var(--input-bg)] p-3 min-w-0">
                <div className="font-medium text-[var(--text-primary)] text-sm">{r.asset_no}</div>
                <div className="text-amber-500 text-lg font-semibold tabular-nums">{fmtHrs(r._v)}</div>
                <div className="text-xs text-[var(--text-muted)]">idle {fmtPct(idlePct(r))}, util {fmtPct(r.utilization_pct)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Site / type need the register; say so rather than hiding it silently. */}
      {!loading && !fleet.length && !fleetError && rows.length > 0 && (
        <p className="text-xs text-[var(--text-muted)] flex items-center gap-1"><MapPin className="w-3.5 h-3.5" aria-hidden="true" /> No fleet register rows in this scope, so site comparison and the coverage gap are not shown.</p>
      )}
    </div>
  )
}
