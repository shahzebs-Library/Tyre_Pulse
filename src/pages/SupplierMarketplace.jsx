/**
 * SupplierMarketplace (route /supplier-marketplace) - a two-sided sourcing hub:
 *
 *   - Listings tab: a catalog of supplier offers (tyres, retreads, parts,
 *     services) with price, MOQ, lead time, stock and rating.
 *   - RFQs tab: buyer Requests For Quotation, tracked from responses to best
 *     quote to award, with a running saving estimate.
 *
 * Runs on the `marketplace_listings` / `marketplace_rfqs` tables (V196). The
 * base roll-ups live in `src/lib/marketplace.js`; filtering, the currency-safe
 * price and saving views, the RFQ funnel and export rows live in
 * `src/lib/supplierMarketplaceAnalytics.js`. Money is never blended across
 * currencies: prices and savings are always shown per currency.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Store, ShoppingCart, Package, Star, Layers, Award, Building2, BadgeCheck, Boxes, Send,
  TrendingUp, X, FileSpreadsheet, FileText, Plus, Pencil, Trash2, AlertTriangle, RotateCw,
  Timer, Hourglass, Percent,
} from 'lucide-react'
import { toUserMessage } from '../lib/safeError'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listMarketplaceListings, createListing, updateListing, deleteListing,
  listRfqs, createRfq, updateRfq, deleteRfq,
} from '../lib/api/marketplace'
import {
  LISTING_CATEGORIES, LISTING_STATUSES, RFQ_STATUSES, titleCase, currencyOf, isOverdueRfq,
  filterListings, filterRfqs, listingKpis, rfqKpis, categoryPriceByCurrency, rfqFunnel,
  topRatedSuppliers, potentialSaving, LISTING_EXPORT_COLUMNS, RFQ_EXPORT_COLUMNS,
  listingExportRows, rfqExportRows,
} from '../lib/supplierMarketplaceAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { colorAt } from '../lib/reportColors'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_LISTING = {
  supplier: '', listing_no: '', category: 'tyre', product_name: '', brand: '',
  size_spec: '', unit_price: '', currency: 'SAR', moq: '', lead_time_days: '',
  rating: '', in_stock: true, status: 'active', notes: '',
}
const EMPTY_RFQ = {
  product_name: '', rfq_no: '', category: '', quantity: '', target_price: '',
  currency: 'SAR', needed_by: '', responses_count: '', best_quote: '',
  awarded_supplier: '', status: 'open', notes: '',
}

const CATEGORY_BADGE = {
  tyre: 'bg-sky-900/30 text-sky-300 border-sky-800/50',
  retread: 'bg-violet-900/30 text-violet-300 border-violet-800/50',
  parts: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  service: 'bg-teal-900/30 text-teal-300 border-teal-800/50',
}
const LISTING_STATUS_BADGE = {
  active: 'bg-green-900/30 text-green-300 border-green-800/50',
  out_of_stock: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
}
const RFQ_STATUS_BADGE = {
  open: 'bg-sky-900/30 text-sky-300 border-sky-800/50',
  quoting: 'bg-indigo-900/30 text-indigo-300 border-indigo-800/50',
  awarded: 'bg-green-900/30 text-green-300 border-green-800/50',
  cancelled: 'bg-red-900/30 text-red-300 border-red-800/50',
}
const NEUTRAL_BADGE = 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]'

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

const fmtMoney = (v, currency) => {
  if (v == null || v === '') return 'N/A'
  const c = currency && !String(currency).startsWith('Currency') ? `${currency} ` : ''
  return `${c}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}
const fmtNum = (v) => (v == null || v === '' ? 'N/A' : Number(v).toLocaleString())
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}
const numOr = (v, fb = -1) => (v == null || v === '' || !Number.isFinite(Number(v)) ? fb : Number(v))

function Badge({ value, map }) {
  if (!value) return <span className="text-[var(--text-muted)]">N/A</span>
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${map[value] || NEUTRAL_BADGE}`}>{titleCase(value)}</span>
}

function KpiTile({ label, value, icon: Icon, tone = 'text-[var(--text-primary)]', sub }) {
  return (
    <div className="card !p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</div>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function SupplierMarketplace() {
  const { activeCountry } = useSettings()
  const [tab, setTab] = useState('listings')

  const [listings, setListings] = useState(null)
  const [rfqs, setRfqs] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [asOf, setAsOf] = useState(() => new Date())

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [currencyFilter, setCurrencyFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_LISTING)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const [l, r] = await Promise.all([
        listMarketplaceListings({ country: activeCountry }),
        listRfqs({ country: activeCountry }),
      ])
      setListings(Array.isArray(l) ? l : [])
      setRfqs(Array.isArray(r) ? r : [])
      setAsOf(new Date())
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load the marketplace.'))
      setListings(null); setRfqs(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Reset filters when switching tabs so a stale filter never hides rows.
  useEffect(() => {
    setSearch(''); setCategoryFilter(''); setStatusFilter(''); setCurrencyFilter(''); setStockFilter(''); setOverdueOnly(false)
  }, [tab])

  const failed = !!error || notProvisioned
  const isListings = tab === 'listings'
  const allListings = useMemo(() => listings || [], [listings])
  const allRfqs = useMemo(() => rfqs || [], [rfqs])
  const na = isListings ? listings === null : rfqs === null

  const filteredListings = useMemo(() => filterListings(allListings, {
    category: categoryFilter, status: statusFilter, stock: stockFilter, currency: currencyFilter, search,
  }), [allListings, categoryFilter, statusFilter, stockFilter, currencyFilter, search])
  const filteredRfqs = useMemo(() => filterRfqs(allRfqs, {
    category: categoryFilter, status: statusFilter, currency: currencyFilter, overdueOnly, now: asOf, search,
  }), [allRfqs, categoryFilter, statusFilter, currencyFilter, overdueOnly, asOf, search])

  const lk = useMemo(() => listingKpis(filteredListings), [filteredListings])
  const rk = useMemo(() => rfqKpis(filteredRfqs, { now: asOf }), [filteredRfqs, asOf])
  const priceView = useMemo(() => categoryPriceByCurrency(filteredListings), [filteredListings])
  const topSuppliers = useMemo(() => topRatedSuppliers(filteredListings), [filteredListings])
  const funnel = useMemo(() => rfqFunnel(filteredRfqs), [filteredRfqs])

  const filtered = isListings ? filteredListings : filteredRfqs
  const total = isListings ? allListings.length : allRfqs.length
  const currencyOptions = useMemo(
    () => [...new Set((isListings ? allListings : allRfqs).map(currencyOf))].sort(),
    [isListings, allListings, allRfqs],
  )
  const categoryOptions = isListings
    ? LISTING_CATEGORIES
    : [...new Set(allRfqs.map((r) => r.category).filter(Boolean))].sort()
  const statusOptions = isListings ? LISTING_STATUSES : RFQ_STATUSES
  const hasFilters = !!(search || categoryFilter || statusFilter || currencyFilter || stockFilter || overdueOnly)
  const clearFilters = () => { setSearch(''); setCategoryFilter(''); setStatusFilter(''); setCurrencyFilter(''); setStockFilter(''); setOverdueOnly(false) }

  const v = (x) => (na ? 'N/A' : x)
  const savings = rk.savingsByCurrency
  const savingValue = na ? 'N/A' : savings.length === 0 ? 'N/A' : savings.length === 1
    ? fmtMoney(savings[0].saving, savings[0].currency)
    : <span className="block text-base leading-snug">{savings.map((s) => <span key={s.currency} className="block">{fmtMoney(s.saving, s.currency)}</span>)}</span>

  const listingTiles = [
    { label: 'Total listings', value: v(lk.totalListings.toLocaleString()), icon: Package, sub: na ? null : `${lk.distinctCategories} categories` },
    { label: 'Active', value: v(lk.activeCount), icon: BadgeCheck, tone: 'text-green-400' },
    { label: 'In stock rate', value: v(lk.inStockRate == null ? 'N/A' : `${lk.inStockRate}%`), icon: Boxes, tone: 'text-sky-400', sub: na ? null : `${lk.inStockCount} in stock` },
    { label: 'Suppliers', value: v(lk.distinctSuppliers), icon: Building2, tone: 'text-violet-400' },
    { label: 'Average rating', value: v(lk.avgRating == null ? 'N/A' : lk.avgRating.toFixed(1)), icon: Star, tone: 'text-amber-400', sub: 'Out of 5' },
    { label: 'Average lead time', value: v(lk.avgLeadDays == null ? 'N/A' : `${lk.avgLeadDays} d`), icon: Timer },
  ]
  const rfqTiles = [
    { label: 'Total RFQs', value: v(rk.totalRfqs.toLocaleString()), icon: ShoppingCart },
    { label: 'Open', value: v(rk.openCount), icon: Send, tone: 'text-sky-400' },
    { label: 'Overdue', value: v(rk.overdueCount), icon: Hourglass, tone: rk.overdueCount ? 'text-red-400' : 'text-green-400', sub: 'Open past the needed-by date' },
    { label: 'Award rate', value: v(rk.awardRate == null ? 'N/A' : `${rk.awardRate}%`), icon: Percent, tone: 'text-green-400', sub: na ? null : `${rk.awardedCount} awarded` },
    { label: 'Average responses', value: v(rk.avgResponses == null ? 'N/A' : rk.avgResponses), icon: Layers, tone: 'text-violet-400' },
    { label: 'Potential saving', value: savingValue, icon: TrendingUp, tone: 'text-amber-400', sub: savings.length > 1 ? 'Shown per currency, never combined' : 'Target price minus best quote' },
  ]
  const kpis = isListings ? listingTiles : rfqTiles

  // ── Export ──────────────────────────────────────────────────────────────────
  const exportCols = isListings ? LISTING_EXPORT_COLUMNS : RFQ_EXPORT_COLUMNS
  const exportRows = useMemo(
    () => (isListings ? listingExportRows(filteredListings) : rfqExportRows(filteredRfqs, { now: asOf })),
    [isListings, filteredListings, filteredRfqs, asOf],
  )
  const fileName = reportFileName(isListings ? 'TyrePulse Supplier Listings' : 'TyrePulse Buyer RFQs', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExcel = () => exportToExcel(exportRows, exportCols.map((c) => c[0]), exportCols.map((c) => c[1]), fileName)
  const doPdf = () => exportToPdf(exportRows, exportCols.map(([key, header]) => ({ key, header })), isListings ? 'Supplier Listings' : 'Buyer RFQs', fileName, 'landscape')

  // ── Modal ───────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(isListings ? EMPTY_LISTING : EMPTY_RFQ); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    if (tab === 'listings') {
      setForm({
        supplier: r.supplier || '', listing_no: r.listing_no || '', category: r.category || 'tyre',
        product_name: r.product_name || '', brand: r.brand || '', size_spec: r.size_spec || '',
        unit_price: r.unit_price ?? '', currency: r.currency || 'SAR', moq: r.moq ?? '',
        lead_time_days: r.lead_time_days ?? '', rating: r.rating ?? '',
        in_stock: r.in_stock !== false, status: r.status || 'active', notes: r.notes || '',
      })
    } else {
      setForm({
        product_name: r.product_name || '', rfq_no: r.rfq_no || '', category: r.category || '',
        quantity: r.quantity ?? '', target_price: r.target_price ?? '', currency: r.currency || 'SAR',
        needed_by: r.needed_by || '', responses_count: r.responses_count ?? '',
        best_quote: r.best_quote ?? '', awarded_supplier: r.awarded_supplier || '',
        status: r.status || 'open', notes: r.notes || '',
      })
    }
    setFormError(''); setShowModal(true)
  }, [tab])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, val) => setForm((f) => ({ ...f, [k]: val }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (isListings && !String(form.supplier || '').trim()) { setFormError('A supplier is required.'); return }
    if (!isListings && !String(form.product_name || '').trim()) { setFormError('A product name is required.'); return }
    if (isListings && form.rating !== '' && (Number(form.rating) < 0 || Number(form.rating) > 5)) { setFormError('Rating must be between 0 and 5.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (isListings) {
        if (editing) await updateListing(editing.id, payload)
        else await createListing(payload)
      } else if (editing) {
        await updateRfq(editing.id, payload)
      } else {
        await createRfq(payload)
      }
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, isListings, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      if (isListings) await deleteListing(confirmDelete.id)
      else await deleteRfq(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the record.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, isListings, load])

  // ── Tables ──────────────────────────────────────────────────────────────────
  const rowActions = useCallback((r, label) => (
    <div className="flex items-center justify-end gap-1">
      <button type="button" onClick={() => openEdit(r)} className={ICON_BTN} aria-label={`Edit ${label}`}><Pencil size={15} /></button>
      <button type="button" onClick={() => setConfirmDelete(r)} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete ${label}`}><Trash2 size={15} /></button>
    </div>
  ), [openEdit])

  const listingColumns = useMemo(() => [
    {
      id: 'supplier', header: 'Supplier', accessorFn: (r) => r.supplier || '', size: 180,
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-[var(--text-primary)]">{row.original.supplier || 'N/A'}</div>
          {row.original.listing_no && <div className="text-[11px] text-[var(--text-muted)]">{row.original.listing_no}</div>}
        </div>
      ),
    },
    {
      id: 'product', header: 'Product', accessorFn: (r) => r.product_name || '', size: 200,
      cell: ({ row }) => (
        <div className="text-[var(--text-secondary)]">
          {row.original.product_name || 'N/A'}
          {(row.original.brand || row.original.size_spec) && <div className="text-[11px] text-[var(--text-muted)]">{[row.original.brand, row.original.size_spec].filter(Boolean).join(', ')}</div>}
        </div>
      ),
    },
    { id: 'category', header: 'Category', accessorFn: (r) => titleCase(r.category), size: 110, cell: ({ row }) => <Badge value={row.original.category} map={CATEGORY_BADGE} /> },
    { id: 'price', header: 'Unit price', accessorFn: (r) => numOr(r.unit_price), size: 130, meta: { align: 'right', exportValue: (r) => fmtMoney(r.unit_price, currencyOf(r)) }, cell: ({ row }) => <span className="font-semibold tabular-nums text-[var(--text-primary)] whitespace-nowrap">{fmtMoney(row.original.unit_price, currencyOf(row.original))}</span> },
    { id: 'moq', header: 'MOQ', accessorFn: (r) => numOr(r.moq), size: 80, meta: { align: 'right', exportValue: (r) => fmtNum(r.moq) }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.moq)}</span> },
    { id: 'lead', header: 'Lead time', accessorFn: (r) => numOr(r.lead_time_days), size: 100, meta: { align: 'right', exportValue: (r) => (r.lead_time_days == null || r.lead_time_days === '' ? 'N/A' : `${r.lead_time_days} d`) }, cell: ({ row }) => <span className="tabular-nums">{row.original.lead_time_days == null || row.original.lead_time_days === '' ? 'N/A' : `${fmtNum(row.original.lead_time_days)} d`}</span> },
    {
      id: 'rating', header: 'Rating', accessorFn: (r) => numOr(r.rating), size: 90, meta: { align: 'right', exportValue: (r) => (r.rating == null || r.rating === '' ? 'N/A' : Number(r.rating).toFixed(1)) },
      cell: ({ row }) => (row.original.rating == null || row.original.rating === ''
        ? <span className="text-[var(--text-muted)]">N/A</span>
        : <span className="inline-flex items-center gap-1 text-amber-400 font-medium"><Star size={12} className="fill-amber-400" aria-hidden="true" /> {Number(row.original.rating).toFixed(1)}</span>),
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => titleCase(r.status), size: 130,
      cell: ({ row }) => (
        <div>
          <Badge value={row.original.status} map={LISTING_STATUS_BADGE} />
          {row.original.in_stock === false && <span className="block text-[11px] text-amber-400 mt-0.5">Out of stock</span>}
        </div>
      ),
    },
    { id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false }, cell: ({ row }) => rowActions(row.original, `listing from ${row.original.supplier || 'supplier'}`) },
  ], [rowActions])

  const rfqColumns = useMemo(() => [
    { id: 'rfq', header: 'RFQ', accessorFn: (r) => r.rfq_no || '', size: 110, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)] whitespace-nowrap">{row.original.rfq_no || 'N/A'}</span> },
    {
      id: 'product', header: 'Product', accessorFn: (r) => r.product_name || '', size: 200,
      cell: ({ row }) => (
        <div className="text-[var(--text-secondary)]">
          {row.original.product_name || 'N/A'}
          {row.original.category && <div className="text-[11px] text-[var(--text-muted)]">{row.original.category}</div>}
        </div>
      ),
    },
    { id: 'qty', header: 'Quantity', accessorFn: (r) => numOr(r.quantity), size: 90, meta: { align: 'right', exportValue: (r) => fmtNum(r.quantity) }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.quantity)}</span> },
    { id: 'target', header: 'Target', accessorFn: (r) => numOr(r.target_price), size: 130, meta: { align: 'right', exportValue: (r) => fmtMoney(r.target_price, currencyOf(r)) }, cell: ({ row }) => <span className="tabular-nums whitespace-nowrap">{fmtMoney(row.original.target_price, currencyOf(row.original))}</span> },
    { id: 'best', header: 'Best quote', accessorFn: (r) => numOr(r.best_quote), size: 130, meta: { align: 'right', exportValue: (r) => fmtMoney(r.best_quote, currencyOf(r)) }, cell: ({ row }) => <span className="font-semibold tabular-nums whitespace-nowrap text-[var(--text-primary)]">{fmtMoney(row.original.best_quote, currencyOf(row.original))}</span> },
    {
      id: 'saving', header: 'Saving', accessorFn: (r) => potentialSaving(r), size: 130, meta: { align: 'right', exportValue: (r) => (potentialSaving(r) > 0 ? fmtMoney(potentialSaving(r), currencyOf(r)) : 'N/A') },
      cell: ({ row }) => {
        const s = potentialSaving(row.original)
        return s > 0 ? <span className="text-green-400 font-semibold tabular-nums whitespace-nowrap">{fmtMoney(s, currencyOf(row.original))}</span> : <span className="text-[var(--text-muted)]">N/A</span>
      },
    },
    {
      id: 'needed', header: 'Needed by', accessorFn: (r) => (r.needed_by ? new Date(r.needed_by).getTime() : Infinity), size: 130, meta: { exportValue: (r) => fmtDate(r.needed_by) },
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <span className="text-[var(--text-secondary)]">{fmtDate(row.original.needed_by)}</span>
          {isOverdueRfq(row.original, { now: asOf }) && <span className="block text-[11px] text-red-400">Overdue</span>}
        </div>
      ),
    },
    {
      id: 'responses', header: 'Responses', accessorFn: (r) => numOr(r.responses_count), size: 150, meta: { exportValue: (r) => fmtNum(r.responses_count) },
      cell: ({ row }) => (
        <div className="text-[var(--text-secondary)]">
          {fmtNum(row.original.responses_count)}
          {row.original.awarded_supplier && <span className="block text-[11px] text-green-400">Awarded to {row.original.awarded_supplier}</span>}
        </div>
      ),
    },
    { id: 'status', header: 'Status', accessorFn: (r) => titleCase(r.status), size: 110, cell: ({ row }) => <Badge value={row.original.status} map={RFQ_STATUS_BADGE} /> },
    { id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false }, cell: ({ row }) => rowActions(row.original, `RFQ ${row.original.rfq_no || row.original.product_name || ''}`.trim()) },
  ], [rowActions, asOf])

  const TABS = [
    { id: 'listings', label: 'Listings', icon: Package, count: listings === null ? null : allListings.length },
    { id: 'rfqs', label: 'RFQs', icon: ShoppingCart, count: rfqs === null ? null : allRfqs.length },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Marketplace"
        subtitle="Compare supplier tyre, retread and parts listings, and run buyer RFQs end to end: a measurable sourcing funnel from need to award."
        icon={Store}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={failed}>
              <Plus size={14} aria-hidden="true" /> {isListings ? 'Add listing' : 'New RFQ'}
            </button>
          </div>
        }
      />

      <div className="flex items-center gap-1 border-b border-[var(--input-border)] overflow-x-auto" role="tablist" aria-label="Marketplace views">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                active ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon size={15} aria-hidden="true" /> {t.label}
              <span className="ml-1 rounded-full bg-[var(--input-bg)] px-1.5 py-0.5 text-[11px]">{t.count == null ? 'N/A' : t.count}</span>
            </button>
          )
        })}
      </div>

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">The Supplier Marketplace is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Ask your administrator to enable the marketplace, then refresh.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-red-300 font-medium">Could not load the marketplace.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RotateCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <KpiTile key={k.label} {...k} />)}
      </div>
      {hasFilters && !na && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">These figures cover the {filtered.length} {isListings ? 'listings' : 'RFQs'} matching the current filters.</p>
      )}

      {isListings ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><Layers size={15} aria-hidden="true" /> Price by category and currency</h2>
            <p className="text-xs text-[var(--text-muted)] mb-3">Averages are computed within each currency and never combined.</p>
            {na ? <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
              : priceView.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No listings yet.</p> : (
                <ul className="divide-y divide-[var(--input-border)]/60 max-h-64 overflow-y-auto">
                  {priceView.map((c) => (
                    <li key={`${c.category}-${c.currency}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span className="flex items-center gap-2"><Badge value={c.category} map={CATEGORY_BADGE} /><span className="text-xs text-[var(--text-muted)]">{c.currency}</span></span>
                      <span className="text-xs text-[var(--text-muted)]">{c.listings} listing{c.listings === 1 ? '' : 's'}</span>
                      <span className="text-[var(--text-primary)] tabular-nums">average {fmtMoney(c.avgPrice, c.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
          <div className="card">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Award size={15} aria-hidden="true" /> Top-rated suppliers</h2>
            {na ? <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
              : topSuppliers.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No rated suppliers yet.</p> : (
                <ul className="divide-y divide-[var(--input-border)]/60">
                  {topSuppliers.slice(0, 6).map((s) => (
                    <li key={s.supplier} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-[var(--text-primary)] truncate">{s.supplier}</span>
                      <span className="flex items-center gap-3 shrink-0">
                        <span className="inline-flex items-center gap-1 text-amber-400 font-semibold"><Star size={13} className="fill-amber-400" aria-hidden="true" /> {s.avgRating.toFixed(1)}</span>
                        <span className="text-xs text-[var(--text-muted)]">{s.listings} listing{s.listings === 1 ? '' : 's'}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      ) : (
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Send size={15} aria-hidden="true" /> RFQ funnel</h2>
          {na ? <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" /> : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {funnel.map((f, i) => {
                const max = Math.max(1, ...funnel.map((x) => x.count))
                return (
                  <div key={f.key} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 p-3">
                    <p className="text-xs text-[var(--text-muted)]">{f.label}</p>
                    <p className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{f.count}</p>
                    <div className="h-1.5 mt-2 rounded bg-[var(--panel-2)]" aria-hidden="true">
                      <div className="h-1.5 rounded" style={{ width: `${(f.count / max) * 100}%`, background: colorAt(i) }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="card space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <label className="block lg:col-span-2"><span className="label">Search</span>
            <input className="input w-full min-h-[44px]" placeholder={isListings ? 'Supplier, product, brand, size' : 'Product, RFQ number, supplier'} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label className="block"><span className="label">Category</span>
            <select className="input w-full min-h-[44px]" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All categories</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </select></label>
          <label className="block"><span className="label">Status</span>
            <select className="input w-full min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {statusOptions.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select></label>
          <label className="block"><span className="label">Currency</span>
            <select className="input w-full min-h-[44px]" value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)}>
              <option value="">All currencies</option>
              {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
          {isListings ? (
            <label className="block"><span className="label">Stock</span>
              <select className="input w-full min-h-[44px]" value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
                <option value="">Any</option>
                <option value="in">In stock</option>
                <option value="out">Out of stock</option>
              </select></label>
          ) : (
            <label className="flex items-center gap-2 self-end min-h-[44px] text-sm text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" className="h-4 w-4" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Only overdue RFQs
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{na ? 'Not loaded' : `${filtered.length} of ${total}`}</span>
        </div>
      </div>

      {failed ? (
        <div className="card text-center py-10 text-sm text-[var(--text-muted)]">The marketplace is unavailable.</div>
      ) : isListings ? (
        <EnterpriseTable
          key="listings"
          columns={listingColumns}
          data={filteredListings}
          getRowId={(r) => String(r.id)}
          loading={listings === null}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          exportFileName={fileName}
          viewKey="supplier-marketplace-listings"
          initialPageSize={25}
          emptyMessage={allListings.length === 0 ? 'No listings yet. Add your first supplier listing.' : 'No listings match these filters.'}
        />
      ) : (
        <EnterpriseTable
          key="rfqs"
          columns={rfqColumns}
          data={filteredRfqs}
          getRowId={(r) => String(r.id)}
          loading={rfqs === null}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          exportFileName={fileName}
          viewKey="supplier-marketplace-rfqs"
          initialPageSize={25}
          emptyMessage={allRfqs.length === 0 ? 'No RFQs yet. Raise your first RFQ.' : 'No RFQs match these filters.'}
        />
      )}

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? (isListings ? 'Edit listing' : 'Edit RFQ') : (isListings ? 'Add supplier listing' : 'New RFQ')}
        size="lg"
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          {isListings ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block"><span className="label">Supplier *</span>
                  <input className="input w-full" required placeholder="e.g. Al-Jazira Tyres" value={form.supplier} maxLength={200} onChange={(e) => set('supplier', e.target.value)} /></label>
                <label className="block"><span className="label">Listing number (optional)</span>
                  <input className="input w-full" placeholder="e.g. LST-2041" value={form.listing_no} maxLength={120} onChange={(e) => set('listing_no', e.target.value)} /></label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <label className="block"><span className="label">Category</span>
                  <select className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {LISTING_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
                  </select></label>
                <label className="block"><span className="label">Product name</span>
                  <input className="input w-full" placeholder="e.g. 315/80R22.5 Drive" value={form.product_name} maxLength={200} onChange={(e) => set('product_name', e.target.value)} /></label>
                <label className="block"><span className="label">Brand (optional)</span>
                  <input className="input w-full" placeholder="e.g. Michelin" value={form.brand} maxLength={120} onChange={(e) => set('brand', e.target.value)} /></label>
                <label className="block"><span className="label">Size or spec (optional)</span>
                  <input className="input w-full" placeholder="e.g. 315/80R22.5" value={form.size_spec} maxLength={120} onChange={(e) => set('size_spec', e.target.value)} /></label>
                <label className="block"><span className="label">Unit price</span>
                  <input className="input w-full" type="number" step="0.01" min="0" inputMode="decimal" placeholder="1200" value={form.unit_price} onChange={(e) => set('unit_price', e.target.value)} /></label>
                <label className="block"><span className="label">Currency</span>
                  <input className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} /></label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <label className="block"><span className="label">MOQ</span>
                  <input className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="10" value={form.moq} onChange={(e) => set('moq', e.target.value)} /></label>
                <label className="block"><span className="label">Lead time (days)</span>
                  <input className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="14" value={form.lead_time_days} onChange={(e) => set('lead_time_days', e.target.value)} /></label>
                <label className="block"><span className="label">Rating (0 to 5)</span>
                  <input className="input w-full" type="number" step="0.1" min="0" max="5" inputMode="decimal" placeholder="4.5" value={form.rating} onChange={(e) => set('rating', e.target.value)} /></label>
                <label className="block"><span className="label">Status</span>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {LISTING_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </select></label>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] min-h-[44px] cursor-pointer">
                <input type="checkbox" className="h-4 w-4" checked={!!form.in_stock} onChange={(e) => set('in_stock', e.target.checked)} /> In stock
              </label>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block"><span className="label">Product name *</span>
                  <input className="input w-full" required placeholder="e.g. 315/80R22.5 Steer" value={form.product_name} maxLength={200} onChange={(e) => set('product_name', e.target.value)} /></label>
                <label className="block"><span className="label">RFQ number (optional)</span>
                  <input className="input w-full" placeholder="e.g. RFQ-0192" value={form.rfq_no} maxLength={120} onChange={(e) => set('rfq_no', e.target.value)} /></label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <label className="block"><span className="label">Category (optional)</span>
                  <input className="input w-full" placeholder="e.g. tyre" value={form.category} maxLength={40} onChange={(e) => set('category', e.target.value)} /></label>
                <label className="block"><span className="label">Quantity</span>
                  <input className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="40" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} /></label>
                <label className="block"><span className="label">Needed by</span>
                  <input className="input w-full" type="date" value={form.needed_by} onChange={(e) => set('needed_by', e.target.value)} /></label>
                <label className="block"><span className="label">Target price</span>
                  <input className="input w-full" type="number" step="0.01" min="0" inputMode="decimal" placeholder="1100" value={form.target_price} onChange={(e) => set('target_price', e.target.value)} /></label>
                <label className="block"><span className="label">Best quote</span>
                  <input className="input w-full" type="number" step="0.01" min="0" inputMode="decimal" placeholder="1050" value={form.best_quote} onChange={(e) => set('best_quote', e.target.value)} /></label>
                <label className="block"><span className="label">Currency</span>
                  <input className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} /></label>
                <label className="block"><span className="label">Responses received</span>
                  <input className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="3" value={form.responses_count} onChange={(e) => set('responses_count', e.target.value)} /></label>
                <label className="block"><span className="label">Awarded supplier (optional)</span>
                  <input className="input w-full" placeholder="e.g. Al-Jazira Tyres" value={form.awarded_supplier} maxLength={200} onChange={(e) => set('awarded_supplier', e.target.value)} /></label>
                <label className="block"><span className="label">Status</span>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {RFQ_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                  </select></label>
              </div>
            </>
          )}
          <label className="block"><span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[70px] resize-y" placeholder="Additional context" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} /></label>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : (isListings ? 'Add listing' : 'Create RFQ')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title={isListings ? 'Delete this listing?' : 'Delete this RFQ?'}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-muted)]">
          {isListings
            ? `${confirmDelete?.supplier || 'Listing'}, ${confirmDelete?.product_name || titleCase(confirmDelete?.category) || 'N/A'}`
            : `${confirmDelete?.rfq_no || 'RFQ'}, ${confirmDelete?.product_name || 'N/A'}`}. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
