/**
 * DriverExpenses (route /driver-expenses) — log and manage driver expense claims
 * (driver, category, amount, expense date, asset, status). Ported from the
 * fleet_IQ Driver Expenses module and wired to Tyre Pulse's Supabase-backed
 * `driver_expenses` table via the service layer.
 *
 * Real data, KPI tiles, search + status/driver filters, create/edit modal,
 * status badges, delete confirmation, Excel/PDF export, and loading/empty/error
 * states throughout. Degrades to an "apply migration" prompt when the table is
 * absent.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Wallet, Receipt, DollarSign, Users, Plus, Pencil, Trash2, Search, X, Filter,
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, User,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  listExpenses, createExpense, updateExpense, deleteExpense,
  EXPENSE_STATUSES, EXPENSE_CATEGORIES,
} from '../lib/api/driverExpenses'
import { summarizeExpenses } from '../lib/driverExpenses'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const STATUS_META = {
  pending: { label: 'Pending', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
  approved: { label: 'Approved', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50' },
  rejected: { label: 'Rejected', cls: 'bg-red-900/40 text-red-300 border border-red-700/50' },
  reimbursed: { label: 'Reimbursed', cls: 'bg-green-900/40 text-green-300 border border-green-700/50' },
}

const EMPTY_FORM = {
  driver_name: '', category: 'fuel', amount: '', expense_date: '',
  asset_no: '', status: 'pending', description: '',
}

function isMissingRelation(err) {
  const code = String(err?.code || '')
  if (code === '42P01' || code === 'PGRST205') return true
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache')
}
function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

// ─── Create / Edit modal ──────────────────────────────────────────────────────
function ExpenseModal({ open, initial, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setForm(initial ? {
        driver_name: initial.driver_name || '',
        category: initial.category || 'fuel',
        amount: initial.amount ?? '',
        expense_date: initial.expense_date || '',
        asset_no: initial.asset_no || '',
        status: initial.status || 'pending',
        description: initial.description || '',
      } : EMPTY_FORM)
      setError('')
    }
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.driver_name.trim()) { setError('Please enter the driver name.'); return }
    setBusy(true)
    try {
      if (initial?.id) await updateExpense(initial.id, form)
      else await createExpense(form)
      onSaved?.()
    } catch (err) {
      setError(err?.message || 'Could not save the expense claim.')
    } finally {
      setBusy(false)
    }
  }, [form, initial, onSaved])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="card w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Receipt size={18} className="text-[var(--brand-bright)]" />
            {initial?.id ? 'Edit expense claim' : 'New expense claim'}
          </h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div>
          <label className="label">Driver name *</label>
          <input
            className="input w-full" placeholder="e.g. Ahmed Khan" maxLength={200}
            value={form.driver_name} onChange={(e) => set('driver_name', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Category</label>
            <select className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Amount</label>
            <input
              className="input w-full" type="number" min="0" step="0.01" placeholder="0.00"
              value={form.amount} onChange={(e) => set('amount', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Expense date</label>
            <input
              className="input w-full" type="date"
              value={form.expense_date || ''} onChange={(e) => set('expense_date', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">Asset / vehicle no.</label>
          <input
            className="input w-full" placeholder="e.g. TRK-4821" maxLength={120}
            value={form.asset_no} onChange={(e) => set('asset_no', e.target.value)}
          />
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            className="input w-full min-h-[90px] resize-y" maxLength={8000}
            placeholder="Optional notes about this claim…"
            value={form.description} onChange={(e) => set('description', e.target.value)}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {busy ? 'Saving…' : 'Save claim'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Delete confirmation ──────────────────────────────────────────────────────
function DeleteDialog({ row, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!row) return null
  const run = async () => {
    setBusy(true); setError('')
    try { await onConfirm() } catch (e) { setError(e?.message || 'Could not delete.'); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2 text-[var(--text-primary)]">
          <Trash2 size={18} className="text-red-400" />
          <h3 className="text-base font-semibold">Delete expense claim?</h3>
        </div>
        <p className="text-sm text-[var(--text-muted)]">
          This will permanently remove the claim for
          <span className="text-[var(--text-secondary)] font-medium"> {row.driver_name}</span>
          {row.amount != null ? ` (${row.amount})` : ''}. This cannot be undone.
        </p>
        {error && <p className="text-xs text-red-300">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button onClick={run} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 !bg-red-600 hover:!bg-red-500 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DriverExpenses() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [driverFilter, setDriverFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listExpenses({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load expense claims.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeExpenses(rows || []), [rows])

  const driverOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.driver_name).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (driverFilter && r.driver_name !== driverFilter) return false
      if (q) {
        const hay = `${r.driver_name || ''} ${r.category || ''} ${r.asset_no || ''} ${r.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, driverFilter, search])

  const fmtMoney = useCallback((v) => formatCurrencyCompact(v, activeCurrency), [activeCurrency])

  const kpis = [
    { label: 'Total claims', value: summary.total, icon: Receipt, tone: 'text-[var(--text-primary)]' },
    { label: 'Total amount', value: fmtMoney(summary.totalAmount), icon: DollarSign, tone: 'text-[var(--brand-bright)]' },
    { label: 'Pending', value: summary.byStatus.pending, sub: fmtMoney(summary.pendingAmount), icon: Wallet, tone: 'text-amber-400' },
    { label: 'Drivers', value: summary.drivers, icon: Users, tone: 'text-sky-400' },
  ]

  const EXPORT_COLS = ['driver_name', 'category', 'amount', 'expense_date', 'asset_no', 'status', 'description']
  const EXPORT_HEADERS = ['Driver', 'Category', 'Amount', 'Expense date', 'Asset', 'Status', 'Description']
  const exportRows = filtered.map((r) => ({
    driver_name: r.driver_name || '', category: cap(r.category) || '', amount: r.amount ?? '',
    expense_date: r.expense_date || '', asset_no: r.asset_no || '',
    status: STATUS_META[r.status]?.label || r.status || '', description: r.description || '',
  }))

  const clearFilters = () => { setStatusFilter('all'); setDriverFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || driverFilter || search

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (row) => { setEditing(row); setModalOpen(true) }
  const onSaved = () => { setModalOpen(false); setEditing(null); load() }
  const confirmDelete = async () => { await deleteExpense(deleting.id); setDeleting(null); load() }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Expenses"
        subtitle="Log, review and reimburse driver expense claims across the fleet — with status tracking and export."
        icon={Wallet}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'driver_expenses', 'Expenses', { currency: activeCurrency })}
              className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}
            >
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button
              onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Driver Expenses', 'driver_expenses', 'landscape', '', { currency: activeCurrency })}
              className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}
            >
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={15} /> New claim
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Driver expenses aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V152_DRIVER_EXPENSES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && !missing && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load expense claims.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
              {k.sub && rows !== null && <p className="text-xs text-[var(--text-muted)] mt-1">{k.sub} pending</p>}
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search driver, category, asset, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} aria-label="Driver">
            <option value="">All drivers</option>
            {driverOptions.map((d) => <option key={d} value={d}>{d}</option>)}
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
                {['Driver', 'Category', 'Amount', 'Date', 'Asset', 'Status', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    <Filter size={22} className="mx-auto mb-2 opacity-60" />
                    {summary.total === 0 ? 'No expense claims yet. Add the first one.' : 'No claims match these filters.'}
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const st = STATUS_META[r.status] || STATUS_META.pending
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">
                        <span className="inline-flex items-center gap-2"><User size={13} className="text-[var(--text-muted)]" />{r.driver_name || '—'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{cap(r.category) || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] font-medium">{r.amount == null || r.amount === '' ? '—' : fmtMoney(r.amount)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.expense_date)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setDeleting(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Delete"><Trash2 size={14} /></button>
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

      <ExpenseModal open={modalOpen} initial={editing} onClose={() => { setModalOpen(false); setEditing(null) }} onSaved={onSaved} />
      <DeleteDialog row={deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />
    </div>
  )
}
