/**
 * Pressure Intelligence (route /pressure-intel), rebuilt on the Command Center kit.
 *
 * Every recorded wheel pressure (inspections.tyre_conditions pressure_psi) is
 * judged against its own vehicle median at that inspection, more than 15% off
 * flagged, fewer than 4 readings not judged. That single rule lives in
 * pressureIntelligenceAnalytics.js (via kpiEngine / inspectionView); this page
 * never restates it. View shaping: pressureIntelligenceView.js. Reads:
 * src/lib/api/pressureIntelligence.js.
 *
 * Tabs: Fleet View (each asset's latest inspection), Vehicle View (one row per
 * asset), Tyre View (every reading, full history), Alerts (flagged wheels and
 * repeat deviations), Trends (charts), Reports (site, axle, inspector and data
 * quality tables plus exports). Temperature and fuel saving have no source, so
 * they read N/A. There is no live sensor feed (tpms_readings is empty).
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import {
  Gauge, RefreshCw, AlertTriangle, Download, FileText, CheckCircle2, TrendingDown, TrendingUp,
  AlertOctagon, CircleDot, Fuel, Search, X, Radio, History, Info,
} from 'lucide-react'
import {
  PageHero, Kpi, Card, CardState, Tabs, Donut, KitTable, VehicleThumb, ViewAll, fmtInt,
} from '../components/commandCenter/kit'
import { PositionPressureChart, PressureTrendChart } from '../components/pressure/PressureCharts'
import Modal from '../components/ui/Modal'
import EmailPdfButton from '../components/EmailPdfButton'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  listPressureInspections, listPressureSpecs, countTpmsReadings, PRESSURE_ROW_CAP,
} from '../lib/api/pressureIntelligence'
import {
  buildReadings, inspectionPressureRows, filterInspections, pressureKpis,
  siteCompliance, groupBreakdown, psiHistogram, monthlyTrend, inspectorPressureQuality,
  repeatDeviations, pressureInsights, readingExportRows,
  READING_EXPORT_COLS, READING_EXPORT_HEADERS, PRESSURE_MIN_READINGS,
} from '../lib/pressureIntelligenceAnalytics'
import {
  VIEW_STATUS, VIEW_STATUS_ORDER, viewStatus, vehicleTypesOf, filterView, latestPerAsset,
  specLookup, decorate, fleetKpis, distributionSegments, positionBars, dailyTrend,
  alertRows, vehicleRows, fleetExportRows, FLEET_EXPORT_COLS, FLEET_EXPORT_HEADERS,
} from '../lib/pressureIntelligenceView'
import './PressureIntelligence.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

const loadExportUtils = () => import('../lib/exportUtils')

const NA = <span className="cc-na">N/A</span>
const fmtN = (v, d = 0) => (v == null || !Number.isFinite(v) ? 'N/A' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }))
const fmtPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(d)}%`)
const fmtDev = (v) => (v == null ? 'N/A' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)
const signed = (v) => (v == null ? 'N/A' : `${v > 0 ? '+' : ''}${fmtN(v, Number.isInteger(v) ? 0 : 1)}`)

const TABS = [
  { key: 'fleet', label: 'Fleet View' },
  { key: 'vehicle', label: 'Vehicle View' },
  { key: 'tyre', label: 'Tyre View' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'trends', label: 'Trends' },
  { key: 'reports', label: 'Reports' },
]

function StatusPill({ status }) {
  const m = VIEW_STATUS[status] || VIEW_STATUS.unmeasured
  return <span className={`cc-pill ${m.tone}`}>{m.label}</span>
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
    responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x',
    plugins: { legend: { display: legend, labels: { color: 'var(--text-secondary)', font: { size: 11 }, boxWidth: 12 } } },
    scales: horizontal ? { x: value, y: { ...axis(yTitle), stacked } } : { x: { ...axis(xTitle), stacked }, y: value },
  }
}

function ChartBox({ empty, label, height = 250, children }) {
  if (empty) return <div className="cc-empty" style={{ minHeight: height }}>{empty}</div>
  return <div role="img" aria-label={label} style={{ height }}>{children}</div>
}

export default function PressureIntelligence() {
  const { activeCountry, appSettings } = useSettings()
  const company = appSettings?.company_name || ''

  const [inspections, setInspections] = useState([])
  const [specs, setSpecs] = useState([])
  const [specError, setSpecError] = useState(null)
  const [tpmsCount, setTpmsCount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [loadedAt, setLoadedAt] = useState(null)
  const reqId = useRef(0)

  const [tab, setTab] = useState('fleet')
  const [search, setSearch] = useState('')
  const [site, setSite] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [inspector, setInspector] = useState('')
  const [group, setGroup] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [liveOpen, setLiveOpen] = useState(false)
  const [drillAsset, setDrillAsset] = useState(null)
  const [exportError, setExportError] = useState(null)

  const load = useCallback(async () => {
    const my = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const [{ rows, truncated: cut }, specRes, tpms] = await Promise.all([
        listPressureInspections({ country: activeCountry }),
        listPressureSpecs().then((d) => ({ d }), (e) => ({ e })),
        countTpmsReadings(),
      ])
      if (my !== reqId.current) return
      setInspections(rows)
      setTruncated(cut)
      setSpecs(specRes.d || [])
      setSpecError(specRes.e ? toUserMessage(specRes.e, 'Tyre specification pressures could not be read.') : null)
      setTpmsCount(tpms)
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
  const vehicleTypes = useMemo(() => vehicleTypesOf(inspections), [inspections])
  const lookup = useMemo(() => specLookup(specs), [specs])

  // Inspection-level scope (site, inspector, dates, search, vehicle type).
  const scoped = useMemo(() => {
    const vt = vehicleType.toUpperCase()
    return filterInspections(inspections, { site, inspector, from, to, search })
      .filter((r) => !vt || String(r.vehicle_type || '').trim().toUpperCase() === vt)
  }, [inspections, site, inspector, from, to, search, vehicleType])

  const allReadings = useMemo(() => decorate(buildReadings(scoped), lookup), [scoped, lookup])
  const groupScoped = useMemo(() => filterView(allReadings, { group }), [allReadings, group])
  const readings = useMemo(() => filterView(groupScoped, { status }), [groupScoped, status])
  // Status is held out of the headline counts and the donut: they report on status.
  const currentAll = useMemo(() => latestPerAsset(groupScoped), [groupScoped])
  const current = useMemo(() => filterView(currentAll, { status }), [currentAll, status])
  const fk = useMemo(() => fleetKpis(currentAll), [currentAll])
  const bars = useMemo(() => positionBars(current), [current])
  const trend7 = useMemo(() => dailyTrend(readings), [readings])
  const alerts = useMemo(() => alertRows(currentAll), [currentAll])
  const vehicles = useMemo(() => vehicleRows(current), [current])

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
    () => (drillAsset ? decorate(buildReadings(inspections.filter((r) => r.asset_no === drillAsset)), lookup) : [])
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [drillAsset, inspections, lookup],
  )

  const filtersActive = Boolean(search || site || vehicleType || inspector || group || status || from || to)
  const clearAll = () => { setSearch(''); setSite(''); setVehicleType(''); setInspector(''); setGroup(''); setStatus(''); setFrom(''); setTo('') }
  const hasData = inspections.length > 0
  const pageState = { loading, error, data: loading ? null : inspections, retry: load }

  // ── charts for the Trends tab ─────────────────────────────────────────────
  const histData = useMemo(() => ({
    labels: histogram.map((b) => b.label),
    datasets: [{ label: 'Readings', data: histogram.map((b) => b.count), backgroundColor: withAlpha(colorAt(0), 0.75), borderColor: colorAt(0), borderWidth: 1, borderRadius: 3 }],
  }), [histogram])
  const trendData = useMemo(() => ({
    labels: trend.map((m) => m.label),
    datasets: [{ label: 'Within tolerance %', data: trend.map((m) => (m.compliancePct == null ? null : Number(m.compliancePct.toFixed(1)))), borderColor: colorAt(1), backgroundColor: withAlpha(colorAt(1), 0.12), fill: true, tension: 0.3, spanGaps: true, pointRadius: 3 }],
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

  // ── table columns ─────────────────────────────────────────────────────────
  const historyBtn = (r) => (
    <button type="button" className="cc-icon-btn" onClick={(e) => { e.stopPropagation(); setDrillAsset(r.asset_no) }} aria-label={`Pressure history for ${r.asset_no}`} title="Pressure history" disabled={!r.asset_no}>
      <History size={14} aria-hidden="true" />
    </button>
  )
  const vehicleCell = (r) => (
    <div className="pi-veh">
      <VehicleThumb row={r} size="sm" />
      <div><b>{r.asset_no || 'N/A'}</b><small>{r.vehicle_type || 'Type not recorded'}</small></div>
    </div>
  )
  const recommendedCell = (r) => (
    <div className="pi-ref">
      <b>{r.median == null ? 'N/A' : fmtN(r.median, 1)}</b>
      <small>{r.median == null ? 'Too few readings' : 'Vehicle median'}{r.spec != null ? ` | Spec ${fmtN(r.spec)}` : ''}</small>
    </div>
  )
  const devCell = (r) => {
    const s = viewStatus(r)
    const cls = s === 'under' || s === 'critical' ? 'pi-bad' : s === 'over' ? 'pi-info' : ''
    return r.psiDiff == null ? NA : <span className={`pi-dev ${cls}`}>{signed(r.psiDiff)} <small>{fmtDev(r.deviationPct)}</small></span>
  }
  const tempCell = () => <span className="cc-na" title="No temperature source: inspections do not record it and no live sensor readings exist">N/A</span>

  const fleetColumns = [
    { key: 'asset', header: 'Vehicle / Asset', sortValue: (r) => r.asset_no || '', cell: vehicleCell },
    { key: 'serial', header: 'Serial Number', sortValue: (r) => r.serial || '', cell: (r) => (r.serial ? <span className="pi-mono">{r.serial}</span> : <span className="cc-na" title="No serial was recorded on this wheel">N/A</span>) },
    { key: 'position', header: 'Position', cell: (r) => r.position },
    { key: 'pressure', header: 'Current (psi)', numeric: true, cell: (r) => <b>{fmtN(r.pressure, Number.isInteger(r.pressure) ? 0 : 1)}</b> },
    { key: 'median', header: 'Recommended (psi)', numeric: true, sortValue: (r) => r.median ?? -1, cell: recommendedCell },
    { key: 'dev', header: 'Deviation', numeric: true, sortValue: (r) => (r.psiDiff == null ? -9999 : Math.abs(r.psiDiff)), cell: devCell },
    { key: 'temp', header: 'Temperature', sortable: false, cell: tempCell },
    { key: 'status', header: 'Status', sortValue: (r) => VIEW_STATUS_ORDER.indexOf(viewStatus(r)), cell: (r) => <StatusPill status={viewStatus(r)} /> },
    { key: 'date', header: 'Last Updated', sortValue: (r) => r.date || '', cell: (r) => r.date || NA },
    { key: 'actions', header: 'Actions', sortable: false, cell: historyBtn },
  ]
  const tyreColumns = [
    { key: 'date', header: 'Date', sortValue: (r) => r.date || '', cell: (r) => r.date || NA },
    ...fleetColumns.filter((c) => !['date', 'temp'].includes(c.key)).map((c) => (c.key === 'asset' ? { ...c, header: 'Asset' } : c)),
    { key: 'inspector', header: 'Inspector', sortValue: (r) => r.inspector || '', cell: (r) => r.inspector || NA },
  ]
  const vehicleColumns = [
    { key: 'asset', header: 'Vehicle / Asset', sortValue: (r) => r.asset_no, cell: vehicleCell },
    { key: 'site', header: 'Site', cell: (r) => r.site || NA },
    { key: 'date', header: 'Last inspected', cell: (r) => r.date || NA },
    { key: 'wheels', header: 'Wheels read', numeric: true },
    { key: 'medianPsi', header: 'Median (psi)', numeric: true, sortValue: (r) => r.medianPsi ?? -1, cell: (r) => fmtN(r.medianPsi, 1) },
    { key: 'under', header: 'Under', numeric: true },
    { key: 'over', header: 'Over', numeric: true },
    { key: 'critical', header: 'Critical', numeric: true },
    { key: 'worst', header: 'Worst deviation', numeric: true, sortValue: (r) => (r.worst == null ? -1 : Math.abs(r.worst)), cell: (r) => fmtDev(r.worst) },
    { key: 'state', header: 'Status', sortValue: (r) => VIEW_STATUS_ORDER.indexOf(r.state), cell: (r) => <StatusPill status={r.state} /> },
    { key: 'actions', header: 'Actions', sortable: false, cell: historyBtn },
  ]
  const repeatColumns = [
    { key: 'asset_no', header: 'Asset', cell: (r) => <button type="button" className="pi-link" onClick={() => setDrillAsset(r.asset_no)}>{r.asset_no}</button> },
    { key: 'site', header: 'Site', cell: (r) => r.site || NA },
    { key: 'position', header: 'Position' },
    { key: 'occurrences', header: 'Times off median', numeric: true },
    { key: 'lows', header: 'Low', numeric: true },
    { key: 'highs', header: 'High', numeric: true },
    { key: 'lastDate', header: 'Last seen', cell: (r) => r.lastDate || NA },
    { key: 'lastPsi', header: 'Last psi', numeric: true, sortValue: (r) => r.lastPsi ?? -1, cell: (r) => fmtN(r.lastPsi) },
    { key: 'likelyCause', header: 'Possible cause' },
  ]
  const siteColumns = [
    { key: 'site', header: 'Site' },
    { key: 'inspections', header: 'Inspections', numeric: true },
    { key: 'readings', header: 'Measured readings', numeric: true },
    { key: 'comp', header: 'Within tolerance', numeric: true, sortValue: (r) => r.compliancePct ?? -1, cell: (r) => fmtPct(r.compliancePct) },
    { key: 'under', header: 'Low', numeric: true },
    { key: 'over', header: 'High', numeric: true },
    { key: 'med', header: 'Median psi', numeric: true, sortValue: (r) => r.medianPsi ?? -1, cell: (r) => fmtN(r.medianPsi, 1) },
  ]
  const groupColumns = [
    { key: 'group', header: 'Axle group' },
    { key: 'readings', header: 'Readings', numeric: true },
    { key: 'measured', header: 'Measured', numeric: true },
    { key: 'comp', header: 'Within tolerance', numeric: true, sortValue: (r) => r.compliancePct ?? -1, cell: (r) => fmtPct(r.compliancePct) },
    { key: 'under', header: 'Low', numeric: true },
    { key: 'over', header: 'High', numeric: true },
    { key: 'med', header: 'Median psi', numeric: true, sortValue: (r) => r.medianPsi ?? -1, cell: (r) => fmtN(r.medianPsi, 1) },
  ]
  const inspectorColumns = [
    { key: 'inspector', header: 'Inspector' },
    { key: 'inspections', header: 'Inspections', numeric: true },
    { key: 'readings', header: 'Pressures recorded', numeric: true },
    { key: 'measuredPct', header: `With ${PRESSURE_MIN_READINGS}+ readings`, numeric: true, sortValue: (r) => r.measuredPct ?? -1, cell: (r) => fmtPct(r.measuredPct) },
    { key: 'uniformPct', header: 'All wheels identical', numeric: true, sortValue: (r) => r.uniformPct ?? -1, cell: (r) => fmtPct(r.uniformPct) },
    { key: 'flagged', header: 'Readings flagged', numeric: true },
    { key: 'sites', header: 'Sites', cell: (r) => r.sites || NA },
  ]
  const qualityColumns = [
    { key: 'date', header: 'Date', cell: (r) => r.date || NA },
    { key: 'asset_no', header: 'Asset', cell: (r) => r.asset_no || NA },
    { key: 'site', header: 'Site', cell: (r) => r.site || NA },
    { key: 'inspector', header: 'Inspector', cell: (r) => r.inspector || NA },
    { key: 'readings', header: 'Pressures', numeric: true },
    { key: 'positions', header: 'Wheels on sheet', numeric: true },
    { key: 'issue', header: 'Issue', sortValue: (r) => (r.measured ? 1 : 0), cell: (r) => (r.measured ? 'Every wheel reads the same psi' : `Fewer than ${PRESSURE_MIN_READINGS} pressures`) },
  ]

  // ── exports ───────────────────────────────────────────────────────────────
  const scopeLabel = [
    activeCountry !== 'All' ? activeCountry : 'All countries',
    site || null, vehicleType || null, inspector || null, group || null, status ? VIEW_STATUS[status]?.label : null,
    from || to ? `${from || 'start'} to ${to || 'today'}` : null,
  ].filter(Boolean).join(' | ')

  async function exportExcel() {
    setExportError(null)
    try {
      const { exportSheetsToExcel, reportFileName, reportDateLabel } = await loadExportUtils()
      await exportSheetsToExcel([
        { name: 'Summary', rows: [
          { metric: 'Wheels monitored (latest inspection per asset)', value: fk.total },
          { metric: 'Normal', value: fk.ok },
          { metric: 'Under inflated', value: fk.under },
          { metric: 'Over inflated', value: fk.over },
          { metric: 'Critical (recorded flat, burst or damaged)', value: fk.critical },
          { metric: 'Typical pressure (median psi)', value: fk.typicalPsi ?? 'N/A' },
          { metric: 'Inspections in scope', value: kpis.inspections },
          { metric: `Inspections with ${PRESSURE_MIN_READINGS}+ pressures`, value: kpis.measuredInspections },
          { metric: 'Measured readings', value: kpis.measuredReadings },
          { metric: 'Within 15% of vehicle median', value: fmtPct(kpis.compliancePct) },
          { metric: 'Low readings', value: kpis.under },
          { metric: 'High readings', value: kpis.over },
          { metric: 'Vehicles with a flagged wheel', value: kpis.flaggedVehicles },
          { metric: 'Basis', value: kpis.basis },
        ], columns: ['metric', 'value'], headers: ['Metric', 'Value'] },
        { name: 'Current wheels', rows: fleetExportRows(current), columns: FLEET_EXPORT_COLS, headers: FLEET_EXPORT_HEADERS },
        { name: 'Readings', rows: readingExportRows(readings), columns: READING_EXPORT_COLS, headers: READING_EXPORT_HEADERS },
        { name: 'Sites', rows: sitesRows.map((s) => ({ ...s, compliancePct: s.compliancePct == null ? 'N/A' : Number(s.compliancePct.toFixed(1)), medianPsi: s.medianPsi == null ? 'N/A' : Number(s.medianPsi.toFixed(1)) })), columns: ['site', 'inspections', 'readings', 'compliancePct', 'under', 'over', 'medianPsi'], headers: ['Site', 'Inspections', 'Measured readings', 'Within tolerance %', 'Low', 'High', 'Median PSI'] },
        { name: 'Axle groups', rows: groups.map((g) => ({ ...g, compliancePct: g.compliancePct == null ? 'N/A' : Number(g.compliancePct.toFixed(1)), medianPsi: g.medianPsi == null ? 'N/A' : Number(g.medianPsi.toFixed(1)) })), columns: ['group', 'readings', 'measured', 'compliancePct', 'under', 'over', 'medianPsi'], headers: ['Axle group', 'Readings', 'Measured', 'Within tolerance %', 'Low', 'High', 'Median PSI'] },
        { name: 'Inspectors', rows: inspectorRows.map((r) => ({ ...r, measuredPct: r.measuredPct == null ? 'N/A' : Number(r.measuredPct.toFixed(1)), uniformPct: r.uniformPct == null ? 'N/A' : Number(r.uniformPct.toFixed(1)), sites: r.sites || 'N/A' })), columns: ['inspector', 'inspections', 'readings', 'measuredPct', 'uniformPct', 'flagged', 'sites'], headers: ['Inspector', 'Inspections', 'Pressures recorded', `With ${PRESSURE_MIN_READINGS}+ readings %`, 'All wheels identical %', 'Readings flagged', 'Sites'] },
        { name: 'Data quality', rows: qualityRows.map((r) => ({ date: r.date || 'N/A', asset_no: r.asset_no || 'N/A', site: r.site || 'N/A', inspector: r.inspector || 'N/A', readings: r.readings, positions: r.positions, issue: r.measured ? 'Every wheel reads the same psi' : `Fewer than ${PRESSURE_MIN_READINGS} pressures` })), columns: ['date', 'asset_no', 'site', 'inspector', 'readings', 'positions', 'issue'], headers: ['Date', 'Asset', 'Site', 'Inspector', 'Pressures', 'Wheels on sheet', 'Issue'] },
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

  async function exportDrill() {
    setExportError(null)
    try {
      const { exportSheetsToExcel, reportFileName, reportDateLabel } = await loadExportUtils()
      await exportSheetsToExcel([{ name: 'History', rows: fleetExportRows(drillRows), columns: FLEET_EXPORT_COLS, headers: FLEET_EXPORT_HEADERS }],
        reportFileName('Pressure history', drillAsset || '', reportDateLabel()), { title: `Pressure history ${drillAsset || ''}`, company })
    } catch (e) {
      setExportError(toUserMessage(e, 'The Excel file could not be created.'))
    }
  }

  const pctLabel = (n, p) => (p == null ? fmtInt(n) : `${fmtInt(n)} (${p}%)`)
  const liveNote = tpmsCount == null
    ? 'Live sensor readings could not be checked.'
    : tpmsCount === 0
      ? 'There is no live sensor (TPMS) feed yet: no sensor readings have been recorded. Every figure on this page comes from saved inspections.'
      : `${fmtInt(tpmsCount)} live sensor readings are stored. This page still reads inspection pressures; a live sensor view is not built yet.`

  return (
    <div className="cc pi-page">
      <div className="pi-hero">
        <PageHero
          hello="Tyre Management › Pressure Intelligence"
          title="Pressure Intelligence"
          lead="Monitor, analyse and manage tyre pressure across the fleet for safety, fuel efficiency and extended tyre life."
          imgLight="/dashboard/hero-pressure-light.webp"
          imgDark="/dashboard/hero-pressure-dark.webp"
          stat={hasData && kpis.compliancePct != null ? { value: fmtPct(kpis.compliancePct, 0), lines: ['Readings within 15%', 'of vehicle median'] } : null}
        />
        <div className="pi-hero-actions">
          <button type="button" className="cc-btn-ghost" onClick={load} disabled={loading}><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
          <button type="button" className="cc-btn-ghost" onClick={exportExcel} disabled={!hasData}><Download size={14} aria-hidden="true" /> Excel</button>
          <button type="button" className="cc-btn-ghost" onClick={() => exportPdf()} disabled={!hasData}><FileText size={14} aria-hidden="true" /> PDF</button>
          <EmailPdfButton
            className="cc-btn-ghost"
            disabled={!hasData}
            getPdf={async () => ({
              base64: await exportPdf({ returnBase64: true }),
              filename: 'Pressure Intelligence.pdf',
              subject: 'Pressure Intelligence',
              bodyHtml: '<p>Attached: wheels more than 15% off their vehicle median pressure.</p>',
            })}
          />
        </div>
      </div>

      {exportError && <div className="cc-card pi-banner" role="alert"><AlertTriangle size={16} aria-hidden="true" /><div>{exportError}</div></div>}

      <div className="cc-kpis pi-kpis">
        <Kpi icon={Gauge} tone="t-green" value={fk.total} loading={loading} label="Total Tyres Monitored" title="Wheels with a pressure on each asset's latest inspection in scope" />
        <Kpi icon={CheckCircle2} tone="t-green" display={pctLabel(fk.ok, fk.okPct)} loading={loading} label="Correct Pressure" onClick={() => { setStatus('ok'); setTab('fleet') }} title="Within 15% of the vehicle median" />
        <Kpi icon={TrendingDown} tone="t-amber" display={pctLabel(fk.under, fk.underPct)} loading={loading} label="Under Inflated" onClick={() => { setStatus('under'); setTab('fleet') }} title="More than 15% below the vehicle median" />
        <Kpi icon={TrendingUp} tone="t-blue" display={pctLabel(fk.over, fk.overPct)} loading={loading} label="Over Inflated" onClick={() => { setStatus('over'); setTab('fleet') }} title="More than 15% above the vehicle median" />
        <Kpi icon={AlertOctagon} tone="t-red" display={pctLabel(fk.critical, fk.criticalPct)} danger={fk.critical > 0} loading={loading} label="Critical" onClick={() => { setStatus('critical'); setTab('fleet') }} title="Wheel recorded flat, burst or damaged" />
        <Kpi icon={CircleDot} tone="t-purple" display={fk.typicalPsi == null ? 'N/A' : fmtN(fk.typicalPsi, Number.isInteger(fk.typicalPsi) ? 0 : 1)} loading={loading} label="Typical Pressure (psi)" title="Median of the current wheel readings. A median is used because single mistyped readings would distort an average." />
        <Kpi icon={Fuel} tone="t-orange" display="N/A" label="Fuel Saving (est.)" title="Not available: the system has no fuel consumption data linked to tyre pressure, so no saving can be estimated." />
      </div>

      <Card className="pi-filters-card">
        <div className="pi-filters">
          <select className="cc-select" aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">All Sites</option>{sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="cc-select" aria-label="Vehicle type" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
            <option value="">All Vehicle Types</option>{vehicleTypes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="cc-select" aria-label="Position" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All Positions</option>{groupOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="cc-select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All Status</option>{VIEW_STATUS_ORDER.map((s) => <option key={s} value={s}>{VIEW_STATUS[s].label}</option>)}
          </select>
          <select className="cc-select" aria-label="Inspector" value={inspector} onChange={(e) => setInspector(e.target.value)}>
            <option value="">All Inspectors</option>{inspectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="pi-date"><span>From</span><input type="date" className="cc-select" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
          <label className="pi-date"><span>To</span><input type="date" className="cc-select" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
          <div className="cc-search pi-search"><Search size={14} aria-hidden="true" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by vehicle, site, inspector" aria-label="Search inspections" /></div>
          {filtersActive && <button type="button" className="cc-btn-ghost" onClick={clearAll}><X size={14} aria-hidden="true" /> Clear</button>}
          <button type="button" className={`cc-btn-primary pi-live ${liveOpen ? 'on' : ''}`} aria-expanded={liveOpen} onClick={() => setLiveOpen((v) => !v)}><Radio size={14} aria-hidden="true" /> Live View</button>
        </div>
        {liveOpen && <p className="pi-note" role="status"><Info size={13} aria-hidden="true" /> {liveNote}</p>}
        {hasData && (
          <p className="pi-note">
            No target pressure is stored for most vehicles, so each wheel is compared with the median of the other wheels on the same vehicle at the same inspection; more than 15% off is flagged and an inspection with fewer than {PRESSURE_MIN_READINGS} readings is not judged. A specification pressure is shown where one exists. {kpis.basis}.
            {truncated && ` Capped view: the newest ${PRESSURE_ROW_CAP.toLocaleString('en-US')} inspections are loaded.`}
            {specError && ` ${specError}`}
            {loadedAt && ` Loaded ${loadedAt.toLocaleTimeString()}.`}
          </p>
        )}
      </Card>

      <CardState state={pageState} empty={!loading && !error && !hasData ? 'No inspections with wheel pressures are recorded for this country yet. Pressures appear here as soon as an inspection with wheel readings is saved from the web or the field app.' : null} lines={6}>
        <div className="pi-main">
          <div className="pi-left">
            <Card className="pi-tabbar">
              <Tabs tabs={TABS.map((t) => ({ ...t, count: t.key === 'alerts' ? alerts.length || null : null, countTone: 'bad' }))} value={tab} onChange={setTab} label="Pressure views" />
            </Card>

            {tab === 'fleet' && (
              <Card title="Current wheel pressures" sub="Each asset's latest inspection in scope. Select the history icon for every reading on that asset.">
                <KitTable columns={fleetColumns} rows={current} empty={filtersActive ? 'No wheels match these filters.' : 'No wheel pressures recorded yet.'} getRowId={(r) => r.key} />
              </Card>
            )}
            {tab === 'vehicle' && (
              <Card title="Vehicles" sub="One row per asset from its latest inspection, worst first">
                <KitTable columns={vehicleColumns} rows={vehicles} empty="No vehicles match these filters." getRowId={(r) => r.asset_no} onRowClick={(r) => setDrillAsset(r.original?.asset_no ?? r.asset_no)} />
              </Card>
            )}
            {tab === 'tyre' && (
              <Card title="Every wheel reading" sub="Full history across all loaded inspections in scope" action={<button type="button" className="cc-btn-ghost" onClick={exportExcel}><Download size={14} aria-hidden="true" /> Excel</button>}>
                <KitTable columns={tyreColumns} rows={readings} empty={filtersActive ? 'No readings match these filters.' : 'No wheel pressures recorded yet.'} getRowId={(r) => r.key} />
              </Card>
            )}
            {tab === 'alerts' && (
              <>
                {insights.length > 0 && (
                  <Card title="What needs attention" sub="Derived only from the measured readings in scope">
                    <ul className="pi-insights">
                      {insights.map((i, n) => (
                        <li key={n}><span className={`cc-pill ${i.priority === 'Critical' ? 'bad' : i.priority === 'High' ? 'orange' : 'warn'}`}>{i.priority}</span><span>{i.message}</span></li>
                      ))}
                    </ul>
                  </Card>
                )}
                <Card title="Flagged wheels now" sub="Latest inspection per asset: critical first, then the largest deviation">
                  <KitTable columns={fleetColumns} rows={alerts} empty="No wheel is flagged on the latest inspections in scope." getRowId={(r) => r.key} />
                </Card>
                <Card title="Repeat deviations" sub="The same wheel off its vehicle median on two or more inspections. Repeated low readings are the typical slow leak or valve signature; pressure alone cannot prove the cause.">
                  <KitTable columns={repeatColumns} rows={repeats} empty="No wheel has been off its vehicle median more than once in this scope." getRowId={(r) => `${r.asset_no}|${r.position}`} />
                </Card>
              </>
            )}
            {tab === 'trends' && (
              <div className="pi-grid2">
                <Card title="Pressure distribution" sub="Recorded psi across the readings in scope">
                  <ChartBox empty={histogram.length ? null : 'No pressures match these filters.'} label={`Histogram of ${readings.length} pressure readings`}>
                    <Bar data={histData} options={chartOptions({ xTitle: 'PSI', yTitle: 'Readings' })} />
                  </ChartBox>
                </Card>
                <Card title="Monthly consistency" sub="Share of measured readings within 15% of median, last 12 months">
                  <ChartBox empty={trend.some((m) => m.compliancePct != null) ? null : 'No measured readings in the last 12 months.'} label="Monthly share of readings within tolerance">
                    <Line data={trendData} options={chartOptions({ yTitle: '% within tolerance', max: 100, pctAxis: true, legend: true })} />
                  </ChartBox>
                </Card>
                <Card title="Within tolerance by site" sub="Sites with measured readings, worst first">
                  <ChartBox empty={siteChartRows.length ? null : 'No site has measured readings.'} label="Share within tolerance by site" height={Math.max(220, siteChartRows.length * 26)}>
                    <Bar data={siteData} options={chartOptions({ horizontal: true, xTitle: '% within tolerance', max: 100, pctAxis: true })} />
                  </ChartBox>
                </Card>
                <Card title="Flagged wheels by axle" sub="Low and high readings per axle group">
                  <ChartBox empty={groups.length ? null : 'No readings to group.'} label="Low and high readings per axle group">
                    <Bar data={groupData} options={chartOptions({ yTitle: 'Readings', legend: true, stacked: true })} />
                  </ChartBox>
                </Card>
              </div>
            )}
            {tab === 'reports' && (
              <>
                <Card title="Summary" sub={kpis.basis} action={<div className="pi-actions"><button type="button" className="cc-btn-ghost" onClick={exportExcel}><Download size={14} aria-hidden="true" /> Excel workbook</button><button type="button" className="cc-btn-ghost" onClick={() => exportPdf()}><FileText size={14} aria-hidden="true" /> PDF of flagged wheels</button></div>}>
                  <dl className="pi-summary">
                    <div><dt>Within tolerance</dt><dd>{fmtPct(kpis.compliancePct)}</dd></div>
                    <div><dt>Measured readings</dt><dd>{fmtN(kpis.measuredReadings)}</dd></div>
                    <div><dt>Low wheels</dt><dd>{fmtN(kpis.under)}</dd></div>
                    <div><dt>High wheels</dt><dd>{fmtN(kpis.over)}</dd></div>
                    <div><dt>Vehicles flagged</dt><dd>{fmtN(kpis.flaggedVehicles)}</dd></div>
                    <div><dt>Judgeable inspections</dt><dd>{fmtPct(kpis.measurableCoveragePct, 0)} <small>({fmtN(kpis.measuredInspections)} of {fmtN(kpis.inspections)})</small></dd></div>
                    <div><dt>Median psi</dt><dd>{fmtN(kpis.medianPsi, 1)}</dd></div>
                    <div><dt>Median deviation</dt><dd>{fmtPct(kpis.medianAbsDeviationPct)}</dd></div>
                  </dl>
                </Card>
                <Card title="Sites" sub="Per-site consistency using the same vehicle-median rule">
                  <KitTable columns={siteColumns} rows={sitesRows} empty="No sites in scope." getRowId={(r) => r.site} />
                </Card>
                <Card title="Axle groups" sub="Steer, drive and other axles from the recorded wheel positions">
                  <KitTable columns={groupColumns} rows={groups} empty="No readings to group." getRowId={(r) => r.group} />
                </Card>
                <Card title="Inspector recording quality" sub="How completely each inspector records pressure. A high identical-reading share can mean a gauge was not used.">
                  <KitTable columns={inspectorColumns} rows={inspectorRows} empty="No inspectors in scope." getRowId={(r) => r.inspector} />
                </Card>
                <Card title="Inspections that cannot be fully trusted" sub={`Too few pressures to judge, or every wheel recorded at the same psi. ${qualityRows.length.toLocaleString('en-US')} of ${perInspection.length.toLocaleString('en-US')} inspections.`}>
                  <KitTable columns={qualityColumns} rows={qualityRows} empty="Every inspection in scope carries enough varied readings." getRowId={(r, i) => String(r.id ?? i)} />
                </Card>
              </>
            )}
          </div>

          <div className="pi-rail">
            <Card title="Pressure Distribution" sub="Latest inspection per asset">
              {fk.total ? <Donut segments={distributionSegments(fk)} total={fk.total} centerLabel="Total Tyres" onSelect={(s) => { setStatus(s.key); setTab('fleet') }} /> : <div className="cc-empty">No wheels in scope.</div>}
            </Card>
            <Card title="Position Wise Pressure" sub="Median current psi against the vehicle median">
              {bars.length ? <PositionPressureChart bars={bars} /> : <div className="cc-empty">No wheels in scope.</div>}
            </Card>
            <Card title="Pressure Trend (7 days)" sub={trend7.end ? `Median psi by axle, ${trend7.start} to ${trend7.end}` : 'Median psi by axle'}>
              {trend7.series.length ? <PressureTrendChart trend={trend7} /> : <div className="cc-empty">No dated readings in scope.</div>}
            </Card>
            <Card title="Alerts" action={alerts.length > 5 ? <ViewAll label="View all" onClick={() => setTab('alerts')} /> : null}>
              {alerts.length ? (
                <ul className="pi-alerts">
                  {alerts.slice(0, 5).map((a) => {
                    const s = viewStatus(a)
                    return (
                      <li key={a.key}>
                        <i className={`pi-dot ${VIEW_STATUS[s].tone}`} aria-hidden="true" />
                        <button type="button" className="pi-link" onClick={() => setDrillAsset(a.asset_no)}>{a.asset_no || 'N/A'} {a.position}</button>
                        <span className="pi-alert-psi">{fmtN(a.pressure)} psi ({VIEW_STATUS[s].label})</span>
                        <span className="pi-alert-date">{a.date || 'N/A'}</span>
                      </li>
                    )
                  })}
                </ul>
              ) : <div className="cc-empty">No wheel is flagged on the latest inspections.</div>}
            </Card>
          </div>
        </div>
      </CardState>

      <Modal open={Boolean(drillAsset)} onClose={() => setDrillAsset(null)} title={`Pressure history: ${drillAsset || ''}`} subtitle={`${drillRows.length} readings across every loaded inspection`} size="xl">
        <div className="cc">
          <div className="pi-actions pi-modal-actions"><button type="button" className="cc-btn-ghost" onClick={exportDrill} disabled={!drillRows.length}><Download size={14} aria-hidden="true" /> Excel</button></div>
          <KitTable columns={tyreColumns.filter((c) => c.key !== 'asset')} rows={drillRows} empty="No pressures recorded for this asset." getRowId={(r) => r.key} />
        </div>
      </Modal>
    </div>
  )
}
