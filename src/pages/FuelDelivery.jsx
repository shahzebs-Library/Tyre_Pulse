/**
 * FuelDelivery (route /fuel-delivery) — log and manage bulk fuel deliveries into
 * sites / storage tanks. Captures supplier, litres, unit price, total cost, site,
 * tank and delivery date, with a lightweight ordered → delivered → cancelled
 * lifecycle. Full CRUD, KPI tiles, status/site/search filters, Excel/PDF export,
 * and loading/empty/error states. Runs on the `fuel_deliveries` table
 * (MIGRATIONS_V148_FUEL_DELIVERIES.sql).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Fuel, Droplet, DollarSign, Package, Plus, Pencil, Trash2, Search, X, Filter,
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, RefreshCw, CheckCircle2,
  Clock, XCircle,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDeliveries, createDelivery, updateDelivery, deleteDelivery,
  isDeliveriesTableMissing, DELIVERY_STATUSES,
} from '../lib/api/fuelDeliveries'
import { summarizeDeliveries } from '../lib/fuelDeliveries'
import { formatCurrencyCompact } from '../lib/formatters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const STATUS_META = {
  ordered: { label: 'Ordered', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50', icon: Clock },
  delivered: { label: 'Delivered', cls: 'bg-green-900/40 text-green-300 border border-green-700/50', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', cls: 'bg-red-900/40 text-red-300 border border-red-700/50', icon: XCircle },
}

const today = () => new Date().toISOString().slice(0, 10)
const EMPTY_FORM = {
  delivery_no: '', supplier: '', site: '', tank: '',
  litres: '', unit_price: '', total_cost: '',
  delivered_at: today(), status: 'delivered', notes: '',
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
function fmtNum(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
function DeliveryModal({ open, initial, onClose, onSaved, activeCountry }) {
  const editing = !!initial?.id
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(initial?.id
      ? {
          delivery_no: initial.delivery_no || '', supplier: initial.supplier || '',
          site: initial.site || '', tank: initial.tank || '',
          litres: initial.litres ?? '', unit_price: initial.unit_price ?? '',
          total_cost: initial.total_cost ?? '',
          delivered_at: initial.delivered_at || today(),
          status: initial.status || 'delivered', notes: initial.notes || '',
        }
      : { ...EMPTY_FORM })
  }, [open, initial])

  const set = (k, v) => setForm((f) => {
    const next = { ...f, [k]: v }
    // Auto-derive total cost from litres × unit price unless the user has typed one.
    if ((k === 'litres' || k === 'unit_price')) {
      const l = parseFloat(k === 'litres' ? v : next.litres)
      const p = parseFloat(k === 'unit_price' ? v : next.unit_price)
      if (Number.isFinite(l) && Number.isFinite(p)) next.total_cost = (l * p).toFixed(2)
    }
    return next
  })

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.supplier.trim() && !form.site.trim()) {
      setError('Enter a supplier or a site.'); return
    }
    setBusy(true)
    try {
      const payload = {
        ...form,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateDelivery(initial.id, payload)
      else await createDelivery(payload)
      onSaved?.()
    } catch (err) {
      setError(err?.message || 'Could not save the delivery.')
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, activeCountry, onSaved])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="card w-full max-w-2xl max-h-[92vh] overflow-y-auto !bg-[var(--card-bg)] border border-[var(--input-border)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Fuel size={18} className="text-brand-bright" />
            {editing ? 'Edit delivery' : 'Log fuel delivery'}
          </h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Supplier</label>
              <input className="input w-full" placeholder="e.g. ADNOC Distribution" value={form.supplier} maxLength={200}
                onChange={(e) => set('supplier', e.target.value)} />
            </div>
            <div>
              <label className="label">Site</label>
              <input className="input w-full" placeholder="e.g. Dubai Depot" value={form.site} maxLength={200}
                onChange={(e) => set('site', e.target.value)} />
            </div>
            <div>
              <label className="label">Tank</label>
              <input className="input w-full" placeholder="e.g. Tank A / Diesel bulk" value={form.tank} maxLength={120}
                onChange={(e) => set('tank', e.target.value)} />
            </div>
            <div>
              <label className="label">Delivery No.</label>
              <input className="input w-full" placeholder="e.g. DN-2026-001" value={form.delivery_no} maxLength={64}
                onChange={(e) => set('delivery_no', e.target.value)} />
            </div>
            <div>
              <label className="label">Litres</label>
              <input type="number" step="0.01" min="0" className="input w-full" placeholder="1000" value={form.litres}
                onChange={(e) => set('litres', e.target.value)} />
            </div>
            <div>
              <label className="label">Unit price / L</label>
              <input type="number" step="0.001" min="0" className="input w-full" placeholder="2.85" value={form.unit_price}
                onChange={(e) => set('unit_price', e.target.value)} />
            </div>
            <div>
              <label className="label">Total cost</label>
              <input type="number" step="0.01" min="0" className="input w-full" placeholder="Auto-calculated" value={form.total_cost}
                onChange={(e) => set('total_cost', e.target.value)} />
            </div>
            <div>
              <label className="label">Delivered / due date</label>
              <input type="date" className="input w-full" value={form.delivered_at}
                onChange={(e) => set('delivered_at', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {DELIVERY_STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="Optional — reference, driver, batch quality…"
              value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
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
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Log delivery'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function ConfirmDelete({ row, onCancel, onConfirm, busy }) {
  if (!row) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onMouseDown={onCancel}>
      <div className="card w-full max-w-md border border-[var(--input-border)]" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Trash2 size={16} className="text-red-400" /> Delete delivery
        </h3>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          Delete the delivery{row.delivery_no ? ` “${row.delivery_no}”` : ''}
          {row.supplier ? ` from ${row.supplier}` : ''}? This cannot be undone.
        </p>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function FuelDelivery() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listDeliveries({
        country: activeCountry,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        site: siteFilter || undefined,
      })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      // listDeliveries swallows a missing table into []; probe once (cheap HEAD)
      // so we can surface the "apply migration" prompt only when truly absent.
      setMissing(data.length === 0 ? await isDeliveriesTableMissing() : false)
    } catch (err) {
      setError(err?.message || 'Could not load fuel deliveries.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry, statusFilter, siteFilter])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeDeliveries(rows || []), [rows])

  const siteOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (siteFilter && r.site !== siteFilter) return false
      if (q) {
        const hay = `${r.delivery_no || ''} ${r.supplier || ''} ${r.site || ''} ${r.tank || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, siteFilter, search])

  const kpis = [
    { label: 'Deliveries', value: summary.totalDeliveries.toLocaleString(), icon: Package, tone: 'text-[var(--text-primary)]' },
    { label: 'Total litres', value: `${summary.totalLitres.toLocaleString()} L`, icon: Droplet, tone: 'text-sky-400' },
    { label: 'Total cost', value: formatCurrencyCompact(summary.totalCost, activeCurrency), icon: DollarSign, tone: 'text-amber-400' },
    { label: 'Avg price / L', value: summary.avgPricePerLitre ? `${activeCurrency} ${summary.avgPricePerLitre.toFixed(3)}` : '—', icon: Fuel, tone: 'text-green-400' },
  ]

  const EXPORT_COLS = ['delivery_no', 'supplier', 'site', 'tank', 'litres', 'unit_price', 'total_cost', 'delivered_at', 'status']
  const EXPORT_HEADERS = ['Delivery No', 'Supplier', 'Site', 'Tank', 'Litres', 'Unit Price', 'Total Cost', 'Delivered', 'Status']
  const exportRows = filtered.map((r) => ({
    delivery_no: r.delivery_no || '', supplier: r.supplier || '', site: r.site || '', tank: r.tank || '',
    litres: r.litres ?? '', unit_price: r.unit_price ?? '', total_cost: r.total_cost ?? '',
    delivered_at: r.delivered_at || '', status: STATUS_META[r.status]?.label || r.status || '',
  }))

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (row) => { setEditing(row); setModalOpen(true) }
  const onSaved = () => { setModalOpen(false); setEditing(null); load() }

  const doDelete = async () => {
    if (!confirm) return
    setDeleting(true)
    try {
      await deleteDelivery(confirm.id)
      setConfirm(null)
      load()
    } catch (err) {
      setError(err?.message || 'Could not delete the delivery.')
    } finally {
      setDeleting(false)
    }
  }

  const clearFilters = () => { setStatusFilter('all'); setSiteFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || siteFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fuel Delivery"
        subtitle="Log and track bulk fuel deliveries into sites and storage tanks — supplier, litres, cost and status."
        icon={Fuel}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'fuel_deliveries')}
              className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Fuel Deliveries', 'fuel_deliveries', 'landscape')}
              className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> Log delivery
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Fuel deliveries aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V148_FUEL_DELIVERIES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && !missing && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn't load fuel deliveries.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search delivery no, supplier, site, tank…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {(rows || []).length}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Delivery', 'Supplier', 'Site / Tank', 'Litres', 'Unit price', 'Total cost', 'Delivered', 'Status', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {(rows || []).length === 0 ? 'No fuel deliveries logged yet. Use “Log delivery” to add the first.' : 'No deliveries match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const st = STATUS_META[r.status] || STATUS_META.delivered
                  const StatusIcon = st.icon
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.delivery_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.supplier || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}{r.tank ? ` · ${r.tank}` : ''}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.litres == null ? '—' : `${fmtNum(r.litres)} L`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.unit_price == null ? '—' : `${activeCurrency} ${fmtNum(r.unit_price)}`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">{r.total_cost == null ? '—' : formatCurrencyCompact(r.total_cost, activeCurrency)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.delivered_at)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${st.cls}`}>
                          <StatusIcon size={11} /> {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]" aria-label="Edit">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setConfirm(r)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--input-bg)]" aria-label="Delete">
                            <Trash2 size={14} />
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
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      <DeliveryModal
        open={modalOpen}
        initial={editing}
        activeCountry={activeCountry}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSaved={onSaved}
      />
      <ConfirmDelete row={confirm} busy={deleting} onCancel={() => setConfirm(null)} onConfirm={doDelete} />
    </div>
  )
}
