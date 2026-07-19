/**
 * BreakdownCallouts (route /breakdown-callouts) — Roadside Assistance / Breakdown
 * Callouts. Captures every roadside breakdown / assistance event raised against
 * an asset: when it was reported, dispatched, and resolved, who attended, the
 * cost, and the outcome. Response and resolution timings are the backbone of
 * availability, downtime, and vendor-performance analytics, so every callout is
 * org-isolated and country-scoped.
 *
 * Runs on the new `breakdown_callouts` table (V176). Real data, KPI tiles,
 * create/edit modal, filters, search, delete confirm, Excel/PDF export, and
 * loading/empty/error states throughout. Response/resolution timing, the fleet
 * KPI summary, and the per-type breakdown live in the pure
 * `src/lib/breakdownCallouts.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  LifeBuoy, Siren, Clock, ShieldAlert, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Wrench,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listBreakdownCallouts, createBreakdownCallout, updateBreakdownCallout, deleteBreakdownCallout,
} from '../lib/api/breakdownCallouts'
import { summariseCallouts, byType, responseMinutes, resolutionMinutes } from '../lib/breakdownCallouts'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const BREAKDOWN_TYPES = ['tyre', 'engine', 'electrical', 'brakes', 'transmission', 'accident', 'fuel', 'other']
const SEVERITIES = ['low', 'medium', 'high', 'critical']
const STATUSES = ['reported', 'dispatched', 'on_site', 'resolved', 'cancelled']

const EMPTY_FORM = {
  asset_no: '', callout_no: '', driver_name: '', location: '',
  breakdown_type: '', severity: '', reported_at: '', dispatched_at: '', resolved_at: '',
  provider: '', cost: '', currency: '', status: 'reported', resolution: '', notes: '',
}

const SEVERITY_BADGE = {
  low: 'bg-sky-900/30 text-sky-300 border border-sky-800/50',
  medium: 'bg-amber-900/30 text-amber-300 border border-amber-800/50',
  high: 'bg-orange-900/30 text-orange-300 border border-orange-800/50',
  critical: 'bg-red-900/30 text-red-300 border border-red-800/50',
}
const STATUS_BADGE = {
  reported: 'bg-slate-700/40 text-slate-200 border border-slate-600/50',
  dispatched: 'bg-indigo-900/30 text-indigo-300 border border-indigo-800/50',
  on_site: 'bg-violet-900/30 text-violet-300 border border-violet-800/50',
  resolved: 'bg-green-900/30 text-green-300 border border-green-800/50',
  cancelled: 'bg-gray-800/50 text-gray-400 border border-gray-700/50',
}
const STATUS_LABEL = {
  reported: 'Reported', dispatched: 'Dispatched', on_site: 'On site',
  resolved: 'Resolved', cancelled: 'Cancelled',
}

const titleCase = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : '—')

const fmtMinutes = (m) => {
  if (m == null) return '—'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

const fmtCost = (v, cur) =>
  v == null || v === '' ? '—' : `${cur ? `${cur} ` : ''}${Number(v).toLocaleString()}`

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** timestamptz → value for a <input type="datetime-local"> (local time, no tz). */
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function BreakdownCallouts() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [countryFilter, setCountryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
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
      const data = await listBreakdownCallouts({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load breakdown callouts.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseCallouts(rows || []), [rows])
  const typeBreakdown = useMemo(() => byType(rows || []), [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (countryFilter && r.country !== countryFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (severityFilter && r.severity !== severityFilter) return false
      if (typeFilter && r.breakdown_type !== typeFilter) return false
      if (q) {
        const hay = `${r.callout_no || ''} ${r.asset_no || ''} ${r.driver_name || ''} ${r.location || ''} ${r.provider || ''} ${r.resolution || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, countryFilter, statusFilter, severityFilter, typeFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total callouts', value: summary.totalCallouts, icon: LifeBuoy, tone: 'text-[var(--text-primary)]' },
    { label: 'Open callouts', value: summary.openCount, icon: Siren, tone: 'text-amber-400' },
    { label: 'Critical open', value: summary.criticalOpenCount, icon: ShieldAlert, tone: 'text-red-400' },
    { label: 'Avg response', value: fmtMinutes(summary.avgResponseMinutes), icon: Clock, tone: 'text-sky-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['callout_no', 'asset_no', 'breakdown_type', 'severity', 'status', 'driver_name', 'location', 'provider', 'reported_at', 'response_minutes', 'resolution_minutes', 'cost', 'currency']
  const EXPORT_HEADERS = ['Callout #', 'Asset', 'Type', 'Severity', 'Status', 'Driver', 'Location', 'Provider', 'Reported', 'Response (min)', 'Resolution (min)', 'Cost', 'Currency']
  const exportRows = filtered.map((r) => ({
    callout_no: r.callout_no || '', asset_no: r.asset_no || '',
    breakdown_type: r.breakdown_type || '', severity: r.severity || '',
    status: r.status || '', driver_name: r.driver_name || '',
    location: r.location || '', provider: r.provider || '',
    reported_at: r.reported_at ? new Date(r.reported_at).toLocaleString() : '',
    response_minutes: responseMinutes(r) ?? '',
    resolution_minutes: resolutionMinutes(r) ?? '',
    cost: r.cost ?? '', currency: r.currency || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', callout_no: r.callout_no || '',
      driver_name: r.driver_name || '', location: r.location || '',
      breakdown_type: r.breakdown_type || '', severity: r.severity || '',
      reported_at: toLocalInput(r.reported_at), dispatched_at: toLocalInput(r.dispatched_at),
      resolved_at: toLocalInput(r.resolved_at), provider: r.provider || '',
      cost: r.cost ?? '', currency: r.currency || '', status: r.status || 'reported',
      resolution: r.resolution || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (form.cost !== '' && form.cost != null && !(Number(form.cost) >= 0)) {
      setFormError('Cost must be a non-negative number.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateBreakdownCallout(editing.id, payload)
      else await createBreakdownCallout(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the callout.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteBreakdownCallout(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the callout.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => {
    setCountryFilter(''); setStatusFilter(''); setSeverityFilter(''); setTypeFilter(''); setSearch('')
  }
  const hasFilters = countryFilter || statusFilter || severityFilter || typeFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Breakdown Callouts"
        subtitle="Log and track roadside assistance and breakdown events per asset — response, resolution, cost, and provider performance for availability and downtime analytics."
        icon={LifeBuoy}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'breakdown_callouts') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Breakdown Callouts', 'breakdown_callouts', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log callout
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Breakdown callouts aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V176_BREAKDOWN_CALLOUTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load breakdown callouts.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Callouts by type */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Wrench size={15} /> Callouts by breakdown type
        </h3>
        {rows === null ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : typeBreakdown.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No callouts logged yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {typeBreakdown.map((t) => (
              <div key={t.type} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                <p className="text-xs text-[var(--text-muted)]">{titleCase(t.type)}</p>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{t.count} callout{t.count === 1 ? '' : 's'}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{t.cost > 0 ? fmtCost(t.cost) : '—'}</p>
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
            <input className="input pl-9 w-full" placeholder="Search callout #, asset, driver, location, provider…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {countryOptions.length > 0 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className="input" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {BREAKDOWN_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalCallouts}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Callout', 'Asset', 'Type', 'Severity', 'Status', 'Reported', 'Response', 'Cost', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No callouts logged yet — log your first breakdown callout.' : 'No callouts match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)] whitespace-nowrap">{r.callout_no || '—'}</td>
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{titleCase(r.breakdown_type)}</td>
                    <td className="px-4 py-2.5">
                      {r.severity
                        ? <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${SEVERITY_BADGE[r.severity] || 'bg-slate-700/40 text-slate-200'}`}>{titleCase(r.severity)}</span>
                        : <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.status
                        ? <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[r.status] || 'bg-slate-700/40 text-slate-200'}`}>{STATUS_LABEL[r.status] || r.status}</span>
                        : <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.reported_at)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtMinutes(responseMinutes(r))}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtCost(r.cost, r.currency)}</td>
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit callout' : 'Log breakdown callout'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Callout # (optional)</label>
                  <input className="input w-full" placeholder="e.g. BRK-2026-0142" value={form.callout_no} maxLength={80} onChange={(e) => set('callout_no', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Breakdown type</label>
                  <select className="input w-full" value={form.breakdown_type} onChange={(e) => set('breakdown_type', e.target.value)}>
                    <option value="">Select type…</option>
                    {BREAKDOWN_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Severity</label>
                  <select className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                    <option value="">Select severity…</option>
                    {SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Driver (optional)</label>
                  <input className="input w-full" placeholder="e.g. Ahmed Khan" value={form.driver_name} maxLength={160} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Location (optional)</label>
                <input className="input w-full" placeholder="e.g. Highway 40, KM 218 near Al Kharj" value={form.location} maxLength={300} onChange={(e) => set('location', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Reported at</label>
                  <input className="input w-full" type="datetime-local" value={form.reported_at} onChange={(e) => set('reported_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
                <div>
                  <label className="label">Dispatched at</label>
                  <input className="input w-full" type="datetime-local" value={form.dispatched_at} onChange={(e) => set('dispatched_at', e.target.value)} />
                </div>
                <div>
                  <label className="label">Resolved at</label>
                  <input className="input w-full" type="datetime-local" value={form.resolved_at} onChange={(e) => set('resolved_at', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Provider (optional)</label>
                  <input className="input w-full" placeholder="e.g. RoadCare KSA" value={form.provider} maxLength={200} onChange={(e) => set('provider', e.target.value)} />
                </div>
                <div>
                  <label className="label">Cost (optional)</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="850" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
                </div>
                <div>
                  <label className="label">Currency (optional)</label>
                  <input className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Resolution (optional)</label>
                <textarea className="input w-full min-h-[64px] resize-y" placeholder="e.g. replaced steer tyre on site, asset returned to service" value={form.resolution} maxLength={8000} onChange={(e) => set('resolution', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[64px] resize-y" placeholder="e.g. recurring issue on this axle" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Log callout'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this callout?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.callout_no || confirmDelete.asset_no || 'Callout'} · {titleCase(confirmDelete.breakdown_type)} · {fmtDateTime(confirmDelete.reported_at)}. This can’t be undone.
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
