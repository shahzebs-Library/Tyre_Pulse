import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { computeSiteMetrics, buildSiteRadar, bucketByMonth } from '../lib/analyticsEngine'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { Download, FileText, Maximize2, GitMerge, AlertTriangle, RefreshCw } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import EmailPdfButton from '../components/EmailPdfButton'
import PeriodFilter, { filterByPeriodValue } from '../components/ui/PeriodFilter'
import SegmentedControl from '../components/ui/SegmentedControl'
import {
  Chart as ChartJS, RadialLinearScale, PointElement, LineElement,
  Filler, Tooltip, Legend, CategoryScale, LinearScale, BarElement,
} from 'chart.js'
import { Radar, Bar, Line } from 'react-chartjs-2'
import { ChartModal } from '../components/ChartModal'

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement)

const SITE_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#06b6d4', '#84cc16', '#f97316', '#a855f7',
]

const GRANULARITIES = ['Monthly', 'Quarterly', 'Yearly']

// ── helpers for granularity bucketing ────────────────────────────────────────
function getPeriodKey(dateStr, granularity) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  const y = d.getFullYear()
  if (granularity === 'Yearly') return String(y)
  if (granularity === 'Quarterly') {
    const q = Math.ceil((d.getMonth() + 1) / 3)
    return `${y} Q${q}`
  }
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function buildPeriodBuckets(records, granularity, defaultCost) {
  const map = {}
  records.forEach(r => {
    const key = getPeriodKey(r.issue_date, granularity)
    if (!key) return
    if (!map[key]) map[key] = { period: key, total: 0, count: 0 }
    map[key].total += (Number(r.cost_per_tyre) || 0) * (r.qty || 1)
    map[key].count += 1
  })
  return Object.values(map).sort((a, b) => a.period.localeCompare(b.period))
}

function slicePeriods(buckets, granularity) {
  if (granularity === 'Yearly') return buckets.slice(-5)
  if (granularity === 'Quarterly') return buckets.slice(-8)
  return buckets.slice(-12)
}

// ── skeleton components ───────────────────────────────────────────────────────
function SkeletonBar({ className = '' }) {
  return <div className={`animate-pulse bg-gray-800/60 rounded ${className}`} />
}

function FilterCardSkeleton() {
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap gap-3">
        <SkeletonBar className="h-8 w-36" />
        <SkeletonBar className="h-8 w-36" />
        <SkeletonBar className="h-8 w-48" />
      </div>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4].map(i => <SkeletonBar key={i} className="h-7 w-20 rounded-full" />)}
      </div>
    </div>
  )
}

function KpiCardSkeleton() {
  return (
    <div className="card border-t-2 border-gray-700">
      <SkeletonBar className="h-4 w-24 mb-3" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex justify-between">
            <SkeletonBar className="h-3 w-16" />
            <SkeletonBar className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ChartCardSkeleton() {
  return (
    <div className="card">
      <SkeletonBar className="h-4 w-48 mb-4" />
      <SkeletonBar className="h-64 w-full" />
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────
export default function SiteComparison() {
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [selectedSites, setSelectedSites] = useState([])

  const [period, setPeriod]           = useState({ mode: 'all' })
  const [granularity, setGranularity] = useState('Monthly')

  const [modalOpen, setModalOpen] = useState(false)
  const trendChartRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data, error: e } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,issue_date,brand,site,category,risk_level,cost_per_tyre,qty')
          .order('issue_date')
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      })
      if (e) throw new Error(e.message || e)
      const recs = data || []
      setRecords(recs)
      const byCount = {}
      recs.forEach(r => { if (r.site) byCount[r.site] = (byCount[r.site] || 0) + 1 })
      const top4 = Object.entries(byCount).sort(([, a], [, b]) => b - a).slice(0, 4).map(([s]) => s)
      setSelectedSites(top4)
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load site data.'))
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const filteredRecords = useMemo(
    () => filterByPeriodValue(records, period, 'issue_date'),
    [records, period]
  )

  const allMetrics = useMemo(() => computeSiteMetrics(filteredRecords), [filteredRecords])
  const allSites   = useMemo(() => allMetrics.map(s => s.site), [allMetrics])

  const filteredMetrics = useMemo(
    () => allMetrics.filter(s => selectedSites.includes(s.site)),
    [allMetrics, selectedSites]
  )

  const radarData = useMemo(() => buildSiteRadar(filteredMetrics), [filteredMetrics])

  function toggleSite(site) {
    setSelectedSites(prev =>
      prev.includes(site) ? prev.filter(s => s !== site) : [...prev, site]
    )
  }

  const SITE_COLS = [
    { key: 'site', header: 'Site' },
    { key: 'count', header: 'Records' },
    { key: 'totalCost', header: 'Total Cost' },
    { key: 'avgCost', header: 'Avg Cost' },
    { key: 'highRiskCount', header: 'High Risk' },
    { key: 'highRiskPct', header: 'High Risk %' },
    { key: 'topBrand', header: 'Top Brand' },
    { key: 'topCategory', header: 'Top Category' },
  ]

  const costChart = !loading && filteredMetrics.length > 0 ? {
    labels: filteredMetrics.map(s => s.site),
    datasets: [{
      label: t('sitecomparison.chart.totalCostSar'),
      data: filteredMetrics.map(s => Math.round(s.totalCost)),
      backgroundColor: filteredMetrics.map((_, i) => SITE_COLORS[i % SITE_COLORS.length] + 'bb'),
      borderColor:     filteredMetrics.map((_, i) => SITE_COLORS[i % SITE_COLORS.length]),
      borderWidth: 1, borderRadius: 4,
    }],
  } : null

  const riskChart = !loading && filteredMetrics.length > 0 ? {
    labels: filteredMetrics.map(s => s.site),
    datasets: [{
      label: t('sitecomparison.chart.highRiskPct'),
      data: filteredMetrics.map(s => parseFloat(s.highRiskPct.toFixed(1))),
      backgroundColor: 'rgba(239,68,68,0.6)',
      borderRadius: 4,
    }],
  } : null

  const BAR_OPTS = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af' } } },
    scales: {
      x: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af' } },
      y: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af' } },
    },
  }

  const RADAR_OPTS = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af', font: { size: 11 } } } },
    scales: {
      r: {
        min: 0, max: 100,
        grid: { color: '#374151' },
        pointLabels: { color: '#9ca3af', font: { size: 11 } },
        ticks: { color: '#6b7280', backdropColor: 'transparent', stepSize: 25 },
      },
    },
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('sitecomparison.title')}
        subtitle={t('sitecomparison.subtitle')}
        icon={GitMerge}
        actions={!loading && allMetrics.length > 0 ? (
          <div className="flex gap-2">
            <button
              onClick={() => exportToExcel(allMetrics, SITE_COLS.map(c => c.key), SITE_COLS.map(c => c.header), 'TyrePulse_SiteComparison')}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <Download size={14} /> {t('sitecomparison.actions.excel')}
            </button>
            <button
              onClick={() => exportToPdf(allMetrics, SITE_COLS, 'Site Comparison', 'TyrePulse_SiteComparison', 'landscape')}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <FileText size={14} /> {t('sitecomparison.actions.pdf')}
            </button>
            <EmailPdfButton
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
              getPdf={async () => ({
                base64: await exportToPdf(allMetrics, SITE_COLS, 'Site Comparison', 'TyrePulse_SiteComparison', 'landscape', '', { returnBase64: true }),
                filename: 'TyrePulse_SiteComparison.pdf',
                subject: 'Site Comparison',
                bodyHtml: '<p>Attached is the Site Comparison report.</p>',
              })}
            />
          </div>
        ) : null}
      />

      {loading ? (
        <>
          <FilterCardSkeleton />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <KpiCardSkeleton key={i} />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ChartCardSkeleton />
            <ChartCardSkeleton />
          </div>
        </>
      ) : error ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle size={40} className="text-red-400 mb-4" />
          <p className="text-red-300 font-medium text-lg">{t('sitecomparison.states.loadError')}</p>
          <p className="text-gray-500 text-sm mt-1">{error}</p>
          <button onClick={load} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
            <RefreshCw size={16} /> {t('sitecomparison.states.retry')}
          </button>
        </div>
      ) : allSites.length === 0 ? (
        <>
          <div className="card space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="label text-xs">{t('sitecomparison.filters.period')}</label>
                <PeriodFilter records={records} value={period} onChange={setPeriod} />
              </div>
            </div>
          </div>
          <div className="card flex flex-col items-center justify-center py-16 text-center">
            <GitMerge size={40} className="text-gray-700 mb-4" />
            <p className="text-gray-400 font-medium text-lg">{t('sitecomparison.states.noSiteData')}</p>
            <p className="text-gray-600 text-sm mt-1">{t('sitecomparison.states.noSiteDataHint')}</p>
          </div>
        </>
      ) : (
        <>
          {/* Filter bar + site selector */}
          <div className="card space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="label text-xs">{t('sitecomparison.filters.period')}</label>
                <PeriodFilter records={records} value={period} onChange={setPeriod} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="label text-xs">{t('sitecomparison.filters.granularity')}</label>
                <SegmentedControl
                  ariaLabel="granularity"
                  size="sm"
                  value={granularity}
                  onChange={setGranularity}
                  options={GRANULARITIES.map(g => ({ value: g, label: t(`sitecomparison.granularity.${g}`) }))}
                />
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-400 mb-3">{t('sitecomparison.filters.selectSites')}</p>
              <div className="flex flex-wrap gap-2">
                {allSites.map((site, i) => {
                  const active = selectedSites.includes(site)
                  return (
                    <button
                      key={site}
                      onClick={() => toggleSite(site)}
                      disabled={!active && selectedSites.length >= 6}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                        active
                          ? 'border-transparent text-white'
                          : 'border-gray-700 text-gray-400 hover:border-gray-500 disabled:opacity-30'
                      }`}
                      style={active ? { backgroundColor: SITE_COLORS[selectedSites.indexOf(site) % SITE_COLORS.length] } : {}}
                    >
                      {site}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {filteredMetrics.length === 0 ? (
            <div className="card flex flex-col items-center justify-center py-16 text-center">
              <GitMerge size={40} className="text-gray-700 mb-4" />
              <p className="text-gray-400 font-medium">{t('sitecomparison.states.selectSite')}</p>
              <p className="text-gray-600 text-sm mt-1">{t('sitecomparison.states.selectSiteHint')}</p>
            </div>
          ) : (
            <>
              {/* KPI comparison cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {filteredMetrics.map((s, i) => (
                  <div key={s.site} className="card border-t-2" style={{ borderColor: SITE_COLORS[i % SITE_COLORS.length] }}>
                    <p className="text-white font-semibold text-sm">{s.site}</p>
                    <div className="mt-3 space-y-2">
                      <KpiRow label={t('sitecomparison.kpi.records')} value={s.count} />
                      <KpiRow label={t('sitecomparison.kpi.totalCost')} value={formatCurrencyCompact(s.totalCost, activeCurrency)} />
                      <KpiRow label={t('sitecomparison.kpi.highRisk')} value={`${s.highRiskCount} (${s.highRiskPct.toFixed(0)}%)`}
                        highlight={s.highRiskPct > 30 ? 'text-red-400' : s.highRiskPct > 15 ? 'text-yellow-400' : 'text-green-400'} />
                      <KpiRow label={t('sitecomparison.kpi.topBrand')} value={s.topBrand} />
                      <KpiRow label={t('sitecomparison.kpi.topCategory')} value={s.topCategory} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="text-sm font-medium text-gray-400 mb-4">{t('sitecomparison.chart.totalCostComparison')}</h3>
                  <div style={{ height: 260 }}>
                    <Bar data={costChart} options={BAR_OPTS} />
                  </div>
                </div>
                <div className="card">
                  <h3 className="text-sm font-medium text-gray-400 mb-4">{t('sitecomparison.chart.highRiskComparison')}</h3>
                  <div style={{ height: 260 }}>
                    <Bar data={riskChart} options={BAR_OPTS} />
                  </div>
                </div>
              </div>

              {/* Radar */}
              {filteredMetrics.length >= 2 && (
                <div className="card">
                  <h3 className="text-sm font-medium text-gray-400 mb-4">
                    {t('sitecomparison.chart.radarTitle')}
                  </h3>
                  <div className="max-w-xl mx-auto" style={{ height: 380 }}>
                    <Radar data={radarData} options={RADAR_OPTS} />
                  </div>
                  <p className="text-xs text-gray-600 text-center mt-2">
                    {t('sitecomparison.chart.radarLegend')}
                  </p>
                </div>
              )}

              {/* Trend comparison with granularity */}
              <TrendComparison
                records={filteredRecords}
                selectedSites={selectedSites}
                granularity={granularity}
                chartRef={trendChartRef}
                onMaximize={() => setModalOpen(true)}
              />
            </>
          )}
        </>
      )}

      {/* ChartModal for trend */}
      <TrendModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        records={filteredRecords}
        selectedSites={selectedSites}
        granularity={granularity}
        onGranularityChange={setGranularity}
        chartRef={trendChartRef}
      />
    </div>
  )
}

function KpiRow({ label, value, highlight }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={highlight || 'text-gray-300'}>{value}</span>
    </div>
  )
}

// ── Trend chart with granularity ──────────────────────────────────────────────
function TrendComparison({ records, selectedSites, defaultCost = 1200, granularity, chartRef, onMaximize }) {
  const { t } = useLanguage()
  const { chartData, allPeriods } = useTrendData(records, selectedSites, defaultCost, granularity)

  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af' } } },
    scales: {
      x: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af' } },
      y: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af' } },
    },
  }

  if (allPeriods.length < 2) return null

  return (
    <div className="card relative">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-400">
          {t('sitecomparison.trend.title', { granularity: t(`sitecomparison.granularity.${granularity}`), period: t(`sitecomparison.periodLabel.${granularity}`) })}
        </h3>
        <button
          onClick={onMaximize}
          className="text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
          title={t('sitecomparison.trend.fullscreen')}
        >
          <Maximize2 size={15} />
        </button>
      </div>
      <div style={{ height: 300 }}>
        <Line ref={chartRef} data={chartData} options={opts} />
      </div>
    </div>
  )
}

// ── Modal wrapper for trend chart ─────────────────────────────────────────────
function TrendModal({ open, onClose, records, selectedSites, defaultCost, granularity, onGranularityChange, chartRef }) {
  const { t } = useLanguage()
  const { chartData } = useTrendData(records, selectedSites, defaultCost, granularity)

  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af' } } },
    scales: {
      x: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af' } },
      y: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af' } },
    },
  }

  return (
    <ChartModal
      open={open}
      onClose={onClose}
      title={t('sitecomparison.trend.modalTitle')}
      chartRef={chartRef}
      filters={{ granularity }}
      onFilterChange={(key, val) => { if (key === 'granularity') onGranularityChange(val) }}
      filterOptions={{}}
      showGranularity={false}
      showSite={false}
      showBrand={false}
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">{t('sitecomparison.trend.granularityLabel')}</span>
        <SegmentedControl
          ariaLabel="granularity"
          size="sm"
          value={granularity}
          onChange={onGranularityChange}
          options={GRANULARITIES.map(g => ({ value: g, label: t(`sitecomparison.granularity.${g}`) }))}
        />
      </div>
      <div style={{ height: 420 }}>
        <Line ref={chartRef} data={chartData} options={opts} />
      </div>
    </ChartModal>
  )
}

// ── shared hook for building trend chart data ─────────────────────────────────
function useTrendData(records, selectedSites, defaultCost, granularity) {
  return useMemo(() => {
    const datasets = selectedSites.map((site, i) => {
      const siteRecs = records.filter(r => r.site === site)
      const allBuckets = buildPeriodBuckets(siteRecs, granularity, defaultCost)
      const buckets = slicePeriods(allBuckets, granularity)
      return { site, buckets, color: SITE_COLORS[i % SITE_COLORS.length] }
    })

    const periodSet = new Set()
    datasets.forEach(d => d.buckets.forEach(b => periodSet.add(b.period)))
    const allPeriods = [...periodSet].sort()

    const chartData = {
      labels: allPeriods,
      datasets: datasets.map(d => ({
        label: d.site,
        data: allPeriods.map(p => {
          const found = d.buckets.find(b => b.period === p)
          return found ? Math.round(found.total) : null
        }),
        borderColor: d.color,
        backgroundColor: d.color + '22',
        fill: false, tension: 0.4, spanGaps: true, pointRadius: 3,
      })),
    }

    return { chartData, allPeriods }
  }, [records, selectedSites, defaultCost, granularity])
}
