/**
 * PolicyManagement (route /policies) - manage fleet policies & SOPs and the
 * insurance/governance documents covering the fleet: title, category (coverage
 * type), version, owner (responsible party), effective/renewal (review) dates
 * and a status lifecycle. Backed by the `policies` table (V137). Any
 * authenticated member reads; Admin/Manager/Director author and maintain.
 *
 * Deepened to a portfolio dashboard: status distribution, renewal/expiry bands,
 * a 12-month renewal pipeline, coverage-type and insurer/owner breakdowns, and
 * a premium roll-up shown ONLY where a premium is actually recorded (honest N/A
 * otherwise, never fabricated). Search + status/coverage/expiry/date filters, a
 * sortable table (soonest renewal first) with traffic-light badges, role-gated
 * CRUD, Excel/PDF export, and full loading / error+Retry / empty states.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ScrollText, Plus, Pencil, Trash2, Search, X, Filter, FileSpreadsheet,
  FileText, AlertTriangle, Loader2, CheckCircle2, ClipboardList, CalendarClock,
  CalendarX, Archive, Save, ShieldCheck, Wallet, Layers, ArrowUpDown, RefreshCw,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listPolicies, createPolicy, updatePolicy, deletePolicy,
} from '../lib/api/policies'
import {
  POLICY_STATUSES, POLICY_STATUS_META,
} from '../lib/policies'
import {
  summarizePolicyPortfolio, filterPolicies, sortByExpiry, policyExpiry,
  policyPremium, EXPIRY_BANDS, DEFAULT_WARN_DAYS,
} from '../lib/policyAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { formatCurrency } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { categorical, withAlpha, ACCENTS } from '../lib/reportColors'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const STATUS_STYLES = {
  draft: 'bg-slate-700/40 text-slate-300 border border-slate-600/50',
  active: 'bg-green-900/40 text-green-300 border border-green-700/50',
  under_review: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  archived: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
// Traffic-light styling for the renewal/expiry band.
const BAND_STYLES = {
  expired: 'bg-red-900/40 text-red-300 border border-red-700/50',
  expiring: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  valid: 'bg-green-900/40 text-green-300 border border-green-700/50',
  none: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const BAND_LABEL = {
  expired: 'Expired', expiring: 'Expiring', valid: 'Valid', none: 'No date',
}
const EMPTY_FORM = {
  title: '', category: '', version: '', owner: '',
  effective_date: '', review_date: '', status: 'draft', body: '', notes: '',
}
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { enabled: true },
  },
  scales: {
    x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 11 } } },
    y: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', precision: 0 }, beginAtZero: true },
  },
}
const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: {
    legend: { position: 'bottom', labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 } } },
    tooltip: { enabled: true },
  },
}

// -- Create / edit modal -------------------------------------------------------
function PolicyModal({ open, existing, onClose, onSaved }) {
  const { activeCountry } = useSettings() || {}
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    if (existing) {
      setForm({
        title: existing.title || '', category: existing.category || '',
        version: existing.version || '', owner: existing.owner || '',
        effective_date: existing.effective_date || '', review_date: existing.review_date || '',
        status: existing.status || 'draft', body: existing.body || '', notes: existing.notes || '',
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setError('')
  }, [open, existing])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.title.trim()) { setError('A policy title is required.'); return }
    setBusy(true)
    try {
      const payload = {
        ...form,
        title: form.title.trim(),
        category: form.category.trim() || null,
        version: form.version.trim() || null,
        owner: form.owner.trim() || null,
        effective_date: form.effective_date || null,
        review_date: form.review_date || null,
        body: form.body.trim() || null,
        notes: form.notes.trim() || null,
      }
      if (existing) {
        await updatePolicy(existing.id, payload)
      } else {
        const country = activeCountry && activeCountry !== 'All' ? activeCountry : null
        await createPolicy({ ...payload, country })
      }
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the policy. Please try again.'))
    } finally {
      setBusy(false)
    }
  }, [form, existing, activeCountry, onSaved, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-10">
      <div className="w-full max-w-2xl card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {existing ? 'Edit policy' : 'New policy'}
          </h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Title *</label>
            <input className="input w-full" placeholder="e.g. Fleet Third-Party Liability Cover" value={form.title} maxLength={300} onChange={(e) => set('title', e.target.value)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Coverage type / category</label>
              <input className="input w-full" placeholder="e.g. Motor, Liability, Cargo" value={form.category} maxLength={120} onChange={(e) => set('category', e.target.value)} />
            </div>
            <div>
              <label className="label">Version</label>
              <input className="input w-full" placeholder="e.g. 1.0" value={form.version} maxLength={60} onChange={(e) => set('version', e.target.value)} />
            </div>
            <div>
              <label className="label">Owner / responsible party</label>
              <input className="input w-full" placeholder="e.g. Fleet Ops, Insurer" value={form.owner} maxLength={160} onChange={(e) => set('owner', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {POLICY_STATUSES.map((s) => <option key={s} value={s}>{POLICY_STATUS_META[s]?.label || s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Effective date</label>
              <input type="date" className="input w-full" value={form.effective_date || ''} onChange={(e) => set('effective_date', e.target.value)} />
            </div>
            <div>
              <label className="label">Renewal / review date</label>
              <input type="date" className="input w-full" value={form.review_date || ''} onChange={(e) => set('review_date', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Body</label>
            <textarea className="input w-full min-h-[120px] resize-y" placeholder="Coverage scope, terms and requirements..." value={form.body} maxLength={20000} onChange={(e) => set('body', e.target.value)} />
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full min-h-[70px] resize-y" placeholder="Internal notes, references..." value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
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
              {busy ? 'Saving...' : existing ? 'Update policy' : 'Create policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// -- Delete confirm ------------------------------------------------------------
function DeleteConfirm({ policy, onCancel, onConfirm, busy }) {
  if (!policy) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md card space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-900/30 border border-red-800/50 flex items-center justify-center shrink-0">
            <Trash2 size={18} className="text-red-400" />
          </div>
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">Delete policy?</h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              "{policy.title}" will be permanently removed. This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 !bg-red-600 hover:!bg-red-500 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// -- Small chart card ----------------------------------------------------------
function ChartCard({ title, icon: Icon, children, empty }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={15} className="text-[var(--text-muted)]" />}
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      </div>
      {empty ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-[var(--text-muted)]">
          No data yet.
        </div>
      ) : (
        <div className="h-[240px]">{children}</div>
      )}
    </div>
  )
}

// -- Page ----------------------------------------------------------------------
export default function PolicyManagement() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [bandFilter, setBandFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')
  const [sortDir, setSortDir] = useState('asc') // soonest renewal first

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listPolicies({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load policies.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const now = Date.now()
  const portfolio = useMemo(() => summarizePolicyPortfolio(rows || [], now), [rows, now])

  const categoryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.category).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const list = filterPolicies(rows || [], {
      status: statusFilter, category: categoryFilter, band: bandFilter,
      from: fromDate, to: toDate, search,
    }, now)
    return sortByExpiry(list, sortDir)
  }, [rows, statusFilter, categoryFilter, bandFilter, fromDate, toDate, search, sortDir, now])

  const clearFilters = () => {
    setStatusFilter('all'); setCategoryFilter(''); setBandFilter('all')
    setFromDate(''); setToDate(''); setSearch('')
  }
  const hasFilters = statusFilter !== 'all' || categoryFilter || bandFilter !== 'all' || fromDate || toDate || search

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (p) => { setEditing(p); setModalOpen(true) }

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await deletePolicy(deleting.id)
      setDeleting(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the policy.'))
    } finally {
      setDeleteBusy(false)
    }
  }, [deleting, load])

  // -- charts (real data only) --
  const statusChart = useMemo(() => {
    const items = portfolio.status.list.filter((x) => x.count > 0)
    return {
      empty: items.length === 0,
      data: {
        labels: items.map((x) => x.label),
        datasets: [{ data: items.map((x) => x.count), backgroundColor: categorical(items.length), borderWidth: 0 }],
      },
    }
  }, [portfolio])

  const pipelineChart = useMemo(() => {
    const b = portfolio.pipeline.buckets
    const total = b.reduce((a, x) => a + x.count, 0) + portfolio.pipeline.overdue
    return {
      empty: total === 0,
      data: {
        labels: b.map((x) => x.label),
        datasets: [{ label: 'Renewals', data: b.map((x) => x.count), backgroundColor: withAlpha(ACCENTS.primary, 0.85), borderRadius: 4 }],
      },
    }
  }, [portfolio])

  // Premium-by-insurer only where at least one row carries a premium AND an
  // insurer; otherwise fall back to policy count by coverage type (real data).
  const insurerChart = useMemo(() => {
    const src = portfolio.hasInsurer ? portfolio.insurers : portfolio.coverage
    const withPrem = src.filter((x) => x.premium != null)
    const usePremium = withPrem.length > 0
    const items = (usePremium ? withPrem : src).filter((x) => x.key !== 'Unspecified').slice(0, 8)
    return {
      title: portfolio.hasInsurer
        ? (usePremium ? 'Premium by insurer' : 'Policies by insurer')
        : (usePremium ? 'Premium by coverage type' : 'Policies by coverage type'),
      usePremium,
      empty: items.length === 0,
      data: {
        labels: items.map((x) => x.key),
        datasets: [{
          label: usePremium ? 'Premium' : 'Policies',
          data: items.map((x) => (usePremium ? x.premium : x.count)),
          backgroundColor: categorical(items.length),
          borderRadius: 4,
        }],
      },
    }
  }, [portfolio])

  // -- export --
  const EXPORT_COLS = ['title', 'category', 'version', 'owner', 'status', 'expiry', 'effective_date', 'review_date', 'premium']
  const EXPORT_HEADERS = ['Title', 'Coverage type', 'Version', 'Owner', 'Status', 'Renewal', 'Effective', 'Renewal date', 'Premium']
  const exportRows = filtered.map((r) => {
    const prem = policyPremium(r)
    return {
      title: r.title || '', category: r.category || '', version: r.version || '',
      owner: r.owner || '', status: POLICY_STATUS_META[r.status]?.label || r.status || '',
      expiry: BAND_LABEL[policyExpiry(r, now).band] || '',
      effective_date: r.effective_date || '', review_date: r.review_date || '',
      premium: prem == null ? 'N/A' : String(prem),
    }
  })

  const premiumKpi = portfolio.kpis.premiumTotal == null
    ? 'N/A'
    : formatCurrency(portfolio.kpis.premiumTotal, activeCurrency || 'SAR', 0)

  const kpis = [
    { label: 'Total policies', value: portfolio.total, icon: ClipboardList, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: portfolio.kpis.active, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Expiring soon', value: portfolio.kpis.expiringSoon, icon: CalendarClock, tone: 'text-amber-400', hint: `<= ${DEFAULT_WARN_DAYS}d` },
    { label: 'Expired', value: portfolio.kpis.expired, icon: CalendarX, tone: 'text-red-400' },
    { label: 'Under review', value: portfolio.kpis.underReview, icon: ShieldCheck, tone: 'text-amber-300' },
    { label: 'Coverage types', value: portfolio.kpis.coverageTypes, icon: Layers, tone: 'text-[var(--text-primary)]' },
    { label: 'Archived', value: portfolio.kpis.archived, icon: Archive, tone: 'text-[var(--text-muted)]' },
    { label: 'Total premium', value: premiumKpi, icon: Wallet, tone: 'text-[var(--text-primary)]', isText: true, hint: portfolio.premium.hasAny ? `${portfolio.premium.present} recorded` : 'not recorded' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Policy Management"
        subtitle="Fleet insurance & governance policies - coverage, ownership, renewals and premium tracked in one register."
        icon={ScrollText}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, reportFileName('Policies'))} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Policy Management', reportFileName('Policies'), 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New policy
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Policy management isn't enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V137_POLICIES.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && !missing && (
        <div className="card border border-red-800/50 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div><p className="text-red-300 font-medium">Couldn't load policies.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          </div>
          <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0"><RefreshCw size={14} /> Retry</button>
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
              <p className={`${k.isText ? 'text-2xl' : 'text-3xl'} font-bold mt-1 ${k.tone}`}>
                {rows === null ? '...' : k.value}
              </p>
              {k.hint && rows !== null && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{k.hint}</p>}
            </div>
          )
        })}
      </div>

      {/* Charts */}
      {rows !== null && rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard title="Status distribution" icon={ClipboardList} empty={statusChart.empty}>
            <Doughnut data={statusChart.data} options={DOUGHNUT_OPTS} />
          </ChartCard>
          <ChartCard title="Renewal pipeline (next 12 months)" icon={CalendarClock} empty={pipelineChart.empty}>
            <Bar data={pipelineChart.data} options={CHART_OPTS} />
          </ChartCard>
          <ChartCard title={insurerChart.title} icon={Wallet} empty={insurerChart.empty}>
            <Bar data={insurerChart.data} options={CHART_OPTS} />
          </ChartCard>
        </div>
      )}

      {portfolio.pipeline.overdue > 0 && (
        <div className="card border border-red-800/40 flex items-center gap-2 text-sm">
          <CalendarX size={16} className="text-red-400 shrink-0" />
          <span className="text-[var(--text-secondary)]">
            <span className="font-semibold text-red-300">{portfolio.pipeline.overdue}</span> policy renewal{portfolio.pipeline.overdue === 1 ? '' : 's'} already overdue.
          </span>
          <button onClick={() => { setBandFilter('expired'); setStatusFilter('all') }} className="ml-auto btn-secondary text-xs">Show overdue</button>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search title, coverage, owner, insurer, version..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {POLICY_STATUSES.map((s) => <option key={s} value={s}>{POLICY_STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)} aria-label="Renewal band">
            <option value="all">All renewals</option>
            {EXPIRY_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Coverage type">
            <option value="">All coverage types</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {portfolio.total}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--text-muted)]">Renewal from</label>
          <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="Renewal from" />
          <label className="text-xs text-[var(--text-muted)]">to</label>
          <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="Renewal to" />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Title</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Coverage type</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Version</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Owner</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Effective</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">
                  <button onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]" title="Sort by renewal date">
                    Renewal <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap">Status</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {rows.length === 0 && !missing ? (
                    <><ScrollText size={24} className="mx-auto mb-2 opacity-60" />No policies yet. Create your first fleet policy or coverage record.</>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No policies match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.map((r) => {
                  const e = policyExpiry(r, now)
                  return (
                    <tr key={r.id} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 ${e.expired ? 'bg-red-900/10' : e.expiringSoon ? 'bg-amber-900/10' : ''}`}>
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.title}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.category || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.version || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.owner || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.effective_date)}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span className="text-[var(--text-secondary)]">{fmtDate(r.review_date)}</span>
                          {e.hasDate && r.status !== 'archived' && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${BAND_STYLES[e.band]}`}>{BAND_LABEL[e.band]}</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || STATUS_STYLES.draft}`}>{POLICY_STATUS_META[r.status]?.label || r.status}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit policy"><Pencil size={14} /></button>
                          <button onClick={() => setDeleting(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-300" aria-label="Delete policy"><Trash2 size={14} /></button>
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

      <PolicyModal open={modalOpen} existing={editing} onClose={() => setModalOpen(false)} onSaved={load} />
      <DeleteConfirm policy={deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} busy={deleteBusy} />
    </div>
  )
}
