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
  Users, AlertTriangle, Search, X, FileSpreadsheet, FileText,
  Plus, Pencil, Trash2, MapPin, PenLine, Image as ImageIcon, ShieldCheck, CalendarClock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listPodRecords, createPodRecord, updatePodRecord, deletePodRecord,
} from '../lib/api/podRecords'
import { POD_STATUSES } from '../lib/podRecords'
import {
  summarizePodRegister, driverReliability, filterPods, evidenceOf, EVIDENCE_OPTIONS,
} from '../lib/proofOfDeliveryAnalytics'
import { safeHref } from '../lib/safeUrl'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { isMissingRelation, probeRelation } from '../lib/api/_client'

// listPodRecords reads at most this many rows; the page says so when it bites.
const READ_CAP = 500
const ICON_BTN = 'min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)]'


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

const fmtInt = (v) => (v == null || v === '' ? 'N/A' : Number(v).toLocaleString())

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
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
  if (!meta) return <span className="text-[var(--text-muted)]">N/A</span>
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.badge}`}>
      <Icon size={12} aria-hidden="true" /> {meta.label}
    </span>
  )
}

function Kpi({ label, value, hint, icon: Icon, tone }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{hint}</p>}
    </div>
  )
}


export default function ProofOfDelivery() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [driverFilter, setDriverFilter] = useState('')
  const [evidenceFilter, setEvidenceFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')
  const [actionError, setActionError] = useState('')

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
      const data = await listPodRecords({ country: activeCountry, limit: READ_CAP })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      setUpdatedAt(new Date())
      // The service turns a missing table into []; only a definite missing
      // relation raises the banner, never a permission or network failure.
      if (list.length === 0) {
        const probe = await probeRelation('pod_records')
        if (probe.checked && !probe.exists) setNotProvisioned(true)
      }
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load proof of delivery records.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const now = useMemo(() => Date.now(), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(() => summarizePodRegister(rows || [], now), [rows, now])
  const statusCounts = summary.counts
  const drivers = useMemo(() => driverReliability(rows || []), [rows])

  const filtered = useMemo(() => filterPods(rows || [], {
    status: statusFilter, driver: driverFilter, evidence: evidenceFilter,
    from: fromDate, to: toDate, search,
  }), [rows, statusFilter, driverFilter, evidenceFilter, fromDate, toDate, search])

  const loaded = rows !== null
  const rate = (v) => (!loaded || v == null ? 'N/A' : `${v}%`)
  const kpis = [
    { label: 'Total PODs', value: loaded ? summary.totalPods : 'N/A', icon: PackageCheck, tone: 'text-[var(--text-primary)]', hint: loaded ? `${summary.last30} in the last 30 days` : null },
    { label: 'Delivered', value: loaded ? summary.deliveredCount : 'N/A', icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Failed', value: loaded ? summary.failedCount : 'N/A', icon: XCircle, tone: 'text-red-400' },
    { label: 'Pending', value: loaded ? summary.pendingCount : 'N/A', icon: Clock, tone: 'text-amber-400' },
    { label: 'Delivery rate', value: rate(summary.deliveryRate), icon: Percent, tone: 'text-sky-400', hint: 'Of decided deliveries' },
    { label: 'Exception rate', value: rate(summary.exceptionRate), icon: AlertTriangle, tone: 'text-amber-300', hint: 'Failed, returned or partial' },
    { label: 'Evidence captured', value: rate(summary.evidenceRate), icon: ShieldCheck, tone: 'text-[var(--text-primary)]', hint: loaded ? `${summary.noEvidence} with no signature or photo` : null },
    { label: 'Customers', value: loaded ? summary.distinctCustomers : 'N/A', icon: Users, tone: 'text-[var(--text-primary)]' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['pod_no', 'asset_no', 'driver_name', 'customer_name', 'delivery_address', 'order_ref', 'delivered_at', 'received_by', 'items_count', 'status', 'evidence', 'failure_reason']
  const EXPORT_HEADERS = ['POD No', 'Asset', 'Driver', 'Customer', 'Address', 'Order Ref', 'Delivered at', 'Received by', 'Items', 'Status', 'Evidence', 'Failure reason']
  const exportRows = filtered.map((r) => ({
    pod_no: r.pod_no || '', asset_no: r.asset_no || '', driver_name: r.driver_name || '',
    customer_name: r.customer_name || '', delivery_address: r.delivery_address || '',
    order_ref: r.order_ref || '', delivered_at: r.delivered_at || '', received_by: r.received_by || '',
    items_count: r.items_count ?? 'N/A', status: STATUS_META[r.status]?.label || r.status || '',
    evidence: EVIDENCE_OPTIONS.find((o) => o.key === evidenceOf(r))?.label || '',
    failure_reason: r.failure_reason || '',
  }))
  const fileName = reportFileName('Proof of Delivery', activeCountry && activeCountry !== 'All' ? activeCountry : '')

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = useCallback((r) => {
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
  }, [])
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
      setFormError(toUserMessage(err, 'Could not save the POD record.'))
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
      setActionError(toUserMessage(err, 'Could not delete the POD record.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => {
    setStatusFilter(''); setDriverFilter(''); setEvidenceFilter(''); setFromDate(''); setToDate(''); setSearch('')
  }
  const hasFilters = statusFilter || driverFilter || evidenceFilter || fromDate || toDate || search

  const columns = useMemo(() => [
    {
      id: 'pod_no', header: 'POD / Order', accessorFn: (r) => r.pod_no || '',
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-[var(--text-primary)]">{row.original.pod_no || 'N/A'}</p>
          {row.original.order_ref && <p className="text-[11px] text-[var(--text-muted)]">Order {row.original.order_ref}</p>}
        </div>
      ),
    },
    {
      id: 'customer_name', header: 'Customer', accessorFn: (r) => r.customer_name || '',
      cell: ({ row }) => (
        <div>
          <p className="text-[var(--text-primary)]">{row.original.customer_name || 'N/A'}</p>
          {row.original.delivery_address && <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1 max-w-[220px] truncate" title={row.original.delivery_address}><MapPin size={11} className="shrink-0" aria-hidden="true" /> {row.original.delivery_address}</p>}
        </div>
      ),
    },
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => r.asset_no || '', cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'driver_name', header: 'Driver', accessorFn: (r) => r.driver_name || '', cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'delivered_at', header: 'Delivered', accessorFn: (r) => r.delivered_at || '',
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <p>{fmtDateTime(row.original.delivered_at)}</p>
          {row.original.received_by && <p className="text-[11px] text-[var(--text-muted)]">by {row.original.received_by}</p>}
        </div>
      ),
    },
    { id: 'items_count', header: 'Items', accessorFn: (r) => (r.items_count == null || r.items_count === '' ? null : Number(r.items_count)), meta: { align: 'right' }, cell: ({ getValue }) => fmtInt(getValue()) },
    { id: 'status', header: 'Status', accessorFn: (r) => STATUS_META[r.status]?.label || r.status || '', meta: { filterVariant: 'select' }, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'evidence', header: 'Evidence', accessorFn: (r) => EVIDENCE_OPTIONS.find((o) => o.key === evidenceOf(r))?.label || '',
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="flex items-center gap-1">
            {safeHref(r.signature_url) ? (
              <a href={safeHref(r.signature_url)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={`${ICON_BTN} text-[var(--text-muted)] hover:text-sky-400`} aria-label="View signature"><PenLine size={15} /></a>
            ) : r.signature_url ? (
              <span className="text-[var(--text-muted)] text-[11px]">Signature unavailable</span>
            ) : null}
            {safeHref(r.photo_url) ? (
              <a href={safeHref(r.photo_url)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={`${ICON_BTN} text-[var(--text-muted)] hover:text-sky-400`} aria-label="View photo"><ImageIcon size={15} /></a>
            ) : r.photo_url ? (
              <span className="text-[var(--text-muted)] text-[11px]">Photo unavailable</span>
            ) : null}
            {!r.signature_url && !r.photo_url && <span className="text-[11px] text-amber-300">None captured</span>}
          </div>
        )
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, enableHiding: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className={`${ICON_BTN} hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]`} aria-label={`Edit POD ${row.original.pod_no || row.original.customer_name || ''}`.trim()}><Pencil size={15} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400`} aria-label={`Delete POD ${row.original.pod_no || row.original.customer_name || ''}`.trim()}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])
  const showFailureReason = ['failed', 'returned', 'partial'].includes(form.status)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proof of Delivery"
        subtitle="Capture confirmed delivery events with signature and photo evidence: the operational record behind delivery-reliability KPIs and dispute resolution."
        icon={PackageCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileName)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button type="button" onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Proof of Delivery', fileName, 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} /> Record POD
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Proof of Delivery is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V179_POD_RECORDS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start justify-between gap-3" role="alert">
          <p className="text-sm text-red-300 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{actionError}</p>
          <button type="button" onClick={() => setActionError('')} aria-label="Dismiss message" className={`${ICON_BTN} text-[var(--text-muted)] hover:text-[var(--text-primary)]`}><X size={16} /></button>
        </div>
      )}

      {loaded && rows.length >= READ_CAP && (
        <p className="text-xs text-amber-300" role="status">
          Showing the {READ_CAP} most recent deliveries. Older records are not loaded, so the figures below cover these {READ_CAP} only.
        </p>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      {/* Status breakdown strip */}
      {loaded && (
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Package size={15} aria-hidden="true" /> Status breakdown
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {POD_STATUSES.map((s) => {
              const meta = STATUS_META[s]
              const Icon = meta.icon
              const active = statusFilter === s
              return (
                <button
                  type="button"
                  key={s}
                  onClick={() => setStatusFilter(active ? '' : s)}
                  aria-pressed={active}
                  className={`min-h-[44px] rounded-lg border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${active ? 'border-[var(--accent)] bg-[var(--input-bg)]' : 'border-[var(--input-border)] bg-[var(--input-bg)]/40 hover:bg-[var(--input-bg)]'}`}
                >
                  <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1"><Icon size={12} className={meta.tone} aria-hidden="true" /> {meta.label}</p>
                  <p className={`text-lg font-bold tabular-nums ${meta.tone}`}>{statusCounts[s] || 0}</p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Driver reliability */}
      {drivers.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Truck size={15} aria-hidden="true" /> Driver reliability
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {drivers.slice(0, 12).map((d) => (
              <button
                type="button"
                key={d.driver_name}
                onClick={() => setDriverFilter(driverFilter === d.driver_name ? '' : d.driver_name)}
                aria-pressed={driverFilter === d.driver_name}
                className={`min-h-[44px] text-left rounded-lg border px-3 py-2 focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${driverFilter === d.driver_name ? 'border-[var(--accent)] bg-[var(--input-bg)]' : 'border-[var(--input-border)] bg-[var(--input-bg)]/40 hover:bg-[var(--input-bg)]'}`}
              >
                <p className="text-xs text-[var(--text-muted)] truncate">{d.driver_name}</p>
                <p className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                  {d.successRate == null ? 'N/A' : `${d.successRate}%`} success
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">{d.deliveries} delivered, {d.failed} failed</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full min-h-[44px]" placeholder="Search POD, asset, driver, customer, address" aria-label="Search deliveries" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {POD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} aria-label="Driver">
            <option value="">All drivers</option>
            {drivers.map((d) => <option key={d.driver_name} value={d.driver_name}>{d.driver_name}</option>)}
          </select>
          <select className="input min-h-[44px]" value={evidenceFilter} onChange={(e) => setEvidenceFilter(e.target.value)} aria-label="Evidence">
            <option value="">Any evidence</option>
            {EVIDENCE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <label htmlFor="pod-from" className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1"><CalendarClock size={13} aria-hidden="true" /> From</label>
          <input id="pod-from" type="date" className="input min-h-[44px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <label htmlFor="pod-to" className="text-xs text-[var(--text-muted)]">to</label>
          <input id="pod-to" type="date" className="input min-h-[44px]" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {summary.totalPods}</span>
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={rows === null && !error}
        error={error || null}
        onRetry={load}
        enableGlobalFilter={false}
        exportFileName={fileName}
        emptyMessage={(rows || []).length === 0 && !notProvisioned ? 'No POD records yet. Record your first delivery.' : 'No records match these filters.'}
        onRowClick={(r) => openEdit(r)}
      />

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit POD record' : 'Record proof of delivery'}</h3>
              <button type="button" onClick={closeModal} aria-label="Close" className={`${ICON_BTN} text-[var(--text-muted)] hover:text-[var(--text-primary)]`}><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="pod-customer">Customer name</label>
                  <input id="pod-customer" className="input w-full" placeholder="e.g. Al Rajhi Logistics" value={form.customer_name} maxLength={240} onChange={(e) => set('customer_name', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="pod-status">Status</label>
                  <select id="pod-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {POD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label" htmlFor="pod-no">POD number (optional)</label>
                  <input id="pod-no" className="input w-full" placeholder="e.g. POD-10432" value={form.pod_no} maxLength={120} onChange={(e) => set('pod_no', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="pod-order">Order ref (optional)</label>
                  <input id="pod-order" className="input w-full" placeholder="e.g. SO-88213" value={form.order_ref} maxLength={120} onChange={(e) => set('order_ref', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="pod-items">Items count (optional)</label>
                  <input id="pod-items" className="input w-full" type="number" step="1" min="0" placeholder="12" value={form.items_count} onChange={(e) => set('items_count', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="pod-asset">Asset number (optional)</label>
                  <input id="pod-asset" className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="pod-driver">Driver name (optional)</label>
                  <input id="pod-driver" className="input w-full" placeholder="e.g. Mohammed A." value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="pod-address">Delivery address (optional)</label>
                <input id="pod-address" className="input w-full" placeholder="e.g. Warehouse 4, Industrial City 2, Riyadh" value={form.delivery_address} maxLength={2000} onChange={(e) => set('delivery_address', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="pod-delivered">Delivered at</label>
                  <input id="pod-delivered" className="input w-full" type="datetime-local" value={form.delivered_at} onChange={(e) => set('delivered_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
                <div>
                  <label className="label" htmlFor="pod-received">Received by (optional)</label>
                  <input id="pod-received" className="input w-full" placeholder="Name of receiver" value={form.received_by} maxLength={200} onChange={(e) => set('received_by', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="pod-sig">Signature URL (optional)</label>
                  <input id="pod-sig" className="input w-full" type="url" placeholder="https://" value={form.signature_url} maxLength={2000} onChange={(e) => set('signature_url', e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="pod-photo">Photo URL (optional)</label>
                  <input id="pod-photo" className="input w-full" type="url" placeholder="https://" value={form.photo_url} maxLength={2000} onChange={(e) => set('photo_url', e.target.value)} />
                </div>
              </div>
              {showFailureReason && (
                <div>
                  <label className="label" htmlFor="pod-failure">Failure / exception reason</label>
                  <input id="pod-failure" className="input w-full" placeholder="e.g. Customer absent, partial acceptance, damaged goods" value={form.failure_reason} maxLength={2000} onChange={(e) => set('failure_reason', e.target.value)} />
                </div>
              )}
              <div>
                <label className="label" htmlFor="pod-notes">Notes (optional)</label>
                <textarea id="pod-notes" className="input w-full min-h-[80px] resize-y" placeholder="Any delivery notes or context" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving' : editing ? 'Save changes' : 'Record POD'}
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
                  {confirmDelete.pod_no || confirmDelete.customer_name || 'Record'}, {fmtDateTime(confirmDelete.delivered_at)}. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
