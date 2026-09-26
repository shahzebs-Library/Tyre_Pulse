import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import {
  ClipboardCheck, Download, FileText, AlertTriangle, CheckCircle, RefreshCw, Info,
  ShieldCheck, Users, BarChart2, TrendingUp, Truck, Copy, ListChecks, Gauge, MapPin,
} from 'lucide-react'
import * as inspIntelApi from '../lib/api/inspectionIntelligence'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import StatTile from '../components/ui/StatTile'
import FilterBar from '../components/ui/FilterBar'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'
import { colorAt, withAlpha } from '../lib/reportColors'
import { coverageRows, filterCoverage, coverageTotals, COVERAGE_STALE_DAYS } from '../lib/inspectorActivity'
import {
  filterInspections, windowFrom, dataQuality, inspectionKpis, siteSummary, monthlyTrend,
  conditionMix, duplicateInspections, inspectorBoard, inspectionRecommendations,
  inspectionExportRows, INSPECTION_EXPORT_COLS, INSPECTION_EXPORT_HEADERS,
} from '../lib/inspectionIntelligenceAnalytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler)

const loadExportUtils = () => import('../lib/exportUtils')

const fmtN = (v) => (v == null || !Number.isFinite(v) ? 'N/A' : Number(v).toLocaleString())
const fmtPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(d)}%`)

const DATE_PRESETS = [
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' },
  { key: 180, label: '6 months' },
  { key: 365, label: '12 months' },
  { key: 0, label: 'All time' },
]

const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart2 },
  { key: 'coverage', label: 'Fleet coverage', icon: Truck },
  { key: 'inspectors', label: 'Inspectors', icon: Users },
  { key: 'register', label: 'Inspections', icon: ClipboardCheck },
  { key: 'quality', label: 'Data quality', icon: ShieldCheck },
  { key: 'actions', label: 'Recommendations', icon: ListChecks },
]

const COVERAGE_STATUS = [
  { key: 'not_done', label: 'Not done' },
  { key: 'done', label: 'Completed' },
  { key: 'all', label: 'All' },
]

const SEVERITY_PILL = {
  ok: ['Completed', 'bg-green-500/15 text-green-300 border-green-500/40'],
  never: ['Never inspected', 'bg-red-500/15 text-red-300 border-red-500/40'],
  critical: ['Over 30 days', 'bg-red-500/15 text-red-300 border-red-500/40'],
  high: ['15 to 30 days', 'bg-orange-500/15 text-orange-400 border-orange-500/40'],
  medium: [`${COVERAGE_STALE_DAYS + 1} to 14 days`, 'bg-amber-500/15 text-amber-300 border-amber-500/40'],
}

function chartOptions({ horizontal = false, yTitle = '', xTitle = '', legend = false, pctAxis = false, max } = {}) {
  const axis = (title) => ({
    grid: { color: 'var(--panel-2)' },
    ticks: { color: 'var(--text-muted)', font: { size: 11 } },
    title: title ? { display: true, text: title, color: 'var(--text-muted)', font: { size: 11 } } : { display: false },
  })
  const value = { ...axis(horizontal ? xTitle : yTitle), min: 0, ...(max != null ? { max } : {}) }
  if (pctAxis) value.ticks = { ...value.ticks, callback: (v) => `${v}%` }
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: { legend: { display: legend, labels: { color: 'var(--text-secondary)', font: { size: 11 }, boxWidth: 12 } } },
    scales: horizontal ? { x: value, y: axis(yTitle) } : { x: axis(xTitle), y: value },
  }
}

function Section({ title, subtitle, icon: Icon, actions, children }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            {Icon && <Icon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />}{title}
          </h2>
          {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  )
}

function ChartBox({ empty, label, height = 260, children }) {
  if (empty) return <div className="flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4" style={{ height }}>{empty}</div>
  return <div role="img" aria-label={label} style={{ height }}>{children}</div>
}

function PriorityList({ items, empty }) {
  if (!items.length) return <p className="text-sm text-[var(--text-muted)] py-6 text-center">{empty}</p>
  return (
    <ul className="space-y-2">
      {items.map((i, n) => (
        <li key={n} className="flex items-start gap-3 rounded-lg border border-[var(--border-dim)] px-3 py-2">
          <span className={`text-[11px] font-semibold uppercase tracking-wide shrink-0 mt-0.5 ${i.priority === 'Critical' ? 'text-red-400' : i.priority === 'High' ? 'text-orange-400' : 'text-amber-300'}`}>{i.priority}</span>
          <span className="text-sm text-[var(--text-secondary)]">{i.message}</span>
        </li>
      ))}
    </ul>
  )
}

export default function InspectionIntelligence() {
  const { activeCountry, setActiveCountry, appSettings } = useSettings()
  const company = appSettings?.company_name || ''

  const [inspections, setInspections] = useState([])
  const [fleet, setFleet] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const reqId = useRef(0)

  const [tab, setTab] = useState('overview')
  const [search, setSearch] = useState('')
  const [site, setSite] = useState('')
  const [inspector, setInspector] = useState('')
  const [status, setStatus] = useState('')
  const [days, setDays] = useState(90)

  const [covSite, setCovSite] = useState('')
  const [covStatus, setCovStatus] = useState('not_done')
  const [covSearch, setCovSearch] = useState('')

  const [raising, setRaising] = useState(null)
  const [raised, setRaised] = useState({})
  const [actionError, setActionError] = useState(null)
  const [exportError, setExportError] = useState(null)

  const load = useCallback(async () => {
    const my = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const [ins, fl] = await Promise.all([
        inspIntelApi.listInspectionIntelInspections({ country: activeCountry }),
        inspIntelApi.listInspectionIntelFleet({ country: activeCountry }),
      ])
      if (my !== reqId.current) return
      if (ins.error) throw ins.error
      if (fl.error) throw fl.error
      setInspections(ins.data || [])
      setFleet(fl.data || [])
      setTruncated(Boolean(ins.truncated || fl.truncated))
    } catch (e) {
      if (my === reqId.current) setError(toUserMessage(e, 'Failed to load inspection data.'))
    } finally {
      if (my === reqId.current) setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // One clock reading per load, so every figure on screen shares the same 'now'.
  const now = useMemo(() => Date.now(), [inspections]) // eslint-disable-line react-hooks/exhaustive-deps
  const from = useMemo(() => windowFrom(days), [days])
  const sites = useMemo(() => [...new Set(inspections.map((r) => r.site).filter(Boolean))].sort(), [inspections])
  const inspectors = useMemo(() => [...new Set(inspections.map((r) => r.inspector).filter(Boolean))].sort(), [inspections])
  const fleetSet = useMemo(() => new Set(fleet.map((v) => String(v.asset_no || '').trim().toUpperCase()).filter(Boolean)), [fleet])

  const filtered = useMemo(
    () => filterInspections(inspections, { site, inspector, status, from, search }),
    [inspections, site, inspector, status, from, search],
  )
  const kpis = useMemo(() => inspectionKpis(filtered), [filtered])
  const sitesRows = useMemo(() => siteSummary(filtered), [filtered])
  const trend = useMemo(() => monthlyTrend(inspections, { now }), [inspections, now])
  const mix = useMemo(() => conditionMix(filtered), [filtered])
  const dupes = useMemo(() => duplicateInspections(filtered), [filtered])
  const dq = useMemo(() => dataQuality(filtered, fleetSet), [filtered, fleetSet])
  const board = useMemo(() => inspectorBoard(filtered, { now }), [filtered, now])

  // Coverage reads EVERY inspection: a vehicle last seen 200 days ago must show
  // that date, not "never", because the page window is 90 days.
  const coverageAll = useMemo(() => coverageRows(fleet, inspections), [fleet, inspections])
  const coverageSum = useMemo(() => coverageTotals(coverageAll), [coverageAll])
  const coverage = useMemo(() => filterCoverage(coverageAll, { site: covSite, status: covStatus, search: covSearch }), [coverageAll, covSite, covStatus, covSearch])
  const coverageSites = useMemo(() => [...new Set(coverageAll.map((r) => r.site).filter(Boolean))].sort(), [coverageAll])

  const recs = useMemo(
    () => inspectionRecommendations({ kpis, coverage: coverageSum, dq, duplicates: dupes, board }),
    [kpis, coverageSum, dq, dupes, board],
  )

  const filtersActive = Boolean(search || site || inspector || status || days !== 90)
  const clearAll = () => { setSearch(''); setSite(''); setInspector(''); setStatus(''); setDays(90) }

  // ── write: raise an overdue-inspection corrective action (unchanged payload) ─
  const raiseAlert = useCallback(async (v) => {
    if (raised[v.asset_no]) return
    setRaising(v.asset_no)
    setActionError(null)
    try {
      await inspIntelApi.insertCorrectiveAction({
        title: `Inspection overdue: ${v.asset_no}`,
        asset_no: v.asset_no,
        site: v.site,
        country: activeCountry !== 'All' ? activeCountry : undefined,
        description: v.daysSince == null
          ? `Inspection overdue: Vehicle ${v.asset_no} at site "${v.site}" has never been inspected.`
          : `Inspection overdue: Vehicle ${v.asset_no} at site "${v.site}" has not been inspected in ${v.daysSince} days.`,
        priority: v.severity === 'critical' || v.severity === 'never' ? 'Critical' : 'High',
        status: 'Open',
        due_date: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
      })
      setRaised((p) => ({ ...p, [v.asset_no]: true }))
    } catch (e) {
      setActionError(toUserMessage(e, `Could not raise a corrective action for ${v.asset_no}.`))
    } finally {
      setRaising(null)
    }
  }, [raised, activeCountry])

  // ── charts ────────────────────────────────────────────────────────────────
  const siteChartRows = useMemo(() => sitesRows.slice(0, 15), [sitesRows])
  const siteData = useMemo(() => ({
    labels: siteChartRows.map((s) => s.site),
    datasets: [
      { label: 'Approved', data: siteChartRows.map((s) => s.approved), backgroundColor: withAlpha(colorAt(1), 0.8), borderRadius: 3 },
      { label: 'Awaiting sign-off', data: siteChartRows.map((s) => s.inspections - s.approved), backgroundColor: withAlpha(colorAt(2), 0.8), borderRadius: 3 },
    ],
  }), [siteChartRows])
  const siteOpts = useMemo(() => {
    const o = chartOptions({ horizontal: true, xTitle: 'Inspections', legend: true })
    o.scales.x.stacked = true
    o.scales.y.stacked = true
    return o
  }, [])

  const trendData = useMemo(() => ({
    labels: trend.map((m) => m.label),
    datasets: [
      { type: 'bar', label: 'Inspections', data: trend.map((m) => m.inspections), backgroundColor: withAlpha(colorAt(0), 0.6), borderRadius: 3, yAxisID: 'y' },
      { type: 'line', label: 'Approved %', data: trend.map((m) => (m.approvalPct == null ? null : Number(m.approvalPct.toFixed(1)))), borderColor: colorAt(1), backgroundColor: withAlpha(colorAt(1), 0.15), tension: 0.3, spanGaps: true, pointRadius: 3, yAxisID: 'y1' },
    ],
  }), [trend])
  const trendOpts = useMemo(() => {
    const o = chartOptions({ yTitle: 'Inspections', legend: true })
    o.scales.y1 = { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { color: 'var(--text-muted)', callback: (v) => `${v}%` } }
    return o
  }, [])

  const mixTotal = mix.good + mix.warning + mix.critical + mix.none
  const mixData = useMemo(() => ({
    labels: ['Good', 'Wear', 'Fault', 'Not recorded'],
    datasets: [{ data: [mix.good, mix.warning, mix.critical, mix.none], backgroundColor: ['#22c55e', '#f59e0b', '#ef4444', 'rgba(148,163,184,0.5)'], borderColor: 'var(--panel)', borderWidth: 2 }],
  }), [mix])

  // ── tables ────────────────────────────────────────────────────────────────
  const coverageColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no, size: 110 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site, size: 130, meta: { filterVariant: 'select' } },
    { id: 'last', header: 'Last inspection', accessorFn: (r) => r.lastInspectionDate || '', size: 130, cell: ({ row }) => row.original.lastInspectionDate || 'Never' },
    { id: 'by', header: 'By', accessorFn: (r) => r.inspector || 'N/A', size: 160 },
    { id: 'days', header: 'Days since', accessorFn: (r) => (r.daysSince == null ? 99999 : r.daysSince), size: 100, meta: { align: 'right', exportValue: (r) => r.daysSince ?? 'Never' }, cell: ({ row }) => (row.original.daysSince == null ? 'Never' : `${row.original.daysSince}d`) },
    {
      id: 'status', header: 'Status', accessorFn: (r) => (SEVERITY_PILL[r.severity] || SEVERITY_PILL.medium)[0], size: 140,
      cell: ({ row }) => {
        const [label, cls] = SEVERITY_PILL[row.original.severity] || SEVERITY_PILL.medium
        return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${cls}`}>{label}</span>
      },
    },
    {
      id: 'action', header: 'Action', enableSorting: false, size: 170, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const v = row.original
        if (v.done) return <span className="text-xs text-[var(--text-muted)]">None needed</span>
        if (raised[v.asset_no]) return <span className="text-xs text-green-300 inline-flex items-center gap-1"><CheckCircle size={12} aria-hidden="true" /> Action raised</span>
        return (
          <button type="button" onClick={() => raiseAlert(v)} disabled={raising === v.asset_no}
            className="btn-primary text-xs min-h-[36px] px-3 disabled:opacity-50">
            {raising === v.asset_no ? 'Raising...' : 'Raise action'}
          </button>
        )
      },
    },
  ], [raised, raising, raiseAlert])

  const boardColumns = useMemo(() => [
    { id: 'inspector', header: 'Inspector', accessorFn: (r) => r.inspector, size: 180 },
    { id: 'total', header: 'Inspections', accessorFn: (r) => r.total, size: 100, meta: { align: 'right' } },
    { id: 'vehicles', header: 'Vehicles', accessorFn: (r) => r.vehicles, size: 90, meta: { align: 'right' } },
    { id: 'approved', header: 'Approved', accessorFn: (r) => r.completionPct ?? -1, size: 100, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.completionPct, 0) },
    { id: 'pressure', header: 'Pressures judgeable', accessorFn: (r) => r.pressureMeasurablePct ?? -1, size: 140, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.pressureMeasurablePct, 0) },
    { id: 'uniform', header: 'All wheels same PSI', accessorFn: (r) => r.uniformPct ?? -1, size: 140, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.uniformPct, 0) },
    { id: 'faults', header: 'Faults reported', accessorFn: (r) => r.faultsReported, size: 120, meta: { align: 'right' } },
    { id: 'last', header: 'Last active', accessorFn: (r) => r.lastActive || '', size: 120, cell: ({ row }) => row.original.lastActive || 'N/A' },
    { id: 'sites', header: 'Sites', accessorFn: (r) => r.sites.join(', ') || 'N/A', size: 220 },
  ], [])

  const siteColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorFn: (r) => r.site, size: 150 },
    { id: 'inspections', header: 'Inspections', accessorFn: (r) => r.inspections, size: 100, meta: { align: 'right' } },
    { id: 'vehicles', header: 'Vehicles', accessorFn: (r) => r.vehicles, size: 90, meta: { align: 'right' } },
    { id: 'approved', header: 'Approved', accessorFn: (r) => r.approvalPct ?? -1, size: 100, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.approvalPct, 0) },
    { id: 'faults', header: 'Faults found', accessorFn: (r) => r.faults, size: 110, meta: { align: 'right' } },
    { id: 'pressure', header: 'Pressures judgeable', accessorFn: (r) => r.pressureMeasurablePct ?? -1, size: 140, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.pressureMeasurablePct, 0) },
  ], [])

  const registerRows = useMemo(() => inspectionExportRows(filtered), [filtered])
  const registerColumns = useMemo(() => INSPECTION_EXPORT_COLS.map((key, i) => ({
    id: key, header: INSPECTION_EXPORT_HEADERS[i], accessorFn: (r) => r[key], size: key === 'inspector' ? 170 : 110,
    meta: ['positions', 'faults', 'pressures'].includes(key) ? { align: 'right' } : (key === 'statusLabel' || key === 'site') ? { filterVariant: 'select' } : undefined,
  })), [])

  const dupColumns = useMemo(() => [
    { id: 'date', header: 'Date', accessorFn: (r) => r.date, size: 110 },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no, size: 110 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 120 },
    { id: 'count', header: 'Inspections that day', accessorFn: (r) => r.count, size: 150, meta: { align: 'right' } },
    { id: 'by', header: 'Inspectors', accessorFn: (r) => r.inspectors || 'N/A', size: 220 },
  ], [])

  const dqColumns = useMemo(() => [
    { id: 'label', header: 'Check', accessorFn: (r) => r.label, size: 220 },
    { id: 'pass', header: 'Pass rate', accessorFn: (r) => r.passPct ?? -1, size: 110, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.passPct, 0) },
    { id: 'failing', header: 'Inspections failing', accessorFn: (r) => r.failing, size: 150, meta: { align: 'right' } },
    { id: 'examples', header: 'Examples', accessorFn: (r) => r.rows.slice(0, 5).map((x) => x.asset_no || 'N/A').join(', ') || 'None', size: 260, meta: { export: false } },
  ], [])

  // ── exports ───────────────────────────────────────────────────────────────
  const scopeLabel = [activeCountry !== 'All' ? activeCountry : 'All countries', DATE_PRESETS.find((p) => p.key === days)?.label, site, inspector].filter(Boolean).join(' | ')

  async function exportExcel() {
    setExportError(null)
    try {
      const { exportSheetsToExcel, reportFileName, reportDateLabel } = await loadExportUtils()
      await exportSheetsToExcel([
        { name: 'Inspections', rows: registerRows, columns: INSPECTION_EXPORT_COLS, headers: INSPECTION_EXPORT_HEADERS },
        { name: 'Coverage', rows: coverageAll.map((v) => ({ ...v, lastInspectionDate: v.lastInspectionDate || 'Never', daysSince: v.daysSince ?? 'Never', status: (SEVERITY_PILL[v.severity] || SEVERITY_PILL.medium)[0] })), columns: ['asset_no', 'site', 'lastInspectionDate', 'inspector', 'daysSince', 'status'], headers: ['Asset', 'Site', 'Last inspection', 'By', 'Days since', 'Status'] },
        { name: 'Inspectors', rows: board.map((a) => ({ ...a, sites: a.sites.join(', '), completionPct: fmtPct(a.completionPct, 0), pressureMeasurablePct: fmtPct(a.pressureMeasurablePct, 0) })), columns: ['inspector', 'total', 'vehicles', 'completionPct', 'pressureMeasurablePct', 'faultsReported', 'lastActive', 'sites'], headers: ['Inspector', 'Inspections', 'Vehicles', 'Approved', 'Pressures judgeable', 'Faults reported', 'Last active', 'Sites'] },
        { name: 'Recommendations', rows: recs, columns: ['priority', 'message'], headers: ['Priority', 'Recommendation'] },
      ], reportFileName('Inspection Intelligence', reportDateLabel()), { title: 'Inspection Intelligence', company, notes: [scopeLabel] })
    } catch (e) {
      setExportError(toUserMessage(e, 'The Excel file could not be created.'))
    }
  }

  async function exportPdf(opts = {}) {
    setExportError(null)
    try {
      const { exportToPdf, reportFileName, reportDateLabel } = await loadExportUtils()
      return await exportToPdf(
        registerRows,
        INSPECTION_EXPORT_COLS.map((key, i) => ({ key, header: INSPECTION_EXPORT_HEADERS[i] })),
        'Inspection Intelligence',
        reportFileName('Inspection Intelligence', reportDateLabel()),
        'landscape',
        company,
        { subtitleNote: `${scopeLabel} | ${fmtPct(kpis.approvalPct, 0)} approved | fleet coverage ${fmtPct(coverageSum.coveragePct, 0)}`, ...opts },
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'The PDF could not be created.'))
      return null
    }
  }

  const hasData = inspections.length > 0 || fleet.length > 0

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title="Inspection Intelligence"
        subtitle="Inspection coverage, sign-off, recording quality and faults found across the fleet"
        icon={ClipboardCheck}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={load} disabled={loading} className="btn-secondary text-xs min-h-[40px] px-3 inline-flex items-center gap-1.5 disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
            <button type="button" onClick={exportExcel} disabled={!hasData} className="btn-secondary text-xs min-h-[40px] px-3 inline-flex items-center gap-1.5 disabled:opacity-50">
              <Download size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => exportPdf()} disabled={!hasData} className="btn-secondary text-xs min-h-[40px] px-3 inline-flex items-center gap-1.5 disabled:opacity-50">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <EmailPdfButton
              className="btn-secondary text-xs min-h-[40px] px-3 inline-flex items-center gap-1.5"
              disabled={!hasData}
              getPdf={async () => ({
                base64: await exportPdf({ returnBase64: true }),
                filename: 'Inspection Intelligence Report.pdf',
                subject: 'Inspection Intelligence',
                bodyHtml: '<p>Attached is the Inspection Intelligence report.</p>',
              })}
            />
          </div>
        }
      />

      {(exportError || actionError) && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{actionError || exportError}</div>
      )}

      <FilterBar
        search={search}
        onSearch={setSearch}
        placeholder="Search asset, site, inspector, vehicle type or document"
        searchLabel="Search inspections"
        resultCount={hasData ? filtered.length : null}
        onClearAll={filtersActive ? clearAll : undefined}
        selects={[
          { key: 'country', value: activeCountry === 'All' ? '' : activeCountry, onChange: (v) => setActiveCountry(v || 'All'), placeholder: 'All countries', ariaLabel: 'Filter by country', options: COUNTRIES.map((c) => ({ value: c, label: c })) },
          { key: 'site', value: site, onChange: setSite, placeholder: 'All sites', ariaLabel: 'Filter by site', options: sites.map((s) => ({ value: s, label: s })) },
          { key: 'inspector', value: inspector, onChange: setInspector, placeholder: 'All inspectors', ariaLabel: 'Filter by inspector', options: inspectors.map((s) => ({ value: s, label: s })) },
          { key: 'status', value: status, onChange: setStatus, placeholder: 'Any sign-off', ariaLabel: 'Filter by sign-off status', options: [{ value: 'approved', label: 'Approved' }, { value: 'pending', label: 'Awaiting sign-off' }] },
        ]}
      >
        <div role="group" aria-label="Inspection date window" className="flex flex-wrap gap-1">
          {DATE_PRESETS.map((p) => (
            <button key={p.key} type="button" aria-pressed={days === p.key} onClick={() => setDays(p.key)}
              className={`px-3 min-h-[40px] rounded-xl text-xs font-medium border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${days === p.key ? 'bg-[var(--accent)] text-white border-transparent' : 'border-[var(--border-dim)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </FilterBar>

      {loading && !hasData ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" aria-busy="true" aria-label="Loading inspection data">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="card h-[108px] animate-pulse" />)}
        </div>
      ) : error ? (
        <Card>
          <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle size={28} className="text-red-400" aria-hidden="true" />
            <p className="text-sm text-[var(--text-primary)] font-medium">Inspection data could not be loaded</p>
            <p className="text-xs text-[var(--text-muted)] max-w-md">{error}</p>
            <button type="button" onClick={load} className="btn-primary text-sm min-h-[44px] px-4 inline-flex items-center gap-2"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
          </div>
        </Card>
      ) : !hasData ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <ClipboardCheck size={32} className="text-[var(--text-muted)]" aria-hidden="true" />
            <p className="text-sm text-[var(--text-primary)] font-medium">No inspections or fleet vehicles for this country yet</p>
            <p className="text-xs text-[var(--text-muted)] max-w-md">Inspections appear here once they are recorded from the web or the field app. Coverage needs vehicles in the fleet register.</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-xl border border-[var(--border-dim)] bg-[var(--surface-2)] px-4 py-3 text-xs text-[var(--text-secondary)]">
            <Info size={14} className="shrink-0 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
            <p>
              Approved means the inspection has been signed off (status Done). Pressures are judgeable when at least 4 wheels carry a reading, the same rule the pressure report uses.
              Fleet coverage reads every inspection, not only this window: a vehicle is covered when inspected in the last {COVERAGE_STALE_DAYS} days.
              {truncated && ' Capped view: the loaded rows hit the 50,000 row ceiling.'}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatTile index={0} icon={ClipboardCheck} label="Inspections" value={fmtN(kpis.inspections)} sub={`${fmtN(kpis.vehicles)} vehicles, ${fmtN(kpis.inspectors)} inspectors`} tone="info" spark={trend.map((m) => m.inspections)} />
            <StatTile index={1} icon={CheckCircle} label="Approved" value={fmtPct(kpis.approvalPct, 0)} sub={`${fmtN(kpis.pending)} awaiting sign-off`} tone={kpis.approvalPct == null ? 'neutral' : kpis.approvalPct >= 80 ? 'accent' : 'warn'} />
            <StatTile index={2} icon={Truck} label="Fleet covered" value={fmtPct(coverageSum.coveragePct, 0)} sub={`${fmtN(coverageSum.notDone)} due, ${fmtN(coverageSum.never)} never`} tone={coverageSum.coveragePct == null ? 'neutral' : coverageSum.coveragePct >= 75 ? 'accent' : 'crit'} />
            <StatTile index={3} icon={Gauge} label="Pressures judgeable" value={fmtPct(kpis.pressureMeasurablePct, 0)} sub={`Consistency ${fmtPct(kpis.pressureCompliancePct)}`} tone="neutral" />
            <StatTile index={4} icon={AlertTriangle} label="Faults found" value={fmtN(kpis.faults)} sub={`${fmtN(kpis.severe)} severe, on ${fmtPct(kpis.withFaultPct, 0)} of inspections`} tone={kpis.severe > 0 ? 'crit' : 'neutral'} />
            <StatTile index={5} icon={ShieldCheck} label="Data quality" value={fmtPct(dq.score, 0)} sub={`${dupes.length} possible duplicates`} tone={dq.score == null ? 'neutral' : dq.score >= 80 ? 'accent' : 'warn'} />
          </div>

          <div role="tablist" aria-label="Inspection intelligence sections" className="flex flex-wrap gap-2 border-b border-[var(--border-dim)] pb-3">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`inline-flex items-center gap-2 px-3.5 min-h-[40px] rounded-lg text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${tab === key ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                <Icon size={15} aria-hidden="true" /> {label}
                {key === 'actions' && recs.length > 0 && <span className="text-[11px] px-1.5 rounded-full bg-[var(--panel-2)]">{recs.length}</span>}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Section title="Inspections per month" icon={TrendingUp} subtitle="Last 12 months, all inspections, with the share approved">
                  <ChartBox empty={trend.some((m) => m.inspections > 0) ? null : 'No inspections in the last 12 months.'} label="Monthly inspections and approval share">
                    <Bar data={trendData} options={trendOpts} />
                  </ChartBox>
                </Section>
                <Section title="Recorded tyre condition" icon={Gauge} subtitle={`${fmtN(mixTotal)} wheel records in this window`}>
                  <ChartBox empty={mixTotal ? null : 'No wheel condition recorded in this window.'} label="Share of wheels recorded good, worn, faulty or not recorded">
                    <Doughnut data={mixData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', font: { size: 11 }, boxWidth: 12 } } } }} />
                  </ChartBox>
                </Section>
              </div>
              <Section title="Inspections by site" icon={MapPin} subtitle="Approved versus awaiting sign-off, busiest sites first">
                <ChartBox empty={siteChartRows.length ? null : 'No sites in this window.'} label="Approved and pending inspections by site" height={Math.max(220, siteChartRows.length * 28)}>
                  <Bar data={siteData} options={siteOpts} />
                </ChartBox>
              </Section>
              <Section title="Site summary" icon={MapPin}>
                <EnterpriseTable columns={siteColumns} data={sitesRows} getRowId={(r) => r.site} initialPageSize={25} exportFileName="Inspection sites" emptyMessage="No sites in this window." />
              </Section>
              {recs.length > 0 && (
                <Section title="Top priorities" icon={ListChecks}>
                  <PriorityList items={recs.slice(0, 4)} empty="" />
                </Section>
              )}
            </div>
          )}

          {tab === 'coverage' && (
            <Section
              title="Inspection coverage by vehicle"
              icon={Truck}
              subtitle={`${fmtN(coverageSum.done)} of ${fmtN(coverageSum.vehicles)} inspected in the last ${COVERAGE_STALE_DAYS} days${coverageSum.never ? `, ${coverageSum.never} never inspected` : ''}. Raising an action creates an open corrective action due in 2 days.`}
              actions={(
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor="cov-site">Coverage site</label>
                  <select id="cov-site" value={covSite} onChange={(e) => setCovSite(e.target.value)} className="input text-sm min-h-[40px]">
                    <option value="">All sites</option>
                    {coverageSites.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div role="group" aria-label="Coverage status" className="flex rounded-lg overflow-hidden border border-[var(--border-dim)]">
                    {COVERAGE_STATUS.map((o) => (
                      <button key={o.key} type="button" aria-pressed={covStatus === o.key} onClick={() => setCovStatus(o.key)}
                        className={`px-3 min-h-[40px] text-xs font-medium ${covStatus === o.key ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <label className="sr-only" htmlFor="cov-search">Search coverage</label>
                  <input id="cov-search" value={covSearch} onChange={(e) => setCovSearch(e.target.value)} placeholder="Asset, site, inspector" className="input text-sm min-h-[40px] w-48" />
                </div>
              )}
            >
              <EnterpriseTable
                columns={coverageColumns}
                data={coverage}
                getRowId={(r) => r.asset_no}
                enableGlobalFilter={false}
                viewKey="inspection-intelligence-coverage"
                initialPageSize={50}
                exportFileName="Inspection coverage"
                emptyMessage={coverageAll.length === 0 ? 'No vehicle is registered for this country, so coverage cannot be measured.' : 'No vehicle matches these filters.'}
              />
            </Section>
          )}

          {tab === 'inspectors' && (
            <Section title="Inspector board" icon={Users} subtitle="Activity in this window plus how completely each inspector records the tyres. A high identical-pressure share can mean a gauge was not used.">
              <EnterpriseTable columns={boardColumns} data={board} getRowId={(r) => r.inspector} viewKey="inspection-intelligence-inspectors" initialPageSize={25} exportFileName="Inspection inspectors" emptyMessage="No named inspector in this window." />
            </Section>
          )}

          {tab === 'register' && (
            <Section title="Inspections in scope" icon={ClipboardCheck} subtitle="Wheels recorded, faults found and pressures captured per inspection">
              <EnterpriseTable columns={registerColumns} data={registerRows} getRowId={(r, i) => `${r.document_no}|${r.asset_no}|${r.date}|${i}`} viewKey="inspection-intelligence-register" initialPageSize={50} exportFileName="Inspection register" emptyMessage={filtersActive ? 'No inspections match these filters.' : 'No inspections recorded yet.'} />
            </Section>
          )}

          {tab === 'quality' && (
            <div className="space-y-5">
              <Section title="Data quality checks" icon={ShieldCheck} subtitle={`Score ${fmtPct(dq.score, 0)} is the average pass rate of these checks`}>
                <EnterpriseTable columns={dqColumns} data={dq.checks} getRowId={(r) => r.key} enableGlobalFilter={false} enableColumnFilters={false} exportFileName="Inspection data quality" emptyMessage="No inspections to check." />
                {dq.uniform.length > 0 && (
                  <p className="mt-3 text-xs text-[var(--text-muted)]">
                    {dq.uniform.length.toLocaleString()} inspections record the identical pressure on every wheel. That is possible, but it is also what a copied or defaulted form looks like.
                  </p>
                )}
              </Section>
              <Section title="Possible duplicates" icon={Copy} subtitle="The same vehicle inspected more than once on the same day">
                <EnterpriseTable columns={dupColumns} data={dupes} getRowId={(r) => r.key} initialPageSize={25} exportFileName="Inspection duplicates" emptyMessage="No vehicle was inspected twice on the same day in this window." />
              </Section>
            </div>
          )}

          {tab === 'actions' && (
            <Section title="Recommendations" icon={ListChecks} subtitle="Derived only from the measured figures above">
              <PriorityList items={recs} empty="No issues found. Inspection coverage and recording look healthy in this scope." />
            </Section>
          )}
        </>
      )}
    </div>
  )
}
