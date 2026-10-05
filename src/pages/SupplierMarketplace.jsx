/**
 * SupplierMarketplace (route /supplier-marketplace) - the sourcing hub, rebuilt
 * on the Command Center kit to the owner's mockup:
 *
 *   header + period, five headline tiles, the supplier listings register with
 *   its filter bar, the selected listing panel (details / supplier / prices /
 *   reviews), a side-by-side comparison of the ticked listings, the sourcing
 *   funnel, recent RFQs, and below them the full RFQ register plus the price
 *   and top-supplier views that the old page carried.
 *
 * Runs on `marketplace_listings` / `marketplace_rfqs` (V196). Every number is
 * shaped in `src/lib/supplierMarketplaceView.js` (new layout) and
 * `src/lib/supplierMarketplaceAnalytics.js` (filters, exports, price views).
 * Money is never summed across currencies. Create / edit / delete for both
 * listings and RFQs, and Excel / PDF export of both, are all kept.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ShoppingCart, FileText, FileSpreadsheet, Users, Clock, Database, Plus, Pencil, Trash2,
  AlertTriangle, RefreshCw, Search, Filter, Star, ChevronRight, Send, X, Disc, Trophy, Scale, ListChecks,
} from 'lucide-react'
import { toUserMessage } from '../lib/safeError'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, KitTable, Tabs, ViewAll, fmtInt } from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import {
  listMarketplaceListings, createListing, updateListing, deleteListing,
  listRfqs, createRfq, updateRfq, deleteRfq,
} from '../lib/api/marketplace'
import {
  LISTING_CATEGORIES, LISTING_STATUSES, RFQ_STATUSES, titleCase, currencyOf, isOverdueRfq,
  filterListings, filterRfqs, categoryPriceByCurrency, topRatedSuppliers, potentialSaving,
  LISTING_EXPORT_COLUMNS, RFQ_EXPORT_COLUMNS, listingExportRows, rfqExportRows,
} from '../lib/supplierMarketplaceAnalytics'
import {
  PERIODS, LEAD_BUCKETS, quotedCount, RATING_FLOORS, NOT_RECORDED, inPeriod, listingOptions, applyListingExtras,
  stockState, headlineTiles, moneyLines, sourcingFunnel, recentRfqs, compareListings,
  listingDetailFields, supplierProfile, samePriceBook, RFQ_TONE,
} from '../lib/supplierMarketplaceView'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { isMissingRelation } from '../lib/api/_client'
import './SupplierMarketplace.css'

// Header photo cropped from the owner's Supplier Marketplace mockup (the clean
// warehouse / forklift area, no header text or buttons), with a lighter grade
// for the light theme.
const HERO_DARK = '/dashboard/hero-market-dark.webp'
const HERO_LIGHT = '/dashboard/hero-market-light.webp'

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
const EMPTY_FILTERS = { search: '', category: '', brand: '', country: '', minRating: '', lead: '', stock: '', status: '', currency: '' }

const NA = <span className="cc-na">N/A</span>
const money = (v, currency) => {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return null
  return moneyLines([{ currency, value: Number(v) }])[0]
}
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const fmtDate = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}
const Pill = ({ tone = 'muted', children }) => <span className={`cc-pill ${tone}`}>{children}</span>

function Rating({ value }) {
  const n = num(value)
  if (n == null) return NA
  return <span className="sm-rating"><Star size={12} aria-hidden="true" /> {n.toFixed(1)}</span>
}

export default function SupplierMarketplace() {
  const { activeCountry } = useSettings()

  const [listings, setListings] = useState(null)
  const [rfqs, setRfqs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [actionError, setActionError] = useState('')
  const [asOf, setAsOf] = useState(() => new Date())

  const [period, setPeriod] = useState('all')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [quoteQty, setQuoteQty] = useState('')
  const [selection, setSelection] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [detailTab, setDetailTab] = useState('details')
  const [bottomTab, setBottomTab] = useState('rfqs')
  const [rfqFilters, setRfqFilters] = useState({ search: '', status: '', currency: '', overdueOnly: false })

  const [modal, setModal] = useState(null) // { mode: 'listing'|'rfq', editing: row|null }
  const [form, setForm] = useState(EMPTY_LISTING)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null) // { mode, row }
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(''); setNotProvisioned(false)
    try {
      const [l, r] = await Promise.all([
        listMarketplaceListings({ country: activeCountry }),
        listRfqs({ country: activeCountry }),
      ])
      setListings(Array.isArray(l) ? l : [])
      setRfqs(Array.isArray(r) ? r : [])
      setAsOf(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load the marketplace.'))
      setListings(null); setRfqs(null)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])
  useEffect(() => { load() }, [load])

  const allListings = useMemo(() => listings || [], [listings])
  const allRfqs = useMemo(() => rfqs || [], [rfqs])
  const periodRfqs = useMemo(() => inPeriod(allRfqs, period, asOf), [allRfqs, period, asOf])
  const known = listings !== null && !error

  const cardState = { loading, error: error || (notProvisioned ? 'The Supplier Marketplace is not enabled on this database yet.' : null), retry: load, data: known ? true : null }

  // -- Listings register -----------------------------------------------------
  const options = useMemo(() => listingOptions(allListings), [allListings])
  const filteredListings = useMemo(() => applyListingExtras(
    filterListings(allListings, { category: filters.category, status: filters.status, stock: filters.stock, currency: filters.currency, search: filters.search }),
    { brand: filters.brand, country: filters.country, minRating: filters.minRating, lead: filters.lead },
  ), [allListings, filters])
  const hasFilters = Object.values(filters).some(Boolean)
  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const currencyOptions = useMemo(() => [...new Set(allListings.map(currencyOf))].sort(), [allListings])

  const selected = useMemo(() => allListings.find((l) => String(l.id) === String(selectedId)) || filteredListings[0] || null, [allListings, filteredListings, selectedId])
  const ticked = useMemo(() => allListings.filter((l) => selection[String(l.id)]), [allListings, selection])
  const comparison = useMemo(() => compareListings(ticked), [ticked])

  const tiles = useMemo(() => headlineTiles(allListings, periodRfqs), [allListings, periodRfqs])
  const funnel = useMemo(() => sourcingFunnel(periodRfqs), [periodRfqs])
  const quoted = useMemo(() => quotedCount(periodRfqs), [periodRfqs])
  const recent = useMemo(() => recentRfqs(periodRfqs, { limit: 5, now: asOf }), [periodRfqs, asOf])
  const priceView = useMemo(() => categoryPriceByCurrency(filteredListings), [filteredListings])
  const topSuppliers = useMemo(() => topRatedSuppliers(filteredListings), [filteredListings])

  const filteredRfqs = useMemo(() => filterRfqs(periodRfqs, { ...rfqFilters, now: asOf }), [periodRfqs, rfqFilters, asOf])
  const rfqCurrencies = useMemo(() => [...new Set(allRfqs.map(currencyOf))].sort(), [allRfqs])

  // -- Export ----------------------------------------------------------------
  const countryTag = activeCountry !== 'All' ? activeCountry : null
  const runExport = async (what, kind) => {
    setActionError('')
    try {
      const isL = what === 'listings'
      const cols = isL ? LISTING_EXPORT_COLUMNS : RFQ_EXPORT_COLUMNS
      const rows = isL ? listingExportRows(filteredListings) : rfqExportRows(filteredRfqs, { now: asOf })
      const name = reportFileName(isL ? 'TyrePulse Supplier Listings' : 'TyrePulse Buyer RFQs', countryTag, reportDateLabel())
      if (kind === 'excel') await exportToExcel(rows, cols.map((c) => c[0]), cols.map((c) => c[1]), name)
      else await exportToPdf(rows, cols.map(([key, header]) => ({ key, header })), isL ? 'Supplier Listings' : 'Buyer RFQs', name, 'landscape')
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  // -- Create / edit ---------------------------------------------------------
  const openCreate = (mode, prefill = {}) => {
    setModal({ mode, editing: null })
    setForm({ ...(mode === 'listing' ? EMPTY_LISTING : EMPTY_RFQ), ...prefill })
    setFormError('')
  }
  const openEdit = useCallback((mode, r) => {
    setModal({ mode, editing: r })
    if (mode === 'listing') {
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
    setFormError('')
  }, [])
  const closeModal = () => { if (!saving) setModal(null) }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const isListingForm = modal?.mode === 'listing'

  const submit = async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (isListingForm && !String(form.supplier || '').trim()) { setFormError('A supplier is required.'); return }
    if (!isListingForm && !String(form.product_name || '').trim()) { setFormError('A product name is required.'); return }
    if (isListingForm && form.rating !== '' && (Number(form.rating) < 0 || Number(form.rating) > 5)) { setFormError('Rating must be between 0 and 5.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (isListingForm) {
        if (modal.editing) await updateListing(modal.editing.id, payload)
        else await createListing(payload)
      } else if (modal.editing) await updateRfq(modal.editing.id, payload)
      else await createRfq(payload)
      setModal(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save.'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      if (confirmDelete.mode === 'listing') await deleteListing(confirmDelete.row.id)
      else await deleteRfq(confirmDelete.row.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the record.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const requestQuote = (l, qty) => openCreate('rfq', {
    product_name: [l?.product_name, l?.size_spec].filter(Boolean).join(' ') || '',
    category: l?.category || '', currency: l?.currency || 'SAR',
    target_price: l?.unit_price ?? '', quantity: qty || l?.moq || '',
  })
  // Award: open a new RFQ already marked awarded to the cheapest ticked
  // listing (cheapest within its own currency). Nothing is saved until the
  // user confirms the form.
  const awardSupplier = () => {
    const best = comparison.rows.find((r) => r.cheapest) || comparison.rows[0]
    const src = ticked.find((t) => String(t.id) === String(best?.id)) || ticked[0]
    if (!src) return
    openCreate('rfq', {
      product_name: [src.product_name, src.size_spec].filter(Boolean).join(' ') || '',
      category: src.category || '', currency: src.currency || 'SAR',
      target_price: src.unit_price ?? '', best_quote: src.unit_price ?? '', quantity: src.moq ?? '',
      awarded_supplier: src.supplier || '', status: 'awarded', responses_count: String(ticked.length),
    })
  }

  // -- Columns ---------------------------------------------------------------
  const listingCols = [
    { key: 'supplier', header: 'Supplier', sortValue: (r) => r.supplier || '', cell: (r) => <span className="cc-strong">{r.supplier || 'N/A'}{r.listing_no && <span className="cc-sub">{r.listing_no}</span>}</span> },
    { key: 'item', header: 'Item / specification', sortValue: (r) => r.product_name || '', cell: (r) => <span>{r.size_spec || r.product_name || 'N/A'}<span className="cc-sub">{r.size_spec ? (r.product_name || titleCase(r.category)) : titleCase(r.category)}</span></span> },
    { key: 'brand', header: 'Brand', cell: (r) => r.brand || NA },
    { key: 'price', header: 'Price', numeric: true, sortValue: (r) => num(r.unit_price) ?? -1, cell: (r) => money(r.unit_price, currencyOf(r)) || NA },
    { key: 'moq', header: 'MOQ', numeric: true, sortValue: (r) => num(r.moq) ?? -1, cell: (r) => (num(r.moq) == null ? NA : fmtInt(r.moq)) },
    { key: 'lead', header: 'Lead time', numeric: true, sortValue: (r) => num(r.lead_time_days) ?? 9999, cell: (r) => (num(r.lead_time_days) == null ? NA : `${fmtInt(r.lead_time_days)} days`) },
    { key: 'country', header: 'Region', cell: (r) => r.country || NA },
    { key: 'stock', header: 'Stock', sortValue: (r) => stockState(r).label, cell: (r) => { const s = stockState(r); return <Pill tone={s.tone}>{s.label}</Pill> } },
    { key: 'rating', header: 'Rating', numeric: true, sortValue: (r) => num(r.rating) ?? -1, cell: (r) => <Rating value={r.rating} /> },
    {
      key: 'actions', header: '', sortable: false,
      cell: (r) => (
        <span className="sm-row-actions" onClick={(e) => e.stopPropagation()} role="presentation">
          <button type="button" className="cc-btn" onClick={() => { setSelectedId(r.id); setDetailTab('details') }}>View</button>
          <button type="button" className="cc-icon-btn" onClick={() => openEdit('listing', r)} aria-label={`Edit listing from ${r.supplier || 'supplier'}`}><Pencil size={13} /></button>
          <button type="button" className="cc-icon-btn sm-danger" onClick={() => setConfirmDelete({ mode: 'listing', row: r })} aria-label={`Delete listing from ${r.supplier || 'supplier'}`}><Trash2 size={13} /></button>
        </span>
      ),
    },
  ]

  const rfqCols = [
    { key: 'rfq_no', header: 'RFQ', cell: (r) => <span className="cc-strong">{r.rfq_no || 'N/A'}</span> },
    { key: 'product', header: 'Product', sortValue: (r) => r.product_name || '', cell: (r) => <span>{r.product_name || 'N/A'}{r.category && <span className="cc-sub">{r.category}</span>}</span> },
    { key: 'qty', header: 'Quantity', numeric: true, sortValue: (r) => num(r.quantity) ?? -1, cell: (r) => (num(r.quantity) == null ? NA : fmtInt(r.quantity)) },
    { key: 'target', header: 'Target', numeric: true, sortValue: (r) => num(r.target_price) ?? -1, cell: (r) => money(r.target_price, currencyOf(r)) || NA },
    { key: 'best', header: 'Best quote', numeric: true, sortValue: (r) => num(r.best_quote) ?? -1, cell: (r) => money(r.best_quote, currencyOf(r)) || NA },
    { key: 'saving', header: 'Saving', numeric: true, sortValue: (r) => potentialSaving(r), cell: (r) => { const s = potentialSaving(r); return s > 0 ? <span className="sm-good">{money(s, currencyOf(r))}</span> : NA } },
    { key: 'needed', header: 'Needed by', sortValue: (r) => (r.needed_by ? new Date(r.needed_by).getTime() : Infinity), cell: (r) => <span>{fmtDate(r.needed_by)}{isOverdueRfq(r, { now: asOf }) && <span className="cc-sub sm-bad">Overdue</span>}</span> },
    { key: 'responses', header: 'Responses', numeric: true, sortValue: (r) => num(r.responses_count) ?? -1, cell: (r) => <span>{num(r.responses_count) == null ? NA : fmtInt(r.responses_count)}{r.awarded_supplier && <span className="cc-sub sm-good">Awarded to {r.awarded_supplier}</span>}</span> },
    { key: 'status', header: 'Status', cell: (r) => <Pill tone={RFQ_TONE[String(r.status || '').toLowerCase()] || 'muted'}>{titleCase(r.status) || 'N/A'}</Pill> },
    {
      key: 'actions', header: '', sortable: false,
      cell: (r) => (
        <span className="sm-row-actions">
          <button type="button" className="cc-icon-btn" onClick={() => openEdit('rfq', r)} aria-label={`Edit RFQ ${r.rfq_no || r.product_name || ''}`.trim()}><Pencil size={13} /></button>
          <button type="button" className="cc-icon-btn sm-danger" onClick={() => setConfirmDelete({ mode: 'rfq', row: r })} aria-label={`Delete RFQ ${r.rfq_no || r.product_name || ''}`.trim()}><Trash2 size={13} /></button>
        </span>
      ),
    },
  ]

  const compareCols = [
    { key: 'supplier', header: 'Supplier', cell: (r) => <span className="cc-strong">{r.supplier}<span className="cc-sub">{r.product}</span></span> },
    { key: 'price', header: 'Price', numeric: true, cell: (r) => (r.price == null ? NA : <span className={r.cheapest ? 'sm-best' : ''}>{money(r.price, r.currency)}</span>) },
    { key: 'lead', header: 'Lead time', numeric: true, cell: (r) => (r.lead == null ? NA : <span className={r.fastest ? 'sm-best' : ''}>{r.lead} days</span>) },
    { key: 'moq', header: 'MOQ', numeric: true, cell: (r) => (r.moq == null ? NA : fmtInt(r.moq)) },
    { key: 'terms', header: 'Payment terms', cell: () => <span className="cc-na">Not recorded</span> },
    { key: 'total', header: 'Value at MOQ', numeric: true, cell: (r) => (r.total == null ? NA : money(r.total, r.currency)) },
  ]

  // -- Tiles ----------------------------------------------------------------
  const awardedLines = moneyLines(tiles.awarded)
  const kpis = [
    { icon: ShoppingCart, tone: 't-green', value: known ? tiles.activeListings : null, label: 'Active listings', title: known ? `${fmtInt(tiles.totalListings)} listings in total` : undefined },
    { icon: FileText, tone: 't-blue', value: known ? tiles.openRfqs : null, label: 'Open RFQs', onClick: () => { setBottomTab('rfqs'); setRfqFilters((f) => ({ ...f, status: 'open' })) } },
    { icon: Users, tone: 't-purple', value: known ? tiles.responses : null, label: tiles.responses == null && known ? 'Supplier responses (not recorded on any RFQ)' : 'Supplier responses' },
    { icon: Clock, tone: 't-amber', display: !known || tiles.avgLeadDays == null ? 'N/A' : `${tiles.avgLeadDays} days`, label: 'Avg. lead time' },
    {
      icon: Database, tone: 't-green',
      display: !known || !awardedLines.length ? 'N/A' : awardedLines.length === 1 ? awardedLines[0] : <span className="sm-multi">{awardedLines.map((l) => <span key={l}>{l}</span>)}</span>,
      label: tiles.awardedUnpriced ? `Awarded value (${tiles.awardedUnpriced} awarded RFQ${tiles.awardedUnpriced === 1 ? '' : 's'} without a quote)` : 'Awarded value',
      title: 'Best quote x quantity on awarded RFQs, per currency',
    },
  ]

  const detailFields = listingDetailFields(selected)
  const profile = selected ? supplierProfile(allListings, selected.supplier) : null
  const prices = samePriceBook(allListings, selected)
  const stock = stockState(selected)

  return (
    <div className="cc sm-page">
      <header className="sm-head">
        <div className="sm-head-img cc-hero-dark" style={{ backgroundImage: `url(${HERO_DARK})` }} aria-hidden="true" />
        <div className="sm-head-img cc-hero-light" style={{ backgroundImage: `url(${HERO_LIGHT})` }} aria-hidden="true" />
        <div className="sm-head-copy">
          <p className="sm-crumb">Inventory and Procurement <ChevronRight size={12} aria-hidden="true" /> <span>Supplier Marketplace</span></p>
          <h1>Supplier Marketplace</h1>
          <p>Compare supplier listings, run RFQs and manage the sourcing funnel for tyres, retreads, parts and services.</p>
        </div>
        <div className="sm-head-actions">
          <select className="cc-select" aria-label="RFQ period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <button type="button" className="cc-icon-btn" onClick={load} aria-label="Refresh" title="Refresh"><RefreshCw size={14} /></button>
          <button type="button" className="cc-btn-ghost" onClick={() => openCreate('listing')} disabled={notProvisioned}><Plus size={14} aria-hidden="true" /> Add listing</button>
          <button type="button" className="cc-btn-primary" onClick={() => openCreate('rfq')} disabled={notProvisioned}><Plus size={14} aria-hidden="true" /> Create RFQ</button>
        </div>
      </header>

      {notProvisioned && (
        <div className="cc-card sm-banner" role="status"><AlertTriangle size={18} aria-hidden="true" /><div><b>The Supplier Marketplace is not enabled on this database yet.</b><p>Ask your administrator to enable the marketplace, then refresh.</p></div></div>
      )}
      {error && (
        <div className="cc-card sm-banner bad" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><b>Could not load the marketplace.</b><p>{error}</p></div><button type="button" className="cc-btn-ghost" onClick={load}>Retry</button></div>
      )}
      {actionError && (
        <div className="cc-card sm-banner bad" role="alert"><AlertTriangle size={18} aria-hidden="true" /><div><p>{actionError}</p></div><button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button></div>
      )}

      <div className="cc-kpis sm-kpis">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading && listings === null} />)}
      </div>
      {period !== 'all' && known && <p className="sm-note">RFQ figures cover RFQs created in the {PERIODS.find((p) => p.key === period)?.label.toLowerCase()}. Listing figures are the current catalogue.</p>}

      <div className="sm-grid">
        <Card
          className="sm-listings"
          title="Supplier listings"
          sub="Live supplier offers across tyres, retreads, parts and services."
          action={(
            <div className="sm-card-tools">
              <label className="cc-search sm-search"><Search size={14} aria-hidden="true" /><input type="search" placeholder="Search listings, supplier, brand" value={filters.search} onChange={(e) => setF('search', e.target.value)} aria-label="Search listings" /></label>
              <button type="button" className="cc-btn-ghost" aria-pressed={showFilters} onClick={() => setShowFilters((s) => !s)}><Filter size={14} aria-hidden="true" /> Filters</button>
            </div>
          )}
        >
          <div className="sm-filterbar">
            <label className="cc-field"><span>Category</span><select className="cc-select" value={filters.category} onChange={(e) => setF('category', e.target.value)}><option value="">All categories</option>{LISTING_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select></label>
            <label className="cc-field"><span>Brand</span><select className="cc-select" value={filters.brand} onChange={(e) => setF('brand', e.target.value)}><option value="">All brands</option>{options.brands.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
            <label className="cc-field"><span>Region</span><select className="cc-select" value={filters.country} onChange={(e) => setF('country', e.target.value)}><option value="">All regions</option>{options.countries.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label className="cc-field"><span>Supplier rating</span><select className="cc-select" value={filters.minRating} onChange={(e) => setF('minRating', e.target.value)}>{RATING_FLOORS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
            <label className="cc-field"><span>Delivery time</span><select className="cc-select" value={filters.lead} onChange={(e) => setF('lead', e.target.value)}>{LEAD_BUCKETS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
            <button type="button" className="cc-link cc-link-btn sm-clear" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!hasFilters}>Clear all</button>
          </div>
          {showFilters && (
            <div className="sm-filterbar sm-filterbar-more">
              <label className="cc-field"><span>Stock</span><select className="cc-select" value={filters.stock} onChange={(e) => setF('stock', e.target.value)}><option value="">Any</option><option value="in">In stock</option><option value="out">Out of stock</option></select></label>
              <label className="cc-field"><span>Status</span><select className="cc-select" value={filters.status} onChange={(e) => setF('status', e.target.value)}><option value="">All statuses</option>{LISTING_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select></label>
              <label className="cc-field"><span>Currency</span><select className="cc-select" value={filters.currency} onChange={(e) => setF('currency', e.target.value)}><option value="">All currencies</option>{currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            </div>
          )}
          <CardState state={cardState} lines={6}>
            <KitTable
              columns={listingCols}
              rows={filteredListings}
              getRowId={(r) => String(r.id)}
              enableRowSelection
              rowSelection={selection}
              onRowSelectionChange={setSelection}
              onRowClick={(r) => { setSelectedId(r.id); setDetailTab('details') }}
              empty={allListings.length === 0 ? 'No supplier listings recorded yet. Add the first listing to start comparing suppliers.' : 'No listings match these filters.'}
            />
            <div className="sm-table-foot">
              <p className="sm-foot">Showing {fmtInt(filteredListings.length)} of {fmtInt(allListings.length)} listings{ticked.length ? `, ${ticked.length} ticked for comparison` : ''}</p>
              <span className="sm-foot-tools">
                <button type="button" className="cc-btn-ghost" onClick={() => runExport('listings', 'excel')} disabled={!filteredListings.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                <button type="button" className="cc-btn-ghost" onClick={() => runExport('listings', 'pdf')} disabled={!filteredListings.length}><FileText size={14} aria-hidden="true" /> PDF</button>
              </span>
            </div>
          </CardState>
        </Card>

        <Card
          className="sm-detail"
          title="Supplier / listing details"
          action={selected ? <button type="button" className="cc-link cc-link-btn" onClick={() => setDetailTab('supplier')}>View supplier profile <ChevronRight size={13} aria-hidden="true" /></button> : null}
        >
          <CardState state={cardState} lines={6}>
            <div className="sm-detail-body">
              <div className="sm-detail-top">
                <span className="sm-detail-art" aria-hidden="true"><Disc size={34} /></span>
                <div className="sm-detail-id">
                  {selected ? <Pill tone={stock.tone}>{stock.label}</Pill> : <Pill>No listing selected</Pill>}
                  <h3>{selected ? (selected.supplier || 'N/A') : (allListings.length ? 'Select a listing' : 'No listings yet')}</h3>
                  <p>{selected ? <><Rating value={selected.rating} />{selected.country ? <span> | {selected.country}</span> : null}</> : <span className="sm-muted">{allListings.length ? 'Pick a row in Supplier listings to see its details here.' : 'Add a supplier listing to see its details here.'}</span>}</p>
                </div>
              </div>
              <Tabs
                label="Listing detail views"
                value={detailTab}
                onChange={setDetailTab}
                tabs={[{ key: 'details', label: 'Listing details' }, { key: 'supplier', label: 'Supplier info' }, { key: 'prices', label: 'Pricing' }, { key: 'reviews', label: 'Reviews' }]}
              />
              {!selected && <div className="cc-empty">{allListings.length ? 'No listing selected.' : 'No supplier listings recorded yet.'}</div>}
              {selected && detailTab === 'details' && (
                <dl className="sm-fields">
                  {detailFields.map((f) => (
                    <div key={f.label}><dt>{f.label}</dt><dd className={f.value === NOT_RECORDED ? 'cc-na' : f.tone ? `sm-tone-${f.tone}` : ''} title={f.note}>{f.value}</dd></div>
                  ))}
                </dl>
              )}
              {selected && detailTab === 'supplier' && profile && (
                <dl className="sm-fields">
                  <div><dt>Listings</dt><dd>{fmtInt(profile.listings)}</dd></div>
                  <div><dt>In stock</dt><dd>{fmtInt(profile.inStock)}</dd></div>
                  <div><dt>Average rating</dt><dd>{profile.avgRating == null ? <span className="cc-na">Not rated</span> : profile.avgRating.toFixed(1)}</dd></div>
                  <div><dt>Categories</dt><dd>{profile.categories.join(', ') || <span className="cc-na">Not recorded</span>}</dd></div>
                  <div><dt>Verification</dt><dd className="cc-na">Not recorded</dd></div>
                </dl>
              )}
              {selected && detailTab === 'prices' && (prices.length < 2
                ? <div className="cc-empty">No other supplier lists the same item. Price history is not kept for listings.</div>
                : (
                  <ul className="sm-price-list">
                    {prices.map((p) => <li key={p.id} className={p.self ? 'is-self' : ''}><span>{p.supplier}</span><b>{money(p.price, p.currency)}</b></li>)}
                  </ul>
                ))}
              {selected && detailTab === 'reviews' && <div className="cc-empty">Supplier reviews are not recorded. The rating is the only feedback field on a listing.</div>}
              {selected && <button type="button" className="cc-link cc-link-btn sm-edit-link" onClick={() => openEdit('listing', selected)}>Edit listing <ChevronRight size={13} aria-hidden="true" /></button>}
              <div className="sm-detail-actions">
                <label className="sm-qty"><span className="sr-only">Quantity</span><input className="cc-select" type="number" min="1" inputMode="numeric" placeholder={selected && num(selected.moq) != null ? String(selected.moq) : 'Qty'} value={quoteQty} onChange={(e) => setQuoteQty(e.target.value)} disabled={!selected} aria-label="Quantity for the quote" /></label>
                <button type="button" className="cc-btn-primary" onClick={() => requestQuote(selected, quoteQty)} disabled={!selected || notProvisioned}><Send size={14} aria-hidden="true" /> Request quote</button>
                <button type="button" className="cc-btn-ghost" disabled={!selected} onClick={() => selected && setSelection((s) => ({ ...s, [String(selected.id)]: !s[String(selected.id)] }))}>
                  <ListChecks size={14} aria-hidden="true" /> {selected && selection[String(selected.id)] ? 'Remove from RFQ' : 'Add to RFQ'}
                </button>
              </div>
            </div>
          </CardState>
        </Card>

        <Card
          className="sm-compare"
          title="RFQ comparison"
          sub="Compare ticked supplier listings side by side before you award."
          action={<button type="button" className="cc-btn-ghost" disabled={ticked.length < 2} onClick={() => document.getElementById('sm-compare-table')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}><Scale size={14} aria-hidden="true" /> Compare quotes ({ticked.length})</button>}
        >
          <CardState state={cardState} lines={4}>
            <div id="sm-compare-table">
              <KitTable compact columns={compareCols} rows={comparison.rows} getRowId={(r) => String(r.id)} empty="No listings ticked. Tick listings in Supplier listings (or press Add to RFQ) to compare price, lead time and minimum order." />
            </div>
            {comparison.mixedCurrency && <p className="sm-foot">These listings use more than one currency. Best price and lead time are marked within each currency only.</p>}
            <div className="sm-compare-foot">
              <span className="sm-foot">{ticked.length} supplier{ticked.length === 1 ? '' : 's'} selected</span>
              <span className="sm-push" />
              <button type="button" className="cc-btn-ghost" onClick={() => setSelection({})} disabled={!ticked.length}>Clear</button>
              <button type="button" className="cc-btn-primary" onClick={awardSupplier} disabled={!ticked.length || notProvisioned}><Trophy size={14} aria-hidden="true" /> Award supplier</button>
            </div>
          </CardState>
        </Card>

        <Card
          className="sm-funnel"
          title="Sourcing funnel"
          sub="RFQ progression and supplier response funnel."
          action={<span className="cc-pill muted">{PERIODS.find((p) => p.key === period)?.label}</span>}
        >
          <CardState state={cardState} lines={4}>
            <ol className="sm-funnel-list">
              {funnel.map((s) => (
                <li key={s.key} className={s.recorded ? '' : 'is-unrecorded'}>
                  <span className={`sm-funnel-bar t-${s.tone}`} style={{ width: `${s.width}%` }}>{s.label}</span>
                  <b>{s.recorded ? fmtInt(s.count) : <span className="cc-na">N/A</span>}</b>
                  <span className="sm-funnel-pct">{s.recorded ? (s.pct == null ? 'N/A' : `${s.pct}%`) : 'Not recorded'}</span>
                </li>
              ))}
            </ol>
            <p className="sm-foot">{periodRfqs.length === 0 ? 'No RFQs in this period yet. Create an RFQ to start the funnel. ' : `${fmtInt(quoted)} RFQ${quoted === 1 ? '' : 's'} with a best quote. `}Supplier invitations and shortlists are not recorded on an RFQ.</p>
          </CardState>
        </Card>

        <Card className="sm-recent" title="Recent RFQs" action={<ViewAll label="View all" onClick={() => { setBottomTab('rfqs'); document.getElementById('sm-register')?.scrollIntoView({ behavior: 'smooth' }) }} />}>
          <CardState state={cardState} lines={5} empty={known && recent.length === 0 ? 'No RFQs recorded yet.' : null}>
            <div className="cc-list">
              {recent.map((r) => (
                <button key={r.id} type="button" className="cc-row sm-rfq-row" onClick={() => openEdit('rfq', r.raw)}>
                  <span className="cc-row-icon t-blue"><FileText size={15} aria-hidden="true" /></span>
                  <span className="cc-row-main">
                    <span className="cc-row-title">{r.rfqNo} <span className="sm-muted">{r.title}</span></span>
                    <span className="cc-row-meta">{r.responses}</span>
                  </span>
                  <span className="cc-row-side"><Pill tone={r.tone}>{r.statusLabel}</Pill><span className="cc-row-time">{r.age}</span></span>
                </button>
              ))}
            </div>
          </CardState>
        </Card>

        <section className="cc-card sm-register" id="sm-register" aria-label="RFQ register and insights">
          <Tabs
            label="Register views"
            variant="line"
            value={bottomTab}
            onChange={setBottomTab}
            tabs={[
              { key: 'rfqs', label: 'RFQ register', count: known ? periodRfqs.length : null },
              { key: 'prices', label: 'Price by category' },
              { key: 'top', label: 'Top-rated suppliers' },
            ]}
          />
          {bottomTab === 'rfqs' && (
            <>
              <div className="cc-filters sm-filters">
                <label className="cc-search"><Search size={14} aria-hidden="true" /><input type="search" placeholder="Product, RFQ number, supplier" value={rfqFilters.search} onChange={(e) => setRfqFilters((f) => ({ ...f, search: e.target.value }))} aria-label="Search RFQs" /></label>
                <select className="cc-select" aria-label="RFQ status" value={rfqFilters.status} onChange={(e) => setRfqFilters((f) => ({ ...f, status: e.target.value }))}><option value="">All statuses</option>{RFQ_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
                <select className="cc-select" aria-label="RFQ currency" value={rfqFilters.currency} onChange={(e) => setRfqFilters((f) => ({ ...f, currency: e.target.value }))}><option value="">All currencies</option>{rfqCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                <label className="sm-check"><input type="checkbox" checked={rfqFilters.overdueOnly} onChange={(e) => setRfqFilters((f) => ({ ...f, overdueOnly: e.target.checked }))} /> Only overdue</label>
                <span className="sm-push" />
                <button type="button" className="cc-icon-btn" onClick={() => runExport('rfqs', 'excel')} disabled={!filteredRfqs.length} aria-label="Export RFQs to Excel" title="Export RFQs to Excel"><FileSpreadsheet size={14} /></button>
                <button type="button" className="cc-icon-btn" onClick={() => runExport('rfqs', 'pdf')} disabled={!filteredRfqs.length} aria-label="Export RFQs to PDF" title="Export RFQs to PDF"><FileText size={14} /></button>
                <button type="button" className="cc-btn-primary" onClick={() => openCreate('rfq')} disabled={notProvisioned}><Plus size={14} aria-hidden="true" /> New RFQ</button>
              </div>
              <CardState state={cardState} lines={5}>
                <KitTable columns={rfqCols} rows={filteredRfqs} getRowId={(r) => String(r.id)} empty={allRfqs.length === 0 ? 'No RFQs recorded yet. Create the first RFQ.' : 'No RFQs match these filters.'} />
              </CardState>
            </>
          )}
          {bottomTab === 'prices' && (
            <CardState state={cardState} lines={4} empty={known && priceView.length === 0 ? 'No priced listings yet.' : null}>
              <p className="sm-foot">Averages are computed within each currency and never combined.</p>
              <KitTable
                compact
                columns={[
                  { key: 'category', header: 'Category', cell: (c) => titleCase(c.category) },
                  { key: 'currency', header: 'Currency' },
                  { key: 'listings', header: 'Listings', numeric: true },
                  { key: 'avg', header: 'Average price', numeric: true, cell: (c) => money(c.avgPrice, c.currency) || NA },
                ]}
                rows={priceView}
                getRowId={(c) => `${c.category}-${c.currency}`}
              />
            </CardState>
          )}
          {bottomTab === 'top' && (
            <CardState state={cardState} lines={4} empty={known && topSuppliers.length === 0 ? 'No rated suppliers yet.' : null}>
              <KitTable
                compact
                columns={[
                  { key: 'supplier', header: 'Supplier', cell: (s) => <span className="cc-strong">{s.supplier}</span> },
                  { key: 'rating', header: 'Average rating', numeric: true, cell: (s) => <Rating value={s.avgRating} /> },
                  { key: 'listings', header: 'Listings', numeric: true },
                ]}
                rows={topSuppliers.slice(0, 10)}
                getRowId={(s) => s.supplier}
              />
            </CardState>
          )}
        </section>
      </div>

      <Modal
        open={!!modal}
        onClose={closeModal}
        title={modal?.editing ? (isListingForm ? 'Edit listing' : 'Edit RFQ') : (isListingForm ? 'Add supplier listing' : 'New RFQ')}
        size="lg"
      >
        <form onSubmit={submit} className="space-y-4" noValidate>
          {isListingForm ? (
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
              <label className="inline-flex items-center gap-2 text-sm min-h-[44px] cursor-pointer">
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
              {saving ? 'Saving...' : modal?.editing ? 'Save changes' : (isListingForm ? 'Add listing' : 'Create RFQ')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title={confirmDelete?.mode === 'listing' ? 'Delete this listing?' : 'Delete this RFQ?'}
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-muted)]">
          {confirmDelete?.mode === 'listing'
            ? `${confirmDelete?.row?.supplier || 'Listing'}, ${confirmDelete?.row?.product_name || titleCase(confirmDelete?.row?.category) || 'N/A'}`
            : `${confirmDelete?.row?.rfq_no || 'RFQ'}, ${confirmDelete?.row?.product_name || 'N/A'}`}. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
