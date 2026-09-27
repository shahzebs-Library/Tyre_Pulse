/**
 * RetreadClaims (route /retread-claims) - Safety & Compliance module.
 *
 * Retread warranty / quality claims raised against retread vendors for a
 * specific casing/tyre serial, tracked through the full lifecycle
 * (open, submitted, approved, rejected, settled) with cost-vs-recovered
 * amounts driving fleet recovery, approval and resolution-time KPIs plus
 * vendor accountability.
 *
 * Tabs (synced to ?tab=): Register (default) and Analytics. Analytics tab: status distribution, monthly trend and vendor performance
 * ranking over REAL data only (honest empty states, never fabricated). There
 * is no brand column on retread_claims, so no brand chart is shown.
 *
 * CRUD lives in src/lib/api/retreadClaims.js; every KPI/aggregation comes from
 * the pure, unit-tested src/lib/retreadClaimsAnalytics.js so the numbers are
 * computed in exactly one place (page, table, exports).
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
  Recycle, Plus, Search, X, Filter, Pencil, Trash2, Loader2, Save,
  FileSpreadsheet, FileText, AlertTriangle, DollarSign, Inbox, TrendingUp,
  RotateCw, Percent, Clock, Building2, LayoutGrid, BarChart3, ListChecks,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import NotInUseNotice from '../components/ui/NotInUseNotice'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import {
  listRetreadClaims, createRetreadClaim, updateRetreadClaim, deleteRetreadClaim,
} from '../lib/api/retreadClaims'
import {
  analyzeRetreadClaims, computeRetreadKpis, filterRetreadClaims, retreadClaimRow,
  honestRecoveryRate, vendorRows,
  RETREAD_CLAIM_STATUSES, RETREAD_CLAIM_STATUS_META,
} from '../lib/retreadClaimsAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
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
  plugins: { legend: { position: 'bottom', labels: { color: INK, boxWidth: 12, padding: 12, font: { size: 11 } } } },
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

// Status -> chart hue (semantic ladder, deliberately fixed; the label is always shown).
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

const EXPORT_COLS = ['claim_no', 'tyre_serial', 'asset_no', 'vendor', 'reason', 'claim_date', 'cost', 'amount_recovered', 'outstanding', 'status']
const EXPORT_HEADERS = ['Claim No', 'Tyre Serial', 'Asset', 'Vendor', 'Reason', 'Claim Date', 'Cost', 'Recovered', 'Outstanding', 'Status']

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blankToUndef = (v) => (v === null || v === undefined || v === '' ? undefined : v)

const TABS = [
  { id: 'register', label: 'Register', icon: ListChecks },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
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
    <div role="tablist" aria-label="Retread claims views" className="flex flex-wrap gap-1 border-b border-[var(--border-bright)]">
      {TABS.map((t, i) => {
        const Icon = t.icon
        const active = tab === t.id
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            id={`rc-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`rc-panel-${t.id}`}
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

function StatusBadge({ status }) {
  return (
    <span className={`badge text-[11px] px-2 py-0.5 rounded whitespace-nowrap ${STATUS_STYLES[status] || STATUS_STYLES.open}`}>
      {RETREAD_CLAIM_STATUS_META[status]?.label || status || 'N/A'}
    </span>
  )
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString().slice(0, 10)
}

export default function RetreadClaims() {
  const { activeCountry, activeCurrency } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [searchParams, setSearchParams] = useSearchParams()
  const tab = TAB_IDS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'register'
  const setTab = useCallback((id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (id === 'register') next.delete('tab'); else next.set('tab', id)
      return next
    }, { replace: true })
  }, [setSearchParams])
  const [statusFilter, setStatusFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

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

  const loading = rows === null
  // A failed read must never render as "no claims" or a row of zeros.
  const loadFailed = Boolean(error) && !loading

  const vendorOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.vendor).filter(Boolean))].sort((x, y) => x.localeCompare(y)),
    [rows],
  )

  const filteredRaw = useMemo(
    () => filterRetreadClaims(rows || [], { status: statusFilter, vendor: vendorFilter, search, from: fromDate, to: toDate }),
    [rows, statusFilter, vendorFilter, search, fromDate, toDate],
  )
  // Newest first by default; the table re-sorts on any header click.
  const filtered = useMemo(
    () => sortRows(filteredRaw.map(retreadClaimRow), { key: 'claimDay', dir: 'desc' }),
    [filteredRaw],
  )

  // Analytics computed from the SAME filtered set so KPIs and charts follow the filters.
  const analytics = useMemo(() => analyzeRetreadClaims(filteredRaw, { vendorLimit: 8, now: updatedAt || undefined }), [filteredRaw, updatedAt])
  const allVendors = useMemo(() => vendorRows(analyzeRetreadClaims(filteredRaw, { vendorLimit: 0 }).vendors), [filteredRaw])
  const summary = useMemo(() => computeRetreadKpis(rows || []), [rows])
  const k = analytics.kpis
  const recoveryRate = honestRecoveryRate(k.totalRecovered, k.totalClaimed)

  // ── Modal handlers ──────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      claim_no: r.claim_no || '', tyre_serial: r.tyre_serial || '', asset_no: r.asset_no || '',
      vendor: r.vendor || '', reason: r.reason || '', claim_date: r.claim_date || '',
      cost: r.cost ?? '', amount_recovered: r.amount_recovered ?? '',
      status: r.status || 'open', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }, [])
  const setField = (k2, v) => setForm((f) => ({ ...f, [k2]: v }))
  // One guarded close for Escape, the backdrop, the X and Cancel.
  const closeForm = () => { if (!saving) setModalOpen(false) }
  const closeDelete = () => { if (!deleteBusy) setDeleting(null) }

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
    setDeleteBusy(true)
    try {
      await deleteRetreadClaim(deleting.id)
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
    claim_no: r.claim_no || 'N/A', tyre_serial: r.tyre_serial || 'N/A', asset_no: r.asset_no || 'N/A',
    vendor: r.vendor || 'N/A', reason: r.reason || '', claim_date: r.claimDay || 'N/A',
    cost: r.costValue ?? 'N/A', amount_recovered: r.recoveredValue ?? 'N/A',
    outstanding: r.outstanding ?? 'N/A', status: r.statusLabel,
  })), [filtered])
  const fileName = reportFileName('TyrePulse Retread Claims', activeCountry && activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExport = async (kind) => {
    try {
      if (kind === 'excel') await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileName, 'Retread claims', { currency: ccy })
      else await exportToPdf(exportRows, EXPORT_COLS.map((c, i) => ({ key: c, header: EXPORT_HEADERS[i] })), 'Retread Claims', fileName, 'landscape', '', { currency: ccy })
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  const na = loading || loadFailed
  const kpis = [
    { label: 'Total claims', value: na ? 'N/A' : k.total, sub: na ? '' : `${k.openCount} open`, icon: LayoutGrid, tone: 'text-[var(--text-primary)]', accent: 'text-indigo-400' },
    { label: 'Open exposure', value: na ? 'N/A' : money(k.openExposure), sub: 'cost of live claims', icon: Inbox, tone: 'text-sky-400', accent: 'text-sky-400' },
    { label: 'Approval rate', value: na || k.approvalRate == null ? 'N/A' : `${k.approvalRate}%`, sub: na ? '' : `${k.decidedCount} decided`, icon: Percent, tone: k.approvalRate != null && k.approvalRate >= 60 ? 'text-green-400' : 'text-amber-400', accent: 'text-amber-400' },
    { label: 'Value claimed', value: na ? 'N/A' : money(k.totalClaimed), sub: 'gross exposure', icon: DollarSign, tone: 'text-[var(--text-primary)]', accent: 'text-[var(--text-muted)]' },
    { label: 'Recovered', value: na ? 'N/A' : money(k.totalRecovered), sub: na ? '' : recoveryRate == null ? 'no cost recorded' : `${recoveryRate}% recovery`, icon: TrendingUp, tone: 'text-emerald-400', accent: 'text-emerald-400' },
    { label: 'Avg resolution', value: na || k.avgResolutionDays == null ? 'N/A' : `${k.avgResolutionDays}d`, sub: na ? '' : `${k.resolvedCount} resolved`, icon: Clock, tone: 'text-[var(--text-primary)]', accent: 'text-violet-400' },
  ]

  const clearFilters = () => { setStatusFilter('all'); setVendorFilter(''); setSearch(''); setFromDate(''); setToDate('') }
  const hasFilters = statusFilter !== 'all' || vendorFilter || search || fromDate || toDate

  // ── Chart datasets ──────────────────────────────────────────────────────────
  const hasData = filtered.length > 0
  const shownStatuses = analytics.statuses.filter((st) => st.count > 0)
  const statusChart = {
    labels: shownStatuses.map((st) => st.label),
    datasets: [{
      data: shownStatuses.map((st) => st.count),
      backgroundColor: shownStatuses.map((st) => STATUS_HUE[st.status] || '#64748b'),
      borderWidth: 0,
    }],
  }
  const trendChart = {
    labels: analytics.trend.map((t) => t.label),
    datasets: [
      { type: 'bar', label: 'Claims', data: analytics.trend.map((t) => t.claims), backgroundColor: withAlpha(colorAt(0), 0.55), borderColor: colorAt(0), borderWidth: 1, yAxisID: 'y1', order: 2 },
      { type: 'line', label: 'Cost', data: analytics.trend.map((t) => t.cost), borderColor: colorAt(2), backgroundColor: withAlpha(colorAt(2), 0.15), tension: 0.3, fill: true, yAxisID: 'y', order: 1, pointRadius: 2 },
      { type: 'line', label: 'Recovered', data: analytics.trend.map((t) => t.recovered), borderColor: colorAt(1), backgroundColor: withAlpha(colorAt(1), 0.12), tension: 0.3, fill: true, yAxisID: 'y', order: 0, pointRadius: 2 },
    ],
  }
  const vendorCostChart = {
    labels: analytics.vendors.map((v) => v.key),
    datasets: [
      { label: 'Cost', data: analytics.vendors.map((v) => v.cost), backgroundColor: withAlpha(colorAt(0), 0.65), borderColor: colorAt(0), borderWidth: 1 },
      { label: 'Recovered', data: analytics.vendors.map((v) => v.recovered), backgroundColor: withAlpha(colorAt(1), 0.65), borderColor: colorAt(1), borderWidth: 1 },
    ],
  }

  // ── Table columns ───────────────────────────────────────────────────────────
  const registerColumns = useMemo(() => [
    { id: 'claim_no', header: 'Claim No', accessorFn: (r) => blankToUndef(r.claim_no), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'tyre_serial', header: 'Tyre Serial', accessorFn: (r) => blankToUndef(r.tyre_serial), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-secondary)]">{row.original.tyre_serial || 'N/A'}{row.original.asset_no ? <span className="text-[var(--text-muted)]"> | {row.original.asset_no}</span> : ''}</span> },
    { id: 'vendor', header: 'Vendor', accessorFn: (r) => blankToUndef(r.vendor), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'reason', header: 'Reason', accessorFn: (r) => blankToUndef(r.reason), enableSorting: false,
      cell: ({ getValue }) => <span className="block max-w-[220px] truncate" title={getValue() || ''}>{getValue() || 'N/A'}</span> },
    { id: 'claimDay', header: 'Claim Date', accessorFn: (r) => blankToUndef(r.claimDay), sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="whitespace-nowrap tabular-nums">{getValue() || 'N/A'}</span> },
    { id: 'cost', header: 'Cost', accessorFn: (r) => r.costValue ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="font-medium tabular-nums text-[var(--text-primary)]">{money(getValue())}</span> },
    { id: 'recovered', header: 'Recovered', accessorFn: (r) => r.recoveredValue ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums text-emerald-400">{money(getValue())}</span> },
    { id: 'status', header: 'Status', accessorFn: (r) => RETREAD_CLAIM_STATUSES.indexOf(r.status), sortingFn: valueSort,
      cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const label = r.claim_no || r.tyre_serial || 'claim'
        return (
          <div className="flex items-center gap-1 justify-end">
            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(r) }} aria-label={`Edit claim ${label}`} title="Edit" className="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#16a34a)]"><Pencil size={14} aria-hidden="true" /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setDeleting(r) }} aria-label={`Delete claim ${label}`} title="Delete" className="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-red-900/40 text-[var(--text-muted)] hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"><Trash2 size={14} aria-hidden="true" /></button>
          </div>
        )
      } },
  ], [money, openEdit])

  const vendorColumns = useMemo(() => [
    { id: 'key', header: 'Vendor', accessorKey: 'key', sortingFn: valueSort,
      cell: ({ getValue }) => <span className="block max-w-[180px] truncate text-[var(--text-primary)]" title={getValue()}>{getValue()}</span> },
    { id: 'claims', header: 'Claims', accessorKey: 'claims', sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { id: 'open', header: 'Open', accessorKey: 'open', sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> },
    { id: 'cost', header: 'Cost', accessorKey: 'cost', sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{money(getValue())}</span> },
    { id: 'recovered', header: 'Recovered', accessorKey: 'recovered', sortingFn: valueSort, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums text-emerald-400">{money(getValue())}</span> },
    { id: 'recoveryPct', header: 'Recovery', accessorFn: (v) => v.recoveryPct ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() == null ? 'N/A' : `${getValue()}%`}</span> },
    { id: 'approvalRate', header: 'Approval', accessorFn: (v) => v.approvalRate ?? undefined, sortingFn: valueSort, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() == null ? 'N/A' : `${getValue()}%`}</span> },
  ], [money])

  const emptyAll = summary.total === 0

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
      <NotInUseNotice count={loadFailed || missing ? undefined : rows?.length} label="retread claims"
        hint="Claims appear once one is raised with a retread supplier." />

      {missing && (
        <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Retread claims are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V145_RETREAD_CLAIMS.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" role="alert" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">Could not load retread claims.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0 min-h-[44px]"><RotateCw size={14} aria-hidden="true" /> Retry</button>
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon
          return (
            <Card key={kpi.label}>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{kpi.label}</p>
                <Icon size={16} className={kpi.accent} aria-hidden="true" />
              </div>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${kpi.tone}`}>{kpi.value}</p>
              {kpi.sub ? <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{kpi.sub}</p> : null}
            </Card>
          )
        })}
      </div>

      {/* Shared filters: both tabs describe the same set of claims */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input type="search" aria-label="Search retread claims" className="input pl-9 w-full" placeholder="Search claim no, serial, asset, vendor, reason..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {RETREAD_CLAIM_STATUSES.map((st) => <option key={st} value={st}>{RETREAD_CLAIM_STATUS_META[st]?.label || st}</option>)}
          </select>
          <select className="input" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} aria-label="Vendor" disabled={!vendorOptions.length}>
            <option value="">All vendors</option>
            {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <div className="flex flex-wrap items-center gap-1.5">
            <label htmlFor="rc-from" className="text-xs text-[var(--text-muted)]">Claim date from</label>
            <input id="rc-from" type="date" className="input" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
            <label htmlFor="rc-to" className="text-xs text-[var(--text-muted)]">to</label>
            <input id="rc-to" type="date" className="input" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
          </div>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {summary.total} claims</span>
        </div>
      </Card>

      <PageTabs tab={tab} onChange={setTab} />

      {tab === 'analytics' && (
        <div role="tabpanel" id="rc-panel-analytics" aria-labelledby="rc-tab-analytics" className="space-y-4">
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[0, 1].map((i) => <div key={i} className="h-72 rounded-xl bg-[var(--input-bg)] animate-pulse" />)}
            </div>
          ) : loadFailed ? (
            <Card><div className="py-12 text-center text-sm text-[var(--text-muted)]">Analytics are unavailable because the claims could not be loaded. Use Retry above.</div></Card>
          ) : !hasData ? (
            <Card><div className="py-16 text-center text-[var(--text-muted)]">
              <BarChart3 size={26} className="mx-auto mb-2 opacity-60" aria-hidden="true" />
              {emptyAll ? 'No retread claims yet. Record a claim to build vendor and recovery analytics.' : 'No claims match these filters.'}
            </div></Card>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader title="Status distribution" description={`Where the ${filtered.length} claims sit in the lifecycle.`} />
                  <div style={{ height: 260 }} role="img" aria-label={`Status distribution: ${shownStatuses.map((st) => `${st.label} ${st.count}`).join(', ')}`}>
                    <Doughnut data={statusChart} options={DOUGHNUT} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Monthly trend (12 months)" description="Claims raised vs cost and recovered value." />
                  <div style={{ height: 260 }}><Bar data={trendChart} options={DUAL_AXIS} /></div>
                </Card>
              </div>

              <Card>
                <CardHeader title="Vendor exposure vs recovery" description={`Top vendors by claim count (${ccy}).`} />
                {analytics.vendors.length ? (
                  <div style={{ height: 300 }}><Bar data={vendorCostChart} options={HORIZONTAL} /></div>
                ) : (
                  <p className="py-10 text-center text-sm text-[var(--text-muted)]">No vendor is recorded on the filtered claims.</p>
                )}
              </Card>

              <Card pad="none" clip>
                <div className="px-4 pt-4">
                  <CardHeader icon={Building2} title="Vendor performance" description="Every vendor in the filtered claims. Recovery is N/A where no cost was recorded." />
                </div>
                <EnterpriseTable
                  columns={vendorColumns}
                  data={allVendors}
                  getRowId={(v) => v.key}
                  enableColumnFilters={false}
                  searchPlaceholder="Search vendors"
                  exportFileName={reportFileName('TyrePulse Retread Vendor Performance', reportDateLabel())}
                  reportMeta={{ title: 'Retread Vendor Performance', currency: ccy }}
                  emptyMessage="No vendor is recorded on the filtered claims."
                  emptyIcon={<Building2 size={22} className="opacity-60" aria-hidden="true" />}
                />
              </Card>
            </>
          )}
        </div>
      )}

      {tab === 'register' && (
        <div role="tabpanel" id="rc-panel-register" aria-labelledby="rc-tab-register">
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
              viewKey="retread-claims"
              initialPageSize={50}
              pageSizeOptions={[25, 50, 100, 250]}
              emptyMessage={missing ? 'Retread claims are not enabled on this database yet.' : emptyAll ? 'No retread claims yet. Record your first claim.' : 'No claims match these filters.'}
              emptyIcon={<Filter size={22} className="opacity-60" aria-hidden="true" />}
            />
          </Card>
        </div>
      )}

      {/* Create / edit - Modal owns Escape, focus trap, scroll lock and the X;
          every dismissal path is guarded while a save is in flight. */}
      <Modal open={modalOpen} onClose={closeForm} title={editing ? 'Edit claim' : 'New retread claim'} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label htmlFor="rc-f-claim" className="label">Claim No</label><input id="rc-f-claim" className="input w-full" value={form.claim_no} onChange={(e) => setField('claim_no', e.target.value)} placeholder="RTC-0001" /></div>
            <div><label htmlFor="rc-f-serial" className="label">Tyre Serial</label><input id="rc-f-serial" className="input w-full" value={form.tyre_serial} onChange={(e) => setField('tyre_serial', e.target.value)} placeholder="Casing / tyre serial" /></div>
            <div><label htmlFor="rc-f-asset" className="label">Asset No</label><input id="rc-f-asset" className="input w-full" value={form.asset_no} onChange={(e) => setField('asset_no', e.target.value)} placeholder="Vehicle / asset" /></div>
            <div><label htmlFor="rc-f-vendor" className="label">Vendor</label><input id="rc-f-vendor" className="input w-full" value={form.vendor} onChange={(e) => setField('vendor', e.target.value)} placeholder="Retread vendor" /></div>
            <div><label htmlFor="rc-f-date" className="label">Claim date</label><input id="rc-f-date" type="date" className="input w-full" value={form.claim_date || ''} onChange={(e) => setField('claim_date', e.target.value)} /></div>
            <div><label htmlFor="rc-f-status" className="label">Status</label>
              <select id="rc-f-status" className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                {RETREAD_CLAIM_STATUSES.map((st) => <option key={st} value={st}>{RETREAD_CLAIM_STATUS_META[st]?.label || st}</option>)}
              </select>
            </div>
            <div><label htmlFor="rc-f-cost" className="label">Cost ({ccy})</label><input id="rc-f-cost" type="number" inputMode="decimal" min="0" step="0.01" className="input w-full" value={form.cost} onChange={(e) => setField('cost', e.target.value)} /></div>
            <div><label htmlFor="rc-f-recovered" className="label">Amount recovered ({ccy})</label><input id="rc-f-recovered" type="number" inputMode="decimal" min="0" step="0.01" className="input w-full" value={form.amount_recovered} onChange={(e) => setField('amount_recovered', e.target.value)} /></div>
          </div>
          <div><label htmlFor="rc-f-reason" className="label">Reason</label>
            <textarea id="rc-f-reason" className="input w-full min-h-[70px] resize-y" value={form.reason} maxLength={8000} onChange={(e) => setField('reason', e.target.value)} placeholder="Claim reason: separation, defect, premature failure..." />
          </div>
          <div><label htmlFor="rc-f-notes" className="label">Notes</label>
            <textarea id="rc-f-notes" className="input w-full min-h-[70px] resize-y" value={form.notes} maxLength={8000} onChange={(e) => setField('notes', e.target.value)} placeholder="Vendor response, resolution notes..." />
          </div>
          <p className="text-xs text-[var(--text-muted)]">Provide at least a vendor or a tyre serial.</p>
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
