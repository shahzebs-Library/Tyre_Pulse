/**
 * PartsCatalog (route /parts-catalog) — a master catalog of spare parts: part
 * number, name, category, unit cost, on-hand quantity, reorder level, supplier
 * and unit of measure. Full CRUD with KPI tiles, category/status/search filters,
 * low-stock highlighting, create/edit modal, delete confirm and Excel/PDF export.
 *
 * Reads through the `partsCatalog` service (org-isolated, country-scoped RLS).
 * When the backing table is absent it prompts for MIGRATIONS_V140_PARTS_CATALOG.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Boxes, Package, PackageX, DollarSign, Layers, Plus, X, Trash2, Loader2,
  Search, Pencil, AlertTriangle, FileSpreadsheet, FileText, Save,
  ShoppingCart, BarChart3, ClipboardList, ShieldAlert,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact, formatCurrency } from '../lib/formatters'
import {
  listParts, createPart, updatePart, deletePart, PART_STATUSES,
} from '../lib/api/partsCatalog'
import {
  partIsLowStock, summarizeParts, buildPartsAnalytics, partStockStatus,
  partLineValue, abcClassByPart, STOCK_STATUS_META,
} from '../lib/partsCatalog'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const ABC_COLORS = { A: '#10b981', B: '#f59e0b', C: '#64748b' }

const CATEGORIES = [
  'engine', 'brakes', 'tyres', 'electrical', 'body', 'hydraulic', 'air_system',
  'fluids', 'filters', 'hvac', 'suspension', 'drivetrain', 'general', 'other',
]
const UOMS = ['pcs', 'litres', 'kg', 'm', 'set', 'pair', 'box', 'roll']

const STATUS_STYLES = {
  active: 'bg-green-900/40 text-green-300 border border-green-700/50',
  discontinued: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

const EMPTY_FORM = {
  part_no: '', name: '', category: 'engine', unit_cost: '', on_hand_qty: '',
  reorder_level: '', supplier: '', uom: 'pcs', status: 'active', notes: '',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}

export default function PartsCatalog() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  // Modal + form
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Delete confirm
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listParts({ country: activeCountry })
      setMissing(Array.isArray(data) && data.missing === true)
      setRows(Array.isArray(data) ? [...data] : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load the parts catalog.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeParts(rows || []), [rows])
  const analytics = useMemo(() => buildPartsAnalytics(rows || []), [rows])
  const abcMap = useMemo(() => abcClassByPart(rows || []), [rows])

  const chartAxis = {
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
      y: { beginAtZero: true, ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    },
    maintainAspectRatio: false,
    responsive: true,
  }

  const valueByCategory = useMemo(() => {
    const cats = analytics.valuation.byCategory.slice(0, 10)
    return {
      labels: cats.map((c) => c.category),
      datasets: [{ data: cats.map((c) => c.value), backgroundColor: categorical(cats.length), borderWidth: 0 }],
    }
  }, [analytics])

  const statusBar = useMemo(() => {
    const keys = ['out', 'below_reorder', 'low', 'ok', 'unknown']
    return {
      labels: keys.map((k) => STOCK_STATUS_META[k].label),
      datasets: [{ data: keys.map((k) => analytics.statusCounts[k]), backgroundColor: keys.map((k) => STOCK_STATUS_META[k].color), borderWidth: 0 }],
    }
  }, [analytics])

  const abcBar = useMemo(() => {
    const keys = ['A', 'B', 'C']
    return {
      labels: keys.map((k) => `Class ${k}`),
      datasets: [{ data: keys.map((k) => analytics.abc.summary[k].count), backgroundColor: keys.map((k) => ABC_COLORS[k]), borderWidth: 0 }],
    }
  }, [analytics])

  const topValueBar = useMemo(() => {
    const top = analytics.abc.items.filter((i) => i.value > 0).slice(0, 8)
    return {
      labels: top.map((i) => i.part_no),
      datasets: [{ data: top.map((i) => i.value), backgroundColor: top.map((_, i) => withAlpha(colorAt(i), 0.85)), borderWidth: 0 }],
    }
  }, [analytics])

  const categoryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.category).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (q) {
        const hay = `${r.part_no || ''} ${r.name || ''} ${r.supplier || ''} ${r.category || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, categoryFilter, statusFilter, search])

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowForm(true) }
  const openEdit = (p) => {
    setEditing(p)
    setForm({
      part_no: p.part_no ?? '', name: p.name ?? '', category: p.category ?? 'engine',
      unit_cost: p.unit_cost ?? '', on_hand_qty: p.on_hand_qty ?? '',
      reorder_level: p.reorder_level ?? '', supplier: p.supplier ?? '',
      uom: p.uom ?? 'pcs', status: p.status ?? 'active', notes: p.notes ?? '',
    })
    setFormError(''); setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditing(null) }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.part_no.trim()) { setFormError('A part number is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updatePart(editing.id, payload)
      else await createPart(payload)
      closeForm()
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the part.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await deletePart(pendingDelete.id)
      setPendingDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the part.'))
    } finally {
      setDeleting(false)
    }
  }, [pendingDelete, load])

  // Export (enriched with derived stock status, ABC class and line value)
  const EXPORT_COLS = ['part_no', 'name', 'category', 'unit_cost', 'on_hand_qty', 'reorder_level', 'stock_status', 'line_value', 'abc_class', 'supplier', 'uom', 'status']
  const EXPORT_HEADERS = ['Part No', 'Name', 'Category', 'Unit Cost', 'On Hand', 'Reorder Lvl', 'Stock Status', 'Line Value', 'ABC', 'Supplier', 'UoM', 'Status']
  const exportRows = filtered.map((r) => {
    const lv = partLineValue(r)
    return {
      part_no: r.part_no || '', name: r.name || '', category: r.category || '',
      unit_cost: r.unit_cost ?? '', on_hand_qty: r.on_hand_qty ?? '',
      reorder_level: r.reorder_level ?? '',
      stock_status: STOCK_STATUS_META[partStockStatus(r)].label,
      line_value: lv == null ? '' : lv,
      abc_class: abcMap.get(r.id) || '',
      supplier: r.supplier || '', uom: r.uom || '', status: r.status || '',
    }
  })

  const kpis = [
    { label: 'Total SKUs', value: analytics.kpis.totalSkus, icon: Package, tone: 'text-[var(--text-primary)]' },
    { label: 'Inventory value', value: formatCurrencyCompact(analytics.kpis.inventoryValue, activeCurrency), icon: DollarSign, tone: 'text-amber-400' },
    { label: 'Out of stock', value: analytics.kpis.outOfStock, icon: PackageX, tone: 'text-red-400' },
    { label: 'Below reorder', value: analytics.kpis.belowReorder, icon: ShoppingCart, tone: 'text-orange-400' },
  ]

  const clearFilters = () => { setCategoryFilter('all'); setStatusFilter('all'); setSearch('') }
  const hasFilters = categoryFilter !== 'all' || statusFilter !== 'all' || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parts Catalog"
        subtitle="Master catalog of spare parts — cost, on-hand stock, reorder levels and suppliers, with low-stock alerts."
        icon={Boxes}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'parts_catalog', 'Parts', { currency: activeCurrency, title: 'Parts Catalog' })} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Parts Catalog', 'parts_catalog', 'landscape', '', { currency: activeCurrency })} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={15} /> Add part
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">The parts catalog isn't enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V140_PARTS_CATALOG.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Something went wrong.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
            <input className="input pl-9 w-full" placeholder="Search part no, name, supplier…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {PART_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
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
                {['Part No', 'Name', 'Category', 'Unit Cost', 'On Hand', 'Reorder', 'Supplier', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Package size={22} className="mx-auto mb-2 opacity-60" />
                  {summary.total === 0 && !missing ? (
                    <div className="space-y-3">
                      <p>No parts in the catalog yet.</p>
                      <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={14} /> Add the first part</button>
                    </div>
                  ) : 'No parts match these filters.'}
                </td></tr>
              ) : (
                filtered.map((p) => {
                  const low = partIsLowStock(p)
                  return (
                    <tr key={p.id} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 ${low ? 'bg-red-900/10' : ''}`}>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{p.part_no}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.name || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] capitalize">{p.category || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.unit_cost == null ? '—' : formatCurrency(p.unit_cost, activeCurrency)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`font-semibold ${low ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>
                          {p.on_hand_qty ?? '—'}{p.uom ? <span className="text-[var(--text-muted)] font-normal text-xs"> {p.uom}</span> : null}
                        </span>
                        {low && <AlertTriangle size={12} className="inline ml-1.5 text-red-400" />}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)]">{p.reorder_level ?? '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.supplier || '—'}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[p.status] || STATUS_STYLES.active}`}>{p.status || 'active'}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setPendingDelete(p)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Analytics */}
      {rows !== null && summary.total > 0 && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 pt-1">
            <BarChart3 size={18} className="text-sky-400" />
            <h2 className="font-bold text-[var(--text-primary)]">Inventory analytics</h2>
            <span className="text-xs text-[var(--text-muted)] ml-auto">Across all {summary.total} catalog parts</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Value by category</p>
              <p className="text-xs text-[var(--text-muted)] mb-3">Inventory value ({activeCurrency}) contribution per category</p>
              <div className="h-64">
                {analytics.valuation.total > 0
                  ? <Doughnut data={valueByCategory} options={{ maintainAspectRatio: false, responsive: true, plugins: { legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } } } }} />
                  : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No costed stock to value yet.</div>}
              </div>
            </div>

            <div className="card">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Stock status</p>
              <p className="text-xs text-[var(--text-muted)] mb-3">Parts by on-hand position vs reorder point</p>
              <div className="h-64"><Bar data={statusBar} options={chartAxis} /></div>
            </div>

            <div className="card">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">ABC class distribution</p>
              <p className="text-xs text-[var(--text-muted)] mb-3">Pareto split by inventory value (A ~80%, B ~15%, C ~5%)</p>
              <div className="h-64"><Bar data={abcBar} options={chartAxis} /></div>
            </div>

            <div className="card">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Top value parts</p>
              <p className="text-xs text-[var(--text-muted)] mb-3">Highest line value ({activeCurrency}) SKUs</p>
              <div className="h-64">
                {topValueBar.labels.length
                  ? <Bar data={topValueBar} options={{ ...chartAxis, indexAxis: 'y' }} />
                  : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No costed stock to rank yet.</div>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Reorder needed */}
            <div className="card !p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
                <ShoppingCart size={16} className="text-orange-400" />
                <h3 className="font-semibold text-[var(--text-primary)] text-sm">Reorder needed</h3>
                <span className="text-xs text-[var(--text-muted)] ml-auto">{analytics.reorder.length} parts</span>
              </div>
              {analytics.reorder.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                  <ClipboardList size={20} className="mx-auto mb-2 opacity-60" />
                  All active parts are above their reorder point.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[var(--card-bg)]">
                      <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                        {['Part', 'On Hand', 'Reorder', 'Suggest Qty', 'Est. Cost', 'Supplier'].map((h) => (
                          <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.reorder.map((r) => (
                        <tr key={r.id} className="border-b border-[var(--input-border)]/50">
                          <td className="px-3 py-2">
                            <div className="font-mono text-xs text-[var(--text-primary)]">{r.part_no}</div>
                            {r.name ? <div className="text-xs text-[var(--text-muted)] truncate max-w-[160px]">{r.name}</div> : null}
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-semibold" style={{ color: STOCK_STATUS_META[r.status].color }}>{r.on_hand_qty}</span>
                          </td>
                          <td className="px-3 py-2 text-[var(--text-muted)]">{r.reorder_level}</td>
                          <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">{r.suggestedQty}{r.uom ? <span className="text-[var(--text-muted)] font-normal text-xs"> {r.uom}</span> : null}</td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{r.estimatedCost == null ? 'N/A' : formatCurrency(r.estimatedCost, activeCurrency)}</td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{r.supplier || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ABC analysis */}
            <div className="card !p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
                <Layers size={16} className="text-emerald-400" />
                <h3 className="font-semibold text-[var(--text-primary)] text-sm">ABC analysis</h3>
                <span className="text-xs text-[var(--text-muted)] ml-auto">By inventory value</span>
              </div>
              {analytics.abc.total <= 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                  <BarChart3 size={20} className="mx-auto mb-2 opacity-60" />
                  No costed stock to rank yet. Add unit cost and on-hand quantity.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-px bg-[var(--input-border)]">
                    {['A', 'B', 'C'].map((cls) => {
                      const s = analytics.abc.summary[cls]
                      const share = analytics.abc.total > 0 ? Math.round((s.value / analytics.abc.total) * 100) : 0
                      return (
                        <div key={cls} className="bg-[var(--card-bg)] px-3 py-3 text-center">
                          <div className="text-xs text-[var(--text-muted)]">Class {cls}</div>
                          <div className="text-xl font-bold" style={{ color: ABC_COLORS[cls] }}>{s.count}</div>
                          <div className="text-xs text-[var(--text-muted)]">{share}% value</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-[var(--card-bg)]">
                        <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                          {['Part', 'Value', 'Cum %', 'Class'].map((h) => (
                            <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.abc.items.filter((i) => i.value > 0).slice(0, 30).map((i) => (
                          <tr key={i.id} className="border-b border-[var(--input-border)]/50">
                            <td className="px-3 py-2 font-mono text-xs text-[var(--text-primary)]">{i.part_no}</td>
                            <td className="px-3 py-2 text-[var(--text-secondary)]">{formatCurrency(i.value, activeCurrency)}</td>
                            <td className="px-3 py-2 text-[var(--text-muted)]">{i.cumShare}%</td>
                            <td className="px-3 py-2">
                              <span className="badge text-[11px] px-2 py-0.5 rounded" style={{ backgroundColor: withAlpha(ABC_COLORS[i.abcClass], 0.18), color: ABC_COLORS[i.abcClass] }}>{i.abcClass}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Data quality */}
          {analytics.dataQuality.totalIssues > 0 && (
            <div className="card border border-amber-800/40">
              <div className="flex items-center gap-2 mb-3">
                <ShieldAlert size={16} className="text-amber-400" />
                <h3 className="font-semibold text-[var(--text-primary)] text-sm">Data quality</h3>
                <span className="text-xs text-[var(--text-muted)] ml-auto">{analytics.dataQuality.totalIssues} issues found</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                {[
                  { label: 'Missing cost', value: analytics.dataQuality.counts.missingCost },
                  { label: 'Missing reorder', value: analytics.dataQuality.counts.missingReorder },
                  { label: 'Negative qty', value: analytics.dataQuality.counts.negativeQty },
                  { label: 'Missing category', value: analytics.dataQuality.counts.missingCategory },
                ].map((d) => (
                  <div key={d.label} className="rounded-lg bg-[var(--input-bg)]/50 px-3 py-2">
                    <div className={`text-lg font-bold ${d.value > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{d.value}</div>
                    <div className="text-xs text-[var(--text-muted)]">{d.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create / edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={closeForm}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-[var(--card-bg)] border-b border-[var(--input-border)] px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-[var(--text-primary)]">{editing ? 'Edit part' : 'Add part to catalog'}</h2>
              <button onClick={closeForm} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Part number <span className="text-red-400">*</span></label>
                  <input className="input w-full" value={form.part_no} maxLength={120} onChange={(e) => set('part_no', e.target.value)} placeholder="e.g. FLT-OIL-TY-001" />
                </div>
                <div>
                  <label className="label">Name</label>
                  <input className="input w-full" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Engine Oil Filter" />
                </div>
                <div>
                  <label className="label">Category</label>
                  <select className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Unit of measure</label>
                  <select className="input w-full" value={form.uom} onChange={(e) => set('uom', e.target.value)}>
                    {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Unit cost ({activeCurrency})</label>
                  <input type="number" step="0.01" min="0" className="input w-full" value={form.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">On-hand quantity</label>
                  <input type="number" step="any" min="0" className="input w-full" value={form.on_hand_qty} onChange={(e) => set('on_hand_qty', e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="label">Reorder level</label>
                  <input type="number" step="any" min="0" className="input w-full" value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} placeholder="e.g. 5" />
                </div>
                <div>
                  <label className="label">Supplier</label>
                  <input className="input w-full" value={form.supplier} maxLength={200} onChange={(e) => set('supplier', e.target.value)} placeholder="e.g. Al Futtaim Parts" />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {PART_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input w-full min-h-[80px] resize-y" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} placeholder="Specifications, compatibility, storage location…" />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center gap-3 pt-1">
                <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add part'}
                </button>
                <button type="button" onClick={closeForm} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => !deleting && setPendingDelete(null)}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--input-border)] flex items-center gap-2">
              <Trash2 size={18} className="text-red-400" />
              <h2 className="font-bold text-[var(--text-primary)]">Delete part?</h2>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Delete <span className="font-mono text-[var(--text-primary)]">{pendingDelete.part_no}</span>
                {pendingDelete.name ? ` — ${pendingDelete.name}` : ''}? This can't be undone.
              </p>
              <div className="flex items-center gap-3">
                <button onClick={confirmDelete} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-500 inline-flex items-center gap-2 disabled:opacity-60">
                  {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
                <button onClick={() => setPendingDelete(null)} disabled={deleting} className="btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
