/**
 * DriverExpenses (route /driver-expenses) - per-driver cost claims (fuel, tolls,
 * per-diem, repairs, maintenance) with a full approval + reimbursement lifecycle
 * and a deep spend-intelligence layer.
 *
 * Wired to Tyre Pulse's Supabase-backed `driver_expenses` table (V152) via the
 * service layer. Real columns only: driver_name, category, amount, expense_date,
 * asset_no, status (pending|approved|rejected|reimbursed), description. Every
 * metric is derived from real rows via src/lib/driverExpensesAnalytics.js with
 * honest empty / null states (NEVER fabricated).
 *
 * Includes: 8 KPI tiles (claims, total spend, avg claim, approval rate, pending
 * value, reimbursement outstanding, reimbursed, drivers), a category-spend
 * doughnut, a 12-month submitted-vs-approved trend, a top-spenders ranking, a
 * searchable / filterable (driver, category, status, date range) sortable table
 * with status badges, create/edit/delete, and Excel/PDF export. Loading /
 * error+Retry / empty states throughout. Degrades to an "apply migration" prompt
 * when the table is absent.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Tooltip, Legend, Filler,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'
import {
  Wallet, Receipt, DollarSign, Users, Plus, Pencil, Trash2, Search, X, Filter,
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, User, Percent,
  Clock, CircleDollarSign, CheckCircle2, TrendingUp, PieChart, Tag,
  ArrowUp, ArrowDown, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  listExpenses, createExpense, updateExpense, deleteExpense,
  EXPENSE_STATUSES, EXPENSE_CATEGORIES,
} from '../lib/api/driverExpenses'
import {
  analyzeExpenses, filterExpenses, sortExpenses, distinctValues, distinctCategories,
  statusLabel, categoryLabel, normStatus, normCategory,
} from '../lib/driverExpensesAnalytics'
import { toUserMessage } from '../lib/safeError'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'

ChartJS.register(
  ArcElement, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Tooltip, Legend, Filler,
)

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
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
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
      setError(toUserMessage(err, 'Could not save the expense claim.'))
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
            placeholder="Optional notes about this claim..."
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
            {busy ? 'Saving...' : 'Save claim'}
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
    try { await onConfirm() } catch (e) { setError(toUserMessage(e, 'Could not delete.')); setBusy(false) }
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

// ─── Top-spenders ranking card ────────────────────────────────────────────────
function SpendersCard({ rows, currency, loading }) {
  const fmt = (v) => formatCurrencyCompact(v, currency)
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 inline-flex items-center gap-2">
        <Users size={15} className="text-[var(--text-muted)]" /> Top spenders
      </h3>
      {loading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-8 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-sm text-[var(--text-muted)]">No driver spend recorded.</div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r, i) => (
            <li key={r.driver}>
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2 text-[var(--text-secondary)] truncate">
                  <span className="w-5 text-xs text-[var(--text-muted)] tabular-nums">{i + 1}.</span>
                  <span className="truncate font-medium text-[var(--text-primary)]">{r.driver}</span>
                  <span className="text-xs text-[var(--text-muted)]">({r.count})</span>
                </span>
                <span className="font-semibold text-[var(--text-primary)] tabular-nums shrink-0">{fmt(r.value)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(3, (r.value / max) * 100)}%`, background: colorAt(i) }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Sortable table header ────────────────────────────────────────────────────
function SortTh({ label, field, sort, onSort, className = '' }) {
  const active = sort.field === field
  return (
    <th className={`px-4 py-3 font-semibold whitespace-nowrap select-none cursor-pointer hover:text-[var(--text-secondary)] ${className}`} onClick={() => onSort(field)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </span>
    </th>
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
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [driverFilter, setDriverFilter] = useState('')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [sort, setSort] = useState({ field: 'expense_date', dir: 'desc' })

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
      else { setError(toUserMessage(err, 'Could not load expense claims.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  const analysis = useMemo(() => analyzeExpenses(rows || [], { topN: 8 }), [rows])
  const k = analysis.kpis

  const driverOptions = useMemo(() => distinctValues(rows || [], 'driver_name'), [rows])
  const categoryOptions = useMemo(() => distinctCategories(rows || []), [rows])

  const filtered = useMemo(() => {
    const f = filterExpenses(rows || [], {
      status: statusFilter, category: categoryFilter, driver: driverFilter,
      search, from: fromDate, to: toDate,
    })
    return sortExpenses(f, sort.field, sort.dir)
  }, [rows, statusFilter, categoryFilter, driverFilter, search, fromDate, toDate, sort])

  // Analytics for the filtered subset drive the KPI + charts, so the page reflects
  // whatever the user has narrowed to (falls back to all when no filters active).
  const view = useMemo(() => analyzeExpenses(filtered, { topN: 8 }), [filtered])

  const fmtMoney = useCallback((v) => formatCurrencyCompact(v, activeCurrency), [activeCurrency])

  const onSort = (field) => setSort((s) => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' }))

  // ── KPI tiles (8) ──
  const vk = view.kpis
  const kpis = [
    { label: 'Total claims', value: loading ? 'N/A' : vk.total, sub: `${vk.drivers} drivers`, icon: Receipt, tone: 'text-[var(--text-primary)]' },
    { label: 'Total spend', value: loading ? 'N/A' : fmtMoney(vk.totalValue), sub: `${vk.thisPeriodCount} in ${vk.periodDays}d`, icon: DollarSign, tone: 'text-[var(--brand-bright)]' },
    { label: 'Avg claim', value: loading ? 'N/A' : (vk.avgClaim == null ? 'N/A' : fmtMoney(vk.avgClaim)), sub: 'per claim', icon: CircleDollarSign, tone: 'text-indigo-400' },
    { label: 'Approval rate', value: loading ? 'N/A' : (vk.approvalRate == null ? 'N/A' : `${vk.approvalRate}%`), sub: `${vk.decidedCount} decided`, icon: Percent, tone: 'text-emerald-400' },
    { label: 'Pending', value: loading ? 'N/A' : vk.pendingCount, sub: fmtMoney(vk.pendingValue), icon: Clock, tone: 'text-amber-400' },
    { label: 'Outstanding', value: loading ? 'N/A' : fmtMoney(vk.reimbursementOutstanding), sub: 'approved, unpaid', icon: Wallet, tone: 'text-sky-400' },
    { label: 'Reimbursed', value: loading ? 'N/A' : fmtMoney(vk.reimbursedValue), sub: 'paid out', icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Rejected', value: loading ? 'N/A' : fmtMoney(vk.rejectedValue), sub: `${vk.byStatusCount.rejected} claims`, icon: X, tone: 'text-red-400' },
  ]

  // ── Charts ──
  const catItems = view.categories
  const catDonut = useMemo(() => ({
    labels: catItems.map((c) => c.label),
    datasets: [{
      data: catItems.map((c) => c.value),
      backgroundColor: categorical(catItems.length),
      borderColor: 'var(--card-bg)',
      borderWidth: 2,
    }],
  }), [catItems])

  const donutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '62%',
    plugins: {
      legend: { position: 'right', labels: { color: 'var(--text-secondary)', font: { size: 11 }, boxWidth: 12, padding: 8 } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const c = catItems[ctx.dataIndex]
            return `${c.label}: ${fmtMoney(c.value)} (${c.pct}%, ${c.count})`
          },
        },
      },
    },
  }

  const trend = view.trend
  const trendData = useMemo(() => ({
    labels: trend.map((b) => b.label),
    datasets: [
      { type: 'bar', label: 'Submitted', data: trend.map((b) => b.value), backgroundColor: withAlpha(colorAt(0), 0.55), borderColor: colorAt(0), borderWidth: 1, borderRadius: 4, order: 2 },
      { type: 'line', label: 'Approved', data: trend.map((b) => b.approvedValue), borderColor: colorAt(2), backgroundColor: withAlpha(colorAt(2), 0.15), pointRadius: 2, tension: 0.3, fill: true, order: 1 },
    ],
  }), [trend])

  const trendOpts = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { color: 'var(--text-secondary)', font: { size: 11 }, boxWidth: 12 } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y)}` } },
    },
    scales: {
      x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
      y: { ticks: { color: 'var(--text-muted)', font: { size: 10 }, callback: (v) => fmtMoney(v) }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
    },
  }

  const hasTrend = trend.some((b) => b.value > 0 || b.count > 0)

  // ── Export (respects the active filter + sort) ──
  const EXPORT_COLS = ['driver_name', 'category', 'amount', 'expense_date', 'asset_no', 'status', 'description']
  const EXPORT_HEADERS = ['Driver', 'Category', 'Amount', 'Expense date', 'Asset', 'Status', 'Description']
  const exportRows = filtered.map((r) => ({
    driver_name: r.driver_name || '', category: categoryLabel(r.category) || '', amount: r.amount ?? '',
    expense_date: r.expense_date || '', asset_no: r.asset_no || '',
    status: statusLabel(r.status), description: r.description || '',
  }))

  const clearFilters = () => {
    setStatusFilter('all'); setCategoryFilter('all'); setDriverFilter(''); setSearch(''); setFromDate(''); setToDate('')
  }
  const hasFilters = statusFilter !== 'all' || categoryFilter !== 'all' || driverFilter || search || fromDate || toDate

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (row) => { setEditing(row); setModalOpen(true) }
  const onSaved = () => { setModalOpen(false); setEditing(null); load() }
  const confirmDelete = async () => { await deleteExpense(deleting.id); setDeleting(null); load() }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Expenses"
        subtitle="Log, review and reimburse driver expense claims across the fleet, with spend intelligence, approval tracking and export."
        icon={Wallet}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={async () => { try { await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'driver_expenses', 'Expenses', { currency: activeCurrency }) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
              className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}
            >
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button
              onClick={async () => { try { await exportToPdf(exportRows, EXPORT_COLS.map((c, i) => ({ key: c, header: EXPORT_HEADERS[i] })), 'Driver Expenses', 'driver_expenses', 'landscape', '', { currency: activeCurrency }) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
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
            <p className="text-amber-300 font-medium">Driver expenses aren't enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V152_DRIVER_EXPENSES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && !missing && (
        <div className="card border border-red-800/50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div><p className="text-red-300 font-medium">Couldn't load expense claims.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0"><RefreshCw size={14} /> Retry</button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((tile) => {
          const Icon = tile.icon
          return (
            <div key={tile.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{tile.label}</p>
                <Icon size={16} className={tile.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${tile.tone}`}>{tile.value}</p>
              {!loading && tile.sub && <p className="text-xs text-[var(--text-muted)] mt-1">{tile.sub}</p>}
            </div>
          )
        })}
      </div>

      {/* Charts row: category doughnut + submitted-vs-approved trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 inline-flex items-center gap-2">
            <PieChart size={15} className="text-[var(--text-muted)]" /> Spend by category
          </h3>
          <div className="h-64">
            {loading
              ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : catItems.length
                ? <Doughnut data={catDonut} options={donutOpts} />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No categorized spend yet.</div>}
          </div>
        </div>

        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 inline-flex items-center gap-2">
            <TrendingUp size={15} className="text-[var(--text-muted)]" /> Submitted vs approved spend (last 12 months)
          </h3>
          <div className="h-64">
            {loading
              ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : hasTrend
                ? <Bar data={trendData} options={trendOpts} />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No dated claims to trend.</div>}
          </div>
        </div>
      </div>

      {/* Top spenders */}
      <SpendersCard rows={view.topDrivers} currency={activeCurrency} loading={loading} />

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search driver, category, asset, notes..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
          </select>
          <select className="input" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} aria-label="Driver">
            <option value="">All drivers</option>
            {driverOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
            From <input type="date" className="input py-1" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
          </label>
          <label className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
            To <input type="date" className="input py-1" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
          </label>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto inline-flex items-center gap-2">
            <Tag size={13} /> {filtered.length} of {analysis.kpis.total}
            {!loading && filtered.length > 0 && <span className="text-[var(--text-secondary)]">| {fmtMoney(view.kpis.totalValue)}</span>}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <SortTh label="Driver" field="driver_name" sort={sort} onSort={onSort} />
                <SortTh label="Category" field="category" sort={sort} onSort={onSort} />
                <SortTh label="Amount" field="amount" sort={sort} onSort={onSort} />
                <SortTh label="Date" field="expense_date" sort={sort} onSort={onSort} />
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Asset</th>
                <SortTh label="Status" field="status" sort={sort} onSort={onSort} />
                <th className="px-4 py-3 font-semibold whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    <Filter size={22} className="mx-auto mb-2 opacity-60" />
                    {analysis.kpis.total === 0 ? 'No expense claims yet. Add the first one.' : 'No claims match these filters.'}
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const st = STATUS_META[normStatus(r.status)] || STATUS_META.pending
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">
                        <span className="inline-flex items-center gap-2"><User size={13} className="text-[var(--text-muted)]" />{r.driver_name || 'N/A'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.category ? categoryLabel(r.category) : 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] font-medium tabular-nums">{r.amount == null || r.amount === '' ? 'N/A' : fmtMoney(r.amount)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.expense_date)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || 'N/A'}</td>
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
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 - refine filters or export for the full set.</p>}
      </div>

      <ExpenseModal open={modalOpen} initial={editing} onClose={() => { setModalOpen(false); setEditing(null) }} onSaved={onSaved} />
      <DeleteDialog row={deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />
    </div>
  )
}
