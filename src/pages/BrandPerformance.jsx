import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { computeBrandMetrics, linearRegression, bucketByMonth } from '../lib/analyticsEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

const CHART_OPTS = (horizontal = false) => ({
  responsive: true, maintainAspectRatio: false,
  indexAxis: horizontal ? 'y' : 'x',
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
    y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
  },
})

export default function BrandPerformance() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    supabase
      .from('tyre_records')
      .select('id,issue_date,brand,site,category,risk_level,cost_per_tyre,qty,description,remarks')
      .order('issue_date')
      .then(({ data }) => { setRecords(data || []); setLoading(false) })
  }, [])

  const metrics = useMemo(() => computeBrandMetrics(records), [records])
  const selectedData = useMemo(() =>
    selected ? records.filter(r => r.brand === selected) : [],
    [records, selected]
  )

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading brand data…</div>

  // Top 10 brands by count for the ranking chart
  const top10 = metrics.slice(0, 10)

  const rankingChart = {
    labels: top10.map(b => b.brand),
    datasets: [
      {
        label: 'Records',
        data: top10.map(b => b.count),
        backgroundColor: top10.map(b =>
          b.failureRate > 30 ? 'rgba(239,68,68,0.7)' :
          b.failureRate > 15 ? 'rgba(245,158,11,0.7)' : 'rgba(16,185,129,0.7)'
        ),
        borderRadius: 4,
      },
    ],
  }

  const failureRateChart = {
    labels: top10.map(b => b.brand),
    datasets: [{
      label: 'Failure Rate %',
      data: top10.map(b => parseFloat(b.failureRate.toFixed(1))),
      backgroundColor: 'rgba(239,68,68,0.6)',
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Brand Performance</h1>
        <p className="text-gray-400 text-sm mt-1">Failure rates, avg life, cost and ranking by brand</p>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Volume by Brand (top 10)</h3>
          <div style={{ height: 240 }}>
            <Bar data={rankingChart} options={CHART_OPTS()} />
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-gray-400 mb-4">High-Risk Failure Rate % (top 10)</h3>
          <div style={{ height: 240 }}>
            <Bar data={failureRateChart} options={CHART_OPTS()} />
          </div>
        </div>
      </div>

      {/* Ranking table */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-medium text-gray-400 mb-4">Brand Ranking Table</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-800">
              <th className="pb-2 pr-3">#</th>
              <th className="pb-2 pr-4">Brand</th>
              <th className="pb-2 pr-4 text-right">Records</th>
              <th className="pb-2 pr-4 text-right">Total Cost</th>
              <th className="pb-2 pr-4 text-right">Avg/Tyre</th>
              <th className="pb-2 pr-4 text-right">Failure Rate</th>
              <th className="pb-2 pr-4">Top Failure</th>
              <th className="pb-2 text-right">Risk Score</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((b, i) => (
              <tr
                key={b.brand}
                className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                onClick={() => setSelected(selected === b.brand ? null : b.brand)}
              >
                <td className="py-2 pr-3 text-gray-500 text-xs">{i + 1}</td>
                <td className="py-2 pr-4 font-medium text-white">{b.brand}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{b.count}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">
                  SAR {b.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}
                </td>
                <td className="py-2 pr-4 text-gray-300 text-right">
                  SAR {Math.round(b.avgCost).toLocaleString()}
                </td>
                <td className="py-2 pr-4 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    b.failureRate > 30 ? 'bg-red-900/40 text-red-400' :
                    b.failureRate > 15 ? 'bg-yellow-900/40 text-yellow-400' :
                    'bg-green-900/40 text-green-400'
                  }`}>
                    {b.failureRate.toFixed(1)}%
                  </span>
                </td>
                <td className="py-2 pr-4 text-gray-400 text-xs">{b.topCategory}</td>
                <td className="py-2 text-right">
                  <span className={`text-xs font-mono ${
                    b.riskScore > 2 ? 'text-red-400' :
                    b.riskScore > 1.5 ? 'text-yellow-400' : 'text-green-400'
                  }`}>
                    {b.riskScore.toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Drill-down panel */}
      {selected && <BrandDrillDown brand={selected} records={selectedData} />}
    </div>
  )
}

function BrandDrillDown({ brand, records }) {
  const monthly = useMemo(() =>
    bucketByMonth(records, r => r.issue_date, r => (r.cost_per_tyre || 1200) * (r.qty || 1)),
    [records]
  )

  const trendPoints = monthly.map((d, i) => [i, d.count])
  const reg = trendPoints.length >= 2 ? linearRegression(trendPoints) : null

  const chartData = {
    labels: monthly.map(d => d.month),
    datasets: [
      {
        label: 'Records',
        data: monthly.map(d => d.count),
        borderColor: 'rgba(59,130,246,1)',
        backgroundColor: 'rgba(59,130,246,0.15)',
        fill: true, tension: 0.4, yAxisID: 'y',
      },
      reg && {
        label: 'Trend',
        data: monthly.map((_, i) => Math.max(0, Math.round(reg.predict(i)))),
        borderColor: 'rgba(107,114,128,0.6)',
        borderDash: [4, 4], fill: false, pointRadius: 0, yAxisID: 'y',
      },
    ].filter(Boolean),
  }

  const lineOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af' } } },
    scales: {
      x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
      y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
    },
  }

  // Category breakdown
  const catMap = {}
  records.forEach(r => { if (r.category) catMap[r.category] = (catMap[r.category] || 0) + 1 })
  const catEntries = Object.entries(catMap).sort(([, a], [, b]) => b - a)

  return (
    <div className="card border border-blue-500/30 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">Drill-down: {brand}</h3>
        <span className="text-xs text-gray-500">{records.length} total records</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-gray-400 mb-3">Monthly Failure Trend</p>
          <div style={{ height: 220 }}>
            <Line data={chartData} options={lineOpts} />
          </div>
          {reg && (
            <p className="text-xs text-gray-500 mt-2">
              Trend slope: {reg.slope > 0 ? '↑' : '↓'} {Math.abs(reg.slope).toFixed(2)}/mo
              &nbsp;· R² = {reg.r2.toFixed(2)}
            </p>
          )}
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-3">Failure Category Breakdown</p>
          <div className="space-y-2">
            {catEntries.map(([cat, cnt]) => (
              <div key={cat} className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-300">{cat}</span>
                    <span className="text-gray-400">{cnt} ({((cnt / records.length) * 100).toFixed(0)}%)</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${(cnt / records.length) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {catEntries.length === 0 && <p className="text-gray-500 text-sm">No category data</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
