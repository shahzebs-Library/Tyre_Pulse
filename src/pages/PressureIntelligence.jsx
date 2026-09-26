import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import {
  Gauge, RefreshCw, AlertTriangle, Download, FileText, Info, Activity, TrendingDown,
  TrendingUp, Truck, ClipboardCheck, Repeat, Users, MapPin, BarChart2, ShieldCheck,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import StatTile from '../components/ui/StatTile'
import FilterBar from '../components/ui/FilterBar'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import EmailPdfButton from '../components/EmailPdfButton'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  buildReadings, inspectionPressureRows, filterInspections, filterReadings, pressureKpis,
  siteCompliance, groupBreakdown, psiHistogram, monthlyTrend, inspectorPressureQuality,
  repeatDeviations, pressureInsights, readingExportRows,
  READING_EXPORT_COLS, READING_EXPORT_HEADERS, STATUS_META, PRESSURE_MIN_READINGS,
} from '../lib/pressureIntelligenceAnalytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

// exportUtils carries the PDF/Excel engines; load it on first click only.
const loadExportUtils = () => import('../lib/exportUtils')

const ROW_CAP = 50000
const COLS = 'id,asset_no,vehicle_type,site,country,inspector,inspection_date,scheduled_date,created_at,status,tyre_conditions'

const fmtN = (v, d = 0) => (v == null || !Number.isFinite(v) ? 'N/A' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }))
const fmtPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(d)}%`)
const fmtDev = (v) => (v == null ? 'N/A' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)

const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart2 },
  { key: 'readings', label: 'Readings', icon: Gauge },
  { key: 'repeats', label: 'Repeat deviations', icon: Repeat },
  { key: 'sites', label: 'Sites and axles', icon: MapPin },
  { key: 'inspectors', label: 'Inspectors', icon: Users },
  { key: 'quality', label: 'Data quality', icon: ShieldCheck },
]

const STATUS_CLASS = {
  ok: 'bg-green-500/15 text-green-300 border-green-500/40',
  under: 'bg-red-500/15 text-red-300 border-red-500/40',
  over: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  unmeasured: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--border-dim)]',
}

/** Status is carried by the word as well as the colour. */
function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.unmeasured
  return (
    <span title={meta.label} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${STATUS_CLASS[status] || STATUS_CLASS.unmeasured}`}>
      {status === 'under' ? <TrendingDown size={11} aria-hidden="true" /> : status === 'over' ? <TrendingUp size={11} aria-hidden="true" /> : null}
      {meta.short}
    </span>
  )
}

function chartOptions({ horizontal = false, xTitle = '', yTitle = '', legend = false, max, pctAxis = false, stacked = false } = {}) {
  const axis = (title) => ({
    grid: { color: 'var(--panel-2)' },
    ticks: { color: 'var(--text-muted)', font: { size: 11 } },
    title: title ? { display: true, text: title, color: 'var(--text-muted)', font: { size: 11 } } : { display: false },
  })
  const value = { ...axis(horizontal ? xTitle : yTitle), min: 0, stacked, ...(max != null ? { max } : {}) }
  if (pctAxis) value.ticks = { ...value.ticks, callback: (v) => `${v}%` }
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: legend, labels: { color: 'var(--text-secondary)', font: { size: 11 }, boxWidth: 12 } },
      tooltip: { enabled: true },
    },
    scales: horizontal
      ? { x: value, y: { ...axis(yTitle), stacked } }
      : { x: { ...axis(xTitle), stacked }, y: value },
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
  if (empty) {
    return (
      <div className="flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4" style={{ height }}>
        {empty}
      </div>
    )
  }
  return <div role="img" aria-label={label} style={{ height }}>{children}</div>
}

export default function PressureIntelligence() {
  const { activeCountry, appSettings } = useSettings()
  const company = appSettings?.company_name || ''

  const [inspections, setInspections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [loadedAt, setLoadedAt] = useState(null)
  const reqId = useRef(0)

  const [tab, setTab] = useState('overview')
  const [search, setSearch] = useState('')
  const [site, setSite] = useState('')
  const [inspector, setInspector] = useState('')
  const [group, setGroup] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [drillAsset, setDrillAsset] = useState(null)
  const [exportError, setExportError] = useState(null)

  const load = useCallback(async () => {
    const my = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      // Null-safe country scope, applied server-side, bounded and paged with an
      // id tiebreak so a page boundary never drops or repeats a row.
      const country = activeCountry !== 'All' ? activeCountry : null
      const { data, error: err, truncated: cut } = await fetchAllPages((f, t) => {
        let q = supabase.from('inspections').select(COLS)
        if (country) q = q.or(`country.eq.${country},country.is.null`)
        return q.order('inspection_date', { ascending: false }).order('id', { ascending: false }).range(f, t)
      }, { max: ROW_CAP })
      if (my !== reqId.current) return
      if (err) throw err
      setInspections(data || [])
      setTruncated(Boolean(cut))
      setLoadedAt(new Date())
    } catch (e) {
      if (my === reqId.current) setError(toUserMessage(e, 'Could not load pressure data.'))
    } finally {
      if (my === reqId.current) setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const sites = useMemo(() => [...new Set(inspections.map((r) => r.site).filter(Boolean))].sort(), [inspections])
  const inspectors = useMemo(() => [...new Set(inspections.map((r) => r.inspector).filter(Boolean))].sort(), [inspections])

  const scoped = useMemo(
    () => filterInspections(inspections, { site, inspector, from, to, search }),
    [inspections, site, inspector, from, to, search],
  )
  const allReadings = useMemo(() => buildReadings(scoped), [scoped])
  const readings = useMemo(() => filterReadings(allReadings, { group, status }), [allReadings, group, status])
  const kpis = useMemo(() => pressureKpis(scoped), [scoped])
  const sitesRows = useMemo(() => siteCompliance(scoped), [scoped])
  const groups = useMemo(() => groupBreakdown(allReadings), [allReadings])
  const histogram = useMemo(() => psiHistogram(readings), [readings])
  const trend = useMemo(() => monthlyTrend(allReadings, { now: Date.now() }), [allReadings])
  const inspectorRows = useMemo(() => inspectorPressureQuality(scoped), [scoped])
  const repeats = useMemo(() => repeatDeviations(allReadings), [allReadings])
  const insights = useMemo(() => pressureInsights(scoped), [scoped])
  const perInspection = useMemo(() => inspectionPressureRows(scoped), [scoped])
  const qualityRows = useMemo(() => perInspection.filter((r) => !r.measured || r.uniform), [perInspection])
  const groupOptions = useMemo(() => [...new Set(allReadings.map((r) => r.group))], [allReadings])

  const drillRows = useMemo(
    () => (drillAsset ? buildReadings(inspections.filter((r) => r.asset_no === drillAsset)) : [])
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [drillAsset, inspections],
  )

  const filtersActive = Boolean(search || site || inspector || group || status || from || to)
  const clearAll = () => { setSearch(''); setSite(''); setInspector(''); setGroup(''); setStatus(''); setFrom(''); setTo('') }

  // ── charts ────────────────────────────────────────────────────────────────
  const histData = useMemo(() => ({
    labels: histogram.map((b) => b.label),
    datasets: [{ label: 'Readings', data: histogram.map((b) => b.count), backgroundColor: withAlpha(colorAt(0), 0.75), borderColor: colorAt(0), borderWidth: 1, borderRadius: 3 }],
  }), [histogram])

  const trendData = useMemo(() => ({
    labels: trend.map((m) => m.label),
    datasets: [
      { label: 'Within tolerance %', data: trend.map((m) => (m.compliancePct == null ? null : Number(m.compliancePct.toFixed(1)))), borderColor: colorAt(1), backgroundColor: withAlpha(colorAt(1), 0.12), fill: true, tension: 0.3, spanGaps: true, pointRadius: 3 },
    ],
  }), [trend])

  const siteChartRows = useMemo(() => sitesRows.filter((s) => s.compliancePct != null).slice(0, 15), [sitesRows])
  const siteData = useMemo(() => ({
    labels: siteChartRows.map((s) => s.site),
    datasets: [{ label: 'Within tolerance %', data: siteChartRows.map((s) => Number(s.compliancePct.toFixed(1))), backgroundColor: siteChartRows.map((_, i) => withAlpha(colorAt(i), 0.75)), borderRadius: 3 }],
  }), [siteChartRows])

  const groupData = useMemo(() => ({
    labels: groups.map((g) => g.group),
    datasets: [
      { label: 'Low', data: groups.map((g) => g.under), backgroundColor: 'rgba(239,68,68,0.75)', borderRadius: 3 },
      { label: 'High', data: groups.map((g) => g.over), backgroundColor: 'rgba(245,158,11,0.75)', borderRadius: 3 },
    ],
  }), [groups])

  // ── tables ────────────────────────────────────────────────────────────────
  const readingColumns = useMemo(() => [
    { id: 'date', header: 'Date', accessorFn: (r) => r.date || '', size: 110 },
    {
      id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 110,
      cell: ({ row }) => row.original.asset_no ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); setDrillAsset(row.original.asset_no) }}
          className="font-medium text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded min-h-[32px]">
          {row.original.asset_no}
        </button>
      ) : 'N/A',
    },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 110, meta: { filterVariant: 'select' } },
    { id: 'position', header: 'Position', accessorFn: (r) => r.position, size: 90 },
    { id: 'group', header: 'Axle', accessorFn: (r) => r.group, size: 90, meta: { filterVariant: 'select' } },
    { id: 'psi', header: 'PSI', accessorFn: (r) => r.pressure, size: 80, meta: { align: 'right' } },
    { id: 'median', header: 'Vehicle median', accessorFn: (r) => r.median ?? -1, size: 110, meta: { align: 'right', exportValue: (r) => r.median ?? 'N/A' }, cell: ({ row }) => fmtN(row.original.median) },
    { id: 'dev', header: 'Deviation', accessorFn: (r) => (r.deviationPct == null ? -999 : Math.abs(r.deviationPct)), size: 100, meta: { align: 'right', exportValue: (r) => r.deviationPct ?? 'N/A' }, cell: ({ row }) => <span className="tabular-nums">{fmtDev(row.original.deviationPct)}</span> },
    { id: 'status', header: 'Status', accessorFn: (r) => STATUS_META[r.status]?.short || r.status, size: 120, meta: { filterVariant: 'select' }, cell: ({ row }) => <StatusPill status={row.original.status} /> },
    { id: 'inspector', header: 'Inspector', accessorFn: (r) => r.inspector || 'N/A', size: 150 },
  ], [])

  const repeatColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no, size: 110, cell: ({ row }) => (
      <button type="button" onClick={() => setDrillAsset(row.original.asset_no)} className="font-medium text-[var(--accent)] hover:underline rounded min-h-[32px]">{row.original.asset_no}</button>
    ) },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 110 },
    { id: 'position', header: 'Position', accessorFn: (r) => r.position, size: 90 },
    { id: 'occ', header: 'Times off median', accessorFn: (r) => r.occurrences, size: 120, meta: { align: 'right' } },
    { id: 'lows', header: 'Low', accessorFn: (r) => r.lows, size: 70, meta: { align: 'right' } },
    { id: 'highs', header: 'High', accessorFn: (r) => r.highs, size: 70, meta: { align: 'right' } },
    { id: 'last', header: 'Last seen', accessorFn: (r) => r.lastDate || '', size: 110 },
    { id: 'lastPsi', header: 'Last PSI', accessorFn: (r) => r.lastPsi ?? -1, size: 90, meta: { align: 'right' }, cell: ({ row }) => fmtN(row.original.lastPsi) },
    { id: 'cause', header: 'Possible cause', accessorFn: (r) => r.likelyCause, size: 230 },
  ], [])

  const siteColumns = useMemo(() => [
    { id: 'site', header: 'Site', accessorFn: (r) => r.site, size: 150 },
    { id: 'inspections', header: 'Inspections', accessorFn: (r) => r.inspections, size: 110, meta: { align: 'right' } },
    { id: 'readings', header: 'Measured readings', accessorFn: (r) => r.readings, size: 130, meta: { align: 'right' } },
    { id: 'comp', header: 'Within tolerance', accessorFn: (r) => r.compliancePct ?? -1, size: 130, meta: { align: 'right', exportValue: (r) => r.compliancePct == null ? 'N/A' : Number(r.compliancePct.toFixed(1)) }, cell: ({ row }) => fmtPct(row.original.compliancePct) },
    { id: 'under', header: 'Low', accessorFn: (r) => r.under, size: 80, meta: { align: 'right' } },
    { id: 'over', header: 'High', accessorFn: (r) => r.over, size: 80, meta: { align: 'right' } },
    { id: 'avg', header: 'Median PSI', accessorFn: (r) => r.medianPsi ?? -1, size: 90, meta: { align: 'right', exportValue: (r) => r.medianPsi == null ? 'N/A' : Number(r.medianPsi.toFixed(1)) }, cell: ({ row }) => fmtN(row.original.medianPsi, 1) },
  ], [])

  const groupColumns = useMemo(() => [
    { id: 'group', header: 'Axle group', accessorFn: (r) => r.group, size: 130 },
    { id: 'readings', header: 'Readings', accessorFn: (r) => r.readings, size: 100, meta: { align: 'right' } },
    { id: 'measured', header: 'Measured', accessorFn: (r) => r.measured, size: 100, meta: { align: 'right' } },
    { id: 'comp', header: 'Within tolerance', accessorFn: (r) => r.compliancePct ?? -1, size: 130, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.compliancePct) },
    { id: 'under', header: 'Low', accessorFn: (r) => r.under, size: 80, meta: { align: 'right' } },
    { id: 'over', header: 'High', accessorFn: (r) => r.over, size: 80, meta: { align: 'right' } },
    { id: 'avg', header: 'Median PSI', accessorFn: (r) => r.medianPsi ?? -1, size: 90, meta: { align: 'right' }, cell: ({ row }) => fmtN(row.original.medianPsi, 1) },
  ], [])

  const inspectorColumns = useMemo(() => [
    { id: 'inspector', header: 'Inspector', accessorFn: (r) => r.inspector, size: 180 },
    { id: 'inspections', header: 'Inspections', accessorFn: (r) => r.inspections, size: 100, meta: { align: 'right' } },
    { id: 'readings', header: 'Pressures recorded', accessorFn: (r) => r.readings, size: 130, meta: { align: 'right' } },
    { id: 'measured', header: `With ${PRESSURE_MIN_READINGS}+ readings`, accessorFn: (r) => r.measuredPct ?? -1, size: 140, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.measuredPct) },
    { id: 'uniform', header: 'All wheels identical', accessorFn: (r) => r.uniformPct ?? -1, size: 140, meta: { align: 'right' }, cell: ({ row }) => fmtPct(row.original.uniformPct) },
    { id: 'flagged', header: 'Readings flagged', accessorFn: (r) => r.flagged, size: 120, meta: { align: 'right' } },
    { id: 'sites', header: 'Sites', accessorFn: (r) => r.sites || 'N/A', size: 220 },
  ], [])

  const qualityColumns = useMemo(() => [
    { id: 'date', header: 'Date', accessorFn: (r) => r.date || '', size: 110 },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 110 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 110 },
    { id: 'inspector', header: 'Inspector', accessorFn: (r) => r.inspector || 'N/A', size: 160 },
    { id: 'readings', header: 'Pressures', accessorFn: (r) => r.readings, size: 90, meta: { align: 'right' } },
    { id: 'positions', header: 'Wheels on sheet', accessorFn: (r) => r.positions, size: 120, meta: { align: 'right' } },
    { id: 'issue', header: 'Issue', accessorFn: (r) => (r.measured ? 'Every wheel reads the same PSI' : `Fewer than ${PRESSURE_MIN_READINGS} pressures`), size: 240 },
  ], [])

  // ── exports ───────────────────────────────────────────────────────────────
  const scopeLabel = [
    activeCountry !== 'All' ? activeCountry : 'All countries',
    site || null, inspector || null, group || null,
    from || to ? `${from || 'start'} to ${to || 'today'}` : null,
  ].filter(Boolean).join(' | ')

  async function exportExcel() {
    setExportError(null)
    try {
      const { exportSheetsToExcel, reportFileName, reportDateLabel } = await loadExportUtils()
      await exportSheetsToExcel([
        { name: 'Summary', rows: [
          { metric: 'Inspections in scope', value: kpis.inspections },
          { metric: `Inspections with ${PRESSURE_MIN_READINGS}+ pressures`, value: kpis.measuredInspections },
          { metric: 'Measured readings', value: kpis.measuredReadings },
          { metric: 'Within 15% of vehicle median', value: fmtPct(kpis.compliancePct) },
          { metric: 'Low readings', value: kpis.under },
          { metric: 'High readings', value: kpis.over },
          { metric: 'Vehicles with a flagged wheel', value: kpis.flaggedVehicles },
          { metric: 'Basis', value: kpis.basis },
        ], columns: ['metric', 'value'], headers: ['Metric', 'Value'] },
        { name: 'Readings', rows: readingExportRows(readings), columns: READING_EXPORT_COLS, headers: READING_EXPORT_HEADERS },
        { name: 'Sites', rows: sitesRows.map((s) => ({ ...s, compliancePct: s.compliancePct == null ? 'N/A' : Number(s.compliancePct.toFixed(1)), medianPsi: s.medianPsi == null ? 'N/A' : Number(s.medianPsi.toFixed(1)) })), columns: ['site', 'inspections', 'readings', 'compliancePct', 'under', 'over', 'medianPsi'], headers: ['Site', 'Inspections', 'Measured readings', 'Within tolerance %', 'Low', 'High', 'Median PSI'] },
        { name: 'Repeat deviations', rows: repeats, columns: ['asset_no', 'site', 'position', 'occurrences', 'lows', 'highs', 'lastDate', 'lastPsi', 'likelyCause'], headers: ['Asset', 'Site', 'Position', 'Times off median', 'Low', 'High', 'Last seen', 'Last PSI', 'Possible cause'] },
      ], reportFileName('Pressure Intelligence', reportDateLabel()), { title: 'Pressure Intelligence', company, notes: [scopeLabel, kpis.basis] })
    } catch (e) {
      setExportError(toUserMessage(e, 'The Excel file could not be created.'))
    }
  }

  async function exportPdf(opts = {}) {
    setExportError(null)
    try {
      const { exportToPdf, reportFileName, reportDateLabel } = await loadExportUtils()
      const rows = readingExportRows(readings.filter((r) => r.status === 'under' || r.status === 'over'))
      return await exportToPdf(
        rows,
        READING_EXPORT_COLS.map((key, i) => ({ key, header: READING_EXPORT_HEADERS[i] })),
        'Pressure Intelligence: wheels off vehicle median',
        reportFileName('Pressure Intelligence', reportDateLabel()),
        'landscape',
        company,
        { subtitleNote: `${scopeLabel} | ${fmtPct(kpis.compliancePct)} within tolerance`, emptyHint: 'No wheel is more than 15% off its vehicle median for these filters.', ...opts },
      )
    } catch (e) {
      setExportError(toUserMessage(e, 'The PDF could not be created.'))
      return null
    }
  }

  const hasData = inspections.length > 0

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title="Pressure Intelligence"
        subtitle="Every recorded wheel pressure compared with its own vehicle median at that inspection"
        icon={Gauge}
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
                filename: 'Pressure Intelligence.pdf',
                subject: 'Pressure Intelligence',
                bodyHtml: '<p>Attached: wheels more than 15% off their vehicle median pressure.</p>',
              })}
            />
          </div>
        }
      />

      {exportError && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{exportError}</div>
      )}

      <FilterBar
        search={search}
        onSearch={setSearch}
        placeholder="Search asset, site, inspector or vehicle type"
        searchLabel="Search inspections"
        resultCount={hasData ? scoped.length : null}
        onClearAll={filtersActive ? clearAll : undefined}
        selects={[
          { key: 'site', value: site, onChange: setSite, placeholder: 'All sites', ariaLabel: 'Filter by site', options: sites.map((s) => ({ value: s, label: s })) },
          { key: 'inspector', value: inspector, onChange: setInspector, placeholder: 'All inspectors', ariaLabel: 'Filter by inspector', options: inspectors.map((s) => ({ value: s, label: s })) },
          { key: 'group', value: group, onChange: setGroup, placeholder: 'All axles', ariaLabel: 'Filter by axle group', options: groupOptions.map((s) => ({ value: s, label: s })) },
          { key: 'status', value: status, onChange: setStatus, placeholder: 'All statuses', ariaLabel: 'Filter by reading status', options: Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.short })) },
        ]}
      >
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input text-sm min-h-[40px]" aria-label="From date" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input text-sm min-h-[40px]" aria-label="To date" />
        </label>
      </FilterBar>

      {loading && !hasData ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" aria-busy="true" aria-label="Loading pressure data">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="card h-[108px] animate-pulse" />)}
        </div>
      ) : error ? (
        <Card>
          <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle size={28} className="text-red-500" aria-hidden="true" />
            <p className="text-sm text-[var(--text-primary)] font-medium">Pressure data could not be loaded</p>
            <p className="text-xs text-[var(--text-muted)] max-w-md">{error}</p>
            <button type="button" onClick={load} className="btn-primary text-sm min-h-[44px] px-4 inline-flex items-center gap-2"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
          </div>
        </Card>
      ) : !hasData ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Gauge size={32} className="text-[var(--text-muted)]" aria-hidden="true" />
            <p className="text-sm text-[var(--text-primary)] font-medium">No inspections recorded for this country yet</p>
            <p className="text-xs text-[var(--text-muted)] max-w-md">Pressures appear here as soon as an inspection with wheel readings is saved from the web or the field app.</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-xl border border-[var(--border-dim)] bg-[var(--surface-2)] px-4 py-3 text-xs text-[var(--text-secondary)]">
            <Info size={14} className="shrink-0 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
            <p>
              There is no target pressure in the system, so each reading is compared with the median of the other wheels on the same vehicle at the same inspection.
              More than 15% off is flagged. An inspection with fewer than {PRESSURE_MIN_READINGS} readings is not judged. {kpis.basis}.
              {truncated && ` Capped view: the newest ${ROW_CAP.toLocaleString()} inspections are loaded.`}
              {loadedAt && ` Loaded ${loadedAt.toLocaleTimeString()}.`}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatTile index={0} icon={ShieldCheck} label="Within tolerance" value={fmtPct(kpis.compliancePct)} sub={`${fmtN(kpis.measuredReadings)} measured readings`} tone={kpis.compliancePct == null ? 'neutral' : kpis.compliancePct >= 95 ? 'accent' : kpis.compliancePct >= 85 ? 'warn' : 'crit'} spark={trend.map((m) => m.compliancePct).filter((v) => v != null)} />
            <StatTile index={1} icon={TrendingDown} label="Low wheels" value={fmtN(kpis.under)} sub="Over 15% below median" tone="crit" />
            <StatTile index={2} icon={TrendingUp} label="High wheels" value={fmtN(kpis.over)} sub="Over 15% above median" tone="warn" />
            <StatTile index={3} icon={Truck} label="Vehicles flagged" value={fmtN(kpis.flaggedVehicles)} sub="At least one wheel off" tone="info" />
            <StatTile index={4} icon={ClipboardCheck} label="Judgeable inspections" value={fmtPct(kpis.measurableCoveragePct, 0)} sub={`${fmtN(kpis.measuredInspections)} of ${fmtN(kpis.inspections)}`} tone="neutral" />
            <StatTile index={5} icon={Activity} label="Median PSI" value={fmtN(kpis.medianPsi, 1)} sub={`Median deviation ${fmtPct(kpis.medianAbsDeviationPct)}`} tone="neutral" />
          </div>

          <div role="tablist" aria-label="Pressure intelligence sections" className="flex flex-wrap gap-2 border-b border-[var(--border-dim)] pb-3">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`inline-flex items-center gap-2 px-3.5 min-h-[40px] rounded-lg text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${tab === key ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                <Icon size={15} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-5">
              {insights.length > 0 && (
                <Section title="What needs attention" icon={AlertTriangle} subtitle="Derived only from the measured readings in scope">
                  <ul className="space-y-2">
                    {insights.map((i, n) => (
                      <li key={n} className="flex items-start gap-3 rounded-lg border border-[var(--border-dim)] px-3 py-2">
                        <span className={`text-[11px] font-semibold uppercase tracking-wide shrink-0 mt-0.5 ${i.priority === 'Critical' ? 'text-red-400' : i.priority === 'High' ? 'text-orange-400' : 'text-amber-300'}`}>{i.priority}</span>
                        <span className="text-sm text-[var(--text-secondary)]">{i.message}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Section title="Pressure distribution" subtitle="Recorded PSI across the readings in scope" icon={BarChart2}>
                  <ChartBox empty={histogram.length ? null : 'No pressures match these filters.'} label={`Histogram of ${readings.length} pressure readings`}>
                    <Bar data={histData} options={chartOptions({ xTitle: 'PSI', yTitle: 'Readings' })} />
                  </ChartBox>
                </Section>
                <Section title="Monthly consistency" subtitle="Share of measured readings within 15% of median, last 12 months" icon={Activity}>
                  <ChartBox empty={trend.some((m) => m.compliancePct != null) ? null : 'No measured readings in the last 12 months.'} label="Monthly share of readings within tolerance">
                    <Line data={trendData} options={chartOptions({ yTitle: '% within tolerance', max: 100, pctAxis: true, legend: true })} />
                  </ChartBox>
                </Section>
                <Section title="Within tolerance by site" subtitle="Sites with measured readings, worst first" icon={MapPin}>
                  <ChartBox empty={siteChartRows.length ? null : 'No site has measured readings.'} label="Share within tolerance by site" height={Math.max(220, siteChartRows.length * 26)}>
                    <Bar data={siteData} options={chartOptions({ horizontal: true, xTitle: '% within tolerance', max: 100, pctAxis: true })} />
                  </ChartBox>
                </Section>
                <Section title="Flagged wheels by axle" subtitle="Low and high readings per axle group" icon={Truck}>
                  <ChartBox empty={groups.length ? null : 'No readings to group.'} label="Low and high readings per axle group">
                    <Bar data={groupData} options={chartOptions({ yTitle: 'Readings', legend: true, stacked: true })} />
                  </ChartBox>
                </Section>
              </div>
            </div>
          )}

          {tab === 'readings' && (
            <Section title="Wheel readings" icon={Gauge} subtitle="Select an asset to see its full pressure history. Status is shown in words as well as colour.">
              <EnterpriseTable
                columns={readingColumns}
                data={readings}
                getRowId={(r) => r.key}
                viewKey="pressure-intelligence-readings"
                initialPageSize={50}
                exportFileName="Pressure readings"
                searchPlaceholder="Search readings"
                emptyMessage={filtersActive ? 'No readings match these filters.' : 'No wheel pressures recorded yet.'}
              />
            </Section>
          )}

          {tab === 'repeats' && (
            <Section title="Repeat deviations" icon={Repeat} subtitle="The same wheel off its vehicle median on two or more inspections. A pattern of low readings is the typical slow leak or valve signature; pressure alone cannot prove the cause.">
              <EnterpriseTable
                columns={repeatColumns}
                data={repeats}
                getRowId={(r) => `${r.asset_no}|${r.position}`}
                initialPageSize={25}
                exportFileName="Pressure repeat deviations"
                emptyMessage="No wheel has been off its vehicle median more than once in this scope."
              />
            </Section>
          )}

          {tab === 'sites' && (
            <div className="space-y-5">
              <Section title="Sites" icon={MapPin} subtitle="Per-site consistency using the same vehicle-median rule">
                <EnterpriseTable columns={siteColumns} data={sitesRows} getRowId={(r) => r.site} initialPageSize={25} exportFileName="Pressure by site" emptyMessage="No sites in scope." />
              </Section>
              <Section title="Axle groups" icon={Truck} subtitle="Steer, drive and other axles from the recorded wheel positions">
                <EnterpriseTable columns={groupColumns} data={groups} getRowId={(r) => r.group} enableGlobalFilter={false} enableColumnFilters={false} exportFileName="Pressure by axle" emptyMessage="No readings to group." />
              </Section>
            </div>
          )}

          {tab === 'inspectors' && (
            <Section title="Inspector recording quality" icon={Users} subtitle="How completely each inspector records pressure. A high identical-reading share can mean a gauge was not used.">
              <EnterpriseTable columns={inspectorColumns} data={inspectorRows} getRowId={(r) => r.inspector} initialPageSize={25} exportFileName="Pressure by inspector" emptyMessage="No inspectors in scope." />
            </Section>
          )}

          {tab === 'quality' && (
            <Section title="Inspections that cannot be fully trusted" icon={ShieldCheck} subtitle={`Too few pressures to judge, or every wheel recorded at the same PSI. ${qualityRows.length.toLocaleString()} of ${perInspection.length.toLocaleString()} inspections.`}>
              <EnterpriseTable columns={qualityColumns} data={qualityRows} getRowId={(r, i) => String(r.id ?? i)} initialPageSize={25} exportFileName="Pressure data quality" emptyMessage="Every inspection in scope carries enough varied readings." />
            </Section>
          )}
        </>
      )}

      <Modal open={Boolean(drillAsset)} onClose={() => setDrillAsset(null)} title={`Pressure history: ${drillAsset || ''}`} subtitle={`${drillRows.length} readings across every loaded inspection`} size="xl">
        <EnterpriseTable
          columns={readingColumns.filter((c) => c.id !== 'asset')}
          data={drillRows}
          getRowId={(r) => r.key}
          initialPageSize={25}
          exportFileName={`Pressure history ${drillAsset || ''}`}
          emptyMessage="No pressures recorded for this asset."
        />
      </Modal>
    </div>
  )
}
