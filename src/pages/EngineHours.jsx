/**
 * EngineHours (route /engine-hours) - Engine Hours, rebuilt on the shared page
 * kit to the owner's light reference design.
 *
 * Sources, all real:
 *  - engine_hours_logs (V161): the hour-meter readings. Full create / edit /
 *    delete as before, paged past the 1,000-row server cap.
 *  - vehicle_fleet: make, model, fleet number and the vehicle picture class.
 *  - asset_utilization: telematics working / idle / driving time snapshots.
 *  - pm_programs measured in engine hours: the service thresholds.
 *
 * Per-asset maths comes from engineHoursAnalytics.js (monotonic accumulation,
 * average daily hours, meter drops); the page view is shaped by
 * engineHoursView.js. Anything without a source reads N/A, never a made-up 0.
 * Each card loads, fails and retries on its own.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Gauge, Clock, CalendarX, Wrench, AlertOctagon, Plus, RefreshCw, Search, X,
  SlidersHorizontal, FileSpreadsheet, FileText, Pencil, Trash2, Loader2, Save,
  AlertTriangle, ListChecks, ExternalLink, ShieldAlert, Info, RotateCcw,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import SideDrawer from '../components/ui/SideDrawer'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  Card, CardState, Kpi, PageHero, Donut, Pager, MeterCell, KitTable, Tabs,
  VehicleThumb, useCard, fmtInt,
} from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import {
  listEngineHours, createEngineHours, updateEngineHours, deleteEngineHours,
  ENGINE_HOURS_SOURCES,
} from '../lib/api/engineHours'
import { listAssets } from '../lib/api/assets'
import { listAssetUtilization } from '../lib/api/assetUtilization'
import { listPmPrograms } from '../lib/api/pmPrograms'
import {
  filterEngineHours, anomalyRowIds, monthlyHoursTrend, utilizationByAsset,
  utilizationBySite, distinctFieldValues, engineHoursRow, engineHoursExportRow,
  summarizeEngineHours, ENGINE_HOURS_EXPORT_COLS, ENGINE_HOURS_EXPORT_HEADERS,
} from '../lib/engineHoursAnalytics'
import {
  DEFAULT_SETTINGS, normalizeSettings, assetProfiles, filterProfiles,
  utilizationSegments, dailyHoursTrend, telematicsSummary, allAnomalies, assetHourSeries,
  serviceThresholds, buildKpis, UTIL_STATUS, UTIL_STATUS_KEYS, THRESHOLD_STATUS,
  assetExportRow, ASSET_EXPORT_COLS, ASSET_EXPORT_HEADERS,
  thresholdExportRow, THRESHOLD_EXPORT_COLS, THRESHOLD_EXPORT_HEADERS,
} from '../lib/engineHoursView'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { compareValues, sortRows } from '../lib/consoleTable'
import { isMissingRelation } from '../lib/api/_client'
import './EngineHours.css'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'register', label: 'Hour Readings' },
  { key: 'thresholds', label: 'Service Thresholds' },
  { key: 'anomalies', label: 'Anomalies' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
]
const TAB_KEYS = TABS.map((t) => t.key)
const SETTINGS_KEY = 'engineHours.settings.v1'
const TREND_DAYS = [14, 30, 60, 90]
const SORTS = {
  asset: { label: 'Asset', fn: (a, b) => compareValues(a.asset_no, b.asset_no) },
  hours: { label: 'Current hours', fn: (a, b) => (b.currentHours ?? -1) - (a.currentHours ?? -1) },
  avg: { label: 'Daily avg hours', fn: (a, b) => (b.avgDailyHours ?? -1) - (a.avgDailyHours ?? -1) },
  last: { label: 'Oldest reading first', fn: (a, b) => String(a.lastReadingDate || '').localeCompare(String(b.lastReadingDate || '')) },
}

function readSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) } catch { return normalizeSettings({}) }
}
function writeSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* storage unavailable: settings apply to this visit only */ }
}

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blankToUndef = (v) => (v === null || v === undefined || v === '' ? undefined : v)
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const emptyForm = (preset = {}) => ({ asset_no: '', engine_hours: '', reading_date: localToday(), source: 'manual', site: '', notes: '', ...preset })

const fmtHours = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? 'N/A'
  : Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })
const fmtDate = (d) => {
  if (!d) return 'N/A'
  const dt = new Date(String(d).length === 10 ? `${d}T00:00:00` : d)
  return Number.isNaN(dt.getTime()) ? 'N/A' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
const na = (t = 'N/A') => <span className="cc-na">{t}</span>

/** Vertical bars over buckets of { label, hours }. One series, drawn only when measured. */
function HoursBars({ buckets, ariaLabel }) {
  const W = 640; const H = 200; const L = 40; const B = 24; const T = 8
  const max = Math.max(0, ...buckets.map((b) => b.hours || 0))
  const top = max > 0 ? Math.ceil(max / 4) * 4 || 4 : 4
  const plotW = W - L - 6
  const plotH = H - B - T
  const slot = plotW / Math.max(1, buckets.length)
  const barW = Math.max(2, Math.min(22, slot * 0.62))
  const every = Math.max(1, Math.ceil(buckets.length / 8))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="eh-bars" role="img" aria-label={ariaLabel} preserveAspectRatio="none">
      {[0, 1, 2, 3, 4].map((i) => {
        const y = T + plotH - (plotH * i) / 4
        return (
          <g key={i}>
            <line x1={L} x2={W - 4} y1={y} y2={y} className="eh-grid" />
            <text x={L - 6} y={y + 3} textAnchor="end" className="cc-axis">{fmtInt(Math.round((top * i) / 4))}</text>
          </g>
        )
      })}
      {buckets.map((b, i) => {
        const h = top ? (plotH * (b.hours || 0)) / top : 0
        const x = L + slot * i + (slot - barW) / 2
        return (
          <g key={b.day || b.label}>
            <rect x={x} y={T + plotH - h} width={barW} height={Math.max(0, h)} rx="2" className="eh-bar">
              <title>{`${b.label}: ${fmtHours(b.hours)} h${b.readings != null ? `, ${b.readings} reading${b.readings === 1 ? '' : 's'}` : ''}`}</title>
            </rect>
            {i % every === 0 && <text x={L + slot * i + slot / 2} y={H - 6} textAnchor="middle" className="cc-axis">{b.label}</text>}
          </g>
        )
      })}
    </svg>
  )
}

function Banner({ tone, children, onRetry, onDismiss }) {
  return (
    <div className={`cc-card eh-banner ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <AlertTriangle size={17} aria-hidden="true" />
      <div>{children}</div>
      {onRetry && <button type="button" className="cc-btn-ghost" onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Retry</button>}
      {onDismiss && <button type="button" className="cc-icon-btn" onClick={onDismiss} aria-label="Dismiss message"><X size={14} /></button>}
    </div>
  )
}

export default function EngineHours() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [settings, setSettings] = useState(readSettings)
  const [draft, setDraft] = useState(settings)

  // Filters
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [makeFilter, setMakeFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [assetFilter, setAssetFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')

  const [trendDays, setTrendDays] = useState(30)
  const [sortKey, setSortKey] = useState('asset')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [checked, setChecked] = useState(() => new Set())

  const [searchParams, setSearchParams] = useSearchParams()
  const tab = TAB_KEYS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'overview'
  const setTab = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (id === 'overview') next.delete('tab'); else next.set('tab', id)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [assetView, setAssetView] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Readings: the page's own loader, because create / edit / delete reload it.
  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listEngineHours({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load engine-hour readings.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])
  useEffect(() => { load() }, [load])

  // Linked sources: each loads and fails on its own.
  const fleetState = useCard(() => listAssets({ country: activeCountry }), [activeCountry])
  const utilState = useCard(() => listAssetUtilization({ country: activeCountry }), [activeCountry])
  const pmState = useCard(() => listPmPrograms({ country: activeCountry }), [activeCountry])

  const loadFailed = Boolean(error) && rows !== null && rows.length === 0 && !missing
  const now = useMemo(() => new Date(), [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  // Readings narrowed by site, dates, asset and source.
  const readingScope = useMemo(() => {
    const base = filterEngineHours(rows || [], { asset: assetFilter, site: siteFilter, from, to })
    return sourceFilter ? base.filter((r) => (r.source || '') === sourceFilter) : base
  }, [rows, assetFilter, siteFilter, from, to, sourceFilter])

  const allProfiles = useMemo(
    () => assetProfiles(readingScope, { fleet: fleetState.data || [], now, settings }),
    [readingScope, fleetState.data, now, settings],
  )
  const profiles = useMemo(
    () => filterProfiles(allProfiles, { make: makeFilter, model: modelFilter, status: statusFilter, search }).sort(SORTS[sortKey].fn),
    [allProfiles, makeFilter, modelFilter, statusFilter, search, sortKey],
  )
  // Every tab follows the asset set the filters leave.
  const assetSet = useMemo(() => new Set(profiles.map((p) => p.asset_no)), [profiles])
  const filtered = useMemo(
    () => readingScope.filter((r) => assetSet.has(String(r.asset_no || '').trim())),
    [readingScope, assetSet],
  )

  const anomalies = useMemo(() => allAnomalies(filtered), [filtered])
  const anomalyIds = useMemo(() => anomalyRowIds(filtered), [filtered])
  const trend = useMemo(() => dailyHoursTrend(filtered, { days: trendDays, now }), [filtered, trendDays, now])
  const telem = useMemo(() => telematicsSummary(utilState.data || [], assetSet), [utilState.data, assetSet])
  const segments = useMemo(() => utilizationSegments(profiles), [profiles])
  const thresholds = useMemo(
    () => (pmState.data ? serviceThresholds(pmState.data, rows || [], { settings }) : null),
    [pmState.data, rows, settings],
  )
  const kpi = useMemo(() => buildKpis({ profiles, readings: filtered, thresholds, now }), [profiles, filtered, thresholds, now])
  const summary = useMemo(() => summarizeEngineHours(filtered, {}, now), [filtered, now])
  const monthly = useMemo(() => monthlyHoursTrend(filtered, now).map((b) => ({ ...b, hours: b.hoursAdded })), [filtered, now])
  const bySite = useMemo(() => utilizationBySite(filtered, now), [filtered, now])
  const byAsset = useMemo(() => utilizationByAsset(filtered, now, 10), [filtered, now])

  const siteOptions = useMemo(() => distinctFieldValues(rows || [], 'site'), [rows])
  const assetOptions = useMemo(() => distinctFieldValues(rows || [], 'asset_no'), [rows])
  const sourceOptions = useMemo(() => distinctFieldValues(rows || [], 'source'), [rows])
  const makeOptions = useMemo(() => distinctFieldValues(allProfiles, 'make'), [allProfiles])
  const modelOptions = useMemo(
    () => distinctFieldValues(makeFilter ? allProfiles.filter((p) => p.make === makeFilter) : allProfiles, 'model'),
    [allProfiles, makeFilter],
  )

  const hasFilters = search || siteFilter || makeFilter || modelFilter || statusFilter || from || to || assetFilter || sourceFilter
  const moreCount = (assetFilter ? 1 : 0) + (sourceFilter ? 1 : 0)
  const clearFilters = () => {
    setSearch(''); setSiteFilter(''); setMakeFilter(''); setModelFilter(''); setStatusFilter('')
    setFrom(''); setTo(''); setAssetFilter(''); setSourceFilter(''); setPage(0)
  }
  useEffect(() => { setPage(0) }, [search, siteFilter, makeFilter, modelFilter, statusFilter, from, to, assetFilter, sourceFilter, sortKey])

  const pageCount = Math.max(1, Math.ceil(profiles.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = profiles.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const allOnPage = pageRows.length > 0 && pageRows.every((p) => checked.has(p.asset_no))
  const toggle = (id) => setChecked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleAll = () => setChecked((prev) => {
    const n = new Set(prev)
    if (allOnPage) pageRows.forEach((p) => n.delete(p.asset_no)); else pageRows.forEach((p) => n.add(p.asset_no))
    return n
  })
  const checkedRows = profiles.filter((p) => checked.has(p.asset_no))

  // CRUD ---------------------------------------------------------------------
  const openCreate = useCallback((preset = {}) => { setEditing(null); setForm(emptyForm(preset)); setFormError(''); setModalOpen(true) }, [])
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', engine_hours: r.engine_hours ?? '', reading_date: r.reading_date || localToday(),
      source: r.source || 'manual', site: r.site || '', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }, [])
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const closeForm = () => { if (!saving) setModalOpen(false) }
  const closeDelete = () => { if (!deleting) setConfirmDelete(null) }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (String(form.engine_hours).trim() === '' || Number.isNaN(Number(form.engine_hours))) {
      setFormError('A numeric engine-hours reading is required.'); return
    }
    setSaving(true)
    try {
      const payload = {
        asset_no: form.asset_no, engine_hours: form.engine_hours, reading_date: form.reading_date || null,
        source: form.source || null, site: form.site || null, notes: form.notes || null,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateEngineHours(editing.id, payload)
      else await createEngineHours(payload)
      setModalOpen(false)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the reading.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteEngineHours(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the reading.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // Exports ------------------------------------------------------------------
  const scopeLabel = activeCountry && activeCountry !== 'All' ? activeCountry : null
  const sortedReadings = useMemo(
    () => sortRows(filtered.map((r) => engineHoursRow(r, anomalyIds)), { key: 'day', dir: 'desc' }),
    [filtered, anomalyIds],
  )
  const runExport = async (fn) => {
    try { await fn() } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const exportReadings = (kind) => runExport(async () => {
    const data = sortedReadings.map((r) => engineHoursExportRow(r, anomalyIds))
    const name = reportFileName('TyrePulse Engine Hours', scopeLabel, reportDateLabel())
    if (kind === 'excel') await exportToExcel(data, ENGINE_HOURS_EXPORT_COLS, ENGINE_HOURS_EXPORT_HEADERS, name, 'Engine hours')
    else await exportToPdf(data, ENGINE_HOURS_EXPORT_COLS.map((c, i) => ({ key: c, header: ENGINE_HOURS_EXPORT_HEADERS[i] })), 'Engine Hours', name, 'landscape')
  })
  const exportAssets = (kind, list = profiles) => runExport(async () => {
    const data = list.map(assetExportRow)
    const name = reportFileName('TyrePulse Engine Hours by Asset', scopeLabel, reportDateLabel())
    if (kind === 'excel') await exportToExcel(data, ASSET_EXPORT_COLS, ASSET_EXPORT_HEADERS, name, 'Assets')
    else await exportToPdf(data, ASSET_EXPORT_COLS.map((c, i) => ({ key: c, header: ASSET_EXPORT_HEADERS[i] })), 'Engine Hours by Asset', name, 'landscape')
  })
  const exportAnomalies = () => runExport(async () => {
    const data = anomalies.map((a) => ({
      type: a.type === 'jump' ? 'Jump' : 'Drop', asset_no: a.asset_no, reading_date: a.reading_date || 'N/A',
      engine_hours: a.engine_hours ?? 'N/A', prev: a.prevHours ?? 'N/A', change: a.change ?? 'N/A',
    }))
    await exportToExcel(data, ['type', 'asset_no', 'reading_date', 'engine_hours', 'prev', 'change'],
      ['Type', 'Asset', 'Reading date', 'Reading', 'Previous', 'Change (h)'],
      reportFileName('TyrePulse Engine Hours Anomalies', scopeLabel, reportDateLabel()), 'Anomalies')
  })
  const exportThresholds = () => runExport(async () => {
    await exportToExcel((thresholds || []).map(thresholdExportRow), THRESHOLD_EXPORT_COLS, THRESHOLD_EXPORT_HEADERS,
      reportFileName('TyrePulse Engine Hour Service Thresholds', scopeLabel, reportDateLabel()), 'Thresholds')
  })

  // Tables -------------------------------------------------------------------
  const assetColumns = [
    {
      key: '_sel', sortable: false,
      header: <input type="checkbox" aria-label="Select all assets on this page" checked={allOnPage} onChange={toggleAll} />,
      cell: (p) => <input type="checkbox" aria-label={`Select ${p.asset_no}`} checked={checked.has(p.asset_no)} onChange={() => toggle(p.asset_no)} />,
    },
    {
      key: 'asset_no', header: 'Asset / Fleet No',
      cell: (p) => (
        <span className="cc-vehicle">
          <VehicleThumb row={{ asset_no: p.asset_no, make: p.make, model: p.model, vehicle_type: p.vehicle_type }} size="sm" />
          <span>
            <span className="cc-strong">{p.asset_no}</span>
            <span className="cc-sub">{p.fleet_number || (p.site ? p.site : 'No fleet number')}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'make', header: 'Make / Model',
      cell: (p) => (fleetState.loading && !fleetState.data ? na('...')
        : p.make || p.model ? <span>{p.make || 'N/A'}<span className="cc-sub">{p.model || 'N/A'}</span></span>
          : na(fleetState.error ? 'N/A' : p.inRegister ? 'N/A' : 'Not in register')),
    },
    { key: 'currentHours', header: 'Current Hours', numeric: true, cell: (p) => (p.currentHours == null ? na() : <span className="cc-strong">{fmtHours(p.currentHours)} h</span>) },
    {
      key: 'last', header: 'Last Reading',
      cell: (p) => (
        <span>
          {fmtDate(p.lastReadingDate)}
          <span className={`cc-sub ${p.readingOverdue ? 'eh-overdue' : ''}`}>
            {p.lastReadingDaysAgo == null ? 'No date' : p.lastReadingDaysAgo === 0 ? 'Today' : `${fmtInt(p.lastReadingDaysAgo)} day${p.lastReadingDaysAgo === 1 ? '' : 's'} ago`}
            {p.readingOverdue ? ', overdue' : ''}
          </span>
        </span>
      ),
    },
    {
      key: 'since', header: 'Hours Since', numeric: true,
      cell: (p) => (p.sincePrevious == null ? <span title="Needs two readings">{na()}</span>
        : <span title="Hours added since the previous reading">{fmtHours(p.sincePrevious)} h<span className="cc-sub">{p.sincePreviousDays == null ? '' : `over ${fmtInt(p.sincePreviousDays)} d`}</span></span>),
    },
    { key: 'avg', header: 'Daily Avg Hours', numeric: true, cell: (p) => (p.avgDailyHours == null ? <span title="Needs two dated readings">{na()}</span> : `${fmtHours(p.avgDailyHours)} h`) },
    {
      key: 'util', header: 'Utilization',
      cell: (p) => <span title={`Average daily run-hours as a share of ${settings.basisHoursPerDay} h`}><MeterCell value={p.utilizationPct == null ? null : Math.min(100, p.utilizationPct)} suffix="%" tone={p.utilizationPct == null ? undefined : UTIL_STATUS[p.status].color} /></span>,
    },
    { key: 'status', header: 'Status', cell: (p) => <span className={`cc-pill ${UTIL_STATUS[p.status].tone}`}>{UTIL_STATUS[p.status].label}</span> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, sortable: false,
      cell: (p) => (
        <span className="eh-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="cc-icon-btn" title="Log a reading" aria-label={`Log a reading for ${p.asset_no}`} disabled={missing} onClick={() => openCreate({ asset_no: p.asset_no, site: p.site || '' })}><Plus size={14} /></button>
          <button type="button" className="cc-icon-btn" title="View readings" aria-label={`View readings for ${p.asset_no}`} onClick={() => { setAssetFilter(p.asset_no); setMoreOpen(true); setTab('register') }}><ListChecks size={14} /></button>
          <Link className="cc-icon-btn" title="Open asset" aria-label={`Open asset ${p.asset_no}`} to={`/asset-management/${encodeURIComponent(p.asset_no)}`}><ExternalLink size={14} /></Link>
        </span>
      ),
    },
  ]

  const logColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => blankToUndef(r.asset_no), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="cc-strong">{getValue() || 'N/A'}</span> },
    { id: 'hours', header: 'Engine hours', accessorFn: (r) => r.hours ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="eh-nowrap">
          {row.original.hours == null ? 'N/A' : `${fmtHours(row.original.hours)} h`}
          {row.original.isAnomaly && <span className="cc-pill bad eh-mini"><ShieldAlert size={10} aria-hidden="true" /> anomaly</span>}
        </span>
      ) },
    { id: 'day', header: 'Reading date', accessorFn: (r) => blankToUndef(r.day), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => fmtDate(row.original.reading_date || row.original.created_at) },
    { id: 'source', header: 'Source', accessorFn: (r) => blankToUndef(r.source), sortingFn: valueSort, sortUndefined: 'last', cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (r) => blankToUndef(r.site), sortingFn: valueSort, sortUndefined: 'last', cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'notes', header: 'Notes', accessorFn: (r) => blankToUndef(r.notes), enableSorting: false,
      cell: ({ getValue }) => <span className="eh-notes" title={getValue() || ''}>{getValue() || 'N/A'}</span> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const label = `${r.asset_no || 'asset'} ${fmtDate(r.reading_date)}`
        return (
          <span className="eh-actions">
            <button type="button" className="cc-icon-btn" onClick={(e) => { e.stopPropagation(); openEdit(r) }} aria-label={`Edit reading ${label}`} title="Edit"><Pencil size={14} /></button>
            <button type="button" className="cc-icon-btn eh-danger" onClick={(e) => { e.stopPropagation(); setConfirmDelete(r) }} aria-label={`Delete reading ${label}`} title="Delete"><Trash2 size={14} /></button>
          </span>
        )
      } },
  ], [openEdit])

  const anomalyColumns = useMemo(() => [
    { id: 'type', header: 'Type', accessorKey: 'type', sortingFn: valueSort,
      cell: ({ getValue }) => <span className={`cc-pill ${getValue() === 'jump' ? 'warn' : 'bad'}`}>{getValue() === 'jump' ? 'Jump' : 'Drop'}</span> },
    { id: 'asset_no', header: 'Asset', accessorKey: 'asset_no', sortingFn: valueSort, cell: ({ getValue }) => <span className="cc-strong">{getValue() || 'N/A'}</span> },
    { id: 'reading_date', header: 'Reading date', accessorFn: (a) => blankToUndef(a.reading_date), sortingFn: valueSort, sortUndefined: 'last', cell: ({ getValue }) => fmtDate(getValue()) },
    { id: 'engine_hours', header: 'Reading', accessorFn: (a) => a.engine_hours ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => `${fmtHours(getValue())} h` },
    { id: 'prevHours', header: 'Previous', accessorFn: (a) => a.prevHours ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ row }) => <span>{fmtHours(row.original.prevHours)} h <span className="cc-sub">{row.original.prevDate ? fmtDate(row.original.prevDate) : ''}</span></span> },
    { id: 'change', header: 'Change', accessorFn: (a) => a.change ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ row }) => {
        const a = row.original
        return a.type === 'jump'
          ? <span className="eh-warn-text">+{fmtHours(a.change)} h<span className="cc-sub">{fmtHours(a.perDay)} h per day</span></span>
          : <span className="eh-bad-text">-{fmtHours(a.drop)} h</span>
      } },
  ], [])

  const thresholdColumns = [
    { key: 'name', header: 'Plan', cell: (t) => <span><span className="cc-strong">{t.name}</span><span className="cc-sub">{t.priority ? `Priority ${t.priority}` : ''}</span></span> },
    { key: 'asset_no', header: 'Asset', cell: (t) => t.asset_no || (t.asset_type ? <span>{t.asset_type}<span className="cc-sub">Asset type</span></span> : na()) },
    { key: 'currentHours', header: 'Current Hours', numeric: true, cell: (t) => (t.currentHours == null ? na() : <span>{fmtHours(t.currentHours)} h<span className="cc-sub">{fmtDate(t.lastReadingDate)}</span></span>) },
    { key: 'nextDueHours', header: 'Next Due', numeric: true, cell: (t) => (t.nextDueHours == null ? na() : `${fmtHours(t.nextDueHours)} h`) },
    { key: 'interval', header: 'Interval', numeric: true, cell: (t) => (t.interval == null ? na() : `${fmtHours(t.interval)} h`) },
    { key: 'remaining', header: 'Hours Left', numeric: true, sortValue: (t) => t.remaining ?? Infinity,
      cell: (t) => (t.remaining == null ? na() : <span className={t.remaining < 0 ? 'eh-bad-text' : ''}>{t.remaining < 0 ? `${fmtHours(-t.remaining)} h over` : `${fmtHours(t.remaining)} h`}</span>) },
    { key: 'status', header: 'Status', cell: (t) => <span className={`cc-pill ${THRESHOLD_STATUS[t.status].tone}`} title={t.reason || undefined}>{THRESHOLD_STATUS[t.status].label}</span> },
  ]

  const openAsset = (assetNo) => {
    const key = String(assetNo || '').trim().toUpperCase()
    if (!key) return
    setAssetView(allProfiles.find((p) => String(p.asset_no || '').toUpperCase() === key) || { asset_no: String(assetNo).trim() })
  }

  // KPIs ---------------------------------------------------------------------
  const readingsLoading = rows === null
  const pmNoPlans = thresholds && thresholds.length === 0
  const serviceDisplay = (v) => (pmState.loading && !pmState.data ? '...' : pmState.error ? 'N/A' : pmNoPlans ? 'N/A' : fmtInt(v))
  const serviceTitle = pmState.error ? 'Maintenance plans could not be read.'
    : pmNoPlans ? 'No active maintenance plan is measured in engine hours, so there is no threshold to compare against.' : null
  const kpis = [
    { icon: Gauge, tone: 't-green', label: 'Assets with hour meters', display: loadFailed ? 'N/A' : fmtInt(kpi.assetsWithMeters),
      title: 'Assets with at least one engine-hour reading in the current filters' },
    { icon: Clock, tone: 't-blue', label: 'Readings today', display: loadFailed ? 'N/A' : fmtInt(kpi.readingsToday),
      title: 'Engine-hour readings dated today', onClick: () => { setFrom(localToday()); setTo(localToday()); setTab('register') } },
    { icon: CalendarX, tone: 't-amber', label: 'Overdue readings', display: loadFailed ? 'N/A' : fmtInt(kpi.overdueReadings),
      title: `Assets with no reading in the last ${settings.staleDays} days`, onClick: () => { setStatusFilter('overdue'); setTab('overview') } },
    { icon: Wrench, tone: 't-orange', label: 'Near service', display: serviceDisplay(kpi.nearService),
      title: serviceTitle || `Engine-hour plans within ${fmtHours(settings.serviceWindowHours)} h of their next service`, onClick: () => setTab('thresholds') },
    { icon: AlertOctagon, tone: 't-red', label: 'Exceeded threshold', display: serviceDisplay(kpi.exceeded), danger: Boolean(kpi.exceeded),
      title: serviceTitle || 'Engine-hour plans past their next due hours', onClick: () => setTab('thresholds') },
  ]

  const readingsState = { loading: readingsLoading, error: loadFailed ? error : null, retry: load, data: rows }
  const trendHasData = trend.some((b) => b.hours > 0)
  const telemParts = [
    telem.workingHours != null && `working ${fmtHours(telem.workingHours)} h`,
    telem.idleHours != null && `idle ${fmtHours(telem.idleHours)} h`,
    telem.drivingHours != null && `driving ${fmtHours(telem.drivingHours)} h`,
  ].filter(Boolean)

  const tabList = TABS.map((t) => ({
    ...t,
    count: t.key === 'anomalies' && !loadFailed && anomalies.length ? anomalies.length
      : t.key === 'thresholds' && thresholds && kpi.exceeded ? kpi.exceeded : undefined,
    countTone: t.key === 'anomalies' || t.key === 'thresholds' ? 'red' : undefined,
  }))

  const saveSettings = (e) => {
    e.preventDefault()
    const next = normalizeSettings(draft)
    setSettings(next); setDraft(next); writeSettings(next)
  }
  const resetSettings = () => {
    const next = normalizeSettings(DEFAULT_SETTINGS)
    setSettings(next); setDraft(next); writeSettings(next)
  }

  return (
    <div className="cc eh-page">
      <div className="eh-hero-wrap">
        <PageHero
          title="Engine Hours"
          lead="Track engine hours, monitor utilization and plan maintenance based on accurate hour-meter readings."
          imgLight="/dashboard/hero-assets-light.webp"
          imgDark="/dashboard/hero-assets-dark.webp"
        />
        <div className="eh-hero-actions">
          <button type="button" className="cc-btn-ghost" onClick={() => { load(); fleetState.retry(); utilState.retry(); pmState.retry() }} disabled={refreshing}>
            <RefreshCw size={14} aria-hidden="true" className={refreshing ? 'eh-spin' : ''} /> Refresh
          </button>
          <button type="button" className="cc-btn-primary" onClick={() => openCreate()} disabled={missing}>
            <Plus size={15} aria-hidden="true" /> Add Reading
          </button>
        </div>
      </div>

      {missing && (
        <Banner tone="warn"><b>Engine hours tracking is not enabled on this database yet.</b><p>Apply MIGRATIONS_V161_ENGINE_HOURS.sql, then reload.</p></Banner>
      )}
      {loadFailed && (
        <Banner tone="bad" onRetry={load}><b>Could not load engine-hour readings.</b><p>{error}</p></Banner>
      )}
      {actionError && <Banner tone="bad" onDismiss={() => setActionError('')}><p>{actionError}</p></Banner>}

      <div className="cc-kpis eh-kpis">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={readingsLoading} />)}
      </div>

      <Tabs tabs={tabList} value={tab} onChange={setTab} label="Engine hours views" variant="line" />

      <div className="cc-card eh-filterbar">
        <div className="cc-filters">
          <div className="cc-search">
            <Search size={15} aria-hidden="true" />
            <label htmlFor="eh-search" className="sr-only">Search assets</label>
            <input id="eh-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset, fleet no, make, model or site..." />
          </div>
          <select className="cc-select" aria-label="Site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="cc-select" aria-label="Make" value={makeFilter} onChange={(e) => { setMakeFilter(e.target.value); setModelFilter('') }} disabled={!makeOptions.length}>
            <option value="">{fleetState.error ? 'Makes unavailable' : 'All makes'}</option>
            {makeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="cc-select" aria-label="Model" value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} disabled={!modelOptions.length}>
            <option value="">{fleetState.error ? 'Models unavailable' : 'All models'}</option>
            {modelOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="cc-select" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {UTIL_STATUS_KEYS.map((k) => <option key={k} value={k}>{UTIL_STATUS[k].label}</option>)}
            <option value="overdue">Reading overdue</option>
          </select>
          <label className="eh-date"><span className="sr-only">From date</span>
            <input type="date" className="cc-select eh-date-input" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="eh-date"><span className="sr-only">To date</span>
            <input type="date" className="cc-select eh-date-input" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" className="cc-btn-ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
            <SlidersHorizontal size={14} aria-hidden="true" /> More Filters{moreCount ? ` (${moreCount})` : ''}
          </button>
          {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={13} aria-hidden="true" /> Clear</button>}
        </div>
        {moreOpen && (
          <div className="cc-filters eh-more">
            <label className="cc-field"><span>Asset</span>
              <select className="cc-select" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
                <option value="">All assets</option>
                {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="cc-field"><span>Reading source</span>
              <select className="cc-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                <option value="">All sources</option>
                {sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
        )}
        <p className="eh-count" aria-live="polite">
          {readingsLoading ? 'Loading readings...' : `${fmtInt(profiles.length)} asset${profiles.length === 1 ? '' : 's'} and ${fmtInt(filtered.length)} of ${fmtInt(rows?.length || 0)} readings. Every tab follows these filters.`}
        </p>
      </div>

      {tab === 'overview' && (<>
        <div className="eh-row2">
          <Card
            title="Engine Hours Trend"
            sub="Run-hours added per day, from consecutive hour-meter readings."
            action={
              <select className="cc-select" aria-label="Trend period" value={trendDays} onChange={(e) => setTrendDays(Number(e.target.value))}>
                {TREND_DAYS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
              </select>
            }
          >
            <CardState state={readingsState} empty={!trendHasData ? 'No run-hours measured in this period. An asset needs two readings before hours can be counted.' : null} lines={5}>
              <div className="eh-legend">
                <span><i className="eh-swatch" aria-hidden="true" /> Total hours</span>
              </div>
              <HoursBars buckets={trend} ariaLabel={`Run-hours per day over the last ${trendDays} days`} />
            </CardState>
            <p className="eh-note">
              <Info size={12} aria-hidden="true" /> Hours count on the day of the later reading. Working, idle and PTO hours are not drawn per day: readings record the meter only, and PTO hours are not recorded anywhere.
              {' '}{utilState.loading && !utilState.data ? 'Checking telematics...'
                : utilState.error ? 'Telematics snapshots could not be read.'
                  : telem.assets ? `Telematics snapshots for ${fmtInt(telem.assets)} of these asset${telem.assets === 1 ? '' : 's'} (${telem.from === telem.to ? fmtDate(telem.from) : `${fmtDate(telem.from)} to ${fmtDate(telem.to)}`}): ${telemParts.length ? telemParts.join(', ') : 'no time figures'}.`
                    : 'No telematics snapshot covers these assets.'}
            </p>
          </Card>

          <Card title="Utilization Status" sub={`Assets by average daily run-hours (low is under ${fmtHours(settings.lowHoursPerDay)} h a day).`}>
            <CardState state={readingsState} empty={profiles.length ? null : 'No assets match these filters.'} lines={5}>
              <Donut segments={segments} total={profiles.length} centerLabel="Assets" onSelect={(s) => setStatusFilter(s.key === statusFilter ? '' : s.key)} />
            </CardState>
          </Card>
        </div>

        <Card
          title="Engine Hour Readings"
          sub={fleetState.error ? 'Make and model are unavailable because the asset register could not be read.' : 'Latest reading per asset, with utilization from its logged history.'}
          action={
            <div className="eh-head-actions">
              <select className="cc-select" aria-label="Sort assets" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>Sort: {s.label}</option>)}
              </select>
              <button type="button" className="cc-btn-ghost" onClick={() => exportAssets('excel')} disabled={!profiles.length}><FileSpreadsheet size={14} aria-hidden="true" /> Export</button>
            </div>
          }
        >
          {checked.size > 0 && (
            <div className="cc-bulk">
              <span className="cc-bulk-count">{checked.size} selected</span>
              <button type="button" className="cc-btn-ghost" onClick={() => exportAssets('excel', checkedRows)}><FileSpreadsheet size={14} aria-hidden="true" /> Export selected</button>
              <button type="button" className="cc-btn-ghost" onClick={() => setChecked(new Set())}>Clear selection</button>
            </div>
          )}
          <CardState state={readingsState} empty={profiles.length ? null : (rows && rows.length === 0 ? (missing ? 'Engine hours tracking is not enabled yet.' : 'No engine-hour readings yet. Add the first reading to get started.') : 'No assets match these filters.')} lines={8}>
            <KitTable manualPagination showPagination={false} enableSorting={false} onRowClick={(p) => setAssetView(p)}
              pageIndex={safePage} pageSize={pageSize} pageCount={pageCount} totalRows={profiles.length}
              getRowId={(p) => p.asset_no} rows={pageRows} columns={assetColumns} />
            <Pager page={safePage} pageSize={pageSize} total={profiles.length} noun="assets"
              onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0) }} sizes={[10, 25, 50, 100]} />
          </CardState>
        </Card>
      </>)}

      {tab === 'register' && (
        <Card title="Hour Readings" sub="Every logged reading, newest first. Edit or delete a reading from its row."
          action={
            <div className="eh-head-actions">
              <button type="button" className="cc-btn-ghost" onClick={() => exportReadings('excel')} disabled={!sortedReadings.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
              <button type="button" className="cc-btn-ghost" onClick={() => exportReadings('pdf')} disabled={!sortedReadings.length}><FileText size={14} aria-hidden="true" /> PDF</button>
            </div>
          }>
          <EnterpriseTable
            className="cc-et"
            columns={logColumns}
            data={sortedReadings}
            getRowId={(r) => String(r.id)}
            onRowClick={(r) => openAsset(r.asset_no)}
            loading={readingsLoading}
            error={loadFailed ? error : null}
            onRetry={load}
            enableColumnFilters={false}
            enableExport={false}
            searchPlaceholder="Search readings, source or notes"
            viewKey="engine-hours-log"
            initialPageSize={50}
            pageSizeOptions={[25, 50, 100, 250]}
            emptyMessage={missing ? 'Engine hours tracking is not enabled on this database yet.' : rows && rows.length === 0 ? 'No engine-hour readings yet. Add the first reading to get started.' : 'No readings match these filters.'}
          />
        </Card>
      )}

      {tab === 'thresholds' && (
        <Card title="Service Thresholds" sub={`Active maintenance plans measured in engine hours. Near service means within ${fmtHours(settings.serviceWindowHours)} h of the next due hours.`}
          action={
            <div className="eh-head-actions">
              <Link className="cc-btn-ghost" to="/pm-programs"><Wrench size={14} aria-hidden="true" /> Maintenance plans</Link>
              <button type="button" className="cc-btn-ghost" onClick={exportThresholds} disabled={!thresholds?.length}><FileSpreadsheet size={14} aria-hidden="true" /> Export</button>
            </div>
          }>
          <CardState
            state={{ loading: pmState.loading || readingsLoading, error: pmState.error, retry: pmState.retry, data: pmState.data && rows ? pmState.data : null }}
            empty={thresholds && thresholds.length === 0 ? 'No active maintenance plan is measured in engine hours. Set the meter source to engine hours on a plan in Preventive Maintenance to track it here.' : null}
            lines={6}
          >
            <div className="eh-strip">
              {['exceeded', 'near', 'ok', 'unknown'].map((k) => (
                <span key={k} className={`cc-pill ${THRESHOLD_STATUS[k].tone}`}>{THRESHOLD_STATUS[k].label}: {fmtInt((thresholds || []).filter((t) => t.status === k).length)}</span>
              ))}
            </div>
            <KitTable rows={thresholds || []} columns={thresholdColumns} getRowId={(t) => String(t.id)} empty="No plans" />
            <p className="eh-note"><Info size={12} aria-hidden="true" /> Current hours are the latest reading on file for the plan's asset, in any date range. A plan with no reading or no next due hours is shown as not measurable, never as on track.</p>
          </CardState>
        </Card>
      )}

      {tab === 'anomalies' && (
        <Card title={`Anomalies${loadFailed || readingsLoading ? '' : ` (${anomalies.length})`}`}
          sub="Drops: a reading lower than the previous one (meter reset, replacement or keying error). Jumps: more hours than the days between readings could hold. Shown as recorded, never smoothed away."
          action={<button type="button" className="cc-btn-ghost" onClick={exportAnomalies} disabled={!anomalies.length}><FileSpreadsheet size={14} aria-hidden="true" /> Export</button>}>
          <EnterpriseTable
            className="cc-et"
            columns={anomalyColumns}
            data={anomalies}
            getRowId={(a) => String(a.type === 'drop' ? `drop:${a.id}` : a.id)}
            onRowClick={(a) => openAsset(a.asset_no)}
            loading={readingsLoading}
            error={loadFailed ? error : null}
            onRetry={load}
            enableColumnFilters={false}
            enableExport={false}
            searchPlaceholder="Search anomalies"
            emptyMessage={rows && rows.length === 0 ? 'No readings logged yet.' : 'No meter drops or jumps in the filtered readings.'}
            emptyIcon={<ShieldAlert size={22} className="opacity-60" aria-hidden="true" />}
          />
        </Card>
      )}

      {tab === 'reports' && (<>
        <div className="eh-row2">
          <Card title="Monthly Run-Hours" sub="Hours added per month over the last 12 months.">
            <CardState state={readingsState} empty={monthly.some((b) => b.hours > 0) ? null : 'No run-hours measured in the last 12 months.'} lines={5}>
              <HoursBars buckets={monthly} ariaLabel="Run-hours per month over the last 12 months" />
            </CardState>
          </Card>
          <Card title="Utilization Highlights" sub="From each asset's average daily run-hours.">
            <CardState state={readingsState} empty={summary.mostUtilized || summary.staleAssets ? null : 'Needs two dated readings on at least one asset.'} lines={4}>
              <div className="cc-list">
                {summary.mostUtilized && <div className="cc-row"><div className="cc-row-main"><div className="cc-row-title">Most utilized: {summary.mostUtilized.asset_no}</div><div className="cc-row-meta">{fmtHours(summary.mostUtilized.avgDailyHours)} h a day</div></div></div>}
                {summary.leastUtilized && summary.leastUtilized.asset_no !== summary.mostUtilized?.asset_no && <div className="cc-row"><div className="cc-row-main"><div className="cc-row-title">Least utilized: {summary.leastUtilized.asset_no}</div><div className="cc-row-meta">{fmtHours(summary.leastUtilized.avgDailyHours)} h a day</div></div></div>}
                <div className="cc-row"><div className="cc-row-main"><div className="cc-row-title">Hours accumulated: {fmtHours(summary.totalHoursAdded)} h</div><div className="cc-row-meta">Across {fmtInt(summary.assetsTracked)} asset(s) in the filters</div></div></div>
                <div className="cc-row"><div className="cc-row-main"><div className="cc-row-title">Fleet average: {summary.avgDailyHours == null ? 'N/A' : `${fmtHours(summary.avgDailyHours)} h a day`}</div><div className="cc-row-meta">Highest meter {summary.maxHours == null ? 'N/A' : `${fmtHours(summary.maxHours)} h`}</div></div></div>
              </div>
            </CardState>
          </Card>
        </div>
        <div className="eh-row2 eh-row2-even">
          <Card title="Run-Hours by Site" sub="Hours counted at the site of the later reading.">
            <CardState state={readingsState} empty={bySite.length ? null : 'Needs two readings per asset to attribute hours.'} lines={5}>
              <BarList items={bySite.map((s) => ({ key: s.key, label: s.key, value: s.hoursAdded, meta: `${fmtInt(s.assets)} asset${s.assets === 1 ? '' : 's'}` }))} />
            </CardState>
          </Card>
          <Card title="Top Assets by Run-Hours" sub="The ten assets that ran the most hours.">
            <CardState state={readingsState} empty={byAsset.some((a) => a.hoursAdded > 0) ? null : 'Needs two readings per asset to measure run-hours.'} lines={5}>
              <BarList items={byAsset.filter((a) => a.hoursAdded > 0).map((a) => ({ key: a.asset, label: a.asset, value: a.hoursAdded, meta: a.avgDailyHours == null ? 'N/A a day' : `${fmtHours(a.avgDailyHours)} h a day` }))} />
            </CardState>
          </Card>
        </div>
        <Card title="Downloads" sub="Every file covers the current filters.">
          <div className="eh-downloads">
            <button type="button" className="cc-btn-ghost" onClick={() => exportReadings('excel')} disabled={!sortedReadings.length}><FileSpreadsheet size={14} aria-hidden="true" /> Readings (Excel)</button>
            <button type="button" className="cc-btn-ghost" onClick={() => exportReadings('pdf')} disabled={!sortedReadings.length}><FileText size={14} aria-hidden="true" /> Readings (PDF)</button>
            <button type="button" className="cc-btn-ghost" onClick={() => exportAssets('excel')} disabled={!profiles.length}><FileSpreadsheet size={14} aria-hidden="true" /> Asset summary (Excel)</button>
            <button type="button" className="cc-btn-ghost" onClick={() => exportAssets('pdf')} disabled={!profiles.length}><FileText size={14} aria-hidden="true" /> Asset summary (PDF)</button>
            <button type="button" className="cc-btn-ghost" onClick={exportAnomalies} disabled={!anomalies.length}><FileSpreadsheet size={14} aria-hidden="true" /> Anomalies (Excel)</button>
            <button type="button" className="cc-btn-ghost" onClick={exportThresholds} disabled={!thresholds?.length}><FileSpreadsheet size={14} aria-hidden="true" /> Service thresholds (Excel)</button>
          </div>
        </Card>
      </>)}

      {tab === 'settings' && (
        <Card title="Settings" sub="How this page judges utilization, overdue readings and service windows. Saved on this device only; the data itself is unchanged.">
          <form className="eh-settings" onSubmit={saveSettings}>
            <label className="cc-field"><span>Low utilization below (hours a day)</span>
              <input className="cc-select eh-num" type="number" min="0.1" max="24" step="0.1" value={draft.lowHoursPerDay} onChange={(e) => setDraft((d) => ({ ...d, lowHoursPerDay: e.target.value }))} />
            </label>
            <label className="cc-field"><span>Utilization basis (hours a day)</span>
              <input className="cc-select eh-num" type="number" min="1" max="24" step="0.5" value={draft.basisHoursPerDay} onChange={(e) => setDraft((d) => ({ ...d, basisHoursPerDay: e.target.value }))} />
            </label>
            <label className="cc-field"><span>Reading overdue after (days)</span>
              <input className="cc-select eh-num" type="number" min="1" max="365" step="1" value={draft.staleDays} onChange={(e) => setDraft((d) => ({ ...d, staleDays: e.target.value }))} />
            </label>
            <label className="cc-field"><span>Near service within (hours)</span>
              <input className="cc-select eh-num" type="number" min="1" max="5000" step="1" value={draft.serviceWindowHours} onChange={(e) => setDraft((d) => ({ ...d, serviceWindowHours: e.target.value }))} />
            </label>
            <div className="eh-settings-actions">
              <button type="submit" className="cc-btn-primary"><Save size={14} aria-hidden="true" /> Save settings</button>
              <button type="button" className="cc-btn-ghost" onClick={resetSettings}><RotateCcw size={14} aria-hidden="true" /> Reset to defaults</button>
            </div>
          </form>
          <p className="eh-note"><Info size={12} aria-hidden="true" /> Defaults: low under {DEFAULT_SETTINGS.lowHoursPerDay} h a day, utilization as a share of {DEFAULT_SETTINGS.basisHoursPerDay} h, overdue after {DEFAULT_SETTINGS.staleDays} days, and near service within {DEFAULT_SETTINGS.serviceWindowHours} h, the same window the Preventive Maintenance module uses.</p>
        </Card>
      )}

      {modalOpen && (
        <Modal open onClose={closeForm} size="md" title={editing ? 'Edit reading' : 'Add engine-hour reading'}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="eh-f-asset">Asset number</label>
                <input id="eh-f-asset" className="input w-full" placeholder="e.g. GEN-014" value={form.asset_no} maxLength={120} list="eh-asset-list" onChange={(e) => setField('asset_no', e.target.value)} />
                <datalist id="eh-asset-list">{assetOptions.map((a) => <option key={a} value={a} />)}</datalist>
              </div>
              <div>
                <label className="label" htmlFor="eh-f-hours">Engine hours</label>
                <input id="eh-f-hours" className="input w-full" type="number" step="0.1" min="0" placeholder="0.0" value={form.engine_hours} onChange={(e) => setField('engine_hours', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="eh-f-date">Reading date</label>
                <input id="eh-f-date" className="input w-full" type="date" value={form.reading_date} onChange={(e) => setField('reading_date', e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="eh-f-source">Source</label>
                <select id="eh-f-source" className="input w-full" value={form.source} onChange={(e) => setField('source', e.target.value)}>
                  {ENGINE_HOURS_SOURCES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="eh-f-site">Site (optional)</label>
              <input id="eh-f-site" className="input w-full" placeholder="Depot or site" value={form.site} maxLength={200} onChange={(e) => setField('site', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="eh-f-notes">Notes (optional)</label>
              <textarea id="eh-f-notes" className="input w-full min-h-[80px] resize-y" placeholder="Meter reset, telematics sync, anomaly" value={form.notes} maxLength={4000} onChange={(e) => setField('notes', e.target.value)} />
            </div>
            {formError && (
              <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={closeForm} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {saving ? 'Saving' : (editing ? 'Save changes' : 'Add reading')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {assetView && (
        <AssetHoursDrawer
          profile={assetView}
          series={assetHourSeries(rows || [], assetView.asset_no)}
          canAdd={!missing}
          onClose={() => setAssetView(null)}
          onAdd={() => { const a = assetView; setAssetView(null); openCreate({ asset_no: a.asset_no, site: a.site || '' }) }}
          onFilter={() => { const a = assetView; setAssetView(null); setAssetFilter(a.asset_no); setMoreOpen(true); setTab('register') }}
          onEdit={(r) => { setAssetView(null); openEdit(r) }}
        />
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={closeDelete}
          size="sm"
          title="Delete reading?"
          footer={
            <>
              <button type="button" onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting' : 'Delete'}
              </button>
            </>
          }
        >
          <p className="text-sm text-[var(--text-muted)]">
            This removes the {fmtHours(confirmDelete.engine_hours)} h reading for
            <span className="font-medium text-[var(--text-secondary)]"> {confirmDelete.asset_no || 'this asset'}</span>
            {confirmDelete.reading_date ? ` (${fmtDate(confirmDelete.reading_date)})` : ''}. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  )
}

/** Horizontal bars with a label, a value in hours and a side note. */
function BarList({ items }) {
  const max = Math.max(1, ...items.map((i) => i.value || 0))
  return (
    <div className="eh-barlist">
      {items.map((i) => (
        <div key={i.key} className="eh-barlist-row">
          <span className="eh-barlist-label" title={i.label}>{i.label}</span>
          <span className="cc-bar-track"><i style={{ width: `${Math.max(2, (i.value / max) * 100)}%`, background: 'var(--cc-green)' }} /></span>
          <b>{fmtHours(i.value)} h</b>
          <span className="eh-barlist-meta">{i.meta}</span>
        </div>
      ))}
    </div>
  )
}

/** One asset's engine-hour history: line chart with flagged points and every reading. */
function AssetHoursDrawer({ profile, series, canAdd, onClose, onAdd, onFilter, onEdit }) {
  const pts = series.points
  const dated = pts.filter((p) => p.date)
  const W = 560; const H = 180; const pad = { l: 56, r: 12, t: 12, b: 26 }
  let chart = <div className="cc-empty">{dated.length ? 'Only one dated reading, so there is no line to draw yet.' : 'No dated readings.'}</div>
  if (dated.length >= 2) {
    const t = dated.map((p) => Date.parse(`${p.date}T00:00:00Z`))
    const t0 = Math.min(...t); const t1 = Math.max(...t)
    const vals = dated.map((p) => p.value)
    const lo = Math.min(...vals); const span = (Math.max(...vals) - lo) || 1
    const x = (ms) => pad.l + (t1 === t0 ? 0 : ((ms - t0) / (t1 - t0)) * (W - pad.l - pad.r))
    const y = (v) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b)
    const d = dated.map((p, i) => ({ p, i })).filter(({ p }) => !p.flagged && !p.jump).map(({ p, i }, k) => `${k ? 'L' : 'M'}${x(t[i])},${y(p.value)}`).join(' ')
    const fmtD = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
    chart = (
      <div className="cc-chart eh-series">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Engine hours from ${fmtD(t0)} to ${fmtD(t1)}, ${series.flaggedCount} flagged`}>
          {[0, 0.5, 1].map((f) => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={y(lo + span * f)} y2={y(lo + span * f)} stroke="var(--cc-track)" /><text className="cc-axis" x={pad.l - 6} y={y(lo + span * f)} dy="0.35em" textAnchor="end">{fmtInt(Math.round(lo + span * f))}</text></g>)}
          <path d={d} fill="none" stroke="#16a34a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {dated.map((p, i) => (
            <circle key={p.key} cx={x(t[i])} cy={y(p.value)} r={p.flagged || p.jump ? 5 : 3} fill={p.flagged || p.jump ? 'var(--cc-red)' : '#16a34a'}>
              <title>{`${fmtDate(p.date)}: ${fmtHours(p.value)} h${p.reason ? `. ${p.reason}` : ''}`}</title>
            </circle>
          ))}
          <text className="cc-axis" x={pad.l} y={H - 6}>{fmtD(t0)}</text>
          <text className="cc-axis" x={W - pad.r} y={H - 6} textAnchor="end">{fmtD(t1)}</text>
        </svg>
      </div>
    )
  }
  const flagged = pts.filter((p) => p.flagged || p.jump)
  const newest = [...pts].reverse()
  return (
    <SideDrawer open onClose={onClose} size="lg" title={`${profile.asset_no} engine hours`}
      subtitle={[profile.fleet_number, profile.vehicle_type, profile.site].filter(Boolean).join(' | ') || undefined}
      footer={
        <div className="cc eh-drawer-foot">
          <button type="button" className="cc-btn-ghost" onClick={onFilter}>Show in Hour Readings</button>
          <Link className="cc-btn-ghost" to={`/asset-management/${encodeURIComponent(profile.asset_no)}`}><ExternalLink size={14} aria-hidden="true" /> Open asset</Link>
          <button type="button" className="cc-btn-primary" disabled={!canAdd} onClick={onAdd}><Plus size={14} aria-hidden="true" /> Log a reading</button>
        </div>
      }>
      <div className="cc eh-drawer">
        <div className="eh-drawer-head">
          <VehicleThumb row={{ asset_no: profile.asset_no, make: profile.make, model: profile.model, vehicle_type: profile.vehicle_type }} size="lg" />
          <dl className="eh-dl">
            <div><dt>Current hours</dt><dd>{profile.currentHours == null ? 'Not recorded' : `${fmtHours(profile.currentHours)} h`}</dd></div>
            <div><dt>Make / model</dt><dd>{[profile.make, profile.model].filter(Boolean).join(' ') || 'Not recorded'}</dd></div>
            <div><dt>Hours in history</dt><dd>{series.hoursRun == null ? 'N/A' : `${fmtHours(series.hoursRun)} h`}</dd></div>
            <div><dt>Daily average</dt><dd>{profile.avgDailyHours == null ? 'N/A' : `${fmtHours(profile.avgDailyHours)} h`}</dd></div>
            <div><dt>Readings</dt><dd>{fmtInt(pts.length)}{series.firstDate ? `, ${fmtDate(series.firstDate)} to ${fmtDate(series.lastDate)}` : ''}</dd></div>
            <div><dt>Flagged</dt><dd className={flagged.length ? 'eh-bad-text' : ''}>{fmtInt(flagged.length)}</dd></div>
          </dl>
        </div>
        {flagged.length > 0 && (
          <div className="eh-flags" role="note">
            <b><AlertTriangle size={14} aria-hidden="true" /> Flagged readings</b>
            <ul>{flagged.slice(-8).reverse().map((p) => <li key={p.key}>{fmtDate(p.date)}: {fmtHours(p.value)} h. {p.reason}</li>)}</ul>
          </div>
        )}
        <Card title="Engine hours over time" sub="Green line joins accepted readings; red points are drops or jumps.">{chart}</Card>
        <Card title="All readings for this asset">
          <KitTable compact scroll rows={newest} getRowId={(p) => p.key} onRowClick={(p) => onEdit(p.row)} empty="No readings recorded for this asset."
            columns={[
              { key: 'date', header: 'Reading date', cell: (p) => fmtDate(p.date) },
              { key: 'value', header: 'Engine hours', numeric: true, cell: (p) => `${fmtHours(p.value)} h` },
              { key: 'source', header: 'Source', cell: (p) => p.row.source || 'Not recorded' },
              { key: 'site', header: 'Site', cell: (p) => p.row.site || 'Not recorded' },
              { key: 'status', header: 'Status', cell: (p) => (p.flagged || p.jump
                ? <span><span className={`cc-pill ${p.jump ? 'warn' : 'bad'}`}>{p.jump ? 'Jump' : 'Drop'}</span><span className="cc-sub eh-reason">{p.reason}</span></span>
                : <span className="cc-pill good">Accepted</span>) },
            ]} />
          <p className="eh-note"><Info size={12} aria-hidden="true" /> Click a reading to edit it.</p>
        </Card>
      </div>
    </SideDrawer>
  )
}
