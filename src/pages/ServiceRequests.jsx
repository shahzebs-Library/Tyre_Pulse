/**
 * ServiceRequests (route /service-requests) — Service Requests. A lightweight
 * ticketed request queue that precedes work orders: customers or internal staff
 * raise a service request against an asset (tyre, mechanical, electrical,
 * bodywork, inspection, breakdown, or other), it is triaged, worked, and
 * resolved/closed. Intake throughput and resolution time feed the formal
 * work-order lifecycle downstream.
 *
 * Runs on the new `service_requests` table (V174). Real data, KPI tiles, a
 * status breakdown strip, create/edit modal, filters, search, delete confirm,
 * Excel/PDF export, and loading/empty/error states throughout. The KPI summary,
 * status breakdown, and category distribution live in the pure
 * `src/lib/serviceRequests.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Wrench, ClipboardList, Inbox, Flame, Timer, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listServiceRequests, createServiceRequest, updateServiceRequest, deleteServiceRequest,
} from '../lib/api/serviceRequests'
import { summariseRequests, byStatus, byCategory } from '../lib/serviceRequests'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const CATEGORY_OPTIONS = ['tyre', 'mechanical', 'electrical', 'bodywork', 'inspection', 'breakdown', 'other']
const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent']
const STATUS_OPTIONS = ['new', 'triaged', 'in_progress', 'resolved', 'closed', 'cancelled']

const STATUS_LABELS = {
  new: 'New', triaged: 'Triaged', in_progress: 'In progress',
  resolved: 'Resolved', closed: 'Closed', cancelled: 'Cancelled',
}

const EMPTY_FORM = {
  request_no: '', asset_no: '', requester_name: '', contact: '', category: 'tyre',
  priority: 'medium', status: 'new', subject: '', description: '',
  requested_at: '', resolved_at: '', assigned_to: '', resolution: '', notes: '',
}

const PRIORITY_BADGE = {
  low: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
  medium: 'bg-sky-900/30 text-sky-300 border-sky-800/50',
  high: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  urgent: 'bg-red-900/30 text-red-300 border-red-800/50',
}

const STATUS_BADGE = {
  new: 'bg-indigo-900/30 text-indigo-300 border-indigo-800/50',
  triaged: 'bg-sky-900/30 text-sky-300 border-sky-800/50',
  in_progress: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  resolved: 'bg-green-900/30 text-green-300 border-green-800/50',
  closed: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
  cancelled: 'bg-red-900/30 text-red-300 border-red-800/50',
}

const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '—')
const statusLabel = (s) => STATUS_LABELS[s] || cap(s)

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function fmtHours(v) {
  if (v == null) return '—'
  if (v < 24) return `${v.toFixed(1)} h`
  return `${(v / 24).toFixed(1)} d`
}

function Badge({ value, map, label }) {
  if (!value) return <span className="text-[var(--text-muted)]">—</span>
  const cls = map[value] || 'bg-slate-700/40 text-slate-300 border-slate-600/50'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label ? label(value) : cap(value)}
    </span>
  )
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function ServiceRequests() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
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
      const data = await listServiceRequests({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load service requests.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseRequests(rows || []), [rows])
  const statusCounts = useMemo(() => byStatus(rows || []), [rows])
  const categories = useMemo(() => byCategory(rows || []), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (priorityFilter && r.priority !== priorityFilter) return false
      if (categoryFilter && r.category !== categoryFilter) return false
      if (q) {
        const hay = `${r.request_no || ''} ${r.subject || ''} ${r.asset_no || ''} ${r.requester_name || ''} ${r.assigned_to || ''} ${r.description || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, priorityFilter, categoryFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total requests', value: summary.totalRequests, icon: ClipboardList, tone: 'text-[var(--text-primary)]' },
    { label: 'Open', value: summary.openCount, icon: Inbox, tone: 'text-sky-400' },
    { label: 'Urgent open', value: summary.urgentOpenCount, icon: Flame, tone: 'text-red-400' },
    { label: 'Avg resolution', value: fmtHours(summary.avgResolutionHours), icon: Timer, tone: 'text-green-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['request_no', 'subject', 'asset_no', 'category', 'priority', 'status', 'requester_name', 'assigned_to', 'requested_at', 'resolved_at']
  const EXPORT_HEADERS = ['Request #', 'Subject', 'Asset', 'Category', 'Priority', 'Status', 'Requester', 'Assigned to', 'Requested at', 'Resolved at']
  const exportRows = filtered.map((r) => ({
    request_no: r.request_no || '', subject: r.subject || '', asset_no: r.asset_no || '',
    category: cap(r.category), priority: cap(r.priority), status: statusLabel(r.status),
    requester_name: r.requester_name || '', assigned_to: r.assigned_to || '',
    requested_at: r.requested_at || '', resolved_at: r.resolved_at || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      request_no: r.request_no || '', asset_no: r.asset_no || '',
      requester_name: r.requester_name || '', contact: r.contact || '',
      category: r.category || 'tyre', priority: r.priority || 'medium',
      status: r.status || 'new', subject: r.subject || '', description: r.description || '',
      requested_at: r.requested_at ? String(r.requested_at).slice(0, 16) : '',
      resolved_at: r.resolved_at ? String(r.resolved_at).slice(0, 16) : '',
      assigned_to: r.assigned_to || '', resolution: r.resolution || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.subject.trim()) { setFormError('A subject is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        requested_at: form.requested_at || null,
        resolved_at: form.resolved_at || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateServiceRequest(editing.id, payload)
      else await createServiceRequest(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the request.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteServiceRequest(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the request.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter(''); setPriorityFilter(''); setCategoryFilter(''); setSearch('') }
  const hasFilters = statusFilter || priorityFilter || categoryFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Requests"
        subtitle="Intake queue for customer and internal service requests — triage, prioritise, assign, and resolve tickets before they become work orders."
        icon={Wrench}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'service_requests')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Service Requests', 'service_requests', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New request
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Service requests aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V174_SERVICE_REQUESTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load service requests.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Status breakdown strip */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <ClipboardList size={15} /> Requests by status
        </h3>
        {rows === null ? (
          <div className="h-14 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : summary.totalRequests === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No requests raised yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((s) => {
              const count = statusCounts[s] || 0
              const active = statusFilter === s
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(active ? '' : s)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${active ? 'border-[var(--accent)] bg-[var(--input-bg)]' : 'border-[var(--input-border)] bg-[var(--input-bg)]/40 hover:bg-[var(--input-bg)]'}`}
                >
                  <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 rounded-full ${(STATUS_BADGE[s] || '').split(' ')[0]}`} />
                    {statusLabel(s)}
                  </p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{count}</p>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search request #, subject, asset, requester, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <select className="input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Priority">
            <option value="">All priorities</option>
            {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
          </select>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalRequests}</span>
        </div>
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {categories.map((c) => (
              <button
                key={c.category}
                onClick={() => setCategoryFilter(categoryFilter === c.category ? '' : c.category)}
                className={`text-[11px] rounded-full border px-2 py-0.5 transition-colors ${categoryFilter === c.category ? 'border-[var(--accent)] text-[var(--text-primary)] bg-[var(--input-bg)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                {cap(c.category)} · {c.count}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Request', 'Subject', 'Asset', 'Category', 'Priority', 'Status', 'Requested', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No requests raised yet — create your first request.' : 'No requests match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)] whitespace-nowrap">{r.request_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-primary)] max-w-[280px] truncate" title={r.subject || ''}>{r.subject || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{cap(r.category)}</td>
                    <td className="px-4 py-2.5"><Badge value={r.priority} map={PRIORITY_BADGE} /></td>
                    <td className="px-4 py-2.5"><Badge value={r.status} map={STATUS_BADGE} label={statusLabel} /></td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.requested_at)}</td>
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit request' : 'New service request'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label">Subject</label>
                <input className="input w-full" placeholder="e.g. Front-left tyre losing pressure" value={form.subject} maxLength={300} onChange={(e) => set('subject', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Category</label>
                  <select className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select className="input w-full" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                    {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Request # (optional)</label>
                  <input className="input w-full" placeholder="e.g. SR-2026-0142" value={form.request_no} maxLength={60} onChange={(e) => set('request_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Asset number (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Requester (optional)</label>
                  <input className="input w-full" placeholder="Name" value={form.requester_name} maxLength={200} onChange={(e) => set('requester_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Contact (optional)</label>
                  <input className="input w-full" placeholder="Phone / email" value={form.contact} maxLength={200} onChange={(e) => set('contact', e.target.value)} />
                </div>
                <div>
                  <label className="label">Assigned to (optional)</label>
                  <input className="input w-full" placeholder="Technician / team" value={form.assigned_to} maxLength={200} onChange={(e) => set('assigned_to', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Requested at</label>
                  <input className="input w-full" type="datetime-local" value={form.requested_at} onChange={(e) => set('requested_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
                <div>
                  <label className="label">Resolved at (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.resolved_at} onChange={(e) => set('resolved_at', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Description (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="What is being requested, symptoms, context…" value={form.description} maxLength={8000} onChange={(e) => set('description', e.target.value)} />
              </div>
              <div>
                <label className="label">Resolution (optional)</label>
                <textarea className="input w-full min-h-[60px] resize-y" placeholder="How it was resolved, parts/labour, outcome…" value={form.resolution} maxLength={8000} onChange={(e) => set('resolution', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[60px] resize-y" placeholder="Internal notes" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create request'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this request?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.request_no || confirmDelete.subject || 'Request'} · {cap(confirmDelete.category)} · {statusLabel(confirmDelete.status)}. This can’t be undone.
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
