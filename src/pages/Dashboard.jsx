import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { dashboard } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToPptx, exportToExcel, exportToPdf, exportDailyExecutivePdf } from '../lib/exportUtils'
import { formatDate } from '../lib/formatters'
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
  BarChart2, Shield, Cpu, ArrowUpRight, RefreshCw, CheckCircle2,
} from 'lucide-react'
import { ChartModal } from '../components/ChartModal'
import EmptyState from '../components/EmptyState'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatTile from '../components/ui/StatTile'
import Skeleton, { SkeletonCards, SkeletonChart } from '../components/ui/Skeleton'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
  ArcElement, LineElement, PointElement, Filler,
)

const GRID   = { color:'var(--text-muted)' }
const TICK   = { color: '#4b5563', font: { size: 11 } }
const LEGEND = { labels: { color: '#6b7280', boxWidth: 10, font: { size: 11 } } }

const BASE_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: LEGEND },
  scales: { x: { ticks: TICK, grid: GRID }, y: { ticks: TICK, grid: GRID } },
}
const NO_SCALE = { ...BASE_OPTS, scales: undefined, plugins: { legend: { ...LEGEND, position: 'right' } } }
const H_BAR    = { ...BASE_OPTS, indexAxis: 'y', plugins: { legend: { display: false } } }
const STACKED  = { ...BASE_OPTS, scales: { x: { stacked: true, ticks: TICK, grid: { display: false } }, y: { stacked: true, ticks: TICK, grid: GRID } } }

// Risk palette shared by the risk-distribution bar and the stacked risk-mix trend.
const RISK_COLORS = { Critical: '#dc2626', High: '#ea580c', Medium: '#ca8a04', Low: '#16a34a' }
// A record's tyre count: rows are aggregates where `qty` is the number of tyres.
const recordQty = t => Number(t.qty) || 1

// Same {var} interpolation the i18n layer uses, applied to inline fallbacks.
const interpolateFallback = (str, vars) =>
  vars ? str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : str

function inMonth(t, y, m) {
  if (!t.issue_date) return false
  const d = new Date(t.issue_date)
  return d.getFullYear() === y && d.getMonth() + 1 === m
}
function isHigh(t) { return t.risk_level === 'Critical' || t.risk_level === 'High' }

/* ── Health Ring ─────────────────────────────────────────────────────────── */
function HealthRing({ score }) {
  const { t } = useLanguage()
  const r = 38
  const circ = 2 * Math.PI * r
  const pct  = Math.min(Math.max(score, 0), 100)
  const dash = (pct / 100) * circ
  const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444'
  const label = pct >= 70 ? t('dashboard.health.good') : pct >= 40 ? t('dashboard.health.moderate') : t('dashboard.health.atRisk')

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
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-[var(--text-primary)] leading-none tabular-nums">{score}</span>
          <span className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">/ 100</span>
        </div>
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{label}</span>
      <span className="text-[10px] text-gray-600">{t('dashboard.health.fleetHealth')}</span>
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
            <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-none">{title}</h3>
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
  const { t } = useLanguage()
  const styles = {
    Critical: 'bg-red-500/15 text-red-300 border-red-500/25',
    High:     'bg-orange-500/15 text-orange-300 border-orange-500/25',
    Medium:   'bg-yellow-500/15 text-yellow-300 border-yellow-500/25',
    Low:      'bg-green-500/15 text-green-300 border-green-500/25',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${styles[level] ?? 'bg-gray-800/60 text-gray-400 border-gray-700/40'}`}>
      {level ?? t('dashboard.risk.unknown')}
    </span>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const { profile } = useAuth()
  const { appSettings, activeCountry, activeCurrency } = useSettings()
  const { branding } = useTenant()
  const { t } = useLanguage()
  // Tenant identity for generated reports: legal/brand name falls back to the
  // global company name, then a safe default. Never blocks export on absence.
  const reportCompany = branding?.legal_name || branding?.display_name || appSettings.company_name || 'TyrePulse'

  const [rawTyres, setRawTyres]       = useState([])
  const [summary, setSummary]         = useState(null)
  const [rawActions, setRawActions]   = useState([])
  const [rawStock, setRawStock]       = useState([])
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [search, setSearch]           = useState('')
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [dateShortcut, setDateShortcut] = useState('This Month')
  const [showCustom, setShowCustom]   = useState(false)
  const [granularity, setGranularity] = useState('monthly')
  const [recentRecords, setRecentRecords] = useState([])
  const [openActions, setOpenActions]     = useState([])
  const [expandedChart, setExpandedChart] = useState(null)
  const [exporting, setExporting]         = useState(null) // 'excel' | 'pdf' | 'pptx' | 'daily' | null
  const [exportMsg, setExportMsg]         = useState(null) // { text, type: 'ok' | 'err' }

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

  // Note: no window-focus reload - it made the page appear to refresh on its
  // own when switching tabs. Use the manual Refresh button to re-pull on demand.

  async function load() {
    setLoading(true); setError(null)
    try {
      // Null-safe country filter (behind the service layer) never silently
      // drops uncategorised rows; full-fleet aggregates come from the RPC.
      const [tyreRes, stockRes, actionRes, recentRes, openActRes, summaryRes] = await Promise.all([
        dashboard.listDashboardTyres({ country: activeCountry, from: dateFrom, to: dateTo }),
        dashboard.listDashboardStock({ country: activeCountry }),
        dashboard.listDashboardActions({ country: activeCountry }),
        dashboard.listDashboardRecentTyres({ country: activeCountry }),
        dashboard.listDashboardOpenActions({ country: activeCountry }),
        dashboard.reportTyreSummary({ country: activeCountry, from: dateFrom, to: dateTo }),
      ])
      // Surface a hard failure (offline / RLS-denied) instead of rendering an
      // empty dashboard that looks identical to "no data".
      const firstErr = [tyreRes, stockRes, actionRes, recentRes, openActRes, summaryRes].find(r => r?.error)?.error
      if (firstErr) throw new Error(firstErr.message || firstErr)
      setRawTyres(tyreRes.data ?? [])
      setSummary(summaryRes?.data ?? null)
      setRawStock(stockRes.data ?? [])
      setRawActions(actionRes.data ?? [])
      setRecentRecords(recentRes.data ?? [])
      setOpenActions(openActRes.data ?? [])
    } catch (e) {
      setError(e.message || t('dashboard.states.errorDefault'))
    } finally {
      setLoading(false)
    }
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
    const open = (rawActions ?? []).filter(a => a.status === 'Open').length
    // Use accurate server-side aggregates unless a text search narrows the view.
    if (summary && !search) {
      return {
        tyres: Number(summary.total_records) || 0,
        stock: rawStock.length,
        actions: open,
        critical: Number(summary.high_risk) || 0,
        cost: Number(summary.total_cost) || 0,
        vehicles: Number(summary.distinct_assets) || 0,
      }
    }
    const cost = tyres.reduce((s, t) => s + recordCost(t), 0)
    const crit = tyres.filter(isHigh).length
    return { tyres: tyres.length, stock: rawStock.length, actions: open, critical: crit, cost, vehicles: new Set(tyres.map(t => t.asset_no).filter(Boolean)).size }
  }, [tyres, rawActions, rawStock, summary, search])

  const fleetHealthScore = useMemo(() => computeFleetHealthScore(tyres), [tyres])
  const seasonalTrends   = useMemo(() => computeSeasonalTrends(tyres), [tyres])
  const tyreLife         = useMemo(() => computeTyreLifeAnalysis(tyres), [tyres])

  const seasonalBarData = useMemo(() => ({
    labels: seasonalTrends.map(d => d.month),
    datasets: [{
      label: t('dashboard.legend.tyreIssues'), data: seasonalTrends.map(d => d.count),
      backgroundColor: seasonalTrends.map(d =>
        d.highRiskRate > 0.3 ? 'rgba(239,68,68,0.65)' :
        d.highRiskRate > 0.15 ? 'rgba(245,158,11,0.65)' : 'rgba(59,130,246,0.6)'
      ),
      borderRadius: 5,
    }],
  }), [seasonalTrends, t])

  // Anchor every time-bucketed chart/KPI to the DATA's latest date, not today.
  // Historic imports (e.g. 2020-21 ERP files) would otherwise render every
  // "last N periods" chart empty even though the records are all loaded.
  const dataAnchor = useMemo(() => {
    let max = null
    for (const r of tyres) { if (r.issue_date && (!max || r.issue_date > max)) max = r.issue_date }
    return max ? new Date(max.slice(0, 10) + 'T00:00:00') : new Date()
  }, [tyres])

  const riskTrend = useMemo(() => {
    const now = dataAnchor
    const thisM = { y: now.getFullYear(), m: now.getMonth() + 1 }
    const lastM = now.getMonth() === 0 ? { y: now.getFullYear() - 1, m: 12 } : { y: now.getFullYear(), m: now.getMonth() }
    const thisHigh = tyres.filter(t => inMonth(t, thisM.y, thisM.m) && isHigh(t)).length
    const lastHigh = tyres.filter(t => inMonth(t, lastM.y, lastM.m) && isHigh(t)).length
    return { delta: thisHigh - lastHigh, lastHigh }
  }, [tyres, dataAnchor])

  const periodChartData = useMemo(() => {
    const now = dataAnchor
    if (granularity === 'daily') {
      const days = []
      for (let i = 29; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days.push(fmt(d)) }
      return {
        labels: days.map(d => { const [, m, dy] = d.split('-'); return `${dy}/${m}` }),
        datasets: [
          { label: t('dashboard.legend.all'),       data: days.map(day => tyres.filter(t => t.issue_date?.slice(0,10) === day).length), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
          { label: t('dashboard.legend.highRisk'), data: days.map(day => tyres.filter(t => t.issue_date?.slice(0,10) === day && isHigh(t)).length), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 },
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
          { label: t('dashboard.legend.all'), data: weeks.map(({ key }) => { let n=0; tyres.forEach(t => { if (!t.issue_date) return; const d=new Date(t.issue_date); const wn=Math.ceil((((d-new Date(d.getFullYear(),0,1))/86400000)+1)/7); if(`W${wn} ${d.getFullYear()}`===key) n++ }); return n }), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
          { label: t('dashboard.legend.highRisk'), data: weeks.map(({ key }) => { let n=0; tyres.forEach(t => { if (!t.issue_date||!isHigh(t)) return; const d=new Date(t.issue_date); const wn=Math.ceil((((d-new Date(d.getFullYear(),0,1))/86400000)+1)/7); if(`W${wn} ${d.getFullYear()}`===key) n++ }); return n }), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 },
        ],
      }
    }
    if (granularity === 'yearly') {
      const years = []; for (let i = 4; i >= 0; i--) years.push(now.getFullYear() - i)
      return {
        labels: years.map(String),
        datasets: [
          { label: t('dashboard.legend.all'),       data: years.map(y => tyres.filter(t => t.issue_date?.slice(0,4) === String(y)).length), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
          { label: t('dashboard.legend.highRisk'), data: years.map(y => tyres.filter(t => t.issue_date?.slice(0,4) === String(y) && isHigh(t)).length), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 },
        ],
      }
    }
    const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return { label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), y: d.getFullYear(), m: d.getMonth() + 1 } })
    return {
      labels: months.map(m => m.label),
      datasets: [
        { label: t('dashboard.legend.all'),       data: months.map(({ y, m }) => tyres.filter(t => inMonth(t, y, m)).length), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
        { label: t('dashboard.legend.highRisk'), data: months.map(({ y, m }) => tyres.filter(t => inMonth(t, y, m) && isHigh(t)).length), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 },
      ],
    }
  }, [tyres, granularity, t, dataAnchor])

  const monthlyCostData = useMemo(() => {
    const now = dataAnchor
    const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return { label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), y: d.getFullYear(), m: d.getMonth() + 1 } })
    return {
      labels: months.map(m => m.label),
      datasets: [{
        label: t('dashboard.legend.cost', { currency: activeCurrency }),
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
  }, [tyres, activeCurrency, t, dataAnchor])

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
    return { labels: top.map(([s]) => s), datasets: [{ label: t('dashboard.legend.cost', { currency: activeCurrency }), data: top.map(([, c]) => Math.round(c)), backgroundColor: 'rgba(6,182,212,0.75)', borderRadius: 5, borderSkipped: false }] }
  }, [tyres, activeCurrency, t])

  /* Stacked monthly risk mix (last 12 months). Tyre counts sum qty per row —
     rows are aggregates — so the bars reflect tyre volume, not record volume. */
  const riskMixData = useMemo(() => {
    const now = dataAnchor
    const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return { label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), y: d.getFullYear(), m: d.getMonth() + 1 } })
    const levels = ['Low', 'Medium', 'High', 'Critical']
    const datasets = levels.map(level => ({
      label: level,
      data: months.map(({ y, m }) => tyres.reduce((s, t) => (t.risk_level === level && inMonth(t, y, m)) ? s + recordQty(t) : s, 0)),
      backgroundColor: `${RISK_COLORS[level]}c0`,
      borderRadius: 3,
      stack: 'risk',
    }))
    if (!datasets.some(ds => ds.data.some(v => v > 0))) return null
    return { labels: months.map(m => m.label), datasets }
  }, [tyres, dataAnchor])

  /* Spend split between new and retread purchases (category convention shared
     with kpiEngine.computeRetreadPerformance: /retread/i marks retreads). */
  const categorySplitData = useMemo(() => {
    let fresh = 0, retread = 0
    tyres.forEach(t => {
      const c = recordCost(t)
      if (!c) return
      if (/retread/i.test(String(t.category ?? ''))) retread += c
      else fresh += c
    })
    if (fresh + retread <= 0) return null
    return {
      labels: ['New', 'Retread'],
      datasets: [{ data: [Math.round(fresh), Math.round(retread)], backgroundColor: ['#3b82f6', '#10b981'], borderWidth: 0, hoverOffset: 6 }],
    }
  }, [tyres])

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
      chartLabels: [...months.slice(3).map(m => m.label), t('dashboard.forecast.thisMonth'), t('dashboard.forecast.nextMonth')],
      actualData: [...last3, null, null],
      projectedData: [null, null, null, Math.round(avg), Math.round(avg)],
    }
  }, [rawTyres, t])

  // Real 6-month series for the KPI-card sparklines (never fabricated — derived
  // straight from the loaded records). Only metrics with a genuine time series
  // get a sparkline; stock/actions have none here and stay sparkline-free.
  const sparkSeries = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 } })
    const inM = (t, y, m) => inMonth(t, y, m)
    const tyresS = months.map(({ y, m }) => rawTyres.filter(t => inM(t, y, m)).length)
    const costS  = months.map(({ y, m }) => Math.round(rawTyres.filter(t => inM(t, y, m)).reduce((s, t) => s + recordCost(t), 0)))
    const riskS  = months.map(({ y, m }) => rawTyres.filter(t => inM(t, y, m) && ['Critical', 'High'].includes(t.risk_level)).length)
    const hasSpread = arr => arr.some(v => v > 0) && new Set(arr).size > 1
    return {
      tyres: hasSpread(tyresS) ? tyresS : null,
      cost:  hasSpread(costS)  ? costS  : null,
      risk:  hasSpread(riskS)  ? riskS  : null,
    }
  }, [rawTyres])

  /* Centralised export runner: disables the button, shows progress, surfaces
     any error to the user (exports lazy-load heavy libs and can fail on slow
     networks, pop-up blockers, or empty data — never leave a silent dead button). */
  async function runExport(key, task) {
    if (exporting) return
    setExporting(key); setExportMsg(null)
    try {
      await task()
      setExportMsg({ text: 'Report downloaded successfully.', type: 'ok' })
    } catch (err) {
      console.error(`[Dashboard] ${key} export failed:`, err)
      setExportMsg({ text: `Export failed: ${err?.message || 'Could not generate the file. Please retry.'}`, type: 'err' })
    } finally {
      setExporting(null)
    }
  }

  function handleExcelExport() {
    return runExport('excel', () => exportToExcel(
      tyres.map(t => ({ ...t, cost_per_tyre: t.cost_per_tyre||0, total_cost: recordCost(t) })),
      ['issue_date','asset_no','brand','site','category','risk_level','cost_per_tyre'],
      ['Date','Asset No','Brand','Site','Category','Risk Level',`Cost (${activeCurrency})`],
      `TyrePulse_Dashboard_${new Date().toISOString().slice(0,10)}`, 'Dashboard', { company: reportCompany }))
  }
  function handlePdfExport() {
    return runExport('pdf', () => exportToPdf(
      tyres.slice(0, 200).map(t => ({ ...t, cost_per_tyre: t.cost_per_tyre||0 })),
      [{ key:'issue_date',header:'Date',width:24 },{ key:'asset_no',header:'Asset No',width:28 },{ key:'brand',header:'Brand',width:24 },{ key:'site',header:'Site',width:30 },{ key:'category',header:'Category',width:32 },{ key:'risk_level',header:'Risk',width:20 },{ key:'cost_per_tyre',header:`Cost (${activeCurrency})`,width:24 }],
      `TyrePulse Dashboard Report · ${formatDate(new Date(), activeCountry)}`,
      `TyrePulse_Dashboard_${new Date().toISOString().slice(0,10)}`, 'landscape', reportCompany,
      { branding, currency: activeCurrency }))
  }
  function handlePptxExport() {
    return runExport('pptx', pptxExportTask)
  }
  async function pptxExportTask() {
    const now = new Date()
    const [{ data: sum }, actionRes] = await Promise.all([
      dashboard.reportTyreSummary({ country: activeCountry, from: dateFrom, to: dateTo }),
      dashboard.listOpenActionsForPptx(),
    ])
    const s = sum || {}
    const actions = actionRes.data ?? []
    const cur = activeCurrency
    const totalCost = Number(s.total_cost) || 0
    const highRisk  = Number(s.high_risk) || 0
    const critical  = Number(s.critical) || 0
    const sites = s.top_sites || []
    const brands = s.top_brands || []
    const insights = [
      `Fleet holds ${(s.total_records||0).toLocaleString()} tyre records across ${(s.top_sites||[]).length}+ sites, with ${highRisk} flagged high-risk or critical.`,
      brands[0] ? `${brands[0].brand} is the most-deployed brand (${brands[0].count} records).` : 'Brand distribution unavailable.',
      totalCost > 0 ? `Period tyre spend totals ${cur} ${Math.round(totalCost).toLocaleString()}; ${(s.cost_by_site||[])[0]?.site || 'lead site'} carries the largest share.` : 'No tyre cost recorded for the period.',
      actions.length ? `${actions.length} corrective actions are open - ${actions.filter(a=>a.priority==='Critical'||a.priority==='High').length} high priority.` : 'No open corrective actions.',
    ]
    const recommendations = [
      critical > 0 ? { priority:'Critical', text:`Replace ${critical} critical tyres before next deployment.` } : null,
      highRisk - critical > 0 ? { priority:'High', text:`Inspect ${highRisk - critical} high-risk tyres within 7 days.` } : null,
      actions.length > 5 ? { priority:'Medium', text:`Clear the ${actions.length}-item corrective-action backlog.` } : null,
      { priority:'Low', text:'Maintain weekly pressure checks and monthly tread measurements fleet-wide.' },
    ].filter(Boolean)
    await exportToPptx({
      totalVehicles: Number(s.distinct_assets) || 0,
      totalTyres: Number(s.total_records) || 0, totalCost, openActions: actions.length, highRisk,
      currency: cur,
      topSites: sites.map(t => ({ site: t.site, count: t.count })),
      costBySite: (s.cost_by_site || []).map(t => ({ site: t.site, cost: t.cost })),
      categoryBreakdown: (s.category_breakdown || []).map(t => ({ category: t.category, count: t.count })),
      topBrands: brands.map(b => ({ brand: b.brand, count: b.count })),
      riskBreakdown: (s.risk_breakdown || []).map(r => ({ level: r.level, count: r.count })),
      monthlyTrend: (s.monthly_trend || []).map(m => ({ month: m.month, count: m.count })),
      recentActions: actions, insights, recommendations,
      period: now.toLocaleString('default',{month:'long',year:'numeric'}),
      generatedBy: profile?.full_name || profile?.username || 'Fleet Manager',
      company: reportCompany,
      branding,
    }, `TyrePulse_Report_${now.toISOString().slice(0,10)}`)
  }

  function handleDailyReportExport() {
    return runExport('daily', dailyReportTask)
  }
  async function dailyReportTask() {
    const now = new Date()
    const today      = now.toISOString().slice(0,10)
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
    const yearStart  = `${now.getFullYear()}-01-01`
    // Accurate, full-fleet aggregates (server-side) + month/YTD cost slices.
    const [{ data: sAll }, { data: sMonth }, { data: sYtd }, actionRes, inspRes, critRes] = await Promise.all([
      dashboard.reportTyreSummary({ country: activeCountry, from: null, to: null }),
      dashboard.reportTyreSummary({ country: activeCountry, from: monthStart, to: null }),
      dashboard.reportTyreSummary({ country: activeCountry, from: yearStart, to: null }),
      dashboard.listOpenActionsForDaily(),
      dashboard.listRecentInspectionsForDaily(),
      dashboard.listCriticalTyresForDaily({ country: activeCountry }),
    ])
    const s       = sAll || {}
    const actions = actionRes.data ?? []
    const insps   = inspRes.data ?? []
    const critRows = critRes.data ?? []

    const todayInsps     = insps.filter(i => i.scheduled_date === today)
    const completedToday = todayInsps.filter(i => i.status === 'Done').length
    const defectsFound   = insps.filter(i => i.severity === 'High' || i.severity === 'Critical').length

    const defectTypes = {}
    insps.forEach(i => { if (i.findings) { const key = i.findings.split('.')[0].slice(0,40); defectTypes[key] = (defectTypes[key]??0)+1 } })
    const topDefects = Object.entries(defectTypes).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([type,count])=>({type,count}))

    const siteBreakdown = (s.site_breakdown || []).map(b => ({ name: b.name, vehicles: b.vehicles, alerts: b.alerts, compliance: b.compliance }))

    const criticalTyres = Number(s.critical) || 0
    const warningTyres  = Number(s.high) || 0
    const goodTyres     = Number(s.low) || 0
    const totalTyres    = Number(s.total_records) || 0
    const monthCost     = Number(sMonth?.total_cost) || 0

    exportDailyExecutivePdf({
      date: formatDate(now, activeCountry, { day: '2-digit', month: 'long', year: 'numeric' }),
      company: reportCompany,
      branding,
      reportPeriod: 'Daily',
      currency: activeCurrency,
      generatedBy: profile?.full_name || profile?.username || 'Fleet Manager',
      site: activeCountry !== 'All' ? activeCountry : 'All Sites',
      totalVehicles: Number(s.distinct_assets) || 0,
      activeVehicles: Number(sMonth?.distinct_assets) || 0,
      vehiclesWithAlerts: Number(s.vehicles_with_alerts) || 0,
      totalTyres,
      criticalTyres,
      warningTyres,
      goodTyres,
      pressureCompliance: totalTyres > 0 ? Math.round((goodTyres / totalTyres) * 100) : 0,
      inspectionsScheduled: todayInsps.length,
      inspectionsCompleted: completedToday,
      defectsFound,
      monthlyBudget: null,
      monthlySpend: monthCost,
      ytdSpend: Number(sYtd?.total_cost) || 0,
      criticalAlerts: critRows.map(t=>({ message:`Critical tyre risk on ${t.asset_no||'unknown'}`, asset: t.asset_no||'-', site: t.site||'-', severity:'Critical' })),
      openActions: actions.map(a=>({ title: a.title, priority: a.priority, site: a.site, assignee: a.assigned_to||'Unassigned' })),
      topDefects,
      siteBreakdown,
      insights: [
        `Fleet recorded ${totalTyres.toLocaleString()} tyre records with ${criticalTyres} critical cases.`,
        goodTyres > 0 && totalTyres > 0 ? `${Math.round((goodTyres/totalTyres)*100)}% of tyres are within safe operating parameters.` : 'Tyre risk distribution requires management review.',
        actions.length > 0 ? `${actions.length} corrective actions are pending resolution - prioritize ${actions.filter(a=>a.priority==='Critical'||a.priority==='High').length} high priority items.` : 'No open corrective actions.',
        monthCost > 0 ? `Monthly tyre spend of ${activeCurrency} ${Math.round(monthCost).toLocaleString()} recorded this month.` : 'No tyre cost records for this month.',
      ].filter(Boolean),
      recommendations: [
        criticalTyres > 0 ? { priority:'Critical', text:`${criticalTyres} tyres in critical condition - schedule immediate replacement before next vehicle deployment.` } : null,
        warningTyres > 3  ? { priority:'High',     text:`${warningTyres} tyres showing high-risk wear patterns - schedule inspection and replacement within 7 days.` } : null,
        actions.length > 5 ? { priority:'Medium',   text:`${actions.length} open corrective actions backlog - review assignments and resolve overdue items.` } : null,
        { priority:'Low', text:'Maintain weekly tyre pressure checks and monthly tread depth measurements across all fleet sites.' },
      ].filter(Boolean),
    }, `TyrePulse_Daily_Report_${today}`)
  }

  /* Translate with an inline English fallback: `t` returns the key itself when
     a namespace entry is missing, so new chart labels render real copy today
     and automatically switch to locale files once translators add the keys. */
  const tf = (key, fallback, vars) => {
    const v = t(key, vars)
    return v === key ? interpolateFallback(fallback, vars) : v
  }

  /* Currency-aware chart formatting: compact ticks on axes, exact values in
     tooltips. Shared by every spend chart so money always reads consistently. */
  const fmtMoney = v => `${activeCurrency} ${Math.round(Number(v) || 0).toLocaleString()}`
  const moneyTick = v => `${activeCurrency} ${(v / 1000).toFixed(0)}K`
  const moneyTooltip = {
    callbacks: {
      label: ctx => {
        const name = ctx.dataset?.label || ctx.label
        return name ? `${name}: ${fmtMoney(ctx.raw)}` : fmtMoney(ctx.raw)
      },
    },
  }

  const TrendIcon = riskTrend?.delta > 0 ? TrendingUp : riskTrend?.delta < 0 ? TrendingDown : Minus
  const trendCol  = riskTrend?.delta > 0 ? '#ef4444' : riskTrend?.delta < 0 ? '#22c55e' : '#6b7280'
  const periodChartTitle = { daily:t('dashboard.charts.periodDaily'), weekly:t('dashboard.charts.periodWeekly'), monthly:t('dashboard.charts.periodMonthly'), yearly:t('dashboard.charts.periodYearly') }[granularity]

  const hourNow = new Date().getHours()
  const greeting = hourNow < 12 ? t('dashboard.greeting.morning') : hourNow < 17 ? t('dashboard.greeting.afternoon') : t('dashboard.greeting.evening')
  const firstName = (profile?.full_name ?? profile?.username ?? 'there').split(' ')[0]

  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <SkeletonCards count={5} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SkeletonChart className="lg:col-span-2" />
        <SkeletonChart />
      </div>
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center px-6">
      <AlertTriangle size={44} className="text-red-400" />
      <p className="text-red-300 font-semibold text-lg">{t('dashboard.states.errorTitle')}</p>
      <p className="text-gray-500 text-sm max-w-md">{error}</p>
      <button onClick={load} className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
        <RefreshCw size={16} /> {t('dashboard.states.retry')}
      </button>
    </div>
  )

  /* ─── RENDER ──────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-6 animate-in">

      {/* ── EXPORT TOAST ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {exportMsg && (
          <motion.div
            key="export-toast"
            initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg"
            style={{
              background: exportMsg.type === 'ok' ? 'rgba(22,163,74,0.15)' : 'rgba(239,68,68,0.15)',
              border: `1px solid ${exportMsg.type === 'ok' ? 'rgba(22,163,74,0.4)' : 'rgba(239,68,68,0.4)'}`,
              color: exportMsg.type === 'ok' ? '#4ade80' : '#f87171',
              backdropFilter: 'blur(8px)',
            }}
            onAnimationComplete={() => { if (exportMsg) setTimeout(() => setExportMsg(null), 3500) }}>
            {exportMsg.type === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span className="max-w-xs">{exportMsg.text}</span>
            <button onClick={() => setExportMsg(null)} className="ml-1 opacity-70 hover:opacity-100"><X size={13} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── HERO HEADER ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl p-6"
        style={{
          background: 'linear-gradient(135deg, var(--hero-from) 0%, var(--hero-to) 100%)',
          border: '1px solid rgba(22,163,74,0.2)',
          boxShadow: 'var(--shadow-card)',
        }}>
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 60% 60% at 100% 0%, rgba(22,163,74,0.06) 0%, transparent 60%)',
        }} />
        {/* Top glow line */}
        <div className="absolute top-0 left-8 right-8 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(22,163,74,0.6) 30%, rgba(74,222,128,0.8) 50%, rgba(22,163,74,0.6) 70%, transparent)' }} />

        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          {/* Left - greeting */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-green-600 uppercase tracking-[0.12em] mb-1">
              {greeting}
            </p>
            <h1 className="page-title" style={{ fontSize: '1.5rem' }}>
              {firstName}
            </h1>
            <p className="text-gray-500 text-sm mt-1.5">
              {t('dashboard.hero.subtitle')} ·&nbsp;
              <span className="text-gray-400">{formatDate(new Date(), activeCountry, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
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
                  ? t('dashboard.hero.riskUnchanged')
                  : riskTrend.delta > 0
                    ? t('dashboard.hero.riskUp', { count: Math.abs(riskTrend.delta) })
                    : t('dashboard.hero.riskDown', { count: Math.abs(riskTrend.delta) })}
              </motion.div>
            )}
          </div>

          {/* Right - fleet health + export */}
          <div className="flex items-center gap-5 flex-shrink-0">
            <HealthRing score={fleetHealthScore} />

            <div className="hidden sm:flex flex-col gap-1.5">
              <button onClick={handleExcelExport} disabled={!!exporting} className="btn-secondary text-xs gap-1.5 py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed">
                {exporting === 'excel'
                  ? <><RefreshCw size={12} className="text-green-400 animate-spin" /> {t('dashboard.export.exporting')}</>
                  : <><FileSpreadsheet size={12} className="text-green-400" /> {t('dashboard.export.excel')}</>}
              </button>
              <button onClick={handlePdfExport} disabled={!!exporting} className="btn-secondary text-xs gap-1.5 py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed">
                {exporting === 'pdf'
                  ? <><RefreshCw size={12} className="text-red-400 animate-spin" /> {t('dashboard.export.exporting')}</>
                  : <><FileText size={12} className="text-red-400" /> {t('dashboard.export.pdf')}</>}
              </button>
              <button onClick={handlePptxExport} disabled={!!exporting} className="btn-secondary text-xs gap-1.5 py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed">
                {exporting === 'pptx'
                  ? <><RefreshCw size={12} className="text-orange-400 animate-spin" /> {t('dashboard.export.building')}</>
                  : <><Presentation size={12} className="text-orange-400" /> {t('dashboard.export.pptx')}</>}
              </button>
              <button onClick={handleDailyReportExport} disabled={!!exporting} className="btn-secondary text-xs gap-1.5 py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.25)' }}>
                {exporting === 'daily'
                  ? <><RefreshCw size={12} className="text-green-400 animate-spin" /> {t('dashboard.export.building')}</>
                  : <><FileText size={12} className="text-green-400" /> {t('dashboard.export.dailyPdf')}</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI METRICS (console stat-tiles) ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <StatTile index={0} to="/tyres" icon={CircleDot} tone="info"
          label={t('dashboard.kpi.tyreRecords')} value={Number(stats.tyres || 0).toLocaleString()}
          sub={t('dashboard.kpi.recordsSub', { count: stats.vehicles || 0 })} spark={sparkSeries.tyres} />
        <StatTile index={1} to="/stock" icon={Package} tone="accent"
          label={t('dashboard.kpi.stockSites')} value={Number(stats.stock || 0).toLocaleString()} />
        <StatTile index={2} to="/actions" icon={ClipboardList} tone="warn"
          label={t('dashboard.kpi.openActions')} value={Number(stats.actions || 0).toLocaleString()} />
        <StatTile index={3} to="/anomalies" icon={AlertTriangle} tone="crit"
          label={t('dashboard.kpi.highRisk')} value={Number(stats.critical || 0).toLocaleString()}
          unit={stats.tyres ? `(${((stats.critical / stats.tyres) * 100).toFixed(1)}%)` : ''}
          delta={riskTrend?.delta} deltaSuffix="" deltaGood={(riskTrend?.delta ?? 0) <= 0}
          spark={sparkSeries.risk} />
        <StatTile index={4} to="/analytics" icon={DollarSign} tone="accent"
          label={t('dashboard.kpi.totalCost')} value={`${(stats.cost / 1000).toFixed(0)}K`}
          unit={activeCurrency} spark={sparkSeries.cost} />
      </div>

      {/* ── COMMAND BAR (filters) ─────────────────────────────────────────── */}
      <div className="card py-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-52">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
            <input className="input pl-8 w-full" placeholder={t('dashboard.filters.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Granularity segmented */}
          <SegmentedControl
            ariaLabel="granularity"
            size="sm"
            value={granularity}
            onChange={setGranularity}
            options={[
              { value:'daily',   label:t('dashboard.granularity.day') },
              { value:'weekly',  label:t('dashboard.granularity.week') },
              { value:'monthly', label:t('dashboard.granularity.month') },
              { value:'yearly',  label:t('dashboard.granularity.year') },
            ]}
          />
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
          {search && <span className="text-[10px] text-green-600 ml-auto font-medium">{t('dashboard.filters.recordsOfTotal', { count: tyres.length.toLocaleString(), total: rawTyres.length.toLocaleString() })}</span>}
        </div>

        <AnimatePresence>
          {showCustom && (
            <motion.div className="flex gap-2 items-center" initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }}>
              <input type="date" className="input flex-1" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-gray-600 text-xs">{t('dashboard.filters.to')}</span>
              <input type="date" className="input flex-1" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── QUICK ACTIONS ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <ActionTile to="/anomalies" icon={AlertTriangle} label={t('dashboard.quickActions.anomalyScan')} color="#fca5a5" bg="rgba(239,68,68,0.08)" border="rgba(239,68,68,0.2)" />
        <ActionTile to="/alerts"    icon={Bell}          label={t('dashboard.quickActions.viewAlerts')}      color="#fde68a" bg="rgba(245,158,11,0.08)" border="rgba(245,158,11,0.2)" />
        <ActionTile to="/upload"    icon={Upload}        label={t('dashboard.quickActions.uploadData')}      color="#93c5fd" bg="rgba(59,130,246,0.08)"  border="rgba(59,130,246,0.2)" />
        <ActionTile to="/inspections" icon={ClipboardCheck} label={t('dashboard.quickActions.inspections')}   color="#86efac" bg="rgba(22,163,74,0.08)"  border="rgba(22,163,74,0.2)" />
        <ActionTile to="/ai-command-center" icon={Cpu}   label={t('dashboard.quickActions.aiCommand')}       color="#d8b4fe" bg="rgba(139,92,246,0.08)" border="rgba(139,92,246,0.2)" />
      </div>

      {/* ── INTEL ROW - Avg Life + Seasonal ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Avg tyre life */}
        <div className="card flex flex-col items-center justify-center text-center gap-1 py-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-2"
            style={{ background:'rgba(59,130,246,0.1)', border:'1px solid rgba(59,130,246,0.25)' }}>
            <Clock size={16} className="text-blue-400" />
          </div>
          <p className="text-label">{t('dashboard.intel.avgTyreLife')}</p>
          <p className="text-3xl font-extrabold text-blue-400 leading-none mt-1 tabular-nums">
            {tyreLife?.avgLifeDays != null ? tyreLife.avgLifeDays : '-'}
          </p>
          <p className="text-xs text-gray-600">{t('dashboard.intel.days')}</p>
          {tyreLife?.avgLifeKm != null && <p className="text-[10px] text-gray-700 mt-0.5">{t('dashboard.intel.kmAvg', { km: tyreLife.avgLifeKm.toLocaleString() })}</p>}
        </div>

        {/* Seasonal chart */}
        <ChartPanel title={t('dashboard.charts.seasonalPattern')} subtitle={t('dashboard.charts.seasonalSubtitle')} icon={BarChart2} className="lg:col-span-2">
          <div className="h-28">
            <Bar data={seasonalBarData} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:{ color:'#4b5563', font:{ size:9 } }, grid:{ display:false } }, y:{ ticks:{ color:'#4b5563', font:{ size:9 } }, grid: GRID } } }} />
          </div>
        </ChartPanel>
      </div>

      {/* ── MAIN CHART + BRAND ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ChartPanel title={periodChartTitle} subtitle={t('dashboard.charts.periodSubtitle', { period: dateShortcut, count: tyres.length.toLocaleString() })} icon={TrendingUp} onExpand={() => setExpandedChart('main')} className="lg:col-span-2">
          <div className="h-60">
            <Bar data={periodChartData} options={{ ...BASE_OPTS, plugins: { legend: LEGEND } }} />
          </div>
        </ChartPanel>
        <ChartPanel title={t('dashboard.charts.brandBreakdown')} subtitle={t('dashboard.charts.brandSubtitle')} icon={Shield}>
          <div className="h-60 flex items-center justify-center">
            {brandData
              ? <Doughnut data={brandData} options={NO_SCALE} />
              : <EmptyState compact icon="database" title={t('dashboard.charts.noBrandData')} description={t('dashboard.charts.noBrandDataDesc')} />}
          </div>
        </ChartPanel>
      </div>

      {/* ── COST TREND ───────────────────────────────────────────────────── */}
      <ChartPanel title={t('dashboard.charts.monthlyCostTrend', { currency: activeCurrency })} subtitle={t('dashboard.charts.costSubtitle')} icon={DollarSign} onExpand={() => setExpandedChart('cost')}>
        <div className="h-52">
          <Line data={monthlyCostData} options={{ ...BASE_OPTS, plugins:{ legend:{ display:false }, tooltip: moneyTooltip }, scales:{ x:{ ticks:TICK, grid:GRID }, y:{ ticks:{ ...TICK, callback: moneyTick }, grid:GRID } } }} />
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
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('dashboard.forecast.title')}</h3>
              <p className="text-[11px] text-gray-500">{t('dashboard.forecast.subtitle')} <span className="text-blue-400">{forecastData.confidence}</span></p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { label:t('dashboard.forecast.thisMonth'), value:`~${forecastData.forecastThisMonth}`, color:'text-blue-400' },
            { label:t('dashboard.forecast.nextMonth'), value:`~${forecastData.forecastNextMonth}`, color:'text-blue-300' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl p-3 text-center" style={{ background:'rgba(59,130,246,0.06)', border:'1px solid rgba(59,130,246,0.14)' }}>
              <p className={`text-2xl font-extrabold ${color} leading-none tabular-nums`}>{value}</p>
              <p className="text-label mt-1.5">{label}</p>
            </div>
          ))}
        </div>
        <div className="h-44">
          <Bar data={{ labels: forecastData.chartLabels, datasets: [{ label:t('dashboard.forecast.actual'), data:forecastData.actualData, backgroundColor:'rgba(22,163,74,0.75)', borderRadius:5 }, { label:t('dashboard.forecast.forecast'), data:forecastData.projectedData, backgroundColor:'rgba(59,130,246,0.55)', borderRadius:5 }] }} options={{ ...BASE_OPTS, plugins:{ legend:LEGEND } }} />
        </div>
      </div>

      {/* ── RISK + CATEGORY ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartPanel title={t('dashboard.charts.riskDistribution')} icon={AlertTriangle}>
          <div className="h-52">
            <Bar data={riskDistData} options={{ ...H_BAR, scales:{ x:{ ticks:TICK, grid:GRID }, y:{ ticks:{ color:'#9ca3af' }, grid:GRID } } }} />
          </div>
        </ChartPanel>
        <ChartPanel title={t('dashboard.charts.failureCategoryMix')} icon={Activity}>
          <div className="h-52 flex items-center justify-center">
            {categoryData
              ? <Doughnut data={categoryData} options={NO_SCALE} />
              : <EmptyState compact icon="filter" title={t('dashboard.charts.noCategories')} description={t('dashboard.charts.noCategoriesDesc')} />}
          </div>
        </ChartPanel>
      </div>

      {/* ── TOP ASSETS + SITES ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartPanel title={t('dashboard.charts.topAssets', { currency: activeCurrency })} subtitle={t('dashboard.charts.topAssetsSubtitle')} icon={Cpu}>
          <div className="h-64">
            {topAssetsData
              ? <Bar data={topAssetsData} options={{ ...H_BAR, plugins:{ ...H_BAR.plugins, tooltip: moneyTooltip }, scales:{ x:{ ticks:{ ...TICK, callback: v => `${(v/1000).toFixed(0)}K` }, grid:GRID }, y:{ ticks:{ color:'#9ca3af', font:{ size:10 } }, grid:GRID } } }} />
              : <EmptyState compact icon="database" title={t('dashboard.charts.noAssetData')} />}
          </div>
        </ChartPanel>
        <ChartPanel title={t('dashboard.charts.topSites', { currency: activeCurrency })} subtitle={t('dashboard.charts.topSitesSubtitle')} icon={BarChart2}>
          <div className="h-64">
            {siteCostData
              ? <Bar data={siteCostData} options={{ ...H_BAR, plugins:{ ...H_BAR.plugins, tooltip: moneyTooltip }, scales:{ x:{ ticks:{ ...TICK, callback: v => `${(v/1000).toFixed(0)}K` }, grid:GRID }, y:{ ticks:{ color:'#9ca3af' }, grid:GRID } } }} />
              : <EmptyState compact icon="database" title={t('dashboard.charts.noSiteData')} />}
          </div>
        </ChartPanel>
      </div>

      {/* ── RISK MIX TREND + SPEND SPLIT ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartPanel title={tf('dashboard.charts.riskMixTrend', 'Risk Mix Over Time')} subtitle={tf('dashboard.charts.riskMixSubtitle', 'Monthly tyre volume by risk level · last 12 months')} icon={Activity} onExpand={riskMixData ? () => setExpandedChart('riskMix') : undefined}>
          <div className="h-64">
            {riskMixData
              ? <Bar data={riskMixData} options={STACKED} />
              : <EmptyState compact icon="database" title={tf('dashboard.charts.noRiskTrend', 'No risk trend data')} description={tf('dashboard.charts.noRiskTrendDesc', 'Records with issue dates and risk levels will chart here.')} />}
          </div>
        </ChartPanel>
        <ChartPanel title={tf('dashboard.charts.categorySplit', 'Spend Split ({currency})', { currency: activeCurrency })} subtitle={tf('dashboard.charts.categorySplitSubtitle', 'New vs retread purchase spend')} icon={DollarSign}>
          <div className="h-64 flex items-center justify-center">
            {categorySplitData
              ? <Doughnut data={categorySplitData} options={{ ...NO_SCALE, plugins: { ...NO_SCALE.plugins, tooltip: moneyTooltip } }} />
              : <EmptyState compact icon="database" title={tf('dashboard.charts.noSpendSplit', 'No spend data')} description={tf('dashboard.charts.noSpendSplitDesc', 'Records with cost values will chart here.')} />}
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
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('dashboard.activity.recentTyreRecords')}</h3>
            </div>
            <Link to="/tyres" className="text-[11px] text-green-600 hover:text-green-400 font-medium flex items-center gap-1 transition-colors">
              {t('dashboard.activity.viewAll')} <ChevronRight size={11} />
            </Link>
          </div>
          {recentRecords.length === 0
            ? <EmptyState compact icon="database" title={t('dashboard.activity.noRecords')} description={t('dashboard.activity.noRecordsDesc')} />
            : (
              <div className="space-y-1.5">
                {recentRecords.map((r, i) => (
                  <motion.div key={r.id} initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }} transition={{ delay: i * 0.04 }}
                    className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors group"
                    style={{ background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.04)' }}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(22,163,74,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.025)'}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: r.risk_level === 'Critical' ? '#ef4444' : r.risk_level === 'High' ? '#f97316' : r.risk_level === 'Low' ? '#22c55e' : '#f59e0b' }} />
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
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('dashboard.activity.openActions')}</h3>
            </div>
            <Link to="/actions" className="text-[11px] text-yellow-600 hover:text-yellow-400 font-medium flex items-center gap-1 transition-colors">
              {t('dashboard.activity.viewAll')} <ChevronRight size={11} />
            </Link>
          </div>
          {openActions.length === 0
            ? <EmptyState compact icon="search" title={t('dashboard.activity.noActions')} description={t('dashboard.activity.noActionsDesc')} />
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
        <ChartModal title={t('dashboard.charts.monthlyCostTrend', { currency: activeCurrency })} onClose={() => setExpandedChart(null)}>
          <Line data={monthlyCostData} options={{ ...BASE_OPTS, plugins:{ legend:{ display:false }, tooltip: moneyTooltip }, scales:{ x:{ ticks:TICK, grid:GRID }, y:{ ticks:{ ...TICK, callback: moneyTick }, grid:GRID } } }} />
        </ChartModal>
      )}
      {expandedChart === 'riskMix' && riskMixData && (
        <ChartModal title={tf('dashboard.charts.riskMixTrend', 'Risk Mix Over Time')} onClose={() => setExpandedChart(null)}>
          <Bar data={riskMixData} options={STACKED} />
        </ChartModal>
      )}
    </div>
  )
}
