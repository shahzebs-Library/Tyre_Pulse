/**
 * Analytics tab of the Tyre Lifecycle Tracker. The lifecycle stage funnel,
 * brand life (new vs retread), priced spend by category and the km-run bands,
 * carried over from the earlier page unchanged in behaviour, on kit cards.
 */
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { Card, fmtInt } from '../commandCenter/kit'
import { colorAt, withAlpha, categorical } from '../../lib/reportColors'
import { lifecycleKpis, stageFunnel, brandLife, costByCategory, kmBandCounts } from '../../lib/tyreLifecycleAnalytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const GRID = { color: 'var(--cc-track)' }
const TICK = { color: 'var(--cc-ink-3)' }
const LEGEND = { labels: { color: 'var(--cc-ink-2)', boxWidth: 12 } }
const BASE = {
  responsive: true, maintainAspectRatio: false, plugins: { legend: LEGEND },
  scales: { x: { ticks: TICK, grid: GRID }, y: { ticks: TICK, grid: GRID, beginAtZero: true } },
}
const DONUT = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom', labels: { color: 'var(--cc-ink-2)', boxWidth: 12, padding: 12 } },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const sum = ctx.dataset.data.reduce((a, b) => a + b, 0)
          return ` ${ctx.label}: ${ctx.parsed.toLocaleString()} (${sum ? ((ctx.parsed / sum) * 100).toFixed(1) : 0}%)`
        },
      },
    },
  },
}
const STAGE_TONE = { 'In Service': 'good', 'Retread Eligible': 'info', Retreaded: 'info', Scrapped: 'bad', Removed: 'muted' }
const pct = (v) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(1)}%`)

export default function LifecycleAnalytics({ records, currency, onStage }) {
  const kpis = lifecycleKpis(records)
  const funnel = stageFunnel(records)
  const brands = brandLife(records)
  const cost = costByCategory(records)
  const bands = kmBandCounts(records)

  const brandChart = {
    labels: brands.map((b) => b.brand),
    datasets: [
      { label: 'New (avg km)', data: brands.map((b) => (b.newAvg == null ? null : Math.round(b.newAvg))), backgroundColor: withAlpha(colorAt(0), 0.75), borderRadius: 4 },
      { label: 'Retread (avg km)', data: brands.map((b) => (b.retreadAvg == null ? null : Math.round(b.retreadAvg))), backgroundColor: withAlpha(colorAt(1), 0.75), borderRadius: 4 },
    ],
  }
  const donutColors = categorical(cost.buckets.length)
  const costDonut = {
    labels: cost.buckets.map((b) => b.label),
    datasets: [{ data: cost.buckets.map((b) => Math.round(b.total)), backgroundColor: donutColors.map((c) => withAlpha(c, 0.85)), borderWidth: 0 }],
  }
  const bandChart = {
    labels: bands.map((b) => b.label),
    datasets: [{ label: 'Tyres', data: bands.map((b) => b.count), backgroundColor: bands.map((_, i) => withAlpha(colorAt(i), 0.75)), borderRadius: 4 }],
  }

  return (
    <div className="tlc-analytics">
      <div className="cc-kpis tlc-mini">
        <div className="cc-card tlc-stat"><b>{kpis.avgLifeKm == null ? 'N/A' : `${fmtInt(Math.round(kpis.avgLifeKm))} km`}</b><span>Average life ({fmtInt(kpis.measuredLife)} measured)</span></div>
        <div className="cc-card tlc-stat"><b>{pct(kpis.retreadRate)}</b><span>{kpis.categorised ? `Retread rate of ${fmtInt(kpis.categorised)} categorised` : 'Retread rate: no category recorded'}</span></div>
        <div className="cc-card tlc-stat"><b>{pct(kpis.scrapRate)}</b><span>{kpis.removed ? `Scrap rate: ${fmtInt(kpis.scrapped)} of ${fmtInt(kpis.removed)} removed` : 'Scrap rate: no removals recorded'}</span></div>
        <div className="cc-card tlc-stat"><b>{kpis.avgCpk == null ? 'N/A' : kpis.avgCpk.toFixed(4)}</b><span>Avg cost per km ({kpis.measuredCpk ? `${fmtInt(kpis.measuredCpk)} priced and measured` : 'needs price and removal km'})</span></div>
        <div className="cc-card tlc-stat"><b>{fmtInt(kpis.serials)}</b><span>Distinct serials{kpis.missingSerial ? `, ${fmtInt(kpis.missingSerial)} records without serial` : ''}</span></div>
      </div>

      <Card title="Lifecycle stages" sub="Select a stage to filter the register. Stages are mutually exclusive and add up to the records in scope.">
        <div className="tlc-funnel">
          {funnel.map((s) => (
            <button key={s.stage} type="button" className="tlc-stage" onClick={() => onStage?.(s.stage)}>
              <span className={`cc-pill ${STAGE_TONE[s.stage]}`}>{s.stage}</span>
              <b>{fmtInt(s.count)}</b>
              <small>{pct(s.pct)} of records</small>
              <small>{!currency ? 'Avg price: pick one country' : s.avgCost == null ? 'Avg price N/A' : `Avg ${currency} ${fmtInt(Math.round(s.avgCost))}`}</small>
            </button>
          ))}
        </div>
      </Card>

      <div className="tlc-an-grid">
        <Card title="Brand lifecycle" sub="Average km run, new against retread">
          <div className="tlc-chart">
            {brands.length ? (
              <div className="tlc-fill" role="img" aria-label={`Average km run for ${brands.length} brands, new and retread`}><Bar data={brandChart} options={BASE} /></div>
            ) : <div className="cc-empty">No tyre in scope has both a fitment and a removal km, so life cannot be measured.</div>}
          </div>
        </Card>
        <Card title="Spend by category" sub={`Priced tyre records only (${fmtInt(cost.priced)} priced). The authoritative total is the expense grid.`}>
          <div className="tlc-chart">
            {!currency ? <div className="cc-empty">Spend is kept per currency. Pick one country to see it.</div> : cost.total ? (
              <div className="tlc-fill" role="img" aria-label={`Spend by category, ${cost.buckets.map((b) => `${b.label} ${Math.round(b.total)}`).join(', ')}`}><Doughnut data={costDonut} options={DONUT} /></div>
            ) : <div className="cc-empty">No priced tyres in scope</div>}
          </div>
        </Card>
      </div>

      <Card title="Life distribution" sub="Measured tyres per km-run band">
        {kpis.measuredLife === 0 ? <div className="cc-empty">No measured tyre life in scope.</div> : (
          <div className="tlc-chart tlc-chart-sm" role="img" aria-label={`Tyres per km band: ${bands.map((b) => `${b.label} ${b.count}`).join(', ')}`}>
            <Bar data={bandChart} options={{ ...BASE, plugins: { legend: { display: false } } }} />
          </div>
        )}
      </Card>
    </div>
  )
}
