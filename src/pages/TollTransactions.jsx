/**
 * TollTransactions (route /toll-transactions) — Toll Transactions. Captures
 * individual toll-road charges per asset, whether paid by electronic tag, cash,
 * card, or on account. Toll spend is a material, recurring, per-trip operating
 * cost, so every charge is org-isolated and country-scoped and can be
 * reconciled or disputed.
 *
 * Runs on the new `toll_transactions` table (V169). Real data, KPI tiles,
 * create/edit modal, filters, search, delete confirm, Excel/PDF export, and
 * loading/empty/error states throughout. Finance roll-ups and the KPI summary
 * live in the pure `src/lib/tollTransactions.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Receipt, Coins, Wallet, AlertTriangle, MapPin, CreditCard, Truck, Search, X,
  Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTollTransactions, createTollTransaction, updateTollTransaction, deleteTollTransaction,
} from '../lib/api/tollTransactions'
import { summariseTolls, byAsset, byPlaza } from '../lib/tollTransactions'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  asset_no: '', driver_name: '', tag_id: '', plaza_name: '', highway: '',
  transaction_at: '', amount: '', currency: '', payment_method: '', status: '', notes: '',
}

const PAYMENT_METHODS = ['tag', 'cash', 'card', 'account', 'other']
const STATUSES = ['posted', 'disputed', 'reconciled', 'refunded']

const STATUS_TONE = {
  posted: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
  disputed: 'text-red-400 bg-red-500/10 border-red-500/30',
  reconciled: 'text-green-400 bg-green-500/10 border-green-500/30',
  refunded: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
}

const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

const fmtAmount = (v, currency) => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  const num = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${currency} ${num}` : num
}

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** Local <input type="datetime-local"> value (YYYY-MM-DDTHH:mm) from an ISO/date. */
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

export default function TollTransactions() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [countryFilter, setCountryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
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
      const data = await listTollTransactions({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load toll transactions.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseTolls(rows || []), [rows])
  const assetRollup = useMemo(() => byAsset(rows || []), [rows])
  const plazaRollup = useMemo(() => byPlaza(rows || []), [rows])

  const displayCurrency = useMemo(
    () => (rows || []).map((r) => r.currency).find(Boolean) || '',
    [rows],
  )

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (countryFilter && r.country !== countryFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (methodFilter && r.payment_method !== methodFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.driver_name || ''} ${r.tag_id || ''} ${r.plaza_name || ''} ${r.highway || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, countryFilter, statusFilter, methodFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Transactions', value: summary.totalTransactions, icon: Receipt, tone: 'text-[var(--text-primary)]' },
    { label: 'Total toll spend', value: fmtAmount(summary.totalAmount, displayCurrency), icon: Coins, tone: 'text-amber-400' },
    { label: 'Disputed', value: summary.disputedCount, icon: AlertTriangle, tone: 'text-red-400' },
    { label: 'Disputed amount', value: fmtAmount(summary.disputedAmount, displayCurrency), icon: Wallet, tone: 'text-red-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'driver_name', 'tag_id', 'plaza_name', 'highway', 'transaction_at', 'amount', 'currency', 'payment_method', 'status', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Driver', 'Tag ID', 'Plaza', 'Highway', 'Transaction at', 'Amount', 'Currency', 'Payment method', 'Status', 'Notes']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', driver_name: r.driver_name || '', tag_id: r.tag_id || '',
    plaza_name: r.plaza_name || '', highway: r.highway || '',
    transaction_at: r.transaction_at || '', amount: r.amount ?? '',
    currency: r.currency || '', payment_method: r.payment_method || '',
    status: r.status || '', notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', driver_name: r.driver_name || '', tag_id: r.tag_id || '',
      plaza_name: r.plaza_name || '', highway: r.highway || '',
      transaction_at: toLocalInput(r.transaction_at), amount: r.amount ?? '',
      currency: r.currency || '', payment_method: r.payment_method || '',
      status: r.status || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (form.amount !== '' && form.amount != null && !Number.isFinite(Number(form.amount))) {
      setFormError('Amount must be a number.'); return
    }
    if (form.amount !== '' && Number(form.amount) < 0) { setFormError('Amount cannot be negative.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        transaction_at: form.transaction_at ? new Date(form.transaction_at).toISOString() : null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateTollTransaction(editing.id, payload)
      else await createTollTransaction(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the toll transaction.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTollTransaction(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the toll transaction.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setCountryFilter(''); setStatusFilter(''); setMethodFilter(''); setSearch('') }
  const hasFilters = countryFilter || statusFilter || methodFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Toll Transactions"
        subtitle="Capture toll-road charges per asset — tag, cash, card, or on-account — for reconciliation, dispute handling, and per-trip cost visibility."
        icon={Receipt}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'toll_transactions')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Toll Transactions', 'toll_transactions', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Add transaction
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Toll transactions aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V169_TOLL_TRANSACTIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load toll transactions.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Cost roll-ups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Truck size={15} /> Toll spend by asset
          </h3>
          {rows === null ? (
            <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : assetRollup.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No toll transactions recorded yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {assetRollup.slice(0, 16).map((a) => (
                <div key={a.asset_no} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                  <p className="text-xs text-[var(--text-muted)]">{a.asset_no}</p>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{fmtAmount(a.amount, displayCurrency)}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{a.count} charge{a.count === 1 ? '' : 's'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <MapPin size={15} /> Toll spend by plaza
          </h3>
          {rows === null ? (
            <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : plazaRollup.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No plaza data yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {plazaRollup.slice(0, 16).map((p) => (
                <div key={p.plaza} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                  <p className="text-xs text-[var(--text-muted)]">{p.plaza}</p>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{fmtAmount(p.amount, displayCurrency)}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{p.count} charge{p.count === 1 ? '' : 's'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, driver, tag, plaza, highway, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {countryOptions.length > 0 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <select className="input" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} aria-label="Payment method">
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalTransactions}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Plaza', 'Transaction at', 'Amount', 'Method', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No toll transactions recorded yet — add your first transaction.' : 'No transactions match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.plaza_name || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.transaction_at)}</td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] whitespace-nowrap">{fmtAmount(r.amount, r.currency)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1"><CreditCard size={13} className="opacity-70" /> {r.payment_method ? titleCase(r.payment_method) : '—'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {r.status ? (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status] || 'text-[var(--text-secondary)] bg-[var(--input-bg)] border-[var(--input-border)]'}`}>
                          {titleCase(r.status)}
                        </span>
                      ) : '—'}
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit toll transaction' : 'Add toll transaction'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Driver (optional)</label>
                  <input className="input w-full" placeholder="e.g. Ahmed Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Toll plaza (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh North Plaza" value={form.plaza_name} maxLength={200} onChange={(e) => set('plaza_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Highway (optional)</label>
                  <input className="input w-full" placeholder="e.g. Highway 40" value={form.highway} maxLength={200} onChange={(e) => set('highway', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Transaction date &amp; time</label>
                  <input className="input w-full" type="datetime-local" value={form.transaction_at} onChange={(e) => set('transaction_at', e.target.value)} />
                </div>
                <div>
                  <label className="label">Tag ID (optional)</label>
                  <input className="input w-full" placeholder="e.g. RFID-88231" value={form.tag_id} maxLength={120} onChange={(e) => set('tag_id', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Amount</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="25.00" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
                </div>
                <div>
                  <label className="label">Currency (optional)</label>
                  <input className="input w-full" placeholder="SAR" value={form.currency} maxLength={12} onChange={(e) => set('currency', e.target.value)} />
                </div>
                <div>
                  <label className="label">Payment method</label>
                  <select className="input w-full" value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
                    <option value="">—</option>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    <option value="">—</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. disputed — duplicate charge on same trip" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add transaction'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this transaction?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Transaction'} · {fmtAmount(confirmDelete.amount, confirmDelete.currency)} · {fmtDateTime(confirmDelete.transaction_at)}. This can’t be undone.
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
