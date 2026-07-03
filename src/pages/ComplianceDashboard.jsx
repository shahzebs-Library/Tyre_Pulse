import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  ShieldCheck, AlertTriangle, CheckCircle, XCircle, TrendingDown, TrendingUp,
  Download, FileText, Filter, X, ChevronLeft, ChevronRight, Search,
  RefreshCw, BarChart3, ClipboardList, Gauge, Building2, Info, Calendar,
  Mail, Award, Clock, AlertCircle, Users, Eye, ExternalLink,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme } from '../lib/exportUtils'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Compliance constants ───────────────────────────────────────────────────────
const LEGAL_MIN_TREAD   = 1.6  // mm - general legal minimum
const FLEET_MIN_TREAD   = 3.0  // mm - heavy commercial / fleet standard
const PRESSURE_TOLERANCE = 0.10 // ±10%
const INSPECTION_MAX_DAYS = 30  // days
const INSPECTION_DUE_DAYS = 45  // warn before overdue

// ── Chart options factory ─────────────────────────────────────────────────────
const chartOpts = (horizontal = false, xLabel = '', yLabel = '') => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: horizontal ? 'y' : 'x',
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 10 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(31,41,55,0.8)' },
      ticks: { color: '#9ca3af', font: { size: 10 } },
      title: xLabel ? { display: true, text: xLabel, color: '#6b7280', font: { size: 10 } } : { display: false },
    },
    y: {
      grid: { color: 'rgba(31,41,55,0.8)' },
      ticks: { color: '#9ca3af', font: { size: 10 } },
      title: yLabel ? { display: true, text: yLabel, color: '#6b7280', font: { size: 10 } } : { display: false },
    },
  },
})

const doughnutOpts = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '68%',
  plugins: {
    legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 10 }, padding: 12 } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
    },
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysSince(dateStr) {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function daysInService(issueDateStr) {
  if (!issueDateStr) return null
  return Math.floor((Date.now() - new Date(issueDateStr).getTime()) / 86400000)
}

function scoreColor(pct) {
  if (pct >= 80) return { text: 'text-green-400', bg: 'bg-green-900/20', border: 'border-green-700/40', hex: '#22c55e', ring: 'ring-green-500/30' }
  if (pct >= 60) return { text: 'text-orange-400', bg: 'bg-orange-900/20', border: 'border-orange-700/40', hex: '#f97316', ring: 'ring-orange-500/30' }
  return { text: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-700/40', hex: '#ef4444', ring: 'ring-red-500/30' }
}

function inspectionStatus(daysSinceInspection) {
  if (daysSinceInspection === null) return 'no_data'
  if (daysSinceInspection <= INSPECTION_MAX_DAYS) return 'compliant'
  if (daysSinceInspection <= INSPECTION_DUE_DAYS) return 'due_soon'
  return 'overdue'
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Select({ value, onChange, options, placeholder, className = '' }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500 ${className}`}
    >
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? o}
        </option>
      ))}
    </select>
  )
}

function KpiCard({ title, value, sub, icon: Icon, color, alert }) {
  const styles = {
    green:  { border: 'border-green-700/40 bg-green-950/20', icon: 'text-green-400', val: 'text-green-400' },
    red:    { border: 'border-red-700/40 bg-red-950/20',     icon: 'text-red-400',   val: 'text-red-400'   },
    orange: { border: 'border-orange-700/40 bg-orange-950/20', icon: 'text-orange-400', val: 'text-orange-400' },
    amber:  { border: 'border-amber-700/40 bg-amber-950/20', icon: 'text-amber-400', val: 'text-amber-400' },
    blue:   { border: 'border-blue-700/40 bg-blue-950/20',   icon: 'text-blue-400',  val: 'text-blue-300'  },
    purple: { border: 'border-purple-700/40 bg-purple-950/20', icon: 'text-purple-400', val: 'text-purple-300' },
  }
  const s = styles[color] ?? { border: 'border-gray-700/40 bg-gray-900/40', icon: 'text-gray-400', val: 'text-white' }
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${s.border}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} className={s.icon} />
          <span className="text-xs text-gray-400 font-medium">{title}</span>
        </div>
        {alert && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 font-bold animate-pulse">
            ALERT
          </span>
        )}
      </div>
      <p className={`text-2xl font-bold leading-tight ${s.val}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  )
}

function InspectionBadge({ status }) {
  const map = {
    compliant: 'bg-green-500/20 text-green-300 border border-green-500/40',
    due_soon:  'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
    overdue:   'bg-red-500/20 text-red-300 border border-red-500/40',
    no_data:   'bg-gray-800 text-gray-400',
  }
  const label = { compliant: 'Compliant', due_soon: 'Due Soon', overdue: 'Overdue', no_data: 'No Data' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? map.no_data}`}>
      {label[status] ?? status}
    </span>
  )
}

function RiskBadge({ risk }) {
  const map = {
    Critical: 'bg-red-500/20 text-red-300 border border-red-500/40',
    High:     'bg-orange-500/20 text-orange-300 border border-orange-500/40',
    Medium:   'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
    Low:      'bg-green-500/20 text-green-300 border border-green-500/40',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[risk] ?? 'bg-gray-800 text-gray-400'}`}>
      {risk || 'Unknown'}
    </span>
  )
}

// ── Compliance Score Gauge ─────────────────────────────────────────────────────
function ComplianceGauge({ score, trend }) {
  const c = scoreColor(score)
  const circumference = 2 * Math.PI * 52
  const dash = (score / 100) * circumference
  return (
    <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
      <svg width={140} height={140} viewBox="0 0 140 140">
        <circle cx={70} cy={70} r={52} fill="none" stroke="#1f2937" strokeWidth={10} />
        <circle
          cx={70} cy={70} r={52}
          fill="none"
          stroke={c.hex}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          strokeDashoffset={circumference * 0.25}
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-3xl font-black ${c.text}`}>{score}%</span>
        {trend !== null && (
          <span className={`text-xs flex items-center gap-0.5 mt-0.5 ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  )
}

// ── Tab button ────────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, icon: Icon, label, count, countColor }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
        active
          ? 'bg-green-900/40 text-green-300 border border-green-700/50'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
      }`}
    >
      <Icon size={13} />
      {label}
      {count !== undefined && (
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
          countColor ?? 'bg-gray-700 text-gray-300'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ComplianceDashboard() {
  const { profile } = useAuth()
  const { activeCurrency, activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  // Data
  const [tyreRecords, setTyreRecords]   = useState([])
  const [inspections, setInspections]   = useState([])
  const [fleetMaster, setFleetMaster]   = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [lastRefresh, setLastRefresh]   = useState(null)

  // Filters
  const [siteFilter, setSiteFilter]       = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [activeTab, setActiveTab]         = useState('tread')

  // Table pagination/search
  const [treadPage, setTreadPage]         = useState(1)
  const [pressurePage, setPressurePage]   = useState(1)
  const [inspPage, setInspPage]           = useState(1)
  const [treadSearch, setTreadSearch]     = useState('')
  const [pressureSearch, setPressureSearch] = useState('')
  const [inspSearch, setInspSearch]       = useState('')
  const PAGE_SIZE = 25

  // Modals
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailTo, setEmailTo]             = useState('')
  const [emailSent, setEmailSent]         = useState(false)

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [{ data: tr }, { data: ins }, { data: fm }] = await Promise.all([
        fetchAllPages((from, to) => supabase
          .from('tyre_records')
          .select('id,asset_no,serial_number,brand,size,position,site,country,tread_depth,pressure_reading,risk_level,issue_date,removal_date,category')
          .order('issue_date', { ascending: false })
          .range(from, to)),
        fetchAllPages((from, to) => supabase
          .from('inspections')
          .select('id,asset_no,site,scheduled_date,status,inspection_type,findings,inspector')
          .order('scheduled_date', { ascending: false })
          .range(from, to)),
        supabase
          .from('fleet_master')
          .select('asset_no,site,vehicle_type,status'),
      ])
      setTyreRecords(tr || [])
      setInspections(ins || [])
      setFleetMaster(fm || [])
      setLastRefresh(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Filter options ──────────────────────────────────────────────────────────
  const sites = useMemo(() => {
    const s = new Set([
      ...tyreRecords.map(r => r.site),
      ...inspections.map(r => r.site),
    ].filter(Boolean))
    return [...s].sort()
  }, [tyreRecords, inspections])

  const countries = useMemo(() =>
    [...new Set(tyreRecords.map(r => r.country).filter(Boolean))].sort()
  , [tyreRecords])

  // ── Apply global filters ────────────────────────────────────────────────────
  const filteredTyres = useMemo(() => {
    let d = [...tyreRecords]
    if (activeCountry !== 'All') d = d.filter(r => r.country === activeCountry)
    if (countryFilter) d = d.filter(r => r.country === countryFilter)
    if (siteFilter)    d = d.filter(r => r.site === siteFilter)
    return d
  }, [tyreRecords, activeCountry, countryFilter, siteFilter])

  const filteredInspections = useMemo(() => {
    let d = [...inspections]
    if (siteFilter) d = d.filter(r => r.site === siteFilter)
    return d
  }, [inspections, siteFilter])

  // ── Tread compliance ────────────────────────────────────────────────────────
  const treadStats = useMemo(() => {
    const total     = filteredTyres.length
    const withData  = filteredTyres.filter(r => r.tread_depth != null)
    const compliant = withData.filter(r => Number(r.tread_depth) >= FLEET_MIN_TREAD)
    const legal     = withData.filter(r => Number(r.tread_depth) >= LEGAL_MIN_TREAD)
    const legalFail = withData.filter(r => Number(r.tread_depth) < LEGAL_MIN_TREAD)
    const fleetFail = withData.filter(r => Number(r.tread_depth) < FLEET_MIN_TREAD)
    const noData    = filteredTyres.filter(r => r.tread_depth == null)
    const pct = withData.length > 0 ? (compliant.length / withData.length) * 100 : 0
    return { total, withData: withData.length, compliant: compliant.length, pct, legalFail, fleetFail, noData: noData.length }
  }, [filteredTyres])

  // ── Pressure compliance ─────────────────────────────────────────────────────
  const pressureStats = useMemo(() => {
    const total       = filteredTyres.length
    const withReading = filteredTyres.filter(r => r.pressure_reading != null && Number(r.pressure_reading) > 0)
    const noReading   = filteredTyres.filter(r => !r.pressure_reading || Number(r.pressure_reading) === 0)
    // Without a nominal value per tyre, flag any reading outside a general band 85-130 PSI as anomaly
    const compliant   = withReading.filter(r => {
      const v = Number(r.pressure_reading)
      return v >= 85 && v <= 130
    })
    const anomalies   = withReading.filter(r => {
      const v = Number(r.pressure_reading)
      return v < 85 || v > 130
    })
    const pct = withReading.length > 0 ? (compliant.length / withReading.length) * 100 : 0
    return { total, withReading: withReading.length, noReading: noReading.length, compliant: compliant.length, anomalies: anomalies.length, pct }
  }, [filteredTyres])

  // ── Inspection compliance ───────────────────────────────────────────────────
  const inspectionStats = useMemo(() => {
    // Build per-asset latest inspection map
    const latestByAsset = {}
    filteredInspections.forEach(ins => {
      if (!ins.asset_no) return
      const existing = latestByAsset[ins.asset_no]
      if (!existing || (ins.scheduled_date || '') > (existing.scheduled_date || '')) {
        latestByAsset[ins.asset_no] = ins
      }
    })

    // Cross-reference fleet
    const allAssets = [...new Set([
      ...fleetMaster.filter(v => !siteFilter || v.site === siteFilter).map(v => v.asset_no),
      ...Object.keys(latestByAsset),
    ])]

    const rows = allAssets.map(asset_no => {
      const ins   = latestByAsset[asset_no]
      const fm    = fleetMaster.find(v => v.asset_no === asset_no) || {}
      const days  = ins ? daysSince(ins.scheduled_date) : null
      const status = inspectionStatus(days)
      return {
        asset_no,
        vehicle_type:   fm.vehicle_type || '-',
        site:           ins?.site || fm.site || '-',
        last_inspection: ins?.scheduled_date || null,
        days_since:     days,
        next_due:       ins?.scheduled_date
          ? new Date(new Date(ins.scheduled_date).getTime() + INSPECTION_MAX_DAYS * 86400000).toISOString().slice(0, 10)
          : null,
        status,
        inspector:      ins?.inspector || '-',
        inspection_type: ins?.inspection_type || '-',
      }
    })

    const compliant = rows.filter(r => r.status === 'compliant').length
    const dueSoon   = rows.filter(r => r.status === 'due_soon').length
    const overdue   = rows.filter(r => r.status === 'overdue').length
    const noData    = rows.filter(r => r.status === 'no_data').length
    const pct       = rows.length > 0 ? (compliant / rows.length) * 100 : 0

    return { rows, compliant, dueSoon, overdue, noData, pct, total: rows.length }
  }, [filteredInspections, fleetMaster, siteFilter])

  // ── Critical count ──────────────────────────────────────────────────────────
  const criticalCount = useMemo(() =>
    filteredTyres.filter(r => (r.risk_level || '').toLowerCase() === 'critical').length
  , [filteredTyres])

  const fullyCompliantVehicles = useMemo(() => {
    const compliantAssets = new Set(
      filteredTyres
        .filter(r => r.tread_depth != null && Number(r.tread_depth) >= FLEET_MIN_TREAD && r.risk_level?.toLowerCase() !== 'critical')
        .map(r => r.asset_no)
    )
    const nonCompliantAssets = new Set(
      filteredTyres
        .filter(r => (r.tread_depth != null && Number(r.tread_depth) < FLEET_MIN_TREAD) || r.risk_level?.toLowerCase() === 'critical')
        .map(r => r.asset_no)
    )
    return [...compliantAssets].filter(a => !nonCompliantAssets.has(a)).length
  }, [filteredTyres])

  // ── Overall compliance score (weighted) ─────────────────────────────────────
  const overallScore = useMemo(() => {
    const treadW   = 0.40
    const pressureW = 0.30
    const inspW    = 0.30
    const score =
      treadStats.pct    * treadW +
      pressureStats.pct * pressureW +
      inspectionStats.pct * inspW
    return Math.round(score)
  }, [treadStats, pressureStats, inspectionStats])

  // ── Trend (compare current vs hypothetical last-month by slicing older records) ──
  const complianceTrend = useMemo(() => {
    // Use last 6 months monthly compliance percentages from tread data as proxy
    const now    = new Date()
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const byMonth = months.map(m => {
      const monthTyres = tyreRecords.filter(r => (r.issue_date || '').startsWith(m))
      if (monthTyres.length === 0) return null
      const withData   = monthTyres.filter(r => r.tread_depth != null)
      if (withData.length === 0) return null
      const compliant  = withData.filter(r => Number(r.tread_depth) >= FLEET_MIN_TREAD)
      return (compliant.length / withData.length) * 100
    })
    const current  = byMonth[byMonth.length - 1]
    const previous = byMonth[byMonth.length - 2]
    const trend    = (current != null && previous != null) ? current - previous : null
    return { months, values: byMonth, trend }
  }, [tyreRecords])

  // ── Tread distribution chart ────────────────────────────────────────────────
  const treadDistChart = useMemo(() => {
    const bands = [
      { label: '0-2mm',  min: 0,  max: 2,  color: 'rgba(239,68,68,0.85)' },
      { label: '2-4mm',  min: 2,  max: 4,  color: 'rgba(249,115,22,0.8)' },
      { label: '4-6mm',  min: 4,  max: 6,  color: 'rgba(234,179,8,0.8)' },
      { label: '6-8mm',  min: 6,  max: 8,  color: 'rgba(34,197,94,0.8)' },
      { label: '8mm+',   min: 8,  max: Infinity, color: 'rgba(34,197,94,0.95)' },
    ]
    const counts = bands.map(b =>
      filteredTyres.filter(r => {
        const v = Number(r.tread_depth)
        return r.tread_depth != null && v >= b.min && v < b.max
      }).length
    )
    return {
      labels: bands.map(b => b.label),
      datasets: [{
        label: 'Tyres',
        data: counts,
        backgroundColor: bands.map(b => b.color),
        borderColor: bands.map(b => b.color.replace(/[\d.]+\)$/, '1)')),
        borderWidth: 1,
        borderRadius: 4,
      }],
    }
  }, [filteredTyres])

  // ── Tread compliance by site chart ──────────────────────────────────────────
  const treadBySite = useMemo(() => {
    const map = {}
    filteredTyres.forEach(r => {
      if (!r.site || r.tread_depth == null) return
      if (!map[r.site]) map[r.site] = { ok: 0, total: 0 }
      map[r.site].total++
      if (Number(r.tread_depth) >= FLEET_MIN_TREAD) map[r.site].ok++
    })
    return Object.entries(map)
      .map(([site, v]) => ({ site, pct: v.total > 0 ? (v.ok / v.total * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct)
  }, [filteredTyres])

  const treadBySiteChart = useMemo(() => {
    const colors = treadBySite.map(s =>
      s.pct >= 90 ? 'rgba(34,197,94,0.75)' :
      s.pct >= 75 ? 'rgba(234,179,8,0.75)' :
      s.pct >= 60 ? 'rgba(249,115,22,0.75)' :
      'rgba(239,68,68,0.75)'
    )
    return {
      labels: treadBySite.map(s => s.site),
      datasets: [{
        label: 'Tread Compliance %',
        data: treadBySite.map(s => s.pct.toFixed(1)),
        backgroundColor: colors,
        borderColor: colors.map(c => c.replace(/0\.75/, '1')),
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [treadBySite])

  // ── Pressure doughnut ────────────────────────────────────────────────────────
  const pressureDoughnutData = useMemo(() => ({
    labels: ['Compliant', 'Non-Compliant', 'No Reading'],
    datasets: [{
      data: [pressureStats.compliant, pressureStats.anomalies, pressureStats.noReading],
      backgroundColor: ['rgba(34,197,94,0.75)', 'rgba(239,68,68,0.75)', 'rgba(107,114,128,0.6)'],
      borderColor: ['rgba(34,197,94,1)', 'rgba(239,68,68,1)', 'rgba(107,114,128,1)'],
      borderWidth: 1,
    }],
  }), [pressureStats])

  // ── Pressure by site chart ───────────────────────────────────────────────────
  const pressureBySite = useMemo(() => {
    const map = {}
    filteredTyres.forEach(r => {
      if (!r.site) return
      if (!map[r.site]) map[r.site] = { ok: 0, total: 0 }
      map[r.site].total++
      const v = Number(r.pressure_reading)
      if (v >= 85 && v <= 130) map[r.site].ok++
    })
    return Object.entries(map)
      .filter(([, v]) => v.total > 0)
      .map(([site, v]) => ({ site, pct: (v.ok / v.total * 100) }))
      .sort((a, b) => b.pct - a.pct)
  }, [filteredTyres])

  const pressureBySiteChart = useMemo(() => {
    const colors = pressureBySite.map(s =>
      s.pct >= 90 ? 'rgba(34,197,94,0.75)' :
      s.pct >= 75 ? 'rgba(234,179,8,0.75)' :
      'rgba(239,68,68,0.75)'
    )
    return {
      labels: pressureBySite.map(s => s.site),
      datasets: [{
        label: 'Pressure Compliance %',
        data: pressureBySite.map(s => s.pct.toFixed(1)),
        backgroundColor: colors,
        borderColor: colors.map(c => c.replace(/0\.75/, '1')),
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [pressureBySite])

  // ── Inspection by site chart ─────────────────────────────────────────────────
  const inspBySite = useMemo(() => {
    const map = {}
    inspectionStats.rows.forEach(r => {
      if (!r.site || r.site === '-') return
      if (!map[r.site]) map[r.site] = { compliant: 0, overdue: 0, due_soon: 0, no_data: 0 }
      map[r.site][r.status] = (map[r.site][r.status] || 0) + 1
    })
    return Object.entries(map).map(([site, v]) => ({ site, ...v }))
  }, [inspectionStats])

  const inspBySiteChart = useMemo(() => ({
    labels: inspBySite.map(s => s.site),
    datasets: [
      {
        label: 'Compliant',
        data: inspBySite.map(s => s.compliant || 0),
        backgroundColor: 'rgba(34,197,94,0.75)',
        borderColor: 'rgba(34,197,94,1)',
        borderWidth: 1,
        borderRadius: 3,
      },
      {
        label: 'Due Soon',
        data: inspBySite.map(s => s.due_soon || 0),
        backgroundColor: 'rgba(234,179,8,0.75)',
        borderColor: 'rgba(234,179,8,1)',
        borderWidth: 1,
        borderRadius: 3,
      },
      {
        label: 'Overdue',
        data: inspBySite.map(s => s.overdue || 0),
        backgroundColor: 'rgba(239,68,68,0.75)',
        borderColor: 'rgba(239,68,68,1)',
        borderWidth: 1,
        borderRadius: 3,
      },
    ],
  }), [inspBySite])

  // ── Trend line chart ─────────────────────────────────────────────────────────
  const trendLineChart = useMemo(() => {
    const { months, values } = complianceTrend
    const labels = months.map(m => {
      const [y, mo] = m.split('-')
      return new Date(y, Number(mo) - 1).toLocaleString('en', { month: 'short', year: '2-digit' })
    })
    return {
      labels,
      datasets: [{
        label: 'Tread Compliance %',
        data: values,
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.1)',
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: '#22c55e',
        tension: 0.3,
        fill: true,
        spanGaps: true,
      }],
    }
  }, [complianceTrend])

  const trendLineOpts = useMemo(() => ({
    ...chartOpts(false, '', 'Compliance %'),
    plugins: {
      legend: { labels: { color: '#9ca3af', font: { size: 10 } } },
      tooltip: {
        backgroundColor: 'var(--panel)',
        titleColor: '#f9fafb',
        bodyColor: '#d1d5db',
        borderColor: 'var(--hairline)',
        borderWidth: 1,
        callbacks: { label: ctx => ` ${ctx.parsed.y !== null ? ctx.parsed.y.toFixed(1) : 'N/A'}%` },
      },
    },
    scales: {
      ...chartOpts().scales,
      y: {
        min: 0, max: 100,
        grid: { color: 'rgba(31,41,55,0.8)' },
        ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => `${v}%` },
      },
    },
  }), [])

  // ── Non-compliant tread table ────────────────────────────────────────────────
  const nonCompliantTyres = useMemo(() => {
    let rows = filteredTyres.filter(r => r.tread_depth == null || Number(r.tread_depth) < FLEET_MIN_TREAD)
    if (treadSearch) {
      const q = treadSearch.toLowerCase()
      rows = rows.filter(r =>
        (r.asset_no || '').toLowerCase().includes(q) ||
        (r.serial_number || '').toLowerCase().includes(q) ||
        (r.site || '').toLowerCase().includes(q) ||
        (r.brand || '').toLowerCase().includes(q)
      )
    }
    return rows.sort((a, b) => {
      const av = a.tread_depth != null ? Number(a.tread_depth) : -1
      const bv = b.tread_depth != null ? Number(b.tread_depth) : -1
      return av - bv
    })
  }, [filteredTyres, treadSearch])

  const treadPageCount = Math.max(1, Math.ceil(nonCompliantTyres.length / PAGE_SIZE))
  const treadPageRows  = nonCompliantTyres.slice((treadPage - 1) * PAGE_SIZE, treadPage * PAGE_SIZE)

  // ── Pressure anomaly table ───────────────────────────────────────────────────
  const pressureAnomalies = useMemo(() => {
    let rows = filteredTyres.map(r => {
      const v = Number(r.pressure_reading)
      let flag = 'No Data'
      if (r.pressure_reading != null && v > 0) {
        flag = (v < 85 || v > 130) ? 'Anomaly' : 'OK'
      }
      return { ...r, pressureFlag: flag }
    }).filter(r => r.pressureFlag !== 'OK')

    if (pressureSearch) {
      const q = pressureSearch.toLowerCase()
      rows = rows.filter(r =>
        (r.asset_no || '').toLowerCase().includes(q) ||
        (r.serial_number || '').toLowerCase().includes(q) ||
        (r.site || '').toLowerCase().includes(q)
      )
    }
    return rows.sort((a, b) => {
      if (a.pressureFlag === 'Anomaly' && b.pressureFlag !== 'Anomaly') return -1
      if (b.pressureFlag === 'Anomaly' && a.pressureFlag !== 'Anomaly') return 1
      return 0
    })
  }, [filteredTyres, pressureSearch])

  const pressurePageCount = Math.max(1, Math.ceil(pressureAnomalies.length / PAGE_SIZE))
  const pressurePageRows  = pressureAnomalies.slice((pressurePage - 1) * PAGE_SIZE, pressurePage * PAGE_SIZE)

  // ── Inspection table ─────────────────────────────────────────────────────────
  const inspectionRows = useMemo(() => {
    let rows = [...inspectionStats.rows]
    if (inspSearch) {
      const q = inspSearch.toLowerCase()
      rows = rows.filter(r =>
        (r.asset_no || '').toLowerCase().includes(q) ||
        (r.site || '').toLowerCase().includes(q) ||
        (r.vehicle_type || '').toLowerCase().includes(q) ||
        (r.inspector || '').toLowerCase().includes(q)
      )
    }
    return rows.sort((a, b) => {
      const rank = { overdue: 0, due_soon: 1, no_data: 2, compliant: 3 }
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
    })
  }, [inspectionStats, inspSearch])

  const inspPageCount = Math.max(1, Math.ceil(inspectionRows.length / PAGE_SIZE))
  const inspPageRows  = inspectionRows.slice((inspPage - 1) * PAGE_SIZE, inspPage * PAGE_SIZE)

  const overdueCount = inspectionStats.rows.filter(r => r.status === 'overdue').length

  // ── PDF: Tread Compliance Report ─────────────────────────────────────────────
  async function exportTreadPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)

    pdfHeader(doc, 'Tread Depth Compliance Report', `Fleet Min: ${FLEET_MIN_TREAD}mm · Legal Min: ${LEGAL_MIN_TREAD}mm`, company, brand)

    doc.setFontSize(11)
    doc.setTextColor(40, 40, 40)
    doc.text('Compliance Summary', 14, 30)
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 33,
      head: [['Metric', 'Value']],
      body: [
        ['Overall Compliance %', `${treadStats.pct.toFixed(1)}%`],
        ['Total Tyres', String(treadStats.total)],
        ['Tyres With Data', String(treadStats.withData)],
        ['Fleet-Compliant (≥3mm)', String(treadStats.compliant)],
        ['Below Fleet Min (<3mm)', String(treadStats.fleetFail.length)],
        ['Below Legal Min (<1.6mm)', String(treadStats.legalFail.length)],
        ['No Tread Data', String(treadStats.noData)],
      ],
      columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 50 } },
    })

    doc.addPage()
    pdfHeader(doc, 'Non-Compliant Tyre List', `Fleet Min: ${FLEET_MIN_TREAD}mm · Legal Min: ${LEGAL_MIN_TREAD}mm`, company, brand)
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 28,
      head: [['Asset', 'Serial', 'Brand', 'Position', 'Tread (mm)', 'Site', 'Days In Service', 'Risk', 'Status']],
      body: nonCompliantTyres.slice(0, 200).map(r => [
        r.asset_no || '-',
        r.serial_number || '-',
        r.brand || '-',
        r.position || '-',
        r.tread_depth != null ? `${Number(r.tread_depth).toFixed(1)}` : 'No Data',
        r.site || '-',
        r.issue_date ? String(daysInService(r.issue_date)) : '-',
        r.risk_level || '-',
        r.tread_depth != null && Number(r.tread_depth) < LEGAL_MIN_TREAD ? 'LEGAL FAILURE' : 'Below Fleet Min',
      ]),
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 8) {
          if ((data.cell.raw || '').includes('LEGAL')) {
            data.cell.styles.textColor = [220, 38, 38]
            data.cell.styles.fontStyle = 'bold'
          }
        }
      },
    })

    const pgCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pgCount; i++) { doc.setPage(i); pdfFooter(doc, i, pgCount, company, brand) }
    doc.save(`tread_compliance_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  // ── PDF: Full Compliance Certificate ────────────────────────────────────────
  async function exportCertificatePdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const W = doc.internal.pageSize.width
    const H = doc.internal.pageSize.height
    const now = new Date()
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })

    // Cover header
    pdfHeader(doc, 'Fleet Tyre Compliance Certificate', `Issued: ${dateStr} · Reference: TPC-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, company, brand)

    // Score block
    const scoreCol = scoreColor(overallScore)
    doc.setFillColor(17, 24, 39)
    doc.roundedRect(14, 42, 80, 30, 3, 3, 'F')
    doc.setFontSize(28)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(34, 197, 94)
    doc.text(`${overallScore}%`, 54, 60, { align: 'center' })
    doc.setFontSize(9)
    doc.setTextColor(156, 163, 175)
    doc.text('Overall Compliance Score', 54, 68, { align: 'center' })

    // Compliance areas summary
    doc.setFontSize(11)
    doc.setTextColor(40, 40, 40)
    doc.text('Compliance Area Summary', 14, 82)
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 85,
      head: [['Area', 'Score', 'Status', 'Details']],
      body: [
        ['Tread Depth', `${treadStats.pct.toFixed(1)}%`,
          treadStats.pct >= 80 ? 'COMPLIANT' : 'NON-COMPLIANT',
          `${treadStats.compliant}/${treadStats.withData} tyres ≥ ${FLEET_MIN_TREAD}mm fleet minimum`],
        ['Pressure', `${pressureStats.pct.toFixed(1)}%`,
          pressureStats.pct >= 80 ? 'COMPLIANT' : 'NON-COMPLIANT',
          `${pressureStats.compliant} compliant, ${pressureStats.anomalies} anomalies, ${pressureStats.noReading} no data`],
        ['Inspection Schedule', `${inspectionStats.pct.toFixed(1)}%`,
          inspectionStats.pct >= 80 ? 'COMPLIANT' : 'NON-COMPLIANT',
          `${inspectionStats.compliant} vehicles ≤ ${INSPECTION_MAX_DAYS} days since inspection`],
        ['Critical Risk Tyres', criticalCount === 0 ? '100%' : '0%',
          criticalCount === 0 ? 'PASS' : 'FAIL',
          criticalCount === 0 ? 'No critical risk tyres on fleet' : `${criticalCount} critical risk tyres require immediate action`],
      ],
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 2) {
          if ((data.cell.raw || '').includes('NON-COMPLIANT') || (data.cell.raw || '').includes('FAIL')) {
            data.cell.styles.textColor = [220, 38, 38]
            data.cell.styles.fontStyle = 'bold'
          } else {
            data.cell.styles.textColor = [22, 163, 74]
            data.cell.styles.fontStyle = 'bold'
          }
        }
      },
    })

    // Legal minimum violations
    const legalFailures = nonCompliantTyres.filter(r => r.tread_depth != null && Number(r.tread_depth) < LEGAL_MIN_TREAD)
    if (legalFailures.length > 0) {
      doc.addPage()
      doc.setFillColor(220, 38, 38)
      doc.rect(0, 0, W, 16, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text(`LEGAL COMPLIANCE FAILURES - ${legalFailures.length} Tyre(s) Below ${LEGAL_MIN_TREAD}mm`, 14, 10)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 20,
        head: [['Asset', 'Serial', 'Brand', 'Position', 'Tread (mm)', 'Site', 'Risk Level']],
        body: legalFailures.slice(0, 100).map(r => [
          r.asset_no || '-',
          r.serial_number || '-',
          r.brand || '-',
          r.position || '-',
          Number(r.tread_depth).toFixed(1),
          r.site || '-',
          r.risk_level || '-',
        ]),
        headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 8, textColor: [220, 38, 38] },
      })
    }

    // Signature page
    doc.addPage()
    doc.setFillColor(22, 101, 52)
    doc.rect(0, 0, W, 16, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('Certificate Declaration', 14, 10)

    doc.setTextColor(40, 40, 40)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    const declaration = [
      `This compliance certificate confirms that the fleet tyre compliance assessment was performed on ${dateStr}.`,
      `The assessment covers tread depth compliance against the ${FLEET_MIN_TREAD}mm fleet minimum standard and the`,
      `${LEGAL_MIN_TREAD}mm legal minimum, tyre pressure verification, and inspection schedule adherence.`,
      '',
      `Overall Fleet Compliance Score: ${overallScore}% | Total Tyres Assessed: ${treadStats.total}`,
      `Tread Compliance: ${treadStats.pct.toFixed(1)}% | Pressure Compliance: ${pressureStats.pct.toFixed(1)}% | Inspection Compliance: ${inspectionStats.pct.toFixed(1)}%`,
    ]
    declaration.forEach((line, i) => {
      doc.text(line, 14, 28 + i * 7)
    })

    // Signature line
    doc.setDrawColor(100, 100, 100)
    doc.line(14, H - 30, 100, H - 30)
    doc.line(W - 100, H - 30, W - 14, H - 30)
    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text('Prepared by TyrePulse Fleet Management System', 14, H - 24)
    doc.text('Authorised Signature', W - 100, H - 24)
    doc.setFontSize(7)
    doc.text(`Generated: ${now.toLocaleString('en-GB')}`, 14, H - 18)
    doc.text(`Report ID: TPC-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.floor(Math.random() * 9000 + 1000)}`, W - 14, H - 18, { align: 'right' })

    const pgCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pgCount; i++) { doc.setPage(i); pdfFooter(doc, i, pgCount, company, brand) }
    doc.save(`compliance_certificate_${now.toISOString().slice(0, 10)}.pdf`)
  }

  // ── Excel export ─────────────────────────────────────────────────────────────
  async function exportExcel() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    // Summary sheet
    const summaryRows = [
      { 'Metric': 'Overall Compliance Score', 'Value': `${overallScore}%` },
      { 'Metric': 'Tread Compliance', 'Value': `${treadStats.pct.toFixed(1)}%` },
      { 'Metric': 'Pressure Compliance', 'Value': `${pressureStats.pct.toFixed(1)}%` },
      { 'Metric': 'Inspection Compliance', 'Value': `${inspectionStats.pct.toFixed(1)}%` },
      { 'Metric': 'Critical Tyres', 'Value': String(criticalCount) },
      { 'Metric': 'Fully Compliant Vehicles', 'Value': String(fullyCompliantVehicles) },
      { 'Metric': 'Legal Failures (<1.6mm)', 'Value': String(treadStats.legalFail.length) },
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary')

    // Non-compliant tyres
    const treadRows = nonCompliantTyres.map(r => ({
      'Asset No':       r.asset_no || '',
      'Serial':         r.serial_number || '',
      'Brand':          r.brand || '',
      'Size':           r.size || '',
      'Position':       r.position || '',
      'Tread Depth mm': r.tread_depth != null ? Number(r.tread_depth).toFixed(1) : 'No Data',
      'Site':           r.site || '',
      'Country':        r.country || '',
      'Days in Service': r.issue_date ? daysInService(r.issue_date) : '',
      'Risk Level':     r.risk_level || '',
      'Status':         r.tread_depth != null && Number(r.tread_depth) < LEGAL_MIN_TREAD ? 'LEGAL FAILURE' : 'Below Fleet Min',
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(treadRows), 'Tread Non-Compliant')

    // Inspection schedule
    const inspRows = inspectionStats.rows.map(r => ({
      'Asset No':       r.asset_no,
      'Vehicle Type':   r.vehicle_type,
      'Site':           r.site,
      'Last Inspection': r.last_inspection || 'Never',
      'Days Since':     r.days_since ?? 'N/A',
      'Next Due':       r.next_due || 'N/A',
      'Status':         r.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      'Inspector':      r.inspector,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inspRows), 'Inspection Schedule')

    XLSX.writeFile(wb, `compliance_dashboard_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const hasFilter = siteFilter || countryFilter
  const c = scoreColor(overallScore)

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      <PageHeader
        title="Compliance Dashboard"
        subtitle={`Legal & safety compliance - tread depth, pressure, inspection schedules & audit certificates${lastRefresh ? ` · Last refresh: ${lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`}
        icon={ShieldCheck}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 text-xs hover:bg-gray-700 transition-colors"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              onClick={() => setShowEmailModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900/40 border border-blue-700/50 text-blue-300 text-xs hover:bg-blue-900/60 transition-colors"
            >
              <Mail size={12} /> Share Report
            </button>
            <button
              onClick={exportExcel}
              disabled={loading || !tyreRecords.length}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-900/40 border border-green-700/50 text-green-300 text-xs hover:bg-green-900/60 transition-colors disabled:opacity-40"
            >
              <Download size={12} /> Excel
            </button>
            <button
              onClick={exportCertificatePdf}
              disabled={loading || !tyreRecords.length}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900/40 border border-amber-700/50 text-amber-300 text-xs hover:bg-amber-900/60 transition-colors disabled:opacity-40"
            >
              <Award size={12} /> Export Certificate
            </button>
          </div>
        }
      />

      {/* ── Filters ── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={13} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-400">Filters</span>
          {hasFilter && (
            <button
              onClick={() => { setSiteFilter(''); setCountryFilter('') }}
              className="ml-auto flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Select value={siteFilter} onChange={setSiteFilter} options={sites} placeholder="All Sites" />
          <Select value={countryFilter} onChange={setCountryFilter} options={countries} placeholder="All Countries" />
          <div className="flex items-center gap-2 col-span-2 bg-gray-800/50 rounded-lg px-3 py-2">
            <Info size={12} className="text-gray-500 shrink-0" />
            <span className="text-xs text-gray-500">
              Fleet standard: ≥{FLEET_MIN_TREAD}mm tread | Legal min: {LEGAL_MIN_TREAD}mm | Inspection: every {INSPECTION_MAX_DAYS} days
            </span>
          </div>
        </div>
      </div>

      {/* ── Loading / Error ── */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <RefreshCw size={22} className="text-green-400 animate-spin mr-2" />
          <span className="text-gray-400 text-sm">Loading compliance data...</span>
        </div>
      )}
      {error && (
        <div className="bg-red-950/30 border border-red-700/40 rounded-xl p-4 flex items-center gap-3">
          <XCircle size={16} className="text-red-400" />
          <p className="text-sm text-red-300">{error}</p>
          <button onClick={fetchData} className="ml-auto text-xs text-red-400 hover:text-red-300">Retry</button>
        </div>
      )}

      {!loading && !error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">

          {/* ── Compliance Score + Trend Header Card ── */}
          <div className={`rounded-xl border p-5 ${c.border} ${c.bg}`}>
            <div className="flex flex-col lg:flex-row gap-6 items-center lg:items-start">

              {/* Gauge */}
              <div className="flex flex-col items-center gap-2 shrink-0">
                <ComplianceGauge score={overallScore} trend={complianceTrend.trend} />
                <div className={`text-xs font-bold px-3 py-1 rounded-full ${c.bg} ${c.border} border ${c.text}`}>
                  {overallScore >= 80 ? 'COMPLIANT' : overallScore >= 60 ? 'MARGINAL' : 'NON-COMPLIANT'}
                </div>
              </div>

              {/* Score breakdown */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                {[
                  { label: 'Tread Depth', pct: treadStats.pct, weight: '40%', icon: Gauge },
                  { label: 'Pressure',    pct: pressureStats.pct, weight: '30%', icon: AlertCircle },
                  { label: 'Inspection',  pct: inspectionStats.pct, weight: '30%', icon: ClipboardList },
                ].map(({ label, pct, weight, icon: Icon }) => {
                  const col = scoreColor(pct)
                  return (
                    <div key={label} className="bg-gray-900/60 rounded-xl p-4 border border-gray-700/40">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon size={13} className={col.text} />
                        <span className="text-xs text-gray-400">{label}</span>
                        <span className="ml-auto text-xs text-gray-600">Weight: {weight}</span>
                      </div>
                      <p className={`text-2xl font-black ${col.text}`}>{pct.toFixed(1)}%</p>
                      <div className="mt-2 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, backgroundColor: col.hex }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Last audit info + trend */}
              <div className="shrink-0 flex flex-col gap-3 min-w-[180px]">
                <div className="bg-gray-900/60 rounded-xl p-3 border border-gray-700/40">
                  <p className="text-xs text-gray-500 mb-1">Last Audit</p>
                  <p className="text-sm font-semibold text-white">
                    {lastRefresh ? lastRefresh.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                  </p>
                </div>
                <div className="bg-gray-900/60 rounded-xl p-3 border border-gray-700/40">
                  <p className="text-xs text-gray-500 mb-1">Critical Alerts</p>
                  <p className={`text-sm font-semibold ${criticalCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {criticalCount > 0 ? `${criticalCount} Critical` : 'None Active'}
                  </p>
                </div>
                <div className="bg-gray-900/60 rounded-xl p-3 border border-gray-700/40">
                  <p className="text-xs text-gray-500 mb-1">Overdue Inspections</p>
                  <p className={`text-sm font-semibold ${overdueCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {overdueCount > 0 ? `${overdueCount} Overdue` : 'All Current'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard
              title="Tread Compliance"
              value={`${treadStats.pct.toFixed(1)}%`}
              sub={`${treadStats.compliant}/${treadStats.withData} tyres ≥ ${FLEET_MIN_TREAD}mm`}
              icon={Gauge}
              color={treadStats.pct >= 80 ? 'green' : treadStats.pct >= 60 ? 'amber' : 'red'}
            />
            <KpiCard
              title="Pressure Compliance"
              value={`${pressureStats.pct.toFixed(1)}%`}
              sub={`${pressureStats.noReading} tyres with no data`}
              icon={AlertCircle}
              color={pressureStats.pct >= 80 ? 'green' : pressureStats.pct >= 60 ? 'amber' : 'red'}
            />
            <KpiCard
              title="Inspection Compliance"
              value={`${inspectionStats.pct.toFixed(1)}%`}
              sub={`${inspectionStats.compliant}/${inspectionStats.total} vehicles current`}
              icon={ClipboardList}
              color={inspectionStats.pct >= 80 ? 'green' : inspectionStats.pct >= 60 ? 'amber' : 'red'}
            />
            <KpiCard
              title="Critical Non-Compliance"
              value={criticalCount}
              sub="Risk level = Critical"
              icon={AlertTriangle}
              color={criticalCount > 0 ? 'red' : 'green'}
              alert={criticalCount > 0}
            />
            <KpiCard
              title="Fully Compliant Vehicles"
              value={fullyCompliantVehicles}
              sub="All tyre checks passed"
              icon={CheckCircle}
              color={fullyCompliantVehicles > 0 ? 'green' : 'orange'}
            />
          </div>

          {/* ── Compliance Trend Line ── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={14} className="text-green-400" />
              <h3 className="text-sm font-semibold text-white">Compliance Trend</h3>
              <span className="ml-auto text-xs text-gray-500">Tread compliance % - last 6 months</span>
            </div>
            <div className="h-48">
              <Line data={trendLineChart} options={trendLineOpts} />
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-1 p-3 border-b border-gray-800 overflow-x-auto">
              <TabBtn
                active={activeTab === 'tread'}
                onClick={() => setActiveTab('tread')}
                icon={Gauge}
                label="Tread Depth"
                count={treadStats.fleetFail.length}
                countColor={treadStats.fleetFail.length > 0 ? 'bg-red-900/40 text-red-300 border border-red-700/40' : 'bg-gray-700 text-gray-300'}
              />
              <TabBtn
                active={activeTab === 'pressure'}
                onClick={() => setActiveTab('pressure')}
                icon={AlertCircle}
                label="Pressure"
                count={pressureStats.anomalies}
                countColor={pressureStats.anomalies > 0 ? 'bg-orange-900/40 text-orange-300 border border-orange-700/40' : 'bg-gray-700 text-gray-300'}
              />
              <TabBtn
                active={activeTab === 'inspection'}
                onClick={() => setActiveTab('inspection')}
                icon={ClipboardList}
                label="Inspection Schedule"
                count={overdueCount}
                countColor={overdueCount > 0 ? 'bg-red-900/40 text-red-300 border border-red-700/40' : 'bg-gray-700 text-gray-300'}
              />
            </div>

            <div className="p-4">
              <AnimatePresence mode="wait">

                {/* ─── TAB: Tread Depth ─── */}
                {activeTab === 'tread' && (
                  <motion.div
                    key="tread"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-5"
                  >
                    {/* Summary row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'Total Tyres', val: treadStats.total, col: 'text-blue-300' },
                        { label: 'Compliant (≥3mm)', val: treadStats.compliant, col: 'text-green-400' },
                        { label: 'Below Fleet Min', val: treadStats.fleetFail.length, col: 'text-orange-400' },
                        { label: 'Legal Failures (<1.6mm)', val: treadStats.legalFail.length, col: 'text-red-400' },
                      ].map(({ label, val, col }) => (
                        <div key={label} className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/40">
                          <p className="text-xs text-gray-500">{label}</p>
                          <p className={`text-xl font-bold ${col}`}>{val}</p>
                        </div>
                      ))}
                    </div>

                    {/* Charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/40">
                        <div className="flex items-center gap-2 mb-3">
                          <BarChart3 size={13} className="text-blue-400" />
                          <span className="text-sm font-medium text-white">Tread Depth Distribution</span>
                        </div>
                        <div className="h-52">
                          <Bar data={treadDistChart} options={{
                            ...chartOpts(false, 'Tread Depth Band', 'Tyres'),
                            plugins: { legend: { display: false }, tooltip: { backgroundColor: 'var(--panel)', titleColor: '#f9fafb', bodyColor: '#d1d5db', borderColor: 'var(--hairline)', borderWidth: 1 } },
                          }} />
                        </div>
                        <div className="flex flex-wrap gap-3 mt-2">
                          {[
                            { color: 'bg-red-500',    label: '0-2mm (Legal failure)' },
                            { color: 'bg-orange-500', label: '2-4mm (Below fleet min)' },
                            { color: 'bg-yellow-500', label: '4-6mm (Monitor)' },
                            { color: 'bg-green-500',  label: '6mm+ (Good)' },
                          ].map(l => (
                            <div key={l.label} className="flex items-center gap-1.5">
                              <span className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
                              <span className="text-xs text-gray-500">{l.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/40">
                        <div className="flex items-center gap-2 mb-3">
                          <Building2 size={13} className="text-purple-400" />
                          <span className="text-sm font-medium text-white">Tread Compliance by Site</span>
                        </div>
                        {treadBySite.length === 0 ? (
                          <div className="flex items-center justify-center h-52 text-gray-600 text-sm">No site data</div>
                        ) : (
                          <div className="h-52">
                            <Bar data={treadBySiteChart} options={{
                              ...chartOpts(true, 'Compliance %', ''),
                              plugins: {
                                legend: { display: false },
                                tooltip: { backgroundColor: 'var(--panel)', titleColor: '#f9fafb', bodyColor: '#d1d5db', borderColor: 'var(--hairline)', borderWidth: 1, callbacks: { label: ctx => ` ${Number(ctx.parsed.x).toFixed(1)}%` } },
                              },
                              scales: {
                                x: { min: 0, max: 100, grid: { color: 'rgba(31,41,55,0.8)' }, ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => `${v}%` } },
                                y: { grid: { color: 'rgba(31,41,55,0.8)' }, ticks: { color: '#9ca3af', font: { size: 9 } } },
                              },
                            }} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Non-compliant table */}
                    <div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={13} className="text-red-400" />
                          <span className="text-sm font-semibold text-white">Non-Compliant Tyres</span>
                          <span className="text-xs px-2 py-0.5 bg-red-900/30 text-red-300 border border-red-700/40 rounded-full">
                            {nonCompliantTyres.length}
                          </span>
                        </div>
                        <div className="sm:ml-auto flex items-center gap-2">
                          <div className="relative">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                              value={treadSearch}
                              onChange={e => { setTreadSearch(e.target.value); setTreadPage(1) }}
                              placeholder="Search asset, serial, site..."
                              className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg pl-7 pr-3 py-2 w-48 focus:outline-none focus:ring-1 focus:ring-green-500"
                            />
                          </div>
                          <button
                            onClick={exportTreadPdf}
                            disabled={nonCompliantTyres.length === 0}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 text-xs hover:bg-red-900/60 transition-colors disabled:opacity-40"
                          >
                            <FileText size={12} /> Tread Report
                          </button>
                        </div>
                      </div>

                      {nonCompliantTyres.length === 0 ? (
                        <div className="flex flex-col items-center py-12 gap-2">
                          <CheckCircle size={28} className="text-green-500" />
                          <p className="text-gray-400 text-sm">All tyres meet the fleet minimum tread depth - fully compliant!</p>
                        </div>
                      ) : (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-700/60">
                                  {['Asset', 'Position', 'Brand', 'Tread (mm)', 'Site', 'Days in Service', 'Risk', 'Status'].map(h => (
                                    <th key={h} className="text-left text-gray-500 pb-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {treadPageRows.map((r, i) => {
                                  const td = r.tread_depth != null ? Number(r.tread_depth) : null
                                  const isLegalFail = td !== null && td < LEGAL_MIN_TREAD
                                  return (
                                    <tr
                                      key={r.id ?? i}
                                      className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors ${isLegalFail ? 'bg-red-950/20' : ''}`}
                                    >
                                      <td className="py-2 pr-3 text-white font-medium">{r.asset_no || '-'}</td>
                                      <td className="py-2 pr-3 text-gray-300">{r.position || '-'}</td>
                                      <td className="py-2 pr-3 text-gray-300">{r.brand || '-'}</td>
                                      <td className={`py-2 pr-3 font-bold ${isLegalFail ? 'text-red-400' : 'text-orange-400'}`}>
                                        {td !== null ? `${td.toFixed(1)} mm` : <span className="text-gray-600">No Data</span>}
                                      </td>
                                      <td className="py-2 pr-3 text-gray-400">{r.site || '-'}</td>
                                      <td className="py-2 pr-3 text-gray-400">
                                        {r.issue_date ? `${daysInService(r.issue_date)} days` : '-'}
                                      </td>
                                      <td className="py-2 pr-3"><RiskBadge risk={r.risk_level} /></td>
                                      <td className="py-2 pr-3">
                                        {isLegalFail ? (
                                          <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-500/20 text-red-300 border border-red-500/40">
                                            LEGAL FAILURE
                                          </span>
                                        ) : td === null ? (
                                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                                            Unknown
                                          </span>
                                        ) : (
                                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/40">
                                            Below Min
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex items-center justify-between mt-3">
                            <p className="text-xs text-gray-500">
                              {(treadPage - 1) * PAGE_SIZE + 1}-{Math.min(treadPage * PAGE_SIZE, nonCompliantTyres.length)} of {nonCompliantTyres.length}
                            </p>
                            <div className="flex items-center gap-1">
                              <button disabled={treadPage === 1} onClick={() => setTreadPage(p => p - 1)}
                                className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40">
                                <ChevronLeft size={13} />
                              </button>
                              <span className="text-xs text-gray-400 px-2">{treadPage} / {treadPageCount}</span>
                              <button disabled={treadPage === treadPageCount} onClick={() => setTreadPage(p => p + 1)}
                                className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40">
                                <ChevronRight size={13} />
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* ─── TAB: Pressure ─── */}
                {activeTab === 'pressure' && (
                  <motion.div
                    key="pressure"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-5"
                  >
                    {/* Summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'Total Tyres', val: pressureStats.total, col: 'text-blue-300' },
                        { label: 'With Reading', val: pressureStats.withReading, col: 'text-green-400' },
                        { label: 'Compliant (85-130 PSI)', val: pressureStats.compliant, col: 'text-green-400' },
                        { label: 'Anomalies / No Data', val: `${pressureStats.anomalies} / ${pressureStats.noReading}`, col: 'text-red-400' },
                      ].map(({ label, val, col }) => (
                        <div key={label} className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/40">
                          <p className="text-xs text-gray-500">{label}</p>
                          <p className={`text-xl font-bold ${col}`}>{val}</p>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Doughnut */}
                      <div className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/40">
                        <div className="flex items-center gap-2 mb-3">
                          <AlertCircle size={13} className="text-orange-400" />
                          <span className="text-sm font-medium text-white">Pressure Compliance Breakdown</span>
                        </div>
                        <div className="h-56">
                          <Doughnut data={pressureDoughnutData} options={doughnutOpts} />
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                          {[
                            { label: 'Compliant', val: pressureStats.compliant, color: 'text-green-400' },
                            { label: 'Anomaly',   val: pressureStats.anomalies, color: 'text-red-400' },
                            { label: 'No Data',   val: pressureStats.noReading, color: 'text-gray-400' },
                          ].map(({ label, val, color }) => (
                            <div key={label} className="bg-gray-900/50 rounded-lg p-2">
                              <p className="text-xs text-gray-500">{label}</p>
                              <p className={`text-lg font-bold ${color}`}>{val}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* By site */}
                      <div className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/40">
                        <div className="flex items-center gap-2 mb-3">
                          <Building2 size={13} className="text-purple-400" />
                          <span className="text-sm font-medium text-white">Pressure Compliance by Site</span>
                        </div>
                        {pressureBySite.length === 0 ? (
                          <div className="flex items-center justify-center h-56 text-gray-600 text-sm">No site data</div>
                        ) : (
                          <div className="h-56">
                            <Bar data={pressureBySiteChart} options={{
                              ...chartOpts(true, 'Compliance %', ''),
                              plugins: {
                                legend: { display: false },
                                tooltip: { backgroundColor: 'var(--panel)', titleColor: '#f9fafb', bodyColor: '#d1d5db', borderColor: 'var(--hairline)', borderWidth: 1, callbacks: { label: ctx => ` ${Number(ctx.parsed.x).toFixed(1)}%` } },
                              },
                              scales: {
                                x: { min: 0, max: 100, grid: { color: 'rgba(31,41,55,0.8)' }, ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => `${v}%` } },
                                y: { grid: { color: 'rgba(31,41,55,0.8)' }, ticks: { color: '#9ca3af', font: { size: 9 } } },
                              },
                            }} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Anomaly table */}
                    <div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={13} className="text-orange-400" />
                          <span className="text-sm font-semibold text-white">Pressure Anomalies & Missing Data</span>
                          <span className="text-xs px-2 py-0.5 bg-orange-900/30 text-orange-300 border border-orange-700/40 rounded-full">
                            {pressureAnomalies.length}
                          </span>
                        </div>
                        <div className="sm:ml-auto">
                          <div className="relative">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                              value={pressureSearch}
                              onChange={e => { setPressureSearch(e.target.value); setPressurePage(1) }}
                              placeholder="Search asset, serial, site..."
                              className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg pl-7 pr-3 py-2 w-48 focus:outline-none focus:ring-1 focus:ring-green-500"
                            />
                          </div>
                        </div>
                      </div>

                      {pressureAnomalies.length === 0 ? (
                        <div className="flex flex-col items-center py-12 gap-2">
                          <CheckCircle size={28} className="text-green-500" />
                          <p className="text-gray-400 text-sm">No pressure anomalies - all tyres have valid readings!</p>
                        </div>
                      ) : (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-700/60">
                                  {['Asset', 'Serial', 'Brand', 'Position', 'Pressure Reading', 'Site', 'Risk', 'Flag'].map(h => (
                                    <th key={h} className="text-left text-gray-500 pb-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {pressurePageRows.map((r, i) => (
                                  <tr
                                    key={r.id ?? i}
                                    className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors ${r.pressureFlag === 'Anomaly' ? 'bg-orange-950/10' : ''}`}
                                  >
                                    <td className="py-2 pr-3 text-white font-medium">{r.asset_no || '-'}</td>
                                    <td className="py-2 pr-3 text-gray-400 font-mono text-[11px]">{r.serial_number || '-'}</td>
                                    <td className="py-2 pr-3 text-gray-300">{r.brand || '-'}</td>
                                    <td className="py-2 pr-3 text-gray-300">{r.position || '-'}</td>
                                    <td className={`py-2 pr-3 font-bold ${r.pressureFlag === 'Anomaly' ? 'text-orange-400' : 'text-gray-600'}`}>
                                      {r.pressure_reading ? `${Number(r.pressure_reading).toFixed(0)} PSI` : '-'}
                                    </td>
                                    <td className="py-2 pr-3 text-gray-400">{r.site || '-'}</td>
                                    <td className="py-2 pr-3"><RiskBadge risk={r.risk_level} /></td>
                                    <td className="py-2 pr-3">
                                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                        r.pressureFlag === 'Anomaly'
                                          ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                                          : 'bg-gray-800 text-gray-400'
                                      }`}>
                                        {r.pressureFlag}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex items-center justify-between mt-3">
                            <p className="text-xs text-gray-500">
                              {(pressurePage - 1) * PAGE_SIZE + 1}-{Math.min(pressurePage * PAGE_SIZE, pressureAnomalies.length)} of {pressureAnomalies.length}
                            </p>
                            <div className="flex items-center gap-1">
                              <button disabled={pressurePage === 1} onClick={() => setPressurePage(p => p - 1)}
                                className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40">
                                <ChevronLeft size={13} />
                              </button>
                              <span className="text-xs text-gray-400 px-2">{pressurePage} / {pressurePageCount}</span>
                              <button disabled={pressurePage === pressurePageCount} onClick={() => setPressurePage(p => p + 1)}
                                className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40">
                                <ChevronRight size={13} />
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* ─── TAB: Inspection Schedule ─── */}
                {activeTab === 'inspection' && (
                  <motion.div
                    key="inspection"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-5"
                  >
                    {/* Summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'Total Vehicles', val: inspectionStats.total, col: 'text-blue-300' },
                        { label: `Compliant (≤${INSPECTION_MAX_DAYS}d)`, val: inspectionStats.compliant, col: 'text-green-400' },
                        { label: `Due Soon (${INSPECTION_MAX_DAYS + 1}-${INSPECTION_DUE_DAYS}d)`, val: inspectionStats.dueSoon, col: 'text-yellow-400' },
                        { label: `Overdue (>${INSPECTION_DUE_DAYS}d)`, val: inspectionStats.overdue, col: 'text-red-400' },
                      ].map(({ label, val, col }) => (
                        <div key={label} className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/40">
                          <p className="text-xs text-gray-500">{label}</p>
                          <p className={`text-xl font-bold ${col}`}>{val}</p>
                        </div>
                      ))}
                    </div>

                    {/* Bar chart by site */}
                    {inspBySite.length > 0 && (
                      <div className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/40">
                        <div className="flex items-center gap-2 mb-3">
                          <BarChart3 size={13} className="text-blue-400" />
                          <span className="text-sm font-medium text-white">Inspection Status by Site</span>
                        </div>
                        <div className="h-52">
                          <Bar data={inspBySiteChart} options={{
                            ...chartOpts(false, 'Site', 'Vehicles'),
                            plugins: {
                              legend: { labels: { color: '#9ca3af', font: { size: 10 } } },
                              tooltip: { backgroundColor: 'var(--panel)', titleColor: '#f9fafb', bodyColor: '#d1d5db', borderColor: 'var(--hairline)', borderWidth: 1 },
                            },
                            scales: {
                              x: { stacked: true, grid: { color: 'rgba(31,41,55,0.8)' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
                              y: { stacked: true, grid: { color: 'rgba(31,41,55,0.8)' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
                            },
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Inspection table */}
                    <div>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-blue-400" />
                          <span className="text-sm font-semibold text-white">Vehicle Inspection Schedule</span>
                          {overdueCount > 0 && (
                            <span className="text-xs px-2 py-0.5 bg-red-900/30 text-red-300 border border-red-700/40 rounded-full">
                              {overdueCount} Overdue
                            </span>
                          )}
                        </div>
                        <div className="sm:ml-auto flex items-center gap-2">
                          <div className="relative">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                              value={inspSearch}
                              onChange={e => { setInspSearch(e.target.value); setInspPage(1) }}
                              placeholder="Search asset, site, inspector..."
                              className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg pl-7 pr-3 py-2 w-48 focus:outline-none focus:ring-1 focus:ring-green-500"
                            />
                          </div>
                          {overdueCount > 0 && (
                            <a
                              href="/inspection-planner"
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 text-xs hover:bg-red-900/60 transition-colors"
                            >
                              <ExternalLink size={12} />
                              Schedule {overdueCount} Overdue
                            </a>
                          )}
                        </div>
                      </div>

                      {inspectionRows.length === 0 ? (
                        <div className="flex flex-col items-center py-12 gap-2">
                          <ClipboardList size={28} className="text-gray-700" />
                          <p className="text-gray-500 text-sm">No inspection data found for the selected filters.</p>
                        </div>
                      ) : (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-700/60">
                                  {['Asset No', 'Vehicle Type', 'Site', 'Last Inspection', 'Days Since', 'Next Due', 'Status', 'Inspector'].map(h => (
                                    <th key={h} className="text-left text-gray-500 pb-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {inspPageRows.map((r, i) => (
                                  <tr
                                    key={r.asset_no ?? i}
                                    className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors ${
                                      r.status === 'overdue' ? 'bg-red-950/10' :
                                      r.status === 'due_soon' ? 'bg-yellow-950/10' : ''
                                    }`}
                                  >
                                    <td className="py-2 pr-3 text-white font-medium">{r.asset_no || '-'}</td>
                                    <td className="py-2 pr-3 text-gray-300">{r.vehicle_type}</td>
                                    <td className="py-2 pr-3 text-gray-400">{r.site}</td>
                                    <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">
                                      {r.last_inspection
                                        ? new Date(r.last_inspection).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                                        : <span className="text-gray-600">Never</span>}
                                    </td>
                                    <td className={`py-2 pr-3 font-medium ${
                                      r.days_since === null ? 'text-gray-600' :
                                      r.days_since > INSPECTION_DUE_DAYS ? 'text-red-400' :
                                      r.days_since > INSPECTION_MAX_DAYS ? 'text-yellow-400' :
                                      'text-green-400'
                                    }`}>
                                      {r.days_since !== null ? `${r.days_since}d` : '-'}
                                    </td>
                                    <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">
                                      {r.next_due
                                        ? new Date(r.next_due).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                                        : '-'}
                                    </td>
                                    <td className="py-2 pr-3">
                                      <InspectionBadge status={r.status} />
                                    </td>
                                    <td className="py-2 pr-3 text-gray-400">{r.inspector}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex items-center justify-between mt-3">
                            <p className="text-xs text-gray-500">
                              {(inspPage - 1) * PAGE_SIZE + 1}-{Math.min(inspPage * PAGE_SIZE, inspectionRows.length)} of {inspectionRows.length}
                            </p>
                            <div className="flex items-center gap-1">
                              <button disabled={inspPage === 1} onClick={() => setInspPage(p => p - 1)}
                                className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40">
                                <ChevronLeft size={13} />
                              </button>
                              <span className="text-xs text-gray-400 px-2">{inspPage} / {inspPageCount}</span>
                              <button disabled={inspPage === inspPageCount} onClick={() => setInspPage(p => p + 1)}
                                className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40">
                                <ChevronRight size={13} />
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>
            </div>
          </div>

          {/* ── Empty state ── */}
          {tyreRecords.length === 0 && inspections.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <ShieldCheck size={44} className="text-gray-700" />
              <p className="text-gray-500 text-sm">No fleet data found. Upload tyre records or inspection data to begin compliance tracking.</p>
            </div>
          )}

        </motion.div>
      )}

      {/* ── Email Modal ── */}
      <AnimatePresence>
        {showEmailModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) { setShowEmailModal(false); setEmailSent(false) } }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Mail size={16} className="text-blue-400" />
                  <h3 className="text-sm font-semibold text-white">Share Compliance Report</h3>
                </div>
                <button onClick={() => { setShowEmailModal(false); setEmailSent(false) }} className="text-gray-500 hover:text-white">
                  <X size={16} />
                </button>
              </div>

              {emailSent ? (
                <div className="flex flex-col items-center py-8 gap-3">
                  <CheckCircle size={32} className="text-green-400" />
                  <p className="text-green-300 text-sm font-medium">Report shared successfully!</p>
                  <p className="text-gray-500 text-xs">Sent to: {emailTo}</p>
                  <button onClick={() => { setShowEmailModal(false); setEmailSent(false) }}
                    className="mt-2 px-4 py-2 rounded-lg bg-green-900/40 border border-green-700/50 text-green-300 text-xs">
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-gray-400 mb-1.5 block">Recipient Email</label>
                      <input
                        type="email"
                        value={emailTo}
                        onChange={e => setEmailTo(e.target.value)}
                        placeholder="email@company.com"
                        className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700/40">
                      <p className="text-xs text-gray-400 font-medium mb-2">Report includes:</p>
                      <ul className="space-y-1">
                        {[
                          `Overall compliance score: ${overallScore}%`,
                          `Tread compliance: ${treadStats.pct.toFixed(1)}%`,
                          `Pressure compliance: ${pressureStats.pct.toFixed(1)}%`,
                          `Inspection compliance: ${inspectionStats.pct.toFixed(1)}%`,
                          `${criticalCount} critical alerts`,
                        ].map(item => (
                          <li key={item} className="flex items-center gap-2 text-xs text-gray-500">
                            <CheckCircle size={10} className="text-green-500 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <p className="text-xs text-gray-600 flex items-center gap-1">
                      <Info size={11} />
                      Email delivery requires a configured SMTP service. This generates a shareable compliance summary.
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-5">
                    <button onClick={() => setShowEmailModal(false)}
                      className="px-4 py-2 rounded-lg text-gray-400 text-xs hover:text-white transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={() => { if (emailTo) setEmailSent(true) }}
                      disabled={!emailTo}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 text-white text-xs hover:bg-blue-600 transition-colors disabled:opacity-40"
                    >
                      <Mail size={12} /> Send Report
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}
