/**
 * Materials (route /materials) - Materials Management. The workshop's
 * consumable inventory: oils, filters, valves, sealants, greases, coolants,
 * cleaning agents, fasteners and other shop consumables. Distinct from the
 * fitment-grade tyre Parts Catalog: materials are stock-managed shop supplies
 * with quantity on hand, reorder thresholds and unit costs.
 *
 * Runs on the `materials` table (V190). KPI strip (with an honest priced vs
 * unpriced value), a reorder worklist with estimated order spend, a category
 * value breakdown, search + category / stock / supplier / country filters, a
 * sortable EnterpriseTable register, create/edit, delete confirm, Excel/PDF
 * export and loading / empty / error / not-provisioned states. Inventory rules
 * live in `src/lib/materials.js`; page derivations in
 * `src/lib/materialsAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Boxes, Package, Warehouse, ShoppingCart, PackageX, DollarSign, Layers,
  AlertTriangle, Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil,
  Trash2, TrendingDown, RefreshCw, Loader2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency } from '../lib/formatters'
import {
  listMaterials, createMaterial, updateMaterial, deleteMaterial,
} from '../lib/api/materials'
import {
  MATERIAL_CATEGORIES, CATEGORY_LABEL, STOCK_LABEL, filterMaterials, hasMaterialFilters,
  materialOptions, materialTableRows, reorderWorklist, materialKpis, categoryBreakdown,
  materialExportRows, materialValue, MATERIAL_EXPORT_COLS, MATERIAL_EXPORT_HEADERS,
} from '../lib/materialsAnalytics'
import { headAndRest } from '../lib/geofencingAnalytics'
import { colorAt } from '../lib/reportColors'
import { compareValues } from '../lib/consoleTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const STATUSES = ['active', 'low', 'out_of_stock', 'discontinued']

const EMPTY_FORM = {
  name: '', sku: '', category: '', unit: '', quantity_on_hand: '',
  reorder_point: '', reorder_qty: '', unit_cost: '', currency: '', supplier: '',
  location: '', status: '', notes: '',
}

// Derived stock-status badge (semantic meaning; the label is always shown).
const STOCK_BADGE = {
  active: 'bg-green-900/30 text-green-300 border border-green-800/50',
  low: 'bg-amber-900/30 text-amber-300 border border-amber-800/50',
  out_of_stock: 'bg-red-900/30 text-red-300 border border-red-800/50',
}

const fmtQty = (v, unit) => {
  if (v == null || v === '') return 'N/A'
  const n = Number(v)
  if (!Number.isFinite(n)) return 'N/A'
  return `${n.toLocaleString()}${unit ? ` ${unit}` : ''}`
}
const sortBy = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

export default function Materials() {
  const { activeCountry, activeCurrency } = useSettings()
  const currency = activeCurrency || 'SAR'
  // Money renders N/A for an unmeasured value, never a fabricated 0.
  const money = useCallback((v) => (v == null ? 'N/A' : formatCurrency(v, currency, 0)), [currency])

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
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
      else setError(toUserMessage(err, 'Could not load materials.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // A failed read is not an empty store: figures read N/A, never zero.
  const known = rows !== null && !error
  const filters = { category: categoryFilter, status: statusFilter, country: countryFilter, supplier: supplierFilter, search }
  const hasFilters = hasMaterialFilters(filters)
  const countryOptions = useMemo(() => materialOptions(rows || [], 'country'), [rows])
  const supplierOptions = useMemo(() => materialOptions(rows || [], 'supplier'), [rows])
  const filtered = useMemo(
    () => filterMaterials(rows || [], { category: categoryFilter, status: statusFilter, country: countryFilter, supplier: supplierFilter, search }),
    [rows, categoryFilter, statusFilter, countryFilter, supplierFilter, search],
  )
  const tableRows = useMemo(() => materialTableRows(filtered), [filtered])
  const kpi = useMemo(() => materialKpis(filtered), [filtered])
  const categories = useMemo(() => categoryBreakdown(filtered), [filtered])
  const reorder = useMemo(() => headAndRest(reorderWorklist(filtered), 30), [filtered])
  const maxCatValue = useMemo(() => categories.reduce((m, c) => Math.max(m, c.stockValue), 0), [categories])

  const kpis = [
    { label: 'Items', value: kpi.totalItems, icon: Package, tone: 'text-[var(--text-primary)]' },
    { label: 'Stock value', value: money(kpi.stockValue), sub: kpi.unpricedItems ? `${kpi.unpricedItems} unpriced item${kpi.unpricedItems === 1 ? '' : 's'} not valued` : 'every item priced', icon: DollarSign, tone: 'text-amber-400' },
    { label: 'Low stock', value: kpi.lowStock, icon: TrendingDown, tone: 'text-amber-400' },
    { label: 'Out of stock', value: kpi.outOfStock, sub: kpi.availabilityPct == null ? '' : `${kpi.availabilityPct}% of items available`, icon: PackageX, tone: kpi.outOfStock > 0 ? 'text-red-400' : 'text-[var(--text-muted)]' },
    { label: 'Reorder needed', value: kpi.reorderCount, sub: kpi.reorderSpend == null ? 'order cost not measurable' : `about ${money(kpi.reorderSpend)} to reorder`, icon: ShoppingCart, tone: 'text-sky-400' },
    { label: 'Categories', value: kpi.categories, icon: Layers, tone: 'text-violet-400' },
  ]

  const exportName = reportFileName('Materials')
  const runExport = async (kind) => {
    setActionError('')
    try {
      const out = materialExportRows(filtered)
      if (kind === 'excel') await exportToExcel(out, MATERIAL_EXPORT_COLS, MATERIAL_EXPORT_HEADERS, exportName)
      else await exportToPdf(out, MATERIAL_EXPORT_COLS.map((k, i) => ({ key: k, header: MATERIAL_EXPORT_HEADERS[i] })), 'Materials Management', exportName, 'landscape')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

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
      setFormError(toUserMessage(err, 'Could not save the material.'))
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
      setActionError(toUserMessage(err, 'Could not delete the material.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setCategoryFilter(''); setStatusFilter(''); setCountryFilter(''); setSupplierFilter(''); setSearch('') }

  const columns = [
    {
      id: 'name', header: 'Material', accessorFn: (r) => r.name || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 220,
      cell: ({ row: { original: r } }) => (
        <div>
          <div className="font-medium text-[var(--text-primary)]">{r.name || 'N/A'}</div>
          {r.sku && <div className="text-[11px] text-[var(--text-muted)] font-mono">{r.sku}</div>}
        </div>
      ),
    },
    { id: 'category', header: 'Category', accessorFn: (r) => r._categoryLabel, sortingFn: sortBy, size: 120 },
    { id: 'qty', header: 'On hand', accessorFn: (r) => r._qty ?? undefined, sortUndefined: 'last', size: 120, meta: { align: 'right' }, cell: ({ row: { original: r } }) => <span className="font-semibold text-[var(--text-primary)] tabular-nums">{fmtQty(r.quantity_on_hand, r.unit)}</span> },
    { id: 'rp', header: 'Reorder pt', accessorFn: (r) => r._reorderPoint ?? undefined, sortUndefined: 'last', size: 110, meta: { align: 'right' }, cell: ({ row: { original: r } }) => fmtQty(r.reorder_point, r.unit) },
    { id: 'cost', header: 'Unit cost', accessorFn: (r) => r._unitCost ?? undefined, sortUndefined: 'last', size: 110, meta: { align: 'right' }, cell: ({ row: { original: r } }) => money(r._unitCost) },
    { id: 'value', header: 'Stock value', accessorFn: (r) => r._value ?? undefined, sortUndefined: 'last', size: 130, meta: { align: 'right' }, cell: ({ row: { original: r } }) => <span className="font-semibold text-[var(--text-primary)] tabular-nums">{money(r._value)}</span> },
    { id: 'status', header: 'Stock', accessorFn: (r) => ['out_of_stock', 'low', 'active'].indexOf(r._status), size: 120, cell: ({ row: { original: r } }) => <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${STOCK_BADGE[r._status]}`}>{r._statusLabel}</span> },
    { id: 'supplier', header: 'Supplier', accessorFn: (r) => r.supplier || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 150, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'location', header: 'Location', accessorFn: (r) => r.location || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 140, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'actions', header: '', enableSorting: false, size: 104, meta: { export: false },
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(r)} className="inline-flex items-center justify-center w-11 h-11 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit material ${r.name || ''}`.trim()}><Pencil size={15} aria-hidden="true" /></button>
          <button type="button" onClick={() => setConfirmDelete(r)} className="inline-flex items-center justify-center w-11 h-11 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete material ${r.name || ''}`.trim()}><Trash2 size={15} aria-hidden="true" /></button>
        </div>
      ),
    },
  ]

  const field = (id, label, input) => (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {input}
    </div>
  )
  const unavailable = 'Unavailable: the materials could not be read.'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Materials Management"
        subtitle="Track workshop consumable inventory (oils, filters, valves, sealants, greases and shop supplies) with on-hand quantities, reorder thresholds, unit costs and live stock value."
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
              <Plus size={14} aria-hidden="true" /> Add material
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div role="status" className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Materials management is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V190_MATERIALS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="card border border-red-800/50 flex flex-wrap items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-300 font-medium">Could not load materials.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Reorder worklist + category value breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ShoppingCart size={15} className="text-sky-400" aria-hidden="true" /> Reorder worklist
            {known && kpi.reorderCount > 0 && <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">({kpi.reorderCount})</span>}
          </h2>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : !known ? (
            <p className="text-sm text-[var(--text-muted)]">{unavailable}</p>
          ) : reorder.head.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nothing to reorder in this view. Every item is above its reorder point.</p>
          ) : (
            <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {reorder.head.map((it, idx) => (
                <li key={it.id || `${it.sku || it.name}-${idx}`} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{it.name}</p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">{[it.sku, it.supplier, STOCK_LABEL[it.status]].filter(Boolean).join(' | ')}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-amber-400 tabular-nums">Order {it.orderQty.toLocaleString()}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">short {it.shortfall.toLocaleString()} | {money(it.estCost)}</p>
                  </div>
                </li>
              ))}
              {reorder.rest > 0 && <li className="text-xs text-[var(--text-muted)] pt-1">and {reorder.rest} more. Filter by stock state or export for the full list.</li>}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Warehouse size={15} className="text-violet-400" aria-hidden="true" /> On-hand value by category
          </h2>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-7 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : !known ? (
            <p className="text-sm text-[var(--text-muted)]">{unavailable}</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{hasFilters ? 'No materials match these filters.' : 'No materials recorded yet.'}</p>
          ) : (
            <ul className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {categories.map((c, i) => (
                <li key={c.category}>
                  <button
                    type="button"
                    onClick={() => setCategoryFilter(categoryFilter === c.category || c.category === 'uncategorised' ? '' : c.category)}
                    aria-pressed={categoryFilter === c.category}
                    className="w-full text-left rounded-lg px-1 py-1 min-h-[44px] hover:bg-[var(--input-bg)] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)]"
                  >
                    <span className="flex items-center justify-between text-xs mb-1">
                      <span className="text-[var(--text-secondary)]">{c.label} <span className="text-[var(--text-muted)]">| {c.items} item{c.items === 1 ? '' : 's'}{c.unpriced ? `, ${c.unpriced} unpriced` : ''}</span></span>
                      <span className="font-semibold text-[var(--text-primary)] tabular-nums">{c.unpriced === c.items ? 'N/A' : money(c.stockValue)}</span>
                    </span>
                    <span className="block h-1.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                      <span className="block h-full rounded-full" style={{ backgroundColor: colorAt(i), width: `${maxCatValue > 0 ? Math.max(3, (c.stockValue / maxCatValue) * 100) : 0}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="mat-search" className="sr-only">Search materials</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="mat-search" type="search" className="input pl-9 w-full min-h-[44px]" placeholder="Search name, SKU, supplier, location, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {MATERIAL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Stock status">
            <option value="">All stock states</option>
            <option value="active">In stock</option>
            <option value="low">Low</option>
            <option value="out_of_stock">Out of stock</option>
          </select>
          {supplierOptions.length > 0 && (
            <select className="input min-h-[44px]" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} aria-label="Supplier">
              <option value="">All suppliers</option>
              {supplierOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {countryOptions.length > 0 && (
            <select className="input min-h-[44px]" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
              <option value="">All countries</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
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
                <Package size={26} className="opacity-60" aria-hidden="true" />
                <p>No materials recorded yet.</p>
                <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><Plus size={14} aria-hidden="true" /> Add your first item</button>
              </div>
            ) : notProvisioned ? (
              <p>Materials management is not provisioned on this database.</p>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Filter size={22} className="opacity-60" aria-hidden="true" />
                <p>No materials match these filters.</p>
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
            emptyMessage="No materials to show."
          />
        )}
      </div>

      {/* Create / Edit modal */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit material' : 'Add material'}
        size="lg"
        footer={(
          <>
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="material-form" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Saving</> : editing ? 'Save changes' : 'Add material'}
            </button>
          </>
        )}
      >
        <form id="material-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('mat-name', 'Material name (required)', <input id="mat-name" required className="input w-full" placeholder="e.g. 15W-40 Engine Oil" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} />)}
            {field('mat-sku', 'SKU (optional)', <input id="mat-sku" className="input w-full" placeholder="e.g. OIL-15W40-20L" value={form.sku} maxLength={120} onChange={(e) => set('sku', e.target.value)} />)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {field('mat-category', 'Category', (
              <select id="mat-category" className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">Select</option>
                {MATERIAL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            ))}
            {field('mat-unit', 'Unit', <input id="mat-unit" className="input w-full" placeholder="e.g. litre, each, kg" value={form.unit} maxLength={40} onChange={(e) => set('unit', e.target.value)} />)}
            {field('mat-status', 'Status', (
              <select id="mat-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">Auto</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {field('mat-qty', 'Qty on hand', <input id="mat-qty" className="input w-full" type="number" inputMode="decimal" step="any" min="0" placeholder="0" value={form.quantity_on_hand} onChange={(e) => set('quantity_on_hand', e.target.value)} />)}
            {field('mat-rp', 'Reorder point', <input id="mat-rp" className="input w-full" type="number" inputMode="decimal" step="any" min="0" placeholder="0" value={form.reorder_point} onChange={(e) => set('reorder_point', e.target.value)} />)}
            {field('mat-rq', 'Reorder qty', <input id="mat-rq" className="input w-full" type="number" inputMode="decimal" step="any" min="0" placeholder="0" value={form.reorder_qty} onChange={(e) => set('reorder_qty', e.target.value)} />)}
            {field('mat-cost', `Unit cost (${currency})`, <input id="mat-cost" className="input w-full" type="number" inputMode="decimal" step="any" min="0" placeholder="0.00" value={form.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} />)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('mat-supplier', 'Supplier (optional)', <input id="mat-supplier" className="input w-full" placeholder="e.g. Gulf Lubricants Co." value={form.supplier} maxLength={200} onChange={(e) => set('supplier', e.target.value)} list="mat-supplier-options" />)}
            {field('mat-location', 'Location (optional)', <input id="mat-location" className="input w-full" placeholder="e.g. Store A, Rack 3" value={form.location} maxLength={200} onChange={(e) => set('location', e.target.value)} />)}
          </div>
          <datalist id="mat-supplier-options">{supplierOptions.map((s) => <option key={s} value={s} />)}</datalist>
          {field('mat-notes', 'Notes (optional)', <textarea id="mat-notes" className="input w-full min-h-[70px] resize-y" placeholder="e.g. bulk supply, hazardous, batch tracked" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />)}
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
        title="Delete this material?"
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
          {confirmDelete?.name || 'Material'}{confirmDelete?.sku ? ` | ${confirmDelete.sku}` : ''} | {money(confirmDelete ? materialValue(confirmDelete) : null)} on hand. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
