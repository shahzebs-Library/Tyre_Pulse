import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  Trash2, AlertTriangle, TrendingDown, TrendingUp, Minus,
  Search, Filter, Download, FileText, FileSpreadsheet,
  RefreshCw, CheckCircle, Clock, DollarSign, Package,
  BarChart3, Building2, Tag, Calendar, Layers, Info,
  ChevronDown, ChevronUp, Loader2, XCircle, ArrowRight,
  Recycle, AlertOctagon, ShieldAlert, Flame, Activity,
} from 'lucide-react'
import { SkeletonTable } from '../components/ui/Skeleton'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../lib/exportUtils'
import { formatMonthYear } from '../lib/formatters'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
)

// ── Constants ─────────────────────────────────────────────────────────────────


const TABS = ['Overview', 'By Brand', 'By Site', 'Disposal Log']

const DATE_RANGE_OPTS = [
  { label: 'Last 30 Days', days: 30 },
  { label: 'Last 90 Days', days: 90 },
  { label: 'Last 180 Days', days: 180 },
  { label: 'Last 365 Days', days: 365 },
  { label: 'All Time', days: null },
]

const REMOVAL_REASONS = ['All', 'Flat', 'Wear', 'Damage', 'Cut', 'Burst', 'Sidewall', 'Other']

const DISPOSAL_STATUSES = {
  Pending:   { text: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700' },
  Disposed:  { text: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700' },
  Retreaded: { text: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700' },
}

// ── Chart defaults ─────────────────────────────────────────────────────────────

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
    },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
  },
}

const CHART_OPTS_NO_SCALES = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
    },
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '-'
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtCurrency(n, currency) {
  if (n == null || isNaN(n)) return '-'
  return `${currency} ${fmt(n, 0)}`
}

function subDays(d, days) {
  const dt = new Date(d)
  dt.setDate(dt.getDate() - days)
  return dt
}

function kmLife(t) {
  const f = Number(t.km_at_fitment)
  const r = Number(t.km_at_removal)
  if (!isNaN(f) && !isNaN(r) && r > f) return r - f
  return null
}

function isScrap(t) {
  return t.risk_level === 'Critical' || t.category === 'Scrap'
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color = 'text-blue-400', warn = false, badge }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-gray-900 border ${warn ? 'border-red-700/60' : 'border-gray-800'} rounded-xl p-4 flex items-start gap-3`}
    >
      <div className={`p-2 rounded-lg bg-gray-800 shrink-0 ${color}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-gray-400 text-xs leading-none">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${color} truncate`}>{value}</p>
        {sub && <p className="text-gray-500 text-xs mt-0.5 leading-tight">{sub}</p>}
        {badge && (
          <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>
    </motion.div>
  )
}

function TrendArrow({ trend }) {
  if (trend === 'up')     return <TrendingUp  size={14} className="text-red-400" />
  if (trend === 'down')   return <TrendingDown size={14} className="text-green-400" />
  return <Minus size={14} className="text-gray-500" />
}

function Badge({ label, cfg }) {
  const c = cfg ?? { text: 'text-gray-400', bg: 'bg-gray-800', border: 'border-gray-600' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-semibold ${c.text} ${c.bg} ${c.border}`}>
      {label}
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function TyreScrapManagement() {
  const { profile } = useAuth()
  const { appSettings, activeCurrency, activeCountry } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  // ── State ───────────────────────────────────────────────────────────────────
  const [allTyres,   setAllTyres]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [activeTab,  setActiveTab]  = useState('Overview')

  // Filters
  const [dateRangeIdx, setDateRangeIdx] = useState(2)          // 180 days default
  const [filterSite,   setFilterSite]   = useState('All')
  const [filterBrand,  setFilterBrand]  = useState('All')
  const [filterReason, setFilterReason] = useState('All')

  // Disposal log search
  const [logSearch,    setLogSearch]    = useState('')
  const [logBrand,     setLogBrand]     = useState('All')
  const [logSite,      setLogSite]      = useState('All')
  const [logDateFrom,  setLogDateFrom]  = useState('')
  const [logDateTo,    setLogDateTo]    = useState('')

  // Disposal statuses persisted in tyre_disposals (V62) - shared across the
  // team instead of one browser's localStorage.
  const [disposals, setDisposals] = useState({})
  const [disposalError, setDisposalError] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase.from('tyre_disposals').select('tyre_record_id,status').then(({ data }) => {
      if (cancelled || !data) return
      setDisposals(Object.fromEntries(data.map((d) => [d.tyre_record_id, d.status])))
    })
    return () => { cancelled = true }
  }, [])

  const listRef = useRef(null)

  // ── Load data ────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await fetchAllPages((from, to) => supabase
        .from('tyre_records')
        .select(
          'id, asset_no, serial_number, brand, size, position, site, country, ' +
          'risk_level, tread_depth, cost_per_tyre, km_at_fitment, km_at_removal, ' +
          'issue_date, removal_date, qty, category, removal_reason'
        )
        .range(from, to))
      if (err) throw err
      setAllTyres(data ?? [])
    } catch (e) {
      setError(e.message ?? 'Failed to load tyre data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Derived: filter window ────────────────────────────────────────────────────
  const cutoffDate = useMemo(() => {
    const days = DATE_RANGE_OPTS[dateRangeIdx].days
    if (days == null) return null
    return subDays(new Date(), days)
  }, [dateRangeIdx])

  // ── Derived: country-filtered base ────────────────────────────────────────────
  const countryFiltered = useMemo(() => {
    if (!activeCountry || activeCountry === 'All') return allTyres
    return allTyres.filter(t => t.country === activeCountry)
  }, [allTyres, activeCountry])

  // ── Derived: apply date + site + brand filters ─────────────────────────────────
  const filtered = useMemo(() => {
    return countryFiltered.filter(t => {
      if (filterSite !== 'All' && t.site !== filterSite) return false
      if (filterBrand !== 'All' && t.brand !== filterBrand) return false
      if (filterReason !== 'All') {
        const reason = (t.removal_reason ?? '').toLowerCase()
        if (!reason.includes(filterReason.toLowerCase())) return false
      }
      if (cutoffDate) {
        const refDate = t.removal_date || t.issue_date
        if (!refDate || new Date(refDate) < cutoffDate) return false
      }
      return true
    })
  }, [countryFiltered, filterSite, filterBrand, filterReason, cutoffDate])

  // ── Scrapped subset ───────────────────────────────────────────────────────────
  const scrapped = useMemo(() => filtered.filter(isScrap), [filtered])
  const allScrapped = useMemo(() => countryFiltered.filter(isScrap), [countryFiltered])

  // ── Unique options for dropdowns ──────────────────────────────────────────────
  const siteOptions = useMemo(() => {
    const s = [...new Set(countryFiltered.map(t => t.site).filter(Boolean))].sort()
    return ['All', ...s]
  }, [countryFiltered])

  const brandOptions = useMemo(() => {
    const b = [...new Set(countryFiltered.map(t => t.brand).filter(Boolean))].sort()
    return ['All', ...b]
  }, [countryFiltered])

  // ── Fleet average km life ─────────────────────────────────────────────────────
  const fleetAvgKmLife = useMemo(() => {
    const lives = allTyres.map(kmLife).filter(v => v != null && v > 0)
    if (!lives.length) return 100000
    return lives.reduce((s, v) => s + v, 0) / lives.length
  }, [allTyres])

  // ── KPIs ──────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalCount    = filtered.length
    const scrapCount    = scrapped.length
    const scrapRate     = totalCount > 0 ? (scrapCount / totalCount) * 100 : 0
    const totalCost     = scrapped.reduce((s, t) => s + (Number(t.cost_per_tyre) || 0), 0)
    const lives         = scrapped.map(kmLife).filter(v => v != null && v > 0)
    const avgKmLife     = lives.length ? lives.reduce((a, b) => a + b, 0) / lives.length : null
    // Retread savings: 30% could have retreaded at 40% lower cost
    const retreadCandidates = Math.round(scrapCount * 0.30)
    const avgCost           = scrapCount > 0 ? totalCost / scrapCount : 0
    const retreadSavings    = retreadCandidates * avgCost * 0.40

    return { scrapCount, totalCost, avgKmLife, scrapRate, retreadSavings, retreadCandidates }
  }, [scrapped, filtered, appSettings])

  // ── Monthly trend (last 12 months) ────────────────────────────────────────────
  const monthlyTrend = useMemo(() => {
    const now = new Date()
    const months = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        label: formatMonthYear(d),
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        count: 0,
        cost: 0,
      })
    }
    allScrapped.forEach(t => {
      const ref = t.removal_date || t.issue_date
      if (!ref) return
      const m = ref.slice(0, 7)
      const bucket = months.find(x => x.key === m)
      if (bucket) {
        bucket.count++
        bucket.cost += Number(t.cost_per_tyre) || 0
      }
    })
    return months
  }, [allScrapped])

  // ── Doughnut: by removal reason ───────────────────────────────────────────────
  const reasonDonut = useMemo(() => {
    const map = {}
    scrapped.forEach(t => {
      const r = t.removal_reason?.trim() || 'Unknown'
      map[r] = (map[r] || 0) + 1
    })
    const labels = Object.keys(map)
    const COLORS = ['#ef4444','#f97316','#eab308','#3b82f6','#8b5cf6','#06b6d4','#10b981','#f43f5e']
    return {
      labels,
      datasets: [{ data: Object.values(map), backgroundColor: COLORS.slice(0, labels.length), borderWidth: 0 }],
    }
  }, [scrapped])

  // ── Doughnut: by position ─────────────────────────────────────────────────────
  const positionDonut = useMemo(() => {
    const map = {}
    scrapped.forEach(t => {
      const p = t.position?.trim() || 'Unknown'
      map[p] = (map[p] || 0) + 1
    })
    const labels = Object.keys(map)
    const COLORS = ['#6366f1','#ec4899','#14b8a6','#f59e0b','#84cc16','#a78bfa','#fb923c','#38bdf8']
    return {
      labels,
      datasets: [{ data: Object.values(map), backgroundColor: COLORS.slice(0, labels.length), borderWidth: 0 }],
    }
  }, [scrapped])

  // ── Early scrap analysis ──────────────────────────────────────────────────────
  const earlyScrap = useMemo(() => {
    const threshold = fleetAvgKmLife * 0.5
    return scrapped.filter(t => {
      const life = kmLife(t)
      return life != null && life < threshold
    })
  }, [scrapped, fleetAvgKmLife])

  // ── Retread opportunity for current month ─────────────────────────────────────
  const thisMonthKey = useMemo(() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
  }, [])

  const thisMonthScrap = useMemo(() => {
    return allScrapped.filter(t => {
      const ref = t.removal_date || t.issue_date
      return ref && ref.slice(0, 7) === thisMonthKey
    })
  }, [allScrapped, thisMonthKey])

  const retreatOpportunity = useMemo(() => {
    const count = Math.round(thisMonthScrap.length * 0.30)
    const avgCost = thisMonthScrap.length > 0
      ? thisMonthScrap.reduce((s, t) => s + (Number(t.cost_per_tyre) || 0), 0) / thisMonthScrap.length
      : 0
    const savings = count * avgCost * 0.40
    return { count, savings }
  }, [thisMonthScrap, appSettings])

  // ── Brand analysis ────────────────────────────────────────────────────────────
  const brandAnalysis = useMemo(() => {
    const map = {}
    filtered.forEach(t => {
      const b = t.brand?.trim() || 'Unknown'
      if (!map[b]) map[b] = { brand: b, total: 0, scrap: 0, lives: [], costs: [], earlyCount: 0 }
      map[b].total++
      if (isScrap(t)) {
        map[b].scrap++
        const life = kmLife(t)
        if (life != null && life > 0) map[b].lives.push(life)
        map[b].costs.push(Number(t.cost_per_tyre) || 0)
        if (life != null && life < fleetAvgKmLife * 0.5) map[b].earlyCount++
      }
    })
    return Object.values(map).map(b => {
      const scrapRate   = b.total > 0 ? (b.scrap / b.total) * 100 : 0
      const avgKm       = b.lives.length ? b.lives.reduce((a, v) => a + v, 0) / b.lives.length : null
      const totalCost   = b.costs.reduce((s, v) => s + v, 0)
      const avgCPK      = avgKm && totalCost > 0 ? totalCost / (avgKm * b.scrap) : null
      const earlyPct    = b.scrap > 0 ? (b.earlyCount / b.scrap) * 100 : 0
      const rec         = scrapRate > 20 ? 'High Scrap - Review' : 'Normal Performance'
      return { ...b, scrapRate, avgKm, avgCPK, earlyPct, rec }
    }).sort((a, b) => b.scrapRate - a.scrapRate)
  }, [filtered, fleetAvgKmLife])

  const brandChartData = useMemo(() => ({
    labels: brandAnalysis.slice(0, 10).map(b => b.brand),
    datasets: [{
      label: 'Scrap Rate %',
      data: brandAnalysis.slice(0, 10).map(b => +b.scrapRate.toFixed(1)),
      backgroundColor: brandAnalysis.slice(0, 10).map(b =>
        b.scrapRate > 20 ? '#ef4444' : b.scrapRate > 10 ? '#f97316' : '#22c55e'
      ),
    }],
  }), [brandAnalysis])

  // ── Site analysis ─────────────────────────────────────────────────────────────
  const siteAnalysis = useMemo(() => {
    const map = {}
    filtered.forEach(t => {
      const s = t.site?.trim() || 'Unknown'
      if (!map[s]) map[s] = { site: s, total: 0, scrap: 0, cost: 0, brands: {}, monthly: {} }
      map[s].total++
      if (isScrap(t)) {
        map[s].scrap++
        map[s].cost += Number(t.cost_per_tyre) || 0
        const b = t.brand?.trim() || 'Unknown'
        map[s].brands[b] = (map[s].brands[b] || 0) + 1
        const ref = t.removal_date || t.issue_date
        if (ref) {
          const mk = ref.slice(0, 7)
          map[s].monthly[mk] = (map[s].monthly[mk] || 0) + 1
        }
      }
    })
    return Object.values(map).map(s => {
      const scrapRate = s.total > 0 ? (s.scrap / s.total) * 100 : 0
      const worstBrand = Object.entries(s.brands).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-'
      // Trend: compare last 2 available months
      const monthKeys = Object.keys(s.monthly).sort()
      let trend = 'stable'
      if (monthKeys.length >= 2) {
        const last  = s.monthly[monthKeys[monthKeys.length - 1]] || 0
        const prev  = s.monthly[monthKeys[monthKeys.length - 2]] || 0
        if (last > prev * 1.1)      trend = 'up'
        else if (last < prev * 0.9) trend = 'down'
      }
      return { ...s, scrapRate, worstBrand, trend }
    }).sort((a, b) => b.scrapRate - a.scrapRate)
  }, [filtered])

  // ── Site grouped bar (last 6 months) ─────────────────────────────────────────
  const siteBarData = useMemo(() => {
    const now = new Date()
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        label: formatMonthYear(d),
        key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      })
    }
    const topSites = siteAnalysis.slice(0, 5).map(s => s.site)
    const COLORS   = ['#3b82f6','#f97316','#a855f7','#22c55e','#ef4444']
    return {
      labels: months.map(m => m.label),
      datasets: topSites.map((site, idx) => ({
        label: site,
        data: months.map(m => {
          const entry = siteAnalysis.find(s => s.site === site)
          return entry?.monthly?.[m.key] ?? 0
        }),
        backgroundColor: COLORS[idx % COLORS.length],
      })),
    }
  }, [siteAnalysis])

  // ── Heat map: brand × site ────────────────────────────────────────────────────
  const heatMapData = useMemo(() => {
    const topBrands = brandAnalysis.slice(0, 6).map(b => b.brand)
    const topSites  = siteAnalysis.slice(0, 6).map(s => s.site)
    const map = {}
    scrapped.forEach(t => {
      const bk = t.brand?.trim() || 'Unknown'
      const sk = t.site?.trim() || 'Unknown'
      if (!topBrands.includes(bk) || !topSites.includes(sk)) return
      const key = `${bk}__${sk}`
      map[key] = (map[key] || 0) + 1
    })
    const maxVal = Math.max(...Object.values(map), 1)
    return { topBrands, topSites, map, maxVal }
  }, [scrapped, brandAnalysis, siteAnalysis])

  // ── Disposal log entries ──────────────────────────────────────────────────────
  const disposalLog = useMemo(() => {
    return allScrapped
      .filter(t => {
        if (logSearch) {
          const s = logSearch.toLowerCase()
          if (
            !t.serial_number?.toLowerCase().includes(s) &&
            !t.brand?.toLowerCase().includes(s) &&
            !t.asset_no?.toLowerCase().includes(s) &&
            !t.site?.toLowerCase().includes(s)
          ) return false
        }
        if (logBrand !== 'All' && t.brand !== logBrand) return false
        if (logSite !== 'All' && t.site !== logSite) return false
        if (logDateFrom) {
          const ref = t.removal_date || t.issue_date
          if (!ref || ref < logDateFrom) return false
        }
        if (logDateTo) {
          const ref = t.removal_date || t.issue_date
          if (!ref || ref > logDateTo) return false
        }
        return true
      })
      .sort((a, b) => {
        const da = a.removal_date || a.issue_date || ''
        const db = b.removal_date || b.issue_date || ''
        return db.localeCompare(da)
      })
  }, [allScrapped, logSearch, logBrand, logSite, logDateFrom, logDateTo])

  // ── Mark as disposed ──────────────────────────────────────────────────────────
  const markDisposed = useCallback((id, status = 'Disposed') => {
    setDisposalError('')
    let prevStatus
    setDisposals(prev => {
      prevStatus = prev[id]
      return { ...prev, [id]: status }
    })
    supabase.from('tyre_disposals')
      .upsert({ tyre_record_id: id, status }, { onConflict: 'tyre_record_id' })
      .then(({ error: err }) => {
        if (err) {
          setDisposals(prev => ({ ...prev, [id]: prevStatus ?? 'Pending' }))
          setDisposalError(`Could not save the disposal status: ${err.message}`)
        }
      })
  }, [])

  // ── Monthly trend chart data ──────────────────────────────────────────────────
  const trendChartData = useMemo(() => ({
    labels: monthlyTrend.map(m => m.label),
    datasets: [
      {
        label: 'Scrap Count',
        data: monthlyTrend.map(m => m.count),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.12)',
        fill: true,
        tension: 0.4,
        yAxisID: 'y',
      },
      {
        label: `Cost (${activeCurrency})`,
        data: monthlyTrend.map(m => Math.round(m.cost)),
        borderColor: '#f97316',
        backgroundColor: 'rgba(249,115,22,0.08)',
        fill: false,
        tension: 0.4,
        yAxisID: 'y1',
      },
    ],
  }), [monthlyTrend, activeCurrency])

  const trendChartOpts = useMemo(() => ({
    ...CHART_OPTS,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#1f2937' } },
      y: {
        position: 'left',
        ticks: { color: '#9ca3af', font: { size: 10 } },
        grid: { color: '#1f2937' },
        title: { display: true, text: 'Count', color: '#6b7280', font: { size: 10 } },
      },
      y1: {
        position: 'right',
        ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => `${activeCurrency} ${fmt(v)}` },
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'Cost', color: '#6b7280', font: { size: 10 } },
      },
    },
  }), [activeCurrency])

  // ── Exports ───────────────────────────────────────────────────────────────────
  async function exportDisposalPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const filename = `TyrePulse_Scrap_Disposal_Manifest_${new Date().toISOString().slice(0, 10)}.pdf`
    const title = 'Tyre Scrap Disposal Manifest'

    if (disposalLog.length === 0) {
      pdfHeader(doc, title, `0 records · ${activeCurrency}`, company, brand)
      pdfEmptyState(doc, 'No scrap disposals for the selected period', 'Adjust the filters and export again.')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(filename)
      return
    }

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 30,
      margin: { left: 10, right: 10, top: 28 },
      head: [['Serial No', 'Brand', 'Size', 'Position', 'Asset', 'Site', 'Date Removed', 'km Life', 'Cost', 'Removal Reason', 'Disposal Status']],
      body: disposalLog.map(t => [
        t.serial_number ?? '-',
        t.brand ?? '-',
        t.size ?? '-',
        t.position ?? '-',
        t.asset_no ?? '-',
        t.site ?? '-',
        t.removal_date || t.issue_date || '-',
        kmLife(t) != null ? fmt(kmLife(t)) : '-',
        t.cost_per_tyre != null ? `${activeCurrency} ${fmt(Number(t.cost_per_tyre))}` : '-',
        t.removal_reason ?? '-',
        disposals[t.id] ?? 'Pending',
      ]),
      didDrawPage: () => pdfHeader(doc, title, `${disposalLog.length} records · ${activeCurrency}`, company, brand),
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save(filename)
  }

  async function exportDisposalExcel() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const rows = disposalLog.map(t => ({
      'Serial No':        t.serial_number ?? '',
      'Brand':            t.brand ?? '',
      'Size':             t.size ?? '',
      'Position':         t.position ?? '',
      'Asset No':         t.asset_no ?? '',
      'Site':             t.site ?? '',
      'Country':          t.country ?? '',
      'Date Removed':     t.removal_date || t.issue_date || '',
      'km at Fitment':    t.km_at_fitment ?? '',
      'km at Removal':    t.km_at_removal ?? '',
      'km Life':          kmLife(t) ?? '',
      [`Cost (${activeCurrency})`]: t.cost_per_tyre ?? '',
      'Removal Reason':   t.removal_reason ?? '',
      'Risk Level':       t.risk_level ?? '',
      'Category':         t.category ?? '',
      'Disposal Status':  disposals[t.id] ?? 'Pending',
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Scrap Log')

    // Summary sheet
    const summaryRows = brandAnalysis.map(b => ({
      'Brand':          b.brand,
      'Total Tyres':    b.total,
      'Total Scrapped': b.scrap,
      'Scrap Rate %':   +b.scrapRate.toFixed(1),
      'Avg km Life':    b.avgKm != null ? Math.round(b.avgKm) : '',
      'Avg CPK':        b.avgCPK != null ? +b.avgCPK.toFixed(4) : '',
      'Early Scrap %':  +b.earlyPct.toFixed(1),
      'Recommendation': b.rec,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Brand Analysis')

    XLSX.writeFile(wb, `TyrePulse_Scrap_Management_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      <PageHeader
        title="Tyre Scrap Management"
        subtitle="Record and analyse tyre scrap events and root causes"
        icon={Trash2}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={exportDisposalPdf}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition"
          >
            <FileText size={14} /> PDF
          </button>
          <button
            onClick={exportDisposalExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition"
          >
            <FileSpreadsheet size={14} /> Excel
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          </div>
        }
      />

      {/* ── Error banner ── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 flex items-center gap-3"
          >
            <AlertOctagon className="text-red-400 shrink-0" size={18} />
            <p className="text-red-300 text-sm flex-1">{error}</p>
            <button onClick={loadData} className="text-red-400 hover:text-red-200 text-xs underline shrink-0">Retry</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Global filter bar ── */}
      <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
        <select
          value={dateRangeIdx}
          onChange={e => setDateRangeIdx(Number(e.target.value))}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-red-600"
        >
          {DATE_RANGE_OPTS.map((o, i) => (
            <option key={o.label} value={i}>{o.label}</option>
          ))}
        </select>

        <select
          value={filterSite}
          onChange={e => setFilterSite(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-red-600"
        >
          {siteOptions.map(s => <option key={s}>{s}</option>)}
        </select>

        <select
          value={filterBrand}
          onChange={e => setFilterBrand(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-red-600"
        >
          {brandOptions.map(b => <option key={b}>{b}</option>)}
        </select>

        <select
          value={filterReason}
          onChange={e => setFilterReason(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-red-600"
        >
          {REMOVAL_REASONS.map(r => <option key={r}>{r}</option>)}
        </select>

        <div className="flex items-center gap-2 ml-auto text-xs text-gray-500">
          <Filter size={12} />
          <span>{scrapped.length} scrapped of {filtered.length} tyres</span>
        </div>
      </div>

      {/* ── Loading state ── */}
      {loading && <SkeletonTable rows={8} cols={6} />}

      {!loading && (
        <>
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
            <KpiCard
              icon={Trash2}
              label="Total Scrapped"
              value={fmt(kpis.scrapCount)}
              sub={`${DATE_RANGE_OPTS[dateRangeIdx].label}`}
              color="text-red-400"
              warn={kpis.scrapCount > 0}
            />
            <KpiCard
              icon={DollarSign}
              label="Total Scrap Cost"
              value={fmtCurrency(kpis.totalCost, activeCurrency)}
              sub="cumulative disposal cost"
              color="text-orange-400"
            />
            <KpiCard
              icon={Activity}
              label="Avg km Life at Scrap"
              value={kpis.avgKmLife != null ? `${fmt(kpis.avgKmLife)} km` : '-'}
              sub={`Fleet avg: ${fmt(fleetAvgKmLife)} km`}
              color={
                kpis.avgKmLife != null && kpis.avgKmLife < fleetAvgKmLife * 0.6
                  ? 'text-red-400'
                  : kpis.avgKmLife != null && kpis.avgKmLife < fleetAvgKmLife * 0.8
                  ? 'text-yellow-400'
                  : 'text-green-400'
              }
            />
            <KpiCard
              icon={BarChart3}
              label="Scrap Rate"
              value={kpis.scrapRate > 0 ? `${kpis.scrapRate.toFixed(1)}%` : '0%'}
              sub={`${kpis.scrapCount} of ${filtered.length} tyres`}
              color={
                kpis.scrapRate > 25 ? 'text-red-400'
                  : kpis.scrapRate > 15 ? 'text-orange-400'
                  : kpis.scrapRate > 8 ? 'text-yellow-400'
                  : 'text-green-400'
              }
              badge={
                kpis.scrapRate > 25
                  ? { label: 'Critical - Investigate', cls: 'text-red-400 bg-red-900/30 border-red-700' }
                  : kpis.scrapRate > 15
                  ? { label: 'Elevated - Monitor', cls: 'text-orange-400 bg-orange-900/30 border-orange-700' }
                  : null
              }
            />
            <KpiCard
              icon={Recycle}
              label="Potential Retread Savings"
              value={fmtCurrency(kpis.retreadSavings, activeCurrency)}
              sub={`~${kpis.retreadCandidates} units could be retreaded`}
              color="text-blue-400"
            />
          </div>

          {/* ── Tabs ── */}
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                  activeTab === t
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* ══════════════════════════════════════════════════════════════════════
              Tab: Overview
          ════════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'Overview' && (
            <div className="space-y-5">

              {/* Retread opportunity banner */}
              <AnimatePresence>
                {retreatOpportunity.count > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-blue-900/30 border border-blue-700 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <Recycle className="text-blue-400 shrink-0" size={20} />
                      <div>
                        <p className="font-bold text-blue-300 text-sm">
                          {retreatOpportunity.count} tyre{retreatOpportunity.count !== 1 ? 's' : ''} this month may qualify for retreading
                        </p>
                        <p className="text-blue-400/80 text-xs">
                          Estimated savings: {fmtCurrency(retreatOpportunity.savings, activeCurrency)} - retreading at 40% lower cost vs new replacement
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="text-blue-400 shrink-0" size={18} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Monthly trend + reason doughnut */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-400 font-medium mb-3 flex items-center gap-2">
                    <TrendingDown className="text-red-400" size={13} /> Monthly Scrap Trend - Last 12 Months
                  </p>
                  <div className="h-52">
                    {monthlyTrend.some(m => m.count > 0)
                      ? <Line data={trendChartData} options={trendChartOpts} />
                      : <EmptyChart />
                    }
                  </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-400 font-medium mb-3">Scrap by Removal Reason</p>
                  <div className="h-52">
                    {reasonDonut.labels.length > 0
                      ? <Doughnut data={reasonDonut} options={CHART_OPTS_NO_SCALES} />
                      : <EmptyChart />
                    }
                  </div>
                </div>
              </div>

              {/* Position doughnut + early scrap */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-400 font-medium mb-3">Scrap by Tyre Position</p>
                  <div className="h-52">
                    {positionDonut.labels.length > 0
                      ? <Doughnut data={positionDonut} options={CHART_OPTS_NO_SCALES} />
                      : <EmptyChart />
                    }
                  </div>
                </div>

                <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-400 font-medium flex items-center gap-2">
                      <AlertTriangle className="text-yellow-400" size={13} />
                      Early Scrap Analysis
                      <span className="text-gray-600">(&lt;50% of expected fleet life)</span>
                    </p>
                    {earlyScrap.length > 0 && (
                      <span className="text-yellow-400 font-bold text-sm">{earlyScrap.length} tyres</span>
                    )}
                  </div>

                  {earlyScrap.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-gray-500 text-sm flex-col gap-2">
                      <CheckCircle size={28} className="text-green-600" />
                      No early scrap detected in current filter window
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-800">
                            <th className="py-2 text-left">Serial</th>
                            <th className="py-2 text-left">Brand</th>
                            <th className="py-2 text-left">Position</th>
                            <th className="py-2 text-left">Site</th>
                            <th className="py-2 text-right">km Life</th>
                            <th className="py-2 text-right">% of Avg</th>
                            <th className="py-2 text-left">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {earlyScrap.slice(0, 8).map(t => {
                            const life = kmLife(t) ?? 0
                            const pct  = fleetAvgKmLife > 0 ? (life / fleetAvgKmLife) * 100 : 0
                            return (
                              <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                                <td className="py-1.5 font-mono text-blue-300">{t.serial_number ?? '-'}</td>
                                <td className="py-1.5 text-gray-300">{t.brand}</td>
                                <td className="py-1.5 text-gray-400">{t.position ?? '-'}</td>
                                <td className="py-1.5 text-gray-400">{t.site ?? '-'}</td>
                                <td className="py-1.5 text-right text-red-400 font-semibold">{fmt(life)}</td>
                                <td className="py-1.5 text-right">
                                  <span className={`font-bold ${pct < 30 ? 'text-red-400' : 'text-yellow-400'}`}>
                                    {pct.toFixed(0)}%
                                  </span>
                                </td>
                                <td className="py-1.5 text-gray-500">{t.removal_reason ?? '-'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      {earlyScrap.length > 8 && (
                        <p className="text-gray-600 text-xs mt-2 text-center">
                          + {earlyScrap.length - 8} more - use Disposal Log tab for full list
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Empty state for overview */}
              {scrapped.length === 0 && !loading && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
                  <CheckCircle className="mx-auto text-green-500 mb-3" size={44} />
                  <p className="text-gray-300 font-semibold">No scrapped tyres found</p>
                  <p className="text-gray-500 text-sm mt-1">Try adjusting the date range or filters above</p>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              Tab: By Brand
          ════════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'By Brand' && (
            <div className="space-y-5">

              {/* Top 3 worst performers */}
              {brandAnalysis.filter(b => b.scrap > 0).length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {brandAnalysis.filter(b => b.scrap > 0).slice(0, 3).map((b, i) => (
                    <motion.div
                      key={b.brand}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.07 }}
                      className={`bg-gray-900 border rounded-xl p-4 ${
                        i === 0 ? 'border-red-700/70' : i === 1 ? 'border-orange-700/60' : 'border-yellow-700/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                          i === 0 ? 'text-red-400 bg-red-900/30 border-red-700'
                            : i === 1 ? 'text-orange-400 bg-orange-900/30 border-orange-700'
                            : 'text-yellow-400 bg-yellow-900/30 border-yellow-700'
                        }`}>
                          #{i + 1} Worst Performer
                        </span>
                        <Flame size={14} className={i === 0 ? 'text-red-400' : i === 1 ? 'text-orange-400' : 'text-yellow-400'} />
                      </div>
                      <p className="font-bold text-gray-100 text-lg">{b.brand}</p>
                      <p className={`text-3xl font-extrabold mt-0.5 ${
                        i === 0 ? 'text-red-400' : i === 1 ? 'text-orange-400' : 'text-yellow-400'
                      }`}>
                        {b.scrapRate.toFixed(1)}%
                      </p>
                      <p className="text-gray-500 text-xs mt-0.5">scrap rate · {b.scrap} of {b.total}</p>
                      <div className="mt-2 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            i === 0 ? 'bg-red-500' : i === 1 ? 'bg-orange-500' : 'bg-yellow-500'
                          }`}
                          style={{ width: `${Math.min(b.scrapRate, 100)}%` }}
                        />
                      </div>
                      {b.avgKm != null && (
                        <p className="text-gray-500 text-xs mt-2">
                          Avg km life: <span className="text-gray-300 font-semibold">{fmt(b.avgKm)} km</span>
                        </p>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Brand bar chart */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-400 font-medium mb-3">Scrap Rate by Brand (Top 10)</p>
                <div className="h-56">
                  {brandAnalysis.length > 0
                    ? <Bar data={brandChartData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
                    : <EmptyChart />
                  }
                </div>
              </div>

              {/* Brand table */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                  <Tag className="text-blue-400" size={15} />
                  <h2 className="font-semibold text-gray-200 text-sm">Brand Scrap Performance</h2>
                </div>
                {brandAnalysis.length === 0 ? (
                  <div className="p-10 text-center text-gray-500">
                    No brand data available for current filters
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-gray-400 text-xs">
                          <th className="px-4 py-3 text-left">Brand</th>
                          <th className="px-4 py-3 text-right">Total</th>
                          <th className="px-4 py-3 text-right">Scrapped</th>
                          <th className="px-4 py-3 text-right">Scrap Rate</th>
                          <th className="px-4 py-3 text-right">Avg km Life</th>
                          <th className="px-4 py-3 text-right">Avg CPK</th>
                          <th className="px-4 py-3 text-right">Early Scrap %</th>
                          <th className="px-4 py-3 text-left">Recommendation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {brandAnalysis.map((b, i) => (
                          <motion.tr
                            key={b.brand}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: i * 0.03 }}
                            className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition ${
                              b.scrapRate > 20 ? 'bg-red-900/5' : ''
                            }`}
                          >
                            <td className="px-4 py-3 font-medium text-gray-100">
                              <div className="flex items-center gap-2">
                                {b.scrapRate > 20 && <AlertTriangle size={12} className="text-red-400 shrink-0" />}
                                {b.brand}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-gray-400">{b.total}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={b.scrap > 0 ? 'text-red-400 font-semibold' : 'text-gray-500'}>{b.scrap}</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-14 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      b.scrapRate > 20 ? 'bg-red-500' : b.scrapRate > 10 ? 'bg-orange-500' : 'bg-green-500'
                                    }`}
                                    style={{ width: `${Math.min(b.scrapRate, 100)}%` }}
                                  />
                                </div>
                                <span className={`text-xs font-bold min-w-[3rem] text-right ${
                                  b.scrapRate > 20 ? 'text-red-400' : b.scrapRate > 10 ? 'text-orange-400' : 'text-green-400'
                                }`}>{b.scrapRate.toFixed(1)}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-gray-400 text-xs">
                              {b.avgKm != null ? `${fmt(b.avgKm)} km` : '-'}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-400 text-xs">
                              {b.avgCPK != null ? b.avgCPK.toFixed(4) : '-'}
                            </td>
                            <td className="px-4 py-3 text-right text-xs">
                              <span className={b.earlyPct > 30 ? 'text-red-400 font-bold' : 'text-gray-400'}>
                                {b.earlyPct.toFixed(0)}%
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <Badge
                                label={b.rec}
                                cfg={
                                  b.rec === 'High Scrap - Review'
                                    ? { text: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-700' }
                                    : { text: 'text-green-400', bg: 'bg-green-900/20', border: 'border-green-700/50' }
                                }
                              />
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
                  {brandAnalysis.length} brands · Early scrap = removed at &lt;50% of fleet average km life
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              Tab: By Site
          ════════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'By Site' && (
            <div className="space-y-5">

              {/* Site grouped bar chart */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-400 font-medium mb-3 flex items-center gap-2">
                  <Building2 size={13} className="text-blue-400" /> Scrap Count by Site - Last 6 Months
                </p>
                <div className="h-56">
                  {siteAnalysis.length > 0
                    ? <Bar data={siteBarData} options={CHART_OPTS} />
                    : <EmptyChart />
                  }
                </div>
              </div>

              {/* Site table */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                  <Building2 className="text-blue-400" size={15} />
                  <h2 className="font-semibold text-gray-200 text-sm">Site Scrap Analysis</h2>
                </div>
                {siteAnalysis.length === 0 ? (
                  <div className="p-10 text-center text-gray-500">No site data for current filters</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-gray-400 text-xs">
                          <th className="px-4 py-3 text-left">Site</th>
                          <th className="px-4 py-3 text-right">Total Scrapped</th>
                          <th className="px-4 py-3 text-right">Scrap Cost</th>
                          <th className="px-4 py-3 text-right">Scrap Rate</th>
                          <th className="px-4 py-3 text-left">Worst Brand</th>
                          <th className="px-4 py-3 text-center">Trend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {siteAnalysis.map((s, i) => (
                          <motion.tr
                            key={s.site}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: i * 0.03 }}
                            className="border-b border-gray-800/60 hover:bg-gray-800/30 transition"
                          >
                            <td className="px-4 py-3 font-medium text-gray-100">{s.site}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={s.scrap > 0 ? 'text-red-400 font-semibold' : 'text-gray-500'}>{s.scrap}</span>
                            </td>
                            <td className="px-4 py-3 text-right text-orange-400 text-xs font-medium">
                              {fmtCurrency(s.cost, activeCurrency)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`font-bold text-xs ${
                                s.scrapRate > 20 ? 'text-red-400' : s.scrapRate > 10 ? 'text-orange-400' : 'text-green-400'
                              }`}>
                                {s.scrapRate.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs">{s.worstBrand}</td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <TrendArrow trend={s.trend} />
                                <span className={`text-xs ${
                                  s.trend === 'up' ? 'text-red-400' : s.trend === 'down' ? 'text-green-400' : 'text-gray-500'
                                }`}>
                                  {s.trend === 'up' ? 'Rising' : s.trend === 'down' ? 'Improving' : 'Stable'}
                                </span>
                              </div>
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Heat map: brand × site */}
              {heatMapData.topBrands.length > 0 && heatMapData.topSites.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                    <Layers className="text-purple-400" size={15} />
                    <h2 className="font-semibold text-gray-200 text-sm">Brand × Site Scrap Heat Map</h2>
                    <span className="text-gray-600 text-xs ml-1">(count of scrapped tyres)</span>
                  </div>
                  <div className="overflow-x-auto p-4">
                    <table className="text-xs border-separate" style={{ borderSpacing: '3px' }}>
                      <thead>
                        <tr>
                          <th className="px-2 py-1.5 text-gray-500 text-left font-normal w-24">Brand \ Site</th>
                          {heatMapData.topSites.map(s => (
                            <th key={s} className="px-2 py-1.5 text-gray-400 font-semibold text-center min-w-[80px]">
                              {s}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {heatMapData.topBrands.map(brand => (
                          <tr key={brand}>
                            <td className="px-2 py-1.5 text-gray-300 font-medium">{brand}</td>
                            {heatMapData.topSites.map(site => {
                              const val = heatMapData.map[`${brand}__${site}`] ?? 0
                              const intensity = heatMapData.maxVal > 0 ? val / heatMapData.maxVal : 0
                              const bg = val === 0
                                ? 'bg-gray-800/40'
                                : intensity > 0.7 ? 'bg-red-600'
                                : intensity > 0.4 ? 'bg-orange-500'
                                : intensity > 0.2 ? 'bg-yellow-600'
                                : 'bg-yellow-900/60'
                              return (
                                <td key={site} className={`px-2 py-1.5 text-center rounded font-bold ${bg} ${val > 0 ? 'text-white' : 'text-gray-600'}`}>
                                  {val > 0 ? val : '·'}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-gray-600 text-xs mt-2">
                      Colour scale: <span className="text-yellow-600">Low</span> → <span className="text-orange-500">Medium</span> → <span className="text-red-500">High</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              Tab: Disposal Log
          ════════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'Disposal Log' && (
            <div className="space-y-4" ref={listRef}>

              {/* Log filters */}
              <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                  <input
                    value={logSearch}
                    onChange={e => setLogSearch(e.target.value)}
                    placeholder="Search serial, brand, asset, site..."
                    className="w-full pl-8 pr-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-red-600"
                  />
                </div>
                <select
                  value={logBrand}
                  onChange={e => setLogBrand(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-red-600"
                >
                  {brandOptions.map(b => <option key={b}>{b}</option>)}
                </select>
                <select
                  value={logSite}
                  onChange={e => setLogSite(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-red-600"
                >
                  {siteOptions.map(s => <option key={s}>{s}</option>)}
                </select>
                <input
                  type="date"
                  value={logDateFrom}
                  onChange={e => setLogDateFrom(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-red-600"
                  title="Date from"
                />
                <input
                  type="date"
                  value={logDateTo}
                  onChange={e => setLogDateTo(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-red-600"
                  title="Date to"
                />
                {disposalError && (
                  <p className="w-full text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5">{disposalError}</p>
                )}
                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={exportDisposalExcel}
                    className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition"
                  >
                    <FileSpreadsheet size={14} /> Excel
                  </button>
                  <button
                    onClick={exportDisposalPdf}
                    className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition"
                  >
                    <FileText size={14} /> Manifest
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-400 text-xs">
                        <th className="px-4 py-3 text-left">Serial No</th>
                        <th className="px-4 py-3 text-left">Brand</th>
                        <th className="px-4 py-3 text-left">Size</th>
                        <th className="px-4 py-3 text-left">Position</th>
                        <th className="px-4 py-3 text-left">Asset</th>
                        <th className="px-4 py-3 text-left">Site</th>
                        <th className="px-4 py-3 text-left">Date Removed</th>
                        <th className="px-4 py-3 text-right">km Life</th>
                        <th className="px-4 py-3 text-right">Cost</th>
                        <th className="px-4 py-3 text-left">Removal Reason</th>
                        <th className="px-4 py-3 text-center">Disposal Status</th>
                        <th className="px-4 py-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {disposalLog.length === 0 && (
                        <tr>
                          <td colSpan={12} className="px-4 py-14 text-center text-gray-500">
                            <Trash2 className="inline mb-2 text-gray-700" size={36} />
                            <p className="mt-1 font-medium text-gray-400">No disposal records match current filters</p>
                            <p className="text-xs mt-0.5">Adjust search or date range to find records</p>
                          </td>
                        </tr>
                      )}
                      {disposalLog.map((t, i) => {
                        const life   = kmLife(t)
                        const status = disposals[t.id] ?? 'Pending'
                        const cfg    = DISPOSAL_STATUSES[status] ?? DISPOSAL_STATUSES.Pending
                        return (
                          <motion.tr
                            key={t.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: Math.min(i * 0.02, 0.4) }}
                            className="border-b border-gray-800/60 hover:bg-gray-800/30 transition"
                          >
                            <td className="px-4 py-2.5 font-mono text-blue-300 text-xs">{t.serial_number ?? '-'}</td>
                            <td className="px-4 py-2.5 text-gray-200 font-medium">{t.brand ?? '-'}</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs font-mono">{t.size ?? '-'}</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">{t.position ?? '-'}</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">{t.asset_no ?? '-'}</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">{t.site ?? '-'}</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">
                              {t.removal_date || t.issue_date || '-'}
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs">
                              <span className={life != null ? (life < fleetAvgKmLife * 0.5 ? 'text-red-400 font-semibold' : 'text-gray-300') : 'text-gray-600'}>
                                {life != null ? `${fmt(life)} km` : '-'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-xs text-orange-400">
                              {t.cost_per_tyre != null ? `${activeCurrency} ${fmt(Number(t.cost_per_tyre))}` : '-'}
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 text-xs">{t.removal_reason ?? '-'}</td>
                            <td className="px-4 py-2.5 text-center">
                              <Badge label={status} cfg={cfg} />
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {status === 'Pending' ? (
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => markDisposed(t.id, 'Disposed')}
                                    className="px-2 py-1 bg-green-900/30 hover:bg-green-900/60 border border-green-700/50 rounded text-green-400 text-[10px] font-semibold transition"
                                    title="Mark as Disposed"
                                  >
                                    Dispose
                                  </button>
                                  <button
                                    onClick={() => markDisposed(t.id, 'Retreaded')}
                                    className="px-2 py-1 bg-blue-900/30 hover:bg-blue-900/60 border border-blue-700/50 rounded text-blue-400 text-[10px] font-semibold transition"
                                    title="Mark as Retreaded"
                                  >
                                    Retread
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => markDisposed(t.id, 'Pending')}
                                  className="px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-500 text-[10px] transition"
                                  title="Reset to Pending"
                                >
                                  Reset
                                </button>
                              )}
                            </td>
                          </motion.tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="px-4 py-2 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
                  <span>{disposalLog.length} records</span>
                  <span>
                    {disposalLog.filter(t => (disposals[t.id] ?? 'Pending') === 'Disposed').length} disposed ·&nbsp;
                    {disposalLog.filter(t => (disposals[t.id] ?? 'Pending') === 'Retreaded').length} retreaded ·&nbsp;
                    {disposalLog.filter(t => (disposals[t.id] ?? 'Pending') === 'Pending').length} pending
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── EmptyChart placeholder ─────────────────────────────────────────────────────

function EmptyChart() {
  return (
    <div className="h-full flex items-center justify-center text-gray-600 text-xs flex-col gap-2">
      <BarChart3 size={24} className="text-gray-700" />
      No data available for current filters
    </div>
  )
}
