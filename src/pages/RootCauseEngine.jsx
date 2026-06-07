import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  AlertOctagon, Download, FileText, ChevronLeft, ChevronRight,
  ExternalLink, AlertTriangle, TrendingUp, DollarSign, Activity,
  Filter, BarChart2, ShieldAlert, Layers,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { useSettings } from '../contexts/SettingsContext'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

// ─── Constants ────────────────────────────────────────────────────────────────

const ROOT_CAUSES = [
  'Under Inflation',
  'Over Inflation',
  'Alignment Issues',
  'Suspension Issues',
  'Wheel Balancing',
  'Brake Problems',
  'Driver Behavior',
  'Road Conditions',
  'Load Conditions',
  'Overloading',
  'Maintenance Quality',
  'Manufacturing Defects',
  'Rotation Compliance',
  'Operational Misuse',
]

const PREVENTION_MAP = {
  'Under Inflation': 'Implement weekly pressure checks. Install TPMS sensors on all vehicles. Train drivers on visual inspection. Set pressure alert threshold at ±10 PSI from spec.',
  'Over Inflation': 'Review inflation procedures. Calibrate all pressure gauges quarterly. Enforce manufacturer spec inflation. Avoid inflating tyres hot.',
  'Alignment Issues': 'Schedule alignment checks every 20,000 km or after impact events. Inspect after any suspension repair. Review camber and toe settings.',
  'Suspension Issues': 'Inspect shock absorbers every 50,000 km. Implement suspension check during tyre rotation. Replace worn components before tyre installation.',
  'Wheel Balancing': 'Balance all tyres at fitment. Re-balance at 10,000 km intervals. Inspect wheel weights after any impact.',
  'Brake Problems': 'Inspect braking system before tyre installation on affected axles. Address brake drag immediately. Train drivers on smooth braking technique.',
  'Driver Behavior': 'Implement driver behavior monitoring (telematics). Run defensive driving training. Review high-km-loss records with fleet managers.',
  'Road Conditions': 'Map high-risk routes and apply tyre specification upgrades. Increase inspection frequency for affected routes. Carry puncture repair kits.',
  'Load Conditions': 'Audit load distribution procedures. Verify load ratings match tyre spec. Inspect tyres after heavy load runs.',
  'Overloading': 'Enforce maximum load compliance. Install load monitoring. Reject overloaded assignments until corrected.',
  'Maintenance Quality': 'Audit workshop quality standards. Implement pre-fitment tread depth check. Enforce mandatory service intervals.',
  'Manufacturing Defects': 'Raise warranty claims for qualifying records. Audit supplier quality. Implement incoming tyre inspection before fitment.',
  'Rotation Compliance': 'Implement rotation schedule at 10,000 km intervals. Log all rotations in system. Audit steer position wear patterns monthly.',
  'Operational Misuse': 'Enforce tyre specification matching for vehicle type. Prohibit retread use on steer axles if policy violated. Audit mixed tyre usage.',
}

const DATE_PRESETS = [
  { label: 'Last 30d', days: 30 },
  { label: 'Last 90d', days: 90 },
  { label: 'Last 6mo', days: 180 },
  { label: 'Last 1yr', days: 365 },
  { label: 'All Time', days: null },
]

const RISK_COLORS_MAP = {
  Critical: '#dc2626',
  High: '#ea580c',
  Medium: '#d97706',
  Low: '#16a34a',
}

const CHART_DARK = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1f2937',
      borderColor: '#374151',
      borderWidth: 1,
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: '#9ca3af', font: { size: 11 } },
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.06)' },
      ticks: { color: '#9ca3af', font: { size: 11 } },
    },
  },
}

const RECORDS_PER_PAGE = 20
const TOP_CAUSES_HEATMAP = 8

// ─── Root Cause Classification ────────────────────────────────────────────────

function classifyRootCauses(record) {
  const findings = (record.findings || record.description || record.remarks || '').toLowerCase()
  const category = (record.category || '').toLowerCase()
  const removalReason = (record.removal_reason || '').toLowerCase()
  const position = (record.position || '').toLowerCase()
  const combined = findings + ' ' + category + ' ' + removalReason

  const pressure = parseFloat(record.pressure_reading)
  const tread = parseFloat(record.tread_depth)
  const kmFit = parseFloat(record.km_at_fitment)
  const kmRem = parseFloat(record.km_at_removal)
  const cost = parseFloat(record.cost_per_tyre)
  const kmLife = !isNaN(kmFit) && !isNaN(kmRem) ? kmRem - kmFit : NaN
  const riskLevel = (record.risk_level || '').trim()

  const matched = []

  // 1. Under Inflation
  if (
    /under|low pressure|under inflat|deflat|flat/.test(combined) ||
    (!isNaN(pressure) && pressure < 70) ||
    (!isNaN(tread) && tread < 2 && riskLevel === 'Critical')
  ) {
    matched.push('Under Inflation')
  }

  // 2. Over Inflation
  if (
    /over inflat|over pressure|high pressure|burst|blowout/.test(combined) ||
    (!isNaN(pressure) && pressure > 130)
  ) {
    matched.push('Over Inflation')
  }

  // 3. Alignment Issues
  if (
    /align|toe|camber|caster|irregular wear|one-sided|feathering/.test(combined) ||
    /alignment|irregular/.test(category)
  ) {
    matched.push('Alignment Issues')
  }

  // 4. Suspension Issues
  if (/suspension|shock|absorber|strut|cupping|scallop/.test(combined)) {
    matched.push('Suspension Issues')
  }

  // 5. Wheel Balancing
  if (/balanc|vibrat|wobble|shimmy|cupping/.test(combined)) {
    matched.push('Wheel Balancing')
  }

  // 6. Brake Problems
  if (/brake|lock|flat spot|skid|drag/.test(combined)) {
    matched.push('Brake Problems')
  }

  // 7. Driver Behavior
  if (
    /driver|speeding|hard brake|curb|pothole strike|impact|abuse/.test(combined) ||
    (!isNaN(kmLife) && kmLife < 10000 && riskLevel === 'Critical')
  ) {
    matched.push('Driver Behavior')
  }

  // 8. Road Conditions
  if (
    /road|gravel|debris|nail|cut|puncture|kerb|pothole/.test(combined) ||
    /puncture|cut|impact/.test(category)
  ) {
    matched.push('Road Conditions')
  }

  // 9. Load Conditions
  if (/\bload\b|weight|cargo/.test(combined) && !/overload/.test(combined)) {
    matched.push('Load Conditions')
  }

  // 10. Overloading
  if (
    /overload|excess load|over weight|over capacity/.test(combined) ||
    (!isNaN(kmLife) && kmLife < 20000 && !isNaN(cost) && cost > 1500)
  ) {
    matched.push('Overloading')
  }

  // 11. Maintenance Quality
  if (
    /maintenan|service|neglect|worn|deteriorat|age/.test(combined) ||
    (!isNaN(tread) && tread < 1.6)
  ) {
    matched.push('Maintenance Quality')
  }

  // 12. Manufacturing Defects
  if (
    /defect|manufactur|warranty|delamination|bead|sidewall crack|bulge/.test(combined) ||
    /defect|warranty/.test(category)
  ) {
    matched.push('Manufacturing Defects')
  }

  // 13. Rotation Compliance
  if (
    /rotat|not rotated|overdue rotation/.test(combined) ||
    (
      /steer/.test(position) &&
      !isNaN(kmLife) && kmLife < 30000 &&
      (riskLevel === 'High' || riskLevel === 'Critical')
    )
  ) {
    matched.push('Rotation Compliance')
  }

  // 14. Operational Misuse
  if (
    /misuse|wrong tyre|wrong size|retread abuse|off-road|overspec/.test(combined) ||
    /misuse/.test(category)
  ) {
    matched.push('Operational Misuse')
  }

  return matched
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyDatePreset(preset) {
  if (!preset || preset.days === null) return null
  const d = new Date()
  d.setDate(d.getDate() - preset.days)
  return d.toISOString().slice(0, 10)
}

function fmtCost(n, currency = 'ZAR') {
  if (isNaN(n) || n === 0) return `${currency} 0`
  return `${currency} ${Math.round(n).toLocaleString()}`
}

function fmtNum(n) {
  return (n || 0).toLocaleString()
}

function topN(arr, key, n = 5) {
  const counts = {}
  arr.forEach(r => {
    const val = r[key]
    if (val) counts[val] = (counts[val] || 0) + 1
  })
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }))
}

function barColor(count, total) {
  if (total === 0) return '#4b5563'
  const pct = count / total
  if (pct > 0.2) return '#dc2626'
  if (pct > 0.1) return '#d97706'
  return '#16a34a'
}

function heatIntensity(count, max) {
  if (!count || !max) return ''
  const ratio = count / max
  if (ratio > 0.75) return 'bg-red-700 text-white'
  if (ratio > 0.5) return 'bg-orange-700 text-white'
  if (ratio > 0.25) return 'bg-yellow-700 text-gray-900'
  if (ratio > 0) return 'bg-green-900 text-green-200'
  return ''
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, sub, color = 'text-blue-400' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-3">
      <div className={`mt-0.5 ${color}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
        <p className={`text-xl font-bold mt-0.5 ${color}`}>{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RootCauseEngine() {
  const { activeCurrency, activeCountry } = useSettings()
  const currency = activeCurrency || 'ZAR'

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [datePreset, setDatePreset] = useState('All Time')
  const [siteFilter, setSiteFilter] = useState('all')
  const [riskFilter, setRiskFilter] = useState('all')
  const [minRecords, setMinRecords] = useState(1)

  const [activeTab, setActiveTab] = useState('Under Inflation')
  const [deepDivePage, setDeepDivePage] = useState(1)

  // ── Data fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('tyre_records')
      .select(
        'id,asset_no,site,brand,tyre_serial,category,risk_level,findings,description,remarks,' +
        'tread_depth,pressure_reading,km_at_fitment,km_at_removal,cost_per_tyre,' +
        'issue_date,removal_reason,position'
      )
      .order('issue_date', { ascending: false })
      .limit(10000)

    if (activeCountry && activeCountry !== 'All') {
      q = q.eq('country', activeCountry)
    }

    q.then(({ data, error: err }) => {
      if (err) {
        setError(err.message)
      } else {
        setRecords(data || [])
      }
      setLoading(false)
    })
  }, [activeCountry])

  // ── Sites list ──────────────────────────────────────────────────────────────
  const allSites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return ['all', ...[...s].sort()]
  }, [records])

  // ── Date cutoff ─────────────────────────────────────────────────────────────
  const dateCutoff = useMemo(() => {
    const preset = DATE_PRESETS.find(p => p.label === datePreset)
    return preset ? applyDatePreset(preset) : null
  }, [datePreset])

  // ── Filtered records ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return records.filter(r => {
      if (dateCutoff && r.issue_date && r.issue_date < dateCutoff) return false
      if (siteFilter !== 'all' && r.site !== siteFilter) return false
      if (riskFilter !== 'all') {
        if ((r.risk_level || '').trim() !== riskFilter) return false
      }
      return true
    })
  }, [records, dateCutoff, siteFilter, riskFilter])

  // ── Classification ──────────────────────────────────────────────────────────
  const classifiedRecords = useMemo(() => {
    return filtered.map(r => ({
      ...r,
      rootCauses: classifyRootCauses(r),
    }))
  }, [filtered])

  // ── Cause stats ─────────────────────────────────────────────────────────────
  const causeStats = useMemo(() => {
    const stats = {}
    ROOT_CAUSES.forEach(c => {
      stats[c] = { count: 0, totalCost: 0, records: [] }
    })

    classifiedRecords.forEach(r => {
      const causes = r.rootCauses.length > 0 ? r.rootCauses : []
      causes.forEach(cause => {
        if (stats[cause]) {
          stats[cause].count++
          stats[cause].totalCost += parseFloat(r.cost_per_tyre) || 0
          stats[cause].records.push(r)
        }
      })
    })

    return stats
  }, [classifiedRecords])

  // ── Causes sorted by count ──────────────────────────────────────────────────
  const sortedCauses = useMemo(() => {
    return ROOT_CAUSES
      .map(c => ({ cause: c, ...causeStats[c] }))
      .filter(c => c.count >= minRecords)
      .sort((a, b) => b.count - a.count)
  }, [causeStats, minRecords])

  const totalClassified = useMemo(() => {
    const ids = new Set()
    classifiedRecords.forEach(r => {
      if (r.rootCauses.length > 0) ids.add(r.id)
    })
    return ids.size
  }, [classifiedRecords])

  const topCause = sortedCauses[0] || null

  // ── Frequency chart data ────────────────────────────────────────────────────
  const freqChartData = useMemo(() => {
    const total = sortedCauses.reduce((s, c) => s + c.count, 0)
    return {
      labels: sortedCauses.map(c => c.cause),
      datasets: [{
        label: 'Records',
        data: sortedCauses.map(c => c.count),
        backgroundColor: sortedCauses.map(c => barColor(c.count, total)),
        borderRadius: 4,
        borderSkipped: false,
      }],
    }
  }, [sortedCauses])

  // ── Financial chart data ────────────────────────────────────────────────────
  const financialChartData = useMemo(() => {
    const sorted = [...sortedCauses].sort((a, b) => b.totalCost - a.totalCost)
    return {
      labels: sorted.map(c => c.cause),
      datasets: [{
        label: 'Total Cost',
        data: sorted.map(c => Math.round(c.totalCost)),
        backgroundColor: sorted.map((_, i) => {
          const opacity = 1 - (i / sorted.length) * 0.6
          return `rgba(99,102,241,${opacity})`
        }),
        borderRadius: 4,
        borderSkipped: false,
      }],
    }
  }, [sortedCauses])

  // ── Heat map ─────────────────────────────────────────────────────────────────
  const heatMapData = useMemo(() => {
    const topCauses = sortedCauses.slice(0, TOP_CAUSES_HEATMAP).map(c => c.cause)
    const sites = allSites.filter(s => s !== 'all')

    const matrix = {}
    sites.forEach(site => {
      matrix[site] = {}
      topCauses.forEach(c => { matrix[site][c] = 0 })
    })

    classifiedRecords.forEach(r => {
      if (!r.site) return
      r.rootCauses.forEach(cause => {
        if (topCauses.includes(cause) && matrix[r.site]) {
          matrix[r.site][cause] = (matrix[r.site][cause] || 0) + 1
        }
      })
    })

    // Only include sites that have at least 1 match
    const activeSites = sites.filter(s => topCauses.some(c => matrix[s][c] > 0))
    const maxVal = Math.max(
      1,
      ...activeSites.flatMap(s => topCauses.map(c => matrix[s][c] || 0))
    )

    return { topCauses, activeSites, matrix, maxVal }
  }, [sortedCauses, allSites, classifiedRecords])

  // ── Deep dive data for active tab ───────────────────────────────────────────
  const deepDiveData = useMemo(() => {
    const stat = causeStats[activeTab] || { count: 0, totalCost: 0, records: [] }
    const recs = stat.records
    const total = filtered.length

    const kmLifeValues = recs
      .map(r => {
        const fit = parseFloat(r.km_at_fitment)
        const rem = parseFloat(r.km_at_removal)
        return !isNaN(fit) && !isNaN(rem) && rem > fit ? rem - fit : null
      })
      .filter(v => v !== null)

    const costValues = recs.map(r => parseFloat(r.cost_per_tyre)).filter(v => !isNaN(v) && v > 0)
    const avgCPK = kmLifeValues.length > 0 && costValues.length > 0
      ? (costValues.reduce((a, b) => a + b, 0) / costValues.length) /
        (kmLifeValues.reduce((a, b) => a + b, 0) / kmLifeValues.length)
      : null

    const totalPages = Math.ceil(recs.length / RECORDS_PER_PAGE)
    const paginated = recs.slice((deepDivePage - 1) * RECORDS_PER_PAGE, deepDivePage * RECORDS_PER_PAGE)

    return {
      count: stat.count,
      pct: total > 0 ? ((stat.count / total) * 100).toFixed(1) : '0.0',
      totalCost: stat.totalCost,
      avgCPK,
      topAssets: topN(recs, 'asset_no', 5),
      topBrands: topN(recs, 'brand', 5),
      topSites: topN(recs, 'site', 5),
      prevention: PREVENTION_MAP[activeTab] || '',
      paginated,
      totalPages,
      totalRecs: recs.length,
    }
  }, [activeTab, causeStats, filtered.length, deepDivePage])

  // Reset page when tab changes
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab)
    setDeepDivePage(1)
  }, [])

  // ── Worst vehicles ──────────────────────────────────────────────────────────
  const worstVehicles = useMemo(() => {
    const vehicleMap = {}

    classifiedRecords.forEach(r => {
      if (!r.asset_no || r.rootCauses.length === 0) return
      if (!vehicleMap[r.asset_no]) {
        vehicleMap[r.asset_no] = {
          asset_no: r.asset_no,
          site: r.site || '—',
          totalIncidents: 0,
          causeCounts: {},
          totalCost: 0,
          kmLifeSum: 0,
          kmLifeCount: 0,
        }
      }
      const v = vehicleMap[r.asset_no]
      v.totalIncidents += r.rootCauses.length
      const cost = parseFloat(r.cost_per_tyre) || 0
      v.totalCost += cost
      r.rootCauses.forEach(c => {
        v.causeCounts[c] = (v.causeCounts[c] || 0) + 1
      })
      const kmFit = parseFloat(r.km_at_fitment)
      const kmRem = parseFloat(r.km_at_removal)
      if (!isNaN(kmFit) && !isNaN(kmRem) && kmRem > kmFit) {
        v.kmLifeSum += kmRem - kmFit
        v.kmLifeCount++
      }
    })

    return Object.values(vehicleMap)
      .map(v => {
        const topCauseEntry = Object.entries(v.causeCounts).sort((a, b) => b[1] - a[1])[0]
        const avgKmLife = v.kmLifeCount > 0 ? v.kmLifeSum / v.kmLifeCount : null
        const avgCost = v.totalCost / Math.max(v.kmLifeCount || 1, 1)
        const avgCPK = avgKmLife && avgCost ? avgCost / avgKmLife : null
        return {
          ...v,
          topCause: topCauseEntry ? topCauseEntry[0] : '—',
          avgCPK,
        }
      })
      .sort((a, b) => b.totalIncidents - a.totalIncidents)
      .slice(0, 15)
  }, [classifiedRecords])

  // ── Exports ─────────────────────────────────────────────────────────────────
  function handleExcelExport() {
    const rows = classifiedRecords.map(r => ({
      asset_no: r.asset_no || '',
      site: r.site || '',
      brand: r.brand || '',
      issue_date: r.issue_date || '',
      risk_level: r.risk_level || '',
      root_causes: r.rootCauses.join('; ') || 'Unclassified',
      cost_per_tyre: r.cost_per_tyre || '',
      findings: (r.findings || r.description || r.remarks || '').slice(0, 200),
    }))
    exportToExcel(
      rows,
      ['asset_no', 'site', 'brand', 'issue_date', 'risk_level', 'root_causes', 'cost_per_tyre', 'findings'],
      ['Asset No', 'Site', 'Brand', 'Date', 'Risk Level', 'Root Causes', `Cost (${currency})`, 'Findings'],
      'TyrePulse_RootCause_Export',
      'Root Causes'
    )
  }

  function handlePdfExport() {
    const rows = sortedCauses.map(c => ({
      cause: c.cause,
      count: c.count.toLocaleString(),
      total_cost: Math.round(c.totalCost).toLocaleString(),
      pct: filtered.length > 0 ? ((c.count / filtered.length) * 100).toFixed(1) + '%' : '0%',
      top_asset: topN(c.records, 'asset_no', 1)[0]?.name || '—',
    }))
    exportToPdf(
      rows,
      [
        { key: 'cause', header: 'Root Cause' },
        { key: 'count', header: 'Records' },
        { key: 'pct', header: '% of Total' },
        { key: 'total_cost', header: `Cost (${currency})` },
        { key: 'top_asset', header: 'Top Asset' },
      ],
      'Root Cause Intelligence Summary',
      'TyrePulse_RootCause_Summary',
      'landscape'
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Loading classification engine…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="bg-gray-900 border border-red-900 rounded-xl p-8 text-center max-w-md">
          <AlertOctagon size={32} className="text-red-500 mx-auto mb-3" />
          <p className="text-red-400 font-semibold mb-1">Failed to load records</p>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center max-w-md">
          <Layers size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 font-semibold mb-1">No tyre records found</p>
          <p className="text-gray-600 text-sm">Upload tyre change records to enable root cause analysis.</p>
        </div>
      </div>
    )
  }

  const coveragePct = filtered.length > 0
    ? ((totalClassified / filtered.length) * 100).toFixed(1)
    : '0.0'

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-red-900/30 rounded-lg border border-red-800/40 mt-0.5">
            <AlertOctagon size={22} className="text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Root Cause Intelligence Engine</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Rule-based classification of 14 engineering root causes across the fleet
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleExcelExport}
            className="flex items-center gap-2 px-3 py-2 bg-green-900/40 border border-green-700/50 text-green-400 rounded-lg text-sm hover:bg-green-900/60 transition-colors"
          >
            <Download size={15} />
            Excel
          </button>
          <button
            onClick={handlePdfExport}
            className="flex items-center gap-2 px-3 py-2 bg-red-900/40 border border-red-700/50 text-red-400 rounded-lg text-sm hover:bg-red-900/60 transition-colors"
          >
            <FileText size={15} />
            PDF
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-gray-500" />
          <span className="text-xs text-gray-500 uppercase tracking-wide font-medium">Filters</span>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          {/* Date presets */}
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Date Range</p>
            <div className="flex gap-1.5 flex-wrap">
              {DATE_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => setDatePreset(p.label)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    datePreset === p.label
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Site filter */}
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Site</p>
            <select
              value={siteFilter}
              onChange={e => setSiteFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Sites</option>
              {allSites.filter(s => s !== 'all').map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Risk filter */}
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Risk Level</p>
            <select
              value={riskFilter}
              onChange={e => setRiskFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Levels</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          {/* Min records */}
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Min Records: <span className="text-gray-400">{minRecords}</span></p>
            <input
              type="range"
              min={1}
              max={50}
              value={minRecords}
              onChange={e => setMinRecords(Number(e.target.value))}
              className="w-28 accent-indigo-500"
            />
          </div>

          <div className="ml-auto text-xs text-gray-600">
            {fmtNum(filtered.length)} records in view
          </div>
        </div>
      </div>

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Activity}
          label="Total Records"
          value={fmtNum(filtered.length)}
          sub="in current filter"
          color="text-blue-400"
        />
        <StatCard
          icon={ShieldAlert}
          label="Cause Coverage"
          value={`${coveragePct}%`}
          sub={`${fmtNum(totalClassified)} records classified`}
          color="text-indigo-400"
        />
        <StatCard
          icon={TrendingUp}
          label="Top Root Cause"
          value={topCause ? topCause.cause.split(' ').slice(0, 2).join(' ') : '—'}
          sub={topCause ? `${fmtNum(topCause.count)} records` : 'No data'}
          color="text-red-400"
        />
        <StatCard
          icon={DollarSign}
          label="Top Cause Cost"
          value={topCause ? fmtCost(topCause.totalCost, currency) : '—'}
          sub={topCause ? `for ${topCause.cause}` : 'No data'}
          color="text-amber-400"
        />
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Frequency chart */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={16} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-white">Root Cause Frequency</h2>
          </div>
          {sortedCauses.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-600 text-sm">
              No causes meet the minimum records threshold
            </div>
          ) : (
            <div style={{ height: Math.max(sortedCauses.length * 36, 200) }}>
              <Bar
                data={freqChartData}
                options={{
                  ...CHART_DARK,
                  indexAxis: 'y',
                  plugins: {
                    ...CHART_DARK.plugins,
                    tooltip: {
                      ...CHART_DARK.plugins.tooltip,
                      callbacks: {
                        label: ctx => ` ${ctx.parsed.x.toLocaleString()} records`,
                      },
                    },
                  },
                  scales: {
                    x: {
                      grid: { color: 'rgba(255,255,255,0.06)' },
                      ticks: { color: '#9ca3af', font: { size: 11 } },
                    },
                    y: {
                      grid: { color: 'transparent' },
                      ticks: { color: '#d1d5db', font: { size: 11 } },
                    },
                  },
                }}
              />
            </div>
          )}
          <div className="flex gap-4 mt-3 text-xs text-gray-600">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-600 inline-block" /> &gt;20% of total</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-600 inline-block" /> 10-20%</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-700 inline-block" /> &lt;10%</span>
          </div>
        </div>

        {/* Financial impact chart */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign size={16} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Financial Impact by Root Cause</h2>
            <span className="text-xs text-gray-600 ml-1">({currency})</span>
          </div>
          {sortedCauses.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-600 text-sm">
              No data available
            </div>
          ) : (
            <div style={{ height: Math.max(sortedCauses.length * 36, 200) }}>
              <Bar
                data={financialChartData}
                options={{
                  ...CHART_DARK,
                  indexAxis: 'y',
                  plugins: {
                    ...CHART_DARK.plugins,
                    tooltip: {
                      ...CHART_DARK.plugins.tooltip,
                      callbacks: {
                        label: ctx => ` ${currency} ${Math.round(ctx.parsed.x).toLocaleString()}`,
                      },
                    },
                  },
                  scales: {
                    x: {
                      grid: { color: 'rgba(255,255,255,0.06)' },
                      ticks: {
                        color: '#9ca3af',
                        font: { size: 11 },
                        callback: v => `${currency} ${(v / 1000).toFixed(0)}K`,
                      },
                    },
                    y: {
                      grid: { color: 'transparent' },
                      ticks: { color: '#d1d5db', font: { size: 11 } },
                    },
                  },
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Heat Map ── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
        <div className="flex items-center gap-2 mb-4">
          <Layers size={16} className="text-purple-400" />
          <h2 className="text-sm font-semibold text-white">Site × Root Cause Heat Map</h2>
          <span className="text-xs text-gray-600 ml-1">(top {TOP_CAUSES_HEATMAP} causes)</span>
        </div>
        {heatMapData.activeSites.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-8">No site data available</p>
        ) : (
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left text-gray-500 font-medium py-2 pr-4 border-b border-gray-800 whitespace-nowrap">Site</th>
                {heatMapData.topCauses.map(c => (
                  <th
                    key={c}
                    className="text-gray-400 font-medium py-2 px-2 border-b border-gray-800 text-center whitespace-nowrap"
                    style={{ maxWidth: 80 }}
                  >
                    <span
                      className="block truncate"
                      style={{ maxWidth: 80 }}
                      title={c}
                    >
                      {c}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatMapData.activeSites.map(site => (
                <tr key={site} className="border-b border-gray-800/50">
                  <td className="py-2 pr-4 text-gray-300 font-medium whitespace-nowrap">{site}</td>
                  {heatMapData.topCauses.map(cause => {
                    const count = heatMapData.matrix[site]?.[cause] || 0
                    const cls = heatIntensity(count, heatMapData.maxVal)
                    return (
                      <td key={cause} className="py-1 px-2 text-center">
                        {count > 0 ? (
                          <span className={`inline-block min-w-[2rem] px-1.5 py-0.5 rounded text-center font-semibold ${cls}`}>
                            {count}
                          </span>
                        ) : (
                          <span className="text-gray-800">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex gap-4 mt-3 text-xs text-gray-600 flex-wrap">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-700" /> High (&gt;75%)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-orange-700" /> Medium-High</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-yellow-700" /> Medium</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-green-900" /> Low</span>
        </div>
      </div>

      {/* ── Deep Dive Tabs ── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Root Cause Deep Dive</h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ROOT_CAUSES.map(cause => {
              const count = causeStats[cause]?.count || 0
              const isActive = activeTab === cause
              return (
                <button
                  key={cause}
                  onClick={() => handleTabChange(cause)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {cause}
                  {count > 0 && (
                    <span className={`rounded-full px-1.5 py-0 text-[10px] font-bold ${
                      isActive ? 'bg-indigo-500 text-white' : 'bg-gray-700 text-gray-400'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="p-4 space-y-4"
          >
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-800/60 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Records</p>
                <p className="text-lg font-bold text-white">{fmtNum(deepDiveData.count)}</p>
                <p className="text-xs text-gray-600">{deepDiveData.pct}% of total</p>
              </div>
              <div className="bg-gray-800/60 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Total Cost</p>
                <p className="text-lg font-bold text-amber-400">{fmtCost(deepDiveData.totalCost, currency)}</p>
              </div>
              <div className="bg-gray-800/60 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Avg CPK</p>
                <p className="text-lg font-bold text-indigo-400">
                  {deepDiveData.avgCPK != null
                    ? `${currency} ${deepDiveData.avgCPK.toFixed(4)}`
                    : '—'}
                </p>
                <p className="text-xs text-gray-600">Cost per km</p>
              </div>
              <div className="bg-gray-800/60 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Coverage %</p>
                <p className="text-lg font-bold text-blue-400">{deepDiveData.pct}%</p>
                <p className="text-xs text-gray-600">of filtered records</p>
              </div>
            </div>

            {/* Top lists */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Top assets */}
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 font-medium">Top 5 Affected Assets</p>
                {deepDiveData.topAssets.length === 0 ? (
                  <p className="text-gray-700 text-xs">No data</p>
                ) : (
                  <ul className="space-y-1.5">
                    {deepDiveData.topAssets.map((a, i) => (
                      <li key={a.name} className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-600 w-4">{i + 1}.</span>
                          <span className="text-gray-300 text-xs font-mono">{a.name}</span>
                        </span>
                        <span className="text-xs font-bold text-white bg-gray-700 px-2 py-0.5 rounded">
                          {a.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Top brands */}
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 font-medium">Top 5 Affected Brands</p>
                {deepDiveData.topBrands.length === 0 ? (
                  <p className="text-gray-700 text-xs">No data</p>
                ) : (
                  <ul className="space-y-1.5">
                    {deepDiveData.topBrands.map((b, i) => (
                      <li key={b.name} className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-600 w-4">{i + 1}.</span>
                          <span className="text-gray-300 text-xs">{b.name}</span>
                        </span>
                        <span className="text-xs font-bold text-white bg-gray-700 px-2 py-0.5 rounded">
                          {b.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Top sites */}
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 font-medium">Top 5 Affected Sites</p>
                {deepDiveData.topSites.length === 0 ? (
                  <p className="text-gray-700 text-xs">No data</p>
                ) : (
                  <ul className="space-y-1.5">
                    {deepDiveData.topSites.map((s, i) => (
                      <li key={s.name} className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-600 w-4">{i + 1}.</span>
                          <span className="text-gray-300 text-xs">{s.name}</span>
                        </span>
                        <span className="text-xs font-bold text-white bg-gray-700 px-2 py-0.5 rounded">
                          {s.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Prevention recommendation */}
            {deepDiveData.prevention && (
              <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg p-3 flex gap-3">
                <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-400 mb-1">Prevention Recommendation</p>
                  <p className="text-sm text-amber-200/80 leading-relaxed">{deepDiveData.prevention}</p>
                </div>
              </div>
            )}

            {/* Records table */}
            {deepDiveData.totalRecs > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-500 font-medium">
                    Affected Records — {fmtNum(deepDiveData.totalRecs)} total
                  </p>
                  {deepDiveData.totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDeepDivePage(p => Math.max(1, p - 1))}
                        disabled={deepDivePage === 1}
                        className="p-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 transition-colors"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <span className="text-xs text-gray-500">
                        {deepDivePage} / {deepDiveData.totalPages}
                      </span>
                      <button
                        onClick={() => setDeepDivePage(p => Math.min(deepDiveData.totalPages, p + 1))}
                        disabled={deepDivePage === deepDiveData.totalPages}
                        className="p-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 transition-colors"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto rounded-lg border border-gray-800">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-gray-800/70 text-gray-400">
                        <th className="text-left py-2 px-3 font-medium">Asset No</th>
                        <th className="text-left py-2 px-3 font-medium">Site</th>
                        <th className="text-left py-2 px-3 font-medium">Brand</th>
                        <th className="text-left py-2 px-3 font-medium">Date</th>
                        <th className="text-left py-2 px-3 font-medium">Risk</th>
                        <th className="text-left py-2 px-3 font-medium">Findings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {deepDiveData.paginated.map(r => (
                        <tr key={r.id} className="hover:bg-gray-800/30 transition-colors">
                          <td className="py-2 px-3 text-gray-200 font-mono">{r.asset_no || '—'}</td>
                          <td className="py-2 px-3 text-gray-300">{r.site || '—'}</td>
                          <td className="py-2 px-3 text-gray-300">{r.brand || '—'}</td>
                          <td className="py-2 px-3 text-gray-400">{r.issue_date || '—'}</td>
                          <td className="py-2 px-3">
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                              style={{
                                backgroundColor: (RISK_COLORS_MAP[r.risk_level] || '#4b5563') + '30',
                                color: RISK_COLORS_MAP[r.risk_level] || '#9ca3af',
                                border: `1px solid ${(RISK_COLORS_MAP[r.risk_level] || '#4b5563')}60`,
                              }}
                            >
                              {r.risk_level || 'N/A'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-gray-400 max-w-xs">
                            <span
                              title={r.findings || r.description || r.remarks || ''}
                              className="block truncate"
                              style={{ maxWidth: 260 }}
                            >
                              {(r.findings || r.description || r.remarks || '—').slice(0, 90)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {deepDiveData.totalRecs === 0 && (
              <div className="text-center py-10 text-gray-700 text-sm">
                No records classified under <span className="text-gray-500 font-medium">{activeTab}</span> with current filters.
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Worst Vehicles Table ── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <AlertOctagon size={16} className="text-red-400" />
          <h2 className="text-sm font-semibold text-white">Worst Vehicles by Root Cause Incidents</h2>
          <span className="text-xs text-gray-600 ml-1">(top 15)</span>
        </div>
        {worstVehicles.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-8">No vehicle data available</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-800/70 text-gray-400">
                  <th className="text-left py-2 px-3 font-medium w-6">#</th>
                  <th className="text-left py-2 px-3 font-medium">Asset No</th>
                  <th className="text-left py-2 px-3 font-medium">Site</th>
                  <th className="text-right py-2 px-3 font-medium">Incidents</th>
                  <th className="text-left py-2 px-3 font-medium">Top Cause</th>
                  <th className="text-right py-2 px-3 font-medium">Total Cost</th>
                  <th className="text-right py-2 px-3 font-medium">Avg CPK</th>
                  <th className="text-center py-2 px-3 font-medium">History</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {worstVehicles.map((v, i) => (
                  <tr key={v.asset_no} className="hover:bg-gray-800/30 transition-colors">
                    <td className="py-2 px-3 text-gray-600">{i + 1}</td>
                    <td className="py-2 px-3 text-gray-200 font-mono font-semibold">{v.asset_no}</td>
                    <td className="py-2 px-3 text-gray-300">{v.site}</td>
                    <td className="py-2 px-3 text-right">
                      <span className={`font-bold ${
                        v.totalIncidents >= 10 ? 'text-red-400' :
                        v.totalIncidents >= 5 ? 'text-amber-400' : 'text-gray-300'
                      }`}>
                        {v.totalIncidents.toLocaleString()}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-400">{v.topCause}</td>
                    <td className="py-2 px-3 text-right text-amber-400 font-medium">
                      {fmtCost(v.totalCost, currency)}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-400">
                      {v.avgCPK != null ? `${currency} ${v.avgCPK.toFixed(4)}` : '—'}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <a
                        href={`/vehicle-history?q=${encodeURIComponent(v.asset_no)}`}
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors text-[11px] font-medium"
                      >
                        <ExternalLink size={12} />
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
