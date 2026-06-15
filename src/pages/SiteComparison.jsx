import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { computeSiteMetrics, buildSiteRadar, bucketByMonth } from '../lib/analyticsEngine'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { Download, FileText, Maximize2, GitMerge } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
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
    map[key].total += (r.cost_per_tyre || defaultCost) * (r.qty || 1)
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
  const { appSettings, activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSites, setSelectedSites] = useState([])

  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [granularity, setGranularity] = useState('Monthly')

  const [modalOpen, setModalOpen] = useState(false)
  const trendChartRef = useRef(null)

  useEffect(() => {
    fetchAllPages((from, to) => {
      let q = supabase
        .from('tyre_records')
        .select('id,issue_date,brand,site,category,risk_level,cost_per_tyre,qty')
        .order('issue_date')
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      return q.range(from, to)
    }).then(({ data }) => {
      const recs = data || []
      setRecords(recs)
      setSelectedSites([])
      const byCount = {}
      recs.forEach(r => { if (r.site) byCount[r.site] = (byCount[r.site] || 0) + 1 })
      const top4 = Object.entries(byCount).sort(([, a], [, b]) => b - a).slice(0, 4).map(([s]) => s)
      setSelectedSites(top4)
      setLoading(false)
    })
  }, [activeCountry])

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (dateFrom && r.issue_date && r.issue_date < dateFrom) return false
      if (dateTo && r.issue_date && r.issue_date > dateTo) return false
      return true
    })
  }, [records, dateFrom, dateTo])

  const allMetrics = useMemo(() => computeSiteMetrics(filteredRecords, appSettings.cost_per_tyre), [filteredRecords, appSettings.cost_per_tyre])
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
      label: 'Total Cost (SAR)',
      data: filteredMetrics.map(s => Math.round(s.totalCost)),
      backgroundColor: filteredMetrics.map((_, i) => SITE_COLORS[i % SITE_COLORS.length] + 'bb'),
      borderColor:     filteredMetrics.map((_, i) => SITE_COLORS[i % SITE_COLORS.length]),
      borderWidth: 1, borderRadius: 4,
    }],
  } : null

  const riskChart = !loading && filteredMetrics.length > 0 ? {
    labels: filteredMetrics.map(s => s.site),
    datasets: [{
      label: 'High Risk %',
      data: filteredMetrics.map(s => parseFloat(s.highRiskPct.toFixed(1))),
      backgroundColor: 'rgba(239,68,68,0.6)',
      borderRadius: 4,
    }],
  } : null

  const BAR_OPTS = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af' } } },
    scales: {
      x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
      y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
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
        title="Site Comparison"
        subtitle="Head-to-head performance across sites"
        icon={GitMerge}
        actions={!loading && allMetrics.length > 0 ? (
          <div className="flex gap-2">
            <button
              onClick={() => exportToExcel(allMetrics, SITE_COLS.map(c => c.key), SITE_COLS.map(c => c.header), 'TyrePulse_SiteComparison')}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <Download size={14} /> Excel
            </button>
            <button
              onClick={() => exportToPdf(allMetrics, SITE_COLS, 'Site Comparison', 'TyrePulse_SiteComparison', 'landscape')}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <FileText size={14} /> PDF
            </button>
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
      ) : allSites.length === 0 ? (
        <>
          <div className="card space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="label text-xs">Date From</label>
                <input type="date" className="input py-1.5 text-sm w-36" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="label text-xs">Date To</label>
                <input type="date" className="input py-1.5 text-sm w-36" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="card flex flex-col items-center justify-center py-16 text-center">
            <GitMerge size={40} className="text-gray-700 mb-4" />
            <p className="text-gray-400 font-medium text-lg">No site data available</p>
            <p className="text-gray-600 text-sm mt-1">Upload tyre records with site information to start comparing.</p>
          </div>
        </>
      ) : (
        <>
          {/* Filter bar + site selector */}
          <div className="card space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="label text-xs">Date From</label>
                <input type="date" className="input py-1.5 text-sm w-36" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="label text-xs">Date To</label>
                <input type="date" className="input py-1.5 text-sm w-36" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="label text-xs">Granularity</label>
                <div className="flex gap-1">
                  {GRANULARITIES.map(g => (
                    <button
                      key={g}
                      onClick={() => setGranularity(g)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        granularity === g
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-400 mb-3">Select sites to compare (up to 6):</p>
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
              <p className="text-gray-400 font-medium">Select at least one site to compare</p>
              <p className="text-gray-600 text-sm mt-1">Toggle sites above to begin the comparison.</p>
            </div>
          ) : (
            <>
              {/* KPI comparison cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {filteredMetrics.map((s, i) => (
                  <div key={s.site} className="card border-t-2" style={{ borderColor: SITE_COLORS[i % SITE_COLORS.length] }}>
                    <p className="text-white font-semibold text-sm">{s.site}</p>
                    <div className="mt-3 space-y-2">
                      <KpiRow label="Records" value={s.count} />
                      <KpiRow label="Total Cost" value={formatCurrencyCompact(s.totalCost, activeCurrency)} />
                      <KpiRow label="High Risk" value={`${s.highRiskCount} (${s.highRiskPct.toFixed(0)}%)`}
                        highlight={s.highRiskPct > 30 ? 'text-red-400' : s.highRiskPct > 15 ? 'text-yellow-400' : 'text-green-400'} />
                      <KpiRow label="Top Brand" value={s.topBrand} />
                      <KpiRow label="Top Category" value={s.topCategory} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="text-sm font-medium text-gray-400 mb-4">Total Cost Comparison</h3>
                  <div style={{ height: 260 }}>
                    <Bar data={costChart} options={BAR_OPTS} />
                  </div>
                </div>
                <div className="card">
                  <h3 className="text-sm font-medium text-gray-400 mb-4">High-Risk Rate Comparison</h3>
                  <div style={{ height: 260 }}>
                    <Bar data={riskChart} options={BAR_OPTS} />
                  </div>
                </div>
              </div>

              {/* Radar */}
              {filteredMetrics.length >= 2 && (
                <div className="card">
                  <h3 className="text-sm font-medium text-gray-400 mb-4">
                    Multi-Dimension Radar (0-100, higher = better)
                  </h3>
                  <div className="max-w-xl mx-auto" style={{ height: 380 }}>
                    <Radar data={radarData} options={RADAR_OPTS} />
                  </div>
                  <p className="text-xs text-gray-600 text-center mt-2">
                    Cost Efficiency · Safety · Volume · Risk Quality · Data Quality
                  </p>
                </div>
              )}

              {/* Trend comparison with granularity */}
              <TrendComparison
                records={filteredRecords}
                selectedSites={selectedSites}
                defaultCost={appSettings.cost_per_tyre}
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
        defaultCost={appSettings.cost_per_tyre}
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
  const { chartData, allPeriods } = useTrendData(records, selectedSites, defaultCost, granularity)

  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af' } } },
    scales: {
      x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
      y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
    },
  }

  if (allPeriods.length < 2) return null

  const labelMap = { Monthly: 'last 12 months', Quarterly: 'last 8 quarters', Yearly: 'last 5 years' }

  return (
    <div className="card relative">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-400">
          {granularity} Cost Trend by Site ({labelMap[granularity]})
        </h3>
        <button
          onClick={onMaximize}
          className="text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
          title="Fullscreen"
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
  const { chartData } = useTrendData(records, selectedSites, defaultCost, granularity)

  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af' } } },
    scales: {
      x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
      y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
    },
  }

  return (
    <ChartModal
      open={open}
      onClose={onClose}
      title="Cost Trend by Site"
      chartRef={chartRef}
      filters={{ granularity }}
      onFilterChange={(key, val) => { if (key === 'granularity') onGranularityChange(val) }}
      filterOptions={{}}
      showGranularity={false}
      showSite={false}
      showBrand={false}
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">Granularity:</span>
        {GRANULARITIES.map(g => (
          <button
            key={g}
            onClick={() => onGranularityChange(g)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              granularity === g ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {g}
          </button>
        ))}
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
