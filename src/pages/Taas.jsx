/**
 * Taas (route /taas) — Tyre-as-a-Service. Manages subscription / usage-billing
 * contracts that turn tyre servicing into recurring revenue: per-km, per-month,
 * per-tyre, or hybrid plans. Tracks cost-per-km, km utilisation, monthly
 * recurring revenue (MRR), and upcoming renewals so the commercial team can
 * price, forecast, and retain contracts.
 *
 * Runs on the new `taas_subscriptions` table (V195). Real data, KPI tiles, a
 * by-plan revenue breakdown, a renewals-due attention list, per-subscription
 * cost-per-km / utilisation, filters, search, create/edit modal, delete confirm,
 * Excel/PDF export, and loading/empty/error/not-provisioned states throughout.
 * All commercial roll-ups live in the pure `src/lib/taas.js` helpers; the clock
 * is read once (`Date.now()`) and injected into every time-dependent function.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Repeat, CircleDollarSign, Activity, Package, CalendarClock, AlertTriangle,
  Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2, Layers,
  Wallet,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTaasSubscriptions, createTaasSubscription, updateTaasSubscription,
  deleteTaasSubscription,
} from '../lib/api/taas'
import {
  summariseTaas, byPlan, costPerKm, kmUtilization, daysToRenewal,
  PLAN_TYPES, STATUSES,
} from '../lib/taas'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatCurrency, formatCurrencyCompact } from '../lib/formatters'

const EMPTY_FORM = {
  subscription_no: '', customer_name: '', asset_no: '', plan_type: 'per_km',
  tyres_covered: '', rate: '', rate_unit: '', committed_km: '', actual_km: '',
  monthly_fee: '', currency: '', start_date: '', renewal_date: '',
  billed_to_date: '', status: 'active', notes: '',
}

const PLAN_LABEL = {
  per_km: 'Per km', per_month: 'Per month', per_tyre: 'Per tyre', hybrid: 'Hybrid',
  unspecified: 'Unspecified',
}
const PLAN_BADGE = {
  per_km: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  per_month: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  per_tyre: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  hybrid: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  unspecified: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}
const STATUS_LABEL = {
  active: 'Active', trial: 'Trial', paused: 'Paused',
  cancelled: 'Cancelled', expired: 'Expired',
}
const STATUS_BADGE = {
  active: 'bg-green-500/15 text-green-300 border-green-500/30',
  trial: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  cancelled: 'bg-red-500/15 text-red-300 border-red-500/30',
  expired: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

const fmtKm = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()} km`)
const fmtDate = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
const fmtPct = (v) => (v == null ? '—' : `${Math.round(v)}%`)

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

function Badge({ label, cls }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  )
}

/** Utilisation pill: colours by band, flags over-run above 100%. */
function UtilBar({ pct }) {
  if (pct == null) return <span className="text-[var(--text-muted)]">—</span>
  const capped = Math.min(pct, 100)
  const over = pct > 100
  const tone = over ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : 'bg-green-500'
  const text = over ? 'text-red-300' : pct >= 85 ? 'text-amber-300' : 'text-green-300'
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${capped}%` }} />
      </div>
      <span className={`text-xs font-medium tabular-nums ${text}`}>{Math.round(pct)}%</span>
    </div>
  )
}

export default function Taas() {
  const { activeCountry, activeCurrency } = useSettings()
  const currency = activeCurrency || 'SAR'
  const nowMs = useMemo(() => Date.now(), [])

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
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
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load TaaS subscriptions.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseTaas(rows || [], nowMs), [rows, nowMs])
  const planBreakdown = useMemo(() => byPlan(rows || []), [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (planFilter && r.plan_type !== planFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (countryFilter && r.country !== countryFilter) return false
      if (q) {
        const hay = `${r.customer_name || ''} ${r.subscription_no || ''} ${r.asset_no || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, planFilter, statusFilter, countryFilter, search])

  // Renewals due (live contracts, next 30 days incl. overdue) — attention list.
  const renewals = useMemo(() => {
    return (rows || [])
      .filter((r) => r.status === 'active' || r.status === 'trial')
      .map((r) => ({ r, days: daysToRenewal(r, nowMs) }))
      .filter((x) => x.days != null && x.days <= 30)
      .sort((a, b) => a.days - b.days)
      .slice(0, 12)
  }, [rows, nowMs])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Subscriptions', value: summary.totalSubscriptions, icon: Repeat, tone: 'text-[var(--text-primary)]' },
    { label: 'Active contracts', value: summary.activeCount, icon: Activity, tone: 'text-green-400' },
    { label: 'Monthly recurring revenue', value: formatCurrencyCompact(summary.mrr, currency), icon: CircleDollarSign, tone: 'text-amber-400' },
    { label: 'Tyres covered', value: summary.totalTyresCovered.toLocaleString(), icon: Package, tone: 'text-sky-400' },
    { label: 'Renewals due (30d)', value: summary.renewalsDue30d, icon: CalendarClock, tone: summary.renewalsDue30d > 0 ? 'text-orange-400' : 'text-[var(--text-primary)]' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = [
    'subscription_no', 'customer_name', 'asset_no', 'plan', 'status', 'tyres_covered',
    'rate', 'committed_km', 'actual_km', 'utilization', 'monthly_fee', 'billed_to_date',
    'cost_per_km', 'start_date', 'renewal_date',
  ]
  const EXPORT_HEADERS = [
    'Subscription', 'Customer', 'Asset', 'Plan', 'Status', 'Tyres', 'Rate',
    'Committed km', 'Actual km', 'Utilisation %', 'Monthly fee', 'Billed to date',
    'Cost per km', 'Start date', 'Renewal date',
  ]
  const exportRows = filtered.map((r) => {
    const cpk = costPerKm(r)
    const util = kmUtilization(r)
    return {
      subscription_no: r.subscription_no || '',
      customer_name: r.customer_name || '',
      asset_no: r.asset_no || '',
      plan: PLAN_LABEL[r.plan_type] || r.plan_type || '',
      status: STATUS_LABEL[r.status] || r.status || '',
      tyres_covered: r.tyres_covered ?? '',
      rate: r.rate ?? '',
      committed_km: r.committed_km ?? '',
      actual_km: r.actual_km ?? '',
      utilization: util == null ? '' : Math.round(util),
      monthly_fee: r.monthly_fee ?? '',
      billed_to_date: r.billed_to_date ?? '',
      cost_per_km: cpk == null ? '' : Math.round(cpk * 1000) / 1000,
      start_date: r.start_date || '',
      renewal_date: r.renewal_date || '',
    }
  })

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
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
  }
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
      setFormError(err?.message || 'Could not save the subscription.')
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
      setError(err?.message || 'Could not delete the subscription.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setSearch(''); setPlanFilter(''); setStatusFilter(''); setCountryFilter('') }
  const hasFilters = search || planFilter || statusFilter || countryFilter
  const maxPlanMrr = Math.max(1, ...planBreakdown.map((p) => p.mrr))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tyre-as-a-Service"
        subtitle="Manage subscription and usage-billing contracts — per-km, per-month, per-tyre, and hybrid plans — with cost-per-km, utilisation, MRR, and renewal tracking."
        icon={Repeat}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'taas_subscriptions', 'TaaS', { currency, title: 'Tyre-as-a-Service Subscriptions' })} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Tyre-as-a-Service Subscriptions', 'taas_subscriptions', 'landscape', '', { currency })} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New subscription
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Tyre-as-a-Service isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V195_TAAS_SUBSCRIPTIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load TaaS subscriptions.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
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

      {/* Revenue by plan + Renewals due */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By-plan revenue breakdown */}
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Layers size={15} /> Revenue by plan
          </h3>
          {rows === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : planBreakdown.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No subscriptions yet.</p>
          ) : (
            <div className="space-y-3">
              {planBreakdown.map((p) => (
                <div key={p.plan_type}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="flex items-center gap-2">
                      <Badge label={PLAN_LABEL[p.plan_type] || p.plan_type} cls={PLAN_BADGE[p.plan_type] || PLAN_BADGE.unspecified} />
                      <span className="text-[var(--text-muted)] text-xs">{p.count} contract{p.count === 1 ? '' : 's'}</span>
                    </span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">{formatCurrency(p.mrr, currency, 0)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                    <div className="h-full bg-amber-500" style={{ width: `${(p.mrr / maxPlanMrr) * 100}%` }} />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 mt-1 border-t border-[var(--input-border)] text-sm">
                <span className="text-[var(--text-muted)] flex items-center gap-1.5"><Wallet size={14} /> Total MRR</span>
                <span className="font-bold text-amber-400 tabular-nums">{formatCurrency(summary.mrr, currency, 0)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Renewals-due attention list */}
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <CalendarClock size={15} /> Renewals due (next 30 days)
          </h3>
          {rows === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : renewals.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No live contracts renewing in the next 30 days.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {renewals.map(({ r, days }) => {
                const overdue = days < 0
                const soon = days >= 0 && days <= 7
                const tone = overdue ? 'text-red-300' : soon ? 'text-orange-300' : 'text-amber-300'
                const chip = overdue
                  ? `${Math.abs(days)}d overdue`
                  : days === 0 ? 'due today' : `in ${days}d`
                return (
                  <button
                    key={r.id}
                    onClick={() => openEdit(r)}
                    className="w-full flex items-center justify-between gap-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 text-left hover:bg-[var(--input-bg)]/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.customer_name || '—'}</p>
                      <p className="text-[11px] text-[var(--text-muted)] truncate">
                        {r.subscription_no || r.asset_no || '—'} · {PLAN_LABEL[r.plan_type] || r.plan_type || '—'} · {fmtDate(r.renewal_date)}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold whitespace-nowrap ${tone}`}>{chip}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search customer, subscription, asset, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} aria-label="Plan type">
            <option value="">All plans</option>
            {PLAN_TYPES.map((p) => <option key={p} value={p}>{PLAN_LABEL[p]}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          {countryOptions.length > 0 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalSubscriptions}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Customer', 'Plan', 'Status', 'Tyres', 'Utilisation', 'Cost / km', 'Monthly fee', 'Renewal', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No subscriptions yet — create your first TaaS contract.' : 'No subscriptions match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const cpk = costPerKm(r)
                  const util = kmUtilization(r)
                  const days = daysToRenewal(r, nowMs)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-[var(--text-primary)]">{r.customer_name || '—'}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">{r.subscription_no || r.asset_no || '—'}</p>
                      </td>
                      <td className="px-4 py-2.5"><Badge label={PLAN_LABEL[r.plan_type] || r.plan_type || '—'} cls={PLAN_BADGE[r.plan_type] || PLAN_BADGE.unspecified} /></td>
                      <td className="px-4 py-2.5"><Badge label={STATUS_LABEL[r.status] || r.status || '—'} cls={STATUS_BADGE[r.status] || STATUS_BADGE.expired} /></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{r.tyres_covered ?? '—'}</td>
                      <td className="px-4 py-2.5"><UtilBar pct={util} /></td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] tabular-nums">{cpk == null ? '—' : formatCurrency(cpk, r.currency || currency, 3)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{r.monthly_fee == null ? '—' : formatCurrency(r.monthly_fee, r.currency || currency, 0)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="text-[var(--text-secondary)]">{fmtDate(r.renewal_date)}</span>
                        {days != null && (r.status === 'active' || r.status === 'trial') && days <= 30 && (
                          <span className={`block text-[11px] ${days < 0 ? 'text-red-400' : days <= 7 ? 'text-orange-400' : 'text-amber-400'}`}>
                            {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'due today' : `in ${days}d`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
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

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit subscription' : 'New TaaS subscription'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Customer name</label>
                  <input className="input w-full" placeholder="e.g. Gulf Logistics Co." value={form.customer_name} maxLength={200} onChange={(e) => set('customer_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Subscription no. (optional)</label>
                  <input className="input w-full" placeholder="e.g. TAAS-2026-014" value={form.subscription_no} maxLength={120} onChange={(e) => set('subscription_no', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Asset (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Plan type</label>
                  <select className="input w-full" value={form.plan_type} onChange={(e) => set('plan_type', e.target.value)}>
                    {PLAN_TYPES.map((p) => <option key={p} value={p}>{PLAN_LABEL[p]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="label">Tyres covered</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="6" value={form.tyres_covered} onChange={(e) => set('tyres_covered', e.target.value)} />
                </div>
                <div>
                  <label className="label">Rate</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="0.12" value={form.rate} onChange={(e) => set('rate', e.target.value)} />
                </div>
                <div>
                  <label className="label">Rate unit</label>
                  <input className="input w-full" placeholder="per km / per tyre" value={form.rate_unit} maxLength={40} onChange={(e) => set('rate_unit', e.target.value)} />
                </div>
                <div>
                  <label className="label">Monthly fee</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="1200" value={form.monthly_fee} onChange={(e) => set('monthly_fee', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="label">Committed km</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="60000" value={form.committed_km} onChange={(e) => set('committed_km', e.target.value)} />
                </div>
                <div>
                  <label className="label">Actual km</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="42000" value={form.actual_km} onChange={(e) => set('actual_km', e.target.value)} />
                </div>
                <div>
                  <label className="label">Billed to date</label>
                  <input className="input w-full" type="number" step="0.01" min="0" placeholder="5040" value={form.billed_to_date} onChange={(e) => set('billed_to_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Currency</label>
                  <input className="input w-full" placeholder={currency} value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Start date</label>
                  <input className="input w-full" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Renewal date</label>
                  <input className="input w-full" type="date" value={form.renewal_date} onChange={(e) => set('renewal_date', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. includes retread coverage; quarterly usage true-up" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create subscription'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this subscription?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.customer_name || 'Subscription'} · {PLAN_LABEL[confirmDelete.plan_type] || confirmDelete.plan_type || '—'} · {fmtDate(confirmDelete.renewal_date)}. This can’t be undone.
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
