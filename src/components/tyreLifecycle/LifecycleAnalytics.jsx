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
import { statusLabels } from '../../lib/tyreLifecycleLabels'
import { useLanguage } from '../../contexts/LanguageContext'

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
const fmtPct = (v, na) => (v == null || !Number.isFinite(v) ? na : `${v.toFixed(1)}%`)

export default function LifecycleAnalytics({ records, currency, onStage }) {
  const { t } = useLanguage()
  const naText = t('tyrelifecycle.na')
  const pct = (v) => fmtPct(v, naText)
  const STAGE_LABEL = statusLabels(t)
  const BUCKET_LABEL = { new: t('tyrelifecycle.analytics.bucketNew'), retread: t('tyrelifecycle.analytics.bucketRetread'), repair: t('tyrelifecycle.analytics.bucketRepair'), scrap: t('tyrelifecycle.analytics.bucketScrap') }
  const bucketLabel = (b) => BUCKET_LABEL[b.key] || b.label
  const kpis = lifecycleKpis(records)
  const funnel = stageFunnel(records)
  const brands = brandLife(records)
  const cost = costByCategory(records)
  const bands = kmBandCounts(records)

  const brandChart = {
    labels: brands.map((b) => b.brand),
    datasets: [
      { label: t('tyrelifecycle.analytics.brandNew'), data: brands.map((b) => (b.newAvg == null ? null : Math.round(b.newAvg))), backgroundColor: withAlpha(colorAt(0), 0.75), borderRadius: 4 },
      { label: t('tyrelifecycle.analytics.brandRetread'), data: brands.map((b) => (b.retreadAvg == null ? null : Math.round(b.retreadAvg))), backgroundColor: withAlpha(colorAt(1), 0.75), borderRadius: 4 },
    ],
  }
  const donutColors = categorical(cost.buckets.length)
  const costDonut = {
    labels: cost.buckets.map(bucketLabel),
    datasets: [{ data: cost.buckets.map((b) => Math.round(b.total)), backgroundColor: donutColors.map((c) => withAlpha(c, 0.85)), borderWidth: 0 }],
  }
  const bandChart = {
    labels: bands.map((b) => b.label),
    datasets: [{ label: t('tyrelifecycle.analytics.tyres'), data: bands.map((b) => b.count), backgroundColor: bands.map((_, i) => withAlpha(colorAt(i), 0.75)), borderRadius: 4 }],
  }

  return (
    <div className="tlc-analytics">
      <div className="cc-kpis tlc-mini">
        <div className="cc-card tlc-stat"><b>{kpis.avgLifeKm == null ? naText : t('tyrelifecycle.hero.statKm', { value: fmtInt(Math.round(kpis.avgLifeKm)) })}</b><span>{t('tyrelifecycle.analytics.avgLife', { count: fmtInt(kpis.measuredLife) })}</span></div>
        <div className="cc-card tlc-stat"><b>{pct(kpis.retreadRate)}</b><span>{kpis.categorised ? t('tyrelifecycle.analytics.retreadRate', { count: fmtInt(kpis.categorised) }) : t('tyrelifecycle.analytics.retreadRateNone')}</span></div>
        <div className="cc-card tlc-stat"><b>{pct(kpis.scrapRate)}</b><span>{kpis.removed ? t('tyrelifecycle.analytics.scrapRate', { scrapped: fmtInt(kpis.scrapped), removed: fmtInt(kpis.removed) }) : t('tyrelifecycle.analytics.scrapRateNone')}</span></div>
        <div className="cc-card tlc-stat"><b>{kpis.avgCpk == null ? naText : kpis.avgCpk.toFixed(4)}</b><span>{t('tyrelifecycle.analytics.avgCpk', { detail: kpis.measuredCpk ? t('tyrelifecycle.analytics.cpkMeasured', { count: fmtInt(kpis.measuredCpk) }) : t('tyrelifecycle.analytics.cpkNeeds') })}</span></div>
        <div className="cc-card tlc-stat"><b>{fmtInt(kpis.serials)}</b><span>{kpis.missingSerial ? t('tyrelifecycle.analytics.serialsMissing', { count: fmtInt(kpis.missingSerial) }) : t('tyrelifecycle.analytics.serials')}</span></div>
      </div>

      <Card title={t('tyrelifecycle.analytics.stagesTitle')} sub={t('tyrelifecycle.analytics.stagesSub')}>
        <div className="tlc-funnel">
          {funnel.map((s) => (
            <button key={s.stage} type="button" className="tlc-stage" onClick={() => onStage?.(s.stage)}>
              <span className={`cc-pill ${STAGE_TONE[s.stage]}`}>{STAGE_LABEL[s.stage] || s.stage}</span>
              <b>{fmtInt(s.count)}</b>
              <small>{t('tyrelifecycle.analytics.ofRecords', { pct: pct(s.pct) })}</small>
              <small>{!currency ? t('tyrelifecycle.analytics.avgPricePick') : s.avgCost == null ? t('tyrelifecycle.analytics.avgPriceNa') : t('tyrelifecycle.analytics.avgPrice', { currency, value: fmtInt(Math.round(s.avgCost)) })}</small>
            </button>
          ))}
        </div>
      </Card>

      <div className="tlc-an-grid">
        <Card title={t('tyrelifecycle.analytics.brandTitle')} sub={t('tyrelifecycle.analytics.brandSub')}>
          <div className="tlc-chart">
            {brands.length ? (
              <div className="tlc-fill" role="img" aria-label={t('tyrelifecycle.analytics.brandAria', { count: brands.length })}><Bar data={brandChart} options={BASE} /></div>
            ) : <div className="cc-empty">{t('tyrelifecycle.analytics.brandEmpty')}</div>}
          </div>
        </Card>
        <Card title={t('tyrelifecycle.analytics.spendTitle')} sub={t('tyrelifecycle.analytics.spendSub', { count: fmtInt(cost.priced) })}>
          <div className="tlc-chart">
            {!currency ? <div className="cc-empty">{t('tyrelifecycle.analytics.spendPick')}</div> : cost.total ? (
              <div className="tlc-fill" role="img" aria-label={t('tyrelifecycle.analytics.spendAria', { detail: cost.buckets.map((b) => `${bucketLabel(b)} ${Math.round(b.total)}`).join(', ') })}><Doughnut data={costDonut} options={DONUT} /></div>
            ) : <div className="cc-empty">{t('tyrelifecycle.analytics.spendEmpty')}</div>}
          </div>
        </Card>
      </div>

      <Card title={t('tyrelifecycle.analytics.distTitle')} sub={t('tyrelifecycle.analytics.distSub')}>
        {kpis.measuredLife === 0 ? <div className="cc-empty">{t('tyrelifecycle.analytics.distEmpty')}</div> : (
          <div className="tlc-chart tlc-chart-sm" role="img" aria-label={t('tyrelifecycle.analytics.distAria', { detail: bands.map((b) => `${b.label} ${b.count}`).join(', ') })}>
            <Bar data={bandChart} options={{ ...BASE, plugins: { legend: { display: false } } }} />
          </div>
        )}
      </Card>
    </div>
  )
}
