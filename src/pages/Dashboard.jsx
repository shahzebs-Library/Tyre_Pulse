import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import StatCard from '../components/StatCard'
import { exportToPptx } from '../lib/exportUtils'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, Title,
  Tooltip, Legend, ArcElement
} from 'chart.js'
import { CircleDot, Package, ClipboardList, AlertTriangle, TrendingUp, DollarSign, Presentation } from 'lucide-react'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement)

const CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#9ca3af' } } },
  scales: {
    x: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } },
  },
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [stats, setStats] = useState({ tyres: 0, stock: 0, actions: 0, critical: 0, cost: 0 })
  const [brandData, setBrandData] = useState(null)
  const [monthlyData, setMonthlyData] = useState(null)
  const [recentRecords, setRecentRecords] = useState([])
  const [openActions, setOpenActions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    const [tyreRes, stockRes, actionRes, recentRes, openActionsRes] = await Promise.all([
      supabase.from('tyre_records').select('id, cost_per_tyre, brand, issue_date, risk_level', { count: 'exact' }),
      supabase.from('stock_records').select('id', { count: 'exact' }),
      supabase.from('corrective_actions').select('id, status', { count: 'exact' }),
      supabase.from('tyre_records').select('id, issue_date, brand, asset_no, site, risk_level').order('created_at', { ascending: false }).limit(5),
      supabase.from('corrective_actions').select('id, title, priority, site, status').eq('status', 'Open').order('created_at', { ascending: false }).limit(5),
    ])

    const tyres = tyreRes.data ?? []
    const totalCost = tyres.reduce((sum, t) => sum + (t.cost_per_tyre ?? 1200), 0)
    const critical = tyres.filter(t => t.risk_level === 'Critical' || t.risk_level === 'High').length
    const openCount = (actionRes.data ?? []).filter(a => a.status === 'Open').length

    setStats({
      tyres: tyreRes.count ?? 0,
      stock: stockRes.count ?? 0,
      actions: openCount,
      critical,
      cost: totalCost,
    })

    // Brand breakdown for doughnut
    const brandCounts = {}
    tyres.forEach(t => {
      if (t.brand) brandCounts[t.brand] = (brandCounts[t.brand] ?? 0) + 1
    })
    const topBrands = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)
    if (topBrands.length > 0) {
      setBrandData({
        labels: topBrands.map(([b]) => b),
        datasets: [{
          data: topBrands.map(([, c]) => c),
          backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'],
          borderWidth: 0,
        }],
      })
    }

    // Monthly trend (last 6 months)
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      return { label: d.toLocaleString('default', { month: 'short' }), year: d.getFullYear(), month: d.getMonth() + 1 }
    })
    const monthlyCounts = months.map(({ year, month }) =>
      tyres.filter(t => {
        if (!t.issue_date) return false
        const d = new Date(t.issue_date)
        return d.getFullYear() === year && d.getMonth() + 1 === month
      }).length
    )
    setMonthlyData({
      labels: months.map(m => m.label),
      datasets: [{
        label: 'Tyre Issues',
        data: monthlyCounts,
        backgroundColor: '#3b82f6',
        borderRadius: 4,
      }],
    })

    setRecentRecords(recentRes.data ?? [])
    setOpenActions(openActionsRes.data ?? [])
    setLoading(false)
  }

  async function handlePptxExport() {
    // Gather aggregated data for PPT
    const [tyreRes, actionRes, siteRes, categoryRes, riskRes] = await Promise.all([
      supabase.from('tyre_records').select('site, category, risk_level, cost_per_tyre, issue_date'),
      supabase.from('corrective_actions').select('title, priority, site, status').eq('status', 'Open').order('created_at', { ascending: false }).limit(20),
      supabase.from('tyre_records').select('site').not('site', 'is', null),
      supabase.from('tyre_records').select('category').not('category', 'is', null),
      supabase.from('tyre_records').select('risk_level').not('risk_level', 'is', null),
    ])

    const tyres = tyreRes.data ?? []

    // Top sites
    const siteCounts = {}
    tyres.forEach(t => { if (t.site) siteCounts[t.site] = (siteCounts[t.site] ?? 0) + 1 })
    const topSites = Object.entries(siteCounts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([site, count]) => ({ site, count }))

    // Brand breakdown (from already loaded brand data)
    const brandCounts = {}
    tyres.forEach(t => { if (t.brand) brandCounts[t.brand] = (brandCounts[t.brand] ?? 0) + 1 })
    const topBrands = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([brand, count]) => ({ brand, count }))

    // Category breakdown
    const catCounts = {}
    tyres.forEach(t => { if (t.category) catCounts[t.category] = (catCounts[t.category] ?? 0) + 1 })
    const categoryBreakdown = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }))

    // Risk breakdown
    const riskCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 }
    tyres.forEach(t => { if (t.risk_level && riskCounts[t.risk_level] !== undefined) riskCounts[t.risk_level]++ })
    const riskBreakdown = Object.entries(riskCounts).map(([level, count]) => ({ level, count }))

    // Monthly trend (last 6 months)
    const now = new Date()
    const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      const count = tyres.filter(t => {
        if (!t.issue_date) return false
        const td = new Date(t.issue_date)
        return td.getFullYear() === d.getFullYear() && td.getMonth() === d.getMonth()
      }).length
      return { month: d.toLocaleString('default', { month: 'short', year: '2-digit' }), count }
    })

    const totalCost = tyres.reduce((s, t) => s + (t.cost_per_tyre ?? 1200), 0)
    const highRisk = tyres.filter(t => t.risk_level === 'Critical' || t.risk_level === 'High').length

    await exportToPptx({
      totalTyres: tyres.length,
      totalCost,
      openActions: (actionRes.data ?? []).length,
      highRisk,
      topSites,
      categoryBreakdown,
      riskBreakdown,
      monthlyTrend,
      recentActions: actionRes.data ?? [],
      period: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
      company: 'Readymix Concrete Company',
    }, `TyrePulse_Report_${new Date().toISOString().slice(0, 10)}`)
  }

  const riskBadge = (level) => {
    const map = { Critical: 'bg-red-900/50 text-red-300', High: 'bg-orange-900/50 text-orange-300', Medium: 'bg-yellow-900/50 text-yellow-300', Low: 'bg-green-900/50 text-green-300' }
    return map[level] ?? 'bg-gray-800 text-gray-400'
  }

  const priorityBadge = (p) => {
    const map = { High: 'bg-red-900/50 text-red-300', Medium: 'bg-yellow-900/50 text-yellow-300', Low: 'bg-blue-900/50 text-blue-300' }
    return map[p] ?? 'bg-gray-800 text-gray-400'
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 rounded-full border-2 border-gray-700 border-t-blue-500" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Welcome back, {profile?.full_name ?? profile?.username ?? 'there'}</p>
        </div>
        <button onClick={handlePptxExport} className="btn-secondary flex items-center gap-2 text-sm">
          <Presentation size={15} className="text-orange-400" /> Export Report (.pptx)
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard label="Total Tyres" value={stats.tyres.toLocaleString()} icon={CircleDot} color="blue" />
        <StatCard label="Stock Sites" value={stats.stock.toLocaleString()} icon={Package} color="green" />
        <StatCard label="Open Actions" value={stats.actions.toLocaleString()} icon={ClipboardList} color="yellow" />
        <StatCard label="High Risk" value={stats.critical.toLocaleString()} icon={AlertTriangle} color="red" />
        <StatCard label="Total Cost" value={`SAR ${(stats.cost / 1000).toFixed(0)}K`} icon={DollarSign} color="purple" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2"><TrendingUp size={16} /> Monthly Tyre Issues</h2>
          <div className="h-56">
            {monthlyData ? <Bar data={monthlyData} options={CHART_OPTIONS} /> : <p className="text-gray-500 text-sm">No data</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Brand Breakdown</h2>
          <div className="h-56 flex items-center justify-center">
            {brandData ? <Doughnut data={brandData} options={{ ...CHART_OPTIONS, scales: undefined }} /> : <p className="text-gray-500 text-sm">No data</p>}
          </div>
        </div>
      </div>

      {/* Recent Records + Open Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Recent Tyre Records</h2>
          {recentRecords.length === 0 ? (
            <p className="text-gray-500 text-sm">No records yet</p>
          ) : (
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
          {openActions.length === 0 ? (
            <p className="text-gray-500 text-sm">No open actions</p>
          ) : (
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
