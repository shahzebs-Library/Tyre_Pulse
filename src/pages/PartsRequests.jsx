/**
 * PartsRequests (route /parts-requests) - the workshop parts-request lifecycle.
 *
 * A technician raises a parts request for a job (status 'requested'); a foreman
 * or storekeeper approves ('approved'), issues ('issued') and fulfils
 * ('fulfilled') it - which is what resolves the technician's blocked-for-parts
 * time on the Workshop Live board.
 *
 * View is open to Admin / Manager / Director + super-admin; the status-advance
 * write actions are enforced server-side by RLS (elevated only) and gated in the
 * UI. All maths live in the pure, unit-tested partsRequests engine; this page is
 * presentation + orchestration only. Honest loading / empty / error states, no
 * fabricated data. Light + dark via var(--*).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  PackagePlus, Boxes, Clock, CheckCircle2, AlertTriangle, Filter, X, Plus,
  Loader2, FileSpreadsheet, FileText, Search, ClipboardList, PieChart,
  BarChart3, Check, ThumbsUp, Ban, ArrowRight, RefreshCw, Hourglass, Percent,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import EChart from '../components/charts/EChart'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  listPartsRequests, createPartsRequest, setPartsRequestStatus,
  listOpenJobs, listPartCatalog, distinctSites,
} from '../lib/api/partsRequests'
import {
  summarizeParts, nextPartsStatus, PARTS_STATUS,
  PARTS_STATUS_LABEL, PARTS_PRIORITIES, PARTS_PRIORITY_LABEL, normalizePartsStatus,
} from '../lib/partsRequests'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import {
  decorateRequests, openAgeing, openByPriority, fillRate, fmtAge, requestExportRows,
} from '../lib/partsRequestsAnalytics'
import { compareValues } from '../lib/consoleTable'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const WRITE_ROLES = new Set(['Admin', 'Manager', 'Director'])

// Forward-action label per current open status.
const FORWARD_ACTION = {
  requested: { label: 'Approve', icon: ThumbsUp },
  approved: { label: 'Issue', icon: ArrowRight },
  issued: { label: 'Fulfil', icon: Check },
}

const STATUS_TONE = {
  requested: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  approved: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  issued: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  fulfilled: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-300 border-red-500/30',
  cancelled: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]',
}
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
// chartVarPlugin-style tokens: ECharts gets the live computed value per theme.
const cssVar = (name, fallback) => {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
const PRIORITY_TONE = {
  low: 'text-[var(--text-muted)]',
  medium: 'text-sky-300',
  high: 'text-amber-300',
  critical: 'text-red-300',
}

const EMPTY_FORM = {
  job_id: '', asset_no: '', part_id: '', part_name: '', qty: '1',
  priority: 'medium', needed_by: '', notes: '',
}

const todayISO = () => new Date().toISOString().slice(0, 10)

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 16) : d.toLocaleString()
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString()
}
function fmtNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString() : 'N/A'
}
function fmtHours(v) {
  return v == null ? 'N/A' : `${v} h`
}

export default function PartsRequests() {
  const { activeCountry, activeCurrency } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const canWrite = isSuperAdmin === true || WRITE_ROLES.has(profile?.role)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [filters, setFilters] = useState({ status: 'All', site: 'All', q: '' })
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const clearFilters = () => setFilters({ status: 'All', site: 'All', q: '' })

  // Per-row status action in flight.
  const [busyId, setBusyId] = useState(null)

  // New-request modal.
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [jobs, setJobs] = useState([])
  const [parts, setParts] = useState([])
  const [pickerLoading, setPickerLoading] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const data = await listPartsRequests({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setMissing(false)
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else setError(toUserMessage(err, 'Could not load parts requests.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { setLoading(true); load() }, [load])

  // Load picker sources when the modal opens (best-effort).
  const openModal = useCallback(async () => {
    setForm({ ...EMPTY_FORM })
    setFormError('')
    setShowModal(true)
    setPickerLoading(true)
    try {
      const [j, p] = await Promise.all([
        listOpenJobs({ country: activeCountry }).catch(() => []),
        listPartCatalog({ country: activeCountry }).catch(() => []),
      ])
      setJobs(Array.isArray(j) ? j : [])
      setParts(Array.isArray(p) ? p : [])
    } finally {
      setPickerLoading(false)
    }
  }, [activeCountry])

  const siteOptions = useMemo(() => distinctSites(rows), [rows])

  /**
   * The SCOPE the tiles and the chart cover: site + search, but NOT status.
   *
   * Status is deliberately held out. Two of the four tiles (Open Requests,
   * Fulfilled Today) and the whole status pie ARE status readings, so counting
   * them over a status-narrowed set makes them restate the status the reader
   * already picked - "Open Requests: 0" the moment they look at fulfilled ones.
   * Holding out the dimension a figure reports on is the same rule the
   * Accidents register follows for its Delayed toggle.
   */
  const scoped = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return rows.filter((r) => {
      if (filters.site !== 'All' && String(r.site || '') !== filters.site) return false
      if (q) {
        const hay = `${r.part_name || ''} ${r.asset_no || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, filters])

  const filtered = useMemo(() => (
    filters.status === 'All'
      ? scoped
      : scoped.filter((r) => normalizePartsStatus(r.status) === filters.status)
  ), [scoped, filters.status])

  // Decorated once (overdue, age) so the table, the ageing panel and the export
  // agree on every row. The register pages and sorts inside EnterpriseTable.
  const decoratedFiltered = useMemo(() => decorateRequests(filtered, new Date()), [filtered])
  const decoratedScoped = useMemo(() => decorateRequests(scoped, new Date()), [scoped])
  const ageing = useMemo(() => openAgeing(decoratedScoped), [decoratedScoped])
  const priorities = useMemo(() => openByPriority(decoratedScoped), [decoratedScoped])
  const fill = useMemo(() => fillRate(decoratedScoped), [decoratedScoped])
  const failedFirstLoad = !!error && rows.length === 0 && !missing

  // Was `summarizeParts(rows)`: the tiles stated fleet-wide figures directly
  // above a table narrowed to one site, so the two contradicted each other.
  const summary = useMemo(() => summarizeParts(scoped, {}), [scoped])

  const fulfilledToday = useMemo(() => {
    const today = todayISO()
    return scoped.filter((r) => normalizePartsStatus(r.status) === 'fulfilled'
      && String(r.fulfilled_at || '').slice(0, 10) === today).length
  }, [scoped])

  // True only while the tiles cover less than the whole register, which is when
  // the caption below them is worth printing.
  const scopeNarrowed = scoped.length !== rows.length

  // ── Charts (EChart + reportColors) ─────────────────────────────────────────
  const statusChartOption = useMemo(() => {
    const data = PARTS_STATUS
      .map((s) => ({ name: PARTS_STATUS_LABEL[s], value: summary.byStatus[s] || 0 }))
      .filter((d) => d.value > 0)
    const colors = categorical(data.length)
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { color: cssVar('--text-secondary', '#94a3b8'), fontSize: 11 } },
      series: [{
        type: 'pie', radius: ['45%', '70%'], center: ['50%', '45%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: cssVar('--card-bg', 'transparent'), borderWidth: 1 },
        label: { color: cssVar('--text-secondary', '#94a3b8'), fontSize: 11 },
        data: data.map((d, i) => ({ ...d, itemStyle: { color: colors[i] } })),
      }],
    }
  }, [summary.byStatus])

  const partChartOption = useMemo(() => {
    const top = summary.byPart.slice(0, 10)
    return {
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', minInterval: 1, axisLabel: { color: cssVar('--text-muted', '#94a3b8'), fontSize: 10 }, splitLine: { lineStyle: { color: cssVar('--panel-2', 'rgba(148,163,184,0.2)') } } },
      yAxis: {
        type: 'category', inverse: true,
        data: top.map((p) => p.part),
        axisLabel: { color: cssVar('--text-muted', '#94a3b8'), fontSize: 10, width: 120, overflow: 'truncate' },
      },
      series: [{
        type: 'bar', barMaxWidth: 18,
        data: top.map((p, i) => ({ value: p.count, itemStyle: { color: colorAt(i), borderRadius: [0, 4, 4, 0] } })),
      }],
    }
  }, [summary.byPart])

  // ── Status advance ─────────────────────────────────────────────────────────
  const advance = useCallback(async (row, status) => {
    if (!canWrite) return
    setBusyId(row.id)
    setError('')
    try {
      const updated = await setPartsRequestStatus(row.id, status)
      if (updated) setRows((r) => r.map((x) => (x.id === row.id ? updated : x)))
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not update the request.'))
    } finally {
      setBusyId(null)
    }
  }, [canWrite])

  // ── Create ─────────────────────────────────────────────────────────────────
  const onPickPart = useCallback((partId) => {
    const p = parts.find((x) => x.id === partId)
    setForm((f) => ({
      ...f,
      part_id: partId,
      part_name: p ? (p.name || f.part_name) : f.part_name,
    }))
  }, [parts])

  const onPickJob = useCallback((jobId) => {
    const j = jobs.find((x) => x.id === jobId)
    setForm((f) => ({
      ...f,
      job_id: jobId,
      asset_no: j ? (j.asset_no || f.asset_no) : f.asset_no,
      site: f.site,
    }))
  }, [jobs])

  const submitForm = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.part_id && !String(form.part_name || '').trim()) {
      setFormError('Select a part or enter a part name.')
      return
    }
    setSaving(true)
    try {
      const job = jobs.find((x) => x.id === form.job_id)
      const created = await createPartsRequest({
        ...form,
        site: job?.site || null,
        needed_by: form.needed_by ? new Date(form.needed_by).toISOString() : null,
        country: activeCountry !== 'All' ? activeCountry : null,
      })
      if (created) setRows((r) => [created, ...r])
      setShowModal(false)
      setForm({ ...EMPTY_FORM })
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not raise the request.'))
    } finally {
      setSaving(false)
    }
  }, [form, jobs, activeCountry])

  // ── Exports (whole filtered set, never one page) ─────────────────────────
  const EXPORT_COLS = ['requested_at', 'part_name', 'qty', 'asset_no', 'site', 'priority', 'status', 'needed_by', 'overdue', 'age', 'fulfilled_at']
  const EXPORT_HEADERS = ['Requested', 'Part', 'Qty', 'Asset', 'Site', 'Priority', 'Status', 'Needed by', 'Overdue', 'Age', 'Fulfilled']
  const exportRows = () => requestExportRows(decoratedFiltered)
  const exportExcel = () => {
    const name = reportFileName('Parts Requests', reportDateLabel())
    exportToExcel(exportRows(), EXPORT_COLS, EXPORT_HEADERS, name, 'Parts Requests', { title: 'Parts Requests', currency: activeCurrency })
  }
  const exportPdf = () => {
    const name = reportFileName('Parts Requests', reportDateLabel())
    exportToPdf(exportRows(), EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Parts Requests Report', name, 'landscape', '', { currency: activeCurrency })
  }

  const columns = useMemo(() => {
    const base = [
      { id: 'requested_at', header: 'Requested', accessorFn: (r) => r.requested_at || undefined, size: 160, sortingFn: valueSort, sortUndefined: 'last',
        cell: ({ getValue }) => <span className="text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(getValue())}</span> },
      { id: 'part_name', header: 'Part', accessorFn: (r) => r.part_name || undefined, size: 200, sortingFn: valueSort, sortUndefined: 'last',
        cell: ({ getValue }) => <span className="text-[var(--text-primary)]">{getValue() ?? 'N/A'}</span> },
      { id: 'qty', header: 'Qty', accessorFn: (r) => (Number.isFinite(Number(r.qty)) ? Number(r.qty) : undefined), size: 70, sortingFn: valueSort, sortUndefined: 'last',
        cell: ({ getValue }) => <span className="tabular-nums">{fmtNum(getValue())}</span>, meta: { align: 'right' } },
      { id: 'asset_no', header: 'Asset', accessorFn: (r) => r.asset_no || undefined, size: 110, sortingFn: valueSort, sortUndefined: 'last', cell: ({ getValue }) => getValue() ?? 'N/A' },
      { id: 'site', header: 'Site', accessorFn: (r) => r.site || undefined, size: 120, sortingFn: valueSort, sortUndefined: 'last', cell: ({ getValue }) => getValue() ?? 'N/A' },
      { id: 'priority', header: 'Priority', accessorFn: (r) => PRIORITY_RANK[r.priority] ?? 9, size: 100, sortingFn: valueSort,
        cell: ({ row }) => <span className={`text-xs font-medium ${PRIORITY_TONE[row.original.priority] || 'text-[var(--text-secondary)]'}`}>{PARTS_PRIORITY_LABEL[row.original.priority] || row.original.priority || 'N/A'}</span>,
        meta: { exportValue: (r) => PARTS_PRIORITY_LABEL[r.priority] || r.priority || 'N/A' } },
      { id: 'needed_by', header: 'Needed by', accessorFn: (r) => r.needed_by || undefined, size: 150, sortingFn: valueSort, sortUndefined: 'last',
        cell: ({ row }) => {
          const r = row.original
          if (!r.needed_by) return <span className="text-[var(--text-muted)]">N/A</span>
          return <span className={r._overdue ? 'text-red-300 font-medium' : 'text-[var(--text-secondary)]'}>{fmtDate(r.needed_by)}{r._overdue ? ' (overdue)' : ''}</span>
        } },
      { id: 'age', header: 'Age', accessorFn: (r) => r._ageHours ?? undefined, size: 80, sortingFn: valueSort, sortUndefined: 'last',
        cell: ({ getValue }) => <span className="tabular-nums text-[var(--text-secondary)]">{fmtAge(getValue())}</span>, meta: { align: 'right', exportValue: (r) => fmtAge(r._ageHours) } },
      { id: 'status', header: 'Status', accessorFn: (r) => PARTS_STATUS_LABEL[r._status] || r.status || 'N/A', size: 110, sortingFn: valueSort,
        cell: ({ row, getValue }) => <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${STATUS_TONE[row.original._status] || STATUS_TONE.cancelled}`}>{getValue()}</span> },
    ]
    if (!canWrite) return base
    return [...base, {
      id: 'actions', header: 'Actions', enableSorting: false, size: 210, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        const status = r._status
        const fwd = FORWARD_ACTION[status]
        const FwdIcon = fwd?.icon
        const rowBusy = busyId === r.id
        const name = r.part_name || 'request'
        if (!r._open) return <span className="text-[11px] text-[var(--text-muted)]">Closed</span>
        return (
          <div className="inline-flex items-center gap-1.5">
            {fwd && (
              <button type="button" onClick={() => advance(r, nextPartsStatus(status))} disabled={rowBusy}
                className="inline-flex items-center gap-1 px-2.5 min-h-[44px] text-[11px] rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white disabled:opacity-60">
                {rowBusy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : (FwdIcon && <FwdIcon size={12} aria-hidden="true" />)} {fwd.label}<span className="sr-only"> {name}</span>
              </button>
            )}
            <button type="button" onClick={() => advance(r, 'rejected')} disabled={rowBusy}
              className="inline-flex items-center gap-1 px-2.5 min-h-[44px] text-[11px] rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-muted)] hover:text-red-300 hover:border-red-500/40 disabled:opacity-60">
              <Ban size={12} aria-hidden="true" /> Reject<span className="sr-only"> {name}</span>
            </button>
          </div>
        )
      },
    }]
  }, [canWrite, busyId, advance])

  const kpis = [
    { label: 'Open Requests', value: fmtNum(summary.open), icon: Boxes },
    { label: 'Overdue', value: fmtNum(summary.overdue), icon: AlertTriangle, tone: summary.overdue > 0 ? 'text-red-300' : undefined },
    { label: 'Fulfilled Today', value: fmtNum(fulfilledToday), icon: CheckCircle2 },
    { label: 'Avg Fulfil Hours', value: fmtHours(summary.avgFulfilOreHours), icon: Clock },
    { label: 'Fill Rate', value: fill == null ? 'N/A' : `${fill}%`, icon: Percent, hint: 'Fulfilled against every request that reached a final outcome' },
    { label: 'Open Over 7 Days', value: fmtNum(ageing.buckets.find((b) => b.key === 'gt7d')?.count ?? 0), icon: Hourglass, tone: (ageing.buckets.find((b) => b.key === 'gt7d')?.count ?? 0) > 0 ? 'text-amber-300' : undefined },
  ]

  const inputCls = 'w-full min-h-[44px] rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus:border-blue-500'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parts Requests"
        subtitle="Technicians raise parts requests for their jobs; a foreman or storekeeper approves and issues them, which resolves blocked-for-parts time on the workshop board."
        icon={PackagePlus}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={canWrite && (
          <button type="button" onClick={openModal} className="btn-primary text-sm min-h-[44px] inline-flex items-center gap-1.5" disabled={missing}>
            <Plus size={14} aria-hidden="true" /> New request
          </button>
        )}
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Parts Requests is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply the <span className="font-mono text-[var(--text-primary)]">v296_parts_requests</span> migration, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-red-300 font-medium">{failedFirstLoad ? 'Parts requests could not be loaded.' : 'Something went wrong.'}</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 px-3 min-h-[44px] text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card" title={k.hint}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
              </div>
              {loading
                ? <div className="h-7 w-12 mt-1 rounded bg-[var(--input-bg)] animate-pulse" />
                : <p className={`text-xl font-bold mt-1 tabular-nums ${k.tone || 'text-[var(--text-primary)]'}`}>{failedFirstLoad ? 'N/A' : k.value}</p>}
            </div>
          )
        })}
      </div>

      {/* RULE 2: when the tiles cover a narrowed set, say so. A silently
          narrowed KPI is the same defect one level down. */}
      {!loading && scopeNarrowed && (
        <p className="text-xs text-[var(--text-muted)] -mt-1">
          These figures cover the {fmtNum(scoped.length)} request{scoped.length === 1 ? '' : 's'} matching
          your site and search filters, of {fmtNum(rows.length)} in total. They ignore the status filter so
          the status figures stay readable.
        </p>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <PieChart size={16} className="text-[var(--text-secondary)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">Requests by status</h3>
          </div>
          <div className="h-[240px]">
            {summary.total === 0
              ? <EmptyChart />
              : <EChart option={statusChartOption} className="h-full" ariaLabel="Requests by status" />}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={16} className="text-[var(--text-secondary)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">Most requested parts</h3>
          </div>
          <div className="h-[240px]">
            {summary.byPart.length === 0
              ? <EmptyChart />
              : <EChart option={partChartOption} className="h-full" ariaLabel="Most requested parts" />}
          </div>
        </div>
      </div>

      {/* Open-request ageing + priority */}
      {!loading && !failedFirstLoad && summary.open > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Hourglass size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
              <h3 className="font-semibold text-[var(--text-primary)]">How long open requests have waited</h3>
            </div>
            <ul className="space-y-2">
              {ageing.buckets.map((b) => (
                <li key={b.key} className="flex items-center gap-3 text-sm">
                  <span className="w-28 text-[var(--text-secondary)]">{b.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                    <div className="h-full" style={{ width: `${summary.open ? (b.count / summary.open) * 100 : 0}%`, background: b.key === 'gt7d' ? '#f59e0b' : colorAt(0) }} />
                  </div>
                  <span className="w-10 text-right tabular-nums text-[var(--text-primary)]">{b.count}</span>
                </li>
              ))}
            </ul>
            {ageing.undated > 0 && <p className="text-[11px] text-[var(--text-muted)] mt-2">{ageing.undated} open request{ageing.undated === 1 ? '' : 's'} carry no request time and are not aged.</p>}
          </div>
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
              <h3 className="font-semibold text-[var(--text-primary)]">Open requests by priority</h3>
            </div>
            <ul className="grid grid-cols-2 gap-2">
              {priorities.byPriority.map((p) => (
                <li key={p.priority} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                  <p className={`text-xs font-medium ${PRIORITY_TONE[p.priority] || 'text-[var(--text-secondary)]'}`}>{p.label}</p>
                  <p className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{p.count}</p>
                </li>
              ))}
            </ul>
            {priorities.other > 0 && <p className="text-[11px] text-[var(--text-muted)] mt-2">{priorities.other} open request{priorities.other === 1 ? '' : 's'} carry no recognised priority.</p>}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <Filter size={15} /> <span className="text-sm font-medium">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Status</span>
            <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={inputCls}>
              <option value="All">All statuses</option>
              {PARTS_STATUS.map((s) => <option key={s} value={s}>{PARTS_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1">
            <span>Site</span>
            <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)} className={inputCls}>
              <option value="All">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
            <span>Search</span>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input value={filters.q} onChange={(e) => setFilter('q', e.target.value)} className={`${inputCls} pl-9`} placeholder="Part, asset or note..." />
            </div>
          </label>
        </div>
        {(filters.status !== 'All' || filters.site !== 'All' || filters.q) && (
          <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1.5 px-3 min-h-[44px] text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X size={13} aria-hidden="true" /> Clear filters
          </button>
        )}
      </div>

      {/* Register */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardList size={16} className="text-[var(--text-secondary)]" aria-hidden="true" />
          <h3 className="font-semibold text-[var(--text-primary)]">Parts requests</h3>
          <span className="text-[11px] text-[var(--text-muted)]" aria-live="polite">{failedFirstLoad ? 'Not loaded' : `${filtered.length} shown`}</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={exportExcel} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 px-3 min-h-[44px] text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={exportPdf} disabled={filtered.length === 0} className="inline-flex items-center gap-1.5 px-3 min-h-[44px] text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        </div>
        <EnterpriseTable
          columns={columns}
          data={decoratedFiltered}
          getRowId={(r) => String(r.id)}
          loading={loading}
          error={failedFirstLoad ? error : null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          emptyIcon={<Boxes size={28} className="opacity-50" aria-hidden="true" />}
          emptyMessage={rows.length === 0 ? 'No parts requests yet.' : 'No requests match the filters.'}
        />
      </div>

      {/* New request modal */}
      <Modal
        open={showModal}
        onClose={() => !saving && setShowModal(false)}
        title="New parts request"
        size="lg"
        footer={(
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setShowModal(false)} disabled={saving} className="btn-secondary text-sm min-h-[44px]">Cancel</button>
            <button type="submit" form="parts-request-form" disabled={saving} className="btn-primary text-sm min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-60">
              {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />} Raise request
            </button>
          </div>
        )}
      >
            {formError && (
              <div role="alert" className="mb-4 rounded-lg border border-red-800/50 bg-red-500/10 flex items-center gap-2 px-3 py-2">
                <AlertTriangle size={15} className="text-red-400" />
                <span className="text-sm text-red-200">{formError}</span>
              </div>
            )}

            <form id="parts-request-form" onSubmit={submitForm} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
                <span>Job (open work order) <span className="text-[var(--text-muted)]">(optional)</span></span>
                <select value={form.job_id} onChange={(e) => onPickJob(e.target.value)} className={inputCls} disabled={pickerLoading}>
                  <option value="">{pickerLoading ? 'Loading jobs...' : 'No job / general request'}</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {[j.work_order_no || j.id.slice(0, 8), j.asset_no, j.status].filter(Boolean).join(' | ')}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Part (catalog)</span>
                <select value={form.part_id} onChange={(e) => onPickPart(e.target.value)} className={inputCls} disabled={pickerLoading}>
                  <option value="">{pickerLoading ? 'Loading parts...' : 'Not in catalog / type name'}</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {[p.part_no, p.name].filter(Boolean).join(' - ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Part name <span className="text-red-400">*</span></span>
                <input value={form.part_name} onChange={(e) => setField('part_name', e.target.value)} className={inputCls} placeholder="e.g. Brake pad set" />
              </label>

              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Quantity</span>
                <input type="number" min="1" step="any" value={form.qty} onChange={(e) => setField('qty', e.target.value)} className={inputCls} />
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Priority</span>
                <select value={form.priority} onChange={(e) => setField('priority', e.target.value)} className={inputCls}>
                  {PARTS_PRIORITIES.map((p) => <option key={p} value={p}>{PARTS_PRIORITY_LABEL[p]}</option>)}
                </select>
              </label>

              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Asset <span className="text-[var(--text-muted)]">(optional)</span></span>
                <input value={form.asset_no} onChange={(e) => setField('asset_no', e.target.value)} className={inputCls} placeholder="auto-filled from job" />
              </label>
              <label className="text-xs text-[var(--text-muted)] space-y-1">
                <span>Needed by <span className="text-[var(--text-muted)]">(optional)</span></span>
                <input type="date" value={form.needed_by} onChange={(e) => setField('needed_by', e.target.value)} className={inputCls} />
              </label>

              <label className="text-xs text-[var(--text-muted)] space-y-1 sm:col-span-2">
                <span>Notes <span className="text-[var(--text-muted)]">(optional)</span></span>
                <input value={form.notes} onChange={(e) => setField('notes', e.target.value)} className={inputCls} placeholder="optional" />
              </label>

            </form>
      </Modal>
    </div>
  )
}

function EmptyChart({ hint = 'No requests yet.' }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)]">
      <Boxes size={26} className="opacity-40 mb-2" />
      <p className="text-xs">{hint}</p>
    </div>
  )
}
