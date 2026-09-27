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
  FileSpreadsheet, FileText, Trash2, Pencil, AlertTriangle, Loader2,
  Send, Clock, RotateCcw, CheckCircle2,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import { listLoads, createLoad, updateLoad, deleteLoad, LOAD_STATUSES } from '../lib/api/dispatch'
import { loadStatusMeta } from '../lib/dispatch'
import {
  enrichLoads, filterLoads, optionList, dispatchKpis, statusShares, topRoutes, loadExport,
} from '../lib/dispatchAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

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

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
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
      setError(toUserMessage(err, 'Could not save this load. Please try again.'))
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, activeCountry, onSaved, onClose])

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit load' : 'New load'}
      size="lg"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-secondary text-sm min-h-[44px]">Cancel</button>
          <button type="submit" form="dispatch-load-form" disabled={busy} className="btn-primary inline-flex items-center gap-2 text-sm min-h-[44px] disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {busy ? 'Saving' : editing ? 'Save changes' : 'Create load'}
          </button>
        </>
      )}
    >
        <form id="dispatch-load-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="dl-f1" className="label">Load no.</label>
              <input id="dl-f1" className="input w-full" placeholder="e.g. LD-1042" value={form.load_no} maxLength={100} onChange={(e) => set('load_no', e.target.value)} />
            </div>
            <div>
              <label htmlFor="dl-f2" className="label">Asset no.</label>
              <input id="dl-f2" className="input w-full" placeholder="Truck / trailer" value={form.asset_no} maxLength={100} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="dl-f3" className="label">Driver</label>
              <input id="dl-f3" className="input w-full" placeholder="Driver name" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="dl-f4" className="label">Site / depot</label>
              <input id="dl-f4" className="input w-full" placeholder="Originating site" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="dl-f5" className="label">Origin</label>
              <input id="dl-f5" className="input w-full" placeholder="Pickup location" value={form.origin} maxLength={300} onChange={(e) => set('origin', e.target.value)} />
            </div>
            <div>
              <label htmlFor="dl-f6" className="label">Destination</label>
              <input id="dl-f6" className="input w-full" placeholder="Drop-off location" value={form.destination} maxLength={300} onChange={(e) => set('destination', e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="dl-f7" className="label">Cargo</label>
            <input id="dl-f7" className="input w-full" placeholder="What is being carried?" value={form.cargo} maxLength={500} onChange={(e) => set('cargo', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="dl-f8" className="label">Weight (kg)</label>
              <input id="dl-f8" type="number" min="0" step="any" className="input w-full" placeholder="0" value={form.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} />
            </div>
            <div>
              <label htmlFor="dl-f9" className="label">Scheduled</label>
              <input id="dl-f9" type="datetime-local" className="input w-full" value={form.scheduled_at} onChange={(e) => set('scheduled_at', e.target.value)} />
            </div>
            <div>
              <label htmlFor="dl-f10" className="label">Status</label>
              <select id="dl-f10" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {LOAD_STATUSES.map((s) => <option key={s} value={s}>{loadStatusMeta[s]?.label || s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="dl-f11" className="label">Notes</label>
            <textarea id="dl-f11" className="input w-full min-h-[80px] resize-y" placeholder="Special instructions, references" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </form>
    </Modal>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function DeleteConfirm({ load, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    setBusy(true); setErr('')
    try { await onConfirm() } catch (e) { setErr(toUserMessage(e, 'Could not delete.')); setBusy(false) }
  }
  return (
    <Modal
      open
      onClose={busy ? undefined : onCancel}
      closeOnBackdrop={!busy}
      title="Delete this load?"
      size="sm"
      footer={(
        <>
          <button type="button" onClick={onCancel} className="btn-secondary text-sm min-h-[44px]" disabled={busy}>Cancel</button>
          <button type="button" onClick={go} disabled={busy} className="btn-primary bg-red-600 hover:bg-red-500 inline-flex items-center gap-2 text-sm min-h-[44px] disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-900/30 border border-red-800/50 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-red-400" />
          </div>
          <div>
            <p className="text-sm text-[var(--text-muted)]">
              {load.load_no || load.asset_no || 'This load'} will be permanently removed. This cannot be undone.
            </p>
          </div>
        </div>
        {err && <p role="alert" className="text-xs text-red-300">{err}</p>}
      </div>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
function fmtNum(v, digits = 0) {
  return v == null ? 'N/A' : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits })
}

export default function Dispatch() {
  const { activeCountry } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modal, setModal] = useState(null) // { initial } | null
  const [toDelete, setToDelete] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setLoadError(''); setMissing(false)
    try {
      const data = await listLoads({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setNow(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      // A failed read is not "no loads": keep rows null so every figure reads N/A.
      else { setLoadError(toUserMessage(err, 'Could not load dispatch loads.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const enriched = useMemo(() => enrichLoads(rows || [], now), [rows, now])
  const kpi = useMemo(() => dispatchKpis(rows || [], now), [rows, now])
  const shares = useMemo(() => statusShares(kpi), [kpi])
  const routes = useMemo(() => topRoutes(enriched), [enriched])
  const assetOptions = useMemo(() => optionList(rows || [], 'asset_no'), [rows])
  const siteOptions = useMemo(() => optionList(rows || [], 'site'), [rows])
  const filtered = useMemo(
    () => filterLoads(enriched, { status: statusFilter, asset: assetFilter, site: siteFilter, search }),
    [enriched, statusFilter, assetFilter, siteFilter, search],
  )

  const donutData = {
    labels: LOAD_STATUSES.map((s) => loadStatusMeta[s].label),
    datasets: [{
      data: LOAD_STATUSES.map((s) => kpi.byStatus[s] || 0),
      backgroundColor: LOAD_STATUSES.map((s) => STATUS_COLORS[s]),
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-muted)', boxWidth: 12, padding: 12 } } },
  }
  const donutSummary = shares.map((x) => `${x.label} ${x.count}`).join(', ')

  const ready = rows !== null
  const v = (x) => (ready ? fmtNum(x, 2) : 'N/A')
  const kpis = [
    { label: 'Total loads', value: v(kpi.total), icon: Boxes, tone: 'text-[var(--text-primary)]', filter: 'all' },
    { label: 'Active pipeline', value: v(kpi.active), icon: Package, tone: 'text-sky-400', filter: 'active', sub: ready ? `${kpi.scheduledToday} scheduled today` : null },
    { label: 'In transit', value: v(kpi.inTransit), icon: Truck, tone: 'text-amber-400', filter: 'in_transit' },
    { label: 'Overdue departures', value: v(kpi.overdue), icon: Clock, tone: 'text-red-400', filter: 'overdue', sub: 'Scheduled time passed, not yet in transit' },
    { label: 'Delivered', value: v(kpi.delivered), icon: PackageCheck, tone: 'text-green-400', filter: 'delivered', sub: ready ? `Delivery rate ${kpi.deliveryRatePct == null ? 'N/A' : `${kpi.deliveryRatePct}%`} of closed loads` : null },
    { label: 'Payload (t)', value: v(kpi.totalWeightTonnes), icon: CheckCircle2, tone: 'text-[var(--text-primary)]', sub: ready ? `Weight recorded on ${kpi.weightCoveragePct == null ? 'N/A' : `${kpi.weightCoveragePct}%`} of loads` : null },
  ]

  const doExport = async (format) => {
    const shaped = loadExport(filtered)
    const file = reportFileName('Dispatch Loads', activeCountry && activeCountry !== 'All' ? activeCountry : '')
    try {
      if (format === 'pdf') await exportToPdf(shaped.rows, shaped.keys.map((k, i) => ({ key: k, header: shaped.headers[i] })), 'Dispatch Loads', file, 'landscape')
      else await exportToExcel(shaped.rows, shaped.keys, shaped.headers, file)
    } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const clearFilters = () => { setStatusFilter('all'); setAssetFilter(''); setSiteFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || !!assetFilter || !!siteFilter || !!search

  const onSaved = () => { load() }
  const doDelete = async () => {
    await deleteLoad(toDelete.id)
    setToDelete(null)
    setRows((prev) => (prev || []).filter((r) => r.id !== toDelete.id))
  }

  const columns = [
    { id: 'load', header: 'Load', accessorFn: (r) => r.load_no || '', size: 120, cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{row.original.load_no || 'N/A'}</span> },
    {
      id: 'asset', header: 'Asset / Driver', accessorFn: (r) => r.asset_no || '', size: 160,
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</div>
          <div className="text-xs text-[var(--text-muted)]">{row.original.driver_name || 'N/A'}</div>
        </div>
      ),
    },
    {
      id: 'route', header: 'Route', accessorFn: (r) => r._route, size: 240,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <MapPin size={12} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
          <span className="truncate max-w-[110px]" title={row.original.origin || ''}>{row.original.origin || 'N/A'}</span>
          <ArrowRight size={12} className="text-[var(--text-muted)] shrink-0" aria-label="to" />
          <span className="truncate max-w-[110px]" title={row.original.destination || ''}>{row.original.destination || 'N/A'}</span>
        </div>
      ),
    },
    { id: 'cargo', header: 'Cargo', accessorFn: (r) => r.cargo || 'N/A', size: 160 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 120 },
    { id: 'weight', header: 'Weight (kg)', accessorFn: (r) => (r._weight == null ? -1 : r._weight), size: 110, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original._weight)}</span> },
    {
      id: 'scheduled', header: 'Scheduled', accessorFn: (r) => r.scheduled_at || '', size: 170,
      cell: ({ row }) => (
        <span className={row.original._overdue ? 'text-red-400 font-medium' : 'text-[var(--text-secondary)]'}>
          {fmtDateTime(row.original.scheduled_at)}
          {row.original._overdue && <span className="block text-[11px]">Overdue departure</span>}
        </span>
      ),
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => loadStatusMeta[r.status]?.label || r.status || '', size: 120,
      cell: ({ row }) => {
        const meta = loadStatusMeta[row.original.status] || loadStatusMeta.planned
        return <span className={`badge text-[11px] px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => setModal({ initial: row.original })} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit load ${row.original.load_no || row.original.asset_no || ''}`.trim()}><Pencil size={15} /></button>
          <button onClick={() => setToDelete(row.original)} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete load ${row.original.load_no || row.original.asset_no || ''}`.trim()}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispatch Planning"
        subtitle="Plan and track loads across the fleet: assign assets and drivers, schedule dispatches and follow them to delivery."
        icon={Truck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={() => setModal({ initial: null })} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <Plus size={14} /> New load
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Dispatch planning is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V142_DISPATCH_LOADS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {loadError && (
        <div role="alert" className="card border border-red-800/50 flex flex-wrap items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-red-300 font-medium">Dispatch loads could not be loaded.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{loadError} The figures below are not available until the register loads.</p>
          </div>
          <button onClick={load} disabled={refreshing} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RotateCcw size={14} /> Retry</button>
        </div>
      )}

      {error && (
        <div role="alert" className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1"><p className="text-red-300 font-medium">That action did not complete.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button onClick={() => setError('')} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)]" aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      {/* KPI tiles (most double as status filters) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          const active = k.filter && k.filter !== 'all' && statusFilter === k.filter
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>
              {k.sub && <p className="text-[11px] text-[var(--text-muted)] mt-1">{k.sub}</p>}
            </>
          )
          return k.filter ? (
            <button key={k.label} type="button" onClick={() => setStatusFilter(k.filter)} aria-pressed={active}
              className={`card text-left min-h-[44px] transition-colors hover:border-[var(--accent)] ${active ? 'ring-2 ring-[var(--accent)]' : ''}`}>{body}</button>
          ) : <div key={k.label} className="card">{body}</div>
        })}
      </div>

      {/* Chart + pipeline + lanes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Loads by status</h3>
          <div className="h-64" role="img" aria-label={`Loads by status: ${donutSummary}`}>
            {!ready ? (loadError ? <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Not available</p> : <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />)
              : kpi.total ? <Doughnut data={donutData} options={donutOpts} />
                : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No loads yet.</p>}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Pipeline</h3>
          <div className="space-y-2.5">
            {shares.map((x) => (
              <div key={x.status}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--text-secondary)]">{x.label}</span>
                  <span className="text-[var(--text-muted)] tabular-nums">{ready ? `${x.count} (${x.pct == null ? 'N/A' : `${x.pct}%`})` : 'N/A'}</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden" role="presentation">
                  <div className="h-2 rounded-full transition-all" style={{ width: `${x.pct || 0}%`, backgroundColor: STATUS_COLORS[x.status] }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Busiest lanes</h3>
          {!ready ? <p className="text-sm text-[var(--text-muted)]">Not available</p>
            : routes.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No origin or destination recorded on any load yet.</p>
              : (
                <ol className="space-y-2">
                  {routes.map((r) => (
                    <li key={r.route} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-[var(--text-secondary)] break-words min-w-0">{r.route}</span>
                      <span className="text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">{r.loads} loads, {r.weightTonnes == null ? 'N/A' : `${r.weightTonnes} t`}</span>
                    </li>
                  ))}
                </ol>
              )}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full min-h-[44px]" aria-label="Search loads" placeholder="Search load, asset, driver, route, cargo" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            <option value="active">Active pipeline</option>
            <option value="overdue">Overdue departures</option>
            {LOAD_STATUSES.map((s) => <option key={s} value={s}>{loadStatusMeta[s].label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input min-h-[44px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{ready ? `${filtered.length} of ${kpi.total}` : 'N/A'}</span>
        </div>
      </div>

      {!loadError && (
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={!ready}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={hasFilters ? 'No loads match these filters.' : missing ? 'Dispatch planning is not enabled on this database yet.' : 'No loads planned yet. Use New load to plan the first one.'}
        />
      )}

      {modal && <LoadModal initial={modal.initial} onClose={() => setModal(null)} onSaved={onSaved} />}
      {toDelete && <DeleteConfirm load={toDelete} onCancel={() => setToDelete(null)} onConfirm={doDelete} />}
    </div>
  )
}
