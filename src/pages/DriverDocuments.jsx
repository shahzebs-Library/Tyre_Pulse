/**
 * DriverDocuments (route /driver-documents) — tracks per-driver documents
 * (licence, medical certificate, permit, visa …) with issue + expiry dates and
 * renewal alerts. Full CRUD backed by the `driver_documents` table (V154),
 * org-isolated and country-scoped. Real data, KPI tiles, search + filters,
 * create/edit modal, delete confirmation, Excel/PDF export, and loading /
 * empty / error states.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  FileCheck, AlertTriangle, Clock, CheckCircle2, User, Search, X,
  Plus, Pencil, Trash2, FileSpreadsheet, FileText, Loader2, Save, RotateCcw, Users, ShieldCheck,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDriverDocuments, createDriverDocument, updateDriverDocument, deleteDriverDocument,
} from '../lib/api/driverDocuments'
import {
  enrichDocuments, filterDocuments, typeOptions as buildTypeOptions, driverOptions as buildDriverOptions,
  documentKpis, typeBreakdown, documentExport, docTypeLabel, expiryPhrase,
  DOC_STATUS_META, DOC_TYPES, DOC_TYPE_LABELS, EXPIRING_SOON_DAYS, URGENT_DAYS,
} from '../lib/driverDocumentsAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const STATUS_STYLES = {
  valid: 'bg-green-900/40 text-green-300 border border-green-700/50',
  expiring: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  expired: 'bg-red-900/40 text-red-300 border border-red-700/50',
}
const STATUS_ICON = { valid: CheckCircle2, expiring: Clock, expired: AlertTriangle }

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

const EMPTY_FORM = {
  driver_name: '', doc_type: 'license', doc_number: '', issuer: '',
  issue_date: '', expiry_date: '', status: 'valid', notes: '',
}

export default function DriverDocuments() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [driverFilter, setDriverFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [loadError, setLoadError] = useState('')
  // Reference clock captured per load so every derived band is stable
  // between renders (a per-render Date.now() recomputed every memo).
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setLoadError(''); setMissing(false)
    try {
      const data = await listDriverDocuments({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setNow(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      // A failed read is NOT "no documents": keep rows null so KPIs read N/A.
      else { setLoadError(toUserMessage(err, 'Could not load driver documents.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const enriched = useMemo(() => enrichDocuments(rows || [], now), [rows, now])
  const kpi = useMemo(() => documentKpis(rows || [], now), [rows, now])
  const breakdown = useMemo(() => typeBreakdown(enriched), [enriched])
  const typeOptions = useMemo(() => buildTypeOptions(enriched), [enriched])
  const driverOptions = useMemo(() => buildDriverOptions(enriched), [enriched])
  const filtered = useMemo(
    () => filterDocuments(enriched, { status: statusFilter, type: typeFilter, driver: driverFilter, search }),
    [enriched, statusFilter, typeFilter, driverFilter, search],
  )

  const clearFilters = () => { setStatusFilter('all'); setTypeFilter('all'); setDriverFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || driverFilter !== 'all' || !!search

  // ── CRUD handlers ────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      driver_name: r.driver_name || '',
      doc_type: r.doc_type || 'license',
      doc_number: r.doc_number || '',
      issuer: r.issuer || '',
      issue_date: r.issue_date || '',
      expiry_date: r.expiry_date || '',
      status: r.status || 'valid',
      notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.driver_name.trim()) { setFormError('Driver name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        issue_date: form.issue_date || null,
        expiry_date: form.expiry_date || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) {
        const updated = await updateDriverDocument(editing.id, payload)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await createDriverDocument(payload)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the document.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteDriverDocument(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the document.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  // ── Export (the full filtered set, never just the visible page) ──────────
  const doExport = async (format) => {
    const shaped = documentExport(filtered)
    const file = reportFileName('Driver Documents', activeCountry !== 'All' ? activeCountry : '')
    try {
      if (format === 'pdf') {
        await exportToPdf(shaped.rows, shaped.keys.map((k, i) => ({ key: k, header: shaped.headers[i] })), 'Driver Documents', file, 'landscape')
      } else {
        await exportToExcel(shaped.rows, shaped.keys, shaped.headers, file)
      }
    } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const na = (v) => (rows === null || v == null ? 'N/A' : v)
  const kpis = [
    { label: 'Total documents', value: na(kpi.total), icon: FileCheck, tone: 'text-[var(--text-primary)]', filter: 'all' },
    { label: 'Valid', value: na(kpi.valid), icon: CheckCircle2, tone: 'text-green-400', filter: 'valid' },
    { label: `Expiring in ${EXPIRING_SOON_DAYS} days`, value: na(kpi.expiring), icon: Clock, tone: 'text-amber-400', filter: 'expiring', sub: rows === null ? null : `${kpi.urgent} within ${URGENT_DAYS} days` },
    { label: 'Expired', value: na(kpi.expired), icon: AlertTriangle, tone: 'text-red-400', filter: 'expired' },
    { label: 'Drivers covered', value: na(kpi.drivers), icon: Users, tone: 'text-[var(--text-primary)]', sub: rows === null ? null : `${kpi.driversWithExpired} with an expired document` },
    { label: 'Driver compliance', value: rows === null || kpi.compliancePct == null ? 'N/A' : `${kpi.compliancePct}%`, icon: ShieldCheck, tone: 'text-sky-400', sub: 'Drivers with no expired document' },
  ]

  const columns = [
    {
      id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || '', size: 200,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2 font-medium text-[var(--text-primary)]">
          <User size={14} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
          {row.original.driver_name || 'N/A'}
        </span>
      ),
    },
    { id: 'type', header: 'Type', accessorFn: (r) => docTypeLabel(r.doc_type), size: 120 },
    {
      id: 'number', header: 'Number', accessorFn: (r) => r.doc_number || '', size: 140,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-secondary)]">{row.original.doc_number || 'N/A'}</span>,
    },
    { id: 'issuer', header: 'Issuer', accessorFn: (r) => r.issuer || 'N/A', size: 150 },
    { id: 'issue', header: 'Issue', accessorFn: (r) => r.issue_date || '', size: 110, cell: ({ row }) => fmtDate(row.original.issue_date) },
    {
      id: 'expiry', header: 'Expiry', accessorFn: (r) => (r._days == null ? Number.POSITIVE_INFINITY : r._days), size: 170,
      cell: ({ row }) => {
        const r = row.original
        const cls = r._status === 'expired' ? 'text-red-400 font-medium' : r._status === 'expiring' ? 'text-amber-400 font-medium' : 'text-[var(--text-secondary)]'
        return (
          <span className={cls}>
            {fmtDate(r.expiry_date)}
            <span className="block text-[11px] opacity-80">{expiryPhrase(r._days)}</span>
          </span>
        )
      },
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => DOC_STATUS_META[r._status]?.label || '', size: 130,
      cell: ({ row }) => {
        const st = row.original._status
        const Icon = STATUS_ICON[st] || CheckCircle2
        return (
          <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${STATUS_STYLES[st]}`}>
            <Icon size={11} aria-hidden="true" />{DOC_STATUS_META[st]?.label}
          </span>
        )
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEdit(row.original)} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit document for ${row.original.driver_name || 'driver'}`}><Pencil size={15} /></button>
          <button onClick={() => setConfirmDelete(row.original)} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete document for ${row.original.driver_name || 'driver'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Documents"
        subtitle="Driver licences, medical certificates, permits & visas, with issue/expiry tracking and renewal alerts."
        icon={FileCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <Plus size={14} /> New document
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Driver documents are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V154_DRIVER_DOCUMENTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {loadError && (
        <div role="alert" className="card border border-red-800/50 flex flex-wrap items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-red-300 font-medium">Driver documents could not be loaded.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{loadError} The figures below are not available until the register loads.</p>
          </div>
          <button onClick={load} disabled={refreshing} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RotateCcw size={14} /> Retry</button>
        </div>
      )}

      {error && (
        <div role="alert" className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1"><p className="text-red-300 font-medium">That action did not complete.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button onClick={() => setError('')} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)]" aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      {/* Expiry banner */}
      {rows !== null && kpi.renewalQueue > 0 && (
        <div className="card border border-amber-800/50 flex flex-wrap items-center gap-3 !py-3">
          <Clock size={16} className="text-amber-400 shrink-0" aria-hidden="true" />
          <span className="text-sm text-[var(--text-secondary)] flex-1 min-w-[200px]">
            {kpi.renewalQueue} document{kpi.renewalQueue === 1 ? '' : 's'} expiring within {EXPIRING_SOON_DAYS} days or already expired. Renewal required.
            {kpi.nextExpiry && <> Next: {kpi.nextExpiry.driver}, {kpi.nextExpiry.type}, {expiryPhrase(kpi.nextExpiry.days)}.</>}
          </span>
          <button onClick={() => setStatusFilter('expiring')} className="btn-secondary text-xs min-h-[44px]">Show renewals</button>
        </div>
      )}

      {/* KPI tiles (status tiles double as filters) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          const active = k.filter && statusFilter === k.filter && k.filter !== 'all'
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>
              {k.sub && <p className="text-[11px] text-[var(--text-muted)] mt-1">{k.sub}</p>}
            </>
          )
          return k.filter ? (
            <button key={k.label} type="button" onClick={() => setStatusFilter(k.filter)} aria-pressed={active}
              className={`card text-left min-h-[44px] transition-colors hover:border-[var(--accent)] ${active ? 'ring-2 ring-[var(--accent)]' : ''}`}>
              {body}
            </button>
          ) : <div key={k.label} className="card">{body}</div>
        })}
      </div>

      {/* Type breakdown */}
      {rows !== null && breakdown.length > 0 && (
        <div className="card">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">Documents by type</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {breakdown.map((b) => {
              const pct = kpi.total ? Math.round((b.total / kpi.total) * 100) : 0
              return (
                <div key={b.type}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-secondary)] capitalize">{b.type}</span>
                    <span className="text-[var(--text-muted)] tabular-nums">{b.total} ({b.expired} expired, {b.expiring} expiring)</span>
                  </div>
                  <div className="h-2 mt-1 rounded bg-[var(--input-bg)] overflow-hidden" role="presentation">
                    <div className="h-full rounded bg-sky-500/70" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full min-h-[44px]" aria-label="Search documents" placeholder="Search driver, doc type, number, issuer" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="valid">Valid</option>
            <option value="expiring">Expiring soon</option>
            <option value="expired">Expired</option>
          </select>
          <select className="input min-h-[44px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Document type">
            <option value="all">All types</option>
            {typeOptions.map((t) => <option key={t} value={t}>{docTypeLabel(t)}</option>)}
          </select>
          <select className="input min-h-[44px] max-w-[220px]" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} aria-label="Driver">
            <option value="all">All drivers</option>
            {driverOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{rows === null ? 'N/A' : `${filtered.length} of ${kpi.total}`}</span>
        </div>
      </div>

      {/* Register */}
      {!loadError && (
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={rows === null}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={hasFilters ? 'No documents match these filters.' : missing ? 'Driver documents are not enabled on this database yet.' : 'No driver documents recorded yet. Add the first one with New document.'}
        />
      )}

      {/* Create / edit modal */}
      {modalOpen && (
        <Modal
          open
          onClose={() => { if (!saving) setModalOpen(false) }}
          closeOnBackdrop={!saving}
          title={editing ? 'Edit document' : 'New document'}
          size="lg"
        >
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dd-f1" className="label">Driver name<span className="text-red-400"> *</span></label>
                  <input id="dd-f1" className="input w-full" placeholder="e.g. J. Smith" value={form.driver_name} maxLength={200} onChange={(e) => setField('driver_name', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="dd-f2" className="label">Document type</label>
                  <select id="dd-f2" className="input w-full" value={form.doc_type} onChange={(e) => setField('doc_type', e.target.value)}>
                    {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="dd-f3" className="label">Document number</label>
                  <input id="dd-f3" className="input w-full" value={form.doc_number} maxLength={120} onChange={(e) => setField('doc_number', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="dd-f4" className="label">Issuer</label>
                  <input id="dd-f4" className="input w-full" placeholder="Issuing authority" value={form.issuer} maxLength={200} onChange={(e) => setField('issuer', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="dd-f5" className="label">Status</label>
                  <select id="dd-f5" className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                    <option value="valid">Valid</option>
                    <option value="expiring">Expiring soon</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="dd-f6" className="label">Issue date</label>
                  <input id="dd-f6" type="date" className="input w-full" value={form.issue_date || ''} onChange={(e) => setField('issue_date', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="dd-f7" className="label">Expiry date</label>
                  <input id="dd-f7" type="date" className="input w-full" value={form.expiry_date || ''} onChange={(e) => setField('expiry_date', e.target.value)} />
                </div>
              </div>
              <div>
                <label htmlFor="dd-f8" className="label">Notes</label>
                <textarea id="dd-f8" className="input w-full min-h-[90px] resize-y" value={form.notes} maxLength={4000} onChange={(e) => setField('notes', e.target.value)} />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving' : editing ? 'Save changes' : 'Create document'}
                </button>
                <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="btn-secondary">Cancel</button>
              </div>
            </form>
        </Modal>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <Modal
          open
          onClose={deleting ? undefined : () => setConfirmDelete(null)}
          closeOnBackdrop={!deleting}
          title="Delete document?"
          size="sm"
        >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-[var(--text-muted)]">
                  This permanently removes the {docTypeLabel(confirmDelete.doc_type).toLowerCase()} document for <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.driver_name}</span>. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-5">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="btn-secondary">Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-500 border-red-600 inline-flex items-center gap-2 disabled:opacity-60">
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting' : 'Delete'}
              </button>
            </div>
        </Modal>
      )}
    </div>
  )
}
