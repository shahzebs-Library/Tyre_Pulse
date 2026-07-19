/**
 * ApprovalDelegations (route /approval-delegations) — Approval Delegation /
 * Acting Approver (enterprise plan §6). Lets a user hand their approval
 * authority to a backup/acting approver for a period (leave cover, temporary
 * delegation), optionally scoped to one approval type. Additive to the V95
 * workflow engine: a delegate's inbox surfaces delegated pending approvals via
 * `workflows.myDelegatedApprovals()`; this page manages the delegations.
 *
 * Runs on the `approval_delegations` table (V203). Real data, KPI tiles, a "My
 * delegations" section (rows I created) plus an org-wide table (managers),
 * search + status filter, create/edit modal with a user picker, delete confirm,
 * Excel/PDF export, and loading / empty / error / not-provisioned states. All
 * lifecycle logic (active / upcoming / expired) lives in the pure
 * `src/lib/approvalDelegations.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  UserCheck, Users, CalendarClock, Clock, ShieldCheck, CheckCircle2,
  Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
  AlertTriangle, Power, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../contexts/AuthContext'
import {
  listDelegations, myDelegations, createDelegation, updateDelegation, deleteDelegation,
} from '../lib/api/approvalDelegations'
import { listProfiles } from '../lib/api/users'
import { summariseDelegations, delegationStatus } from '../lib/approvalDelegations'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const MANAGER_ROLES = new Set(['Admin', 'Manager', 'Director'])

// Common approval entity types (scope options); free text is also accepted.
const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'All approval types' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'work_order', label: 'Work Order' },
  { value: 'accident', label: 'Accident' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'tyre_change', label: 'Tyre Change' },
]

const STATUS_META = {
  active: { label: 'Active', cls: 'bg-green-500/15 text-green-300 border-green-500/40' },
  upcoming: { label: 'Upcoming', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/40' },
  expired: { label: 'Expired', cls: 'bg-gray-500/15 text-gray-300 border-gray-500/40' },
  inactive: { label: 'Inactive', cls: 'bg-gray-500/15 text-gray-300 border-gray-500/40' },
}

const EMPTY_FORM = {
  delegate_id: '', delegator_id: '', entity_type: '',
  reason: '', starts_at: '', ends_at: '', active: true,
}

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** Datetime-local value (YYYY-MM-DDTHH:mm) from a stored timestamp. */
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

export default function ApprovalDelegations() {
  const { user, profile } = useAuth()
  const myId = user?.id || null
  const isManager = MANAGER_ROLES.has(profile?.role) || profile?.is_super_admin === true

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [people, setPeople] = useState([])

  const [statusFilter, setStatusFilter] = useState('')
  const [scopeFilter, setScopeFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const nowMs = Date.now()

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      // Managers see the org-wide set; everyone else sees the delegations they
      // created (RLS lets them read all, but the focused view is honest).
      const data = isManager ? await listDelegations({ limit: 500 }) : await myDelegations()
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load delegations.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [isManager])

  useEffect(() => { load() }, [load])

  // Best-effort user directory for the picker; degrades to free-text id entry.
  useEffect(() => {
    let alive = true
    listProfiles()
      .then((list) => { if (alive) setPeople(Array.isArray(list) ? list : []) })
      .catch(() => { if (alive) setPeople([]) })
    return () => { alive = false }
  }, [])

  const peopleById = useMemo(() => {
    const m = new Map()
    for (const p of people) m.set(p.id, p)
    return m
  }, [people])

  const nameOf = useCallback((id) => {
    if (!id) return '—'
    const p = peopleById.get(id)
    if (!p) return id
    return p.full_name || p.username || p.email || id
  }, [peopleById])

  const summary = useMemo(() => summariseDelegations(rows || [], nowMs), [rows, nowMs])

  const mine = useMemo(
    () => (rows || []).filter((r) => r.delegator_id === myId),
    [rows, myId],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter && delegationStatus(r, nowMs) !== statusFilter) return false
      if (scopeFilter && (r.entity_type || '') !== scopeFilter) return false
      if (q) {
        const hay = `${nameOf(r.delegator_id)} ${nameOf(r.delegate_id)} ${r.entity_type || ''} ${r.reason || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, scopeFilter, search, nowMs, nameOf])

  const kpis = [
    { label: 'Delegations', value: summary.total, icon: Users, tone: 'text-[var(--text-primary)]' },
    { label: 'Active now', value: summary.activeCount, icon: ShieldCheck, tone: 'text-green-400' },
    { label: 'Upcoming', value: summary.upcomingCount, icon: CalendarClock, tone: 'text-sky-400' },
    { label: 'Expired', value: summary.expiredCount, icon: Clock, tone: 'text-amber-400' },
  ]

  // ── Export ─────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['delegator', 'delegate', 'entity_type', 'status', 'starts_at', 'ends_at', 'reason']
  const EXPORT_HEADERS = ['Delegator', 'Delegate (acting)', 'Scope', 'Status', 'Starts', 'Ends', 'Reason']
  const exportRows = filtered.map((r) => ({
    delegator: nameOf(r.delegator_id),
    delegate: nameOf(r.delegate_id),
    entity_type: r.entity_type || 'All types',
    status: STATUS_META[delegationStatus(r, nowMs)]?.label || '—',
    starts_at: r.starts_at ? fmtDateTime(r.starts_at) : 'Immediately',
    ends_at: r.ends_at ? fmtDateTime(r.ends_at) : 'Open-ended',
    reason: r.reason || '',
  }))

  // ── Modal ──────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, delegator_id: isManager ? '' : (myId || '') })
    setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      delegate_id: r.delegate_id || '',
      delegator_id: r.delegator_id || '',
      entity_type: r.entity_type || '',
      reason: r.reason || '',
      starts_at: toLocalInput(r.starts_at),
      ends_at: toLocalInput(r.ends_at),
      active: r.active !== false,
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const canManageRow = useCallback(
    (r) => isManager || r?.delegator_id === myId,
    [isManager, myId],
  )

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.delegate_id.trim()) { setFormError('Choose who will act on the approvals (the delegate).'); return }
    const effectiveDelegator = (isManager && form.delegator_id) ? form.delegator_id : myId
    if (effectiveDelegator && effectiveDelegator === form.delegate_id) {
      setFormError('The delegate must be a different person from the delegator.'); return
    }
    if (form.starts_at && form.ends_at && new Date(form.ends_at) < new Date(form.starts_at)) {
      setFormError('The end date must be on or after the start date.'); return
    }
    setSaving(true)
    try {
      const payload = {
        delegate_id: form.delegate_id,
        entity_type: form.entity_type || null,
        reason: form.reason || null,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
        active: Boolean(form.active),
      }
      // Only send an explicit delegator when a manager selects one; otherwise the
      // DB default (auth.uid()) records the caller as the delegator.
      if (isManager && form.delegator_id) payload.delegator_id = form.delegator_id

      if (editing) await updateDelegation(editing.id, payload)
      else await createDelegation(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the delegation.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, isManager, myId, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteDelegation(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the delegation.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter(''); setScopeFilter(''); setSearch('') }
  const hasFilters = statusFilter || scopeFilter || search

  const scopeLabel = (v) =>
    ENTITY_TYPE_OPTIONS.find((o) => o.value === (v || ''))?.label || v || 'All approval types'

  const StatusBadge = ({ r }) => {
    const meta = STATUS_META[delegationStatus(r, nowMs)] || STATUS_META.inactive
    return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
  }

  const renderRow = (r) => (
    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)] whitespace-nowrap">{nameOf(r.delegator_id)}</td>
      <td className="px-4 py-2.5 text-[var(--text-primary)] whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5"><UserCheck size={13} className="text-sky-400" /> {nameOf(r.delegate_id)}</span>
      </td>
      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{scopeLabel(r.entity_type)}</td>
      <td className="px-4 py-2.5"><StatusBadge r={r} /></td>
      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.starts_at ? fmtDateTime(r.starts_at) : 'Immediately'}</td>
      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.ends_at ? fmtDateTime(r.ends_at) : 'Open-ended'}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {canManageRow(r) ? (
            <>
              <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
              <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
            </>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">Read-only</span>
          )}
        </div>
      </td>
    </tr>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval Delegation"
        subtitle="Hand your approval authority to a backup or acting approver for a period — leave cover, temporary delegation, or a standing deputy. Additive to the approval workflow engine."
        icon={UserCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'approval_delegations') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Approval Delegations', 'approval_delegations', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Delegate approvals
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Approval delegation isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V203_APPROVAL_DELEGATIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load delegations.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* My delegations */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <ShieldCheck size={15} /> My delegations
          <span className="text-xs font-normal text-[var(--text-muted)]">— approvals you have handed to someone else</span>
        </h3>
        {rows === null ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : mine.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">You haven’t delegated any approvals. Use “Delegate approvals” to appoint an acting approver.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {mine.map((r) => {
              const meta = STATUS_META[delegationStatus(r, nowMs)] || STATUS_META.inactive
              return (
                <div key={r.id} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 min-w-[180px]">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                      <UserCheck size={13} className="text-sky-400" /> {nameOf(r.delegate_id)}
                    </p>
                    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">{scopeLabel(r.entity_type)}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{r.ends_at ? `Until ${fmtDateTime(r.ends_at)}` : 'Open-ended'}</p>
                </div>
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
            <input className="input pl-9 w-full" placeholder="Search delegator, delegate, scope, reason…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="upcoming">Upcoming</option>
            <option value="expired">Expired</option>
          </select>
          <select className="input" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} aria-label="Scope">
            <option value="">All scopes</option>
            {ENTITY_TYPE_OPTIONS.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Delegator', 'Delegate (acting)', 'Scope', 'Status', 'Starts', 'Ends', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {(rows.length === 0 && !notProvisioned) ? 'No delegations yet — appoint an acting approver to get started.' : 'No delegations match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map(renderRow)
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit delegation' : 'Delegate approvals'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              {isManager && (
                <div>
                  <label className="label">Delegator (whose approvals)</label>
                  {people.length ? (
                    <select className="input w-full" value={form.delegator_id} onChange={(e) => set('delegator_id', e.target.value)}>
                      <option value="">Me ({nameOf(myId)})</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username || p.email || p.id}{p.role ? ` — ${p.role}` : ''}</option>)}
                    </select>
                  ) : (
                    <input className="input w-full" placeholder="User id (leave blank for yourself)" value={form.delegator_id} onChange={(e) => set('delegator_id', e.target.value)} />
                  )}
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">As a manager you may set up a delegation on another user’s behalf. Leave as “Me” to delegate your own approvals.</p>
                </div>
              )}

              <div>
                <label className="label">Delegate (acts on the approvals)</label>
                {people.length ? (
                  <select className="input w-full" value={form.delegate_id} onChange={(e) => set('delegate_id', e.target.value)}>
                    <option value="">Select a user…</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.username || p.email || p.id}{p.role ? ` — ${p.role}` : ''}</option>)}
                  </select>
                ) : (
                  <>
                    <input className="input w-full" placeholder="Delegate user id" value={form.delegate_id} onChange={(e) => set('delegate_id', e.target.value)} />
                    <p className="text-[11px] text-[var(--text-muted)] mt-1 inline-flex items-center gap-1"><Info size={12} /> User directory unavailable — enter the delegate’s user id.</p>
                  </>
                )}
              </div>

              <div>
                <label className="label">Scope</label>
                <select className="input w-full" value={form.entity_type} onChange={(e) => set('entity_type', e.target.value)}>
                  {ENTITY_TYPE_OPTIONS.map((o) => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
                </select>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Limit the delegation to one approval type, or leave as “All approval types”.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Starts</label>
                  <input className="input w-full" type="datetime-local" value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Blank = effective immediately.</p>
                </div>
                <div>
                  <label className="label">Ends</label>
                  <input className="input w-full" type="datetime-local" value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Blank = open-ended.</p>
                </div>
              </div>

              <div>
                <label className="label">Reason (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. annual leave 14–21 Jul; deputy approver" value={form.reason} maxLength={8000} onChange={(e) => set('reason', e.target.value)} />
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
                <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
                <Power size={14} className={form.active ? 'text-green-400' : 'text-[var(--text-muted)]'} />
                Delegation is active
              </label>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create delegation'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Remove this delegation?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {nameOf(confirmDelete.delegate_id)} will no longer act on {nameOf(confirmDelete.delegator_id)}’s approvals. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty-of-actions hint for non-managers with no delegations at all */}
      {rows !== null && rows.length === 0 && !notProvisioned && !error && (
        <div className="card flex items-start gap-3 border border-[var(--input-border)]">
          <CheckCircle2 size={18} className="text-sky-400 mt-0.5 shrink-0" />
          <p className="text-sm text-[var(--text-muted)]">
            Delegations let approvals keep moving while an approver is away. Appoint a backup approver, set an optional window, and their inbox will surface your pending approvals automatically.
          </p>
        </div>
      )}
    </div>
  )
}
