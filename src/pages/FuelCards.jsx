/**
 * FuelCards (route /fuel-cards) - Fuel Card Management. Register fleet fuel
 * cards, assign them to vehicles/drivers, and track monthly spend limits, status
 * and expiry. Wired to Supabase via the fuelCards service.
 *
 * Card numbers are PII: they are masked to the last 4 digits everywhere they are
 * rendered AND in every export. The page carries a KPI strip, expiry and
 * provider breakdowns, data-quality findings, search + filters, a sortable
 * register (EnterpriseTable), create/edit/delete, Excel/PDF export, and
 * loading / empty / error+Retry / missing-migration states. When the
 * `fuel_cards` table is not provisioned the service returns `{ missing: true }`
 * and creation stays disabled. Writes are Admin/Manager/Director only
 * (RLS-enforced).
 *
 * Calculations live in src/lib/fuelCardsAnalytics.js over src/lib/fuelCards.js.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CreditCard, Plus, Search, X, Trash2, Pencil, AlertTriangle, CheckCircle2,
  Clock, DollarSign, CalendarClock, Loader2, FileSpreadsheet, FileText, Ban,
  Layers, RefreshCw, Lightbulb, ShieldAlert,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listFuelCards, createFuelCard, updateFuelCard, deleteFuelCard,
  FUEL_CARD_STATUSES,
} from '../lib/api/fuelCards'
import { maskCardNumber, FUEL_CARD_STATUS_META, EXPIRY_BANDS } from '../lib/fuelCards'
import {
  enrichCards, filterCards, buildFuelCardKpis, buildFuelCardInsights,
  providerBreakdown, expiryBreakdown, fuelCardExportRows, FUEL_CARD_EXPORT_COLUMNS,
  statusLabel, expiryLabel,
} from '../lib/fuelCardsAnalytics'
import { compareValues } from '../lib/consoleTable'
import { colorAt } from '../lib/reportColors'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'

const LIST_CAP = 500 // listFuelCards returns the newest 500 cards.

// Semantic status/expiry colours; each badge also carries its text label.
const STATUS_META = {
  active: { cls: 'bg-green-500/15 text-green-500 border border-green-500/40', icon: CheckCircle2 },
  blocked: { cls: 'bg-red-500/15 text-red-500 border border-red-500/40', icon: Ban },
  expired: { cls: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]', icon: AlertTriangle },
  unassigned: { cls: 'bg-amber-500/15 text-amber-500 border border-amber-500/40', icon: Clock },
  unknown: { cls: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]', icon: CreditCard },
}
const EXPIRY_CLS = {
  expired: 'bg-red-500/15 text-red-500 border border-red-500/40',
  expiring: 'bg-amber-500/15 text-amber-500 border border-amber-500/40',
  valid: 'bg-green-500/15 text-green-500 border border-green-500/40',
  unknown: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]',
}

const EMPTY_FORM = {
  card_number: '', provider: '', asset_no: '', driver_name: '',
  monthly_limit: '', status: 'active', expiry_date: '', notes: '',
}

const ICON_BTN = 'inline-flex items-center justify-center h-11 w-11 sm:h-9 sm:w-9 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50'
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (v === null || v === undefined || v === '' ? undefined : v)

function fmtDate(v) {
  if (!v) return 'N/A'
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : 'N/A'
}

function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums break-words ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
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
  const close = () => { if (!busy) onClose?.() }

  return (
    <Modal open onClose={close} size="lg" title={<span className="inline-flex items-center gap-2"><CreditCard size={18} aria-hidden="true" />{editing ? 'Edit fuel card' : 'New fuel card'}</span>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label className="label" htmlFor="fc-number">Card number *</label>
          <input id="fc-number" className="input w-full" placeholder="e.g. 4321 1234 5678 9012" autoComplete="off" inputMode="numeric" required
            value={form.card_number} maxLength={64} onChange={(e) => set('card_number', e.target.value)} />
          {form.card_number.trim() && (
            <p className="text-xs text-[var(--text-muted)] mt-1">Stored securely, shown as <span className="font-mono">{maskCardNumber(form.card_number)}</span></p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="fc-provider">Provider</label>
            <input id="fc-provider" className="input w-full" placeholder="e.g. WEX, Shell, BP"
              value={form.provider} maxLength={120} onChange={(e) => set('provider', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="fc-status">Status</label>
            <select id="fc-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {FUEL_CARD_STATUSES.map((s) => <option key={s} value={s}>{FUEL_CARD_STATUS_META[s]?.label || s}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="fc-asset">Assigned vehicle / asset</label>
            <input id="fc-asset" className="input w-full" placeholder="Asset number"
              value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="fc-driver">Assigned driver</label>
            <input id="fc-driver" className="input w-full" placeholder="Driver name"
              value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="fc-limit">Monthly limit ({currency})</label>
            <input id="fc-limit" type="number" min="0" step="0.01" inputMode="decimal" className="input w-full" placeholder="0"
              value={form.monthly_limit} onChange={(e) => set('monthly_limit', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="fc-expiry">Expiry date</label>
            <input id="fc-expiry" type="date" className="input w-full" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="fc-notes">Notes</label>
          <textarea id="fc-notes" className="input w-full min-h-[90px] resize-y" placeholder="Restrictions, PIN policy, notes..."
            value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={close} className="btn-secondary min-h-[44px] sm:min-h-0" disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60 min-h-[44px] sm:min-h-0">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Create card'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function FuelCards() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  // One reference clock per load so expiry banding is stable between renders.
  const [now, setNow] = useState(() => Date.now())

  const [statusFilter, setStatusFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('')
  const [expiryFilter, setExpiryFilter] = useState('')
  const [assignFilter, setAssignFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const { rows: data, missing: miss } = await listFuelCards({ country: activeCountry })
      setMissing(miss)
      setRows(Array.isArray(data) ? data : [])
      const t = new Date()
      setUpdatedAt(t); setNow(t.getTime())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load fuel cards.'))
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null && !error
  const failedEmpty = rows === null && !!error
  const cards = useMemo(() => enrichCards(rows || [], now), [rows, now])
  const kpi = useMemo(() => buildFuelCardKpis(cards, activeCountry), [cards, activeCountry])
  const insights = useMemo(() => buildFuelCardInsights(cards, activeCountry), [cards, activeCountry])
  // Top 8 providers only: a breakdown panel, not a register.
  const providers = useMemo(() => providerBreakdown(cards).slice(0, 8), [cards])
  const expiries = useMemo(() => expiryBreakdown(cards), [cards])
  const providerOptions = useMemo(() => [...new Set(cards.map((r) => r.provider).filter(Boolean))].sort(), [cards])

  const filtered = useMemo(() => filterCards(cards, {
    status: statusFilter, provider: providerFilter, expiry: expiryFilter, assignment: assignFilter, search,
  }), [cards, statusFilter, providerFilter, expiryFilter, assignFilter, search])

  const closeDelete = () => { if (!deleting) { setConfirmDelete(null); setDeleteError('') } }
  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setDeleteError('')
    try {
      await deleteFuelCard(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete the fuel card.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = useCallback((row) => { setEditing(row); setModalOpen(true) }, [])
  const onSaved = () => { setModalOpen(false); setEditing(null); load() }

  const clearFilters = () => { setStatusFilter('all'); setProviderFilter(''); setExpiryFilter(''); setAssignFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || providerFilter || expiryFilter || assignFilter || search

  // Export - card numbers are masked here too, never exported in full.
  const exportRows = useMemo(() => fuelCardExportRows(filtered), [filtered])
  const scopeLabel = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
  const doExcel = async () => {
    setActionError('')
    try {
      await exportToExcel(exportRows, FUEL_CARD_EXPORT_COLUMNS.map((c) => c.key), FUEL_CARD_EXPORT_COLUMNS.map((c) => c.header), reportFileName('Fuel Cards', scopeLabel))
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    setActionError('')
    try {
      await exportToPdf(exportRows, FUEL_CARD_EXPORT_COLUMNS, `Fuel Cards (${scopeLabel})`, reportFileName('Fuel Cards', scopeLabel), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const limitValue = kpi.limit.total != null ? formatCurrencyCompact(kpi.limit.total, activeCurrency) : 'N/A'
  const limitSub = kpi.limit.mixed
    ? `Per country: ${kpi.limit.totals.map((t) => `${t.country} ${Math.round(t.total).toLocaleString()}`).join(', ')}`
    : kpi.limit.withLimit < kpi.total ? `${kpi.total - kpi.limit.withLimit} card(s) without a limit` : null

  const kpis = [
    { label: 'Total cards', value: kpi.total.toLocaleString(), icon: CreditCard, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: kpi.active.toLocaleString(), icon: CheckCircle2, tone: 'text-green-500', sub: kpi.blocked ? `${kpi.blocked} blocked` : null },
    { label: 'Unassigned', value: kpi.unassigned.toLocaleString(), icon: Layers, tone: 'text-amber-500' },
    { label: 'Expiring in 30 days', value: kpi.expiring.toLocaleString(), icon: CalendarClock, tone: kpi.expiring ? 'text-amber-500' : 'text-[var(--text-primary)]', sub: kpi.expired ? `${kpi.expired} already expired` : null },
    { label: 'Stale active status', value: kpi.staleActive.toLocaleString(), icon: ShieldAlert, tone: kpi.staleActive ? 'text-red-500' : 'text-[var(--text-primary)]', sub: 'Active but past expiry' },
    { label: 'Total monthly limit', value: limitValue, icon: DollarSign, tone: 'text-[var(--brand-bright)]', sub: limitSub },
  ]

  const columns = useMemo(() => [
    {
      id: 'card', header: 'Card', accessorFn: (r) => blank(r.masked), sortingFn: valueSort, sortUndefined: 'last', size: 180,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="text-[var(--text-primary)] font-medium font-mono">{row.original.masked}</p>
          {row.original.notes && <p className="text-xs text-[var(--text-muted)] truncate max-w-[240px]">{row.original.notes}</p>}
        </div>
      ),
    },
    { id: 'provider', header: 'Provider', accessorFn: (r) => blank(r.provider), sortingFn: valueSort, sortUndefined: 'last', size: 130, cell: ({ getValue }) => <span className="text-[var(--text-secondary)]">{getValue() || 'N/A'}</span> },
    {
      id: 'assigned', header: 'Assigned to', accessorFn: (r) => blank(r.asset_no || r.driver_name), sortingFn: valueSort, sortUndefined: 'last', size: 170,
      cell: ({ row }) => {
        const r = row.original
        return r.assigned ? (
          <div className="min-w-0">
            {r.asset_no && <p className="text-[var(--text-secondary)] truncate">{r.asset_no}</p>}
            {r.driver_name && <p className="text-xs text-[var(--text-muted)] truncate">{r.driver_name}</p>}
          </div>
        ) : <span className="text-[var(--text-muted)]">Unassigned</span>
      },
    },
    { id: 'limit', header: 'Monthly limit', accessorFn: (r) => r.limitValue ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 130, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums text-[var(--text-secondary)] whitespace-nowrap">{getValue() == null ? 'N/A' : formatCurrencyCompact(getValue(), activeCurrency)}</span> },
    {
      id: 'status', header: 'Status', accessorFn: (r) => statusLabel(r.status), sortingFn: valueSort, size: 130,
      cell: ({ row }) => {
        const r = row.original
        const meta = STATUS_META[r.status] || STATUS_META.unknown
        const Icon = meta.icon
        return (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${meta.cls}`}><Icon size={11} aria-hidden="true" /> {statusLabel(r.status)}</span>
            {r.staleActive && <span className="text-[10px] font-semibold text-red-500">stale</span>}
          </span>
        )
      },
    },
    {
      id: 'expiry', header: 'Expiry', accessorFn: (r) => r.expiryDays ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 150,
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="whitespace-nowrap">
            <span className={`badge text-[11px] px-2 py-0.5 rounded ${EXPIRY_CLS[r.expiryBand] || EXPIRY_CLS.unknown}`}>{expiryLabel(r.expiryBand)}</span>
            {r.expiryBand === 'expiring' && r.expiryDays != null && <span className="ml-1.5 text-xs text-amber-500">({r.expiryDays}d)</span>}
            {r.expiry_date && <p className="text-xs text-[var(--text-muted)] mt-0.5">{fmtDate(r.expiry_date)}</p>}
          </div>
        )
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 100, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center gap-1 justify-end">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit card ${row.original.masked}`}><Pencil size={14} /></button>
          <button type="button" onClick={() => { setDeleteError(''); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-500`} aria-label={`Delete card ${row.original.masked}`}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ], [activeCurrency, openEdit])

  const maxProvider = Math.max(1, ...providers.map((p) => p.count))
  const maxExpiry = Math.max(1, ...expiries.map((p) => p.count))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fuel Card Management"
        subtitle="Register fleet fuel cards, assign to vehicles and drivers, and track limits, status and expiry."
        icon={CreditCard}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={missing}>
              <Plus size={14} aria-hidden="true" /> New card
            </button>
          </div>
        }
      />

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[var(--text-primary)] font-medium">Could not load fuel cards.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-500/40 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)] flex-1">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      {missing ? (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Fuel cards are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V135_FUEL_CARDS.sql</span>, then reload.
            </p>
          </div>
        </div>
      ) : (
        <>
          <section aria-label="Fuel card figures">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {kpis.map((k) => <Kpi key={k.label} {...k} value={rows === null ? 'N/A' : k.value} sub={rows === null ? null : k.sub} />)}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-2">
              Figures cover all {kpi.total.toLocaleString()} card(s) in {scopeLabel}. Filters below narrow the register only.
              {rows && rows.length >= LIST_CAP ? ` Only the newest ${LIST_CAP} cards are loaded, so older cards are not counted.` : ''}
            </p>
          </section>

          {!loading && insights.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2"><Lightbulb size={15} className="text-amber-500" aria-hidden="true" /> Findings</h2>
              <ul className="space-y-1.5">
                {insights.map((s) => (
                  <li key={s} className="text-sm text-[var(--text-secondary)] flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" /> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card min-w-0">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><CalendarClock size={15} aria-hidden="true" /> Expiry position</h2>
              {loading ? <div className="h-28 bg-[var(--input-bg)] rounded animate-pulse" /> : kpi.total === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No cards registered yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {expiries.map((e) => (
                    <li key={e.key}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <button type="button" onClick={() => setExpiryFilter(e.key)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline" aria-label={`Filter register to ${e.label}`}>{e.label}</button>
                        <span className="tabular-nums font-semibold text-[var(--text-primary)]">{e.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                        <div className={`h-full rounded-full ${e.key === 'expired' ? 'bg-red-500' : e.key === 'expiring' ? 'bg-amber-500' : e.key === 'valid' ? 'bg-green-500' : 'bg-[var(--text-muted)]'}`} style={{ width: `${(e.count / maxExpiry) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card min-w-0">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><CreditCard size={15} aria-hidden="true" /> Cards by provider</h2>
              {loading ? <div className="h-28 bg-[var(--input-bg)] rounded animate-pulse" /> : providers.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No cards registered yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {providers.map((p, i) => (
                    <li key={p.key}>
                      <div className="flex items-center justify-between text-xs mb-1 gap-2">
                        <button type="button" onClick={() => setProviderFilter(p.key === 'Unspecified' ? '' : p.key)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline truncate" aria-label={`Filter register to ${p.label}`}>{p.label}</button>
                        <span className="tabular-nums font-semibold text-[var(--text-primary)]">{p.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${(p.count / maxProvider) * 100}%`, background: colorAt(i) }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="card">
            <div className="flex flex-wrap items-end gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <label htmlFor="fc-search" className="sr-only">Search fuel cards</label>
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                <input id="fc-search" className="input pl-9 w-full" placeholder="Search card, provider, asset, driver..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input w-full sm:w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
                <option value="all">All statuses</option>
                {FUEL_CARD_STATUSES.map((s) => <option key={s} value={s}>{FUEL_CARD_STATUS_META[s]?.label || s}</option>)}
              </select>
              <select className="input w-full sm:w-auto" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} aria-label="Provider">
                <option value="">All providers</option>
                {providerOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="input w-full sm:w-auto" value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value)} aria-label="Expiry">
                <option value="">All expiry</option>
                {EXPIRY_BANDS.map((b) => <option key={b} value={b}>{expiryLabel(b)}</option>)}
              </select>
              <select className="input w-full sm:w-auto" value={assignFilter} onChange={(e) => setAssignFilter(e.target.value)} aria-label="Assignment">
                <option value="">Assigned and unassigned</option>
                <option value="assigned">Assigned only</option>
                <option value="unassigned">Unassigned only</option>
              </select>
              {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><X size={14} aria-hidden="true" /> Clear</button>}
              <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {kpi.total}</span>
            </div>
          </div>

          <EnterpriseTable
            columns={columns}
            data={filtered}
            getRowId={(r) => String(r.id)}
            loading={loading}
            error={failedEmpty ? error : null}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            viewKey="fuel-cards"
            initialPageSize={25}
            emptyMessage={kpi.total === 0 ? 'No fuel cards yet. Register your first one.' : 'No cards match these filters.'}
          />
        </>
      )}

      <FuelCardModal
        open={modalOpen}
        initial={editing}
        currency={activeCurrency}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSaved={onSaved}
      />

      {confirmDelete && (
        <Modal
          open
          onClose={closeDelete}
          size="sm"
          title="Delete this fuel card?"
          footer={
            <>
              <button type="button" onClick={closeDelete} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                {deleting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <p className="text-sm text-[var(--text-secondary)]">
            Card <span className="font-mono font-medium text-[var(--text-primary)]">{confirmDelete.masked}</span>{confirmDelete.provider ? ` (${confirmDelete.provider})` : ''} will be permanently removed. This cannot be undone.
          </p>
          {deleteError && (
            <p role="alert" className="flex items-start gap-2 text-sm text-red-500 mt-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {deleteError}
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}
