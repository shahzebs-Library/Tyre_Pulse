/**
 * PartsCatalog (route /parts-catalog) - the master catalog of spare parts: part
 * number, name, category, unit cost, on-hand quantity, reorder level, supplier
 * and unit of measure. Full CRUD with a KPI strip, search + category / status /
 * stock / supplier filters, a sortable paged register, inventory analytics
 * (valuation, stock status, ABC Pareto), a purchase list and data-quality flags,
 * with Excel/PDF exports of the full filtered result.
 *
 * Inventory maths live in `src/lib/partsCatalog.js`; register shaping (filters,
 * sorting, KPIs, export rows) lives in `src/lib/partsCatalogAnalytics.js`. Reads
 * go through the `partsCatalog` service (org-isolated, country-scoped RLS).
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
  ShoppingCart, BarChart3, ClipboardList, ShieldAlert, RefreshCcw,
  ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact, formatCurrency } from '../lib/formatters'
import {
  listParts, createPart, updatePart, deletePart, PART_STATUSES,
} from '../lib/api/partsCatalog'
import {
  summarizeParts, buildPartsAnalytics, abcClassByPart, STOCK_STATUS_META, STOCK_STATUS_KEYS,
} from '../lib/partsCatalog'
import {
  filterParts, partTableRows, PART_SORT_ACCESSORS, sortRows, partsKpis, abcTableRows, abcShare,
  partExportRows, PART_EXPORT_COLS, PART_EXPORT_HEADERS, reorderExportRows,
  REORDER_EXPORT_COLS, REORDER_EXPORT_HEADERS, distinctValues, ABC_TABLE_ROWS,
} from '../lib/partsCatalogAnalytics'
import { nextSort } from '../lib/consoleTableSort'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

/** ABC class tones are semantic (value tier), so they stay fixed. */
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

const AXIS_TICK = { color: 'var(--text-muted)', font: { size: 11 } }
const CHART_AXIS = {
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: AXIS_TICK, grid: { color: 'var(--panel-2)' } },
    y: { beginAtZero: true, ticks: AXIS_TICK, grid: { color: 'var(--panel-2)' } },
  },
  maintainAspectRatio: false,
  responsive: true,
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-bright,#22c55e)]'

function SortButton({ label, active, dir, onClick, align }) {
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 min-h-[32px] rounded ${FOCUS} ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-[var(--text-primary)]' : ''}`}
      aria-label={`Sort by ${label}${active ? `, currently ${dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
    >
      {label}
      <Icon size={12} aria-hidden="true" />
    </button>
  )
}

/**
 * EnterpriseTable over the shared pager. Sorting runs over the FULL row set
 * before paging (usePagedRows), so a column sort never re-orders only the
 * visible page. Columns: { id, header, sort?: accessor, cell?, align?, size? }.
 */
function SortedPagedTable({ columns, rows, defaultSort, getRowId, emptyMessage, loading, error, onRetry, maxHeight = 620 }) {
  const [sort, setSort] = useState(defaultSort)
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === sort?.key)
    return col?.sort ? sortRows(rows, sort, { [col.id]: col.sort }) : rows
  }, [rows, columns, sort])
  const pager = usePagedRows(sorted)
  const tableColumns = useMemo(() => columns.map((c) => ({
    id: c.id,
    accessorFn: c.sort || ((r) => r[c.id]),
    header: c.sort
      ? () => <SortButton label={c.header} align={c.align} active={sort?.key === c.id} dir={sort?.dir} onClick={() => setSort((s) => nextSort(s, c.id, c.firstDir || 'desc'))} />
      : c.header,
    cell: c.cell ? ({ row }) => c.cell(row.original) : undefined,
    size: c.size,
    enableSorting: false,
    meta: { align: c.align, export: c.id !== 'actions' },
  })), [columns, sort])
  return (
    <div className="space-y-2">
      <EnterpriseTable
        columns={tableColumns}
        data={pager.pageRows}
        getRowId={getRowId}
        loading={loading}
        error={error || null}
        onRetry={onRetry}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableSorting={false}
        enableExport={false}
        virtual
        maxHeight={maxHeight}
        emptyMessage={emptyMessage}
      />
      {!loading && !error && <TablePagination {...pager} />}
    </div>
  )
}

function Kpi({ label, value, sub, icon: Icon, tone = 'text-[var(--text-primary)]' }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub ? <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p> : null}
    </Card>
  )
}

export default function PartsCatalog() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('all')
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
    setRefreshing(true); setLoadError('')
    try {
      const data = await listParts({ country: activeCountry })
      setMissing(Array.isArray(data) && data.missing === true)
      setRows(Array.isArray(data) ? [...data] : [])
      setUpdatedAt(new Date())
    } catch (err) {
      // A failed read is NOT an empty catalog: rows stay null so every figure
      // reads N/A and the register shows the error with a Retry.
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setLoadError(toUserMessage(err, 'Could not load the parts catalog.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loaded = rows !== null
  const summary = useMemo(() => summarizeParts(rows || []), [rows])
  const analytics = useMemo(() => buildPartsAnalytics(rows || []), [rows])
  const abcMap = useMemo(() => abcClassByPart(rows || []), [rows])
  const kpi = useMemo(() => partsKpis(analytics), [analytics])
  const abcTable = useMemo(() => abcTableRows(analytics.abc.items), [analytics])

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

  const categoryOptions = useMemo(() => distinctValues(rows || [], 'category'), [rows])
  const supplierOptions = useMemo(() => distinctValues(rows || [], 'supplier'), [rows])

  const filteredRaw = useMemo(
    () => filterParts(rows || [], { search, category: categoryFilter, status: statusFilter, stock: stockFilter, supplier: supplierFilter }),
    [rows, search, categoryFilter, statusFilter, stockFilter, supplierFilter],
  )
  const tableRows = useMemo(() => partTableRows(filteredRaw, abcMap), [filteredRaw, abcMap])
  const reorderPager = usePagedRows(analytics.reorder)

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowForm(true) }
  const openEdit = useCallback((p) => {
    setEditing(p)
    setForm({
      part_no: p.part_no ?? '', name: p.name ?? '', category: p.category ?? 'engine',
      unit_cost: p.unit_cost ?? '', on_hand_qty: p.on_hand_qty ?? '',
      reorder_level: p.reorder_level ?? '', supplier: p.supplier ?? '',
      uom: p.uom ?? 'pcs', status: p.status ?? 'active', notes: p.notes ?? '',
    })
    setFormError(''); setShowForm(true)
  }, [])
  // ONE guarded close for each dialog. `Modal` routes Escape, the backdrop and
  // its own X through a single `onClose`. `submit` clears the dialog state
  // DIRECTLY rather than calling this: it runs while `saving` is still true, so
  // a guarded close would leave the dialog open after a successful save.
  const closeForm = () => { if (!saving) { setShowForm(false); setEditing(null) } }
  const closeDelete = () => { if (!deleting) setPendingDelete(null) }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.part_no.trim()) { setFormError('A part number is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updatePart(editing.id, payload)
      else await createPart(payload)
      setShowForm(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the part.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    setDeleting(true); setActionError('')
    try {
      await deletePart(pendingDelete.id)
      setPendingDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the part.'))
    } finally {
      setDeleting(false)
    }
  }, [pendingDelete, load])

  // Exports cover the FULL filtered register, in the table's default order.
  const exportRows = useMemo(
    () => partExportRows(sortRows(tableRows, { key: 'part_no', dir: 'asc' }, PART_SORT_ACCESSORS)),
    [tableRows],
  )
  const exportExcel = () => exportToExcel(exportRows, PART_EXPORT_COLS, PART_EXPORT_HEADERS, reportFileName('Parts Catalog', activeCountry), 'Parts', { currency: activeCurrency, title: 'Parts Catalog' })
  const exportPdf = () => exportToPdf(exportRows, PART_EXPORT_COLS.map((k, i) => ({ key: k, header: PART_EXPORT_HEADERS[i] })), 'Parts Catalog', reportFileName('Parts Catalog', activeCountry), 'landscape', '', { currency: activeCurrency })
  const reorderRows = useMemo(() => reorderExportRows(analytics.reorder), [analytics])
  const exportReorder = (kind) => {
    if (!reorderRows.length) return
    const name = reportFileName('Parts Purchase List', activeCountry)
    if (kind === 'excel') exportToExcel(reorderRows, REORDER_EXPORT_COLS, REORDER_EXPORT_HEADERS, name, 'Reorder', { currency: activeCurrency, title: 'Parts purchase list' })
    else exportToPdf(reorderRows, REORDER_EXPORT_COLS.map((k, i) => ({ key: k, header: REORDER_EXPORT_HEADERS[i] })), 'Parts purchase list', name, 'landscape', '', { currency: activeCurrency })
  }

  const clearFilters = () => { setCategoryFilter('all'); setStatusFilter('all'); setStockFilter('all'); setSupplierFilter('all'); setSearch('') }
  const hasFilters = categoryFilter !== 'all' || statusFilter !== 'all' || stockFilter !== 'all' || supplierFilter !== 'all' || search

  const na = (v) => (loaded ? v : 'N/A')
  const money = (v) => (v == null ? 'N/A' : formatCurrencyCompact(v, activeCurrency))

  const registerColumns = useMemo(() => [
    { id: 'part_no', header: 'Part No', sort: PART_SORT_ACCESSORS.part_no, firstDir: 'asc', size: 150,
      cell: (p) => <span className="font-mono text-xs text-[var(--text-primary)]">{p.part_no}</span> },
    { id: 'name', header: 'Name', sort: PART_SORT_ACCESSORS.name, firstDir: 'asc', size: 200,
      cell: (p) => <span className="text-[var(--text-secondary)]">{p.name || 'N/A'}</span> },
    { id: 'category', header: 'Category', sort: PART_SORT_ACCESSORS.category, firstDir: 'asc', size: 120,
      cell: (p) => <span className="text-[var(--text-secondary)] capitalize">{p.category || 'N/A'}</span> },
    { id: 'unit_cost', header: 'Unit Cost', sort: PART_SORT_ACCESSORS.unit_cost, align: 'right', size: 110,
      cell: (p) => <span className="tabular-nums">{p._unitCost == null ? 'N/A' : formatCurrency(p._unitCost, activeCurrency)}</span> },
    { id: 'on_hand', header: 'On Hand', sort: PART_SORT_ACCESSORS.on_hand, align: 'right', size: 100,
      cell: (p) => (
        <span className="tabular-nums text-[var(--text-secondary)]">
          {p.on_hand_qty ?? 'N/A'}{p.uom ? <span className="text-[var(--text-muted)] text-xs"> {p.uom}</span> : null}
        </span>
      ) },
    { id: 'reorder', header: 'Reorder', sort: PART_SORT_ACCESSORS.reorder, align: 'right', size: 90,
      cell: (p) => <span className="tabular-nums text-[var(--text-muted)]">{p.reorder_level ?? 'N/A'}</span> },
    { id: 'stock', header: 'Stock', sort: PART_SORT_ACCESSORS.stock, firstDir: 'asc', size: 140,
      cell: (p) => {
        const meta = STOCK_STATUS_META[p._stock]
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: meta.color }}>
            {(p._stock === 'out' || p._stock === 'below_reorder') && <AlertTriangle size={12} aria-hidden="true" />}
            {meta.label}
          </span>
        )
      } },
    { id: 'line_value', header: 'Line Value', sort: PART_SORT_ACCESSORS.line_value, align: 'right', size: 120,
      cell: (p) => <span className="tabular-nums">{p._lineValue == null ? 'N/A' : formatCurrency(p._lineValue, activeCurrency)}</span> },
    { id: 'abc', header: 'ABC', sort: PART_SORT_ACCESSORS.abc, firstDir: 'asc', size: 70,
      cell: (p) => (p._abc
        ? <span className="badge text-[11px] px-2 py-0.5 rounded" style={{ backgroundColor: withAlpha(ABC_COLORS[p._abc], 0.18), color: ABC_COLORS[p._abc] }}>{p._abc}</span>
        : <span className="text-[var(--text-muted)]">N/A</span>) },
    { id: 'supplier', header: 'Supplier', sort: PART_SORT_ACCESSORS.supplier, firstDir: 'asc', size: 150,
      cell: (p) => <span className="text-[var(--text-secondary)]">{p.supplier || 'N/A'}</span> },
    { id: 'status', header: 'Status', sort: PART_SORT_ACCESSORS.status, firstDir: 'asc', size: 110,
      cell: (p) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[p.status] || STATUS_STYLES.active}`}>{p.status || 'active'}</span> },
    { id: 'actions', header: 'Actions', size: 110,
      cell: (p) => (
        <div className="flex items-center gap-1 justify-end">
          <button type="button" onClick={() => openEdit(p)} className={`min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`} aria-label={`Edit part ${p.part_no}`}><Pencil size={15} aria-hidden="true" /></button>
          <button type="button" onClick={() => setPendingDelete(p)} className={`min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 ${FOCUS}`} aria-label={`Delete part ${p.part_no}`}><Trash2 size={15} aria-hidden="true" /></button>
        </div>
      ) },
  ], [activeCurrency, openEdit])

  const reorderColumns = useMemo(() => [
    { id: 'part', header: 'Part', size: 170,
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-mono text-xs text-[var(--text-primary)]">{r.part_no}</div>
          {r.name ? <div className="text-xs text-[var(--text-muted)] truncate max-w-[180px]">{r.name}</div> : null}
        </div>
      ) },
    { id: 'on_hand', header: 'On Hand', align: 'right', size: 90,
      cell: (r) => (
        <span className="inline-flex items-center gap-1 font-semibold tabular-nums" style={{ color: STOCK_STATUS_META[r.status].color }}>
          {r.on_hand_qty}<span className="sr-only"> ({STOCK_STATUS_META[r.status].label})</span>
        </span>
      ) },
    { id: 'reorder', header: 'Reorder', align: 'right', size: 80, cell: (r) => <span className="tabular-nums text-[var(--text-muted)]">{r.reorder_level}</span> },
    { id: 'suggest', header: 'Suggest Qty', align: 'right', size: 110,
      cell: (r) => <span className="font-semibold tabular-nums text-[var(--text-primary)]">{r.suggestedQty}{r.uom ? <span className="text-[var(--text-muted)] font-normal text-xs"> {r.uom}</span> : null}</span> },
    { id: 'cost', header: 'Est. Cost', align: 'right', size: 110, cell: (r) => <span className="tabular-nums">{r.estimatedCost == null ? 'N/A' : formatCurrency(r.estimatedCost, activeCurrency)}</span> },
    { id: 'supplier', header: 'Supplier', size: 140, cell: (r) => <span className="text-[var(--text-secondary)]">{r.supplier || 'N/A'}</span> },
  ], [activeCurrency])

  const abcColumns = useMemo(() => [
    { id: 'part', header: 'Part', accessorFn: (i) => i.part_no, cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{row.original.part_no}</span> },
    { id: 'value', header: 'Value', accessorFn: (i) => i.value, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{formatCurrency(row.original.value, activeCurrency)}</span> },
    { id: 'cum', header: 'Cum %', accessorFn: (i) => i.cumShare, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums text-[var(--text-muted)]">{row.original.cumShare}%</span> },
    { id: 'class', header: 'Class', accessorFn: (i) => i.abcClass,
      cell: ({ row }) => <span className="badge text-[11px] px-2 py-0.5 rounded" style={{ backgroundColor: withAlpha(ABC_COLORS[row.original.abcClass], 0.18), color: ABC_COLORS[row.original.abcClass] }}>{row.original.abcClass}</span> },
  ], [activeCurrency])

  const registerEmpty = summary.total === 0 && !missing
    ? 'No parts in the catalog yet. Use Add part to create the first one.'
    : 'No parts match these filters.'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parts Catalog"
        subtitle="Master catalog of spare parts: cost, on-hand stock, reorder levels and suppliers, with low-stock alerts."
        icon={Boxes}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!exportRows.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={exportPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!exportRows.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <Plus size={15} aria-hidden="true" /> Add part
            </button>
          </div>
        }
      />

      {/* `tone` carries the amber edge; `flexDirection` is inline because Card is
          `flex flex-col` and a `flex-row` class cannot win the cascade. */}
      {missing && (
        <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">The parts catalog isn't enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V140_PARTS_CATALOG.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {loadError && (
        <Card tone="crit" className="items-start gap-3" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-red-300 font-medium">The parts catalog could not be loaded.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{loadError} Figures below read N/A until it loads.</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] shrink-0"><RefreshCcw size={14} aria-hidden="true" /> Retry</button>
        </Card>
      )}

      {actionError && (
        <Card tone="crit" className="items-start gap-3" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={`min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] ${FOCUS}`} aria-label="Dismiss error"><X size={15} aria-hidden="true" /></button>
        </Card>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total SKUs" value={na(kpi.totalSkus)} sub={loaded ? `${kpi.active} active, ${kpi.discontinued} discontinued` : null} icon={Package} />
        <Kpi label="Inventory value" value={loaded ? money(kpi.inventoryValue) : 'N/A'} sub={loaded ? `${kpi.valuedSkus} SKU${kpi.valuedSkus === 1 ? '' : 's'} costed` : null} icon={DollarSign} tone="text-amber-400" />
        <Kpi label="Out of stock" value={na(kpi.outOfStock)} sub="on hand at or below zero" icon={PackageX} tone={kpi.outOfStock ? 'text-red-400' : 'text-[var(--text-primary)]'} />
        <Kpi label="At or below reorder" value={na(kpi.belowReorder)} sub="includes out of stock" icon={ShoppingCart} tone={kpi.belowReorder ? 'text-orange-400' : 'text-[var(--text-primary)]'} />
        <Kpi label="Reorder spend" value={loaded ? money(kpi.reorderSpend) : 'N/A'} sub={loaded ? (kpi.reorderUncosted ? `${kpi.reorderUncosted} line${kpi.reorderUncosted === 1 ? '' : 's'} without a unit cost` : `${kpi.reorderLines} line${kpi.reorderLines === 1 ? '' : 's'} to order`) : null} icon={ClipboardList} tone="text-sky-400" />
        <Kpi label="Data issues" value={na(kpi.dataIssues)} sub="missing cost, reorder or category" icon={ShieldAlert} tone={kpi.dataIssues ? 'text-amber-400' : 'text-[var(--text-primary)]'} />
      </div>

      {/* Filters */}
      <Card className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,2fr)_repeat(4,minmax(0,1fr))] gap-2 items-end">
          <div className="relative">
            <label htmlFor="parts-search" className="sr-only">Search parts</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="parts-search" type="search" className="input pl-9 w-full min-h-[44px]" placeholder="Search part no, name, supplier..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input min-h-[44px]" value={stockFilter} onChange={(e) => setStockFilter(e.target.value)} aria-label="Stock status">
            <option value="all">All stock levels</option>
            {STOCK_STATUS_KEYS.map((k) => <option key={k} value={k}>{STOCK_STATUS_META[k].label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} aria-label="Supplier">
            <option value="all">All suppliers</option>
            {supplierOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {PART_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{loaded ? `${tableRows.length} of ${summary.total} parts` : 'N/A'}</span>
        </div>
      </Card>

      {/* Register */}
      <Card pad="none">
        <CardHeader className="px-4 pt-4" icon={Package} title="Parts register" description="Sort any column; exports cover every filtered part, not just this page." />
        <div className="px-2 pb-3">
          <SortedPagedTable
            columns={registerColumns}
            rows={tableRows}
            defaultSort={{ key: 'part_no', dir: 'asc' }}
            getRowId={(r) => String(r.id)}
            loading={!loaded && !loadError}
            error={loadError}
            onRetry={load}
            emptyMessage={registerEmpty}
          />
        </div>
      </Card>

      {/* Analytics */}
      {loaded && summary.total > 0 && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 pt-1">
            <BarChart3 size={18} className="text-sky-400" aria-hidden="true" />
            <h2 className="font-bold text-[var(--text-primary)]">Inventory analytics</h2>
            <span className="text-xs text-[var(--text-muted)] ml-auto">Across all {summary.total} catalog parts</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Value by category" description={`Inventory value (${activeCurrency}) contribution per category`} />
              <div className="h-64" role="img" aria-label="Inventory value by category">
                {analytics.valuation.total > 0
                  ? <Doughnut data={valueByCategory} options={{ maintainAspectRatio: false, responsive: true, plugins: { legend: { position: 'right', labels: { color: 'var(--text-muted)', font: { size: 11 }, boxWidth: 12 } } } }} />
                  : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No costed stock to value yet.</div>}
              </div>
            </Card>

            <Card>
              <CardHeader title="Stock status" description="Parts by on-hand position vs reorder point" />
              <div className="h-64" role="img" aria-label={`Stock status: ${STOCK_STATUS_KEYS.map((k) => `${STOCK_STATUS_META[k].label} ${analytics.statusCounts[k]}`).join(', ')}`}><Bar data={statusBar} options={CHART_AXIS} /></div>
            </Card>

            <Card>
              <CardHeader title="ABC class distribution" description="Pareto split by inventory value (A ~80%, B ~15%, C ~5%)" />
              <div className="h-64" role="img" aria-label={`ABC classes: A ${analytics.abc.summary.A.count}, B ${analytics.abc.summary.B.count}, C ${analytics.abc.summary.C.count}`}><Bar data={abcBar} options={CHART_AXIS} /></div>
            </Card>

            <Card>
              <CardHeader title="Top value parts" description={`Highest line value (${activeCurrency}) SKUs`} />
              <div className="h-64" role="img" aria-label="Top value parts">
                {topValueBar.labels.length
                  ? <Bar data={topValueBar} options={{ ...CHART_AXIS, indexAxis: 'y' }} />
                  : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No costed stock to rank yet.</div>}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card pad="none">
              <CardHeader
                className="px-4 py-3 border-b border-[var(--input-border)] !mb-0"
                icon={ShoppingCart}
                iconTone="warn"
                title="Reorder needed"
                actions={<span className="text-xs text-[var(--text-muted)]">{analytics.reorder.length} parts</span>}
              />
              {analytics.reorder.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                  <ClipboardList size={20} className="mx-auto mb-2 opacity-60" aria-hidden="true" />
                  All active parts are above their reorder point.
                </div>
              ) : (
                <div className="p-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 px-1">
                    <span className="text-xs text-[var(--text-muted)] mr-auto">Purchase list, most urgent first</span>
                    <button type="button" onClick={() => exportReorder('excel')} disabled={!reorderRows.length} className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[44px]"><FileSpreadsheet size={12} aria-hidden="true" /> Excel</button>
                    <button type="button" onClick={() => exportReorder('pdf')} disabled={!reorderRows.length} className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[44px]"><FileText size={12} aria-hidden="true" /> PDF</button>
                  </div>
                  <EnterpriseTable
                    columns={reorderColumns.map((c) => ({ id: c.id, header: c.header, accessorFn: (r) => r[c.id], cell: ({ row }) => c.cell(row.original), size: c.size, enableSorting: false, meta: { align: c.align } }))}
                    data={reorderPager.pageRows}
                    getRowId={(r) => String(r.id)}
                    enableGlobalFilter={false}
                    enableColumnFilters={false}
                    enableSorting={false}
                    enableExport={false}
                    virtual
                    maxHeight={360}
                    emptyMessage="No parts to reorder."
                  />
                  <TablePagination {...reorderPager} />
                </div>
              )}
            </Card>

            <Card pad="none">
              <CardHeader
                className="px-4 py-3 border-b border-[var(--input-border)] !mb-0"
                icon={Layers}
                iconTone="good"
                title="ABC analysis"
                actions={(
                  // STATE THE CAP. The table lists at most ABC_TABLE_ROWS parts;
                  // without a note a truncated Pareto reads as the whole catalogue.
                  <span className="text-xs text-[var(--text-muted)]">
                    {abcTable.truncated ? `By inventory value, top ${ABC_TABLE_ROWS} of ${abcTable.costed}` : 'By inventory value'}
                  </span>
                )}
              />
              {analytics.abc.total <= 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                  <BarChart3 size={20} className="mx-auto mb-2 opacity-60" aria-hidden="true" />
                  No costed stock to rank yet. Add unit cost and on-hand quantity.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-px bg-[var(--input-border)]">
                    {['A', 'B', 'C'].map((cls) => {
                      const s = analytics.abc.summary[cls]
                      const share = abcShare(s, analytics.abc.total)
                      return (
                        <div key={cls} className="bg-[var(--card-bg)] px-3 py-3 text-center">
                          <div className="text-xs text-[var(--text-muted)]">Class {cls}</div>
                          <div className="text-xl font-bold tabular-nums" style={{ color: ABC_COLORS[cls] }}>{s.count}</div>
                          <div className="text-xs text-[var(--text-muted)]">{share == null ? 'N/A' : `${share}% value`}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="p-2">
                    <EnterpriseTable
                      columns={abcColumns}
                      data={abcTable.rows}
                      getRowId={(r) => String(r.id)}
                      enableGlobalFilter={false}
                      enableColumnFilters={false}
                      enableExport={false}
                      virtual
                      maxHeight={320}
                      emptyMessage="No costed parts."
                    />
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* Data quality. `tone="warn"` carries the amber edge. */}
          {analytics.dataQuality.totalIssues > 0 && (
            <Card tone="warn">
              <CardHeader
                icon={ShieldAlert}
                iconTone="warn"
                title="Data quality"
                actions={<span className="text-xs text-[var(--text-muted)]">{analytics.dataQuality.totalIssues} issues found</span>}
              />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                {[
                  { label: 'Missing cost', value: analytics.dataQuality.counts.missingCost },
                  { label: 'Missing reorder', value: analytics.dataQuality.counts.missingReorder },
                  { label: 'Negative qty', value: analytics.dataQuality.counts.negativeQty },
                  { label: 'Missing category', value: analytics.dataQuality.counts.missingCategory },
                ].map((d) => (
                  <div key={d.label} className="rounded-lg bg-[var(--input-bg)]/50 px-3 py-2">
                    <div className={`text-lg font-bold tabular-nums ${d.value > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{d.value}</div>
                    <div className="text-xs text-[var(--text-muted)]">{d.label}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Create / edit modal. The submit button stays INSIDE the <form> rather
          than moving to Modal's `footer`: a footer button would need a
          `form="..."` association to keep submitting, which is a behaviour
          change, not a migration. Modal owns the height cap the `max-h-[90vh]`
          and the sticky header were doing by hand, plus the focus trap, the
          scroll lock, escape-to-close and the portal. */}
      {showForm && (
        <Modal
          open
          onClose={closeForm}
          size="md"
          title={editing ? 'Edit part' : 'Add part to catalog'}
        >
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="part-part_no">Part number <span className="text-red-400">*</span></label>
                  <input id="part-part_no" aria-required="true" className="input w-full" value={form.part_no} maxLength={120} onChange={(e) => set('part_no', e.target.value)} placeholder="e.g. FLT-OIL-TY-001" />
                </div>
                <div>
                  <label className="label" htmlFor="part-name">Name</label>
                  <input id="part-name" className="input w-full" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Engine Oil Filter" />
                </div>
                <div>
                  <label className="label" htmlFor="part-category">Category</label>
                  <select id="part-category" className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="part-uom">Unit of measure</label>
                  <select id="part-uom" className="input w-full" value={form.uom} onChange={(e) => set('uom', e.target.value)}>
                    {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="part-unit_cost">Unit cost ({activeCurrency})</label>
                  <input id="part-unit_cost" type="number" step="0.01" min="0" className="input w-full" value={form.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="label" htmlFor="part-on_hand_qty">On-hand quantity</label>
                  <input id="part-on_hand_qty" type="number" step="any" min="0" className="input w-full" value={form.on_hand_qty} onChange={(e) => set('on_hand_qty', e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="label" htmlFor="part-reorder_level">Reorder level</label>
                  <input id="part-reorder_level" type="number" step="any" min="0" className="input w-full" value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} placeholder="e.g. 5" />
                </div>
                <div>
                  <label className="label" htmlFor="part-supplier">Supplier</label>
                  <input id="part-supplier" className="input w-full" value={form.supplier} maxLength={200} onChange={(e) => set('supplier', e.target.value)} placeholder="e.g. Al Futtaim Parts" />
                </div>
                <div>
                  <label className="label" htmlFor="part-status">Status</label>
                  <select id="part-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {PART_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="part-notes">Notes</label>
                <textarea id="part-notes" className="input w-full min-h-[80px] resize-y" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} placeholder="Specifications, compatibility, storage location..." />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center gap-3 pt-1">
                <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving...' : editing ? 'Save changes' : 'Add part'}
                </button>
                <button type="button" onClick={closeForm} className="btn-secondary">Cancel</button>
              </div>
            </form>
        </Modal>
      )}

      {/* Delete confirm. No <form> here, so the actions belong in Modal's
          `footer`, which pins them where a user can always reach them. The
          legacy overlay guarded only its backdrop against closing mid-delete
          and had no X at all; `closeDelete` is now the single guarded close
          behind Escape, the backdrop and the X alike. The Trash2 cue moves
          from the old header row into the body beside the sentence. */}
      {pendingDelete && (
        <Modal
          open
          onClose={closeDelete}
          size="sm"
          title="Delete part?"
          footer={
            <>
              <button onClick={closeDelete} disabled={deleting} className="btn-secondary">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-500 inline-flex items-center gap-2 disabled:opacity-60">
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
            <p className="text-sm text-[var(--text-secondary)]">
              Delete <span className="font-mono text-[var(--text-primary)]">{pendingDelete.part_no}</span>
              {pendingDelete.name ? ` (${pendingDelete.name})` : ''}? This can't be undone.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
