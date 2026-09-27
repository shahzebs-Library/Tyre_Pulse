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
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  ShieldAlert, Plus, Search, X, Filter, Pencil, Trash2, Loader2, Save,
  FileSpreadsheet, FileText, AlertTriangle, DollarSign, Inbox, TrendingUp,
  Clock, Percent, Wallet, RefreshCw, LayoutGrid, ListChecks, Building2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  listClaims, createClaim, updateClaim, deleteClaim,
} from '../lib/api/insuranceClaims'
import { CLAIM_STATUSES, CLAIM_STATUS_META } from '../lib/insuranceClaims'
import {
  analyzeInsuranceClaims, outstandingValue, filterInsuranceClaims,
  insuranceClaimRow, headlineRates, insurerRows,
} from '../lib/insuranceClaimsAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { compareValues, sortRows } from '../lib/consoleTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
)

// ── Chart theme: token colours so both light and dark modes stay legible ──────
const INK = 'var(--text-muted)'
const AXIS = { ticks: { color: INK, font: { size: 11 } }, grid: { color: 'var(--panel-2)' } }
const BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: INK, boxWidth: 12, font: { size: 11 } } } },
  scales: { x: AXIS, y: AXIS },
}
const HORIZONTAL = { ...BASE, indexAxis: 'y' }
const DOUGHNUT = {
  responsive: true, maintainAspectRatio: false, cutout: '62%',
  plugins: { legend: { position: 'bottom', labels: { color: INK, boxWidth: 12, padding: 10, font: { size: 11 } } } },
}
const DUAL_AXIS = {
  ...BASE,
  interaction: { mode: 'index', intersect: false },
  scales: {
    x: AXIS,
    y: { ...AXIS, position: 'left', beginAtZero: true, title: { display: true, text: 'Value', color: INK, font: { size: 10 } } },
    y1: { ...AXIS, position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'Claims', color: INK, font: { size: 10 } } },
  },
}

// Status -> chart colour. Semantic (the colour carries meaning), aligned with
// the badge palette below; the label is always printed beside it.
const STATUS_COLOR = {
  open: '#38bdf8', submitted: '#3b82f6', under_review: '#f59e0b',
  approved: '#22c55e', rejected: '#ef4444', settled: '#10b981', closed: '#64748b',
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

const EXPORT_COLS = ['claim_no', 'asset_no', 'insurer', 'policy_no', 'incident_date', 'claim_date', 'amount_claimed', 'amount_settled', 'outstanding', 'status', 'ageDays']
const EXPORT_HEADERS = ['Claim No', 'Asset', 'Insurer', 'Policy', 'Incident', 'Claim Date', 'Claimed', 'Settled', 'Outstanding', 'Status', 'Age (days)']

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blankToUndef = (v) => (v === null || v === undefined || v === '' ? undefined : v)

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 10)
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'register', label: 'Claims register', icon: ListChecks },
  { id: 'insurers', label: 'Insurers', icon: Building2 },
]
const TAB_IDS = TABS.map((t) => t.id)

/** Accessible tab strip synced to ?tab= (arrow keys move between tabs). */
function PageTabs({ tab, onChange }) {
  const refs = useRef([])
  const onKey = (e, i) => {
    let next = null
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next == null) return
    e.preventDefault()
    onChange(TABS[next].id)
    refs.current[next]?.focus()
  }
  return (
    <div role="tablist" aria-label="Insurance claims views" className="flex flex-wrap gap-1 border-b border-[var(--border-bright)]">
      {TABS.map((t, i) => {
        const Icon = t.icon
        const active = tab === t.id
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            id={`ic-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`ic-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`inline-flex items-center gap-1.5 px-4 min-h-[44px] text-sm font-medium border-b-2 -mb-px rounded-t-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#16a34a)] ${active ? 'border-[var(--accent,#16a34a)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
          >
            <Icon size={15} aria-hidden="true" /> {t.label}
          </button>
        )
      })}
    </div>
  )
}

function Kpi({ label, value, sub, icon: Icon, tone = 'text-[var(--text-primary)]', accent = 'text-[var(--text-muted)]' }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={accent} aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub != null && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </Card>
  )
}

function ChartCard({ title, subtitle, children, height = 260, empty, summary }) {
  return (
    <Card>
      <CardHeader title={title} description={subtitle} />
      {empty ? (
        <div style={{ height }} className="flex flex-col items-center justify-center text-[var(--text-muted)]">
          <Inbox size={22} className="mb-2 opacity-60" aria-hidden="true" />
          <p className="text-sm">{empty}</p>
        </div>
      ) : (
        <div style={{ height }} role="img" aria-label={summary || title}>{children}</div>
      )}
    </Card>
  )
}

function StatusBadge({ status }) {
  return (
    <span className={`badge text-[11px] px-2 py-0.5 rounded whitespace-nowrap ${STATUS_STYLES[status] || STATUS_STYLES.open}`}>
      {CLAIM_STATUS_META[status]?.label || status || 'N/A'}
    </span>
  )
}

export default function InsuranceClaims() {
  const { activeCountry, activeCurrency } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [insurerFilter, setInsurerFilter] = useState('')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = TAB_IDS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'overview'
  const setTab = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (id === 'overview') next.delete('tab'); else next.set('tab', id)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

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

  // Ages are measured against the moment the data loaded, so they are stable
  // between renders instead of ticking every keystroke.
  const now = useMemo(() => (updatedAt ? updatedAt.getTime() : Date.now()), [updatedAt])
  const loading = rows === null
  // A failed read must never render as "no claims" or a row of zeros.
  const loadFailed = Boolean(error) && !loading

  const insurerOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.insurer).filter(Boolean))].sort((x, y) => x.localeCompare(y)),
    [rows],
  )

  const filtered = useMemo(() => {
    const list = filterInsuranceClaims(rows || [], {
      status: statusFilter, insurer: insurerFilter, search, from: fromDate, to: toDate,
    }).map((r) => insuranceClaimRow(r, now))
    return sortRows(list, { key: 'incident_date', dir: 'desc' })
  }, [rows, statusFilter, insurerFilter, search, fromDate, toDate, now])

  // The dashboard reflects the active filters.
  const a = useMemo(() => analyzeInsuranceClaims(filtered, { now }), [filtered, now])
  const rates = useMemo(() => headlineRates(a), [a])
  const insurers = useMemo(() => insurerRows(a), [a])
  const totalLoaded = rows ? rows.length : 0

  // ── Modal handlers ──────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      claim_no: r.claim_no || '', asset_no: r.asset_no || '', insurer: r.insurer || '',
      policy_no: r.policy_no || '', incident_date: r.incident_date || '', claim_date: r.claim_date || '',
      amount_claimed: r.amount_claimed ?? '', amount_settled: r.amount_settled ?? '',
      status: r.status || 'open', description: r.description || '',
    })
    setFormError(''); setModalOpen(true)
  }, [])
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  // One guarded close for Escape, the backdrop, the X and Cancel.
  const closeForm = () => { if (!saving) setModalOpen(false) }
  const closeDelete = () => { if (!deleteBusy) setDeleting(null) }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.insurer.trim() && !form.asset_no.trim()) {
      setFormError('Provide an insurer or an asset number.'); return
    }
    setSaving(true)
    try {
      // Only the stored columns go to the service - never the derived register
      // fields (outstanding, age, labels).
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
    setDeleteBusy(true)
    try {
      await deleteClaim(deleting.id)
      setDeleting(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the claim.'))
      setDeleting(null)
    } finally {
      setDeleteBusy(false)
    }
  }, [deleting, load])

  // ── Export: the WHOLE filtered set, not the page on screen ─────────────────
  const exportRows = useMemo(() => filtered.map((r) => ({
    claim_no: r.claim_no || 'N/A', asset_no: r.asset_no || 'N/A', insurer: r.insurer || 'N/A',
    policy_no: r.policy_no || 'N/A', incident_date: fmtDate(r.incident_date), claim_date: fmtDate(r.claim_date),
    amount_claimed: r.claimed ?? 'N/A', amount_settled: r.settled ?? 'N/A',
    outstanding: r.outstanding ?? 'N/A',
    status: r.statusLabel, ageDays: r.ageDays ?? 'N/A',
  })), [filtered])
  const fileName = reportFileName('TyrePulse Insurance Claims', activeCountry && activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExport = async (kind) => {
    try {
      if (kind === 'excel') await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileName, 'Claims', { currency: ccy })
      else await exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Insurance Claims', fileName, 'landscape', '', { currency: ccy })
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  // ── KPIs (pure engine over the filtered view; N/A when not measurable) ─────
  const na = loading || loadFailed
  const kpis = [
    { label: 'Total claims', value: na ? 'N/A' : a.total, sub: na ? null : `${a.openCount} open`, icon: ShieldAlert, accent: 'text-indigo-400' },
    { label: 'Open claims', value: na ? 'N/A' : a.openCount, sub: na ? null : a.avgOpenAgeDays == null ? 'no dated open claims' : `avg age ${a.avgOpenAgeDays}d`, icon: Inbox, accent: 'text-sky-400', tone: 'text-sky-400' },
    { label: 'Total claimed', value: na ? 'N/A' : money(a.totalClaimed), sub: na || !a.total ? null : `avg ${money(a.avgClaim)}`, icon: DollarSign },
    { label: 'Total settled', value: na ? 'N/A' : money(a.totalSettled), sub: 'recovered from insurers', icon: TrendingUp, accent: 'text-emerald-400', tone: 'text-emerald-400' },
    { label: 'Recovery rate', value: na || rates.recoveryRate == null ? 'N/A' : `${rates.recoveryRate}%`, sub: rates.recoveryRate == null ? 'nothing claimed yet' : 'settled / claimed', icon: Percent,
      tone: rates.recoveryRate == null ? 'text-[var(--text-primary)]' : rates.recoveryRate >= 70 ? 'text-green-400' : 'text-amber-400', accent: 'text-amber-400' },
    { label: 'Approval rate', value: na || rates.approvalRate == null ? 'N/A' : `${rates.approvalRate}%`, sub: na ? null : `${a.decidedCount} decided`, icon: ShieldAlert, accent: 'text-blue-400' },
    { label: 'Outstanding', value: na ? 'N/A' : money(a.outstanding), sub: 'claimed not yet settled', icon: Wallet, tone: !na && a.outstanding > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]', accent: 'text-amber-400' },
    { label: 'Delayed claims', value: na ? 'N/A' : a.delayedCount, sub: na ? null : `open over ${a.delayedThresholdDays}d${a.avgSettleDays == null ? '' : ` | settle avg ${a.avgSettleDays}d`}`, icon: Clock, tone: !na && a.delayedCount > 0 ? 'text-red-400' : 'text-[var(--text-primary)]', accent: 'text-red-400' },
  ]

  // ── Chart data ────────────────────────────────────────────────────────────────
  const statusDoughnut = useMemo(() => {
    const entries = CLAIM_STATUSES.map((st) => ({ st, n: a.byStatus[st] || 0 })).filter((e) => e.n > 0)
    return {
      labels: entries.map((e) => CLAIM_STATUS_META[e.st]?.label || e.st),
      datasets: [{ data: entries.map((e) => e.n), backgroundColor: entries.map((e) => STATUS_COLOR[e.st] || '#64748b'), borderWidth: 0 }],
    }
  }, [a.byStatus])
  const statusHasData = statusDoughnut.labels.length > 0

  const trendData = useMemo(() => ({
    labels: a.monthly.map((m) => m.label),
    datasets: [
      { type: 'bar', label: 'Claimed', data: a.monthly.map((m) => m.claimed), backgroundColor: withAlpha(colorAt(0), 0.6), yAxisID: 'y', order: 2 },
      { type: 'bar', label: 'Settled', data: a.monthly.map((m) => m.settled), backgroundColor: withAlpha(colorAt(1), 0.65), yAxisID: 'y', order: 2 },
      { type: 'line', label: 'Claims', data: a.monthly.map((m) => m.count), borderColor: colorAt(2), backgroundColor: withAlpha(colorAt(2), 0.15), yAxisID: 'y1', tension: 0.35, fill: false, pointRadius: 2, order: 1 },
    ],
  }), [a.monthly])
  const trendHasData = a.monthly.some((m) => m.count > 0)

  const insurerData = useMemo(() => {
    const top = insurers.slice(0, 8)
    return {
      labels: top.map((g) => g.insurer),
      datasets: [
        { label: 'Claimed', data: top.map((g) => g.claimed), backgroundColor: withAlpha(colorAt(0), 0.65) },
        { label: 'Settled', data: top.map((g) => g.settled), backgroundColor: withAlpha(colorAt(1), 0.7) },
      ],
    }
  }, [insurers])
  const insurerHasData = insurers.length > 0

  // ── Table columns ───────────────────────────────────────────────────────────
  const registerColumns = useMemo(() => [
    { id: 'claim_no', header: 'Claim No', accessorFn: (r) => blankToUndef(r.claim_no), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => blankToUndef(r.asset_no), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'insurer', header: 'Insurer / Policy', accessorFn: (r) => blankToUndef(r.insurer), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => <span>{row.original.insurer || 'N/A'}{row.original.policy_no ? <span className="text-[var(--text-muted)]"> | {row.original.policy_no}</span> : ''}</span> },
    { id: 'incident_date', header: 'Incident', accessorFn: (r) => blankToUndef(r.incident_date), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="whitespace-nowrap tabular-nums">{fmtDate(getValue())}</span> },
    { id: 'claimed', header: 'Claimed', accessorFn: (r) => r.claimed ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="font-medium tabular-nums text-[var(--text-primary)]">{money(getValue())}</span> },
    { id: 'settled', header: 'Settled', accessorFn: (r) => r.settled ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums text-emerald-400">{money(getValue())}</span> },
    { id: 'outstanding', header: 'Outstanding', accessorFn: (r) => r.outstanding ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{money(getValue())}</span> },
    { id: 'ageDays', header: 'Age', accessorFn: (r) => r.ageDays ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ row }) => (
        <span className={`tabular-nums whitespace-nowrap ${row.original.isDelayed ? 'text-red-400 font-medium' : ''}`}>
          {row.original.ageDays == null ? 'N/A' : `${row.original.ageDays}d`}{row.original.isDelayed ? ' (delayed)' : ''}
        </span>
      ) },
    { id: 'status', header: 'Status', accessorFn: (r) => r.statusLabel, sortingFn: valueSort,
      meta: { filterVariant: 'select' },
      cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const label = r.claim_no || r.asset_no || 'claim'
        return (
          <div className="flex items-center gap-1 justify-end">
            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(r) }} aria-label={`Edit claim ${label}`} title="Edit" className="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#16a34a)]"><Pencil size={14} aria-hidden="true" /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setDeleting(r) }} aria-label={`Delete claim ${label}`} title="Delete" className="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-red-900/40 text-[var(--text-muted)] hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><Trash2 size={14} aria-hidden="true" /></button>
          </div>
        )
      } },
  ], [money, openEdit])

  const delayedRows = useMemo(() => a.delayed.map((r) => ({ ...r, outstandingValue: outstandingValue(r) })), [a.delayed])
  const delayedColumns = useMemo(() => [
    { id: 'ref', header: 'Claim', accessorFn: (r) => blankToUndef(r.claim_no || r.asset_no), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => (
        <div>
          <div className="font-mono text-xs text-[var(--text-primary)]">{row.original.claim_no || row.original.asset_no || 'N/A'}</div>
          <div className="text-[11px] text-[var(--text-muted)]">{row.original.insurer || 'Unassigned'}</div>
        </div>
      ) },
    { id: 'status', header: 'Status', accessorFn: (r) => CLAIM_STATUS_META[r.status]?.label || r.status, sortingFn: valueSort,
      cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: 'outstandingValue', header: 'Outstanding', accessorFn: (r) => r.outstandingValue, sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{money(getValue())}</span> },
    { id: 'ageDays', header: 'Age', accessorFn: (r) => r.ageDays, sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums text-red-400 font-medium">{getValue()}d</span> },
  ], [money])

  const insurerColumns = useMemo(() => [
    { id: 'insurer', header: 'Insurer', accessorKey: 'insurer', sortingFn: valueSort,
      cell: ({ getValue }) => <span className="text-[var(--text-primary)]">{getValue()}</span> },
    { id: 'count', header: 'Claims', accessorKey: 'count', sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { id: 'openCount', header: 'Open', accessorKey: 'openCount', sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { id: 'claimed', header: 'Claimed', accessorKey: 'claimed', sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{money(getValue())}</span> },
    { id: 'settled', header: 'Settled', accessorKey: 'settled', sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums text-emerald-400">{money(getValue())}</span> },
    { id: 'outstanding', header: 'Outstanding', accessorKey: 'outstanding', sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{money(getValue())}</span> },
    { id: 'recoveryPct', header: 'Recovery', accessorFn: (g) => g.recoveryPct ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() == null ? 'N/A' : `${getValue()}%`}</span> },
    { id: 'avgClaim', header: 'Avg claim', accessorKey: 'avgClaim', sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.count ? money(row.original.avgClaim) : 'N/A'}</span> },
  ], [money])

  const clearFilters = () => { setStatusFilter('all'); setInsurerFilter(''); setSearch(''); setFromDate(''); setToDate('') }
  const hasFilters = statusFilter !== 'all' || insurerFilter || search || fromDate || toDate
  const chartEmpty = (hasAny, emptyText) => (loading ? 'Loading...' : loadFailed ? 'Not loaded. Use Retry above.' : !hasAny ? emptyText : null)

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
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length} title="Exports the claims matching the filters">
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length} title="Exports the claims matching the filters">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing}>
              <Plus size={14} aria-hidden="true" /> New claim
            </button>
          </div>
        }
      />

      {missing && (
        <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Insurance claims are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V134_INSURANCE_CLAIMS.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" role="alert" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Could not load insurance claims.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </Card>
      )}

      {actionError && (
        <Card tone="crit" role="alert" className="items-center gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={16} className="text-red-400 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} aria-label="Dismiss message" className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#16a34a)]"><X size={15} aria-hidden="true" /></button>
        </Card>
      )}

      {/* KPI tiles - follow the filters below */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      {/* Filters: shared by every tab so the dashboard, register and insurer
          breakdown always describe the same set of claims. */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input type="search" aria-label="Search claims" className="input pl-9 w-full" placeholder="Search claim no, asset, insurer, policy..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {CLAIM_STATUSES.map((st) => <option key={st} value={st}>{CLAIM_STATUS_META[st]?.label || st}</option>)}
          </select>
          <select className="input" value={insurerFilter} onChange={(e) => setInsurerFilter(e.target.value)} aria-label="Insurer" disabled={!insurerOptions.length}>
            <option value="">All insurers</option>
            {insurerOptions.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <div className="flex flex-wrap items-center gap-1.5">
            <label htmlFor="ic-from" className="text-xs text-[var(--text-muted)]">Incident from</label>
            <input id="ic-from" type="date" className="input" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
            <label htmlFor="ic-to" className="text-xs text-[var(--text-muted)]">to</label>
            <input id="ic-to" type="date" className="input" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
          </div>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {totalLoaded} claims</span>
        </div>
      </Card>

      <PageTabs tab={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div role="tabpanel" id="ic-panel-overview" aria-labelledby="ic-tab-overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard title="Status distribution" subtitle="Claims by lifecycle stage" empty={chartEmpty(statusHasData, 'No claims to chart.')}
              summary={`Status distribution: ${statusDoughnut.labels.map((l, i) => `${l} ${statusDoughnut.datasets[0].data[i]}`).join(', ')}`}>
              <Doughnut data={statusDoughnut} options={DOUGHNUT} />
            </ChartCard>
            <div className="lg:col-span-2">
              <ChartCard title="Monthly trend" subtitle="Claimed and settled value with claim volume, trailing 12 months" empty={chartEmpty(trendHasData, 'No dated claims to chart.')}>
                <Bar data={trendData} options={DUAL_AXIS} />
              </ChartCard>
            </div>
          </div>

          <Card pad="none" clip>
            <div className="px-4 pt-4">
              <CardHeader
                icon={Clock}
                title="Delayed and outstanding"
                description={`Open claims aged ${a.delayedThresholdDays} days or more, oldest first${!na && a.delayedCount > 0 ? `. ${money(a.outstandingOpen)} at risk.` : '.'}`}
              />
            </div>
            <EnterpriseTable
              columns={delayedColumns}
              data={delayedRows}
              getRowId={(r) => String(r.id)}
              loading={loading}
              error={loadFailed ? error : null}
              onRetry={load}
              enableColumnFilters={false}
              searchPlaceholder="Search delayed claims"
              initialPageSize={25}
              exportFileName={reportFileName('TyrePulse Delayed Insurance Claims', reportDateLabel())}
              reportMeta={{ title: 'Delayed Insurance Claims', currency: ccy }}
              emptyMessage="No delayed open claims. Nothing is overdue."
              emptyIcon={<ShieldAlert size={22} className="opacity-60" aria-hidden="true" />}
            />
          </Card>
        </div>
      )}

      {tab === 'register' && (
        <div role="tabpanel" id="ic-panel-register" aria-labelledby="ic-tab-register">
          <Card pad="none" clip>
            <EnterpriseTable
              columns={registerColumns}
              data={filtered}
              getRowId={(r) => String(r.id)}
              loading={loading}
              error={loadFailed ? error : null}
              onRetry={load}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              viewKey="insurance-claims"
              initialPageSize={50}
              pageSizeOptions={[25, 50, 100, 250]}
              emptyMessage={missing ? 'Insurance claims are not enabled on this database yet.' : totalLoaded === 0 ? 'No insurance claims yet. Record your first claim.' : 'No claims match these filters.'}
              emptyIcon={<Filter size={22} className="opacity-60" aria-hidden="true" />}
            />
          </Card>
        </div>
      )}

      {tab === 'insurers' && (
        <div role="tabpanel" id="ic-panel-insurers" aria-labelledby="ic-tab-insurers" className="space-y-4">
          <ChartCard title="Insurer performance" subtitle="Claimed vs settled by insurer (top 8)" height={300} empty={chartEmpty(insurerHasData, 'No insurer data yet.')}>
            <Bar data={insurerData} options={HORIZONTAL} />
          </ChartCard>
          <Card pad="none" clip>
            <EnterpriseTable
              columns={insurerColumns}
              data={insurers}
              getRowId={(g) => g.insurer}
              loading={loading}
              error={loadFailed ? error : null}
              onRetry={load}
              enableColumnFilters={false}
              searchPlaceholder="Search insurers"
              exportFileName={reportFileName('TyrePulse Insurer Performance', reportDateLabel())}
              reportMeta={{ title: 'Insurer Performance', currency: ccy }}
              emptyMessage={totalLoaded === 0 ? 'No insurance claims yet.' : 'No insurers in the filtered claims.'}
              emptyIcon={<Building2 size={22} className="opacity-60" aria-hidden="true" />}
            />
          </Card>
        </div>
      )}

      {/* Create / edit - Modal owns Escape, focus trap, scroll lock and the X;
          every dismissal path is guarded while a save is in flight. */}
      <Modal open={modalOpen} onClose={closeForm} title={editing ? 'Edit claim' : 'New insurance claim'} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label htmlFor="ic-f-claim" className="label">Claim No</label><input id="ic-f-claim" className="input w-full" value={form.claim_no} onChange={(e) => setField('claim_no', e.target.value)} placeholder="CLM-0001" /></div>
            <div><label htmlFor="ic-f-asset" className="label">Asset No</label><input id="ic-f-asset" className="input w-full" value={form.asset_no} onChange={(e) => setField('asset_no', e.target.value)} placeholder="Vehicle / asset" /></div>
            <div><label htmlFor="ic-f-insurer" className="label">Insurer</label><input id="ic-f-insurer" className="input w-full" value={form.insurer} onChange={(e) => setField('insurer', e.target.value)} placeholder="e.g. Tawuniya" /></div>
            <div><label htmlFor="ic-f-policy" className="label">Policy No</label><input id="ic-f-policy" className="input w-full" value={form.policy_no} onChange={(e) => setField('policy_no', e.target.value)} /></div>
            <div><label htmlFor="ic-f-incident" className="label">Incident date</label><input id="ic-f-incident" type="date" className="input w-full" value={form.incident_date || ''} onChange={(e) => setField('incident_date', e.target.value)} /></div>
            <div><label htmlFor="ic-f-claimdate" className="label">Claim date</label><input id="ic-f-claimdate" type="date" className="input w-full" value={form.claim_date || ''} onChange={(e) => setField('claim_date', e.target.value)} /></div>
            <div><label htmlFor="ic-f-claimed" className="label">Amount claimed ({ccy})</label><input id="ic-f-claimed" type="number" inputMode="decimal" min="0" step="0.01" className="input w-full" value={form.amount_claimed} onChange={(e) => setField('amount_claimed', e.target.value)} /></div>
            <div><label htmlFor="ic-f-settled" className="label">Amount settled ({ccy})</label><input id="ic-f-settled" type="number" inputMode="decimal" min="0" step="0.01" className="input w-full" value={form.amount_settled} onChange={(e) => setField('amount_settled', e.target.value)} /></div>
            <div><label htmlFor="ic-f-status" className="label">Status</label>
              <select id="ic-f-status" className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                {CLAIM_STATUSES.map((st) => <option key={st} value={st}>{CLAIM_STATUS_META[st]?.label || st}</option>)}
              </select>
            </div>
          </div>
          <div><label htmlFor="ic-f-desc" className="label">Description</label>
            <textarea id="ic-f-desc" className="input w-full min-h-[90px] resize-y" value={form.description} maxLength={8000} onChange={(e) => setField('description', e.target.value)} placeholder="What happened, damage summary, notes..." />
          </div>
          <p className="text-xs text-[var(--text-muted)]">Provide at least an insurer or an asset number.</p>
          {formError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeForm} disabled={saving} className="btn-secondary text-sm min-h-[44px]">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60">
              {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create claim'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={closeDelete}
        title="Delete claim?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={closeDelete} disabled={deleteBusy} className="btn-secondary text-sm min-h-[44px]">Cancel</button>
            <button type="button" onClick={confirmDelete} disabled={deleteBusy} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60">
              {deleteBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} Delete
            </button>
          </>
        )}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" aria-hidden="true" /></div>
          <p className="text-sm text-[var(--text-muted)]">
            {deleting?.claim_no ? <span className="font-mono text-[var(--text-secondary)]">{deleting.claim_no}</span> : 'This claim'} will be permanently removed. This cannot be undone.
          </p>
        </div>
      </Modal>
    </div>
  )
}
