/**
 * ApprovalDelegations (route /approval-delegations): Approval Delegation /
 * Acting Approver (enterprise plan section 6). Lets a user hand their approval
 * authority to a backup/acting approver for a period (leave cover, temporary
 * delegation), optionally scoped to one approval type. Additive to the V95
 * workflow engine: a delegate's inbox surfaces delegated pending approvals via
 * `workflows.myDelegatedApprovals()`; this page manages the delegations.
 *
 * Runs on the `approval_delegations` table (V203). Real data only: KPI strip, a
 * "My delegations" section (rows I created) plus an org-wide register
 * (managers), search + status + scope filters, a sortable paged
 * EnterpriseTable, create/edit dialog with a user picker, delete confirm,
 * Excel/PDF export of the whole filtered set, and loading / empty / error+Retry
 * / not-provisioned states. Lifecycle logic lives in
 * `src/lib/approvalDelegations.js`; page calculation in
 * `src/lib/approvalDelegationsAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  UserCheck, Users, CalendarClock, Clock, ShieldCheck, CheckCircle2, Hourglass,
  Search, X, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
  AlertTriangle, Power, Info, Infinity as InfinityIcon,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useAuth } from '../contexts/AuthContext'
import {
  listDelegations, myDelegations, createDelegation, updateDelegation, deleteDelegation,
} from '../lib/api/approvalDelegations'
import { listProfiles } from '../lib/api/users'
import {
  delegationKpis, delegationStatus, filterDelegations, delegationExportRows,
  personName, scopeLabel, ENTITY_TYPE_OPTIONS, STATUS_LABEL, EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/approvalDelegationsAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const MANAGER_ROLES = new Set(['Admin', 'Manager', 'Director'])
const LIST_LIMIT = 500

const STATUS_CLS = {
  active: 'bg-green-500/15 text-green-500 border-green-500/40',
  upcoming: 'bg-blue-500/15 text-blue-500 border-blue-500/40',
  expired: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
  inactive: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

const EMPTY_FORM = {
  delegate_id: '', delegator_id: '', entity_type: '',
  reason: '', starts_at: '', ends_at: '', active: true,
}
const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

/** Datetime-local value (YYYY-MM-DDTHH:mm) from a stored timestamp. */
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function StatusBadge({ status }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLS[status] || STATUS_CLS.inactive}`}>{STATUS_LABEL[status] || 'Inactive'}</span>
}

function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function ApprovalDelegations() {
  const { user, profile } = useAuth()
  const myId = user?.id || null
  const isManager = MANAGER_ROLES.has(profile?.role) || profile?.is_super_admin === true

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

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

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      // Managers see the org-wide set; everyone else sees the delegations they
      // created (RLS lets them read all, but the focused view is honest).
      const data = isManager ? await listDelegations({ limit: LIST_LIMIT }) : await myDelegations()
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      setNowMs(Date.now())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else setError(toUserMessage(err, 'Could not load delegations.'))
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
  const nameOf = useCallback((id) => personName(id, peopleById), [peopleById])

  const loaded = Array.isArray(rows)
  const kpi = useMemo(() => (loaded ? delegationKpis(rows, { now: nowMs }) : null), [rows, loaded, nowMs])
  const mine = useMemo(() => (rows || []).filter((r) => r.delegator_id === myId), [rows, myId])
  const filtered = useMemo(
    () => filterDelegations(rows || [], { status: statusFilter, scope: scopeFilter, search }, nowMs, nameOf),
    [rows, statusFilter, scopeFilter, search, nowMs, nameOf],
  )
  const exportRows = useMemo(() => delegationExportRows(filtered, nowMs, nameOf, fmtDateTime), [filtered, nowMs, nameOf])
  const truncated = isManager && loaded && rows.length >= LIST_LIMIT

  const doExport = async (kind) => {
    setActionError('')
    const base = reportFileName('TyrePulse Approval Delegations', reportDateLabel())
    try {
      if (kind === 'xlsx') await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, base, 'Delegations', { title: 'Approval Delegations' })
      else await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Approval Delegations', base, 'landscape')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, delegator_id: isManager ? '' : (myId || '') })
    setFormError(''); setShowModal(true)
  }
  const openEdit = useCallback((r) => {
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
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const canManageRow = useCallback((r) => isManager || r?.delegator_id === myId, [isManager, myId])

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
      setActionError(toUserMessage(err, 'Could not delete the delegation.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter(''); setScopeFilter(''); setSearch('') }
  const hasFilters = statusFilter || scopeFilter || search

  const columns = useMemo(() => [
    {
      id: 'delegator', header: 'Delegator', accessorFn: (r) => nameOf(r.delegator_id), size: 170,
      cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)] whitespace-nowrap">{getValue()}</span>,
    },
    {
      id: 'delegate', header: 'Delegate (acting)', accessorFn: (r) => nameOf(r.delegate_id), size: 180,
      cell: ({ getValue }) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[var(--text-primary)]"><UserCheck size={13} className="text-sky-500" aria-hidden="true" /> {getValue()}</span>,
    },
    { id: 'scope', header: 'Scope', accessorFn: (r) => scopeLabel(r.entity_type), size: 160, meta: { filterVariant: 'select' } },
    {
      id: 'status', header: 'Status', accessorFn: (r) => STATUS_LABEL[delegationStatus(r, nowMs)], size: 110, meta: { filterVariant: 'select' },
      cell: ({ row }) => <StatusBadge status={delegationStatus(row.original, nowMs)} />,
    },
    {
      id: 'starts', header: 'Starts', accessorFn: (r) => r.starts_at || '', size: 170,
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.starts_at ? fmtDateTime(row.original.starts_at) : 'Immediately'}</span>,
    },
    {
      id: 'ends', header: 'Ends', accessorFn: (r) => r.ends_at || '9999', size: 170,
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.ends_at ? fmtDateTime(row.original.ends_at) : 'Open-ended'}</span>,
    },
    { id: 'reason', header: 'Reason', accessorFn: (r) => r.reason || '', size: 200, cell: ({ getValue }) => <span className="line-clamp-2">{getValue() || 'N/A'}</span> },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false, align: 'right' },
      cell: ({ row }) => canManageRow(row.original) ? (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit delegation to ${nameOf(row.original.delegate_id)}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:text-red-500`} aria-label={`Remove delegation to ${nameOf(row.original.delegate_id)}`}><Trash2 size={15} /></button>
        </div>
      ) : <span className="text-[11px] text-[var(--text-muted)]">Read-only</span>,
    },
  ], [nameOf, nowMs, canManageRow, openEdit])

  const personOption = (p) => <option key={p.id} value={p.id}>{p.full_name || p.username || p.email || p.id}{p.role ? ` (${p.role})` : ''}</option>

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval Delegation"
        subtitle="Hand your approval authority to a backup or acting approver for a period: leave cover, temporary delegation, or a standing deputy. Additive to the approval workflow engine."
        icon={UserCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('xlsx')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> Delegate approvals
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Approval delegation is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V203_APPROVAL_DELEGATIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {actionError && (
        <div role="alert" className="card border border-red-500/40 flex items-start justify-between gap-3">
          <p className="text-sm text-red-500">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Delegations" value={kpi ? kpi.total : 'N/A'} sub={kpi ? `${kpi.distinctDelegates} acting approver(s)` : null} icon={Users} tone="text-[var(--text-primary)]" />
        <Kpi label="Active now" value={kpi ? kpi.activeCount : 'N/A'} icon={ShieldCheck} tone="text-green-500" />
        <Kpi label="Upcoming" value={kpi ? kpi.upcomingCount : 'N/A'} icon={CalendarClock} tone="text-sky-500" />
        <Kpi label={`Ending in ${kpi?.soonDays ?? 7} days`} value={kpi ? kpi.endingSoon : 'N/A'} icon={Hourglass} tone={kpi && kpi.endingSoon > 0 ? 'text-orange-500' : 'text-[var(--text-primary)]'} />
        <Kpi label="Open-ended (active)" value={kpi ? kpi.openEnded : 'N/A'} sub="no end date set" icon={InfinityIcon} tone="text-violet-500" />
        <Kpi label="Expired" value={kpi ? kpi.expiredCount : 'N/A'} icon={Clock} tone="text-amber-500" />
      </div>

      {/* My delegations */}
      <section className="card" aria-labelledby="deleg-mine">
        <h2 id="deleg-mine" className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex flex-wrap items-center gap-2">
          <ShieldCheck size={15} aria-hidden="true" /> My delegations
          <span className="text-xs font-normal text-[var(--text-muted)]">(approvals you have handed to someone else)</span>
        </h2>
        {!loaded && !error ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : !loaded ? (
          <p className="text-sm text-[var(--text-muted)]">Unavailable until the delegations load.</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">You have not delegated any approvals. Use Delegate approvals to appoint an acting approver.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {mine.map((r) => (
              <button type="button" key={r.id} onClick={() => openEdit(r)} className="text-left min-h-[44px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 hover:border-[var(--text-muted)]" aria-label={`Edit delegation to ${nameOf(r.delegate_id)}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 truncate">
                    <UserCheck size={13} className="text-sky-500" aria-hidden="true" /> {nameOf(r.delegate_id)}
                  </p>
                  <StatusBadge status={delegationStatus(r, nowMs)} />
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">{scopeLabel(r.entity_type)}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{r.ends_at ? `Until ${fmtDateTime(r.ends_at)}` : 'Open-ended'}</p>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="deleg-search" className="sr-only">Search delegations</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="deleg-search" className="input pl-9 w-full min-h-[44px]" placeholder="Search delegator, delegate, scope, reason" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="input min-h-[44px]" value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} aria-label="Scope">
            <option value="">All scopes</option>
            {ENTITY_TYPE_OPTIONS.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto self-center" aria-live="polite">{filtered.length} of {kpi ? kpi.total : 'N/A'}</span>
        </div>
        {truncated && <p className="text-xs text-amber-500 mt-2">Showing the newest {LIST_LIMIT} delegations. Older delegations are not loaded; narrow with search to find them.</p>}
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={!loaded && !error}
        error={error || null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        viewKey="approval-delegations"
        emptyMessage={
          notProvisioned ? 'Approval delegation is not provisioned yet.'
            : (rows || []).length === 0 ? 'No delegations yet. Appoint an acting approver to get started.'
              : 'No delegations match these filters.'
        }
      />

      {/* Create / Edit dialog */}
      <Modal
        open={showModal}
        onClose={closeModal}
        size="md"
        closeOnBackdrop={!saving}
        title={editing ? 'Edit delegation' : 'Delegate approvals'}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="deleg-form" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create delegation'}
            </button>
          </div>
        }
      >
        <form id="deleg-form" onSubmit={submit} className="space-y-4">
          {isManager && (
            <div>
              <label className="label" htmlFor="df-delegator">Delegator (whose approvals)</label>
              {people.length ? (
                <select id="df-delegator" className="input w-full" value={form.delegator_id} onChange={(e) => set('delegator_id', e.target.value)} aria-describedby="df-delegator-help">
                  <option value="">Me ({nameOf(myId)})</option>
                  {people.map(personOption)}
                </select>
              ) : (
                <input id="df-delegator" className="input w-full" placeholder="User id (leave blank for yourself)" value={form.delegator_id} onChange={(e) => set('delegator_id', e.target.value)} aria-describedby="df-delegator-help" />
              )}
              <p id="df-delegator-help" className="text-[11px] text-[var(--text-muted)] mt-1">As a manager you may set up a delegation on another user's behalf. Leave as Me to delegate your own approvals.</p>
            </div>
          )}

          <div>
            <label className="label" htmlFor="df-delegate">Delegate (acts on the approvals) *</label>
            {people.length ? (
              <select id="df-delegate" className="input w-full" value={form.delegate_id} onChange={(e) => set('delegate_id', e.target.value)} required>
                <option value="">Select a user</option>
                {people.map(personOption)}
              </select>
            ) : (
              <>
                <input id="df-delegate" className="input w-full" placeholder="Delegate user id" value={form.delegate_id} onChange={(e) => set('delegate_id', e.target.value)} required aria-describedby="df-delegate-help" />
                <p id="df-delegate-help" className="text-[11px] text-[var(--text-muted)] mt-1 inline-flex items-center gap-1"><Info size={12} aria-hidden="true" /> User directory unavailable. Enter the delegate's user id.</p>
              </>
            )}
          </div>

          <div>
            <label className="label" htmlFor="df-scope">Scope</label>
            <select id="df-scope" className="input w-full" value={form.entity_type} onChange={(e) => set('entity_type', e.target.value)} aria-describedby="df-scope-help">
              {ENTITY_TYPE_OPTIONS.map((o) => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
            </select>
            <p id="df-scope-help" className="text-[11px] text-[var(--text-muted)] mt-1">Limit the delegation to one approval type, or leave as All approval types.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="df-starts">Starts</label>
              <input id="df-starts" className="input w-full" type="datetime-local" value={form.starts_at} onChange={(e) => set('starts_at', e.target.value)} aria-describedby="df-starts-help" />
              <p id="df-starts-help" className="text-[11px] text-[var(--text-muted)] mt-1">Blank means effective immediately.</p>
            </div>
            <div>
              <label className="label" htmlFor="df-ends">Ends</label>
              <input id="df-ends" className="input w-full" type="datetime-local" value={form.ends_at} onChange={(e) => set('ends_at', e.target.value)} aria-describedby="df-ends-help" />
              <p id="df-ends-help" className="text-[11px] text-[var(--text-muted)] mt-1">Blank means open-ended.</p>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="df-reason">Reason (optional)</label>
            <textarea id="df-reason" className="input w-full min-h-[70px] resize-y" placeholder="e.g. annual leave 14 to 21 Jul; deputy approver" value={form.reason} maxLength={8000} onChange={(e) => set('reason', e.target.value)} />
          </div>

          <label className="flex items-center gap-2 min-h-[44px] text-sm text-[var(--text-secondary)] cursor-pointer select-none">
            <input type="checkbox" className="w-4 h-4" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            <Power size={14} className={form.active ? 'text-green-500' : 'text-[var(--text-muted)]'} aria-hidden="true" />
            Delegation is active
          </label>

          {formError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => !deleting && setConfirmDelete(null)}
        size="sm"
        closeOnBackdrop={!deleting}
        title="Remove this delegation?"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Removing...' : 'Remove'}
            </button>
          </div>
        }
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-secondary)]">
            {nameOf(confirmDelete.delegate_id)} will no longer act on {nameOf(confirmDelete.delegator_id)}'s approvals. This cannot be undone.
          </p>
        )}
      </Modal>

      {/* Guidance for an organisation with no delegations at all */}
      {loaded && rows.length === 0 && !notProvisioned && !error && (
        <div className="card flex items-start gap-3 border border-[var(--input-border)]">
          <CheckCircle2 size={18} className="text-sky-500 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-muted)]">
            Delegations let approvals keep moving while an approver is away. Appoint a backup approver, set an optional window, and their inbox will surface your pending approvals automatically.
          </p>
        </div>
      )}
    </div>
  )
}
