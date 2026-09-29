/**
 * Customers (route /customers) - Customer Management registry, rebuilt on the
 * shared page kit to the owner's light reference design.
 *
 * The `customers` table (V158) holds identity, contact, type (shown as
 * industry), site and status. Assigned assets, open service requests, account
 * codes and SLA targets come from Customer Portal accounts; active contracts
 * and renewals from the contracts register. Both are linked by name (rule in
 * src/lib/customersView.js, stated on screen) and each loads and fails on its
 * own. Revenue, satisfaction and SLA performance have no source and read N/A.
 *
 * Kept from the previous page: create / edit / delete with role-gated writes
 * (RLS), contact-quality and site filters, Excel and PDF export of the filtered
 * register, loading / error+Retry states and the not-provisioned probe.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Users, UserCheck, FileText, Truck, AlertTriangle, BarChart3, Plus, Pencil, Trash2,
  Search, X, Save, Loader2, FileSpreadsheet, RefreshCw, Link2, Download, ShieldCheck,
  CalendarClock, Star, PieChart, SlidersHorizontal, Info, Mail,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import {
  Card, CardState, Kpi, PageHero, Donut, Pager, KitTable, ViewAll, fmtInt, fmtPct, useCard,
} from '../components/commandCenter/kit'
import { WORLD_LAND_PATH, WORLD_W, WORLD_H, project } from '../components/commandCenter/worldLand'
import { COUNTRY_POINTS } from '../lib/commandCenter'
import { useSettings } from '../contexts/SettingsContext'
import {
  listCustomers, createCustomer, updateCustomer, deleteCustomer, CUSTOMER_STATUSES,
} from '../lib/api/customers'
import { listCustomerAccounts } from '../lib/api/customerPortal'
import { listContracts } from '../lib/api/contracts'
import { isValidEmail } from '../lib/customers'
import {
  statusLabel, filterCustomers, distinctValues, CONTACT_QUALITY,
  customerExportRows, CUSTOMER_EXPORT_COLUMNS,
} from '../lib/customersAnalytics'
import {
  buildCustomerRows, customerViewKpis, byCountry, topByFleet, healthSegments, serviceCoverage,
  renewalsDue, filterView, periodLabel, healthLabel, MATCH_RULE, HEALTH_RULE, RENEWAL_DAYS,
} from '../lib/customersView'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation, probeRelation } from '../lib/api/_client'
import './customers.css'

// The service reads the newest customers up to this many; say so when hit.
const READ_LIMIT = 500

const EMPTY_FORM = {
  name: '', customer_type: '', contact_name: '', email: '', phone: '',
  address: '', site: '', status: 'active', notes: '',
}

const STATUS_TONE = { active: 'good', inactive: 'muted', prospect: 'info' }
const HEALTH_TONE = { healthy: 'good', at_risk: 'warn', critical: 'bad', inactive: 'muted', prospect: 'info' }

// ─── Create / edit modal ──────────────────────────────────────────────────────
function CustomerModal({ open, initial, onClose, onSaved, country, typeOptions }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editing = !!initial?.id
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (open) {
      setForm(initial?.id ? { ...EMPTY_FORM, ...initial } : EMPTY_FORM)
      setError('')
    }
  }, [open, initial])

  const close = () => { if (!busy) onClose?.() }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!String(form.name || '').trim()) { setError('Please enter a customer name.'); return }
    if (String(form.email || '').trim() && !isValidEmail(form.email)) { setError('Please enter a valid email address.'); return }
    setBusy(true)
    try {
      if (editing) {
        const { id: _id, ...patch } = form
        const row = await updateCustomer(initial.id, patch)
        onSaved?.(row, 'update')
      } else {
        const row = await createCustomer({ ...form, country: country !== 'All' ? country : null })
        onSaved?.(row, 'create')
      }
      onClose?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the customer. Please try again.'))
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, country, onSaved, onClose])

  return (
    <Modal open={open} onClose={close} title={editing ? 'Edit customer' : 'New customer'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="cu-name">Customer name <span className="text-red-400">*</span></label>
          <input id="cu-name" className="input w-full" placeholder="e.g. Gulf Logistics LLC" value={form.name || ''} maxLength={200} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="cu-type">Type</label>
            <input id="cu-type" className="input w-full" placeholder="Fleet / Workshop / Partner" value={form.customer_type || ''} maxLength={80} onChange={(e) => set('customer_type', e.target.value)} list="customer-type-options" />
            <datalist id="customer-type-options">
              {(typeOptions || []).map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="cu-status">Status</label>
            <select id="cu-status" className="input w-full" value={form.status || 'active'} onChange={(e) => set('status', e.target.value)}>
              {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="cu-contact">Contact name</label>
            <input id="cu-contact" className="input w-full" placeholder="Primary contact" value={form.contact_name || ''} maxLength={160} onChange={(e) => set('contact_name', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="cu-site">Site / Branch</label>
            <input id="cu-site" className="input w-full" placeholder="e.g. Dubai HQ" value={form.site || ''} maxLength={160} onChange={(e) => set('site', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="cu-email">Email</label>
            <input id="cu-email" type="email" autoComplete="email" className="input w-full" placeholder="ops@customer.com" value={form.email || ''} maxLength={254} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="cu-phone">Phone</label>
            <input id="cu-phone" type="tel" autoComplete="tel" className="input w-full" placeholder="+971" value={form.phone || ''} maxLength={60} onChange={(e) => set('phone', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="cu-address">Address</label>
          <input id="cu-address" className="input w-full" placeholder="Street, city, country" value={form.address || ''} maxLength={500} onChange={(e) => set('address', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="cu-notes">Notes</label>
          <textarea id="cu-notes" className="input w-full min-h-[80px] resize-y" placeholder="Account notes, terms, context" value={form.notes || ''} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={close} disabled={busy} className="btn-secondary text-sm min-h-[44px]">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
            {busy ? 'Saving' : editing ? 'Save changes' : 'Create customer'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Delete confirmation ──────────────────────────────────────────────────────
function DeleteConfirm({ customer, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setError(''); setBusy(false) }, [customer])
  const run = async () => {
    setBusy(true); setError('')
    try { await deleteCustomer(customer.id); onConfirm?.(customer.id) }
    catch (err) { setError(toUserMessage(err, 'Could not delete this customer.')); setBusy(false) }
  }
  return (
    <Modal
      open={Boolean(customer)}
      onClose={() => { if (!busy) onCancel?.() }}
      title="Delete customer?"
      size="sm"
      footer={(
        <>
          <button type="button" onClick={onCancel} className="btn-secondary text-sm min-h-[44px]" disabled={busy}>Cancel</button>
          <button type="button" onClick={run} disabled={busy} className="btn-danger text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
            {busy ? 'Deleting' : 'Delete'}
          </button>
        </>
      )}
    >
      {customer && (
        <p className="text-sm text-[var(--text-muted)]">
          <span className="font-medium text-[var(--text-secondary)]">{customer.name}</span> will be permanently removed. This cannot be undone.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-400 mt-3">{error}</p>}
    </Modal>
  )
}

// ─── Customer distribution map ────────────────────────────────────────────────
function CustomerMap({ points, unplaced, country, onCountry }) {
  const view = useMemo(() => {
    if (!points.length) return [0, 0, WORLD_W, WORLD_H]
    const xs = points.map((p) => p.xy[0]); const ys = points.map((p) => p.xy[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2; const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const w = Math.max(420, (Math.max(...xs) - Math.min(...xs)) * 4)
    const h = w * 0.52
    return [cx - w / 2, cy - h / 2, w, h]
  }, [points])
  const max = Math.max(1, ...points.map((p) => p.total))
  return (
    <div className="cc-map cu-map">
      <svg viewBox={view.join(' ')} preserveAspectRatio="xMidYMid slice" role="img"
        aria-label={`Customers by country: ${points.map((p) => `${p.country} ${p.total}`).join(', ')}`}>
        <path d={WORLD_LAND_PATH} fill="var(--cc-land)" stroke="var(--cc-land-stroke)" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
        {points.map((p) => {
          const r = (7 + 9 * Math.sqrt(p.total / max)) * view[2] / 520
          const on = country === p.country
          return (
            <g key={p.country} className="cu-pin" role="button" tabIndex={0} aria-label={`${p.country}: ${p.total} customers. Filter the register.`}
              onClick={() => onCountry(on ? '' : p.country)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCountry(on ? '' : p.country) } }}>
              <circle cx={p.xy[0]} cy={p.xy[1]} r={r * 1.7} fill="var(--cc-green)" opacity={on ? 0.3 : 0.16} />
              <circle cx={p.xy[0]} cy={p.xy[1]} r={r} fill="var(--cc-green-strong)" stroke="var(--cc-green)" strokeWidth={r * 0.18} />
              <text x={p.xy[0]} y={p.xy[1]} dy="0.35em" textAnchor="middle" fontSize={r * 0.95} fontWeight="700" fill="#fff">{p.total}</text>
              <title>{`${p.country}: ${p.total} customers`}</title>
            </g>
          )
        })}
      </svg>
      {unplaced > 0 && (
        <div className="cc-map-legend"><b>Not on the map</b><div>No country recorded<span>{fmtInt(unplaced)}</span></div></div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Customers() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const [search, setSearch] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [qualityFilter, setQualityFilter] = useState('all')
  const [moreFilters, setMoreFilters] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listCustomers({ country: activeCountry, limit: READ_LIMIT })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      // The service degrades a missing table to [] instead of throwing. Probe
      // on an empty list and believe only a DEFINITE answer.
      if (list.length === 0) {
        const { exists, checked } = await probeRelation('customers')
        setMissing(checked && !exists)
      }
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      else setError(toUserMessage(err, 'Could not load customers.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])
  useEffect(() => { load() }, [load])

  // Linked registers: each loads and fails on its own.
  const accountsCard = useCard(() => listCustomerAccounts({ country: activeCountry, limit: 1000 }), [activeCountry])
  const contractsCard = useCard(async () => (await listContracts({ country: activeCountry, limit: 1000 })).rows, [activeCountry])
  const accounts = useMemo(() => (accountsCard.error || accountsCard.loading ? null : (accountsCard.data || [])), [accountsCard.error, accountsCard.loading, accountsCard.data])
  const contracts = useMemo(() => (contractsCard.error || contractsCard.loading ? null : (contractsCard.data || [])), [contractsCard.error, contractsCard.loading, contractsCard.data])

  const loading = rows === null
  const now = useMemo(() => new Date(), [rows, accounts, contracts]) // eslint-disable-line react-hooks/exhaustive-deps
  const viewRows = useMemo(() => buildCustomerRows(rows || [], { accounts, contracts, now }), [rows, accounts, contracts, now])
  const kpi = useMemo(() => customerViewKpis(viewRows, { accountsKnown: accounts != null, contractsKnown: contracts != null }), [viewRows, accounts, contracts])

  const countries = useMemo(() => byCountry(viewRows), [viewRows])
  const mapPoints = useMemo(() => countries
    .map((c) => ({ ...c, xy: COUNTRY_POINTS[c.country] ? project(...COUNTRY_POINTS[c.country]) : null }))
    .filter((c) => c.xy), [countries])
  const unplaced = countries.filter((c) => !COUNTRY_POINTS[c.country]).reduce((s, c) => s + c.total, 0)
  const top = useMemo(() => topByFleet(viewRows), [viewRows])
  const health = useMemo(() => healthSegments(viewRows), [viewRows])
  const healthy = health.find((h) => h.key === 'healthy')?.count || 0
  const coverage = useMemo(() => serviceCoverage(viewRows, contracts != null), [viewRows, contracts])
  const renewals = useMemo(() => renewalsDue(viewRows, now), [viewRows, now])

  const industryOptions = useMemo(() => distinctValues(rows || [], 'customer_type'), [rows])
  const siteOptions = useMemo(() => distinctValues(rows || [], 'site'), [rows])
  const filtered = useMemo(() => {
    const base = filterView(viewRows, { query: search, country: countryFilter, industry: industryFilter, status: statusFilter })
    if (!siteFilter && qualityFilter === 'all') return base
    const keep = new Set(filterCustomers(base, { site: siteFilter, quality: qualityFilter }).map((r) => r.id))
    return base.filter((r) => keep.has(r.id))
  }, [viewRows, search, countryFilter, industryFilter, statusFilter, siteFilter, qualityFilter])
  useEffect(() => { setPage(0) }, [search, countryFilter, industryFilter, statusFilter, siteFilter, qualityFilter, pageSize])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pages - 1)
  const pageRows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const truncated = (rows || []).length >= READ_LIMIT
  const hasFilters = search || countryFilter || industryFilter || statusFilter || siteFilter || qualityFilter !== 'all'
  const clearFilters = () => { setSearch(''); setCountryFilter(''); setIndustryFilter(''); setStatusFilter(''); setSiteFilter(''); setQualityFilter('all') }

  const onSaved = useCallback((row, kind) => {
    if (!row) { load(); return }
    setRows((prev) => {
      const list = prev || []
      return kind === 'create' ? [row, ...list] : list.map((r) => (r.id === row.id ? { ...r, ...row } : r))
    })
    if (kind === 'create') setMissing(false)
  }, [load])
  const onDeleted = useCallback((id) => {
    setRows((prev) => (prev || []).filter((r) => r.id !== id))
    setDeleting(null)
  }, [])
  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = useCallback((r) => { setEditing(r); setModalOpen(true) }, [])

  const exportName = reportFileName('Customer registry', new Date().toISOString().slice(0, 10))
  const doExport = async (kind) => {
    try {
      const out = customerExportRows(filtered)
      if (kind === 'excel') await exportToExcel(out, CUSTOMER_EXPORT_COLUMNS.map((c) => c.key), CUSTOMER_EXPORT_COLUMNS.map((c) => c.header), exportName)
      else await exportToPdf(out, CUSTOMER_EXPORT_COLUMNS, 'Customer Registry', exportName, 'landscape')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const na = (t = 'N/A') => <span className="cc-na">{t}</span>
  const linkedDisplay = (card, v) => (card.loading ? '...' : card.error ? 'N/A' : v == null ? 'N/A' : fmtInt(v))
  const custState = { loading, error: error && !rows?.length ? error : null, retry: load, data: rows }
  const noCustomers = !loading && !(rows || []).length
  const emptyInvite = (text) => (
    <div>
      {missing ? 'Customer Management is not enabled yet.' : text}
      {!missing && <><br /><button type="button" className="cc-btn" onClick={openCreate}>Add customer</button></>}
    </div>
  )

  const kpis = [
    { icon: Users, tone: 't-green', value: kpi.total, label: 'Total Customers', title: truncated ? `Only the newest ${READ_LIMIT} customers are loaded.` : 'Customers in the registry for this country scope.' },
    { icon: UserCheck, tone: 't-green', value: kpi.active, label: 'Active Customers', title: 'Customers marked active.' },
    { icon: FileText, tone: 't-purple', label: 'Active Contracts', display: linkedDisplay(contractsCard, kpi.activeContracts), to: '/contracts',
      title: `Active, unexpired contracts linked to a customer. ${MATCH_RULE}` },
    { icon: Truck, tone: 't-green', label: 'Assigned Assets', display: linkedDisplay(accountsCard, kpi.assignedAssets),
      title: kpi.assignedAssets == null ? `No customer is linked to a Customer Portal account with an asset count. ${MATCH_RULE}` : `Linked asset counts from ${kpi.linkedAccounts} Customer Portal account(s).` },
    { icon: AlertTriangle, tone: 't-red', danger: (kpi.openIssues || 0) > 0, label: 'Open Service Issues', display: linkedDisplay(accountsCard, kpi.openIssues),
      title: kpi.openIssues == null ? `No customer is linked to a Customer Portal account. ${MATCH_RULE}` : 'Open service requests on linked Customer Portal accounts.' },
    { icon: BarChart3, tone: 't-green', label: 'Monthly Revenue', display: 'N/A', title: 'No billing or revenue is recorded for customers, so none is shown.' },
  ]

  const columns = [
    { key: 'code', header: 'Customer Code', cell: (r) => r.code || na() },
    {
      key: 'name', header: 'Customer Name',
      cell: (r) => (
        <span className="cu-name">
          <b>{r.name}</b>
          {r.email ? <span className="cc-sub"><Mail size={11} aria-hidden="true" /> {r.email}</span> : <span className="cc-sub">{r.contact_name || 'No email on file'}</span>}
        </span>
      ),
    },
    { key: 'customer_type', header: 'Industry / Segment', cell: (r) => r.customer_type || na() },
    { key: 'country', header: 'Country', cell: (r) => r.country || na() },
    { key: 'assets', header: 'Assigned Assets', align: 'right', cell: (r) => (r.assets == null ? na() : <span className="cc-strong">{fmtInt(r.assets)}</span>) },
    { key: 'site', header: 'Site', cell: (r) => r.site || na() },
    { key: 'period', header: 'Contract Period', cell: (r) => (contractsCard.loading ? na('...') : periodLabel(r.period) || na(r.contractsKnown ? 'No linked contract' : 'N/A')) },
    { key: 'status', header: 'Status', cell: (r) => <span className={`cc-pill ${STATUS_TONE[String(r.status || '').toLowerCase()] || 'muted'}`}>{statusLabel(r.status)}</span> },
    { key: 'health', header: 'Health', cell: (r) => <span className={`cc-pill ${HEALTH_TONE[r.health] || 'muted'}`} title={HEALTH_RULE}>{healthLabel(r.health)}</span> },
    {
      key: 'sla', header: 'SLA Status',
      cell: (r) => <span title="The portal account records an SLA target only. No response times are recorded, so SLA performance cannot be measured.">{r.slaHours == null ? na() : <span className="cc-na">Target {fmtInt(r.slaHours)} h, not measured</span>}</span>,
    },
    {
      key: '_actions', header: 'Actions', sortable: false,
      cell: (r) => (
        <span className="cu-actions" onClick={(e) => e.stopPropagation()}>
          <Link className="cc-icon-btn" to="/contracts" aria-label={`Contracts for ${r.name}`} title="View contracts"><FileText size={14} /></Link>
          <button type="button" className="cc-icon-btn" onClick={() => openEdit(r)} aria-label={`Edit ${r.name || 'customer'}`}><Pencil size={14} /></button>
          <button type="button" className="cc-icon-btn cu-danger" onClick={() => setDeleting(r)} aria-label={`Delete ${r.name || 'customer'}`}><Trash2 size={14} /></button>
        </span>
      ),
    },
  ]

  return (
    <div className="cc cu-page">
      <div className="cu-hero-wrap">
        <PageHero
          title="Customers"
          lead="Manage your customers, contracts, sites and fleet allocations"
          imgLight="/dashboard/hero-customers-light.webp"
          imgDark="/dashboard/hero-customers-dark.webp"
        />
        <div className="cu-hero-actions">
          <button type="button" className="cc-btn-ghost" onClick={openCreate} disabled={missing}><Plus size={15} aria-hidden="true" /> Add Customer</button>
          <Link className="cc-btn-ghost" to="/contracts"><FileText size={15} aria-hidden="true" /> View Contracts</Link>
          <button type="button" className="cc-btn-ghost" disabled title="Assets cannot be assigned to a customer yet: Customer Portal accounts store an asset count, not a list of assets."><Link2 size={15} aria-hidden="true" /> Assign Assets</button>
          <button type="button" className="cc-btn-ghost" onClick={() => doExport('excel')} disabled={!filtered.length}><Download size={15} aria-hidden="true" /> Export List</button>
        </div>
      </div>

      {missing && (
        <div className="cc-card cu-banner warn" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><b>Customer Management is not enabled on this database yet.</b><p>Apply MIGRATIONS_V158_CUSTOMERS.sql, then reload.</p></div>
        </div>
      )}
      {error && (
        <div className="cc-card cu-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><b>Could not load customers.</b><p>{error}</p></div>
          <button type="button" className="cc-btn-ghost" onClick={load}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {actionError && (
        <div className="cc-card cu-banner bad" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><p>{actionError}</p></div>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      <div className="cu-row cu-row-1">
        <Card title="Customer Distribution" sub="Customers by country"
          action={(
            <select className="cc-select" aria-label="Country" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
              <option value="">All countries</option>
              {countries.map((c) => <option key={c.country} value={c.country}>{c.country}</option>)}
            </select>
          )}>
          <CardState state={custState} lines={6} empty={noCustomers ? emptyInvite('No customers yet, so there is nothing to place on the map.') : null}>
            <CustomerMap points={mapPoints} unplaced={unplaced} country={countryFilter} onCountry={setCountryFilter} />
          </CardState>
        </Card>

        <Card title="Top Customers by Fleet Size" sub="Assets linked on Customer Portal accounts"
          action={<ViewAll to="/customer-portal" label="Portal accounts" />}>
          <CardState state={noCustomers ? custState : { ...accountsCard, loading: accountsCard.loading || loading }} lines={5}
            empty={noCustomers ? emptyInvite('No customers yet.')
              : top.length === 0 ? <span title={MATCH_RULE}>No customer is linked to a portal account with assets. Accounts link by matching company name.</span> : null}>
            <ol className="cu-top">
              {top.map((t, i) => {
                const w = Math.round((t.assets / top[0].assets) * 100)
                return (
                  <li key={t.id}>
                    <span className="cu-rank">{i + 1}</span>
                    <span className="cu-top-name"><b>{t.name}</b><small>{fmtInt(t.assets)} assets</small></span>
                    <span className="cc-bar-track cu-top-bar"><i style={{ width: `${w}%`, background: 'var(--cc-green)' }} /></span>
                    <b className="cu-top-n">{fmtInt(t.assets)}</b>
                  </li>
                )
              })}
            </ol>
          </CardState>
        </Card>

        <Card title="Customer Health Overview" sub="Rule-based, from status, contact and linked records"
          action={<span className="cu-info" title={HEALTH_RULE}><Info size={14} aria-label="How health is judged" /></span>}>
          <CardState state={custState} lines={5} empty={noCustomers ? emptyInvite('No customers yet.') : null}>
            <Donut segments={health} total={healthy} centerLabel={viewRows.length ? `Healthy, ${fmtPct((healthy / viewRows.length) * 100)}` : "Healthy"}
              onSelect={(s) => { if (['active', 'inactive', 'prospect'].includes(s.key)) setStatusFilter(s.key) }} />
          </CardState>
        </Card>
      </div>

      <div className="cu-row cu-row-2">
        <Card className="cu-mini">
          <div className="cu-mini-body">
            <span className="cc-kpi-icon t-green"><ShieldCheck size={20} aria-hidden="true" /></span>
            <div>
              <h2 className="cc-card-title">Service Coverage</h2>
              <b className="cu-mini-val">{contractsCard.loading ? '...' : contractsCard.error ? 'N/A' : fmtPct(coverage.pct)}</b>
              <small>{contractsCard.error ? <>Contracts could not be read. <button type="button" className="cc-link cc-link-btn" onClick={contractsCard.retry}>Try again</button></>
                : coverage.pct == null ? (coverage.of ? 'Contracts not loaded yet' : 'No active customers yet')
                  : `${coverage.covered} of ${coverage.of} active customers hold an active contract`}</small>
            </div>
          </div>
        </Card>
        <Card className="cu-mini">
          <div className="cu-mini-body">
            <span className="cc-kpi-icon t-blue"><CalendarClock size={20} aria-hidden="true" /></span>
            <div>
              <h2 className="cc-card-title">Contract Renewal <span className="cu-muted">(next {RENEWAL_DAYS} days)</span></h2>
              <b className="cu-mini-val">{contractsCard.loading ? '...' : contractsCard.error ? 'N/A' : fmtInt(renewals.length)}</b>
              <small title={renewals.map((r) => `${r.customer}: ${r.title}, ${r.days} day(s)`).join('\n') || undefined}>
                {contractsCard.error ? <>Contracts could not be read. <button type="button" className="cc-link cc-link-btn" onClick={contractsCard.retry}>Try again</button></>
                  : renewals.length ? `Soonest: ${renewals[0].customer}, ${renewals[0].days} day(s)` : 'No linked contract ends in this window'}
              </small>
            </div>
          </div>
        </Card>
        <Card className="cu-mini">
          <div className="cu-mini-body">
            <span className="cc-kpi-icon t-amber"><Star size={20} aria-hidden="true" /></span>
            <div>
              <h2 className="cc-card-title">Customer Satisfaction</h2>
              <b className="cu-mini-val">N/A</b>
              <small>No customer ratings or surveys are recorded.</small>
            </div>
          </div>
        </Card>
        <Card className="cu-mini">
          <div className="cu-mini-body">
            <span className="cc-kpi-icon t-purple"><PieChart size={20} aria-hidden="true" /></span>
            <div>
              <h2 className="cc-card-title">Revenue by Segment</h2>
              <b className="cu-mini-val">N/A</b>
              <small>No customer revenue is recorded, so segments cannot be valued.</small>
            </div>
          </div>
        </Card>
      </div>

      <Card className="cu-register">
        <div className="cc-filters cu-filters">
          <div className="cc-search">
            <Search size={15} aria-hidden="true" />
            <label htmlFor="cu-search" className="sr-only">Search customers</label>
            <input id="cu-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by customer name, code, contact, industry..." />
          </div>
          <select className="cc-select" aria-label="Country" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
            <option value="">All Countries</option>
            {countries.map((c) => <option key={c.country} value={c.country}>{c.country}</option>)}
          </select>
          <select className="cc-select" aria-label="Industry" value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} disabled={!industryOptions.length}>
            <option value="">All Industries</option>
            {industryOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="cc-select" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <button type="button" className="cc-btn-ghost" aria-expanded={moreFilters} onClick={() => setMoreFilters((v) => !v)}><SlidersHorizontal size={14} aria-hidden="true" /> More Filters</button>
          {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={13} aria-hidden="true" /> Clear</button>}
        </div>
        {moreFilters && (
          <div className="cc-filters cu-filters cu-more">
            <select className="cc-select" aria-label="Site" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} disabled={!siteOptions.length}>
              <option value="">All sites</option>
              {siteOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="cc-select" aria-label="Contact quality" value={qualityFilter} onChange={(e) => setQualityFilter(e.target.value)}>
              <option value="all">Any contact quality</option>
              {CONTACT_QUALITY.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
            </select>
            <button type="button" className="cc-btn-ghost" onClick={() => doExport('pdf')} disabled={!filtered.length}><FileText size={14} aria-hidden="true" /> Export PDF</button>
            <button type="button" className="cc-btn-ghost" onClick={() => doExport('excel')} disabled={!filtered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Export Excel</button>
            <button type="button" className="cc-btn-ghost" onClick={() => { load(); accountsCard.retry(); contractsCard.retry() }} disabled={refreshing}>
              {refreshing ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />} Refresh
            </button>
          </div>
        )}
        {(accountsCard.error || contractsCard.error) && (
          <p className="cu-note" role="status">
            {accountsCard.error && <>Customer Portal accounts could not be read, so assets, issues, codes and SLA targets show N/A. <button type="button" className="cc-link cc-link-btn" onClick={accountsCard.retry}>Try again</button> </>}
            {contractsCard.error && <>Contracts could not be read, so contract figures show N/A. <button type="button" className="cc-link cc-link-btn" onClick={contractsCard.retry}>Try again</button></>}
          </p>
        )}
        <CardState state={custState} lines={8}
          empty={noCustomers ? emptyInvite('No customers yet. Add your first customer to start the registry.')
            : filtered.length === 0 ? 'No customers match these filters.' : null}>
          <KitTable manualPagination showPagination={false} enableSorting={false}
            pageIndex={safePage} pageSize={pageSize} pageCount={pages} totalRows={filtered.length}
            getRowId={(r) => String(r.id)} rows={pageRows} columns={columns} />
          <Pager page={safePage} pageSize={pageSize} total={filtered.length} noun="customers"
            onPage={setPage} onPageSize={setPageSize} sizes={[10, 25, 50, 100]} />
        </CardState>
        <p className="cu-note">{MATCH_RULE}{truncated ? ` Only the newest ${READ_LIMIT} customers are loaded.` : ''}</p>
      </Card>

      <CustomerModal
        open={modalOpen}
        initial={editing}
        country={activeCountry}
        typeOptions={industryOptions}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSaved={onSaved}
      />
      <DeleteConfirm customer={deleting} onCancel={() => setDeleting(null)} onConfirm={onDeleted} />
    </div>
  )
}
