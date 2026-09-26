/**
 * Inspection coverage against the FLEET REGISTER, by region, site and vehicle
 * type, plus inspector workload. Region comes from the site register
 * (siteRegionMap) and is never stored on an inspection. All maths live in the
 * pure src/lib/inspectionPlannerAnalytics.js.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { Search, FileSpreadsheet, FileText, ArrowUpDown } from 'lucide-react'
import { listAssetOptions } from '../../lib/api/assetHistory'
import { listSites, siteRegionMap, regionForSite } from '../../lib/api/sites'
import {
  coverageByAsset, groupCoverage, coverageTotals, filterCoverage, sortCoverage, inspectorWorkload,
  COVERAGE_LABEL, NO_REGION, NO_SITE, NO_TYPE,
} from '../../lib/inspectionPlannerAnalytics'
import { exportToExcel, exportToPdf } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import { colorAt, withAlpha } from '../../lib/reportColors'
import { TablePagination, usePagedRows } from '../ui/TablePagination'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const STATE_TONE = { covered: '#16a34a', overdue: '#f59e0b', never: '#ef4444' }
const DIMS = [['region', 'Region'], ['site', 'Site'], ['vehicle_type', 'Vehicle type']]
const COLS = ['asset_no', 'country', 'region', 'site', 'vehicle_type', 'state', 'last_inspection', 'days_since', 'last_inspector']
const HEADS = ['Asset', 'Country', 'Region', 'Site', 'Vehicle type', 'Coverage', 'Last inspection', 'Days since', 'Last inspector']

export default function PlannerCoveragePanel({ country, inspections = [], schedule = [], today, interval = 30, sourceError }) {
  const [fleet, setFleet] = useState([])
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [dim, setDim] = useState('region')
  const [filters, setFilters] = useState({ search: '', region: '', site: '', vehicleType: '', state: '' })
  const [sort, setSort] = useState({ key: 'days_since', dir: 'desc' })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [fleetRes, siteRows] = await Promise.all([
        listAssetOptions({ country }),
        listSites({ country }).catch(() => []),
      ])
      if (!fleetRes.ok) throw fleetRes.error || new Error('Fleet register unavailable')
      setFleet(fleetRes.rows || [])
      setTruncated(Boolean(fleetRes.truncated))
      setSites(siteRows || [])
    } catch (err) {
      setError(toUserMessage(err, 'Could not read the fleet register.'))
    } finally { setLoading(false) }
  }, [country])
  useEffect(() => { load() }, [load])

  const regionMap = useMemo(() => siteRegionMap(sites), [sites])
  const rows = useMemo(() => coverageByAsset({
    fleet, inspections, today, interval, regionOf: (s) => regionForSite(regionMap, s),
  }), [fleet, inspections, today, interval, regionMap])
  const totals = useMemo(() => coverageTotals(rows), [rows])
  const groups = useMemo(() => groupCoverage(rows, dim), [rows, dim])
  const filtered = useMemo(() => sortCoverage(filterCoverage(rows, filters), sort.key, sort.dir), [rows, filters, sort])
  const workload = useMemo(() => inspectorWorkload(inspections, schedule, { today, days: 30 }), [inspections, schedule, today])
  const pager = usePagedRows(filtered, { pageSize: 25 })
  const options = useMemo(() => ({
    region: [...new Set(rows.map((r) => r.region || NO_REGION))].sort(),
    site: [...new Set(rows.map((r) => r.site || NO_SITE))].sort(),
    vehicleType: [...new Set(rows.map((r) => r.vehicle_type || NO_TYPE))].sort(),
  }), [rows])
  const setF = (k, v) => setFilters((o) => ({ ...o, [k]: v }))
  const toggleSort = (key) => setSort((o) => ({ key, dir: o.key === key && o.dir === 'desc' ? 'asc' : 'desc' }))

  function exportRows(kind) {
    const out = filtered.map((r) => ({
      ...r, region: r.region || NO_REGION, site: r.site || NO_SITE, vehicle_type: r.vehicle_type || NO_TYPE,
      state: COVERAGE_LABEL[r.state], last_inspection: r.last_inspection || 'N/A',
      days_since: r.days_since ?? 'N/A', last_inspector: r.last_inspector || 'N/A',
    }))
    if (!out.length) return
    if (kind === 'excel') exportToExcel(out, COLS, HEADS, 'Inspection Coverage')
    else exportToPdf(out, COLS.map((k, i) => ({ key: k, header: HEADS[i] })), 'Inspection coverage', 'Inspection Coverage', 'landscape')
  }

  if (sourceError) return <p role="status" className="card text-sm">Inspection history is unavailable, so coverage cannot be measured. Retry loading above.</p>
  if (loading) return <p role="status" className="card text-sm">Loading fleet register...</p>
  if (error) return <div role="alert" className="card text-sm space-y-2"><p>{error}</p><button className="btn-secondary" onClick={load}>Retry</button></div>
  if (!rows.length) return <p className="card text-sm">No active assets are in the fleet register for this scope.</p>

  const chartGroups = groups.slice(0, 12)
  const chart = {
    labels: chartGroups.map((g) => g.key),
    datasets: [
      { label: 'Covered', data: chartGroups.map((g) => g.covered), backgroundColor: STATE_TONE.covered, stack: 's' },
      { label: 'Overdue', data: chartGroups.map((g) => g.overdue), backgroundColor: STATE_TONE.overdue, stack: 's' },
      { label: 'Never inspected', data: chartGroups.map((g) => g.never), backgroundColor: STATE_TONE.never, stack: 's' },
    ],
  }
  const workChart = {
    labels: workload.slice(0, 12).map((w) => w.name),
    datasets: [
      { label: 'Readings (30 days)', data: workload.slice(0, 12).map((w) => w.readings), backgroundColor: withAlpha(colorAt(0), 0.85) },
      { label: 'Upcoming appointments', data: workload.slice(0, 12).map((w) => w.upcoming), backgroundColor: withAlpha(colorAt(3), 0.85) },
    ],
  }
  const axis = { ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' } }

  return (
    <section className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">Coverage of every active asset in the fleet register within the {interval}-day analysis interval. Region comes from the site register; a site without a region is shown as {NO_REGION}.</p>
      {truncated && <p role="alert" className="card text-sm">The fleet register read hit its ceiling; coverage describes the loaded assets only.</p>}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[['Active assets', totals.assets], ['Covered', totals.covered], ['Overdue', totals.overdue], ['Never inspected', totals.never], ['Coverage', totals.ratePct == null ? 'N/A' : `${totals.ratePct}%`]].map(([label, value]) => (
          <div key={label} className="card p-4"><span className="block text-sm text-[var(--panel-ink-3)]">{label}</span><strong className="mt-1 block text-2xl">{value}</strong></div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="font-semibold">Coverage by {DIMS.find((d) => d[0] === dim)[1].toLowerCase()}</h2>
            <div className="flex gap-1" role="group" aria-label="Coverage dimension">{DIMS.map(([k, label]) => <button key={k} type="button" aria-pressed={dim === k} className={dim === k ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={() => setDim(k)}>{label}</button>)}</div>
          </div>
          <div className="h-64"><Bar data={chart} options={{ maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { labels: { color: 'var(--text-secondary)' } } }, scales: { x: { ...axis, stacked: true, ticks: { ...axis.ticks, precision: 0 } }, y: { ...axis, stacked: true } } }} /></div>
          {groups.length > 12 && <p className="text-xs text-[var(--text-muted)] mt-2">Chart shows the 12 lowest-coverage groups; the table below lists all.</p>}
          <div className="overflow-x-auto mt-3 max-h-56 overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[var(--text-muted)]"><th className="p-2 text-start">Group</th><th className="p-2 text-end">Assets</th><th className="p-2 text-end">Overdue</th><th className="p-2 text-end">Never</th><th className="p-2 text-end">Coverage</th></tr></thead>
              <tbody>{groups.map((g) => <tr key={g.key} className="border-t border-[var(--hairline)]"><td className="p-2">{g.key}</td><td className="p-2 text-end">{g.assets}</td><td className="p-2 text-end">{g.overdue}</td><td className="p-2 text-end">{g.never}</td><td className="p-2 text-end">{g.ratePct == null ? 'N/A' : `${g.ratePct}%`}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="card p-4">
          <h2 className="font-semibold mb-1">Inspector workload</h2>
          <p className="text-xs text-[var(--text-muted)] mb-3">Readings recorded in the last 30 days and open appointments. Working hours and availability are not recorded.</p>
          {!workload.length ? <p className="text-sm">No inspector activity in the last 30 days.</p> : (
            <>
              <div className="h-48"><Bar data={workChart} options={{ maintainAspectRatio: false, plugins: { legend: { labels: { color: 'var(--text-secondary)' } } }, scales: { x: axis, y: { ...axis, beginAtZero: true, ticks: { ...axis.ticks, precision: 0 } } } }} /></div>
              <div className="overflow-x-auto mt-3 max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-[var(--text-muted)]"><th className="p-2 text-start">Inspector</th><th className="p-2 text-end">Readings</th><th className="p-2 text-end">Assets</th><th className="p-2 text-end">Upcoming</th><th className="p-2 text-end">Missed</th></tr></thead>
                  <tbody>{workload.map((w) => <tr key={w.name} className="border-t border-[var(--hairline)]"><td className="p-2">{w.name}</td><td className="p-2 text-end">{w.readings}</td><td className="p-2 text-end">{w.assets}</td><td className="p-2 text-end">{w.upcoming}</td><td className="p-2 text-end">{w.missed}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="p-3 flex flex-wrap gap-2 items-end border-b border-[var(--hairline)]">
          <label className="relative flex-1 min-w-[200px]"><span className="sr-only">Search coverage</span><Search size={15} className="absolute start-3 top-3 text-[var(--text-muted)]" /><input className="input w-full ps-9 text-sm" placeholder="Search asset, site, type, inspector..." value={filters.search} onChange={(e) => setF('search', e.target.value)} /></label>
          {[['region', 'All regions', options.region], ['site', 'All sites', options.site], ['vehicleType', 'All vehicle types', options.vehicleType]].map(([k, label, items]) => (
            <select key={k} aria-label={label} className="input text-sm w-auto" value={filters[k]} onChange={(e) => setF(k, e.target.value)}><option value="">{label}</option>{items.map((i) => <option key={i}>{i}</option>)}</select>
          ))}
          <select aria-label="Coverage state" className="input text-sm w-auto" value={filters.state} onChange={(e) => setF('state', e.target.value)}><option value="">All states</option>{Object.entries(COVERAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn-secondary text-sm" onClick={() => setFilters({ search: '', region: '', site: '', vehicleType: '', state: '' })}>Clear</button>
          <button className="btn-secondary text-sm" disabled={!filtered.length} onClick={() => exportRows('excel')}><FileSpreadsheet size={14} /> Excel</button>
          <button className="btn-secondary text-sm" disabled={!filtered.length} onClick={() => exportRows('pdf')}><FileText size={14} /> PDF</button>
        </div>
        {!filtered.length ? <p className="p-8 text-center text-sm">No assets match these filters.</p> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[var(--text-muted)]">{COLS.map((k, i) => <th key={k} className="p-2 text-start"><button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort(k)}>{HEADS[i]} <ArrowUpDown size={11} className="opacity-50" /></button></th>)}</tr></thead>
                <tbody>{pager.pageRows.map((r) => (
                  <tr key={`${r.country}|${r.asset_no}`} className="border-t border-[var(--hairline)]">
                    <td className="p-2 font-medium">{r.asset_no}</td><td className="p-2">{r.country || 'N/A'}</td><td className="p-2">{r.region || NO_REGION}</td>
                    <td className="p-2">{r.site || NO_SITE}</td><td className="p-2">{r.vehicle_type || NO_TYPE}</td>
                    <td className="p-2"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: STATE_TONE[r.state] }} />{COVERAGE_LABEL[r.state]}</span></td>
                    <td className="p-2">{r.last_inspection || 'N/A'}</td><td className="p-2">{r.days_since ?? 'N/A'}</td><td className="p-2">{r.last_inspector || 'N/A'}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
            <TablePagination {...pager} />
          </>
        )}
      </div>
    </section>
  )
}
