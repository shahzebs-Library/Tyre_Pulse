/**
 * LoadPlanning (route /load-planning) - pairs each asset with the cargo it is
 * scheduled to carry (origin / destination, cargo type, planned weight and
 * volume) and measures that planned load against the asset's rated payload
 * and volume so overloads are caught before dispatch. Overloading drives
 * accelerated tyre wear, axle stress, fuel burn and compliance risk.
 *
 * Runs on the `load_plans` table (V167). KPI strip, capacity-band and status
 * breakdowns, an overload worklist, route rollup, search + status / country /
 * band / date filters, a sortable EnterpriseTable register, create/edit,
 * delete confirm, Excel/PDF export and loading / empty / error states.
 * Utilisation lives in `src/lib/loadPlans.js`; page derivations live in
 * `src/lib/loadPlanningAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Boxes, Scale, Gauge, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, ArrowRight, MapPin, RefreshCw, Truck, Loader2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listLoadPlans, createLoadPlan, updateLoadPlan, deleteLoadPlan,
} from '../lib/api/loadPlans'
import {
  LOAD_STATUSES, LOAD_BANDS, LOAD_BAND_LABEL, statusLabel, loadTableRows, filterLoadPlans,
  hasLoadFilters, loadCountryOptions, loadKpis, loadStatusBreakdown, loadRouteRollup,
  overloadWorklist, loadExportRows, LOAD_EXPORT_COLS, LOAD_EXPORT_HEADERS,
} from '../lib/loadPlanningAnalytics'
import { headAndRest } from '../lib/geofencingAnalytics'
import { compareValues } from '../lib/consoleTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const STATUS_TONE = {
  draft: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  planned: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  loaded: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  dispatched: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  delivered: 'bg-green-500/15 text-green-300 border-green-500/30',
}
// Capacity bands are semantic (risk), so they keep fixed meaning colours.
const BAND_BAR = { overloaded: 'bg-red-500', near: 'bg-amber-500', ok: 'bg-green-500', unmeasured: 'bg-[var(--text-dim)]' }

const EMPTY_FORM = {
  reference: '', asset_no: '', origin: '', destination: '', plan_date: '',
  cargo_type: '', cargo_weight_kg: '', max_payload_kg: '', volume_m3: '',
  max_volume_m3: '', pallet_count: '', status: 'draft', notes: '',
}

const fmtKg = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} kg`)
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)
const sortBy = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

/** Utilisation pill: text label plus colour band, red + icon when overloaded. */
function UtilPill({ pct }) {
  if (pct == null) return <span className="text-[var(--text-muted)]">N/A</span>
  const over = pct > 100
  const tone = over
    ? 'bg-red-500/15 text-red-300 border-red-500/40'
    : pct >= 90
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : 'bg-green-500/15 text-green-300 border-green-500/30'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>
      {over && <AlertTriangle size={11} aria-hidden="true" />}{pct}%{over ? <span className="sr-only"> over capacity</span> : null}
    </span>
  )
}

export default function LoadPlanning() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [bandFilter, setBandFilter] = useState('')
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
      const data = await listLoadPlans({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load load plans.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // A failed read is not an empty register: figures read N/A, never zero.
  const known = rows !== null && !error
  const filters = { status: statusFilter, country: countryFilter, band: bandFilter, from: fromDate, to: toDate, search }
  const hasFilters = hasLoadFilters(filters)
  const countryOptions = useMemo(() => loadCountryOptions(rows || []), [rows])
  const filtered = useMemo(
    () => filterLoadPlans(rows || [], { status: statusFilter, country: countryFilter, band: bandFilter, from: fromDate, to: toDate, search }),
    [rows, statusFilter, countryFilter, bandFilter, fromDate, toDate, search],
  )
  const tableRows = useMemo(() => loadTableRows(filtered), [filtered])
  const kpi = useMemo(() => loadKpis(filtered), [filtered])
  const statusBreak = useMemo(() => loadStatusBreakdown(filtered), [filtered])
  const routes = useMemo(() => loadRouteRollup(filtered), [filtered])
  const overloaded = useMemo(() => headAndRest(overloadWorklist(filtered), 24), [filtered])

  const kpis = [
    { label: 'Plans', value: kpi.total, icon: Boxes, tone: 'text-[var(--text-primary)]' },
    { label: 'Planned cargo', value: kpi.totalWeightKg == null ? 'N/A' : fmtKg(Math.round(kpi.totalWeightKg)), icon: Truck, tone: 'text-[var(--text-primary)]' },
    { label: 'Avg weight util', value: fmtPct(kpi.avgWeightUtilPct), icon: Scale, tone: 'text-sky-400' },
    { label: 'Avg volume util', value: fmtPct(kpi.avgVolumeUtilPct), icon: Gauge, tone: 'text-indigo-400' },
    { label: 'Overloaded', value: kpi.overloaded, sub: kpi.overloadRatePct == null ? 'no rated capacity' : `${kpi.overloadRatePct}% of measured plans`, icon: AlertTriangle, tone: kpi.overloaded > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Dispatched / delivered', value: kpi.dispatched, icon: ArrowRight, tone: 'text-amber-400' },
  ]

  const exportName = reportFileName('Load Plans')
  const runExport = async (kind) => {
    setActionError('')
    try {
      const out = loadExportRows(filtered)
      if (kind === 'excel') await exportToExcel(out, LOAD_EXPORT_COLS, LOAD_EXPORT_HEADERS, exportName)
      else await exportToPdf(out, LOAD_EXPORT_COLS.map((k, i) => ({ key: k, header: LOAD_EXPORT_HEADERS[i] })), 'Load Plans', exportName, 'landscape')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      reference: r.reference || '', asset_no: r.asset_no || '',
      origin: r.origin || '', destination: r.destination || '',
      plan_date: r.plan_date || '', cargo_type: r.cargo_type || '',
      cargo_weight_kg: r.cargo_weight_kg ?? '', max_payload_kg: r.max_payload_kg ?? '',
      volume_m3: r.volume_m3 ?? '', max_volume_m3: r.max_volume_m3 ?? '',
      pallet_count: r.pallet_count ?? '', status: r.status || 'draft', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.reference.trim()) { setFormError('A plan reference is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateLoadPlan(editing.id, payload)
      else await createLoadPlan(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the load plan.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteLoadPlan(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the load plan.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter(''); setCountryFilter(''); setBandFilter(''); setFromDate(''); setToDate(''); setSearch('') }

  const columns = [
    {
      id: 'reference', header: 'Reference', accessorFn: (r) => r.reference || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 170,
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
          {r.reference || 'N/A'}
          {r._over && <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300"><AlertTriangle size={10} aria-hidden="true" /> Overload</span>}
        </div>
      ),
    },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 120, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'route', header: 'Route', accessorFn: (r) => r._route || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 220,
      cell: ({ row: { original: r } }) => (r._route ? (
        <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
          <MapPin size={12} className="opacity-60" aria-hidden="true" />{r.origin || 'N/A'}<ArrowRight size={12} className="opacity-50" aria-label="to" />{r.destination || 'N/A'}
        </span>
      ) : 'N/A'),
    },
    { id: 'date', header: 'Plan date', accessorFn: (r) => r._date || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 120, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'cargo', header: 'Cargo', accessorFn: (r) => r._weight ?? undefined, sortUndefined: 'last', size: 160,
      cell: ({ row: { original: r } }) => (
        <div className="text-[var(--text-secondary)]">
          <div>{r.cargo_type || 'N/A'}</div>
          <div className="text-[11px] text-[var(--text-muted)]">{fmtKg(r.cargo_weight_kg)}</div>
        </div>
      ),
    },
    { id: 'weight', header: 'Weight util', accessorFn: (r) => r._weightPct ?? undefined, sortUndefined: 'last', size: 110, cell: ({ row: { original: r } }) => <UtilPill pct={r._weightPct} /> },
    { id: 'volume', header: 'Volume util', accessorFn: (r) => r._volumePct ?? undefined, sortUndefined: 'last', size: 110, cell: ({ row: { original: r } }) => <UtilPill pct={r._volumePct} /> },
    {
      id: 'status', header: 'Status', accessorFn: (r) => LOAD_STATUSES.indexOf(String(r.status || '').toLowerCase()), size: 120,
      cell: ({ row: { original: r } }) => (r.status ? <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status] || STATUS_TONE.draft}`}>{statusLabel(r.status)}</span> : 'N/A'),
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 104, meta: { export: false },
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(r)} className="inline-flex items-center justify-center w-11 h-11 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit load plan ${r.reference || ''}`.trim()}><Pencil size={15} aria-hidden="true" /></button>
          <button type="button" onClick={() => setConfirmDelete(r)} className="inline-flex items-center justify-center w-11 h-11 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete load plan ${r.reference || ''}`.trim()}><Trash2 size={15} aria-hidden="true" /></button>
        </div>
      ),
    },
  ]
  const routeColumns = [
    { id: 'route', header: 'Route', accessorFn: (r) => r.route, sortingFn: sortBy, size: 260 },
    { id: 'plans', header: 'Plans', accessorFn: (r) => r.plans, size: 90, meta: { align: 'right' } },
    { id: 'over', header: 'Overloaded', accessorFn: (r) => r.overloaded, size: 110, meta: { align: 'right' } },
    { id: 'kg', header: 'Planned cargo', accessorFn: (r) => r.weightKg ?? undefined, sortUndefined: 'last', size: 140, meta: { align: 'right' }, cell: ({ row: { original: r } }) => fmtKg(r.weightKg == null ? null : Math.round(r.weightKg)) },
  ]

  const bandTotal = LOAD_BANDS.reduce((s, b) => s + kpi.bands[b], 0)
  const field = (id, label, input, hint) => (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {input}
      {hint ? <p className="text-[11px] text-[var(--text-muted)] mt-1">{hint}</p> : null}
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Load Planning"
        subtitle="Plan each asset's cargo against its rated payload and volume: catch overloads before dispatch and protect tyre life, axles, and compliance."
        icon={Boxes}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => runExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!known || !filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => runExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!known || !filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> New plan
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div role="status" className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Load planning is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V167_LOAD_PLANS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="card border border-red-800/50 flex flex-wrap items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-300 font-medium">Could not load load plans.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {actionError && <p role="alert" className="card text-sm text-red-300">{actionError}</p>}

      {/* KPI strip (follows the filters) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{known ? k.value : 'N/A'}</p>
              {k.sub && known ? <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.sub}</p> : null}
            </div>
          )
        })}
      </div>

      {/* Capacity bands + lifecycle status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Capacity band</h2>
          {!known ? (
            <p className="text-sm text-[var(--text-muted)]">{rows === null ? 'Loading' : 'Unavailable: the load plans could not be read.'}</p>
          ) : bandTotal === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{hasFilters ? 'No plans match these filters.' : 'No load plans yet.'}</p>
          ) : (
            <div className="space-y-2">
              {LOAD_BANDS.map((b) => (
                <button
                  key={b}
                  type="button"
                  aria-pressed={bandFilter === b}
                  onClick={() => setBandFilter(bandFilter === b ? '' : b)}
                  className={`w-full text-left rounded-lg px-2 py-1.5 min-h-[44px] hover:bg-[var(--input-bg)] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${bandFilter === b ? 'ring-1 ring-[var(--brand-bright)]' : ''}`}
                >
                  <span className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--text-secondary)]">{LOAD_BAND_LABEL[b]}</span>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">{kpi.bands[b]}</span>
                  </span>
                  <span className="block h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                    <span className={`block h-full rounded-full ${BAND_BAR[b]}`} style={{ width: `${(kpi.bands[b] / bandTotal) * 100}%` }} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Lifecycle status</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {LOAD_STATUSES.map((s, i) => (
              <button
                key={s}
                type="button"
                aria-pressed={statusFilter === s}
                onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
                className={`rounded-lg border border-[var(--input-border)] p-3 text-center min-h-[44px] hover:bg-[var(--input-bg)] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${statusFilter === s ? 'ring-2 ring-[var(--brand-bright)]' : ''}`}
                style={{ borderTopColor: withAlpha(colorAt(i), 0.9), borderTopWidth: 3 }}
              >
                <span className="block text-xl font-bold tabular-nums text-[var(--text-primary)]">{known ? statusBreak.counts[s] : 'N/A'}</span>
                <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">{statusLabel(s)}</span>
              </button>
            ))}
          </div>
          {known && statusBreak.other > 0 && <p className="text-[11px] text-[var(--text-muted)] mt-2">{statusBreak.other} plan{statusBreak.other === 1 ? '' : 's'} carry another or no status.</p>}
        </div>
      </div>

      {/* Overloaded attention strip */}
      {known && overloaded.head.length > 0 && (
        <div className="card border border-red-800/50">
          <h2 className="text-sm font-semibold text-red-300 mb-3 flex items-center gap-2">
            <AlertTriangle size={15} aria-hidden="true" /> Plans over rated capacity ({overloaded.head.length + overloaded.rest}), worst first
          </h2>
          <div className="flex flex-wrap gap-2">
            {overloaded.head.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openEdit(r)}
                aria-label={`Edit overloaded plan ${r.reference || ''}`.trim()}
                className="text-left rounded-lg border border-red-500/30 bg-red-900/10 px-3 py-2 min-h-[44px] hover:bg-red-900/20 focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <p className="text-xs font-semibold text-[var(--text-primary)]">{r.reference}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{r.asset_no || 'N/A'}</p>
                <p className="text-[11px] text-red-300 mt-0.5">
                  {[r._weightPct != null && r._weightPct > 100 ? `Weight ${r._weightPct}%` : null, r._volumePct != null && r._volumePct > 100 ? `Volume ${r._volumePct}%` : null].filter(Boolean).join(' | ')}
                </p>
              </button>
            ))}
            {overloaded.rest > 0 && <p className="text-xs text-[var(--text-muted)] self-center">and {overloaded.rest} more. Filter by the Overloaded band for the full list.</p>}
          </div>
        </div>
      )}

      {/* Route rollup */}
      {known && routes.length > 0 && (
        <div className="card !p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2"><MapPin size={15} className="text-[var(--text-muted)]" aria-hidden="true" /><h2 className="text-sm font-semibold text-[var(--text-primary)]">Plans by route</h2></div>
          <EnterpriseTable columns={routeColumns} data={routes} getRowId={(r) => r.route} enableGlobalFilter={false} enableColumnFilters={false} enableExport={false} initialPageSize={25} emptyMessage="No routes recorded." />
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="lp-search" className="sr-only">Search load plans</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="lp-search" type="search" className="input pl-9 w-full min-h-[44px]" placeholder="Search reference, asset, route, cargo, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {LOAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <select className="input min-h-[44px]" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Capacity band">
            <option value="">All capacity bands</option>
            {LOAD_BANDS.map((b) => <option key={b} value={b}>{LOAD_BAND_LABEL[b]}</option>)}
          </select>
          {countryOptions.length > 0 && (
            <select className="input min-h-[44px]" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <label className="text-xs text-[var(--text-muted)] flex flex-col gap-1">From
            <input type="date" className="input min-h-[44px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--text-muted)] flex flex-col gap-1">To
            <input type="date" className="input min-h-[44px]" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{known ? `${filtered.length} of ${rows.length}` : 'N/A'}</span>
        </div>
      </div>

      {/* Register */}
      <div className="card overflow-hidden !p-0">
        {known && filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-[var(--text-muted)]">
            {rows.length === 0 && !notProvisioned ? (
              <div className="flex flex-col items-center gap-3">
                <Boxes size={26} className="opacity-60" aria-hidden="true" />
                <p>No load plans yet.</p>
                <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><Plus size={14} aria-hidden="true" /> Create your first plan</button>
              </div>
            ) : notProvisioned ? (
              <p>Load planning is not provisioned on this database.</p>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Filter size={22} className="opacity-60" aria-hidden="true" />
                <p>No plans match these filters.</p>
                <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>
              </div>
            )}
          </div>
        ) : (
          <EnterpriseTable
            columns={columns}
            data={tableRows}
            getRowId={(r) => String(r.id)}
            loading={rows === null}
            error={error || null}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No plans to show."
          />
        )}
      </div>

      {/* Create / Edit modal */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit load plan' : 'New load plan'}
        size="lg"
        footer={(
          <>
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="load-plan-form" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Saving</> : editing ? 'Save changes' : 'Create plan'}
            </button>
          </>
        )}
      >
        <form id="load-plan-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('lp-ref', 'Reference (required)', <input id="lp-ref" required className="input w-full" placeholder="e.g. LP-2026-0042" value={form.reference} maxLength={200} onChange={(e) => set('reference', e.target.value)} />)}
            {field('lp-asset', 'Asset number (optional)', <input id="lp-asset" className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />)}
            {field('lp-origin', 'Origin (optional)', <input id="lp-origin" className="input w-full" placeholder="e.g. Riyadh depot" value={form.origin} maxLength={200} onChange={(e) => set('origin', e.target.value)} />)}
            {field('lp-dest', 'Destination (optional)', <input id="lp-dest" className="input w-full" placeholder="e.g. Dammam port" value={form.destination} maxLength={200} onChange={(e) => set('destination', e.target.value)} />)}
            {field('lp-date', 'Plan date', <input id="lp-date" className="input w-full" type="date" value={form.plan_date} onChange={(e) => set('plan_date', e.target.value)} />, 'Leave blank to use today.')}
            {field('lp-cargo', 'Cargo type (optional)', <input id="lp-cargo" className="input w-full" placeholder="e.g. Palletised FMCG" value={form.cargo_type} maxLength={200} onChange={(e) => set('cargo_type', e.target.value)} />)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {field('lp-weight', 'Cargo weight (kg)', <input id="lp-weight" className="input w-full" type="number" inputMode="numeric" step="1" min="0" placeholder="18000" value={form.cargo_weight_kg} onChange={(e) => set('cargo_weight_kg', e.target.value)} />)}
            {field('lp-payload', 'Max payload (kg)', <input id="lp-payload" className="input w-full" type="number" inputMode="numeric" step="1" min="0" placeholder="24000" value={form.max_payload_kg} onChange={(e) => set('max_payload_kg', e.target.value)} />)}
            {field('lp-volume', 'Volume (m3)', <input id="lp-volume" className="input w-full" type="number" inputMode="decimal" step="0.1" min="0" placeholder="60" value={form.volume_m3} onChange={(e) => set('volume_m3', e.target.value)} />)}
            {field('lp-maxvol', 'Max volume (m3)', <input id="lp-maxvol" className="input w-full" type="number" inputMode="decimal" step="0.1" min="0" placeholder="76" value={form.max_volume_m3} onChange={(e) => set('max_volume_m3', e.target.value)} />)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('lp-pallets', 'Pallet count (optional)', <input id="lp-pallets" className="input w-full" type="number" inputMode="numeric" step="1" min="0" placeholder="26" value={form.pallet_count} onChange={(e) => set('pallet_count', e.target.value)} />)}
            {field('lp-status', 'Status', (
              <select id="lp-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {LOAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            ))}
          </div>
          {field('lp-notes', 'Notes (optional)', <textarea id="lp-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. hazmat segregation, temperature-controlled" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />)}
          {formError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this load plan?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting' : 'Delete'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-muted)]">
          {confirmDelete?.reference || 'Plan'}{confirmDelete?.asset_no ? ` | ${confirmDelete.asset_no}` : ''}. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
