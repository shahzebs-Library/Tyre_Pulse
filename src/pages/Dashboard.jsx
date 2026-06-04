import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import StatCard from '../components/StatCard'
import { exportToPptx } from '../lib/exportUtils'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend, ArcElement
} from 'chart.js'
import {
  CircleDot, Package, ClipboardList, AlertTriangle,
  TrendingUp, TrendingDown, DollarSign, Presentation, Minus
} from 'lucide-react'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement)

const BASE_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#9ca3af', boxWidth: 12 } } },
  scales: {
    x: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } },
  },
}

const NO_SCALE_OPTS = { ...BASE_OPTS, scales: undefined }

export default function Dashboard() {
  const { profile } = useAuth()
  const [stats, setStats]             = useState({ tyres: 0, stock: 0, actions: 0, critical: 0, cost: 0 })
  const [riskTrend, setRiskTrend]     = useState(null)   // { delta, pct }
  const [brandData, setBrandData]     = useState(null)
  const [categoryData, setCategoryData] = useState(null)
  const [monthlyData, setMonthlyData] = useState(null)
  const [siteCostData, setSiteCostData] = useState(null)
  const [recentRecords, setRecentRecords] = useState([])
  const [openActions, setOpenActions] = useState([])
  const [loading, setLoading]         = useState(true)

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    const [tyreRes, stockRes, actionRes, recentRes, openActionsRes] = await Promise.all([
      supabase.from('tyre_records').select('id, cost_per_tyre, brand, issue_date, risk_level, site, category', { count: 'exact' }),
      supabase.from('stock_records').select('id', { count: 'exact' }),
      supabase.from('corrective_actions').select('id, status', { count: 'exact' }),
      supabase.from('tyre_records').select('id, issue_date, brand, asset_no, site, risk_level').order('created_at', { ascending: false }).limit(5),
      supabase.from('corrective_actions').select('id, title, priority, site, status').eq('status', 'Open').order('created_at', { ascending: false }).limit(5),
    ])

    const tyres = tyreRes.data ?? []
    const totalCost = tyres.reduce((s, t) => s + (t.cost_per_tyre ?? 1200), 0)
    const critical  = tyres.filter(t => t.risk_level === 'Critical' || t.risk_level === 'High').length
    const openCount = (actionRes.data ?? []).filter(a => a.status === 'Open').length

    setStats({ tyres: tyreRes.count ?? 0, stock: stockRes.count ?? 0, actions: openCount, critical, cost: totalCost })

    // ── Risk trend: this month vs last month ─────────────────────────────────
    const now = new Date()
    const thisM = { y: now.getFullYear(), m: now.getMonth() + 1 }
    const lastM = now.getMonth() === 0
      ? { y: now.getFullYear() - 1, m: 12 }
      : { y: now.getFullYear(), m: now.getMonth() }

    const inMonth = (t, { y, m }) => {
      if (!t.issue_date) return false
      const d = new Date(t.issue_date)
      return d.getFullYear() === y && d.getMonth() + 1 === m
    }
    const isHigh = t => t.risk_level === 'Critical' || t.risk_level === 'High'
    const thisHigh = tyres.filter(t => inMonth(t, thisM) && isHigh(t)).length
    const lastHigh = tyres.filter(t => inMonth(t, lastM) && isHigh(t)).length
    const delta    = thisHigh - lastHigh
    setRiskTrend({ delta, lastHigh })

    // ── Brand doughnut ───────────────────────────────────────────────────────
    const brandCounts = {}
    tyres.forEach(t => { if (t.brand) brandCounts[t.brand] = (brandCounts[t.brand] ?? 0) + 1 })
    const topBrands = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)
    if (topBrands.length) {
      setBrandData({
        labels: topBrands.map(([b]) => b),
        datasets: [{ data: topBrands.map(([, c]) => c), backgroundColor: ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'], borderWidth: 0 }],
      })
    }

    // ── Category doughnut ────────────────────────────────────────────────────
    const catCounts = {}
    tyres.forEach(t => { if (t.category) catCounts[t.category] = (catCounts[t.category] ?? 0) + 1 })
    const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 7)
    if (topCats.length) {
      setCategoryData({
        labels: topCats.map(([c]) => c),
        datasets: [{ data: topCats.map(([, n]) => n), backgroundColor: ['#ef4444','#f97316','#f59e0b','#84cc16','#06b6d4','#8b5cf6','#ec4899'], borderWidth: 0 }],
      })
    }

    // ── Monthly trend bar ────────────────────────────────────────────────────
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      return { label: d.toLocaleString('default', { month: 'short' }), year: d.getFullYear(), month: d.getMonth() + 1 }
    })
    setMonthlyData({
      labels: months.map(m => m.label),
      datasets: [{
        label: 'All',
        data: months.map(({ year, month }) => tyres.filter(t => inMonth(t, { y: year, m: month })).length),
        backgroundColor: '#3b82f6', borderRadius: 4,
      }, {
        label: 'High Risk',
        data: months.map(({ year, month }) => tyres.filter(t => inMonth(t, { y: year, m: month }) && isHigh(t)).length),
        backgroundColor: '#ef4444', borderRadius: 4,
      }],
    })

    // ── Top sites by cost (horizontal bar) ───────────────────────────────────
    const siteCosts = {}
    tyres.forEach(t => { if (t.site) siteCosts[t.site] = (siteCosts[t.site] ?? 0) + (t.cost_per_tyre ?? 1200) })
    const topSites = Object.entries(siteCosts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (topSites.length) {
      setSiteCostData({
        labels: topSites.map(([s]) => s),
        datasets: [{ label: 'Cost (SAR)', data: topSites.map(([, c]) => c), backgroundColor: '#7c3aed', borderRadius: 4 }],
      })
    }

    setRecentRecords(recentRes.data ?? [])
    setOpenActions(openActionsRes.data ?? [])
    setLoading(false)
  }

  async function handlePptxExport() {
    const [tyreRes, actionRes] = await Promise.all([
      supabase.from('tyre_records').select('site, category, risk_level, cost_per_tyre, issue_date, brand'),
      supabase.from('corrective_actions').select('title, priority, site, status').eq('status', 'Open').order('created_at', { ascending: false }).limit(20),
    ])
    const tyres = tyreRes.data ?? []
    const now   = new Date()

    const countBy = (arr, key) => {
      const m = {}
      arr.forEach(t => { if (t[key]) m[t[key]] = (m[t[key]] ?? 0) + 1 })
      return Object.entries(m).sort((a, b) => b[1] - a[1])
    }
    const sumBy = (arr, key, valKey) => {
      const m = {}
      arr.forEach(t => { if (t[key]) m[t[key]] = (m[t[key]] ?? 0) + (t[valKey] ?? 1200) })
      return Object.entries(m).sort((a, b) => b[1] - a[1])
    }

    const riskCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 }
    tyres.forEach(t => { if (t.risk_level && riskCounts[t.risk_level] !== undefined) riskCounts[t.risk_level]++ })

    const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      const count = tyres.filter(t => {
        if (!t.issue_date) return false
        const td = new Date(t.issue_date)
        return td.getFullYear() === d.getFullYear() && td.getMonth() === d.getMonth()
      }).length
      return { month: d.toLocaleString('default', { month: 'short', year: '2-digit' }), count }
    })

    await exportToPptx({
      totalTyres:        tyres.length,
      totalCost:         tyres.reduce((s, t) => s + (t.cost_per_tyre ?? 1200), 0),
      openActions:       (actionRes.data ?? []).length,
      highRisk:          tyres.filter(t => t.risk_level === 'Critical' || t.risk_level === 'High').length,
      topSites:          sumBy(tyres, 'site', 'cost_per_tyre').slice(0, 12).map(([site, count]) => ({ site, count })),
      categoryBreakdown: countBy(tyres, 'category').map(([category, count]) => ({ category, count })),
      riskBreakdown:     Object.entries(riskCounts).map(([level, count]) => ({ level, count })),
      monthlyTrend,
      recentActions:     actionRes.data ?? [],
      period:            now.toLocaleString('default', { month: 'long', year: 'numeric' }),
      company:           'Readymix Concrete Company',
    }, `TyrePulse_Report_${now.toISOString().slice(0, 10)}`)
  }

  const riskBadge     = l => ({ Critical: 'bg-red-900/50 text-red-300', High: 'bg-orange-900/50 text-orange-300', Medium: 'bg-yellow-900/50 text-yellow-300', Low: 'bg-green-900/50 text-green-300' }[l] ?? 'bg-gray-800 text-gray-400')
  const priorityBadge = p => ({ High: 'bg-red-900/50 text-red-300', Medium: 'bg-yellow-900/50 text-yellow-300', Low: 'bg-blue-900/50 text-blue-300' }[p] ?? 'bg-gray-800 text-gray-400')

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 rounded-full border-2 border-gray-700 border-t-blue-500" /></div>

  const TrendIcon = riskTrend?.delta > 0 ? TrendingUp : riskTrend?.delta < 0 ? TrendingDown : Minus
  const trendCol  = riskTrend?.delta > 0 ? 'text-red-400' : riskTrend?.delta < 0 ? 'text-green-400' : 'text-gray-500'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Welcome back, {profile?.full_name ?? profile?.username ?? 'there'}</p>
        </div>
        <button onClick={handlePptxExport} className="btn-secondary flex items-center gap-2 text-sm">
          <Presentation size={15} className="text-orange-400" /> Export Report (.pptx)
        </button>
      </div>

      {/* KPI stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard label="Total Tyres"  value={stats.tyres.toLocaleString()}                     icon={CircleDot}    color="blue" />
        <StatCard label="Stock Sites"  value={stats.stock.toLocaleString()}                     icon={Package}      color="green" />
        <StatCard label="Open Actions" value={stats.actions.toLocaleString()}                   icon={ClipboardList} color="yellow" />
        <StatCard label="High Risk"    value={stats.critical.toLocaleString()}                  icon={AlertTriangle} color="red" />
        <StatCard label="Total Cost"   value={`SAR ${(stats.cost / 1000).toFixed(0)}K`}         icon={DollarSign}   color="purple" />
      </div>

      {/* Risk trend callout */}
      {riskTrend && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${riskTrend.delta > 0 ? 'bg-red-900/20 border-red-800/50 text-red-300' : riskTrend.delta < 0 ? 'bg-green-900/20 border-green-800/50 text-green-300' : 'bg-gray-800/50 border-gray-700 text-gray-400'}`}>
          <TrendIcon size={18} className={trendCol} />
          {riskTrend.delta === 0
            ? 'High-risk record count is unchanged from last month.'
            : `High-risk records are ${riskTrend.delta > 0 ? 'up' : 'down'} ${Math.abs(riskTrend.delta)} vs last month (${riskTrend.lastHigh} last month).`}
        </div>
      )}

      {/* Row 1: Monthly trend + Brand doughnut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2"><TrendingUp size={16} /> Monthly Tyre Issues</h2>
          <div className="h-56">
            {monthlyData
              ? <Bar data={monthlyData} options={{ ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, legend: { labels: { color: '#9ca3af', boxWidth: 10 } } } }} />
              : <p className="text-gray-500 text-sm">No data</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Brand Breakdown</h2>
          <div className="h-56 flex items-center justify-center">
            {brandData ? <Doughnut data={brandData} options={NO_SCALE_OPTS} /> : <p className="text-gray-500 text-sm">No data</p>}
          </div>
        </div>
      </div>

      {/* Row 2: Category doughnut + Top sites by cost */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Failure Category Mix</h2>
          <div className="h-56 flex items-center justify-center">
            {categoryData
              ? <Doughnut data={categoryData} options={NO_SCALE_OPTS} />
              : <p className="text-gray-500 text-sm">No classified records yet — run Data Cleaning to populate</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Top Sites by Spend (SAR)</h2>
          <div className="h-56">
            {siteCostData
              ? <Bar data={siteCostData} options={{ ...BASE_OPTS, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#9ca3af', callback: v => `${(v/1000).toFixed(0)}K` }, grid: { color: '#1f2937' } }, y: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } } } }} />
              : <p className="text-gray-500 text-sm">No data</p>}
          </div>
        </div>
      </div>

      {/* Row 3: Recent records + Open actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Recent Tyre Records</h2>
          {recentRecords.length === 0 ? <p className="text-gray-500 text-sm">No records yet</p> : (
            <div className="space-y-2">
              {recentRecords.map(r => (
                <div key={r.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm text-white font-medium">{r.asset_no ?? '—'}</p>
                    <p className="text-xs text-gray-400">{r.brand} · {r.site}</p>
                  </div>
                  <div className="text-right">
                    <span className={`badge ${riskBadge(r.risk_level)}`}>{r.risk_level ?? 'Unknown'}</span>
                    <p className="text-xs text-gray-500 mt-1">{r.issue_date ?? '—'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Open Corrective Actions</h2>
          {openActions.length === 0 ? <p className="text-gray-500 text-sm">No open actions</p> : (
            <div className="space-y-2">
              {openActions.map(a => (
                <div key={a.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm text-white font-medium">{a.title}</p>
                    <p className="text-xs text-gray-400">{a.site}</p>
                  </div>
                  <span className={`badge ${priorityBadge(a.priority)}`}>{a.priority}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
