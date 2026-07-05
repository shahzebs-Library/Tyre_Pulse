import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend, PointElement, LineElement,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  CircleDot, Package, RefreshCw, Trash2, ChevronDown, ChevronUp,
  Search, X, FileText, FileSpreadsheet, TrendingUp, Gauge,
  DollarSign, Activity, Filter, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { exportToPdf, exportToExcel } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import PeriodFilter, { filterByPeriodValue } from '../components/ui/PeriodFilter'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend, PointElement, LineElement,
)

const GRID   = { color: '#1f2937' }
const TICK   = { color: '#9ca3af' }
const LEGEND = { labels: { color: '#9ca3af', boxWidth: 12 } }

const BASE_CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: LEGEND },
  scales: {
    x: { ticks: TICK, grid: GRID },
    y: { ticks: TICK, grid: GRID },
  },
}

const DONUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 12, padding: 12 } },
    tooltip: {
      callbacks: {
        label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString()} (${((ctx.parsed / ctx.dataset.data.reduce((a, b) => a + b, 0)) * 100).toFixed(1)}%)`,
      },
    },
  },
}

const PAGE_SIZE = 25

const KM_BANDS = [
  { label: '0-20k',   min: 0,      max: 20000  },
  { label: '20-40k',  min: 20000,  max: 40000  },
  { label: '40-60k',  min: 40000,  max: 60000  },
  { label: '60-80k',  min: 60000,  max: 80000  },
  { label: '80-100k', min: 80000,  max: 100000 },
  { label: '100k+',   min: 100000, max: Infinity },
]

function kmRun(r) {
  if (r.km_at_fitment == null || r.km_at_removal == null) return null
  const v = r.km_at_removal - r.km_at_fitment
  return v > 0 ? v : null
}

function cpk(r) {
  const km = kmRun(r)
  if (!km || !r.cost_per_tyre) return null
  return r.cost_per_tyre / km
}

function lifecycleStage(r) {
  if ((r.category === 'Scrap') || (r.risk_level === 'Critical' && r.km_at_removal != null)) return 'Scrapped'
  if (r.category === 'Retread') return 'Retreaded'
  if (r.km_at_removal != null && r.tread_depth != null && r.tread_depth >= 3) return 'Retread Eligible'
  if (r.km_at_removal != null) return 'Removed'
  return 'In Service'
}

function stageColor(stage) {
  switch (stage) {
    case 'In Service':      return 'text-green-400 bg-green-400/10'
    case 'Retread Eligible':return 'text-cyan-400 bg-cyan-400/10'
    case 'Retreaded':       return 'text-blue-400 bg-blue-400/10'
    case 'Scrapped':        return 'text-red-400 bg-red-400/10'
    case 'Removed':         return 'text-gray-400 bg-gray-400/10'
    default:                return 'text-gray-500 bg-gray-500/10'
  }
}

export default function TyreLifecycle() {
  const { activeCountry, activeCurrency } = useSettings()

  const [records, setRecords]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [expandedSerial, setExpandedSerial] = useState(null)

  // Filters
  const [search, setSearch]         = useState('')
  const [filterBrand, setFilterBrand]     = useState('')
  const [filterSite, setFilterSite]       = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [period, setPeriod]         = useState({ mode: 'all' })
  const [page, setPage]             = useState(1)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data } = await fetchAllPages((from, to) => {
      let q = supabase
        .from('tyre_records')
        .select('id,asset_no,serial_number,position,brand,size,tread_depth,cost_per_tyre,issue_date,km_at_fitment,km_at_removal,risk_level,site,country,category')
        .order('issue_date', { ascending: false })
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      return q.range(from, to)
    })
    setRecords(data || [])
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { fetchData() }, [fetchData])

  const uniqueBrands = useMemo(() => [...new Set(records.map(r => r.brand).filter(Boolean))].sort(), [records])
  const uniqueSites  = useMemo(() => [...new Set(records.map(r => r.site).filter(Boolean))].sort(), [records])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return filterByPeriodValue(records, period, 'issue_date').filter(r => {
      if (search && !(
        (r.serial_number || '').toLowerCase().includes(q) ||
        (r.asset_no || '').toLowerCase().includes(q)
      )) return false
      if (filterBrand && r.brand !== filterBrand) return false
      if (filterSite && r.site !== filterSite) return false
      if (filterCategory && r.category !== filterCategory) return false
      return true
    })
  }, [records, search, filterBrand, filterSite, filterCategory, period])

  const hasFilter = search || filterBrand || filterSite || filterCategory || period.mode !== 'all'

  function clearFilters() {
    setSearch(''); setFilterBrand(''); setFilterSite('')
    setFilterCategory(''); setPeriod({ mode: 'all' })
    setPage(1)
  }

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = filtered.length
    const serials = new Set(filtered.map(r => r.serial_number).filter(Boolean))
    const totalSerials = serials.size

    const withKm = filtered.filter(r => kmRun(r) != null)
    const avgLife = withKm.length
      ? withKm.reduce((s, r) => s + kmRun(r), 0) / withKm.length
      : 0

    const retreads = filtered.filter(r => r.category === 'Retread').length
    const retreadRate = total > 0 ? (retreads / total) * 100 : 0

    const scrapped = filtered.filter(r =>
      r.category === 'Scrap' || (r.risk_level === 'Critical' && r.km_at_removal != null)
    ).length
    const scrapRate = total > 0 ? (scrapped / total) * 100 : 0

    const cpkVals = filtered.map(r => cpk(r)).filter(v => v != null)
    const avgCpk = cpkVals.length ? cpkVals.reduce((s, v) => s + v, 0) / cpkVals.length : 0

    return { totalSerials, avgLife, retreadRate, scrapRate, avgCpk }
  }, [filtered])

  // ── Funnel stages ────────────────────────────────────────────────────────────
  const funnel = useMemo(() => {
    const newFitment = filtered.filter(r => r.category === 'New' || (!r.category && r.km_at_fitment != null)).length
    const inService  = filtered.filter(r => r.km_at_removal == null).length
    const retreatEl  = filtered.filter(r =>
      r.km_at_removal != null && r.tread_depth != null && r.tread_depth >= 3 &&
      r.category !== 'Scrap' && r.risk_level !== 'Critical'
    ).length
    const retreaded  = filtered.filter(r => r.category === 'Retread').length
    const scrapped   = filtered.filter(r =>
      r.category === 'Scrap' || (r.risk_level === 'Critical' && r.km_at_removal != null)
    ).length

    const total = filtered.length || 1
    const avgCostFor = cat => {
      const sub = filtered.filter(r => {
        if (cat === 'new') return r.category === 'New' || !r.category
        if (cat === 'service') return r.km_at_removal == null
        if (cat === 'eligible') return retreatEl > 0
        if (cat === 'retread') return r.category === 'Retread'
        if (cat === 'scrap') return r.category === 'Scrap' || r.risk_level === 'Critical'
        return false
      })
      const costs = sub.map(r => r.cost_per_tyre).filter(v => v != null)
      return costs.length ? costs.reduce((s, v) => s + v, 0) / costs.length : 0
    }

    return [
      { label: 'New Fitment',      count: newFitment, pct: ((newFitment / total) * 100).toFixed(0), avgCost: avgCostFor('new'),     icon: Package,   color: 'blue'  },
      { label: 'In Service',       count: inService,  pct: ((inService  / total) * 100).toFixed(0), avgCost: avgCostFor('service'), icon: Activity,  color: 'green' },
      { label: 'Retread Eligible', count: retreatEl,  pct: ((retreatEl  / total) * 100).toFixed(0), avgCost: avgCostFor('eligible'),icon: TrendingUp, color: 'cyan'  },
      { label: 'Retreaded',        count: retreaded,  pct: ((retreaded  / total) * 100).toFixed(0), avgCost: avgCostFor('retread'), icon: RefreshCw, color: 'purple'},
      { label: 'Scrapped',         count: scrapped,   pct: ((scrapped   / total) * 100).toFixed(0), avgCost: avgCostFor('scrap'),   icon: Trash2,    color: 'red'   },
    ]
  }, [filtered])

  // ── Brand lifecycle chart ─────────────────────────────────────────────────
  const brandChart = useMemo(() => {
    const brandMap = {}
    filtered.forEach(r => {
      if (!r.brand) return
      const km = kmRun(r)
      if (!km) return
      if (!brandMap[r.brand]) brandMap[r.brand] = { newKm: [], retreadKm: [] }
      if (r.category === 'Retread') brandMap[r.brand].retreadKm.push(km)
      else brandMap[r.brand].newKm.push(km)
    })
    const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
    const brands = Object.entries(brandMap)
      .map(([brand, d]) => ({ brand, newAvg: avg(d.newKm), retreadAvg: avg(d.retreadKm), totalAvg: avg([...d.newKm, ...d.retreadKm]) }))
      .filter(b => b.totalAvg > 0)
      .sort((a, b) => b.totalAvg - a.totalAvg)
      .slice(0, 12)

    return {
      labels: brands.map(b => b.brand),
      datasets: [
        {
          label: 'New (avg km)',
          data: brands.map(b => Math.round(b.newAvg)),
          backgroundColor: 'rgba(59,130,246,0.7)',
          borderRadius: 4,
        },
        {
          label: 'Retread (avg km)',
          data: brands.map(b => Math.round(b.retreadAvg)),
          backgroundColor: 'rgba(139,92,246,0.7)',
          borderRadius: 4,
        },
      ],
    }
  }, [filtered])

  // ── Cost doughnut ─────────────────────────────────────────────────────────
  const costDonut = useMemo(() => {
    const sum = arr => arr.reduce((s, r) => s + (r.cost_per_tyre || 0) * (r.qty || 1), 0)
    const newCost      = sum(filtered.filter(r => r.category === 'New' || !r.category))
    const retreadCost  = sum(filtered.filter(r => r.category === 'Retread'))
    const repairCost   = sum(filtered.filter(r => r.category === 'Repaired'))
    const emergencyCost= sum(filtered.filter(r =>
      r.risk_level === 'Critical' && r.category !== 'Retread' && r.category !== 'Repaired'
    ))
    return {
      labels: ['New Tyres', 'Retreads', 'Repairs', 'Emergency'],
      datasets: [{
        data: [newCost, retreadCost, repairCost, emergencyCost],
        backgroundColor: [
          'rgba(59,130,246,0.8)',
          'rgba(139,92,246,0.8)',
          'rgba(245,158,11,0.8)',
          'rgba(239,68,68,0.8)',
        ],
        borderColor: 'var(--panel)',
        borderWidth: 2,
      }],
    }
  }, [filtered])

  // ── Age distribution ──────────────────────────────────────────────────────
  const ageDistChart = useMemo(() => {
    const counts = KM_BANDS.map(band =>
      filtered.filter(r => {
        const km = kmRun(r)
        return km != null && km >= band.min && km < band.max
      }).length
    )
    return {
      labels: KM_BANDS.map(b => b.label),
      datasets: [{
        label: 'Tyres',
        data: counts,
        backgroundColor: counts.map((_, i) => {
          const pct = i / (KM_BANDS.length - 1)
          return `rgba(${Math.round(59 + 180 * pct)},${Math.round(130 - 80 * pct)},${Math.round(246 - 180 * pct)},0.75)`
        }),
        borderRadius: 4,
      }],
    }
  }, [filtered])

  // ── Pagination ─────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageData   = useMemo(() =>
    filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  )

  useEffect(() => { setPage(1) }, [search, filterBrand, filterSite, filterCategory, period])

  // ── Expand row - fetch all records for that serial ────────────────────────
  const [serialHistory, setSerialHistory] = useState({})

  async function toggleExpand(serial) {
    if (expandedSerial === serial) { setExpandedSerial(null); return }
    setExpandedSerial(serial)
    if (serialHistory[serial]) return
    const { data } = await supabase
      .from('tyre_records')
      .select('id,asset_no,serial_number,position,brand,size,issue_date,km_at_fitment,km_at_removal,category,risk_level,cost_per_tyre,site')
      .eq('serial_number', serial)
      .order('issue_date')
    setSerialHistory(prev => ({ ...prev, [serial]: data || [] }))
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function handlePdfExport() {
    const cols = [
      { key: 'serial_number', header: 'Serial' },
      { key: 'brand',         header: 'Brand' },
      { key: 'size',          header: 'Size' },
      { key: 'position',      header: 'Position' },
      { key: 'asset_no',      header: 'Asset' },
      { key: 'site',          header: 'Site' },
      { key: 'issue_date',    header: 'Fitment Date' },
      { key: '_removal_date', header: 'Removal Date' },
      { key: '_km_run',       header: 'km Run' },
      { key: 'category',      header: 'Category' },
      { key: '_cpk',          header: 'CPK' },
      { key: '_stage',        header: 'Stage' },
    ]
    const rows = filtered.map(r => ({
      ...r,
      _removal_date: r.km_at_removal != null ? (r.issue_date || '') : 'Active',
      _km_run:       kmRun(r) != null ? kmRun(r).toLocaleString() : '-',
      _cpk:          cpk(r) != null ? cpk(r).toFixed(4) : '-',
      _stage:        lifecycleStage(r),
    }))
    exportToPdf(rows, cols, 'Tyre Lifecycle Report', 'TyreLifecycle_Report', 'landscape')
  }

  function handleExcelExport() {
    const columns = ['serial_number','brand','size','position','asset_no','site','issue_date','km_at_fitment','km_at_removal','category','risk_level','cost_per_tyre']
    const headers = ['Serial','Brand','Size','Position','Asset','Site','Fitment Date','km at Fitment','km at Removal','Category','Risk Level','Cost']
    exportToExcel(filtered, columns, headers, 'TyreLifecycle_Export', 'Lifecycle')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading lifecycle data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Lifecycle Tracker"
        subtitle="Full lifecycle visibility from fitment to retirement"
        icon={Activity}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={handlePdfExport} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
              <FileText size={14} /> PDF
            </button>
            <button onClick={handleExcelExport} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
              <FileSpreadsheet size={14} /> Excel
            </button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'Tyres Tracked',  value: kpis.totalSerials.toLocaleString(),              icon: CircleDot,  color: 'blue',   suffix: '' },
          { label: 'Avg Life',       value: Math.round(kpis.avgLife).toLocaleString(),        icon: Gauge,      color: 'green',  suffix: ' km' },
          { label: 'Retread Rate',   value: kpis.retreadRate.toFixed(1),                      icon: RefreshCw,  color: 'purple', suffix: '%' },
          { label: 'Scrap Rate',     value: kpis.scrapRate.toFixed(1),                        icon: Trash2,     color: 'red',    suffix: '%' },
          { label: 'Avg CPK',        value: kpis.avgCpk > 0 ? kpis.avgCpk.toFixed(4) : '-', icon: DollarSign, color: 'yellow', suffix: '' },
        ].map(({ label, value, icon: Icon, color, suffix }) => {
          const colorMap = {
            blue:   'text-blue-400 bg-blue-400/10',
            green:  'text-green-400 bg-green-400/10',
            purple: 'text-purple-400 bg-purple-400/10',
            red:    'text-red-400 bg-red-400/10',
            yellow: 'text-yellow-400 bg-yellow-400/10',
          }
          return (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${colorMap[color]}`}>
                <Icon size={16} />
              </div>
              <p className="text-2xl font-bold text-white">{value}{suffix}</p>
              <p className="text-xs text-gray-500 mt-1">{label}</p>
            </motion.div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-400 font-medium">
          <Filter size={14} />
          <span>Filters</span>
          {hasFilter && (
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors">
              <X size={12} /> Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="relative col-span-2 sm:col-span-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Serial / Asset..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <select
            value={filterBrand}
            onChange={e => setFilterBrand(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All Brands</option>
            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          <select
            value={filterSite}
            onChange={e => setFilterSite(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All Sites</option>
            {uniqueSites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">All Categories</option>
            {['New', 'Retread', 'Repaired', 'Scrap'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <PeriodFilter
            records={records}
            value={period}
            onChange={setPeriod}
            className="col-span-2"
          />
        </div>
      </div>

      {/* Lifecycle Funnel */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-5">Lifecycle Stage Funnel</h2>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1">
          {funnel.map((stage, i) => {
            const colorMap = {
              blue:   { bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   text: 'text-blue-400',   dot: 'bg-blue-500'   },
              green:  { bg: 'bg-green-500/10',  border: 'border-green-500/30',  text: 'text-green-400',  dot: 'bg-green-500'  },
              cyan:   { bg: 'bg-cyan-500/10',   border: 'border-cyan-500/30',   text: 'text-cyan-400',   dot: 'bg-cyan-500'   },
              purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', dot: 'bg-purple-500' },
              red:    { bg: 'bg-red-500/10',    border: 'border-red-500/30',    text: 'text-red-400',    dot: 'bg-red-500'    },
            }
            const c = colorMap[stage.color]
            const Icon = stage.icon
            return (
              <div key={stage.label} className="flex sm:flex-col items-center flex-1">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.07 }}
                  className={`flex-1 sm:w-full rounded-xl border ${c.bg} ${c.border} p-4 text-center`}
                >
                  <div className={`w-8 h-8 rounded-full ${c.bg} border ${c.border} flex items-center justify-center mx-auto mb-2`}>
                    <Icon size={15} className={c.text} />
                  </div>
                  <p className={`text-2xl font-bold ${c.text}`}>{stage.count.toLocaleString()}</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-tight">{stage.label}</p>
                  <p className="text-xs text-gray-500 mt-1">{stage.pct}% of total</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {stage.avgCost > 0
                      ? `Avg ${activeCurrency} ${Math.round(stage.avgCost).toLocaleString()}`
                      : '-'
                    }
                  </p>
                </motion.div>
                {i < funnel.length - 1 && (
                  <div className="hidden sm:flex items-center justify-center w-6 shrink-0">
                    <ChevronRight size={16} className="text-gray-600" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Brand Lifecycle */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Brand Lifecycle Analysis (avg km: New vs Retread)</h2>
          <div style={{ height: 280 }}>
            {brandChart.labels.length > 0 ? (
              <Bar data={brandChart} options={{ ...BASE_CHART_OPTS, plugins: { legend: LEGEND } }} />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                No km data available
              </div>
            )}
          </div>
        </div>

        {/* Cost Doughnut */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Cost per Lifecycle Stage</h2>
          <div style={{ height: 280 }}>
            {costDonut.datasets[0].data.some(v => v > 0) ? (
              <Doughnut data={costDonut} options={DONUT_OPTS} />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                No cost data available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Age Distribution */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Tyre Age Distribution (km bands)</h2>
        <div style={{ height: 220 }}>
          <Bar
            data={ageDistChart}
            options={{
              ...BASE_CHART_OPTS,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: TICK, grid: GRID },
                y: { ticks: TICK, grid: GRID, title: { display: true, text: 'Count', color: '#6b7280' } },
              },
            }}
          />
        </div>
      </div>

      {/* Lifecycle Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">
            Tyre Lifecycle Table
            <span className="ml-2 text-gray-600 font-normal text-xs">
              {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 disabled:opacity-30 hover:bg-gray-700 transition-colors"
            >
              <ChevronLeft size={14} className="text-gray-400" />
            </button>
            <span className="text-xs text-gray-500">{page}/{totalPages}</span>
            <button
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 disabled:opacity-30 hover:bg-gray-700 transition-colors"
            >
              <ChevronRight size={14} className="text-gray-400" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-800 bg-gray-950/50">
                <th className="px-4 py-3 font-medium">Serial</th>
                <th className="px-4 py-3 font-medium">Brand</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Site</th>
                <th className="px-4 py-3 font-medium">Fitment Date</th>
                <th className="px-4 py-3 font-medium text-right">km Run</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium text-right">CPK</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-16 text-gray-600 text-sm">
                    No records match the current filters
                  </td>
                </tr>
              ) : (
                pageData.map(r => {
                  const stage = lifecycleStage(r)
                  const km    = kmRun(r)
                  const cpkV  = cpk(r)
                  const isExp = expandedSerial === r.serial_number
                  return (
                    <>
                      <tr
                        key={r.id}
                        className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                        onClick={() => r.serial_number && toggleExpand(r.serial_number)}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-gray-300">{r.serial_number || '-'}</td>
                        <td className="px-4 py-3 text-white font-medium">{r.brand || '-'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{r.size || '-'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{r.position || '-'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{r.asset_no || '-'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{r.site || '-'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{r.issue_date || '-'}</td>
                        <td className="px-4 py-3 text-gray-300 text-right tabular-nums">
                          {km != null ? km.toLocaleString() : <span className="text-gray-600">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            r.category === 'Scrap'   ? 'text-red-400 bg-red-400/10' :
                            r.category === 'Retread' ? 'text-purple-400 bg-purple-400/10' :
                            r.category === 'Repaired'? 'text-yellow-400 bg-yellow-400/10' :
                            'text-blue-400 bg-blue-400/10'
                          }`}>
                            {r.category || 'New'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs text-gray-400">
                          {cpkV != null ? cpkV.toFixed(4) : <span className="text-gray-600">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stageColor(stage)}`}>
                            {stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {r.serial_number && (
                            isExp ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                          )}
                        </td>
                      </tr>

                      {/* Expanded history */}
                      <AnimatePresence>
                        {isExp && r.serial_number && (
                          <tr key={`${r.id}-expand`}>
                            <td colSpan={12} className="bg-gray-950/60 border-b border-gray-800">
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="px-6 py-4"
                              >
                                <p className="text-xs font-semibold text-gray-400 mb-3">
                                  Transfer History - Serial: <span className="text-white font-mono">{r.serial_number}</span>
                                </p>
                                {!serialHistory[r.serial_number] ? (
                                  <p className="text-xs text-gray-600">Loading...</p>
                                ) : serialHistory[r.serial_number].length === 0 ? (
                                  <p className="text-xs text-gray-600">No history records found</p>
                                ) : (
                                  <div className="relative pl-4">
                                    <div className="absolute left-1.5 top-0 bottom-0 w-px bg-gray-700" />
                                    {serialHistory[r.serial_number].map((h, idx) => {
                                      const hStage = lifecycleStage(h)
                                      const hKm    = kmRun(h)
                                      return (
                                        <div key={h.id} className="relative flex items-start gap-4 mb-3 last:mb-0">
                                          <div className={`absolute -left-1.5 top-1 w-2.5 h-2.5 rounded-full border-2 border-gray-950 ${
                                            hStage === 'Scrapped'  ? 'bg-red-500' :
                                            hStage === 'Retreaded' ? 'bg-purple-500' :
                                            hStage === 'In Service'? 'bg-green-500' : 'bg-gray-500'
                                          }`} />
                                          <div className="pl-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                                            <span className="text-gray-400">{h.issue_date || '-'}</span>
                                            <span className="text-white">Asset: <span className="text-gray-300">{h.asset_no || '-'}</span></span>
                                            <span className="text-white">Site: <span className="text-gray-300">{h.site || '-'}</span></span>
                                            <span className="text-white">Position: <span className="text-gray-300">{h.position || '-'}</span></span>
                                            <span className="text-white">km: <span className="text-gray-300">{hKm != null ? hKm.toLocaleString() : '-'}</span></span>
                                            <span className={`px-1.5 py-0.5 rounded font-medium ${stageColor(hStage)}`}>{hStage}</span>
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between">
            <span className="text-xs text-gray-600">
              Page {page} of {totalPages} · {filtered.length} records
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(1)} disabled={page === 1} className="px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 text-gray-400 disabled:opacity-30 hover:bg-gray-700 transition-colors">«</button>
              <button onClick={() => setPage(p => p - 1)} disabled={page === 1} className="px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 text-gray-400 disabled:opacity-30 hover:bg-gray-700 transition-colors">‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, totalPages - 4))
                const p = start + i
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      p === page
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {p}
                  </button>
                )
              })}
              <button onClick={() => setPage(p => p + 1)} disabled={page === totalPages} className="px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 text-gray-400 disabled:opacity-30 hover:bg-gray-700 transition-colors">›</button>
              <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="px-2 py-1 text-xs rounded bg-gray-800 border border-gray-700 text-gray-400 disabled:opacity-30 hover:bg-gray-700 transition-colors">»</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
