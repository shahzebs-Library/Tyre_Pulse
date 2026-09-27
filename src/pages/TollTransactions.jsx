/**
 * TollTransactions (route /toll-transactions) - toll-road charges per asset,
 * paid by electronic tag, cash, card or on account. Toll spend is a recurring
 * per-trip operating cost, so every charge is org-isolated, country-scoped and
 * can be reconciled or disputed.
 *
 * Runs on the `toll_transactions` table (V169). All analytics live in the pure
 * `src/lib/tollTransactionsAnalytics.js` engine (which reuses the roll-up
 * primitives in `src/lib/tollTransactions.js`). Money is always shown in its
 * own currency: a scope that mixes SAR, AED and EGP reports each currency on
 * its own line and never a combined total.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Receipt, Coins, AlertTriangle, Truck, Search, X, FileSpreadsheet, FileText,
  Plus, Pencil, Trash2, RotateCcw, Percent, CalendarClock, Banknote, MapPin,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTollTransactions, createTollTransaction, updateTollTransaction, deleteTollTransaction,
} from '../lib/api/tollTransactions'
import {
  filterTolls, summarizeTollAnalytics, monthlyTrend, methodMix, rollupsForCurrency,
  tollExportRows, currencyOf, titleCase, TOLL_STATUSES, TOLL_METHODS,
  EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/tollTransactionsAnalytics'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')
const READ_LIMIT = 500

const EMPTY_FORM = {
  asset_no: '', driver_name: '', tag_id: '', plaza_name: '', highway: '',
  transaction_at: '', amount: '', currency: '', payment_method: '', status: '', notes: '',
}

const STATUS_TONE = {
  posted: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
  disputed: 'text-red-400 bg-red-500/10 border-red-500/30',
  reconciled: 'text-green-400 bg-green-500/10 border-green-500/30',
  refunded: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
}

const fmtAmount = (v, currency) => {
  if (v == null || v === '') return 'N/A'
  const n = Number(v)
  if (!Number.isFinite(n)) return 'N/A'
  const num = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency && currency !== 'Unspecified' ? `${currency} ${num}` : num
}
const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

/** Local <input type="datetime-local"> value (YYYY-MM-DDTHH:mm) from an ISO/date. */
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}
const DONUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '60%',
  plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
}

const FIELD = 'input w-full min-h-[44px]'

export default function TollTransactions() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [countryFilter, setCountryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [currencyFilter, setCurrencyFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
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
      const data = await listTollTransactions({ country: activeCountry, limit: READ_LIMIT })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load toll transactions.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loaded = Array.isArray(rows)
  const all = useMemo(() => rows || [], [rows])
  const filtered = useMemo(() => filterTolls(all, {
    search, country: countryFilter, status: statusFilter, method: methodFilter,
    currency: currencyFilter, from: fromDate, to: toDate,
  }), [all, search, countryFilter, statusFilter, methodFilter, currencyFilter, fromDate, toDate])
  const summary = useMemo(() => summarizeTollAnalytics(filtered, { now: Date.now() }), [filtered])
  const trend = useMemo(
    () => monthlyTrend(filtered, { now: Date.now(), currency: summary.currency }),
    [filtered, summary.currency],
  )
  const methods = useMemo(() => methodMix(filtered), [filtered])
  const rollups = useMemo(() => rollupsForCurrency(filtered, summary.currency), [filtered, summary.currency])

  const countryOptions = useMemo(() => [...new Set(all.map((r) => r.country).filter(Boolean))].sort(), [all])
  const currencyOptions = useMemo(() => [...new Set(all.map(currencyOf))].sort(), [all])
  const truncated = loaded && all.length >= READ_LIMIT

  // ── Exports (whole filtered set, never one page) ─────────────────────────
  const exportRows = useMemo(() => tollExportRows(filtered), [filtered])
  const fileBase = async () => {
    const { reportFileName, reportDateLabel } = await loadExportUtils()
    return reportFileName('TyrePulse Toll Transactions', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  }
  const doExcel = async () => {
    try {
      const { exportToExcel } = await loadExportUtils()
      await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, await fileBase())
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }
  const doPdf = async () => {
    try {
      const { exportToPdf } = await loadExportUtils()
      await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Toll Transactions', await fileBase(), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', driver_name: r.driver_name || '', tag_id: r.tag_id || '',
      plaza_name: r.plaza_name || '', highway: r.highway || '',
      transaction_at: toLocalInput(r.transaction_at), amount: r.amount ?? '',
      currency: r.currency || '', payment_method: r.payment_method || '',
      status: r.status || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
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
      setFormError(toUserMessage(err, 'Could not save the toll transaction.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteTollTransaction(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the toll transaction.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => {
    setCountryFilter(''); setStatusFilter(''); setMethodFilter(''); setCurrencyFilter('')
    setFromDate(''); setToDate(''); setSearch('')
  }
  const hasFilters = !!(countryFilter || statusFilter || methodFilter || currencyFilter || fromDate || toDate || search)

  // ── Table ────────────────────────────────────────────────────────────────
  const columns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 120,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || 'N/A', size: 140 },
    { id: 'plaza', header: 'Plaza', accessorFn: (r) => r.plaza_name || 'N/A', size: 160 },
    { id: 'highway', header: 'Highway', accessorFn: (r) => r.highway || 'N/A', size: 120 },
    { id: 'when', header: 'Transaction at', accessorFn: (r) => r.transaction_at || '', size: 170,
      cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDateTime(row.original.transaction_at)}</span> },
    { id: 'amount', header: 'Amount', accessorFn: (r) => (r.amount == null || r.amount === '' ? null : Number(r.amount)), size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-semibold tabular-nums whitespace-nowrap text-[var(--text-primary)]">{fmtAmount(row.original.amount, currencyOf(row.original))}</span> },
    { id: 'method', header: 'Method', accessorFn: (r) => (r.payment_method ? titleCase(r.payment_method) : 'N/A'), size: 110 },
    { id: 'status', header: 'Status', accessorFn: (r) => (r.status ? titleCase(r.status) : 'N/A'), size: 120,
      cell: ({ row }) => {
        const s = String(row.original.status || '').toLowerCase()
        return s ? (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s] || 'text-[var(--text-secondary)] bg-[var(--input-bg)] border-[var(--input-border)]'}`}>
            {titleCase(s)}
          </span>
        ) : <span className="text-[var(--text-muted)]">N/A</span>
      } },
    { id: 'actions', header: '', size: 110, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit toll for ${row.original.asset_no || 'asset'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete toll for ${row.original.asset_no || 'asset'}`}><Trash2 size={15} /></button>
        </div>
      ) },
  ], [openEdit])

  const assetColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (a) => a.asset_no, size: 140 },
    { id: 'count', header: 'Charges', accessorFn: (a) => a.count, size: 90, meta: { align: 'right' } },
    { id: 'amount', header: 'Spend', accessorFn: (a) => a.amount, size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtAmount(row.original.amount, summary.currency)}</span> },
  ], [summary.currency])
  const plazaColumns = useMemo(() => [
    { id: 'plaza', header: 'Plaza', accessorFn: (p) => p.plaza, size: 180 },
    { id: 'count', header: 'Charges', accessorFn: (p) => p.count, size: 90, meta: { align: 'right' } },
    { id: 'amount', header: 'Spend', accessorFn: (p) => p.amount, size: 130, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtAmount(row.original.amount, summary.currency)}</span> },
  ], [summary.currency])

  const trendData = {
    labels: trend.map((t) => t.month),
    datasets: [{
      label: summary.currency ? `Spend (${summary.currency})` : 'Transactions',
      data: trend.map((t) => (summary.currency ? t.amount : t.count)),
      backgroundColor: withAlpha(colorAt(0), 0.75),
      borderRadius: 4,
    }],
  }
  const methodData = {
    labels: methods.map((m) => m.label),
    datasets: [{ data: methods.map((m) => m.count), backgroundColor: categorical(methods.length), borderWidth: 0 }],
  }

  const moneyNote = summary.mixedCurrency ? 'Mixed currencies: see the per-currency split' : null
  const kpis = [
    { label: 'Transactions', value: loaded ? fmtNum(summary.total) : 'N/A', icon: Receipt, sub: `${fmtNum(summary.last30Count)} in the last 30 days` },
    { label: 'Toll spend', value: loaded ? fmtAmount(summary.totalAmount, summary.currency) : 'N/A', icon: Coins, tone: 'warn', sub: moneyNote || (summary.unpricedCount ? `${summary.unpricedCount} without an amount` : 'All charges priced') },
    { label: 'Average charge', value: loaded ? fmtAmount(summary.avgAmount, summary.currency) : 'N/A', icon: Banknote, sub: moneyNote || 'Per priced charge' },
    { label: 'Disputed', value: loaded ? fmtNum(summary.disputedCount) : 'N/A', icon: AlertTriangle, tone: 'crit', sub: `Rate ${fmtPct(summary.disputeRatePct)}` },
    { label: 'Disputed amount', value: loaded ? fmtAmount(summary.disputedAmount, summary.currency) : 'N/A', icon: Percent, tone: 'crit', sub: moneyNote || 'Awaiting resolution' },
    { label: 'Reconciled', value: loaded ? fmtPct(summary.reconciledPct) : 'N/A', icon: CalendarClock, tone: 'accent', sub: `${fmtNum(summary.distinctAssets)} assets charged` },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Toll Transactions"
        subtitle="Toll-road charges per asset (tag, cash, card or on account) for reconciliation, dispute handling and per-trip cost visibility."
        icon={Receipt}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned || !loaded}>
              <Plus size={14} /> Add transaction
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Toll transactions are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V169_TOLL_TRANSACTIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-red-300 font-medium">Could not load toll transactions.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={refreshing}>
            <RotateCcw size={14} /> Retry
          </button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      {/* KPI strip: covers exactly the transactions matching the filters */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k, i) => <StatTile key={k.label} index={i} label={k.label} value={k.value} icon={k.icon} tone={k.tone} sub={k.sub} />)}
      </div>
      {loaded && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">
          These figures cover the {fmtNum(filtered.length)} transaction{filtered.length === 1 ? '' : 's'} matching the current filters
          {truncated ? `. Only the most recent ${READ_LIMIT} transactions are loaded, so older charges are not included.` : '.'}
        </p>
      )}

      {/* Per-currency split: money is never added across currencies */}
      {loaded && summary.currencies.length > 1 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><Coins size={15} aria-hidden="true" /> Spend by currency</h2>
          <p className="text-xs text-[var(--text-muted)] mb-3">This scope mixes currencies, so each is reported on its own. Pick a currency filter to see totals, trend and rankings in one currency.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {summary.currencies.map((c) => (
              <button
                type="button"
                key={c.currency}
                onClick={() => setCurrencyFilter(c.currency)}
                className="text-left rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-3 min-h-[44px] hover:border-[var(--accent)]"
                aria-label={`Show only ${c.currency} transactions`}
              >
                <p className="text-xs text-[var(--text-muted)]">{c.currency}</p>
                <p className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">{fmtAmount(c.priced ? c.amount : null, c.currency)}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{c.count} charge{c.count === 1 ? '' : 's'} | disputed {fmtAmount(c.priced ? c.disputedAmount : null, c.currency)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            {summary.currency ? `Monthly toll spend (${summary.currency}), last 12 months` : 'Monthly transactions, last 12 months'}
          </h2>
          <div className="h-60" role="img" aria-label={`Monthly ${summary.currency ? 'toll spend' : 'transaction count'} for the last 12 months`}>
            {!loaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : trend.some((t) => t.count > 0) ? <Bar data={trendData} options={CHART_OPTS} />
                : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No transactions in the last 12 months for this scope.</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Payment method mix</h2>
          <div className="h-60" role="img" aria-label="Transactions by payment method">
            {!loaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : methods.length ? <Doughnut data={methodData} options={DONUT_OPTS} />
                : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No transactions to break down.</p>}
          </div>
        </div>
      </div>

      {/* Roll-ups (one currency only) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Truck size={15} aria-hidden="true" /> Toll spend by asset</h2>
          {summary.mixedCurrency
            ? <p className="text-sm text-[var(--text-muted)] py-4">Rankings need one currency. Choose a currency filter above.</p>
            : (
              <EnterpriseTable columns={assetColumns} data={rollups.assets} getRowId={(a) => a.asset_no}
                loading={!loaded && !error} emptyMessage="No toll charges carry an asset number." enableExport={false}
                enableColumnFilters={false} enableColumnVisibility={false} initialPageSize={25} searchPlaceholder="Search assets" />
            )}
        </div>
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><MapPin size={15} aria-hidden="true" /> Toll spend by plaza</h2>
          {summary.mixedCurrency
            ? <p className="text-sm text-[var(--text-muted)] py-4">Rankings need one currency. Choose a currency filter above.</p>
            : (
              <EnterpriseTable columns={plazaColumns} data={rollups.plazas} getRowId={(p) => p.plaza}
                loading={!loaded && !error} emptyMessage="No toll charges carry a plaza name." enableExport={false}
                enableColumnFilters={false} enableColumnVisibility={false} initialPageSize={25} searchPlaceholder="Search plazas" />
            )}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3 items-end">
          <div className="sm:col-span-2">
            <label htmlFor="toll-search" className="label">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="toll-search" className={`${FIELD} pl-9`} placeholder="Asset, driver, tag, plaza, highway, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          {countryOptions.length > 1 && (
            <div>
              <label htmlFor="toll-country" className="label">Country</label>
              <select id="toll-country" className={FIELD} value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
                <option value="">All countries</option>
                {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="toll-status" className="label">Status</label>
            <select id="toll-status" className={FIELD} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {TOLL_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="toll-method" className="label">Payment method</label>
            <select id="toll-method" className={FIELD} value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
              <option value="">All methods</option>
              {TOLL_METHODS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="toll-currency" className="label">Currency</label>
            <select id="toll-currency" className={FIELD} value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)}>
              <option value="">All currencies</option>
              {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="toll-from" className="label">From</label>
            <input id="toll-from" type="date" className={FIELD} value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="toll-to" className="label">To</label>
            <input id="toll-to" type="date" className={FIELD} value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear filters</button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{fmtNum(filtered.length)} of {fmtNum(all.length)} transactions</span>
        </div>
      </div>

      {/* Register */}
      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={!loaded && !error}
        error={error && !loaded ? error : null}
        onRetry={load}
        emptyMessage={all.length === 0 && !notProvisioned ? 'No toll transactions recorded yet. Add your first transaction.' : 'No transactions match these filters.'}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        viewKey="toll-transactions"
        initialPageSize={25}
      />

      {/* Create / Edit */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit toll transaction' : 'Add toll transaction'}
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="toll-form" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Add transaction'}
            </button>
          </div>
        }
      >
        <form id="toll-form" onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="tf-asset" className="label">Asset number <span className="text-red-400" aria-hidden="true">*</span></label>
              <input id="tf-asset" className={FIELD} placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} required onChange={(e) => set('asset_no', e.target.value)} />
            </div>
            <div>
              <label htmlFor="tf-driver" className="label">Driver (optional)</label>
              <input id="tf-driver" className={FIELD} placeholder="e.g. Ahmed Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="tf-plaza" className="label">Toll plaza (optional)</label>
              <input id="tf-plaza" className={FIELD} placeholder="e.g. Riyadh North Plaza" value={form.plaza_name} maxLength={200} onChange={(e) => set('plaza_name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="tf-highway" className="label">Highway (optional)</label>
              <input id="tf-highway" className={FIELD} placeholder="e.g. Highway 40" value={form.highway} maxLength={200} onChange={(e) => set('highway', e.target.value)} />
            </div>
            <div>
              <label htmlFor="tf-when" className="label">Transaction date and time</label>
              <input id="tf-when" className={FIELD} type="datetime-local" value={form.transaction_at} onChange={(e) => set('transaction_at', e.target.value)} />
            </div>
            <div>
              <label htmlFor="tf-tag" className="label">Tag ID (optional)</label>
              <input id="tf-tag" className={FIELD} placeholder="e.g. RFID-88231" value={form.tag_id} maxLength={120} onChange={(e) => set('tag_id', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="tf-amount" className="label">Amount</label>
              <input id="tf-amount" className={FIELD} type="number" step="0.01" min="0" inputMode="decimal" placeholder="25.00" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
            </div>
            <div>
              <label htmlFor="tf-currency" className="label">Currency (optional)</label>
              <input id="tf-currency" className={FIELD} placeholder="SAR" value={form.currency} maxLength={12} onChange={(e) => set('currency', e.target.value)} />
            </div>
            <div>
              <label htmlFor="tf-method" className="label">Payment method</label>
              <select id="tf-method" className={FIELD} value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
                <option value="">None</option>
                {TOLL_METHODS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="tf-status" className="label">Status</label>
              <select id="tf-status" className={FIELD} value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">None</option>
                {TOLL_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="tf-notes" className="label">Notes (optional)</label>
            <textarea id="tf-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. disputed, duplicate charge on same trip" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this transaction?"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-secondary)]">
            {confirmDelete.asset_no || 'Transaction'} | {fmtAmount(confirmDelete.amount, currencyOf(confirmDelete))} | {fmtDateTime(confirmDelete.transaction_at)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
