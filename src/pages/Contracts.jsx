/**
 * Contracts (route /contracts) — Contract Manager. Commercial agreements
 * (supplier / service / maintenance / lease / retread) tracked as a spend +
 * expiry/renewal-planning concern.
 *
 * Deepened to production depth: lifecycle KPIs (total, active, live value,
 * annualized live spend, expiring <=30/<=60d, expired, next renewal), status
 * distribution + value-by-type + 12-month renewal pipeline charts, a fully
 * filterable/searchable/sortable table (type, status, vendor, expiry window,
 * date range, free-text) with traffic-light badges and Excel/PDF export.
 *
 * All figures derive from the real `contracts` table (V131). There is NO
 * auto_renew or renewal_date column, so renewal date == end_date and auto-renew
 * analytics are shown only if the data ever carries that field (honest N/A).
 * Nothing is fabricated; charts and the table show honest empty states when
 * there is no data. Writes are Admin/Manager/Director only (RLS-enforced).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  FileText, Plus, Search, X, Trash2, Pencil, AlertTriangle,
  CheckCircle2, Clock, DollarSign, CalendarClock, Loader2, FileSpreadsheet,
  BarChart3, PieChart, TrendingUp, Building2, Layers, Repeat, ArrowUpDown, RefreshCw,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listContracts, createContract, updateContract, deleteContract,
  CONTRACT_STATUSES, CONTRACT_TYPES,
} from '../lib/api/contracts'
import {
  buildContractKpis, statusDistribution, valueByType, valueByVendor,
  renewalPipeline, enrichContracts, autoRenewSplit,
  filterContracts, sortContracts, contractCurrencyMix, contractExportRows,
  CONTRACT_SORTS, CONTRACT_EXPORT_COLUMNS,
} from '../lib/contractsAnalytics'
import { formatCurrencyCompact } from '../lib/formatters'
import { colorAt, withAlpha, ACCENTS } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { compareValues, isBlank } from '../lib/consoleTable'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const STATUS_META = {
  active: { label: 'Active', cls: 'bg-green-900/40 text-green-300 border border-green-700/50', icon: CheckCircle2 },
  'expiring-soon': { label: 'Expiring soon', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50', icon: Clock },
  expired: { label: 'Expired', cls: 'bg-red-900/40 text-red-300 border border-red-700/50', icon: AlertTriangle },
  pending: { label: 'Pending', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50', icon: Clock },
  cancelled: { label: 'Cancelled', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]', icon: X },
  unknown: { label: 'Unknown', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]', icon: FileText },
}

// Semantic tones for the status doughnut (colour carries meaning; not palettized).
const STATUS_TONE = {
  active: '#22c55e', 'expiring-soon': '#f59e0b', expired: '#ef4444',
  pending: '#0ea5e9', cancelled: '#64748b', unknown: '#94a3b8',
}

const EMPTY_FORM = {
  title: '', vendor: '', contract_type: 'supply',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: '', value: '', status: 'active', notes: '',
}

const SORTS = CONTRACT_SORTS

/** Column sorting through the shared console comparator (blanks sort last). */
const sortable = (fn) => ({
  accessorFn: (r) => { const v = fn(r); return isBlank(v) ? undefined : v },
  sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
  sortUndefined: 'last',
})

function fmtDate(v) {
  if (!v) return 'N/A'
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : 'N/A'
}

const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', font: { size: 11 }, boxWidth: 12 } },
    tooltip: {
      backgroundColor: 'var(--panel-2)', titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)',
      borderColor: 'rgba(148,163,184,0.25)', borderWidth: 1,
    },
  },
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
      setError(toUserMessage(err, 'Could not save the contract.'))
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, currency, onSaved])

  const close = () => { if (!busy) onClose?.() }

  return (
    <Modal open={open} onClose={close} title={editing ? 'Edit contract' : 'New contract'} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="ct-title">Contract title *</label>
            <input id="ct-title" className="input w-full" placeholder="e.g. Michelin annual supply agreement"
              value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="ct-vendor">Vendor / counterparty</label>
              <input id="ct-vendor" className="input w-full" placeholder="Supplier name"
                value={form.vendor} maxLength={200} onChange={(e) => set('vendor', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ct-type">Type</label>
              <select id="ct-type" className="input w-full" value={form.contract_type} onChange={(e) => set('contract_type', e.target.value)}>
                {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ct-start">Start date</label>
              <input id="ct-start" type="date" className="input w-full" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ct-end">End / renewal date</label>
              <input id="ct-end" type="date" className="input w-full" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ct-value">Value ({currency})</label>
              <input id="ct-value" type="number" min="0" step="0.01" className="input w-full" placeholder="0"
                value={form.value} onChange={(e) => set('value', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ct-status">Status</label>
              <select id="ct-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="ct-notes">Notes</label>
            <textarea id="ct-notes" className="input w-full min-h-[90px] resize-y" placeholder="Terms, SLAs, renewal conditions"
              value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {busy ? 'Saving...' : editing ? 'Save changes' : 'Create contract'}
            </button>
            <button type="button" onClick={close} disabled={busy} className="btn-secondary min-h-[44px]">Cancel</button>
          </div>
        </form>
    </Modal>
  )
}

// ─── Small presentational helpers ───────────────────────────────────────────────
function ChartCard({ title, icon: Icon, empty, children }) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon size={15} className="text-[var(--brand-bright)]" aria-hidden="true" />}
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      </div>
      {empty ? (
        <div className="h-[220px] flex flex-col items-center justify-center text-center text-[var(--text-muted)] text-sm">
          <BarChart3 size={22} className="mb-2 opacity-50" aria-hidden="true" />
          No data to chart yet.
        </div>
      ) : (
        <div className="h-[220px]">{children}</div>
      )}
    </Card>
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
  // ONE reference clock per load. It used to be `Date.now()` on every render,
  // which handed every memo below a new dependency and recomputed the whole
  // analytics set on each keystroke.
  const [now, setNow] = useState(() => Date.now())

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('')
  const [expiryFilter, setExpiryFilter] = useState('all') // all | 30 | 60 | 90
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('expiry')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      // listContracts reports `missing` from the SAME query as the rows, so a
      // table that is not installed is told apart from an empty register
      // without a second round trip.
      const { rows: data, missing: miss } = await listContracts({ country: activeCountry })
      setMissing(miss)
      setRows(Array.isArray(data) ? data : [])
      setNow(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load contracts.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  const enriched = useMemo(() => enrichContracts(rows || [], now), [rows, now])

  // The tiles and charts cover the contracts matching search, type and vendor.
  // Status, the expiry window and the renewal dates are held out: the tiles,
  // the status doughnut and the renewal pipeline REPORT on those, so narrowing
  // them by their own filter would only restate the choice.
  const scopeRows = useMemo(() => {
    const scoped = filterContracts(enriched, { type: typeFilter, vendor: vendorFilter, query: search })
    const ids = new Set(scoped.map((r) => r.id))
    return (rows || []).filter((r) => ids.has(r.id))
  }, [enriched, rows, typeFilter, vendorFilter, search])
  const kpis = useMemo(() => buildContractKpis(scopeRows, now), [scopeRows, now])
  const statusDist = useMemo(() => statusDistribution(scopeRows, now), [scopeRows, now])
  const byType = useMemo(() => valueByType(scopeRows, now), [scopeRows, now])
  const byVendor = useMemo(() => valueByVendor(scopeRows, now, { limit: 8 }), [scopeRows, now])
  const pipeline = useMemo(() => renewalPipeline(scopeRows, now, { months: 12 }), [scopeRows, now])
  const autoRenew = useMemo(() => autoRenewSplit(scopeRows, now), [scopeRows, now])
  const currency = useMemo(() => contractCurrencyMix(scopeRows, activeCurrency), [scopeRows, activeCurrency])
  const money = (v) => (currency.mixed ? 'N/A' : formatCurrencyCompact(v, currency.single || activeCurrency))

  const vendorOptions = useMemo(() => [...new Set(enriched.map((r) => r.vendor).filter(Boolean))].sort(), [enriched])
  const typeOptions = useMemo(() => [...new Set(enriched.map((r) => r.contract_type).filter(Boolean))].sort(), [enriched])

  const filtered = useMemo(() => sortContracts(filterContracts(enriched, {
    status: statusFilter, type: typeFilter, vendor: vendorFilter, expiryWindow: expiryFilter,
    from: fromDate, to: toDate, query: search,
  }), sortKey), [enriched, statusFilter, typeFilter, vendorFilter, expiryFilter, fromDate, toDate, search, sortKey])

  const onDelete = useCallback(async () => {
    const target = confirmDelete
    if (!target) return
    setDeletingId(target.id); setError('')
    try {
      await deleteContract(target.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== target.id))
      setConfirmDelete(null)
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the contract.'))
    } finally {
      setDeletingId(null)
    }
  }, [confirmDelete])

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = useCallback((row) => { setEditing(row); setModalOpen(true) }, [])
  const onSaved = () => { setModalOpen(false); setEditing(null); load() }

  const clearFilters = () => {
    setStatusFilter('all'); setTypeFilter('all'); setVendorFilter('')
    setExpiryFilter('all'); setFromDate(''); setToDate(''); setSearch('')
  }
  const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || vendorFilter ||
    expiryFilter !== 'all' || fromDate || toDate || search

  // Export -------------------------------------------------------------------
  const exportRows = useMemo(() => contractExportRows(filtered, activeCurrency), [filtered, activeCurrency])
  const exportName = reportFileName('Contracts', new Date().toISOString().slice(0, 10))
  const doExport = async (kind) => {
    try {
      if (kind === 'excel') await exportToExcel(exportRows, CONTRACT_EXPORT_COLUMNS.map((c) => c.key), CONTRACT_EXPORT_COLUMNS.map((c) => c.header), exportName)
      else await exportToPdf(exportRows, CONTRACT_EXPORT_COLUMNS, 'Contracts', exportName, 'landscape')
    } catch (e) {
      setError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const mixedNote = currency.mixed ? `Mixed currencies (${currency.currencies.join(', ')})` : null
  const kpiTiles = [
    { label: 'Total contracts', value: kpis.total, icon: FileText, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: kpis.active, icon: CheckCircle2, tone: 'text-green-400', sub: kpis.pending ? `${kpis.pending} pending` : null },
    { label: `Expiring in ${kpis.urgentDays} days or less`, value: kpis.expiringUrgentCount, icon: AlertTriangle, tone: kpis.expiringUrgentCount > 0 ? 'text-red-400' : 'text-[var(--text-primary)]' },
    { label: `Expiring in ${kpis.soonDays} days or less`, value: kpis.expiringSoonCount, icon: CalendarClock, tone: 'text-amber-400' },
    { label: 'Expired', value: kpis.expired, icon: Clock, tone: 'text-[var(--text-muted)]' },
    { label: 'Live value', value: money(kpis.totalValue), icon: DollarSign, tone: 'text-[var(--brand-bright)]', sub: mixedNote },
    {
      label: 'Annualized live',
      value: kpis.liveAnnualizedValue == null ? 'N/A' : money(kpis.liveAnnualizedValue),
      icon: TrendingUp, tone: 'text-sky-400', sub: kpis.liveAnnualizedValue == null ? 'Needs start and end dates' : mixedNote,
    },
    {
      label: 'Next renewal',
      value: kpis.nextRenewal ? `${kpis.nextRenewal.daysRemaining} days` : 'N/A',
      sub: kpis.nextRenewal ? kpis.nextRenewal.contract.title : 'None upcoming',
      icon: Repeat, tone: 'text-violet-400',
    },
  ]

  // Chart data ---------------------------------------------------------------
  const statusChart = {
    labels: statusDist.map((b) => b.label),
    datasets: [{
      data: statusDist.map((b) => b.count),
      backgroundColor: statusDist.map((b) => STATUS_TONE[b.key] || '#94a3b8'),
      borderColor: 'var(--panel-2)', borderWidth: 2,
    }],
  }
  const typeChart = {
    labels: byType.map((t) => t.label),
    datasets: [{
      label: `Value (${currency.single || activeCurrency})`,
      data: byType.map((t) => Math.round(t.value)),
      backgroundColor: byType.map((_, i) => withAlpha(colorAt(i), 0.85)),
      borderRadius: 4,
    }],
  }
  const pipelineChart = {
    labels: pipeline.map((b) => b.label),
    datasets: [{
      label: 'Contracts',
      data: pipeline.map((b) => b.count),
      backgroundColor: withAlpha(ACCENTS?.primary || colorAt(0), 0.85),
      borderRadius: 4, yAxisID: 'y',
    }],
  }

  const columns = useMemo(() => [
    { id: 'title', header: 'Contract', ...sortable((r) => r.title), size: 240,
      cell: ({ row }) => (
        <div>
          <p className="text-[var(--text-primary)] font-medium">{row.original.title}</p>
          {row.original.notes && <p className="text-xs text-[var(--text-muted)] truncate max-w-[240px]" title={row.original.notes}>{row.original.notes}</p>}
        </div>
      ) },
    { id: 'vendor', header: 'Vendor', ...sortable((r) => r.vendor), size: 150,
      cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.vendor || 'N/A'}</span> },
    { id: 'type', header: 'Type', ...sortable((r) => r.contract_type), size: 110,
      cell: ({ row }) => <span className="text-[var(--text-secondary)] capitalize">{row.original.contract_type || 'N/A'}</span> },
    { id: 'start', header: 'Start', ...sortable((r) => r.start_date), size: 110,
      cell: ({ row }) => <span className="text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(row.original.start_date)}</span> },
    { id: 'end', header: 'End / renewal', ...sortable((r) => r.end_date), size: 150,
      cell: ({ row }) => {
        const r = row.original
        const urgent = r._status === 'expiring-soon' || r._status === 'expired'
        return (
          <span className="whitespace-nowrap">
            <span className={urgent ? 'text-amber-500 font-medium' : 'text-[var(--text-secondary)]'}>{fmtDate(r.end_date)}</span>
            {r._days != null && r._days >= 0 && r._days <= 60 && (
              <span className={`ml-1.5 text-xs ${r._days <= 7 ? 'text-red-400' : 'text-amber-500'}`}>({r._days}d)</span>
            )}
          </span>
        )
      } },
    { id: 'value', header: 'Value', ...sortable((r) => r._value), size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)] whitespace-nowrap">{row.original._value == null ? 'N/A' : formatCurrencyCompact(row.original._value, row.original.currency || activeCurrency)}</span> },
    { id: 'annualized', header: 'Annualized', ...sortable((r) => r._annualized), size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-muted)] whitespace-nowrap">{row.original._annualized == null ? 'N/A' : formatCurrencyCompact(row.original._annualized, row.original.currency || activeCurrency)}</span> },
    { id: 'status', header: 'Status', ...sortable((r) => (STATUS_META[r._status] || STATUS_META.unknown).label), size: 140,
      cell: ({ row }) => {
        const meta = STATUS_META[row.original._status] || STATUS_META.unknown
        const StatusIcon = meta.icon
        return (
          <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${meta.cls}`}>
            <StatusIcon size={11} aria-hidden="true" /> {meta.label}
          </span>
        )
      } },
    { id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="flex items-center gap-1 justify-end">
            <button type="button" onClick={() => openEdit(r)} className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--brand-bright)] hover:bg-[var(--input-bg)] focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`Edit ${r.title || 'contract'}`}>
              <Pencil size={15} />
            </button>
            <button type="button" onClick={() => setConfirmDelete(r)} disabled={deletingId === r.id} className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--input-bg)] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-500" aria-label={`Delete ${r.title || 'contract'}`}>
              {deletingId === r.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            </button>
          </div>
        )
      } },
  ], [activeCurrency, deletingId, openEdit])

  const expiringChips = useMemo(
    () => enriched
      .filter((c) => c._days != null && c._days >= 0 && c._days <= kpis.soonDays && c._status !== 'cancelled')
      .sort((a, b) => a._days - b._days)
      .slice(0, 6),
    [enriched, kpis.soonDays],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contract Manager"
        subtitle="Commercial agreements with lifecycle status, spend and renewal planning."
        icon={FileText}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing}>
              <Plus size={14} aria-hidden="true" /> New contract
            </button>
          </div>
        }
      />

      {error && (
        <Card tone="crit" className="items-start gap-3" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[var(--text-primary)] font-medium">Something went wrong with contracts.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" /> Retry
          </button>
        </Card>
      )}

      {missing ? (
        <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Contracts are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V131_CONTRACTS.sql</span>, then reload.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Expiring-soon banner */}
          {!loading && kpis.expiringSoonCount > 0 && (
            <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
              <CalendarClock size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[var(--text-primary)] font-medium">
                  {kpis.expiringSoonCount} contract{kpis.expiringSoonCount !== 1 ? 's' : ''} expiring within {kpis.soonDays} days
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {expiringChips.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => { setExpiryFilter(String(kpis.soonDays)); setSearch(c.title || '') }}
                      className="text-xs bg-amber-500/10 text-[var(--text-primary)] border border-amber-500/40 px-2.5 min-h-[32px] rounded-full hover:bg-amber-500/20"
                    >
                      {c.title}: {c._days} days left
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpiTiles.map((k) => {
              const Icon = k.icon
              return (
                <Card key={k.label}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                    <Icon size={16} className={k.tone} aria-hidden="true" />
                  </div>
                  {loading
                    ? <div className="h-7 w-16 mt-2 rounded bg-[var(--input-bg)] animate-pulse" />
                    : <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>}
                  {k.sub && !loading && <p className="text-xs text-[var(--text-muted)] truncate mt-0.5" title={k.sub}>{k.sub}</p>}
                </Card>
              )
            })}
          </div>
          {!loading && scopeRows.length !== (rows || []).length && (
            <p className="text-xs text-[var(--text-muted)] -mt-3">
              These figures cover the {scopeRows.length} contract{scopeRows.length === 1 ? '' : 's'} matching your search, type and vendor filters, of {(rows || []).length}.
              The status, expiry and renewal-date filters are not applied here, so the status and renewal views stay readable.
            </p>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard title="Status distribution" icon={PieChart} empty={!loading && statusDist.length === 0}>
              <Doughnut data={statusChart} options={{ ...CHART_BASE, cutout: '62%' }} role="img" aria-label="Contract status distribution" />
            </ChartCard>
            <ChartCard title={`Value by type (${currency.mixed ? 'mixed currencies' : currency.single || activeCurrency})`} icon={Layers} empty={!loading && (currency.mixed || byType.every((t) => t.value === 0))}>
              <Bar data={typeChart} options={{
                ...CHART_BASE,
                plugins: { ...CHART_BASE.plugins, legend: { display: false } },
                scales: {
                  x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
                  y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
                },
              }} role="img" aria-label="Contract value by type" />
            </ChartCard>
            <ChartCard title="Renewal pipeline (12 months)" icon={CalendarClock} empty={!loading && pipeline.every((b) => b.count === 0)}>
              <Bar data={pipelineChart} options={{
                ...CHART_BASE,
                plugins: { ...CHART_BASE.plugins, legend: { display: false } },
                scales: {
                  x: { ticks: { color: 'var(--text-muted)', font: { size: 9 }, maxRotation: 60, minRotation: 45 }, grid: { display: false } },
                  y: { beginAtZero: true, ticks: { color: 'var(--text-muted)', font: { size: 10 }, precision: 0 }, grid: { color: 'var(--panel-2)' } },
                },
              }} role="img" aria-label="Contracts renewing per month" />
            </ChartCard>
          </div>

          {/* Vendor exposure + auto-renew note */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <Building2 size={15} className="text-[var(--brand-bright)]" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Spend exposure by vendor</h3>
              </div>
              {loading ? (
                <div className="h-24 rounded bg-[var(--input-bg)] animate-pulse" />
              ) : currency.mixed ? (
                <p className="text-sm text-[var(--text-muted)] py-6 text-center">These contracts are in {currency.currencies.join(', ')}. Filter to one vendor or type to compare spend.</p>
              ) : byVendor.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-6 text-center">No vendor data yet.</p>
              ) : (
                <ul className="space-y-2">
                  {byVendor.map((v, i) => {
                    const max = byVendor[0].value || 1
                    const pct = max > 0 ? Math.max(2, Math.round((v.value / max) * 100)) : 0
                    return (
                      <li key={v.type} className="flex items-center gap-3">
                        <span className="text-xs text-[var(--text-secondary)] w-28 truncate" title={v.type}>{v.type}</span>
                        <div className="flex-1 h-4 bg-[var(--input-bg)] rounded overflow-hidden" aria-hidden="true">
                          <div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: withAlpha(colorAt(i), 0.85) }} />
                        </div>
                        <span className="text-xs text-[var(--text-secondary)] w-24 text-right whitespace-nowrap tabular-nums">{money(v.value)}</span>
                        <span className="text-xs text-[var(--text-muted)] w-20 text-right whitespace-nowrap">{v.count} contract{v.count === 1 ? '' : 's'}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <Repeat size={15} className="text-[var(--brand-bright)]" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Auto-renew</h3>
              </div>
              {autoRenew.available ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between"><span className="text-[var(--text-secondary)]">Auto-renew</span><span className="font-semibold text-[var(--text-primary)]">{autoRenew.auto}</span></div>
                  <div className="flex items-center justify-between"><span className="text-[var(--text-secondary)]">Manual</span><span className="font-semibold text-[var(--text-primary)]">{autoRenew.manual}</span></div>
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  Auto-renew is not tracked on these contracts. Renewal date is taken from each contract's end date.
                </p>
              )}
            </Card>
          </div>

          {/* Filters */}
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                <input className="input pl-9 w-full" placeholder="Search title, vendor, type, notes" aria-label="Search contracts" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="expiring-soon">Expiring soon</option>
                <option value="expired">Expired</option>
                <option value="pending">Pending</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
                <option value="all">All types</option>
                {typeOptions.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
              <select className="input" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} aria-label="Vendor">
                <option value="">All vendors</option>
                {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <select className="input" value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value)} aria-label="Expiry window">
                <option value="all">Any expiry</option>
                <option value="30">Expiring in 30 days or less</option>
                <option value="60">Expiring in 60 days or less</option>
                <option value="90">Expiring in 90 days or less</option>
              </select>
              <select className="input" value={sortKey} onChange={(e) => setSortKey(e.target.value)} aria-label="Default order">
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1"><ArrowUpDown size={12} aria-hidden="true" /> Renewal between</span>
              <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="Renewal from" />
              <span className="text-xs text-[var(--text-muted)]">and</span>
              <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="Renewal to" />
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
                  <X size={14} aria-hidden="true" /> Clear
                </button>
              )}
              <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {(rows || []).length}</span>
            </div>
          </Card>

          {/* Register: the WHOLE filtered set; the table pages and sorts across it. */}
          <Card pad="none" clip>
            <EnterpriseTable
              columns={columns}
              data={filtered}
              getRowId={(r) => String(r.id)}
              loading={loading}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableSorting
              enableExport={false}
              initialPageSize={25}
              pageSizeOptions={[25, 50, 100]}
              emptyMessage={(rows || []).length === 0 ? 'No contracts yet. Use "New contract" to add the first one.' : 'No contracts match these filters.'}
            />
          </Card>
        </>
      )}

      <ContractModal
        open={modalOpen}
        initial={editing}
        currency={activeCurrency}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSaved={onSaved}
      />

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => { if (!deletingId) setConfirmDelete(null) }}
        title="Delete this contract?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} disabled={Boolean(deletingId)} className="btn-secondary text-sm min-h-[44px]">Cancel</button>
            <button type="button" onClick={onDelete} disabled={Boolean(deletingId)} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60">
              {deletingId ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} Delete
            </button>
          </>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.title}</span> will be permanently removed. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
