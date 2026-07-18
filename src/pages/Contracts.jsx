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
  FileText, Plus, Search, X, Filter, Trash2, Pencil, AlertTriangle,
  CheckCircle2, Clock, DollarSign, CalendarClock, Loader2, FileSpreadsheet,
  BarChart3, PieChart, TrendingUp, Building2, Layers, Repeat, ArrowUpDown,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listContracts, createContract, updateContract, deleteContract,
  CONTRACT_STATUSES, CONTRACT_TYPES,
} from '../lib/api/contracts'
import {
  buildContractKpis, statusDistribution, valueByType, valueByVendor,
  renewalPipeline, enrichContracts, autoRenewSplit,
} from '../lib/contractsAnalytics'
import { formatCurrencyCompact } from '../lib/formatters'
import { colorAt, categorical, withAlpha, ACCENTS } from '../lib/reportColors'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

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

const SORTS = [
  { key: 'expiry', label: 'Soonest expiry' },
  { key: 'value', label: 'Highest value' },
  { key: 'recent', label: 'Newest' },
  { key: 'title', label: 'Title A-Z' },
]

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
      backgroundColor: 'var(--panel-2)', titleColor: '#f3f4f6', bodyColor: '#cbd5e1',
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
              <label className="label">Vendor / counterparty</label>
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
              <label className="label">End / renewal date</label>
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
            <textarea className="input w-full min-h-[90px] resize-y" placeholder="Terms, SLAs, renewal conditions"
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
              {busy ? 'Saving...' : editing ? 'Save changes' : 'Create contract'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Small presentational helpers ───────────────────────────────────────────────
function ChartCard({ title, icon: Icon, empty, children }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon size={15} className="text-[var(--brand-bright)]" />}
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      </div>
      {empty ? (
        <div className="h-[220px] flex flex-col items-center justify-center text-center text-[var(--text-muted)] text-sm">
          <BarChart3 size={22} className="mb-2 opacity-50" />
          No data to chart yet.
        </div>
      ) : (
        <div className="h-[220px]">{children}</div>
      )}
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
  const [typeFilter, setTypeFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('')
  const [expiryFilter, setExpiryFilter] = useState('all') // all | 30 | 60 | 90
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('expiry')

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
      setError(toUserMessage(err, 'Could not load contracts.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Single reference clock so status/analytics are stable across the render.
  const now = Date.now()
  const enriched = useMemo(() => enrichContracts(rows || [], now), [rows, now])
  const kpis = useMemo(() => buildContractKpis(rows || [], now), [rows, now])
  const statusDist = useMemo(() => statusDistribution(rows || [], now), [rows, now])
  const byType = useMemo(() => valueByType(rows || [], now), [rows, now])
  const byVendor = useMemo(() => valueByVendor(rows || [], now, { limit: 8 }), [rows, now])
  const pipeline = useMemo(() => renewalPipeline(rows || [], now, { months: 12 }), [rows, now])
  const autoRenew = useMemo(() => autoRenewSplit(rows || [], now), [rows, now])

  const vendorOptions = useMemo(
    () => [...new Set(enriched.map((r) => r.vendor).filter(Boolean))].sort(),
    [enriched],
  )
  const typeOptions = useMemo(
    () => [...new Set(enriched.map((r) => r.contract_type).filter(Boolean))].sort(),
    [enriched],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const expWindow = expiryFilter === 'all' ? null : Number(expiryFilter)
    const list = enriched.filter((r) => {
      if (statusFilter !== 'all' && r._status !== statusFilter) return false
      if (typeFilter !== 'all' && (r.contract_type || '') !== typeFilter) return false
      if (vendorFilter && r.vendor !== vendorFilter) return false
      if (expWindow != null && !(r._days != null && r._days >= 0 && r._days <= expWindow && r._status !== 'cancelled')) return false
      if (fromDate && (!r.end_date || String(r.end_date).slice(0, 10) < fromDate)) return false
      if (toDate && (!r.end_date || String(r.end_date).slice(0, 10) > toDate)) return false
      if (q) {
        const hay = `${r.title || ''} ${r.vendor || ''} ${r.contract_type || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const sorted = [...list]
    if (sortKey === 'expiry') {
      sorted.sort((a, b) => (a._days ?? Infinity) - (b._days ?? Infinity))
    } else if (sortKey === 'value') {
      sorted.sort((a, b) => (b._value ?? -Infinity) - (a._value ?? -Infinity))
    } else if (sortKey === 'title') {
      sorted.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
    } else {
      sorted.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    }
    return sorted
  }, [enriched, statusFilter, typeFilter, vendorFilter, expiryFilter, fromDate, toDate, search, sortKey])

  const onDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this contract? This cannot be undone.')) return
    setDeletingId(id); setError('')
    try {
      await deleteContract(id)
      setRows((prev) => (prev || []).filter((r) => r.id !== id))
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the contract.'))
    } finally {
      setDeletingId(null)
    }
  }, [])

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (row) => { setEditing(row); setModalOpen(true) }
  const onSaved = () => { setModalOpen(false); setEditing(null); load() }

  const clearFilters = () => {
    setStatusFilter('all'); setTypeFilter('all'); setVendorFilter('')
    setExpiryFilter('all'); setFromDate(''); setToDate(''); setSearch('')
  }
  const hasFilters = statusFilter !== 'all' || typeFilter !== 'all' || vendorFilter ||
    expiryFilter !== 'all' || fromDate || toDate || search

  // Export -------------------------------------------------------------------
  const EXPORT_COLS = ['title', 'vendor', 'contract_type', 'start_date', 'end_date', 'value', 'annualized', 'currency', 'status', 'days_remaining']
  const EXPORT_HEADERS = ['Title', 'Vendor', 'Type', 'Start', 'End / renewal', 'Value', 'Annualized', 'Currency', 'Status', 'Days left']
  const exportRows = filtered.map((r) => ({
    title: r.title || '', vendor: r.vendor || '', contract_type: r.contract_type || '',
    start_date: fmtDate(r.start_date), end_date: fmtDate(r.end_date),
    value: r._value ?? '', annualized: r._annualized != null ? Math.round(r._annualized) : 'N/A',
    currency: r.currency || activeCurrency,
    status: STATUS_META[r._status]?.label || r._status,
    days_remaining: r._days ?? 'N/A',
  }))

  const kpiTiles = [
    { label: 'Total contracts', value: kpis.total, icon: FileText, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: kpis.active, icon: CheckCircle2, tone: 'text-green-400' },
    { label: `Expiring <=${kpis.urgentDays}d`, value: kpis.expiringUrgentCount, icon: AlertTriangle, tone: 'text-red-400' },
    { label: `Expiring <=${kpis.soonDays}d`, value: kpis.expiringSoonCount, icon: CalendarClock, tone: 'text-amber-400' },
    { label: 'Expired', value: kpis.expired, icon: Clock, tone: 'text-[var(--text-muted)]' },
    { label: 'Live value', value: formatCurrencyCompact(kpis.totalValue, activeCurrency), icon: DollarSign, tone: 'text-[var(--brand-bright)]' },
    {
      label: 'Annualized live',
      value: kpis.liveAnnualizedValue == null ? 'N/A' : formatCurrencyCompact(kpis.liveAnnualizedValue, activeCurrency),
      icon: TrendingUp, tone: 'text-sky-400',
    },
    {
      label: 'Next renewal',
      value: kpis.nextRenewal ? `${kpis.nextRenewal.daysRemaining}d` : 'N/A',
      sub: kpis.nextRenewal ? kpis.nextRenewal.contract.title : null,
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
      label: `Value (${activeCurrency})`,
      data: byType.map((t) => Math.round(t.value)),
      backgroundColor: byType.map((_, i) => withAlpha(colorAt(i), 0.85)),
      borderRadius: 4,
    }],
  }
  const pipelineChart = {
    labels: pipeline.map((b) => b.label),
    datasets: [
      {
        label: 'Contracts',
        data: pipeline.map((b) => b.count),
        backgroundColor: withAlpha(ACCENTS?.primary || '#6366f1', 0.85),
        borderRadius: 4, yAxisID: 'y',
      },
    ],
  }

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
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'contracts')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Contracts', 'contracts', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
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
          <div className="min-w-0">
            <p className="text-red-300 font-medium">Something went wrong.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
            <button onClick={load} className="btn-secondary text-sm mt-2 inline-flex items-center gap-1.5"><Loader2 size={13} className={refreshing ? 'animate-spin' : ''} /> Retry</button>
          </div>
        </div>
      )}

      {missing ? (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Contracts are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V131_CONTRACTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Expiring-soon banner */}
          {kpis.expiringSoonCount > 0 && (
            <div className="card border border-amber-800/50 flex items-start gap-3">
              <CalendarClock size={18} className="text-amber-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-amber-300 font-medium">
                  {kpis.expiringSoonCount} contract{kpis.expiringSoonCount !== 1 ? 's' : ''} expiring within {kpis.soonDays} days
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {enriched
                    .filter((c) => c._days != null && c._days >= 0 && c._days <= kpis.soonDays && c._status !== 'cancelled')
                    .sort((a, b) => a._days - b._days)
                    .slice(0, 6)
                    .map((c) => (
                      <button key={c.id} onClick={() => { setExpiryFilter('60'); }} className="text-xs bg-amber-900/40 text-amber-300 border border-amber-700/50 px-2 py-0.5 rounded-full hover:bg-amber-900/60">
                        {c.title} : {c._days}d left
                      </button>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {kpiTiles.map((k) => {
              const Icon = k.icon
              return (
                <div key={k.label} className="card">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                    <Icon size={16} className={k.tone} />
                  </div>
                  <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{rows === null ? '-' : k.value}</p>
                  {k.sub && <p className="text-xs text-[var(--text-muted)] truncate mt-0.5" title={k.sub}>{k.sub}</p>}
                </div>
              )
            })}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard title="Status distribution" icon={PieChart} empty={rows !== null && statusDist.length === 0}>
              <Doughnut data={statusChart} options={{ ...CHART_BASE, cutout: '62%' }} />
            </ChartCard>
            <ChartCard title={`Value by type (${activeCurrency})`} icon={Layers} empty={rows !== null && byType.every((t) => t.value === 0)}>
              <Bar data={typeChart} options={{
                ...CHART_BASE,
                plugins: { ...CHART_BASE.plugins, legend: { display: false } },
                scales: {
                  x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
                  y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
                },
              }} />
            </ChartCard>
            <ChartCard title="Renewal pipeline (12 mo)" icon={CalendarClock} empty={rows !== null && pipeline.every((b) => b.count === 0)}>
              <Bar data={pipelineChart} options={{
                ...CHART_BASE,
                plugins: { ...CHART_BASE.plugins, legend: { display: false } },
                scales: {
                  x: { ticks: { color: 'var(--text-muted)', font: { size: 9 }, maxRotation: 60, minRotation: 45 }, grid: { display: false } },
                  y: { beginAtZero: true, ticks: { color: 'var(--text-muted)', font: { size: 10 }, precision: 0 }, grid: { color: 'var(--panel-2)' } },
                },
              }} />
            </ChartCard>
          </div>

          {/* Vendor exposure + auto-renew note */}
          {(byVendor.length > 0 || rows !== null) && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="card lg:col-span-2">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 size={15} className="text-[var(--brand-bright)]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Spend exposure by vendor</h3>
                </div>
                {byVendor.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] py-6 text-center">No vendor data yet.</p>
                ) : (
                  <div className="space-y-2">
                    {byVendor.map((v, i) => {
                      const max = byVendor[0].value || 1
                      const pct = max > 0 ? Math.max(2, Math.round((v.value / max) * 100)) : 0
                      return (
                        <div key={v.type} className="flex items-center gap-3">
                          <span className="text-xs text-[var(--text-secondary)] w-28 truncate" title={v.type}>{v.type}</span>
                          <div className="flex-1 h-4 bg-[var(--input-bg)] rounded overflow-hidden">
                            <div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: withAlpha(colorAt(i), 0.85) }} />
                          </div>
                          <span className="text-xs text-[var(--text-secondary)] w-24 text-right whitespace-nowrap">{formatCurrencyCompact(v.value, activeCurrency)}</span>
                          <span className="text-xs text-[var(--text-muted)] w-14 text-right whitespace-nowrap">{v.count} ctr</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <Repeat size={15} className="text-[var(--brand-bright)]" />
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
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input className="input pl-9 w-full" placeholder="Search title, vendor, type, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                <option value="30">Expiring &lt;=30d</option>
                <option value="60">Expiring &lt;=60d</option>
                <option value="90">Expiring &lt;=90d</option>
              </select>
              <select className="input" value={sortKey} onChange={(e) => setSortKey(e.target.value)} aria-label="Sort">
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1"><ArrowUpDown size={12} /> Renewal between</label>
              <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="Renewal from" />
              <span className="text-xs text-[var(--text-muted)]">and</span>
              <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="Renewal to" />
              {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
              <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {kpis.total}</span>
            </div>
          </div>

          {/* Table */}
          <div className="card overflow-hidden !p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    {['Contract', 'Vendor', 'Type', 'Start', 'End / renewal', 'Value', 'Annualized', 'Status', ''].map((h, i) => (
                      <th key={h || `act-${i}`} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows === null ? (
                    [0, 1, 2, 3, 4].map((i) => (
                      <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                      {kpis.total === 0 ? (
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
                          <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.vendor || 'N/A'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] capitalize">{r.contract_type || 'N/A'}</td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.start_date)}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={urgent ? 'text-amber-300 font-medium' : 'text-[var(--text-secondary)]'}>{fmtDate(r.end_date)}</span>
                            {r._days != null && r._days >= 0 && r._days <= 60 && (
                              <span className={`ml-1.5 text-xs ${r._days <= 7 ? 'text-red-400' : 'text-amber-400'}`}>({r._days}d)</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                            {r._value == null ? 'N/A' : formatCurrencyCompact(r._value, r.currency || activeCurrency)}
                          </td>
                          <td className="px-4 py-2.5 text-[var(--text-muted)] whitespace-nowrap">
                            {r._annualized == null ? 'N/A' : formatCurrencyCompact(r._annualized, r.currency || activeCurrency)}
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
