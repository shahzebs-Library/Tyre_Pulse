import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { applyCountry } from '../lib/countryFilter'
import StatCard from '../components/StatCard'
import { exportToPptx, exportToExcel, exportToPdf, exportDailyExecutivePdf } from '../lib/exportUtils'
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
  Bell, Upload, ClipboardCheck, Maximize2, Zap, ChevronRight,
  BarChart2, Shield, Cpu, ArrowUpRight,
} from 'lucide-react'
import { ChartModal } from '../components/ChartModal'
import EmptyState from '../components/EmptyState'
import LoadingState from '../components/LoadingState'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
  ArcElement, LineElement, PointElement, Filler,
)

const GRID   = { color: 'rgba(255,255,255,0.04)' }
const TICK   = { color: '#4b5563', font: { size: 11 } }
const LEGEND = { labels: { color: '#6b7280', boxWidth: 10, font: { size: 11 } } }

const BASE_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: LEGEND },
  scales: { x: { ticks: TICK, grid: GRID }, y: { ticks: TICK, grid: GRID } },
}
const NO_SCALE = { ...BASE_OPTS, scales: undefined, plugins: { legend: { ...LEGEND, position: 'right' } } }
const H_BAR    = { ...BASE_OPTS, indexAxis: 'y', plugins: { legend: { display: false } } }

function inMonth(t, y, m) {
  if (!t.issue_date) return false
  const d = new Date(t.issue_date)
  return d.getFullYear() === y && d.getMonth() + 1 === m
}
function isHigh(t) { return t.risk_level === 'Critical' || t.risk_level === 'High' }

/* ── Health Ring ─────────────────────────────────────────────────────────── */
function HealthRing({ score }) {
  const r = 38
  const circ = 2 * Math.PI * r
  const pct  = Math.min(Math.max(score, 0), 100)
  const dash = (pct / 100) * circ
  const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444'
  const label = pct >= 70 ? 'Good' : pct >= 40 ? 'Moderate' : 'At Risk'

  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <div className="relative w-24 h-24">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
          <motion.circle
            cx="48" cy="48" r={r} fill="none"
            stroke={color} strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${circ}`}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: circ - dash }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-white leading-none">{score}</span>
          <span className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">/ 100</span>
        </div>
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{label}</span>
      <span className="text-[10px] text-gray-600">Fleet Health</span>
    </div>
  )
}

/* ── Chart Panel ─────────────────────────────────────────────────────────── */
function ChartPanel({ title, subtitle, icon: Icon, onExpand, children, className = '' }) {
  return (
    <div className={`card group ${className}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)' }}>
              <Icon size={14} className="text-green-400" />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-white leading-none">{title}</h3>
            {subtitle && <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {onExpand && (
          <button
            onClick={onExpand}
            className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded-md text-gray-600 hover:text-white hover:bg-white/5"
          >
            <Maximize2 size={12} />
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

/* ── Quick Action Tile ───────────────────────────────────────────────────── */
function ActionTile({ to, icon: Icon, label, color, bg, border }) {
  return (
    <Link to={to}>
      <motion.div
        className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer"
        style={{ background: bg, border: `1px solid ${border}`, color }}
        whileHover={{ scale: 1.03, y: -1 }}
        whileTap={{ scale: 0.97 }}
      >
        <Icon size={14} />
        <span className="whitespace-nowrap">{label}</span>
        <ArrowUpRight size={11} className="ml-auto opacity-50" />
      </motion.div>
    </Link>
  )
}

/* ── Risk Badge ──────────────────────────────────────────────────────────── */
function RiskBadge({ level }) {
  const styles = {
    Critical: 'bg-red-500/15 text-red-300 border-red-500/25',
    High:     'bg-orange-500/15 text-orange-300 border-orange-500/25',
    Medium:   'bg-yellow-500/15 text-yellow-300 border-yellow-500/25',
    Low:      'bg-green-500/15 text-green-300 border-green-500/25',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${styles[level] ?? 'bg-gray-800/60 text-gray-400 border-gray-700/40'}`}>
      {level ?? 'Unknown'}
    </span>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
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
  const [dateShortcut, setDateShortcut] = useState('This Month')
  const [showCustom, setShowCustom]   = useState(false)
  const [granularity, setGranularity] = useState('monthly')
  const [recentRecords, setRecentRecords] = useState([])
  const [openActions, setOpenActions]     = useState([])
  const [expandedChart, setExpandedChart] = useState(null)

  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`

  function applyShortcut(label) {
    const now = new Date(); const today = fmt(now); let from, to
    if (label === 'Today')       { from = today; to = today }
    else if (label === 'Yesterday') { const y = new Date(now); y.setDate(y.getDate()-1); from = fmt(y); to = fmt(y) }
    else if (label === 'This Week') { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); from = fmt(d); to = today }
    else if (label === 'This Month') { from = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`; to = today }
    else if (label === 'Last Month') {
      const lm = new Date(now.getFullYear(), now.getMonth()-1, 1)
      const lme = new Date(now.getFullYear(), now.getMonth(), 0)
      from = fmt(lm); to = fmt(lme)
    } else if (label === 'This Year') { from = `${now.getFullYear()}-01-01`; to = today }
    if (label !== 'Custom') { setDateFrom(from); setDateTo(to) }
    setDateShortcut(label); setShowCustom(label === 'Custom')
  }

  useEffect(() => { applyShortcut('This Month') }, [])
  useEffect(() => { load() }, [activeCountry, dateFrom, dateTo])

  // Refresh when the user returns to the tab (e.g. after uploading data),
  // so newly-added records appear without changing filters.
  useEffect(() => {
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountry, dateFrom, dateTo])

  async function load() {
    setLoading(true)
    // Null-safe country filter: never silently drop uncategorised rows.
    const flt = q => applyCountry(q, activeCountry)
    let tyreQ = applyCountry(
      supabase.from('tyre_records').select('id,cost_per_tyre,brand,issue_date,risk_level,site,category,asset_no'),
      activeCountry,
    )
    if (dateFrom) tyreQ = tyreQ.gte('issue_date', dateFrom)
    if (dateTo)   tyreQ = tyreQ.lte('issue_date', dateTo)
    const [tyreRes, stockRes, actionRes, recentRes, openActRes] = await Promise.all([
      tyreQ,
      flt(supabase.from('stock_records').select('id', { count: 'exact' })),
      flt(supabase.from('corrective_actions').select('id,status', { count: 'exact' })),
      flt(supabase.from('tyre_records').select('id,issue_date,brand,asset_no,site,risk_level').order('created_at', { ascending: false }).limit(8)),
      flt(supabase.from('corrective_actions').select('id,title,priority,site,status').eq('status','Open').order('created_at', { ascending: false }).limit(8)),
    ])
    setRawTyres(tyreRes.data ?? [])
    setRawStock(stockRes.data ?? [])
    setRawActions(actionRes.data ?? [])
    setRecentRecords(recentRes.data ?? [])
    setOpenActions(openActRes.data ?? [])
    setLoading(false)
  }

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

  const stats = useMemo(() => {
    const cost = tyres.reduce((s, t) => s + recordCost(t), 0)
    const crit = tyres.filter(isHigh).length
    const open = (rawActions ?? []).filter(a => a.status === 'Open').length
    return { tyres: tyres.length, stock: rawStock.length, actions: open, critical: crit, cost }
  }, [tyres, rawActions, rawStock])

  const fleetHealthScore = useMemo(() => computeFleetHealthScore(tyres), [tyres])
  const seasonalTrends   = useMemo(() => computeSeasonalTrends(tyres), [tyres])
  const tyreLife         = useMemo(() => computeTyreLifeAnalysis(tyres), [tyres])

  const seasonalBarData = useMemo(() => ({
    labels: seasonalTrends.map(d => d.month),
    datasets: [{
      label: 'Tyre Issues', data: seasonalTrends.map(d => d.count),
      backgroundColor: seasonalTrends.map(d =>
        d.highRiskRate > 0.3 ? 'rgba(239,68,68,0.65)' :
        d.highRiskRate > 0.15 ? 'rgba(245,158,11,0.65)' : 'rgba(59,130,246,0.6)'
      ),
      borderRadius: 5,
    }],
  }), [seasonalTrends])

  const riskTrend = useMemo(() => {
    const now = new Date()
    const thisM = { y: now.getFullYear(), m: now.getMonth() + 1 }
    const lastM = now.getMonth() === 0 ? { y: now.getFullYear() - 1, m: 12 } : { y: now.getFullYear(), m: now.getMonth() }
    const thisHigh = tyres.filter(t => inMonth(t, thisM.y, thisM.m) && isHigh(t)).length
    const lastHigh = tyres.filter(t => inMonth(t, lastM.y, lastM.m) && isHigh(t)).length
    return { delta: thisHigh - lastHigh, lastHigh }
  }, [tyres])

  const periodChartData = useMemo(() => {
    const now = new Date()
    if (granularity === 'daily') {
      const days = []
      for (let i = 29; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days.push(fmt(d)) }
      return {
        labels: days.map(d => { const [, m, dy] = d.split('-'); return `${dy}/${m}` }),
        datasets: [
          { label: 'All',       data: days.map(day => tyres.filter(t => t.issue_date?.slice(0,10) === day).length), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
          { label: 'High Risk', data: days.map(day => tyres.filter(t => t.issue_date?.slice(0,10) === day && isHigh(t)).length), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 },
        ],
      }
    }
    if (granularity === 'weekly') {
      const weeks = []
      for (let i = 12; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i * 7)
        const weekNum = Math.ceil((((d - new Date(d.getFullYear(),0,1))/86400000)+1)/7)
        const key = `W${weekNum} ${d.getFullYear()}`
        if (!weeks.find(w => w.key === key)) weeks.push({ key })
      }
      return {
        labels: weeks.map(w => w.key),
        datasets: [
          { label: 'All', data: weeks.map(({ key }) => { let n=0; tyres.forEach(t => { if (!t.issue_date) return; const d=new Date(t.issue_date); const wn=Math.ceil((((d-new Date(d.getFullYear(),0,1))/86400000)+1)/7); if(`W${wn} ${d.getFullYear()}`===key) n++ }); return n }), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
          { label: 'High Risk', data: weeks.map(({ key }) => { let n=0; tyres.forEach(t => { if (!t.issue_date||!isHigh(t)) return; const d=new Date(t.issue_date); const wn=Math.ceil((((d-new Date(d.getFullYear(),0,1))/86400000)+1)/7); if(`W${wn} ${d.getFullYear()}`===key) n++ }); return n }), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 },
        ],
      }
    }
    if (granularity === 'yearly') {
      const years = []; for (let i = 4; i >= 0; i--) years.push(now.getFullYear() - i)
      return {
        labels: years.map(String),
        datasets: [
          { label: 'All',       data: years.map(y => tyres.filter(t => t.issue_date?.slice(0,4) === String(y)).length), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
          { label: 'High Risk', data: years.map(y => tyres.filter(t => t.issue_date?.slice(0,4) === String(y) && isHigh(t)).length), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 },
        ],
      }
    }
    const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return { label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), y: d.getFullYear(), m: d.getMonth() + 1 } })
    return {
      labels: months.map(m => m.label),
      datasets: [
        { label: 'All',       data: months.map(({ y, m }) => tyres.filter(t => inMonth(t, y, m)).length), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
        { label: 'High Risk', data: months.map(({ y, m }) => tyres.filter(t => inMonth(t, y, m) && isHigh(t)).length), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 },
      ],
    }
  }, [tyres, granularity])

  const monthlyCostData = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return { label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), y: d.getFullYear(), m: d.getMonth() + 1 } })
    return {
      labels: months.map(m => m.label),
      datasets: [{
        label: `Cost (${activeCurrency})`,
        data: months.map(({ y, m }) => Math.round(tyres.filter(t => inMonth(t, y, m)).reduce((s, t) => s + recordCost(t), 0))),
        borderColor: '#22c55e',
        backgroundColor: 'rgba(22,163,74,0.08)',
        fill: true, tension: 0.45, pointRadius: 4,
        pointBackgroundColor: '#22c55e',
        pointBorderColor: '#052e16',
        pointHoverRadius: 6,
        borderWidth: 2,
      }],
    }
  }, [tyres, activeCurrency])

  const brandData = useMemo(() => {
    const m = {}; tyres.forEach(t => { if (t.brand) m[t.brand] = (m[t.brand] ?? 0) + 1 })
    const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 7)
    if (!top.length) return null
    return { labels: top.map(([b]) => b), datasets: [{ data: top.map(([, c]) => c), backgroundColor: ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316'], borderWidth: 0, hoverOffset: 6 }] }
  }, [tyres])

  const categoryData = useMemo(() => {
    const m = {}; tyres.forEach(t => { if (t.category) m[t.category] = (m[t.category] ?? 0) + 1 })
    const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (!top.length) return null
    return { labels: top.map(([c]) => c), datasets: [{ data: top.map(([, n]) => n), backgroundColor: ['#ef4444','#f97316','#f59e0b','#84cc16','#06b6d4','#8b5cf6','#ec4899','#3b82f6'], borderWidth: 0, hoverOffset: 6 }] }
  }, [tyres])

  const riskDistData = useMemo(() => {
    const levels = ['Critical', 'High', 'Medium', 'Low', 'Unknown']
    const counts = Object.fromEntries(levels.map(l => [l, 0]))
    tyres.forEach(t => { const k = t.risk_level ?? 'Unknown'; if (counts[k] !== undefined) counts[k]++ })
    return { labels: levels, datasets: [{ data: levels.map(l => counts[l]), backgroundColor: ['#dc2626','#ea580c','#ca8a04','#16a34a','#374151'], borderRadius: 6, borderSkipped: false }] }
  }, [tyres])

  const topAssetsData = useMemo(() => {
    const m = {}; tyres.forEach(t => { if (!t.asset_no) return; m[t.asset_no] = (m[t.asset_no] ?? 0) + recordCost(t) })
    const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10)
    if (!top.length) return null
    return { labels: top.map(([a]) => a), datasets: [{ data: top.map(([, c]) => Math.round(c)), backgroundColor: 'rgba(124,58,237,0.75)', borderRadius: 5, borderSkipped: false }] }
  }, [tyres])

  const siteCostData = useMemo(() => {
    const m = {}; tyres.forEach(t => { if (t.site) m[t.site] = (m[t.site] ?? 0) + recordCost(t) })
    const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (!top.length) return null
    return { labels: top.map(([s]) => s), datasets: [{ label: `Cost (${activeCurrency})`, data: top.map(([, c]) => Math.round(c)), backgroundColor: 'rgba(6,182,212,0.75)', borderRadius: 5, borderSkipped: false }] }
  }, [tyres, activeCurrency])

  const forecastData = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1); return { y: d.getFullYear(), m: d.getMonth() + 1, label: d.toLocaleString('default', { month: 'short' }) } })
    const monthlyCounts = months.map(({ y, m }) => rawTyres.filter(t => inMonth(t, y, m)).length)
    const last3 = monthlyCounts.slice(3); const avg = last3.reduce((s, v) => s + v, 0) / 3
    const nonZeroMonths = last3.filter(v => v > 0).length
    let confidence = 'Low'
    if (nonZeroMonths >= 3) { const mean = avg; const stdDev = Math.sqrt(last3.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / 3); const cv = mean > 0 ? (stdDev / mean) * 100 : 100; confidence = cv < 20 ? 'High' : 'Medium' }
    else if (nonZeroMonths >= 1) { confidence = 'Medium' }
    return {
      forecastThisMonth: Math.round(avg), forecastNextMonth: Math.round(avg), confidence, nonZeroMonths,
      chartLabels: [...months.slice(3).map(m => m.label), 'This Month', 'Next Month'],
      actualData: [...last3, null, null],
      projectedData: [null, null, null, Math.round(avg), Math.round(avg)],
    }
  }, [rawTyres])

  function handleExcelExport() {
    exportToExcel(tyres.map(t => ({ ...t, cost_per_tyre: t.cost_per_tyre||0, total_cost: recordCost(t) })),
      ['issue_date','asset_no','brand','site','category','risk_level','cost_per_tyre'],
      ['Date','Asset No','Brand','Site','Category','Risk Level',`Cost (${activeCurrency})`],
      `TyrePulse_Dashboard_${new Date().toISOString().slice(0,10)}`, 'Dashboard')
  }
  function handlePdfExport() {
    exportToPdf(tyres.slice(0, 200).map(t => ({ ...t, cost_per_tyre: t.cost_per_tyre||0 })),
      [{ key:'issue_date',header:'Date',width:24 },{ key:'asset_no',header:'Asset No',width:28 },{ key:'brand',header:'Brand',width:24 },{ key:'site',header:'Site',width:30 },{ key:'category',header:'Category',width:32 },{ key:'risk_level',header:'Risk',width:20 },{ key:'cost_per_tyre',header:`Cost (${activeCurrency})`,width:24 }],
      `TyrePulse Dashboard Report · ${new Date().toLocaleDateString()}`,
      `TyrePulse_Dashboard_${new Date().toISOString().slice(0,10)}`, 'landscape')
  }
  async function handlePptxExport() {
    const [tyreRes, actionRes] = await Promise.all([
      supabase.from('tyre_records').select('site,category,risk_level,cost_per_tyre,issue_date,brand'),
      supabase.from('corrective_actions').select('title,priority,site,status').eq('status','Open').order('created_at',{ascending:false}).limit(20),
    ])
    const all = tyreRes.data ?? []; const now = new Date()
    const countBy = (arr, key) => { const m={}; arr.forEach(t=>{if(t[key]) m[t[key]]=(m[t[key]]??0)+1}); return Object.entries(m).sort((a,b)=>b[1]-a[1]) }
    const sumBy   = (arr, key) => { const m={}; arr.forEach(t=>{if(t[key]) m[t[key]]=(m[t[key]]??0)+recordCost(t)}); return Object.entries(m).sort((a,b)=>b[1]-a[1]) }
    const riskCounts = { Critical:0, High:0, Medium:0, Low:0 }
    all.forEach(t=>{ if(t.risk_level && riskCounts[t.risk_level]!==undefined) riskCounts[t.risk_level]++ })
    const monthlyTrend = Array.from({length:6},(_,i)=>{ const d = new Date(now.getFullYear(), now.getMonth()-5+i, 1); const count = all.filter(t=>{ if(!t.issue_date) return false; const td=new Date(t.issue_date); return td.getFullYear()===d.getFullYear()&&td.getMonth()===d.getMonth() }).length; return { month: d.toLocaleString('default',{month:'short',year:'2-digit'}), count } })
    await exportToPptx({ totalTyres: all.length, totalCost: all.reduce((s,t)=>s+recordCost(t),0), openActions: (actionRes.data??[]).length, highRisk: all.filter(t=>t.risk_level==='Critical'||t.risk_level==='High').length, topSites: sumBy(all,'site').slice(0,12).map(([site,count])=>({site,count})), categoryBreakdown: countBy(all,'category').map(([category,count])=>({category,count})), riskBreakdown: Object.entries(riskCounts).map(([level,count])=>({level,count})), monthlyTrend, recentActions: actionRes.data??[], period: now.toLocaleString('default',{month:'long',year:'numeric'}), company: appSettings.company_name||'TyrePulse' }, `TyrePulse_Report_${now.toISOString().slice(0,10)}`)
  }

  async function handleDailyReportExport() {
    const now = new Date()
    const [tyreRes, actionRes, inspRes] = await Promise.all([
      supabase.from('tyre_records').select('site,category,risk_level,cost_per_tyre,issue_date,brand,asset_no'),
      supabase.from('corrective_actions').select('id,title,priority,site,status,assigned_to').eq('status','Open').order('created_at',{ascending:false}).limit(20),
      supabase.from('inspections').select('id,status,severity,scheduled_date,site,findings,inspector').order('scheduled_date',{ascending:false}).limit(50),
    ])
    const all     = tyreRes.data ?? []
    const actions = actionRes.data ?? []
    const insps   = inspRes.data ?? []

    const today    = now.toISOString().slice(0,10)
    const todayInsps  = insps.filter(i => i.scheduled_date === today)
    const completedToday = todayInsps.filter(i => i.status === 'Done').length
    const defectsFound   = insps.filter(i => i.severity === 'High' || i.severity === 'Critical').length

    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
    const monthTyres = all.filter(t => t.issue_date >= monthStart)
    const monthCost  = monthTyres.reduce((s,t)=>s+recordCost(t),0)

    const siteCounts = {}
    all.forEach(t => { if (t.site) siteCounts[t.site] = (siteCounts[t.site] ?? 0) + 1 })

    const defectTypes = {}
    insps.forEach(i => { if (i.findings) { const key = i.findings.split('.')[0].slice(0,40); defectTypes[key] = (defectTypes[key]??0)+1 } })
    const topDefects = Object.entries(defectTypes).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([type,count])=>({type,count}))

    const uniqueSites = [...new Set(all.map(t=>t.site).filter(Boolean))]
    const siteBreakdown = uniqueSites.slice(0,10).map(name => {
      const siteT = all.filter(t => t.site === name)
      const alerts = siteT.filter(t => t.risk_level === 'Critical' || t.risk_level === 'High').length
      const good   = siteT.filter(t => t.risk_level === 'Low').length
      const compliance = siteT.length > 0 ? Math.round((good / siteT.length) * 100) : 0
      return { name, vehicles: new Set(siteT.map(t=>t.asset_no).filter(Boolean)).size, alerts, compliance }
    })

    const criticalTyres = all.filter(t => t.risk_level === 'Critical').length
    const warningTyres  = all.filter(t => t.risk_level === 'High').length
    const goodTyres     = all.filter(t => t.risk_level === 'Low').length

    exportDailyExecutivePdf({
      date: now.toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'}),
      company: appSettings.company_name || 'TyrePulse Fleet',
      reportPeriod: 'Daily',
      generatedBy: profile?.full_name || profile?.username || 'Fleet Manager',
      site: activeCountry !== 'All' ? activeCountry : 'All Sites',
      totalVehicles: new Set(all.map(t=>t.asset_no).filter(Boolean)).size,
      activeVehicles: new Set(monthTyres.map(t=>t.asset_no).filter(Boolean)).size,
      vehiclesWithAlerts: new Set(all.filter(t=>t.risk_level==='Critical'||t.risk_level==='High').map(t=>t.asset_no).filter(Boolean)).size,
      totalTyres: all.length,
      criticalTyres,
      warningTyres,
      goodTyres,
      pressureCompliance: all.length > 0 ? Math.round((goodTyres / all.length) * 100) : 0,
      inspectionsScheduled: todayInsps.length,
      inspectionsCompleted: completedToday,
      defectsFound,
      monthlyBudget: null,
      monthlySpend: monthCost,
      ytdSpend: all.filter(t=>t.issue_date?.slice(0,4)===String(now.getFullYear())).reduce((s,t)=>s+recordCost(t),0),
      criticalAlerts: all.filter(t=>t.risk_level==='Critical').slice(0,10).map(t=>({ message:`Critical tyre risk on ${t.asset_no||'unknown'}`, asset: t.asset_no||'—', site: t.site||'—', severity:'Critical' })),
      openActions: actions.map(a=>({ title: a.title, priority: a.priority, site: a.site, assignee: a.assigned_to||'Unassigned' })),
      topDefects,
      siteBreakdown,
      insights: [
        `Fleet recorded ${all.length} tyre issues in the selected period with ${criticalTyres} critical cases.`,
        goodTyres > 0 ? `${Math.round((goodTyres/all.length)*100)}% of tyres are within safe operating parameters.` : 'Tyre risk distribution requires management review.',
        actions.length > 0 ? `${actions.length} corrective actions are pending resolution — prioritize ${actions.filter(a=>a.priority==='Critical'||a.priority==='High').length} high priority items.` : 'No open corrective actions.',
        monthCost > 0 ? `Monthly tyre spend of ${(appSettings.currency||'SAR')} ${Math.round(monthCost).toLocaleString()} recorded this month.` : 'No tyre cost records for this month.',
      ].filter(Boolean),
      recommendations: [
        criticalTyres > 0 ? { priority:'Critical', text:`${criticalTyres} tyres in critical condition — schedule immediate replacement before next vehicle deployment.` } : null,
        warningTyres > 3  ? { priority:'High',     text:`${warningTyres} tyres showing high-risk wear patterns — schedule inspection and replacement within 7 days.` } : null,
        actions.length > 5 ? { priority:'Medium',   text:`${actions.length} open corrective actions backlog — review assignments and resolve overdue items.` } : null,
        { priority:'Low', text:'Maintain weekly tyre pressure checks and monthly tread depth measurements across all fleet sites.' },
      ].filter(Boolean),
    }, `TyrePulse_Daily_Report_${today}`)
  }

  const TrendIcon = riskTrend?.delta > 0 ? TrendingUp : riskTrend?.delta < 0 ? TrendingDown : Minus
  const trendCol  = riskTrend?.delta > 0 ? '#ef4444' : riskTrend?.delta < 0 ? '#22c55e' : '#6b7280'
  const periodChartTitle = { daily:'Daily Changes', weekly:'Weekly Changes', monthly:'Monthly Changes', yearly:'Yearly Changes' }[granularity]

  const hourNow = new Date().getHours()
  const greeting = hourNow < 12 ? 'Good morning' : hourNow < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = (profile?.full_name ?? profile?.username ?? 'there').split(' ')[0]

  if (loading) return <LoadingState message="Loading dashboard…" />

  /* ─── RENDER ──────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-6 animate-in">

      {/* ── HERO HEADER ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl p-6"
        style={{
          background: 'linear-gradient(135deg, rgba(9,18,11,0.98) 0%, rgba(5,12,7,0.99) 100%)',
          border: '1px solid rgba(22,163,74,0.2)',
          boxShadow: '0 0 80px rgba(22,163,74,0.06), 0 8px 32px rgba(0,0,0,0.5)',
        }}>
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 60% 60% at 100% 0%, rgba(22,163,74,0.1) 0%, transparent 60%)',
        }} />
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 40% 40% at 0% 100%, rgba(22,163,74,0.05) 0%, transparent 60%)',
        }} />
        {/* Top glow line */}
        <div className="absolute top-0 left-8 right-8 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(22,163,74,0.6) 30%, rgba(74,222,128,0.8) 50%, rgba(22,163,74,0.6) 70%, transparent)' }} />

        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          {/* Left — greeting */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-green-600 uppercase tracking-[0.12em] mb-1">
              {greeting}
            </p>
            <h1 className="page-title" style={{ fontSize: '1.5rem' }}>
              {firstName}
            </h1>
            <p className="text-gray-500 text-sm mt-1.5">
              Fleet Intelligence Dashboard ·&nbsp;
              <span className="text-gray-400">{new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' })}</span>
            </p>

            {/* Risk trend callout */}
            {riskTrend && (
              <motion.div
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
                className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 rounded-full text-xs font-medium"
                style={{
                  background: riskTrend.delta > 0 ? 'rgba(239,68,68,0.1)' : riskTrend.delta < 0 ? 'rgba(22,163,74,0.1)' : 'rgba(107,114,128,0.1)',
                  border: `1px solid ${riskTrend.delta > 0 ? 'rgba(239,68,68,0.3)' : riskTrend.delta < 0 ? 'rgba(22,163,74,0.3)' : 'rgba(107,114,128,0.2)'}`,
                  color: trendCol,
                }}>
                <TrendIcon size={11} />
                {riskTrend.delta === 0
                  ? 'High-risk records unchanged vs last month'
                  : `High-risk ${riskTrend.delta > 0 ? 'up' : 'down'} ${Math.abs(riskTrend.delta)} vs last month`}
              </motion.div>
            )}
          </div>

          {/* Right — fleet health + export */}
          <div className="flex items-center gap-5 flex-shrink-0">
            <HealthRing score={fleetHealthScore} />

            <div className="hidden sm:flex flex-col gap-1.5">
              <button onClick={handleExcelExport} className="btn-secondary text-xs gap-1.5 py-1.5 px-3">
                <FileSpreadsheet size={12} className="text-green-400" /> Excel
              </button>
              <button onClick={handlePdfExport} className="btn-secondary text-xs gap-1.5 py-1.5 px-3">
                <FileText size={12} className="text-red-400" /> PDF
              </button>
              <button onClick={handlePptxExport} className="btn-secondary text-xs gap-1.5 py-1.5 px-3">
                <Presentation size={12} className="text-orange-400" /> PPTX
              </button>
              <button onClick={handleDailyReportExport} className="btn-secondary text-xs gap-1.5 py-1.5 px-3"
                style={{ background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.25)' }}>
                <FileText size={12} className="text-green-400" /> Daily PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI METRICS ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {[
          { to:'/tyres',    label:'Tyre Records', value:stats.tyres,   icon:CircleDot,     color:'blue'   },
          { to:'/stock',    label:'Stock Sites',  value:stats.stock,   icon:Package,       color:'green'  },
          { to:'/actions',  label:'Open Actions', value:stats.actions, icon:ClipboardList, color:'yellow' },
          { to:'/anomalies',label:'High Risk',    value:`${stats.critical} (${stats.tyres?((stats.critical/stats.tyres)*100).toFixed(1):0}%)`, icon:AlertTriangle, color:'red' },
          { to:'/analytics',label:'Total Cost',   value:`${activeCurrency} ${(stats.cost/1000).toFixed(0)}K`, icon:DollarSign, color:'purple' },
        ].map(({ to, label, value, icon, color }, i) => (
          <motion.div key={to} initial={{ opacity:0, y:14 }} animate={{ opacity:1, y:0 }} transition={{ delay: i * 0.06, duration: 0.4, ease:[0.22,1,0.36,1] }}>
            <Link to={to} className="block">
              <StatCard label={label} value={value} icon={icon} color={color} />
            </Link>
          </motion.div>
        ))}
      </div>

      {/* ── COMMAND BAR (filters) ─────────────────────────────────────────── */}
      <div className="card py-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-52">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input className="input pl-8 w-full" placeholder="Search asset, brand, site…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Granularity segmented */}
          <div className="flex gap-0.5 p-0.5 rounded-xl" style={{ background:'rgba(22,163,74,0.05)', border:'1px solid rgba(22,163,74,0.1)' }}>
            {[['daily','Day'],['weekly','Week'],['monthly','Month'],['yearly','Year']].map(([val, lbl]) => (
              <button key={val} onClick={() => setGranularity(val)}
                className="px-3 py-1 rounded-lg text-[11px] font-semibold transition-all duration-200"
                style={granularity === val
                  ? { background:'linear-gradient(135deg,#16a34a,#15803d)', color:'#fff', boxShadow:'0 0 12px rgba(22,163,74,0.35)' }
                  : { color:'#6b7280' }}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Date shortcuts */}
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar size={12} className="text-gray-600 flex-shrink-0" />
          <div className="flex flex-wrap gap-1.5">
            {['Today','Yesterday','This Week','This Month','Last Month','This Year','Custom'].map(label => (
              <button key={label} onClick={() => applyShortcut(label)}
                className="px-3 py-1 rounded-lg text-[11px] font-semibold transition-all duration-200"
                style={dateShortcut === label
                  ? { background:'rgba(22,163,74,0.15)', border:'1px solid rgba(22,163,74,0.35)', color:'#86efac' }
                  : { background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', color:'#6b7280' }}>
                {label}
              </button>
            ))}
          </div>
          {search && <span className="text-[10px] text-green-600 ml-auto font-medium">{tyres.length.toLocaleString()} of {rawTyres.length.toLocaleString()} records</span>}
        </div>

        <AnimatePresence>
          {showCustom && (
            <motion.div className="flex gap-2 items-center" initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }}>
              <input type="date" className="input flex-1" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-gray-600 text-xs">to</span>
              <input type="date" className="input flex-1" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── QUICK ACTIONS ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <ActionTile to="/anomalies" icon={AlertTriangle} label="Run Anomaly Scan" color="#fca5a5" bg="rgba(239,68,68,0.08)" border="rgba(239,68,68,0.2)" />
        <ActionTile to="/alerts"    icon={Bell}          label="View Alerts"      color="#fde68a" bg="rgba(245,158,11,0.08)" border="rgba(245,158,11,0.2)" />
        <ActionTile to="/upload"    icon={Upload}        label="Upload Data"      color="#93c5fd" bg="rgba(59,130,246,0.08)"  border="rgba(59,130,246,0.2)" />
        <ActionTile to="/inspections" icon={ClipboardCheck} label="Inspections"   color="#86efac" bg="rgba(22,163,74,0.08)"  border="rgba(22,163,74,0.2)" />
        <ActionTile to="/ai-command-center" icon={Cpu}   label="AI Command"       color="#d8b4fe" bg="rgba(139,92,246,0.08)" border="rgba(139,92,246,0.2)" />
      </div>

      {/* ── INTEL ROW — Avg Life + Seasonal ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Avg tyre life */}
        <div className="card flex flex-col items-center justify-center text-center gap-1 py-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-2"
            style={{ background:'rgba(59,130,246,0.1)', border:'1px solid rgba(59,130,246,0.25)' }}>
            <Clock size={16} className="text-blue-400" />
          </div>
          <p className="text-label">Avg Tyre Life</p>
          <p className="text-3xl font-extrabold text-blue-400 leading-none mt-1">
            {tyreLife?.avgLifeDays != null ? tyreLife.avgLifeDays : '—'}
          </p>
          <p className="text-xs text-gray-600">days</p>
          {tyreLife?.avgLifeKm != null && <p className="text-[10px] text-gray-700 mt-0.5">{tyreLife.avgLifeKm.toLocaleString()} km avg</p>}
        </div>

        {/* Seasonal chart */}
        <ChartPanel title="Seasonal Pattern" subtitle="Monthly issue distribution" icon={BarChart2} className="lg:col-span-2">
          <div className="h-28">
            <Bar data={seasonalBarData} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:{ color:'#4b5563', font:{ size:9 } }, grid:{ display:false } }, y:{ ticks:{ color:'#4b5563', font:{ size:9 } }, grid: GRID } } }} />
          </div>
        </ChartPanel>
      </div>

      {/* ── MAIN CHART + BRAND ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ChartPanel title={periodChartTitle} subtitle={`${dateShortcut} · ${tyres.length.toLocaleString()} records`} icon={TrendingUp} onExpand={() => setExpandedChart('main')} className="lg:col-span-2">
          <div className="h-60">
            <Bar data={periodChartData} options={{ ...BASE_OPTS, plugins: { legend: LEGEND } }} />
          </div>
        </ChartPanel>
        <ChartPanel title="Brand Breakdown" subtitle="By tyre count" icon={Shield}>
          <div className="h-60 flex items-center justify-center">
            {brandData
              ? <Doughnut data={brandData} options={NO_SCALE} />
              : <EmptyState compact icon="database" title="No brand data" description="Upload records to see breakdown." />}
          </div>
        </ChartPanel>
      </div>

      {/* ── COST TREND ───────────────────────────────────────────────────── */}
      <ChartPanel title={`Monthly Cost Trend · ${activeCurrency}`} subtitle="12-month rolling" icon={DollarSign} onExpand={() => setExpandedChart('cost')}>
        <div className="h-52">
          <Line data={monthlyCostData} options={{ ...BASE_OPTS, plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:TICK, grid:GRID }, y:{ ticks:{ ...TICK, callback: v => `${(v/1000).toFixed(0)}K` }, grid:GRID } } }} />
        </div>
      </ChartPanel>

      {/* ── FORECAST ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background:'rgba(59,130,246,0.1)', border:'1px solid rgba(59,130,246,0.2)' }}>
              <Zap size={14} className="text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Tyre Forecast</h3>
              <p className="text-[11px] text-gray-500">3-month rolling average · Confidence: <span className="text-blue-400">{forecastData.confidence}</span></p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { label:'This month', value:`~${forecastData.forecastThisMonth}`, color:'text-blue-400' },
            { label:'Next month', value:`~${forecastData.forecastNextMonth}`, color:'text-blue-300' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl p-3 text-center" style={{ background:'rgba(59,130,246,0.06)', border:'1px solid rgba(59,130,246,0.14)' }}>
              <p className={`text-2xl font-extrabold ${color} leading-none`}>{value}</p>
              <p className="text-label mt-1.5">{label}</p>
            </div>
          ))}
        </div>
        <div className="h-44">
          <Bar data={{ labels: forecastData.chartLabels, datasets: [{ label:'Actual', data:forecastData.actualData, backgroundColor:'rgba(22,163,74,0.75)', borderRadius:5 }, { label:'Forecast', data:forecastData.projectedData, backgroundColor:'rgba(59,130,246,0.55)', borderRadius:5 }] }} options={{ ...BASE_OPTS, plugins:{ legend:LEGEND } }} />
        </div>
      </div>

      {/* ── RISK + CATEGORY ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartPanel title="Risk Level Distribution" icon={AlertTriangle}>
          <div className="h-52">
            <Bar data={riskDistData} options={{ ...H_BAR, scales:{ x:{ ticks:TICK, grid:GRID }, y:{ ticks:{ color:'#9ca3af' }, grid:GRID } } }} />
          </div>
        </ChartPanel>
        <ChartPanel title="Failure Category Mix" icon={Activity}>
          <div className="h-52 flex items-center justify-center">
            {categoryData
              ? <Doughnut data={categoryData} options={NO_SCALE} />
              : <EmptyState compact icon="filter" title="No categories" description="Run Data Cleaning to populate categories." />}
          </div>
        </ChartPanel>
      </div>

      {/* ── TOP ASSETS + SITES ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartPanel title={`Top Assets by Spend · ${activeCurrency}`} subtitle="Highest cost vehicles" icon={Cpu}>
          <div className="h-64">
            {topAssetsData
              ? <Bar data={topAssetsData} options={{ ...H_BAR, scales:{ x:{ ticks:{ ...TICK, callback: v => `${(v/1000).toFixed(0)}K` }, grid:GRID }, y:{ ticks:{ color:'#9ca3af', font:{ size:10 } }, grid:GRID } } }} />
              : <EmptyState compact icon="database" title="No asset data" />}
          </div>
        </ChartPanel>
        <ChartPanel title={`Top Sites by Spend · ${activeCurrency}`} subtitle="Highest cost locations" icon={BarChart2}>
          <div className="h-64">
            {siteCostData
              ? <Bar data={siteCostData} options={{ ...H_BAR, scales:{ x:{ ticks:{ ...TICK, callback: v => `${(v/1000).toFixed(0)}K` }, grid:GRID }, y:{ ticks:{ color:'#9ca3af' }, grid:GRID } } }} />
              : <EmptyState compact icon="database" title="No site data" />}
          </div>
        </ChartPanel>
      </div>

      {/* ── ACTIVITY FEED ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent tyre records */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:'rgba(22,163,74,0.1)', border:'1px solid rgba(22,163,74,0.2)' }}>
                <CircleDot size={13} className="text-green-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Recent Tyre Records</h3>
            </div>
            <Link to="/tyres" className="text-[11px] text-green-600 hover:text-green-400 font-medium flex items-center gap-1 transition-colors">
              View all <ChevronRight size={11} />
            </Link>
          </div>
          {recentRecords.length === 0
            ? <EmptyState compact icon="database" title="No records yet" description="Upload tyre data to see recent activity." />
            : (
              <div className="space-y-1.5">
                {recentRecords.map((r, i) => (
                  <motion.div key={r.id} initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }} transition={{ delay: i * 0.04 }}
                    className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors group"
                    style={{ background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.04)' }}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(22,163,74,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.025)'}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: r.risk_level === 'Critical' ? '#ef4444' : r.risk_level === 'High' ? '#f97316' : r.risk_level === 'Low' ? '#22c55e' : '#f59e0b', boxShadow: `0 0 6px currentColor` }} />
                      <div className="min-w-0">
                        <Link to={`/vehicle-history?asset=${r.asset_no}`} className="text-sm text-gray-200 font-medium hover:text-green-400 transition-colors truncate block">
                          {r.asset_no ?? 'N/A'}
                        </Link>
                        <p className="text-[11px] text-gray-600 truncate">{r.brand} · {r.site}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <RiskBadge level={r.risk_level} />
                      <p className="text-[10px] text-gray-700 mt-1">{r.issue_date ?? 'N/A'}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
        </div>

        {/* Open corrective actions */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)' }}>
                <ClipboardList size={13} className="text-yellow-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Open Corrective Actions</h3>
            </div>
            <Link to="/actions" className="text-[11px] text-yellow-600 hover:text-yellow-400 font-medium flex items-center gap-1 transition-colors">
              View all <ChevronRight size={11} />
            </Link>
          </div>
          {openActions.length === 0
            ? <EmptyState compact icon="search" title="No open actions" description="All corrective actions are resolved." />
            : (
              <div className="space-y-1.5">
                {openActions.map((a, i) => {
                  const pColor = { High:'#ef4444', Medium:'#f59e0b', Low:'#3b82f6' }[a.priority] ?? '#6b7280'
                  return (
                    <motion.div key={a.id} initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }} transition={{ delay: i * 0.04 }}
                      className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors"
                      style={{ background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.04)' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(245,158,11,0.04)'}
                      onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.025)'}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: pColor }} />
                        <div className="min-w-0">
                          <p className="text-sm text-gray-200 font-medium truncate">{a.title}</p>
                          <p className="text-[11px] text-gray-600">{a.site}</p>
                        </div>
                      </div>
                      <span className="flex-shrink-0 ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                        style={{ color: pColor, background:`${pColor}18`, borderColor:`${pColor}30` }}>
                        {a.priority}
                      </span>
                    </motion.div>
                  )
                })}
              </div>
            )}
        </div>
      </div>

      {/* Chart modals */}
      {expandedChart === 'main' && (
        <ChartModal title={periodChartTitle} onClose={() => setExpandedChart(null)}>
          <Bar data={periodChartData} options={{ ...BASE_OPTS, plugins: { legend: LEGEND } }} />
        </ChartModal>
      )}
      {expandedChart === 'cost' && (
        <ChartModal title={`Monthly Cost Trend · ${activeCurrency}`} onClose={() => setExpandedChart(null)}>
          <Line data={monthlyCostData} options={{ ...BASE_OPTS, plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:TICK, grid:GRID }, y:{ ticks:{ ...TICK, callback: v => `${activeCurrency} ${(v/1000).toFixed(0)}K` }, grid:GRID } } }} />
        </ChartModal>
      )}
    </div>
  )
}
