/**
 * InsuranceClaims (route /insurance-claims) - Accident & Insurance module.
 *
 * The MANUAL insurance-claims CRUD ledger over the `insurance_claims` table.
 * DISTINCT from /claims-summary (ClaimsSummary.jsx, which analyzes
 * accident-embedded claims on the `accidents` table). Do not merge the two.
 *
 * Tracks insurance claims raised against fleet assets following an accident or
 * incident, through their full lifecycle (open -> submitted -> under_review ->
 * approved / rejected -> settled -> closed). Surfaces a claims analytics
 * dashboard (KPIs, status distribution, monthly trend, insurer performance,
 * delayed/outstanding detection) plus a filterable, searchable, sortable
 * ledger with role-gated create/edit/delete. Real data only, honest empty
 * states throughout.
 *
 * CRUD lives in src/lib/api/insuranceClaims.js; the aggregation/age logic lives
 * in the pure, unit-tested src/lib/insuranceClaimsAnalytics.js (built on the
 * shared primitives in src/lib/insuranceClaims.js).
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
  ShieldAlert, Plus, Search, X, Filter, Pencil, Trash2, Loader2, Save,
  FileSpreadsheet, FileText, AlertTriangle, DollarSign, Inbox, TrendingUp,
  Clock, Percent, Wallet, RefreshCw, ArrowUpDown, ChevronUp, ChevronDown,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  listClaims, createClaim, updateClaim, deleteClaim,
} from '../lib/api/insuranceClaims'
import {
  claimAgeDays, CLAIM_STATUSES, CLAIM_STATUS_META,
} from '../lib/insuranceClaims'
import {
  analyzeInsuranceClaims, outstandingValue,
} from '../lib/insuranceClaimsAnalytics'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
)

// ── Chart theme (matches the app's other chart.js pages) ──────────────────────
const AXIS = { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'rgba(148,163,184,0.12)' } }
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
  plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 12, padding: 10, font: { size: 11 } } }, tooltip: BASE.plugins.tooltip },
}
const DUAL_AXIS = {
  ...BASE,
  interaction: { mode: 'index', intersect: false },
  plugins: { ...BASE.plugins },
  scales: {
    x: AXIS,
    y: { ...AXIS, position: 'left', title: { display: true, text: 'Value', color: '#64748b', font: { size: 10 } } },
    y1: { ...AXIS, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Claims', color: '#64748b', font: { size: 10 } } },
  },
}

// Status -> chart colour (aligned with the badge palette below).
const STATUS_COLOR = {
  open: '#38bdf8', submitted: '#3b82f6', under_review: '#f59e0b',
  approved: '#22c55e', rejected: '#ef4444', settled: '#10b981', slate: '#64748b', closed: '#64748b',
}

const STATUS_STYLES = {
  open:         'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  submitted:    'bg-blue-900/40 text-blue-300 border border-blue-700/50',
  under_review: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  approved:     'bg-green-900/40 text-green-300 border border-green-700/50',
  rejected:     'bg-red-900/40 text-red-300 border border-red-700/50',
  settled:      'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50',
  closed:       'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}

const EMPTY_FORM = {
  claim_no: '', asset_no: '', insurer: '', policy_no: '',
  incident_date: '', claim_date: '', amount_claimed: '', amount_settled: '',
  status: 'open', description: '',
}

const SORTS = {
  claim_no:       (a, b) => String(a.claim_no || '').localeCompare(String(b.claim_no || '')),
  asset_no:       (a, b) => String(a.asset_no || '').localeCompare(String(b.asset_no || '')),
  insurer:        (a, b) => String(a.insurer || '').localeCompare(String(b.insurer || '')),
  incident_date:  (a, b) => new Date(a.incident_date || 0) - new Date(b.incident_date || 0),
  amount_claimed: (a, b) => (Number(a.amount_claimed) || 0) - (Number(b.amount_claimed) || 0),
  amount_settled: (a, b) => (Number(a.amount_settled) || 0) - (Number(b.amount_settled) || 0),
  status:         (a, b) => String(a.status || '').localeCompare(String(b.status || '')),
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

function Kpi({ label, value, sub, icon: Icon, tone = 'text-[var(--text-primary)]', accent = 'text-[var(--text-muted)]' }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={accent} />
      </div>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub != null && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}
function ChartCard({ title, subtitle, children, height = 260, empty }) {
  return (
    <div className="card">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {subtitle && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
      </div>
      {empty ? (
        <div style={{ height }} className="flex flex-col items-center justify-center text-[var(--text-muted)]">
          <Inbox size={22} className="mb-2 opacity-60" />
          <p className="text-sm">{empty}</p>
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </div>
  )
}

export default function InsuranceClaims() {
  const { activeCountry, activeCurrency } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [insurerFilter, setInsurerFilter] = useState('')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [sortKey, setSortKey] = useState('incident_date')
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
      const data = await listClaims({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load insurance claims.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const now = Date.now()

  // Full analysis over the loaded (country-scoped) set - drives KPIs + charts.
  const analysis = useMemo(() => analyzeInsuranceClaims(rows || [], { now }), [rows, now])

  const insurerOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.insurer).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const from = fromDate ? new Date(fromDate).getTime() : null
    const to = toDate ? new Date(toDate).getTime() + 86400000 - 1 : null
    const list = (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (insurerFilter && r.insurer !== insurerFilter) return false
      if (from != null || to != null) {
        const anchor = r.incident_date || r.claim_date || r.created_at
        const t = anchor ? new Date(anchor).getTime() : null
        if (t == null || Number.isNaN(t)) return false
        if (from != null && t < from) return false
        if (to != null && t > to) return false
      }
      if (q) {
        const hay = `${r.claim_no || ''} ${r.asset_no || ''} ${r.insurer || ''} ${r.policy_no || ''} ${r.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const cmp = SORTS[sortKey] || SORTS.incident_date
    const sorted = [...list].sort(cmp)
    if (sortDir === 'desc') sorted.reverse()
    return sorted
  }, [rows, statusFilter, insurerFilter, search, fromDate, toDate, sortKey, sortDir])

  // Analysis of the *filtered* view so the dashboard reflects active filters.
  const viewAnalysis = useMemo(() => analyzeInsuranceClaims(filtered, { now }), [filtered, now])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const SortHead = ({ label, k, align = 'left' }) => (
    <th className={`px-4 py-3 font-semibold whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {sortKey === k ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ArrowUpDown size={11} className="opacity-40" />}
      </button>
    </th>
  )

  // ── Modal handlers ──────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      claim_no: r.claim_no || '', asset_no: r.asset_no || '', insurer: r.insurer || '',
      policy_no: r.policy_no || '', incident_date: r.incident_date || '', claim_date: r.claim_date || '',
      amount_claimed: r.amount_claimed ?? '', amount_settled: r.amount_settled ?? '',
      status: r.status || 'open', description: r.description || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.insurer.trim() && !form.asset_no.trim()) {
      setFormError('Provide an insurer or an asset number.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateClaim(editing.id, payload)
      else await createClaim(payload)
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
      await deleteClaim(deleting.id)
      setDeleting(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the claim.'))
      setDeleting(null)
    }
  }, [deleting, load])

  // ── Export ──────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['claim_no', 'asset_no', 'insurer', 'policy_no', 'incident_date', 'claim_date', 'amount_claimed', 'amount_settled', 'outstanding', 'status', 'ageDays']
  const EXPORT_HEADERS = ['Claim No', 'Asset', 'Insurer', 'Policy', 'Incident', 'Claim Date', 'Claimed', 'Settled', 'Outstanding', 'Status', 'Age (days)']
  const exportRows = filtered.map((r) => ({
    claim_no: r.claim_no || '', asset_no: r.asset_no || '', insurer: r.insurer || '',
    policy_no: r.policy_no || '', incident_date: fmtDate(r.incident_date), claim_date: fmtDate(r.claim_date),
    amount_claimed: r.amount_claimed ?? '', amount_settled: r.amount_settled ?? '',
    outstanding: outstandingValue(r) || '',
    status: CLAIM_STATUS_META[r.status]?.label || r.status, ageDays: claimAgeDays(r, now) ?? '',
  }))

  // ── KPIs (driven by the pure engine over the filtered view) ───────────────────
  const loading = rows === null
  const a = viewAnalysis
  const kpis = [
    { label: 'Total claims', value: loading ? 'N/A' : a.total, sub: `${a.openCount} open`, icon: ShieldAlert, accent: 'text-indigo-400' },
    { label: 'Open claims', value: loading ? 'N/A' : a.openCount, sub: a.avgOpenAgeDays == null ? 'no dated open claims' : `avg age ${a.avgOpenAgeDays}d`, icon: Inbox, accent: 'text-sky-400', tone: 'text-sky-400' },
    { label: 'Total claimed', value: loading ? 'N/A' : money(a.totalClaimed), sub: a.total ? `avg ${money(a.avgClaim)}` : null, icon: DollarSign },
    { label: 'Total settled', value: loading ? 'N/A' : money(a.totalSettled), sub: 'recovered from insurers', icon: TrendingUp, accent: 'text-emerald-400', tone: 'text-emerald-400' },
    { label: 'Recovery rate', value: loading ? 'N/A' : `${a.recoveryRate}%`, sub: 'settled / claimed', icon: Percent, tone: a.recoveryRate >= 70 ? 'text-green-400' : 'text-amber-400', accent: a.recoveryRate >= 70 ? 'text-green-400' : 'text-amber-400' },
    { label: 'Approval rate', value: loading ? 'N/A' : (a.decidedCount ? `${a.approvalRate}%` : 'N/A'), sub: `${a.decidedCount} decided`, icon: ShieldAlert, accent: 'text-blue-400' },
    { label: 'Outstanding', value: loading ? 'N/A' : money(a.outstanding), sub: 'claimed not yet settled', icon: Wallet, tone: a.outstanding > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]', accent: 'text-amber-400' },
    { label: 'Delayed claims', value: loading ? 'N/A' : a.delayedCount, sub: `open > ${a.delayedThresholdDays}d${a.avgSettleDays == null ? '' : ` | settle avg ${a.avgSettleDays}d`}`, icon: Clock, tone: a.delayedCount > 0 ? 'text-red-400' : 'text-[var(--text-primary)]', accent: 'text-red-400' },
  ]

  // ── Chart data ────────────────────────────────────────────────────────────────
  const statusDoughnut = useMemo(() => {
    const entries = CLAIM_STATUSES.map((s) => ({ s, n: a.byStatus[s] || 0 })).filter((e) => e.n > 0)
    return {
      labels: entries.map((e) => CLAIM_STATUS_META[e.s]?.label || e.s),
      datasets: [{ data: entries.map((e) => e.n), backgroundColor: entries.map((e) => STATUS_COLOR[e.s] || '#64748b'), borderWidth: 0 }],
    }
  }, [a.byStatus])
  const statusHasData = statusDoughnut.labels.length > 0

  const trendData = useMemo(() => ({
    labels: a.monthly.map((m) => m.label),
    datasets: [
      { type: 'bar', label: 'Claimed', data: a.monthly.map((m) => m.claimed), backgroundColor: 'rgba(99,102,241,0.55)', yAxisID: 'y', order: 2 },
      { type: 'bar', label: 'Settled', data: a.monthly.map((m) => m.settled), backgroundColor: 'rgba(16,185,129,0.6)', yAxisID: 'y', order: 2 },
      { type: 'line', label: 'Claims', data: a.monthly.map((m) => m.count), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.15)', yAxisID: 'y1', tension: 0.35, fill: false, pointRadius: 2, order: 1 },
    ],
  }), [a.monthly])
  const trendHasData = a.monthly.some((m) => m.count > 0)

  const insurerData = useMemo(() => {
    const top = a.insurers.slice(0, 8)
    return {
      labels: top.map((g) => g.insurer),
      datasets: [
        { label: 'Claimed', data: top.map((g) => g.claimed), backgroundColor: 'rgba(99,102,241,0.6)' },
        { label: 'Settled', data: top.map((g) => g.settled), backgroundColor: 'rgba(16,185,129,0.65)' },
      ],
    }
  }, [a.insurers])
  const insurerHasData = a.insurers.length > 0

  const clearFilters = () => { setStatusFilter('all'); setInsurerFilter(''); setSearch(''); setFromDate(''); setToDate('') }
  const hasFilters = statusFilter !== 'all' || insurerFilter || search || fromDate || toDate

  return (
    <div className="space-y-6">
      <PageHeader
        title="Insurance Claims"
        subtitle="Accident to asset damage to insurer claim to recovery. Track every claim through its lifecycle with claimed vs settled recovery reporting."
        icon={ShieldAlert}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'insurance_claims')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Insurance Claims', 'insurance_claims', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
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
            <p className="text-amber-300 font-medium">Insurance claims are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V134_INSURANCE_CLAIMS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Could not load insurance claims.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0"><RefreshCw size={14} /> Retry</button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <Kpi key={k.label} {...k} />
        ))}
      </div>

      {/* Analytics dashboard */}
      {!missing && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard title="Status distribution" subtitle="Claims by lifecycle stage" empty={loading ? 'Loading...' : !statusHasData ? 'No claims to chart.' : null}>
            <Doughnut data={statusDoughnut} options={DOUGHNUT} />
          </ChartCard>
          <div className="lg:col-span-2">
            <ChartCard title="Monthly trend" subtitle="Claimed and settled value with claim volume, trailing 12 months" empty={loading ? 'Loading...' : !trendHasData ? 'No dated claims to chart.' : null}>
              <Bar data={trendData} options={DUAL_AXIS} />
            </ChartCard>
          </div>
        </div>
      )}

      {!missing && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Insurer performance" subtitle="Claimed vs settled by insurer (top 8)" empty={loading ? 'Loading...' : !insurerHasData ? 'No insurer data yet.' : null}>
            <Bar data={insurerData} options={HORIZONTAL} />
          </ChartCard>

          {/* Delayed / outstanding intelligence */}
          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Delayed and outstanding</h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Open claims aged over {a.delayedThresholdDays} days, highest first</p>
              </div>
              {!loading && a.delayedCount > 0 && (
                <span className="text-[11px] text-amber-300">{money(a.outstandingOpen)} at risk</span>
              )}
            </div>
            {loading ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-8 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
            ) : a.delayed.length === 0 ? (
              <div className="h-[220px] flex flex-col items-center justify-center text-[var(--text-muted)]">
                <ShieldAlert size={22} className="mb-2 opacity-60" />
                <p className="text-sm">No delayed open claims. Nothing overdue.</p>
              </div>
            ) : (
              <div className="max-h-[240px] overflow-y-auto -mx-2">
                <table className="w-full text-sm">
                  <tbody>
                    {a.delayed.slice(0, 12).map((r) => (
                      <tr key={r.id} className="border-b border-[var(--input-border)]/40">
                        <td className="px-2 py-2">
                          <div className="font-mono text-xs text-[var(--text-primary)]">{r.claim_no || r.asset_no || 'N/A'}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">{r.insurer || 'Unassigned'}</div>
                        </td>
                        <td className="px-2 py-2 text-right text-[var(--text-secondary)]">{money(outstandingValue(r))}</td>
                        <td className="px-2 py-2 text-right"><span className="text-red-300 font-medium">{r.ageDays}d</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
            <input className="input pl-9 w-full" placeholder="Search claim no, asset, insurer, policy..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {CLAIM_STATUSES.map((s) => <option key={s} value={s}>{CLAIM_STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={insurerFilter} onChange={(e) => setInsurerFilter(e.target.value)} aria-label="Insurer">
            <option value="">All insurers</option>
            {insurerOptions.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" title="Incident date from" />
            <span className="text-xs text-[var(--text-muted)]">to</span>
            <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" title="Incident date to" />
          </div>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {analysis.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-xs uppercase tracking-wider text-[var(--text-muted)]">
                <SortHead label="Claim No" k="claim_no" />
                <SortHead label="Asset" k="asset_no" />
                <SortHead label="Insurer / Policy" k="insurer" />
                <SortHead label="Incident" k="incident_date" />
                <SortHead label="Claimed" k="amount_claimed" align="right" />
                <SortHead label="Settled" k="amount_settled" align="right" />
                <th className="px-4 py-3 font-semibold whitespace-nowrap text-right">Outstanding</th>
                <th className="px-4 py-3 font-semibold whitespace-nowrap text-left">Age</th>
                <SortHead label="Status" k="status" />
                <th className="px-4 py-3 font-semibold whitespace-nowrap" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={10} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {analysis.total === 0 ? 'No insurance claims yet. Record your first claim.' : 'No claims match these filters.'}
                </td></tr>
              ) : (
                filtered.map((r) => {
                  const age = claimAgeDays(r, now)
                  const out = outstandingValue(r)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.claim_no || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.insurer || 'N/A'}{r.policy_no ? <span className="text-[var(--text-muted)]"> | {r.policy_no}</span> : ''}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.incident_date)}</td>
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)] text-right">{money(r.amount_claimed)}</td>
                      <td className="px-4 py-2.5 text-emerald-400 text-right">{r.amount_settled ? money(r.amount_settled) : 'N/A'}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{out > 0 ? money(out) : 'N/A'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{age == null ? 'N/A' : `${age}d`}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || STATUS_STYLES.open}`}>{CLAIM_STATUS_META[r.status]?.label || r.status}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit claim"><Pencil size={14} /></button>
                          <button onClick={() => setDeleting(r)} className="p-1.5 rounded-lg hover:bg-red-900/40 text-[var(--text-muted)] hover:text-red-300" aria-label="Delete claim"><Trash2 size={14} /></button>
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

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[var(--input-border)] flex items-center justify-between">
              <h2 className="font-bold text-[var(--text-primary)]">{editing ? 'Edit claim' : 'New insurance claim'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label">Claim No</label><input className="input w-full" value={form.claim_no} onChange={(e) => setField('claim_no', e.target.value)} placeholder="CLM-0001" /></div>
                <div><label className="label">Asset No</label><input className="input w-full" value={form.asset_no} onChange={(e) => setField('asset_no', e.target.value)} placeholder="Vehicle / asset" /></div>
                <div><label className="label">Insurer</label><input className="input w-full" value={form.insurer} onChange={(e) => setField('insurer', e.target.value)} placeholder="e.g. Tawuniya" /></div>
                <div><label className="label">Policy No</label><input className="input w-full" value={form.policy_no} onChange={(e) => setField('policy_no', e.target.value)} /></div>
                <div><label className="label">Incident date</label><input type="date" className="input w-full" value={form.incident_date || ''} onChange={(e) => setField('incident_date', e.target.value)} /></div>
                <div><label className="label">Claim date</label><input type="date" className="input w-full" value={form.claim_date || ''} onChange={(e) => setField('claim_date', e.target.value)} /></div>
                <div><label className="label">Amount claimed ({ccy})</label><input type="number" min="0" step="0.01" className="input w-full" value={form.amount_claimed} onChange={(e) => setField('amount_claimed', e.target.value)} /></div>
                <div><label className="label">Amount settled ({ccy})</label><input type="number" min="0" step="0.01" className="input w-full" value={form.amount_settled} onChange={(e) => setField('amount_settled', e.target.value)} /></div>
                <div><label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                    {CLAIM_STATUSES.map((s) => <option key={s} value={s}>{CLAIM_STATUS_META[s]?.label || s}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="label">Description</label>
                <textarea className="input w-full min-h-[90px] resize-y" value={form.description} maxLength={8000} onChange={(e) => setField('description', e.target.value)} placeholder="What happened, damage summary, notes..." />
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
