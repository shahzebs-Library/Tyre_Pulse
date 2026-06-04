import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { computeAssetMetrics, bucketByMonth, linearRegression } from '../lib/analyticsEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler)

const RISK_BADGE = {
  High:    'bg-red-900/40 text-red-400 border-red-700/50',
  Medium:  'bg-yellow-900/40 text-yellow-400 border-yellow-700/50',
  Low:     'bg-green-900/40 text-green-400 border-green-700/50',
  Unknown: 'bg-gray-800 text-gray-400 border-gray-700',
}

export default function FleetAnalytics() {
  const [records, setRecords]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [selected, setSelected] = useState(null)
  const [sortBy, setSortBy]     = useState('count')

  useEffect(() => {
    supabase
      .from('tyre_records')
      .select('*')
      .order('issue_date', { ascending: false })
      .then(({ data }) => {
        setRecords(data || [])
        setLoading(false)
      })
  }, [])

  const assetMetrics = useMemo(() => computeAssetMetrics(records), [records])

  const sorted = useMemo(() => {
    const arr = [...assetMetrics]
    if (sortBy === 'count')    return arr.sort((a, b) => b.count - a.count)
    if (sortBy === 'cost')     return arr.sort((a, b) => b.totalCost - a.totalCost)
    if (sortBy === 'risk')     return arr.sort((a, b) => b.highRiskCount - a.highRiskCount)
    if (sortBy === 'freq')     return arr.sort((a, b) => b.failureFreqPerMonth - a.failureFreqPerMonth)
    return arr
  }, [assetMetrics, sortBy])

  const filtered = useMemo(() =>
    sorted.filter(a => !search || a.assetNo.toLowerCase().includes(search.toLowerCase())),
    [sorted, search]
  )

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading fleet data…</div>

  const selectedAsset = selected ? assetMetrics.find(a => a.assetNo === selected) : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Fleet Analytics</h1>
        <p className="text-gray-400 text-sm mt-1">Per-asset history, cost, failure frequency and tyre lifecycle</p>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Assets',    value: assetMetrics.length,       color: 'text-blue-400' },
          { label: 'Total Records',   value: records.length.toLocaleString(), color: 'text-white' },
          { label: 'High Freq Assets',
            value: assetMetrics.filter(a => a.failureFreqPerMonth > 2).length,
            color: 'text-red-400' },
          { label: 'Avg Cost/Asset',
            value: assetMetrics.length
              ? `SAR ${Math.round(assetMetrics.reduce((s, a) => s + a.totalCost, 0) / assetMetrics.length).toLocaleString()}`
              : '—',
            color: 'text-green-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-gray-400 text-sm mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Asset list */}
      <div className="card">
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            className="input flex-1 min-w-48"
            placeholder="Search asset number…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="input w-44" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="count">Sort: Record Count</option>
            <option value="cost">Sort: Total Cost</option>
            <option value="risk">Sort: High Risk Count</option>
            <option value="freq">Sort: Failure Freq</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-800">
                <th className="pb-2 pr-4">Asset No</th>
                <th className="pb-2 pr-4 text-right">Records</th>
                <th className="pb-2 pr-4 text-right">Total Cost</th>
                <th className="pb-2 pr-4 text-right">High Risk</th>
                <th className="pb-2 pr-4 text-right">Fail/Mo</th>
                <th className="pb-2 pr-4">Sites</th>
                <th className="pb-2 pr-4">Brands</th>
                <th className="pb-2">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map(a => (
                <tr
                  key={a.assetNo}
                  onClick={() => setSelected(selected === a.assetNo ? null : a.assetNo)}
                  className={`border-b border-gray-800/50 cursor-pointer transition-colors ${
                    selected === a.assetNo ? 'bg-blue-900/20' : 'hover:bg-gray-800/20'
                  }`}
                >
                  <td className="py-2 pr-4 font-mono text-xs text-blue-400 font-medium">{a.assetNo}</td>
                  <td className="py-2 pr-4 text-gray-300 text-right">{a.count}</td>
                  <td className="py-2 pr-4 text-gray-300 text-right">
                    SAR {a.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {a.highRiskCount > 0
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-400">{a.highRiskCount}</span>
                      : <span className="text-gray-600">0</span>
                    }
                  </td>
                  <td className="py-2 pr-4 text-right text-xs text-gray-400">{a.failureFreqPerMonth.toFixed(1)}</td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">{a.sites.slice(0, 2).join(', ')}</td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">{a.brands.slice(0, 2).join(', ')}</td>
                  <td className="py-2 text-gray-500 text-xs">{a.lastSeen || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <p className="text-xs text-gray-500 text-center pt-3">
              Showing 100 of {filtered.length} assets — refine search to narrow
            </p>
          )}
        </div>
      </div>

      {/* Drill-down */}
      {selectedAsset && <AssetDrillDown asset={selectedAsset} />}
    </div>
  )
}

function AssetDrillDown({ asset }) {
  const monthly = useMemo(() =>
    bucketByMonth(asset.records, r => r.issue_date,
      r => (r.cost_per_tyre || 1200) * (r.qty || 1)),
    [asset]
  )

  const points    = monthly.map((d, i) => [i, d.count])
  const reg       = points.length >= 2 ? linearRegression(points) : null

  const costData = {
    labels: monthly.map(d => d.month),
    datasets: [{
      label: 'Cost (SAR)',
      data: monthly.map(d => Math.round(d.total)),
      backgroundColor: 'rgba(59,130,246,0.5)',
      borderColor: 'rgba(59,130,246,1)',
      borderRadius: 4,
    }],
  }

  const countData = {
    labels: monthly.map(d => d.month),
    datasets: [
      {
        label: 'Records',
        data: monthly.map(d => d.count),
        borderColor: 'rgba(16,185,129,1)',
        backgroundColor: 'rgba(16,185,129,0.1)',
        fill: true, tension: 0.4,
      },
      reg && {
        label: 'Trend',
        data: monthly.map((_, i) => Math.max(0, parseFloat(reg.predict(i).toFixed(1)))),
        borderColor: 'rgba(107,114,128,0.6)',
        borderDash: [4, 4], fill: false, pointRadius: 0,
      },
    ].filter(Boolean),
  }

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af', font: { size: 11 } } } },
    scales: {
      x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
      y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
    },
  }

  const barOpts = {
    ...chartOpts,
    plugins: { ...chartOpts.plugins, legend: { display: false } },
  }

  // Tyre lifecycle: group by serial_no
  const bySerial = {}
  asset.records.forEach(r => {
    if (!r.serial_no) return
    if (!bySerial[r.serial_no]) bySerial[r.serial_no] = []
    bySerial[r.serial_no].push(r)
  })
  const serials = Object.entries(bySerial)
    .sort(([, a], [, b]) => new Date(b[0].issue_date) - new Date(a[0].issue_date))
    .slice(0, 10)

  return (
    <div className="card border border-blue-500/30 space-y-6">
      {/* Asset header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-white font-bold text-lg font-mono">{asset.assetNo}</h3>
          <p className="text-gray-400 text-sm mt-1">
            {asset.count} records · SAR {asset.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })} total
            · active since {asset.firstSeen || '?'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {asset.sites.map(s => (
            <span key={s} className="text-xs bg-blue-900/30 text-blue-400 border border-blue-700/50 px-2 py-0.5 rounded-full">{s}</span>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-gray-400 mb-2">Monthly Cost (SAR)</p>
          <div style={{ height: 200 }}>
            <Bar data={costData} options={barOpts} />
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-2">Failure Frequency + Trend</p>
          <div style={{ height: 200 }}>
            <Line data={countData} options={chartOpts} />
          </div>
          {reg && (
            <p className="text-xs text-gray-500 mt-1">
              R² = {reg.r2.toFixed(2)} · slope {reg.slope > 0 ? '↑' : '↓'}{Math.abs(reg.slope).toFixed(2)}/mo
            </p>
          )}
        </div>
      </div>

      {/* Tyre Lifecycle / Serial number history */}
      <div>
        <p className="text-sm font-medium text-gray-300 mb-3">Tyre Lifecycle — Serial Number History</p>
        {serials.length > 0 ? (
          <div className="space-y-2">
            {serials.map(([serial, recs]) => {
              const latest = recs[0]
              return (
                <div key={serial} className="bg-gray-800/40 rounded-lg p-3 flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xs text-blue-300">{serial}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${RISK_BADGE[latest.risk_level] || RISK_BADGE.Unknown}`}>
                    {latest.risk_level || 'Unknown'}
                  </span>
                  <span className="text-xs text-gray-400">{latest.brand || 'Unknown brand'}</span>
                  <span className="text-xs text-gray-400">{latest.category || 'Uncategorised'}</span>
                  <span className="text-xs text-gray-500 ml-auto">{recs.length} event{recs.length !== 1 ? 's' : ''}</span>
                  <span className="text-xs text-gray-600">{latest.issue_date || '—'}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No serial number data available for this asset</p>
        )}
      </div>

      {/* Full record history table */}
      <div>
        <p className="text-sm font-medium text-gray-300 mb-3">Full Record History (latest 30)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800 text-left">
                <th className="pb-1.5 pr-3">Date</th>
                <th className="pb-1.5 pr-3">Serial</th>
                <th className="pb-1.5 pr-3">Brand</th>
                <th className="pb-1.5 pr-3">Category</th>
                <th className="pb-1.5 pr-3">Risk</th>
                <th className="pb-1.5 pr-3 text-right">Cost</th>
                <th className="pb-1.5">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {asset.records.slice(0, 30).map(r => (
                <tr key={r.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                  <td className="py-1.5 pr-3 text-gray-400">{r.issue_date || '—'}</td>
                  <td className="py-1.5 pr-3 font-mono text-gray-400">{r.serial_no || '—'}</td>
                  <td className="py-1.5 pr-3 text-gray-300">{r.brand || '—'}</td>
                  <td className="py-1.5 pr-3 text-gray-400">{r.category || '—'}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-xs border ${RISK_BADGE[r.risk_level] || RISK_BADGE.Unknown}`}>
                      {r.risk_level || '?'}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-right text-gray-400">
                    SAR {((r.cost_per_tyre || 1200) * (r.qty || 1)).toLocaleString()}
                  </td>
                  <td className="py-1.5 text-gray-500 max-w-xs truncate">{r.remarks_cleaned || r.remarks || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
