import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap, Download, FileText, TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronRight, CheckCircle, Clock, AlertTriangle,
  XCircle, DollarSign, BarChart2, Target, RefreshCw, Plus,
  Package, Wrench, Search, ShieldCheck, Truck, Star,
  ArrowUpRight, ArrowDownRight, Award, Activity, Info,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import * as ciApi from '../lib/api/continuousImprovement'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const PRIORITY_BADGE = {
  High:   'bg-red-900/50 text-red-300 border border-red-700/50',
  Medium: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50',
  Low:    'bg-blue-900/50 text-blue-300 border border-blue-700/50',
}

const STATUS_COLORS = {
  Open:         'bg-red-900/40 text-red-300 border border-red-700/50',
  'In Progress':'bg-yellow-900/40 text-yellow-300 border border-yellow-700/50',
  Closed:       'bg-green-900/40 text-green-300 border border-green-700/50',
  Overdue:      'bg-orange-900/40 text-orange-300 border border-orange-700/50',
}

const CATEGORY_META = {
  cost:        { label: 'Cost Reduction',      icon: DollarSign,  color: '#10b981', bg: 'from-green-900/20'  },
  reliability: { label: 'Reliability',          icon: ShieldCheck, color: '#3b82f6', bg: 'from-blue-900/20'   },
  process:     { label: 'Process',              icon: RefreshCw,   color: '#f59e0b', bg: 'from-yellow-900/20' },
  inspection:  { label: 'Inspection',           icon: Search,      color: '#8b5cf6', bg: 'from-purple-900/20' },
  maintenance: { label: 'Maintenance',          icon: Wrench,      color: '#ef4444', bg: 'from-red-900/20'    },
  procurement: { label: 'Procurement',          icon: Package,     color: '#06b6d4', bg: 'from-cyan-900/20'   },
}

const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280', font: { size: 10 } } },
    y: { grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280', font: { size: 10 } } },
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '-'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtCur(n, currency, decimals = 0) {
  if (n == null || isNaN(n)) return '-'
  return `${currency} ${fmt(n, decimals)}`
}

function daysOpen(created_at) {
  if (!created_at) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(created_at).getTime()) / 86400000))
}

function monthKey(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function last12MonthKeys() {
  const keys = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

function monthLabel(key) {
  const [yr, mo] = key.split('-')
  return `${MONTH_LABELS[parseInt(mo) - 1]} ${yr.slice(2)}`
}

function scoreColor(score) {
  if (score >= 75) return 'text-green-400'
  if (score >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function scoreBg(score) {
  if (score >= 75) return 'border-green-700/50 bg-green-950/20'
  if (score >= 50) return 'border-yellow-700/50 bg-yellow-950/10'
  return 'border-red-700/50 bg-red-950/20'
}

// ── Opportunity row component ─────────────────────────────────────────────────

function OpportunityRow({ opp, onCreateAction, alreadyCreated, creating }) {
  const { activeCurrency } = useSettings()
  const [expanded, setExpanded] = useState(false)
  const ImpactIcon = opp.saving > 0 ? ArrowDownRight : ArrowUpRight

  return (
    <motion.div
      layout
      className="border border-[var(--input-border)] rounded-lg overflow-hidden"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-[var(--surface-1)] hover:bg-[var(--input-bg)]/60 transition-colors text-left"
      >
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${PRIORITY_BADGE[opp.priority] ?? PRIORITY_BADGE.Medium}`}>
          {opp.priority}
        </span>
        <span className="flex-1 text-sm text-[var(--text-secondary)]">{opp.title}</span>
        {opp.saving > 0 && (
          <span className="flex items-center gap-1 text-xs text-green-400 font-medium">
            <ImpactIcon size={12} />
            Est. {fmtCur(opp.saving, opp.currency ?? activeCurrency)} / yr
          </span>
        )}
        {opp.impactPct > 0 && (
          <span className="text-xs text-emerald-400 font-medium ml-2">{fmt(opp.impactPct, 1)}% improvement</span>
        )}
        {expanded ? <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" /> : <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-2 bg-[var(--input-bg)]/60 border-t border-[var(--input-border)] space-y-3">
              <p className="text-sm text-[var(--text-muted)]">{opp.description}</p>
              {opp.details && (
                <ul className="space-y-1">
                  {opp.details.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-muted)]">
                      <span className="text-[var(--text-dim)] mt-0.5">•</span>
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-3 pt-1">
                {alreadyCreated ? (
                  <span className="flex items-center gap-1 text-xs text-green-400">
                    <CheckCircle size={12} /> Action already created
                  </span>
                ) : (
                  <button
                    onClick={() => onCreateAction(opp)}
                    disabled={creating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                  >
                    {creating ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                    Create Corrective Action
                  </button>
                )}
                {opp.site && (
                  <span className="text-xs text-[var(--text-dim)]">Site: {opp.site}</span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Category accordion ────────────────────────────────────────────────────────

function CategoryAccordion({ categoryKey, opportunities, onCreateAction, createdTitles, creatingKey }) {
  const [open, setOpen] = useState(true)
  const meta = CATEGORY_META[categoryKey]
  const Icon = meta.icon

  return (
    <div className={`bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--input-bg)]/40 transition-colors"
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: `${meta.color}20` }}>
          <Icon size={14} style={{ color: meta.color }} />
        </span>
        <span className="font-semibold text-sm text-[var(--text-secondary)]">{meta.label} Opportunities</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">{opportunities.length} found</span>
          {open ? <ChevronDown size={14} className="text-[var(--text-muted)]" /> : <ChevronRight size={14} className="text-[var(--text-muted)]" />}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2 border-t border-[var(--input-border)]">
              {opportunities.length === 0 ? (
                <p className="text-xs text-[var(--text-dim)] py-3 text-center">No improvement opportunities detected, performing well in this area.</p>
              ) : (
                opportunities.map((opp, i) => (
                  <OpportunityRow
                    key={opp.key ?? i}
                    opp={opp}
                    onCreateAction={onCreateAction}
                    alreadyCreated={createdTitles.has(opp.title)}
                    creating={creatingKey === opp.key}
                  />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium
        ${type === 'success' ? 'bg-green-950 border-green-700 text-green-300' : 'bg-red-950 border-red-700 text-red-300'}`}
    >
      {type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
      {message}
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContinuousImprovement() {
  const { activeCurrency, activeCountry } = useSettings()

  const [records, setRecords]     = useState([])
  const [actions, setActions]     = useState([])
  const [inspections, setInspections] = useState([])
  const [targets, setTargets]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [creatingKey, setCreatingKey] = useState(null)
  const [toast, setToast]         = useState(null)
  const [period, setPeriod]       = useState('6mo')
  const [closingId, setClosingId] = useState(null)

  // ── Load data ────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [recRes, actRes, insRes, tgtRes] = await Promise.all([
        ciApi.listImprovementTyreRecords({ country: activeCountry }),
        ciApi.listImprovementActions({ country: activeCountry }),
        ciApi.listImprovementInspections({ country: activeCountry }),
        ciApi.listImprovementKpiTargets(),
      ])

      setRecords(recRes.data ?? [])
      setActions(actRes.data ?? [])
      setInspections(insRes.data ?? [])
      setTargets(tgtRes.data ?? [])
    } catch (e) {
      setError(toUserMessage(e, 'Failed to load data'))
    }
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Period cutoff ─────────────────────────────────────────────────────────────

  const periodCutoff = useMemo(() => {
    const now = new Date()
    if (period === '3mo') return new Date(now.getFullYear(), now.getMonth() - 3, 1)
    if (period === '6mo') return new Date(now.getFullYear(), now.getMonth() - 6, 1)
    if (period === '1yr') return new Date(now.getFullYear(), now.getMonth() - 12, 1)
    return new Date(now.getFullYear(), now.getMonth() - 6, 1)
  }, [period])

  const filteredRecords = useMemo(
    () => records.filter(r => r.issue_date && new Date(r.issue_date) >= periodCutoff),
    [records, periodCutoff]
  )

  // ── Core derived metrics ──────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const withKm = records.filter(r => r.km_at_fitment != null && r.km_at_removal != null && r.cost_per_tyre > 0)
    const cpkList = withKm.map(r => {
      const km = r.km_at_removal - r.km_at_fitment
      return km > 0 ? r.cost_per_tyre / km : null
    }).filter(Boolean)
    const avgCpk = cpkList.length ? cpkList.reduce((a, b) => a + b, 0) / cpkList.length : 0

    const totalCost = records.reduce((s, r) => s + (r.cost_per_tyre ?? 0) * (r.qty || 1), 0)
    const avgCostPerTyre = records.length ? totalCost / records.length : 0

    const failures = records.filter(r => r.risk_level === 'High' || r.category === 'Scrap')
    const failureRate = records.length ? (failures.length / records.length) * 100 : 0

    const completed = inspections.filter(i => i.status === 'Completed' || i.completed_date)
    const inspectionCompliance = inspections.length ? (completed.length / inspections.length) * 100 : 0

    const closedActions = actions.filter(a => a.status === 'Closed')
    const closeRate = actions.length ? (closedActions.length / actions.length) * 100 : 0

    return { avgCpk, avgCostPerTyre, totalCost, failureRate, inspectionCompliance, closeRate }
  }, [records, inspections, actions])

  // ── Improvement Score ─────────────────────────────────────────────────────────

  const improvementScore = useMemo(() => {
    const monthKeys = last12MonthKeys()
    const midPoint = monthKeys[5]

    const recentRec = records.filter(r => monthKey(r.issue_date) > midPoint)
    const olderRec  = records.filter(r => monthKey(r.issue_date) <= midPoint && monthKey(r.issue_date) >= monthKeys[0])

    function avgCpkFor(recs) {
      const wk = recs.filter(r => r.km_at_fitment != null && r.km_at_removal != null && r.cost_per_tyre > 0)
      const cpks = wk.map(r => {
        const km = r.km_at_removal - r.km_at_fitment
        return km > 0 ? r.cost_per_tyre / km : null
      }).filter(Boolean)
      return cpks.length ? cpks.reduce((a, b) => a + b, 0) / cpks.length : null
    }

    const recentCpk = avgCpkFor(recentRec)
    const olderCpk  = avgCpkFor(olderRec)

    let costPts = 12
    if (recentCpk != null && olderCpk != null && olderCpk > 0) {
      const pctImprove = (olderCpk - recentCpk) / olderCpk
      costPts = Math.min(25, Math.max(0, 12.5 + pctImprove * 100))
    }

    function failureRateFor(recs) {
      if (!recs.length) return null
      const f = recs.filter(r => r.risk_level === 'High' || r.category === 'Scrap')
      return (f.length / recs.length) * 100
    }

    const recentFR = failureRateFor(recentRec)
    const olderFR  = failureRateFor(olderRec)

    let relPts = 12
    if (recentFR != null && olderFR != null && olderFR > 0) {
      const pctImprove = (olderFR - recentFR) / olderFR
      relPts = Math.min(25, Math.max(0, 12.5 + pctImprove * 100))
    }

    const inspPts  = (metrics.inspectionCompliance / 100) * 25
    const closePts = (metrics.closeRate / 100) * 25

    const total = Math.round(costPts + relPts + inspPts + closePts)

    // last month score estimate
    const prevMonth = monthKeys[10]
    const prevRec = records.filter(r => monthKey(r.issue_date) === prevMonth)
    const currRec = records.filter(r => monthKey(r.issue_date) === monthKeys[11])
    const prevFR = failureRateFor(prevRec)
    const currFR = failureRateFor(currRec)
    let delta = null
    if (prevFR != null && currFR != null) {
      delta = prevFR > currFR ? 2 : currFR > prevFR ? -2 : 0
    }

    return { total, costPts: Math.round(costPts), relPts: Math.round(relPts), inspPts: Math.round(inspPts), closePts: Math.round(closePts), delta }
  }, [records, metrics])

  // ── Opportunities ─────────────────────────────────────────────────────────────

  const opportunities = useMemo(() => {
    const cur = activeCurrency
    const result = { cost: [], reliability: [], process: [], inspection: [], maintenance: [], procurement: [] }

    // ── A. Cost Reduction ──────────────────────────────────────────────────────
    const brandMap = {}
    records.forEach(r => {
      if (!r.brand || !r.km_at_fitment || !r.km_at_removal || !r.cost_per_tyre) return
      const km = r.km_at_removal - r.km_at_fitment
      if (km <= 0) return
      const cpk = r.cost_per_tyre / km
      if (!brandMap[r.brand]) brandMap[r.brand] = { cpks: [], costs: [] }
      brandMap[r.brand].cpks.push(cpk)
      brandMap[r.brand].costs.push(r.cost_per_tyre)
    })

    const brandCpks = Object.entries(brandMap)
      .map(([brand, v]) => ({ brand, avgCpk: v.cpks.reduce((a, b) => a + b, 0) / v.cpks.length, count: v.cpks.length }))
      .filter(b => b.count >= 3)
      .sort((a, b) => a.avgCpk - b.avgCpk)

    if (brandCpks.length >= 2) {
      const best  = brandCpks[0]
      const worst = brandCpks[brandCpks.length - 1]
      const avgKm = 50000
      const fleetReplacements = records.length / Math.max(1, (new Date() - new Date(records[records.length - 1]?.issue_date ?? Date.now())) / (365 * 86400000))
      const annualSaving = Math.round(fleetReplacements * (worst.avgCpk - best.avgCpk) * avgKm)

      result.cost.push({
        key: 'brand-switch',
        title: `Switch procurement from ${worst.brand} to ${best.brand}`,
        description: `${worst.brand} has CPK ${fmt(worst.avgCpk, 4)} vs ${best.brand} at ${fmt(best.avgCpk, 4)} - a ${fmt((worst.avgCpk - best.avgCpk) / best.avgCpk * 100, 1)}% difference. Migrating procurement could generate significant annual savings.`,
        priority: 'High',
        saving: annualSaving > 0 ? annualSaving : 0,
        currency: cur,
        details: [
          `${worst.brand}: avg CPK ${fmt(worst.avgCpk, 4)} (${worst.count} tyres)`,
          `${best.brand}: avg CPK ${fmt(best.avgCpk, 4)} (${best.count} tyres)`,
          `Estimated fleet replacements/year: ${fmt(Math.round(fleetReplacements))}`,
        ],
      })
    }

    // Site with highest avg cost
    const siteMap = {}
    records.forEach(r => {
      if (!r.site || !r.cost_per_tyre) return
      if (!siteMap[r.site]) siteMap[r.site] = []
      siteMap[r.site].push(r.cost_per_tyre)
    })
    const siteCosts = Object.entries(siteMap)
      .map(([site, costs]) => ({ site, avg: costs.reduce((a, b) => a + b, 0) / costs.length, count: costs.length }))
      .filter(s => s.count >= 5)
      .sort((a, b) => b.avg - a.avg)

    const fleetAvgCost = metrics.avgCostPerTyre
    if (siteCosts.length > 1 && siteCosts[0].avg > fleetAvgCost * 1.2) {
      result.cost.push({
        key: 'site-cost-audit',
        title: `Audit ${siteCosts[0].site} cost controls - ${fmt(((siteCosts[0].avg / fleetAvgCost) - 1) * 100, 0)}% above fleet average`,
        description: `Site ${siteCosts[0].site} averages ${fmtCur(siteCosts[0].avg, cur)} per tyre replacement vs fleet average ${fmtCur(fleetAvgCost, cur)}. A procurement and workshop audit may identify overspend drivers.`,
        priority: 'Medium',
        saving: Math.round((siteCosts[0].avg - fleetAvgCost) * siteCosts[0].count),
        currency: cur,
        site: siteCosts[0].site,
        details: siteCosts.slice(0, 5).map(s => `${s.site}: avg ${fmtCur(s.avg, cur)} (${s.count} tyres)`),
      })
    }

    // High CPK vehicles
    const vehicleMap = {}
    records.forEach(r => {
      if (!r.asset_no || !r.km_at_fitment || !r.km_at_removal || !r.cost_per_tyre) return
      const km = r.km_at_removal - r.km_at_fitment
      if (km <= 0) return
      if (!vehicleMap[r.asset_no]) vehicleMap[r.asset_no] = []
      vehicleMap[r.asset_no].push(r.cost_per_tyre / km)
    })
    const fleetAvgCpk = metrics.avgCpk
    const highCpkVehicles = Object.entries(vehicleMap)
      .map(([asset, cpks]) => ({ asset, avg: cpks.reduce((a, b) => a + b, 0) / cpks.length, count: cpks.length }))
      .filter(v => v.count >= 2 && v.avg > fleetAvgCpk * 2)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 8)

    if (highCpkVehicles.length > 0) {
      result.cost.push({
        key: 'high-cpk-vehicles',
        title: `${highCpkVehicles.length} vehicles operating at 2× fleet average CPK`,
        description: `These vehicles show abnormally high cost-per-kilometre. Root causes may include alignment issues, driver behaviour, route conditions, or wrong tyre specification.`,
        priority: 'High',
        saving: Math.round(highCpkVehicles.reduce((s, v) => s + (v.avg - fleetAvgCpk) * 50000 * v.count, 0)),
        currency: cur,
        details: highCpkVehicles.map(v => `${v.asset}: CPK ${fmt(v.avg, 4)} - ${fmt(((v.avg / fleetAvgCpk) - 1) * 100, 0)}% above average`),
      })
    }

    // ── B. Reliability ────────────────────────────────────────────────────────

    const posMap = {}
    records.forEach(r => {
      if (!r.position) return
      if (!posMap[r.position]) posMap[r.position] = { total: 0, failures: 0 }
      posMap[r.position].total++
      if (r.risk_level === 'High' || r.category === 'Scrap') posMap[r.position].failures++
    })

    Object.entries(posMap).forEach(([pos, v]) => {
      const rate = v.total > 4 ? (v.failures / v.total) * 100 : 0
      if (rate > 20) {
        result.reliability.push({
          key: `pos-failure-${pos}`,
          title: `High failure rate on ${pos} position (${fmt(rate, 1)}%)`,
          description: `${pos} tyres are failing at ${fmt(rate, 1)}% - above the 20% threshold. Inspect all ${pos} tyres immediately. Likely causes: inflation non-compliance, alignment, or load distribution issues.`,
          priority: rate > 35 ? 'High' : 'Medium',
          impactPct: rate - 20,
          details: [`${v.failures} failures out of ${v.total} tyres on ${pos} position`],
        })
      }
    })

    const fleetFailureRate = metrics.failureRate
    const siteFailMap = {}
    records.forEach(r => {
      if (!r.site) return
      if (!siteFailMap[r.site]) siteFailMap[r.site] = { total: 0, failures: 0 }
      siteFailMap[r.site].total++
      if (r.risk_level === 'High' || r.category === 'Scrap') siteFailMap[r.site].failures++
    })
    Object.entries(siteFailMap).forEach(([site, v]) => {
      const rate = v.total > 4 ? (v.failures / v.total) * 100 : 0
      if (rate > fleetFailureRate * 1.3 && rate > 10) {
        result.reliability.push({
          key: `site-failure-${site}`,
          title: `${site} failure rate ${fmt(rate, 1)}% - ${fmt(rate - fleetFailureRate, 1)}pp above fleet average`,
          description: `Site ${site} has a significantly elevated failure rate. A reliability review covering workshop practices, tyre selection, and maintenance compliance is recommended.`,
          priority: 'Medium',
          site,
          details: [`Fleet avg: ${fmt(fleetFailureRate, 1)}%`, `${site}: ${fmt(rate, 1)}% (${v.failures}/${v.total} tyres)`],
        })
      }
    })

    const brandFailMap = {}
    records.forEach(r => {
      if (!r.brand) return
      if (!brandFailMap[r.brand]) brandFailMap[r.brand] = { total: 0, failures: 0 }
      brandFailMap[r.brand].total++
      if (r.risk_level === 'High' || r.category === 'Scrap') brandFailMap[r.brand].failures++
    })
    Object.entries(brandFailMap).forEach(([brand, v]) => {
      const rate = v.total > 5 ? (v.failures / v.total) * 100 : 0
      if (rate > fleetFailureRate * 1.4 && rate > 12) {
        result.reliability.push({
          key: `brand-failure-${brand}`,
          title: `${brand} failure rate ${fmt(rate, 1)}% - review procurement`,
          description: `${brand} tyres show above-average failure rate. Consider replacing with higher-reliability brands if CPK analysis supports this decision.`,
          priority: 'Medium',
          details: [`Fleet avg failure rate: ${fmt(fleetFailureRate, 1)}%`, `${brand}: ${fmt(rate, 1)}% (${v.failures}/${v.total} tyres)`],
        })
      }
    })

    // ── C. Process Improvements ───────────────────────────────────────────────

    const overdueActions = actions.filter(a =>
      a.status !== 'Closed' && daysOpen(a.created_at) > 14
    )
    if (overdueActions.length > 0) {
      result.process.push({
        key: 'overdue-actions',
        title: `${overdueActions.length} corrective actions overdue (>14 days open)`,
        description: `These open actions represent unresolved operational risks. Escalation and assignment review required to restore action close rate.`,
        priority: overdueActions.length > 10 ? 'High' : 'Medium',
        details: overdueActions.slice(0, 6).map(a => `${a.title} - ${daysOpen(a.created_at)}d open${a.site ? ` (${a.site})` : ''}`),
      })
    }

    const siteInspComp = {}
    inspections.forEach(i => {
      if (!i.site) return
      if (!siteInspComp[i.site]) siteInspComp[i.site] = { total: 0, done: 0 }
      siteInspComp[i.site].total++
      if (i.status === 'Completed' || i.completed_date) siteInspComp[i.site].done++
    })
    const lowComplianceSites = Object.entries(siteInspComp)
      .map(([site, v]) => ({ site, pct: v.total > 2 ? (v.done / v.total) * 100 : 100 }))
      .filter(s => s.pct < 85)
      .sort((a, b) => a.pct - b.pct)

    if (lowComplianceSites.length > 0) {
      result.process.push({
        key: 'inspection-compliance-sites',
        title: `${lowComplianceSites.length} sites below 85% inspection compliance`,
        description: `Low inspection compliance leads to undetected tyre degradation, increased failure rates, and higher replacement costs. Immediate compliance intervention required.`,
        priority: 'High',
        details: lowComplianceSites.map(s => `${s.site}: ${fmt(s.pct, 1)}% compliance`),
      })
    }

    const openActionsByPriority = actions.filter(a => a.status === 'Open')
    if (openActionsByPriority.filter(a => a.priority === 'High').length > 5) {
      result.process.push({
        key: 'high-priority-backlog',
        title: `${openActionsByPriority.filter(a => a.priority === 'High').length} high-priority actions still open`,
        description: `High-priority corrective actions are accumulating. Review assignment, escalate unresolved items, and implement daily action tracking.`,
        priority: 'High',
        details: openActionsByPriority.filter(a => a.priority === 'High').slice(0, 5).map(a => `${a.title}${a.site ? ` - ${a.site}` : ''}`),
      })
    }

    // ── D. Inspection Improvements ────────────────────────────────────────────

    const sitesWithNoInspections = [...new Set(records.map(r => r.site).filter(Boolean))]
      .filter(site => !siteInspComp[site])

    if (sitesWithNoInspections.length > 0) {
      result.inspection.push({
        key: 'sites-no-inspections',
        title: `${sitesWithNoInspections.length} active site(s) with no inspection records`,
        description: `Sites with tyre records but no inspection history represent unmonitored operational risk. Establish regular inspection schedules immediately.`,
        priority: 'High',
        details: sitesWithNoInspections.map(s => `${s}: no inspections found`),
      })
    }

    const overdueInspections = inspections.filter(i => {
      if (i.status === 'Completed' || i.completed_date) return false
      if (!i.scheduled_date) return false
      return new Date(i.scheduled_date) < new Date()
    })
    if (overdueInspections.length > 0) {
      result.inspection.push({
        key: 'overdue-inspections',
        title: `${overdueInspections.length} scheduled inspections are overdue`,
        description: `Overdue inspections create compliance gaps and undetected tyre risk. Implement automated reminder and escalation workflow.`,
        priority: overdueInspections.length > 20 ? 'High' : 'Medium',
        details: [`${overdueInspections.length} inspections past scheduled date`],
      })
    }

    if (metrics.inspectionCompliance < 75) {
      result.inspection.push({
        key: 'fleet-inspection-compliance',
        title: `Fleet inspection compliance at ${fmt(metrics.inspectionCompliance, 1)}% - critical`,
        description: `Overall inspection compliance is critically low. Without systematic inspections, pressure non-compliance and wear issues go undetected. A structured inspection programme rollout is required.`,
        priority: 'High',
        impactPct: 75 - metrics.inspectionCompliance,
      })
    }

    // ── E. Maintenance Improvements ───────────────────────────────────────────

    const vehicleHighRiskCount = {}
    const now12 = new Date()
    now12.setMonth(now12.getMonth() - 12)
    records.filter(r => r.issue_date && new Date(r.issue_date) >= now12 && r.risk_level === 'High').forEach(r => {
      if (!r.asset_no) return
      vehicleHighRiskCount[r.asset_no] = (vehicleHighRiskCount[r.asset_no] ?? 0) + 1
    })
    const repeatHighRisk = Object.entries(vehicleHighRiskCount)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    if (repeatHighRisk.length > 0) {
      result.maintenance.push({
        key: 'repeat-high-risk-vehicles',
        title: `${repeatHighRisk.length} vehicles with 3+ high-risk tyres in 12 months`,
        description: `Repeated high-risk tyre events on the same vehicle suggest a systemic mechanical issue: alignment, suspension, brake drag, or driver behaviour. Full vehicle inspection required.`,
        priority: 'High',
        details: repeatHighRisk.map(([asset, count]) => `${asset}: ${count} high-risk tyre events`),
      })
    }

    const siteScrapMap = {}
    records.forEach(r => {
      if (!r.site) return
      if (!siteScrapMap[r.site]) siteScrapMap[r.site] = { total: 0, scrap: 0 }
      siteScrapMap[r.site].total++
      if (r.category === 'Scrap') siteScrapMap[r.site].scrap++
    })
    const fleetScrapRate = records.length ? (records.filter(r => r.category === 'Scrap').length / records.length) * 100 : 0
    const highScrapSites = Object.entries(siteScrapMap)
      .map(([site, v]) => ({ site, rate: v.total > 5 ? (v.scrap / v.total) * 100 : 0 }))
      .filter(s => s.rate > fleetScrapRate * 1.5 && s.rate > 10)
      .sort((a, b) => b.rate - a.rate)

    if (highScrapSites.length > 0) {
      result.maintenance.push({
        key: 'high-scrap-sites',
        title: `${highScrapSites.length} site(s) with elevated scrap rate - workshop audit required`,
        description: `These sites are generating scrap tyres at above-average rates. Root causes likely include poor installation practice, under-inflation, or overloading. Workshop audit recommended.`,
        priority: 'Medium',
        details: highScrapSites.map(s => `${s.site}: ${fmt(s.rate, 1)}% scrap rate`),
      })
    }

    const steerFast = posMap['Steer']
    if (steerFast && posMap['Drive']) {
      const steerFR = steerFast.total > 5 ? (steerFast.failures / steerFast.total) * 100 : 0
      const driveFR = posMap['Drive'].total > 5 ? (posMap['Drive'].failures / posMap['Drive'].total) * 100 : 0
      if (steerFR > driveFR * 1.5) {
        result.maintenance.push({
          key: 'steer-wear',
          title: `Steer tyres failing ${fmt(steerFR / Math.max(driveFR, 1), 1)}× faster than drive - rotation non-compliance signal`,
          description: `Steer tyre failure rate significantly exceeds drive axle, suggesting tyre rotation is not being performed. Implement mandatory rotation schedule.`,
          priority: 'Medium',
          details: [`Steer failure rate: ${fmt(steerFR, 1)}%`, `Drive failure rate: ${fmt(driveFR, 1)}%`],
        })
      }
    }

    // ── F. Procurement Improvements ───────────────────────────────────────────

    if (brandCpks.length >= 2) {
      result.procurement.push({
        key: 'brand-cpk-ranking',
        title: `Brand CPK ranking - procurement consolidation opportunity`,
        description: `Fleet is using ${brandCpks.length} brands with CPK variance of ${fmt(brandCpks[brandCpks.length-1].avgCpk - brandCpks[0].avgCpk, 4)}. Consolidating to top 2-3 performers could reduce CPK significantly.`,
        priority: brandCpks.length > 8 ? 'High' : 'Medium',
        details: brandCpks.slice(0, 6).map(b => `${b.brand}: CPK ${fmt(b.avgCpk, 4)} (${b.count} tyres)`),
      })
    }

    if (brandCpks.length > 8) {
      result.procurement.push({
        key: 'vendor-consolidation',
        title: `${brandCpks.length} active brands - vendor consolidation recommended`,
        description: `Operating with ${brandCpks.length} different tyre brands increases inventory complexity, reduces negotiating power, and complicates quality control. Consolidate to 3-5 preferred brands.`,
        priority: 'Medium',
        saving: Math.round(metrics.avgCostPerTyre * records.length * 0.05),
        currency: cur,
        details: [`Current active brands: ${brandCpks.length}`, 'Target: 3-5 preferred approved brands', 'Estimated procurement saving: 5-10% through volume discounts'],
      })
    }

    const retreads = records.filter(r => r.category === 'Retread')
    const newTyres = records.filter(r => r.category !== 'Retread')

    function avgCpkFromSet(set) {
      const wk = set.filter(r => r.km_at_fitment != null && r.km_at_removal != null && r.cost_per_tyre > 0)
      const cpks = wk.map(r => {
        const km = r.km_at_removal - r.km_at_fitment
        return km > 0 ? r.cost_per_tyre / km : null
      }).filter(Boolean)
      return cpks.length ? cpks.reduce((a, b) => a + b, 0) / cpks.length : null
    }

    const retreadCpk = avgCpkFromSet(retreads)
    const newTyreCpk = avgCpkFromSet(newTyres)

    if (retreadCpk != null && newTyreCpk != null && retreadCpk < newTyreCpk * 0.8 && retreads.length > 10) {
      const adoptionSaving = Math.round((newTyreCpk - retreadCpk) * 50000 * records.length * 0.15)
      result.procurement.push({
        key: 'retread-adoption',
        title: `Increase retread adoption - ${fmt(((newTyreCpk - retreadCpk) / newTyreCpk) * 100, 0)}% lower CPK than new tyres`,
        description: `Retreads are outperforming new tyres on CPK. Increasing retread adoption from ${fmt(retreads.length / records.length * 100, 0)}% to 25-30% of replacements could generate significant annual savings.`,
        priority: 'Medium',
        saving: adoptionSaving > 0 ? adoptionSaving : 0,
        currency: cur,
        details: [
          `Retread avg CPK: ${fmt(retreadCpk, 4)}`,
          `New tyre avg CPK: ${fmt(newTyreCpk, 4)}`,
          `Current retread share: ${fmt(retreads.length / records.length * 100, 1)}%`,
        ],
      })
    } else if (retreads.length < 5 && records.length > 50) {
      result.procurement.push({
        key: 'retread-opportunity',
        title: `Low retread usage (${fmt(retreads.length / Math.max(records.length, 1) * 100, 1)}%) - evaluate retread programme`,
        description: `Fleet retread adoption is very low. A structured retread evaluation programme could reduce tyre costs by 30-50% on eligible axle positions (drive and trailer).`,
        priority: 'Low',
        details: [`Current retreads: ${retreads.length} of ${records.length} total`, 'Typical retread saving: 30-50% cost reduction per tyre'],
      })
    }

    return result
  }, [records, actions, inspections, metrics, activeCurrency])

  // ── Action tracking ───────────────────────────────────────────────────────────

  const createdTitles = useMemo(() => new Set(actions.map(a => a.title)), [actions])

  const handleCreateAction = useCallback(async (opp) => {
    setCreatingKey(opp.key)
    try {
      const { error: insErr } = await ciApi.insertCorrectiveAction({
        title: opp.title,
        description: opp.description ?? '',
        site: opp.site ?? 'All',
        priority: opp.priority,
        status: 'Open',
        due_date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      })
      if (insErr) throw insErr
      setToast({ message: 'Corrective action created successfully', type: 'success' })
      // Refresh actions
      const { data } = await ciApi.listCorrectiveActionsRefresh()
      setActions(data ?? [])
    } catch (e) {
      setToast({ message: toUserMessage(e, 'Failed to create action'), type: 'error' })
    }
    setCreatingKey(null)
  }, [])

  const handleCloseAction = useCallback(async (id) => {
    setClosingId(id)
    try {
      await ciApi.closeCorrectiveAction(id, {
        status: 'Closed',
        resolved_at: new Date().toISOString(),
      })
      setActions(prev => prev.map(a => a.id === id ? { ...a, status: 'Closed', resolved_at: new Date().toISOString() } : a))
      setToast({ message: 'Action closed successfully', type: 'success' })
    } catch (e) {
      setToast({ message: 'Failed to close action', type: 'error' })
    }
    setClosingId(null)
  }, [])

  // ── Monthly trend charts ──────────────────────────────────────────────────────

  const monthKeys12 = useMemo(() => last12MonthKeys(), [])

  const cpkTrendData = useMemo(() => {
    const monthData = {}
    monthKeys12.forEach(k => { monthData[k] = { cpks: [] } })
    records.forEach(r => {
      const k = monthKey(r.issue_date)
      if (!monthData[k] || !r.km_at_fitment || !r.km_at_removal || !r.cost_per_tyre) return
      const km = r.km_at_removal - r.km_at_fitment
      if (km > 0) monthData[k].cpks.push(r.cost_per_tyre / km)
    })

    const cpkValues = monthKeys12.map(k => {
      const cpks = monthData[k].cpks
      return cpks.length ? cpks.reduce((a, b) => a + b, 0) / cpks.length : null
    })

    const cpkTarget = targets.find(t => t.metric === 'target_cpk' || t.metric === 'max_cpk')
    const targetLine = cpkTarget ? monthKeys12.map(() => cpkTarget.target_value) : null

    const datasets = [
      {
        label: 'Avg CPK',
        data: cpkValues,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.4,
        spanGaps: true,
        pointRadius: 3,
      },
    ]
    if (targetLine) {
      datasets.push({
        label: 'CPK Target',
        data: targetLine,
        borderColor: '#10b981',
        borderDash: [5, 4],
        fill: false,
        pointRadius: 0,
        tension: 0,
      })
    }

    return {
      labels: monthKeys12.map(monthLabel),
      datasets,
    }
  }, [records, targets, monthKeys12])

  const failureRateTrendData = useMemo(() => {
    const monthData = {}
    monthKeys12.forEach(k => { monthData[k] = { total: 0, failures: 0 } })
    records.forEach(r => {
      const k = monthKey(r.issue_date)
      if (!monthData[k]) return
      monthData[k].total++
      if (r.risk_level === 'High' || r.category === 'Scrap') monthData[k].failures++
    })

    const rateValues = monthKeys12.map(k => {
      const d = monthData[k]
      return d.total > 0 ? (d.failures / d.total) * 100 : null
    })

    const frTarget = targets.find(t => t.metric === 'max_failure_rate' || t.metric === 'failure_rate_target')
    const targetLine = frTarget ? monthKeys12.map(() => frTarget.target_value) : null

    const datasets = [
      {
        label: 'Failure Rate %',
        data: rateValues,
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.12)',
        fill: true,
        tension: 0.4,
        spanGaps: true,
        pointRadius: 3,
      },
    ]
    if (targetLine) {
      datasets.push({
        label: 'Target',
        data: targetLine,
        borderColor: '#10b981',
        borderDash: [5, 4],
        fill: false,
        pointRadius: 0,
        tension: 0,
      })
    }

    return {
      labels: monthKeys12.map(monthLabel),
      datasets,
    }
  }, [records, targets, monthKeys12])

  // ── Action close rate trend ───────────────────────────────────────────────────

  const actionCloseTrend = useMemo(() => {
    const monthData = {}
    monthKeys12.forEach(k => { monthData[k] = { total: 0, closed: 0 } })
    actions.forEach(a => {
      const k = monthKey(a.created_at)
      if (!monthData[k]) return
      monthData[k].total++
      if (a.status === 'Closed') monthData[k].closed++
    })

    return {
      labels: monthKeys12.map(monthLabel),
      datasets: [{
        label: 'Close Rate %',
        data: monthKeys12.map(k => {
          const d = monthData[k]
          return d.total > 0 ? (d.closed / d.total) * 100 : null
        }),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,0.15)',
        fill: true,
        tension: 0.4,
        spanGaps: true,
        pointRadius: 3,
      }],
    }
  }, [actions, monthKeys12])

  // ── KPI vs Target scorecard ───────────────────────────────────────────────────

  const kpiScorecard = useMemo(() => {
    const metricDefs = [
      { metric: 'target_cpk',           label: 'Cost Per KM (CPK)',        unit: '',   current: metrics.avgCpk,               higherBetter: false, fmt: v => fmt(v, 4) },
      { metric: 'max_failure_rate',     label: 'Failure Rate %',           unit: '%',  current: metrics.failureRate,          higherBetter: false, fmt: v => `${fmt(v, 1)}%` },
      { metric: 'min_inspection_comp',  label: 'Inspection Compliance %',  unit: '%',  current: metrics.inspectionCompliance, higherBetter: true,  fmt: v => `${fmt(v, 1)}%` },
      { metric: 'min_action_close_rate',label: 'Action Close Rate %',      unit: '%',  current: metrics.closeRate,            higherBetter: true,  fmt: v => `${fmt(v, 1)}%` },
      { metric: 'max_avg_cost_tyre',    label: 'Avg Cost Per Tyre',        unit: activeCurrency, current: metrics.avgCostPerTyre, higherBetter: false, fmt: v => fmtCur(v, activeCurrency) },
    ]

    return metricDefs.map(def => {
      const tgtRow = targets.find(t => t.metric === def.metric)
      const target = tgtRow?.target_value ?? null
      const current = def.current
      if (target == null) return { ...def, target: null, status: 'no-target', gap: null }

      const gap = current - target
      let status
      if (def.higherBetter) {
        status = current >= target ? 'Met' : current >= target * 0.9 ? 'Close' : 'Off Track'
      } else {
        status = current <= target ? 'Met' : current <= target * 1.1 ? 'Close' : 'Off Track'
      }
      return { ...def, target, gap, status }
    }).filter(d => d.target != null)
  }, [metrics, targets, activeCurrency])

  const kpiBarData = useMemo(() => {
    if (!kpiScorecard.length) return null
    const labels = kpiScorecard.map(k => k.label)
    return {
      labels,
      datasets: [
        {
          label: 'Current',
          data: kpiScorecard.map(k => k.current),
          backgroundColor: kpiScorecard.map(k =>
            k.status === 'Met' ? 'rgba(16,185,129,0.7)' :
            k.status === 'Close' ? 'rgba(245,158,11,0.7)' :
            'rgba(239,68,68,0.7)'
          ),
          borderRadius: 4,
        },
        {
          label: 'Target',
          data: kpiScorecard.map(k => k.target),
          backgroundColor:'var(--text-muted)',
          borderColor:'var(--text-muted)',
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    }
  }, [kpiScorecard])

  // ── Corrective action stats ───────────────────────────────────────────────────

  const actionStats = useMemo(() => {
    const open        = actions.filter(a => a.status === 'Open')
    const inProgress  = actions.filter(a => a.status === 'In Progress')
    const closed      = actions.filter(a => a.status === 'Closed')
    const overdue     = actions.filter(a => a.status !== 'Closed' && daysOpen(a.created_at) > 14)
    const openTable   = actions.filter(a => a.status !== 'Closed').sort((a, b) => {
      const po = { High: 0, Medium: 1, Low: 2 }
      return (po[a.priority] ?? 1) - (po[b.priority] ?? 1)
    })
    return { open, inProgress, closed, overdue, openTable }
  }, [actions])

  // ── ROI summary ───────────────────────────────────────────────────────────────

  const roiSummary = useMemo(() => {
    // Actual fleet average cost only; when there is no cost data the ROI estimate
    // stays at 0 rather than being fabricated from a settings default.
    const avgTyreCost = Number(metrics.avgCostPerTyre) || 0
    const closedCritical = actionStats.closed.filter(a => a.priority === 'High').length
    const openCritical   = actionStats.open.filter(a => a.priority === 'High').length
    const costAvoidance  = closedCritical * avgTyreCost * 3
    const backlogRisk    = openCritical   * avgTyreCost * 2

    const allOpps = Object.values(opportunities).flat()
    const totalSaving = allOpps.reduce((s, o) => s + (o.saving ?? 0), 0)

    return {
      totalRaised: actions.length,
      totalClosed: actionStats.closed.length,
      costAvoidance,
      backlogRisk,
      totalSaving,
    }
  }, [actions, actionStats, metrics, opportunities])

  // ── Exports ───────────────────────────────────────────────────────────────────

  const handleExcelExport = useCallback(() => {
    exportToExcel(
      actions.map(a => ({
        ...a,
        days_open: daysOpen(a.created_at),
        overdue: daysOpen(a.created_at) > 14 && a.status !== 'Closed' ? 'Yes' : 'No',
      })),
      ['title','site','priority','status','days_open','overdue','created_at','resolved_at','description'],
      ['Title','Site','Priority','Status','Days Open','Overdue','Created','Resolved','Description'],
      'continuous_improvement',
      'Actions',
    )
  }, [actions])

  const handlePdfExport = useCallback(() => {
    exportToPdf(
      actions.map(a => ({
        ...a,
        days_open: daysOpen(a.created_at),
      })),
      ['title','site','priority','status','days_open'],
      ['Title','Site','Priority','Status','Days Open'],
      'Continuous Improvement Report',
      'continuous_improvement',
    )
  }, [actions])

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface-1)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw size={32} className="text-blue-400 animate-spin" />
          <p className="text-[var(--text-muted)] text-sm">Loading continuous improvement data...</p>
        </div>
      </div>
    )
  }

  const totalOpps = Object.values(opportunities).reduce((s, arr) => s + arr.length, 0)

  return (
    <div className="text-[var(--text-secondary)] space-y-6">

      {/* ── Header ── */}
      <PageHeader
        title="Continuous Improvement"
        subtitle="Systematic identification and tracking of cost reduction, reliability, and process improvement opportunities"
        icon={Zap}
        actions={<>
          <SegmentedControl
            ariaLabel="period"
            size="sm"
            value={period}
            onChange={setPeriod}
            options={[
              { value: '3mo', label: 'Last 3 Mo' },
              { value: '6mo', label: 'Last 6 Mo' },
              { value: '1yr', label: 'Last 12 Mo' },
            ]}
          />
          <button
            onClick={handleExcelExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-xs font-medium transition-colors"
          >
            <Download size={13} /> Excel
          </button>
          <button
            onClick={handlePdfExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors"
          >
            <FileText size={13} /> PDF
          </button>
        </>}
      />

      {error && (
        <div className="bg-red-950/50 border border-red-700/50 rounded-xl p-4 flex items-center gap-3 text-red-300 text-sm">
          <XCircle size={16} /> {error}
        </div>
      )}

      {/* ── Section 2: Improvement Score ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className={`bg-[var(--surface-1)] border rounded-xl p-5 ${scoreBg(improvementScore.total)}`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          {/* Main score */}
          <div className="flex flex-col items-center lg:items-start gap-1 min-w-[140px]">
            <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wider">Improvement Programme Score</p>
            <div className="flex items-end gap-2">
              <span className={`text-6xl font-black tabular-nums ${scoreColor(improvementScore.total)}`}>
                {improvementScore.total}
              </span>
              <span className="text-[var(--text-dim)] text-xl mb-2">/100</span>
            </div>
            {improvementScore.delta != null && (
              <span className={`flex items-center gap-1 text-xs font-medium ${improvementScore.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {improvementScore.delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {improvementScore.delta >= 0 ? '+' : ''}{improvementScore.delta} vs last month
              </span>
            )}
          </div>

          {/* Component breakdown */}
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Cost Improvement',    pts: improvementScore.costPts,  max: 25, color: '#10b981' },
              { label: 'Reliability',          pts: improvementScore.relPts,   max: 25, color: '#3b82f6' },
              { label: 'Insp. Compliance',     pts: improvementScore.inspPts,  max: 25, color: '#8b5cf6' },
              { label: 'Action Close Rate',    pts: improvementScore.closePts, max: 25, color: '#f59e0b' },
            ].map(item => (
              <div key={item.label} className="bg-[var(--input-bg)]/60 rounded-lg p-3">
                <p className="text-xs text-[var(--text-muted)] mb-1">{item.label}</p>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg font-bold" style={{ color: item.color }}>{item.pts}</span>
                  <span className="text-xs text-[var(--text-dim)]">/{item.max}</span>
                </div>
                <div className="h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(item.pts / item.max) * 100}%`, background: item.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* ── Section 7: ROI Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Actions Raised',    value: fmt(roiSummary.totalRaised),              icon: Activity,      color: 'text-blue-400',   desc: 'All time' },
          { label: 'Actions Closed',          value: fmt(roiSummary.totalClosed),              icon: CheckCircle,   color: 'text-green-400',  desc: `${fmt(metrics.closeRate, 0)}% close rate` },
          { label: 'Est. Cost Avoidance',     value: fmtCur(roiSummary.costAvoidance, activeCurrency), icon: DollarSign, color: 'text-emerald-400', desc: 'From closed critical actions' },
          { label: 'Open Action Backlog Risk',value: fmtCur(roiSummary.backlogRisk, activeCurrency),  icon: AlertTriangle,color: 'text-orange-400', desc: 'Open critical actions' },
        ].map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon size={15} className={card.color} />
                <span className="text-xs text-[var(--text-muted)]">{card.label}</span>
              </div>
              <p className={`text-xl font-bold tabular-nums ${card.color}`}>{card.value}</p>
              <p className="text-xs text-[var(--text-dim)] mt-0.5">{card.desc}</p>
            </div>
          )
        })}
      </div>

      {roiSummary.totalSaving > 0 && (
        <div className="bg-emerald-950/30 border border-emerald-700/40 rounded-xl p-4 flex items-center gap-3">
          <Award size={18} className="text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300">
            <span className="font-semibold">{totalOpps} improvement opportunities identified</span> with a combined estimated annual saving potential of{' '}
            <span className="font-bold">{fmtCur(roiSummary.totalSaving, activeCurrency)}</span>.
          </p>
        </div>
      )}

      {/* ── Section 3: Opportunity Finder ── */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          <Star size={14} className="text-yellow-400" />
          Improvement Opportunity Finder
          <span className="text-xs text-[var(--text-dim)] font-normal">- auto-generated from fleet data</span>
          <span className="ml-auto text-xs text-[var(--text-muted)]">{totalOpps} opportunities across 6 categories</span>
        </h2>
        <div className="space-y-3">
          {Object.keys(CATEGORY_META).map(cat => (
            <CategoryAccordion
              key={cat}
              categoryKey={cat}
              opportunities={opportunities[cat] ?? []}
              onCreateAction={handleCreateAction}
              createdTitles={createdTitles}
              creatingKey={creatingKey}
            />
          ))}
        </div>
      </div>

      {/* ── Section 4: Progress Tracking Charts ── */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          <BarChart2 size={14} className="text-blue-400" />
          Progress Tracking - Last 12 Months
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
            <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">CPK Trend vs Target</p>
            <div className="h-52">
              {cpkTrendData.datasets[0].data.some(v => v != null) ? (
                <Line
                  data={cpkTrendData}
                  options={{
                    ...CHART_BASE,
                    scales: {
                      ...CHART_BASE.scales,
                      y: { ...CHART_BASE.scales.y, title: { display: true, text: 'CPK', color: '#6b7280', font: { size: 10 } } },
                    },
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">Insufficient CPK data for trend</div>
              )}
            </div>
          </div>

          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
            <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">Failure Rate Trend vs Target</p>
            <div className="h-52">
              {failureRateTrendData.datasets[0].data.some(v => v != null) ? (
                <Line
                  data={failureRateTrendData}
                  options={{
                    ...CHART_BASE,
                    scales: {
                      ...CHART_BASE.scales,
                      y: { ...CHART_BASE.scales.y, title: { display: true, text: 'Failure %', color: '#6b7280', font: { size: 10 } } },
                    },
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">Insufficient failure rate data</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 5: Corrective Action Programme ── */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          <Wrench size={14} className="text-orange-400" />
          Corrective Action Programme
        </h2>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Open',        count: actionStats.open.length,       color: 'text-red-400',    icon: AlertTriangle },
            { label: 'In Progress', count: actionStats.inProgress.length, color: 'text-yellow-400', icon: Clock },
            { label: 'Closed',      count: actionStats.closed.length,     color: 'text-green-400',  icon: CheckCircle },
            { label: 'Overdue',     count: actionStats.overdue.length,    color: 'text-orange-400', icon: XCircle },
          ].map(s => {
            const Icon = s.icon
            return (
              <div key={s.label} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-3 flex items-center gap-3">
                <Icon size={18} className={s.color} />
                <div>
                  <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.count}</p>
                  <p className="text-xs text-[var(--text-muted)]">{s.label}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Close rate trend + open actions table */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 lg:col-span-2">
            <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">Action Close Rate Trend</p>
            <div className="h-44">
              {actionCloseTrend.datasets[0].data.some(v => v != null) ? (
                <Line
                  data={actionCloseTrend}
                  options={{
                    ...CHART_BASE,
                    scales: {
                      ...CHART_BASE.scales,
                      y: {
                        ...CHART_BASE.scales.y,
                        min: 0, max: 100,
                        ticks: { ...CHART_BASE.scales.y.ticks, callback: v => `${v}%` },
                      },
                    },
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No action data available</div>
              )}
            </div>
          </div>

          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 lg:col-span-3 overflow-hidden">
            <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">
              Open & Overdue Actions
              <span className="ml-2 text-[var(--text-dim)] font-normal">({actionStats.openTable.length} total)</span>
            </p>
            {actionStats.openTable.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-36 gap-2 text-[var(--text-dim)]">
                <CheckCircle size={24} className="text-green-600" />
                <p className="text-sm">All corrective actions are closed</p>
              </div>
            ) : (
              <div className="overflow-auto max-h-52">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[var(--text-muted)] border-b border-[var(--input-border)]">
                      <th className="text-left pb-2 pr-2 font-medium">Title</th>
                      <th className="text-left pb-2 pr-2 font-medium">Site</th>
                      <th className="text-left pb-2 pr-2 font-medium">Priority</th>
                      <th className="text-left pb-2 pr-2 font-medium">Days Open</th>
                      <th className="text-left pb-2 pr-2 font-medium">Status</th>
                      <th className="text-left pb-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actionStats.openTable.slice(0, 30).map(a => {
                      const days = daysOpen(a.created_at)
                      const isOverdue = days > 14
                      return (
                        <tr key={a.id} className="border-b border-[var(--input-border)]/60 hover:bg-[var(--input-bg)]/30">
                          <td className="py-1.5 pr-2 max-w-[180px] truncate text-[var(--text-secondary)]">{a.title}</td>
                          <td className="py-1.5 pr-2 text-[var(--text-muted)]">{a.site ?? '-'}</td>
                          <td className="py-1.5 pr-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${PRIORITY_BADGE[a.priority] ?? PRIORITY_BADGE.Medium}`}>
                              {a.priority}
                            </span>
                          </td>
                          <td className={`py-1.5 pr-2 font-medium tabular-nums ${isOverdue ? 'text-orange-400' : 'text-[var(--text-muted)]'}`}>
                            {days}d {isOverdue && <span className="text-orange-500 text-[10px]">OVERDUE</span>}
                          </td>
                          <td className="py-1.5 pr-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_COLORS[a.status] ?? STATUS_COLORS.Open}`}>
                              {a.status}
                            </span>
                          </td>
                          <td className="py-1.5">
                            <button
                              onClick={() => handleCloseAction(a.id)}
                              disabled={closingId === a.id}
                              className="px-2 py-0.5 rounded bg-green-800/50 hover:bg-green-700/50 text-green-300 text-[10px] transition-colors disabled:opacity-50"
                            >
                              {closingId === a.id ? '...' : 'Close'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {actionStats.openTable.length > 30 && (
                  <p className="text-xs text-[var(--text-dim)] text-center pt-2">{actionStats.openTable.length - 30} more actions not shown</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 6: KPI vs Target Scorecard ── */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
          <Target size={14} className="text-purple-400" />
          KPI vs Target Scorecard
          {kpiScorecard.length === 0 && (
            <span className="ml-2 text-xs text-[var(--text-dim)] font-normal">- configure targets in KPI Scorecard settings</span>
          )}
        </h2>

        {kpiScorecard.length === 0 ? (
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-8 text-center">
            <Info size={24} className="text-[var(--text-dim)] mx-auto mb-2" />
            <p className="text-[var(--text-muted)] text-sm">No KPI targets configured.</p>
            <p className="text-[var(--text-dim)] text-xs mt-1">Set targets in the KPI Scorecard page to enable gap analysis.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Table */}
            <div className="lg:col-span-3 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[var(--text-muted)] border-b border-[var(--input-border)] bg-[var(--input-bg)]/40">
                    <th className="text-left px-4 py-2.5 font-medium">Metric</th>
                    <th className="text-right px-4 py-2.5 font-medium">Current</th>
                    <th className="text-right px-4 py-2.5 font-medium">Target</th>
                    <th className="text-right px-4 py-2.5 font-medium">Gap</th>
                    <th className="text-right px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {kpiScorecard.map(k => (
                    <tr key={k.metric} className="border-b border-[var(--input-border)]/60 hover:bg-[var(--input-bg)]/20">
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{k.label}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-[var(--text-secondary)]">{k.fmt(k.current)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-[var(--text-muted)]">{k.fmt(k.target)}</td>
                      <td className={`px-4 py-2.5 text-right font-mono text-xs ${
                        k.status === 'Met' ? 'text-green-400' :
                        k.status === 'Close' ? 'text-yellow-400' :
                        'text-red-400'
                      }`}>
                        {k.gap != null ? (k.gap >= 0 ? '+' : '') + k.fmt(k.gap) : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          k.status === 'Met'       ? 'bg-green-900/50 text-green-300 border border-green-700/50' :
                          k.status === 'Close'     ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-700/50' :
                          'bg-red-900/50 text-red-300 border border-red-700/50'
                        }`}>
                          {k.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bar chart */}
            <div className="lg:col-span-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
              <p className="text-xs font-semibold text-[var(--text-muted)] mb-3">Actual vs Target (Normalised)</p>
              <div className="h-52">
                {kpiBarData ? (
                  <Bar
                    data={kpiBarData}
                    options={{
                      ...CHART_BASE,
                      scales: {
                        x: { ...CHART_BASE.scales.x, ticks: { ...CHART_BASE.scales.x.ticks, font: { size: 9 } } },
                        y: { ...CHART_BASE.scales.y },
                      },
                      plugins: {
                        ...CHART_BASE.plugins,
                        legend: { labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 10 } },
                      },
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No target data</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Improvement score legend ── */}
      <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
        <p className="text-xs font-semibold text-[var(--text-muted)] mb-3 flex items-center gap-2">
          <Info size={13} /> Score Methodology
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs text-[var(--text-muted)]">
          <div className="flex gap-2"><span className="text-green-400 font-semibold">≥75</span> - Excellent: sustain & extend programme</div>
          <div className="flex gap-2"><span className="text-yellow-400 font-semibold">50-74</span> - Progressing: intensify action tracking</div>
          <div className="flex gap-2"><span className="text-red-400 font-semibold">&lt;50</span> - Critical: immediate escalation required</div>
          <div className="flex gap-2"><span className="text-[var(--text-muted)] font-semibold">Score</span> = Cost (25) + Reliability (25) + Compliance (25) + Close Rate (25)</div>
        </div>
      </div>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
