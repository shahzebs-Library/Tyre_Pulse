/**
 * VideoTelematics (route /video-telematics) - Video Telematics / Dashcam Events.
 * Captures safety-critical driving events detected by AI dashcams (collision,
 * harsh braking, tailgating, distraction, drowsiness, phone use, seatbelt
 * violations) per asset and driver. Event history is the evidentiary backbone
 * for driver coaching, risk scoring, accident investigation, and insurance
 * workflows, so every event is org-isolated and country-scoped.
 *
 * Runs on the `dashcam_events` table (V168). Base counts live in
 * `src/lib/dashcamEvents.js`; filtering, the honest-null KPI set, the driver
 * risk ranking, the monthly trend and export rows live in
 * `src/lib/videoTelematicsAnalytics.js`. This page only renders them.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  Video, ShieldAlert, AlertTriangle, CheckCircle2, Eye, ExternalLink, X, FileSpreadsheet, FileText,
  Plus, Pencil, Trash2, RotateCw, Gauge, Hourglass, Users, BarChart3,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDashcamEvents, createDashcamEvent, updateDashcamEvent, deleteDashcamEvent,
} from '../lib/api/dashcamEvents'
import {
  EVENT_TYPES, EVENT_TYPE_LABEL, SEVERITIES, SEVERITY_LABEL, NO_DRIVER,
  filterDashcamEvents, dashcamKpis, driverRiskRanking, monthlyEventTrend, byEventType,
  DASHCAM_EXPORT_COLUMNS, dashcamExportRows,
} from '../lib/videoTelematicsAnalytics'
import { safeHref } from '../lib/safeUrl'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { colorAt } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)

// Severity is semantic, so its colours stay fixed (and every badge carries text).
const SEVERITY_BADGE = {
  low: 'bg-emerald-900/30 text-emerald-300 border border-emerald-800/50',
  medium: 'bg-amber-900/30 text-amber-300 border border-amber-800/50',
  high: 'bg-orange-900/30 text-orange-300 border border-orange-800/50',
  critical: 'bg-red-900/30 text-red-300 border border-red-800/50',
}
const SEVERITY_COLOR = { low: '#10b981', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' }

const EMPTY_FORM = {
  asset_no: '', driver_name: '', event_type: 'harsh_brake', severity: 'medium',
  event_at: '', location: '', speed_kmh: '', video_url: '', reviewed: false,
  review_notes: '', notes: '',
}

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

const fmtSpeed = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} km/h`)
function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

function SeverityBadge({ value }) {
  const sev = String(value || '').toLowerCase()
  const cls = SEVERITY_BADGE[sev] || 'bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{SEVERITY_LABEL[sev] || 'N/A'}</span>
}

function KpiTile({ label, value, icon: Icon, tone = 'text-[var(--text-primary)]', sub }) {
  return (
    <div className="card !p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

const barOpts = (stacked, legend = true, horizontal = false) => ({
  responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x',
  plugins: { legend: { display: legend, labels: { color: 'var(--text-muted)', boxWidth: 12 } } },
  scales: {
    x: { stacked, beginAtZero: true, ticks: { color: 'var(--text-muted)', font: { size: 10 }, precision: 0 }, grid: { display: horizontal, color: 'var(--panel-2)' } },
    y: { stacked, beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { display: !horizontal, color: 'var(--panel-2)' } },
  },
})

export default function VideoTelematics() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [asOf, setAsOf] = useState(() => new Date())

  const [typeFilter, setTypeFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [reviewFilter, setReviewFilter] = useState('')
  const [driverFilter, setDriverFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listDashcamEvents({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setAsOf(new Date())
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load dashcam events.'))
      setRows(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const failed = !!error || notProvisioned
  const na = rows === null
  const all = useMemo(() => rows || [], [rows])
  const driverOptions = useMemo(() => [...new Set(all.map((r) => String(r.driver_name || '').trim() || NO_DRIVER))].sort(), [all])

  const filtered = useMemo(() => filterDashcamEvents(all, {
    type: typeFilter, severity: severityFilter, review: reviewFilter, driver: driverFilter,
    from: fromDate, to: toDate, search,
  }), [all, typeFilter, severityFilter, reviewFilter, driverFilter, fromDate, toDate, search])

  const kpi = useMemo(() => dashcamKpis(filtered, { now: asOf }), [filtered, asOf])
  const types = useMemo(() => byEventType(filtered), [filtered])
  const drivers = useMemo(() => driverRiskRanking(filtered, 8), [filtered])
  const trend = useMemo(() => monthlyEventTrend(filtered, { now: asOf }), [filtered, asOf])

  const hasFilters = !!(typeFilter || severityFilter || reviewFilter || driverFilter || fromDate || toDate || search)
  const clearFilters = () => {
    setTypeFilter(''); setSeverityFilter(''); setReviewFilter(''); setDriverFilter('')
    setFromDate(''); setToDate(''); setSearch('')
  }

  const v = (x) => (na ? 'N/A' : x)
  const kpis = [
    { label: 'Events captured', value: v(kpi.totalEvents.toLocaleString()), icon: Video, sub: na ? null : `${kpi.last7Days} in the last 7 days` },
    { label: 'Critical events', value: v(kpi.criticalCount), icon: ShieldAlert, tone: 'text-red-400', sub: na ? null : `${kpi.highCount} high` },
    { label: 'Awaiting review', value: v(kpi.unreviewedCount), icon: Eye, tone: 'text-amber-400' },
    { label: 'High risk unreviewed', value: v(kpi.highRiskUnreviewed), icon: AlertTriangle, tone: kpi.highRiskUnreviewed ? 'text-red-400' : 'text-green-400', sub: 'Critical or high, not yet reviewed' },
    { label: 'Review rate', value: v(kpi.reviewedPct == null ? 'N/A' : `${kpi.reviewedPct}%`), icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Oldest unreviewed', value: v(kpi.oldestUnreviewedDays == null ? 'N/A' : `${kpi.oldestUnreviewedDays} d`), icon: Hourglass, tone: kpi.oldestUnreviewedDays != null && kpi.oldestUnreviewedDays > 7 ? 'text-red-400' : 'text-[var(--text-primary)]' },
    { label: 'Average event speed', value: v(kpi.avgSpeedKmh == null ? 'N/A' : `${kpi.avgSpeedKmh} km/h`), icon: Gauge, tone: 'text-sky-400' },
    { label: 'Video evidence', value: v(kpi.videoCoverage == null ? 'N/A' : `${kpi.videoCoverage}%`), icon: Video, sub: na ? null : `${kpi.distinctAssets} assets involved` },
  ]

  // ── Export ──────────────────────────────────────────────────────────────────
  const exportRows = useMemo(() => dashcamExportRows(filtered, { fmtDate: fmtDateTime }), [filtered])
  const fileName = reportFileName('TyrePulse Dashcam Events', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExcel = () => exportToExcel(exportRows, DASHCAM_EXPORT_COLUMNS.map((c) => c[0]), DASHCAM_EXPORT_COLUMNS.map((c) => c[1]), fileName)
  const doPdf = () => exportToPdf(exportRows, DASHCAM_EXPORT_COLUMNS.map(([key, header]) => ({ key, header })), 'Video Telematics: Dashcam Events', fileName, 'landscape')

  // ── Charts ──────────────────────────────────────────────────────────────────
  const trendTotal = trend.reduce((s, m) => s + m.low + m.medium + m.high + m.critical, 0)
  const trendData = {
    labels: trend.map((m) => m.month),
    datasets: SEVERITIES.map((s) => ({ label: SEVERITY_LABEL[s], data: trend.map((m) => m[s]), backgroundColor: SEVERITY_COLOR[s], borderRadius: 2 })),
  }
  const typeData = {
    labels: types.map((t) => EVENT_TYPE_LABEL[t.type] || t.type),
    datasets: [{ label: 'Events', data: types.map((t) => t.count), backgroundColor: types.map((_, i) => colorAt(i)), borderRadius: 4 }],
  }

  // ── Modal ───────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      event_type: r.event_type || 'other', severity: r.severity || 'medium',
      event_at: toLocalInput(r.event_at), location: r.location || '',
      speed_kmh: r.speed_kmh ?? '', video_url: r.video_url || '',
      reviewed: !!r.reviewed, review_notes: r.review_notes || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, val) => setForm((f) => ({ ...f, [k]: val }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (form.speed_kmh !== '' && form.speed_kmh != null && Number(form.speed_kmh) < 0) {
      setFormError('Speed cannot be negative.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        event_at: form.event_at ? new Date(form.event_at).toISOString() : null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateDashcamEvent(editing.id, payload)
      else await createDashcamEvent(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the event.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteDashcamEvent(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the event.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // ── Table ───────────────────────────────────────────────────────────────────
  const columns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 120, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || '', size: 150, cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.driver_name || 'N/A'}</span> },
    { id: 'type', header: 'Event', accessorFn: (r) => EVENT_TYPE_LABEL[r.event_type] || r.event_type || '', size: 140 },
    { id: 'severity', header: 'Severity', accessorFn: (r) => ({ low: 1, medium: 2, high: 3, critical: 4 }[String(r.severity || '').toLowerCase()] || 0), size: 110, meta: { exportValue: (r) => SEVERITY_LABEL[String(r.severity || '').toLowerCase()] || '' }, cell: ({ row }) => <SeverityBadge value={row.original.severity} /> },
    { id: 'event_at', header: 'Event time', accessorFn: (r) => (r.event_at ? new Date(r.event_at).getTime() : -Infinity), size: 170, meta: { exportValue: (r) => fmtDateTime(r.event_at) }, cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDateTime(row.original.event_at)}</span> },
    { id: 'location', header: 'Location', accessorFn: (r) => r.location || '', size: 160, cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.location || 'N/A'}</span> },
    { id: 'speed', header: 'Speed', accessorFn: (r) => (r.speed_kmh == null || r.speed_kmh === '' ? -1 : Number(r.speed_kmh)), size: 100, meta: { align: 'right', exportValue: (r) => fmtSpeed(r.speed_kmh) }, cell: ({ row }) => <span className="tabular-nums">{fmtSpeed(row.original.speed_kmh)}</span> },
    {
      id: 'review', header: 'Review', accessorFn: (r) => (r.reviewed ? 'Reviewed' : 'Pending'), size: 110,
      cell: ({ row }) => (row.original.reviewed
        ? <span className="inline-flex items-center gap-1 text-green-400 text-xs"><CheckCircle2 size={13} aria-hidden="true" /> Reviewed</span>
        : <span className="inline-flex items-center gap-1 text-amber-400 text-xs"><Eye size={13} aria-hidden="true" /> Pending</span>),
    },
    {
      id: 'video', header: 'Video', enableSorting: false, size: 90, meta: { exportValue: (r) => r.video_url || '' },
      cell: ({ row }) => {
        const href = safeHref(row.original.video_url)
        if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-[44px] text-sky-400 hover:text-sky-300 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"><ExternalLink size={13} aria-hidden="true" /> Open clip</a>
        if (row.original.video_url) return <span className="text-[var(--text-muted)] text-xs">Link not playable</span>
        return <span className="text-[var(--text-muted)]">N/A</span>
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit event for ${row.original.asset_no || 'asset'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete event for ${row.original.asset_no || 'asset'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Video Telematics"
        subtitle="Capture and triage AI-dashcam safety events (collisions, harsh braking, distraction and more) per asset and driver, with severity, location and video evidence for coaching and claims."
        icon={Video}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={failed}>
              <Plus size={14} aria-hidden="true" /> Log event
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Video telematics is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Ask your administrator to enable dashcam events, then refresh.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-red-300 font-medium">Could not load dashcam events.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RotateCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => <KpiTile key={k.label} {...k} />)}
      </div>
      {hasFilters && !na && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">These figures cover the {filtered.length} events matching the current filters.</p>
      )}

      {/* Charts + driver risk */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><BarChart3 size={15} aria-hidden="true" /> Events per month by severity</h2>
          <div className="h-60">
            {na ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
              : trendTotal === 0 ? <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No dated events in the last 12 months.</p>
                : <Bar data={trendData} options={barOpts(true)} role="img" aria-label="Dashcam events per month by severity" />}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Video size={15} aria-hidden="true" /> Events by type</h2>
          <div className="h-60">
            {na ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
              : types.length === 0 ? <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No events logged.</p>
                : <Bar data={typeData} options={barOpts(false, false, true)} role="img" aria-label="Dashcam events by type" />}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><Users size={15} aria-hidden="true" /> Driver risk ranking</h2>
        <p className="text-xs text-[var(--text-muted)] mb-3">Score weights each event by severity: low 1, medium 2, high 3, critical 5. A coaching priority list, not a verdict.</p>
        {na ? <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
          : drivers.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No events to rank.</p> : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 divide-y md:divide-y-0 divide-[var(--input-border)]/60">
              {drivers.map((d, i) => (
                <li key={d.driver} className="flex items-center justify-between gap-3 py-2 text-sm border-b border-[var(--input-border)]/40">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-[var(--text-muted)] tabular-nums w-5">{i + 1}.</span>
                    <span className="text-[var(--text-primary)] truncate">{d.driver}</span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0 text-xs">
                    <span className="text-[var(--text-muted)]">{d.events} events</span>
                    {d.critical > 0 && <span className="text-red-400">{d.critical} critical</span>}
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">score {d.score}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block"><span className="label">Search</span>
            <input className="input w-full min-h-[44px]" placeholder="Asset, driver, location, notes" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label className="block"><span className="label">Event type</span>
            <select className="input w-full min-h-[44px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All event types</option>
              {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select></label>
          <label className="block"><span className="label">Severity</span>
            <select className="input w-full min-h-[44px]" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
              <option value="">All severities</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </select></label>
          <label className="block"><span className="label">Review status</span>
            <select className="input w-full min-h-[44px]" value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}>
              <option value="">All</option>
              <option value="unreviewed">Awaiting review</option>
              <option value="reviewed">Reviewed</option>
            </select></label>
          <label className="block"><span className="label">Driver</span>
            <select className="input w-full min-h-[44px]" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}>
              <option value="">All drivers</option>
              {driverOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select></label>
          <label className="block"><span className="label">Event from</span>
            <input type="date" className="input w-full min-h-[44px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label className="block"><span className="label">Event to</span>
            <input type="date" className="input w-full min-h-[44px]" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{na ? 'Not loaded' : `${filtered.length} of ${all.length} events`}</span>
        </div>
      </div>

      {failed ? (
        <div className="card text-center py-10 text-sm text-[var(--text-muted)]">Dashcam events are unavailable.</div>
      ) : (
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={na}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          exportFileName={fileName}
          viewKey="video-telematics"
          initialPageSize={25}
          emptyMessage={all.length === 0 ? 'No events logged yet. Log your first event.' : 'No events match these filters.'}
        />
      )}

      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit event' : 'Log dashcam event'} size="md">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Asset number *</span>
              <input className="input w-full" required placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} /></label>
            <label className="block"><span className="label">Driver (optional)</span>
              <input className="input w-full" placeholder="e.g. A. Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} /></label>
            <label className="block"><span className="label">Event type</span>
              <select className="input w-full" value={form.event_type} onChange={(e) => set('event_type', e.target.value)}>
                {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select></label>
            <label className="block"><span className="label">Severity</span>
              <select className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
              </select></label>
            <label className="block"><span className="label">Event time</span>
              <input className="input w-full" type="datetime-local" value={form.event_at} onChange={(e) => set('event_at', e.target.value)} />
              <span className="block text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</span></label>
            <label className="block"><span className="label">Speed (km/h, optional)</span>
              <input className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="e.g. 82" value={form.speed_kmh} onChange={(e) => set('speed_kmh', e.target.value)} /></label>
          </div>
          <label className="block"><span className="label">Location (optional)</span>
            <input className="input w-full" placeholder="e.g. Ring Road, Riyadh" value={form.location} maxLength={300} onChange={(e) => set('location', e.target.value)} /></label>
          <label className="block"><span className="label">Video URL (optional)</span>
            <input className="input w-full" type="url" placeholder="https://" value={form.video_url} maxLength={2000} onChange={(e) => set('video_url', e.target.value)} /></label>
          <label className="block"><span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. hard braking near junction" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} /></label>
          <fieldset className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3 space-y-3">
            <legend className="sr-only">Review</legend>
            <label className="flex items-center gap-2.5 cursor-pointer select-none min-h-[44px]">
              <input type="checkbox" className="h-4 w-4" checked={!!form.reviewed} onChange={(e) => set('reviewed', e.target.checked)} />
              <span className="text-sm text-[var(--text-primary)] font-medium">Mark as reviewed</span>
            </label>
            {form.reviewed && (
              <label className="block"><span className="label">Review notes or coaching outcome (optional)</span>
                <textarea className="input w-full min-h-[60px] resize-y" value={form.review_notes} maxLength={8000} onChange={(e) => set('review_notes', e.target.value)} /></label>
            )}
          </fieldset>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Log event'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this event?"
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-muted)]">
          {confirmDelete?.asset_no || 'Event'}, {EVENT_TYPE_LABEL[confirmDelete?.event_type] || confirmDelete?.event_type || 'N/A'}, {fmtDateTime(confirmDelete?.event_at)}. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
