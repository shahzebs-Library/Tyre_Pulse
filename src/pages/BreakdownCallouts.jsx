/**
 * BreakdownCallouts (route /breakdown-callouts) - Roadside Assistance / Breakdown
 * Callouts. Captures every roadside breakdown / assistance event raised against
 * an asset: when it was reported, dispatched, and resolved, who attended, the
 * cost, and the outcome. Response and resolution timings are the backbone of
 * availability, downtime, and vendor-performance analytics, so every callout is
 * org-isolated and country-scoped.
 *
 * Runs on the `breakdown_callouts` table (V176). Real data, KPI tiles, by-type
 * and provider breakdowns, filters, search, a sortable EnterpriseTable register,
 * create/edit dialog, delete confirm, Excel/PDF export, and
 * loading/empty/error/not-provisioned states. Timing maths lives in
 * `src/lib/breakdownCallouts.js`; the page shaping (filters, currency-safe cost,
 * SLA, provider league, export rows) lives in
 * `src/lib/breakdownCalloutsAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  LifeBuoy, Siren, Clock, ShieldAlert, AlertTriangle, Search, X,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Wrench, Timer, Wallet, Truck,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listBreakdownCallouts, createBreakdownCallout, updateBreakdownCallout, deleteBreakdownCallout,
} from '../lib/api/breakdownCallouts'
import {
  CALLOUT_TYPES, CALLOUT_SEVERITIES, CALLOUT_STATUSES, EMPTY_CALLOUT_FILTERS, RESPONSE_SLA_MIN,
  titleCase, calloutStatusLabel, fmtMinutes, activeCalloutFilterCount, filterCallouts,
  calloutKpis, calloutsByType, providerPerformance, countryOptions, calloutTableRows,
  calloutExportRows, CALLOUT_EXPORT_COLUMNS,
} from '../lib/breakdownCalloutsAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const SEVERITY_BADGE = {
  low: 'bg-sky-500/15 text-sky-300 border border-sky-500/40',
  medium: 'bg-amber-500/15 text-amber-300 border border-amber-500/40',
  high: 'bg-orange-500/15 text-orange-300 border border-orange-500/40',
  critical: 'bg-red-500/15 text-red-300 border border-red-500/40',
}
const STATUS_BADGE = {
  reported: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]',
  dispatched: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/40',
  on_site: 'bg-violet-500/15 text-violet-300 border border-violet-500/40',
  resolved: 'bg-green-500/15 text-green-300 border border-green-500/40',
  cancelled: 'bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]',
}
const FALLBACK_BADGE = 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]'
const ICON_BTN = 'inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'

const EMPTY_FORM = {
  asset_no: '', callout_no: '', driver_name: '', location: '',
  breakdown_type: '', severity: '', reported_at: '', dispatched_at: '', resolved_at: '',
  provider: '', cost: '', currency: '', status: 'reported', resolution: '', notes: '',
}

const fmtMoney = (v, cur) => (v == null ? 'N/A' : `${cur ? `${cur} ` : ''}${Number(v).toLocaleString()}`)

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

/** timestamptz -> value for a <input type="datetime-local"> (local time, no tz). */
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Kpi({ label, value, icon: Icon, tone, sub, loading }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>
        {loading ? <span className="inline-block h-8 w-16 rounded bg-[var(--input-bg)] animate-pulse" aria-label="Loading" /> : (value ?? 'N/A')}
      </div>
      {sub && !loading && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function BreakdownCallouts() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [filters, setFilters] = useState(EMPTY_CALLOUT_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

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
      const data = await listBreakdownCallouts({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load breakdown callouts.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const all = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const loading = rows === null
  const failed = Boolean(error)
  // KPIs and breakdowns follow the filters so the tiles always describe the
  // same callouts the register shows.
  const filtered = useMemo(() => filterCallouts(all, filters), [all, filters])
  const kpi = useMemo(() => calloutKpis(filtered), [filtered])
  const types = useMemo(() => calloutsByType(filtered), [filtered])
  const providers = useMemo(() => providerPerformance(filtered).slice(0, 6), [filtered])
  const countries = useMemo(() => countryOptions(all), [all])
  const tableRows = useMemo(() => calloutTableRows(filtered), [filtered])
  const filterCount = activeCalloutFilterCount(filters)

  const costValue = failed ? null : kpi.singleCurrencyCost
    ? fmtMoney(kpi.singleCurrencyCost.total, kpi.singleCurrencyCost.currency)
    : kpi.mixedCurrency
      ? <span className="flex flex-col text-sm leading-snug">{kpi.costs.map((c) => <span key={c.currency}>{fmtMoney(c.total, c.currency || 'No currency')}</span>)}</span>
      : null

  const kv = (v) => (failed ? null : v)
  const kpis = [
    { label: 'Callouts', value: kv(kpi.totalCallouts), icon: LifeBuoy, tone: 'text-[var(--text-primary)]', sub: failed ? null : `${kpi.resolvedCount} resolved` },
    { label: 'Open callouts', value: kv(kpi.openCount), icon: Siren, tone: 'text-amber-400' },
    { label: 'Critical open', value: kv(kpi.criticalOpenCount), icon: ShieldAlert, tone: 'text-red-400' },
    { label: 'Avg response', value: failed ? null : fmtMinutes(kpi.avgResponseMinutes), icon: Clock, tone: 'text-sky-400', sub: failed || kpi.responseSlaPct == null ? 'No dispatch times recorded' : `${kpi.responseSlaPct}% within ${RESPONSE_SLA_MIN} min` },
    { label: 'Avg resolution', value: failed ? null : fmtMinutes(kpi.avgResolutionMinutes), icon: Timer, tone: 'text-violet-400' },
    { label: 'Callout cost', value: costValue, icon: Wallet, tone: 'text-[var(--text-primary)]', sub: kpi.mixedCurrency ? 'Per currency, never added together' : kpi.costs.length ? null : 'No costs recorded' },
  ]

  const doExport = async (kind) => {
    const out = calloutExportRows(filtered)
    const keys = CALLOUT_EXPORT_COLUMNS.map(([k]) => k)
    const headers = CALLOUT_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse Breakdown Callouts')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name)
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Breakdown Callouts', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', callout_no: r.callout_no || '',
      driver_name: r.driver_name || '', location: r.location || '',
      breakdown_type: r.breakdown_type || '', severity: r.severity || '',
      reported_at: toLocalInput(r.reported_at), dispatched_at: toLocalInput(r.dispatched_at),
      resolved_at: toLocalInput(r.resolved_at), provider: r.provider || '',
      cost: r.cost ?? '', currency: r.currency || '', status: r.status || 'reported',
      resolution: r.resolution || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (form.cost !== '' && form.cost != null && !(Number(form.cost) >= 0)) {
      setFormError('Cost must be a non-negative number.'); return
    }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateBreakdownCallout(editing.id, payload)
      else await createBreakdownCallout(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the callout.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteBreakdownCallout(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not delete the callout.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const columns = useMemo(() => [
    { id: 'callout', header: 'Callout', accessorFn: (r) => r.callout_no || '', size: 130, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)] whitespace-nowrap">{getValue() || 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 110, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'type', header: 'Type', accessorFn: (r) => titleCase(r.breakdown_type), size: 120 },
    {
      id: 'severity', header: 'Severity', accessorFn: (r) => CALLOUT_SEVERITIES.indexOf(r.severity), size: 110,
      cell: ({ row }) => (row.original.severity
        ? <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${SEVERITY_BADGE[row.original.severity] || FALLBACK_BADGE}`}>{titleCase(row.original.severity)}</span>
        : <span className="text-[var(--text-muted)]">N/A</span>),
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r._statusLabel, size: 120,
      cell: ({ row }) => (row.original.status
        ? <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGE[row.original.status] || FALLBACK_BADGE}`}>{row.original._statusLabel}</span>
        : <span className="text-[var(--text-muted)]">N/A</span>),
    },
    { id: 'provider', header: 'Provider', accessorFn: (r) => r.provider || '', size: 140, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'reported', header: 'Reported', accessorFn: (r) => r.reported_at || '', size: 170, cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDateTime(getValue())}</span> },
    {
      id: 'response', header: 'Response', accessorFn: (r) => r._response, size: 110, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ row }) => {
        const m = row.original._response
        const late = m != null && m > RESPONSE_SLA_MIN
        return <span className={`whitespace-nowrap tabular-nums ${late ? 'text-amber-400' : ''}`}>{fmtMinutes(m)}{late ? ' (late)' : ''}</span>
      },
    },
    { id: 'resolution', header: 'Resolution', accessorFn: (r) => r._resolution, size: 110, sortUndefined: 'last', meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{fmtMinutes(getValue())}</span> },
    { id: 'cost', header: 'Cost', accessorFn: (r) => r._cost, size: 120, sortUndefined: 'last', meta: { align: 'right' }, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{fmtMoney(row.original._cost, row.original.currency)}</span> },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => {
        const who = row.original.callout_no || row.original.asset_no || 'callout'
        return (
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className={`${ICON_BTN} hover:text-[var(--text-primary)]`} aria-label={`Edit ${who}`}><Pencil size={15} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete ${who}`}><Trash2 size={15} /></button>
          </div>
        )
      },
    },
  ], [openEdit])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Breakdown Callouts"
        subtitle="Log and track roadside assistance and breakdown events per asset: response, resolution, cost, and provider performance for availability and downtime analytics."
        icon={LifeBuoy}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} /> Log callout
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Breakdown callouts are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V176_BREAKDOWN_CALLOUTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-red-300 font-medium">Could not load breakdown callouts.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error} The figures below are unavailable until the register loads.</p>
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px]" disabled={refreshing}>Retry</button>
        </div>
      )}

      {notice && (
        <div className="card border border-amber-500/40 flex items-start justify-between gap-3" role="status">
          <p className="text-sm text-amber-300">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Wrench size={15} aria-hidden="true" /> Callouts by breakdown type
          </h2>
          {loading ? <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
            : failed ? <p className="text-sm text-[var(--text-muted)]">Unavailable: the register could not be loaded.</p>
              : types.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No callouts in this view.</p>
                : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {types.map((t) => {
                      const active = filters.type === t.type
                      return (
                        <button
                          type="button"
                          key={t.type}
                          onClick={() => setFilter('type', active ? '' : t.type)}
                          aria-pressed={active}
                          className={`text-left rounded-lg border px-3 py-2 min-h-[44px] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${active ? 'border-[var(--accent)] bg-[var(--input-bg)]' : 'border-[var(--input-border)]'}`}
                        >
                          <p className="text-xs text-[var(--text-muted)]">{t.label}</p>
                          <p className="text-sm font-semibold text-[var(--text-primary)]">{t.count} callout{t.count === 1 ? '' : 's'}{t.open ? `, ${t.open} open` : ''}</p>
                          <p className="text-[11px] text-[var(--text-muted)]">
                            {t.costs.length ? t.costs.map((c) => fmtMoney(c.total, c.currency)).join(' / ') : 'No cost recorded'}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                )}
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Truck size={15} aria-hidden="true" /> Provider response, slowest first
          </h2>
          {loading ? <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
            : failed ? <p className="text-sm text-[var(--text-muted)]">Unavailable: the register could not be loaded.</p>
              : providers.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No provider has been recorded on a callout in this view.</p>
                : (
                  <ul className="divide-y divide-[var(--input-border)]">
                    {providers.map((p) => (
                      <li key={p.provider} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="text-[var(--text-secondary)] truncate">{p.provider}</span>
                        <span className="text-[11px] text-[var(--text-muted)] shrink-0">{p.callouts} callout{p.callouts === 1 ? '' : 's'}</span>
                        <span className={`font-semibold tabular-nums shrink-0 ${p.avgResponseMinutes != null && p.avgResponseMinutes > RESPONSE_SLA_MIN ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>
                          {p.avgResponseMinutes == null ? 'Not measured' : fmtMinutes(p.avgResponseMinutes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,2fr)_repeat(4,1fr)_auto] gap-3 items-end">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Search</span>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" placeholder="Callout, asset, driver, location, provider" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Country</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.country} onChange={(e) => setFilter('country', e.target.value)} disabled={!countries.length}>
              <option value="">All countries</option>
              {countries.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Status</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {CALLOUT_STATUSES.map((s) => <option key={s} value={s}>{calloutStatusLabel(s)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Severity</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.severity} onChange={(e) => setFilter('severity', e.target.value)}>
              <option value="">All severities</option>
              {CALLOUT_SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Type</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.type} onChange={(e) => setFilter('type', e.target.value)}>
              <option value="">All types</option>
              {CALLOUT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setFilter('openOnly', !filters.openOnly)}
            aria-pressed={filters.openOnly}
            className={`text-sm inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-lg border ${filters.openOnly ? 'bg-brand-subtle text-brand-bright border-[var(--accent)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            <Siren size={14} aria-hidden="true" /> Open only
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <span className="text-xs text-[var(--text-muted)]" aria-live="polite">{filtered.length} of {all.length} callouts. The figures above cover this view.</span>
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_CALLOUT_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={tableRows}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={failed ? error : null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        initialPageSize={25}
        viewKey="breakdown-callouts"
        onRowClick={(r) => openEdit(r)}
        emptyMessage={
          notProvisioned ? 'Enable breakdown callouts to start logging roadside events.'
            : all.length === 0 ? 'No callouts logged yet. Use Log callout to record the first one.'
              : 'No callouts match these filters.'
        }
      />

      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit callout' : 'Log breakdown callout'} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Asset number</span>
              <input className="input w-full" required placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </label>
            <label className="block"><span className="label">Callout # (optional)</span>
              <input className="input w-full" placeholder="e.g. BRK-2026-0142" value={form.callout_no} maxLength={80} onChange={(e) => set('callout_no', e.target.value)} />
            </label>
            <label className="block"><span className="label">Breakdown type</span>
              <select className="input w-full" value={form.breakdown_type} onChange={(e) => set('breakdown_type', e.target.value)}>
                <option value="">Select type</option>
                {CALLOUT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Severity</span>
              <select className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                <option value="">Select severity</option>
                {CALLOUT_SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Driver (optional)</span>
              <input className="input w-full" placeholder="e.g. Ahmed Khan" value={form.driver_name} maxLength={160} onChange={(e) => set('driver_name', e.target.value)} />
            </label>
            <label className="block"><span className="label">Status</span>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {CALLOUT_STATUSES.map((s) => <option key={s} value={s}>{calloutStatusLabel(s)}</option>)}
              </select>
            </label>
          </div>
          <label className="block"><span className="label">Location (optional)</span>
            <input className="input w-full" placeholder="e.g. Highway 40, KM 218 near Al Kharj" value={form.location} maxLength={300} onChange={(e) => set('location', e.target.value)} />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block"><span className="label">Reported at</span>
              <input className="input w-full" type="datetime-local" value={form.reported_at} onChange={(e) => set('reported_at', e.target.value)} />
              <span className="block text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</span>
            </label>
            <label className="block"><span className="label">Dispatched at</span>
              <input className="input w-full" type="datetime-local" value={form.dispatched_at} onChange={(e) => set('dispatched_at', e.target.value)} />
            </label>
            <label className="block"><span className="label">Resolved at</span>
              <input className="input w-full" type="datetime-local" value={form.resolved_at} onChange={(e) => set('resolved_at', e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block"><span className="label">Provider (optional)</span>
              <input className="input w-full" placeholder="e.g. RoadCare KSA" value={form.provider} maxLength={200} onChange={(e) => set('provider', e.target.value)} />
            </label>
            <label className="block"><span className="label">Cost (optional)</span>
              <input className="input w-full" type="number" step="0.01" min="0" placeholder="850" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
            </label>
            <label className="block"><span className="label">Currency (optional)</span>
              <input className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
            </label>
          </div>
          <label className="block"><span className="label">Resolution (optional)</span>
            <textarea className="input w-full min-h-[64px] resize-y" placeholder="e.g. replaced steer tyre on site, asset returned to service" value={form.resolution} maxLength={8000} onChange={(e) => set('resolution', e.target.value)} />
          </label>
          <label className="block"><span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[64px] resize-y" placeholder="e.g. recurring issue on this axle" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </label>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Log callout'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this callout?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete.callout_no || confirmDelete.asset_no || 'Callout'}, {titleCase(confirmDelete.breakdown_type)}, reported {fmtDateTime(confirmDelete.reported_at)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
