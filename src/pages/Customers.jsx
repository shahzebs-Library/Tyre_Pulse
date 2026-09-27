/**
 * Customers (route /customers) - Customer Management registry.
 *
 * A per-organisation book of customer accounts (fleet operators, workshops,
 * partners) with contact details, classification and a status lifecycle. Full
 * CRUD with role-gated writes (RLS enforces Admin/Manager/Director), KPI tiles,
 * contact-quality coverage, status and type charts, search + filters, a
 * sortable register and Excel/PDF export. Country-scoped via Settings.
 *
 * Every figure comes from the pure engine src/lib/customersAnalytics.js (built
 * on src/lib/customers.js). A failed read shows an error with Retry; a missing
 * table is confirmed by a probe before the page claims it is not installed.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Building2, Users, User, Phone, Mail, Plus, Pencil, Trash2, Search, X,
  Save, Loader2, AlertTriangle, FileSpreadsheet, FileText, CheckCircle2,
  RefreshCw, MapPin, PhoneOff, PieChart, BarChart3,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listCustomers, createCustomer, updateCustomer, deleteCustomer,
  CUSTOMER_STATUSES,
} from '../lib/api/customers'
import { isValidEmail } from '../lib/customers'
import {
  statusLabel, filterCustomers, distinctValues, customerKpis, countBy, statusMix,
  contactQuality, CONTACT_QUALITY, contactQualityLabel, customerExportRows, CUSTOMER_EXPORT_COLUMNS,
} from '../lib/customersAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation, probeRelation } from '../lib/api/_client'
import { colorAt, withAlpha } from '../lib/reportColors'
import { compareValues, isBlank } from '../lib/consoleTable'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

// The service reads the newest customers up to this many; say so when hit.
const READ_LIMIT = 500

const STATUS_CLS = {
  active: 'bg-green-900/40 text-green-300 border border-green-700/50',
  inactive: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
  prospect: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
}
// Semantic tones for the status doughnut (the colour carries meaning).
const STATUS_TONE = { active: '#22c55e', inactive: '#94a3b8', prospect: '#0ea5e9' }
const QUALITY_TONE = {
  complete: 'text-green-500',
  reachable: 'text-sky-500',
  invalid_email: 'text-amber-500',
  missing: 'text-red-400',
}

const EMPTY_FORM = {
  name: '', customer_type: '', contact_name: '', email: '', phone: '',
  address: '', site: '', status: 'active', notes: '',
}

/** Column sorting through the shared console comparator (blanks sort last). */
const sortable = (fn) => ({
  accessorFn: (r) => { const v = fn(r); return isBlank(v) ? undefined : v },
  sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
  sortUndefined: 'last',
})

const BAR_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y',
  plugins: { legend: { display: false } },
  scales: {
    x: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)' }, grid: { display: false } },
  },
}
const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '60%',
  plugins: { legend: { position: 'right', labels: { color: 'var(--text-muted)', boxWidth: 12 } } },
}

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

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Customers() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [qualityFilter, setQualityFilter] = useState('all')
  const [search, setSearch] = useState('')

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
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      else setError(toUserMessage(err, 'Could not load customers.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  const typeOptions = useMemo(() => distinctValues(rows || [], 'customer_type'), [rows])
  const siteOptions = useMemo(() => distinctValues(rows || [], 'site'), [rows])

  const filtered = useMemo(() => filterCustomers(rows || [], {
    status: statusFilter, type: typeFilter, site: siteFilter, quality: qualityFilter, query: search,
  }), [rows, statusFilter, typeFilter, siteFilter, qualityFilter, search])
  // The tiles and charts cover the customers matching type, site and search.
  // Status and contact quality are held out: the tiles and the status chart
  // report on those, so narrowing them by their own filter restates the choice.
  const kpiScope = useMemo(
    () => filterCustomers(rows || [], { type: typeFilter, site: siteFilter, query: search }),
    [rows, typeFilter, siteFilter, search],
  )
  const kpi = useMemo(() => customerKpis(kpiScope), [kpiScope])
  const mix = useMemo(() => statusMix(kpiScope).filter((s) => s.count > 0), [kpiScope])
  const byType = useMemo(() => countBy(kpiScope, 'customer_type').slice(0, 8), [kpiScope])
  const truncated = (rows || []).length >= READ_LIMIT

  const onSaved = useCallback((row, kind) => {
    if (!row) { load(); return }
    setRows((prev) => {
      const list = prev || []
      return kind === 'create' ? [row, ...list] : list.map((r) => (r.id === row.id ? { ...r, ...row } : r))
    })
    setUpdatedAt(new Date())
  }, [load])

  const onDeleted = useCallback((id) => {
    setRows((prev) => (prev || []).filter((r) => r.id !== id))
    setDeleting(null)
  }, [])

  const clearFilters = () => { setStatusFilter('all'); setTypeFilter(''); setSiteFilter(''); setQualityFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || typeFilter || siteFilter || qualityFilter !== 'all' || search

  const exportName = reportFileName('Customer registry', new Date().toISOString().slice(0, 10))
  const doExport = async (kind) => {
    try {
      const out = customerExportRows(filtered)
      if (kind === 'excel') await exportToExcel(out, CUSTOMER_EXPORT_COLUMNS.map((c) => c.key), CUSTOMER_EXPORT_COLUMNS.map((c) => c.header), exportName)
      else await exportToPdf(out, CUSTOMER_EXPORT_COLUMNS, 'Customer Registry', exportName, 'landscape')
    } catch (e) {
      setError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const kpis = [
    { label: 'Total customers', value: kpi.total, icon: Building2, tone: 'text-[var(--text-primary)]', sub: `${kpi.types} type${kpi.types === 1 ? '' : 's'}` },
    { label: 'Active', value: kpi.active, icon: CheckCircle2, tone: 'text-green-400', sub: kpi.activePct == null ? undefined : `${kpi.activePct}% of the registry` },
    { label: 'Prospects', value: kpi.prospect, icon: Users, tone: 'text-sky-400', sub: `${kpi.inactive} inactive` },
    { label: 'Reachable', value: kpi.reachablePct == null ? 'N/A' : `${kpi.reachablePct}%`, icon: Phone, tone: 'text-violet-400', sub: 'Valid email or a phone number' },
    { label: 'Contact gaps', value: kpi.needsAttention, icon: PhoneOff, tone: kpi.needsAttention > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]',
      sub: `${kpi.quality.invalid_email} bad email, ${kpi.quality.missing} none` },
    { label: 'Sites', value: kpi.sites, icon: MapPin, tone: 'text-[var(--text-primary)]' },
  ]

  const statusChart = useMemo(() => ({
    labels: mix.map((m) => m.label),
    datasets: [{ data: mix.map((m) => m.count), backgroundColor: mix.map((m) => STATUS_TONE[m.key]), borderColor: 'var(--panel-2)', borderWidth: 2 }],
  }), [mix])
  const typeChart = useMemo(() => ({
    labels: byType.map((t) => t.key),
    datasets: [{ label: 'Customers', data: byType.map((t) => t.count), backgroundColor: byType.map((_, i) => withAlpha(colorAt(i), 0.85)), borderRadius: 4 }],
  }), [byType])

  const openEdit = useCallback((r) => { setEditing(r); setModalOpen(true) }, [])

  const columns = useMemo(() => [
    { id: 'name', header: 'Customer', ...sortable((r) => r.name), size: 220,
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-[var(--text-primary)]">{row.original.name}</div>
          {row.original.address && <div className="text-xs text-[var(--text-muted)] truncate max-w-[240px]" title={row.original.address}>{row.original.address}</div>}
        </div>
      ) },
    { id: 'type', header: 'Type', ...sortable((r) => r.customer_type), size: 120,
      cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.customer_type || 'N/A'}</span> },
    { id: 'contact', header: 'Contact', ...sortable((r) => r.contact_name), size: 220,
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="space-y-0.5">
            {r.contact_name && <div className="text-[var(--text-secondary)] flex items-center gap-1.5"><User size={12} className="text-[var(--text-muted)]" aria-hidden="true" />{r.contact_name}</div>}
            {r.email && <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><Mail size={11} aria-hidden="true" />{r.email}</div>}
            {r.phone && <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><Phone size={11} aria-hidden="true" />{r.phone}</div>}
            {!r.contact_name && !r.email && !r.phone && <span className="text-[var(--text-muted)]">N/A</span>}
          </div>
        )
      } },
    { id: 'quality', header: 'Contact quality', ...sortable((r) => contactQualityLabel(contactQuality(r))), size: 170,
      cell: ({ row }) => {
        const q = contactQuality(row.original)
        return <span className={`text-xs font-medium ${QUALITY_TONE[q]}`}>{contactQualityLabel(q)}</span>
      } },
    { id: 'site', header: 'Site', ...sortable((r) => r.site), size: 130,
      cell: ({ row }) => <span className="text-[var(--text-secondary)]">{row.original.site || 'N/A'}</span> },
    { id: 'status', header: 'Status', ...sortable((r) => statusLabel(r.status)), size: 110,
      cell: ({ row }) => {
        const k = String(row.original.status || '').toLowerCase()
        return <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_CLS[k] || STATUS_CLS.inactive}`}>{statusLabel(row.original.status)}</span>
      } },
    { id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={() => openEdit(r)} className="w-11 h-11 inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`Edit ${r.name || 'customer'}`}><Pencil size={15} /></button>
            <button type="button" onClick={() => setDeleting(r)} className="w-11 h-11 inline-flex items-center justify-center rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 focus-visible:ring-2 focus-visible:ring-red-500" aria-label={`Delete ${r.name || 'customer'}`}><Trash2 size={15} /></button>
          </div>
        )
      } },
  ], [openEdit])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle="Your customer registry: accounts, contacts and classification, country-scoped."
        icon={Building2}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={() => { setEditing(null); setModalOpen(true) }} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing}>
              <Plus size={14} aria-hidden="true" /> New customer
            </button>
          </div>
        }
      />

      {missing && (
        <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">Customer Management is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V158_CUSTOMERS.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && !missing && (
        <Card tone="crit" className="items-start gap-3" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[var(--text-primary)] font-medium">Something went wrong with customers.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </Card>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <Card key={k.label}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              {loading
                ? <div className="h-7 w-12 mt-2 rounded bg-[var(--input-bg)] animate-pulse" />
                : <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>}
              {k.sub && !loading && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.sub}</p>}
            </Card>
          )
        })}
      </div>
      {!loading && (kpiScope.length !== (rows || []).length || truncated) && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">
          {kpiScope.length !== (rows || []).length && (
            <>These figures cover the {kpiScope.length} customer{kpiScope.length === 1 ? '' : 's'} matching your type, site and search filters, of {(rows || []).length}. The status and contact-quality filters are not applied here. </>
          )}
          {truncated && <>Only the newest {READ_LIMIT} customers are loaded.</>}
        </p>
      )}

      {/* Charts */}
      {!loading && !missing && (rows || []).length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader title="Status mix" icon={PieChart} />
            <CardBody style={{ height: '14rem' }}>
              {mix.length
                ? <Doughnut data={statusChart} options={DOUGHNUT_OPTS} role="img" aria-label="Customers by status" />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No status recorded.</div>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Customers by type" icon={BarChart3} />
            <CardBody style={{ height: '14rem' }}>
              {byType.length
                ? <Bar data={typeChart} options={BAR_OPTS} role="img" aria-label="Customers by type" />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No customer types recorded.</div>}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full" placeholder="Search name, contact, email, phone, site" aria-label="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type" disabled={!typeOptions.length}>
            <option value="">All types</option>
            {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="input" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site" disabled={!siteOptions.length}>
            <option value="">All sites</option>
            {siteOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="input" value={qualityFilter} onChange={(e) => setQualityFilter(e.target.value)} aria-label="Contact quality">
            <option value="all">Any contact quality</option>
            {CONTACT_QUALITY.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
          </select>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear
            </button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {(rows || []).length}</span>
        </div>
      </Card>

      {/* Register: the WHOLE filtered set; the table pages and sorts across it. */}
      <Card pad="none" clip>
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={loading}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableSorting
          enableExport={false}
          initialPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyMessage={missing
            ? 'Customer Management is not enabled yet.'
            : (rows || []).length === 0
              ? 'No customers yet. Use "New customer" to add the first account.'
              : 'No customers match these filters.'}
        />
      </Card>

      <CustomerModal
        open={modalOpen}
        initial={editing}
        country={activeCountry}
        typeOptions={typeOptions}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSaved={onSaved}
      />
      <DeleteConfirm customer={deleting} onCancel={() => setDeleting(null)} onConfirm={onDeleted} />
    </div>
  )
}
