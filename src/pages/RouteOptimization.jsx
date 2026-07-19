/**
 * RouteOptimization (route /route-optimization) — Route Optimization. Captures
 * planned delivery/collection routes per asset and compares a naive total
 * distance against an optimised distance so dispatchers can see, and bank, the
 * kilometres saved. Fewer kilometres driven directly lowers fuel burn, tyre
 * wear, and CPK, so route savings feed the same fleet-cost intelligence as
 * odometer and utilisation data. Every plan is org-isolated and country-scoped.
 *
 * Runs on the new `route_plans` table (V165). Real data, KPI tiles, create/edit
 * modal, filters, search, delete confirm, Excel/PDF export, and
 * loading/empty/error states throughout. Per-plan savings and the fleet KPI
 * summary live in the pure `src/lib/routePlans.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Navigation, Split, Milestone, TrendingDown, Flag, AlertTriangle,
  Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listRoutePlans, createRoutePlan, updateRoutePlan, deleteRoutePlan,
} from '../lib/api/routePlans'
import { summariseRoutePlans, computeSavings } from '../lib/routePlans'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const EMPTY_FORM = {
  plan_name: '', asset_no: '', driver_name: '', plan_date: '', stops_count: '',
  total_distance_km: '', optimized_distance_km: '', estimated_duration_min: '',
  status: 'draft', notes: '',
}

const STATUS_OPTIONS = ['draft', 'optimized', 'dispatched', 'completed']

const STATUS_STYLES = {
  draft: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  optimized: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  dispatched: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  completed: 'bg-green-500/15 text-green-300 border-green-500/30',
}

const fmtKm = (v) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`

const fmtInt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString())

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function RouteOptimization() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
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
      const data = await listRoutePlans({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load route plans.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseRoutePlans(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (q) {
        const hay = `${r.plan_name || ''} ${r.asset_no || ''} ${r.driver_name || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, assetFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Route plans', value: summary.totalPlans, icon: Split, tone: 'text-[var(--text-primary)]' },
    { label: 'Total distance', value: `${Math.round(summary.totalDistanceKm).toLocaleString()} km`, icon: Milestone, tone: 'text-sky-400' },
    { label: 'Distance saved', value: `${Math.round(summary.totalSavingsKm).toLocaleString()} km`, icon: TrendingDown, tone: 'text-green-400' },
    { label: 'Avg savings', value: `${summary.avgSavingsPct.toFixed(1)}%`, icon: Flag, tone: 'text-amber-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = [
    'plan_name', 'asset_no', 'driver_name', 'plan_date', 'stops_count',
    'total_distance_km', 'optimized_distance_km', 'savings_km', 'savings_pct',
    'estimated_duration_min', 'status',
  ]
  const EXPORT_HEADERS = [
    'Plan', 'Asset', 'Driver', 'Plan date', 'Stops', 'Total (km)',
    'Optimized (km)', 'Saved (km)', 'Saved %', 'Duration (min)', 'Status',
  ]
  const exportRows = filtered.map((r) => {
    const { savingsKm, savingsPct } = computeSavings(r)
    return {
      plan_name: r.plan_name || '', asset_no: r.asset_no || '',
      driver_name: r.driver_name || '', plan_date: r.plan_date || '',
      stops_count: r.stops_count ?? '', total_distance_km: r.total_distance_km ?? '',
      optimized_distance_km: r.optimized_distance_km ?? '',
      savings_km: r.savings_km ?? Math.round(savingsKm * 10) / 10,
      savings_pct: Math.round(savingsPct * 10) / 10,
      estimated_duration_min: r.estimated_duration_min ?? '', status: r.status || '',
    }
  })

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      plan_name: r.plan_name || '', asset_no: r.asset_no || '',
      driver_name: r.driver_name || '', plan_date: r.plan_date || '',
      stops_count: r.stops_count ?? '', total_distance_km: r.total_distance_km ?? '',
      optimized_distance_km: r.optimized_distance_km ?? '',
      estimated_duration_min: r.estimated_duration_min ?? '',
      status: r.status || 'draft', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const previewSavings = useMemo(() => computeSavings({
    total_distance_km: form.total_distance_km,
    optimized_distance_km: form.optimized_distance_km,
  }), [form.total_distance_km, form.optimized_distance_km])

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.plan_name.trim()) { setFormError('A plan name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateRoutePlan(editing.id, payload)
      else await createRoutePlan(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the route plan.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteRoutePlan(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the route plan.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter(''); setAssetFilter(''); setSearch('') }
  const hasFilters = statusFilter || assetFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Route Optimization"
        subtitle="Plan and optimise fleet routes — compare naive vs optimised distance to bank the kilometres, fuel, and tyre wear you save."
        icon={Navigation}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'route_plans')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Route Optimization', 'route_plans', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New plan
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Route optimization isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V165_ROUTE_PLANS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load route plans.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

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
            <input className="input pl-9 w-full" placeholder="Search plan, asset, driver, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalPlans}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Plan', 'Asset', 'Date', 'Stops', 'Total', 'Optimized', 'Saved', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No route plans yet — create your first plan.' : 'No route plans match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const { savingsKm, savingsPct } = computeSavings(r)
                  const savedKm = r.savings_km != null ? Number(r.savings_km) : savingsKm
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                        {r.plan_name || '—'}
                        {r.driver_name && <span className="block text-[11px] text-[var(--text-muted)]">{r.driver_name}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.plan_date)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtInt(r.stops_count)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtKm(r.total_distance_km)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtKm(r.optimized_distance_km)}</td>
                      <td className="px-4 py-2.5 font-semibold text-green-400 whitespace-nowrap">
                        {savedKm > 0 ? `${fmtKm(savedKm)}` : '—'}
                        {savedKm > 0 && <span className="block text-[11px] text-[var(--text-muted)] font-normal">{savingsPct.toFixed(1)}%</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] capitalize ${STATUS_STYLES[r.status] || STATUS_STYLES.draft}`}>{r.status || 'draft'}</span>
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
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit route plan' : 'New route plan'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label">Plan name</label>
                <input className="input w-full" placeholder="e.g. Riyadh morning delivery loop" value={form.plan_name} maxLength={200} onChange={(e) => set('plan_name', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Driver (optional)</label>
                  <input className="input w-full" placeholder="e.g. A. Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Plan date</label>
                  <input className="input w-full" type="date" value={form.plan_date} onChange={(e) => set('plan_date', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use today.</p>
                </div>
                <div>
                  <label className="label">Stops (optional)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="12" value={form.stops_count} onChange={(e) => set('stops_count', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Total distance (km)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="320" value={form.total_distance_km} onChange={(e) => set('total_distance_km', e.target.value)} />
                </div>
                <div>
                  <label className="label">Optimized distance (km)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="278" value={form.optimized_distance_km} onChange={(e) => set('optimized_distance_km', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Estimated duration (min, optional)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="240" value={form.estimated_duration_min} onChange={(e) => set('estimated_duration_min', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              {previewSavings.savingsKm > 0 && (
                <div className="flex items-center gap-2 text-sm text-green-300 bg-green-900/15 border border-green-800/40 rounded-lg px-3 py-2">
                  <TrendingDown size={15} className="shrink-0" />
                  Optimising saves {fmtKm(previewSavings.savingsKm)} ({previewSavings.savingsPct.toFixed(1)}%) on this route.
                </div>
              )}

              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. avoid the ring road before 09:00" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this route plan?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.plan_name || 'Route plan'}{confirmDelete.asset_no ? ` · ${confirmDelete.asset_no}` : ''} · {fmtDate(confirmDelete.plan_date)}. This can’t be undone.
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
