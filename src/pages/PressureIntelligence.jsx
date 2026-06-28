import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  Gauge, AlertTriangle, CheckCircle, XCircle, TrendingDown, TrendingUp,
  Download, FileText, Filter, X, ChevronLeft, ChevronRight, Search,
  RefreshCw, BarChart3, Thermometer, Users, Building2, Info, Eye,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Pressure standards ────────────────────────────────────────────────────────
const SPEC = { Steer: 120, Drive: 110, Trailer: 100 }
function specFor(pos) {
  if (!pos) return 105
  const k = Object.keys(SPEC).find(k => pos.toLowerCase().includes(k.toLowerCase()))
  return k ? SPEC[k] : 105
}
function classifyReading(reading, spec) {
  const r = Number(reading)
  if (!r || !spec) return 'unknown'
  if (r < spec * 0.80) return 'critical_under'
  if (r < spec * 0.90) return 'under'
  if (r > spec * 1.10) return 'over'
  return 'ok'
}
function deviationPct(reading, spec) {
  return Math.abs(((Number(reading) - spec) / spec) * 100)
}

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

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    critical_under: 'bg-red-500/20 text-red-300 border border-red-500/40',
    under:          'bg-orange-500/20 text-orange-300 border border-orange-500/40',
    over:           'bg-amber-500/20 text-amber-300 border border-amber-500/40',
    ok:             'bg-green-500/20 text-green-300 border border-green-500/40',
    unknown:        'bg-gray-800 text-gray-400',
  }
  const label = {
    critical_under: 'Critical Under',
    under:          'Under-Inflated',
    over:           'Over-Inflated',
    ok:             'OK',
    unknown:        'Unknown',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? map.unknown}`}>
      {label[status] ?? status}
    </span>
  )
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, icon: Icon, color, alert }) {
  const border = {
    green:  'border-green-700/40 bg-green-950/20',
    red:    'border-red-700/40 bg-red-950/20',
    orange: 'border-orange-700/40 bg-orange-950/20',
    amber:  'border-amber-700/40 bg-amber-950/20',
    blue:   'border-blue-700/40 bg-blue-950/20',
  }
  const iconColor = {
    green: 'text-green-400', red: 'text-red-400',
    orange: 'text-orange-400', amber: 'text-amber-400', blue: 'text-blue-400',
  }
  const valueColor = {
    green: 'text-green-400', red: 'text-red-400',
    orange: 'text-orange-400', amber: 'text-amber-400', blue: 'text-blue-300',
  }
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${border[color] ?? 'border-gray-700/40 bg-gray-900/40'}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} className={iconColor[color] ?? 'text-gray-400'} />
          <span className="text-xs text-gray-400 font-medium">{title}</span>
        </div>
        {alert && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 font-bold animate-pulse">
            ALERT
          </span>
        )}
      </div>
      <p className={`text-2xl font-bold leading-tight ${valueColor[color] ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  )
}

// ── Histogram bands ───────────────────────────────────────────────────────────
const HISTOGRAM_BANDS = [
  { label: '0–60',    min: 0,   max: 60,  color: 'rgba(239,68,68,0.8)' },
  { label: '60–80',   min: 60,  max: 80,  color: 'rgba(239,68,68,0.65)' },
  { label: '80–90',   min: 80,  max: 90,  color: 'rgba(249,115,22,0.8)' },
  { label: '90–100',  min: 90,  max: 100, color: 'rgba(234,179,8,0.8)' },
  { label: '100–110', min: 100, max: 110, color: 'rgba(34,197,94,0.8)' },
  { label: '110–120', min: 110, max: 120, color: 'rgba(34,197,94,0.8)' },
  { label: '120–130', min: 120, max: 130, color: 'rgba(234,179,8,0.75)' },
  { label: '130–140', min: 130, max: 140, color: 'rgba(249,115,22,0.75)' },
  { label: '140+',    min: 140, max: Infinity, color: 'rgba(239,68,68,0.8)' },
]

function bandFor(val) {
  return HISTOGRAM_BANDS.findIndex(b => val >= b.min && val < b.max)
}

// ── Select helper ─────────────────────────────────────────────────────────────
function Select({ value, onChange, options, placeholder, className = '' }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 ${className}`}
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

// ── Standard deviation ────────────────────────────────────────────────────────
function stdev(arr) {
  if (arr.length < 2) return 0
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PressureIntelligence() {
  const { activeCountry } = useSettings()

  // Data
  const [inspections, setInspections]   = useState([])
  const [tyreRecords, setTyreRecords]   = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)

  // Filters
  const [siteFilter, setSiteFilter]         = useState('')
  const [countryFilter, setCountryFilter]   = useState('')
  const [positionFilter, setPositionFilter] = useState('')
  const [dateFrom, setDateFrom]             = useState('')
  const [dateTo, setDateTo]                 = useState('')
  const [inspectorFilter, setInspectorFilter] = useState('')

  // Table
  const [anomalyPage, setAnomalyPage]   = useState(1)
  const ANOMALY_PAGE_SIZE = 25
  const [sortAnomalies, setSortAnomalies] = useState('severity')
  const [assetDrilldown, setAssetDrilldown] = useState(null)

  // Search
  const [tableSearch, setTableSearch] = useState('')

  // ── Data fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [{ data: ins }, { data: tr }] = await Promise.all([
          fetchAllPages((from, to) => supabase
            .from('inspections')
            .select('id,asset_no,tyre_serial,pressure_reading,inspector,inspection_date,site,country,notes')
            .order('inspection_date', { ascending: false })
            .range(from, to)),
          fetchAllPages((from, to) => supabase
            .from('tyre_records')
            .select('id,asset_no,serial_number,position,pressure_reading,brand,size,site,country,issue_date,risk_level')
            .order('issue_date', { ascending: false })
            .range(from, to)),
        ])
        setInspections(ins || [])
        setTyreRecords(tr || [])
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Normalize into unified readings ────────────────────────────────────────
  const allReadings = useMemo(() => {
    const fromInspections = (inspections || [])
      .filter(r => r.pressure_reading != null && !isNaN(Number(r.pressure_reading)))
      .map(r => ({
        id:          r.id,
        source:      'inspection',
        asset_no:    r.asset_no,
        serial:      r.tyre_serial,
        position:    null,
        reading:     Number(r.pressure_reading),
        inspector:   r.inspector,
        date:        r.inspection_date,
        site:        r.site,
        country:     r.country,
        notes:       r.notes,
        tread_depth: null,
      }))

    const fromTyres = (tyreRecords || [])
      .filter(r => r.pressure_reading != null && !isNaN(Number(r.pressure_reading)))
      .map(r => ({
        id:       r.id,
        source:   'tyre_records',
        asset_no: r.asset_no,
        serial:   r.serial_number,
        position: r.position,
        reading:  Number(r.pressure_reading),
        inspector: null,
        date:     r.issue_date,
        site:     r.site,
        country:  r.country,
        notes:    null,
        brand:    r.brand,
        size:     r.size,
      }))

    // Prefer inspections; supplement with tyre_records only if no inspections
    return fromInspections.length > 0 ? fromInspections : fromTyres
  }, [inspections, tyreRecords])

  // ── Filter options ──────────────────────────────────────────────────────────
  const sites      = useMemo(() => [...new Set(allReadings.map(r => r.site).filter(Boolean))].sort(), [allReadings])
  const countries  = useMemo(() => [...new Set(allReadings.map(r => r.country).filter(Boolean))].sort(), [allReadings])
  const inspectors = useMemo(() => [...new Set(allReadings.map(r => r.inspector).filter(Boolean))].sort(), [allReadings])
  const POSITIONS  = ['Steer', 'Drive', 'Trailer', 'Other']

  // ── Apply filters ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let d = [...allReadings]
    if (activeCountry !== 'All') d = d.filter(r => r.country === activeCountry)
    if (countryFilter)  d = d.filter(r => r.country === countryFilter)
    if (siteFilter)     d = d.filter(r => r.site === siteFilter)
    if (positionFilter) {
      if (positionFilter === 'Other') {
        d = d.filter(r => !Object.keys(SPEC).some(p => (r.position || '').toLowerCase().includes(p.toLowerCase())))
      } else {
        d = d.filter(r => (r.position || '').toLowerCase().includes(positionFilter.toLowerCase()))
      }
    }
    if (dateFrom) d = d.filter(r => r.date >= dateFrom)
    if (dateTo)   d = d.filter(r => r.date <= dateTo)
    if (inspectorFilter) d = d.filter(r => r.inspector === inspectorFilter)
    return d
  }, [allReadings, activeCountry, countryFilter, siteFilter, positionFilter, dateFrom, dateTo, inspectorFilter])

  // ── Enrich with spec + status ────────────────────────────────────────────
  const enriched = useMemo(() => filtered.map(r => {
    const spec   = specFor(r.position)
    const status = classifyReading(r.reading, spec)
    const devPct = deviationPct(r.reading, spec)
    return { ...r, spec, status, devPct }
  }), [filtered])

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total    = enriched.length
    if (total === 0) return { compliance: 0, underCount: 0, overCount: 0, criticalCount: 0, avgDev: 0, total: 0 }
    const ok       = enriched.filter(r => r.status === 'ok').length
    const under    = enriched.filter(r => r.status === 'under').length
    const over     = enriched.filter(r => r.status === 'over').length
    const critical = enriched.filter(r => r.status === 'critical_under').length
    const avgDev   = enriched.reduce((s, r) => s + r.devPct, 0) / total
    return {
      compliance:    ((ok / total) * 100).toFixed(1),
      underCount:    under,
      overCount:     over,
      criticalCount: critical,
      avgDev:        avgDev.toFixed(1),
      total,
    }
  }, [enriched])

  // ── Histogram ───────────────────────────────────────────────────────────────
  const histogramData = useMemo(() => {
    const counts = HISTOGRAM_BANDS.map(() => 0)
    enriched.forEach(r => {
      const idx = bandFor(r.reading)
      if (idx >= 0) counts[idx]++
    })
    return {
      labels: HISTOGRAM_BANDS.map(b => b.label),
      datasets: [{
        label: 'Readings',
        data: counts,
        backgroundColor: HISTOGRAM_BANDS.map(b => b.color),
        borderColor: HISTOGRAM_BANDS.map(b => b.color.replace(/0\.\d+\)/, '1)')),
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [enriched])

  const histogramOpts = useMemo(() => ({
    ...chartOpts(false, 'Pressure Range (PSI)', 'Count'),
    plugins: {
      ...chartOpts().plugins,
      legend: { display: false },
      annotation: {},
      tooltip: {
        backgroundColor: 'var(--panel)',
        titleColor: '#f9fafb',
        bodyColor: '#d1d5db',
        borderColor: 'var(--hairline)',
        borderWidth: 1,
      },
    },
  }), [])

  // ── Compliance by site ───────────────────────────────────────────────────────
  const siteCompliance = useMemo(() => {
    const map = {}
    enriched.forEach(r => {
      if (!r.site) return
      if (!map[r.site]) map[r.site] = { ok: 0, total: 0 }
      map[r.site].total++
      if (r.status === 'ok') map[r.site].ok++
    })
    return Object.entries(map)
      .map(([site, v]) => ({ site, pct: (v.ok / v.total * 100).toFixed(1), ok: v.ok, total: v.total }))
      .sort((a, b) => Number(b.pct) - Number(a.pct))
  }, [enriched])

  const siteComplianceData = useMemo(() => {
    const colors = siteCompliance.map(s => {
      const pct = Number(s.pct)
      if (pct >= 95) return 'rgba(34,197,94,0.75)'
      if (pct >= 85) return 'rgba(234,179,8,0.75)'
      if (pct >= 75) return 'rgba(249,115,22,0.75)'
      return 'rgba(239,68,68,0.75)'
    })
    return {
      labels: siteCompliance.map(s => s.site),
      datasets: [{
        label: 'Compliance %',
        data: siteCompliance.map(s => Number(s.pct)),
        backgroundColor: colors,
        borderColor: colors.map(c => c.replace(/0\.75/, '1')),
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [siteCompliance])

  const siteComplianceOpts = useMemo(() => ({
    ...chartOpts(true, 'Compliance %', ''),
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'var(--panel)',
        titleColor: '#f9fafb',
        bodyColor: '#d1d5db',
        borderColor: 'var(--hairline)',
        borderWidth: 1,
        callbacks: {
          label: ctx => ` ${ctx.parsed.x.toFixed(1)}%`,
        },
      },
    },
    scales: {
      x: {
        min: 0, max: 100,
        grid: { color: 'rgba(31,41,55,0.8)' },
        ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => `${v}%` },
      },
      y: { grid: { color: 'rgba(31,41,55,0.8)' }, ticks: { color: '#9ca3af', font: { size: 9 } } },
    },
  }), [])

  // ── Anomaly table ────────────────────────────────────────────────────────────
  const SEVERITY_RANK = { critical_under: 0, under: 1, over: 2 }
  const anomalies = useMemo(() => {
    let rows = enriched.filter(r => r.status !== 'ok' && r.status !== 'unknown')
    if (tableSearch) {
      const q = tableSearch.toLowerCase()
      rows = rows.filter(r =>
        (r.asset_no || '').toLowerCase().includes(q) ||
        (r.serial || '').toLowerCase().includes(q) ||
        (r.site || '').toLowerCase().includes(q) ||
        (r.inspector || '').toLowerCase().includes(q)
      )
    }
    rows.sort((a, b) => {
      if (sortAnomalies === 'severity') return (SEVERITY_RANK[a.status] ?? 9) - (SEVERITY_RANK[b.status] ?? 9)
      if (sortAnomalies === 'deviation') return b.devPct - a.devPct
      if (sortAnomalies === 'date') return (b.date || '') > (a.date || '') ? 1 : -1
      return 0
    })
    return rows
  }, [enriched, tableSearch, sortAnomalies])

  const anomalyPageCount = Math.max(1, Math.ceil(anomalies.length / ANOMALY_PAGE_SIZE))
  const anomalyPageRows  = anomalies.slice((anomalyPage - 1) * ANOMALY_PAGE_SIZE, anomalyPage * ANOMALY_PAGE_SIZE)

  // ── Pressure trend by position (12 months) ────────────────────────────────
  const positionTrend = useMemo(() => {
    const now     = new Date()
    const months  = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const positions = ['Steer', 'Drive', 'Trailer']
    const posData   = {}
    const avgData   = {}
    positions.forEach(p => { posData[p] = {} })
    months.forEach(m => { avgData[m] = [] })

    enriched.forEach(r => {
      if (!r.date) return
      const m = r.date.slice(0, 7)
      if (!months.includes(m)) return
      const pos = positions.find(p => (r.position || '').toLowerCase().includes(p.toLowerCase()))
      if (pos) {
        if (!posData[pos][m]) posData[pos][m] = []
        posData[pos][m].push(r.reading)
      }
      avgData[m].push(r.reading)
    })

    const posColors = {
      Steer:   { border: '#60a5fa', bg: 'rgba(96,165,250,0.1)' },
      Drive:   { border: '#34d399', bg: 'rgba(52,211,153,0.1)' },
      Trailer: { border: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    }

    const datasets = positions.map(pos => ({
      label: pos,
      data: months.map(m => {
        const arr = posData[pos][m]
        return arr?.length ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : null
      }),
      borderColor: posColors[pos].border,
      backgroundColor: posColors[pos].bg,
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.3,
      spanGaps: true,
    }))

    datasets.push({
      label: 'Fleet Avg',
      data: months.map(m => {
        const arr = avgData[m]
        return arr?.length ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : null
      }),
      borderColor: '#a78bfa',
      backgroundColor: 'rgba(167,139,250,0.08)',
      borderWidth: 2,
      borderDash: [5, 3],
      pointRadius: 2,
      tension: 0.3,
      spanGaps: true,
    })

    return { labels: months.map(m => {
      const [y, mo] = m.split('-')
      return new Date(y, mo - 1).toLocaleString('en', { month: 'short', year: '2-digit' })
    }), datasets }
  }, [enriched])

  // ── Inspector quality ────────────────────────────────────────────────────────
  const inspectorStats = useMemo(() => {
    const map = {}
    enriched.forEach(r => {
      const name = r.inspector || 'Unknown'
      if (!map[name]) map[name] = { readings: [], anomalies: 0, sites: new Set() }
      map[name].readings.push(r.reading)
      if (r.status !== 'ok') map[name].anomalies++
      if (r.site) map[name].sites.add(r.site)
    })
    return Object.entries(map)
      .map(([name, v]) => {
        const total   = v.readings.length
        const avg     = (v.readings.reduce((s, x) => s + x, 0) / total).toFixed(1)
        const sd      = stdev(v.readings).toFixed(1)
        const anomPct = ((v.anomalies / total) * 100).toFixed(1)
        const consistency = Math.max(0, 100 - Number(sd) * 2).toFixed(0)
        return {
          name,
          total,
          avg,
          sd,
          anomPct,
          consistency,
          sites: [...v.sites].join(', '),
          flag: Number(anomPct) > 30,
        }
      })
      .sort((a, b) => Number(b.anomPct) - Number(a.anomPct))
  }, [enriched])

  // ── Root cause classification ─────────────────────────────────────────────
  const rootCauses = useMemo(() => {
    const bySerial = {}
    enriched.forEach(r => {
      if (!r.serial) return
      if (!bySerial[r.serial]) bySerial[r.serial] = []
      bySerial[r.serial].push(r)
    })

    let slowLeak = 0, valveFailure = 0, ageRelated = 0, environmental = 0

    const today = new Date()

    Object.values(bySerial).forEach(readings => {
      const underReadings = readings.filter(r => r.status === 'under' || r.status === 'critical_under')
      if (underReadings.length === 0) return

      // Slow leak: 2+ under-inflation readings for same serial
      if (underReadings.length >= 2) slowLeak++

      // Valve failure: reading went from OK to critical in single step
      const sorted = [...readings].sort((a, b) => (a.date || '') > (b.date || '') ? 1 : -1)
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1], curr = sorted[i]
        if (prev.status === 'ok' && curr.status === 'critical_under') valveFailure++
      }

      // Age-related: tyre older than 3 years with under-inflation (using earliest date in readings)
      const earliestDate = sorted[0]?.date
      if (earliestDate) {
        const ageYears = (today - new Date(earliestDate)) / (1000 * 60 * 60 * 24 * 365)
        if (ageYears > 3) ageRelated++
      }
    })

    // Environmental: higher non-compliance in cold months (Nov-Feb)
    const coldMonths = [11, 12, 1, 2]
    const coldNonComp = enriched.filter(r => {
      if (!r.date) return false
      const mo = new Date(r.date).getMonth() + 1
      return coldMonths.includes(mo) && r.status !== 'ok'
    }).length
    const warmNonComp = enriched.filter(r => {
      if (!r.date) return false
      const mo = new Date(r.date).getMonth() + 1
      return !coldMonths.includes(mo) && r.status !== 'ok'
    }).length
    const coldTotal = enriched.filter(r => {
      if (!r.date) return false
      const mo = new Date(r.date).getMonth() + 1
      return coldMonths.includes(mo)
    }).length
    const warmTotal = enriched.length - coldTotal
    if (coldTotal > 0 && warmTotal > 0) {
      const coldRate = coldNonComp / coldTotal
      const warmRate = warmNonComp / warmTotal
      if (coldRate > warmRate * 1.2) environmental = coldNonComp
    }

    return [
      { cause: 'Slow Leak', count: slowLeak, rec: 'Schedule tyre removal, pressure test, and patch or replace', color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/30' },
      { cause: 'Valve/Sudden Failure', count: valveFailure, rec: 'Inspect valve stem and cap integrity, replace immediately', color: 'text-red-400', bg: 'bg-red-900/20 border-red-700/30' },
      { cause: 'Age-Related Degradation', count: ageRelated, rec: 'Review tyre age policy; consider planned replacement of tyres >3 years', color: 'text-amber-400', bg: 'bg-amber-900/20 border-amber-700/30' },
      { cause: 'Environmental / Seasonal', count: environmental, rec: 'Increase cold-season inspection frequency; adjust pressure for ambient temperature', color: 'text-blue-400', bg: 'bg-blue-900/20 border-blue-700/30' },
    ]
  }, [enriched])

  // ── Seasonal analysis ─────────────────────────────────────────────────────
  const seasonalData = useMemo(() => {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const byMonth = Array.from({ length: 12 }, () => [])

    enriched.forEach(r => {
      if (!r.date) return
      const mo = new Date(r.date).getMonth()
      byMonth[mo].push(r.reading)
    })

    const avgs  = byMonth.map(arr => arr.length ? (arr.reduce((s, v) => s + v, 0) / arr.length) : null)
    const mins  = byMonth.map(arr => arr.length ? Math.min(...arr) : null)
    const maxs  = byMonth.map(arr => arr.length ? Math.max(...arr) : null)
    const ncPct = byMonth.map((arr, mo) => {
      if (!arr.length) return null
      const nc = enriched.filter(r => {
        if (!r.date) return false
        return new Date(r.date).getMonth() === mo && r.status !== 'ok'
      }).length
      return ((nc / arr.length) * 100).toFixed(1)
    })

    return {
      labels: MONTHS,
      avgs,
      mins,
      maxs,
      ncPct,
      datasets: [
        {
          label: 'Avg Pressure',
          data: avgs,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.15)',
          borderWidth: 2,
          pointRadius: 4,
          tension: 0.3,
          fill: false,
          spanGaps: true,
          yAxisID: 'y',
        },
        {
          label: 'Non-Compliance %',
          data: ncPct,
          borderColor: '#f87171',
          backgroundColor: 'rgba(248,113,113,0.1)',
          borderWidth: 2,
          borderDash: [4, 3],
          pointRadius: 3,
          tension: 0.3,
          fill: false,
          spanGaps: true,
          yAxisID: 'y1',
        },
      ],
    }
  }, [enriched])

  const seasonalOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#9ca3af', font: { size: 10 } } },
      tooltip: { backgroundColor: 'var(--panel)', titleColor: '#f9fafb', bodyColor: '#d1d5db', borderColor: 'var(--hairline)', borderWidth: 1 },
    },
    scales: {
      x: { grid: { color: 'rgba(31,41,55,0.8)' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
      y: {
        grid: { color: 'rgba(31,41,55,0.8)' },
        ticks: { color: '#9ca3af', font: { size: 10 } },
        title: { display: true, text: 'Avg Pressure (PSI)', color: '#6b7280', font: { size: 9 } },
      },
      y1: {
        position: 'right',
        grid: { drawOnChartArea: false },
        ticks: { color: '#f87171', font: { size: 10 }, callback: v => `${v}%` },
        title: { display: true, text: 'Non-Compliance %', color: '#f87171', font: { size: 9 } },
      },
    },
  }), [])

  // ── Asset drilldown ────────────────────────────────────────────────────────
  const assetHistory = useMemo(() => {
    if (!assetDrilldown) return []
    return enriched
      .filter(r => r.asset_no === assetDrilldown)
      .sort((a, b) => (a.date || '') > (b.date || '') ? 1 : -1)
  }, [enriched, assetDrilldown])

  // ── Exports ────────────────────────────────────────────────────────────────
  function exportExcel() {
    const rows = enriched.map(r => ({
      'Asset No':      r.asset_no || '',
      'Serial':        r.serial || '',
      'Position':      r.position || '',
      'Reading (PSI)': r.reading,
      'Spec (PSI)':    r.spec,
      'Deviation %':   r.devPct.toFixed(1),
      'Status':        r.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      'Inspector':     r.inspector || '',
      'Date':          r.date || '',
      'Site':          r.site || '',
      'Country':       r.country || '',
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length + 2, 12) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Pressure Readings')

    // Anomaly sheet
    const anomRows = anomalies.map(r => ({
      'Asset No':      r.asset_no || '',
      'Serial':        r.serial || '',
      'Position':      r.position || '',
      'Reading (PSI)': r.reading,
      'Spec (PSI)':    r.spec,
      'Deviation %':   r.devPct.toFixed(1),
      'Status':        r.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      'Inspector':     r.inspector || '',
      'Date':          r.date || '',
      'Site':          r.site || '',
    }))
    const ws2 = XLSX.utils.json_to_sheet(anomRows)
    XLSX.utils.book_append_sheet(wb, ws2, 'Anomalies')

    XLSX.writeFile(wb, `pressure_intelligence_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const W = doc.internal.pageSize.width

    doc.setFillColor(22, 101, 52)
    doc.rect(0, 0, W, 22, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('TYREPULSE · Pressure Intelligence Report', 14, 10)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} | Total Readings: ${kpis.total} | Compliance: ${kpis.compliance}%`, 14, 17)

    // KPI table
    doc.setFontSize(11)
    doc.setTextColor(60, 60, 60)
    doc.text('Pressure KPI Summary', 14, 30)
    autoTable(doc, {
      startY: 33,
      head: [['Metric', 'Value']],
      body: [
        ['Overall Compliance %', `${kpis.compliance}%`],
        ['Under-Inflated Count', String(kpis.underCount)],
        ['Over-Inflated Count', String(kpis.overCount)],
        ['Critical Under-Inflation', String(kpis.criticalCount)],
        ['Average Deviation %', `${kpis.avgDev}%`],
        ['Total Readings', String(kpis.total)],
      ],
      theme: 'grid',
      headStyles: { fillColor: [22, 101, 52], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 40 } },
    })

    // Site compliance
    const yAfterKpi = doc.lastAutoTable.finalY + 8
    doc.text('Compliance by Site', 14, yAfterKpi)
    autoTable(doc, {
      startY: yAfterKpi + 3,
      head: [['Site', 'Compliance %', 'Total Readings', 'Status']],
      body: siteCompliance.map(s => [
        s.site,
        `${s.pct}%`,
        String(s.total),
        Number(s.pct) >= 95 ? 'Good' : Number(s.pct) >= 85 ? 'Warning' : 'Poor',
      ]),
      theme: 'grid',
      headStyles: { fillColor: [22, 101, 52], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8 },
    })

    // Anomaly table (first 50)
    doc.addPage()
    doc.setFillColor(22, 101, 52)
    doc.rect(0, 0, W, 16, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('Pressure Anomaly Report', 14, 10)
    autoTable(doc, {
      startY: 20,
      head: [['Asset', 'Position', 'Serial', 'Reading', 'Spec', 'Dev %', 'Status', 'Inspector', 'Date', 'Site']],
      body: anomalies.slice(0, 50).map(r => [
        r.asset_no || '', r.position || '', r.serial || '',
        `${r.reading} PSI`, `${r.spec} PSI`, `${r.devPct.toFixed(1)}%`,
        r.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        r.inspector || '', r.date || '', r.site || '',
      ]),
      theme: 'striped',
      headStyles: { fillColor: [22, 101, 52], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 7 },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 6) {
          const val = data.cell.raw || ''
          if (val.includes('Critical')) data.cell.styles.textColor = [220, 38, 38]
          else if (val.includes('Under')) data.cell.styles.textColor = [249, 115, 22]
          else if (val.includes('Over')) data.cell.styles.textColor = [245, 158, 11]
        }
      },
    })

    doc.save(`pressure_intelligence_${new Date().toISOString().slice(0,10)}.pdf`)
  }

  const hasActiveFilter = siteFilter || countryFilter || positionFilter || dateFrom || dateTo || inspectorFilter

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 space-y-5">
      <PageHeader
        title="Pressure Intelligence"
        subtitle={`Deep pressure monitoring, anomaly detection & compliance tracking${enriched.length > 0 ? ` · ${enriched.length.toLocaleString()} readings` : ''}`}
        icon={Gauge}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportExcel} disabled={enriched.length === 0} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40">
              <Download size={13} /> Excel
            </button>
            <button onClick={exportPdf} disabled={enriched.length === 0} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40">
              <FileText size={13} /> PDF
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={13} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-400">Filters</span>
          {hasActiveFilter && (
            <button
              onClick={() => { setSiteFilter(''); setCountryFilter(''); setPositionFilter(''); setDateFrom(''); setDateTo(''); setInspectorFilter('') }}
              className="ml-auto flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          <Select value={siteFilter} onChange={setSiteFilter} options={sites} placeholder="All Sites" />
          <Select value={countryFilter} onChange={setCountryFilter} options={countries} placeholder="All Countries" />
          <Select value={positionFilter} onChange={setPositionFilter} options={POSITIONS} placeholder="All Positions" />
          <Select value={inspectorFilter} onChange={setInspectorFilter} options={inspectors} placeholder="All Inspectors" />
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="From"
          />
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="To"
          />
        </div>
      </div>

      {/* Loading / Error / Empty */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={22} className="text-blue-400 animate-spin mr-2" />
          <span className="text-gray-400 text-sm">Loading pressure data…</span>
        </div>
      )}
      {error && (
        <div className="bg-red-950/30 border border-red-700/40 rounded-xl p-4 flex items-center gap-3">
          <XCircle size={16} className="text-red-400" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {enriched.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <Gauge size={40} className="text-gray-700" />
              <p className="text-gray-500 text-sm">No pressure readings found for the selected filters.</p>
            </div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">

              {/* Spec reference strip */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(SPEC).map(([pos, psi]) => (
                  <div key={pos} className="flex items-center gap-1.5 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-gray-400">{pos}:</span>
                    <span className="text-xs font-bold text-white">{psi} PSI</span>
                    <span className="text-xs text-gray-600">({Math.round(psi * 0.9)}–{Math.round(psi * 1.1)} OK)</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5">
                  <span className="text-xs text-gray-400">Default:</span>
                  <span className="text-xs font-bold text-white">105 PSI</span>
                </div>
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiCard
                  title="Pressure Compliance"
                  value={`${kpis.compliance}%`}
                  sub={`${kpis.total} readings analyzed`}
                  icon={CheckCircle}
                  color={Number(kpis.compliance) >= 95 ? 'green' : Number(kpis.compliance) >= 85 ? 'amber' : 'red'}
                />
                <KpiCard
                  title="Under-Inflated"
                  value={kpis.underCount}
                  sub="Below 90% of spec"
                  icon={TrendingDown}
                  color={kpis.underCount > 0 ? 'orange' : 'green'}
                />
                <KpiCard
                  title="Over-Inflated"
                  value={kpis.overCount}
                  sub="Above 110% of spec"
                  icon={TrendingUp}
                  color={kpis.overCount > 0 ? 'amber' : 'green'}
                />
                <KpiCard
                  title="Critical Under-Inflation"
                  value={kpis.criticalCount}
                  sub="Below 80% of spec"
                  icon={AlertTriangle}
                  color={kpis.criticalCount > 0 ? 'red' : 'green'}
                  alert={kpis.criticalCount > 0}
                />
                <KpiCard
                  title="Avg Deviation"
                  value={`${kpis.avgDev}%`}
                  sub="Mean abs deviation from spec"
                  icon={Gauge}
                  color={Number(kpis.avgDev) <= 5 ? 'green' : Number(kpis.avgDev) <= 10 ? 'amber' : 'red'}
                />
              </div>

              {/* Charts row 1 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Histogram */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={14} className="text-blue-400" />
                    <h3 className="text-sm font-semibold text-white">Pressure Distribution</h3>
                    <span className="ml-auto text-xs text-gray-500">All readings by PSI band</span>
                  </div>
                  <div className="h-56">
                    <Bar data={histogramData} options={histogramOpts} />
                  </div>
                  <div className="flex flex-wrap gap-3 mt-3">
                    {[
                      { color: 'bg-red-500', label: 'Critical zone' },
                      { color: 'bg-orange-500', label: 'Under-inflation' },
                      { color: 'bg-green-500', label: 'Acceptable range' },
                      { color: 'bg-amber-400', label: 'Over-inflation' },
                    ].map(l => (
                      <div key={l.label} className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
                        <span className="text-xs text-gray-500">{l.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Site compliance */}
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 size={14} className="text-purple-400" />
                    <h3 className="text-sm font-semibold text-white">Compliance by Site</h3>
                    <span className="ml-auto text-xs text-gray-500">Ranked best → worst</span>
                  </div>
                  {siteCompliance.length === 0 ? (
                    <div className="flex items-center justify-center h-56 text-gray-600 text-sm">No site data</div>
                  ) : (
                    <div className="h-56">
                      <Bar data={siteComplianceData} options={siteComplianceOpts} />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 mt-2">
                    {[
                      { color: 'bg-green-500', label: '≥95%' },
                      { color: 'bg-yellow-500', label: '≥85%' },
                      { color: 'bg-orange-500', label: '≥75%' },
                      { color: 'bg-red-500', label: '<75%' },
                    ].map(l => (
                      <div key={l.label} className="flex items-center gap-1.5">
                        <span className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
                        <span className="text-xs text-gray-500">{l.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Position trend */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={14} className="text-green-400" />
                  <h3 className="text-sm font-semibold text-white">Pressure Trend by Position</h3>
                  <span className="ml-auto text-xs text-gray-500">12-month monthly averages</span>
                </div>
                <div className="h-64">
                  <Line
                    data={positionTrend}
                    options={{
                      ...chartOpts(false, '', 'Avg Pressure (PSI)'),
                      plugins: {
                        legend: { labels: { color: '#9ca3af', font: { size: 10 } } },
                        tooltip: { backgroundColor: 'var(--panel)', titleColor: '#f9fafb', bodyColor: '#d1d5db', borderColor: 'var(--hairline)', borderWidth: 1 },
                      },
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-4 mt-2">
                  {Object.entries(SPEC).map(([pos, psi]) => (
                    <div key={pos} className="text-xs text-gray-500">
                      {pos} spec: <span className="text-gray-300 font-medium">{psi} PSI</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Seasonal analysis */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Thermometer size={14} className="text-amber-400" />
                  <h3 className="text-sm font-semibold text-white">Seasonal Pressure Analysis</h3>
                  <span className="ml-auto text-xs text-gray-500">Monthly avg + non-compliance rate</span>
                </div>
                <div className="h-64">
                  <Line data={seasonalData} options={seasonalOpts} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                  {seasonalData.avgs.map((avg, i) => avg !== null && (
                    <div key={i} className="bg-gray-800/50 rounded-lg p-2">
                      <p className="text-xs text-gray-500">{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i]}</p>
                      <p className="text-sm font-bold text-white">{Number(avg).toFixed(0)} PSI</p>
                      <p className="text-xs text-red-400">{seasonalData.ncPct[i]}% non-compliant</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Anomaly table */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-red-400" />
                    <h3 className="text-sm font-semibold text-white">Pressure Anomalies</h3>
                    <span className="text-xs px-2 py-0.5 bg-red-900/30 text-red-300 border border-red-700/40 rounded-full">
                      {anomalies.length}
                    </span>
                  </div>
                  <div className="sm:ml-auto flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                      <input
                        value={tableSearch}
                        onChange={e => { setTableSearch(e.target.value); setAnomalyPage(1) }}
                        placeholder="Search asset, serial, site…"
                        className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg pl-7 pr-3 py-2 w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <Select
                      value={sortAnomalies}
                      onChange={v => { setSortAnomalies(v); setAnomalyPage(1) }}
                      options={[{ value: 'severity', label: 'Sort: Severity' }, { value: 'deviation', label: 'Sort: Deviation' }, { value: 'date', label: 'Sort: Date' }]}
                      placeholder=""
                      className="w-40"
                    />
                  </div>
                </div>

                {anomalies.length === 0 ? (
                  <div className="flex flex-col items-center py-12 gap-2">
                    <CheckCircle size={28} className="text-green-500" />
                    <p className="text-gray-400 text-sm">No pressure anomalies detected — full compliance!</p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-700/60">
                            {['Asset', 'Position', 'Serial', 'Reading', 'Spec', 'Deviation', 'Status', 'Inspector', 'Date', 'Site', ''].map(h => (
                              <th key={h} className="text-left text-gray-500 pb-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {anomalyPageRows.map((r, i) => (
                            <tr
                              key={r.id ?? i}
                              className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors"
                            >
                              <td className="py-2 pr-3 text-white font-medium">{r.asset_no || '—'}</td>
                              <td className="py-2 pr-3 text-gray-300">{r.position || '—'}</td>
                              <td className="py-2 pr-3 text-gray-400 font-mono">{r.serial || '—'}</td>
                              <td className={`py-2 pr-3 font-bold ${r.status === 'critical_under' ? 'text-red-400' : r.status === 'under' ? 'text-orange-400' : 'text-amber-400'}`}>
                                {r.reading} PSI
                              </td>
                              <td className="py-2 pr-3 text-gray-400">{r.spec} PSI</td>
                              <td className="py-2 pr-3 text-gray-300">{r.devPct.toFixed(1)}%</td>
                              <td className="py-2 pr-3"><StatusBadge status={r.status} /></td>
                              <td className="py-2 pr-3 text-gray-400">{r.inspector || '—'}</td>
                              <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{r.date || '—'}</td>
                              <td className="py-2 pr-3 text-gray-400">{r.site || '—'}</td>
                              <td className="py-2">
                                <button
                                  onClick={() => setAssetDrilldown(r.asset_no === assetDrilldown ? null : r.asset_no)}
                                  className="p-1 text-gray-500 hover:text-blue-400 transition-colors"
                                  title="View asset history"
                                >
                                  <Eye size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between mt-3">
                      <p className="text-xs text-gray-500">
                        {(anomalyPage - 1) * ANOMALY_PAGE_SIZE + 1}–{Math.min(anomalyPage * ANOMALY_PAGE_SIZE, anomalies.length)} of {anomalies.length}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          disabled={anomalyPage === 1}
                          onClick={() => setAnomalyPage(p => p - 1)}
                          className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40 transition-colors"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <span className="text-xs text-gray-400 px-2">{anomalyPage} / {anomalyPageCount}</span>
                        <button
                          disabled={anomalyPage === anomalyPageCount}
                          onClick={() => setAnomalyPage(p => p + 1)}
                          className="p-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40 transition-colors"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Asset drilldown modal */}
              <AnimatePresence>
                {assetDrilldown && assetHistory.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="bg-gray-900 border border-blue-700/40 rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Eye size={14} className="text-blue-400" />
                        <span className="text-sm font-semibold text-white">Pressure History — {assetDrilldown}</span>
                        <span className="text-xs text-gray-500">{assetHistory.length} readings</span>
                      </div>
                      <button onClick={() => setAssetDrilldown(null)} className="text-gray-500 hover:text-white">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-700/60">
                            {['Date', 'Position', 'Serial', 'Reading', 'Spec', 'Dev %', 'Status', 'Inspector', 'Site'].map(h => (
                              <th key={h} className="text-left text-gray-500 pb-2 pr-3 font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {assetHistory.map((r, i) => (
                            <tr key={i} className="border-b border-gray-800/40">
                              <td className="py-1.5 pr-3 text-gray-400">{r.date || '—'}</td>
                              <td className="py-1.5 pr-3 text-gray-300">{r.position || '—'}</td>
                              <td className="py-1.5 pr-3 text-gray-400 font-mono">{r.serial || '—'}</td>
                              <td className={`py-1.5 pr-3 font-bold ${r.status === 'critical_under' ? 'text-red-400' : r.status === 'under' ? 'text-orange-400' : r.status === 'over' ? 'text-amber-400' : 'text-green-400'}`}>
                                {r.reading} PSI
                              </td>
                              <td className="py-1.5 pr-3 text-gray-500">{r.spec} PSI</td>
                              <td className="py-1.5 pr-3 text-gray-300">{r.devPct.toFixed(1)}%</td>
                              <td className="py-1.5 pr-3"><StatusBadge status={r.status} /></td>
                              <td className="py-1.5 pr-3 text-gray-400">{r.inspector || '—'}</td>
                              <td className="py-1.5 pr-3 text-gray-400">{r.site || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Inspector quality */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Users size={14} className="text-indigo-400" />
                  <h3 className="text-sm font-semibold text-white">Inspector Quality Analysis</h3>
                  <span className="ml-auto text-xs text-gray-500">{inspectorStats.length} inspectors</span>
                </div>
                {inspectorStats.length === 0 ? (
                  <p className="text-gray-500 text-sm py-6 text-center">No inspector data available</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-700/60">
                          {['Inspector', 'Total Readings', 'Avg Reading', 'Anomaly Rate', 'Consistency Score', 'Sites', 'Flag'].map(h => (
                            <th key={h} className="text-left text-gray-500 pb-2 pr-4 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {inspectorStats.map((ins, i) => (
                          <tr key={i} className={`border-b border-gray-800/50 ${ins.flag ? 'bg-yellow-950/10' : ''}`}>
                            <td className="py-2 pr-4 text-white font-medium">{ins.name}</td>
                            <td className="py-2 pr-4 text-gray-300">{ins.total}</td>
                            <td className="py-2 pr-4 text-gray-300">{ins.avg} PSI</td>
                            <td className={`py-2 pr-4 font-bold ${Number(ins.anomPct) > 30 ? 'text-red-400' : Number(ins.anomPct) > 15 ? 'text-orange-400' : 'text-green-400'}`}>
                              {ins.anomPct}%
                            </td>
                            <td className="py-2 pr-4">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-gray-800 rounded-full h-1.5 min-w-[60px]">
                                  <div
                                    className={`h-1.5 rounded-full ${Number(ins.consistency) >= 80 ? 'bg-green-500' : Number(ins.consistency) >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                    style={{ width: `${Math.min(100, Number(ins.consistency))}%` }}
                                  />
                                </div>
                                <span className="text-gray-300 text-xs">{ins.consistency}</span>
                              </div>
                            </td>
                            <td className="py-2 pr-4 text-gray-500 max-w-xs truncate">{ins.sites || '—'}</td>
                            <td className="py-2">
                              {ins.flag && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-300 border border-yellow-700/40 whitespace-nowrap">
                                  Review calibration
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Root cause panel */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Info size={14} className="text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">Under-Inflation Root Cause Analysis</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {rootCauses.map(rc => (
                    <div key={rc.cause} className={`rounded-xl border p-4 ${rc.bg}`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className={`text-sm font-semibold ${rc.color}`}>{rc.cause}</span>
                        <span className={`text-2xl font-bold ${rc.color}`}>{rc.count}</span>
                      </div>
                      <p className="text-xs text-gray-500 leading-snug">{rc.rec}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-600 mt-3 flex items-center gap-1">
                  <Info size={10} />
                  Root cause classification based on reading history patterns, tyre age, and seasonal data.
                </p>
              </div>

              {/* Summary intelligence strip */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Gauge size={14} className="text-blue-400" />
                  <h3 className="text-sm font-semibold text-white">Pressure Intelligence Summary</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    {
                      label: 'Compliance Health',
                      value: Number(kpis.compliance) >= 95 ? 'Excellent' : Number(kpis.compliance) >= 85 ? 'Acceptable' : 'Poor',
                      detail: `${kpis.compliance}% of readings within ±10% of spec`,
                      color: Number(kpis.compliance) >= 95 ? 'text-green-400' : Number(kpis.compliance) >= 85 ? 'text-yellow-400' : 'text-red-400',
                    },
                    {
                      label: 'Highest Risk Site',
                      value: siteCompliance.length > 0 ? siteCompliance[siteCompliance.length - 1]?.site || 'N/A' : 'N/A',
                      detail: siteCompliance.length > 0 ? `${siteCompliance[siteCompliance.length - 1]?.pct}% compliance` : 'No site data',
                      color: 'text-orange-400',
                    },
                    {
                      label: 'Best Performing Site',
                      value: siteCompliance[0]?.site || 'N/A',
                      detail: siteCompliance.length > 0 ? `${siteCompliance[0]?.pct}% compliance` : 'No site data',
                      color: 'text-green-400',
                    },
                    {
                      label: 'Critical Alert',
                      value: kpis.criticalCount > 0 ? `${kpis.criticalCount} Critical` : 'None',
                      detail: kpis.criticalCount > 0 ? 'Immediate inspection required' : 'No critical readings detected',
                      color: kpis.criticalCount > 0 ? 'text-red-400' : 'text-green-400',
                    },
                    {
                      label: 'Inspector Flags',
                      value: `${inspectorStats.filter(i => i.flag).length} flagged`,
                      detail: inspectorStats.filter(i => i.flag).length > 0
                        ? `Inspectors with >30% anomaly rate: ${inspectorStats.filter(i => i.flag).map(i => i.name).join(', ')}`
                        : 'All inspectors within normal range',
                      color: inspectorStats.filter(i => i.flag).length > 0 ? 'text-yellow-400' : 'text-green-400',
                    },
                    {
                      label: 'Fleet Avg Pressure',
                      value: enriched.length > 0
                        ? `${(enriched.reduce((s, r) => s + r.reading, 0) / enriched.length).toFixed(0)} PSI`
                        : 'N/A',
                      detail: 'Average across all positions and sites',
                      color: 'text-blue-400',
                    },
                  ].map(item => (
                    <div key={item.label} className="bg-gray-800/40 rounded-xl p-3 border border-gray-700/40">
                      <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                      <p className={`text-base font-bold ${item.color}`}>{item.value}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

            </motion.div>
          )}
        </>
      )}
    </div>
  )
}
