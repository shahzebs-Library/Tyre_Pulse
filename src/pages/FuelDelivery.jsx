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
 * status / flag / search filters, a sortable register (EnterpriseTable),
 * Excel + PDF export, and loading / error+Retry / honest empty states. Runs on
 * the `fuel_deliveries` table (MIGRATIONS_V148_FUEL_DELIVERIES.sql); when it is
 * not provisioned the page says so and logging stays disabled. Pure maths
 * lives in src/lib/fuelDeliveryAnalytics.js (no fabricated data). Money is
 * never totalled across countries (the table has no currency column) and an
 * uncosted delivery is never counted as costing 0.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  Fuel, Droplet, DollarSign, Package, Plus, Pencil, Trash2, Search, X,
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, CheckCircle2,
  Clock, XCircle, TrendingUp, TrendingDown, Minus, Building2, Truck,
  ShieldAlert, Activity, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listDeliveries, createDelivery, updateDelivery, deleteDelivery,
  isDeliveriesTableMissing, DELIVERY_STATUSES,
} from '../lib/api/fuelDeliveries'
import {
  analyzeDeliveries, filterDeliveries, distinctValues, costBasis, deliveryRegisterRows,
  deliveryExportRows, DELIVERY_EXPORT_COLUMNS, ANOMALY_LABELS,
} from '../lib/fuelDeliveryAnalytics'
import { toUserMessage } from '../lib/safeError'
import { formatCurrencyCompact } from '../lib/formatters'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { categorical, colorAt, withAlpha } from '../lib/reportColors'
import { compareValues } from '../lib/consoleTable'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend)

const cssVar = (name, fallback) => {
  try { return (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() || fallback }
  catch { return fallback }
}

const STATUS_META = {
  ordered: { label: 'Ordered', cls: 'bg-sky-500/15 text-sky-500 border border-sky-500/40', icon: Clock },
  delivered: { label: 'Delivered', cls: 'bg-green-500/15 text-green-500 border border-green-500/40', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', cls: 'bg-red-500/15 text-red-500 border border-red-500/40', icon: XCircle },
}

const ANOMALY_META = {
  price_outlier: { label: ANOMALY_LABELS.price_outlier, cls: 'text-red-500 bg-red-500/10 border-red-500/40' },
  cost_mismatch: { label: ANOMALY_LABELS.cost_mismatch, cls: 'text-amber-500 bg-amber-500/10 border-amber-500/40' },
  missing_cost: { label: ANOMALY_LABELS.missing_cost, cls: 'text-amber-500 bg-amber-500/10 border-amber-500/40' },
  missing_litres: { label: ANOMALY_LABELS.missing_litres, cls: 'text-amber-500 bg-amber-500/10 border-amber-500/40' },
}

const LIST_CAP = 500 // listDeliveries returns the newest 500 deliveries.
const ICON_BTN = 'inline-flex items-center justify-center h-11 w-11 sm:h-9 sm:w-9 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (v === null || v === undefined || v === '' ? undefined : v)

// Local calendar day, never toISOString (UTC) which rolls back a day east of UTC.
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
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
  const close = () => { if (!busy) onClose?.() }

  return (
    <Modal open onClose={close} size="lg" title={<span className="inline-flex items-center gap-2"><Fuel size={18} aria-hidden="true" />{editing ? 'Edit delivery' : 'Log fuel delivery'}</span>}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="fd-supplier">Supplier</label>
              <input id="fd-supplier" className="input w-full" placeholder="e.g. ADNOC Distribution" value={form.supplier} maxLength={200}
                onChange={(e) => set('supplier', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="fd-site">Site</label>
              <input id="fd-site" className="input w-full" placeholder="e.g. Dubai Depot" value={form.site} maxLength={200}
                onChange={(e) => set('site', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="fd-tank">Tank</label>
              <input id="fd-tank" className="input w-full" placeholder="e.g. Tank A / Diesel bulk" value={form.tank} maxLength={120}
                onChange={(e) => set('tank', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="fd-delivery_no">Delivery No.</label>
              <input id="fd-delivery_no" className="input w-full" placeholder="e.g. DN-2026-001" value={form.delivery_no} maxLength={64}
                onChange={(e) => set('delivery_no', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="fd-litres">Litres</label>
              <input id="fd-litres" type="number" step="0.01" min="0" className="input w-full" placeholder="1000" value={form.litres}
                onChange={(e) => set('litres', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="fd-unit_price">Unit price / L</label>
              <input id="fd-unit_price" type="number" step="0.001" min="0" className="input w-full" placeholder="2.85" value={form.unit_price}
                onChange={(e) => set('unit_price', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="fd-total_cost">Total cost</label>
              <input id="fd-total_cost" type="number" step="0.01" min="0" className="input w-full" placeholder="Auto-calculated" value={form.total_cost}
                onChange={(e) => set('total_cost', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="fd-delivered_at">Delivered / due date</label>
              <input id="fd-delivered_at" type="date" className="input w-full" value={form.delivered_at}
                onChange={(e) => set('delivered_at', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="fd-status">Status</label>
              <select id="fd-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {DELIVERY_STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="fd-notes">Notes</label>
            <textarea id="fd-notes" className="input w-full min-h-[80px] resize-y" placeholder="Optional - reference, driver, batch quality..."
              value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={close} className="btn-secondary text-sm min-h-[44px] sm:min-h-0" disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60 min-h-[44px] sm:min-h-0">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
              {busy ? 'Saving...' : editing ? 'Save changes' : 'Log delivery'}
            </button>
          </div>
        </form>
    </Modal>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function ConfirmDelete({ row, onCancel, onConfirm, busy, error }) {
  if (!row) return null
  const close = () => { if (!busy) onCancel?.() }
  return (
    <Modal
      open
      onClose={close}
      size="sm"
      title="Delete delivery?"
      footer={
        <>
          <button type="button" onClick={close} className="btn-secondary text-sm" disabled={busy}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />} {busy ? 'Deleting...' : 'Delete'}
          </button>
        </>
      }
    >
      <p className="text-sm text-[var(--text-secondary)]">
        Delete the delivery{row.delivery_no ? ` "${row.delivery_no}"` : ''}
        {row.supplier ? ` from ${row.supplier}` : ''}? This cannot be undone.
      </p>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-red-500 mt-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
    </Modal>
  )
}

// ─── KPI tile ─────────────────────────────────────────────────────────────────
function Kpi({ label, value, icon: Icon, tone, sub }) {
  return (
    <div className="card min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums break-words ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Chart panel wrapper ──────────────────────────────────────────────────────
function ChartCard({ title, icon: Icon, empty, loading, emptyText = 'No data for this metric yet.', summary, children }) {
  return (
    <div className="card min-w-0">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3">
        <Icon size={15} className="text-brand-bright" aria-hidden="true" /> {title}
      </h2>
      {loading
        ? <div className="h-56 bg-[var(--input-bg)] rounded animate-pulse" aria-busy="true" />
        : empty
          ? <div className="h-56 flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4">{emptyText}</div>
          : <div className="h-56" role="img" aria-label={summary || title}>{children}</div>}
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
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [actionError, setActionError] = useState('')
  const [deleteError, setDeleteError] = useState('')

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
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const siteOptions = useMemo(() => distinctValues(rows || [], 'site'), [rows])
  const supplierOptions = useMemo(() => distinctValues(rows || [], 'supplier'), [rows])

  const base = useMemo(() => filterDeliveries(rows || [], {
    status: statusFilter, site: siteFilter, supplier: supplierFilter, from, to, search,
  }), [rows, statusFilter, siteFilter, supplierFilter, from, to, search])
  const registerAll = useMemo(() => deliveryRegisterRows(base), [base])
  // The flag filter narrows the register only; KPIs and charts follow the other
  // filters so a flagged-only view never reads as the whole fleet's fuel spend.
  const register = useMemo(
    () => (flaggedOnly ? registerAll.filter((r) => r.anomaly) : registerAll)
      .slice().sort((x, y) => (y.deliveredTime ?? -Infinity) - (x.deliveredTime ?? -Infinity)),
    [registerAll, flaggedOnly],
  )
  const filtered = base

  // Analytics reflect the filtered set so the KPIs/charts drill with the filters.
  const clock = updatedAt || undefined
  const a = useMemo(() => analyzeDeliveries(filtered, clock ? { now: clock } : {}), [filtered, clock])
  const money = useMemo(() => costBasis(filtered), [filtered])
  const topAnomalies = useMemo(() => a.anomalies.slice(0, 40), [a])

  const trend = a.priceTrend
  const TrendIcon = trend.direction === 'up' ? TrendingUp : trend.direction === 'down' ? TrendingDown : Minus
  const trendTone = trend.direction === 'up' ? 'text-red-400' : trend.direction === 'down' ? 'text-green-400' : 'text-[var(--text-muted)]'
  const trendSub = trend.changePct == null
    ? 'Not enough months'
    : `${trend.changePct > 0 ? '+' : ''}${trend.changePct}% vs prior month`

  const loading = rows === null && !error
  const failedEmpty = rows === null && !!error
  const na = (v) => (rows === null ? 'N/A' : v)

  const kpis = [
    { label: 'Deliveries', value: na(a.totalDeliveries.toLocaleString()), icon: Package, tone: 'text-[var(--text-primary)]', sub: a.cancelledDeliveries ? `${a.cancelledDeliveries} cancelled excluded` : `${a.countedDeliveries} counted` },
    { label: 'Total litres', value: na(`${a.totalLitres.toLocaleString()} L`), icon: Droplet, tone: 'text-sky-500', sub: a.avgDeliverySize != null ? `avg ${a.avgDeliverySize.toLocaleString()} L / delivery` : null },
    { label: 'Total spend', value: na(money.totalCost != null ? formatCurrencyCompact(money.totalCost, activeCurrency) : 'N/A'), icon: DollarSign, tone: 'text-amber-500', sub: money.mixedCurrency ? 'Several countries: pick one to total spend' : money.uncostedCount ? `${money.uncostedCount} delivery(s) without a cost` : null },
    { label: 'Avg price / L', value: na(money.blendedPrice != null ? `${activeCurrency} ${money.blendedPrice.toFixed(3)}` : 'N/A'), icon: Fuel, tone: 'text-green-500', sub: money.mixedCurrency ? 'Not comparable across countries' : a.priceStats.min != null ? `range ${a.priceStats.min} to ${a.priceStats.max}` : null },
    { label: 'Price trend', value: na(!money.mixedCurrency && trend.current != null ? `${activeCurrency} ${trend.current.toFixed(3)}` : 'N/A'), icon: TrendIcon, tone: trendTone, sub: money.mixedCurrency ? 'Pick one country' : trendSub },
    { label: 'Suppliers', value: na(a.supplierCount.toLocaleString()), icon: Truck, tone: 'text-indigo-500', sub: a.topSupplier ? `top: ${a.topSupplier.key}` : null },
    { label: 'Sites', value: na(a.siteCount.toLocaleString()), icon: Building2, tone: 'text-purple-500', sub: a.topSite ? `top: ${a.topSite.key}` : null },
    { label: 'Anomalies', value: na(a.anomalyCount.toLocaleString()), icon: ShieldAlert, tone: a.anomalyCount ? 'text-red-500' : 'text-green-500', sub: a.priceCoveragePct != null ? `${a.priceCoveragePct}% priced` : null },
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
      // Price per litre is withheld when the set spans countries (no shared currency).
      ...(money.mixedCurrency ? [] : [{ type: 'line', label: `Price / L (${activeCurrency})`, data: a.monthly.map((m) => m.avgPrice), borderColor: priceColor, backgroundColor: priceColor, tension: 0.3, spanGaps: true, yAxisID: 'y1', pointRadius: 3, order: 1 }]),
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

  // ── Exports: the full register as filtered, never just the visible page ──
  const exportRows = useMemo(() => deliveryExportRows(register), [register])
  const scopeLabel = activeCountry && activeCountry !== 'All' ? activeCountry : 'All countries'
  const doExcel = async () => {
    setActionError('')
    try {
      await exportToExcel(exportRows, DELIVERY_EXPORT_COLUMNS.map((c) => c.key), DELIVERY_EXPORT_COLUMNS.map((c) => c.header), reportFileName('Fuel Deliveries', scopeLabel))
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    setActionError('')
    try {
      await exportToPdf(exportRows, DELIVERY_EXPORT_COLUMNS, `Fuel Deliveries (${scopeLabel})`, reportFileName('Fuel Deliveries', scopeLabel), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = useCallback((row) => { setEditing(row); setModalOpen(true) }, [])
  const onSaved = () => { setModalOpen(false); setEditing(null); load() }

  const doDelete = async () => {
    if (!confirm) return
    setDeleting(true); setDeleteError('')
    try {
      await deleteDelivery(confirm.id)
      setConfirm(null)
      load()
    } catch (err) {
      setDeleteError(toUserMessage(err, 'Could not delete the delivery.'))
    } finally {
      setDeleting(false)
    }
  }

  const columns = useMemo(() => [
    { id: 'delivery_no', header: 'Delivery', accessorFn: (r) => blank(r.delivery_no), sortingFn: valueSort, sortUndefined: 'last', size: 130, cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'supplier', header: 'Supplier', accessorFn: (r) => blank(r.supplier), sortingFn: valueSort, sortUndefined: 'last', size: 150, cell: ({ getValue }) => <span className="text-[var(--text-secondary)]">{getValue() || 'N/A'}</span> },
    { id: 'site', header: 'Site / Tank', accessorFn: (r) => blank(r.site), sortingFn: valueSort, sortUndefined: 'last', size: 160, cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.site || 'N/A'}{row.original.tank ? ` | ${row.original.tank}` : ''}</span> },
    { id: 'litres', header: 'Litres', accessorFn: (r) => r.litresValue ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 110, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums text-[var(--text-secondary)]">{getValue() == null ? 'N/A' : `${fmtNum(getValue())} L`}</span> },
    { id: 'unit_price', header: 'Unit price', accessorFn: (r) => r.unitValue ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 110, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums text-[var(--text-secondary)]">{getValue() == null ? 'N/A' : `${activeCurrency} ${fmtNum(getValue())}`}</span> },
    { id: 'total_cost', header: 'Total cost', accessorFn: (r) => r.costValue ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 120, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums font-medium text-[var(--text-primary)]">{getValue() == null ? 'N/A' : formatCurrencyCompact(getValue(), activeCurrency)}</span> },
    { id: 'delivered_at', header: 'Delivered', accessorFn: (r) => r.deliveredTime ?? undefined, sortingFn: valueSort, sortUndefined: 'last', size: 120, cell: ({ row }) => <span className="text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(row.original.delivered_at)}</span> },
    {
      id: 'status', header: 'Status', accessorFn: (r) => STATUS_META[r.status]?.label || r.status || undefined, sortingFn: valueSort, sortUndefined: 'last', size: 120,
      cell: ({ row }) => {
        const st = STATUS_META[row.original.status]
        if (!st) return <span className="text-[var(--text-muted)]">{row.original.status || 'N/A'}</span>
        const StatusIcon = st.icon
        return <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${st.cls}`}><StatusIcon size={11} aria-hidden="true" /> {st.label}</span>
      },
    },
    {
      id: 'flag', header: 'Flag', accessorFn: (r) => (r.anomaly ? ANOMALY_LABELS[r.anomaly] : undefined), sortingFn: valueSort, sortUndefined: 'last', size: 130,
      cell: ({ row }) => {
        const m = row.original.anomaly ? ANOMALY_META[row.original.anomaly] : null
        return m ? <span className={`badge text-[10px] px-2 py-0.5 rounded border ${m.cls}`}>{m.label}</span> : <span className="text-[var(--text-muted)]">None</span>
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 100, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center gap-1 justify-end">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit delivery ${row.original.delivery_no || ''}`.trim()}><Pencil size={14} /></button>
          <button type="button" onClick={() => { setDeleteError(''); setConfirm(row.original) }} className={`${ICON_BTN} hover:text-red-500`} aria-label={`Delete delivery ${row.original.delivery_no || ''}`.trim()}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ], [activeCurrency, openEdit])

  const clearFilters = () => { setStatusFilter('all'); setSiteFilter(''); setSupplierFilter(''); setFrom(''); setTo(''); setSearch(''); setFlaggedOnly(false) }
  const hasFilters = statusFilter !== 'all' || siteFilter || supplierFilter || from || to || search || flaggedOnly

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
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!register.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={!register.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0" disabled={missing}>
              <Plus size={14} aria-hidden="true" /> Log delivery
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Fuel deliveries are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V148_FUEL_DELIVERIES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && !missing && (
        <div className="card border border-red-500/40 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[var(--text-primary)] font-medium">Could not load fuel deliveries.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-500/40 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)] flex-1">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      {/* KPI tiles */}
      <section aria-label="Fuel delivery figures">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k) => <Kpi key={k.label} {...k} sub={rows === null ? null : k.sub} />)}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-2">
          Figures and charts follow the filters below ({filtered.length} of {(rows || []).length} deliveries). Cancelled deliveries are excluded from litres and spend.
          {rows && rows.length >= LIST_CAP ? ` Only the newest ${LIST_CAP} deliveries are loaded, so older ones are not counted.` : ''}
        </p>
      </section>

      {/* Charts */}
      {!missing && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="xl:col-span-2">
            <ChartCard title={money.mixedCurrency ? 'Monthly volume (last 12 months)' : 'Monthly volume and price per litre (last 12 months)'} icon={Activity} loading={loading} empty={!hasMonthly} summary={`${a.totalLitres.toLocaleString()} litres delivered across the last 12 months`}>
              <Bar data={trendData} options={trendOpts} />
            </ChartCard>
          </div>
          <ChartCard title="Volume by site" icon={Building2} loading={loading} empty={!a.bySite.length} summary={a.topSite ? `Largest site by volume: ${a.topSite.key}` : undefined}>
            <Bar data={siteData} options={hBarOpts} />
          </ChartCard>
          <ChartCard title="Spend by supplier" icon={Truck} loading={loading} empty={money.mixedCurrency || !a.bySupplier.length} emptyText={money.mixedCurrency ? 'Deliveries span several countries with different currencies. Pick one country to compare supplier spend.' : undefined} summary={a.topSupplier ? `Largest supplier: ${a.topSupplier.key}` : undefined}>
            <Bar data={supplierData} options={hBarOpts} />
          </ChartCard>
        </div>
      )}

      {/* Anomalies */}
      {!missing && !loading && a.anomalies.length > 0 && (
        <div className="card border border-amber-500/40">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <ShieldAlert size={15} className="text-amber-500" aria-hidden="true" /> Price and data-quality flags
              <span className="text-xs text-[var(--text-muted)] font-normal">({a.anomalies.length})</span>
            </h2>
            <button type="button" onClick={() => setFlaggedOnly(true)} className="btn-secondary text-xs min-h-[44px] sm:min-h-0">Show flagged in the register</button>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {topAnomalies.map((an, i) => {
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
            <label htmlFor="fd-search" className="sr-only">Search deliveries</label>
            <input id="fd-search" className="input pl-9 w-full" placeholder="Search delivery no, supplier, site, tank, notes..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input w-full sm:w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input w-full sm:w-auto" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input w-full sm:w-auto" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} aria-label="Supplier">
            <option value="">All suppliers</option>
            {supplierOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="fd-from" className="text-xs text-[var(--text-muted)]">From</label>
          <input id="fd-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label htmlFor="fd-to" className="text-xs text-[var(--text-muted)]">To</label>
          <input id="fd-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] min-h-[44px] cursor-pointer">
            <input type="checkbox" className="h-4 w-4" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
            Flagged only
          </label>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{register.length} of {(rows || []).length}</span>
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={register}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={failedEmpty ? error : null}
        onRetry={load}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        viewKey="fuel-delivery"
        initialPageSize={25}
        emptyMessage={missing ? 'Fuel deliveries are not enabled yet.' : (rows || []).length === 0 ? 'No fuel deliveries logged yet. Use "Log delivery" to add the first.' : 'No deliveries match these filters.'}
      />

      <DeliveryModal
        open={modalOpen}
        initial={editing}
        activeCountry={activeCountry}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSaved={onSaved}
      />
      <ConfirmDelete row={confirm} busy={deleting} error={deleteError} onCancel={() => { setConfirm(null); setDeleteError('') }} onConfirm={doDelete} />
    </div>
  )
}
