/**
 * SupplierMarketplace (route /supplier-marketplace) — a two-sided sourcing hub:
 *
 *   • Listings tab — a catalog of supplier offers (tyres, retreads, parts,
 *     services) with price, MOQ, lead time, stock and rating. The buy-side
 *     "shelf" fleets browse to compare supply options at a glance.
 *
 *   • RFQs tab — buyer Requests For Quotation. A fleet publishes what it needs
 *     and tracks responses → best quote → award, turning ad-hoc sourcing into a
 *     measurable, auditable procurement funnel with a running saving estimate.
 *
 * Runs on the new `marketplace_listings` / `marketplace_rfqs` tables (V196).
 * Real data, KPI tiles, category + top-supplier intelligence panels,
 * create/edit modals, filters, search, delete confirm, Excel/PDF export, and
 * loading/empty/error/not-provisioned states throughout. Deterministic roll-ups
 * live in the pure `src/lib/marketplace.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Store, ShoppingCart, Package, Star, Layers, Award, Building2, BadgeCheck,
  Boxes, Send, TrendingUp, Search, X, Filter, FileSpreadsheet, FileText,
  Plus, Pencil, Trash2, AlertTriangle,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listMarketplaceListings, createListing, updateListing, deleteListing,
  listRfqs, createRfq, updateRfq, deleteRfq,
} from '../lib/api/marketplace'
import {
  summariseListings, byCategory, topRatedSuppliers, summariseRfqs, potentialSaving,
} from '../lib/marketplace'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

// ── Constants ────────────────────────────────────────────────────────────────
const LISTING_CATEGORIES = ['tyre', 'retread', 'parts', 'service', 'other']
const LISTING_STATUSES = ['active', 'out_of_stock', 'archived']
const RFQ_STATUSES = ['open', 'quoting', 'awarded', 'closed', 'cancelled']

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
  other: 'bg-slate-800/40 text-slate-300 border-slate-700/50',
}
const LISTING_STATUS_BADGE = {
  active: 'bg-green-900/30 text-green-300 border-green-800/50',
  out_of_stock: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  archived: 'bg-slate-800/40 text-slate-400 border-slate-700/50',
}
const RFQ_STATUS_BADGE = {
  open: 'bg-sky-900/30 text-sky-300 border-sky-800/50',
  quoting: 'bg-indigo-900/30 text-indigo-300 border-indigo-800/50',
  awarded: 'bg-green-900/30 text-green-300 border-green-800/50',
  closed: 'bg-slate-800/40 text-slate-400 border-slate-700/50',
  cancelled: 'bg-red-900/30 text-red-300 border-red-800/50',
}

// ── Formatting helpers ───────────────────────────────────────────────────────
const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '')
const fmtMoney = (v, currency = 'SAR') =>
  v == null || v === '' ? '—' : `${currency} ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const fmtNum = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString())
const fmtRating = (v) => (v == null || v === '' ? '—' : Number(v).toFixed(1))
function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

function Badge({ value, map }) {
  if (!value) return <span className="text-[var(--text-muted)]">—</span>
  const cls = map[value] || 'bg-slate-800/40 text-slate-300 border-slate-700/50'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {titleCase(value)}
    </span>
  )
}

export default function SupplierMarketplace() {
  const { activeCountry } = useSettings()
  const [tab, setTab] = useState('listings')

  const [listings, setListings] = useState(null)
  const [rfqs, setRfqs] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_LISTING)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const [l, r] = await Promise.all([
        listMarketplaceListings({ country: activeCountry }),
        listRfqs({ country: activeCountry }),
      ])
      setListings(Array.isArray(l) ? l : [])
      setRfqs(Array.isArray(r) ? r : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load the marketplace.')
      setListings([]); setRfqs([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Reset filters when switching tabs so a stale status/category never hides rows.
  useEffect(() => { setSearch(''); setCategoryFilter(''); setStatusFilter('') }, [tab])

  // ── Derived intelligence ─────────────────────────────────────────────────────
  const listingSummary = useMemo(() => summariseListings(listings || []), [listings])
  const rfqSummary = useMemo(() => summariseRfqs(rfqs || []), [rfqs])
  const categories = useMemo(() => byCategory(listings || []), [listings])
  const topSuppliers = useMemo(() => topRatedSuppliers(listings || []), [listings])
  const totalPotentialSaving = useMemo(
    () => (rfqs || []).reduce((s, r) => s + potentialSaving(r), 0),
    [rfqs],
  )

  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (listings || []).filter((r) => {
      if (categoryFilter && r.category !== categoryFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (q) {
        const hay = `${r.supplier || ''} ${r.product_name || ''} ${r.brand || ''} ${r.size_spec || ''} ${r.listing_no || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [listings, search, categoryFilter, statusFilter])

  const filteredRfqs = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rfqs || []).filter((r) => {
      if (categoryFilter && r.category !== categoryFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (q) {
        const hay = `${r.product_name || ''} ${r.rfq_no || ''} ${r.category || ''} ${r.awarded_supplier || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rfqs, search, categoryFilter, statusFilter])

  const isListings = tab === 'listings'
  const loadingTab = isListings ? listings === null : rfqs === null
  const filtered = isListings ? filteredListings : filteredRfqs
  const totalRows = isListings ? (listings || []).length : (rfqs || []).length

  // ── KPI tiles ─────────────────────────────────────────────────────────────
  const listingKpis = [
    { label: 'Total listings', value: listingSummary.totalListings, icon: Package, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: listingSummary.activeCount, icon: BadgeCheck, tone: 'text-green-400' },
    { label: 'In stock', value: listingSummary.inStockCount, icon: Boxes, tone: 'text-sky-400' },
    { label: 'Suppliers', value: listingSummary.distinctSuppliers, icon: Building2, tone: 'text-violet-400' },
    { label: 'Avg rating', value: listingSummary.avgRating == null ? '—' : listingSummary.avgRating.toFixed(1), icon: Star, tone: 'text-amber-400' },
  ]
  const rfqKpis = [
    { label: 'Total RFQs', value: rfqSummary.totalRfqs, icon: ShoppingCart, tone: 'text-[var(--text-primary)]' },
    { label: 'Open', value: rfqSummary.openCount, icon: Send, tone: 'text-sky-400' },
    { label: 'Awarded', value: rfqSummary.awardedCount, icon: Award, tone: 'text-green-400' },
    { label: 'Avg responses', value: rfqSummary.avgResponses == null ? '—' : rfqSummary.avgResponses, icon: Layers, tone: 'text-violet-400' },
    { label: 'Potential saving', value: fmtMoney(Math.round(totalPotentialSaving)), icon: TrendingUp, tone: 'text-amber-400' },
  ]
  const kpis = isListings ? listingKpis : rfqKpis

  // ── Export ───────────────────────────────────────────────────────────────
  const LISTING_EXPORT_COLS = ['supplier', 'listing_no', 'category', 'product_name', 'brand', 'size_spec', 'unit_price', 'currency', 'moq', 'lead_time_days', 'rating', 'in_stock', 'status']
  const LISTING_EXPORT_HEADERS = ['Supplier', 'Listing #', 'Category', 'Product', 'Brand', 'Size / Spec', 'Unit price', 'Currency', 'MOQ', 'Lead time (days)', 'Rating', 'In stock', 'Status']
  const RFQ_EXPORT_COLS = ['rfq_no', 'product_name', 'category', 'quantity', 'target_price', 'currency', 'needed_by', 'responses_count', 'best_quote', 'awarded_supplier', 'potential_saving', 'status']
  const RFQ_EXPORT_HEADERS = ['RFQ #', 'Product', 'Category', 'Quantity', 'Target price', 'Currency', 'Needed by', 'Responses', 'Best quote', 'Awarded supplier', 'Potential saving', 'Status']

  const exportCols = isListings ? LISTING_EXPORT_COLS : RFQ_EXPORT_COLS
  const exportHeaders = isListings ? LISTING_EXPORT_HEADERS : RFQ_EXPORT_HEADERS
  const exportRows = useMemo(() => {
    if (isListings) {
      return filteredListings.map((r) => ({
        supplier: r.supplier || '', listing_no: r.listing_no || '', category: titleCase(r.category),
        product_name: r.product_name || '', brand: r.brand || '', size_spec: r.size_spec || '',
        unit_price: r.unit_price ?? '', currency: r.currency || '', moq: r.moq ?? '',
        lead_time_days: r.lead_time_days ?? '', rating: r.rating ?? '',
        in_stock: r.in_stock ? 'Yes' : 'No', status: titleCase(r.status),
      }))
    }
    return filteredRfqs.map((r) => ({
      rfq_no: r.rfq_no || '', product_name: r.product_name || '', category: r.category || '',
      quantity: r.quantity ?? '', target_price: r.target_price ?? '', currency: r.currency || '',
      needed_by: r.needed_by || '', responses_count: r.responses_count ?? '',
      best_quote: r.best_quote ?? '', awarded_supplier: r.awarded_supplier || '',
      potential_saving: potentialSaving(r) || '', status: titleCase(r.status),
    }))
  }, [isListings, filteredListings, filteredRfqs])

  const exportTitle = isListings ? 'Supplier Listings' : 'Buyer RFQs'
  const exportFile = isListings ? 'marketplace_listings' : 'marketplace_rfqs'
  const doExcel = () => exportToExcel(exportRows, exportCols, exportHeaders, exportFile)
  const doPdf = () => exportToPdf(exportRows, exportCols.map((k, i) => ({ key: k, header: exportHeaders[i] })), exportTitle, exportFile, 'landscape')

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null)
    setForm(isListings ? EMPTY_LISTING : EMPTY_RFQ)
    setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    if (isListings) {
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
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (isListings && !String(form.supplier || '').trim()) { setFormError('A supplier is required.'); return }
    if (!isListings && !String(form.product_name || '').trim()) { setFormError('A product name is required.'); return }
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
      setFormError(err?.message || 'Could not save.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, isListings, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      if (isListings) await deleteListing(confirmDelete.id)
      else await deleteRfq(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the record.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, isListings, load])

  const clearFilters = () => { setSearch(''); setCategoryFilter(''); setStatusFilter('') }
  const hasFilters = search || categoryFilter || statusFilter
  const statusOptions = isListings ? LISTING_STATUSES : RFQ_STATUSES
  const categoryOptions = isListings
    ? LISTING_CATEGORIES
    : [...new Set((rfqs || []).map((r) => r.category).filter(Boolean))].sort()

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Marketplace"
        subtitle="Compare supplier tyre, retread and parts listings, and run buyer RFQs end-to-end — a measurable sourcing funnel from need to award."
        icon={Store}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> {isListings ? 'Add listing' : 'New RFQ'}
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--input-border)]">
        {[
          { id: 'listings', label: 'Listings', icon: Package, count: listingSummary.totalListings },
          { id: 'rfqs', label: 'RFQs', icon: ShoppingCart, count: rfqSummary.totalRfqs },
        ].map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-[var(--accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon size={15} /> {t.label}
              <span className="ml-1 rounded-full bg-[var(--input-bg)] px-1.5 py-0.5 text-[11px]">{t.count}</span>
            </button>
          )
        })}
      </div>

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">The Supplier Marketplace isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V196_MARKETPLACE.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load the marketplace.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{loadingTab ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Intelligence panels (Listings tab) */}
      {isListings && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <Layers size={15} /> By category
            </h3>
            {listings === null ? (
              <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
            ) : categories.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No listings yet.</p>
            ) : (
              <div className="space-y-2">
                {categories.map((c) => (
                  <div key={c.category} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge value={c.category} map={CATEGORY_BADGE} />
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-sm">
                      <span className="text-[var(--text-secondary)]">{c.listings} listing{c.listings === 1 ? '' : 's'}</span>
                      <span className="text-[var(--text-muted)]">avg {fmtMoney(c.avgPrice)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <Award size={15} /> Top-rated suppliers
            </h3>
            {listings === null ? (
              <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
            ) : topSuppliers.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No rated suppliers yet.</p>
            ) : (
              <div className="space-y-2">
                {topSuppliers.slice(0, 6).map((s) => (
                  <div key={s.supplier} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-[var(--text-primary)] truncate">{s.supplier}</span>
                    <div className="flex items-center gap-3 shrink-0 text-sm">
                      <span className="inline-flex items-center gap-1 text-amber-400 font-semibold">
                        <Star size={13} className="fill-amber-400" /> {s.avgRating.toFixed(1)}
                      </span>
                      <span className="text-[var(--text-muted)]">{s.listings} listing{s.listings === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              className="input pl-9 w-full"
              placeholder={isListings ? 'Search supplier, product, brand, size…' : 'Search product, RFQ #, supplier…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {totalRows}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {(isListings
                  ? ['Supplier', 'Product', 'Category', 'Unit price', 'MOQ', 'Lead', 'Rating', 'Status', '']
                  : ['RFQ #', 'Product', 'Qty', 'Target', 'Best quote', 'Saving', 'Needed by', 'Responses', 'Status', '']
                ).map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loadingTab ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/50">
                    <td colSpan={isListings ? 9 : 10} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={isListings ? 9 : 10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    <Filter size={22} className="mx-auto mb-2 opacity-60" />
                    {totalRows === 0 && !notProvisioned
                      ? (isListings ? 'No listings yet — add your first supplier listing.' : 'No RFQs yet — raise your first RFQ.')
                      : 'No records match these filters.'}
                  </td>
                </tr>
              ) : isListings ? (
                filteredListings.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                      {r.supplier || '—'}
                      {r.listing_no && <span className="block text-[11px] text-[var(--text-muted)]">{r.listing_no}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      {r.product_name || '—'}
                      {(r.brand || r.size_spec) && <span className="block text-[11px] text-[var(--text-muted)]">{[r.brand, r.size_spec].filter(Boolean).join(' · ')}</span>}
                    </td>
                    <td className="px-4 py-2.5"><Badge value={r.category} map={CATEGORY_BADGE} /></td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] whitespace-nowrap">{fmtMoney(r.unit_price, r.currency || 'SAR')}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtNum(r.moq)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.lead_time_days == null || r.lead_time_days === '' ? '—' : `${fmtNum(r.lead_time_days)} d`}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {r.rating == null || r.rating === '' ? <span className="text-[var(--text-muted)]">—</span> : (
                        <span className="inline-flex items-center gap-1 text-amber-400 font-medium"><Star size={12} className="fill-amber-400" /> {fmtRating(r.rating)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge value={r.status} map={LISTING_STATUS_BADGE} />
                      {!r.in_stock && <span className="block text-[11px] text-amber-400 mt-0.5">Out of stock</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                filteredRfqs.slice(0, 500).map((r) => {
                  const saving = potentialSaving(r)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)] whitespace-nowrap">{r.rfq_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        {r.product_name || '—'}
                        {r.category && <span className="block text-[11px] text-[var(--text-muted)]">{r.category}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtNum(r.quantity)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtMoney(r.target_price, r.currency || 'SAR')}</td>
                      <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] whitespace-nowrap">{fmtMoney(r.best_quote, r.currency || 'SAR')}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {saving > 0
                          ? <span className="text-green-400 font-semibold">{fmtMoney(saving, r.currency || 'SAR')}</span>
                          : <span className="text-[var(--text-muted)]">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.needed_by)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        {fmtNum(r.responses_count)}
                        {r.awarded_supplier && <span className="block text-[11px] text-green-400">→ {r.awarded_supplier}</span>}
                      </td>
                      <td className="px-4 py-2.5"><Badge value={r.status} map={RFQ_STATUS_BADGE} /></td>
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
              <h3 className="text-lg font-bold text-[var(--text-primary)]">
                {editing ? (isListings ? 'Edit listing' : 'Edit RFQ') : (isListings ? 'Add supplier listing' : 'New RFQ')}
              </h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {isListings ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Supplier</label>
                      <input className="input w-full" placeholder="e.g. Al-Jazira Tyres" value={form.supplier} maxLength={200} onChange={(e) => set('supplier', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Listing # (optional)</label>
                      <input className="input w-full" placeholder="e.g. LST-2041" value={form.listing_no} maxLength={120} onChange={(e) => set('listing_no', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="label">Category</label>
                      <select className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
                        {LISTING_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Product name</label>
                      <input className="input w-full" placeholder="e.g. 315/80R22.5 Drive" value={form.product_name} maxLength={200} onChange={(e) => set('product_name', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Brand (optional)</label>
                      <input className="input w-full" placeholder="e.g. Michelin" value={form.brand} maxLength={120} onChange={(e) => set('brand', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="label">Size / Spec (optional)</label>
                      <input className="input w-full" placeholder="e.g. 315/80R22.5" value={form.size_spec} maxLength={120} onChange={(e) => set('size_spec', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Unit price</label>
                      <input className="input w-full" type="number" step="0.01" min="0" placeholder="1200" value={form.unit_price} onChange={(e) => set('unit_price', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Currency</label>
                      <input className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="label">MOQ</label>
                      <input className="input w-full" type="number" step="1" min="0" placeholder="10" value={form.moq} onChange={(e) => set('moq', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Lead time (days)</label>
                      <input className="input w-full" type="number" step="1" min="0" placeholder="14" value={form.lead_time_days} onChange={(e) => set('lead_time_days', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Rating (0–5)</label>
                      <input className="input w-full" type="number" step="0.1" min="0" max="5" placeholder="4.5" value={form.rating} onChange={(e) => set('rating', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Status</label>
                      <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                        {LISTING_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                      </select>
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                    <input type="checkbox" checked={!!form.in_stock} onChange={(e) => set('in_stock', e.target.checked)} /> In stock
                  </label>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Product name</label>
                      <input className="input w-full" placeholder="e.g. 315/80R22.5 Steer" value={form.product_name} maxLength={200} onChange={(e) => set('product_name', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">RFQ # (optional)</label>
                      <input className="input w-full" placeholder="e.g. RFQ-0192" value={form.rfq_no} maxLength={120} onChange={(e) => set('rfq_no', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="label">Category (optional)</label>
                      <input className="input w-full" placeholder="e.g. tyre" value={form.category} maxLength={40} onChange={(e) => set('category', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Quantity</label>
                      <input className="input w-full" type="number" step="1" min="0" placeholder="40" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Needed by</label>
                      <input className="input w-full" type="date" value={form.needed_by} onChange={(e) => set('needed_by', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="label">Target price</label>
                      <input className="input w-full" type="number" step="0.01" min="0" placeholder="1100" value={form.target_price} onChange={(e) => set('target_price', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Best quote</label>
                      <input className="input w-full" type="number" step="0.01" min="0" placeholder="1050" value={form.best_quote} onChange={(e) => set('best_quote', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Currency</label>
                      <input className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="label">Responses received</label>
                      <input className="input w-full" type="number" step="1" min="0" placeholder="3" value={form.responses_count} onChange={(e) => set('responses_count', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Awarded supplier (optional)</label>
                      <input className="input w-full" placeholder="e.g. Al-Jazira Tyres" value={form.awarded_supplier} maxLength={200} onChange={(e) => set('awarded_supplier', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Status</label>
                      <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                        {RFQ_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="Additional context…" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : (isListings ? 'Add listing' : 'Create RFQ')}
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
                <h3 className="text-[var(--text-primary)] font-semibold">{isListings ? 'Delete this listing?' : 'Delete this RFQ?'}</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {isListings
                    ? `${confirmDelete.supplier || 'Listing'} · ${confirmDelete.product_name || titleCase(confirmDelete.category) || ''}`
                    : `${confirmDelete.rfq_no || 'RFQ'} · ${confirmDelete.product_name || ''}`}
                  . This can’t be undone.
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
