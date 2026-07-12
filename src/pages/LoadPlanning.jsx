/**
 * LoadPlanning (route /load-planning) — Load Planning. Pairs each asset with the
 * cargo it is scheduled to carry — origin/destination, cargo type, planned
 * weight and volume — and measures that planned load against the asset's rated
 * payload and volume so overloads are caught before dispatch. Overloading is a
 * direct driver of accelerated tyre wear, axle stress, fuel burn, and
 * compliance risk, so every plan is org-isolated and country-scoped.
 *
 * Runs on the new `load_plans` table (V167). Real data, KPI tiles, an
 * overloaded-plans attention strip, create/edit modal, filters, search, delete
 * confirm, Excel/PDF export, and loading/empty/error states throughout.
 * Utilisation, overload detection, and the fleet KPI summary live in the pure
 * `src/lib/loadPlans.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Boxes, Scale, Gauge, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, ArrowRight, MapPin,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listLoadPlans, createLoadPlan, updateLoadPlan, deleteLoadPlan,
} from '../lib/api/loadPlans'
import { summariseLoadPlans, utilization, isOverloaded } from '../lib/loadPlans'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const STATUS_OPTIONS = ['draft', 'planned', 'loaded', 'dispatched', 'delivered']

const STATUS_TONE = {
  draft: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  planned: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  loaded: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  dispatched: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  delivered: 'bg-green-500/15 text-green-300 border-green-500/30',
}

const EMPTY_FORM = {
  reference: '', asset_no: '', origin: '', destination: '', plan_date: '',
  cargo_type: '', cargo_weight_kg: '', max_payload_kg: '', volume_m3: '',
  max_volume_m3: '', pallet_count: '', status: 'draft', notes: '',
}

const fmtKg = (v) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString()} kg`
const fmtM3 = (v) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString()} m³`
const fmtPct = (v) => (v == null ? '—' : `${v}%`)

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

/** Utilisation pill: colour by band, red + ring when overloaded (>100%). */
function UtilPill({ pct }) {
  if (pct == null) return <span className="text-[var(--text-muted)]">—</span>
  const over = pct > 100
  const tone = over
    ? 'bg-red-500/15 text-red-300 border-red-500/40'
    : pct >= 90
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : 'bg-green-500/15 text-green-300 border-green-500/30'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {over && <AlertTriangle size={11} />}{pct}%
    </span>
  )
}

export default function LoadPlanning() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
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
      else setError(err?.message || 'Could not load load plans.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseLoadPlans(rows || []), [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter && String(r.status || '') !== statusFilter) return false
      if (countryFilter && String(r.country || '') !== countryFilter) return false
      if (q) {
        const hay = `${r.reference || ''} ${r.asset_no || ''} ${r.origin || ''} ${r.destination || ''} ${r.cargo_type || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, countryFilter, search])

  const overloaded = useMemo(
    () => (rows || []).filter((r) => isOverloaded(r)),
    [rows],
  )

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total plans', value: summary.totalPlans, icon: Boxes, tone: 'text-[var(--text-primary)]' },
    { label: 'Avg weight util', value: `${summary.avgWeightUtilPct}%`, icon: Scale, tone: 'text-sky-400' },
    { label: 'Avg volume util', value: `${summary.avgVolumeUtilPct}%`, icon: Gauge, tone: 'text-indigo-400' },
    { label: 'Overloaded', value: summary.overloadedCount, icon: AlertTriangle, tone: summary.overloadedCount > 0 ? 'text-red-400' : 'text-green-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = [
    'reference', 'asset_no', 'origin', 'destination', 'plan_date', 'cargo_type',
    'cargo_weight_kg', 'max_payload_kg', 'weight_util', 'volume_m3', 'max_volume_m3',
    'volume_util', 'pallet_count', 'status', 'notes',
  ]
  const EXPORT_HEADERS = [
    'Reference', 'Asset', 'Origin', 'Destination', 'Plan date', 'Cargo type',
    'Cargo weight (kg)', 'Max payload (kg)', 'Weight util %', 'Volume (m³)',
    'Max volume (m³)', 'Volume util %', 'Pallets', 'Status', 'Notes',
  ]
  const exportRows = filtered.map((r) => {
    const u = utilization(r)
    return {
      reference: r.reference || '', asset_no: r.asset_no || '',
      origin: r.origin || '', destination: r.destination || '',
      plan_date: r.plan_date || '', cargo_type: r.cargo_type || '',
      cargo_weight_kg: r.cargo_weight_kg ?? '', max_payload_kg: r.max_payload_kg ?? '',
      weight_util: u.weightPct ?? '', volume_m3: r.volume_m3 ?? '',
      max_volume_m3: r.max_volume_m3 ?? '', volume_util: u.volumePct ?? '',
      pallet_count: r.pallet_count ?? '', status: r.status || '', notes: r.notes || '',
    }
  })

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
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
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateLoadPlan(editing.id, payload)
      else await createLoadPlan(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the load plan.')
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
      setError(err?.message || 'Could not delete the load plan.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setStatusFilter(''); setCountryFilter(''); setSearch('') }
  const hasFilters = statusFilter || countryFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Load Planning"
        subtitle="Plan each asset's cargo against its rated payload and volume — catch overloads before dispatch and protect tyre life, axles, and compliance."
        icon={Boxes}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'load_plans')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Load Plans', 'load_plans', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
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
            <p className="text-amber-300 font-medium">Load planning isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V167_LOAD_PLANS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load load plans.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Overloaded attention strip */}
      {rows !== null && overloaded.length > 0 && (
        <div className="card border border-red-800/50">
          <h3 className="text-sm font-semibold text-red-300 mb-3 flex items-center gap-2">
            <AlertTriangle size={15} /> Plans over rated capacity ({overloaded.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {overloaded.slice(0, 24).map((r) => {
              const u = utilization(r)
              return (
                <button
                  key={r.id}
                  onClick={() => openEdit(r)}
                  className="text-left rounded-lg border border-red-500/30 bg-red-900/10 px-3 py-2 hover:bg-red-900/20"
                >
                  <p className="text-xs font-semibold text-[var(--text-primary)]">{r.reference}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{r.asset_no || '—'}</p>
                  <p className="text-[11px] text-red-300 mt-0.5">
                    {u.weightPct != null && u.weightPct > 100 ? `Weight ${u.weightPct}%` : ''}
                    {u.weightPct != null && u.weightPct > 100 && u.volumePct != null && u.volumePct > 100 ? ' · ' : ''}
                    {u.volumePct != null && u.volumePct > 100 ? `Volume ${u.volumePct}%` : ''}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search reference, asset, route, cargo, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
            <option value="">All countries</option>
            {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
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
                {['Reference', 'Asset', 'Route', 'Plan date', 'Cargo', 'Weight util', 'Volume util', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No load plans yet — create your first plan.' : 'No plans match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const u = utilization(r)
                  const over = isOverloaded(r)
                  return (
                    <tr key={r.id} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 ${over ? 'bg-red-900/5' : ''}`}>
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                        <div className="flex items-center gap-1.5">
                          {r.reference || '—'}
                          {over && <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-300"><AlertTriangle size={10} /> Overload</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                        {r.origin || r.destination ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={12} className="opacity-60" />{r.origin || '—'}<ArrowRight size={12} className="opacity-50" />{r.destination || '—'}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.plan_date)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        <div>{r.cargo_type || '—'}</div>
                        {r.cargo_weight_kg != null && <div className="text-[11px] text-[var(--text-muted)]">{fmtKg(r.cargo_weight_kg)}</div>}
                      </td>
                      <td className="px-4 py-2.5"><UtilPill pct={u.weightPct} /></td>
                      <td className="px-4 py-2.5"><UtilPill pct={u.volumePct} /></td>
                      <td className="px-4 py-2.5">
                        {r.status ? (
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_TONE[r.status] || STATUS_TONE.draft}`}>{r.status}</span>
                        ) : '—'}
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit load plan' : 'New load plan'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Reference</label>
                  <input className="input w-full" placeholder="e.g. LP-2026-0042" value={form.reference} maxLength={200} onChange={(e) => set('reference', e.target.value)} />
                </div>
                <div>
                  <label className="label">Asset number (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Origin (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh depot" value={form.origin} maxLength={200} onChange={(e) => set('origin', e.target.value)} />
                </div>
                <div>
                  <label className="label">Destination (optional)</label>
                  <input className="input w-full" placeholder="e.g. Dammam port" value={form.destination} maxLength={200} onChange={(e) => set('destination', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Plan date</label>
                  <input className="input w-full" type="date" value={form.plan_date} onChange={(e) => set('plan_date', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use today.</p>
                </div>
                <div>
                  <label className="label">Cargo type (optional)</label>
                  <input className="input w-full" placeholder="e.g. Palletised FMCG" value={form.cargo_type} maxLength={200} onChange={(e) => set('cargo_type', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="label">Cargo weight (kg)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="18000" value={form.cargo_weight_kg} onChange={(e) => set('cargo_weight_kg', e.target.value)} />
                </div>
                <div>
                  <label className="label">Max payload (kg)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="24000" value={form.max_payload_kg} onChange={(e) => set('max_payload_kg', e.target.value)} />
                </div>
                <div>
                  <label className="label">Volume (m³)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="60" value={form.volume_m3} onChange={(e) => set('volume_m3', e.target.value)} />
                </div>
                <div>
                  <label className="label">Max volume (m³)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="76" value={form.max_volume_m3} onChange={(e) => set('max_volume_m3', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Pallet count (optional)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="26" value={form.pallet_count} onChange={(e) => set('pallet_count', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. hazmat segregation, temperature-controlled" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this load plan?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.reference || 'Plan'}{confirmDelete.asset_no ? ` · ${confirmDelete.asset_no}` : ''} · {fmtDate(confirmDelete.plan_date)}. This can’t be undone.
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
