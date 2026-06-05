import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { computeSiteMetrics, buildSiteRadar, bucketByMonth } from '../lib/analyticsEngine'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { Download, FileText } from 'lucide-react'
import {
  Chart as ChartJS, RadialLinearScale, PointElement, LineElement,
  Filler, Tooltip, Legend, CategoryScale, LinearScale, BarElement,
} from 'chart.js'
import { Radar, Bar, Line } from 'react-chartjs-2'

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement)

const SITE_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#06b6d4', '#84cc16', '#f97316', '#a855f7',
]

export default function SiteComparison() {
  const { appSettings, activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSites, setSelectedSites] = useState([])

  useEffect(() => {
    let q = supabase
      .from('tyre_records')
      .select('id,issue_date,brand,site,category,risk_level,cost_per_tyre,qty')
      .order('issue_date')
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    q.then(({ data }) => {
      const recs = data || []
      setRecords(recs)
      setSelectedSites([])
      // Default: top 4 sites by count
      const byCount = {}
      recs.forEach(r => { if (r.site) byCount[r.site] = (byCount[r.site] || 0) + 1 })
      const top4 = Object.entries(byCount).sort(([, a], [, b]) => b - a).slice(0, 4).map(([s]) => s)
      setSelectedSites(top4)
      setLoading(false)
    })
  }, [activeCountry])

  const allMetrics = useMemo(() => computeSiteMetrics(records, appSettings.cost_per_tyre), [records, appSettings.cost_per_tyre])
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

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading site data…</div>

  // Side-by-side bar: Total cost comparison
  const costChart = {
    labels: filteredMetrics.map(s => s.site),
    datasets: [{
      label: 'Total Cost (SAR)',
      data: filteredMetrics.map(s => Math.round(s.totalCost)),
      backgroundColor: filteredMetrics.map((_, i) => SITE_COLORS[i % SITE_COLORS.length] + 'bb'),
      borderColor:     filteredMetrics.map((_, i) => SITE_COLORS[i % SITE_COLORS.length]),
      borderWidth: 1, borderRadius: 4,
    }],
  }

  const riskChart = {
    labels: filteredMetrics.map(s => s.site),
    datasets: [
      {
        label: 'High Risk %',
        data: filteredMetrics.map(s => parseFloat(s.highRiskPct.toFixed(1))),
        backgroundColor: 'rgba(239,68,68,0.6)',
        borderRadius: 4,
      },
    ],
  }

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
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Site Comparison</h1>
          <p className="text-gray-400 text-sm mt-1">Head-to-head performance across sites</p>
        </div>
        <div className="flex gap-2">
          {(() => {
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
            const exportData = allMetrics
            return (
              <>
                <button
                  onClick={() => exportToExcel(exportData, SITE_COLS.map(c => c.key), SITE_COLS.map(c => c.header), 'TyrePulse_SiteComparison')}
                  className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
                >
                  <Download size={14} /> Excel
                </button>
                <button
                  onClick={() => exportToPdf(exportData, SITE_COLS, 'Site Comparison', 'TyrePulse_SiteComparison', 'landscape')}
                  className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
                >
                  <FileText size={14} /> PDF
                </button>
              </>
            )
          })()}
        </div>
      </div>

      {/* Site selector */}
      <div className="card">
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

      {filteredMetrics.length === 0 && (
        <div className="card text-center text-gray-500 py-12">Select at least one site to compare</div>
      )}

      {filteredMetrics.length > 0 && (
        <>
          {/* KPI comparison cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredMetrics.map((s, i) => (
              <div key={s.site} className="card border-t-2" style={{ borderColor: SITE_COLORS[i % SITE_COLORS.length] }}>
                <p className="text-white font-semibold text-sm">{s.site}</p>
                <div className="mt-3 space-y-2">
                  <KpiRow label="Records" value={s.count} />
                  <KpiRow label="Total Cost" value={`${activeCurrency} ${s.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}`} />
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
                Multi-Dimension Radar (0–100, higher = better)
              </h3>
              <div className="max-w-xl mx-auto" style={{ height: 380 }}>
                <Radar data={radarData} options={RADAR_OPTS} />
              </div>
              <p className="text-xs text-gray-600 text-center mt-2">
                Cost Efficiency · Safety · Volume · Risk Quality · Data Quality
              </p>
            </div>
          )}

          {/* Monthly trend comparison */}
          <MonthlyComparison metrics={filteredMetrics} records={records} selectedSites={selectedSites} defaultCost={appSettings.cost_per_tyre} />
        </>
      )}
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

function MonthlyComparison({ metrics, records, selectedSites, defaultCost = 1200 }) {
  const datasets = useMemo(() => {
    return selectedSites.map((site, i) => {
      const siteRecs = records.filter(r => r.site === site)
      const monthly  = bucketByMonth(siteRecs, r => r.issue_date, r => (r.cost_per_tyre || defaultCost) * (r.qty || 1))
      return { site, monthly, color: SITE_COLORS[i % SITE_COLORS.length] }
    })
  }, [records, selectedSites, defaultCost])

  // Build unified month axis
  const allMonths = useMemo(() => {
    const s = new Set()
    datasets.forEach(d => d.monthly.forEach(m => s.add(m.month)))
    return [...s].sort()
  }, [datasets])

  const chartData = {
    labels: allMonths,
    datasets: datasets.map(d => ({
      label: d.site,
      data: allMonths.map(m => {
        const found = d.monthly.find(x => x.month === m)
        return found ? Math.round(found.total) : null
      }),
      borderColor: d.color,
      backgroundColor: d.color + '22',
      fill: false, tension: 0.4, spanGaps: true, pointRadius: 3,
    })),
  }

  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af' } } },
    scales: {
      x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
      y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
    },
  }

  if (allMonths.length < 2) return null

  return (
    <div className="card">
      <h3 className="text-sm font-medium text-gray-400 mb-4">Monthly Cost Trend by Site</h3>
      <div style={{ height: 300 }}>
        <Line data={chartData} options={opts} />
      </div>
    </div>
  )
}
