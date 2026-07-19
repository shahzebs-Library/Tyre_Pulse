/**
 * FuelCards (route /fuel-cards) — Fuel Card Management. Register fleet fuel
 * cards, assign them to vehicles/drivers, and track monthly spend limits, status
 * and expiry. Ported from FleetIQ's FuelCardManagement and wired to Supabase via
 * the fuelCards service + the pure helpers in lib/fuelCards.
 *
 * Card numbers are PII: they are masked to the last 4 digits everywhere they are
 * rendered AND in every export. KPI tiles, a create/edit modal, a filterable /
 * searchable table with status + expiry badges, Excel/PDF export, and full
 * loading / empty / error / missing-migration states. Writes are Admin/Manager/
 * Director only (RLS-enforced); the UI surfaces failures rather than hiding them.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CreditCard, Plus, Search, X, Filter, Trash2, Pencil, AlertTriangle,
  CheckCircle2, Clock, DollarSign, CalendarClock, Loader2, FileSpreadsheet,
  FileText, Ban, Layers,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listFuelCards, createFuelCard, updateFuelCard, deleteFuelCard,
  FUEL_CARD_STATUSES,
} from '../lib/api/fuelCards'
import {
  maskCardNumber, cardExpiryStatus, summarizeFuelCards,
  FUEL_CARD_STATUS_META, EXPIRY_BAND_META,
} from '../lib/fuelCards'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const STATUS_META = {
  active: { label: 'Active', cls: 'bg-green-900/40 text-green-300 border border-green-700/50', icon: CheckCircle2 },
  blocked: { label: 'Blocked', cls: 'bg-red-900/40 text-red-300 border border-red-700/50', icon: Ban },
  expired: { label: 'Expired', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]', icon: AlertTriangle },
  unassigned: { label: 'Unassigned', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50', icon: Clock },
  unknown: { label: 'Unknown', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]', icon: CreditCard },
}

const EXPIRY_META = {
  expired: { label: 'Expired', cls: 'bg-red-900/40 text-red-300 border border-red-700/50' },
  expiring: { label: 'Expiring soon', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
  valid: { label: 'Valid', cls: 'bg-green-900/40 text-green-300 border border-green-700/50' },
  unknown: { label: 'No expiry', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]' },
}

const EMPTY_FORM = {
  card_number: '', provider: '', asset_no: '', driver_name: '',
  monthly_limit: '', status: 'active', expiry_date: '', notes: '',
}

function fmtDate(v) {
  if (!v) return '—'
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '—'
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
function FuelCardModal({ open, initial, currency, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = Boolean(initial?.id)

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(initial
      ? {
          card_number: initial.card_number || '', provider: initial.provider || '',
          asset_no: initial.asset_no || '', driver_name: initial.driver_name || '',
          monthly_limit: initial.monthly_limit ?? '', status: initial.status || 'active',
          expiry_date: initial.expiry_date ? String(initial.expiry_date).slice(0, 10) : '',
          notes: initial.notes || '',
        }
      : EMPTY_FORM)
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.card_number.trim()) { setError('A card number is required.'); return }
    setBusy(true)
    try {
      if (editing) await updateFuelCard(initial.id, form)
      else await createFuelCard({ ...form, currency })
      onSaved?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the fuel card.'))
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
            <CreditCard size={18} className="text-[var(--brand-bright)]" />
            {editing ? 'Edit fuel card' : 'New fuel card'}
          </h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Card number *</label>
            <input className="input w-full" placeholder="e.g. 4321 1234 5678 9012" autoComplete="off"
              value={form.card_number} maxLength={64} onChange={(e) => set('card_number', e.target.value)} />
            {form.card_number.trim() && (
              <p className="text-xs text-[var(--text-muted)] mt-1">Stored securely — shown as <span className="font-mono">{maskCardNumber(form.card_number)}</span></p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Provider</label>
              <input className="input w-full" placeholder="e.g. WEX, Shell, BP"
                value={form.provider} maxLength={120} onChange={(e) => set('provider', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {FUEL_CARD_STATUSES.map((s) => <option key={s} value={s}>{FUEL_CARD_STATUS_META[s]?.label || s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Assigned vehicle / asset</label>
              <input className="input w-full" placeholder="Asset number"
                value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
            <div>
              <label className="label">Assigned driver</label>
              <input className="input w-full" placeholder="Driver name"
                value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
            </div>
            <div>
              <label className="label">Monthly limit ({currency})</label>
              <input type="number" min="0" step="0.01" className="input w-full" placeholder="0"
                value={form.monthly_limit} onChange={(e) => set('monthly_limit', e.target.value)} />
            </div>
            <div>
              <label className="label">Expiry date</label>
              <input type="date" className="input w-full" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full min-h-[90px] resize-y" placeholder="Restrictions, PIN policy, notes…"
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
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create card'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function FuelCards() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const { rows: data, missing: miss } = await listFuelCards({ country: activeCountry })
      setMissing(miss)
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load fuel cards.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Enrich against a single reference clock so expiry banding is stable per render.
  const now = Date.now()
  const enriched = useMemo(
    () => (rows || []).map((c) => {
      const exp = cardExpiryStatus(c, now)
      return { ...c, _expiryBand: exp.band, _expiryDays: exp.days }
    }),
    [rows, now],
  )
  const summary = useMemo(() => summarizeFuelCards(rows || []), [rows])

  const providerOptions = useMemo(
    () => [...new Set(enriched.map((r) => r.provider).filter(Boolean))].sort(),
    [enriched],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (providerFilter && r.provider !== providerFilter) return false
      if (q) {
        // Search the full card number (operator convenience) plus assignment/meta,
        // but the value is never rendered in full.
        const hay = `${r.card_number || ''} ${r.provider || ''} ${r.asset_no || ''} ${r.driver_name || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, statusFilter, providerFilter, search])

  const onDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this fuel card? This cannot be undone.')) return
    setDeletingId(id); setError('')
    try {
      await deleteFuelCard(id)
      setRows((prev) => (prev || []).filter((r) => r.id !== id))
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the fuel card.'))
    } finally {
      setDeletingId(null)
    }
  }, [])

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (row) => { setEditing(row); setModalOpen(true) }
  const onSaved = () => { setModalOpen(false); setEditing(null); load() }

  const clearFilters = () => { setStatusFilter('all'); setProviderFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || providerFilter || search

  // Export — card numbers are masked here too, never exported in full. ---------
  const EXPORT_COLS = ['card_number', 'provider', 'asset_no', 'driver_name', 'monthly_limit', 'currency', 'status', 'expiry_date', 'expiry']
  const EXPORT_HEADERS = ['Card', 'Provider', 'Asset', 'Driver', 'Monthly limit', 'Currency', 'Status', 'Expiry', 'Expiry status']
  const exportRows = filtered.map((r) => ({
    card_number: maskCardNumber(r.card_number), provider: r.provider || '',
    asset_no: r.asset_no || '', driver_name: r.driver_name || '',
    monthly_limit: r.monthly_limit ?? '', currency: activeCurrency,
    status: STATUS_META[r.status]?.label || r.status,
    expiry_date: fmtDate(r.expiry_date),
    expiry: EXPIRY_BAND_META[r._expiryBand]?.label || r._expiryBand,
  }))

  const kpis = [
    { label: 'Total cards', value: summary.total, icon: CreditCard, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: summary.active, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Unassigned', value: summary.unassigned, icon: Layers, tone: 'text-amber-400' },
    { label: 'Total monthly limit', value: formatCurrencyCompact(summary.totalMonthlyLimit, activeCurrency), icon: DollarSign, tone: 'text-[var(--brand-bright)]' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fuel Card Management"
        subtitle="Register fleet fuel cards, assign to vehicles & drivers, and track limits, status and expiry."
        icon={CreditCard}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'fuel_cards') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Fuel Cards', 'fuel_cards', 'landscape') } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New card
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
            <p className="text-amber-300 font-medium">Fuel cards aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V135_FUEL_CARDS.sql</span>, then reload.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Expiring-soon banner */}
          {(() => {
            const soon = enriched.filter((r) => r._expiryBand === 'expiring')
            if (soon.length === 0) return null
            return (
              <div className="card border border-amber-800/50 flex items-start gap-3">
                <CalendarClock size={18} className="text-amber-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-amber-300 font-medium">
                    {soon.length} card{soon.length !== 1 ? 's' : ''} expiring within 30 days
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {soon.slice(0, 6).map((c) => (
                      <span key={c.id} className="text-xs bg-amber-900/40 text-amber-300 border border-amber-700/50 px-2 py-0.5 rounded-full font-mono">
                        {maskCardNumber(c.card_number)} — {c._expiryDays}d left
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )
          })()}

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
                <input className="input pl-9 w-full" placeholder="Search card, provider, asset, driver…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
                <option value="all">All statuses</option>
                {FUEL_CARD_STATUSES.map((s) => <option key={s} value={s}>{FUEL_CARD_STATUS_META[s]?.label || s}</option>)}
              </select>
              <select className="input" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} aria-label="Provider">
                <option value="">All providers</option>
                {providerOptions.map((p) => <option key={p} value={p}>{p}</option>)}
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
                    {['Card', 'Provider', 'Assigned to', 'Monthly limit', 'Status', 'Expiry', ''].map((h, i) => (
                      <th key={h || `act-${i}`} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows === null ? (
                    [0, 1, 2, 3, 4].map((i) => (
                      <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                      {summary.total === 0 ? (
                        <><CreditCard size={22} className="mx-auto mb-2 opacity-60" />No fuel cards yet. Register your first one.</>
                      ) : (
                        <><Filter size={22} className="mx-auto mb-2 opacity-60" />No cards match these filters.</>
                      )}
                    </td></tr>
                  ) : (
                    filtered.map((r) => {
                      const meta = STATUS_META[r.status] || STATUS_META.unknown
                      const StatusIcon = meta.icon
                      const exp = EXPIRY_META[r._expiryBand] || EXPIRY_META.unknown
                      const urgent = r._expiryBand === 'expiring' || r._expiryBand === 'expired'
                      return (
                        <tr key={r.id} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 ${urgent ? 'bg-amber-900/5' : ''}`}>
                          <td className="px-4 py-2.5">
                            <p className="text-[var(--text-primary)] font-medium font-mono">{maskCardNumber(r.card_number)}</p>
                            {r.notes && <p className="text-xs text-[var(--text-muted)] truncate max-w-[240px]">{r.notes}</p>}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.provider || '—'}</td>
                          <td className="px-4 py-2.5">
                            {r.asset_no || r.driver_name ? (
                              <div className="min-w-0">
                                {r.asset_no && <p className="text-[var(--text-secondary)] truncate">{r.asset_no}</p>}
                                {r.driver_name && <p className="text-xs text-[var(--text-muted)] truncate">{r.driver_name}</p>}
                              </div>
                            ) : <span className="text-[var(--text-dim)]">Unassigned</span>}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                            {r.monthly_limit == null ? '—' : formatCurrencyCompact(r.monthly_limit, activeCurrency)}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${meta.cls}`}>
                              <StatusIcon size={11} /> {meta.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`badge text-[11px] px-2 py-0.5 rounded ${exp.cls}`}>{exp.label}</span>
                            {r._expiryDays != null && r._expiryDays >= 0 && r._expiryBand === 'expiring' && (
                              <span className="ml-1.5 text-xs text-amber-400">({r._expiryDays}d)</span>
                            )}
                            {r.expiry_date && <p className="text-xs text-[var(--text-muted)] mt-0.5">{fmtDate(r.expiry_date)}</p>}
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

      <FuelCardModal
        open={modalOpen}
        initial={editing}
        currency={activeCurrency}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSaved={onSaved}
      />
    </div>
  )
}
