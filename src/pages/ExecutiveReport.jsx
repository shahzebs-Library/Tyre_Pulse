// ─────────────────────────────────────────────────────────────────────────────
// ExecutiveReport.jsx - Executive Intelligence Report · /executive-report
// Full management-ready report: 7 mandatory sections.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  FileText, Download, Printer, FileSpreadsheet,
  TrendingUp, TrendingDown, Minus, AlertTriangle,
  ShieldAlert, DollarSign, BarChart2, Target,
  Zap, CheckCircle, XCircle, Clock, Activity,
  Building2, Wrench, Star, AlertOctagon,
  ChevronRight, Award, Package, Users, Mail,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import EmailReportModal from '../components/EmailReportModal'
import {
  computeAllKpis,
  computeCostTrend,
  computeVendorPerformance,
  computeFailureRate,
} from '../lib/kpiEngine'
import { useSettings } from '../contexts/SettingsContext'
import { applyCountry } from '../lib/countryFilter'
import { formatDate } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import { recordCost } from '../lib/analyticsEngine'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme } from '../lib/exportUtils'
import { useTenant } from '../contexts/TenantContext'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
)

// ── Dark chart base ───────────────────────────────────────────────────────────
const CHART_DARK = {
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
const CHART_DARK_NO_LEGEND = {
  ...CHART_DARK,
  plugins: { ...CHART_DARK.plugins, legend: { display: false } },
}
const CHART_HORIZONTAL = {
  ...CHART_DARK_NO_LEGEND,
  indexAxis: 'y',
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { color: '#1f2937' } },
  },
}
const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: CHART_DARK.plugins.tooltip,
  },
}

// ── Period helpers ────────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'month',   label: 'Last Month',    days: 30  },
  { key: 'quarter', label: 'Last Quarter',  days: 90  },
  { key: 'half',    label: 'Last 6 Months', days: 180 },
  { key: 'year',    label: 'Last Year',     days: 365 },
  { key: 'ytd',     label: 'YTD',           days: null },
]

function getPeriodStart(period) {
  const now = new Date()
  if (period === 'ytd') return new Date(now.getFullYear(), 0, 1)
  const days = PERIODS.find(p => p.key === period)?.days ?? 90
  const d = new Date(now)
  d.setDate(d.getDate() - days)
  return d
}

function filterByPeriod(records, period, dateField = 'issue_date') {
  const start = getPeriodStart(period)
  return records.filter(r => {
    if (!r[dateField]) return false
    return new Date(r[dateField]) >= start
  })
}

// ── Root cause classifier ─────────────────────────────────────────────────────
const RC_CATEGORIES = [
  {
    key: 'inflation',
    label: 'Inflation Issues',
    color: '#ef4444',
    keywords: ['inflation', 'pressure', 'under-inflat', 'over-inflat', 'deflat', 'blow'],
    prevention: 'Implement weekly pressure checks, install TPMS sensors, calibrate gauges quarterly.',
  },
  {
    key: 'alignment',
    label: 'Alignment / Suspension',
    color: '#f97316',
    keywords: ['align', 'suspension', 'camber', 'toe', 'wheel balance', 'balancing', 'bounce'],
    prevention: 'Schedule alignment checks every 20,000 km, inspect after impact events.',
  },
  {
    key: 'driver',
    label: 'Driver Behavior',
    color: '#eab308',
    keywords: ['driver', 'driving', 'speed', 'braking', 'cornering', 'abuse', 'misuse', 'overload'],
    prevention: 'Deploy telematics, run defensive driving training, review high-loss records monthly.',
  },
  {
    key: 'road',
    label: 'Road / Load Conditions',
    color: '#8b5cf6',
    keywords: ['road', 'terrain', 'load', 'overload', 'weight', 'debris', 'pothole', 'cut'],
    prevention: 'Map high-risk routes, enforce load compliance, carry puncture repair kits.',
  },
  {
    key: 'maintenance',
    label: 'Maintenance Quality',
    color: '#06b6d4',
    keywords: ['mainten', 'workshop', 'rotation', 'install', 'torque', 'fitment', 'rim'],
    prevention: 'Audit workshop standards, enforce mandatory service intervals, verify torque spec.',
  },
  {
    key: 'manufacturing',
    label: 'Manufacturing Defects',
    color: '#10b981',
    keywords: ['defect', 'manufactur', 'warranty', 'sidewall', 'bead', 'delamination', 'separation'],
    prevention: 'Raise warranty claims, audit supplier quality, inspect all incoming tyres.',
  },
  {
    key: 'other',
    label: 'Other / Unclassified',
    color: '#6b7280',
    keywords: [],
    prevention: 'Investigate individual records and assign to appropriate root cause category.',
  },
]

function classifyRootCause(record) {
  const text = [record.findings, record.category, record.risk_level]
    .join(' ')
    .toLowerCase()
  for (const cat of RC_CATEGORIES.slice(0, -1)) {
    if (cat.keywords.some(kw => text.includes(kw))) return cat.key
  }
  // Additional heuristics
  if (record.risk_level === 'Critical' || record.risk_level === 'High') {
    if (text.includes('tread')) return 'maintenance'
    if (text.includes('pressure')) return 'inflation'
  }
  return 'other'
}

function computeRootCauses(records) {
  const counts = {}
  RC_CATEGORIES.forEach(c => { counts[c.key] = { count: 0, cost: 0 } })
  records.forEach(r => {
    const key = classifyRootCause(r)
    counts[key].count += 1
    counts[key].cost += recordCost(r)
  })
  const total = records.length
  return RC_CATEGORIES.map(cat => ({
    ...cat,
    count:   counts[cat.key].count,
    cost:    counts[cat.key].cost,
    pct:     total > 0 ? (counts[cat.key].count / total) * 100 : 0,
  })).filter(c => c.count > 0).sort((a, b) => b.count - a.count)
}

// ── Number formatters ────────────────────────────────────────────────────────
function fmtCurrency(n, currency) {
  if (!isFinite(n) || n === 0) return `${currency} 0`
  return `${currency} ${Math.round(n).toLocaleString()}`
}
function fmtNum(n, decimals = 0) {
  if (!isFinite(n)) return '0'
  return n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function fmtPct(n) { return `${fmtNum(n, 1)}%` }
function fmtCpk(n, currency) {
  if (!isFinite(n) || n === 0) return `${currency} 0.00`
  return `${currency} ${n.toFixed(4)}`
}

// ── Status color helpers ──────────────────────────────────────────────────────
function cpkStatus(cpk) {
  if (cpk <= 0.005) return 'green'
  if (cpk <= 0.012) return 'amber'
  return 'red'
}
function pctStatus(pct, goodAbove = 85) {
  if (pct >= goodAbove) return 'green'
  if (pct >= goodAbove * 0.7) return 'amber'
  return 'red'
}
function failStatus(rate) {
  if (rate <= 0.1) return 'green'
  if (rate <= 0.25) return 'amber'
  return 'red'
}
const STATUS_COLORS = {
  green: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/30', dot: 'bg-emerald-400' },
  amber: { text: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/30', dot: 'bg-amber-400' },
  red:   { text: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/30', dot: 'bg-red-400' },
}

const PRIORITY_STYLES = {
  Critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  High:     'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  Medium:   'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  Low:      'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
}

// ── Card component ────────────────────────────────────────────────────────────
function Card({ children, className = '' }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 ${className}`}>
      {children}
    </div>
  )
}

function SectionHeader({ icon: Icon, title, subtitle, badge }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
          <Icon className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {subtitle && <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {badge && (
        <span className="px-2 py-1 text-xs rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          {badge}
        </span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function ExecutiveReport() {
  const { appSettings, activeCurrency, activeCountry } = useSettings()
  const { branding } = useTenant()
  const currency = activeCurrency
  const companyName = appSettings?.company_name || 'TyrePulse Fleet'
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [records,     setRecords]     = useState([])
  const [inspections, setInspections] = useState([])
  const [actions,     setActions]     = useState([])
  const [fleet,       setFleet]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [period,      setPeriod]      = useState('quarter')
  const [exporting,   setExporting]   = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)

  // Chart refs for PDF export
  const costTrendRef    = useRef(null)
  const rootCauseRef    = useRef(null)
  const costBySiteRef   = useRef(null)
  const riskTrendRef    = useRef(null)
  const costByBrandRef  = useRef(null)

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        // Paginate past the PostgREST 1000-row cap so analytics see the FULL
        // dataset (otherwise totals/KPIs are computed on a 1000-row sample).
        const [rRes, iRes, aRes, fRes] = await Promise.all([
          fetchAllPages((from, to) => applyCountry(supabase.from('tyre_records').select(
            'id,asset_no,site,brand,position,risk_level,category,findings,km_at_fitment,km_at_removal,cost_per_tyre,qty,issue_date,tread_depth,pressure_reading,country'
          ), activeCountry).order('issue_date', { ascending: false }).range(from, to), { max: 200000 }),
          fetchAllPages((from, to) => applyCountry(supabase.from('inspections').select(
            'id,asset_no,site,status,scheduled_date,completed_date,findings,country'
          ), activeCountry).order('scheduled_date', { ascending: false }).range(from, to), { max: 50000 }),
          fetchAllPages((from, to) => applyCountry(supabase.from('corrective_actions').select(
            'id,site,status,priority,title,created_at,resolved_at,country'
          ), activeCountry).order('created_at', { ascending: false }).range(from, to), { max: 50000 }),
          applyCountry(supabase.from('vehicle_fleet').select('asset_no,site,vehicle_type,monthly_tyre_budget,country'), activeCountry).then(
            res => ({ data: res.data || [], error: null })
          ).catch(() => ({ data: [], error: null })),
        ])
        if (cancelled) return
        if (rRes.error) throw rRes.error
        if (iRes.error) throw iRes.error
        if (aRes.error) throw aRes.error
        setRecords(rRes.data || [])
        setInspections(iRes.data || [])
        setActions(aRes.data || [])
        setFleet(fRes.data || [])
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [activeCountry])

  // ── Period-filtered datasets ───────────────────────────────────────────────
  const periodRecords     = useMemo(() => filterByPeriod(records,     period, 'issue_date'),      [records,     period])
  const periodInspections = useMemo(() => filterByPeriod(inspections, period, 'scheduled_date'),  [inspections, period])
  const periodActions     = useMemo(() => filterByPeriod(actions,     period, 'created_at'),      [actions,     period])

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const fleetSize = useMemo(() =>
    fleet.length > 0
      ? fleet.length
      : new Set(records.map(r => r.asset_no).filter(Boolean)).size,
    [fleet, records]
  )

  const kpis        = useMemo(() => computeAllKpis(periodRecords, periodInspections, periodActions, fleetSize), [periodRecords, periodInspections, periodActions, fleetSize])
  const costTrend   = useMemo(() => computeCostTrend(periodRecords), [periodRecords])
  const vendors     = useMemo(() => computeVendorPerformance(periodRecords), [periodRecords])
  const rootCauses  = useMemo(() => computeRootCauses(periodRecords), [periodRecords])

  // ── Financial computations ────────────────────────────────────────────────
  const totalSpend = useMemo(() =>
    periodRecords.reduce((s, r) => s + recordCost(r), 0),
    [periodRecords]
  )

  const totalBudget = useMemo(() => {
    if (!fleet.length) return 0
    const periodObj = PERIODS.find(p => p.key === period)
    const months = periodObj?.days ? periodObj.days / 30 : new Date().getMonth() + 1
    return fleet.reduce((s, v) => s + (Number(v.monthly_tyre_budget) || 0), 0) * months
  }, [fleet, period])

  const projectedAnnual = useMemo(() => {
    if (!costTrend.avgMonthlyCost) return 0
    return costTrend.avgMonthlyCost * 12
  }, [costTrend])

  const topCostVehicles = useMemo(() => {
    const byAsset = {}
    periodRecords.forEach(r => {
      if (!r.asset_no) return
      if (!byAsset[r.asset_no]) byAsset[r.asset_no] = { asset_no: r.asset_no, site: r.site, cost: 0, count: 0 }
      byAsset[r.asset_no].cost  += recordCost(r)
      byAsset[r.asset_no].count += 1
    })
    return Object.values(byAsset).sort((a, b) => b.cost - a.cost).slice(0, 5)
  }, [periodRecords])

  const costBySite = useMemo(() => {
    const by = {}
    periodRecords.forEach(r => {
      const site = r.site || 'Unknown'
      if (!by[site]) by[site] = 0
      by[site] += recordCost(r)
    })
    return Object.entries(by).map(([site, cost]) => ({ site, cost })).sort((a, b) => b.cost - a.cost)
  }, [periodRecords])

  const costByBrand = useMemo(() => {
    const by = {}
    periodRecords.forEach(r => {
      const brand = r.brand || 'Unknown'
      if (!by[brand]) by[brand] = 0
      by[brand] += recordCost(r)
    })
    return Object.entries(by).map(([brand, cost]) => ({ brand, cost })).sort((a, b) => b.cost - a.cost).slice(0, 8)
  }, [periodRecords])

  // ── Cost savings opportunity ──────────────────────────────────────────────
  const savingsOpportunity = useMemo(() => {
    if (!kpis.cpk.fleetAvgCpk || !kpis.cpk.p10Cpk) return 0
    const improvement = kpis.cpk.fleetAvgCpk - kpis.cpk.p10Cpk
    if (improvement <= 0) return 0
    const totalKm = periodRecords.filter(r => {
      const f = Number(r.km_at_fitment), rem = Number(r.km_at_removal)
      return isFinite(f) && isFinite(rem) && rem > f
    }).reduce((s, r) => s + (Number(r.km_at_removal) - Number(r.km_at_fitment)), 0)
    return improvement * totalKm * (12 / (PERIODS.find(p => p.key === period)?.days ?? 90) * 30)
  }, [kpis, periodRecords, period])

  // ── Risk matrix ───────────────────────────────────────────────────────────
  const riskMatrix = useMemo(() => {
    const sites = [...new Set(periodRecords.map(r => r.site).filter(Boolean))]
    const levels = ['Critical', 'High', 'Medium', 'Low']
    return sites.map(site => {
      const siteRecs = periodRecords.filter(r => r.site === site)
      const counts = {}
      levels.forEach(l => { counts[l] = siteRecs.filter(r => r.risk_level === l).length })
      const score = (counts.Critical * 4 + counts.High * 3 + counts.Medium * 2 + counts.Low) /
        Math.max(siteRecs.length, 1)
      return { site, ...counts, total: siteRecs.length, score }
    }).sort((a, b) => b.score - a.score)
  }, [periodRecords])

  const fleetRiskScore = useMemo(() => {
    const total = periodRecords.length
    if (!total) return 0
    const weighted =
      periodRecords.filter(r => r.risk_level === 'Critical').length * 4 +
      periodRecords.filter(r => r.risk_level === 'High').length * 3 +
      periodRecords.filter(r => r.risk_level === 'Medium').length * 2 +
      periodRecords.filter(r => r.risk_level === 'Low').length
    return weighted / total
  }, [periodRecords])

  const top10HighRisk = useMemo(() =>
    [...periodRecords]
      .filter(r => r.risk_level === 'Critical' || r.risk_level === 'High')
      .sort((a, b) => {
        const order = { Critical: 0, High: 1 }
        return (order[a.risk_level] ?? 2) - (order[b.risk_level] ?? 2)
      })
      .slice(0, 10),
    [periodRecords]
  )

  // ── Risk trend (6-month) ──────────────────────────────────────────────────
  const riskTrend6m = useMemo(() => {
    const months = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      months.push(key)
    }
    return months.map(mo => {
      const recs = records.filter(r => {
        if (!r.issue_date) return false
        const k = r.issue_date.slice(0, 7)
        return k === mo
      })
      const total = recs.length
      if (!total) return { month: mo, score: 0 }
      const score =
        (recs.filter(r => r.risk_level === 'Critical').length * 4 +
         recs.filter(r => r.risk_level === 'High').length * 3 +
         recs.filter(r => r.risk_level === 'Medium').length * 2 +
         recs.filter(r => r.risk_level === 'Low').length) / total
      return { month: mo, score }
    })
  }, [records])

  // ── Month-over-month cost change ──────────────────────────────────────────
  const momChange = useMemo(() => {
    const months = costTrend.byMonth
    if (months.length < 2) return null
    const last = months[months.length - 1]
    const prev = months[months.length - 2]
    if (!prev.totalCost) return null
    return ((last.totalCost - prev.totalCost) / prev.totalCost) * 100
  }, [costTrend])

  // ── Best brand by CPK ─────────────────────────────────────────────────────
  const bestBrand = useMemo(() => {
    const v = vendors.filter(b => b.validCount >= 3)
    return v.length ? v[v.length - 1] : null // sorted best last (highest score = rank 1)
  }, [vendors])

  const bestBrandByScore = useMemo(() => {
    const v = vendors.filter(b => b.validCount >= 3)
    return v.length ? v[0] : null
  }, [vendors])

  // ── Worst site by failure rate ────────────────────────────────────────────
  const worstSiteByFailure = useMemo(() => {
    const fr = kpis.failureRate?.bySite
    return fr?.length ? fr[0] : null
  }, [kpis])

  // ── Top root cause ────────────────────────────────────────────────────────
  const topRootCause = useMemo(() => rootCauses[0] || null, [rootCauses])

  // ── Recommendations ───────────────────────────────────────────────────────
  const recommendations = useMemo(() => {
    const recs = []
    const inspComp = kpis.inspectionCompliance?.compliancePct ?? 0
    const scrapRate = kpis.scrapRate?.scrapRate ?? 0
    const failRate  = kpis.failureRate?.failureRate ?? 0
    const critRate  = kpis.failureRate?.criticalRate ?? 0
    const fleetCpk  = kpis.cpk?.fleetAvgCpk ?? 0

    if (critRate > 0.15) {
      recs.push({
        priority: 'Critical',
        title: 'Immediate Critical Tyre Removal Programme',
        description: `${fmtPct(critRate * 100)} of fleet tyres are classified as Critical risk. An immediate inspection and forced removal programme must be initiated across all sites to prevent blowouts and road incidents.`,
        impact: `Avoidance of estimated ${fmtCurrency(kpis.scrapRate?.estimatedScrapCost * 0.4, currency)} in accident liability and emergency replacement costs.`,
        owner: 'Fleet Manager',
      })
    }

    if (inspComp < 85) {
      recs.push({
        priority: critRate > 0.1 ? 'Critical' : 'High',
        title: 'Enforce Inspection Compliance Across All Sites',
        description: `Fleet inspection compliance is at ${fmtPct(inspComp)}, well below the 85% target. Missing inspections are a leading indicator of tyre failures. A mandatory compliance enforcement programme with site manager accountability must be implemented.`,
        impact: `Compliance improvement to 90%+ historically reduces failure rate by 20-30%, saving approximately ${fmtCurrency(totalSpend * 0.15, currency)} annually.`,
        owner: 'Management',
      })
    }

    if (bestBrandByScore && vendors.length > 2) {
      const worst = vendors[vendors.length - 1]
      recs.push({
        priority: 'High',
        title: `Procurement Review: Replace ${worst.brand} with Higher-Performing Alternatives`,
        description: `${worst.brand} has the lowest composite performance score in the fleet. CPK of ${fmtCpk(worst.avgCpk, currency)}/km and failure rate of ${fmtPct(worst.failureRate * 100)} significantly exceed fleet averages. Procurement should evaluate contract terms and initiate supplier transition.`,
        impact: `Switching lower-performing brands to ${bestBrandByScore.brand}-equivalent performance could yield ${fmtCurrency(savingsOpportunity * 0.3, currency)} in annual savings.`,
        owner: 'Procurement',
      })
    }

    if (topRootCause && topRootCause.key === 'inflation') {
      recs.push({
        priority: 'High',
        title: 'Deploy Tyre Pressure Monitoring System (TPMS) Fleet-Wide',
        description: `Inflation issues are the primary root cause, accounting for ${fmtPct(topRootCause.pct)} of all tyre events. A fleet-wide TPMS deployment combined with driver training will directly target the highest-impact failure driver.`,
        impact: `Estimated ${fmtCurrency(topRootCause.cost * 0.6, currency)} in avoidable tyre costs per period.`,
        owner: 'Fleet Manager',
      })
    }

    if (topRootCause && topRootCause.key === 'driver') {
      recs.push({
        priority: 'High',
        title: 'Driver Behaviour Telematics Programme',
        description: `Driver behaviour contributes to ${fmtPct(topRootCause.pct)} of tyre incidents. Deploying telematics with speed, harsh braking, and cornering monitoring - combined with driver-specific coaching - will reduce this cause category significantly.`,
        impact: `${fmtCurrency(topRootCause.cost * 0.5, currency)} in potential cost avoidance per period.`,
        owner: 'Fleet Manager',
      })
    }

    if (scrapRate > 0.15) {
      recs.push({
        priority: 'High',
        title: 'Scrap Rate Root Cause Investigation',
        description: `Scrap rate at ${fmtPct(scrapRate * 100)} exceeds acceptable limits. Each scrapped tyre represents full cost loss. A structured investigation into premature removal drivers - including improper inflation, fitment errors, and road damage - must be completed within 30 days.`,
        impact: `Reducing scrap rate by 50% saves approximately ${fmtCurrency(kpis.scrapRate?.estimatedScrapCost * 0.5, currency)} per period.`,
        owner: 'Workshop',
      })
    }

    if (worstSiteByFailure) {
      recs.push({
        priority: 'Medium',
        title: `Site Audit: ${worstSiteByFailure.site} - Highest Failure Rate`,
        description: `${worstSiteByFailure.site} has the highest failure rate at ${fmtPct(worstSiteByFailure.rate * 100)}. A structured site audit covering inspection compliance, tyre fitment practices, road conditions, and driver behaviour is required to understand and remediate site-specific failure drivers.`,
        impact: `Bringing ${worstSiteByFailure.site} to fleet average failure rate could save ${fmtCurrency(costBySite.find(s => s.site === worstSiteByFailure.site)?.cost * 0.2 || 0, currency)} per period.`,
        owner: 'Fleet Manager',
      })
    }

    if (kpis.cpk.fleetAvgCpk > 0 && savingsOpportunity > 5000) {
      recs.push({
        priority: 'Medium',
        title: 'Fleet CPK Optimisation Initiative',
        description: `Fleet average CPK is ${fmtCpk(kpis.cpk.fleetAvgCpk, currency)}/km versus best-in-fleet of ${fmtCpk(kpis.cpk.p10Cpk, currency)}/km. Closing this gap through vendor rationalisation, position optimisation, and maintenance improvements represents significant financial opportunity.`,
        impact: `Estimated annual saving potential: ${fmtCurrency(savingsOpportunity, currency)}.`,
        owner: 'Management',
      })
    }

    if (kpis.downtimeImpact?.totalDowntimeHours > 100) {
      recs.push({
        priority: 'Medium',
        title: 'Priority Maintenance for High-Downtime Vehicles',
        description: `${kpis.downtimeImpact.worstAssets?.slice(0, 3).map(a => a.assetNo).join(', ')} are responsible for disproportionate downtime. A dedicated maintenance review and tyre specification upgrade for these vehicles will improve fleet availability and operational efficiency.`,
        impact: `Estimated ${Math.round(kpis.downtimeImpact.totalDowntimeHours * 0.3)} hours of recovered vehicle availability per period.`,
        owner: 'Workshop',
      })
    }

    if (recs.length < 6) {
      recs.push({
        priority: 'Medium',
        title: 'Tyre Rotation Compliance Enforcement',
        description: 'Implementing a systematic tyre rotation schedule at 10,000 km intervals will equalise wear across positions, extend average tyre life, and reduce position-specific failure rates, particularly on steer axles.',
        impact: `Projected tyre life extension of 10-15%, saving approximately ${fmtCurrency(totalSpend * 0.1, currency)} per period.`,
        owner: 'Workshop',
      })
    }

    return recs.slice(0, 10)
  }, [kpis, vendors, topRootCause, worstSiteByFailure, totalSpend, savingsOpportunity, currency, costBySite])

  // ── Action plan ───────────────────────────────────────────────────────────
  const actionPlan = useMemo(() => {
    const critCount = periodRecords.filter(r => r.risk_level === 'Critical').length
    const actions30 = [
      {
        action: `Remove all ${critCount} Critical-risk tyres from service immediately`,
        priority: 'Critical', timeline: '0-7 days',
        owner: 'Fleet Manager', saving: fmtCurrency(kpis.scrapRate?.estimatedScrapCost * 0.2, currency), status: 'Open',
      },
      {
        action: 'Audit top 3 highest-failure sites with on-site inspection team',
        priority: 'Critical', timeline: '7-14 days',
        owner: 'Fleet Manager', saving: fmtCurrency(totalSpend * 0.08, currency), status: 'Open',
      },
      {
        action: 'Mandate 100% tyre pressure check before vehicle dispatch',
        priority: 'High', timeline: '1-7 days',
        owner: 'Workshop', saving: fmtCurrency(topRootCause?.cost * 0.3 || 0, currency), status: 'Open',
      },
      {
        action: 'Issue corrective action notices to all sites below 70% inspection compliance',
        priority: 'High', timeline: '7-30 days',
        owner: 'Management', saving: fmtCurrency(totalSpend * 0.1, currency), status: 'Open',
      },
    ]
    const actions60 = [
      {
        action: `Initiate procurement review for lowest-performing tyre brand(s)`,
        priority: 'High', timeline: '30-60 days',
        owner: 'Procurement', saving: fmtCurrency(savingsOpportunity * 0.3, currency), status: 'Open',
      },
      {
        action: 'Deploy telematics driver behaviour scoring across all high-failure vehicles',
        priority: 'High', timeline: '30-60 days',
        owner: 'Fleet Manager', saving: fmtCurrency(totalSpend * 0.12, currency), status: 'Open',
      },
      {
        action: 'Implement tyre rotation schedule at 10,000 km for all fleet vehicles',
        priority: 'Medium', timeline: '30-60 days',
        owner: 'Workshop', saving: fmtCurrency(totalSpend * 0.1, currency), status: 'Open',
      },
    ]
    const actions90 = [
      {
        action: 'Complete TPMS sensor installation across all fleet vehicles',
        priority: 'High', timeline: '60-90 days',
        owner: 'Fleet Manager', saving: fmtCurrency(totalSpend * 0.15, currency), status: 'Open',
      },
      {
        action: 'Establish monthly executive tyre KPI review cadence',
        priority: 'Medium', timeline: '60-90 days',
        owner: 'Management', saving: 'Process', status: 'Open',
      },
      {
        action: 'Negotiate revised contracts with top-3 performing vendors based on CPK data',
        priority: 'Medium', timeline: '60-90 days',
        owner: 'Procurement', saving: fmtCurrency(savingsOpportunity * 0.4, currency), status: 'Open',
      },
    ]
    return [...actions30, ...actions60, ...actions90]
  }, [periodRecords, kpis, totalSpend, savingsOpportunity, topRootCause, currency])

  // ── Chart datasets ────────────────────────────────────────────────────────
  const costTrendChart = useMemo(() => ({
    labels: costTrend.byMonth.slice(-12).map(m => m.month),
    datasets: [{
      label: 'Monthly Spend',
      data: costTrend.byMonth.slice(-12).map(m => m.totalCost),
      backgroundColor: 'rgba(16,185,129,0.7)',
      borderColor: '#10b981',
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [costTrend])

  const rcaChart = useMemo(() => ({
    labels: rootCauses.slice(0, 7).map(c => c.label),
    datasets: [{
      data:            rootCauses.slice(0, 7).map(c => c.count),
      backgroundColor: rootCauses.slice(0, 7).map(c => c.color + 'cc'),
      borderColor:     rootCauses.slice(0, 7).map(c => c.color),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [rootCauses])

  const costBySiteChart = useMemo(() => ({
    labels: costBySite.slice(0, 8).map(s => s.site),
    datasets: [{
      label: 'Total Cost',
      data: costBySite.slice(0, 8).map(s => s.cost),
      backgroundColor: 'rgba(99,102,241,0.7)',
      borderColor: '#6366f1',
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [costBySite])

  const costByBrandChart = useMemo(() => ({
    labels: costByBrand.map(b => b.brand),
    datasets: [{
      label: 'Total Cost',
      data: costByBrand.map(b => b.cost),
      backgroundColor: 'rgba(245,158,11,0.7)',
      borderColor: '#f59e0b',
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [costByBrand])

  const riskTrendChart = useMemo(() => ({
    labels: riskTrend6m.map(m => m.month),
    datasets: [{
      label: 'Risk Score',
      data: riskTrend6m.map(m => m.score),
      borderColor: '#f97316',
      backgroundColor: 'rgba(249,115,22,0.1)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: '#f97316',
      pointRadius: 4,
    }],
  }), [riskTrend6m])

  // ── PDF Export ────────────────────────────────────────────────────────────
  const exportPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    setExporting(true)
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(branding)
      const periodLabel = PERIODS.find(p => p.key === period)?.label || 'Quarter'

      // KPI Dashboard
      pdfHeader(doc, 'Executive Intelligence Report', `KPI Dashboard · ${periodLabel}`, company, brand)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 28,
        head: [['KPI', 'Value', 'Status', 'Target']],
        body: [
          ['Fleet Avg CPK', fmtCpk(kpis.cpk.fleetAvgCpk, currency), cpkStatus(kpis.cpk.fleetAvgCpk) === 'green' ? 'Good' : cpkStatus(kpis.cpk.fleetAvgCpk) === 'amber' ? 'Warning' : 'Critical', '< 0.012'],
          ['Median CPK', fmtCpk(kpis.cpk.medianCpk, currency), '-', '-'],
          ['Fleet Avg Tyre Life', `${fmtNum(kpis.avgTyreLife.avgKm)} km`, '-', '> 60,000 km'],
          ['Inspection Compliance', fmtPct(kpis.inspectionCompliance.compliancePct), kpis.inspectionCompliance.compliancePct >= 85 ? 'Good' : 'Warning', '≥ 85%'],
          ['Failure Rate', fmtPct(kpis.failureRate.failureRate * 100), kpis.failureRate.failureRate <= 0.1 ? 'Good' : 'Warning', '< 10%'],
          ['Critical Rate', fmtPct(kpis.failureRate.criticalRate * 100), kpis.failureRate.criticalRate <= 0.05 ? 'Good' : 'Critical', '< 5%'],
          ['Scrap Rate', fmtPct(kpis.scrapRate.scrapRate * 100), kpis.scrapRate.scrapRate <= 0.15 ? 'Good' : 'Warning', '< 15%'],
          ['Fleet Availability', fmtPct(kpis.fleetAvailability.availabilityPct), kpis.fleetAvailability.availabilityPct >= 95 ? 'Good' : 'Warning', '≥ 95%'],
          ['Total Downtime Hours', `${fmtNum(kpis.downtimeImpact.totalDowntimeHours)} hrs`, '-', '-'],
          ['Total Spend (Period)', fmtCurrency(totalSpend, currency), '-', '-'],
          ['Projected Annual Spend', fmtCurrency(projectedAnnual, currency), '-', '-'],
          ['Cost Trend', costTrend.trend.charAt(0).toUpperCase() + costTrend.trend.slice(1), costTrend.trend === 'improving' ? 'Good' : costTrend.trend === 'stable' ? 'Neutral' : 'Warning', 'Improving'],
        ],
      })

      doc.addPage()
      pdfHeader(doc, 'Root Cause Analysis', periodLabel, company, brand)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 28,
        head: [['Root Cause', 'Count', '% of Total', 'Est. Cost Impact', 'Prevention Summary']],
        body: rootCauses.map(c => [
          c.label, c.count, fmtPct(c.pct),
          fmtCurrency(c.cost, currency),
          c.prevention.slice(0, 80) + '...',
        ]),
        columnStyles: { 4: { cellWidth: 70 } },
      })

      doc.addPage()
      pdfHeader(doc, 'Risk Assessment', periodLabel, company, brand)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 28,
        head: [['Site', 'Critical', 'High', 'Medium', 'Low', 'Total', 'Risk Score']],
        body: riskMatrix.map(r => [
          r.site, r.Critical, r.High, r.Medium, r.Low, r.total, r.score.toFixed(2),
        ]),
      })

      doc.addPage()
      pdfHeader(doc, 'Action Plan', periodLabel, company, brand)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 28,
        head: [['Action', 'Priority', 'Timeline', 'Owner', 'Est. Saving', 'Status']],
        body: actionPlan.map(a => [a.action.slice(0, 70), a.priority, a.timeline, a.owner, a.saving, a.status]),
        columnStyles: { 0: { cellWidth: 75 } },
      })

      const totalPages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

      doc.save(`TyrePulse_Executive_Report_${period}_${new Date().toISOString().slice(0, 10)}.pdf`)
    } catch (e) {
      console.error('PDF export failed', e)
    } finally {
      setExporting(false)
    }
  }, [period, kpis, rootCauses, riskMatrix, actionPlan, totalSpend, projectedAnnual, costTrend, currency, company, branding, savingsOpportunity])

  // ── Excel Export ──────────────────────────────────────────────────────────
  const exportExcel = useCallback(async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    const kpiRows = [
      { KPI: 'Fleet Avg CPK', Value: Number(kpis.cpk.fleetAvgCpk || 0).toFixed(6), Unit: `${currency}/km` },
      { KPI: 'Median CPK', Value: Number(kpis.cpk.medianCpk || 0).toFixed(6), Unit: `${currency}/km` },
      { KPI: 'Fleet Avg Tyre Life', Value: Math.round(Number(kpis.avgTyreLife.avgKm) || 0), Unit: 'km' },
      { KPI: 'Inspection Compliance', Value: Number(kpis.inspectionCompliance.compliancePct || 0).toFixed(1), Unit: '%' },
      { KPI: 'Failure Rate', Value: (kpis.failureRate.failureRate * 100).toFixed(1), Unit: '%' },
      { KPI: 'Critical Rate', Value: (kpis.failureRate.criticalRate * 100).toFixed(1), Unit: '%' },
      { KPI: 'Scrap Rate', Value: (kpis.scrapRate.scrapRate * 100).toFixed(1), Unit: '%' },
      { KPI: 'Total Downtime Hours', Value: Math.round(kpis.downtimeImpact.totalDowntimeHours), Unit: 'hrs' },
      { KPI: 'Fleet Availability', Value: kpis.fleetAvailability.availabilityPct.toFixed(1), Unit: '%' },
      { KPI: 'Total Spend', Value: Math.round(totalSpend), Unit: currency },
      { KPI: 'Projected Annual Spend', Value: Math.round(projectedAnnual), Unit: currency },
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiRows), 'KPI Dashboard')

    const rcRows = rootCauses.map(c => ({
      'Root Cause': c.label, Count: c.count, 'Pct of Total': c.pct.toFixed(1) + '%',
      'Est Cost Impact': Math.round(c.cost), Prevention: c.prevention,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rcRows), 'Root Cause Analysis')

    const riskRows = riskMatrix.map(r => ({
      Site: r.site, Critical: r.Critical, High: r.High, Medium: r.Medium,
      Low: r.Low, Total: r.total, 'Risk Score': r.score.toFixed(2),
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(riskRows), 'Risk Matrix')

    const apRows = actionPlan.map(a => ({
      Action: a.action, Priority: a.priority, Timeline: a.timeline,
      Owner: a.owner, 'Est Saving': a.saving, Status: a.status,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(apRows), 'Action Plan')

    const costRows = costTrend.byMonth.map(m => ({
      Month: m.month, 'Total Cost': Math.round(m.totalCost), Count: m.count,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(costRows), 'Cost Trend')

    const siteRows = costBySite.map(s => ({ Site: s.site, 'Total Cost': Math.round(s.cost) }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(siteRows), 'Cost by Site')

    XLSX.writeFile(wb, `TyrePulse_Executive_Report_${period}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }, [kpis, rootCauses, riskMatrix, actionPlan, costTrend, costBySite, totalSpend, projectedAnnual, currency, period])

  const exportActionPlanPDF = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'Action Plan', `Period: ${PERIODS.find(p => p.key === period)?.label}`, company, brand)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 28,
      head: [['#', 'Action', 'Priority', 'Timeline', 'Owner', 'Est. Saving', 'Status']],
      body: actionPlan.map((a, i) => [i + 1, a.action, a.priority, a.timeline, a.owner, a.saving, a.status]),
      columnStyles: { 1: { cellWidth: 100 } },
    })
    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
    doc.save(`TyrePulse_ActionPlan_${new Date().toISOString().slice(0, 10)}.pdf`)
  }, [actionPlan, company, branding, period])

  // ── Loading / Error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Loading executive intelligence...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Card className="max-w-md text-center">
          <AlertOctagon className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-white font-semibold mb-1">Failed to load report data</p>
          <p className="text-gray-400 text-sm">{error}</p>
        </Card>
      </div>
    )
  }

  if (!periodRecords.length && !periodInspections.length) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Card className="max-w-md text-center">
          <FileText className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-white font-semibold mb-1">No data for selected period</p>
          <p className="text-gray-400 text-sm">Try selecting a longer period or upload tyre records.</p>
        </Card>
      </div>
    )
  }

  const trendIcon = costTrend.trend === 'improving'
    ? <TrendingDown className="w-4 h-4 text-emerald-400" />
    : costTrend.trend === 'worsening'
      ? <TrendingUp className="w-4 h-4 text-red-400" />
      : <Minus className="w-4 h-4 text-amber-400" />

  const kpiCards = [
    {
      label: 'Fleet Avg CPK',
      value: fmtCpk(kpis.cpk.fleetAvgCpk, currency),
      status: cpkStatus(kpis.cpk.fleetAvgCpk),
      target: '< 0.012',
      icon: DollarSign,
    },
    {
      label: 'Median CPK',
      value: fmtCpk(kpis.cpk.medianCpk, currency),
      status: cpkStatus(kpis.cpk.medianCpk),
      target: '< 0.012',
      icon: BarChart2,
    },
    {
      label: 'Fleet Avg Tyre Life',
      value: `${fmtNum(kpis.avgTyreLife.avgKm)} km`,
      status: kpis.avgTyreLife.avgKm >= 60000 ? 'green' : kpis.avgTyreLife.avgKm >= 40000 ? 'amber' : 'red',
      target: '≥ 60,000 km',
      icon: Activity,
    },
    {
      label: 'Inspection Compliance',
      value: fmtPct(kpis.inspectionCompliance.compliancePct),
      status: pctStatus(kpis.inspectionCompliance.compliancePct),
      target: '≥ 85%',
      icon: CheckCircle,
    },
    {
      label: 'Pressure Compliance',
      value: fmtPct(kpis.pressureCompliance.compliancePct),
      status: pctStatus(kpis.pressureCompliance.compliancePct),
      target: '≥ 90%',
      icon: Target,
    },
    {
      label: 'Failure Rate',
      value: fmtPct(kpis.failureRate.failureRate * 100),
      status: failStatus(kpis.failureRate.failureRate),
      target: '< 10%',
      icon: AlertTriangle,
    },
    {
      label: 'Critical Rate',
      value: fmtPct(kpis.failureRate.criticalRate * 100),
      status: kpis.failureRate.criticalRate <= 0.05 ? 'green' : kpis.failureRate.criticalRate <= 0.15 ? 'amber' : 'red',
      target: '< 5%',
      icon: ShieldAlert,
    },
    {
      label: 'Scrap Rate',
      value: fmtPct(kpis.scrapRate.scrapRate * 100),
      status: kpis.scrapRate.scrapRate <= 0.15 ? 'green' : kpis.scrapRate.scrapRate <= 0.25 ? 'amber' : 'red',
      target: '< 15%',
      icon: Package,
    },
    {
      label: 'Replacement Rate',
      value: `${fmtNum(kpis.replacementRate.avgPerVehiclePerMonth, 2)}/veh/mo`,
      status: 'amber',
      target: '< 1.0',
      icon: Wrench,
    },
    {
      label: 'Total Downtime Hours',
      value: `${fmtNum(kpis.downtimeImpact.totalDowntimeHours)} hrs`,
      status: kpis.downtimeImpact.totalDowntimeHours <= 100 ? 'green' : kpis.downtimeImpact.totalDowntimeHours <= 300 ? 'amber' : 'red',
      target: '< 100 hrs',
      icon: Clock,
    },
    {
      label: 'Fleet Availability',
      value: fmtPct(kpis.fleetAvailability.availabilityPct),
      status: pctStatus(kpis.fleetAvailability.availabilityPct, 95),
      target: '≥ 95%',
      icon: Zap,
    },
    {
      label: 'Cost Trend',
      value: costTrend.trend.charAt(0).toUpperCase() + costTrend.trend.slice(1),
      status: costTrend.trend === 'improving' ? 'green' : costTrend.trend === 'stable' ? 'amber' : 'red',
      target: 'Improving',
      icon: TrendingUp,
    },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white print:bg-white print:text-black">

      {/* ── Print Styles ────────────────────────────────────────────────── */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-break { page-break-before: always; }
          body { background: white; color: black; }
          .bg-gray-950, .bg-gray-900 { background: white !important; }
          .border-gray-800 { border-color: #e5e7eb !important; }
          .text-white, .text-gray-100 { color: black !important; }
          .text-gray-400 { color: #6b7280 !important; }
        }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-gray-950/95 backdrop-blur border-b border-gray-800 no-print">
        <div className="max-w-screen-2xl mx-auto px-4 py-3">
          <PageHeader
            title="Executive Intelligence Report"
            subtitle={`${companyName} · Generated ${formatDate(new Date(), 'All', { day: '2-digit', month: 'long', year: 'numeric' })}`}
            icon={FileText}
            actions={<>
              <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
                {PERIODS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setPeriod(p.key)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      period === p.key
                        ? 'bg-emerald-600 text-white'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                onClick={exportExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium transition-all border border-gray-700"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Excel
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium transition-all border border-gray-700"
              >
                <Printer className="w-3.5 h-3.5" />
                Print
              </button>
              <button
                onClick={exportPDF}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-all disabled:opacity-50"
              >
                {exporting
                  ? <div className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" />
                  : <Download className="w-3.5 h-3.5" />
                }
                Export PDF
              </button>
              <button
                onClick={() => setEmailModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Mail size={16} />Email Report
              </button>
            </>}
          />
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-8">

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 1 - EXECUTIVE SUMMARY
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <Card className="border-emerald-800/40">
            {/* Confidential badge */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                  <Star className="w-5 h-5 text-emerald-400" />
                </div>
                <h2 className="text-lg font-semibold text-white">Section 1 - Executive Summary</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-red-500/10 text-red-400 border border-red-500/20 tracking-wide">
                  CONFIDENTIAL
                </span>
                <span className="px-2.5 py-1 text-xs rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                  EXECUTIVE SUMMARY
                </span>
              </div>
            </div>

            <div className="bg-gray-950 border border-gray-800 rounded-xl p-5 space-y-4">
              <div className="border-l-4 border-emerald-500 pl-4">
                <p className="text-sm leading-relaxed text-gray-200">
                  During the <strong className="text-white">{PERIODS.find(p => p.key === period)?.label}</strong>,{' '}
                  <strong className="text-white">{companyName}</strong> operated a fleet of{' '}
                  <strong className="text-emerald-400">{fleetSize.toLocaleString()} vehicles</strong>{' '}
                  with <strong className="text-white">{periodRecords.length.toLocaleString()} tyre records</strong> processed.
                  Total tyre expenditure for the period reached{' '}
                  <strong className="text-emerald-400">{fmtCurrency(totalSpend, currency)}</strong>,
                  with the fleet delivering an average Cost Per Kilometre of{' '}
                  <strong className="text-white">{fmtCpk(kpis.cpk.fleetAvgCpk, currency)}/km</strong>.
                  {momChange !== null && (
                    <> Month-over-month cost has{' '}
                      <strong className={momChange < 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {momChange < 0 ? 'improved' : 'increased'} by {fmtPct(Math.abs(momChange))}
                      </strong>,
                      indicating a{' '}
                      <strong className={momChange < 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {momChange < 0 ? 'positive' : 'worsening'} cost trajectory
                      </strong>.
                    </>
                  )}
                </p>
              </div>

              <div className="border-l-4 border-amber-500 pl-4">
                <p className="text-sm leading-relaxed text-gray-200">
                  <strong className="text-amber-400">Operational risk</strong> remains a priority concern.
                  A total of{' '}
                  <strong className="text-red-400">{periodRecords.filter(r => r.risk_level === 'Critical').length} critical-risk tyres</strong>{' '}
                  were identified in the period, representing{' '}
                  <strong className="text-white">{fmtPct(kpis.failureRate.criticalRate * 100)}</strong> of all records.
                  Overall failure rate stands at{' '}
                  <strong className={kpis.failureRate.failureRate > 0.2 ? 'text-red-400' : kpis.failureRate.failureRate > 0.1 ? 'text-amber-400' : 'text-emerald-400'}>
                    {fmtPct(kpis.failureRate.failureRate * 100)}
                  </strong>.
                  Inspection compliance reached{' '}
                  <strong className={kpis.inspectionCompliance.compliancePct >= 85 ? 'text-emerald-400' : 'text-amber-400'}>
                    {fmtPct(kpis.inspectionCompliance.compliancePct)}
                  </strong>{' '}
                  against a target of 85%.
                  {topRootCause && (
                    <> The primary root cause driving failures is <strong className="text-white">{topRootCause.label}</strong>,
                      accounting for <strong className="text-white">{fmtPct(topRootCause.pct)}</strong> of all tyre events.
                    </>
                  )}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {bestBrandByScore && (
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Award className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Key Win</span>
                    </div>
                    <p className="text-sm text-gray-200">
                      <strong className="text-white">{bestBrandByScore.brand}</strong> delivered the best composite performance
                      with CPK of <strong className="text-emerald-400">{fmtCpk(bestBrandByScore.avgCpk, currency)}/km</strong>{' '}
                      and failure rate of <strong className="text-white">{fmtPct(bestBrandByScore.failureRate * 100)}</strong>.
                      Expanding its fleet share is recommended.
                    </p>
                  </div>
                )}
                {worstSiteByFailure && (
                  <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertOctagon className="w-4 h-4 text-red-400" />
                      <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">Key Concern</span>
                    </div>
                    <p className="text-sm text-gray-200">
                      <strong className="text-white">{worstSiteByFailure.site}</strong> records the highest failure rate at{' '}
                      <strong className="text-red-400">{fmtPct(worstSiteByFailure.rate * 100)}</strong>.
                      An immediate site audit is required to identify and address root causes at this location.
                    </p>
                  </div>
                )}
              </div>

              <div className="border-l-4 border-blue-500 pl-4">
                <p className="text-sm leading-relaxed text-gray-200">
                  Annualised tyre spend is projected at{' '}
                  <strong className="text-white">{fmtCurrency(projectedAnnual, currency)}</strong>.
                  {savingsOpportunity > 1000 && (
                    <> Closing the CPK gap between fleet average and best-in-fleet performance represents
                      a cost optimisation opportunity of approximately{' '}
                      <strong className="text-emerald-400">{fmtCurrency(savingsOpportunity, currency)} annually</strong>.
                    </>
                  )}
                  {' '}Average tyre life stands at <strong className="text-white">{fmtNum(kpis.avgTyreLife.avgKm)} km</strong>,
                  with fleet availability at <strong className="text-white">{fmtPct(kpis.fleetAvailability.availabilityPct)}</strong>.
                  Management attention is directed to the Recommendations and Action Plan sections for prioritised interventions.
                </p>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 2 - KPI DASHBOARD
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
          <Card>
            <SectionHeader
              icon={BarChart2}
              title="Section 2 - KPI Dashboard"
              subtitle={`${periodRecords.length.toLocaleString()} tyre records · ${PERIODS.find(p => p.key === period)?.label}`}
              badge="12 Metrics"
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {kpiCards.map((card) => {
                const sc = STATUS_COLORS[card.status]
                const IconComp = card.icon
                return (
                  <div
                    key={card.label}
                    className={`rounded-xl p-3 border ${sc.border} ${sc.bg} flex flex-col gap-2`}
                  >
                    <div className="flex items-center justify-between">
                      <IconComp className={`w-4 h-4 ${sc.text}`} />
                      <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
                    </div>
                    <div>
                      <p className={`text-lg font-bold leading-tight ${sc.text}`}>{card.value}</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-tight">{card.label}</p>
                    </div>
                    <p className="text-xs text-gray-600 leading-tight">Target: {card.target}</p>
                  </div>
                )
              })}
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 3 - ROOT CAUSE ANALYSIS
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
          <Card>
            <SectionHeader
              icon={AlertTriangle}
              title="Section 3 - Root Cause Analysis"
              subtitle="Failure driver classification across all tyre events in period"
              badge={`${rootCauses.length} Categories`}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart */}
              <div className="h-64">
                {rootCauses.length > 0 ? (
                  <Bar
                    ref={rootCauseRef}
                    data={rcaChart}
                    options={{
                      ...CHART_DARK_NO_LEGEND,
                      plugins: {
                        ...CHART_DARK_NO_LEGEND.plugins,
                        tooltip: {
                          ...CHART_DARK.plugins.tooltip,
                          callbacks: {
                            label: ctx => `${ctx.raw} events (${((ctx.raw / periodRecords.length) * 100).toFixed(1)}%)`,
                          },
                        },
                      },
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-600 text-sm">No root cause data</div>
                )}
              </div>

              {/* Table */}
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-2 text-gray-400 font-medium">Cause</th>
                      <th className="text-right py-2 text-gray-400 font-medium">Count</th>
                      <th className="text-right py-2 text-gray-400 font-medium">%</th>
                      <th className="text-right py-2 text-gray-400 font-medium">Cost Impact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rootCauses.map(cause => (
                      <tr key={cause.key} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cause.color }} />
                            <span className="text-gray-200">{cause.label}</span>
                          </div>
                        </td>
                        <td className="py-2 text-right text-white font-medium">{cause.count}</td>
                        <td className="py-2 text-right">
                          <span className="text-gray-300">{fmtPct(cause.pct)}</span>
                        </td>
                        <td className="py-2 text-right text-amber-400">{fmtCurrency(cause.cost, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Prevention summaries */}
            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {rootCauses.slice(0, 3).map(cause => (
                <div key={cause.key} className="bg-gray-950 rounded-lg p-3 border border-gray-800">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cause.color }} />
                    <span className="text-xs font-semibold text-gray-300">{cause.label}</span>
                    <span className="ml-auto text-xs text-red-400 font-bold">{fmtPct(cause.pct)}</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{cause.prevention}</p>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 4 - FINANCIAL IMPACT
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
          <Card>
            <SectionHeader
              icon={DollarSign}
              title="Section 4 - Financial Impact"
              subtitle="Cost analysis, budget tracking, and financial projections"
            />

            {/* Top stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Total Period Spend', value: fmtCurrency(totalSpend, currency), sub: PERIODS.find(p => p.key === period)?.label, color: 'text-white' },
                { label: 'Projected Annual', value: fmtCurrency(projectedAnnual, currency), sub: 'at current rate', color: 'text-amber-400' },
                { label: 'Budget vs Actual', value: totalBudget > 0 ? fmtPct(((totalSpend / totalBudget) * 100)) : 'N/A', sub: totalBudget > 0 ? `Budget: ${fmtCurrency(totalBudget, currency)}` : 'No budget data', color: totalBudget > 0 && totalSpend > totalBudget ? 'text-red-400' : 'text-emerald-400' },
                { label: 'Savings Opportunity', value: fmtCurrency(savingsOpportunity, currency), sub: 'if CPK reached fleet best', color: 'text-emerald-400' },
              ].map(s => (
                <div key={s.label} className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-white font-medium mt-1">{s.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.sub}</p>
                </div>
              ))}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2">
                <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">Monthly Spend Trend</p>
                <div className="h-52">
                  {costTrend.byMonth.length > 0 ? (
                    <Bar ref={costTrendRef} data={costTrendChart} options={CHART_DARK_NO_LEGEND} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-600 text-sm">No trend data</div>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">Cost by Site</p>
                <div className="h-52">
                  {costBySite.length > 0 ? (
                    <Bar ref={costBySiteRef} data={costBySiteChart} options={CHART_HORIZONTAL} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-600 text-sm">No site data</div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
              {/* Cost by Brand */}
              <div>
                <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">Cost by Brand</p>
                <div className="h-44">
                  {costByBrand.length > 0 ? (
                    <Bar ref={costByBrandRef} data={costByBrandChart} options={CHART_HORIZONTAL} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-600 text-sm">No brand data</div>
                  )}
                </div>
              </div>

              {/* Top 5 cost drivers */}
              <div>
                <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">Top 5 Cost Vehicles</p>
                <div className="space-y-2">
                  {topCostVehicles.map((v, i) => (
                    <div key={v.asset_no} className="flex items-center gap-3 bg-gray-950 rounded-lg px-3 py-2 border border-gray-800">
                      <span className="text-xs font-bold text-gray-500 w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{v.asset_no}</p>
                        <p className="text-xs text-gray-500">{v.site} · {v.count} tyres</p>
                      </div>
                      <span className="text-xs font-bold text-amber-400">{fmtCurrency(v.cost, currency)}</span>
                    </div>
                  ))}
                  {topCostVehicles.length === 0 && (
                    <p className="text-xs text-gray-600 text-center py-4">No vehicle cost data</p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 5 - RISK ASSESSMENT
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}>
          <Card>
            <SectionHeader
              icon={ShieldAlert}
              title="Section 5 - Risk Assessment"
              subtitle="Fleet risk exposure, site matrix, and risk trend analysis"
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Fleet risk score */}
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 flex flex-col items-center justify-center text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-3">Fleet Risk Score</p>
                <div className={`text-5xl font-black mb-2 ${
                  fleetRiskScore >= 3 ? 'text-red-400' : fleetRiskScore >= 2 ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {fleetRiskScore.toFixed(2)}
                </div>
                <p className="text-xs text-gray-500">out of 4.00 (max)</p>
                <div className="mt-3 w-full bg-gray-800 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      fleetRiskScore >= 3 ? 'bg-red-500' : fleetRiskScore >= 2 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min((fleetRiskScore / 4) * 100, 100)}%` }}
                  />
                </div>
                <p className={`text-xs font-semibold mt-2 ${
                  fleetRiskScore >= 3 ? 'text-red-400' : fleetRiskScore >= 2 ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {fleetRiskScore >= 3 ? 'HIGH RISK' : fleetRiskScore >= 2 ? 'MODERATE RISK' : 'ACCEPTABLE RISK'}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 w-full text-xs">
                  {[
                    { label: 'Critical', count: periodRecords.filter(r => r.risk_level === 'Critical').length, color: 'text-red-400' },
                    { label: 'High', count: periodRecords.filter(r => r.risk_level === 'High').length, color: 'text-orange-400' },
                    { label: 'Medium', count: periodRecords.filter(r => r.risk_level === 'Medium').length, color: 'text-amber-400' },
                    { label: 'Low', count: periodRecords.filter(r => r.risk_level === 'Low').length, color: 'text-emerald-400' },
                  ].map(item => (
                    <div key={item.label} className="bg-gray-900 rounded-lg p-2 border border-gray-800">
                      <p className={`text-base font-bold ${item.color}`}>{item.count}</p>
                      <p className="text-gray-500">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Risk trend chart */}
              <div>
                <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">6-Month Risk Score Trend</p>
                <div className="h-56">
                  <Line ref={riskTrendRef} data={riskTrendChart} options={{
                    ...CHART_DARK,
                    plugins: { ...CHART_DARK.plugins, legend: { display: false } },
                  }} />
                </div>
              </div>

              {/* Risk heat map */}
              <div>
                <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">Site Risk Heat Map</p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {riskMatrix.slice(0, 10).map(row => {
                    const sc = row.score >= 3 ? 'bg-red-500/20 border-red-500/30 text-red-400'
                      : row.score >= 2 ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                      : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                    return (
                      <div key={row.site} className={`flex items-center justify-between rounded-lg px-3 py-2 border ${sc} text-xs`}>
                        <span className="font-medium text-white">{row.site}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-red-400">{row.Critical}C</span>
                          <span className="text-orange-400">{row.High}H</span>
                          <span className="text-amber-400">{row.Medium}M</span>
                          <span className="font-bold">{row.score.toFixed(1)}</span>
                        </div>
                      </div>
                    )
                  })}
                  {riskMatrix.length === 0 && (
                    <p className="text-xs text-gray-600 text-center py-6">No risk data</p>
                  )}
                </div>
              </div>
            </div>

            {/* Risk matrix table */}
            <div className="mt-6">
              <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">Risk Matrix - Sites × Risk Level</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">Site</th>
                      <th className="text-center py-2 px-3 text-red-400 font-medium">Critical</th>
                      <th className="text-center py-2 px-3 text-orange-400 font-medium">High</th>
                      <th className="text-center py-2 px-3 text-amber-400 font-medium">Medium</th>
                      <th className="text-center py-2 px-3 text-emerald-400 font-medium">Low</th>
                      <th className="text-center py-2 px-3 text-gray-400 font-medium">Total</th>
                      <th className="text-center py-2 px-3 text-gray-400 font-medium">Risk Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riskMatrix.map(row => (
                      <tr key={row.site} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="py-2 px-3 text-gray-200 font-medium">{row.site}</td>
                        <td className="py-2 px-3 text-center">
                          {row.Critical > 0
                            ? <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">{row.Critical}</span>
                            : <span className="text-gray-700">-</span>}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {row.High > 0
                            ? <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-bold">{row.High}</span>
                            : <span className="text-gray-700">-</span>}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {row.Medium > 0
                            ? <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">{row.Medium}</span>
                            : <span className="text-gray-700">-</span>}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {row.Low > 0
                            ? <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">{row.Low}</span>
                            : <span className="text-gray-700">-</span>}
                        </td>
                        <td className="py-2 px-3 text-center text-gray-300">{row.total}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`font-bold ${row.score >= 3 ? 'text-red-400' : row.score >= 2 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {row.score.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top 10 high risk records */}
            {top10HighRisk.length > 0 && (
              <div className="mt-6">
                <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">Top 10 Highest-Risk Records</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left py-2 px-3 text-gray-400 font-medium">Asset No</th>
                        <th className="text-left py-2 px-3 text-gray-400 font-medium">Site</th>
                        <th className="text-center py-2 px-3 text-gray-400 font-medium">Risk</th>
                        <th className="text-left py-2 px-3 text-gray-400 font-medium">Brand</th>
                        <th className="text-left py-2 px-3 text-gray-400 font-medium">Position</th>
                        <th className="text-left py-2 px-3 text-gray-400 font-medium">Findings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top10HighRisk.map((r, i) => (
                        <tr key={r.id || i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                          <td className="py-2 px-3 text-white font-medium">{r.asset_no || '-'}</td>
                          <td className="py-2 px-3 text-gray-300">{r.site || '-'}</td>
                          <td className="py-2 px-3 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                              r.risk_level === 'Critical' ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400'
                            }`}>
                              {r.risk_level}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-gray-300">{r.brand || '-'}</td>
                          <td className="py-2 px-3 text-gray-400">{r.position || '-'}</td>
                          <td className="py-2 px-3 text-gray-400 max-w-xs truncate">{r.findings?.slice(0, 60) || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 6 - RECOMMENDATIONS
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.25 }}>
          <Card>
            <SectionHeader
              icon={Target}
              title="Section 6 - Recommendations"
              subtitle="Prioritised management recommendations based on fleet intelligence"
              badge={`${recommendations.length} Actions`}
            />

            <div className="space-y-3">
              {recommendations.map((rec, i) => (
                <div
                  key={i}
                  className="bg-gray-950 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PRIORITY_STYLES[rec.priority]}`}>
                        {rec.priority}
                      </span>
                      <h3 className="text-sm font-semibold text-white">{rec.title}</h3>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Building2 className="w-3 h-3 text-gray-500" />
                      <span className="text-xs text-gray-400">{rec.owner}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed mb-2">{rec.description}</p>
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="w-3 h-3 text-emerald-500" />
                    <span className="text-xs text-emerald-400">{rec.impact}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 7 - ACTION PLAN
        ═══════════════════════════════════════════════════════════════ */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3 }}>
          <Card>
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Section 7 - Action Plan</h2>
                  <p className="text-sm text-gray-400 mt-0.5">30/60/90 day structured delivery plan</p>
                </div>
              </div>
              <button
                onClick={exportActionPlanPDF}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-all no-print"
              >
                <Download className="w-3.5 h-3.5" />
                Export Action Plan
              </button>
            </div>

            {/* Phase dividers */}
            {[
              { label: '30-Day Actions - Immediate', days: '0-30', color: 'text-red-400 border-red-500/30 bg-red-500/5', rows: actionPlan.slice(0, 4) },
              { label: '60-Day Actions - Short Term', days: '30-60', color: 'text-amber-400 border-amber-500/30 bg-amber-500/5', rows: actionPlan.slice(4, 7) },
              { label: '90-Day Actions - Strategic', days: '60-90', color: 'text-blue-400 border-blue-500/30 bg-blue-500/5', rows: actionPlan.slice(7) },
            ].map(phase => (
              <div key={phase.label} className="mb-5">
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border mb-3 ${phase.color}`}>
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-xs font-semibold">{phase.label}</span>
                  <ChevronRight className="w-3 h-3 ml-auto" />
                  <span className="text-xs">{phase.days} days</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left py-1.5 px-3 text-gray-500 font-medium">Action</th>
                        <th className="text-center py-1.5 px-3 text-gray-500 font-medium">Priority</th>
                        <th className="text-center py-1.5 px-3 text-gray-500 font-medium">Timeline</th>
                        <th className="text-center py-1.5 px-3 text-gray-500 font-medium">Owner</th>
                        <th className="text-right py-1.5 px-3 text-gray-500 font-medium">Est. Saving</th>
                        <th className="text-center py-1.5 px-3 text-gray-500 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {phase.rows.map((action, i) => (
                        <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                          <td className="py-2 px-3 text-gray-200 max-w-sm">{action.action}</td>
                          <td className="py-2 px-3 text-center">
                            <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${PRIORITY_STYLES[action.priority]}`}>
                              {action.priority}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center text-gray-400">{action.timeline}</td>
                          <td className="py-2 px-3 text-center">
                            <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300 text-xs">{action.owner}</span>
                          </td>
                          <td className="py-2 px-3 text-right text-emerald-400 font-medium">{action.saving}</td>
                          <td className="py-2 px-3 text-center">
                            <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs">
                              {action.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {/* Summary footer */}
            <div className="mt-4 border-t border-gray-800 pt-4 flex flex-wrap items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                {actionPlan.length} actions identified
              </span>
              <span className="flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                Total opportunity: {fmtCurrency(savingsOpportunity + totalSpend * 0.15, currency)} estimated annually
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-blue-400" />
                4 stakeholder groups engaged
              </span>
              <span className="ml-auto text-gray-700">
                Report generated {formatDate(new Date(), 'All', { day: '2-digit', month: 'long', year: 'numeric' })}
              </span>
            </div>
          </Card>
        </motion.div>

      </div>

      <EmailReportModal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        reportTitle="Executive Fleet Report"
        pdfColumns={['Site', 'Critical', 'High', 'Medium', 'Low', 'Total', 'Risk Score']}
        pdfRows={riskMatrix.map(r => [r.site, r.Critical, r.High, r.Medium, r.Low, r.total, r.score.toFixed(2)])}
        kpiSummary={{
          'Fleet Avg CPK':          fmtCpk(kpis.cpk.fleetAvgCpk, currency),
          'Total Period Spend':     fmtCurrency(totalSpend, currency),
          'Projected Annual':       fmtCurrency(projectedAnnual, currency),
          'Failure Rate':           fmtPct(kpis.failureRate.failureRate * 100),
          'Inspection Compliance':  fmtPct(kpis.inspectionCompliance.compliancePct),
          'Fleet Availability':     fmtPct(kpis.fleetAvailability.availabilityPct),
          'Scrap Rate':             fmtPct(kpis.scrapRate.scrapRate * 100),
          'Savings Opportunity':    fmtCurrency(savingsOpportunity, currency),
        }}
        period={PERIODS.find(p => p.key === period)?.label || 'Quarter'}
      />
    </div>
  )
}
