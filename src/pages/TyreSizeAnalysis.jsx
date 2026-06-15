import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { normalizePosition } from '../lib/tyrePositions'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  Layers, Download, FileText, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, RefreshCw, Target, BarChart3,
  ChevronDown, ChevronUp, ChevronRight, Loader2, FileSpreadsheet,
  Package, Award, Zap, ShieldAlert, Lightbulb, DollarSign, Activity,
  Filter, X, Calendar, Globe, MapPin, CircleDot,
} from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ──────────────────────────────────────────────────────────────────
const BENCHMARK_GOOD = 1.20
const BENCHMARK_AVG  = 1.80
const MIN_RECORDS_CPK = 5

const DATE_PRESETS = [
  { label: '30d',  days: 30 },
  { label: '90d',  days: 90 },
  { label: '6mo',  days: 180 },
  { label: '1yr',  days: 365 },
  { label: 'All',  days: null },
]

const PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#ec4899','#14b8a6','#f97316','#6366f1','#84cc16',
]

const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel-2)',
      titleColor: '#f3f4f6',
      bodyColor: '#9ca3af',
      borderColor: 'rgba(22,163,74,0.3)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color:'var(--text-muted)' } },
    y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color:'var(--text-muted)' } },
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function calcCpk(r) {
  const km = (r.km_at_removal ?? 0) - (r.km_at_fitment ?? 0)
  if (km <= 0 || !r.cost_per_tyre || r.cost_per_tyre <= 0) return null
  return r.cost_per_tyre / km
}

function calcLife(r) {
  const km = (r.km_at_removal ?? 0) - (r.km_at_fitment ?? 0)
  return km > 0 ? km : null
}

function fmtCpk(v, currency = 'SAR') {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${currency} ${v.toFixed(4)}/km`
}

function fmtKm(v) {
  if (v == null || !isFinite(v) || v === 0) return 'N/A'
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k km`
  return `${Math.round(v)} km`
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${v.toFixed(1)}%`
}

function avg(arr) {
  const clean = arr.filter(v => v != null && isFinite(v))
  if (!clean.length) return null
  return clean.reduce((s, v) => s + v, 0) / clean.length
}

function stdFlag(count) {
  if (count >= 6) return 'Standard'
  if (count >= 2) return 'Low Volume'
  return 'Outlier'
}

function stdFlagColor(flag) {
  if (flag === 'Standard')   return 'text-green-400 bg-green-900/30 border border-green-800'
  if (flag === 'Low Volume') return 'text-yellow-400 bg-yellow-900/30 border border-yellow-800'
  return 'text-red-400 bg-red-900/30 border border-red-800'
}

function cpkColor(cpk) {
  if (cpk == null) return ''
  if (cpk <= BENCHMARK_GOOD) return 'text-green-400'
  if (cpk <= BENCHMARK_AVG)  return 'text-yellow-400'
  return 'text-red-400'
}

function cpkBgCell(cpk) {
  if (cpk == null) return 'bg-gray-800/30'
  if (cpk <= BENCHMARK_GOOD) return 'bg-green-900/40 text-green-300'
  if (cpk <= BENCHMARK_AVG)  return 'bg-yellow-900/40 text-yellow-300'
  return 'bg-red-900/40 text-red-300'
}

// normalizePosition sourced from lib/tyrePositions (coded + free-text aware).

function monthKey(d) {
  if (!d) return null
  const dt = new Date(d)
  if (isNaN(dt)) return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(k) {
  if (!k) return ''
  const [y, m] = k.split('-')
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${names[parseInt(m, 10) - 1]} ${y}`
}

function last12Months() {
  const out = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function TyreSizeAnalysis() {
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Filters
  const [filterCountry, setFilterCountry] = useState('All')
  const [filterSite, setFilterSite]       = useState('All')
  const [filterBrand, setFilterBrand]     = useState('All')
  const [filterPosition, setFilterPosition] = useState('All')
  const [dateFrom, setDateFrom]           = useState('')
  const [dateTo, setDateTo]               = useState('')
  const [activeDatePreset, setActiveDatePreset] = useState('All')

  // UI state
  const [expandedSize, setExpandedSize] = useState(null)
  const [sortField, setSortField]       = useState('count')
  const [sortDir, setSortDir]           = useState('desc')
  const [exporting, setExporting]       = useState(false)

  // ── Fetch ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('tyre_records')
      .select('id,asset_no,serial_number,size,brand,position,cost_per_tyre,km_at_fitment,km_at_removal,risk_level,site,country,tread_depth,issue_date')
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    q.then(({ data, error: err }) => {
      if (err) { setError(err.message); setLoading(false); return }
      setRecords(data || [])
      setLoading(false)
    })
  }, [activeCountry, refreshKey])

  // ── Filter options ───────────────────────────────────────────────────────────
  const filterOptions = useMemo(() => {
    const countries = ['All', ...new Set(records.map(r => r.country).filter(Boolean))].sort()
    const sites     = ['All', ...new Set(records.map(r => r.site).filter(Boolean))].sort()
    const brands    = ['All', ...new Set(records.map(r => r.brand).filter(Boolean))].sort()
    const positions = ['All', 'Steer', 'Drive', 'Trailer', 'Lift Axle', 'Tag Axle', 'Other']
    return { countries, sites, brands, positions }
  }, [records])

  function applyDatePreset(label, days) {
    setActiveDatePreset(label)
    if (!days) { setDateFrom(''); setDateTo(''); return }
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - days)
    setDateFrom(from.toISOString().slice(0, 10))
    setDateTo(to.toISOString().slice(0, 10))
  }

  // ── Filtered records ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return records.filter(r => {
      if (filterCountry !== 'All' && r.country !== filterCountry) return false
      if (filterSite !== 'All' && r.site !== filterSite) return false
      if (filterBrand !== 'All' && r.brand !== filterBrand) return false
      if (filterPosition !== 'All' && normalizePosition(r.position) !== filterPosition) return false
      if (dateFrom && r.issue_date && r.issue_date < dateFrom) return false
      if (dateTo && r.issue_date && r.issue_date > dateTo) return false
      return true
    })
  }, [records, filterCountry, filterSite, filterBrand, filterPosition, dateFrom, dateTo])

  const hasActiveFilter = filterCountry !== 'All' || filterSite !== 'All' || filterBrand !== 'All' ||
    filterPosition !== 'All' || dateFrom !== '' || dateTo !== ''

  function clearFilters() {
    setFilterCountry('All'); setFilterSite('All')
    setFilterBrand('All'); setFilterPosition('All')
    setDateFrom(''); setDateTo(''); setActiveDatePreset('All')
  }

  // ── Size metrics ─────────────────────────────────────────────────────────────
  const sizeMetrics = useMemo(() => {
    const total = filtered.length
    const bySize = {}

    filtered.forEach(r => {
      const sz = (r.size || 'Unknown').trim()
      if (!bySize[sz]) bySize[sz] = { records: [], cpks: [], lives: [], brands: new Set(), sites: new Set(), vehicles: new Set() }
      const g = bySize[sz]
      g.records.push(r)
      const cpk  = calcCpk(r)
      const life = calcLife(r)
      if (cpk != null)  g.cpks.push(cpk)
      if (life != null) g.lives.push(life)
      if (r.brand)   g.brands.add(r.brand)
      if (r.site)    g.sites.add(r.site)
      if (r.asset_no) g.vehicles.add(r.asset_no)
    })

    return Object.entries(bySize)
      .map(([size, g]) => {
        const count     = g.records.length
        const avgCpk    = g.cpks.length >= MIN_RECORDS_CPK ? avg(g.cpks) : null
        const avgLife   = avg(g.lives)
        const brands    = [...g.brands].sort()
        const sites     = [...g.sites].sort()
        const vehicles  = [...g.vehicles]
        const pct       = total > 0 ? (count / total) * 100 : 0
        const failCount = g.records.filter(r => (r.risk_level || '').toLowerCase() === 'high' || (r.risk_level || '').toLowerCase() === 'critical').length
        const failRate  = count > 0 ? (failCount / count) * 100 : 0
        const flag      = stdFlag(count)
        return { size, count, pct, avgCpk, avgLife, brands, sites, vehicles, failRate, flag }
      })
  }, [filtered])

  const sortedSizeMetrics = useMemo(() => {
    const sorted = [...sizeMetrics].sort((a, b) => {
      let va = a[sortField], vb = b[sortField]
      if (va == null) va = sortDir === 'asc' ? Infinity : -Infinity
      if (vb == null) vb = sortDir === 'asc' ? Infinity : -Infinity
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      return sortDir === 'asc' ? va - vb : vb - va
    })
    return sorted
  }, [sizeMetrics, sortField, sortDir])

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  // ── KPI Cards ────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total     = filtered.length
    const uniqueSz  = sizeMetrics.length
    const mostCommon = sizeMetrics.reduce((best, m) => !best || m.count > best.count ? m : best, null)

    const qualified  = sizeMetrics.filter(m => m.avgCpk != null)
    const bestPerf   = qualified.reduce((best, m) => !best || m.avgCpk < best.avgCpk ? m : best, null)

    const stdScore   = total > 0 ? Math.max(0, (1 - uniqueSz / total) * 100) : 0

    return { uniqueSz, total, mostCommon, bestPerf, stdScore }
  }, [filtered, sizeMetrics])

  // ── Fleet average CPK (for consolidation reference) ──────────────────────────
  const fleetAvgCpk = useMemo(() => {
    const all = filtered.map(calcCpk).filter(v => v != null)
    return avg(all)
  }, [filtered])

  // ── Doughnut: top 8 sizes + Other ────────────────────────────────────────────
  const doughnutData = useMemo(() => {
    const top8 = sortedSizeMetrics.slice(0, 8)
    const restCount = sortedSizeMetrics.slice(8).reduce((s, m) => s + m.count, 0)
    const labels = [...top8.map(m => m.size), ...(restCount > 0 ? ['Other'] : [])]
    const data   = [...top8.map(m => m.count), ...(restCount > 0 ? [restCount] : [])]
    return {
      labels,
      datasets: [{
        data,
        backgroundColor: [...PALETTE, '#4b5563'],
        borderColor: 'var(--panel)',
        borderWidth: 2,
      }],
    }
  }, [sortedSizeMetrics])

  const doughnutOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: { color: '#9ca3af', font: { size: 11 }, padding: 12, boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: 'var(--panel-2)',
        titleColor: '#f3f4f6',
        bodyColor: '#9ca3af',
        callbacks: {
          label: ctx => {
            const val = ctx.parsed
            const total = ctx.dataset.data.reduce((s, v) => s + v, 0)
            const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0
            return ` ${val} tyres (${pct}%)`
          },
        },
      },
    },
  }), [])

  // ── Horizontal bar: CPK by size ───────────────────────────────────────────────
  const cpkBarData = useMemo(() => {
    const withCpk = sizeMetrics.filter(m => m.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk).slice(0, 15)
    return {
      labels: withCpk.map(m => m.size),
      datasets: [{
        label: 'Avg CPK',
        data: withCpk.map(m => m.avgCpk),
        backgroundColor: withCpk.map(m =>
          m.avgCpk <= BENCHMARK_GOOD ? 'rgba(16,185,129,0.8)'
            : m.avgCpk <= BENCHMARK_AVG ? 'rgba(245,158,11,0.8)'
            : 'rgba(239,68,68,0.8)'
        ),
        borderRadius: 3,
      }],
    }
  }, [sizeMetrics])

  const cpkBarOpts = useMemo(() => ({
    ...CHART_BASE,
    indexAxis: 'y',
    plugins: {
      ...CHART_BASE.plugins,
      legend: { display: false },
      annotation: {},
      tooltip: {
        ...CHART_BASE.plugins.tooltip,
        callbacks: {
          label: ctx => ` ${activeCurrency} ${ctx.parsed.x.toFixed(4)}/km`,
        },
      },
    },
    scales: {
      x: {
        ...CHART_BASE.scales.x,
        title: { display: true, text: `CPK (${activeCurrency}/km)`, color: '#6b7280' },
      },
      y: { ...CHART_BASE.scales.y },
    },
  }), [activeCurrency])

  // ── Size × Brand Matrix ────────────────────────────────────────────────────────
  const matrixData = useMemo(() => {
    const top5Sizes  = [...sizeMetrics].sort((a, b) => b.count - a.count).slice(0, 5).map(m => m.size)
    const brandCount = {}
    filtered.forEach(r => { if (r.brand) brandCount[r.brand] = (brandCount[r.brand] || 0) + 1 })
    const top5Brands = Object.entries(brandCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b]) => b)

    const matrix = {}
    top5Sizes.forEach(sz => {
      matrix[sz] = {}
      top5Brands.forEach(br => {
        const recs = filtered.filter(r => (r.size || '').trim() === sz && r.brand === br)
        const cpks = recs.map(calcCpk).filter(v => v != null)
        matrix[sz][br] = cpks.length >= 2 ? avg(cpks) : null
      })
    })
    return { sizes: top5Sizes, brands: top5Brands, matrix }
  }, [sizeMetrics, filtered])

  // ── Position-Size Compliance ──────────────────────────────────────────────────
  const posCompliance = useMemo(() => {
    const posGroups = {}
    filtered.forEach(r => {
      const pos = normalizePosition(r.position)
      if (!posGroups[pos]) posGroups[pos] = []
      posGroups[pos].push(r)
    })

    return Object.entries(posGroups).map(([pos, recs]) => {
      const szCount = {}
      recs.forEach(r => {
        const sz = (r.size || 'Unknown').trim()
        szCount[sz] = (szCount[sz] || 0) + 1
      })
      const required = Object.entries(szCount).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sz]) => sz)
      const reqSet   = new Set(required)
      const nonStd   = recs.filter(r => !reqSet.has((r.size || 'Unknown').trim())).length
      const compliance = recs.length > 0 ? ((recs.length - nonStd) / recs.length) * 100 : 100
      return { pos, total: recs.length, required, nonStd, compliance }
    }).sort((a, b) => a.compliance - b.compliance)
  }, [filtered])

  // ── Brand-Size Trend (top 3 combos, 12 months) ────────────────────────────────
  const trendData = useMemo(() => {
    const months = last12Months()

    const comboCount = {}
    filtered.forEach(r => {
      const sz = (r.size || '').trim()
      const br = r.brand || ''
      if (!sz || !br) return
      const key = `${sz} / ${br}`
      comboCount[key] = (comboCount[key] || 0) + 1
    })
    const top3 = Object.entries(comboCount).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k)

    const datasets = top3.map((combo, i) => {
      const [sz, br] = combo.split(' / ')
      const cpkByMonth = {}
      months.forEach(m => { cpkByMonth[m] = [] })
      filtered.forEach(r => {
        const rsz = (r.size || '').trim()
        const rbr = r.brand || ''
        if (rsz !== sz || rbr !== br) return
        const mk = monthKey(r.issue_date)
        if (!mk || !cpkByMonth[mk]) return
        const cpk = calcCpk(r)
        if (cpk != null) cpkByMonth[mk].push(cpk)
      })
      return {
        label: combo,
        data: months.map(m => {
          const vals = cpkByMonth[m]
          return vals.length ? avg(vals) : null
        }),
        borderColor: PALETTE[i],
        backgroundColor: PALETTE[i] + '22',
        tension: 0.3,
        fill: false,
        spanGaps: true,
        pointRadius: 3,
      }
    })

    return { labels: months.map(monthLabel), datasets }
  }, [filtered])

  const trendOpts = useMemo(() => ({
    ...CHART_BASE,
    plugins: {
      ...CHART_BASE.plugins,
      legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
      tooltip: {
        ...CHART_BASE.plugins.tooltip,
        callbacks: { label: ctx => ` ${activeCurrency} ${(ctx.parsed.y ?? 0).toFixed(4)}/km` },
      },
    },
    scales: {
      x: { ...CHART_BASE.scales.x },
      y: {
        ...CHART_BASE.scales.y,
        title: { display: true, text: `CPK (${activeCurrency}/km)`, color: '#6b7280' },
      },
    },
  }), [activeCurrency])

  // ── Consolidation Opportunities ───────────────────────────────────────────────
  const consolidationOps = useMemo(() => {
    const ops = []
    const fleetCpk = fleetAvgCpk

    sizeMetrics.forEach(m => {
      if (m.vehicles.length === 1) {
        ops.push({
          type: 'eliminate',
          title: `Eliminate size ${m.size}`,
          desc: `Used by only 1 vehicle (${m.vehicles[0] || 'unknown'}). Consider eliminating to reduce procurement complexity.`,
          impact: 'Low',
          savings: null,
          size: m.size,
        })
      }

      if (m.brands.length >= 2 && m.avgCpk != null) {
        const brandCpks = m.brands.map(br => {
          const recs = filtered.filter(r => (r.size || '').trim() === m.size && r.brand === br)
          const cpks = recs.map(calcCpk).filter(v => v != null)
          return { brand: br, avgCpk: cpks.length >= 2 ? avg(cpks) : null, count: recs.length }
        }).filter(b => b.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk)

        if (brandCpks.length >= 2) {
          const best  = brandCpks[0]
          const worst = brandCpks[brandCpks.length - 1]
          if (worst.avgCpk / best.avgCpk > 1.25) {
            const annualSavings = worst.count * (worst.avgCpk - best.avgCpk) * (m.avgLife ?? 50000)
            ops.push({
              type: 'standardize',
              title: `Standardize ${m.size} on ${best.brand}`,
              desc: `${best.brand} CPK: ${activeCurrency} ${best.avgCpk.toFixed(4)} vs ${worst.brand} CPK: ${activeCurrency} ${worst.avgCpk.toFixed(4)}. Switch ${worst.count} tyres to ${best.brand}.`,
              impact: 'High',
              savings: annualSavings,
              size: m.size,
            })
          }
        }
      }

      if (fleetCpk && m.avgCpk != null && m.avgCpk > 2 * fleetCpk) {
        const annualSavings = m.count * (m.avgCpk - fleetCpk) * (m.avgLife ?? 50000)
        ops.push({
          type: 'review',
          title: `Review specification for ${m.size}`,
          desc: `Avg CPK of ${activeCurrency} ${m.avgCpk.toFixed(4)}/km is 2× fleet average. Investigate root cause and consider alternative specification.`,
          impact: 'Critical',
          savings: annualSavings,
          size: m.size,
        })
      }
    })

    return ops.sort((a, b) => {
      const rank = { Critical: 0, High: 1, Low: 2 }
      return rank[a.impact] - rank[b.impact]
    })
  }, [sizeMetrics, filtered, fleetAvgCpk, activeCurrency])

  // ── Brand breakdown for expanded row ─────────────────────────────────────────
  function getBrandBreakdown(size) {
    const recs = filtered.filter(r => (r.size || '').trim() === size)
    const byBrand = {}
    recs.forEach(r => {
      const br = r.brand || 'Unknown'
      if (!byBrand[br]) byBrand[br] = { count: 0, cpks: [], lives: [] }
      byBrand[br].count++
      const cpk  = calcCpk(r)
      const life = calcLife(r)
      if (cpk  != null) byBrand[br].cpks.push(cpk)
      if (life != null) byBrand[br].lives.push(life)
    })
    return Object.entries(byBrand)
      .map(([brand, g]) => ({
        brand,
        count: g.count,
        avgCpk:  g.cpks.length  >= 2 ? avg(g.cpks)  : null,
        avgLife: g.lives.length >= 2 ? avg(g.lives) : null,
      }))
      .sort((a, b) => b.count - a.count)
  }

  // ── PDF Export ───────────────────────────────────────────────────────────────
  async function exportPDF() {
    setExporting(true)
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pw = doc.internal.pageSize.width
      doc.setFillColor(22, 101, 52)
      doc.rect(0, 0, pw, 22, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(14); doc.setFont('helvetica', 'bold')
      doc.text('TYREPULSE · Tyre Size & Specification Optimizer', 14, 10)
      doc.setFontSize(9); doc.setFont('helvetica', 'normal')
      doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} | Fleet: ${kpis.total} tyres | Unique Sizes: ${kpis.uniqueSz}`, 14, 17)

      let y = 28
      doc.setFontSize(11); doc.setTextColor(22, 163, 74); doc.setFont('helvetica', 'bold')
      doc.text('Size Distribution Analysis', 14, y); y += 4

      autoTable(doc, {
        startY: y,
        head: [['Size', 'Count', '% Fleet', 'Avg CPK', 'Avg Life', 'Fail Rate', 'Brands', 'Flag']],
        body: sortedSizeMetrics.map(m => [
          m.size, m.count, fmtPct(m.pct),
          m.avgCpk != null ? `${activeCurrency} ${m.avgCpk.toFixed(4)}` : 'N/A',
          fmtKm(m.avgLife), fmtPct(m.failRate),
          m.brands.slice(0, 3).join(', '), m.flag,
        ]),
        styles: { fontSize: 8, fillColor: [17, 24, 39], textColor: [156, 163, 175] },
        headStyles: { fillColor: [22, 101, 52], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [31, 41, 55] },
        margin: { left: 14, right: 14 },
      })

      y = doc.lastAutoTable.finalY + 8
      if (y > 170) { doc.addPage(); y = 14 }

      doc.setFontSize(11); doc.setTextColor(22, 163, 74); doc.setFont('helvetica', 'bold')
      doc.text('Consolidation Recommendations', 14, y); y += 4

      autoTable(doc, {
        startY: y,
        head: [['Size', 'Type', 'Recommendation', 'Impact', 'Est. Annual Savings']],
        body: consolidationOps.map(op => [
          op.size, op.type === 'eliminate' ? 'Eliminate' : op.type === 'standardize' ? 'Standardize' : 'Review',
          op.desc.slice(0, 90),
          op.impact,
          op.savings != null ? `${activeCurrency} ${Math.round(op.savings).toLocaleString()}` : 'N/A',
        ]),
        styles: { fontSize: 7, fillColor: [17, 24, 39], textColor: [156, 163, 175] },
        headStyles: { fillColor: [22, 101, 52], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [31, 41, 55] },
        margin: { left: 14, right: 14 },
      })

      doc.save(`TyreSizeAnalysis_${new Date().toISOString().slice(0, 10)}.pdf`)
    } finally {
      setExporting(false)
    }
  }

  // ── Excel Export ─────────────────────────────────────────────────────────────
  function exportExcel() {
    setExporting(true)
    try {
      const wb = XLSX.utils.book_new()

      const sizeRows = sortedSizeMetrics.map(m => ({
        Size: m.size,
        Count: m.count,
        'Fleet %': fmtPct(m.pct),
        [`Avg CPK (${activeCurrency}/km)`]: m.avgCpk != null ? parseFloat(m.avgCpk.toFixed(4)) : null,
        'Avg Life (km)': m.avgLife != null ? Math.round(m.avgLife) : null,
        'Failure Rate %': m.failRate != null ? parseFloat(m.failRate.toFixed(1)) : null,
        Brands: m.brands.join(', '),
        Sites: m.sites.join(', '),
        'Standardization Flag': m.flag,
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sizeRows), 'Size Distribution')

      const matRows = matrixData.sizes.flatMap(sz =>
        matrixData.brands.map(br => ({
          Size: sz, Brand: br,
          [`Avg CPK (${activeCurrency}/km)`]: matrixData.matrix[sz]?.[br] != null
            ? parseFloat(matrixData.matrix[sz][br].toFixed(4)) : null,
        }))
      )
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matRows), 'Size-Brand Matrix')

      const posRows = posCompliance.map(p => ({
        Position: p.pos,
        'Total Tyres': p.total,
        'Required Sizes': p.required.join(', '),
        'Non-Standard Count': p.nonStd,
        'Compliance %': parseFloat(p.compliance.toFixed(1)),
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(posRows), 'Position Compliance')

      const conRows = consolidationOps.map(op => ({
        Size: op.size,
        Type: op.type,
        Recommendation: op.desc,
        Impact: op.impact,
        'Est. Annual Savings': op.savings != null ? Math.round(op.savings) : null,
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conRows), 'Consolidation Ops')

      XLSX.writeFile(wb, `TyreSizeAnalysis_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-red-400">
        <AlertTriangle className="w-6 h-6" />
        <span>Failed to load data: {error}</span>
      </div>
    )
  }

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 text-gray-600" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-green-400" />
      : <ChevronDown className="w-3 h-3 text-green-400" />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre Size & Specification Optimizer"
        subtitle="Analyze size mix, consolidation opportunities, and procurement optimization"
        icon={Layers}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={exportPDF}
              disabled={exporting}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600 transition-colors text-sm"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              PDF
            </button>
            <button
              onClick={exportExcel}
              disabled={exporting}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600 transition-colors text-sm"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              Excel
            </button>
          </div>
        }
      />

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex gap-1">
            {DATE_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => applyDatePreset(p.label, p.days)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  activeDatePreset === p.label
                    ? 'bg-green-900/50 border-green-700 text-green-300'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >{p.label}</button>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-gray-500" />
              <input
                type="date" value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setActiveDatePreset('') }}
                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-green-600"
              />
              <span className="text-gray-600 text-xs">→</span>
              <input
                type="date" value={dateTo}
                onChange={e => { setDateTo(e.target.value); setActiveDatePreset('') }}
                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-green-600"
              />
            </div>

            {[
              { label: 'Country', value: filterCountry, setter: setFilterCountry, opts: filterOptions.countries, icon: Globe },
              { label: 'Site',    value: filterSite,    setter: setFilterSite,    opts: filterOptions.sites,     icon: MapPin },
              { label: 'Brand',   value: filterBrand,   setter: setFilterBrand,   opts: filterOptions.brands,    icon: Package },
              { label: 'Position',value: filterPosition,setter: setFilterPosition,opts: filterOptions.positions, icon: CircleDot },
            ].map(({ label, value, setter, opts, icon: Icon }) => (
              <div key={label} className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-gray-500" />
                <select
                  value={value}
                  onChange={e => setter(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-green-600"
                >
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}

            {hasActiveFilter && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-red-900/30 border border-red-800 text-red-400 hover:bg-red-900/50 transition-colors"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          <div className="ml-auto text-xs text-gray-500">
            {filtered.length.toLocaleString()} tyres · {kpis.uniqueSz} sizes
          </div>
        </div>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Unique Sizes in Fleet',
            value: kpis.uniqueSz.toString(),
            sub: `across ${kpis.total} tyres`,
            icon: Layers,
            color: 'blue',
          },
          {
            label: 'Most Common Size',
            value: kpis.mostCommon?.size ?? 'N/A',
            sub: kpis.mostCommon ? `${fmtPct(kpis.mostCommon.pct)} of fleet (${kpis.mostCommon.count} tyres)` : '',
            icon: Award,
            color: 'green',
          },
          {
            label: 'Best Performing Size',
            value: kpis.bestPerf?.size ?? 'N/A',
            sub: kpis.bestPerf ? `CPK: ${fmtCpk(kpis.bestPerf.avgCpk, activeCurrency)}` : `Min ${MIN_RECORDS_CPK} records needed`,
            icon: Target,
            color: 'emerald',
          },
          {
            label: 'Standardization Score',
            value: `${kpis.stdScore.toFixed(0)}%`,
            sub: kpis.stdScore >= 70 ? 'Well standardized' : kpis.stdScore >= 40 ? 'Moderate fragmentation' : 'High fragmentation',
            icon: Activity,
            color: kpis.stdScore >= 70 ? 'green' : kpis.stdScore >= 40 ? 'yellow' : 'red',
          },
        ].map(({ label, value, sub, icon: Icon, color }) => {
          const colorMap = {
            blue:    'text-blue-400 bg-blue-900/20 border-blue-800',
            green:   'text-green-400 bg-green-900/20 border-green-800',
            emerald: 'text-emerald-400 bg-emerald-900/20 border-emerald-800',
            yellow:  'text-yellow-400 bg-yellow-900/20 border-yellow-800',
            red:     'text-red-400 bg-red-900/20 border-red-800',
          }
          return (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className="text-xl font-bold text-white truncate">{value}</p>
                  <p className="text-xs text-gray-500 mt-1 truncate">{sub}</p>
                </div>
                <div className={`p-2 rounded-lg border ${colorMap[color]}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* ── Charts Row 1 ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Doughnut */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-green-400" />
            Size Mix Distribution
          </h2>
          {doughnutData.labels.length === 0 ? (
            <div className="flex items-center justify-center h-56 text-gray-500 text-sm">No data</div>
          ) : (
            <div className="h-56">
              <Doughnut data={doughnutData} options={doughnutOpts} />
            </div>
          )}
        </div>

        {/* CPK Horizontal Bar */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-200 mb-1 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-400" />
            CPK by Size (ranked)
          </h2>
          <div className="flex gap-4 text-xs text-gray-500 mb-3">
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-green-500 inline-block" /> ≤{BENCHMARK_GOOD} Good</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-yellow-500 inline-block" /> ≤{BENCHMARK_AVG} Avg</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-red-500 inline-block" /> &gt;{BENCHMARK_AVG} Poor</span>
          </div>
          {cpkBarData.labels.length === 0 ? (
            <div className="flex items-center justify-center h-56 text-gray-500 text-sm">No CPK data (need km fields)</div>
          ) : (
            <div style={{ height: Math.max(200, cpkBarData.labels.length * 26) }}>
              <Bar data={cpkBarData} options={cpkBarOpts} />
            </div>
          )}
        </div>
      </div>

      {/* ── Size Distribution Table ─────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <Layers className="w-4 h-4 text-green-400" />
            Size Distribution Detail
          </h2>
          <span className="text-xs text-gray-500">{sortedSizeMetrics.length} sizes · click row to expand</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950">
                {[
                  { label: 'Size',         field: 'size' },
                  { label: 'Count',        field: 'count' },
                  { label: '% Fleet',      field: 'pct' },
                  { label: 'Avg CPK',      field: 'avgCpk' },
                  { label: 'Avg Life',     field: 'avgLife' },
                  { label: 'Fail Rate %',  field: 'failRate' },
                  { label: 'Brands',       field: null },
                  { label: 'Sites',        field: null },
                  { label: 'Flag',         field: 'flag' },
                ].map(col => (
                  <th
                    key={col.label}
                    onClick={col.field ? () => toggleSort(col.field) : undefined}
                    className={`text-left px-4 py-3 text-gray-400 font-medium whitespace-nowrap ${col.field ? 'cursor-pointer hover:text-gray-200 select-none' : ''}`}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {col.field && <SortIcon field={col.field} />}
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {sortedSizeMetrics.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-gray-500">No tyre records found</td>
                </tr>
              ) : sortedSizeMetrics.map((m, idx) => {
                const isExpanded = expandedSize === m.size
                const brandBreakdown = isExpanded ? getBrandBreakdown(m.size) : []
                return (
                  <>
                    <tr
                      key={m.size}
                      onClick={() => setExpandedSize(isExpanded ? null : m.size)}
                      className={`border-b border-gray-800/50 cursor-pointer transition-colors ${
                        isExpanded ? 'bg-gray-800/60' : idx % 2 === 0 ? 'bg-gray-900 hover:bg-gray-800/40' : 'bg-gray-950 hover:bg-gray-800/40'
                      }`}
                    >
                      <td className="px-4 py-2.5 font-mono text-green-300 font-medium whitespace-nowrap">{m.size}</td>
                      <td className="px-4 py-2.5 text-white font-medium">{m.count.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-gray-300">{fmtPct(m.pct)}</td>
                      <td className={`px-4 py-2.5 font-mono ${cpkColor(m.avgCpk)}`}>
                        {m.avgCpk != null ? `${activeCurrency} ${m.avgCpk.toFixed(4)}` : <span className="text-gray-600">N/A</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-300">{fmtKm(m.avgLife)}</td>
                      <td className={`px-4 py-2.5 ${m.failRate > 20 ? 'text-red-400' : m.failRate > 10 ? 'text-yellow-400' : 'text-gray-300'}`}>
                        {fmtPct(m.failRate)}
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 max-w-[180px] truncate">
                        {m.brands.slice(0, 3).join(', ')}{m.brands.length > 3 ? ` +${m.brands.length - 3}` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 max-w-[140px] truncate">
                        {m.sites.slice(0, 2).join(', ')}{m.sites.length > 2 ? ` +${m.sites.length - 2}` : ''}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${stdFlagColor(m.flag)}`}>
                          {m.flag}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </td>
                    </tr>
                    <AnimatePresence>
                      {isExpanded && (
                        <tr key={`${m.size}-expand`}>
                          <td colSpan={10} className="bg-gray-800/40 border-b border-gray-800">
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="px-4 py-3"
                            >
                              <p className="text-xs font-semibold text-gray-300 mb-2">Brand breakdown for {m.size}</p>
                              <div className="overflow-x-auto">
                                <table className="text-xs w-auto">
                                  <thead>
                                    <tr className="text-gray-500">
                                      <th className="pr-8 py-1 text-left font-medium">Brand</th>
                                      <th className="pr-8 py-1 text-left font-medium">Count</th>
                                      <th className="pr-8 py-1 text-left font-medium">Avg CPK</th>
                                      <th className="pr-8 py-1 text-left font-medium">Avg Life</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {brandBreakdown.map(b => (
                                      <tr key={b.brand} className="border-t border-gray-700/50">
                                        <td className="pr-8 py-1.5 text-gray-200 font-medium">{b.brand}</td>
                                        <td className="pr-8 py-1.5 text-gray-300">{b.count}</td>
                                        <td className={`pr-8 py-1.5 font-mono ${cpkColor(b.avgCpk)}`}>
                                          {b.avgCpk != null ? `${activeCurrency} ${b.avgCpk.toFixed(4)}` : <span className="text-gray-600">N/A</span>}
                                        </td>
                                        <td className="pr-8 py-1.5 text-gray-300">{fmtKm(b.avgLife)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Size × Brand Matrix ─────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-green-400" />
            Size × Brand CPK Performance Matrix
          </h2>
          <div className="flex gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-green-800 inline-block" /> &lt;{BENCHMARK_GOOD}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-yellow-800 inline-block" /> {BENCHMARK_GOOD}–{BENCHMARK_AVG}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-red-800 inline-block" /> &gt;{BENCHMARK_AVG}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          {matrixData.sizes.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">Insufficient data for matrix</div>
          ) : (
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-950">
                  <th className="text-left px-4 py-3 text-gray-400 font-medium">Size / Brand</th>
                  {matrixData.brands.map(br => (
                    <th key={br} className="text-center px-4 py-3 text-gray-400 font-medium whitespace-nowrap">{br}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixData.sizes.map((sz, i) => (
                  <tr key={sz} className={`border-b border-gray-800/50 ${i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-950'}`}>
                    <td className="px-4 py-3 font-mono text-green-300 whitespace-nowrap">{sz}</td>
                    {matrixData.brands.map(br => {
                      const cpk = matrixData.matrix[sz]?.[br]
                      return (
                        <td key={br} className={`px-4 py-3 text-center font-mono rounded-sm ${cpk != null ? cpkBgCell(cpk) : 'text-gray-700'}`}>
                          {cpk != null ? `${cpk.toFixed(3)}` : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Charts Row 2 ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Position-Size Compliance */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              Position-Size Compliance
            </h2>
          </div>
          {posCompliance.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">No position data</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-950 text-gray-400">
                    <th className="text-left px-4 py-2.5 font-medium">Position</th>
                    <th className="text-left px-4 py-2.5 font-medium">Required Sizes</th>
                    <th className="text-right px-4 py-2.5 font-medium">Non-Std</th>
                    <th className="text-right px-4 py-2.5 font-medium">Compliance</th>
                    <th className="px-4 py-2.5 w-28" />
                  </tr>
                </thead>
                <tbody>
                  {posCompliance.map((p, i) => (
                    <tr key={p.pos} className={`border-b border-gray-800/50 ${i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-950'}`}>
                      <td className="px-4 py-2.5 text-gray-200 font-medium">{p.pos}</td>
                      <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">
                        {p.required.join(', ') || '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-right ${p.nonStd > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                        {p.nonStd}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-medium ${
                        p.compliance >= 90 ? 'text-green-400' : p.compliance >= 70 ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        {fmtPct(p.compliance)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="w-full bg-gray-800 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full transition-all ${
                              p.compliance >= 90 ? 'bg-green-500' : p.compliance >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${p.compliance}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Brand-Size CPK Trend */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            Top Size-Brand Combos — CPK Trend (12 months)
          </h2>
          {trendData.datasets.length === 0 ? (
            <div className="flex items-center justify-center h-56 text-gray-500 text-sm">No trend data available</div>
          ) : (
            <div className="h-56">
              <Line data={trendData} options={trendOpts} />
            </div>
          )}
        </div>
      </div>

      {/* ── Consolidation Opportunities ─────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-yellow-400" />
            Consolidation Opportunities
          </h2>
          <span className="text-xs text-gray-500">{consolidationOps.length} recommendations</span>
        </div>

        {consolidationOps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-500">
            <CheckCircle className="w-10 h-10 text-green-700" />
            <p className="text-sm">No consolidation opportunities detected — fleet is well optimized</p>
          </div>
        ) : (
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {consolidationOps.map((op, i) => {
              const impactStyle = {
                Critical: 'border-red-800 bg-red-900/20',
                High:     'border-orange-800 bg-orange-900/20',
                Low:      'border-gray-700 bg-gray-800/40',
              }
              const impactBadge = {
                Critical: 'bg-red-900/50 text-red-300 border border-red-800',
                High:     'bg-orange-900/50 text-orange-300 border border-orange-800',
                Low:      'bg-gray-800 text-gray-400 border border-gray-700',
              }
              const typeIcon = {
                eliminate:   <X className="w-4 h-4 text-red-400" />,
                standardize: <CheckCircle className="w-4 h-4 text-blue-400" />,
                review:      <AlertTriangle className="w-4 h-4 text-yellow-400" />,
              }
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={`rounded-xl border p-4 ${impactStyle[op.impact] || impactStyle.Low}`}
                >
                  <div className="flex items-start gap-2 mb-2">
                    {typeIcon[op.type]}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-100 leading-tight">{op.title}</p>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${impactBadge[op.impact]}`}>
                      {op.impact}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">{op.desc}</p>
                  {op.savings != null && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-green-400">
                      <DollarSign className="w-3.5 h-3.5" />
                      <span>Est. annual savings: <span className="font-semibold">{activeCurrency} {Math.round(op.savings).toLocaleString()}</span></span>
                    </div>
                  )}
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
