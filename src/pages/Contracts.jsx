/**
 * Contracts (route /contracts) — Contract Manager. Manage supplier & service
 * contracts with lifecycle status and expiry tracking. Ported from tyre_saas'
 * ContractManagerPage and wired to Supabase via the contracts service + the
 * pure lifecycle helpers in lib/contracts.
 *
 * KPI tiles, a create/edit modal, a filterable/searchable table with status
 * badges and expiry highlighting, Excel/PDF export, and full loading / empty /
 * error / missing-migration states. Writes are Admin/Manager/Director only
 * (RLS-enforced); the UI surfaces failures rather than hiding them.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  FileText, Plus, Search, X, Filter, Trash2, Pencil, AlertTriangle,
  CheckCircle2, Clock, DollarSign, CalendarClock, Loader2, FileSpreadsheet,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listContracts, createContract, updateContract, deleteContract,
  CONTRACT_STATUSES, CONTRACT_TYPES,
} from '../lib/api/contracts'
import { contractStatus, summarizeContracts, daysUntilEnd } from '../lib/contracts'
import { formatCurrencyCompact } from '../lib/formatters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const STATUS_META = {
  active: { label: 'Active', cls: 'bg-green-900/40 text-green-300 border border-green-700/50', icon: CheckCircle2 },
  'expiring-soon': { label: 'Expiring soon', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50', icon: Clock },
  expired: { label: 'Expired', cls: 'bg-red-900/40 text-red-300 border border-red-700/50', icon: AlertTriangle },
  pending: { label: 'Pending', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50', icon: Clock },
  cancelled: { label: 'Cancelled', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]', icon: X },
  unknown: { label: 'Unknown', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]', icon: FileText },
}

const EMPTY_FORM = {
  title: '', vendor: '', contract_type: 'supply',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '', value: '', status: 'active', notes: '',
}

function fmtDate(v) {
  if (!v) return '—'
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '—'
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
function ContractModal({ open, initial, currency, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = Boolean(initial?.id)

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(initial
      ? {
          title: initial.title || '', vendor: initial.vendor || '',
          contract_type: initial.contract_type || 'supply',
          start_date: initial.start_date ? String(initial.start_date).slice(0, 10) : '',
          end_date: initial.end_date ? String(initial.end_date).slice(0, 10) : '',
          value: initial.value ?? '', status: initial.status || 'active',
          notes: initial.notes || '',
        }
      : EMPTY_FORM)
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.title.trim()) { setError('A contract title is required.'); return }
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      setError('End date cannot be before the start date.'); return
    }
    setBusy(true)
    try {
      if (editing) await updateContract(initial.id, form)
      else await createContract({ ...form, currency })
      onSaved?.()
    } catch (err) {
      setError(err?.message || 'Could not save the contract.')
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, currency, onSaved])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="card w-full max-w-2xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <FileText size={18} className="text-[var(--brand-bright)]" />
            {editing ? 'Edit contract' : 'New contract'}
          </h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Contract title *</label>
            <input className="input w-full" placeholder="e.g. Michelin annual supply agreement"
              value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Vendor / supplier</label>
              <input className="input w-full" placeholder="Supplier name"
                value={form.vendor} maxLength={200} onChange={(e) => set('vendor', e.target.value)} />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input w-full" value={form.contract_type} onChange={(e) => set('contract_type', e.target.value)}>
                {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Start date</label>
              <input type="date" className="input w-full" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
            </div>
            <div>
              <label className="label">End date</label>
              <input type="date" className="input w-full" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Value ({currency})</label>
              <input type="number" min="0" step="0.01" className="input w-full" placeholder="0"
                value={form.value} onChange={(e) => set('value', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full min-h-[90px] resize-y" placeholder="Terms, SLAs, renewal conditions…"
              value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create contract'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Contracts() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const { rows: data, missing: miss } = await listContracts({ country: activeCountry })
      setMissing(miss)
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Could not load contracts.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Enrich against a single reference clock so status is stable across the render.
  const now = Date.now()
  const enriched = useMemo(
    () => (rows || []).map((c) => ({
      ...c,
      _status: contractStatus(c, now),
      _days: daysUntilEnd(c, now),
    })),
    [rows, now],
  )
  const summary = useMemo(() => summarizeContracts(rows || [], now), [rows, now])

  const vendorOptions = useMemo(
    () => [...new Set(enriched.map((r) => r.vendor).filter(Boolean))].sort(),
    [enriched],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter((r) => {
      if (statusFilter !== 'all' && r._status !== statusFilter) return false
      if (vendorFilter && r.vendor !== vendorFilter) return false
      if (q) {
        const hay = `${r.title || ''} ${r.vendor || ''} ${r.contract_type || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, statusFilter, vendorFilter, search])

  const onDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this contract? This cannot be undone.')) return
    setDeletingId(id); setError('')
    try {
      await deleteContract(id)
      setRows((prev) => (prev || []).filter((r) => r.id !== id))
    } catch (err) {
      setError(err?.message || 'Could not delete the contract.')
    } finally {
      setDeletingId(null)
    }
  }, [])

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (row) => { setEditing(row); setModalOpen(true) }
  const onSaved = () => { setModalOpen(false); setEditing(null); load() }

  const clearFilters = () => { setStatusFilter('all'); setVendorFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || vendorFilter || search

  // Export -------------------------------------------------------------------
  const EXPORT_COLS = ['title', 'vendor', 'contract_type', 'start_date', 'end_date', 'value', 'currency', 'status', 'days_remaining']
  const EXPORT_HEADERS = ['Title', 'Vendor', 'Type', 'Start', 'End', 'Value', 'Currency', 'Status', 'Days left']
  const exportRows = filtered.map((r) => ({
    title: r.title || '', vendor: r.vendor || '', contract_type: r.contract_type || '',
    start_date: fmtDate(r.start_date), end_date: fmtDate(r.end_date),
    value: r.value ?? '', currency: r.currency || activeCurrency,
    status: STATUS_META[r._status]?.label || r._status,
    days_remaining: r._days ?? '',
  }))

  const kpis = [
    { label: 'Total contracts', value: summary.total, icon: FileText, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: summary.active, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Expiring ≤60d', value: summary.expiringSoonCount, icon: CalendarClock, tone: 'text-amber-400' },
    { label: 'Live value', value: formatCurrencyCompact(summary.totalValue, activeCurrency), icon: DollarSign, tone: 'text-[var(--brand-bright)]' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contract Manager"
        subtitle="Supplier & service contracts with lifecycle status and expiry tracking."
        icon={FileText}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'contracts')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS, 'Contracts', 'contracts', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New contract
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Something went wrong.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {missing ? (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Contracts aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V131_CONTRACTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Expiring-soon banner */}
          {summary.expiringSoon.length > 0 && (
            <div className="card border border-amber-800/50 flex items-start gap-3">
              <CalendarClock size={18} className="text-amber-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-amber-300 font-medium">
                  {summary.expiringSoon.length} contract{summary.expiringSoon.length !== 1 ? 's' : ''} expiring within 60 days
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {summary.expiringSoon.slice(0, 6).map((c) => (
                    <span key={c.id} className="text-xs bg-amber-900/40 text-amber-300 border border-amber-700/50 px-2 py-0.5 rounded-full">
                      {c.title} — {c.daysRemaining}d left
                    </span>
                  ))}
                </div>
              </div>
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
                <input className="input pl-9 w-full" placeholder="Search title, vendor, type, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="expiring-soon">Expiring soon</option>
                <option value="expired">Expired</option>
                <option value="pending">Pending</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select className="input" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} aria-label="Vendor">
                <option value="">All vendors</option>
                {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
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
                    {['Contract', 'Vendor', 'Type', 'Start', 'End', 'Value', 'Status', ''].map((h, i) => (
                      <th key={h || `act-${i}`} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows === null ? (
                    [0, 1, 2, 3, 4].map((i) => (
                      <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                      {summary.total === 0 ? (
                        <><FileText size={22} className="mx-auto mb-2 opacity-60" />No contracts yet. Create your first one.</>
                      ) : (
                        <><Filter size={22} className="mx-auto mb-2 opacity-60" />No contracts match these filters.</>
                      )}
                    </td></tr>
                  ) : (
                    filtered.map((r) => {
                      const meta = STATUS_META[r._status] || STATUS_META.unknown
                      const StatusIcon = meta.icon
                      const urgent = r._status === 'expiring-soon' || r._status === 'expired'
                      return (
                        <tr key={r.id} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 ${urgent ? 'bg-amber-900/5' : ''}`}>
                          <td className="px-4 py-2.5">
                            <p className="text-[var(--text-primary)] font-medium">{r.title}</p>
                            {r.notes && <p className="text-xs text-[var(--text-muted)] truncate max-w-[240px]">{r.notes}</p>}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.vendor || '—'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] capitalize">{r.contract_type || '—'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.start_date)}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={urgent ? 'text-amber-300 font-medium' : 'text-[var(--text-secondary)]'}>{fmtDate(r.end_date)}</span>
                            {r._days != null && r._days >= 0 && r._days <= 60 && (
                              <span className={`ml-1.5 text-xs ${r._days <= 7 ? 'text-red-400' : 'text-amber-400'}`}>({r._days}d)</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                            {r.value == null ? '—' : formatCurrencyCompact(r.value, r.currency || activeCurrency)}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${meta.cls}`}>
                              <StatusIcon size={11} /> {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1 justify-end">
                              <button type="button" onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--brand-bright)] hover:bg-[var(--input-bg)]" aria-label="Edit">
                                <Pencil size={14} />
                              </button>
                              <button type="button" onClick={() => onDelete(r.id)} disabled={deletingId === r.id} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--input-bg)] disabled:opacity-50" aria-label="Delete">
                                {deletingId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <ContractModal
        open={modalOpen}
        initial={editing}
        currency={activeCurrency}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSaved={onSaved}
      />
    </div>
  )
}
