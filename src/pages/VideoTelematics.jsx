/**
 * VideoTelematics (route /video-telematics) — Video Telematics / Dashcam Events.
 * Captures safety-critical driving events detected by AI dashcams and video
 * telematics devices (collision, harsh braking, tailgating, distraction,
 * drowsiness, phone use, seatbelt violations) per asset and driver. Event
 * history is the evidentiary backbone for driver coaching, risk scoring,
 * accident investigation, and insurance workflows, so every event is
 * org-isolated and country-scoped.
 *
 * Runs on the new `dashcam_events` table (V168). Real data, KPI tiles,
 * create/edit modal with a review toggle, filters, search, delete confirm,
 * Excel/PDF export, and loading/empty/error states throughout. The fleet KPI
 * summary and per-type / per-severity roll-ups live in the pure
 * `src/lib/dashcamEvents.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Video, ShieldAlert, AlertTriangle, CheckCircle2, Eye, ExternalLink, Search, X,
  Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDashcamEvents, createDashcamEvent, updateDashcamEvent, deleteDashcamEvent,
} from '../lib/api/dashcamEvents'
import { summariseDashcam, byEventType, bySeverity } from '../lib/dashcamEvents'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EVENT_TYPES = [
  { value: 'collision', label: 'Collision' },
  { value: 'harsh_brake', label: 'Harsh braking' },
  { value: 'tailgating', label: 'Tailgating' },
  { value: 'distraction', label: 'Distraction' },
  { value: 'drowsiness', label: 'Drowsiness' },
  { value: 'phone_use', label: 'Phone use' },
  { value: 'no_seatbelt', label: 'No seatbelt' },
  { value: 'other', label: 'Other' },
]
const EVENT_TYPE_LABEL = Object.fromEntries(EVENT_TYPES.map((t) => [t.value, t.label]))

const SEVERITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const SEVERITY_BADGE = {
  low: 'bg-emerald-900/30 text-emerald-300 border border-emerald-800/50',
  medium: 'bg-amber-900/30 text-amber-300 border border-amber-800/50',
  high: 'bg-orange-900/30 text-orange-300 border border-orange-800/50',
  critical: 'bg-red-900/30 text-red-300 border border-red-800/50',
}

const EMPTY_FORM = {
  asset_no: '', driver_name: '', event_type: 'harsh_brake', severity: 'medium',
  event_at: '', location: '', speed_kmh: '', video_url: '', reviewed: false,
  review_notes: '', notes: '',
}

const fmtSpeed = (v) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString()} km/h`

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** Convert a stored ISO timestamp to the value a datetime-local input expects. */
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
  const label = SEVERITIES.find((s) => s.value === sev)?.label || '—'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>{label}</span>
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function VideoTelematics() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [typeFilter, setTypeFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [reviewFilter, setReviewFilter] = useState('')
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
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load dashcam events.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseDashcam(rows || []), [rows])
  const typeBreakdown = useMemo(() => byEventType(rows || []), [rows])
  const severityBreakdown = useMemo(() => bySeverity(rows || []), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (typeFilter && r.event_type !== typeFilter) return false
      if (severityFilter && r.severity !== severityFilter) return false
      if (reviewFilter === 'reviewed' && !r.reviewed) return false
      if (reviewFilter === 'unreviewed' && r.reviewed) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.driver_name || ''} ${r.location || ''} ${r.notes || ''} ${r.review_notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, typeFilter, severityFilter, reviewFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Events captured', value: summary.totalEvents, icon: Video, tone: 'text-[var(--text-primary)]' },
    { label: 'Critical events', value: summary.criticalCount, icon: ShieldAlert, tone: 'text-red-400' },
    { label: 'Awaiting review', value: summary.unreviewedCount, icon: Eye, tone: 'text-amber-400' },
    { label: 'Reviewed', value: `${summary.reviewedPct}%`, icon: CheckCircle2, tone: 'text-green-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'driver_name', 'event_type', 'severity', 'event_at', 'location', 'speed_kmh', 'reviewed', 'video_url', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Driver', 'Event type', 'Severity', 'Event time', 'Location', 'Speed (km/h)', 'Reviewed', 'Video URL', 'Notes']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', driver_name: r.driver_name || '',
    event_type: EVENT_TYPE_LABEL[r.event_type] || r.event_type || '',
    severity: r.severity || '', event_at: r.event_at || '', location: r.location || '',
    speed_kmh: r.speed_kmh ?? '', reviewed: r.reviewed ? 'Yes' : 'No',
    video_url: r.video_url || '', notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      event_type: r.event_type || 'other', severity: r.severity || 'medium',
      event_at: toLocalInput(r.event_at), location: r.location || '',
      speed_kmh: r.speed_kmh ?? '', video_url: r.video_url || '',
      reviewed: !!r.reviewed, review_notes: r.review_notes || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

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
      setFormError(err?.message || 'Could not save the event.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteDashcamEvent(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the event.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setTypeFilter(''); setSeverityFilter(''); setReviewFilter(''); setSearch('') }
  const hasFilters = typeFilter || severityFilter || reviewFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Video Telematics"
        subtitle="Capture and triage AI-dashcam safety events — collisions, harsh braking, distraction, and more — per asset and driver, with severity, location, and video evidence for coaching and claims."
        icon={Video}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'dashcam_events')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Video Telematics — Dashcam Events', 'dashcam_events', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log event
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Video telematics isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V168_DASHCAM_EVENTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load dashcam events.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Event-type / severity breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Video size={15} /> Events by type
          </h3>
          {rows === null ? (
            <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : typeBreakdown.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No events logged yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {typeBreakdown.map((t) => (
                <div key={t.type} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                  <p className="text-xs text-[var(--text-muted)]">{EVENT_TYPE_LABEL[t.type] || t.type}</p>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{t.count.toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ShieldAlert size={15} /> Events by severity
          </h3>
          {rows === null ? (
            <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : summary.totalEvents === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No events logged yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {SEVERITIES.map((s) => (
                <div key={s.value} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                  <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><SeverityBadge value={s.value} /></p>
                  <p className="text-sm font-semibold text-[var(--text-primary)] mt-1">{severityBreakdown[s.value].toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, driver, location, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Event type">
            <option value="">All event types</option>
            {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="input" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="input" value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)} aria-label="Review status">
            <option value="">All statuses</option>
            <option value="unreviewed">Awaiting review</option>
            <option value="reviewed">Reviewed</option>
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalEvents}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Driver', 'Event', 'Severity', 'Event time', 'Speed', 'Review', 'Video', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No events logged yet — log your first event.' : 'No events match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.driver_name || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{EVENT_TYPE_LABEL[r.event_type] || r.event_type || '—'}</td>
                    <td className="px-4 py-2.5"><SeverityBadge value={r.severity} /></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.event_at)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtSpeed(r.speed_kmh)}</td>
                    <td className="px-4 py-2.5">
                      {r.reviewed
                        ? <span className="inline-flex items-center gap-1 text-green-400 text-xs"><CheckCircle2 size={13} /> Reviewed</span>
                        : <span className="inline-flex items-center gap-1 text-amber-400 text-xs"><Eye size={13} /> Pending</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.video_url
                        ? <a href={r.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs" aria-label="Open video"><ExternalLink size={13} /> Clip</a>
                        : <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit event' : 'Log dashcam event'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Driver (optional)</label>
                  <input className="input w-full" placeholder="e.g. A. Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Event type</label>
                  <select className="input w-full" value={form.event_type} onChange={(e) => set('event_type', e.target.value)}>
                    {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Severity</label>
                  <select className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                    {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Event time</label>
                  <input className="input w-full" type="datetime-local" value={form.event_at} onChange={(e) => set('event_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
                <div>
                  <label className="label">Speed (km/h, optional)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="e.g. 82" value={form.speed_kmh} onChange={(e) => set('speed_kmh', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Location (optional)</label>
                <input className="input w-full" placeholder="e.g. Ring Road, Riyadh" value={form.location} maxLength={300} onChange={(e) => set('location', e.target.value)} />
              </div>
              <div>
                <label className="label">Video URL (optional)</label>
                <input className="input w-full" type="url" placeholder="https://…/clip.mp4" value={form.video_url} maxLength={2000} onChange={(e) => set('video_url', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. hard braking near junction" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {/* Review toggle */}
              <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3 space-y-3">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input type="checkbox" className="h-4 w-4 accent-green-500" checked={!!form.reviewed} onChange={(e) => set('reviewed', e.target.checked)} />
                  <span className="text-sm text-[var(--text-primary)] font-medium">Mark as reviewed</span>
                </label>
                {form.reviewed && (
                  <textarea className="input w-full min-h-[60px] resize-y" placeholder="Review notes / coaching outcome (optional)" value={form.review_notes} maxLength={8000} onChange={(e) => set('review_notes', e.target.value)} />
                )}
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Log event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this event?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Event'} · {EVENT_TYPE_LABEL[confirmDelete.event_type] || confirmDelete.event_type || '—'} · {fmtDateTime(confirmDelete.event_at)}. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
