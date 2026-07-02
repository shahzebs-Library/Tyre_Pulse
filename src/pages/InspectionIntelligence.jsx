import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/ui/PageHeader'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  ClipboardCheck, Download, FileText, AlertTriangle, CheckCircle,
  XCircle, Eye, ChevronDown, ChevronUp, AlertCircle, Search,
  ShieldCheck, Users, BarChart2, TrendingUp,
} from 'lucide-react'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
)

// ── helpers ────────────────────────────────────────────────────────────────────
const fmt = n => (typeof n === 'number' ? n.toFixed(1) : '-')
const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) : '0.0')
const MONTHS_BACK = 12

function lastNMonths(n) {
  const months = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    months.push(d.toISOString().slice(0, 7)) // YYYY-MM
  }
  return months
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / 86400000)
}

function containsNumeric(text) {
  if (!text) return false
  return /\d+/.test(text)
}

function scoreSeverity(days) {
  if (days > 30) return 'critical'
  if (days > 14) return 'high'
  return 'medium'
}

const DATE_PRESETS = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '6mo', days: 180 },
]

const CHART_OPTS_BAR = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af', font: { size: 11 } } },
    y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' }, min: 0, max: 100 },
  },
}

const CHART_OPTS_LINE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
  },
  scales: {
    x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af', font: { size: 11 } } },
    y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' }, min: 0, max: 100 },
  },
}

const DONUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } },
  },
}

// Colour helpers
function complianceColor(val) {
  const v = parseFloat(val)
  if (v >= 85) return 'text-green-400'
  if (v >= 60) return 'text-yellow-400'
  return 'text-red-400'
}
function complianceBg(val) {
  const v = parseFloat(val)
  if (v >= 85) return 'bg-green-900/20 border-green-700/40'
  if (v >= 60) return 'bg-yellow-900/20 border-yellow-700/40'
  return 'bg-red-900/20 border-red-700/40'
}
function coverageColor(val) {
  const v = parseFloat(val)
  if (v >= 75) return 'text-green-400'
  if (v >= 50) return 'text-yellow-400'
  return 'text-red-400'
}
function missingColor(count) {
  if (count === 0) return 'text-green-400'
  if (count <= 5) return 'text-yellow-400'
  return 'text-red-400'
}
function dqColor(val) {
  const v = parseFloat(val)
  if (v >= 80) return 'text-green-400'
  if (v >= 60) return 'text-yellow-400'
  return 'text-red-400'
}

const DONUT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#14b8a6', '#f97316', '#ec4899', '#3b82f6', '#84cc16',
]

// ── ExpandableIssueList ────────────────────────────────────────────────────────
function ExpandableIssueList({ items, labelFn }) {
  const [open, setOpen] = useState(false)
  const visible = open ? items : items.slice(0, 3)
  return (
    <div className="mt-2">
      {visible.map((it, i) => (
        <div key={i} className="text-xs text-gray-400 py-0.5 border-b border-white/5 last:border-0">
          {labelFn(it)}
        </div>
      ))}
      {items.length > 3 && (
        <button
          onClick={() => setOpen(o => !o)}
          className="text-xs text-blue-400 hover:text-blue-300 mt-1 flex items-center gap-1"
        >
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {open ? 'Show less' : `Show ${items.length - 3} more`}
        </button>
      )}
    </div>
  )
}

// ── QualityBar ─────────────────────────────────────────────────────────────────
function QualityBar({ score }) {
  const pctVal = Math.min(100, Math.max(0, score * 100))
  const color = pctVal >= 90 ? 'bg-green-500' : pctVal >= 70 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pctVal}%` }} />
      </div>
      <span className={`text-xs font-semibold w-10 text-right ${pctVal >= 90 ? 'text-green-400' : pctVal >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
        {pctVal.toFixed(0)}%
      </span>
    </div>
  )
}

// ── RecommendationCard ─────────────────────────────────────────────────────────
function RecommendationCard({ priority, message }) {
  const styles = {
    Critical: { bg: 'bg-red-900/20 border-red-700/40', dot: 'bg-red-500', label: 'text-red-400' },
    High:     { bg: 'bg-orange-900/20 border-orange-700/40', dot: 'bg-orange-500', label: 'text-orange-400' },
    Medium:   { bg: 'bg-yellow-900/20 border-yellow-700/40', dot: 'bg-yellow-500', label: 'text-yellow-400' },
  }
  const s = styles[priority] || styles.Medium
  return (
    <div className={`rounded-lg border p-3 flex items-start gap-3 ${s.bg}`}>
      <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${s.dot}`} />
      <div>
        <span className={`text-xs font-semibold uppercase tracking-wide ${s.label}`}>{priority}</span>
        <p className="text-sm text-gray-300 mt-0.5">{message}</p>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function InspectionIntelligence() {
  const { activeCountry, setActiveCountry } = useSettings()

  const [inspections, setInspections]   = useState([])
  const [fleet, setFleet]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)

  const [siteFilter, setSiteFilter]     = useState('')
  const [datePreset, setDatePreset]     = useState(90)

  const [raisingAlert, setRaisingAlert] = useState(null)
  const [alertRaised, setAlertRaised]   = useState({})
  const [expandedDQ, setExpandedDQ]     = useState(null)
  const [search, setSearch]             = useState('')

  // ── data load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const countryFilter = q => activeCountry !== 'All' ? q.eq('country', activeCountry) : q

        const [{ data: inspData, error: e1 }, { data: fleetData, error: e2 }] = await Promise.all([
          countryFilter(supabase.from('inspections').select('*')),
          countryFilter(supabase.from('vehicle_fleet').select('asset_no, site, country')),
        ])

        if (e1) throw e1
        if (e2) throw e2

        setInspections(inspData || [])
        setFleet(fleetData || [])
      } catch (err) {
        setError(err.message || 'Failed to load inspection data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [activeCountry])

  // ── date window ──────────────────────────────────────────────────────────────
  const cutoffDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - datePreset)
    return d.toISOString().split('T')[0]
  }, [datePreset])

  // ── filtered inspections ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return inspections.filter(r => {
      if (siteFilter && r.site !== siteFilter) return false
      const refDate = r.scheduled_date || r.created_at?.slice(0, 10)
      if (refDate && refDate < cutoffDate) return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !r.asset_no?.toLowerCase().includes(q) &&
          !r.site?.toLowerCase().includes(q) &&
          !r.inspector?.toLowerCase().includes(q) &&
          !r.inspection_type?.toLowerCase().includes(q)
        ) return false
      }
      return true
    })
  }, [inspections, siteFilter, cutoffDate, search])

  // ── unique sites ──────────────────────────────────────────────────────────────
  const allSites = useMemo(() => {
    const s = new Set(inspections.map(r => r.site).filter(Boolean))
    return [...s].sort()
  }, [inspections])

  // ── compliance metrics ────────────────────────────────────────────────────────
  const complianceMetrics = useMemo(() => {
    const scheduled = filtered.filter(r => r.status && r.status !== 'Cancelled')
    const completedOnTime = scheduled.filter(r => {
      if (r.status !== 'Done') return false
      if (!r.completed_date || !r.scheduled_date) return r.status === 'Done'
      return r.completed_date <= r.scheduled_date ||
        daysSince(r.scheduled_date) - daysSince(r.completed_date) <= 1
    })
    const compliancePct = pct(completedOnTime.length, scheduled.length)

    const pressureRecorded = filtered.filter(r => containsNumeric(r.findings))
    const pressureCovPct = pct(pressureRecorded.length, filtered.length)

    const missingFindings = filtered.filter(r => !r.findings || r.findings.trim() === '')
    const noInspector     = filtered.filter(r => !r.inspector || r.inspector.trim() === '')
    const suspiciousDate  = filtered.filter(r =>
      r.completed_date && r.scheduled_date && r.completed_date < r.scheduled_date && r.status === 'Done'
    )

    const totalFields = filtered.length * 2
    const missingFields = missingFindings.length + noInspector.length
    const dqScore = totalFields > 0 ? (((totalFields - missingFields) / totalFields) * 100).toFixed(1) : '100.0'

    return {
      compliancePct,
      pressureCovPct,
      dqScore,
      missingFindings,
      noInspector,
      suspiciousDate,
      totalScheduled: scheduled.length,
      completedOnTime: completedOnTime.length,
    }
  }, [filtered])

  // ── compliance by site ────────────────────────────────────────────────────────
  const complianceBySite = useMemo(() => {
    const map = {}
    filtered.forEach(r => {
      const site = r.site || 'Unknown'
      if (!map[site]) map[site] = { scheduled: 0, onTime: 0 }
      if (r.status && r.status !== 'Cancelled') {
        map[site].scheduled++
        if (r.status === 'Done') {
          const onTime = !r.completed_date || !r.scheduled_date ||
            r.completed_date <= r.scheduled_date ||
            daysSince(r.scheduled_date) - daysSince(r.completed_date) <= 1
          if (onTime) map[site].onTime++
        }
      }
    })
    return Object.entries(map)
      .map(([site, { scheduled, onTime }]) => ({
        site,
        scheduled,
        onTime,
        pct: scheduled > 0 ? (onTime / scheduled) * 100 : 0,
      }))
      .sort((a, b) => b.pct - a.pct)
  }, [filtered])

  // ── monthly compliance trend ──────────────────────────────────────────────────
  const monthlyTrend = useMemo(() => {
    const months = lastNMonths(MONTHS_BACK)
    return months.map(mo => {
      const monthRecs = inspections.filter(r => {
        const ref = r.scheduled_date || r.created_at?.slice(0, 10) || ''
        return ref.startsWith(mo) && r.status !== 'Cancelled'
      })
      const done = monthRecs.filter(r => r.status === 'Done')
      return {
        month: mo.slice(5) + '/' + mo.slice(2, 4),
        pct: monthRecs.length > 0 ? (done.length / monthRecs.length) * 100 : null,
      }
    })
  }, [inspections])

  // ── inspection type distribution ──────────────────────────────────────────────
  const typeDistribution = useMemo(() => {
    const map = {}
    filtered.forEach(r => {
      const t = r.inspection_type || 'Unknown'
      map[t] = (map[t] || 0) + 1
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered])

  // ── missing inspections ───────────────────────────────────────────────────────
  const missingInspections = useMemo(() => {
    // Latest inspection date per asset_no from ALL inspections (not just filtered window)
    const latestByAsset = {}
    inspections.forEach(r => {
      if (!r.asset_no) return
      const d = r.scheduled_date || r.created_at?.slice(0, 10) || ''
      if (!latestByAsset[r.asset_no] || d > latestByAsset[r.asset_no].date) {
        latestByAsset[r.asset_no] = { date: d, site: r.site }
      }
    })

    const result = []
    fleet.forEach(v => {
      const last = latestByAsset[v.asset_no]
      const days = last ? daysSince(last.date) : Infinity
      const lastDate = last?.date || null
      const site = v.site || last?.site || 'Unknown'
      if (days > 7) {
        result.push({
          asset_no: v.asset_no,
          site,
          lastInspectionDate: lastDate,
          daysSince: days === Infinity ? '-' : days,
          daysNum: days === Infinity ? 9999 : days,
          severity: days > 30 ? 'critical' : days > 14 ? 'high' : 'medium',
        })
      }
    })

    return result.sort((a, b) => b.daysNum - a.daysNum)
  }, [fleet, inspections])

  // ── duplicate detections ──────────────────────────────────────────────────────
  const duplicates = useMemo(() => {
    const map = {}
    filtered.forEach(r => {
      const key = `${r.asset_no}|${r.scheduled_date}|${r.inspection_type}`
      if (!map[key]) map[key] = { asset_no: r.asset_no, date: r.scheduled_date, type: r.inspection_type, count: 0, inspectors: new Set() }
      map[key].count++
      if (r.inspector) map[key].inspectors.add(r.inspector)
    })
    return Object.values(map)
      .filter(d => d.count > 1)
      .map(d => ({ ...d, inspectorNames: [...d.inspectors].join(', ') }))
      .sort((a, b) => b.count - a.count)
  }, [filtered])

  // ── inconsistent inspections ──────────────────────────────────────────────────
  const inconsistentInspections = useMemo(() => {
    const byAsset = {}
    filtered.forEach(r => {
      if (!r.asset_no) return
      if (!byAsset[r.asset_no]) byAsset[r.asset_no] = []
      byAsset[r.asset_no].push(r)
    })

    const result = []
    Object.entries(byAsset).forEach(([asset, recs]) => {
      if (recs.length < 2) return
      const sorted = [...recs].sort((a, b) =>
        (a.scheduled_date || '').localeCompare(b.scheduled_date || '')
      )

      // High overdue ratio
      const overdue = recs.filter(r => r.status === 'Overdue').length
      const overdueRatio = overdue / recs.length
      if (overdueRatio > 0.5) {
        result.push({
          asset_no: asset,
          site: recs[0].site || 'Unknown',
          inconsistencyType: 'High Overdue Rate',
          description: `${overdue}/${recs.length} inspections are overdue (${(overdueRatio * 100).toFixed(0)}%)`,
          records: recs,
        })
        return
      }

      // Drastic findings change
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1].findings || ''
        const curr = sorted[i].findings || ''
        if (Math.abs(prev.length - curr.length) > 300) {
          result.push({
            asset_no: asset,
            site: sorted[i].site || 'Unknown',
            inconsistencyType: 'Findings Discrepancy',
            description: `Findings length changed by ${Math.abs(prev.length - curr.length)} chars between ${sorted[i - 1].scheduled_date} and ${sorted[i].scheduled_date}`,
            records: [sorted[i - 1], sorted[i]],
          })
          break
        }
      }
    })

    return result.slice(0, 20)
  }, [filtered])

  // ── inspector quality scores ──────────────────────────────────────────────────
  const inspectorScores = useMemo(() => {
    const map = {}
    filtered.forEach(r => {
      const name = r.inspector?.trim() || '__unknown__'
      if (!map[name]) map[name] = { total: 0, hasFindings: 0, hasCompleted: 0 }
      map[name].total++
      if (r.findings && r.findings.trim() !== '') map[name].hasFindings++
      if (r.completed_date) map[name].hasCompleted++
    })

    return Object.entries(map)
      .filter(([name]) => name !== '__unknown__')
      .map(([inspector, m]) => {
        const qualityScore = (m.hasFindings / m.total) * 0.5 + (m.hasCompleted / m.total) * 0.5
        return {
          inspector,
          totalInspections: m.total,
          qualityScore,
          missingFindings: m.total - m.hasFindings,
          incompleteCount: m.total - m.hasCompleted,
        }
      })
      .sort((a, b) => b.qualityScore - a.qualityScore)
  }, [filtered])

  // ── recommendations ───────────────────────────────────────────────────────────
  const recommendations = useMemo(() => {
    const recs = []

    complianceBySite
      .filter(s => s.pct < 60 && s.scheduled > 0)
      .forEach(s => recs.push({ priority: 'Critical', message: `Site "${s.site}" inspection compliance at ${s.pct.toFixed(0)}% - schedule immediate inspection round` }))

    if (missingInspections.filter(v => v.severity === 'critical').length > 0) {
      recs.push({ priority: 'Critical', message: `${missingInspections.filter(v => v.severity === 'critical').length} vehicles are overdue by >30 days - critical downtime risk` })
    }

    if (duplicates.length > 0) {
      recs.push({ priority: 'High', message: `${duplicates.length} duplicate inspection entries detected - review data entry procedures immediately` })
    }

    if (missingInspections.length > 5) {
      recs.push({ priority: 'High', message: `${missingInspections.length} vehicles missing recent inspections - high fleet availability risk` })
    }

    inspectorScores
      .filter(i => i.qualityScore < 0.70)
      .forEach(i => recs.push({ priority: 'Medium', message: `Inspector "${i.inspector}" quality score ${(i.qualityScore * 100).toFixed(0)}% - remediation training recommended` }))

    if (parseFloat(complianceMetrics.pressureCovPct) < 50) {
      recs.push({ priority: 'Medium', message: `Pressure data coverage at ${complianceMetrics.pressureCovPct}% - mandate pressure readings in all inspections` })
    }

    complianceBySite
      .filter(s => s.pct >= 60 && s.pct < 85 && s.scheduled > 0)
      .forEach(s => recs.push({ priority: 'Medium', message: `Site "${s.site}" compliance at ${s.pct.toFixed(0)}% - below 85% target, review scheduling` }))

    // Sort Critical → High → Medium
    const order = { Critical: 0, High: 1, Medium: 2 }
    return recs.sort((a, b) => order[a.priority] - order[b.priority])
  }, [complianceBySite, missingInspections, duplicates, inspectorScores, complianceMetrics])

  // ── chart data ────────────────────────────────────────────────────────────────
  const siteChartData = useMemo(() => ({
    labels: complianceBySite.map(s => s.site),
    datasets: [{
      data: complianceBySite.map(s => parseFloat(s.pct.toFixed(1))),
      backgroundColor: complianceBySite.map(s =>
        s.pct >= 85 ? 'rgba(16,185,129,0.7)' : s.pct >= 60 ? 'rgba(245,158,11,0.7)' : 'rgba(239,68,68,0.7)'
      ),
      borderColor: complianceBySite.map(s =>
        s.pct >= 85 ? '#10b981' : s.pct >= 60 ? '#f59e0b' : '#ef4444'
      ),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [complianceBySite])

  const trendChartData = useMemo(() => ({
    labels: monthlyTrend.map(m => m.month),
    datasets: [
      {
        label: 'Compliance %',
        data: monthlyTrend.map(m => m.pct),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.15)',
        tension: 0.3,
        pointRadius: 3,
        spanGaps: true,
      },
      {
        label: 'Target (85%)',
        data: monthlyTrend.map(() => 85),
        borderColor: '#ef4444',
        borderDash: [5, 5],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      },
    ],
  }), [monthlyTrend])

  const donutChartData = useMemo(() => ({
    labels: typeDistribution.map(([t]) => t),
    datasets: [{
      data: typeDistribution.map(([, c]) => c),
      backgroundColor: typeDistribution.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length]),
      borderColor: 'var(--panel)',
      borderWidth: 2,
    }],
  }), [typeDistribution])

  // ── raise alert handler ───────────────────────────────────────────────────────
  async function handleRaiseAlert(vehicle) {
    if (alertRaised[vehicle.asset_no]) return
    setRaisingAlert(vehicle.asset_no)
    try {
      await supabase.from('corrective_actions').insert({
        asset_no: vehicle.asset_no,
        site: vehicle.site,
        country: activeCountry !== 'All' ? activeCountry : undefined,
        description: `Inspection overdue: Vehicle ${vehicle.asset_no} at site "${vehicle.site}" has not been inspected in ${vehicle.daysSince} days.`,
        priority: vehicle.severity === 'critical' ? 'Critical' : 'High',
        status: 'Open',
        due_date: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
        source: 'Inspection Intelligence',
      })
      setAlertRaised(prev => ({ ...prev, [vehicle.asset_no]: true }))
    } catch (_) {
      // silent
    } finally {
      setRaisingAlert(null)
    }
  }

  // ── export ────────────────────────────────────────────────────────────────────
  function handleExcelExport() {
    exportToExcel(
      filtered,
      ['asset_no', 'site', 'inspection_type', 'scheduled_date', 'status', 'inspector', 'findings'],
      ['Asset No', 'Site', 'Type', 'Scheduled', 'Status', 'Inspector', 'Findings'],
      'inspection_intelligence',
      'Inspections',
    )
  }

  function handlePdfExport() {
    exportToPdf(
      filtered,
      ['asset_no', 'site', 'inspection_type', 'scheduled_date', 'status', 'inspector'],
      ['Asset No', 'Site', 'Type', 'Scheduled', 'Status', 'Inspector'],
      'Inspection Intelligence Report',
      'inspection_intelligence',
    )
  }

  // ── severity badge ────────────────────────────────────────────────────────────
  function SeverityBadge({ sev }) {
    const styles = {
      critical: 'bg-red-900/30 text-red-400 border-red-700/50',
      high: 'bg-orange-900/30 text-orange-400 border-orange-700/50',
      medium: 'bg-yellow-900/30 text-yellow-400 border-yellow-700/50',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border capitalize ${styles[sev] || styles.medium}`}>
        {sev}
      </span>
    )
  }

  // ── render ────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-80">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading inspection data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-80">
        <div className="card p-8 text-center max-w-sm">
          <XCircle className="mx-auto mb-3 text-red-400" size={32} />
          <p className="text-red-400 font-semibold">Failed to load data</p>
          <p className="text-gray-500 text-sm mt-1">{error}</p>
        </div>
      </div>
    )
  }

  if (inspections.length === 0 && fleet.length === 0) {
    return (
      <div className="flex items-center justify-center h-80">
        <div className="card p-10 text-center max-w-md">
          <ClipboardCheck className="mx-auto mb-4 text-gray-600" size={40} />
          <p className="text-gray-300 font-semibold text-lg">No inspection records found</p>
          <p className="text-gray-500 text-sm mt-2">
            Schedule inspections to enable intelligence monitoring.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">

      {/* ── Header ── */}
      <PageHeader
        title="Inspection Intelligence"
        subtitle="Compliance monitoring, quality scoring, and anomaly detection across all inspections"
        icon={ClipboardCheck}
        actions={<>
          <button onClick={handleExcelExport} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Download size={14} /> Excel
          </button>
          <button onClick={handlePdfExport} className="btn-secondary flex items-center gap-1.5 text-sm">
            <FileText size={14} /> PDF
          </button>
        </>}
      />

      {/* ── Filters ── */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Country chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {['All', ...COUNTRIES].map(c => (
              <button
                key={c}
                onClick={() => setActiveCountry(c)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  activeCountry === c
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'border-gray-700 text-gray-400 hover:border-indigo-500 hover:text-gray-200'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-gray-700 hidden sm:block" />

          {/* Site select */}
          <select
            className="input text-sm py-1.5 min-w-36"
            value={siteFilter}
            onChange={e => setSiteFilter(e.target.value)}
          >
            <option value="">All Sites</option>
            {allSites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Date presets */}
          <div className="flex gap-1">
            {DATE_PRESETS.map(({ label, days }) => (
              <button
                key={label}
                onClick={() => setDatePreset(days)}
                className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${
                  datePreset === days
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'border-gray-700 text-gray-400 hover:border-indigo-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 flex-1 min-w-48 max-w-xs">
            <Search size={14} className="text-gray-500 flex-shrink-0" />
            <input
              className="input text-sm py-1.5 flex-1"
              placeholder="Search asset, site, inspector..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <span className="text-xs text-gray-500 ml-auto">
            {filtered.length} inspection{filtered.length !== 1 ? 's' : ''} in view
          </span>
        </div>
      </div>

      {/* ── Section 1: Compliance Overview stat cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Inspection Compliance */}
        <div className={`card p-5 border ${complianceBg(complianceMetrics.compliancePct)}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">Inspection Compliance</span>
            <CheckCircle size={16} className={complianceColor(complianceMetrics.compliancePct)} />
          </div>
          <p className={`text-3xl font-bold ${complianceColor(complianceMetrics.compliancePct)}`}>
            {complianceMetrics.compliancePct}%
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {complianceMetrics.completedOnTime} of {complianceMetrics.totalScheduled} on-time
          </p>
          <div className="mt-2 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${parseFloat(complianceMetrics.compliancePct) >= 85 ? 'bg-green-500' : parseFloat(complianceMetrics.compliancePct) >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, parseFloat(complianceMetrics.compliancePct))}%` }}
            />
          </div>
        </div>

        {/* Pressure Data Coverage */}
        <div className={`card p-5 border ${parseFloat(complianceMetrics.pressureCovPct) >= 75 ? 'bg-green-900/10 border-green-700/30' : parseFloat(complianceMetrics.pressureCovPct) >= 50 ? 'bg-yellow-900/10 border-yellow-700/30' : 'bg-red-900/10 border-red-700/30'}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">Pressure Coverage</span>
            <BarChart2 size={16} className={coverageColor(complianceMetrics.pressureCovPct)} />
          </div>
          <p className={`text-3xl font-bold ${coverageColor(complianceMetrics.pressureCovPct)}`}>
            {complianceMetrics.pressureCovPct}%
          </p>
          <p className="text-xs text-gray-500 mt-1">Inspections with pressure readings</p>
          <div className="mt-2 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${parseFloat(complianceMetrics.pressureCovPct) >= 75 ? 'bg-green-500' : parseFloat(complianceMetrics.pressureCovPct) >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, parseFloat(complianceMetrics.pressureCovPct))}%` }}
            />
          </div>
        </div>

        {/* Missing Inspections */}
        <div className={`card p-5 border ${missingInspections.length === 0 ? 'bg-green-900/10 border-green-700/30' : missingInspections.length <= 5 ? 'bg-yellow-900/10 border-yellow-700/30' : 'bg-red-900/10 border-red-700/30'}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">Missing Inspections</span>
            <AlertTriangle size={16} className={missingColor(missingInspections.length)} />
          </div>
          <p className={`text-3xl font-bold ${missingColor(missingInspections.length)}`}>
            {missingInspections.length}
          </p>
          <p className="text-xs text-gray-500 mt-1">Vehicles with no recent inspection</p>
          <p className="text-xs mt-2">
            <span className="text-red-400">{missingInspections.filter(v => v.severity === 'critical').length} critical</span>
            {' · '}
            <span className="text-orange-400">{missingInspections.filter(v => v.severity === 'high').length} high</span>
          </p>
        </div>

        {/* Data Quality Score */}
        <div className={`card p-5 border ${parseFloat(complianceMetrics.dqScore) >= 80 ? 'bg-green-900/10 border-green-700/30' : parseFloat(complianceMetrics.dqScore) >= 60 ? 'bg-yellow-900/10 border-yellow-700/30' : 'bg-red-900/10 border-red-700/30'}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">Data Quality Score</span>
            <ShieldCheck size={16} className={dqColor(complianceMetrics.dqScore)} />
          </div>
          <p className={`text-3xl font-bold ${dqColor(complianceMetrics.dqScore)}`}>
            {complianceMetrics.dqScore}%
          </p>
          <p className="text-xs text-gray-500 mt-1">Based on findings + date completeness</p>
          <div className="mt-2 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${parseFloat(complianceMetrics.dqScore) >= 80 ? 'bg-green-500' : parseFloat(complianceMetrics.dqScore) >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, parseFloat(complianceMetrics.dqScore))}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Section 2: Charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Compliance by Site */}
        <div className="card p-4">
          <p className="text-sm font-semibold text-gray-300 mb-3">Compliance % by Site</p>
          {complianceBySite.length === 0 ? (
            <div className="flex items-center justify-center h-[260px] text-gray-600 text-sm">No site data</div>
          ) : (
            <div style={{ height: 260 }}>
              <Bar data={siteChartData} options={CHART_OPTS_BAR} />
            </div>
          )}
        </div>

        {/* Monthly Trend */}
        <div className="card p-4">
          <p className="text-sm font-semibold text-gray-300 mb-3">Monthly Compliance Trend</p>
          <div style={{ height: 260 }}>
            <Line data={trendChartData} options={CHART_OPTS_LINE} />
          </div>
        </div>

        {/* Inspection Type Distribution */}
        <div className="card p-4">
          <p className="text-sm font-semibold text-gray-300 mb-3">Inspection Type Distribution</p>
          {typeDistribution.length === 0 ? (
            <div className="flex items-center justify-center h-[240px] text-gray-600 text-sm">No data</div>
          ) : (
            <div style={{ height: 240 }}>
              <Doughnut data={donutChartData} options={DONUT_OPTS} />
            </div>
          )}
        </div>
      </div>

      {/* ── Section 3: Missing Inspections Table ── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-orange-400" />
            <p className="font-semibold text-gray-200">Missing Inspections</p>
          </div>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${missingInspections.length === 0 ? 'bg-green-900/30 text-green-400 border-green-700/50' : 'bg-red-900/30 text-red-400 border-red-700/50'}`}>
            {missingInspections.length} vehicles
          </span>
        </div>

        {missingInspections.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-green-400">
            <CheckCircle size={18} />
            <span className="text-sm font-medium">All vehicles have recent inspections</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-header">Asset No</th>
                  <th className="table-header">Site</th>
                  <th className="table-header">Last Inspection</th>
                  <th className="table-header">Days Since</th>
                  <th className="table-header">Status</th>
                  <th className="table-header text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {missingInspections.map(v => (
                  <tr
                    key={v.asset_no}
                    className={`border-t border-white/5 ${v.severity === 'critical' ? 'bg-red-900/10' : v.severity === 'high' ? 'bg-orange-900/10' : 'bg-yellow-900/5'}`}
                  >
                    <td className="table-cell font-mono text-xs">{v.asset_no}</td>
                    <td className="table-cell text-gray-300">{v.site}</td>
                    <td className="table-cell text-gray-400">{v.lastInspectionDate || '-'}</td>
                    <td className="table-cell font-semibold">{v.daysSince === '-' ? '-' : `${v.daysSince}d`}</td>
                    <td className="table-cell"><SeverityBadge sev={v.severity} /></td>
                    <td className="table-cell text-right">
                      {alertRaised[v.asset_no] ? (
                        <span className="text-xs text-green-400 flex items-center justify-end gap-1">
                          <CheckCircle size={12} /> Alert raised
                        </span>
                      ) : (
                        <button
                          onClick={() => handleRaiseAlert(v)}
                          disabled={raisingAlert === v.asset_no}
                          className="btn-primary text-xs px-3 py-1 disabled:opacity-50"
                        >
                          {raisingAlert === v.asset_no ? 'Raising...' : 'Raise Alert'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 4: Duplicate Detection ── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-yellow-400" />
            <p className="font-semibold text-gray-200">Duplicate Inspection Entries</p>
          </div>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${duplicates.length === 0 ? 'bg-green-900/30 text-green-400 border-green-700/50' : 'bg-yellow-900/30 text-yellow-400 border-yellow-700/50'}`}>
            {duplicates.length} found
          </span>
        </div>

        {duplicates.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-green-400">
            <CheckCircle size={18} />
            <span className="text-sm font-medium">No duplicate entries detected</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-header">Asset No</th>
                  <th className="table-header">Date</th>
                  <th className="table-header">Type</th>
                  <th className="table-header text-center">Count</th>
                  <th className="table-header">Inspectors</th>
                  <th className="table-header text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {duplicates.map((d, i) => (
                  <tr key={i} className="border-t border-white/5 bg-yellow-900/5">
                    <td className="table-cell font-mono text-xs">{d.asset_no || '-'}</td>
                    <td className="table-cell text-gray-400">{d.date || '-'}</td>
                    <td className="table-cell text-gray-300">{d.type || '-'}</td>
                    <td className="table-cell text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-900/40 text-yellow-400 border border-yellow-700/50">
                        ×{d.count}
                      </span>
                    </td>
                    <td className="table-cell text-gray-400 text-xs">{d.inspectorNames || '-'}</td>
                    <td className="table-cell text-right">
                      <a
                        href="/inspections"
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center justify-end gap-1"
                      >
                        <Eye size={12} /> Review
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 5: Inspector Quality Scoreboard ── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
          <Users size={16} className="text-indigo-400" />
          <p className="font-semibold text-gray-200">Inspector Quality Scoreboard</p>
        </div>

        {inspectorScores.length === 0 ? (
          <div className="px-5 py-10 text-center text-gray-500 text-sm">
            Inspector data will appear once the <code className="text-gray-400 bg-gray-800 px-1 rounded">inspector</code> field is captured in inspections
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-header">Inspector</th>
                  <th className="table-header text-center">Total</th>
                  <th className="table-header">Quality Score</th>
                  <th className="table-header text-center">Missing Findings</th>
                  <th className="table-header text-center">Incomplete</th>
                  <th className="table-header text-center">Badge</th>
                </tr>
              </thead>
              <tbody>
                {inspectorScores.map((ins, i) => {
                  const scorePct = ins.qualityScore * 100
                  const badge = scorePct >= 90
                    ? { label: 'Top Performer', style: 'bg-green-900/30 text-green-400 border-green-700/50' }
                    : scorePct < 70
                    ? { label: 'Needs Improvement', style: 'bg-yellow-900/30 text-yellow-400 border-yellow-700/50' }
                    : { label: 'Average', style: 'bg-gray-800 text-gray-400 border-gray-700' }

                  return (
                    <tr key={i} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="table-cell font-medium text-gray-200">{ins.inspector}</td>
                      <td className="table-cell text-center text-gray-300">{ins.totalInspections}</td>
                      <td className="table-cell min-w-[140px]">
                        <QualityBar score={ins.qualityScore} />
                      </td>
                      <td className="table-cell text-center">
                        <span className={`${ins.missingFindings > 0 ? 'text-red-400 font-semibold' : 'text-gray-500'}`}>
                          {ins.missingFindings}
                        </span>
                      </td>
                      <td className="table-cell text-center">
                        <span className={`${ins.incompleteCount > 0 ? 'text-orange-400 font-semibold' : 'text-gray-500'}`}>
                          {ins.incompleteCount}
                        </span>
                      </td>
                      <td className="table-cell text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${badge.style}`}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 6: Data Quality Issues ── */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck size={16} className="text-indigo-400" />
          <p className="font-semibold text-gray-200">Data Quality Issues</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* No Findings */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">No Findings Text</span>
              <span className={`text-lg font-bold ${complianceMetrics.missingFindings.length > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {complianceMetrics.missingFindings.length}
              </span>
            </div>
            {complianceMetrics.missingFindings.length > 0 && (
              <>
                <button
                  onClick={() => setExpandedDQ(expandedDQ === 'findings' ? null : 'findings')}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  {expandedDQ === 'findings' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  View affected
                </button>
                {expandedDQ === 'findings' && (
                  <ExpandableIssueList
                    items={complianceMetrics.missingFindings}
                    labelFn={r => `${r.asset_no || '-'} · ${r.scheduled_date || '-'} · ${r.site || '-'}`}
                  />
                )}
              </>
            )}
          </div>

          {/* No Inspector */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">No Inspector Name</span>
              <span className={`text-lg font-bold ${complianceMetrics.noInspector.length > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                {complianceMetrics.noInspector.length}
              </span>
            </div>
            {complianceMetrics.noInspector.length > 0 && (
              <>
                <button
                  onClick={() => setExpandedDQ(expandedDQ === 'inspector' ? null : 'inspector')}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  {expandedDQ === 'inspector' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  View affected
                </button>
                {expandedDQ === 'inspector' && (
                  <ExpandableIssueList
                    items={complianceMetrics.noInspector}
                    labelFn={r => `${r.asset_no || '-'} · ${r.scheduled_date || '-'} · ${r.site || '-'}`}
                  />
                )}
              </>
            )}
          </div>

          {/* Suspicious Date */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Suspicious Date</span>
              <span className={`text-lg font-bold ${complianceMetrics.suspiciousDate.length > 0 ? 'text-orange-400' : 'text-green-400'}`}>
                {complianceMetrics.suspiciousDate.length}
              </span>
            </div>
            <p className="text-xs text-gray-600 mb-2">Done before scheduled date</p>
            {complianceMetrics.suspiciousDate.length > 0 && (
              <>
                <button
                  onClick={() => setExpandedDQ(expandedDQ === 'suspicious' ? null : 'suspicious')}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  {expandedDQ === 'suspicious' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  View affected
                </button>
                {expandedDQ === 'suspicious' && (
                  <ExpandableIssueList
                    items={complianceMetrics.suspiciousDate}
                    labelFn={r => `${r.asset_no || '-'} · completed ${r.completed_date} / scheduled ${r.scheduled_date}`}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 6b: Inconsistent Inspections ── */}
      {inconsistentInspections.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-purple-400" />
              <p className="font-semibold text-gray-200">Inconsistent Inspection Patterns</p>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-900/30 text-purple-400 border border-purple-700/50">
              {inconsistentInspections.length} flagged
            </span>
          </div>
          <div className="divide-y divide-white/5">
            {inconsistentInspections.map((item, i) => (
              <div key={i} className="px-5 py-3 flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-purple-500 mt-1.5 flex-shrink-0" />
                <div>
                  <span className="text-sm font-semibold text-gray-200">{item.asset_no}</span>
                  <span className="text-xs text-gray-500 ml-2">{item.site}</span>
                  <span className="ml-2 px-2 py-0.5 rounded text-xs bg-purple-900/30 text-purple-400 border border-purple-700/40">
                    {item.inconsistencyType}
                  </span>
                  <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Section 7: Recommendations ── */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle size={16} className="text-yellow-400" />
          <p className="font-semibold text-gray-200">Automated Recommendations</p>
          <span className="text-xs text-gray-500">({recommendations.length} action{recommendations.length !== 1 ? 's' : ''})</span>
        </div>

        {recommendations.length === 0 ? (
          <div className="flex items-center gap-2 text-green-400 py-4">
            <CheckCircle size={18} />
            <span className="text-sm font-medium">All metrics within acceptable thresholds - no immediate action required</span>
          </div>
        ) : (
          <div className="space-y-2">
            {recommendations.map((r, i) => (
              <RecommendationCard key={i} priority={r.priority} message={r.message} />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
