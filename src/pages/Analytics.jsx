import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { recordCost } from '../lib/analyticsEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { BarChart2, AlertTriangle, Activity, Layers } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import PeriodFilter from '../components/ui/PeriodFilter'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { colorAt, withAlpha } from '../lib/reportColors'
import { COST_MODES, costModeLabel, pickMonthly, splitTotals } from '../lib/costSources'
import { loadGovernedCostSplit, COST_SPLIT_TTL_MS } from '../lib/api/governedCost'
import CostValue from '../components/cost/CostValue'
import { governedWindow, governedWindowLabel } from '../lib/governedWindow'
import Card, { CardHeader, CardBody } from '../components/ui/Card'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

/**
 * Monthly record-count + cost buckets. The Monthly Trend chart that drew these
 * was removed from this view when it became the Overview tab of Advanced
 * Analytics (the Trend Analysis tab draws records per month, and cost per month
 * comes from the expense grid chart below). Kept as a tested pure helper.
 *
 * Cost must be the ROW total, never the unit price: cost_per_tyre is the
 * "Unit Cost / Tyre" and one tyre_records row can cover several tyres (qty).
 * This bucket used to add cost_per_tyre alone, so every month containing a
 * row with qty > 1 was understated and the chart disagreed with the Total
 * Cost KPI and the site/brand tables rendered on this same page. recordCost
 * is the shared cost_per_tyre x (qty || 1) helper those tables already use.
 */
export function buildMonthlyTrend(records = []) {
  const rows = Array.isArray(records) ? records : []
  const map = {}
  rows.forEach((r) => {
    if (!r?.issue_date) return
    const m = String(r.issue_date).slice(0, 7)
    if (!map[m]) map[m] = { month: m, count: 0, cost: 0 }
    map[m].count++
    map[m].cost += recordCost(r)
  })
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * Map a PeriodFilter value to inclusive server-side issue_date bounds.
 * 'all' -> no bounds; 'year' -> that calendar year; 'custom' -> its from/to.
 * Mirrors filterByPeriodValue so the server window and the client view agree.
 */
export function periodBounds(period) {
  const v = period || { mode: 'all' }
  if (v.mode === 'year') return { from: `${v.year}-01-01`, to: `${v.year}-12-31` }
  if (v.mode === 'custom') return { from: v.from || null, to: v.to || null }
  return { from: null, to: null }
}

export default function Analytics({ embedded = false }) {
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()
  // Opens on the CURRENT YEAR rather than all of history.
  const [period, setPeriod] = useState(() => ({ mode: 'year', year: new Date().getFullYear() }))

  // Period -> date bounds. They drive the tyre counts AND the expense grid
  // window, so every figure on this view covers the same dates.
  const { from: fromDate, to: toDate } = useMemo(() => periodBounds(period), [period])
  const win = useMemo(() => governedWindow({ from: fromDate, to: toDate }), [fromDate, toDate])
  const winLabel = governedWindowLabel(win)

  // Tyre COUNTS (total tyres, high risk) and the average recorded price come
  // from the server-side aggregate (report_tyre_summary). Its cost total is NOT
  // shown: the tyre cost total on this page is the expense grid figure below.
  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setSummaryLoading(true); setSummaryError(null)
    ;(async () => {
      try {
        const { data, error: e } = await supabase.rpc('report_tyre_summary', {
          p_country: activeCountry, p_from: fromDate, p_to: toDate,
        })
        if (cancelled) return
        if (e) throw new Error(e.message || e)
        setSummary(data || null)
      } catch (err) {
        if (cancelled) return
        setSummaryError(toUserMessage(err, 'Failed to load summary.'))
        setSummary(null)
      } finally {
        if (!cancelled) setSummaryLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [activeCountry, fromDate, toDate])

  // The ONE tyre and maintenance cost source for this page: the expense grid,
  // for the same country and period as the counts above.
  const [costMode, setCostMode] = useState('combined')
  const [costSplit, setCostSplit] = useState(null)
  const [costLoading, setCostLoading] = useState(true)
  const [costError, setCostError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setCostLoading(true); setCostError(null)
    loadGovernedCostSplit({
      country: activeCountry === 'All' ? undefined : activeCountry,
      from: win.from, to: win.to, maxAgeMs: COST_SPLIT_TTL_MS,
    })
      .then((res) => { if (!cancelled) setCostSplit(res) })
      .catch((err) => {
        if (cancelled) return
        setCostError(toUserMessage(err, 'Failed to load cost split.'))
        setCostSplit(null)
      })
      .finally(() => { if (!cancelled) setCostLoading(false) })
    return () => { cancelled = true }
  }, [activeCountry, win.from, win.to])

  const costByMonth = useMemo(() => costSplit?.byMonth || [], [costSplit])
  const costTotals = useMemo(() => splitTotals(costByMonth), [costByMonth])
  const costModeColor = useMemo(() => {
    const idx = Math.max(0, COST_MODES.findIndex((m) => m.key === costMode))
    return colorAt(idx)
  }, [costMode])

  const costChartData = useMemo(() => {
    const series = pickMonthly(costMode, costByMonth)
    return {
      labels: series.map((d) => d.month),
      datasets: [{
        label: costModeLabel(costMode),
        data: series.map((d) => d.value),
        backgroundColor: withAlpha(costModeColor, 0.6),
        borderColor: costModeColor,
        borderRadius: 4,
      }],
    }
  }, [costMode, costByMonth, costModeColor])

  const costChartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#6b7280' }, grid: { color: 'var(--panel-2)' } },
      y: { ticks: { color: '#6b7280' }, grid: { color: '#374151' } },
    },
  }

  // The reader falls back to tyre records only when the grid holds nothing for
  // the window; the card says which one it is showing.
  const fromGrid = !costSplit || String(costSplit.source || '').startsWith('governed')
  const kpiTotal = Number(summary?.total_records) || 0
  // Average RECORDED purchase price per tyre record. A unit price, not a total.
  const kpiAvg = kpiTotal > 0 ? (Number(summary?.total_cost) || 0) / kpiTotal : null
  const kpiHighRisk = Number(summary?.high_risk) || 0
  const pulse = (w) => <span className={`inline-block h-7 ${w} rounded bg-white/10 animate-pulse align-middle`} />

  return (
    <div className="space-y-6">
      {/* Embedded as the Overview tab of Advanced Analytics: that page owns the title. */}
      {!embedded && (
        <PageHeader
          title={t('analytics.title')}
          subtitle={t('analytics.subtitle')}
          icon={BarChart2}
        />
      )}

      <PeriodFilter value={period} onChange={setPeriod} />

      {summaryError && !summaryLoading && (
        <div role="alert" className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
          <AlertTriangle size={14} /> {summaryError}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[var(--gap-grid)]">
        <Card className="text-center">
          <p className="text-2xl font-bold text-white">
            {summaryLoading ? pulse('w-16') : summaryError ? 'N/A' : kpiTotal.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">{t('analytics.kpi.totalTyres')}</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-blue-400">
            {costLoading ? pulse('w-20') : costError ? 'N/A' : <CostValue split={costSplit} mode="tyres" />}
          </p>
          <p className="text-xs text-gray-500 mt-1">{fromGrid ? 'Tyre cost, expense grid' : 'Tyre cost, tyre records (no expense grid data for this window)'}</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-emerald-400">
            {summaryLoading ? pulse('w-20')
              : summaryError || kpiAvg === null || activeCountry === 'All' ? 'N/A'
              : formatCurrencyCompact(kpiAvg, activeCurrency)}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {activeCountry === 'All' ? 'Avg recorded price: pick a country' : 'Avg recorded price per tyre record'}
          </p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-red-400">
            {summaryLoading ? pulse('w-12') : summaryError ? 'N/A' : kpiHighRisk.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 mt-1">{t('analytics.kpi.highRisk')}</p>
        </Card>
      </div>
      <p className="text-xs text-gray-500">
        Figures cover {winLabel}. Tyre cost is the expense grid total for that window; site, brand, vehicle and monthly breakdowns are on the analysis tabs.
      </p>

      {/* Tyres vs Maintenance cost split, same window as the cards above */}
      <Card>
        <CardHeader
          level={2}
          icon={Layers}
          title="Tyres vs Maintenance"
          actions={
            <div className="inline-flex rounded-lg border border-[var(--border-dim)] overflow-hidden">
              {COST_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setCostMode(m.key)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    costMode === m.key
                      ? 'bg-blue-600 text-white'
                      : 'bg-transparent text-gray-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          }
        />

        <CardBody>
        {costLoading ? (
          <div className="animate-pulse h-64 rounded-lg bg-white/5" />
        ) : costError ? (
          <div role="alert" className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
            <AlertTriangle size={14} /> {costError}
          </div>
        ) : costTotals.combined === 0 ? (
          <div className="text-center py-12">
            <Activity size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 font-medium">No cost data</p>
            <p className="text-gray-600 text-sm mt-1">No tyre or maintenance spend for {winLabel}.</p>
          </div>
        ) : (
          <>
            <div className="mb-4">
              {/* GOVERNED: per-currency figures, never a blended total. */}
              <p className="text-2xl font-bold" style={{ color: costModeColor }}>
                <CostValue split={costSplit} mode={costMode} />
              </p>
              <p className="text-xs text-gray-500 mt-1">{costModeLabel(costMode)} spend, {winLabel}</p>
            </div>
            <div style={{ height: 280 }}>
              <Bar data={costChartData} options={costChartOpts} />
            </div>
          </>
        )}
        </CardBody>
      </Card>
    </div>
  )
}
