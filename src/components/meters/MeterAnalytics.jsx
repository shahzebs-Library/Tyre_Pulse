import { useMemo } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend } from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { summarizeMileage, computeAssetMileage, mileageTrend, kmBySite, detectAnomalies } from '../../lib/odometerAnalytics'
import EnterpriseTable from '../ui/EnterpriseTable'
import { compareValues, isBlank } from '../../lib/consoleTable'
import { readingDate } from '../../lib/vehicleMeters'
import { colorAt } from '../../lib/reportColors'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)
const options = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
const number = n => n == null ? 'Not available' : Number(n).toLocaleString()
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (isBlank(v) ? undefined : v)
const sortable = { sortingFn: valueSort, sortUndefined: 'last' }
const numCell = (key) => ({ row: { original: r } }) => <span className="tabular-nums">{number(r[key])}</span>
const COLUMNS = [
  { id: 'asset', header: 'Vehicle', accessorFn: (r) => blank(r.asset), ...sortable },
  { id: 'latestKm', header: 'Latest km', accessorFn: (r) => blank(r.latestKm), ...sortable, meta: { align: 'right', exportValue: (r) => r.latestKm ?? 'N/A' }, cell: numCell('latestKm') },
  { id: 'kmAdded', header: 'Distance km', accessorFn: (r) => blank(r.kmAdded), ...sortable, meta: { align: 'right', exportValue: (r) => r.kmAdded ?? 'N/A' }, cell: numCell('kmAdded') },
  { id: 'avgDailyKm', header: 'Average / day', accessorFn: (r) => blank(r.avgDailyKm), ...sortable, meta: { align: 'right', exportValue: (r) => r.avgDailyKm ?? 'N/A' }, cell: numCell('avgDailyKm') },
  { id: 'readingCount', header: 'Readings', accessorFn: (r) => r.readingCount, ...sortable, meta: { align: 'right' } },
  { id: 'latestDate', header: 'Last reading', accessorFn: (r) => blank(r.latestDate), ...sortable, meta: { exportValue: (r) => readingDate(r.latestDate) }, cell: ({ row: { original: r } }) => readingDate(r.latestDate) },
]
export default function MeterAnalytics({ rows }) {
  // Qualify asset numbers so different countries cannot merge into one history.
  const readings = useMemo(() => rows.map(r => ({ ...r, asset_no: `${r.country || 'Unspecified'} / ${r.asset_no}` })), [rows])
  const summary = useMemo(() => summarizeMileage(readings), [readings])
  const assets = useMemo(() => computeAssetMileage(readings), [readings])
  const trend = useMemo(() => mileageTrend(readings), [readings])
  const sites = useMemo(() => kmBySite(readings), [readings])
  const flags = useMemo(() => detectAnomalies(readings), [readings])
  return <div className="space-y-4">
    <p className="text-sm text-[var(--text-muted)]">Kilometre analytics for the selected filters. Engine hours are available in the vehicle table and history.</p>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[
      ['Assets tracked', summary.assetsTracked], ['Readings', summary.totalReadings], ['Distance logged (km)', assets.some(a => a.kmAdded != null) ? summary.totalKmLogged : null], ['Data-quality flags', summary.anomalyCount],
    ].map(([label, value]) => <div className="card" key={label}><p className="text-xs text-[var(--text-muted)]">{label}</p><p className="text-2xl font-semibold">{number(value)}</p></div>)}</div>
    {trend.length > 0 && <div className="grid lg:grid-cols-2 gap-4">
      <div className="card"><h3 className="font-medium mb-3">Distance by month</h3><div className="h-60" role="img" aria-label="Kilometres logged per month"><Line options={options} data={{ labels: trend.map(r => r.period), datasets: [{ label: 'Kilometres', data: trend.map(r => r.km), borderColor: colorAt(0) }] }} /></div></div>
      <div className="card"><h3 className="font-medium mb-3">Distance by site</h3><div className="h-60" role="img" aria-label="Kilometres logged per site"><Bar options={options} data={{ labels: sites.map(r => r.label), datasets: [{ label: 'Kilometres', data: sites.map(r => r.value), backgroundColor: colorAt(2) }] }} /></div></div>
    </div>}
    {flags.length > 0 && <details className="card"><summary className="cursor-pointer font-medium min-h-[44px] flex items-center">Review {flags.length} data-quality flags</summary><div className="max-h-64 overflow-auto mt-3">{flags.map((f, i) => <p key={`${f.id}:${i}`} className="text-sm py-2 border-b border-[var(--input-border)]">{f.asset}: {f.message}</p>)}</div></details>}
    <div className="card !p-0 overflow-hidden">
      <EnterpriseTable columns={COLUMNS} data={assets} getRowId={(r) => String(r.asset)}
        searchPlaceholder="Search vehicle..." enableColumnFilters={false}
        exportFileName="Meter kilometre analytics" emptyMessage="No kilometre history for these filters." />
    </div>
  </div>
}
