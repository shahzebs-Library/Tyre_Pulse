/**
 * JourneyLog (route /journeys) - record and track vehicle journeys: asset,
 * driver, origin to destination, scheduled/actual times, distance and purpose,
 * with a status lifecycle (planned, in progress, completed, cancelled).
 *
 * Tabs: Register (sortable EnterpriseTable with create/edit/delete) and
 * Analytics (trend, status, on-time, top performers, data quality, driver /
 * asset performance). Filters and the KPI strip apply to both.
 *
 * Journey maths: src/lib/journeys.js. Page-side filtering, row shaping and
 * exports: src/lib/journeyLogAnalytics.js. Runs on the `journeys` table
 * (MIGRATIONS_V139_JOURNEYS.sql); a missing relation shows an "apply the
 * migration" state instead of an error.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Line, Doughnut, Bar } from 'react-chartjs-2'
import {
  Navigation, Plus, Search, X, FileSpreadsheet, FileText,
  AlertTriangle, Loader2, Milestone, PlayCircle, Gauge, Pencil, Trash2, Send,
  Clock, Timer, CheckCircle2, ShieldAlert, TrendingUp, List, BarChart3, CalendarDays, Users,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import { toUserMessage } from '../lib/safeError'
import { listJourneys, createJourney, updateJourney, deleteJourney } from '../lib/api/journeys'
import { buildJourneyAnalytics, JOURNEY_STATUSES, JOURNEY_STATUS_META, ON_TIME_META, ON_TIME_TOLERANCE_MIN } from '../lib/journeys'
import {
  filterJourneys, journeyRow, distanceHeadline, recentActivity, distinctJourneyValues,
  journeyExportRows, JOURNEY_EXPORT_COLUMNS, perfRows as perfRowsOf, perfExportRows, PERF_EXPORT_COLUMNS,
  toLocalInput, formatJourneyDateTime,
} from '../lib/journeyLogAnalytics'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Filler, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')

// Semantic status / on-time colours (meaning-carrying, deliberately not palettised).
const STATUS_COLOR = { planned: '#0ea5e9', in_progress: '#f59e0b', completed: '#10b981', cancelled: '#ef4444' }
const ON_TIME_COLOR = { early: '#0ea5e9', on_time: '#10b981', late: '#ef4444', unknown: '#64748b' }
const STATUS_BADGE = {
  planned: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  in_progress: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  completed: 'bg-green-900/40 text-green-300 border border-green-700/50',
  cancelled: 'bg-red-900/40 text-red-300 border border-red-700/50',
}
const STATUS_ICON = { planned: CalendarDays, in_progress: PlayCircle, completed: CheckCircle2, cancelled: X }

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', font: { size: 11 }, boxWidth: 12 } },
    tooltip: { enabled: true },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}
const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-muted)', font: { size: 11 }, boxWidth: 12 } } },
}

const EMPTY_FORM = {
  asset_no: '', driver_name: '', origin: '', destination: '', purpose: '',
  start_time: '', end_time: '', distance_km: '', site: '', status: 'planned', notes: '',
}

const ICON_BTN = 'min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

function StatusBadge({ status }) {
  const Icon = STATUS_ICON[status] || CalendarDays
  return (
    <span className={`badge inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE[status] || STATUS_BADGE.planned}`}>
      <Icon size={11} aria-hidden="true" /> {JOURNEY_STATUS_META[status]?.label || status || 'N/A'}
    </span>
  )
}

function Field({ id, label, required, children }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}{required && <span className="text-red-400" aria-hidden="true"> *</span>}</label>
      {children}
    </div>
  )
}

export default function JourneyLog() {
  const { activeCountry, appSettings } = useSettings()
  const company = appSettings?.company_name || ''
  const [rows, setRows] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [tab, setTab] = useState('register')

  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [perfView, setPerfView] = useState('driver')

  const load = useCallback(async () => {
    setRefreshing(true); setLoadError(''); setMissing(false)
    try {
      const data = await listJourneys({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setLoadError(toUserMessage(err, 'Could not load journeys.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const all = useMemo(() => rows || [], [rows])
  const assetOptions = useMemo(() => distinctJourneyValues(all, 'asset_no'), [all])
  const siteOptions = useMemo(() => distinctJourneyValues(all, 'site'), [all])

  const filtered = useMemo(
    () => filterJourneys(all, { status: statusFilter, asset: assetFilter, site: siteFilter, from: fromDate, to: toDate, search }),
    [all, statusFilter, assetFilter, siteFilter, fromDate, toDate, search],
  )
  const tableRows = useMemo(() => filtered.map(journeyRow), [filtered])

  const analytics = useMemo(() => buildJourneyAnalytics(filtered), [filtered])
  const distance = useMemo(() => distanceHeadline(filtered), [filtered])
  const activity = useMemo(() => recentActivity(filtered, new Date()), [filtered])
  const perfRows = useMemo(() => perfRowsOf(analytics, perfView), [analytics, perfView])

  const monthlyChart = useMemo(() => {
    const c = colorAt(0)
    return {
      labels: analytics.monthly.labels,
      datasets: [{
        label: 'Distance (km)', data: analytics.monthly.distance,
        borderColor: c, backgroundColor: withAlpha(c, 0.15), pointBackgroundColor: c, borderWidth: 2, tension: 0.35, fill: true,
      }],
    }
  }, [analytics])

  const statusChart = useMemo(() => {
    const f = analytics.funnel.filter((x) => x.count > 0)
    return {
      data: { labels: f.map((x) => x.label), datasets: [{ data: f.map((x) => x.count), backgroundColor: f.map((x) => STATUS_COLOR[x.status]), borderWidth: 0 }] },
      total: f.reduce((s, x) => s + x.count, 0),
      summary: f.map((x) => `${x.label} ${x.count}`).join(', '),
    }
  }, [analytics])

  const onTimeChart = useMemo(() => {
    const order = ['early', 'on_time', 'late']
    return {
      labels: order.map((k) => ON_TIME_META[k]?.label || k),
      datasets: [{ label: 'Trips', data: order.map((k) => analytics.onTime[k]), backgroundColor: order.map((k) => ON_TIME_COLOR[k]), borderWidth: 0 }],
    }
  }, [analytics])

  const topDistanceChart = useMemo(() => {
    const list = perfRows.slice(0, 8)
    return {
      data: { labels: list.map((x) => x.name), datasets: [{ label: 'Distance (km)', data: list.map((x) => x.distance), backgroundColor: categorical(list.length), borderWidth: 0 }] },
      empty: list.length === 0,
    }
  }, [perfRows])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = useCallback((j) => {
    setEditing(j)
    setForm({
      asset_no: j.asset_no || '', driver_name: j.driver_name || '', origin: j.origin || '',
      destination: j.destination || '', purpose: j.purpose || '',
      start_time: toLocalInput(j.start_time), end_time: toLocalInput(j.end_time),
      distance_km: j.distance_km ?? '', site: j.site || '', status: j.status || 'planned',
      notes: j.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }, [])
  const closeModal = useCallback(() => { if (!saving) setModalOpen(false) }, [saving])
  const closeDelete = useCallback(() => { if (!deleting) setConfirmDelete(null) }, [deleting])

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset (vehicle) number is required.'); return }
    if (form.start_time && form.end_time && form.end_time < form.start_time) { setFormError('End time must be after the start time.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) {
        const updated = await updateJourney(editing.id, payload)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await createJourney(payload)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the journey.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteJourney(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the journey.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  const clearFilters = () => { setStatusFilter('all'); setAssetFilter(''); setSiteFilter(''); setFromDate(''); setToDate(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || assetFilter || siteFilter || fromDate || toDate || search

  const runExport = async (format, which = 'journeys') => {
    setExporting(true); setActionError('')
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await loadExportUtils()
      const perf = which === 'perf'
      const cols = perf ? PERF_EXPORT_COLUMNS : JOURNEY_EXPORT_COLUMNS
      const data = perf ? perfExportRows(perfRows) : journeyExportRows(filtered)
      const title = perf ? `Journey ${perfView === 'asset' ? 'Asset' : 'Driver'} Performance` : 'Journey Log'
      const file = reportFileName(title)
      if (format === 'pdf') await exportToPdf(data, cols, title, file, 'landscape', company)
      else await exportToExcel(data, cols.map((c) => c.key), cols.map((c) => c.header), file, perf ? 'Performance' : 'Journeys')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    } finally {
      setExporting(false)
    }
  }

  const columns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || undefined, sortUndefined: 'last', size: 110,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || undefined, sortUndefined: 'last', size: 140 },
    { id: 'route', header: 'Route', accessorFn: (r) => r.route, size: 220,
      cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.origin || 'N/A'} <span className="text-[var(--text-muted)]">to</span> {row.original.destination || 'N/A'}</span> },
    { id: 'purpose', header: 'Purpose', accessorFn: (r) => r.purpose || undefined, sortUndefined: 'last', size: 140 },
    { id: 'start', header: 'Start', accessorFn: (r) => r.start_time || undefined, sortUndefined: 'last', size: 170,
      meta: { exportValue: (r) => formatJourneyDateTime(r.start_time) },
      cell: ({ row }) => <span className="whitespace-nowrap">{formatJourneyDateTime(row.original.start_time)}</span> },
    { id: 'distance', header: 'Distance', accessorFn: (r) => r.distance ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 100,
      cell: ({ row }) => (row.original.distance == null ? 'N/A' : `${row.original.distance} km`) },
    { id: 'duration', header: 'Duration', accessorFn: (r) => r.duration ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 100,
      cell: ({ row }) => (row.original.duration == null ? 'N/A' : `${row.original.duration} h`) },
    { id: 'speed', header: 'Avg speed', accessorFn: (r) => r.speed ?? undefined, sortUndefined: 'last', meta: { align: 'right', defaultHidden: true }, size: 110,
      cell: ({ row }) => (row.original.speed == null ? 'N/A' : `${row.original.speed} km/h`) },
    { id: 'ontime', header: 'On time', accessorFn: (r) => (r.onTimeClass === 'unknown' ? undefined : ON_TIME_META[r.onTimeClass]?.label), sortUndefined: 'last', size: 110,
      cell: ({ row }) => (row.original.onTimeClass === 'unknown' ? <span className="text-[var(--text-muted)]">N/A</span> : <span className={ON_TIME_META[row.original.onTimeClass]?.tint}>{ON_TIME_META[row.original.onTimeClass]?.label}</span>) },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || undefined, sortUndefined: 'last', size: 110, meta: { defaultHidden: true } },
    { id: 'status', header: 'Status', accessorFn: (r) => JOURNEY_STATUS_META[r.status]?.label || r.status, size: 130,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge status={row.original.status} />
          {row.original.flags.length > 0 && (
            <span title={row.original.flags.map((f) => f.label).join('; ')} className="inline-flex items-center gap-0.5 text-[11px] text-amber-400">
              <ShieldAlert size={12} aria-hidden="true" /><span className="sr-only">Data quality issue: </span>{row.original.flags.length}
            </span>
          )}
        </span>
      ) },
    { id: 'actions', header: '', enableSorting: false, enableHiding: false, size: 90, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(r) }} className={`${ICON_BTN} hover:bg-[var(--input-bg)] hover:text-[var(--text-primary)]`} aria-label={`Edit journey for ${r.asset_no || 'asset'}`} title="Edit"><Pencil size={15} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(r) }} className={`${ICON_BTN} hover:bg-red-900/30 hover:text-red-400`} aria-label={`Delete journey for ${r.asset_no || 'asset'}`} title="Delete"><Trash2 size={15} /></button>
          </div>
        )
      } },
  ], [openEdit])

  const perfColumns = useMemo(() => [
    { id: 'name', header: perfView === 'asset' ? 'Asset' : 'Driver', accessorFn: (r) => r.name, size: 170,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{row.original.name}</span> },
    { id: 'trips', header: 'Trips', accessorFn: (r) => r.trips, meta: { align: 'right' }, size: 80 },
    { id: 'distance', header: 'Distance (km)', accessorFn: (r) => r.distance, meta: { align: 'right' }, size: 120 },
    { id: 'completionRate', header: 'Completion', accessorFn: (r) => r.completionRate, meta: { align: 'right' }, size: 110, cell: ({ row }) => `${row.original.completionRate}%` },
    { id: 'onTimeRate', header: 'On time', accessorFn: (r) => r.onTimeRate ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 100,
      cell: ({ row }) => (row.original.onTimeRate == null ? 'N/A' : `${row.original.onTimeRate}%`) },
    { id: 'avgDurationHours', header: 'Avg duration (h)', accessorFn: (r) => r.avgDurationHours ?? undefined, sortUndefined: 'last', meta: { align: 'right' }, size: 130,
      cell: ({ row }) => (row.original.avgDurationHours == null ? 'N/A' : row.original.avgDurationHours) },
  ], [perfView])

  const k = analytics.kpis
  const unknown = rows === null
  const n = (v) => (unknown ? 'N/A' : v)
  const nv = (v, suffix) => (unknown || v == null ? 'N/A' : `${v}${suffix}`)
  const dq = analytics.dataQuality

  const TABS = [
    { key: 'register', label: 'Register', icon: List, count: filtered.length },
    { key: 'analytics', label: 'Analytics', icon: BarChart3 },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journey Log"
        subtitle="Record and track vehicle journeys: asset, driver, route, timing, distance and purpose."
        icon={Navigation}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => runExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]" disabled={!filtered.length || exporting}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => runExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]" disabled={!filtered.length || exporting}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} disabled={missing} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[40px] disabled:opacity-50">
              <Plus size={14} aria-hidden="true" /> New journey
            </button>
          </div>
        }
      />

      {missing && (
        <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Journey Log is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V139_JOURNEYS.sql</span>, then reload.</p>
          </div>
        </Card>
      )}

      {loadError && (
        <Card tone="crit" className="items-start gap-3" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-300 font-medium">Could not load journeys.</p><p className="text-[var(--text-muted)] text-sm mt-1 break-words">{loadError}</p></div>
          <button type="button" onClick={load} className="btn-secondary text-sm shrink-0 min-h-[40px]">Retry</button>
        </Card>
      )}
      {actionError && (
        <Card tone="crit" className="items-start gap-3" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-red-300 flex-1 break-words">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Total journeys" value={n(k.totalTrips)} icon={Navigation} sub={unknown ? undefined : `${activity.today} started today, ${activity.last7Days} in 7 days`} />
        <StatTile label="Completed" value={n(k.completedTrips)} icon={CheckCircle2} tone="accent" sub={k.totalTrips > 0 ? `${Math.round((k.completedTrips / k.totalTrips) * 100)}% of journeys` : undefined} />
        <StatTile label="Planned or in progress" value={n(k.activeTrips)} icon={PlayCircle} tone="warn" sub={unknown ? undefined : `${k.inProgress} in progress`} />
        <StatTile label="Total distance" value={nv(distance.total, ' km')} icon={Milestone} tone="info" sub={unknown ? undefined : `${distance.recorded} of ${filtered.length} journeys carry a distance`} />
        <StatTile label="On time" value={nv(k.onTimePct, '%')} icon={Clock} tone="accent" sub={k.onTimeEvaluated > 0 ? `${k.onTimeEvaluated} measurable (+/- ${ON_TIME_TOLERANCE_MIN} min)` : 'No scheduled arrivals yet'} />
        <StatTile label="Avg trip duration" value={nv(k.avgDurationHours, ' h')} icon={Timer} />
        <StatTile label="Avg speed" value={nv(k.avgSpeedKmh, ' km/h')} icon={Gauge} />
        <StatTile label="Data quality issues" value={n(dq.rowsFlagged)} icon={ShieldAlert} tone={dq.rowsFlagged > 0 ? 'warn' : 'neutral'} sub={unknown ? undefined : `of ${dq.total} journeys`} />
      </div>

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[minmax(220px,1fr)_auto_auto_auto_auto_auto_auto] items-end gap-2">
          <div className="relative sm:col-span-2 lg:col-span-4 xl:col-span-1">
            <label htmlFor="journey-search" className="sr-only">Search journeys</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="journey-search" className="input pl-9 w-full min-h-[40px]" placeholder="Search asset, driver, route, purpose" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[40px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {JOURNEY_STATUSES.map((s) => <option key={s} value={s}>{JOURNEY_STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input min-h-[40px]" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Filter by asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input min-h-[40px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Filter by site">
            <option value="">All sites</option>
            {siteOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <div>
            <label htmlFor="journey-from" className="block text-[11px] text-[var(--text-muted)]">Start from</label>
            <input id="journey-from" type="date" className="input min-h-[40px] w-full" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="journey-to" className="block text-[11px] text-[var(--text-muted)]">Start to</label>
            <input id="journey-to" type="date" className="input min-h-[40px] w-full" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 justify-between sm:justify-end">
            {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[40px]"><X size={14} aria-hidden="true" /> Clear</button>}
            <span className="text-xs text-[var(--text-muted)] whitespace-nowrap" aria-live="polite">{unknown ? 'N/A' : `${filtered.length} of ${all.length}`}</span>
          </div>
        </div>
      </Card>

      <div role="tablist" aria-label="Journey views" className="flex flex-wrap items-center gap-1 border-b border-[var(--input-border)]">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button key={t.key} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-t ${active ? 'border-brand-bright text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Icon size={15} aria-hidden="true" /> {t.label}
              {t.count != null && !unknown && <span className="text-[11px] px-1.5 rounded-full bg-[var(--input-bg)] text-[var(--text-secondary)]">{t.count}</span>}
            </button>
          )
        })}
      </div>

      {tab === 'register' ? (
        <EnterpriseTable
          columns={columns}
          data={tableRows}
          getRowId={(r) => String(r.id)}
          loading={unknown && refreshing}
          error={loadError || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          viewKey="journey-log-register"
          initialPageSize={25}
          onRowClick={(r) => openEdit(r)}
          emptyIcon={<Navigation size={24} className="text-[var(--text-muted)]" aria-hidden="true" />}
          emptyMessage={missing ? 'Journey Log is not enabled yet.' : all.length === 0 ? 'No journeys recorded yet. Use New journey to log the first one.' : 'No journeys match these filters.'}
        />
      ) : unknown ? (
        <Card className="text-center text-sm text-[var(--text-muted)]"><div style={{ paddingBlock: 'var(--space-8)' }}>{refreshing ? 'Loading journeys...' : 'Journeys could not be loaded. Use Retry above.'}</div></Card>
      ) : filtered.length === 0 ? (
        <Card className="text-center text-sm text-[var(--text-muted)]"><div style={{ paddingBlock: 'var(--space-8)' }}>{all.length === 0 ? 'No journeys recorded yet, so there is nothing to analyse.' : 'No journeys match these filters.'}</div></Card>
      ) : (
        <div className="space-y-4">
          {dq.rowsFlagged > 0 && (
            <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
              <ShieldAlert size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="text-sm">
                <p className="text-amber-300 font-medium">{dq.rowsFlagged} of {dq.total} journeys have data-quality issues.</p>
                <p className="text-[var(--text-muted)] mt-1">
                  {[
                    dq.byCode.end_before_start && `${dq.byCode.end_before_start} with an end before start`,
                    dq.byCode.nonpositive_distance && `${dq.byCode.nonpositive_distance} completed with zero or negative distance`,
                    dq.byCode.missing_times && `${dq.byCode.missing_times} completed missing a start or end time`,
                  ].filter(Boolean).join(' | ') || 'Review flagged rows.'}
                  {' '}Flagged rows carry a shield marker in the register.
                </p>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Distance trend (last 12 months)" icon={TrendingUp} />
              <div className="h-64"><Line data={monthlyChart} options={CHART_OPTS} /></div>
            </Card>
            <Card>
              <CardHeader title="Trips by status" icon={Navigation} />
              {statusChart.total > 0
                ? <div className="h-64" role="img" aria-label={`Trips by status: ${statusChart.summary}`}><Doughnut data={statusChart.data} options={DOUGHNUT_OPTS} /></div>
                : <div className="h-64 flex items-center justify-center text-[var(--text-muted)] text-sm">No trips to chart.</div>}
            </Card>
            <Card>
              <CardHeader title="On-time performance" icon={Clock}
                description={analytics.onTime.evaluated > 0
                  ? `${analytics.onTime.evaluated} of ${filtered.length} trips have a scheduled arrival to measure against (tolerance +/- ${ON_TIME_TOLERANCE_MIN} min).`
                  : 'No scheduled arrival times captured yet, so on-time cannot be measured.'} />
              {analytics.onTime.evaluated > 0
                ? <div className="h-56"><Bar data={onTimeChart} options={CHART_OPTS} /></div>
                : <div className="h-56 flex flex-col items-center justify-center text-center gap-2 text-[var(--text-muted)] text-sm"><Clock size={24} className="opacity-50" aria-hidden="true" /><span>On-time breakdown is unavailable.</span></div>}
            </Card>
            <Card>
              <CardHeader title={`Top ${perfView === 'asset' ? 'assets' : 'drivers'} by distance`} icon={Milestone}
                actions={
                  <div role="group" aria-label="Rank by" className="flex rounded-lg border border-[var(--input-border)] overflow-hidden text-xs">
                    {[['driver', 'Drivers', Users], ['asset', 'Assets', Navigation]].map(([val, lbl, Icon]) => (
                      <button key={val} type="button" onClick={() => setPerfView(val)} aria-pressed={perfView === val}
                        className={`px-3 min-h-[36px] inline-flex items-center gap-1 ${perfView === val ? 'bg-[var(--input-bg)] text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'}`}>
                        <Icon size={12} aria-hidden="true" /> {lbl}
                      </button>
                    ))}
                  </div>
                } />
              {topDistanceChart.empty
                ? <div className="h-56 flex items-center justify-center text-[var(--text-muted)] text-sm">No {perfView} distance recorded.</div>
                : <div className="h-56"><Bar data={topDistanceChart.data} options={{ ...CHART_OPTS, indexAxis: 'y', plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} /></div>}
            </Card>
          </div>

          <Card>
            <CardHeader title={`${perfView === 'asset' ? 'Asset' : 'Driver'} performance`} icon={Users}
              description={`${perfRows.length} ${perfView === 'asset' ? 'assets' : 'drivers'}. Journeys without a ${perfView === 'asset' ? 'asset' : 'driver'} name are not ranked.`}
              actions={
                <div className="flex gap-2">
                  <button type="button" onClick={() => runExport('excel', 'perf')} disabled={!perfRows.length || exporting} className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[36px]"><FileSpreadsheet size={13} aria-hidden="true" /> Excel</button>
                  <button type="button" onClick={() => runExport('pdf', 'perf')} disabled={!perfRows.length || exporting} className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[36px]"><FileText size={13} aria-hidden="true" /> PDF</button>
                </div>
              } />
            <EnterpriseTable
              columns={perfColumns}
              data={perfRows}
              getRowId={(r) => String(r.name)}
              enableColumnFilters={false}
              enableExport={false}
              searchPlaceholder={`Search ${perfView === 'asset' ? 'assets' : 'drivers'}`}
              initialPageSize={25}
              onRowClick={(r) => { if (perfView === 'asset') { setAssetFilter(r.name); setTab('register') } else { setSearch(r.name); setTab('register') } }}
              emptyMessage={`No ${perfView === 'asset' ? 'asset' : 'driver'} recorded on these journeys.`}
            />
          </Card>
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal} size="lg" title={editing ? 'Edit journey' : 'New journey'}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field id="j-asset" label="Asset (vehicle) no" required>
              <input id="j-asset" className="input w-full" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} placeholder="e.g. DXB-A-12345" list="j-asset-options" required aria-required="true" />
              <datalist id="j-asset-options">{assetOptions.map((a) => <option key={a} value={a} />)}</datalist>
            </Field>
            <Field id="j-driver" label="Driver">
              <input id="j-driver" className="input w-full" value={form.driver_name} maxLength={160} onChange={(e) => set('driver_name', e.target.value)} placeholder="Driver name" />
            </Field>
            <Field id="j-origin" label="Origin">
              <input id="j-origin" className="input w-full" value={form.origin} maxLength={240} onChange={(e) => set('origin', e.target.value)} placeholder="Dubai Industrial Area" />
            </Field>
            <Field id="j-dest" label="Destination">
              <input id="j-dest" className="input w-full" value={form.destination} maxLength={240} onChange={(e) => set('destination', e.target.value)} placeholder="Mussafah, Abu Dhabi" />
            </Field>
            <Field id="j-start" label="Start time">
              <input id="j-start" type="datetime-local" className="input w-full" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
            </Field>
            <Field id="j-end" label="End time">
              <input id="j-end" type="datetime-local" className="input w-full" value={form.end_time} min={form.start_time || undefined} onChange={(e) => set('end_time', e.target.value)} />
            </Field>
            <Field id="j-distance" label="Distance (km)">
              <input id="j-distance" type="number" min="0" step="0.1" inputMode="decimal" className="input w-full" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} placeholder="0" />
            </Field>
            <Field id="j-purpose" label="Purpose">
              <input id="j-purpose" className="input w-full" value={form.purpose} maxLength={240} onChange={(e) => set('purpose', e.target.value)} placeholder="Delivery / Collection / Service" />
            </Field>
            <Field id="j-site" label="Site">
              <input id="j-site" className="input w-full" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} placeholder="Depot / branch" list="j-site-options" />
              <datalist id="j-site-options">{siteOptions.map((a) => <option key={a} value={a} />)}</datalist>
            </Field>
            <Field id="j-status" label="Status">
              <select id="j-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {JOURNEY_STATUSES.map((s) => <option key={s} value={s}>{JOURNEY_STATUS_META[s]?.label || s}</option>)}
              </select>
            </Field>
          </div>
          <Field id="j-notes" label="Notes">
            <textarea id="j-notes" className="input w-full min-h-[80px] resize-y" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} placeholder="Waypoints, load, routing constraints" />
          </Field>
          {formError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm flex-1 min-h-[40px]">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm flex-1 inline-flex items-center justify-center gap-2 disabled:opacity-60 min-h-[40px]">
              {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
              {saving ? 'Saving...' : (editing ? 'Save changes' : 'Create journey')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={closeDelete}
        size="sm"
        title="Delete journey?"
        footer={
          <>
            <button type="button" onClick={closeDelete} className="btn-secondary text-sm min-h-[40px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} disabled={deleting} className="text-sm inline-flex items-center justify-center gap-2 rounded-lg px-4 min-h-[40px] bg-red-600 hover:bg-red-500 text-white font-medium disabled:opacity-60">
              {deleting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-muted)]">
          This permanently removes the journey for <span className="font-mono text-[var(--text-secondary)]">{confirmDelete?.asset_no || 'this asset'}</span>
          {confirmDelete?.origin || confirmDelete?.destination ? ` (${confirmDelete.origin || 'N/A'} to ${confirmDelete.destination || 'N/A'})` : ''}. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
