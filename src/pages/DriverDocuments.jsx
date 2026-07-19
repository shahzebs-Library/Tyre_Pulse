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
  FileCheck, AlertTriangle, Clock, CheckCircle2, User, Search, X, Filter,
  Plus, Pencil, Trash2, FileSpreadsheet, FileText, Loader2, Save,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDriverDocuments, createDriverDocument, updateDriverDocument, deleteDriverDocument,
} from '../lib/api/driverDocuments'
import {
  docStatus, daysToExpiry, summarizeDriverDocuments, DOC_STATUS_META,
  DOC_TYPES, DOC_TYPE_LABELS, EXPIRING_SOON_DAYS,
} from '../lib/driverDocuments'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const STATUS_STYLES = {
  valid: 'bg-green-900/40 text-green-300 border border-green-700/50',
  expiring: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  expired: 'bg-red-900/40 text-red-300 border border-red-700/50',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
const docTypeLabel = (t) => DOC_TYPE_LABELS[t] || (t ? String(t).replace(/_/g, ' ') : '—')

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
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const NOW = Date.now()

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listDriverDocuments({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load driver documents.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Derive live status for every row against the reference clock (pure lib).
  const enriched = useMemo(
    () => (rows || []).map((r) => {
      const status = docStatus(r, NOW)
      return { ...r, _status: status, _days: daysToExpiry(r, NOW) }
    }),
    [rows, NOW],
  )
  const summary = useMemo(() => summarizeDriverDocuments(rows || [], NOW), [rows, NOW])

  const typeOptions = useMemo(() => {
    const present = new Set((enriched || []).map((r) => r.doc_type).filter(Boolean))
    const ordered = DOC_TYPES.filter((t) => present.has(t))
    const extra = [...present].filter((t) => !DOC_TYPES.includes(t)).sort()
    return [...ordered, ...extra]
  }, [enriched])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter((r) => {
      if (statusFilter !== 'all' && r._status !== statusFilter) return false
      if (typeFilter !== 'all' && r.doc_type !== typeFilter) return false
      if (q) {
        const hay = `${r.driver_name || ''} ${r.doc_type || ''} ${r.doc_number || ''} ${r.issuer || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, statusFilter, typeFilter, search])

  const clearFilters = () => { setStatusFilter('all'); setTypeFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || search

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

  // ── Export ───────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['driver_name', 'doc_type', 'doc_number', 'issuer', 'issue_date', 'expiry_date', 'status']
  const EXPORT_HEADERS = ['Driver', 'Document type', 'Doc number', 'Issuer', 'Issue date', 'Expiry date', 'Status']
  const exportRows = filtered.map((r) => ({
    driver_name: r.driver_name || '',
    doc_type: docTypeLabel(r.doc_type),
    doc_number: r.doc_number || '', issuer: r.issuer || '',
    issue_date: r.issue_date || '', expiry_date: r.expiry_date || '',
    status: DOC_STATUS_META[r._status]?.label || r._status || '',
  }))

  const kpis = [
    { label: 'Total documents', value: summary.total, icon: FileCheck, tone: 'text-[var(--text-primary)]' },
    { label: 'Valid', value: summary.byStatus.valid, icon: CheckCircle2, tone: 'text-green-400' },
    { label: `Expiring (≤${EXPIRING_SOON_DAYS}d)`, value: summary.byStatus.expiring, icon: Clock, tone: 'text-amber-400' },
    { label: 'Expired', value: summary.byStatus.expired, icon: AlertTriangle, tone: 'text-red-400' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Documents"
        subtitle="Driver licences, medical certificates, permits & visas — with issue/expiry tracking and renewal alerts."
        icon={FileCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'driver_documents') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Driver Documents', 'driver_documents', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New document
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Driver documents aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V154_DRIVER_DOCUMENTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Something went wrong.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* Expiry banner */}
      {summary.expiringSoon.length > 0 && (
        <div className="card border border-amber-800/50 flex items-center gap-3 !py-3">
          <Clock size={16} className="text-amber-400 shrink-0" />
          <span className="text-sm text-amber-200">
            {summary.expiringSoon.length} document{summary.expiringSoon.length === 1 ? '' : 's'} expiring within {EXPIRING_SOON_DAYS} days or already expired — renewal required.
          </span>
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

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search driver, doc type, number, issuer…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="valid">Valid</option>
            <option value="expiring">Expiring soon</option>
            <option value="expired">Expired</option>
          </select>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Document type">
            <option value="all">All types</option>
            {typeOptions.map((t) => <option key={t} value={t}>{docTypeLabel(t)}</option>)}
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
                {['Driver', 'Type', 'Number', 'Issuer', 'Issue', 'Expiry', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />No documents match these filters.</td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const expClass = r._status === 'expired' ? 'text-red-400 font-medium' : r._status === 'expiring' ? 'text-amber-400 font-medium' : 'text-[var(--text-secondary)]'
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                        <span className="inline-flex items-center gap-2">
                          <User size={14} className="text-[var(--text-muted)] shrink-0" />
                          {r.driver_name || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] capitalize">{docTypeLabel(r.doc_type)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.doc_number || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.issuer || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.issue_date)}</td>
                      <td className={`px-4 py-2.5 ${expClass}`}>
                        {fmtDate(r.expiry_date)}
                        {r._days != null && r.expiry_date && (
                          <span className="ml-1 text-[11px] opacity-80">({r._days < 0 ? `${Math.abs(r._days)}d ago` : `${r._days}d`})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r._status]}`}>{DOC_STATUS_META[r._status]?.label}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
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

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit document' : 'New document'}</h2>
              <button onClick={() => !saving && setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Driver name<span className="text-red-400"> *</span></label>
                  <input className="input w-full" placeholder="e.g. J. Smith" value={form.driver_name} maxLength={200} onChange={(e) => setField('driver_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Document type</label>
                  <select className="input w-full" value={form.doc_type} onChange={(e) => setField('doc_type', e.target.value)}>
                    {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Document number</label>
                  <input className="input w-full" value={form.doc_number} maxLength={120} onChange={(e) => setField('doc_number', e.target.value)} />
                </div>
                <div>
                  <label className="label">Issuer</label>
                  <input className="input w-full" placeholder="Issuing authority" value={form.issuer} maxLength={200} onChange={(e) => setField('issuer', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                    <option value="valid">Valid</option>
                    <option value="expiring">Expiring soon</option>
                    <option value="expired">Expired</option>
                  </select>
                </div>
                <div>
                  <label className="label">Issue date</label>
                  <input type="date" className="input w-full" value={form.issue_date || ''} onChange={(e) => setField('issue_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Expiry date</label>
                  <input type="date" className="input w-full" value={form.expiry_date || ''} onChange={(e) => setField('expiry_date', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input w-full min-h-[90px] resize-y" value={form.notes} maxLength={4000} onChange={(e) => setField('notes', e.target.value)} />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create document'}
                </button>
                <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-[var(--text-primary)]">Delete document?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  This permanently removes the {docTypeLabel(confirmDelete.doc_type).toLowerCase()} document for <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.driver_name}</span>. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-5">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="btn-secondary">Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-500 border-red-600 inline-flex items-center gap-2 disabled:opacity-60">
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
