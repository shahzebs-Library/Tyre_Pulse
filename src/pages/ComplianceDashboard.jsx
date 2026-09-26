import { useState, useEffect, useMemo, useCallback } from 'react'
import PageHeader from '../components/ui/PageHeader'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  ShieldCheck, AlertTriangle, CheckCircle, XCircle, TrendingDown, TrendingUp,
  FileText, FileSpreadsheet, Filter, X, RefreshCw, BarChart3, ClipboardList, Gauge,
  Building2, Info, Calendar, Award, AlertCircle, ExternalLink, HelpCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import {
  resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme,
  exportSheetsToExcel, reportFileName, reportDateLabel,
} from '../lib/exportUtils'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { loadAutoTable } from '../lib/pdfEngine'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
import {
  LEGAL_MIN_TREAD, FLEET_MIN_TREAD, PRESSURE_MIN_PSI, PRESSURE_MAX_PSI,
  INSPECTION_MAX_DAYS, INSPECTION_DUE_DAYS, AREA_WEIGHTS, INSPECTION_LABEL, BAND_LABEL,
  treadStats as buildTreadStats, pressureStats as buildPressureStats, inspectionCompliance,
  overallScore as buildOverallScore, scoreBand, criticalCount as countCritical,
  fullyCompliantVehicles as countFullyCompliant, monthlyTreadTrend, treadDistribution,
  treadBySite as buildTreadBySite, pressureBySite as buildPressureBySite, inspectionBySite,
  nonCompliantTyres as buildNonCompliant, pressureExceptions,
} from '../lib/complianceDashboardAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

const TYRE_CAP = 50000

// Theme tokens resolve per light/dark via the global chartVarPlugin.
const TOOLTIP = {
  backgroundColor: 'var(--panel)',
  titleColor: 'var(--text-primary)',
  bodyColor: 'var(--text-secondary)',
  borderColor: 'var(--hairline)',
  borderWidth: 1,
}
const axis = (title) => ({
  grid: { color: 'var(--panel-2)' },
  ticks: { color: 'var(--text-muted)', font: { size: 10 } },
  title: title ? { display: true, text: title, color: 'var(--text-muted)', font: { size: 10 } } : { display: false },
})
const chartOpts = (horizontal = false, xLabel = '', yLabel = '') => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: horizontal ? 'y' : 'x',
  plugins: { legend: { labels: { color: 'var(--text-muted)', font: { size: 10 } } }, tooltip: TOOLTIP },
  scales: { x: axis(xLabel), y: axis(yLabel) },
})
const pctAxisOpts = (horizontal) => ({
  ...chartOpts(horizontal, horizontal ? 'Compliance %' : '', horizontal ? '' : 'Compliance %'),
  plugins: { legend: { display: false }, tooltip: { ...TOOLTIP, callbacks: { label: ctx => ` ${Number(horizontal ? ctx.parsed.x : ctx.parsed.y).toFixed(1)}%` } } },
  scales: horizontal
    ? { x: { ...axis('Compliance %'), min: 0, max: 100, ticks: { ...axis().ticks, callback: v => `${v}%` } }, y: axis() }
    : { x: axis(), y: { ...axis('Compliance %'), min: 0, max: 100, ticks: { ...axis().ticks, callback: v => `${v}%` } } },
})
const doughnutOpts = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '68%',
  plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-muted)', font: { size: 10 }, padding: 12 } }, tooltip: TOOLTIP },
}

// Semantic compliance colours (meaning-bearing; every use also carries a word).
const BAND = {
  good: { text: 'text-green-400', hex: '#22c55e' },
  marginal: { text: 'text-orange-400', hex: '#f97316' },
  poor: { text: 'text-red-400', hex: '#ef4444' },
  unknown: { text: 'text-[var(--text-muted)]', hex: '#6b7280' },
}
const pctColor = (pct) => (pct >= 90 ? '#22c55e' : pct >= 75 ? '#eab308' : pct >= 60 ? '#f97316' : '#ef4444')
const fmtPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(d)}%`)
const fmtDay = (d) => (d ? formatDate(d, 'All', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A')

const BTN = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] text-sm hover:bg-[var(--input-bg-hover)] transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const SELECT = 'min-h-[44px] w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

// ── Sub-components ────────────────────────────────────────────────────────────
function KpiCard({ title, value, sub, icon: Icon, tone }) {
  return (
    <div className="rounded-xl border border-[var(--input-border)] bg-[var(--surface-1)] p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-[var(--text-muted)]" aria-hidden="true" />
        <span className="text-xs text-[var(--text-muted)] font-medium">{title}</span>
      </div>
      <p className={`text-2xl font-bold leading-tight tabular-nums ${tone || 'text-[var(--text-primary)]'}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)]">{sub}</p>}
    </div>
  )
}

function InspectionBadge({ status }) {
  const map = {
    compliant: 'bg-green-500/20 text-green-300 border border-green-500/40',
    due_soon: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
    overdue: 'bg-red-500/20 text-red-300 border border-red-500/40',
    no_data: 'bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? map.no_data}`}>{INSPECTION_LABEL[status] ?? status}</span>
}

function RiskBadge({ risk }) {
  const map = {
    Critical: 'bg-red-500/20 text-red-300 border border-red-500/40',
    High: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
    Medium: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
    Low: 'bg-green-500/20 text-green-300 border border-green-500/40',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[risk] ?? 'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>{risk || 'Not rated'}</span>
}

function TreadBadge({ cls }) {
  if (cls === 'legal_fail') return <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-500/20 text-red-300 border border-red-500/40">Legal failure</span>
  if (cls === 'below_min') return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/40">Below fleet minimum</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]">Not measured</span>
}

function ComplianceGauge({ score, trend }) {
  const band = BAND[scoreBand(score)]
  const circumference = 2 * Math.PI * 52
  const dash = score != null ? (score / 100) * circumference : 0
  return (
    <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }} role="img"
      aria-label={score != null ? `Overall compliance ${score} percent` : 'Overall compliance not measured'}>
      <svg width={140} height={140} viewBox="0 0 140 140" aria-hidden="true">
        <circle cx={70} cy={70} r={52} fill="none" stroke="var(--input-border)" strokeWidth={10} />
        {score != null && (
          <circle cx={70} cy={70} r={52} fill="none" stroke={band.hex} strokeWidth={10} strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`} strokeDashoffset={circumference * 0.25}
            style={{ transition: 'stroke-dasharray 0.8s ease' }} />
        )}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-3xl font-black tabular-nums ${band.text}`}>{score != null ? `${score}%` : 'N/A'}</span>
        {trend != null && (
          <span className={`text-xs flex items-center gap-0.5 mt-0.5 ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? <TrendingUp size={11} aria-hidden="true" /> : <TrendingDown size={11} aria-hidden="true" />}
            {trend >= 0 ? 'up' : 'down'} {Math.abs(trend).toFixed(1)} pts
          </span>
        )}
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, right, children }) {
  return (
    <section className="bg-[var(--surface-2)] rounded-xl p-4 border border-[var(--input-border)] min-w-0">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Icon size={13} className="text-[var(--text-muted)]" aria-hidden="true" />
        <h3 className="text-sm font-medium text-[var(--text-primary)]">{title}</h3>
        {right && <span className="ml-auto text-xs text-[var(--text-muted)]">{right}</span>}
      </div>
      {children}
    </section>
  )
}

function StatStrip({ items }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(({ label, val, tone }) => (
        <div key={label} className="bg-[var(--surface-2)] rounded-xl p-3 border border-[var(--input-border)]">
          <p className="text-xs text-[var(--text-muted)]">{label}</p>
          <p className={`text-xl font-bold tabular-nums ${tone || 'text-[var(--text-primary)]'}`}>{val}</p>
        </div>
      ))}
    </div>
  )
}

const TABS = [
  { id: 'tread', label: 'Tread depth', icon: Gauge },
  { id: 'pressure', label: 'Pressure', icon: AlertCircle },
  { id: 'inspection', label: 'Inspection schedule', icon: ClipboardList },
]

// ── Main component ─────────────────────────────────────────────────────────────
export default function ComplianceDashboard() {
  const { activeCountry, appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'

  const [tyreRecords, setTyreRecords] = useState([])
  const [inspections, setInspections] = useState([])
  const [fleetMaster, setFleetMaster] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const [siteFilter, setSiteFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [activeTab, setActiveTab] = useState('tread')
  const [inspStatusFilter, setInspStatusFilter] = useState('')

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tr, ins, fm] = await Promise.all([
        // Country-scoped server side (the page applies the same strict rule
        // client-side) and bounded, with an id tiebreak for stable paging.
        fetchAllPages((from, to) => {
          let q = supabase
            .from('tyre_records')
            .select('id,asset_no,serial_number:serial_no,brand,size,position,site,country,tread_depth,pressure_reading,risk_level,issue_date,removal_date,category')
          if (activeCountry && activeCountry !== 'All') q = q.eq('country', activeCountry)
          return q.order('issue_date', { ascending: false }).order('id').range(from, to)
        }, { max: TYRE_CAP }),
        fetchAllPages((from, to) => supabase
          .from('inspections')
          // `country` is selected because the page filters on it.
          .select('id,asset_no,site,country,scheduled_date,status,inspection_type,findings,inspector')
          .order('scheduled_date', { ascending: false })
          .order('id')
          .range(from, to), { max: TYRE_CAP }),
        // PAGED: this register is the DENOMINATOR of inspection compliance, so a
        // silent 1,000-row cap would inflate the score.
        fetchAllPages((from, to) => supabase
          .from('fleet_master')
          .select('asset_no,site,country,vehicle_type,status')
          .order('asset_no').order('id')
          .range(from, to), { max: 20000 }),
      ])
      const firstError = tr.error || ins.error || fm.error
      if (firstError) throw firstError
      setTyreRecords(tr.data || [])
      setInspections(ins.data || [])
      setFleetMaster(fm.data || [])
      setTruncated(!!(tr.truncated || ins.truncated || fm.truncated))
      setLastRefresh(new Date())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load compliance data. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Filter options ──────────────────────────────────────────────────────────
  const sites = useMemo(() => [...new Set([...tyreRecords.map(r => r.site), ...inspections.map(r => r.site)].filter(Boolean))].sort(), [tyreRecords, inspections])
  const countries = useMemo(() => [...new Set(tyreRecords.map(r => r.country).filter(Boolean))].sort(), [tyreRecords])

  // ── Scoped populations ──────────────────────────────────────────────────────
  const filteredTyres = useMemo(() => {
    let d = [...tyreRecords]
    if (activeCountry !== 'All') d = d.filter(r => r.country === activeCountry)
    if (countryFilter) d = d.filter(r => r.country === countryFilter)
    if (siteFilter) d = d.filter(r => r.site === siteFilter)
    return d
  }, [tyreRecords, activeCountry, countryFilter, siteFilter])

  /**
   * THE country rule for inspections and the fleet register. NULL-SAFE, like
   * `applyCountry` and the country RLS policies: an unattributed row is not
   * another country's, so hiding it would delete real work from both halves
   * of the percentage.
   */
  const matchesCountry = useCallback((row) => {
    if (activeCountry !== 'All' && row.country && row.country !== activeCountry) return false
    if (countryFilter && row.country && row.country !== countryFilter) return false
    return true
  }, [activeCountry, countryFilter])

  const filteredInspections = useMemo(() => {
    let d = inspections.filter(matchesCountry)
    if (siteFilter) d = d.filter(r => r.site === siteFilter)
    return d
  }, [inspections, siteFilter, matchesCountry])

  // The inspection-compliance DENOMINATOR, scoped exactly like the numerator.
  const scopedFleet = useMemo(() => {
    let d = fleetMaster.filter(matchesCountry)
    if (siteFilter) d = d.filter(v => v.site === siteFilter)
    return d
  }, [fleetMaster, siteFilter, matchesCountry])

  // ── Engine ──────────────────────────────────────────────────────────────────
  const treadStats = useMemo(() => buildTreadStats(filteredTyres), [filteredTyres])
  const pressureStats = useMemo(() => buildPressureStats(filteredTyres), [filteredTyres])
  const inspectionStats = useMemo(() => inspectionCompliance(filteredInspections, scopedFleet), [filteredInspections, scopedFleet])
  const overall = useMemo(() => buildOverallScore({ tread: treadStats.pct, pressure: pressureStats.pct, inspection: inspectionStats.pct }), [treadStats, pressureStats, inspectionStats])
  const overallScore = overall.score
  const band = scoreBand(overallScore)
  const criticalCount = useMemo(() => countCritical(filteredTyres), [filteredTyres])
  const fullyCompliantVehicles = useMemo(() => countFullyCompliant(filteredTyres), [filteredTyres])
  const complianceTrend = useMemo(() => monthlyTreadTrend(filteredTyres), [filteredTyres])
  const treadBySite = useMemo(() => buildTreadBySite(filteredTyres), [filteredTyres])
  const pressureBySite = useMemo(() => buildPressureBySite(filteredTyres), [filteredTyres])
  const inspBySite = useMemo(() => inspectionBySite(inspectionStats.rows), [inspectionStats])
  const nonCompliantTyres = useMemo(() => buildNonCompliant(filteredTyres), [filteredTyres])
  const pressureAnomalies = useMemo(() => pressureExceptions(filteredTyres), [filteredTyres])
  const inspectionRows = useMemo(
    () => (inspStatusFilter ? inspectionStats.rows.filter(r => r.status === inspStatusFilter) : inspectionStats.rows),
    [inspectionStats, inspStatusFilter],
  )
  const overdueCount = inspectionStats.overdue
  const legalFailures = useMemo(() => nonCompliantTyres.filter(r => r.tread_class === 'legal_fail'), [nonCompliantTyres])

  // ── Charts ──────────────────────────────────────────────────────────────────
  const treadDistChart = useMemo(() => {
    const dist = treadDistribution(filteredTyres)
    const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a']
    return {
      labels: dist.map(b => b.label),
      datasets: [{ label: 'Tyres', data: dist.map(b => b.count), backgroundColor: colors, borderRadius: 4 }],
    }
  }, [filteredTyres])
  const treadBySiteChart = useMemo(() => ({
    labels: treadBySite.map(s => s.site),
    datasets: [{ label: 'Tread compliance %', data: treadBySite.map(s => Number(s.pct.toFixed(1))), backgroundColor: treadBySite.map(s => pctColor(s.pct)), borderRadius: 3 }],
  }), [treadBySite])
  const pressureDoughnutData = useMemo(() => ({
    labels: ['In band', 'Out of band', 'No reading'],
    datasets: [{ data: [pressureStats.compliant, pressureStats.anomalies, pressureStats.noReading], backgroundColor: ['#22c55e', '#ef4444', '#6b7280'], borderWidth: 1 }],
  }), [pressureStats])
  const pressureBySiteChart = useMemo(() => ({
    labels: pressureBySite.map(s => s.site),
    datasets: [{ label: 'Pressure compliance %', data: pressureBySite.map(s => Number(s.pct.toFixed(1))), backgroundColor: pressureBySite.map(s => pctColor(s.pct)), borderRadius: 3 }],
  }), [pressureBySite])
  const inspBySiteChart = useMemo(() => ({
    labels: inspBySite.map(s => s.site),
    datasets: [
      { label: 'Compliant', data: inspBySite.map(s => s.compliant), backgroundColor: '#22c55e', borderRadius: 3 },
      { label: 'Due soon', data: inspBySite.map(s => s.due_soon), backgroundColor: '#eab308', borderRadius: 3 },
      { label: 'Overdue', data: inspBySite.map(s => s.overdue), backgroundColor: '#ef4444', borderRadius: 3 },
      { label: 'Never inspected', data: inspBySite.map(s => s.no_data), backgroundColor: '#6b7280', borderRadius: 3 },
    ],
  }), [inspBySite])
  const trendLineChart = useMemo(() => ({
    labels: complianceTrend.months.map(m => { const [y, mo] = m.split('-'); return new Date(y, Number(mo) - 1).toLocaleString('en', { month: 'short', year: '2-digit' }) }),
    datasets: [{
      label: 'Tread compliance %', data: complianceTrend.values,
      borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)', borderWidth: 2, pointRadius: 4,
      pointBackgroundColor: '#22c55e', tension: 0.3, fill: true, spanGaps: true,
    }],
  }), [complianceTrend])

  // ── Table columns ───────────────────────────────────────────────────────────
  const treadColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: r => r.asset_no || '' },
    { id: 'serial', header: 'Serial', accessorFn: r => r.serial_number || '', cell: ({ getValue }) => <span className="font-mono text-[11px]">{getValue() || 'N/A'}</span> },
    { id: 'position', header: 'Position', accessorFn: r => r.position || '' },
    { id: 'brand', header: 'Brand', accessorFn: r => r.brand || '' },
    {
      id: 'tread', header: 'Tread (mm)', accessorFn: r => (r.tread_depth != null ? Number(r.tread_depth) : -1), meta: { align: 'right', exportValue: r => (r.tread_depth != null ? Number(r.tread_depth).toFixed(1) : 'N/A') },
      cell: ({ row }) => row.original.tread_depth != null
        ? <span className={`tabular-nums font-bold ${row.original.tread_class === 'legal_fail' ? 'text-red-400' : 'text-orange-400'}`}>{Number(row.original.tread_depth).toFixed(1)}</span>
        : <span className="text-[var(--text-dim)]">N/A</span>,
    },
    { id: 'site', header: 'Site', accessorFn: r => r.site || '', meta: { filterVariant: 'select' } },
    { id: 'days', header: 'Days in service', accessorFn: r => r.days_in_service ?? -1, meta: { align: 'right', exportValue: r => r.days_in_service ?? 'N/A' }, cell: ({ row }) => <span className="tabular-nums">{row.original.days_in_service ?? 'N/A'}</span> },
    { id: 'risk', header: 'Risk', accessorFn: r => r.risk_level || '', cell: ({ row }) => <RiskBadge risk={row.original.risk_level} /> },
    {
      id: 'status', header: 'Status', accessorFn: r => ({ legal_fail: 0, below_min: 1, no_data: 2 }[r.tread_class] ?? 3), meta: { exportValue: r => ({ legal_fail: 'Legal failure', below_min: 'Below fleet minimum', no_data: 'Not measured' }[r.tread_class]) },
      cell: ({ row }) => <TreadBadge cls={row.original.tread_class} />,
    },
  ], [])

  const pressureColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: r => r.asset_no || '' },
    { id: 'serial', header: 'Serial', accessorFn: r => r.serial_number || '', cell: ({ getValue }) => <span className="font-mono text-[11px]">{getValue() || 'N/A'}</span> },
    { id: 'brand', header: 'Brand', accessorFn: r => r.brand || '' },
    { id: 'position', header: 'Position', accessorFn: r => r.position || '' },
    {
      id: 'psi', header: 'Pressure', accessorFn: r => Number(r.pressure_reading) || -1, meta: { align: 'right', exportValue: r => (Number(r.pressure_reading) > 0 ? `${Number(r.pressure_reading).toFixed(0)} PSI` : 'N/A') },
      cell: ({ row }) => Number(row.original.pressure_reading) > 0
        ? <span className="tabular-nums font-bold text-orange-400">{Number(row.original.pressure_reading).toFixed(0)} PSI</span>
        : <span className="text-[var(--text-dim)]">N/A</span>,
    },
    { id: 'site', header: 'Site', accessorFn: r => r.site || '', meta: { filterVariant: 'select' } },
    { id: 'risk', header: 'Risk', accessorFn: r => r.risk_level || '', cell: ({ row }) => <RiskBadge risk={row.original.risk_level} /> },
    {
      id: 'flag', header: 'Flag', accessorFn: r => r.pressureFlag, meta: { filterVariant: 'select' },
      cell: ({ row }) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${row.original.pressureFlag === 'Anomaly' ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40' : 'bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]'}`}>
          {row.original.pressureFlag === 'Anomaly' ? 'Out of band' : 'No reading'}
        </span>
      ),
    },
  ], [])

  const inspectionColumns = useMemo(() => [
    { id: 'asset', header: 'Asset no', accessorFn: r => r.asset_no || '' },
    { id: 'type', header: 'Vehicle type', accessorFn: r => r.vehicle_type || '', cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: r => r.site || '', meta: { filterVariant: 'select' }, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'last', header: 'Last inspection', accessorFn: r => r.last_inspection || '', meta: { exportValue: r => (r.last_inspection ? fmtDay(r.last_inspection) : 'Never') }, cell: ({ row }) => row.original.last_inspection ? fmtDay(row.original.last_inspection) : <span className="text-[var(--text-dim)]">Never</span> },
    {
      id: 'days', header: 'Days since', accessorFn: r => r.days_since ?? Number.MAX_SAFE_INTEGER, meta: { align: 'right', exportValue: r => r.days_since ?? 'N/A' },
      cell: ({ row }) => {
        const d = row.original.days_since
        if (d == null) return <span className="text-[var(--text-dim)]">N/A</span>
        return <span className={`tabular-nums font-medium ${d > INSPECTION_DUE_DAYS ? 'text-red-400' : d > INSPECTION_MAX_DAYS ? 'text-yellow-400' : ''}`}>{d}d</span>
      },
    },
    { id: 'next', header: 'Next due', accessorFn: r => r.next_due || '', meta: { exportValue: r => fmtDay(r.next_due) }, cell: ({ row }) => fmtDay(row.original.next_due) },
    { id: 'status', header: 'Status', accessorFn: r => ({ overdue: 0, due_soon: 1, no_data: 2, compliant: 3 }[r.status]), meta: { exportValue: r => INSPECTION_LABEL[r.status] }, cell: ({ row }) => <InspectionBadge status={row.original.status} /> },
    { id: 'inspector', header: 'Inspector', accessorFn: r => r.inspector || '', cell: ({ getValue }) => getValue() || 'N/A' },
  ], [])

  // ── Exports ─────────────────────────────────────────────────────────────────
  const scopeLabel = [activeCountry !== 'All' ? activeCountry : null, countryFilter || null, siteFilter || null].filter(Boolean).join(', ') || 'All data'
  const fileBase = (what) => reportFileName('TyrePulse', what, scopeLabel !== 'All data' ? scopeLabel : null, reportDateLabel())

  async function exportTreadPdf() {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const sub = `Fleet min ${FLEET_MIN_TREAD} mm, legal min ${LEGAL_MIN_TREAD} mm, scope: ${scopeLabel}`
    pdfHeader(doc, 'Tread Depth Compliance Report', sub, company, brand)
    doc.setFontSize(11)
    doc.setTextColor(40, 40, 40)
    doc.text('Compliance Summary', 14, 30)
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 33,
      head: [['Metric', 'Value']],
      body: [
        ['Tread compliance', fmtPct(treadStats.pct)],
        ['Total tyres', String(treadStats.total)],
        ['Tyres with a tread reading', String(treadStats.withData)],
        [`At or above fleet minimum (${FLEET_MIN_TREAD} mm)`, String(treadStats.compliant)],
        [`Below fleet minimum (${FLEET_MIN_TREAD} mm)`, String(treadStats.fleetFail)],
        [`Below legal minimum (${LEGAL_MIN_TREAD} mm)`, String(treadStats.legalFail)],
        ['No tread reading', String(treadStats.noData)],
      ],
      columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 50 } },
    })
    doc.addPage()
    pdfHeader(doc, 'Non-Compliant Tyre List', sub, company, brand)
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 28,
      head: [['Asset', 'Serial', 'Brand', 'Position', 'Tread (mm)', 'Site', 'Days In Service', 'Risk', 'Status']],
      body: nonCompliantTyres.map(r => [
        r.asset_no || 'N/A', r.serial_number || 'N/A', r.brand || 'N/A', r.position || 'N/A',
        r.tread_depth != null ? Number(r.tread_depth).toFixed(1) : 'N/A',
        r.site || 'N/A', r.days_in_service ?? 'N/A', r.risk_level || 'N/A',
        { legal_fail: 'LEGAL FAILURE', below_min: 'Below fleet min', no_data: 'Not measured' }[r.tread_class],
      ]),
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 8 && String(data.cell.raw || '').includes('LEGAL')) {
          data.cell.styles.textColor = [220, 38, 38]
          data.cell.styles.fontStyle = 'bold'
        }
      },
    })
    const pgCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pgCount; i++) { doc.setPage(i); pdfFooter(doc, i, pgCount, company, brand) }
    doc.save(`${fileBase('Tread Compliance')}.pdf`)
  }

  const buildCertificatePdf = useCallback(async ({ returnBase64 = false } = {}) => {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const W = doc.internal.pageSize.width
    const H = doc.internal.pageSize.height
    const now = new Date()
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const ref = `TPC-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    pdfHeader(doc, 'Fleet Tyre Compliance Assessment', `Issued ${dateStr}, reference ${ref}, scope: ${scopeLabel}`, company, brand)
    doc.setFillColor(243, 244, 246)
    doc.roundedRect(14, 42, 80, 30, 3, 3, 'F')
    doc.setFontSize(28)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(17, 24, 39)
    doc.text(overallScore != null ? `${overallScore}%` : 'N/A', 54, 60, { align: 'center' })
    doc.setFontSize(9)
    doc.setTextColor(75, 85, 99)
    doc.text(`Overall score (${overall.covered.length ? overall.covered.join(', ') : 'nothing measured'})`, 54, 68, { align: 'center' })

    doc.setFontSize(11)
    doc.setTextColor(40, 40, 40)
    doc.text('Compliance Area Summary', 14, 82)
    const verdict = (pct) => (pct == null ? 'NOT MEASURED' : pct >= 80 ? 'COMPLIANT' : 'NON-COMPLIANT')
    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 85,
      head: [['Area', 'Score', 'Status', 'Details']],
      body: [
        ['Tread depth', fmtPct(treadStats.pct), verdict(treadStats.pct), `${treadStats.compliant}/${treadStats.withData} measured tyres at or above ${FLEET_MIN_TREAD} mm; ${treadStats.noData} not measured`],
        ['Pressure', fmtPct(pressureStats.pct), verdict(pressureStats.pct), `${pressureStats.compliant} in band (${PRESSURE_MIN_PSI} to ${PRESSURE_MAX_PSI} PSI), ${pressureStats.anomalies} out of band, ${pressureStats.noReading} no reading`],
        ['Inspection schedule', fmtPct(inspectionStats.pct), verdict(inspectionStats.pct), `${inspectionStats.compliant}/${inspectionStats.total} vehicles inspected within ${INSPECTION_MAX_DAYS} days`],
        ['Critical risk tyres', criticalCount === 0 ? 'Pass' : 'Fail', criticalCount === 0 ? 'PASS' : 'FAIL', criticalCount === 0 ? 'No critical-risk tyres in scope' : `${criticalCount} critical-risk tyres need immediate action`],
      ],
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 2) {
          const raw = String(data.cell.raw || '')
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.textColor = raw.includes('NON-COMPLIANT') || raw.includes('FAIL') ? [220, 38, 38] : raw.includes('NOT MEASURED') ? [107, 114, 128] : [22, 163, 74]
        }
      },
    })

    if (legalFailures.length > 0) {
      doc.addPage()
      doc.setFillColor(220, 38, 38)
      doc.rect(0, 0, W, 16, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text(`LEGAL COMPLIANCE FAILURES: ${legalFailures.length} tyre(s) below ${LEGAL_MIN_TREAD} mm`, 14, 10)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 20,
        head: [['Asset', 'Serial', 'Brand', 'Position', 'Tread (mm)', 'Site', 'Risk Level']],
        body: legalFailures.map(r => [r.asset_no || 'N/A', r.serial_number || 'N/A', r.brand || 'N/A', r.position || 'N/A', Number(r.tread_depth).toFixed(1), r.site || 'N/A', r.risk_level || 'N/A']),
        headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 8, textColor: [220, 38, 38] },
      })
    }

    doc.addPage()
    doc.setFillColor(22, 101, 52)
    doc.rect(0, 0, W, 16, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('Assessment Declaration', 14, 10)
    doc.setTextColor(40, 40, 40)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    ;[
      `This assessment of fleet tyre compliance was generated on ${dateStr} for: ${scopeLabel}.`,
      `It covers tread depth against the ${FLEET_MIN_TREAD} mm fleet minimum and the ${LEGAL_MIN_TREAD} mm legal minimum,`,
      `tyre pressure against a ${PRESSURE_MIN_PSI} to ${PRESSURE_MAX_PSI} PSI band, and inspection intervals of ${INSPECTION_MAX_DAYS} days.`,
      '',
      `Overall score: ${overallScore != null ? `${overallScore}%` : 'N/A'}. Areas measured: ${overall.covered.join(', ') || 'none'}. Not measured: ${overall.missing.join(', ') || 'none'}.`,
      `Tread ${fmtPct(treadStats.pct)} | Pressure ${fmtPct(pressureStats.pct)} | Inspection ${fmtPct(inspectionStats.pct)} | Tyres assessed ${treadStats.total}`,
    ].forEach((line, i) => doc.text(line, 14, 28 + i * 7))
    doc.setDrawColor(100, 100, 100)
    doc.line(14, H - 30, 100, H - 30)
    doc.line(W - 100, H - 30, W - 14, H - 30)
    doc.setFontSize(8)
    doc.setTextColor(100, 100, 100)
    doc.text('Prepared by TyrePulse Fleet Management System', 14, H - 24)
    doc.text('Authorised Signature', W - 100, H - 24)
    doc.setFontSize(7)
    doc.text(`Generated: ${now.toLocaleString('en-GB')}`, 14, H - 18)
    doc.text(`Reference: ${ref}`, W - 14, H - 18, { align: 'right' })

    const pgCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pgCount; i++) { doc.setPage(i); pdfFooter(doc, i, pgCount, company, brand) }
    if (returnBase64) return doc.output('datauristring').split(',')[1]
    doc.save(`${reportFileName('TyrePulse Compliance Assessment', scopeLabel !== 'All data' ? scopeLabel : null, reportDateLabel())}.pdf`)
    return null
  }, [branding, company, scopeLabel, overallScore, overall, treadStats, pressureStats, inspectionStats, criticalCount, legalFailures])

  async function exportExcel() {
    await exportSheetsToExcel([
      {
        name: 'Summary',
        columns: ['metric', 'value'],
        headers: ['Metric', 'Value'],
        rows: [
          { metric: 'Overall compliance score', value: overallScore != null ? `${overallScore}%` : 'N/A' },
          { metric: 'Areas in the overall score', value: overall.covered.join(', ') || 'none' },
          { metric: 'Tread compliance', value: fmtPct(treadStats.pct) },
          { metric: 'Pressure compliance', value: fmtPct(pressureStats.pct) },
          { metric: 'Inspection compliance', value: fmtPct(inspectionStats.pct) },
          { metric: 'Critical tyres', value: criticalCount },
          { metric: 'Fully compliant vehicles', value: fullyCompliantVehicles },
          { metric: `Legal failures (below ${LEGAL_MIN_TREAD} mm)`, value: treadStats.legalFail },
        ],
      },
      {
        name: 'Tread Non-Compliant',
        note: 'Tyres below the fleet minimum, or with no tread reading',
        columns: ['asset', 'serial', 'brand', 'size', 'position', 'tread', 'site', 'country', 'days', 'risk', 'status'],
        headers: ['Asset No', 'Serial', 'Brand', 'Size', 'Position', 'Tread Depth mm', 'Site', 'Country', 'Days in Service', 'Risk Level', 'Status'],
        rows: nonCompliantTyres.map(r => ({
          asset: r.asset_no || '', serial: r.serial_number || '', brand: r.brand || '', size: r.size || '', position: r.position || '',
          tread: r.tread_depth != null ? Number(r.tread_depth).toFixed(1) : 'N/A', site: r.site || '', country: r.country || '',
          days: r.days_in_service ?? 'N/A', risk: r.risk_level || 'N/A',
          status: { legal_fail: 'Legal failure', below_min: 'Below fleet minimum', no_data: 'Not measured' }[r.tread_class],
        })),
      },
      {
        name: 'Pressure Exceptions',
        note: `Tyres outside ${PRESSURE_MIN_PSI} to ${PRESSURE_MAX_PSI} PSI, or with no reading`,
        columns: ['asset', 'serial', 'position', 'psi', 'site', 'flag'],
        headers: ['Asset No', 'Serial', 'Position', 'Pressure PSI', 'Site', 'Flag'],
        rows: pressureAnomalies.map(r => ({
          asset: r.asset_no || '', serial: r.serial_number || '', position: r.position || '',
          psi: Number(r.pressure_reading) > 0 ? Number(r.pressure_reading) : 'N/A', site: r.site || '',
          flag: r.pressureFlag === 'Anomaly' ? 'Out of band' : 'No reading',
        })),
      },
      {
        name: 'Inspection Schedule',
        columns: ['asset', 'type', 'site', 'last', 'days', 'next', 'status', 'inspector'],
        headers: ['Asset No', 'Vehicle Type', 'Site', 'Last Inspection', 'Days Since', 'Next Due', 'Status', 'Inspector'],
        rows: inspectionStats.rows.map(r => ({
          asset: r.asset_no, type: r.vehicle_type || 'N/A', site: r.site || 'N/A', last: r.last_inspection || 'Never',
          days: r.days_since ?? 'N/A', next: r.next_due || 'N/A', status: INSPECTION_LABEL[r.status], inspector: r.inspector || 'N/A',
        })),
      },
    ], fileBase('Compliance Dashboard'), { title: 'Compliance Dashboard', company, meta: { Scope: scopeLabel } })
  }

  const hasFilter = !!(siteFilter || countryFilter)
  const noData = tyreRecords.length === 0 && inspections.length === 0 && fleetMaster.length === 0
  const exportDisabled = loading || !!error || noData

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 min-w-0">
      <PageHeader
        title="Compliance Dashboard"
        subtitle={`Tread depth, pressure and inspection schedule compliance${lastRefresh ? `. Last refresh ${lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`}
        icon={ShieldCheck}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={fetchData} disabled={loading} className={BTN}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
            <EmailPdfButton
              className={BTN}
              disabled={exportDisabled}
              label="Email assessment"
              getPdf={async () => ({
                base64: await buildCertificatePdf({ returnBase64: true }),
                filename: `${reportFileName('TyrePulse Compliance Assessment', reportDateLabel())}.pdf`,
                subject: 'Fleet tyre compliance assessment',
                bodyHtml: `<p>Attached is the fleet tyre compliance assessment (${scopeLabel}). Overall score: ${overallScore != null ? `${overallScore}%` : 'N/A'}.</p>`,
              })}
            />
            <button type="button" onClick={exportExcel} disabled={exportDisabled} className={BTN}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => buildCertificatePdf()} disabled={exportDisabled} className={BTN}>
              <Award size={14} aria-hidden="true" /> Assessment PDF
            </button>
          </div>
        }
      />

      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={13} className="text-[var(--text-muted)]" aria-hidden="true" />
          <h2 className="text-xs font-medium text-[var(--text-muted)]">Filters</h2>
          {hasFilter && (
            <button type="button" onClick={() => { setSiteFilter(''); setCountryFilter('') }} className={`${BTN} ml-auto text-xs`}>
              <X size={12} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <select aria-label="Filter by site" value={siteFilter} onChange={e => setSiteFilter(e.target.value)} className={SELECT}>
            <option value="">All sites</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select aria-label="Filter by country" value={countryFilter} onChange={e => setCountryFilter(e.target.value)} className={SELECT}>
            <option value="">All countries</option>
            {countries.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex items-center gap-2 sm:col-span-2 bg-[var(--surface-2)] rounded-lg px-3 py-2">
            <Info size={12} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
            <span className="text-xs text-[var(--text-muted)]">
              Standards: tread at least {FLEET_MIN_TREAD} mm (legal minimum {LEGAL_MIN_TREAD} mm), pressure {PRESSURE_MIN_PSI} to {PRESSURE_MAX_PSI} PSI, inspection every {INSPECTION_MAX_DAYS} days
            </span>
          </div>
        </div>
      </div>

      {truncated && (
        <p role="status" className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
          <Info size={12} aria-hidden="true" /> Capped view: the newest {TYRE_CAP.toLocaleString()} records per source were read. Narrow the country for the full set.
        </p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-24" role="status">
          <RefreshCw size={22} className="text-[var(--text-muted)] animate-spin mr-2" aria-hidden="true" />
          <span className="text-[var(--text-muted)] text-sm">Loading compliance data</span>
        </div>
      )}
      {error && (
        <div role="alert" className="bg-red-950/30 border border-red-700/40 rounded-xl p-4 flex flex-wrap items-center gap-3">
          <XCircle size={16} className="text-red-400" aria-hidden="true" />
          <p className="text-sm text-red-300">{error}</p>
          <button type="button" onClick={fetchData} className={`${BTN} ml-auto`}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {!loading && !error && noData && (
        <div className="card flex flex-col items-center justify-center py-20 gap-3 text-center">
          <ShieldCheck size={44} className="text-[var(--text-dim)]" aria-hidden="true" />
          <p className="text-[var(--text-secondary)] font-medium">No compliance data yet</p>
          <p className="text-[var(--text-muted)] text-sm max-w-md">Compliance is measured from tyre records, inspections and the fleet register. None exist for this country yet.</p>
        </div>
      )}

      {!loading && !error && !noData && (
        <div className="space-y-5">
          {/* Every percentage below is computed over the same scoped population. */}
          {(hasFilter || activeCountry !== 'All') && (
            <p className="text-xs text-[var(--text-muted)]">
              These figures cover the {treadStats.total.toLocaleString()} tyre{treadStats.total === 1 ? '' : 's'} and {inspectionStats.total.toLocaleString()} asset{inspectionStats.total === 1 ? '' : 's'} matching your filters, of {tyreRecords.length.toLocaleString()} tyres and {fleetMaster.length.toLocaleString()} assets loaded.
            </p>
          )}

          <section className="rounded-xl border border-[var(--input-border)] bg-[var(--surface-1)] p-5" aria-label="Overall compliance">
            <div className="flex flex-col lg:flex-row gap-6 items-center lg:items-start">
              <div className="flex flex-col items-center gap-2 shrink-0">
                <ComplianceGauge score={overallScore} trend={complianceTrend.trend} />
                <div className={`text-xs font-bold px-3 py-1 rounded-full border border-[var(--input-border)] ${BAND[band].text}`}>
                  {BAND_LABEL[band]}
                </div>
                {overall.missing.length > 0 && overallScore != null && (
                  <p className="text-[11px] text-[var(--text-muted)] text-center max-w-[180px]">Score covers {overall.covered.join(' and ')} only. {overall.missing.join(' and ')} not measured.</p>
                )}
              </div>

              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                {[
                  { key: 'tread', label: 'Tread depth', pct: treadStats.pct, basis: `${treadStats.withData} of ${treadStats.total} tyres measured`, icon: Gauge },
                  { key: 'pressure', label: 'Pressure', pct: pressureStats.pct, basis: `${pressureStats.withReading} of ${pressureStats.total} tyres with a reading`, icon: AlertCircle },
                  { key: 'inspection', label: 'Inspection', pct: inspectionStats.pct, basis: `${inspectionStats.total} vehicles in scope`, icon: ClipboardList },
                ].map(({ key, label, pct, basis, icon: Icon }) => {
                  const b = BAND[scoreBand(pct)]
                  return (
                    <div key={key} className="bg-[var(--surface-2)] rounded-xl p-4 border border-[var(--input-border)]">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon size={13} className="text-[var(--text-muted)]" aria-hidden="true" />
                        <span className="text-xs text-[var(--text-muted)]">{label}</span>
                        <span className="ml-auto text-xs text-[var(--text-dim)]">Weight {Math.round(AREA_WEIGHTS[key] * 100)}%</span>
                      </div>
                      <p className={`text-2xl font-black tabular-nums ${b.text}`}>{fmtPct(pct)}</p>
                      <div className="mt-2 h-1.5 bg-[var(--input-bg)] rounded-full overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct ?? 0}%`, backgroundColor: b.hex }} />
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] mt-1.5">{basis}</p>
                    </div>
                  )
                })}
              </div>

              <dl className="shrink-0 flex flex-col gap-3 min-w-[180px] w-full lg:w-auto">
                <div className="bg-[var(--surface-2)] rounded-xl p-3 border border-[var(--input-border)]">
                  <dt className="text-xs text-[var(--text-muted)] mb-1">Assessed</dt>
                  <dd className="text-sm font-semibold text-[var(--text-primary)]">{lastRefresh ? fmtDay(lastRefresh.toISOString()) : 'N/A'}</dd>
                </div>
                <div className="bg-[var(--surface-2)] rounded-xl p-3 border border-[var(--input-border)]">
                  <dt className="text-xs text-[var(--text-muted)] mb-1">Critical-risk tyres</dt>
                  <dd className={`text-sm font-semibold ${criticalCount > 0 ? 'text-red-400' : 'text-green-400'}`}>{criticalCount > 0 ? `${criticalCount} critical` : 'None'}</dd>
                </div>
                <div className="bg-[var(--surface-2)] rounded-xl p-3 border border-[var(--input-border)]">
                  <dt className="text-xs text-[var(--text-muted)] mb-1">Overdue inspections</dt>
                  <dd className={`text-sm font-semibold ${overdueCount > 0 ? 'text-red-400' : 'text-green-400'}`}>{overdueCount > 0 ? `${overdueCount} overdue` : 'None overdue'}</dd>
                </div>
              </dl>
            </div>
          </section>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard title="Tread compliance" value={fmtPct(treadStats.pct)} sub={`${treadStats.compliant} of ${treadStats.withData} measured tyres`} icon={Gauge} tone={BAND[scoreBand(treadStats.pct)].text} />
            <KpiCard title="Legal failures" value={treadStats.legalFail.toLocaleString()} sub={`below ${LEGAL_MIN_TREAD} mm`} icon={AlertTriangle} tone={treadStats.legalFail > 0 ? 'text-red-400' : 'text-green-400'} />
            <KpiCard title="Pressure compliance" value={fmtPct(pressureStats.pct)} sub={`${pressureStats.noReading} tyres with no reading`} icon={AlertCircle} tone={BAND[scoreBand(pressureStats.pct)].text} />
            <KpiCard title="Inspection compliance" value={fmtPct(inspectionStats.pct)} sub={`${inspectionStats.compliant} of ${inspectionStats.total} vehicles current`} icon={ClipboardList} tone={BAND[scoreBand(inspectionStats.pct)].text} />
            <KpiCard title="Critical-risk tyres" value={criticalCount.toLocaleString()} sub="risk level Critical" icon={HelpCircle} tone={criticalCount > 0 ? 'text-red-400' : 'text-green-400'} />
            <KpiCard title="Fully compliant vehicles" value={fullyCompliantVehicles.toLocaleString()} sub="every measured tyre passes" icon={CheckCircle} />
          </div>

          <Section icon={TrendingUp} title="Tread compliance trend" right="last 6 months by fitment month; gaps mean no reading that month">
            <div className="h-48" role="img" aria-label="Monthly tread compliance percentage over the last 6 months">
              <Line data={trendLineChart} options={{ ...pctAxisOpts(false), plugins: { legend: { display: false }, tooltip: { ...TOOLTIP, callbacks: { label: ctx => ` ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(1) : 'N/A'}%` } } } }} />
            </div>
          </Section>

          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
            <div role="tablist" aria-label="Compliance areas" className="flex items-center gap-1 p-3 border-b border-[var(--input-border)] overflow-x-auto">
              {TABS.map(t => {
                const count = t.id === 'tread' ? treadStats.fleetFail : t.id === 'pressure' ? pressureStats.anomalies : overdueCount
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`flex items-center gap-2 min-h-[44px] px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                      activeTab === t.id ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--input-bg)]'
                    }`}
                  >
                    <t.icon size={13} aria-hidden="true" />
                    {t.label}
                    <span className="text-xs tabular-nums">({count})</span>
                  </button>
                )
              })}
            </div>

            <div className="p-4 space-y-5">
              {activeTab === 'tread' && (
                <>
                  <StatStrip items={[
                    { label: 'Tyres in scope', val: treadStats.total.toLocaleString() },
                    { label: `At or above ${FLEET_MIN_TREAD} mm`, val: treadStats.compliant.toLocaleString(), tone: 'text-green-400' },
                    { label: 'Below fleet minimum', val: treadStats.fleetFail.toLocaleString(), tone: 'text-orange-400' },
                    { label: `Legal failures (below ${LEGAL_MIN_TREAD} mm)`, val: treadStats.legalFail.toLocaleString(), tone: 'text-red-400' },
                  ]} />
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Section icon={BarChart3} title="Tread depth distribution" right={`${treadStats.noData} tyres not measured`}>
                      <div className="h-52" role="img" aria-label="Number of tyres in each tread depth band">
                        <Bar data={treadDistChart} options={{ ...chartOpts(false, 'Tread depth band', 'Tyres'), plugins: { legend: { display: false }, tooltip: TOOLTIP } }} />
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-2">0 to 2 mm includes legal failures; 2 to 4 mm is below or near the fleet minimum; 4 mm and above passes.</p>
                    </Section>
                    <Section icon={Building2} title="Tread compliance by site">
                      {treadBySite.length === 0 ? (
                        <div className="flex items-center justify-center h-52 text-[var(--text-muted)] text-sm">No site has a tread reading</div>
                      ) : (
                        <div className="h-52" role="img" aria-label="Tread compliance percentage by site">
                          <Bar data={treadBySiteChart} options={pctAxisOpts(true)} />
                        </div>
                      )}
                    </Section>
                  </div>
                  <Section icon={AlertTriangle} title="Non-compliant tyres" right={`${nonCompliantTyres.length.toLocaleString()} tyres`}>
                    <div className="flex justify-end mb-2">
                      <button type="button" onClick={exportTreadPdf} disabled={nonCompliantTyres.length === 0} className={BTN}>
                        <FileText size={14} aria-hidden="true" /> Tread report PDF
                      </button>
                    </div>
                    <EnterpriseTable
                      columns={treadColumns}
                      data={nonCompliantTyres}
                      getRowId={r => String(r.id)}
                      searchPlaceholder="Search asset, serial, site, brand"
                      exportFileName={fileBase('Tread Non-Compliant')}
                      reportMeta={{ title: 'Non-compliant tyres', company }}
                      viewKey="compliance-tread"
                      emptyMessage={treadStats.withData === 0 ? 'No tyre has a tread reading yet, so compliance cannot be judged' : 'Every measured tyre meets the fleet minimum tread depth'}
                    />
                  </Section>
                </>
              )}

              {activeTab === 'pressure' && (
                <>
                  <StatStrip items={[
                    { label: 'Tyres in scope', val: pressureStats.total.toLocaleString() },
                    { label: 'With a reading', val: pressureStats.withReading.toLocaleString() },
                    { label: `In band (${PRESSURE_MIN_PSI} to ${PRESSURE_MAX_PSI} PSI)`, val: pressureStats.compliant.toLocaleString(), tone: 'text-green-400' },
                    { label: 'Out of band / no reading', val: `${pressureStats.anomalies} / ${pressureStats.noReading}`, tone: 'text-red-400' },
                  ]} />
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Section icon={AlertCircle} title="Pressure compliance breakdown">
                      <div className="h-56" role="img" aria-label={`${pressureStats.compliant} in band, ${pressureStats.anomalies} out of band, ${pressureStats.noReading} with no reading`}>
                        <Doughnut data={pressureDoughnutData} options={doughnutOpts} />
                      </div>
                    </Section>
                    <Section icon={Building2} title="Pressure compliance by site" right="tyres with a reading only">
                      {pressureBySite.length === 0 ? (
                        <div className="flex items-center justify-center h-56 text-[var(--text-muted)] text-sm">No site has a pressure reading</div>
                      ) : (
                        <div className="h-56" role="img" aria-label="Pressure compliance percentage by site">
                          <Bar data={pressureBySiteChart} options={pctAxisOpts(true)} />
                        </div>
                      )}
                    </Section>
                  </div>
                  <Section icon={AlertTriangle} title="Pressure exceptions and missing readings" right={`${pressureAnomalies.length.toLocaleString()} tyres`}>
                    <EnterpriseTable
                      columns={pressureColumns}
                      data={pressureAnomalies}
                      getRowId={r => String(r.id)}
                      searchPlaceholder="Search asset, serial, site"
                      exportFileName={fileBase('Pressure Exceptions')}
                      reportMeta={{ title: 'Pressure exceptions', company }}
                      viewKey="compliance-pressure"
                      emptyMessage="Every tyre in scope has an in-band pressure reading"
                    />
                  </Section>
                </>
              )}

              {activeTab === 'inspection' && (
                <>
                  <StatStrip items={[
                    { label: 'Vehicles in scope', val: inspectionStats.total.toLocaleString() },
                    { label: `Compliant (within ${INSPECTION_MAX_DAYS} days)`, val: inspectionStats.compliant.toLocaleString(), tone: 'text-green-400' },
                    { label: `Due soon (${INSPECTION_MAX_DAYS + 1} to ${INSPECTION_DUE_DAYS} days)`, val: inspectionStats.dueSoon.toLocaleString(), tone: 'text-yellow-400' },
                    { label: `Overdue / never inspected`, val: `${inspectionStats.overdue} / ${inspectionStats.noData}`, tone: 'text-red-400' },
                  ]} />
                  {inspBySite.length > 0 && (
                    <Section icon={BarChart3} title="Inspection status by site">
                      <div className="h-52" role="img" aria-label="Vehicles by inspection status for each site">
                        <Bar data={inspBySiteChart} options={{ ...chartOpts(false, 'Site', 'Vehicles'), scales: { x: { ...axis('Site'), stacked: true }, y: { ...axis('Vehicles'), stacked: true } } }} />
                      </div>
                    </Section>
                  )}
                  <Section icon={Calendar} title="Vehicle inspection schedule" right={`${inspectionRows.length.toLocaleString()} vehicles`}>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <select aria-label="Filter by inspection status" value={inspStatusFilter} onChange={e => setInspStatusFilter(e.target.value)} className={`${SELECT} w-auto`}>
                        <option value="">All statuses</option>
                        {['overdue', 'due_soon', 'no_data', 'compliant'].map(s => <option key={s} value={s}>{INSPECTION_LABEL[s]}</option>)}
                      </select>
                      {overdueCount > 0 && (
                        <Link to="/inspection-planner" className={`${BTN} ml-auto`}>
                          <ExternalLink size={12} aria-hidden="true" /> Plan {overdueCount} overdue inspections
                        </Link>
                      )}
                    </div>
                    <EnterpriseTable
                      columns={inspectionColumns}
                      data={inspectionRows}
                      getRowId={r => String(r.asset_no)}
                      searchPlaceholder="Search asset, site, inspector"
                      exportFileName={fileBase('Inspection Schedule')}
                      reportMeta={{ title: 'Vehicle inspection schedule', company }}
                      viewKey="compliance-inspection"
                      emptyMessage={inspStatusFilter ? 'No vehicles have this inspection status' : 'No vehicles or inspections for the selected filters'}
                    />
                  </Section>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
