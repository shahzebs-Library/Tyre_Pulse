/**
 * FuelDelivery (route /fuel-delivery) — log, manage and ANALYSE bulk fuel
 * deliveries into sites / storage tanks. Captures supplier, litres, unit price,
 * total cost, site, tank and delivery date with an ordered -> delivered ->
 * cancelled lifecycle, and turns the log into fuel-cost intelligence: total
 * litres / spend, blended price per litre and its month-on-month trend, volume
 * and cost by site and supplier, a 12-month volume + price trend, and derivable
 * price / data-quality anomalies.
 *
 * Full role-gated CRUD, 8 KPI tiles, charts, date-range / site / supplier /
 * status / search filters, sortable table, Excel + PDF export, and loading /
 * error+Retry / honest empty states. Runs on the `fuel_deliveries` table
 * (MIGRATIONS_V148_FUEL_DELIVERIES.sql). Pure maths lives in
 * src/lib/fuelDeliveryAnalytics.js (no fabricated data).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  Fuel, Droplet, DollarSign, Package, Plus, Pencil, Trash2, Search, X, Filter,
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, CheckCircle2,
  Clock, XCircle, TrendingUp, TrendingDown, Minus, Building2, Truck,
  ShieldAlert, ArrowUp, ArrowDown, Activity, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDeliveries, createDelivery, updateDelivery, deleteDelivery,
  isDeliveriesTableMissing, DELIVERY_STATUSES,
} from '../lib/api/fuelDeliveries'
import {
  analyzeDeliveries, filterDeliveries, distinctValues,
} from '../lib/fuelDeliveryAnalytics'
import { toUserMessage } from '../lib/safeError'
import { formatCurrencyCompact } from '../lib/formatters'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { categorical, colorAt, withAlpha } from '../lib/reportColors'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

const cssVar = (name, fallback) => {
  try { return (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() || fallback }
  catch { return fallback }
}

const STATUS_META = {
  ordered: { label: 'Ordered', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50', icon: Clock },
  delivered: { label: 'Delivered', cls: 'bg-green-900/40 text-green-300 border border-green-700/50', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', cls: 'bg-red-900/40 text-red-300 border border-red-700/50', icon: XCircle },
}

const ANOMALY_META = {
  price_outlier: { label: 'Price outlier', cls: 'text-red-300 bg-red-900/30 border-red-800/50' },
  cost_mismatch: { label: 'Cost mismatch', cls: 'text-amber-300 bg-amber-900/30 border-amber-800/50' },
  missing_cost: { label: 'Missing cost', cls: 'text-amber-300 bg-amber-900/30 border-amber-800/50' },
  missing_litres: { label: 'Missing litres', cls: 'text-amber-300 bg-amber-900/30 border-amber-800/50' },
}

const today = () => new Date().toISOString().slice(0, 10)
const EMPTY_FORM = {
  delivery_no: '', supplier: '', site: '', tank: '',
  litres: '', unit_price: '', total_cost: '',
  delivered_at: today(), status: 'delivered', notes: '',
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}
function fmtNum(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'N/A'
}

// ─── Sort config ──────────────────────────────────────────────────────────────
const SORTS = {
  delivered_at: (a, b) => (Date.parse(a.delivered_at || 0) || 0) - (Date.parse(b.delivered_at || 0) || 0),
  supplier: (a, b) => String(a.supplier || '').localeCompare(String(b.supplier || '')),
  site: (a, b) => String(a.site || '').localeCompare(String(b.site || '')),
  litres: (a, b) => (parseFloat(a.litres) || 0) - (parseFloat(b.litres) || 0),
  unit_price: (a, b) => (parseFloat(a.unit_price) || 0) - (parseFloat(b.unit_price) || 0),
  total_cost: (a, b) => (parseFloat(a.total_cost) || 0) - (parseFloat(b.total_cost) || 0),
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
      setError(toUserMessage(err, 'Could not save the delivery.'))
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
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="Optional - reference, driver, batch quality..."
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
              {busy ? 'Saving...' : editing ? 'Save changes' : 'Log delivery'}
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
          Delete the delivery{row.delivery_no ? ` "${row.delivery_no}"` : ''}
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

// ─── KPI tile ─────────────────────────────────────────────────────────────────
function Kpi({ label, value, icon: Icon, tone, sub }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} />
      </div>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Chart panel wrapper ──────────────────────────────────────────────────────
function ChartCard({ title, icon: Icon, empty, children }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3">
        <Icon size={15} className="text-brand-bright" /> {title}
      </h3>
      {empty
        ? <div className="h-56 flex items-center justify-center text-sm text-[var(--text-muted)]">No data for this metric yet.</div>
        : <div className="h-56">{children}</div>}
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
  const [supplierFilter, setSupplierFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('delivered_at')
  const [sortDir, setSortDir] = useState('desc')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Load the org/country-scoped set once; all sub-filtering happens client-side
  // so KPIs, charts and the table stay in sync with the active filters.
  const load = useCallback(async () => {
    setRefreshing(true); setError('')
    try {
      const data = await listDeliveries({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      setMissing(data.length === 0 ? await isDeliveriesTableMissing() : false)
    } catch (err) {
      setError(toUserMessage(err, 'Could not load fuel deliveries.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const siteOptions = useMemo(() => distinctValues(rows || [], 'site'), [rows])
  const supplierOptions = useMemo(() => distinctValues(rows || [], 'supplier'), [rows])

  const filtered = useMemo(() => {
    const list = filterDeliveries(rows || [], {
      status: statusFilter, site: siteFilter, supplier: supplierFilter, from, to, search,
    })
    const cmp = SORTS[sortKey] || SORTS.delivered_at
    const sorted = [...list].sort(cmp)
    return sortDir === 'desc' ? sorted.reverse() : sorted
  }, [rows, statusFilter, siteFilter, supplierFilter, from, to, search, sortKey, sortDir])

  // Analytics reflect the filtered set so the KPIs/charts drill with the filters.
  const a = useMemo(() => analyzeDeliveries(filtered), [filtered])

  const trend = a.priceTrend
  const TrendIcon = trend.direction === 'up' ? TrendingUp : trend.direction === 'down' ? TrendingDown : Minus
  const trendTone = trend.direction === 'up' ? 'text-red-400' : trend.direction === 'down' ? 'text-green-400' : 'text-[var(--text-muted)]'
  const trendSub = trend.changePct == null
    ? 'Not enough months'
    : `${trend.changePct > 0 ? '+' : ''}${trend.changePct}% vs prior month`

  const loading = rows === null
  const na = (v) => (loading ? 'N/A' : v)

  const kpis = [
    { label: 'Deliveries', value: na(a.totalDeliveries.toLocaleString()), icon: Package, tone: 'text-[var(--text-primary)]', sub: a.cancelledDeliveries ? `${a.cancelledDeliveries} cancelled excluded` : `${a.countedDeliveries} counted` },
    { label: 'Total litres', value: na(`${a.totalLitres.toLocaleString()} L`), icon: Droplet, tone: 'text-sky-400', sub: a.avgDeliverySize != null ? `avg ${a.avgDeliverySize.toLocaleString()} L / delivery` : null },
    { label: 'Total spend', value: na(formatCurrencyCompact(a.totalCost, activeCurrency)), icon: DollarSign, tone: 'text-amber-400', sub: a.avgDeliveryCost != null ? `avg ${formatCurrencyCompact(a.avgDeliveryCost, activeCurrency)} / delivery` : null },
    { label: 'Avg price / L', value: na(a.avgPricePerLitre != null ? `${activeCurrency} ${a.avgPricePerLitre.toFixed(3)}` : 'N/A'), icon: Fuel, tone: 'text-green-400', sub: a.priceStats.min != null ? `range ${a.priceStats.min} to ${a.priceStats.max}` : null },
    { label: 'Price trend', value: na(trend.current != null ? `${activeCurrency} ${trend.current.toFixed(3)}` : 'N/A'), icon: TrendIcon, tone: trendTone, sub: trendSub },
    { label: 'Suppliers', value: na(a.supplierCount.toLocaleString()), icon: Truck, tone: 'text-indigo-400', sub: a.topSupplier ? `top: ${a.topSupplier.key}` : null },
    { label: 'Sites', value: na(a.siteCount.toLocaleString()), icon: Building2, tone: 'text-purple-400', sub: a.topSite ? `top: ${a.topSite.key}` : null },
    { label: 'Anomalies', value: na(a.anomalyCount.toLocaleString()), icon: ShieldAlert, tone: a.anomalyCount ? 'text-red-400' : 'text-green-400', sub: a.priceCoveragePct != null ? `${a.priceCoveragePct}% priced` : null },
  ]

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartText = cssVar('--text-muted', '#9ca3af')
  const gridColor = cssVar('--panel-2', 'rgba(148,163,184,0.15)')
  const volColor = colorAt(4) // sky-ish
  const priceColor = colorAt(2) // amber-ish

  const hasMonthly = a.monthly.some((m) => m.litres > 0 || m.deliveries > 0)
  const trendData = {
    labels: a.monthly.map((m) => m.label),
    datasets: [
      { type: 'bar', label: 'Litres', data: a.monthly.map((m) => m.litres), backgroundColor: withAlpha(volColor, 0.75), borderRadius: 4, maxBarThickness: 26, yAxisID: 'y', order: 2 },
      { type: 'line', label: `Price / L (${activeCurrency})`, data: a.monthly.map((m) => m.avgPrice), borderColor: priceColor, backgroundColor: priceColor, tension: 0.3, spanGaps: true, yAxisID: 'y1', pointRadius: 3, order: 1 },
    ],
  }
  const trendOpts = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'top', labels: { color: chartText, boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: chartText, maxRotation: 0, autoSkip: true }, grid: { display: false } },
      y: { beginAtZero: true, position: 'left', ticks: { color: chartText }, grid: { color: gridColor }, title: { display: true, text: 'Litres', color: chartText } },
      y1: { beginAtZero: false, position: 'right', ticks: { color: chartText }, grid: { display: false }, title: { display: true, text: `Price / L`, color: chartText } },
    },
  }

  const siteData = {
    labels: a.bySite.map((s) => s.key),
    datasets: [{ label: 'Litres', data: a.bySite.map((s) => s.litres), backgroundColor: categorical(a.bySite.length), borderRadius: 4, maxBarThickness: 22 }],
  }
  const supplierData = {
    labels: a.bySupplier.map((s) => s.key),
    datasets: [{ label: `Spend (${activeCurrency})`, data: a.bySupplier.map((s) => s.cost), backgroundColor: categorical(a.bySupplier.length), borderRadius: 4, maxBarThickness: 22 }],
  }
  const hBarOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { color: chartText }, grid: { color: gridColor } },
      y: { ticks: { color: chartText }, grid: { display: false } },
    },
  }

  // ── Exports (respect current filters/sort) ──────────────────────────────────
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
      setError(toUserMessage(err, 'Could not delete the delivery.'))
    } finally {
      setDeleting(false)
    }
  }

  const setSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }
  const SortHead = ({ label, k, right }) => (
    <th className={`px-4 py-3 font-semibold whitespace-nowrap ${right ? 'text-right' : ''}`}>
      <button onClick={() => setSort(k)} className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${right ? 'flex-row-reverse' : ''}`}>
        {label}
        {sortKey === k && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  )

  const clearFilters = () => { setStatusFilter('all'); setSiteFilter(''); setSupplierFilter(''); setFrom(''); setTo(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || siteFilter || supplierFilter || from || to || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fuel Delivery"
        subtitle="Log and analyse bulk fuel deliveries - supplier, litres, price per litre, spend and cost trends."
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
            <p className="text-amber-300 font-medium">Fuel deliveries aren't enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V148_FUEL_DELIVERIES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && !missing && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Couldn't load fuel deliveries.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      {/* Charts */}
      {!missing && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="xl:col-span-2">
            <ChartCard title="Monthly volume and price per litre (last 12 months)" icon={Activity} empty={loading || !hasMonthly}>
              <Bar data={trendData} options={trendOpts} />
            </ChartCard>
          </div>
          <ChartCard title="Volume by site" icon={Building2} empty={loading || !a.bySite.length}>
            <Bar data={siteData} options={hBarOpts} />
          </ChartCard>
          <ChartCard title="Spend by supplier" icon={Truck} empty={loading || !a.bySupplier.length}>
            <Bar data={supplierData} options={hBarOpts} />
          </ChartCard>
        </div>
      )}

      {/* Anomalies */}
      {!missing && !loading && a.anomalies.length > 0 && (
        <div className="card border border-amber-800/40">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3">
            <ShieldAlert size={15} className="text-amber-400" /> Price & data-quality flags
            <span className="text-xs text-[var(--text-muted)] font-normal">({a.anomalies.length})</span>
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {a.anomalies.slice(0, 40).map((an, i) => {
              const meta = ANOMALY_META[an.type] || { label: an.type, cls: 'text-[var(--text-muted)] bg-[var(--input-bg)] border-[var(--input-border)]' }
              return (
                <div key={an.id || i} className="flex items-start gap-3 text-sm">
                  <span className={`badge text-[10px] px-2 py-0.5 rounded border shrink-0 ${meta.cls}`}>{meta.label}</span>
                  <div className="min-w-0">
                    <span className="text-[var(--text-secondary)]">{an.message}</span>
                    <span className="text-[var(--text-muted)] text-xs ml-2">
                      {an.delivery_no || 'N/A'}{an.supplier ? ` | ${an.supplier}` : ''}{an.site ? ` | ${an.site}` : ''}
                    </span>
                  </div>
                </div>
              )
            })}
            {a.anomalies.length > 40 && <p className="text-xs text-[var(--text-muted)]">Showing first 40 of {a.anomalies.length}.</p>}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search delivery no, supplier, site, tank, notes..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} aria-label="Supplier">
            <option value="">All suppliers</option>
            {supplierOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--text-muted)]">From</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <label className="text-xs text-[var(--text-muted)]">To</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
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
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Delivery</th>
                <SortHead label="Supplier" k="supplier" />
                <SortHead label="Site / Tank" k="site" />
                <SortHead label="Litres" k="litres" right />
                <SortHead label="Unit price" k="unit_price" right />
                <SortHead label="Total cost" k="total_cost" right />
                <SortHead label="Delivered" k="delivered_at" />
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Status</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {(rows || []).length === 0 ? 'No fuel deliveries logged yet. Use "Log delivery" to add the first.' : 'No deliveries match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const st = STATUS_META[r.status] || STATUS_META.delivered
                  const StatusIcon = st.icon
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.delivery_no || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.supplier || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || 'N/A'}{r.tank ? ` | ${r.tank}` : ''}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] text-right">{r.litres == null ? 'N/A' : `${fmtNum(r.litres)} L`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] text-right">{r.unit_price == null ? 'N/A' : `${activeCurrency} ${fmtNum(r.unit_price)}`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium text-right">{r.total_cost == null ? 'N/A' : formatCurrencyCompact(r.total_cost, activeCurrency)}</td>
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
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 - refine filters or export for the full set.</p>}
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
