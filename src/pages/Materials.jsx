/**
 * Materials (route /materials) — Materials Management. Manages the workshop's
 * consumable/material inventory: oils, filters, valves, sealants, greases,
 * coolants, cleaning agents, fasteners and other shop consumables. This is
 * distinct from the fitment-grade tyre Parts Catalog — materials are
 * stock-managed shop supplies with quantity on hand, reorder thresholds and
 * unit costs, so the workshop can value on-hand inventory and act on low /
 * out-of-stock items before a job is blocked.
 *
 * Runs on the new `materials` table (V190). Real data, KPI tiles, a
 * replenishment attention panel, a per-category value breakdown, filters,
 * search, create/edit modal, delete confirm, Excel/PDF export, and
 * loading/empty/error/not-provisioned states. Inventory roll-ups live in the
 * pure `src/lib/materials.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Boxes, Package, Warehouse, ShoppingCart, PackageX, DollarSign, Layers,
  AlertTriangle, Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil,
  Trash2, TrendingDown,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import {
  listMaterials, createMaterial, updateMaterial, deleteMaterial,
} from '../lib/api/materials'
import {
  summariseMaterials, byCategory, reorderList, stockValue, stockStatus,
} from '../lib/materials'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const CATEGORIES = [
  'oil', 'filter', 'valve', 'sealant', 'grease', 'coolant', 'cleaning',
  'fastener', 'consumable', 'other',
]
const STATUSES = ['active', 'low', 'out_of_stock', 'discontinued']

const CATEGORY_LABEL = {
  oil: 'Oil', filter: 'Filter', valve: 'Valve', sealant: 'Sealant',
  grease: 'Grease', coolant: 'Coolant', cleaning: 'Cleaning', fastener: 'Fastener',
  consumable: 'Consumable', other: 'Other', uncategorised: 'Uncategorised',
}

const EMPTY_FORM = {
  name: '', sku: '', category: '', unit: '', quantity_on_hand: '',
  reorder_point: '', reorder_qty: '', unit_cost: '', currency: '', supplier: '',
  location: '', status: '', notes: '',
}

// Derived stock-status badge styling (independent of the stored status field).
const STOCK_BADGE = {
  active: 'bg-green-900/30 text-green-300 border border-green-800/50',
  low: 'bg-amber-900/30 text-amber-300 border border-amber-800/50',
  out_of_stock: 'bg-red-900/30 text-red-300 border border-red-800/50',
}
const STOCK_LABEL = { active: 'In stock', low: 'Low', out_of_stock: 'Out of stock' }

const fmtQty = (v, unit) => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString()}${unit ? ` ${unit}` : ''}`
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function Materials() {
  const { activeCountry, activeCurrency } = useSettings()
  const currency = activeCurrency || 'SAR'
  const money = useCallback((v) => formatCurrency(v || 0, currency, 0), [currency])

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [categoryFilter, setCategoryFilter] = useState('')
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
      const data = await listMaterials({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load materials.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Derived intelligence (pure helpers) ────────────────────────────────────
  const summary = useMemo(() => summariseMaterials(rows || []), [rows])
  const categoryBreakdown = useMemo(() => byCategory(rows || []), [rows])
  const reorder = useMemo(() => reorderList(rows || []), [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (categoryFilter && r.category !== categoryFilter) return false
      if (statusFilter && stockStatus(r) !== statusFilter) return false
      if (countryFilter && r.country !== countryFilter) return false
      if (q) {
        const hay = `${r.name || ''} ${r.sku || ''} ${r.supplier || ''} ${r.location || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, categoryFilter, statusFilter, countryFilter, search])

  const maxCatValue = useMemo(
    () => categoryBreakdown.reduce((m, c) => Math.max(m, c.stockValue), 0),
    [categoryBreakdown],
  )

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total items', value: summary.totalItems, icon: Package, tone: 'text-[var(--text-primary)]' },
    { label: 'Stock value', value: money(summary.totalStockValue), icon: DollarSign, tone: 'text-amber-400' },
    { label: 'Low stock', value: summary.lowStockCount, icon: TrendingDown, tone: 'text-amber-400' },
    { label: 'Out of stock', value: summary.outOfStockCount, icon: PackageX, tone: 'text-red-400' },
    { label: 'Reorder needed', value: summary.reorderCount, icon: ShoppingCart, tone: 'text-sky-400' },
    { label: 'Categories', value: summary.distinctCategories, icon: Layers, tone: 'text-violet-400' },
  ]

  // ── Export ─────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['name', 'sku', 'category', 'unit', 'quantity_on_hand', 'reorder_point', 'unit_cost', 'stock_value', 'stock_status', 'supplier', 'location']
  const EXPORT_HEADERS = ['Material', 'SKU', 'Category', 'Unit', 'Qty on hand', 'Reorder point', 'Unit cost', 'Stock value', 'Stock status', 'Supplier', 'Location']
  const exportRows = filtered.map((r) => ({
    name: r.name || '', sku: r.sku || '',
    category: CATEGORY_LABEL[r.category] || r.category || '',
    unit: r.unit || '', quantity_on_hand: r.quantity_on_hand ?? '',
    reorder_point: r.reorder_point ?? '', unit_cost: r.unit_cost ?? '',
    stock_value: Math.round(stockValue(r)),
    stock_status: STOCK_LABEL[stockStatus(r)] || stockStatus(r),
    supplier: r.supplier || '', location: r.location || '',
  }))

  // ── Modal ──────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      name: r.name || '', sku: r.sku || '', category: r.category || '',
      unit: r.unit || '', quantity_on_hand: r.quantity_on_hand ?? '',
      reorder_point: r.reorder_point ?? '', reorder_qty: r.reorder_qty ?? '',
      unit_cost: r.unit_cost ?? '', currency: r.currency || '',
      supplier: r.supplier || '', location: r.location || '',
      status: r.status || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.name.trim()) { setFormError('A material name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        currency: form.currency?.trim() || currency,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateMaterial(editing.id, payload)
      else await createMaterial(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the material.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, currency, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteMaterial(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the material.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setCategoryFilter(''); setStatusFilter(''); setCountryFilter(''); setSearch('') }
  const hasFilters = categoryFilter || statusFilter || countryFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Materials Management"
        subtitle="Track workshop consumable inventory — oils, filters, valves, sealants, greases and shop supplies — with on-hand quantities, reorder thresholds, unit costs and live stock value."
        icon={Boxes}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'materials')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Materials Management', 'materials', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Add material
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Materials management isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V190_MATERIALS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load materials.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
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

      {/* Attention panel + category value breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Reorder attention list */}
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ShoppingCart size={15} className="text-sky-400" /> Reorder worklist
            {reorder.length > 0 && <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">({reorder.length})</span>}
          </h3>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : reorder.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nothing to reorder — every item is above its reorder point.</p>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {reorder.slice(0, 30).map((it, idx) => (
                <div key={`${it.sku || it.name}-${idx}`} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{it.name}</p>
                    {it.sku && <p className="text-[11px] text-[var(--text-muted)] font-mono truncate">{it.sku}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-amber-400">Order {it.reorder_qty.toLocaleString()}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">short {it.shortfall.toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {reorder.length > 30 && <p className="text-xs text-[var(--text-muted)] pt-1">+{reorder.length - 30} more — export for the full list.</p>}
            </div>
          )}
        </div>

        {/* Category value breakdown */}
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Warehouse size={15} className="text-violet-400" /> On-hand value by category
          </h3>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-7 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : categoryBreakdown.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No materials recorded yet.</p>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {categoryBreakdown.map((c) => (
                <div key={c.category}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--text-secondary)]">{CATEGORY_LABEL[c.category] || c.category} <span className="text-[var(--text-muted)]">· {c.items}</span></span>
                    <span className="font-semibold text-[var(--text-primary)]">{money(c.stockValue)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500" style={{ width: `${maxCatValue > 0 ? Math.max(3, (c.stockValue / maxCatValue) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search name, SKU, supplier, location, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Stock status">
            <option value="">All stock states</option>
            <option value="active">In stock</option>
            <option value="low">Low</option>
            <option value="out_of_stock">Out of stock</option>
          </select>
          {countryOptions.length > 0 && (
            <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalItems}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Material', 'Category', 'On hand', 'Reorder pt', 'Unit cost', 'Stock value', 'Status', 'Supplier', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No materials recorded yet — add your first item.' : 'No materials match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const st = stockStatus(r)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-[var(--text-primary)]">{r.name || '—'}</div>
                        {r.sku && <div className="text-[11px] text-[var(--text-muted)] font-mono">{r.sku}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{CATEGORY_LABEL[r.category] || r.category || '—'}</td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">{fmtQty(r.quantity_on_hand, r.unit)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtQty(r.reorder_point, r.unit)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.unit_cost == null || r.unit_cost === '' ? '—' : money(r.unit_cost)}</td>
                      <td className="px-4 py-2.5 font-semibold text-amber-400 whitespace-nowrap">{money(stockValue(r))}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${STOCK_BADGE[st]}`}>{STOCK_LABEL[st]}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.supplier || '—'}</td>
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit material' : 'Add material'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Material name</label>
                  <input className="input w-full" placeholder="e.g. 15W-40 Engine Oil" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} />
                </div>
                <div>
                  <label className="label">SKU (optional)</label>
                  <input className="input w-full" placeholder="e.g. OIL-15W40-20L" value={form.sku} maxLength={120} onChange={(e) => set('sku', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Category</label>
                  <select className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
                    <option value="">— Select —</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Unit</label>
                  <input className="input w-full" placeholder="e.g. litre, each, kg" value={form.unit} maxLength={40} onChange={(e) => set('unit', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    <option value="">— Auto —</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="label">Qty on hand</label>
                  <input className="input w-full" type="number" step="any" min="0" placeholder="0" value={form.quantity_on_hand} onChange={(e) => set('quantity_on_hand', e.target.value)} />
                </div>
                <div>
                  <label className="label">Reorder point</label>
                  <input className="input w-full" type="number" step="any" min="0" placeholder="0" value={form.reorder_point} onChange={(e) => set('reorder_point', e.target.value)} />
                </div>
                <div>
                  <label className="label">Reorder qty</label>
                  <input className="input w-full" type="number" step="any" min="0" placeholder="0" value={form.reorder_qty} onChange={(e) => set('reorder_qty', e.target.value)} />
                </div>
                <div>
                  <label className="label">Unit cost ({currency})</label>
                  <input className="input w-full" type="number" step="any" min="0" placeholder="0.00" value={form.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Supplier (optional)</label>
                  <input className="input w-full" placeholder="e.g. Gulf Lubricants Co." value={form.supplier} maxLength={200} onChange={(e) => set('supplier', e.target.value)} />
                </div>
                <div>
                  <label className="label">Location (optional)</label>
                  <input className="input w-full" placeholder="e.g. Store A · Rack 3" value={form.location} maxLength={200} onChange={(e) => set('location', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. bulk supply, hazardous, batch tracked" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add material'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this material?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.name || 'Material'}{confirmDelete.sku ? ` · ${confirmDelete.sku}` : ''} · {money(stockValue(confirmDelete))} on hand. This can’t be undone.
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
