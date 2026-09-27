/**
 * Meter coverage and data quality: which vehicles have no reading or a stale
 * one, how coverage splits by region / site / vehicle type, flagged readings by
 * source, and regressions from odometerAnalytics. Maths in
 * src/lib/meterCoverageAnalytics.js.
 */
import { useMemo, useState } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { detectAnomalies, STALE_DAYS } from '../../lib/odometerAnalytics'
import {
  vehicleMeterStatus, groupMeterCoverage, meterTotals, flagSummary, anomalyCounts,
  filterMeterStatus, sortMeterStatus, METER_STATE_LABEL, NO_REGION, NO_SITE, NO_TYPE,
} from '../../lib/meterCoverageAnalytics'
import { readingDate } from '../../lib/vehicleMeters'
import { exportToExcel, exportToPdf } from '../../lib/exportUtils'
import EnterpriseTable from '../ui/EnterpriseTable'
import { compareValues, isBlank } from '../../lib/consoleTable'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const TONE = { fresh: '#16a34a', stale: '#f59e0b', never: '#ef4444', not_applicable: '#94a3b8' }
const DIMS = [['region', 'Region'], ['site', 'Site'], ['vehicle_type', 'Vehicle type']]
const COLS = ['asset_no', 'country', 'region', 'site', 'vehicle_type', 'state', 'last_reading', 'days_since', 'missing']
const HEADS = ['Vehicle', 'Country', 'Region', 'Site', 'Vehicle type', 'Coverage', 'Last reading', 'Days since', 'Missing meter']
const missingLabel = (r) => [r.missing_km && 'Kilometres', r.missing_hours && 'Engine hours'].filter(Boolean).join(' + ') || 'None'
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (isBlank(v) ? undefined : v)
const sortable = { sortingFn: valueSort, sortUndefined: 'last' }
const pct = (v) => (v == null ? 'N/A' : `${v}%`)

const STATUS_COLUMNS = [
  { id: 'asset_no', header: 'Vehicle', accessorFn: (r) => blank(r.asset_no), ...sortable, cell: ({ row: { original: r } }) => <span className="font-medium text-[var(--text-primary)]">{r.asset_no}</span> },
  { id: 'country', header: 'Country', accessorFn: (r) => blank(r.country), ...sortable, meta: { exportValue: (r) => r.country || 'N/A' }, cell: ({ row: { original: r } }) => r.country || 'N/A' },
  { id: 'region', header: 'Region', accessorFn: (r) => r.region || NO_REGION, ...sortable },
  { id: 'site', header: 'Site', accessorFn: (r) => r.site || NO_SITE, ...sortable },
  { id: 'vehicle_type', header: 'Vehicle type', accessorFn: (r) => r.vehicle_type || NO_TYPE, ...sortable },
  {
    id: 'state', header: 'Coverage', accessorFn: (r) => METER_STATE_LABEL[r.state], ...sortable,
    cell: ({ row: { original: r } }) => <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: TONE[r.state] }} />{METER_STATE_LABEL[r.state]}</span>,
  },
  { id: 'last_reading', header: 'Last reading', accessorFn: (r) => blank(r.last_reading), ...sortable, meta: { exportValue: (r) => readingDate(r.last_reading) }, cell: ({ row: { original: r } }) => readingDate(r.last_reading) },
  { id: 'days_since', header: 'Days since', accessorFn: (r) => blank(r.days_since), ...sortable, meta: { align: 'right', exportValue: (r) => r.days_since ?? 'N/A' }, cell: ({ row: { original: r } }) => <span className="tabular-nums">{r.days_since ?? 'N/A'}</span> },
  { id: 'missing', header: 'Missing meter', accessorFn: (r) => missingLabel(r), ...sortable },
]

const SOURCE_COLUMNS = [
  { id: 'source', header: 'Source', accessorFn: (r) => blank(r.source), ...sortable },
  { id: 'readings', header: 'Readings', accessorFn: (r) => r.readings, ...sortable, meta: { align: 'right' } },
  { id: 'flagged', header: 'Flagged', accessorFn: (r) => r.flagged, ...sortable, meta: { align: 'right' } },
  { id: 'flagRatePct', header: 'Flag rate', accessorFn: (r) => blank(r.flagRatePct), ...sortable, meta: { align: 'right', exportValue: (r) => pct(r.flagRatePct) }, cell: ({ row: { original: r } }) => pct(r.flagRatePct) },
]

export default function MeterCoverage({ vehicles = [], history = [], today }) {
  const [dim, setDim] = useState('region')
  const [f, setF] = useState({ search: '', state: '', region: '', site: '', vehicleType: '', missing: '' })

  const status = useMemo(() => vehicleMeterStatus(vehicles, { today, staleDays: STALE_DAYS }), [vehicles, today])
  const totals = useMemo(() => meterTotals(status), [status])
  const groups = useMemo(() => groupMeterCoverage(status, dim), [status, dim])
  const flags = useMemo(() => flagSummary(history), [history])
  const anomalies = useMemo(() => anomalyCounts(detectAnomalies(
    history.filter((r) => r.kind === 'km').map((r) => ({ ...r, asset_no: `${r.country || 'Unspecified'} / ${r.asset_no}` })),
  )), [history])
  const rows = useMemo(() => sortMeterStatus(filterMeterStatus(status, f), 'days_since', 'desc'), [status, f])
  const opts = useMemo(() => ({
    region: [...new Set(status.map((r) => r.region || NO_REGION))].sort(),
    site: [...new Set(status.map((r) => r.site || NO_SITE))].sort(),
    vehicleType: [...new Set(status.map((r) => r.vehicle_type || NO_TYPE))].sort(),
  }), [status])
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }))

  function exportRows(kind) {
    const out = rows.map((r) => ({
      ...r, region: r.region || NO_REGION, site: r.site || NO_SITE, vehicle_type: r.vehicle_type || NO_TYPE,
      state: METER_STATE_LABEL[r.state], last_reading: r.last_reading || 'N/A', days_since: r.days_since ?? 'N/A', missing: missingLabel(r),
    }))
    if (!out.length) return
    if (kind === 'excel') exportToExcel(out, COLS, HEADS, 'Meter Coverage')
    else exportToPdf(out, COLS.map((k, i) => ({ key: k, header: HEADS[i] })), 'Meter coverage and quality', 'Meter Coverage', 'landscape')
  }

  if (!status.length) return <p className="card text-sm">No vehicles in this scope.</p>
  const top = groups.slice(0, 12)
  const chart = {
    labels: top.map((g) => g.key),
    datasets: ['fresh', 'stale', 'never'].map((s) => ({ label: METER_STATE_LABEL[s], data: top.map((g) => g[s]), backgroundColor: TONE[s], stack: 'c' })),
  }
  const axis = { ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' } }

  return <div className="space-y-4">
    <p className="text-sm text-[var(--text-muted)]">A reading is recent when it is within {STALE_DAYS} days. Vehicles for the current filters; duplicate register identities are excluded.</p>
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{[
      ['Metered vehicles', totals.vehicles], ['Recent reading', totals.fresh], ['Stale', totals.stale], ['No reading', totals.never],
      ['Coverage', totals.ratePct == null ? 'N/A' : `${totals.ratePct}%`], ['Meters not established', totals.not_applicable],
    ].map(([label, value]) => <div className="card" key={label}><p className="text-xs text-[var(--text-muted)]">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}</div>
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-medium">Coverage by {DIMS.find((d) => d[0] === dim)[1].toLowerCase()}</h3>
          <div className="flex gap-1" role="group" aria-label="Coverage grouping">{DIMS.map(([k, label]) => <button key={k} aria-pressed={dim === k} type="button" className={`${dim === k ? 'btn-primary' : 'btn-secondary'} text-xs min-h-[36px]`} onClick={() => setDim(k)}>{label}</button>)}</div>
        </div>
        {!top.length ? <p className="text-sm">No metered vehicles to group.</p> : <div className="h-64" role="img" aria-label={`Meter coverage by ${DIMS.find((d) => d[0] === dim)[1].toLowerCase()}`}><Bar data={chart} options={{ maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { labels: { color: 'var(--text-secondary)' } } }, scales: { x: { ...axis, stacked: true, ticks: { ...axis.ticks, precision: 0 } }, y: { ...axis, stacked: true } } }} /></div>}
        {groups.length > 12 && <p className="text-xs text-[var(--text-muted)] mt-2">Chart shows the 12 lowest-coverage groups.</p>}
      </div>
      <div className="card space-y-3">
        <h3 className="font-medium">Reading quality</h3>
        <div className="grid grid-cols-3 gap-2 text-sm">{[
          ['Flagged readings', flags.flagged], ['Still unreviewed', flags.awaiting], ['Reviewed', flags.reviewed],
          ['Backward km readings', anomalies.backward], ['Unrealistic jumps', anomalies.jump], ['Duplicate km readings', anomalies.duplicate],
        ].map(([label, value]) => <div key={label}><p className="text-xs text-[var(--text-muted)]">{label}</p><p className="text-lg font-semibold">{value}</p></div>)}</div>
        <EnterpriseTable columns={SOURCE_COLUMNS} data={flags.bySource} getRowId={(r) => String(r.source)}
          enableGlobalFilter={false} enableColumnFilters={false} enableColumnVisibility={false} enableExport={false}
          virtual maxHeight={240} emptyMessage="No readings for these filters." />
      </div>
    </div>
    <div className="card !p-0 overflow-hidden">
      <div className="p-3 flex flex-wrap gap-2 border-b border-[var(--input-border)]">
        <input aria-label="Search coverage" className="input flex-1 min-w-[200px] text-sm" placeholder="Search vehicle, site, region, type..." value={f.search} onChange={(e) => set('search', e.target.value)} />
        <select aria-label="Coverage state" className="input text-sm w-auto" value={f.state} onChange={(e) => set('state', e.target.value)}><option value="">All coverage states</option>{Object.entries(METER_STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Missing meter" className="input text-sm w-auto" value={f.missing} onChange={(e) => set('missing', e.target.value)}><option value="">Any meter</option><option value="km">Missing kilometres</option><option value="hours">Missing engine hours</option></select>
        {[['region', 'All regions', opts.region], ['site', 'All sites', opts.site], ['vehicleType', 'All vehicle types', opts.vehicleType]].map(([k, label, items]) => <select key={k} aria-label={label} className="input text-sm w-auto" value={f[k]} onChange={(e) => set(k, e.target.value)}><option value="">{label}</option>{items.map((i) => <option key={i}>{i}</option>)}</select>)}
        <button type="button" className="btn-secondary text-sm min-h-[44px]" disabled={!rows.length} onClick={() => exportRows('excel')}>Export Excel</button>
        <button type="button" className="btn-secondary text-sm min-h-[44px]" disabled={!rows.length} onClick={() => exportRows('pdf')}>Export PDF</button>
      </div>
      <EnterpriseTable columns={STATUS_COLUMNS} data={rows} getRowId={(r) => String(r.id)}
        enableGlobalFilter={false} enableColumnFilters={false} enableExport={false}
        resetPageKey={JSON.stringify(f)} emptyMessage="No vehicles match these coverage filters." />
    </div>
  </div>
}
