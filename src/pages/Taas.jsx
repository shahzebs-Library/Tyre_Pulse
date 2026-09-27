/**
 * Taas (route /taas): Tyre-as-a-Service. Manages subscription / usage-billing
 * contracts that turn tyre servicing into recurring revenue: per-km, per-month,
 * per-tyre, or hybrid plans. Tracks cost-per-km, km utilisation, monthly
 * recurring revenue (MRR), and upcoming renewals so the commercial team can
 * price, forecast, and retain contracts.
 *
 * Runs on the `taas_subscriptions` table (V195). Real data only: KPI strip, a
 * by-plan revenue breakdown, a renewals-due attention list, filters + search, a
 * sortable paged EnterpriseTable, create/edit dialog, delete confirm, Excel/PDF
 * export of the whole filtered set, and loading / empty / error+Retry /
 * not-provisioned states. Money is never blended across currencies. All
 * calculation lives in the pure `src/lib/taasAnalytics.js` engine.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Repeat, CircleDollarSign, Activity, Package, CalendarClock, AlertTriangle,
  Search, X, FileSpreadsheet, FileText, Plus, Pencil, Trash2, Layers, Wallet, TrendingUp,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTaasSubscriptions, createTaasSubscription, updateTaasSubscription,
  deleteTaasSubscription,
} from '../lib/api/taas'
import {
  taasKpis, byPlan, costPerKm, kmUtilization, daysToRenewal, filterTaas,
  renewalsDue, renewalLabel, isLive, taasExportRows, EXPORT_COLS, EXPORT_HEADERS,
  PLAN_TYPES, STATUSES, PLAN_LABEL, STATUS_LABEL,
} from '../lib/taasAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { formatCurrency, formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_FORM = {
  subscription_no: '', customer_name: '', asset_no: '', plan_type: 'per_km',
  tyres_covered: '', rate: '', rate_unit: '', committed_km: '', actual_km: '',
  monthly_fee: '', currency: '', start_date: '', renewal_date: '',
  billed_to_date: '', status: 'active', notes: '',
}

const PLAN_BADGE = {
  per_km: 'bg-indigo-500/15 text-indigo-500 border-indigo-500/30',
  per_month: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  per_tyre: 'bg-violet-500/15 text-violet-500 border-violet-500/30',
  hybrid: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  unspecified: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}
const STATUS_BADGE = {
  active: 'bg-green-500/15 text-green-500 border-green-500/30',
  trial: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  paused: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  cancelled: 'bg-red-500/15 text-red-500 border-red-500/30',
  expired: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]'

const fmtDate = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

function Badge({ label, cls }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>
}

/** Utilisation bar: band colour plus the number and an "over" word, so colour is never the only signal. */
function UtilBar({ pct }) {
  if (pct == null) return <span className="text-[var(--text-muted)]">N/A</span>
  const capped = Math.min(pct, 100)
  const over = pct > 100
  const tone = over ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : 'bg-green-500'
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
        <div className={`h-full ${tone}`} style={{ width: `${capped}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums text-[var(--text-secondary)]">{Math.round(pct)}%{over ? ' over' : ''}</span>
    </div>
  )
}

function Kpi({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums break-words ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function Taas() {
  const { activeCountry, activeCurrency } = useSettings()
  const currency = activeCurrency || 'SAR'
  const nowMs = useMemo(() => Date.now(), [])

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')

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
      const data = await listTaasSubscriptions({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else setError(toUserMessage(err, 'Could not load TaaS subscriptions.'))
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loaded = Array.isArray(rows)
  const kpi = useMemo(() => (loaded ? taasKpis(rows, { now: nowMs, currency }) : null), [rows, loaded, nowMs, currency])
  const planBreakdown = useMemo(() => byPlan(rows || []), [rows])
  const renewals = useMemo(() => renewalsDue(rows || [], nowMs, 30, 12), [rows, nowMs])
  const countryOptions = useMemo(() => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(), [rows])

  const filtered = useMemo(
    () => filterTaas(rows || [], { plan: planFilter, status: statusFilter, country: countryFilter, search }),
    [rows, planFilter, statusFilter, countryFilter, search],
  )
  const exportRows = useMemo(() => taasExportRows(filtered, currency), [filtered, currency])
  const fileBase = () => reportFileName('TyrePulse TaaS Subscriptions', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())

  const doExport = async (kind) => {
    setActionError('')
    try {
      if (kind === 'xlsx') await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileBase(), 'TaaS', { currency, title: 'Tyre-as-a-Service Subscriptions' })
      else await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Tyre-as-a-Service Subscriptions', fileBase(), 'landscape', '', { currency })
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      subscription_no: r.subscription_no || '', customer_name: r.customer_name || '',
      asset_no: r.asset_no || '', plan_type: r.plan_type || 'per_km',
      tyres_covered: r.tyres_covered ?? '', rate: r.rate ?? '', rate_unit: r.rate_unit || '',
      committed_km: r.committed_km ?? '', actual_km: r.actual_km ?? '',
      monthly_fee: r.monthly_fee ?? '', currency: r.currency || '',
      start_date: r.start_date || '', renewal_date: r.renewal_date || '',
      billed_to_date: r.billed_to_date ?? '', status: r.status || 'active', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.customer_name.trim()) { setFormError('A customer name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        currency: form.currency || currency,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateTaasSubscription(editing.id, payload)
      else await createTaasSubscription(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the subscription.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, currency, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTaasSubscription(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the subscription.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setSearch(''); setPlanFilter(''); setStatusFilter(''); setCountryFilter('') }
  const hasFilters = search || planFilter || statusFilter || countryFilter
  const maxPlanMrr = Math.max(1, ...planBreakdown.map((p) => p.mrr))

  const columns = useMemo(() => [
    {
      id: 'customer', header: 'Customer', accessorFn: (r) => r.customer_name || '', size: 200,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="font-medium text-[var(--text-primary)] truncate">{row.original.customer_name || 'N/A'}</p>
          <p className="text-[11px] text-[var(--text-muted)] truncate">{row.original.subscription_no || row.original.asset_no || 'N/A'}</p>
        </div>
      ),
    },
    {
      id: 'plan', header: 'Plan', accessorFn: (r) => PLAN_LABEL[r.plan_type] || r.plan_type || 'N/A', size: 110, meta: { filterVariant: 'select' },
      cell: ({ row }) => <Badge label={PLAN_LABEL[row.original.plan_type] || row.original.plan_type || 'N/A'} cls={PLAN_BADGE[row.original.plan_type] || PLAN_BADGE.unspecified} />,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => STATUS_LABEL[r.status] || r.status || 'N/A', size: 110, meta: { filterVariant: 'select' },
      cell: ({ row }) => <Badge label={STATUS_LABEL[row.original.status] || row.original.status || 'N/A'} cls={STATUS_BADGE[row.original.status] || STATUS_BADGE.expired} />,
    },
    { id: 'tyres', header: 'Tyres', accessorFn: (r) => (r.tyres_covered == null ? -1 : Number(r.tyres_covered)), size: 80, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.tyres_covered ?? 'N/A'}</span> },
    { id: 'util', header: 'Utilisation', accessorFn: (r) => kmUtilization(r) ?? -1, size: 150, cell: ({ row }) => <UtilBar pct={kmUtilization(row.original)} /> },
    {
      id: 'cpk', header: 'Cost / km', accessorFn: (r) => costPerKm(r) ?? -1, size: 110, meta: { align: 'right' },
      cell: ({ row }) => { const c = costPerKm(row.original); return <span className="font-semibold tabular-nums text-[var(--text-primary)]">{c == null ? 'N/A' : formatCurrency(c, row.original.currency || currency, 3)}</span> },
    },
    {
      id: 'fee', header: 'Monthly fee', accessorFn: (r) => (r.monthly_fee == null ? -1 : Number(r.monthly_fee)), size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.monthly_fee == null ? 'N/A' : formatCurrency(row.original.monthly_fee, row.original.currency || currency, 0)}</span>,
    },
    {
      id: 'renewal', header: 'Renewal', accessorFn: (r) => r.renewal_date || '', size: 130,
      cell: ({ row }) => {
        const r = row.original
        const days = daysToRenewal(r, nowMs)
        return (
          <span className="whitespace-nowrap">
            <span className="text-[var(--text-secondary)]">{fmtDate(r.renewal_date)}</span>
            {days != null && isLive(r) && days <= 30 && (
              <span className={`block text-[11px] font-medium ${days < 0 ? 'text-red-500' : days <= 7 ? 'text-orange-500' : 'text-amber-500'}`}>{renewalLabel(days)}</span>
            )}
          </span>
        )
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit subscription for ${row.original.customer_name || 'customer'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:text-red-500`} aria-label={`Delete subscription for ${row.original.customer_name || 'customer'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit, currency, nowMs])

  const mrrValue = !kpi ? 'N/A' : kpi.mrr == null ? 'N/A' : formatCurrencyCompact(kpi.mrr, kpi.mrrCurrency || currency)
  const mrrSub = !kpi ? null : kpi.mixedCurrency
    ? `Mixed currencies: ${Object.entries(kpi.mrrByCurrency).map(([c, v]) => formatCurrencyCompact(v, c)).join(', ')}`
    : `${kpi.liveCount} live contract(s)`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre-as-a-Service"
        subtitle="Manage subscription and usage-billing contracts (per-km, per-month, per-tyre, and hybrid plans) with cost-per-km, utilisation, MRR, and renewal tracking."
        icon={Repeat}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('xlsx')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> New subscription
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Tyre-as-a-Service is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V195_TAAS_SUBSCRIPTIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {actionError && (
        <div role="alert" className="card border border-red-500/40 flex items-start justify-between gap-3">
          <p className="text-sm text-red-500">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Subscriptions" value={kpi ? kpi.totalSubscriptions : 'N/A'} sub={kpi ? `${kpi.trialCount} on trial` : null} icon={Repeat} tone="text-[var(--text-primary)]" />
        <Kpi label="Active contracts" value={kpi ? kpi.activeCount : 'N/A'} icon={Activity} tone="text-green-500" />
        <Kpi label="Monthly recurring revenue" value={mrrValue} sub={mrrSub} icon={CircleDollarSign} tone="text-amber-500" />
        <Kpi label="Tyres covered" value={kpi ? kpi.totalTyresCovered.toLocaleString() : 'N/A'} icon={Package} tone="text-sky-500" />
        <Kpi label="Avg utilisation" value={kpi?.avgUtilization == null ? 'N/A' : `${kpi.avgUtilization}%`} sub={kpi ? `${kpi.overrunCount} over committed km` : null} icon={TrendingUp} tone="text-indigo-500" />
        <Kpi label="Renewals due (30d)" value={kpi ? kpi.renewalsDue30d : 'N/A'} sub={kpi ? `${kpi.renewalsOverdue} overdue` : null} icon={CalendarClock} tone={kpi && (kpi.renewalsDue30d > 0 || kpi.renewalsOverdue > 0) ? 'text-orange-500' : 'text-[var(--text-primary)]'} />
      </div>

      {/* Revenue by plan + Renewals due */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card" aria-labelledby="taas-plan">
          <h2 id="taas-plan" className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Layers size={15} aria-hidden="true" /> Revenue by plan
          </h2>
          {!loaded && !error ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : !loaded ? (
            <p className="text-sm text-[var(--text-muted)]">Unavailable until the subscriptions load.</p>
          ) : planBreakdown.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No subscriptions yet.</p>
          ) : (
            <div className="space-y-3">
              {kpi?.mixedCurrency && (
                <p className="text-xs text-amber-500">Contracts use more than one currency, so revenue per plan is not totalled. Filter by country to compare in one currency.</p>
              )}
              {planBreakdown.map((p) => (
                <div key={p.plan_type}>
                  <div className="flex items-center justify-between text-sm mb-1 gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <Badge label={PLAN_LABEL[p.plan_type] || p.plan_type} cls={PLAN_BADGE[p.plan_type] || PLAN_BADGE.unspecified} />
                      <span className="text-[var(--text-muted)] text-xs">{p.count} contract{p.count === 1 ? '' : 's'}</span>
                    </span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">{kpi?.mixedCurrency ? 'N/A' : formatCurrency(p.mrr, kpi?.mrrCurrency || currency, 0)}</span>
                  </div>
                  {!kpi?.mixedCurrency && (
                    <div className="h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                      <div className="h-full bg-amber-500" style={{ width: `${(p.mrr / maxPlanMrr) * 100}%` }} />
                    </div>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-[var(--input-border)] text-sm">
                <span className="text-[var(--text-muted)] flex items-center gap-1.5"><Wallet size={14} aria-hidden="true" /> Total MRR</span>
                <span className="font-bold text-amber-500 tabular-nums">{kpi?.mrr == null ? 'N/A' : formatCurrency(kpi.mrr, kpi.mrrCurrency || currency, 0)}</span>
              </div>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="taas-renewals">
          <h2 id="taas-renewals" className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <CalendarClock size={15} aria-hidden="true" /> Renewals due (next 30 days)
          </h2>
          {!loaded && !error ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : !loaded ? (
            <p className="text-sm text-[var(--text-muted)]">Unavailable until the subscriptions load.</p>
          ) : renewals.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No live contracts renewing in the next 30 days.</p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-y-auto">
              {renewals.map(({ r, days }) => {
                const tone = days < 0 ? 'text-red-500' : days <= 7 ? 'text-orange-500' : 'text-amber-500'
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="w-full min-h-[44px] flex items-center justify-between gap-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-left hover:border-[var(--text-muted)] transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.customer_name || 'N/A'}</p>
                        <p className="text-[11px] text-[var(--text-muted)] truncate">
                          {r.subscription_no || r.asset_no || 'N/A'}, {PLAN_LABEL[r.plan_type] || r.plan_type || 'N/A'}, {fmtDate(r.renewal_date)}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold whitespace-nowrap ${tone}`}>{renewalLabel(days)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="taas-search" className="sr-only">Search subscriptions</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="taas-search" className="input pl-9 w-full min-h-[44px]" placeholder="Search customer, subscription, asset, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} aria-label="Plan type">
            <option value="">All plans</option>
            {PLAN_TYPES.map((p) => <option key={p} value={p}>{PLAN_LABEL[p]}</option>)}
          </select>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          {countryOptions.length > 0 && (
            <select className="input min-h-[44px]" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto self-center" aria-live="polite">{filtered.length} of {kpi ? kpi.totalSubscriptions : 'N/A'}</span>
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={!loaded && !error}
        error={error || null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        viewKey="taas-subscriptions"
        emptyMessage={
          notProvisioned ? 'TaaS subscriptions are not provisioned yet.'
            : (rows || []).length === 0 ? 'No subscriptions yet. Create your first TaaS contract.'
              : 'No subscriptions match these filters.'
        }
      />

      {/* Create / Edit dialog */}
      <Modal
        open={showModal}
        onClose={closeModal}
        size="lg"
        title={editing ? 'Edit subscription' : 'New TaaS subscription'}
        closeOnBackdrop={!saving}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="taas-form" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create subscription'}
            </button>
          </div>
        }
      >
        <form id="taas-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="ta-customer">Customer name *</label>
              <input id="ta-customer" className="input w-full" placeholder="e.g. Gulf Logistics Co." value={form.customer_name} maxLength={200} onChange={(e) => set('customer_name', e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="ta-no">Subscription no. (optional)</label>
              <input id="ta-no" className="input w-full" placeholder="e.g. TAAS-2026-014" value={form.subscription_no} maxLength={120} onChange={(e) => set('subscription_no', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label" htmlFor="ta-asset">Asset (optional)</label>
              <input id="ta-asset" className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ta-plan">Plan type</label>
              <select id="ta-plan" className="input w-full" value={form.plan_type} onChange={(e) => set('plan_type', e.target.value)}>
                {PLAN_TYPES.map((p) => <option key={p} value={p}>{PLAN_LABEL[p]}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ta-status">Status</label>
              <select id="ta-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[['tyres_covered', 'Tyres covered', '1', '6'], ['rate', 'Rate', '0.01', '0.12']].map(([k, l, step, ph]) => (
              <div key={k}>
                <label className="label" htmlFor={`ta-${k}`}>{l}</label>
                <input id={`ta-${k}`} className="input w-full" type="number" step={step} min="0" placeholder={ph} value={form[k]} onChange={(e) => set(k, e.target.value)} />
              </div>
            ))}
            <div>
              <label className="label" htmlFor="ta-unit">Rate unit</label>
              <input id="ta-unit" className="input w-full" placeholder="per km / per tyre" value={form.rate_unit} maxLength={40} onChange={(e) => set('rate_unit', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ta-fee">Monthly fee</label>
              <input id="ta-fee" className="input w-full" type="number" step="0.01" min="0" placeholder="1200" value={form.monthly_fee} onChange={(e) => set('monthly_fee', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[['committed_km', 'Committed km', '1', '60000'], ['actual_km', 'Actual km', '1', '42000'], ['billed_to_date', 'Billed to date', '0.01', '5040']].map(([k, l, step, ph]) => (
              <div key={k}>
                <label className="label" htmlFor={`ta-${k}`}>{l}</label>
                <input id={`ta-${k}`} className="input w-full" type="number" step={step} min="0" placeholder={ph} value={form[k]} onChange={(e) => set(k, e.target.value)} />
              </div>
            ))}
            <div>
              <label className="label" htmlFor="ta-cur">Currency</label>
              <input id="ta-cur" className="input w-full" placeholder={currency} value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="ta-start">Start date</label>
              <input id="ta-start" className="input w-full" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ta-renew">Renewal date</label>
              <input id="ta-renew" className="input w-full" type="date" value={form.renewal_date} onChange={(e) => set('renewal_date', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ta-notes">Notes (optional)</label>
            <textarea id="ta-notes" className="input w-full min-h-[70px] resize-y" placeholder="e.g. includes retread coverage; quarterly usage true-up" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {formError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => !deleting && setConfirmDelete(null)}
        size="sm"
        title="Delete this subscription?"
        closeOnBackdrop={!deleting}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-secondary)]">
            {confirmDelete.customer_name || 'Subscription'}, {PLAN_LABEL[confirmDelete.plan_type] || confirmDelete.plan_type || 'N/A'}, renewal {fmtDate(confirmDelete.renewal_date)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
