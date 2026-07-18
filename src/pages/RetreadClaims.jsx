/**
 * RetreadClaims (route /retread-claims) - Safety & Compliance module.
 *
 * Retread warranty / quality claims raised against retread vendors for a
 * specific casing/tyre serial, tracked through the full lifecycle
 * (open, submitted, approved, rejected, settled) with cost-vs-recovered
 * amounts driving fleet recovery, approval and resolution-time KPIs plus
 * vendor accountability.
 *
 * Analytics tab: status distribution, monthly trend and vendor performance
 * ranking over REAL data only (honest empty states, never fabricated). There
 * is no brand column on retread_claims, so no brand chart is shown.
 *
 * CRUD lives in src/lib/api/retreadClaims.js; every KPI/aggregation comes from
 * the pure, unit-tested src/lib/retreadClaimsAnalytics.js so the numbers are
 * computed in exactly one place (page, table, exports).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  Recycle, Plus, Search, X, Filter, Pencil, Trash2, Loader2, Save,
  FileSpreadsheet, FileText, AlertTriangle, DollarSign, Inbox, TrendingUp,
  RotateCw, Percent, Clock, Wallet, Building2, LayoutGrid, BarChart3, ArrowUpDown,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import {
  listRetreadClaims, createRetreadClaim, updateRetreadClaim, deleteRetreadClaim,
} from '../lib/api/retreadClaims'
import {
  analyzeRetreadClaims, computeRetreadKpis,
  RETREAD_CLAIM_STATUSES, RETREAD_CLAIM_STATUS_META,
} from '../lib/retreadClaimsAnalytics'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
)

// ── Chart theme (matches the app's other chart.js pages) ──────────────────────
const AXIS = { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } }
const BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 1, titleColor: '#f8fafc', bodyColor: '#e2e8f0' },
  },
  scales: { x: AXIS, y: AXIS },
}
const NO_LEGEND = { ...BASE, plugins: { ...BASE.plugins, legend: { display: false } } }
const HORIZONTAL = { ...NO_LEGEND, indexAxis: 'y' }
const DOUGHNUT = {
  responsive: true, maintainAspectRatio: false, cutout: '62%',
  plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 12, padding: 12, font: { size: 11 } } }, tooltip: BASE.plugins.tooltip },
}
const DUAL_AXIS = {
  ...BASE,
  plugins: { ...BASE.plugins, legend: { ...BASE.plugins.legend, display: true } },
  scales: {
    x: AXIS,
    y: { ...AXIS, position: 'left', beginAtZero: true, title: { display: true, text: 'Value', color: '#64748b', font: { size: 10 } } },
    y1: { ...AXIS, position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'Claims', color: '#64748b', font: { size: 10 } } },
  },
}

// Status -> chart hue (semantic ladder, deliberately fixed).
const STATUS_HUE = {
  open: '#38bdf8', submitted: '#3b82f6', approved: '#22c55e', rejected: '#ef4444', settled: '#10b981',
}

const STATUS_STYLES = {
  open:      'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  submitted: 'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  approved:  'bg-green-900/40 text-green-300 border border-green-700/50',
  rejected:  'bg-red-900/40 text-red-300 border border-red-700/50',
  settled:   'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
}

const EMPTY_FORM = {
  claim_no: '', tyre_serial: '', asset_no: '', vendor: '', reason: '',
  claim_date: '', cost: '', amount_recovered: '', status: 'open', notes: '',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 10)
}
function dayKey(v) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

// Sortable table columns: key + accessor.
const SORTS = {
  claim_no: (r) => (r.claim_no || '').toLowerCase(),
  tyre_serial: (r) => (r.tyre_serial || '').toLowerCase(),
  vendor: (r) => (r.vendor || '').toLowerCase(),
  claim_date: (r) => dayKey(r.claim_date),
  cost: (r) => Number(r.cost) || 0,
  amount_recovered: (r) => Number(r.amount_recovered) || 0,
  status: (r) => RETREAD_CLAIM_STATUSES.indexOf(r.status),
}

export default function RetreadClaims() {
  const { activeCountry, activeCurrency } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [tab, setTab] = useState('register') // register | analytics
  const [statusFilter, setStatusFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [sortKey, setSortKey] = useState('claim_date')
  const [sortDir, setSortDir] = useState('desc')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleting, setDeleting] = useState(null)

  const ccy = activeCurrency || 'SAR'
  const money = useCallback((v) => (v == null || v === '' ? 'N/A' : formatCurrencyCompact(v, ccy)), [ccy])

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listRetreadClaims({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load retread claims.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const vendorOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.vendor).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (vendorFilter && r.vendor !== vendorFilter) return false
      const dk = dayKey(r.claim_date)
      if (fromDate && (!dk || dk < fromDate)) return false
      if (toDate && (!dk || dk > toDate)) return false
      if (q) {
        const hay = `${r.claim_no || ''} ${r.tyre_serial || ''} ${r.asset_no || ''} ${r.vendor || ''} ${r.reason || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const accessor = SORTS[sortKey] || SORTS.claim_date
    const dir = sortDir === 'asc' ? 1 : -1
    return [...out].sort((a, b) => {
      const av = accessor(a); const bv = accessor(b)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [rows, statusFilter, vendorFilter, search, fromDate, toDate, sortKey, sortDir])

  // Analytics computed from the SAME filtered set so charts follow the filters.
  const analytics = useMemo(() => analyzeRetreadClaims(filtered, { vendorLimit: 8 }), [filtered])
  const summary = useMemo(() => computeRetreadKpis(rows || []), [rows])
  const k = analytics.kpis

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'claim_date' || key === 'cost' || key === 'amount_recovered' ? 'desc' : 'asc') }
  }

  // ── Modal handlers ──────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      claim_no: r.claim_no || '', tyre_serial: r.tyre_serial || '', asset_no: r.asset_no || '',
      vendor: r.vendor || '', reason: r.reason || '', claim_date: r.claim_date || '',
      cost: r.cost ?? '', amount_recovered: r.amount_recovered ?? '',
      status: r.status || 'open', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const setField = (k2, v) => setForm((f) => ({ ...f, [k2]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.vendor.trim() && !form.tyre_serial.trim()) {
      setFormError('Provide a vendor or a tyre serial.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateRetreadClaim(editing.id, payload)
      else await createRetreadClaim(payload)
      setModalOpen(false)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the claim.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const confirmDelete = useCallback(async () => {
    if (!deleting) return
    try {
      await deleteRetreadClaim(deleting.id)
      setDeleting(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the claim.'))
      setDeleting(null)
    }
  }, [deleting, load])

  // ── Export ────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['claim_no', 'tyre_serial', 'asset_no', 'vendor', 'reason', 'claim_date', 'cost', 'amount_recovered', 'status']
  const EXPORT_HEADERS = ['Claim No', 'Tyre Serial', 'Asset', 'Vendor', 'Reason', 'Claim Date', 'Cost', 'Recovered', 'Status']
  const exportRows = filtered.map((r) => ({
    claim_no: r.claim_no || '', tyre_serial: r.tyre_serial || '', asset_no: r.asset_no || '',
    vendor: r.vendor || '', reason: r.reason || '', claim_date: fmtDate(r.claim_date),
    cost: r.cost ?? '', amount_recovered: r.amount_recovered ?? '',
    status: RETREAD_CLAIM_STATUS_META[r.status]?.label || r.status,
  }))

  const kpis = [
    { label: 'Total claims', value: k.total, sub: `${k.openCount} open`, icon: LayoutGrid, tone: 'text-[var(--text-primary)]', accent: 'text-indigo-400' },
    { label: 'Open exposure', value: rows === null ? 'N/A' : money(k.openExposure), sub: 'cost of live claims', icon: Inbox, tone: 'text-sky-400', accent: 'text-sky-400' },
    { label: 'Approval rate', value: rows === null ? 'N/A' : (k.approvalRate == null ? 'N/A' : `${k.approvalRate}%`), sub: `${k.decidedCount} decided`, icon: Percent, tone: k.approvalRate != null && k.approvalRate >= 60 ? 'text-green-400' : 'text-amber-400', accent: 'text-amber-400' },
    { label: 'Value claimed', value: rows === null ? 'N/A' : money(k.totalClaimed), sub: 'gross exposure', icon: DollarSign, tone: 'text-[var(--text-primary)]', accent: 'text-[var(--text-muted)]' },
    { label: 'Recovered', value: rows === null ? 'N/A' : money(k.totalRecovered), sub: rows === null ? '' : `${k.recoveryRate}% recovery`, icon: TrendingUp, tone: 'text-emerald-400', accent: 'text-emerald-400' },
    { label: 'Avg resolution', value: rows === null ? 'N/A' : (k.avgResolutionDays == null ? 'N/A' : `${k.avgResolutionDays}d`), sub: `${k.resolvedCount} resolved`, icon: Clock, tone: 'text-[var(--text-primary)]', accent: 'text-violet-400' },
  ]

  const clearFilters = () => { setStatusFilter('all'); setVendorFilter(''); setSearch(''); setFromDate(''); setToDate('') }
  const hasFilters = statusFilter !== 'all' || vendorFilter || search || fromDate || toDate

  // ── Chart datasets (from analytics; guarded by hasData) ──────────────────────
  const hasData = filtered.length > 0
  const statusChart = {
    labels: analytics.statuses.map((s) => s.label),
    datasets: [{
      data: analytics.statuses.map((s) => s.count),
      backgroundColor: analytics.statuses.map((s) => STATUS_HUE[s.status] || '#64748b'),
      borderColor: 'rgba(15,23,42,0.6)', borderWidth: 1,
    }],
  }
  const trendChart = {
    labels: analytics.trend.map((t) => t.label),
    datasets: [
      { type: 'bar', label: 'Claims', data: analytics.trend.map((t) => t.claims), backgroundColor: 'rgba(99,102,241,0.55)', borderColor: '#6366f1', borderWidth: 1, yAxisID: 'y1', order: 2 },
      { type: 'line', label: 'Cost', data: analytics.trend.map((t) => t.cost), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.15)', tension: 0.3, fill: true, yAxisID: 'y', order: 1, pointRadius: 2 },
      { type: 'line', label: 'Recovered', data: analytics.trend.map((t) => t.recovered), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.12)', tension: 0.3, fill: true, yAxisID: 'y', order: 0, pointRadius: 2 },
    ],
  }
  const vendorCostChart = {
    labels: analytics.vendors.map((v) => v.key),
    datasets: [
      { label: 'Cost', data: analytics.vendors.map((v) => v.cost), backgroundColor: 'rgba(99,102,241,0.6)', borderColor: '#6366f1', borderWidth: 1 },
      { label: 'Recovered', data: analytics.vendors.map((v) => v.recovered), backgroundColor: 'rgba(16,185,129,0.6)', borderColor: '#10b981', borderWidth: 1 },
    ],
  }

  const SortTh = ({ col, children, right }) => (
    <th className={`px-4 py-3 font-semibold whitespace-nowrap ${right ? 'text-right' : ''}`}>
      <button onClick={() => toggleSort(col)} className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${sortKey === col ? 'text-[var(--text-primary)]' : ''}`}>
        {children}
        <ArrowUpDown size={12} className={sortKey === col ? 'opacity-100' : 'opacity-40'} />
      </button>
    </th>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Retread Claims"
        subtitle="Retread warranty & quality claims raised against retread vendors. Casing serial, vendor, reason, cost and recovery, tracked through the full lifecycle."
        icon={Recycle}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'retread_claims')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((c, i) => ({ key: c, header: EXPORT_HEADERS[i] })), 'Retread Claims', 'retread_claims', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New claim
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Retread claims are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V145_RETREAD_CLAIMS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Could not load retread claims.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0"><RotateCw size={14} /> Retry</button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon
          return (
            <div key={kpi.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{kpi.label}</p>
                <Icon size={16} className={kpi.accent} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${kpi.tone}`}>{kpi.value}</p>
              {kpi.sub ? <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{kpi.sub}</p> : null}
            </div>
          )
        })}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[var(--input-border)]">
        {[{ id: 'register', label: 'Register', icon: Filter }, { id: 'analytics', label: 'Analytics', icon: BarChart3 }].map((t) => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${tab === t.id ? 'border-[var(--brand)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* Shared filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search claim no, serial, asset, vendor, reason..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {RETREAD_CLAIM_STATUSES.map((s) => <option key={s} value={s}>{RETREAD_CLAIM_STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} aria-label="Vendor">
            <option value="">All vendors</option>
            {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" title="Claim date from" />
          <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" title="Claim date to" />
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {tab === 'analytics' ? (
        <div className="space-y-4">
          {rows === null ? (
            <div className="card h-64 animate-pulse" />
          ) : !hasData ? (
            <div className="card py-16 text-center text-[var(--text-muted)]">
              <BarChart3 size={26} className="mx-auto mb-2 opacity-60" />
              {summary.total === 0 ? 'No retread claims yet. Record a claim to build vendor and recovery analytics.' : 'No claims match these filters.'}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Status distribution</h3>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Where the {filtered.length} claims sit in the lifecycle.</p>
                  </div>
                  <div style={{ height: 260 }}><Doughnut data={statusChart} options={DOUGHNUT} /></div>
                </div>
                <div className="card">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Monthly trend (12 months)</h3>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Claims raised vs cost and recovered value.</p>
                  </div>
                  <div style={{ height: 260 }}><Bar data={trendChart} options={DUAL_AXIS} /></div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Vendor exposure vs recovery</h3>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Top vendors by claim value ({ccy}).</p>
                  </div>
                  <div style={{ height: 300 }}><Bar data={vendorCostChart} options={HORIZONTAL} /></div>
                </div>
                <div className="card overflow-hidden !p-0">
                  <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
                    <Building2 size={15} className="text-indigo-400" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Vendor performance</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                          {['Vendor', 'Claims', 'Cost', 'Recovered', 'Recovery', 'Approval'].map((h, i) => <th key={h} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.vendors.map((v) => (
                          <tr key={v.key} className="border-b border-[var(--input-border)]/50">
                            <td className="px-3 py-2.5 text-[var(--text-secondary)] max-w-[160px] truncate" title={v.key}>{v.key}</td>
                            <td className="px-3 py-2.5 text-right text-[var(--text-primary)]">{v.claims}</td>
                            <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">{money(v.cost)}</td>
                            <td className="px-3 py-2.5 text-right text-emerald-400">{v.recovered ? money(v.recovered) : 'N/A'}</td>
                            <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">{v.recoveryPct}%</td>
                            <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">{v.approvalRate == null ? 'N/A' : `${v.approvalRate}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        /* Register table */
        <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  <SortTh col="claim_no">Claim No</SortTh>
                  <SortTh col="tyre_serial">Tyre Serial</SortTh>
                  <SortTh col="vendor">Vendor</SortTh>
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">Reason</th>
                  <SortTh col="claim_date">Claim Date</SortTh>
                  <SortTh col="cost" right>Cost</SortTh>
                  <SortTh col="amount_recovered" right>Recovered</SortTh>
                  <SortTh col="status">Status</SortTh>
                  <th className="px-4 py-3 font-semibold whitespace-nowrap"></th>
                </tr>
              </thead>
              <tbody>
                {rows === null ? (
                  [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    <Filter size={22} className="mx-auto mb-2 opacity-60" />
                    {summary.total === 0 ? 'No retread claims yet. Record your first claim.' : 'No claims match these filters.'}
                  </td></tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.claim_no || 'N/A'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.tyre_serial || 'N/A'}{r.asset_no ? <span className="text-[var(--text-muted)]"> | {r.asset_no}</span> : ''}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.vendor || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[220px] truncate" title={r.reason || ''}>{r.reason || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.claim_date)}</td>
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)] text-right">{money(r.cost)}</td>
                      <td className="px-4 py-2.5 text-emerald-400 text-right">{r.amount_recovered ? money(r.amount_recovered) : 'N/A'}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || STATUS_STYLES.open}`}>{RETREAD_CLAIM_STATUS_META[r.status]?.label || r.status}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit claim"><Pencil size={14} /></button>
                          <button onClick={() => setDeleting(r)} className="p-1.5 rounded-lg hover:bg-red-900/40 text-[var(--text-muted)] hover:text-red-300" aria-label="Delete claim"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[var(--input-border)] flex items-center justify-between">
              <h2 className="font-bold text-[var(--text-primary)]">{editing ? 'Edit claim' : 'New retread claim'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label">Claim No</label><input className="input w-full" value={form.claim_no} onChange={(e) => setField('claim_no', e.target.value)} placeholder="RTC-0001" /></div>
                <div><label className="label">Tyre Serial</label><input className="input w-full" value={form.tyre_serial} onChange={(e) => setField('tyre_serial', e.target.value)} placeholder="Casing / tyre serial" /></div>
                <div><label className="label">Asset No</label><input className="input w-full" value={form.asset_no} onChange={(e) => setField('asset_no', e.target.value)} placeholder="Vehicle / asset" /></div>
                <div><label className="label">Vendor</label><input className="input w-full" value={form.vendor} onChange={(e) => setField('vendor', e.target.value)} placeholder="Retread vendor" /></div>
                <div><label className="label">Claim date</label><input type="date" className="input w-full" value={form.claim_date || ''} onChange={(e) => setField('claim_date', e.target.value)} /></div>
                <div><label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                    {RETREAD_CLAIM_STATUSES.map((s) => <option key={s} value={s}>{RETREAD_CLAIM_STATUS_META[s]?.label || s}</option>)}
                  </select>
                </div>
                <div><label className="label">Cost ({ccy})</label><input type="number" min="0" step="0.01" className="input w-full" value={form.cost} onChange={(e) => setField('cost', e.target.value)} /></div>
                <div><label className="label">Amount recovered ({ccy})</label><input type="number" min="0" step="0.01" className="input w-full" value={form.amount_recovered} onChange={(e) => setField('amount_recovered', e.target.value)} /></div>
              </div>
              <div><label className="label">Reason</label>
                <textarea className="input w-full min-h-[70px] resize-y" value={form.reason} maxLength={8000} onChange={(e) => setField('reason', e.target.value)} placeholder="Claim reason: separation, defect, premature failure..." />
              </div>
              <div><label className="label">Notes</label>
                <textarea className="input w-full min-h-[70px] resize-y" value={form.notes} maxLength={8000} onChange={(e) => setField('notes', e.target.value)} placeholder="Vendor response, resolution notes..." />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving...' : editing ? 'Save changes' : 'Create claim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleting && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setDeleting(null)}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="font-bold text-[var(--text-primary)]">Delete claim?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {deleting.claim_no ? <span className="font-mono text-[var(--text-secondary)]">{deleting.claim_no}</span> : 'This claim'} will be permanently removed. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={confirmDelete} className="btn-primary text-sm bg-red-600 hover:bg-red-500 inline-flex items-center gap-1.5"><Trash2 size={14} /> Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
