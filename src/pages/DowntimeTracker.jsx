import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  AlertTriangle, Clock, TrendingDown, DollarSign, Activity,
  Download, RefreshCw, Loader2, FileSpreadsheet, FileText,
  Search, X, Filter, ChevronDown, ChevronUp, Zap,
  CheckCircle2, XCircle, AlertCircle, BarChart2, Maximize2,
} from 'lucide-react'
import StatCard from '../components/StatCard'
import PageHeader from '../components/ui/PageHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import { exportToExcel, exportToPdf, resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme } from '../lib/exportUtils'
import { useTenant } from '../contexts/TenantContext'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Assumptions / Constants ──────────────────────────────────────────────────
// These are ESTIMATION assumptions, not measured facts. Where the `settings`
// table exposes overrides they are applied at runtime (see component body).
const DEFAULT_DOWNTIME_RATE = 850  // assumed cost per hour of downtime (base currency)
const SHIFT_HOURS   = 8            // assumed productive hours per shift-day
const BUDGET_THRESHOLD = 50000     // monthly budget threshold (reference line)
const TARGET_AVAILABILITY = 95     // industry benchmark %

// Assumed downtime hours per removal event by severity - used only as a fallback
// when a linked work order does not provide actual opened/completed timestamps.
const SEVERITY_HOURS = { Critical: 4, High: 3, Medium: 2, Low: 2 }
const SEVERITY_WEIGHT = { Critical: 3, High: 2, Medium: 1, Low: 0.5 }

const PERIOD_PRESETS = [
  { label: '30d',  days: 30  },
  { label: '90d',  days: 90  },
  { label: '6m',   days: 180 },
  { label: '1yr',  days: 365 },
  { label: 'All',  days: null },
]

const RISK_LEVELS = ['Critical', 'High', 'Medium', 'Low']

const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      titleColor: '#f3f4f6',
      bodyColor: '#9ca3af',
      borderColor: 'rgba(34,197,94,0.25)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280', font: { size: 11 } } },
    y: { grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280', font: { size: 11 } } },
  },
}

const PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
]

function fmtCurrency(val, sym) {
  if (!val && val !== 0) return '-'
  if (val >= 1_000_000) return `${sym} ${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000)     return `${sym} ${(val / 1_000).toFixed(1)}K`
  return `${sym} ${Math.round(val).toLocaleString()}`
}

function fmtHours(h) {
  if (!h && h !== 0) return '-'
  if (h >= 1000) return `${(h / 1000).toFixed(1)}K h`
  return `${h.toFixed(1)} h`
}

function periodStart(days) {
  if (!days) return null
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function isoYearMonth(dateStr) {
  if (!dateStr) return null
  return dateStr.slice(0, 7)
}

function last12Months() {
  const months = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

function monthLabel(ym) {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' })
}

// Actual downtime hours from a work order's opened/completed timestamps.
// Returns null when either timestamp is missing or the span is non-positive.
function workOrderHours(wo) {
  if (!wo || !wo.opened_at || !wo.completed_at) return null
  const h = (new Date(wo.completed_at) - new Date(wo.opened_at)) / 3600000
  return h > 0 ? h : null
}

// Downtime hours for a tyre-removal event. Prefers ACTUAL hours from a matched
// work order (keyed on asset_no); falls back to the per-severity ESTIMATE.
// Returns { hours, actual } so callers can flag estimated vs measured values.
function downtimeHours(record, actualByAsset) {
  const actual = actualByAsset && record.asset_no ? actualByAsset.get(record.asset_no) : undefined
  if (actual != null) return { hours: actual, actual: true }
  return { hours: SEVERITY_HOURS[record.risk_level] ?? 2, actual: false }
}

function causeLabel(record) {
  const rl = record.risk_level
  const rfr = (record.reason_for_removal || '').toLowerCase()
  if (rl === 'Critical') return 'Critical Failure'
  if (rfr.includes('pressure') || rfr.includes('blow') || rfr.includes('burst')) return 'Pressure Issue'
  if (rl === 'High') return 'Wear-Related'
  if (rfr.includes('wear') || rfr.includes('worn')) return 'Wear-Related'
  if (rl === 'Low') return 'Routine Replacement'
  if (rl === 'Medium') {
    if (rfr.includes('pressure')) return 'Pressure Issue'
    return 'Wear-Related'
  }
  return 'Unknown'
}

// ── Heatmap Cell ─────────────────────────────────────────────────────────────
function heatColor(hours) {
  if (!hours || hours === 0) return 'bg-gray-800 text-gray-600'
  if (hours <= 4)  return 'bg-yellow-500/30 text-yellow-300'
  if (hours <= 8)  return 'bg-orange-500/40 text-orange-300'
  return 'bg-red-500/40 text-red-300'
}

// ── Chart Modal ───────────────────────────────────────────────────────────────
function ChartCard({ title, children, onExpand }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
        {onExpand && (
          <button onClick={onExpand} className="text-gray-500 hover:text-gray-300 transition-colors">
            <Maximize2 size={14} />
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DowntimeTracker() {
  const { activeCurrency, activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  // Cost/hour assumption - overridable via the `downtime_rate` setting key.
  const downtimeRate = useMemo(() => {
    const v = Number(appSettings?.downtime_rate)
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_DOWNTIME_RATE
  }, [appSettings])
  const rateIsCustom = downtimeRate !== DEFAULT_DOWNTIME_RATE

  const [tyreRecords, setTyreRecords]   = useState([])
  const [workOrders, setWorkOrders]     = useState([])
  const [hasWorkOrders, setHasWorkOrders] = useState(false)
  const [loading, setLoading]           = useState(true)
  const [refreshing, setRefreshing]     = useState(false)
  const [error, setError]               = useState(null)

  // Filters
  const [period, setPeriod]             = useState('All')
  const [siteFilter, setSiteFilter]     = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [riskFilter, setRiskFilter]     = useState('')
  const [assetSearch, setAssetSearch]   = useState('')

  // UI
  const [sortCol, setSortCol]           = useState('totalHours')
  const [sortDir, setSortDir]           = useState('desc')
  const [expandedModal, setExpandedModal] = useState(null)

  const sym = activeCurrency

  // Guards against a slow earlier response overwriting a newer one after the
  // active country changes (fetch-race cancellation).
  const reqIdRef = useRef(0)

  // ── Data Load ───────────────────────────────────────────────────────────────
  const load = useCallback(async (isRefresh = false) => {
    const myReq = ++reqIdRef.current
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const { data: tyreData, error: tyreErr } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,asset_no,serial_number,risk_level,issue_date,km_at_fitment,km_at_removal,cost_per_tyre,site,country,brand,position,reason_for_removal')
          .order('issue_date', { ascending: false })
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      })
      if (myReq !== reqIdRef.current) return
      if (tyreErr) throw tyreErr
      setTyreRecords(tyreData || [])

      // Try work_orders (may be empty). opened_at/completed_at give ACTUAL
      // downtime duration; created_at retained for period filtering.
      const { data: woData, error: woErr } = await supabase
        .from('work_orders')
        .select('id,asset_no,work_type,created_at,opened_at,completed_at,status,priority,total_cost,site')
        .order('created_at', { ascending: false })
      if (myReq !== reqIdRef.current) return
      if (!woErr && woData) {
        setWorkOrders(woData)
        setHasWorkOrders(woData.length > 0)
      }
    } catch (e) {
      if (myReq === reqIdRef.current) setError(e.message || 'Failed to load data')
    } finally {
      if (myReq === reqIdRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Derived filter helpers ──────────────────────────────────────────────────
  const cutoff = useMemo(() => {
    const preset = PERIOD_PRESETS.find(p => p.label === period)
    return preset ? periodStart(preset.days) : null
  }, [period])

  const filtered = useMemo(() => {
    return tyreRecords.filter(r => {
      if (cutoff && r.issue_date && r.issue_date < cutoff) return false
      if (siteFilter    && r.site    !== siteFilter)    return false
      if (countryFilter && r.country !== countryFilter) return false
      if (riskFilter    && r.risk_level !== riskFilter) return false
      if (assetSearch   && !(r.asset_no || '').toLowerCase().includes(assetSearch.toLowerCase())) return false
      return true
    })
  }, [tyreRecords, cutoff, siteFilter, countryFilter, riskFilter, assetSearch])

  const filteredWO = useMemo(() => {
    if (!hasWorkOrders) return []
    return workOrders.filter(w => {
      if (cutoff && w.created_at && w.created_at.slice(0, 10) < cutoff) return false
      if (siteFilter && w.site !== siteFilter) return false
      return true
    })
  }, [workOrders, hasWorkOrders, cutoff, siteFilter])

  // Map asset_no → average ACTUAL downtime hours derived from work orders that
  // carry both opened_at and completed_at. Used to replace the per-severity
  // estimate for those assets; assets without WO timestamps stay estimated.
  const actualByAsset = useMemo(() => {
    const acc = new Map()
    filteredWO.forEach(wo => {
      const h = workOrderHours(wo)
      if (h == null || !wo.asset_no) return
      const cur = acc.get(wo.asset_no) || { sum: 0, n: 0 }
      cur.sum += h; cur.n += 1
      acc.set(wo.asset_no, cur)
    })
    const out = new Map()
    acc.forEach((v, k) => out.set(k, v.sum / v.n))
    return out
  }, [filteredWO])

  // True when at least one displayed event uses actual (measured) work-order hours.
  const usingActual = actualByAsset.size > 0

  // Unique filter options
  const sites     = useMemo(() => [...new Set(tyreRecords.map(r => r.site).filter(Boolean))].sort(), [tyreRecords])
  const countries = useMemo(() => [...new Set(tyreRecords.map(r => r.country).filter(Boolean))].sort(), [tyreRecords])

  // ── KPI Computations ────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalEvents = filtered.length
    const totalHours  = filtered.reduce((s, r) => s + downtimeHours(r, actualByAsset).hours, 0)
    const totalCost   = totalHours * downtimeRate
    const downDays    = totalHours / SHIFT_HOURS

    const uniqueVehicles = new Set(filtered.map(r => r.asset_no).filter(Boolean)).size
    const daysInPeriod   = cutoff
      ? Math.ceil((Date.now() - new Date(cutoff).getTime()) / 86400000)
      : (() => {
          if (filtered.length === 0) return 0
          const dates = filtered.map(r => r.issue_date).filter(Boolean).sort()
          return Math.max(1, Math.ceil((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000) + 1)
        })()

    const totalVehicleDays = uniqueVehicles * Math.max(daysInPeriod, 1)
    const availability     = totalVehicleDays > 0
      ? Math.min(100, ((totalVehicleDays - downDays) / totalVehicleDays) * 100)
      : 100

    // MTTR: average hours between events per vehicle
    const byVehicle = {}
    filtered.forEach(r => {
      if (!r.asset_no) return
      if (!byVehicle[r.asset_no]) byVehicle[r.asset_no] = []
      byVehicle[r.asset_no].push(r.issue_date)
    })
    let mttrSum = 0, mttrCount = 0
    Object.values(byVehicle).forEach(dates => {
      if (dates.length < 2) return
      const sorted = dates.filter(Boolean).sort()
      for (let i = 1; i < sorted.length; i++) {
        const diff = (new Date(sorted[i]) - new Date(sorted[i - 1])) / 3600000
        if (diff > 0) { mttrSum += diff; mttrCount++ }
      }
    })
    const mttr = mttrCount > 0 ? mttrSum / mttrCount : 0

    return { totalEvents, totalHours, totalCost, availability, mttr, uniqueVehicles }
  }, [filtered, cutoff, actualByAsset, downtimeRate])

  // ── Availability Trend (last 12 months) ─────────────────────────────────────
  const availabilityTrend = useMemo(() => {
    const months = last12Months()
    const allVehicles = new Set(tyreRecords.map(r => r.asset_no).filter(Boolean))
    const vCount = Math.max(allVehicles.size, 1)
    const daysInMonth = ym => {
      const [y, m] = ym.split('-')
      return new Date(+y, +m, 0).getDate()
    }
    return months.map(ym => {
      const monthRecords = tyreRecords.filter(r => isoYearMonth(r.issue_date) === ym)
      const hours = monthRecords.reduce((s, r) => s + downtimeHours(r, actualByAsset).hours, 0)
      const days  = daysInMonth(ym)
      const totalVD = vCount * days
      const downDays = hours / SHIFT_HOURS
      return Math.min(100, ((totalVD - downDays) / totalVD) * 100)
    })
  }, [tyreRecords, actualByAsset])

  const availabilityTrendData = useMemo(() => {
    const months = last12Months()
    const labels = months.map(monthLabel)
    const data   = availabilityTrend
    return {
      labels,
      datasets: [
        {
          label: 'Fleet Availability %',
          data,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.08)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: data.map(v => v >= TARGET_AVAILABILITY ? '#22c55e' : '#ef4444'),
          pointRadius: 4,
        },
        {
          label: `Target ${TARGET_AVAILABILITY}%`,
          data: months.map(() => TARGET_AVAILABILITY),
          borderColor: '#6366f1',
          borderDash: [6, 3],
          pointRadius: 0,
          borderWidth: 1.5,
          fill: false,
        },
      ],
    }
  }, [availabilityTrend])

  // ── Downtime by Site ─────────────────────────────────────────────────────────
  const siteData = useMemo(() => {
    const map = {}
    filtered.forEach(r => {
      const s = r.site || 'Unknown'
      if (!map[s]) map[s] = { planned: 0, unplanned: 0 }
      const h = downtimeHours(r, actualByAsset).hours
      if (r.risk_level === 'Critical' || r.risk_level === 'High') map[s].unplanned += h
      else map[s].planned += h
    })
    const entries = Object.entries(map)
      .map(([s, v]) => ({ site: s, ...v, total: v.planned + v.unplanned }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12)
    return {
      labels: entries.map(e => e.site),
      datasets: [
        {
          label: 'Unplanned (h)',
          data: entries.map(e => +e.unplanned.toFixed(1)),
          backgroundColor: '#ef4444',
          borderRadius: 4,
        },
        {
          label: 'Planned (h)',
          data: entries.map(e => +e.planned.toFixed(1)),
          backgroundColor: '#3b82f6',
          borderRadius: 4,
        },
      ],
    }
  }, [filtered, actualByAsset])

  // ── Downtime by Cause ────────────────────────────────────────────────────────
  const causeData = useMemo(() => {
    const map = {}
    filtered.forEach(r => {
      const c = causeLabel(r)
      map[c] = (map[c] || 0) + 1
    })
    const labels = Object.keys(map)
    const CAUSE_COLORS = {
      'Critical Failure':    '#ef4444',
      'Wear-Related':        '#f97316',
      'Pressure Issue':      '#eab308',
      'Routine Replacement': '#22c55e',
      'Unknown':             '#6b7280',
    }
    return {
      labels,
      datasets: [{
        data: labels.map(l => map[l]),
        backgroundColor: labels.map(l => CAUSE_COLORS[l] || '#6b7280'),
        borderColor: 'var(--panel)',
        borderWidth: 2,
      }],
    }
  }, [filtered])

  // ── Monthly Cost Analysis ────────────────────────────────────────────────────
  const monthlyCostData = useMemo(() => {
    const months = last12Months()
    const planned = [], unplanned = [], running = []
    let cumulative = 0
    months.forEach(ym => {
      const recs = filtered.filter(r => isoYearMonth(r.issue_date) === ym)
      let p = 0, u = 0
      recs.forEach(r => {
        const h = downtimeHours(r, actualByAsset).hours
        const cost = h * downtimeRate
        if (r.risk_level === 'Critical' || r.risk_level === 'High') u += cost
        else p += cost
      })
      planned.push(+(p.toFixed(0)))
      unplanned.push(+(u.toFixed(0)))
      cumulative += p + u
      running.push(+(cumulative.toFixed(0)))
    })
    return {
      labels: months.map(monthLabel),
      datasets: [
        {
          label: 'Unplanned Cost',
          data: unplanned,
          backgroundColor: 'rgba(239,68,68,0.7)',
          borderRadius: 4,
          stack: 'costs',
          yAxisID: 'y',
        },
        {
          label: 'Planned Cost',
          data: planned,
          backgroundColor: 'rgba(59,130,246,0.7)',
          borderRadius: 4,
          stack: 'costs',
          yAxisID: 'y',
        },
        {
          label: 'Cumulative',
          data: running,
          type: 'line',
          borderColor: '#22c55e',
          borderWidth: 2,
          pointRadius: 3,
          fill: false,
          tension: 0.3,
          yAxisID: 'y2',
        },
      ],
    }
  }, [filtered, actualByAsset, downtimeRate])

  // ── Vehicles by Downtime Table ────────────────────────────────────────────────
  const vehicleTable = useMemo(() => {
    const map = {}
    filtered.forEach(r => {
      if (!r.asset_no) return
      if (!map[r.asset_no]) map[r.asset_no] = { asset: r.asset_no, site: r.site || '-', events: [], totalHours: 0, totalCost: 0, severitySum: 0 }
      const h = downtimeHours(r, actualByAsset).hours
      map[r.asset_no].events.push(r.issue_date)
      map[r.asset_no].totalHours += h
      map[r.asset_no].totalCost  += h * downtimeRate
      map[r.asset_no].severitySum += SEVERITY_WEIGHT[r.risk_level] ?? 1
    })

    const daysInPeriod = cutoff
      ? Math.ceil((Date.now() - new Date(cutoff).getTime()) / 86400000)
      : 365

    const rows = Object.values(map).map(v => {
      const cnt = v.events.length
      // avg between events in days
      const sortedDates = v.events.filter(Boolean).sort()
      let avgBetween = null
      if (sortedDates.length >= 2) {
        const spans = []
        for (let i = 1; i < sortedDates.length; i++) {
          spans.push((new Date(sortedDates[i]) - new Date(sortedDates[i - 1])) / 86400000)
        }
        avgBetween = spans.reduce((a, b) => a + b, 0) / spans.length
      }
      const months = Math.max(1, daysInPeriod / 30)
      const riskScore = +(v.severitySum / months).toFixed(2)
      return { ...v, eventCount: cnt, avgBetween, riskScore }
    })

    const fleetAvgEvents = rows.length > 0 ? rows.reduce((s, r) => s + r.eventCount, 0) / rows.length : 0

    return rows
      .sort((a, b) => {
        const mul = sortDir === 'desc' ? -1 : 1
        if (sortCol === 'asset')      return mul * a.asset.localeCompare(b.asset)
        if (sortCol === 'site')       return mul * a.site.localeCompare(b.site)
        if (sortCol === 'eventCount') return mul * (a.eventCount - b.eventCount)
        if (sortCol === 'totalHours') return mul * (a.totalHours - b.totalHours)
        if (sortCol === 'totalCost')  return mul * (a.totalCost  - b.totalCost)
        if (sortCol === 'riskScore')  return mul * (a.riskScore  - b.riskScore)
        return 0
      })
      .slice(0, 20)
      .map(r => ({ ...r, isHigh: r.eventCount > fleetAvgEvents * 2 && fleetAvgEvents > 0 }))
  }, [filtered, sortCol, sortDir, cutoff, actualByAsset, downtimeRate])

  // ── Heatmap ──────────────────────────────────────────────────────────────────
  const heatmap = useMemo(() => {
    const months = last12Months()
    const map = {}
    filtered.forEach(r => {
      if (!r.asset_no) return
      const ym = isoYearMonth(r.issue_date)
      if (!ym || !months.includes(ym)) return
      const key = `${r.asset_no}::${ym}`
      map[key] = (map[key] || 0) + downtimeHours(r, actualByAsset).hours
    })

    const allVehicles = [...new Set(filtered.map(r => r.asset_no).filter(Boolean))]
    const byTotal = allVehicles
      .map(a => ({ asset: a, total: months.reduce((s, m) => s + (map[`${a}::${m}`] || 0), 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    return { months, rows: byTotal.map(v => ({ asset: v.asset, cells: months.map(m => map[`${v.asset}::${m}`] || 0) })) }
  }, [filtered, actualByAsset])

  // ── Recommendations ──────────────────────────────────────────────────────────
  const recommendations = useMemo(() => {
    const recs = []

    // Top problematic vehicles
    vehicleTable.slice(0, 3).forEach(v => {
      if (v.eventCount >= 2) {
        recs.push({
          type: 'vehicle',
          severity: v.eventCount >= 5 ? 'critical' : v.eventCount >= 3 ? 'high' : 'medium',
          message: `Vehicle ${v.asset} has had ${v.eventCount} downtime event${v.eventCount > 1 ? 's' : ''} - root cause investigation recommended`,
          action: 'Perform full vehicle inspection, alignment check and driver behaviour review.',
        })
      }
    })

    // Site analysis
    const siteTotals = {}
    filtered.forEach(r => {
      const s = r.site || 'Unknown'
      siteTotals[s] = (siteTotals[s] || 0) + 1
    })
    const avgPerSite = filtered.length / Math.max(Object.keys(siteTotals).length, 1)
    Object.entries(siteTotals)
      .filter(([, c]) => c > avgPerSite * 1.5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .forEach(([site, count]) => {
        const aboveAvg = avgPerSite > 0 ? (((count - avgPerSite) / avgPerSite) * 100).toFixed(0) : 'N/A'
        recs.push({
          type: 'site',
          severity: 'high',
          message: `Site ${site} is ${aboveAvg}% above average downtime - maintenance process review needed`,
          action: 'Audit maintenance schedules, inspect tyre storage conditions and review fitment procedures.',
        })
      })

    // Critical ratio
    const criticalCount = filtered.filter(r => r.risk_level === 'Critical').length
    const critRatio = filtered.length > 0 ? criticalCount / filtered.length : 0
    if (critRatio > 0.2) {
      recs.push({
        type: 'fleet',
        severity: 'critical',
        message: `${(critRatio * 100).toFixed(0)}% of events are Critical - predictive maintenance could reduce unplanned events by ~40%`,
        action: 'Implement weekly pressure monitoring, increase inspection frequency and set up tyre replacement schedule based on km thresholds.',
      })
    }

    // Availability below target
    if (kpis.availability < TARGET_AVAILABILITY) {
      recs.push({
        type: 'availability',
        severity: kpis.availability < 90 ? 'critical' : 'high',
        message: `Fleet availability is ${kpis.availability.toFixed(1)}% - below the ${TARGET_AVAILABILITY}% industry benchmark`,
        action: 'Review tyre lifecycle management, increase preventive replacements and track tread depth more frequently.',
      })
    }

    if (recs.length === 0) {
      recs.push({
        type: 'fleet',
        severity: 'low',
        message: 'Fleet downtime is within acceptable range for current period',
        action: 'Continue current maintenance schedule. Monitor monthly for early trend detection.',
      })
    }

    return recs
  }, [vehicleTable, filtered, kpis])

  // ── Sort Handler ──────────────────────────────────────────────────────────────
  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // ── Export PDF ────────────────────────────────────────────────────────────────
  async function handleExportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'Fleet Downtime & Availability Report', `Period: ${period} · ${usingActual ? 'Actual + Estimated' : 'Estimated'} Data`, company, brand)

    // ── Empty state: no vehicle downtime data for the selected period ──
    if (vehicleTable.length === 0) {
      pdfEmptyState(doc, 'No vehicle downtime data for the selected period')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(`downtime-report-${new Date().toISOString().slice(0, 10)}.pdf`)
      return
    }

    // KPI summary
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(34, 197, 94)
    doc.text('KEY PERFORMANCE INDICATORS', 14, 30)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(200, 200, 200)
    doc.setFontSize(9)
    const kpiText = [
      `Fleet Availability: ${kpis.availability.toFixed(2)}%`,
      `Total Downtime Events: ${kpis.totalEvents.toLocaleString()}`,
      `Total Downtime Hours: ${kpis.totalHours.toFixed(1)} h`,
      `Downtime Cost: ${sym} ${Math.round(kpis.totalCost).toLocaleString()}`,
      `MTTR: ${kpis.mttr > 0 ? kpis.mttr.toFixed(0) + ' h avg between events' : 'N/A'}`,
    ]
    kpiText.forEach((t, i) => doc.text(t, 14 + (i % 3) * 90, 37 + Math.floor(i / 3) * 7))
    doc.setTextColor(120, 120, 120)
    doc.setFontSize(7.5)
    doc.text(
      `Basis: downtime hours are ${usingActual ? 'actual (work-order open→complete) where available, otherwise ' : ''}estimated per severity (Critical 4h, High 3h, Medium/Low 2h). Cost @ ${sym} ${downtimeRate}/hr${rateIsCustom ? ' (configured)' : ' (default assumption)'}.`,
      14, 37 + Math.ceil(kpiText.length / 3) * 7 + 2, { maxWidth: 269 },
    )

    // Vehicle table
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 55,
      head: [['Asset', 'Site', 'Events', 'Total Hours', 'Total Cost', 'Avg Between Events', 'Risk Score']],
      body: vehicleTable.map(v => [
        v.asset,
        v.site,
        v.eventCount,
        v.totalHours.toFixed(1),
        `${sym} ${Math.round(v.totalCost).toLocaleString()}`,
        v.avgBetween ? `${v.avgBetween.toFixed(0)} days` : 'N/A',
        v.riskScore,
      ]),
    })

    // Recommendations
    const finalY = (doc.lastAutoTable?.finalY || 100) + 10
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(34, 197, 94)
    doc.text('RECOMMENDATIONS', 14, finalY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(200, 200, 200)
    recommendations.forEach((r, i) => {
      const y = finalY + 8 + i * 12
      if (y > 190) return
      doc.setFont('helvetica', 'bold')
      doc.text(`${i + 1}. ${r.message}`, 14, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(150, 150, 150)
      doc.text(`   → ${r.action}`, 14, y + 5)
      doc.setTextColor(200, 200, 200)
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save(`downtime-report-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  // ── Export Excel ──────────────────────────────────────────────────────────────
  function handleExportExcel() {
    const rows = filtered.map(r => {
      const dt = downtimeHours(r, actualByAsset)
      return {
        asset_no:             r.asset_no || '',
        site:                 r.site || '',
        country:              r.country || '',
        risk_level:           r.risk_level || '',
        issue_date:           r.issue_date || '',
        reason_for_removal:   r.reason_for_removal || '',
        brand:                r.brand || '',
        position:             r.position || '',
        downtime_hours:       +dt.hours.toFixed(2),
        downtime_cost:        (dt.hours * downtimeRate).toFixed(2),
        cause:                causeLabel(r),
        data_source:          dt.actual ? 'Actual (work order)' : 'Estimated (severity)',
      }
    })
    exportToExcel(
      rows,
      ['asset_no', 'site', 'country', 'risk_level', 'issue_date', 'reason_for_removal', 'brand', 'position', 'downtime_hours', 'downtime_cost', 'cause', 'data_source'],
      ['Asset No', 'Site', 'Country', 'Risk Level', 'Issue Date', 'Reason for Removal', 'Brand', 'Position', 'Downtime Hours', `Downtime Cost (${sym})`, 'Cause', 'Data Source'],
      `downtime-events-${new Date().toISOString().slice(0, 10)}`,
      'Downtime Events',
    )
  }

  // ── Availability chart options ────────────────────────────────────────────────
  const availOpts = {
    ...CHART_BASE,
    scales: {
      ...CHART_BASE.scales,
      y: {
        ...CHART_BASE.scales.y,
        min: Math.max(0, Math.min(...availabilityTrend) - 5),
        max: 100,
        ticks: { ...CHART_BASE.scales.y.ticks, callback: v => `${v}%` },
      },
    },
  }

  const siteBarOpts = {
    ...CHART_BASE,
    indexAxis: 'y',
    plugins: { ...CHART_BASE.plugins, legend: { labels: { color: '#9ca3af', font: { size: 11 } } } },
    scales: {
      x: { stacked: true, grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280', font: { size: 11 } } },
      y: { stacked: true, grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280', font: { size: 10 }, maxTicksLimit: 14 } },
    },
  }

  const costBarOpts = {
    ...CHART_BASE,
    scales: {
      x: { stacked: true, grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280', font: { size: 11 } } },
      y: { id: 'y', stacked: true, grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280', font: { size: 11 }, callback: v => fmtCurrency(v, sym) } },
      y2: { id: 'y2', position: 'right', grid: { display: false }, ticks: { color: '#22c55e', font: { size: 11 }, callback: v => fmtCurrency(v, sym) } },
    },
  }

  const doughnutOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
      tooltip: CHART_BASE.plugins.tooltip,
    },
  }

  // ── Severity badge ────────────────────────────────────────────────────────────
  function SeverityBadge({ level }) {
    const map = { critical: 'bg-red-500/20 text-red-400', high: 'bg-orange-500/20 text-orange-400', medium: 'bg-yellow-500/20 text-yellow-400', low: 'bg-green-500/20 text-green-400' }
    return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${map[level] || map.low}`}>{level}</span>
  }

  // ── Sort icon ─────────────────────────────────────────────────────────────────
  function SortIcon({ col }) {
    if (sortCol !== col) return <ChevronDown size={12} className="text-gray-600" />
    return sortDir === 'desc' ? <ChevronDown size={12} className="text-green-400" /> : <ChevronUp size={12} className="text-green-400" />
  }

  // ── Th helper ─────────────────────────────────────────────────────────────────
  function Th({ col, label }) {
    return (
      <th
        className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 cursor-pointer hover:text-gray-300 select-none whitespace-nowrap"
        onClick={() => toggleSort(col)}
      >
        <span className="flex items-center gap-1">{label}<SortIcon col={col} /></span>
      </th>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={28} className="animate-spin text-green-400" />
        <span className="ml-3 text-gray-400">Loading downtime data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertTriangle size={32} className="text-red-400" />
        <p className="text-red-400 text-sm">{error}</p>
        <button onClick={() => load()} className="btn-primary text-sm">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <PageHeader
        title="Fleet Downtime & Availability"
        subtitle={<>
          {usingActual ? 'Actual work-order durations where available, otherwise estimated from tyre removal events' : 'Estimated from tyre removal events'}
          <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/15 text-yellow-400 text-[10px] rounded font-semibold">
            {usingActual ? 'ACTUAL + ESTIMATED' : 'ESTIMATED'}
          </span>
        </>}
        icon={AlertTriangle}
        actions={<>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
          >
            <FileText size={13} />PDF
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded-lg text-xs text-white transition-colors"
          >
            <FileSpreadsheet size={13} />Excel
          </button>
        </>}
      />

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-2 items-center">
          {/* Period */}
          <SegmentedControl
            ariaLabel="period"
            size="sm"
            value={period}
            onChange={setPeriod}
            options={PERIOD_PRESETS.map(p => ({ value: p.label, label: p.label }))}
          />
          {/* Site */}
          <select
            value={siteFilter}
            onChange={e => setSiteFilter(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none focus:border-green-600"
          >
            <option value="">All Sites</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {/* Country */}
          {countries.length > 1 && (
            <select
              value={countryFilter}
              onChange={e => setCountryFilter(e.target.value)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none focus:border-green-600"
            >
              <option value="">All Countries</option>
              {countries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {/* Risk */}
          <select
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none focus:border-green-600"
          >
            <option value="">All Risk Levels</option>
            {RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {/* Asset search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search asset..."
              value={assetSearch}
              onChange={e => setAssetSearch(e.target.value)}
              className="pl-7 pr-7 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none focus:border-green-600 w-36"
            />
            {assetSearch && (
              <button onClick={() => setAssetSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                <X size={12} />
              </button>
            )}
          </div>
          <span className="ml-auto text-xs text-gray-500">{filtered.length.toLocaleString()} events</span>
        </div>
      </div>

      {/* Estimation basis banner */}
      <div className="flex items-start gap-2.5 bg-yellow-500/5 border border-yellow-500/20 rounded-2xl px-4 py-3">
        <AlertCircle size={15} className="text-yellow-400 shrink-0 mt-0.5" />
        <p className="text-xs text-gray-400 leading-relaxed">
          <span className="text-yellow-400 font-semibold">Estimated figures.</span>{' '}
          Downtime hours are{' '}
          {usingActual
            ? 'taken from actual work-order durations (opened → completed) where a matching work order exists, and otherwise '
            : ''}
          estimated per severity - Critical 4h, High 3h, Medium/Low 2h per tyre-removal event.
          Downtime cost is modelled at{' '}
          <span className="text-gray-200 font-medium">{sym} {downtimeRate.toLocaleString()}/hr</span>{' '}
          {rateIsCustom ? '(configured via settings)' : '(default assumption - set a "downtime_rate" key in Settings to override)'},
          assuming {SHIFT_HOURS} productive hours per shift-day. These are planning estimates, not invoiced downtime.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          label="Fleet Availability (Est.)"
          value={`${kpis.availability.toFixed(2)}%`}
          sub={kpis.availability >= TARGET_AVAILABILITY ? `Above ${TARGET_AVAILABILITY}% target` : `Below ${TARGET_AVAILABILITY}% benchmark`}
          icon={Activity}
          color={kpis.availability >= TARGET_AVAILABILITY ? 'green' : 'red'}
        />
        <StatCard
          label="Downtime Events"
          value={kpis.totalEvents}
          sub={`${kpis.uniqueVehicles} vehicles affected`}
          icon={AlertTriangle}
          color="orange"
        />
        <StatCard
          label="Total Downtime Hours (Est.)"
          value={fmtHours(kpis.totalHours)}
          sub={`${(kpis.totalHours / SHIFT_HOURS).toFixed(1)} shift-days · ${usingActual ? 'actual + severity est.' : 'severity estimate'}`}
          icon={Clock}
          color="yellow"
        />
        <StatCard
          label="Downtime Cost (Est.)"
          value={fmtCurrency(kpis.totalCost, sym)}
          sub={`@ ${sym} ${downtimeRate.toLocaleString()}/hr · ${rateIsCustom ? 'configured' : 'assumed'}`}
          icon={DollarSign}
          color="red"
        />
        <StatCard
          label="MTTR (Est.)"
          value={kpis.mttr > 0 ? `${Math.round(kpis.mttr)} h` : 'N/A'}
          sub="Mean time between tyre events per vehicle"
          icon={BarChart2}
          color="blue"
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Availability Trend */}
        <div className="lg:col-span-2">
          <ChartCard title="Fleet Availability Trend - Last 12 Months">
            <div className="h-56">
              <Line data={availabilityTrendData} options={availOpts} />
            </div>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-green-400" />
                <span className="text-[10px] text-gray-500">Availability</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-indigo-400 border-dashed" style={{ borderTop: '2px dashed #818cf8' }} />
                <span className="text-[10px] text-gray-500">{TARGET_AVAILABILITY}% Target</span>
              </div>
            </div>
          </ChartCard>
        </div>
        {/* Cause Doughnut */}
        <ChartCard title="Downtime by Cause">
          {causeData.labels.length > 0 ? (
            <div className="h-56">
              <Doughnut data={causeData} options={doughnutOpts} />
            </div>
          ) : (
            <div className="h-56 flex items-center justify-center text-gray-600 text-sm">No data</div>
          )}
        </ChartCard>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Site Bar */}
        <ChartCard title="Downtime by Site (hours)">
          {siteData.labels.length > 0 ? (
            <div className="h-64">
              <Bar data={siteData} options={siteBarOpts} />
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-600 text-sm">No data</div>
          )}
        </ChartCard>
        {/* Monthly Cost */}
        <ChartCard title="Monthly Downtime Cost Analysis">
          <div className="h-64">
            <Bar data={monthlyCostData} options={costBarOpts} />
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm bg-red-500/70" />
            <span className="text-[10px] text-gray-500">Unplanned</span>
            <div className="w-2 h-2 rounded-sm bg-blue-500/70 ml-2" />
            <span className="text-[10px] text-gray-500">Planned</span>
            <div className="w-4 h-0.5 bg-green-400 ml-2" />
            <span className="text-[10px] text-gray-500">Cumulative</span>
            <span className="ml-auto text-[10px] text-gray-600">Budget threshold: {fmtCurrency(BUDGET_THRESHOLD, sym)}/mo</span>
          </div>
        </ChartCard>
      </div>

      {/* Downtime Heatmap */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Downtime Heatmap - Top 10 Vehicles × Last 12 Months</h3>
        {heatmap.rows.length === 0 ? (
          <div className="text-center text-gray-600 text-sm py-8">No vehicle data available</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-max">
              {/* Month labels */}
              <div className="flex items-center gap-1 mb-1 ml-28">
                {heatmap.months.map(m => (
                  <div key={m} className="w-10 text-center text-[9px] text-gray-600 font-medium">{monthLabel(m)}</div>
                ))}
              </div>
              {/* Rows */}
              {heatmap.rows.map(({ asset, cells }) => (
                <div key={asset} className="flex items-center gap-1 mb-1">
                  <div className="w-28 text-[10px] text-gray-400 truncate font-medium pr-2 text-right">{asset}</div>
                  {cells.map((h, i) => (
                    <div
                      key={i}
                      title={`${asset} · ${heatmap.months[i]}: ${h.toFixed(1)} h`}
                      className={`w-10 h-7 rounded text-[9px] flex items-center justify-center font-medium transition-transform hover:scale-110 cursor-default ${heatColor(h)}`}
                    >
                      {h > 0 ? h.toFixed(0) : ''}
                    </div>
                  ))}
                </div>
              ))}
              {/* Legend */}
              <div className="flex items-center gap-3 mt-3 ml-28">
                <span className="text-[9px] text-gray-600">Hours:</span>
                {[{ label: '0', cls: 'bg-gray-800' }, { label: '1-4', cls: 'bg-yellow-500/30' }, { label: '5-8', cls: 'bg-orange-500/40' }, { label: '8+', cls: 'bg-red-500/40' }].map(({ label, cls }) => (
                  <span key={label} className="flex items-center gap-1">
                    <span className={`w-4 h-4 rounded ${cls} inline-block`} />
                    <span className="text-[9px] text-gray-600">{label}h</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Vehicles Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-300">Vehicles by Downtime (Top 20)</h3>
          <span className="text-xs text-gray-600">{vehicleTable.length} vehicles · sorted by {sortCol}</span>
        </div>
        <div className="overflow-x-auto">
          {vehicleTable.length === 0 ? (
            <div className="text-center text-gray-600 text-sm py-10">No vehicle downtime data for selected period</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-800">
                <tr>
                  <Th col="asset"      label="Asset" />
                  <Th col="site"       label="Site" />
                  <Th col="eventCount" label="Events" />
                  <Th col="totalHours" label="Total Hours" />
                  <Th col="totalCost"  label="Total Cost" />
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 whitespace-nowrap">Avg Between Events</th>
                  <Th col="riskScore"  label="Risk Score" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {vehicleTable.map((v, i) => (
                  <motion.tr
                    key={v.asset}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className={`transition-colors hover:bg-gray-800/40 ${v.isHigh ? 'bg-red-500/5' : ''}`}
                  >
                    <td className="px-3 py-2.5">
                      <span className={`font-semibold ${v.isHigh ? 'text-red-400' : 'text-white'}`}>{v.asset}</span>
                      {v.isHigh && <span className="ml-2 text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold">HIGH RISK</span>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-400 text-xs">{v.site}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`font-bold ${v.eventCount >= 5 ? 'text-red-400' : v.eventCount >= 3 ? 'text-orange-400' : 'text-gray-300'}`}>
                        {v.eventCount}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-300 font-medium">{v.totalHours.toFixed(1)} h</td>
                    <td className="px-3 py-2.5 text-gray-300 font-medium">{fmtCurrency(v.totalCost, sym)}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{v.avgBetween ? `${v.avgBetween.toFixed(0)} days` : '-'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`font-bold text-xs ${v.riskScore >= 3 ? 'text-red-400' : v.riskScore >= 1.5 ? 'text-orange-400' : v.riskScore >= 0.5 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {v.riskScore.toFixed(2)}
                      </span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Recommendations */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={15} className="text-yellow-400" />
          <h3 className="text-sm font-semibold text-gray-300">Improvement Recommendations</h3>
          <span className="ml-auto text-xs text-gray-600">{recommendations.length} insight{recommendations.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="space-y-3">
          {recommendations.map((r, i) => {
            const iconMap = { critical: <XCircle size={15} className="text-red-400 shrink-0 mt-0.5" />, high: <AlertCircle size={15} className="text-orange-400 shrink-0 mt-0.5" />, medium: <AlertTriangle size={15} className="text-yellow-400 shrink-0 mt-0.5" />, low: <CheckCircle2 size={15} className="text-green-400 shrink-0 mt-0.5" /> }
            const borderMap = { critical: 'border-l-red-500/50', high: 'border-l-orange-500/50', medium: 'border-l-yellow-500/50', low: 'border-l-green-500/50' }
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`flex gap-3 p-3 bg-gray-800/50 rounded-xl border-l-2 ${borderMap[r.severity]}`}
              >
                {iconMap[r.severity]}
                <div className="min-w-0">
                  <p className="text-sm text-gray-200 font-medium leading-snug">{r.message}</p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">Action: {r.action}</p>
                </div>
                <SeverityBadge level={r.severity} />
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
