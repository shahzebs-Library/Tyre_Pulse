/**
 * Dispatch (route /dispatch) — Dispatch & Load Planning.
 *
 * Plan and track loads across the fleet: assign a load to an asset + driver with
 * an origin/destination, cargo, payload weight and a scheduled window, then move
 * it through the lifecycle (planned → dispatched → in transit → delivered /
 * cancelled). Real data, KPI tiles, a status doughnut, search + filters,
 * create/edit modal, delete confirmation, Excel/PDF export and full
 * loading/empty/error states.
 *
 * Backed by the `dispatch_loads` table (MIGRATIONS_V142_DISPATCH_LOADS.sql).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  Truck, Package, PackageCheck, Boxes, MapPin, ArrowRight, Plus, X, Search,
  Filter, FileSpreadsheet, FileText, Trash2, Pencil, AlertTriangle, Loader2,
  Send,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listLoads, createLoad, updateLoad, deleteLoad, LOAD_STATUSES } from '../lib/api/dispatch'
import { summarizeDispatch, loadStatusMeta } from '../lib/dispatch'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(ArcElement, Tooltip, Legend)

const STATUS_COLORS = {
  planned: '#64748b',
  dispatched: '#0ea5e9',
  in_transit: '#f59e0b',
  delivered: '#22c55e',
  cancelled: '#ef4444',
}

const EMPTY_FORM = {
  load_no: '', asset_no: '', driver_name: '', origin: '', destination: '',
  cargo: '', weight_kg: '', scheduled_at: '', status: 'planned', site: '', notes: '',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}
// Convert an ISO timestamp to the value a <input type="datetime-local"> expects.
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
function LoadModal({ initial, onClose, onSaved }) {
  const { activeCountry } = useSettings() || {}
  const editing = Boolean(initial?.id)
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    ...(initial || {}),
    weight_kg: initial?.weight_kg ?? '',
    scheduled_at: toLocalInput(initial?.scheduled_at),
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.asset_no.trim() && !form.load_no.trim()) {
      setError('Enter an asset number or a load number to identify this load.')
      return
    }
    setBusy(true)
    try {
      const payload = {
        ...form,
        weight_kg: form.weight_kg === '' ? null : form.weight_kg,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        country: editing ? form.country : (activeCountry && activeCountry !== 'All' ? activeCountry : null),
      }
      const row = editing ? await updateLoad(initial.id, payload) : await createLoad(payload)
      onSaved?.(row)
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Could not save this load. Please try again.')
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, activeCountry, onSaved, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto !p-0">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--input-border)]">
          <h2 className="text-base font-bold text-[var(--text-primary)]">{editing ? 'Edit load' : 'New load'}</h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Load no.</label>
              <input className="input w-full" placeholder="e.g. LD-1042" value={form.load_no} maxLength={100} onChange={(e) => set('load_no', e.target.value)} />
            </div>
            <div>
              <label className="label">Asset no.</label>
              <input className="input w-full" placeholder="Truck / trailer" value={form.asset_no} maxLength={100} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Driver</label>
              <input className="input w-full" placeholder="Driver name" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
            </div>
            <div>
              <label className="label">Site / depot</label>
              <input className="input w-full" placeholder="Originating site" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Origin</label>
              <input className="input w-full" placeholder="Pickup location" value={form.origin} maxLength={300} onChange={(e) => set('origin', e.target.value)} />
            </div>
            <div>
              <label className="label">Destination</label>
              <input className="input w-full" placeholder="Drop-off location" value={form.destination} maxLength={300} onChange={(e) => set('destination', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Cargo</label>
            <input className="input w-full" placeholder="What is being carried?" value={form.cargo} maxLength={500} onChange={(e) => set('cargo', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Weight (kg)</label>
              <input type="number" min="0" step="any" className="input w-full" placeholder="0" value={form.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} />
            </div>
            <div>
              <label className="label">Scheduled</label>
              <input type="datetime-local" className="input w-full" value={form.scheduled_at} onChange={(e) => set('scheduled_at', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {LOAD_STATUSES.map((s) => <option key={s} value={s}>{loadStatusMeta[s]?.label || s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="Special instructions, references…" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create load'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function DeleteConfirm({ load, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    setBusy(true); setErr('')
    try { await onConfirm() } catch (e) { setErr(e?.message || 'Could not delete.'); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="card w-full max-w-md space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-900/30 border border-red-800/50 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Delete this load?</h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {load.load_no || load.asset_no || 'This load'} will be permanently removed. This cannot be undone.
            </p>
          </div>
        </div>
        {err && <p className="text-xs text-red-300">{err}</p>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm" disabled={busy}>Cancel</button>
          <button type="button" onClick={go} disabled={busy} className="btn-primary bg-red-600 hover:bg-red-500 inline-flex items-center gap-2 text-sm disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Dispatch() {
  const { activeCountry } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modal, setModal] = useState(null) // { initial } | null
  const [toDelete, setToDelete] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listLoads({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load dispatch loads.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeDispatch(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (q) {
        const hay = `${r.load_no || ''} ${r.asset_no || ''} ${r.driver_name || ''} ${r.origin || ''} ${r.destination || ''} ${r.cargo || ''} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, assetFilter, search])

  const chartText = typeof document !== 'undefined'
    ? (getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af')
    : '#9ca3af'
  const donutData = {
    labels: LOAD_STATUSES.map((s) => loadStatusMeta[s].label),
    datasets: [{
      data: LOAD_STATUSES.map((s) => summary.byStatus[s] || 0),
      backgroundColor: LOAD_STATUSES.map((s) => STATUS_COLORS[s]),
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: chartText, boxWidth: 12, padding: 12 } } },
  }

  const kpis = [
    { label: 'Total loads', value: summary.total, icon: Boxes, tone: 'text-[var(--text-primary)]' },
    { label: 'In transit', value: summary.inTransit, icon: Truck, tone: 'text-amber-400' },
    { label: 'Delivered', value: summary.delivered, icon: PackageCheck, tone: 'text-green-400' },
    { label: 'Total weight (t)', value: summary.totalWeightTonnes, icon: Package, tone: 'text-sky-400' },
  ]

  const EXPORT_COLS = ['load_no', 'asset_no', 'driver_name', 'origin', 'destination', 'cargo', 'weight_kg', 'scheduled_at', 'status', 'site']
  const EXPORT_HEADERS = ['Load no', 'Asset', 'Driver', 'Origin', 'Destination', 'Cargo', 'Weight (kg)', 'Scheduled', 'Status', 'Site']
  const exportRows = filtered.map((r) => ({
    load_no: r.load_no || '', asset_no: r.asset_no || '', driver_name: r.driver_name || '',
    origin: r.origin || '', destination: r.destination || '', cargo: r.cargo || '',
    weight_kg: r.weight_kg ?? '', scheduled_at: r.scheduled_at ? fmtDateTime(r.scheduled_at) : '',
    status: loadStatusMeta[r.status]?.label || r.status || '', site: r.site || '',
  }))

  const clearFilters = () => { setStatusFilter('all'); setAssetFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || assetFilter || search

  const onSaved = () => { load() }
  const doDelete = async () => {
    await deleteLoad(toDelete.id)
    setToDelete(null)
    setRows((prev) => (prev || []).filter((r) => r.id !== toDelete.id))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispatch Planning"
        subtitle="Plan and track loads across the fleet — assign assets and drivers, schedule dispatches and follow them to delivery."
        icon={Truck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'dispatch_loads')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Dispatch Loads', 'dispatch_loads', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={() => setModal({ initial: null })} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New load
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Dispatch planning isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V142_DISPATCH_LOADS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && !missing && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load dispatch loads.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Chart + pipeline breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Loads by status</h3>
          <div className="h-64">
            {rows && rows.length ? <Doughnut data={donutData} options={donutOpts} /> : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                {rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No loads yet.'}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Pipeline</h3>
          <div className="space-y-2.5">
            {LOAD_STATUSES.map((s) => {
              const n = summary.byStatus[s] || 0
              const pct = summary.total ? Math.round((n / summary.total) * 100) : 0
              return (
                <div key={s}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--text-secondary)]">{loadStatusMeta[s].label}</span>
                    <span className="text-[var(--text-muted)]">{n} · {pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: STATUS_COLORS[s] }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search load, asset, driver, route, cargo…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {LOAD_STATUSES.map((s) => <option key={s} value={s}>{loadStatusMeta[s].label}</option>)}
          </select>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Load', 'Asset / Driver', 'Route', 'Cargo', 'Weight', 'Scheduled', 'Status', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    {rows.length === 0 ? (
                      <div className="space-y-2">
                        <Package size={22} className="mx-auto opacity-60" />
                        <p>No loads planned yet.</p>
                        <button onClick={() => setModal({ initial: null })} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={14} /> Plan your first load</button>
                      </div>
                    ) : (
                      <><Filter size={22} className="mx-auto mb-2 opacity-60" />No loads match these filters.</>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const meta = loadStatusMeta[r.status] || loadStatusMeta.planned
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.load_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        <div className="font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</div>
                        <div className="text-xs text-[var(--text-muted)]">{r.driver_name || '—'}</div>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <MapPin size={12} className="text-[var(--text-muted)] shrink-0" />
                          <span className="truncate max-w-[120px]">{r.origin || '—'}</span>
                          <ArrowRight size={12} className="text-[var(--text-muted)] shrink-0" />
                          <span className="truncate max-w-[120px]">{r.destination || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]"><span className="truncate max-w-[160px] block">{r.cargo || '—'}</span></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.weight_kg != null && r.weight_kg !== '' ? `${Number(r.weight_kg).toLocaleString()} kg` : '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.scheduled_at)}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setModal({ initial: r })} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setToDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Delete"><Trash2 size={14} /></button>
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

      {modal && <LoadModal initial={modal.initial} onClose={() => setModal(null)} onSaved={onSaved} />}
      {toDelete && <DeleteConfirm load={toDelete} onCancel={() => setToDelete(null)} onConfirm={doDelete} />}
    </div>
  )
}
