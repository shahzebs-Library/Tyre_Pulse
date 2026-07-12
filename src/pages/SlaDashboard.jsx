/**
 * SlaDashboard (route /sla-dashboard) — SLA Dashboard. Tracks service-level
 * agreements across operational work (work orders, breakdown callouts,
 * deliveries, inspections, procurement, support tickets) so the fleet can
 * measure responsiveness, catch at-risk commitments before they breach, and
 * report compliance to customers and management.
 *
 * Runs on the new `sla_records` table (V185). Real data, KPI tiles, a by-type
 * compliance breakdown, an at-risk/breached attention strip, filters, search,
 * create/edit modal, delete confirm, live countdown column, Excel/PDF export,
 * and loading/empty/error/not-provisioned states throughout. Breach and
 * compliance logic lives in the pure `src/lib/slaRecords.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ShieldCheck, CheckCircle2, AlertOctagon, Timer, Percent, Hourglass,
  AlertTriangle, Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil,
  Trash2, ListChecks, Flag, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listSlaRecords, createSlaRecord, updateSlaRecord, deleteSlaRecord,
} from '../lib/api/slaRecords'
import {
  summariseSla, byType, breachStatus, hoursRemaining, resolutionHours,
} from '../lib/slaRecords'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  reference: '', sla_type: 'work_order', asset_no: '', priority: 'medium',
  target_hours: '', started_at: '', due_at: '', resolved_at: '',
  status: 'on_track', owner: '', notes: '',
}

const TYPE_OPTIONS = [
  { value: 'work_order', label: 'Work Order' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'support', label: 'Support' },
  { value: 'other', label: 'Other' },
]
const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.value, t.label]))

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'critical']
const STATUS_OPTIONS = ['on_track', 'at_risk', 'breached', 'met', 'cancelled']

const STATUS_META = {
  met: { label: 'Met', cls: 'bg-green-900/30 text-green-300 border border-green-800/50' },
  on_track: { label: 'On Track', cls: 'bg-sky-900/30 text-sky-300 border border-sky-800/50' },
  at_risk: { label: 'At Risk', cls: 'bg-amber-900/30 text-amber-300 border border-amber-800/50' },
  breached: { label: 'Breached', cls: 'bg-red-900/30 text-red-300 border border-red-800/50' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-700/40 text-slate-300 border border-slate-600/50' },
  unknown: { label: 'Unknown', cls: 'bg-slate-700/40 text-slate-300 border border-slate-600/50' },
}
const PRIORITY_META = {
  critical: { label: 'Critical', cls: 'bg-red-900/30 text-red-300 border border-red-800/50' },
  high: { label: 'High', cls: 'bg-orange-900/30 text-orange-300 border border-orange-800/50' },
  medium: { label: 'Medium', cls: 'bg-amber-900/20 text-amber-200 border border-amber-800/40' },
  low: { label: 'Low', cls: 'bg-slate-700/40 text-slate-300 border border-slate-600/50' },
}

const TITLE_CASE = (v) => (v ? String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—')

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

/** Human countdown string from signed hours-remaining. */
function fmtCountdown(hrs) {
  if (hrs == null) return '—'
  const overdue = hrs < 0
  let mins = Math.round(Math.abs(hrs) * 60)
  const d = Math.floor(mins / 1440); mins -= d * 1440
  const h = Math.floor(mins / 60); mins -= h * 60
  const parts = []
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (!d && mins) parts.push(`${mins}m`)
  if (!parts.length) parts.push('0m')
  const body = parts.join(' ')
  return overdue ? `${body} overdue` : `${body} left`
}

function fmtHours(v) {
  if (v == null) return '—'
  return `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function SlaDashboard() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')

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
      const data = await listSlaRecords({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load SLA records.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Single clock read per render, injected into every pure computation so the
  // dashboard is internally consistent within a paint.
  const nowMs = Date.now()

  const summary = useMemo(() => summariseSla(rows || [], nowMs), [rows, nowMs])
  const typeBreakdown = useMemo(() => byType(rows || [], nowMs), [rows, nowMs])

  // Decorate each row with its derived status + time remaining once.
  const decorated = useMemo(
    () => (rows || []).map((r) => ({
      ...r,
      _status: breachStatus(r, nowMs),
      _remaining: hoursRemaining(r, nowMs),
      _resolution: resolutionHours(r),
    })),
    [rows, nowMs],
  )

  const attention = useMemo(
    () => decorated
      .filter((r) => r._status === 'breached' || r._status === 'at_risk')
      .sort((a, b) => {
        const rank = { breached: 0, at_risk: 1 }
        if (rank[a._status] !== rank[b._status]) return rank[a._status] - rank[b._status]
        return (a._remaining ?? Infinity) - (b._remaining ?? Infinity)
      })
      .slice(0, 12),
    [decorated],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return decorated.filter((r) => {
      if (typeFilter && r.sla_type !== typeFilter) return false
      if (statusFilter && r._status !== statusFilter) return false
      if (priorityFilter && r.priority !== priorityFilter) return false
      if (q) {
        const hay = `${r.reference || ''} ${r.asset_no || ''} ${r.owner || ''} ${r.notes || ''} ${TYPE_LABEL[r.sla_type] || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [decorated, search, typeFilter, statusFilter, priorityFilter])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Tracked SLAs', value: summary.totalRecords, icon: ListChecks, tone: 'text-[var(--text-primary)]' },
    { label: 'Met', value: summary.metCount, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Breached', value: summary.breachedCount, icon: AlertOctagon, tone: 'text-red-400' },
    { label: 'At risk', value: summary.atRiskCount, icon: Timer, tone: 'text-amber-400' },
    { label: 'Compliance', value: `${summary.complianceRate}%`, icon: Percent, tone: 'text-sky-400' },
    { label: 'Avg resolution', value: summary.avgResolutionHours == null ? '—' : fmtHours(summary.avgResolutionHours), icon: Hourglass, tone: 'text-violet-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['reference', 'sla_type', 'asset_no', 'priority', 'status', 'target_hours', 'due_at', 'resolved_at', 'resolution_hours', 'owner']
  const EXPORT_HEADERS = ['Reference', 'Type', 'Asset', 'Priority', 'Status', 'Target (h)', 'Due at', 'Resolved at', 'Resolution (h)', 'Owner']
  const exportRows = filtered.map((r) => ({
    reference: r.reference || '',
    sla_type: TYPE_LABEL[r.sla_type] || r.sla_type || '',
    asset_no: r.asset_no || '',
    priority: TITLE_CASE(r.priority),
    status: STATUS_META[r._status]?.label || r._status || '',
    target_hours: r.target_hours ?? '',
    due_at: r.due_at ? fmtDateTime(r.due_at) : '',
    resolved_at: r.resolved_at ? fmtDateTime(r.resolved_at) : '',
    resolution_hours: r._resolution == null ? '' : Math.round(r._resolution * 10) / 10,
    owner: r.owner || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const toLocalInput = (v) => {
    if (!v) return ''
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return ''
    const off = d.getTimezoneOffset()
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
  }

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      reference: r.reference || '', sla_type: r.sla_type || 'work_order',
      asset_no: r.asset_no || '', priority: r.priority || 'medium',
      target_hours: r.target_hours ?? '', started_at: toLocalInput(r.started_at),
      due_at: toLocalInput(r.due_at), resolved_at: toLocalInput(r.resolved_at),
      status: r.status || 'on_track', owner: r.owner || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.reference.trim()) { setFormError('A reference is required.'); return }
    if (form.target_hours !== '' && Number(form.target_hours) < 0) { setFormError('Target hours cannot be negative.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        target_hours: form.target_hours === '' ? null : form.target_hours,
        started_at: form.started_at || null,
        due_at: form.due_at || null,
        resolved_at: form.resolved_at || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateSlaRecord(editing.id, payload)
      else await createSlaRecord(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the SLA record.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteSlaRecord(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the SLA record.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setSearch(''); setTypeFilter(''); setStatusFilter(''); setPriorityFilter('') }
  const hasFilters = search || typeFilter || statusFilter || priorityFilter

  const worstType = typeBreakdown[0]

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLA Dashboard"
        subtitle="Track service-level agreements across work orders, breakdowns, deliveries, inspections, procurement and support — catch at-risk commitments before they breach and report compliance."
        icon={ShieldCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'sla_records')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'SLA Dashboard', 'sla_records', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New SLA
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">SLA tracking isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V185_SLA_RECORDS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load SLA records.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
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

      {/* By-type compliance breakdown */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Flag size={15} /> Compliance by SLA type
          {worstType && worstType.breached > 0 && (
            <span className="text-xs font-normal text-red-300 ml-2">Worst: {TYPE_LABEL[worstType.sla_type] || worstType.sla_type} ({worstType.breached} breached)</span>
          )}
        </h3>
        {rows === null ? (
          <div className="h-20 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : typeBreakdown.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No SLA records yet.</p>
        ) : (
          <div className="space-y-2.5">
            {typeBreakdown.map((t) => {
              const rate = t.complianceRate
              const bar = rate >= 90 ? 'bg-green-500' : rate >= 70 ? 'bg-amber-500' : 'bg-red-500'
              return (
                <div key={t.sla_type} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-sm text-[var(--text-secondary)]">{TYPE_LABEL[t.sla_type] || t.sla_type}</div>
                  <div className="flex-1 h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                    <div className={`h-full ${bar} rounded-full`} style={{ width: `${Math.max(2, rate)}%` }} />
                  </div>
                  <div className="w-14 shrink-0 text-right text-sm font-semibold text-[var(--text-primary)]">{rate}%</div>
                  <div className="w-24 shrink-0 text-right text-xs text-[var(--text-muted)]">
                    {t.total} total{t.breached ? ` · ${t.breached} breached` : ''}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Attention strip — breached + at-risk */}
      {rows !== null && attention.length > 0 && (
        <div className="card border border-amber-800/40">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-400" /> Needs attention
            <span className="text-xs font-normal text-[var(--text-muted)]">({attention.length} breached / at risk)</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {attention.map((r) => {
              const meta = STATUS_META[r._status]
              return (
                <button key={r.id} onClick={() => openEdit(r)} className="text-left rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 hover:bg-[var(--input-bg)]/70 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{r.reference}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{TYPE_LABEL[r.sla_type] || r.sla_type}{r.asset_no ? ` · ${r.asset_no}` : ''}</p>
                  <p className={`text-xs mt-1 flex items-center gap-1 ${r._status === 'breached' ? 'text-red-300' : 'text-amber-300'}`}>
                    <Clock size={12} /> {fmtCountdown(r._remaining)}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search reference, asset, owner, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {['met', 'on_track', 'at_risk', 'breached', 'unknown'].map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          <select className="input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Priority">
            <option value="">All priorities</option>
            {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{TITLE_CASE(p)}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalRecords}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Reference', 'Type', 'Asset', 'Priority', 'Status', 'Due', 'Time remaining', 'Owner', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No SLA records yet — create your first tracked SLA.' : 'No records match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const sMeta = STATUS_META[r._status]
                  const pMeta = PRIORITY_META[r.priority] || PRIORITY_META.medium
                  const open = r._status !== 'met' && r._status !== 'unknown'
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.reference || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{TYPE_LABEL[r.sla_type] || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${pMeta.cls}`}>{pMeta.label}</span></td>
                      <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${sMeta.cls}`}>{sMeta.label}</span></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.due_at)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {r._status === 'met' ? (
                          <span className="text-green-400">{r._resolution == null ? 'Met' : `Met in ${fmtHours(r._resolution)}`}</span>
                        ) : open && r._remaining != null ? (
                          <span className={r._remaining < 0 ? 'text-red-400 font-medium' : r._status === 'at_risk' ? 'text-amber-400' : 'text-[var(--text-secondary)]'}>{fmtCountdown(r._remaining)}</span>
                        ) : <span className="text-[var(--text-muted)]">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.owner || '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit SLA record' : 'New SLA record'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Reference</label>
                  <input className="input w-full" placeholder="e.g. WO-2048 / TICKET-119" value={form.reference} maxLength={200} onChange={(e) => set('reference', e.target.value)} />
                </div>
                <div>
                  <label className="label">Type</label>
                  <select className="input w-full" value={form.sla_type} onChange={(e) => set('sla_type', e.target.value)}>
                    {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Asset (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select className="input w-full" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                    {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{TITLE_CASE(p)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{TITLE_CASE(s)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Target hours</label>
                  <input className="input w-full" type="number" step="0.5" min="0" placeholder="e.g. 24" value={form.target_hours} onChange={(e) => set('target_hours', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">The agreed resolution window. Drives the at-risk threshold.</p>
                </div>
                <div>
                  <label className="label">Owner (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh workshop" value={form.owner} maxLength={200} onChange={(e) => set('owner', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Started at (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.started_at} onChange={(e) => set('started_at', e.target.value)} />
                </div>
                <div>
                  <label className="label">Due at (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.due_at} onChange={(e) => set('due_at', e.target.value)} />
                </div>
                <div>
                  <label className="label">Resolved at (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.resolved_at} onChange={(e) => set('resolved_at', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Context, escalation history, root cause…" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create SLA'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this SLA record?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.reference || 'Record'} · {TYPE_LABEL[confirmDelete.sla_type] || confirmDelete.sla_type}. This can’t be undone.
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
