/**
 * ProofOfDelivery (route /proof-of-delivery) — Proof of Delivery (POD). Captures
 * a confirmed delivery event per job: which asset ran it, the customer, delivery
 * address, who received it, and captured signature/photo evidence. Delivery
 * reliability (delivery rate, failed/returned rates by driver) is a core
 * operational KPI, so every record is org-isolated and country-scoped.
 *
 * Runs on the new `pod_records` table (V179). Real data, KPI tiles, status
 * breakdown strip, create/edit modal, filters, search, delete confirm,
 * Excel/PDF export, and loading/empty/error states throughout. The KPI summary,
 * status counts, and per-driver roll-ups live in the pure
 * `src/lib/podRecords.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  PackageCheck, Package, Truck, CheckCircle2, XCircle, Clock, Percent,
  Users, AlertTriangle, Search, X, Filter, FileSpreadsheet, FileText,
  Plus, Pencil, Trash2, MapPin, PenLine, Image as ImageIcon,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listPodRecords, createPodRecord, updatePodRecord, deletePodRecord,
} from '../lib/api/podRecords'
import { summarisePods, byStatus, byDriver, POD_STATUSES } from '../lib/podRecords'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  pod_no: '', asset_no: '', driver_name: '', customer_name: '', delivery_address: '',
  order_ref: '', delivered_at: '', received_by: '', signature_url: '', photo_url: '',
  items_count: '', status: 'delivered', failure_reason: '', notes: '',
}

const STATUS_META = {
  pending:   { label: 'Pending',   tone: 'text-amber-400',   badge: 'bg-amber-900/30 text-amber-300 border-amber-800/50',   icon: Clock },
  delivered: { label: 'Delivered', tone: 'text-green-400',   badge: 'bg-green-900/30 text-green-300 border-green-800/50',   icon: CheckCircle2 },
  partial:   { label: 'Partial',   tone: 'text-sky-400',     badge: 'bg-sky-900/30 text-sky-300 border-sky-800/50',         icon: Package },
  failed:    { label: 'Failed',    tone: 'text-red-400',     badge: 'bg-red-900/30 text-red-300 border-red-800/50',         icon: XCircle },
  returned:  { label: 'Returned',  tone: 'text-violet-400',  badge: 'bg-violet-900/30 text-violet-300 border-violet-800/50', icon: Truck },
}

const fmtInt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString())

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function fmtDateInput(v) {
  // timestamptz → value for <input type="datetime-local"> (local, minute precision)
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status]
  if (!meta) return <span className="text-[var(--text-muted)]">—</span>
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.badge}`}>
      <Icon size={12} /> {meta.label}
    </span>
  )
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function ProofOfDelivery() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
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
      const data = await listPodRecords({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load proof of delivery records.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarisePods(rows || []), [rows])
  const statusCounts = useMemo(() => byStatus(rows || []), [rows])
  const drivers = useMemo(() => byDriver(rows || []), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter && String(r.status || '').toLowerCase() !== statusFilter) return false
      if (q) {
        const hay = `${r.pod_no || ''} ${r.asset_no || ''} ${r.driver_name || ''} ${r.customer_name || ''} ${r.delivery_address || ''} ${r.order_ref || ''} ${r.received_by || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total PODs', value: summary.totalPods, icon: PackageCheck, tone: 'text-[var(--text-primary)]' },
    { label: 'Delivered', value: summary.deliveredCount, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Failed', value: summary.failedCount, icon: XCircle, tone: 'text-red-400' },
    { label: 'Delivery rate', value: `${summary.deliveryRate}%`, icon: Percent, tone: 'text-sky-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['pod_no', 'asset_no', 'driver_name', 'customer_name', 'delivery_address', 'order_ref', 'delivered_at', 'received_by', 'items_count', 'status', 'failure_reason']
  const EXPORT_HEADERS = ['POD No', 'Asset', 'Driver', 'Customer', 'Address', 'Order Ref', 'Delivered at', 'Received by', 'Items', 'Status', 'Failure reason']
  const exportRows = filtered.map((r) => ({
    pod_no: r.pod_no || '', asset_no: r.asset_no || '', driver_name: r.driver_name || '',
    customer_name: r.customer_name || '', delivery_address: r.delivery_address || '',
    order_ref: r.order_ref || '', delivered_at: r.delivered_at || '', received_by: r.received_by || '',
    items_count: r.items_count ?? '', status: r.status || '', failure_reason: r.failure_reason || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      pod_no: r.pod_no || '', asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      customer_name: r.customer_name || '', delivery_address: r.delivery_address || '',
      order_ref: r.order_ref || '', delivered_at: fmtDateInput(r.delivered_at),
      received_by: r.received_by || '', signature_url: r.signature_url || '',
      photo_url: r.photo_url || '', items_count: r.items_count ?? '',
      status: r.status || 'delivered', failure_reason: r.failure_reason || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.customer_name.trim()) { setFormError('A customer name is required.'); return }
    if (form.items_count !== '' && form.items_count != null && Number(form.items_count) < 0) {
      setFormError('Items count cannot be negative.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updatePodRecord(editing.id, payload)
      else await createPodRecord(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the POD record.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deletePodRecord(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the POD record.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter(''); setSearch('') }
  const hasFilters = statusFilter || search
  const showFailureReason = ['failed', 'returned', 'partial'].includes(form.status)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proof of Delivery"
        subtitle="Capture confirmed delivery events with signature and photo evidence — the operational record behind delivery-reliability KPIs and dispute resolution."
        icon={PackageCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'proof_of_delivery')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Proof of Delivery', 'proof_of_delivery', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Record POD
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Proof of Delivery isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V179_POD_RECORDS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load proof of delivery records.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
          <Package size={15} /> Status breakdown
        </h3>
        {rows === null ? (
          <div className="h-12 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {POD_STATUSES.map((s) => {
              const meta = STATUS_META[s]
              const Icon = meta.icon
              const active = statusFilter === s
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(active ? '' : s)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${active ? 'border-[var(--accent)] bg-[var(--input-bg)]' : 'border-[var(--input-border)] bg-[var(--input-bg)]/40 hover:bg-[var(--input-bg)]'}`}
                >
                  <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1"><Icon size={12} className={meta.tone} /> {meta.label}</p>
                  <p className={`text-lg font-bold ${meta.tone}`}>{statusCounts[s] || 0}</p>
                </button>
              )
            })}
            <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
              <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1"><Users size={12} className="text-sky-400" /> Customers</p>
              <p className="text-lg font-bold text-sky-400">{summary.distinctCustomers}</p>
            </div>
          </div>
        )}
      </div>

      {/* Top drivers */}
      {drivers.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Truck size={15} /> Deliveries by driver
          </h3>
          <div className="flex flex-wrap gap-2">
            {drivers.slice(0, 12).map((d) => (
              <div key={d.driver_name} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                <p className="text-xs text-[var(--text-muted)]">{d.driver_name}</p>
                <p className="text-sm font-semibold text-green-400">
                  {d.deliveries} delivered
                  {d.failed > 0 && <span className="text-red-400 font-normal"> · {d.failed} failed</span>}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search POD, asset, driver, customer, address…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {POD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalPods}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['POD / Order', 'Customer', 'Asset / Driver', 'Delivered', 'Status', 'Evidence', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No POD records yet — record your first delivery.' : 'No records match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-[var(--text-primary)]">{r.pod_no || '—'}</p>
                      {r.order_ref && <p className="text-[11px] text-[var(--text-muted)]">Order {r.order_ref}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-[var(--text-primary)]">{r.customer_name || '—'}</p>
                      {r.delivery_address && <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1 max-w-[220px] truncate"><MapPin size={11} className="shrink-0" /> {r.delivery_address}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      <p>{r.asset_no || '—'}</p>
                      {r.driver_name && <p className="text-[11px] text-[var(--text-muted)]">{r.driver_name}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                      <p>{fmtDateTime(r.delivered_at)}</p>
                      {r.received_by && <p className="text-[11px] text-[var(--text-muted)]">by {r.received_by}</p>}
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {r.signature_url ? (
                          <a href={r.signature_url} target="_blank" rel="noopener noreferrer" className="text-[var(--text-muted)] hover:text-sky-400" title="Signature" aria-label="View signature"><PenLine size={15} /></a>
                        ) : null}
                        {r.photo_url ? (
                          <a href={r.photo_url} target="_blank" rel="noopener noreferrer" className="text-[var(--text-muted)] hover:text-sky-400" title="Photo" aria-label="View photo"><ImageIcon size={15} /></a>
                        ) : null}
                        {!r.signature_url && !r.photo_url && <span className="text-[11px] text-[var(--text-muted)]">—</span>}
                        {r.items_count != null && <span className="text-[11px] text-[var(--text-muted)]">· {fmtInt(r.items_count)} items</span>}
                      </div>
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
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit POD record' : 'Record proof of delivery'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Customer name</label>
                  <input className="input w-full" placeholder="e.g. Al Rajhi Logistics" value={form.customer_name} maxLength={240} onChange={(e) => set('customer_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {POD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">POD number (optional)</label>
                  <input className="input w-full" placeholder="e.g. POD-10432" value={form.pod_no} maxLength={120} onChange={(e) => set('pod_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Order ref (optional)</label>
                  <input className="input w-full" placeholder="e.g. SO-88213" value={form.order_ref} maxLength={120} onChange={(e) => set('order_ref', e.target.value)} />
                </div>
                <div>
                  <label className="label">Items count (optional)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="12" value={form.items_count} onChange={(e) => set('items_count', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Driver name (optional)</label>
                  <input className="input w-full" placeholder="e.g. Mohammed A." value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Delivery address (optional)</label>
                <input className="input w-full" placeholder="e.g. Warehouse 4, Industrial City 2, Riyadh" value={form.delivery_address} maxLength={2000} onChange={(e) => set('delivery_address', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Delivered at</label>
                  <input className="input w-full" type="datetime-local" value={form.delivered_at} onChange={(e) => set('delivered_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
                <div>
                  <label className="label">Received by (optional)</label>
                  <input className="input w-full" placeholder="Name of receiver" value={form.received_by} maxLength={200} onChange={(e) => set('received_by', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Signature URL (optional)</label>
                  <input className="input w-full" type="url" placeholder="https://…" value={form.signature_url} maxLength={2000} onChange={(e) => set('signature_url', e.target.value)} />
                </div>
                <div>
                  <label className="label">Photo URL (optional)</label>
                  <input className="input w-full" type="url" placeholder="https://…" value={form.photo_url} maxLength={2000} onChange={(e) => set('photo_url', e.target.value)} />
                </div>
              </div>
              {showFailureReason && (
                <div>
                  <label className="label">Failure / exception reason</label>
                  <input className="input w-full" placeholder="e.g. Customer absent, partial acceptance, damaged goods" value={form.failure_reason} maxLength={2000} onChange={(e) => set('failure_reason', e.target.value)} />
                </div>
              )}
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Any delivery notes or context" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Record POD'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this POD record?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.pod_no || confirmDelete.customer_name || 'Record'} · {fmtDateTime(confirmDelete.delivered_at)}. This can’t be undone.
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
