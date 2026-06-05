import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import StatCard from '../components/StatCard'
import { exportToPptx } from '../lib/exportUtils'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  recordCost, computeFleetHealthScore, computeSeasonalTrends, computeTyreLifeAnalysis,
} from '../lib/analyticsEngine'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend, ArcElement, LineElement, PointElement, Filler,
} from 'chart.js'
import {
  CircleDot, Package, ClipboardList, AlertTriangle,
  TrendingUp, TrendingDown, DollarSign, Presentation, Minus,
  FileSpreadsheet, FileText, Search, X, Calendar, Activity, Clock,
} from 'lucide-react'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
  ArcElement, LineElement, PointElement, Filler,
)

const GRID   = { color: '#1f2937' }
const TICK   = { color: '#9ca3af' }
const LEGEND = { labels: { color: '#9ca3af', boxWidth: 12 } }

const BASE_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: LEGEND },
  scales: { x: { ticks: TICK, grid: GRID }, y: { ticks: TICK, grid: GRID } },
}
const NO_SCALE = { ...BASE_OPTS, scales: undefined }
const H_BAR    = { ...BASE_OPTS, indexAxis: 'y', plugins: { legend: { display: false } } }

function inMonth(t, y, m) {
  if (!t.issue_date) return false
  const d = new Date(t.issue_date)
  return d.getFullYear() === y && d.getMonth() + 1 === m
}
function isHigh(t) { return t.risk_level === 'Critical' || t.risk_level === 'High' }

export default function Dashboard() {
  const { profile } = useAuth()
  const { appSettings, activeCountry, activeCurrency } = useSettings()

  const [rawTyres, setRawTyres]       = useState([])
  const [rawActions, setRawActions]   = useState([])
  const [rawStock, setRawStock]       = useState([])
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [search, setSearch]           = useState('')
  const [loading, setLoading]         = useState(true)

  function applyPreset(preset) {
    const now  = new Date()
    const fmt  = d => d.toISOString().slice(0, 10)
    const ago  = days => { const d = new Date(now); d.setDate(d.getDate() - days); return d }
    if (preset === 'all') { setDateFrom(''); setDateTo(''); return }
    if (preset === 'ytd') { setDateFrom(`${now.getFullYear()}-01-01`); setDateTo(fmt(now)); return }
    const days = { '7d': 7, '30d': 30, '3m': 90, '6m': 180 }[preset]
    if (days) { setDateFrom(fmt(ago(days))); setDateTo(fmt(now)) }
  }

  useEffect(() => { load() }, [activeCountry, dateFrom, dateTo])

  async function load() {
    setLoading(true)
    const cf = activeCountry !== 'All' ? activeCountry : null
    const flt = q => cf ? q.eq('country', cf) : q

    let tyreQ = supabase.from('tyre_records').select(
      'id,cost_per_tyre,brand,issue_date,risk_level,site,category,asset_no'
    )
    if (cf) tyreQ = tyreQ.eq('country', cf)
    if (dateFrom) tyreQ = tyreQ.gte('issue_date', dateFrom)
    if (dateTo)   tyreQ = tyreQ.lte('issue_date', dateTo)

    const [tyreRes, stockRes, actionRes, recentRes, openActRes] = await Promise.all([
      tyreQ,
      flt(supabase.from('stock_records').select('id', { count: 'exact' })),
      flt(supabase.from('corrective_actions').select('id,status', { count: 'exact' })),
      flt(supabase.from('tyre_records')
        .select('id,issue_date,brand,asset_no,site,risk_level')
        .order('created_at', { ascending: false }).limit(8)),
      flt(supabase.from('corrective_actions')
        .select('id,title,priority,site,status')
        .eq('status', 'Open').order('created_at', { ascending: false }).limit(8)),
    ])

    setRawTyres(tyreRes.data ?? [])
    setRawStock(stockRes.data ?? [])
    setRawActions(actionRes.data ?? [])
    setLoading(false)
    // Keep recent / open actions live (no date filter needed for these)
    setRecentRecords(recentRes.data ?? [])
    setOpenActions(openActRes.data ?? [])
  }

  const [recentRecords, setRecentRecords] = useState([])
  const [openActions, setOpenActions]     = useState([])

  // ── Client-side search filter (instant, no re-fetch) ──────────────────────
  const tyres = useMemo(() => {
    if (!search) return rawTyres
    const q = search.toLowerCase()
    return rawTyres.filter(t =>
      t.asset_no?.toLowerCase().includes(q) ||
      t.brand?.toLowerCase().includes(q) ||
      t.site?.toLowerCase().includes(q) ||
      t.category?.toLowerCase().includes(q)
    )
  }, [rawTyres, search])

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const cost = tyres.reduce((s, t) => s + recordCost(t), 0)
    const crit = tyres.filter(isHigh).length
    const open = (rawActions ?? []).filter(a => a.status === 'Open').length
    return { tyres: tyres.length, stock: rawStock.length, actions: open, critical: crit, cost }
  }, [tyres, rawActions, rawStock])

  // ── Fleet health, seasonal trends, tyre life ──────────────────────────────
  const fleetHealthScore = useMemo(() => computeFleetHealthScore(tyres), [tyres])
  const seasonalTrends   = useMemo(() => computeSeasonalTrends(tyres), [tyres])
  const tyreLife         = useMemo(() => computeTyreLifeAnalysis(tyres), [tyres])

  // ── Seasonal trends bar chart data ────────────────────────────────────────
  const seasonalBarData = useMemo(() => ({
    labels: seasonalTrends.map(d => d.month),
    datasets: [{
      label: 'Tyre Issues',
      data: seasonalTrends.map(d => d.count),
      backgroundColor: seasonalTrends.map(d =>
        d.highRiskRate > 0.3 ? 'rgba(239,68,68,0.7)' :
        d.highRiskRate > 0.15 ? 'rgba(245,158,11,0.7)' : 'rgba(59,130,246,0.6)'
      ),
      borderRadius: 3,
    }],
  }), [seasonalTrends])

  // ── Risk trend (this month vs last) ─────────────────────────────────────
  const riskTrend = useMemo(() => {
    const now  = new Date()
    const thisM = { y: now.getFullYear(), m: now.getMonth() + 1 }
    const lastM = now.getMonth() === 0
      ? { y: now.getFullYear() - 1, m: 12 }
      : { y: now.getFullYear(), m: now.getMonth() }
    const thisHigh = tyres.filter(t => inMonth(t, thisM.y, thisM.m) && isHigh(t)).length
    const lastHigh = tyres.filter(t => inMonth(t, lastM.y, lastM.m) && isHigh(t)).length
    return { delta: thisHigh - lastHigh, lastHigh }
  }, [tyres])

  // ── Monthly count chart (last 12 months) ─────────────────────────────────
  const monthlyData = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
      return { label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), y: d.getFullYear(), m: d.getMonth() + 1 }
    })
    return {
      labels: months.map(m => m.label),
      datasets: [
        { label: 'All', data: months.map(({ y, m }) => tyres.filter(t => inMonth(t, y, m)).length), backgroundColor: '#3b82f6', borderRadius: 3 },
        { label: 'High Risk', data: months.map(({ y, m }) => tyres.filter(t => inMonth(t, y, m) && isHigh(t)).length), backgroundColor: '#ef4444', borderRadius: 3 },
      ],
    }
  }, [tyres])

  // ── Monthly cost chart (last 12 months) ─────────────────────────────────
  const monthlyCostData = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
      return { label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), y: d.getFullYear(), m: d.getMonth() + 1 }
    })
    return {
      labels: months.map(m => m.label),
      datasets: [{
        label: `Cost (${activeCurrency})`,
        data: months.map(({ y, m }) =>
          Math.round(tyres.filter(t => inMonth(t, y, m)).reduce((s, t) => s + recordCost(t), 0))
        ),
        borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)',
        fill: true, tension: 0.4, pointRadius: 3,
      }],
    }
  }, [tyres, activeCurrency])

  // ── Brand doughnut ────────────────────────────────────────────────────────
  const brandData = useMemo(() => {
    const m = {}
    tyres.forEach(t => { if (t.brand) m[t.brand] = (m[t.brand] ?? 0) + 1 })
    const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 7)
    if (!top.length) return null
    return {
      labels: top.map(([b]) => b),
      datasets: [{ data: top.map(([, c]) => c), backgroundColor: ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316'], borderWidth: 0 }],
    }
  }, [tyres])

  // ── Category doughnut ─────────────────────────────────────────────────────
  const categoryData = useMemo(() => {
    const m = {}
    tyres.forEach(t => { if (t.category) m[t.category] = (m[t.category] ?? 0) + 1 })
    const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (!top.length) return null
    return {
      labels: top.map(([c]) => c),
      datasets: [{ data: top.map(([, n]) => n), backgroundColor: ['#ef4444','#f97316','#f59e0b','#84cc16','#06b6d4','#8b5cf6','#ec4899','#3b82f6'], borderWidth: 0 }],
    }
  }, [tyres])

  // ── Risk distribution bar ─────────────────────────────────────────────────
  const riskDistData = useMemo(() => {
    const levels = ['Critical', 'High', 'Medium', 'Low', 'Unknown']
    const counts = Object.fromEntries(levels.map(l => [l, 0]))
    tyres.forEach(t => { const k = t.risk_level ?? 'Unknown'; if (counts[k] !== undefined) counts[k]++ })
    return {
      labels: levels,
      datasets: [{
        data: levels.map(l => counts[l]),
        backgroundColor: ['#dc2626','#ea580c','#ca8a04','#16a34a','#6b7280'],
        borderRadius: 4,
      }],
    }
  }, [tyres])

  // ── Top assets by cost ────────────────────────────────────────────────────
  const topAssetsData = useMemo(() => {
    const m  = {}
    tyres.forEach(t => {
      if (!t.asset_no) return
      m[t.asset_no] = (m[t.asset_no] ?? 0) + recordCost(t)
    })
    const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10)
    if (!top.length) return null
    return {
      labels: top.map(([a]) => a),
      datasets: [{
        data: top.map(([, c]) => Math.round(c)),
        backgroundColor: '#7c3aed', borderRadius: 4,
      }],
    }
  }, [tyres])

  // ── Top sites by cost ─────────────────────────────────────────────────────
  const siteCostData = useMemo(() => {
    const m  = {}
    tyres.forEach(t => { if (t.site) m[t.site] = (m[t.site] ?? 0) + recordCost(t) })
    const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (!top.length) return null
    return {
      labels: top.map(([s]) => s),
      datasets: [{ label: `Cost (${activeCurrency})`, data: top.map(([, c]) => Math.round(c)), backgroundColor: '#7c3aed', borderRadius: 4 }],
    }
  }, [tyres, activeCurrency])

  // ── Exports ───────────────────────────────────────────────────────────────
  function handleExcelExport() {
    const rows = tyres.map(t => ({
      ...t,
      cost_per_tyre: t.cost_per_tyre || 0,
      total_cost: recordCost(t),
    }))
    exportToExcel(
      rows,
      ['issue_date','asset_no','brand','site','category','risk_level','cost_per_tyre'],
      ['Date','Asset No','Brand','Site','Category','Risk Level',`Cost (${activeCurrency})`],
      `TyrePulse_Dashboard_${new Date().toISOString().slice(0,10)}`,
      'Dashboard'
    )
  }

  function handlePdfExport() {
    exportToPdf(
      tyres.slice(0, 200).map(t => ({ ...t, cost_per_tyre: t.cost_per_tyre || 0 })),
      [
        { key: 'issue_date', header: 'Date', width: 24 },
        { key: 'asset_no',   header: 'Asset No', width: 28 },
        { key: 'brand',      header: 'Brand', width: 24 },
        { key: 'site',       header: 'Site', width: 30 },
        { key: 'category',   header: 'Category', width: 32 },
        { key: 'risk_level', header: 'Risk', width: 20 },
        { key: 'cost_per_tyre', header: `Cost (${activeCurrency})`, width: 24 },
      ],
      `TyrePulse Dashboard Report — ${new Date().toLocaleDateString()}`,
      `TyrePulse_Dashboard_${new Date().toISOString().slice(0,10)}`,
      'landscape'
    )
  }

  async function handlePptxExport() {
    const [tyreRes, actionRes] = await Promise.all([
      supabase.from('tyre_records').select('site,category,risk_level,cost_per_tyre,issue_date,brand'),
      supabase.from('corrective_actions').select('title,priority,site,status').eq('status','Open').order('created_at',{ascending:false}).limit(20),
    ])
    const all = tyreRes.data ?? []
    const now = new Date()
    const countBy = (arr, key) => { const m={}; arr.forEach(t=>{if(t[key]) m[t[key]]=(m[t[key]]??0)+1}); return Object.entries(m).sort((a,b)=>b[1]-a[1]) }
    const sumBy   = (arr, key) => { const m={}; arr.forEach(t=>{if(t[key]) m[t[key]]=(m[t[key]]??0)+recordCost(t)}); return Object.entries(m).sort((a,b)=>b[1]-a[1]) }
    const riskCounts = { Critical:0, High:0, Medium:0, Low:0 }
    all.forEach(t=>{ if(t.risk_level && riskCounts[t.risk_level]!==undefined) riskCounts[t.risk_level]++ })
    const monthlyTrend = Array.from({length:6},(_,i)=>{
      const d = new Date(now.getFullYear(), now.getMonth()-5+i, 1)
      const count = all.filter(t=>{ if(!t.issue_date) return false; const td=new Date(t.issue_date); return td.getFullYear()===d.getFullYear()&&td.getMonth()===d.getMonth() }).length
      return { month: d.toLocaleString('default',{month:'short',year:'2-digit'}), count }
    })
    await exportToPptx({
      totalTyres: all.length, totalCost: all.reduce((s,t)=>s+recordCost(t),0),
      openActions: (actionRes.data??[]).length, highRisk: all.filter(t=>t.risk_level==='Critical'||t.risk_level==='High').length,
      topSites: sumBy(all,'site').slice(0,12).map(([site,count])=>({site,count})),
      categoryBreakdown: countBy(all,'category').map(([category,count])=>({category,count})),
      riskBreakdown: Object.entries(riskCounts).map(([level,count])=>({level,count})),
      monthlyTrend, recentActions: actionRes.data??[],
      period: now.toLocaleString('default',{month:'long',year:'numeric'}),
      company: appSettings.company_name||'TyrePulse',
    }, `TyrePulse_Report_${now.toISOString().slice(0,10)}`)
  }

  const riskBadge     = l => ({ Critical:'bg-red-900/50 text-red-300', High:'bg-orange-900/50 text-orange-300', Medium:'bg-yellow-900/50 text-yellow-300', Low:'bg-green-900/50 text-green-300' }[l] ?? 'bg-gray-800 text-gray-400')
  const priorityBadge = p => ({ High:'bg-red-900/50 text-red-300', Medium:'bg-yellow-900/50 text-yellow-300', Low:'bg-blue-900/50 text-blue-300' }[p] ?? 'bg-gray-800 text-gray-400')

  const TrendIcon = riskTrend?.delta > 0 ? TrendingUp : riskTrend?.delta < 0 ? TrendingDown : Minus
  const trendCol  = riskTrend?.delta > 0 ? 'text-red-400' : riskTrend?.delta < 0 ? 'text-green-400' : 'text-gray-500'

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 rounded-full border-2 border-gray-700 border-t-blue-500" /></div>

  return (
    <div className="space-y-6">

      {/* Header + filters + exports */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">Welcome back, {profile?.full_name ?? profile?.username ?? 'there'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleExcelExport} className="btn-secondary flex items-center gap-1.5 text-sm">
              <FileSpreadsheet size={14} className="text-green-400" /> Excel
            </button>
            <button onClick={handlePdfExport} className="btn-secondary flex items-center gap-1.5 text-sm">
              <FileText size={14} className="text-red-400" /> PDF
            </button>
            <button onClick={handlePptxExport} className="btn-secondary flex items-center gap-1.5 text-sm">
              <Presentation size={14} className="text-orange-400" /> PowerPoint
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="card py-3 space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-48">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className="input pl-8 w-full"
                placeholder="Search asset, brand, site, category…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Date range */}
            <div className="flex items-center gap-2 flex-wrap">
              <Calendar size={14} className="text-gray-500 flex-shrink-0" />
              <input type="date" className="input w-36 text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-gray-600 text-sm">→</span>
              <input type="date" className="input w-36 text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-gray-500 hover:text-gray-300" title="Clear dates">
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Date presets */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-600 mr-1">Quick:</span>
            {[
              { id: '7d',  label: '7 Days' },
              { id: '30d', label: '30 Days' },
              { id: '3m',  label: '3 Months' },
              { id: '6m',  label: '6 Months' },
              { id: 'ytd', label: 'YTD' },
              { id: 'all', label: 'All Time' },
            ].map(({ id, label }) => {
              const isActive = id === 'all' ? (!dateFrom && !dateTo) : false
              return (
                <button
                  key={id}
                  onClick={() => applyPreset(id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                    isActive
                      ? 'border-green-600 text-green-400'
                      : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                  }`}
                  style={isActive ? { backgroundColor: 'rgba(22,163,74,0.08)' } : {}}
                >
                  {label}
                </button>
              )
            })}
            {(search || dateFrom || dateTo) && (
              <p className="text-xs text-green-500 ml-auto">
                {tyres.length.toLocaleString()} of {rawTyres.length.toLocaleString()} records
              </p>
            )}
          </div>
        </div>
      </div>

      {/* KPI stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard label="Tyre Records"  value={stats.tyres.toLocaleString()}                               icon={CircleDot}    color="blue" />
        <StatCard label="Stock Sites"   value={stats.stock.toLocaleString()}                               icon={Package}      color="green" />
        <StatCard label="Open Actions"  value={stats.actions.toLocaleString()}                             icon={ClipboardList} color="yellow" />
        <StatCard
          label="High Risk"
          value={`${stats.critical.toLocaleString()} (${stats.tyres ? ((stats.critical / stats.tyres) * 100).toFixed(1) : 0}%)`}
          icon={AlertTriangle} color="red"
        />
        <StatCard label="Total Cost"    value={`${activeCurrency} ${(stats.cost / 1000).toFixed(0)}K`}    icon={DollarSign}   color="purple" />
      </div>

      {/* Fleet intelligence row: Health Score + Avg Tyre Life */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Fleet Health Score */}
        <div className="card text-center col-span-1">
          <div className={`text-4xl font-bold mb-1 ${
            fleetHealthScore >= 70 ? 'text-green-400' :
            fleetHealthScore >= 40 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {fleetHealthScore}
          </div>
          <p className="text-gray-400 text-sm flex items-center justify-center gap-1">
            <Activity size={13} /> Fleet Health Score
          </p>
          <p className={`text-xs mt-1 ${
            fleetHealthScore >= 70 ? 'text-green-500' :
            fleetHealthScore >= 40 ? 'text-yellow-500' : 'text-red-500'
          }`}>
            {fleetHealthScore >= 70 ? 'Good' : fleetHealthScore >= 40 ? 'Moderate' : 'At Risk'}
          </p>
        </div>

        {/* Avg Tyre Life */}
        <div className="card text-center col-span-1">
          <div className="text-4xl font-bold mb-1 text-blue-400">
            {tyreLife?.avgLifeDays != null ? tyreLife.avgLifeDays : '—'}
          </div>
          <p className="text-gray-400 text-sm flex items-center justify-center gap-1">
            <Clock size={13} /> Avg Tyre Life (days)
          </p>
          {tyreLife?.avgLifeKm != null && (
            <p className="text-xs mt-1 text-gray-500">{tyreLife.avgLifeKm.toLocaleString()} km avg</p>
          )}
        </div>

        {/* Seasonal Trends mini chart */}
        <div className="card col-span-2">
          <h2 className="text-sm font-semibold text-white mb-3">Seasonal Tyre Issues (by Month)</h2>
          <div className="h-28">
            <Bar data={seasonalBarData} options={{
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: '#6b7280', font: { size: 9 } }, grid: { display: false } },
                y: { ticks: { color: '#6b7280', font: { size: 9 } }, grid: { color: '#1f2937' } },
              },
            }} />
          </div>
        </div>
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

      {/* Row 1: Monthly count + Brand doughnut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2"><TrendingUp size={16} /> Monthly Tyre Issues (12 months)</h2>
          <div className="h-56">
            <Bar data={monthlyData} options={{ ...BASE_OPTS, plugins: { ...BASE_OPTS.plugins, legend: { labels: { color: '#9ca3af', boxWidth: 10 } } } }} />
          </div>
        </div>
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Brand Breakdown</h2>
          <div className="h-56 flex items-center justify-center">
            {brandData ? <Doughnut data={brandData} options={NO_SCALE} /> : <p className="text-gray-500 text-sm">No data</p>}
          </div>
        </div>
      </div>

      {/* Row 2: Monthly Cost trend (line) */}
      <div className="card">
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <DollarSign size={16} /> Monthly Cost Trend — {activeCurrency}
        </h2>
        <div className="h-52">
          <Line data={monthlyCostData} options={{
            ...BASE_OPTS,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: TICK, grid: GRID },
              y: { ticks: { ...TICK, callback: v => `${activeCurrency} ${(v/1000).toFixed(0)}K` }, grid: GRID },
            },
          }} />
        </div>
      </div>

      {/* Row 3: Risk distribution + Category mix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Risk Level Distribution</h2>
          <div className="h-52">
            <Bar data={riskDistData} options={{
              ...H_BAR,
              scales: {
                x: { ticks: TICK, grid: GRID },
                y: { ticks: { color: '#9ca3af' }, grid: GRID },
              },
            }} />
          </div>
        </div>
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Failure Category Mix</h2>
          <div className="h-52 flex items-center justify-center">
            {categoryData
              ? <Doughnut data={categoryData} options={NO_SCALE} />
              : <p className="text-gray-500 text-sm">No classified records — run Data Cleaning to populate</p>}
          </div>
        </div>
      </div>

      {/* Row 4: Top Assets by Cost + Top Sites by Spend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Top 10 Assets by Spend ({activeCurrency})</h2>
          <div className="h-64">
            {topAssetsData
              ? <Bar data={topAssetsData} options={{
                  ...H_BAR,
                  scales: {
                    x: { ticks: { ...TICK, callback: v => `${(v/1000).toFixed(0)}K` }, grid: GRID },
                    y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: GRID },
                  },
                }} />
              : <p className="text-gray-500 text-sm">No asset data</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-base font-semibold text-white mb-4">Top Sites by Spend ({activeCurrency})</h2>
          <div className="h-64">
            {siteCostData
              ? <Bar data={siteCostData} options={{
                  ...H_BAR,
                  scales: {
                    x: { ticks: { ...TICK, callback: v => `${(v/1000).toFixed(0)}K` }, grid: GRID },
                    y: { ticks: { color: '#9ca3af' }, grid: GRID },
                  },
                }} />
              : <p className="text-gray-500 text-sm">No data</p>}
          </div>
        </div>
      </div>

      {/* Row 5: Recent records + Open actions */}
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
