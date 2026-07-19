/**
 * Customers (route /customers) — Customer Management registry.
 *
 * A per-organisation book of customer accounts (fleet operators, workshops,
 * partners) with contact details, classification and a status lifecycle. Full
 * CRUD with role-gated writes (RLS enforces Admin/Manager/Director), KPI tiles,
 * search + status/type filters, a create/edit modal, delete confirmation, and
 * Excel/PDF export. Country-scoped via the global Settings context.
 *
 * Loading / empty / error states throughout, including a first-run prompt to
 * apply MIGRATIONS_V158_CUSTOMERS.sql when the table is not yet present.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Building2, Users, User, Phone, Mail, Plus, Pencil, Trash2, Search, X,
  Filter, Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, CheckCircle2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listCustomers, createCustomer, updateCustomer, deleteCustomer,
  CUSTOMER_STATUSES,
} from '../lib/api/customers'
import { summarizeCustomers, isValidEmail } from '../lib/customers'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const STATUS_META = {
  active: { label: 'Active', cls: 'bg-green-900/40 text-green-300 border border-green-700/50' },
  inactive: { label: 'Inactive', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]' },
  prospect: { label: 'Prospect', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50' },
}
const EMPTY_FORM = {
  name: '', customer_type: '', contact_name: '', email: '', phone: '',
  address: '', site: '', status: 'active', notes: '',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
function CustomerModal({ open, initial, onClose, onSaved, country }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = !!initial?.id
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (open) {
      setForm(initial?.id ? { ...EMPTY_FORM, ...initial } : EMPTY_FORM)
      setError('')
    }
  }, [open, initial])

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.name.trim()) { setError('Please enter a customer name.'); return }
    if (form.email.trim() && !isValidEmail(form.email)) { setError('Please enter a valid email address.'); return }
    setBusy(true)
    try {
      if (editing) {
        const { id, ...patch } = form
        const row = await updateCustomer(initial.id, patch)
        onSaved?.(row, 'update')
      } else {
        const row = await createCustomer({ ...form, country: country !== 'All' ? country : null })
        onSaved?.(row, 'create')
      }
      onClose?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the customer. Please try again.'))
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, country, onSaved, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--card-bg)] border border-[var(--input-border)] rounded-xl shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--input-border)] sticky top-0 bg-[var(--card-bg)] z-10">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-[var(--brand-bright)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {editing ? 'Edit customer' : 'New customer'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">Customer name <span className="text-red-400">*</span></label>
            <input className="input w-full" placeholder="e.g. Gulf Logistics LLC" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Type</label>
              <input className="input w-full" placeholder="Fleet / Workshop / Partner" value={form.customer_type} maxLength={80} onChange={(e) => set('customer_type', e.target.value)} list="customer-type-options" />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Contact name</label>
              <input className="input w-full" placeholder="Primary contact" value={form.contact_name} maxLength={160} onChange={(e) => set('contact_name', e.target.value)} />
            </div>
            <div>
              <label className="label">Site / Branch</label>
              <input className="input w-full" placeholder="e.g. Dubai HQ" value={form.site} maxLength={160} onChange={(e) => set('site', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Email</label>
              <input type="email" className="input w-full" placeholder="ops@customer.com" value={form.email} maxLength={254} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input w-full" placeholder="+971 …" value={form.phone} maxLength={60} onChange={(e) => set('phone', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Address</label>
            <input className="input w-full" placeholder="Street, city, country" value={form.address} maxLength={500} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="Account notes, terms, context…" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--input-border)] sticky bottom-0 bg-[var(--card-bg)]">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create customer'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Delete confirmation ──────────────────────────────────────────────────────
function DeleteConfirm({ customer, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!customer) return null
  const run = async () => {
    setBusy(true); setError('')
    try { await deleteCustomer(customer.id); onConfirm?.(customer.id) }
    catch (err) { setError(toUserMessage(err, 'Could not delete this customer.')); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-md bg-[var(--card-bg)] border border-[var(--input-border)] rounded-xl shadow-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-900/30 border border-red-800/50 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Delete customer?</h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              <span className="font-medium text-[var(--text-secondary)]">{customer.name}</span> will be permanently removed. This cannot be undone.
            </p>
          </div>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm" disabled={busy}>Cancel</button>
          <button type="button" onClick={run} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Customers() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listCustomers({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load customers.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeCustomers(rows || []), [rows])
  const typeOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.customer_type).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (typeFilter && r.customer_type !== typeFilter) return false
      if (q) {
        const hay = `${r.name || ''} ${r.contact_name || ''} ${r.email || ''} ${r.phone || ''} ${r.site || ''} ${r.customer_type || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, typeFilter, search])

  const onSaved = useCallback((row, kind) => {
    if (!row) { load(); return }
    setRows((prev) => {
      const list = prev || []
      return kind === 'create' ? [row, ...list] : list.map((r) => (r.id === row.id ? { ...r, ...row } : r))
    })
    setUpdatedAt(new Date())
  }, [load])

  const onDeleted = useCallback((id) => {
    setRows((prev) => (prev || []).filter((r) => r.id !== id))
    setDeleting(null)
  }, [])

  const clearFilters = () => { setStatusFilter('all'); setTypeFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || typeFilter || search

  const EXPORT_COLS = ['name', 'customer_type', 'status', 'contact_name', 'email', 'phone', 'site', 'address']
  const EXPORT_HEADERS = ['Name', 'Type', 'Status', 'Contact', 'Email', 'Phone', 'Site', 'Address']
  const exportRows = filtered.map((r) => ({
    name: r.name || '', customer_type: r.customer_type || '', status: STATUS_META[r.status]?.label || r.status || '',
    contact_name: r.contact_name || '', email: r.email || '', phone: r.phone || '', site: r.site || '', address: r.address || '',
  }))

  const kpis = [
    { label: 'Total customers', value: summary.total, icon: Building2, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: summary.active, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Prospects', value: summary.prospect, icon: Users, tone: 'text-sky-400' },
    { label: 'Types', value: summary.types, icon: Filter, tone: 'text-violet-400' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle="Your customer registry — accounts, contacts and classification, country-scoped."
        icon={Building2}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'customers') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Customer Registry', 'customers', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={() => { setEditing(null); setModalOpen(true) }} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={missing}>
              <Plus size={14} /> New customer
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Customer Management isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V158_CUSTOMERS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && !missing && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load customers.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
            <input className="input pl-9 w-full" placeholder="Search name, contact, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
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
                {['Customer', 'Type', 'Contact', 'Site', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {missing ? (
                    <><Building2 size={22} className="mx-auto mb-2 opacity-60" />No customers yet — apply the migration to get started.</>
                  ) : hasFilters ? (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No customers match these filters.</>
                  ) : (
                    <div className="space-y-3">
                      <Users size={26} className="mx-auto opacity-60" />
                      <p className="text-[var(--text-primary)] font-medium">No customers yet.</p>
                      <button onClick={() => { setEditing(null); setModalOpen(true) }} className="btn-primary text-sm inline-flex items-center gap-1.5">
                        <Plus size={14} /> Add your first customer
                      </button>
                    </div>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const status = STATUS_META[r.status] || STATUS_META.inactive
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-[var(--text-primary)]">{r.name}</div>
                        {r.address && <div className="text-xs text-[var(--text-muted)] truncate max-w-[240px]">{r.address}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.customer_type || '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="space-y-0.5">
                          {r.contact_name && <div className="text-[var(--text-secondary)] flex items-center gap-1.5"><User size={12} className="text-[var(--text-muted)]" />{r.contact_name}</div>}
                          {r.email && <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><Mail size={11} />{r.email}</div>}
                          {r.phone && <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><Phone size={11} />{r.phone}</div>}
                          {!r.contact_name && !r.email && !r.phone && <span className="text-[var(--text-muted)]">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${status.cls}`}>{status.label}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setEditing(r); setModalOpen(true) }} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setDeleting(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
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

      <datalist id="customer-type-options">
        {typeOptions.map((t) => <option key={t} value={t} />)}
      </datalist>

      <CustomerModal
        open={modalOpen}
        initial={editing}
        country={activeCountry}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSaved={onSaved}
      />
      <DeleteConfirm customer={deleting} onCancel={() => setDeleting(null)} onConfirm={onDeleted} />
    </div>
  )
}
