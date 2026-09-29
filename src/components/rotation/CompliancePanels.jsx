/**
 * Compliance and tyre life impact panels for the Rotation Schedule page. All
 * figures come from rotationScheduleAnalytics; this file only renders them.
 */
import { useMemo } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import EnterpriseTable from '../ui/EnterpriseTable'
import { Card } from '../commandCenter/kit'
import { colorAt, withAlpha } from '../../lib/reportColors'
import { reportFileName, reportDateLabel } from '../../lib/exportUtils'
import { WEAR_IMBALANCE_MM } from '../../lib/rotationScheduleAnalytics'
import { fmt, fmtKm, StatusBadge, VEHICLE_STATUS_TONE } from './rotationUi'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

const CHART = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: 'var(--text-muted)', font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}
const TONE_COLOR = { good: 'var(--cc-green)', warn: 'var(--cc-amber)', bad: 'var(--cc-red)', info: 'var(--cc-blue)', muted: 'var(--cc-ink-3)' }

export default function CompliancePanels({ analytics, currency, moneyOk, company, onPickStatus, onOpenVehicle, onSchedule }) {
  const trend = useMemo(() => (analytics.hasMonthlyRotations ? {
    labels: analytics.monthly.map((m) => m.label),
    datasets: [{ label: 'Rotations performed', data: analytics.monthly.map((m) => m.count), borderColor: colorAt(0), backgroundColor: withAlpha(colorAt(0), 0.15), fill: true, tension: 0.35, pointRadius: 3 }],
  } : null), [analytics])

  const sites = useMemo(() => {
    const sc = analytics.siteCompliance.filter((s) => s.pct != null)
    if (!sc.length) return null
    return {
      labels: sc.map((s) => s.site),
      datasets: [{ label: 'Compliance %', data: sc.map((s) => s.pct), backgroundColor: sc.map((s) => (s.pct >= 90 ? '#16a34a' : s.pct >= 70 ? '#d97706' : '#dc2626')), borderRadius: 4 }],
    }
  }, [analytics])

  const impact = useMemo(() => (analytics.avgLifeWith && analytics.avgLifeWithout ? {
    labels: ['Rotated tyres', 'Never rotated'],
    datasets: [{ label: 'Average tyre life (km)', data: [analytics.avgLifeWith, analytics.avgLifeWithout], backgroundColor: [withAlpha(colorAt(0), 0.85), withAlpha(colorAt(1), 0.85)], borderRadius: 6 }],
  } : null), [analytics])

  const imbalanceColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (v) => v.asset },
    { id: 'site', header: 'Site', accessorFn: (v) => v.site },
    { id: 'steer', header: 'Steer tread', accessorFn: (v) => v.steerTread ?? -1, meta: { align: 'right' }, cell: ({ row }) => (row.original.steerTread != null ? `${row.original.steerTread.toFixed(1)} mm` : 'N/A') },
    { id: 'drive', header: 'Drive tread', accessorFn: (v) => v.driveTread ?? -1, meta: { align: 'right' }, cell: ({ row }) => (row.original.driveTread != null ? `${row.original.driveTread.toFixed(1)} mm` : 'N/A') },
    { id: 'imbalance', header: 'Imbalance', accessorFn: (v) => v.wearImbalance, meta: { align: 'right' }, cell: ({ row }) => `${row.original.wearImbalance.toFixed(1)} mm` },
    { id: 'status', header: 'Status', accessorFn: (v) => v.status, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'action', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => <button type="button" className="cc-btn-ghost" onClick={(e) => { e.stopPropagation(); onSchedule(row.original) }}>Schedule rotation</button>,
    },
  ], [onSchedule])

  const moneyTxt = (v) => (moneyOk && v != null ? `${currency} ${fmt(v)}` : 'N/A')

  return (
    <div className="rs-stack">
      <div className="rs-two">
        <Card title="Monthly rotation activity" sub="Last 12 months, detected rotations">
          {trend ? (
            <div className="rs-chart" role="img" aria-label={`Rotations detected per month, ${analytics.monthly.reduce((s, m) => s + m.count, 0)} in the last 12 months`}>
              <Line data={trend} options={{ ...CHART, scales: { ...CHART.scales, y: { ...CHART.scales.y, min: 0, ticks: { ...CHART.scales.y.ticks, precision: 0 } } } }} />
            </div>
          ) : <div className="cc-empty">No rotation detected in the last 12 months</div>}
        </Card>
        <Card title="Site compliance comparison" sub="Share of vehicles on schedule">
          {sites ? (
            <div className="rs-chart" role="img" aria-label="Share of vehicles on schedule, by site">
              <Bar data={sites} options={{ ...CHART, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ...CHART.scales.x, min: 0, max: 100, ticks: { ...CHART.scales.x.ticks, callback: (v) => `${v}%` } }, y: CHART.scales.y } }} />
            </div>
          ) : <div className="cc-empty">No site data available</div>}
        </Card>
      </div>

      <Card title="Fleet status distribution" sub="Select a status to list those vehicles">
        <div className="rs-dist">
          {analytics.statusDistribution.map(({ status, count, pct }) => (
            <button key={status} type="button" onClick={() => onPickStatus(status)} aria-label={`${status}: ${count} vehicles. Show them.`}>
              <b style={{ color: TONE_COLOR[VEHICLE_STATUS_TONE[status]] }}>{count}</b>
              <span>{status}</span>
              <span className="cc-bar-track" aria-hidden="true"><i style={{ width: `${pct ?? 0}%`, background: TONE_COLOR[VEHICLE_STATUS_TONE[status]] }} /></span>
              <small>{pct != null ? `${pct}%` : 'N/A'}</small>
            </button>
          ))}
        </div>
      </Card>

      <div className="rs-two">
        <Card title="Tyre life, rotated against never rotated">
          {impact ? (
            <div className="rs-chart" role="img" aria-label={`Rotated tyres average ${fmt(analytics.avgLifeWith)} km, never rotated ${fmt(analytics.avgLifeWithout)} km`}>
              <Bar data={impact} options={{ ...CHART, plugins: { legend: { display: false } }, scales: { ...CHART.scales, y: { ...CHART.scales.y, ticks: { ...CHART.scales.y.ticks, callback: (v) => `${(v / 1000).toFixed(0)}k` } } } }} />
            </div>
          ) : <div className="cc-empty">Not enough removed tyres with a fitment and removal odometer to compare tyre life</div>}
        </Card>
        <Card title="Rotation impact analysis">
          {analytics.avgLifeWith && analytics.avgLifeWithout ? (
            <>
              <div className="rs-facts">
                <div><span>Rotated tyres ({fmt(analytics.withSamples)})</span><b>{fmtKm(analytics.avgLifeWith)}</b></div>
                <div><span>Never rotated ({fmt(analytics.withoutSamples)})</span><b>{fmtKm(analytics.avgLifeWithout)}</b></div>
              </div>
              <p className="rs-note">
                {analytics.avgLifeWith > analytics.avgLifeWithout
                  ? `Rotated tyres last ${fmt(analytics.avgLifeWith - analytics.avgLifeWithout)} km (${Math.round(((analytics.avgLifeWith - analytics.avgLifeWithout) / analytics.avgLifeWithout) * 100)}%) longer on this fleet.`
                  : 'On this fleet, rotated tyres do not yet last longer than never rotated ones, so no saving is claimed.'}
              </p>
            </>
          ) : <div className="cc-empty">Removal odometer data is needed for a life comparison</div>}
          <dl className="rs-dl">
            <div><dt>Average tyre price (priced rows)</dt><dd>{moneyTxt(analytics.avgCost)}</dd></div>
            <div><dt>Value lost per unrotated tyre</dt><dd>{moneyTxt(analytics.lifeValuePerTyre)}</dd></div>
            <div><dt>Tyres on vehicles not on schedule</dt><dd>{fmt(analytics.tyresAtRisk)}</dd></div>
            <div className="rs-dl-total"><dt>Total value at risk</dt><dd>{moneyTxt(analytics.lifeValueTotal)}</dd></div>
          </dl>
          <p className="rs-note">{moneyOk
            ? 'Per tyre: (1 minus never rotated life divided by rotated life) times the average price. Measured from this fleet, not an assumed factor.'
            : 'Money is shown for one country at a time, so currencies are never added together.'}</p>
        </Card>
      </div>

      <Card title="Position wear balance" sub={`Vehicles with more than ${WEAR_IMBALANCE_MM} mm steer to drive imbalance`}>
        {analytics.imbalanced.length === 0 ? (
          <div className="cc-empty">No vehicle has both steer and drive tread readings out of balance. Tread depth must be recorded for this check.</div>
        ) : (
          <EnterpriseTable
            columns={imbalanceColumns}
            data={analytics.imbalanced}
            getRowId={(v) => v.asset}
            enableColumnFilters={false}
            searchPlaceholder="Search asset or site"
            exportFileName={reportFileName('TyrePulse Rotation Wear Imbalance', reportDateLabel())}
            reportMeta={{ title: 'Position wear balance', company }}
            onRowClick={(v) => onOpenVehicle(v)}
            className="cc-et"
            emptyMessage="No imbalanced vehicles"
          />
        )}
      </Card>
    </div>
  )
}
