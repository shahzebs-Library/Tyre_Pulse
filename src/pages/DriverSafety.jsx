/**
 * DriverSafety (route /driver-safety) — Driver Safety Events. Captures
 * telematics driver-behaviour events (harsh braking / acceleration / cornering,
 * speeding, overspeed, idling, fatigue) per asset and driver, then scores each
 * driver on risk. Driver conduct drives tyre wear, fuel burn and accident
 * exposure, so every event is org-isolated and country-scoped.
 *
 * Runs on the new `driver_safety_events` table (V170). Real data, KPI tiles,
 * per-driver risk scorecard, create/edit modal, filters, search, delete confirm,
 * Excel/PDF export, and loading/empty/error states throughout. The KPI summary,
 * scorecard and event-type roll-ups live in the pure `src/lib/driverSafety.js`
 * helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ShieldAlert, ShieldCheck, Users, Gauge, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDriverSafetyEvents, createDriverSafetyEvent, updateDriverSafetyEvent,
  deleteDriverSafetyEvent,
} from '../lib/api/driverSafety'
import { summariseSafety, driverScorecard, byEventType } from '../lib/driverSafety'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  asset_no: '', driver_name: '', event_type: '', severity: '', event_at: '',
  location: '', speed_kmh: '', speed_limit_kmh: '', g_force: '', penalty_points: '',
  notes: '',
}

const EVENT_TYPES = [
  { value: 'harsh_brake', label: 'Harsh braking' },
  { value: 'harsh_accel', label: 'Harsh acceleration' },
  { value: 'harsh_corner', label: 'Harsh cornering' },
  { value: 'speeding', label: 'Speeding' },
  { value: 'overspeed', label: 'Overspeed' },
  { value: 'idling', label: 'Excessive idling' },
  { value: 'fatigue', label: 'Fatigue' },
  { value: 'other', label: 'Other' },
]
const EVENT_TYPE_LABEL = Object.fromEntries(EVENT_TYPES.map((t) => [t.value, t.label]))
const SEVERITIES = ['low', 'medium', 'high']

const SEVERITY_TONE = {
  high: 'text-red-400 bg-red-900/20 border border-red-800/50',
  medium: 'text-amber-400 bg-amber-900/20 border border-amber-800/50',
  low: 'text-green-400 bg-green-900/20 border border-green-800/50',
}

const num = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString())

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function scoreTone(score) {
  if (score >= 85) return 'text-green-400'
  if (score >= 60) return 'text-amber-400'
  return 'text-red-400'
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function DriverSafety() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [countryFilter, setCountryFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
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
      const data = await listDriverSafetyEvents({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load driver safety events.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseSafety(rows || []), [rows])
  const scorecard = useMemo(() => driverScorecard(rows || []), [rows])
  const eventTypes = useMemo(() => byEventType(rows || []), [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (countryFilter && r.country !== countryFilter) return false
      if (typeFilter && r.event_type !== typeFilter) return false
      if (severityFilter && r.severity !== severityFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.driver_name || ''} ${r.location || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, countryFilter, typeFilter, severityFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Events logged', value: summary.totalEvents, icon: ShieldAlert, tone: 'text-[var(--text-primary)]' },
    { label: 'High-severity', value: summary.highSeverityCount, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Drivers tracked', value: summary.distinctDrivers, icon: Users, tone: 'text-sky-400' },
    { label: 'Penalty points', value: Math.round(summary.totalPenaltyPoints).toLocaleString(), icon: Gauge, tone: 'text-amber-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'driver_name', 'event_type', 'severity', 'event_at', 'location', 'speed_kmh', 'speed_limit_kmh', 'g_force', 'penalty_points', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Driver', 'Event type', 'Severity', 'Event at', 'Location', 'Speed (km/h)', 'Speed limit', 'G-force', 'Penalty points', 'Notes']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', driver_name: r.driver_name || '',
    event_type: EVENT_TYPE_LABEL[r.event_type] || r.event_type || '',
    severity: r.severity || '', event_at: r.event_at || '', location: r.location || '',
    speed_kmh: r.speed_kmh ?? '', speed_limit_kmh: r.speed_limit_kmh ?? '',
    g_force: r.g_force ?? '', penalty_points: r.penalty_points ?? '', notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      event_type: r.event_type || '', severity: r.severity || '',
      event_at: r.event_at ? new Date(r.event_at).toISOString().slice(0, 16) : '',
      location: r.location || '', speed_kmh: r.speed_kmh ?? '',
      speed_limit_kmh: r.speed_limit_kmh ?? '', g_force: r.g_force ?? '',
      penalty_points: r.penalty_points ?? '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateDriverSafetyEvent(editing.id, payload)
      else await createDriverSafetyEvent(payload)
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
      await deleteDriverSafetyEvent(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the event.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setCountryFilter(''); setTypeFilter(''); setSeverityFilter(''); setSearch('') }
  const hasFilters = countryFilter || typeFilter || severityFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Safety Events"
        subtitle="Track harsh braking, acceleration, cornering, speeding and fatigue events per driver — and score each driver on risk. Driver conduct drives tyre wear, fuel burn and accident exposure."
        icon={ShieldAlert}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'driver_safety_events')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Driver Safety Events', 'driver_safety_events', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
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
            <p className="text-amber-300 font-medium">Driver safety tracking isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V170_DRIVER_SAFETY_EVENTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load driver safety events.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Driver risk scorecard */}
      <div className="card overflow-hidden !p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--input-border)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <ShieldCheck size={15} /> Driver risk scorecard
          </h3>
          <span className="text-xs text-[var(--text-muted)]">Worst first · lower score = higher risk</span>
        </div>
        {rows === null ? (
          <div className="p-4"><div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" /></div>
        ) : scorecard.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[var(--text-muted)] text-center">No driver events logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  {['Driver', 'Events', 'Penalty points', 'Safety score'].map((h, i) => <th key={i} className="px-4 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {scorecard.slice(0, 15).map((d) => (
                  <tr key={d.driver_name} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{d.driver_name}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{d.events}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{Math.round(d.penaltyPoints).toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${scoreTone(d.safetyScore)}`}>{Math.round(d.safetyScore)}</span>
                        <div className="h-1.5 w-24 rounded-full bg-[var(--input-bg)] overflow-hidden">
                          <div className={`h-full ${d.safetyScore >= 85 ? 'bg-green-500' : d.safetyScore >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.max(4, d.safetyScore)}%` }} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Event-type distribution */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Filter size={15} /> Events by type
        </h3>
        {rows === null ? (
          <div className="h-12 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : eventTypes.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No events logged yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {eventTypes.map((t) => (
              <div key={t.type} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                <p className="text-xs text-[var(--text-muted)]">{EVENT_TYPE_LABEL[t.type] || t.type}</p>
                <p className="text-lg font-semibold text-[var(--text-primary)]">{t.count.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, driver, location, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {countryOptions.length > 0 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Event type">
            <option value="">All event types</option>
            {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="input" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
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
                {['Driver', 'Asset', 'Event', 'Severity', 'When', 'Speed', 'Penalty', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No events logged yet — log your first event.' : 'No events match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.driver_name || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{EVENT_TYPE_LABEL[r.event_type] || r.event_type || '—'}</td>
                    <td className="px-4 py-2.5">
                      {r.severity ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_TONE[r.severity] || 'text-[var(--text-secondary)]'}`}>
                          {r.severity[0].toUpperCase() + r.severity.slice(1)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.event_at)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                      {num(r.speed_kmh)}{r.speed_limit_kmh != null && r.speed_limit_kmh !== '' ? ` / ${num(r.speed_limit_kmh)}` : ''}
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">{num(r.penalty_points)}</td>
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
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit safety event' : 'Log driver safety event'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Driver</label>
                  <input className="input w-full" placeholder="e.g. Ahmed Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Event type</label>
                  <select className="input w-full" value={form.event_type} onChange={(e) => set('event_type', e.target.value)}>
                    <option value="">Select…</option>
                    {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Severity</label>
                  <select className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                    <option value="">Select…</option>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
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
                  <label className="label">Location (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh–Dammam Hwy km 210" value={form.location} maxLength={300} onChange={(e) => set('location', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="label">Speed (km/h)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="98" value={form.speed_kmh} onChange={(e) => set('speed_kmh', e.target.value)} />
                </div>
                <div>
                  <label className="label">Speed limit</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="80" value={form.speed_limit_kmh} onChange={(e) => set('speed_limit_kmh', e.target.value)} />
                </div>
                <div>
                  <label className="label">G-force</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="0.45" value={form.g_force} onChange={(e) => set('g_force', e.target.value)} />
                </div>
                <div>
                  <label className="label">Penalty points</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="5" value={form.penalty_points} onChange={(e) => set('penalty_points', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. sudden lane change, wet road" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
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
                  {confirmDelete.driver_name || 'Event'} · {EVENT_TYPE_LABEL[confirmDelete.event_type] || confirmDelete.event_type || '—'} · {fmtDateTime(confirmDelete.event_at)}. This can’t be undone.
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
