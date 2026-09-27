/**
 * Recall Tracker (route /recalls) - tyre recall registry and batch quality.
 *
 * Five tabs: Registry, Batch Detector, Timeline, Brand History, Analytics.
 * Every calculation that is not a KPI tile lives in the pure engine
 * `src/lib/recallTrackerAnalytics.js`; recall-to-tyre matching delegates to
 * `recallDetailAnalytics.matchRecallTyres` so this registry and the
 * /recalls/:id detail page always agree on which tyres a recall covers.
 *
 * The KPI tiles deliberately stay inline (see kpiFilterAwareness.test.js):
 * they cover the severity/source/search scope and hold out status.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  AlertTriangle, AlertOctagon, ShieldAlert, ShieldCheck, ShieldQuestion,
  Plus, X, Search, FileText, FileSpreadsheet, Eye, RefreshCw,
  CheckCircle, Clock, Activity, Package, BarChart3,
  GitBranch, Star, Loader2, Flag, Pencil, Trash2, ArrowRight, Info,
} from 'lucide-react'
import * as recallsApi from '../lib/api/recalls'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme, reportFileName } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/EmptyState'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { loadAutoTable } from '../lib/pdfEngine'
import { compareValues } from '../lib/consoleTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import { matchRecallTyres } from '../lib/recallDetailAnalytics'
import {
  RECALL_SEVERITIES, RECALL_STATUSES, RECALL_SOURCES,
  recallMatchesSearch, sortRecallsNewestFirst, buildAffectedIndex,
  registryRows, detectBatchFailures, brandRecallHistory, recallBreakdowns,
  daysBetween,
} from '../lib/recallTrackerAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
)

// Chart ink comes from CSS tokens (resolved per theme by chartVarPlugin), so
// the analytics tab reads correctly in both light and dark mode.
const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: 'var(--text-primary)',
      bodyColor: 'var(--text-secondary)',
    },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 }, precision: 0 }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}

// Severity and status colours are SEMANTIC (a red Critical carries meaning),
// so they stay fixed rather than following the report palette.
const SEVERITY_CFG = {
  Critical: { text: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700',    dot: 'bg-red-500',    hex: '#ef4444', pdfColor: [127, 29, 29] },
  High:     { text: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-700', dot: 'bg-orange-500', hex: '#f97316', pdfColor: [124, 45, 18] },
  Medium:   { text: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', dot: 'bg-yellow-500', hex: '#eab308', pdfColor: [113, 63, 18] },
  Low:      { text: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700',   dot: 'bg-blue-500',   hex: '#3b82f6', pdfColor: [30, 58, 138] },
}

const STATUS_CFG = {
  Active:     { text: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700',    hex: '#ef4444' },
  Monitoring: { text: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', hex: '#eab308' },
  Closed:     { text: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700',  hex: '#22c55e' },
}

const SOURCE_OPTS  = RECALL_SOURCES
const STATUS_OPTS  = RECALL_STATUSES
const SEVERITY_OPTS = RECALL_SEVERITIES
const TAB_OPTS = ['Registry', 'Batch Detector', 'Timeline', 'Brand History', 'Analytics']

// One sort rule for every column: consoleTable's null-last, number/date aware
// comparison, with blanks pushed to the end whatever the direction.
const SORT = {
  sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
  sortUndefined: 'last',
}
const blankToUndef = (v) => (v == null || v === '' ? undefined : v)

const inputCls = 'w-full min-h-[44px] px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] placeholder-[var(--text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const iconBtn = 'inline-flex items-center justify-center min-w-[36px] min-h-[36px] rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

function nowStr() {
  return formatDate(new Date(), 'All', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Badge({ label, cfg, small }) {
  const c = cfg ?? { text: 'text-[var(--text-muted)]', bg: 'bg-[var(--input-bg)]', border: 'border-[var(--input-border)]' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold whitespace-nowrap ${c.text} ${c.bg} ${c.border} ${small ? 'text-[10px]' : ''}`}>
      {c.dot && <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />}
      {label || 'Not set'}
    </span>
  )
}

/** First few sizes as chips, the rest summarised - never silently dropped. */
function SizeChips({ sizes, max = 3 }) {
  const list = Array.isArray(sizes) ? sizes : []
  if (!list.length) return <span className="text-xs text-[var(--text-muted)]">None listed</span>
  const shown = list.filter((_, i) => i < max)
  return (
    <div className="flex flex-wrap gap-1" title={list.join(', ')}>
      {shown.map((s) => (
        <span key={s} className="px-1.5 py-0.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded text-[10px] text-[var(--text-dim)] font-mono">{s}</span>
      ))}
      {list.length > max && <span className="text-[var(--text-muted)] text-[10px]">+{list.length - max} more</span>}
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub, color = 'text-blue-400', warn }) {
  return (
    <div
      className={`bg-[var(--surface-1)] border ${warn ? 'border-red-700/60' : 'border-[var(--input-border)]'} rounded-xl p-4 flex items-start gap-3`}
    >
      <div className={`p-2 rounded-lg bg-[var(--input-bg)] ${color}`} aria-hidden="true">
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[var(--text-muted)] text-xs">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 tabular-nums ${color}`}>{value}</p>
        {sub && <p className="text-[var(--text-muted)] text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

const EMPTY_FORM = {
  recall_number: '',
  brand: '',
  affected_sizes: [],
  affected_serial_prefix: '',
  issue_date: '',
  severity: 'High',
  description: '',
  action_required: '',
  source: 'Manufacturer',
  status: 'Active',
}

export default function RecallTracker() {
  const navigate = useNavigate()
  const { profile, isSuperAdmin } = useAuth()
  const { appSettings } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const isAdmin = profile?.role === 'Admin' || isSuperAdmin === true

  const [tyres, setTyres]       = useState([])
  const [recalls, setRecalls]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [recallsLoading, setRecallsLoading] = useState(true)
  const [tyresError, setTyresError] = useState('')
  const [tyresTruncated, setTyresTruncated] = useState(false)
  const [activeTab, setActiveTab] = useState('Registry')

  const [search, setSearch]       = useState('')
  const [filterSeverity, setFilterSeverity] = useState('All')
  const [filterStatus, setFilterStatus]     = useState('All')
  const [filterSource, setFilterSource]     = useState('All')

  const [showAddModal, setShowAddModal]   = useState(false)
  const [editRecall, setEditRecall]       = useState(null)
  const [form, setForm]                   = useState(EMPTY_FORM)
  const [sizeInput, setSizeInput]         = useState('')
  const [formError, setFormError]         = useState('')
  const [saving, setSaving]               = useState(false)
  const [actionError, setActionError]     = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting]           = useState(false)
  const [exporting, setExporting]         = useState(false)

  const listRef   = useRef(null)

  const [recallsError, setRecallsError] = useState('')

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadRecalls = useCallback(async () => {
    setRecallsLoading(true)
    try {
      setRecallsError('')
      const data = await recallsApi.listRecalls()
      setRecalls(data ?? [])
    } catch (e) {
      setRecallsError(toUserMessage(e, 'Could not load recall records. Please retry.'))
      setRecalls([])
    } finally {
      setRecallsLoading(false)
    }
  }, [])

  const loadTyres = useCallback(async () => {
    setLoading(true)
    setTyresError('')
    try {
      const res = await recallsApi.listRecallTyres()
      if (res?.error) throw res.error
      setTyres(res?.data ?? [])
      setTyresTruncated(Boolean(res?.truncated))
    } catch (e) {
      // A failed tyre read must not read as "no affected tyres": the counts
      // below say they are unavailable instead of showing zero.
      setTyresError(toUserMessage(e, 'Could not load the tyre register used for matching.'))
      setTyres([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadRecalls() }, [loadRecalls])
  useEffect(() => { loadTyres() }, [loadTyres])

  const refreshAll = useCallback(() => { loadRecalls(); loadTyres() }, [loadRecalls, loadTyres])

  // ── Matching: every recall against the register ONCE ─────────────────────────
  const affectedIndex = useMemo(() => buildAffectedIndex(recalls, tyres), [recalls, tyres])
  const matchTyresForRecall = useCallback(
    (recall) => affectedIndex.get(recall?.id) ?? matchRecallTyres(recall, tyres),
    [affectedIndex, tyres],
  )
  const matchingAvailable = !tyresError

  /**
   * The SCOPE the KPI tiles cover: severity, source and search - but NOT status.
   *
   * Status is held out because two of the four tiles (Active Recalls, Avg Days
   * to Close) ARE status readings, and counting them over a status-narrowed set
   * makes each one restate the status the reader already picked. Every other
   * filter DOES apply: these tiles used to be computed over the raw `recalls`,
   * so narrowing to one severity left them stating registry-wide figures above
   * a table showing that severity alone.
   */
  const kpiScope = useMemo(() => {
    const q = String(search || '').trim().toLowerCase()
    return recalls.filter(r => {
      if (filterSeverity !== 'All' && r.severity !== filterSeverity) return false
      if (filterSource !== 'All' && r.source !== filterSource) return false
      if (q) return recallMatchesSearch(r, q)
      return true
    })
  }, [recalls, filterSeverity, filterSource, search])

  const kpiScopeNarrowed = kpiScope.length !== recalls.length

  // ── Derived KPIs ───────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const active = kpiScope.filter(r => r.status === 'Active')
    const affectedSet = new Set()
    active.forEach(r => matchTyresForRecall(r).forEach(t => affectedSet.add(t.id)))
    const recallsWithHit = active.filter(r => matchTyresForRecall(r).length > 0).length

    const closed = kpiScope.filter(r => r.status === 'Closed' && r.closed_at && r.issue_date)
    const avgDays = closed.length > 0
      ? Math.round(closed.reduce((s, r) => s + (daysBetween(r.issue_date, r.closed_at) ?? 0), 0) / closed.length)
      : null

    return {
      activeCount: active.length,
      affectedTyres: affectedSet.size,
      // Null (N/A) when there is no active recall to respond to: 0% would
      // read as a failure to act on recalls that do not exist.
      responseRate: active.length > 0 ? Math.round((recallsWithHit / active.length) * 100) : null,
      avgDaysToClose: avgDays,
    }
  }, [kpiScope, matchTyresForRecall])

  // ── Filtered recalls ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return sortRecallsNewestFirst(recalls.filter(r => {
      if (filterSeverity !== 'All' && r.severity !== filterSeverity) return false
      if (filterStatus !== 'All' && r.status !== filterStatus) return false
      if (filterSource !== 'All' && r.source !== filterSource) return false
      return recallMatchesSearch(r, search)
    }))
  }, [recalls, filterSeverity, filterStatus, filterSource, search])

  const tableRows = useMemo(() => registryRows(filtered, affectedIndex), [filtered, affectedIndex])

  // Plain-English description of the registry filters, so an exported document
  // states the scope it actually covers. A recall report is a safety record: a
  // file headed "Recall Registry" that silently holds only the Critical/Active
  // subset is read as the whole registry long after the screen is gone.
  const filterSummary = useMemo(() => {
    const parts = []
    const q = String(search || '').trim()
    if (q) parts.push(`search "${q}"`)
    if (filterSeverity !== 'All') parts.push(`severity: ${filterSeverity}`)
    if (filterStatus !== 'All') parts.push(`status: ${filterStatus}`)
    if (filterSource !== 'All') parts.push(`source: ${filterSource}`)
    return parts.length ? parts.join(', ') : ''
  }, [search, filterSeverity, filterStatus, filterSource])

  const filtersActive = Boolean(filterSummary)
  const clearFilters = () => {
    setSearch(''); setFilterSeverity('All'); setFilterStatus('All'); setFilterSource('All')
  }

  // Subtitle for both exports. Names the covered subset whenever a filter is on.
  const exportScopeLine = useMemo(() => (
    filterSummary
      ? `${filtered.length} of ${recalls.length} recalls, filtered by ${filterSummary}`
      : `${filtered.length} recalls (all)`
  ), [filtered.length, recalls.length, filterSummary])

  // ── Batch failure detector ─────────────────────────────────────────────────
  const batchResult = useMemo(() => detectBatchFailures(tyres), [tyres])
  const batchAnalysis = batchResult.batches

  // ── Brand history ──────────────────────────────────────────────────────────
  const brandHistory = useMemo(() => brandRecallHistory(recalls), [recalls])

  // ── Timeline ──────────────────────────────────────────────────────────────
  const timeline = useMemo(() => sortRecallsNewestFirst(recalls), [recalls])

  // ── Analytics chart data ───────────────────────────────────────────────────
  const breakdown = useMemo(() => recallBreakdowns(filtered), [filtered])
  const chartData = useMemo(() => ({
    severity: {
      labels: SEVERITY_OPTS,
      datasets: [{
        label: 'Recalls',
        data: SEVERITY_OPTS.map(s => breakdown.severity[s]),
        backgroundColor: SEVERITY_OPTS.map(s => SEVERITY_CFG[s].hex),
        borderRadius: 4,
      }],
    },
    status: {
      labels: STATUS_OPTS,
      datasets: [{
        label: 'Recalls',
        data: STATUS_OPTS.map(s => breakdown.status[s]),
        backgroundColor: STATUS_OPTS.map(s => STATUS_CFG[s].hex),
        borderRadius: 4,
      }],
    },
    source: {
      labels: Object.keys(breakdown.source),
      datasets: [{
        label: 'Recalls',
        data: Object.values(breakdown.source),
        backgroundColor: Object.keys(breakdown.source).map((_, i) => colorAt(i)),
        borderRadius: 4,
      }],
    },
    monthly: {
      labels: breakdown.months,
      datasets: [{
        label: 'Recalls issued',
        data: breakdown.monthCounts,
        borderColor: colorAt(0),
        backgroundColor: withAlpha(colorAt(0), 0.15),
        fill: true,
        tension: 0.35,
      }],
    },
  }), [breakdown])

  const activeInView = useMemo(
    () => tableRows.filter(r => r.status === 'Active').sort((a, b) => b.affected - a.affected),
    [tableRows],
  )
  const maxActiveAffected = useMemo(
    () => Math.max(1, ...activeInView.map(r => r.affected)),
    [activeInView],
  )

  // ── Form helpers ──────────────────────────────────────────────────────────
  function openAdd() {
    setForm(EMPTY_FORM)
    setSizeInput('')
    setFormError('')
    setEditRecall(null)
    setShowAddModal(true)
  }

  function openEdit(r) {
    setForm({ ...EMPTY_FORM, ...r, affected_sizes: r.affected_sizes ?? [], affected_serial_prefix: r.affected_serial_prefix ?? '', description: r.description ?? '', action_required: r.action_required ?? '' })
    setSizeInput('')
    setFormError('')
    setEditRecall(r.id)
    setShowAddModal(true)
  }

  const closeForm = useCallback(() => { if (!saving) setShowAddModal(false) }, [saving])

  function addSize() {
    const s = sizeInput.trim()
    if (!s) return
    if (!form.affected_sizes.includes(s)) {
      setForm(f => ({ ...f, affected_sizes: [...f.affected_sizes, s] }))
    }
    setSizeInput('')
  }

  function removeSize(s) {
    setForm(f => ({ ...f, affected_sizes: f.affected_sizes.filter(x => x !== s) }))
  }

  async function handleSave() {
    if (!form.recall_number.trim()) { setFormError('Recall number required'); return }
    if (!form.brand.trim()) { setFormError('Brand required'); return }
    if (!form.issue_date) { setFormError('Issue date required'); return }
    if (form.affected_sizes.length === 0) { setFormError('At least one affected size required'); return }

    setSaving(true)
    setFormError('')
    try {
      const row = {
        recall_number: form.recall_number.trim(),
        brand: form.brand.trim(),
        affected_sizes: form.affected_sizes ?? [],
        affected_serial_prefix: form.affected_serial_prefix || null,
        issue_date: form.issue_date || null,
        severity: form.severity || 'High',
        description: form.description || null,
        action_required: form.action_required || null,
        source: form.source || 'Manufacturer',
        status: form.status || 'Active',
        country: form.country || profile?.country || null,
        closed_at: form.status === 'Closed' ? new Date().toISOString() : null,
      }
      if (editRecall) {
        await recallsApi.updateRecall(editRecall, row)
      } else {
        await recallsApi.createRecall({ ...row, created_by: profile?.id ?? null })
      }
      await loadRecalls()
      setShowAddModal(false)
    } catch (e) {
      // 23505 = unique_violation on (recall_number, country)
      if (e?.code === '23505') { setFormError('Recall number already exists'); setSaving(false); return }
      setFormError(toUserMessage(e, 'Could not save the recall. Please retry.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleClose(recallId) {
    setActionError('')
    try {
      await recallsApi.updateRecall(recallId, { status: 'Closed', closed_at: new Date().toISOString() })
      await loadRecalls()
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not close the recall.'))
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setActionError('')
    setDeleting(true)
    try {
      await recallsApi.deleteRecall(confirmDelete.id)
      setConfirmDelete(null)
      await loadRecalls()
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not delete the recall.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const closeDeleteDialog = useCallback(() => { if (!deleting) setConfirmDelete(null) }, [deleting])

  // ── Detail navigation ───────────────────────────────────────────────────────
  // The affected-tyres record + approval workflow moved to the routed
  // /recalls/:recallId detail page (RecallDetail.jsx) - large multi-section view.
  function openRecall(recall) {
    navigate(`/recalls/${encodeURIComponent(recall.id)}`)
  }

  async function runExport(fn) {
    setActionError('')
    setExporting(true)
    try { await fn() } catch (e) { setActionError(toUserMessage(e, 'Could not export. Please retry.')) } finally { setExporting(false) }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)

    // ── EMPTY STATE ──
    // The export covers the filtered registry, so an empty document means the
    // filters matched nothing, not that the registry is empty.
    if (filtered.length === 0) {
      pdfHeader(doc, 'Tyre Recall & Batch Quality Tracker', `0 recalls | ${nowStr()}`, company, brand)
      pdfEmptyState(doc, filterSummary
        ? `No recalls match the current filters (${filterSummary})`
        : 'No recalls for the selected period')
      pdfFooter(doc, 1, 1, company, brand)
      doc.save(`${reportFileName('TyrePulse Recall Report', nowStr())}.pdf`)
      return
    }

    pdfHeader(doc, 'Tyre Recall & Batch Quality Tracker', `${exportScopeLine} | ${nowStr()}`, company, brand)

    doc.setFontSize(11)
    doc.setTextColor(30, 41, 59)
    doc.text(filterSummary ? 'Recalls (filtered)' : 'Recalls', 14, 30)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 34,
      head: [['Recall #', 'Brand', 'Affected Sizes', 'Date Issued', 'Severity', 'Source', 'Status', 'Description']],
      body: filtered.map(r => [
        r.recall_number,
        r.brand,
        (r.affected_sizes ?? []).join(', '),
        r.issue_date,
        r.severity,
        r.source,
        r.status,
        r.description,
      ]),
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const val = String(data.cell.raw ?? '').trim()
          const c = SEVERITY_CFG[val]?.pdfColor
          if (c) { data.cell.styles.fillColor = c; data.cell.styles.textColor = [255, 255, 255] }
        }
      },
    })

    // Affected tyres are listed for the active recalls WITHIN the exported
    // scope, so this page can never name a recall the first table left out.
    const affectedRows = []
    filtered.filter(r => r.status === 'Active').forEach(r => {
      matchTyresForRecall(r).forEach(t => {
        affectedRows.push([r.recall_number, t.serial_number, t.asset_no, t.position, t.site, t.country, t.km_at_removal ? 'Removed' : 'Fitted'])
      })
    })

    if (affectedRows.length > 0) {
      doc.addPage()
      pdfHeader(doc, 'Tyre Recall & Batch Quality Tracker', `Affected Fleet Tyres (Active Recalls in this report) | ${nowStr()}`, company, brand)
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 30,
        head: [['Recall #', 'Serial', 'Asset', 'Position', 'Site', 'Country', 'Status']],
        body: affectedRows,
        margin: { left: 14, right: 14 },
      })
    }

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
    doc.save(`${reportFileName('TyrePulse Recall Report', nowStr())}.pdf`)
  }

  async function exportExcel() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    // A workbook outlives the filters that produced it, so it states its own
    // scope on the first sheet rather than looking like the whole registry.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'Report': 'Tyre Recall & Batch Quality Registry',
      'Generated': nowStr(),
      'Recalls included': filtered.length,
      'Recalls in registry': recalls.length,
      'Filters applied': filterSummary || 'None (whole registry)',
    }]), 'Report Scope')

    const recallRows = filtered.map(r => ({
      'Recall #': r.recall_number,
      'Brand': r.brand,
      'Affected Sizes': (r.affected_sizes ?? []).join(', '),
      'Serial Prefix': r.affected_serial_prefix,
      'Issue Date': r.issue_date,
      'Severity': r.severity,
      'Source': r.source,
      'Status': r.status,
      'Description': r.description,
      'Action Required': r.action_required,
      'Created At': r.created_at,
      'Closed At': r.closed_at,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recallRows), 'Recalls')

    const affectedRows = []
    filtered.forEach(r => {
      matchTyresForRecall(r).forEach(t => {
        affectedRows.push({
          'Recall #': r.recall_number,
          'Brand': r.brand,
          'Severity': r.severity,
          'Serial Number': t.serial_number,
          'Asset No': t.asset_no,
          'Position': t.position,
          'Site': t.site,
          'Country': t.country,
          'Risk Level': t.risk_level,
          'Tyre Status': t.km_at_removal ? 'Removed' : 'Fitted',
        })
      })
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(affectedRows), 'Affected Tyres')

    XLSX.writeFile(wb, `${reportFileName('TyrePulse Recall Registry', nowStr())}.xlsx`)
  }

  // ── Table columns ─────────────────────────────────────────────────────────
  const registryColumns = useMemo(() => [
    {
      id: 'recall_number', header: 'Recall #', accessorFn: (r) => blankToUndef(r.recall_number), size: 130, ...SORT,
      cell: ({ row }) => <span className="font-mono text-xs text-blue-400">{row.original.recall_number || 'N/A'}</span>,
    },
    {
      id: 'brand', header: 'Brand', accessorFn: (r) => blankToUndef(r.brand), size: 130, ...SORT,
      cell: ({ row }) => <span className="font-medium text-[var(--text-secondary)]">{row.original.brand || 'N/A'}</span>,
    },
    {
      id: 'sizes', header: 'Affected sizes', accessorFn: (r) => blankToUndef(r.sizes_label), size: 190, ...SORT,
      cell: ({ row }) => <SizeChips sizes={row.original.affected_sizes} />,
      meta: { exportValue: (r) => r.sizes_label },
    },
    {
      id: 'issue_date', header: 'Date issued', accessorFn: (r) => blankToUndef(r.issue_date), size: 120, ...SORT,
      cell: ({ row }) => <span className="text-xs text-[var(--text-muted)] tabular-nums">{row.original.issue_date || 'N/A'}</span>,
    },
    {
      id: 'severity', header: 'Severity', size: 110, ...SORT,
      accessorFn: (r) => (SEVERITY_OPTS.includes(r.severity) ? SEVERITY_OPTS.length - SEVERITY_OPTS.indexOf(r.severity) : undefined),
      cell: ({ row }) => <Badge label={row.original.severity} cfg={SEVERITY_CFG[row.original.severity]} />,
      meta: { exportValue: (r) => r.severity },
    },
    { id: 'source', header: 'Source', accessorFn: (r) => blankToUndef(r.source), size: 120, ...SORT },
    {
      id: 'status', header: 'Status', accessorFn: (r) => blankToUndef(r.status), size: 110, ...SORT,
      cell: ({ row }) => <Badge label={row.original.status} cfg={STATUS_CFG[row.original.status]} />,
    },
    {
      id: 'days_open', header: 'Days open', accessorFn: (r) => blankToUndef(r.days_open), size: 100, ...SORT,
      meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)]">{row.original.days_open == null ? 'N/A' : row.original.days_open}</span>,
    },
    {
      id: 'affected', header: 'Fleet tyres', size: 110, ...SORT, meta: { align: 'right' },
      accessorFn: (r) => (matchingAvailable ? r.affected : undefined),
      cell: ({ row }) => {
        if (!matchingAvailable) return <span className="text-xs text-[var(--text-muted)]">Unavailable</span>
        const r = row.original
        return (
          <span className={`tabular-nums font-bold ${r.affected > 0 ? 'text-orange-400' : 'text-[var(--text-muted)]'}`}>
            {r.affected}
            {r.affected > 0 && <span className="font-normal text-[10px] text-[var(--text-muted)] ml-1">({r.affected_fitted} fitted)</span>}
          </span>
        )
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 170, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => openRecall(r)}
              className={`${iconBtn} gap-1 px-2 bg-blue-900/30 hover:bg-blue-900/60 border border-blue-700/50 text-blue-400 text-xs`}
            >
              <Eye size={12} aria-hidden="true" /> View
            </button>
            {isAdmin && r.status !== 'Closed' && (
              <button
                type="button"
                onClick={() => handleClose(r.id)}
                aria-label={`Mark recall ${r.recall_number || ''} as closed`}
                title="Mark as closed"
                className={`${iconBtn} bg-green-900/30 hover:bg-green-900/60 border border-green-700/50 text-green-400`}
              >
                <CheckCircle size={14} />
              </button>
            )}
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => openEdit(r)}
                  aria-label={`Edit recall ${r.recall_number || ''}`}
                  title="Edit"
                  className={`${iconBtn} text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(r)}
                  aria-label={`Delete recall ${r.recall_number || ''}`}
                  title="Delete"
                  className={`${iconBtn} text-[var(--text-muted)] hover:text-red-400 hover:bg-red-900/20`}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [isAdmin, matchingAvailable])

  const brandColumns = useMemo(() => [
    {
      id: 'brand', header: 'Brand', accessorKey: 'brand', size: 160, ...SORT,
      cell: ({ row }) => (
        <span className="font-medium text-[var(--text-secondary)] inline-flex items-center gap-2">
          {row.original.score < 60 && <AlertTriangle className="text-red-400" size={13} aria-label="Low reliability" />}
          {row.original.brand}
        </span>
      ),
    },
    { id: 'total', header: 'Total recalls', accessorKey: 'total', size: 110, ...SORT, meta: { align: 'right' } },
    {
      id: 'active', header: 'Active', accessorKey: 'active', size: 90, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => <span className={row.original.active > 0 ? 'text-red-400 font-bold' : 'text-[var(--text-muted)]'}>{row.original.active}</span>,
    },
    {
      id: 'critical', header: 'Critical', accessorKey: 'critical', size: 90, ...SORT, meta: { align: 'right' },
      cell: ({ row }) => <span className={row.original.critical > 0 ? 'text-orange-400 font-bold' : 'text-[var(--text-muted)]'}>{row.original.critical}</span>,
    },
    {
      id: 'avgDaysToClose', header: 'Avg days to close', accessorFn: (b) => blankToUndef(b.avgDaysToClose), size: 130, ...SORT,
      meta: { align: 'right', exportValue: (b) => (b.avgDaysToClose == null ? 'N/A' : b.avgDaysToClose) },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-muted)]">{row.original.avgDaysToClose == null ? 'N/A' : `${row.original.avgDaysToClose} d`}</span>,
    },
    {
      id: 'score', header: 'Reliability score', accessorKey: 'score', size: 170, ...SORT,
      cell: ({ row }) => {
        const b = row.original
        const tone = b.score >= 80 ? 'text-green-400' : b.score >= 60 ? 'text-yellow-400' : 'text-red-400'
        const bar = b.score >= 80 ? 'bg-green-500' : b.score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
        return (
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 bg-[var(--input-border)] rounded-full overflow-hidden" aria-hidden="true">
              <div className={`h-full rounded-full ${bar}`} style={{ width: `${b.score}%` }} />
            </div>
            <span className={`text-xs font-bold tabular-nums ${tone}`}>{b.score}</span>
            {b.score < 60 && <span className="text-red-400 text-[10px] font-semibold">LOW</span>}
          </div>
        )
      },
    },
  ], [])

  const batchColumns = useMemo(() => [
    {
      id: 'severity', header: 'Signal', accessorKey: 'severity', size: 130, ...SORT,
      cell: ({ row }) => {
        const high = row.original.rate >= 60
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border ${high ? 'bg-red-900/40 text-red-300 border-red-700' : 'bg-orange-900/40 text-orange-300 border-orange-700'}`}>
            <Flag size={11} aria-hidden="true" /> {row.original.severity}
          </span>
        )
      },
    },
    { id: 'brand', header: 'Brand', accessorKey: 'brand', size: 130, ...SORT },
    {
      id: 'prefix', header: 'Serial batch', accessorKey: 'prefix', size: 110, ...SORT,
      cell: ({ row }) => <span className="font-mono text-yellow-400">{row.original.prefix}****</span>,
    },
    { id: 'total', header: 'Tyres', accessorKey: 'total', size: 80, ...SORT, meta: { align: 'right' } },
    { id: 'rated', header: 'Rated', accessorKey: 'rated', size: 80, ...SORT, meta: { align: 'right' } },
    { id: 'failed', header: 'High or critical', accessorKey: 'failed', size: 120, ...SORT, meta: { align: 'right' } },
    {
      id: 'rate', header: 'Failure rate', accessorKey: 'rate', size: 150, ...SORT,
      cell: ({ row }) => {
        const b = row.original
        return (
          <div className="flex items-center gap-2">
            <div className="w-16 h-2 bg-[var(--input-border)] rounded-full overflow-hidden" aria-hidden="true">
              <div className={`h-full rounded-full ${b.rate >= 60 ? 'bg-red-500' : 'bg-orange-500'}`} style={{ width: `${b.rate}%` }} />
            </div>
            <span className="text-xs font-bold text-red-400 tabular-nums">{b.rate}%</span>
          </div>
        )
      },
    },
    { id: 'fitted', header: 'Still fitted', accessorKey: 'fitted', size: 100, ...SORT, meta: { align: 'right' } },
    {
      id: 'sites', header: 'Sites', accessorFn: (b) => blankToUndef(b.sites.join(', ')), size: 180, ...SORT,
      cell: ({ row }) => <span className="text-xs text-[var(--text-muted)]">{row.original.sites.join(', ') || 'Not recorded'}</span>,
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 140, meta: { export: false },
      cell: ({ row }) => {
        const b = row.original
        if (!isAdmin) return null
        return (
          <button
            type="button"
            onClick={() => {
              setForm({
                ...EMPTY_FORM,
                brand: b.brand,
                affected_serial_prefix: b.prefix,
                severity: b.rate >= 60 ? 'Critical' : 'High',
                source: 'Internal',
                description: `Auto-detected batch failure: ${b.failed}/${b.rated} rated tyres (${b.rate}%) classified as High/Critical risk in batch ${b.prefix}****`,
                issue_date: new Date().toISOString().slice(0, 10),
              })
              setSizeInput('')
              setFormError('')
              setEditRecall(null)
              setShowAddModal(true)
            }}
            className={`${iconBtn} gap-1 px-3 bg-orange-900/30 hover:bg-orange-900/60 border border-orange-700/50 text-orange-400 text-xs font-medium`}
          >
            <Plus size={12} aria-hidden="true" /> Create recall
          </button>
        )
      },
    },
  ], [isAdmin])

  // ── Render ────────────────────────────────────────────────────────────────
  const activeRecalls = useMemo(() => recalls.filter(r => r.status === 'Active'), [recalls])
  const totalAffectedCount = useMemo(() => {
    const s = new Set()
    activeRecalls.forEach(r => matchTyresForRecall(r).forEach(t => s.add(t.id)))
    return s.size
  }, [activeRecalls, matchTyresForRecall])

  const exportBtn = 'inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

  return (
    <div className="space-y-6">

      <PageHeader
        title="Tyre Recall & Batch Quality Tracker"
        subtitle="Monitor tyre recalls, batch defects, and quality alerts"
        icon={ShieldAlert}
        onRefresh={refreshAll}
        refreshing={loading || recallsLoading}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => runExport(exportPdf)}
              disabled={exporting || recallsLoading}
              title={`Exports ${exportScopeLine}`}
              className={exportBtn}
            >
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button
              type="button"
              onClick={() => runExport(exportExcel)}
              disabled={exporting || recallsLoading}
              title={`Exports ${exportScopeLine}`}
              className={exportBtn}
            >
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={openAdd}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <Plus size={14} aria-hidden="true" /> Add recall
              </button>
            )}
          </div>
        }
      />

      {actionError && (
        <div role="alert" className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
          <p className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" /> {actionError}</p>
          <button type="button" onClick={() => setActionError('')} aria-label="Dismiss message" className={`${iconBtn} text-[var(--text-muted)] hover:text-[var(--text-primary)]`}>
            <X size={14} />
          </button>
        </div>
      )}

      {tyresError && (
        <div role="alert" className="bg-amber-900/20 border border-amber-700/50 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-amber-300">
            {tyresError} Fleet tyre counts show as unavailable until the register loads; they are not zero.
          </p>
          <button type="button" onClick={loadTyres} className={exportBtn}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {tyresTruncated && !tyresError && (
        <p className="text-xs text-[var(--text-muted)]">
          The tyre register was read up to its safety ceiling, so affected tyre counts may be understated.
        </p>
      )}

      {/* Active Recall Alert Banner */}
      {activeRecalls.length > 0 && (
        <button
          type="button"
          className="w-full text-left bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 flex items-center justify-between gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={() => {
            setActiveTab('Registry')
            setFilterStatus('Active')
            setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
          }}
        >
          <span className="flex items-center gap-3">
            <AlertOctagon className="text-red-400 shrink-0" size={20} aria-hidden="true" />
            <span>
              <span className="block font-bold text-red-300 text-sm">
                {activeRecalls.length} active recall{activeRecalls.length !== 1 ? 's' : ''}:{' '}
                {matchingAvailable
                  ? `${totalAffectedCount} fleet ${totalAffectedCount === 1 ? 'tyre' : 'tyres'} may be affected`
                  : 'affected tyre count unavailable'}
              </span>
              <span className="block text-red-400 text-xs">Immediate review required. Select to view active recalls.</span>
            </span>
          </span>
          <ArrowRight className="text-red-400 shrink-0" size={18} aria-hidden="true" />
        </button>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={AlertOctagon}
          label="Active Recalls"
          value={recallsLoading ? '...' : kpis.activeCount}
          sub="requires action"
          color={kpis.activeCount > 0 ? 'text-red-400' : 'text-green-400'}
          warn={kpis.activeCount > 0}
        />
        <KpiCard
          icon={Package}
          label="Affected Fleet Tyres"
          value={!matchingAvailable ? 'N/A' : loading ? '...' : kpis.affectedTyres.toLocaleString()}
          sub={matchingAvailable ? 'matched to active recalls' : 'tyre register unavailable'}
          color={kpis.affectedTyres > 0 ? 'text-orange-400' : 'text-[var(--text-muted)]'}
        />
        <KpiCard
          icon={CheckCircle}
          label="Recall Response Rate"
          value={!matchingAvailable || kpis.responseRate == null ? 'N/A' : `${kpis.responseRate}%`}
          sub={kpis.responseRate == null ? 'no active recall in scope' : 'active recalls with identified tyres'}
          color={kpis.responseRate == null ? 'text-[var(--text-muted)]' : kpis.responseRate >= 80 ? 'text-green-400' : kpis.responseRate >= 50 ? 'text-yellow-400' : 'text-red-400'}
        />
        <KpiCard
          icon={Clock}
          label="Avg Days to Close"
          value={kpis.avgDaysToClose != null ? kpis.avgDaysToClose : 'N/A'}
          sub={kpis.avgDaysToClose != null ? 'closed recalls' : 'no closed recall with dates'}
          color="text-blue-400"
        />
      </div>

      {/* A recall board is a safety record: when these figures cover less than
          the whole registry, that has to be on screen, not inferred. */}
      {kpiScopeNarrowed && (
        <p className="text-xs text-[var(--text-muted)] -mt-2">
          These figures cover the {kpiScope.length} recall{kpiScope.length === 1 ? '' : 's'} matching your
          severity, source and search filters, of {recalls.length} in the registry. They ignore the status
          filter so the active and closed figures stay readable.
        </p>
      )}

      {/* Filters: shared by the registry, analytics and exports */}
      <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] gap-2 items-center">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} aria-hidden="true" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recall #, brand, size, description"
            aria-label="Search recalls"
            className={`${inputCls} pl-8`}
          />
        </div>
        {[
          { label: 'Severity', val: filterSeverity, set: setFilterSeverity, opts: ['All', ...SEVERITY_OPTS] },
          { label: 'Status',   val: filterStatus,   set: setFilterStatus,   opts: ['All', ...STATUS_OPTS] },
          { label: 'Source',   val: filterSource,   set: setFilterSource,   opts: ['All', ...SOURCE_OPTS] },
        ].map(({ label, val, set, opts }) => (
          <select
            key={label}
            value={val}
            onChange={e => set(e.target.value)}
            aria-label={`Filter by ${label.toLowerCase()}`}
            className={inputCls}
          >
            {opts.map(o => <option key={o} value={o}>{o === 'All' ? `All ${label.toLowerCase()}s` : o}</option>)}
          </select>
        ))}
        <div className="flex items-center gap-2 justify-end">
          <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{filtered.length} of {recalls.length}</span>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className={`${iconBtn} gap-1 px-2 text-xs text-[var(--text-secondary)] border border-[var(--input-border)]`}>
              <X size={12} aria-hidden="true" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Recall views" className="flex gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1 overflow-x-auto">
        {TAB_OPTS.map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={activeTab === t}
            onClick={() => setActiveTab(t)}
            className={`min-h-[40px] px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              activeTab === t
                ? 'bg-[var(--input-bg-hover)] text-[var(--text-primary)] border border-[var(--input-border)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab: Registry ── */}
      {activeTab === 'Registry' && (
        <div className="space-y-2" ref={listRef}>
          <EnterpriseTable
            columns={registryColumns}
            data={tableRows}
            getRowId={(r) => String(r.id)}
            loading={recallsLoading}
            error={recallsError || null}
            onRetry={loadRecalls}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            onRowClick={(r) => openRecall(r)}
            emptyMessage={recalls.length && filtersActive ? 'No recalls match the current filters.' : 'No recalls recorded yet.'}
            emptyIcon={<ShieldCheck className="text-green-500" size={32} aria-hidden="true" />}
          />
          <p className="text-xs text-[var(--text-muted)] px-1">
            {filtered.length} of {recalls.length} recalls. Fleet tyres counts every tyre matching the recall brand, size and serial prefix; the detail page lists them.
          </p>
        </div>
      )}

      {/* ── Tab: Batch Detector ── */}
      {activeTab === 'Batch Detector' && (
        <div className="space-y-4">
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="text-orange-400" size={18} aria-hidden="true" />
              <h2 className="font-semibold text-[var(--text-secondary)]">Automatic batch failure detection</h2>
            </div>
            <p className="text-[var(--text-muted)] text-xs">
              Tyres grouped by brand and the first 4 serial characters. A batch is flagged when more than 30% of its
              risk-rated tyres are High or Critical, with at least 5 rated tyres. Unrated tyres are not counted as healthy.
            </p>
            {!loading && !tyresError && (
              <p className="text-[var(--text-muted)] text-xs mt-1">
                {batchResult.rated.toLocaleString()} of {batchResult.total.toLocaleString()} serialised tyres carry a risk rating.
              </p>
            )}
          </div>

          {tyresError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Batch detection is unavailable"
              description="The tyre register could not be read, so no batch can be judged. Retry above."
              action={{ label: 'Retry', onClick: loadTyres }}
            />
          ) : !loading && batchResult.rated === 0 ? (
            <EmptyState
              icon={ShieldQuestion}
              title="Cannot assess batch quality yet"
              description="No tyre in the register carries a risk rating, so a failure rate cannot be measured. This is not the same as every batch being healthy."
            />
          ) : (
            <EnterpriseTable
              columns={batchColumns}
              data={batchAnalysis}
              getRowId={(b) => `${b.brand}-${b.prefix}`}
              loading={loading}
              enableColumnFilters={false}
              searchPlaceholder="Search brand or batch"
              exportFileName={reportFileName('TyrePulse Recall Batch Failures', nowStr())}
              reportMeta={{ title: 'Recall batch failure detection', company }}
              initialPageSize={25}
              emptyMessage="No batch is over the failure threshold among rated tyres."
              emptyIcon={<ShieldCheck className="text-green-500" size={32} aria-hidden="true" />}
            />
          )}
        </div>
      )}

      {/* ── Tab: Timeline ── */}
      {activeTab === 'Timeline' && (
        <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
          <h2 className="font-semibold text-[var(--text-secondary)] mb-5 flex items-center gap-2">
            <GitBranch className="text-blue-400" size={16} aria-hidden="true" /> Recall timeline
          </h2>
          {recallsLoading ? (
            <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-14 bg-[var(--input-bg)] rounded-lg animate-pulse" />)}</div>
          ) : recallsError ? (
            <EmptyState icon={AlertTriangle} title="Could not load recalls" description={recallsError} action={{ label: 'Retry', onClick: loadRecalls }} />
          ) : timeline.length === 0 ? (
            <EmptyState
              illustration="state/no-data"
              icon={GitBranch}
              title="No recalls logged yet"
              description="Recalls you add will appear here in chronological order."
            />
          ) : (
            <ol className="relative space-y-0">
              {timeline.map((r, i) => (
                <li key={r.id} className="flex gap-3 sm:gap-4">
                  <div className="flex flex-col items-center w-20 sm:w-28 shrink-0">
                    <span className="text-xs text-[var(--text-muted)] font-mono text-right w-full pr-2">{r.issue_date || 'No date'}</span>
                    <div className="flex flex-col items-center mt-1" aria-hidden="true">
                      <div className={`w-3 h-3 rounded-full border-2 ${SEVERITY_CFG[r.severity]?.dot ?? 'bg-gray-500'} border-[var(--surface-1)] z-10`} />
                      {i < timeline.length - 1 && <div className="w-0.5 h-8 bg-[var(--input-border)]" />}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 pb-6">
                    <button
                      type="button"
                      onClick={() => openRecall(r)}
                      className="w-full text-left bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:border-[var(--border-bright)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-blue-400 text-xs font-bold">{r.recall_number}</span>
                          <span className="text-[var(--text-secondary)] font-medium text-sm">{r.brand}</span>
                          <Badge label={r.severity} cfg={SEVERITY_CFG[r.severity]} small />
                        </span>
                        <span className="block text-[var(--text-muted)] text-xs line-clamp-1">{r.description || 'No description recorded'}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <Badge label={r.status} cfg={STATUS_CFG[r.status]} small />
                        <span className="text-[var(--text-muted)] text-xs">{r.source || 'Source not set'}</span>
                      </span>
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* ── Tab: Brand History ── */}
      {activeTab === 'Brand History' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Star className="text-yellow-400" size={16} aria-hidden="true" />
            <h2 className="font-semibold text-[var(--text-secondary)]">Brand recall history and reliability scores</h2>
          </div>
          <EnterpriseTable
            columns={brandColumns}
            data={brandHistory}
            getRowId={(b) => b.brand}
            loading={recallsLoading}
            error={recallsError || null}
            onRetry={loadRecalls}
            enableColumnFilters={false}
            searchPlaceholder="Search brand"
            exportFileName={reportFileName('TyrePulse Recall Brand History', nowStr())}
            reportMeta={{ title: 'Recall brand history', company }}
            initialPageSize={25}
            emptyMessage="Brand reliability scores appear once recalls have been recorded."
          />
          <p className="text-xs text-[var(--text-muted)] px-1 flex items-center gap-1">
            <Info size={12} aria-hidden="true" /> Score = 100 minus (active recalls x 10 plus critical recalls x 5). Brands below 60 are flagged LOW.
          </p>
        </div>
      )}

      {/* ── Tab: Analytics ── */}
      {activeTab === 'Analytics' && (
        <div className="space-y-4">
          {filtersActive && (
            <p className="text-xs text-[var(--text-muted)]">These charts cover the {filtered.length} recalls matching the current filters.</p>
          )}
          {recallsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-56 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl animate-pulse" />)}
            </div>
          ) : recallsError ? (
            <EmptyState icon={AlertTriangle} title="Could not load recalls" description={recallsError} action={{ label: 'Retry', onClick: loadRecalls }} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={BarChart3} title="Nothing to chart" description={recalls.length ? 'No recall matches the current filters.' : 'Charts appear once recalls are recorded.'} />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  { title: 'Recalls by severity', data: chartData.severity },
                  { title: 'Recalls by status', data: chartData.status },
                  { title: 'Recalls by source', data: chartData.source },
                ].map(c => (
                  <div key={c.title} className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                    <h3 className="text-xs text-[var(--text-muted)] mb-3 font-medium">{c.title}</h3>
                    <div className="h-44" role="img" aria-label={`${c.title}: ${c.data.labels.map((l, i) => `${l} ${c.data.datasets[0].data[i]}`).join(', ')}`}>
                      <Bar data={c.data} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
                    </div>
                  </div>
                ))}
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                  <h3 className="text-xs text-[var(--text-muted)] mb-3 font-medium">Monthly recall trend</h3>
                  <div className="h-44">
                    {chartData.monthly.labels.length > 1
                      ? <Line data={chartData.monthly} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
                      : <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-xs text-center px-4">A trend needs recalls issued in at least two months.</div>}
                  </div>
                </div>
              </div>

              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                <h3 className="text-xs text-[var(--text-muted)] mb-3 font-medium flex items-center gap-1">
                  <BarChart3 size={13} aria-hidden="true" /> Affected fleet tyres per active recall
                </h3>
                {!matchingAvailable ? (
                  <p className="text-[var(--text-muted)] text-xs text-center py-4">Unavailable while the tyre register cannot be read.</p>
                ) : activeInView.length === 0 ? (
                  <p className="text-[var(--text-muted)] text-xs text-center py-4">No active recall in this view.</p>
                ) : (
                  <ul className="space-y-2">
                    {activeInView.map(r => (
                      <li key={r.id} className="flex items-center gap-3">
                        <span className="w-28 text-xs font-mono text-blue-400 truncate" title={r.recall_number}>{r.recall_number}</span>
                        <div className="flex-1 h-2 bg-[var(--input-border)] rounded-full overflow-hidden" aria-hidden="true">
                          <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${(r.affected / maxActiveAffected) * 100}%` }} />
                        </div>
                        <span className="text-xs text-orange-400 w-10 text-right font-bold tabular-nums">{r.affected}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Add / Edit Recall Modal ── */}
      {showAddModal && (
        <Modal
          open
          onClose={closeForm}
          title={editRecall ? 'Edit recall' : 'Add recall'}
          size="lg"
          footer={
            <div className="flex justify-end gap-3">
              <button type="button" onClick={closeForm} disabled={saving} className="btn-secondary min-h-[40px]">Cancel</button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="min-h-[40px] px-5 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg text-sm font-semibold text-white transition inline-flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {saving ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}
                {editRecall ? 'Update recall' : 'Save recall'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            {formError && (
              <div role="alert" className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-red-400 text-sm flex items-center gap-2">
                <AlertTriangle size={14} aria-hidden="true" /> {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="rc-number" className="block text-xs text-[var(--text-muted)] mb-1">Recall number *</label>
                <input
                  id="rc-number"
                  value={form.recall_number}
                  onChange={e => setForm(f => ({ ...f, recall_number: e.target.value }))}
                  className={`${inputCls} font-mono`}
                  placeholder="e.g. RCL-2024-001"
                />
              </div>
              <div>
                <label htmlFor="rc-brand" className="block text-xs text-[var(--text-muted)] mb-1">Brand *</label>
                <input
                  id="rc-brand"
                  value={form.brand}
                  onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                  className={inputCls}
                  placeholder="e.g. Michelin"
                />
              </div>
              <div>
                <label htmlFor="rc-date" className="block text-xs text-[var(--text-muted)] mb-1">Issue date *</label>
                <input
                  id="rc-date"
                  type="date"
                  value={form.issue_date}
                  onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="rc-sev" className="block text-xs text-[var(--text-muted)] mb-1">Severity</label>
                <select id="rc-sev" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} className={inputCls}>
                  {SEVERITY_OPTS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="rc-source" className="block text-xs text-[var(--text-muted)] mb-1">Source</label>
                <select id="rc-source" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} className={inputCls}>
                  {SOURCE_OPTS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="rc-status" className="block text-xs text-[var(--text-muted)] mb-1">Status</label>
                <select id="rc-status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inputCls}>
                  {STATUS_OPTS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="rc-size" className="block text-xs text-[var(--text-muted)] mb-1">Affected sizes * <span className="text-[var(--text-muted)]">(press Enter or comma to add)</span></label>
              <div className="flex flex-wrap gap-1.5 p-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg min-h-[44px]">
                {form.affected_sizes.map(s => (
                  <span key={s} className="flex items-center gap-1 px-2 py-0.5 bg-blue-900/40 border border-blue-700/50 rounded text-xs text-blue-300 font-mono">
                    {s}
                    <button type="button" onClick={() => removeSize(s)} aria-label={`Remove size ${s}`} className="text-blue-400 hover:text-red-400 ml-0.5 p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  id="rc-size"
                  value={sizeInput}
                  onChange={e => setSizeInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSize() }
                  }}
                  onBlur={addSize}
                  placeholder="e.g. 315/80R22.5"
                  className="bg-transparent text-sm text-[var(--text-secondary)] placeholder-[var(--text-muted)] focus:outline-none flex-1 min-w-[140px] font-mono"
                />
              </div>
            </div>

            <div>
              <label htmlFor="rc-prefix" className="block text-xs text-[var(--text-muted)] mb-1">Serial prefix pattern <span className="text-[var(--text-muted)]">(optional, first 4 characters, e.g. MH23)</span></label>
              <input
                id="rc-prefix"
                value={form.affected_serial_prefix}
                onChange={e => setForm(f => ({ ...f, affected_serial_prefix: e.target.value.toUpperCase().slice(0, 4) }))}
                maxLength={4}
                className={`${inputCls} font-mono uppercase`}
                placeholder="e.g. MH23"
              />
            </div>

            <div>
              <label htmlFor="rc-desc" className="block text-xs text-[var(--text-muted)] mb-1">Description</label>
              <textarea
                id="rc-desc"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                className={`${inputCls} resize-none`}
                placeholder="Describe the recall issue"
              />
            </div>

            <div>
              <label htmlFor="rc-action" className="block text-xs text-[var(--text-muted)] mb-1">Action required</label>
              <textarea
                id="rc-action"
                value={form.action_required}
                onChange={e => setForm(f => ({ ...f, action_required: e.target.value }))}
                rows={2}
                className={`${inputCls} resize-none`}
                placeholder="Immediate action to take"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <Modal
          open
          onClose={closeDeleteDialog}
          title="Delete recall?"
          size="sm"
          footer={
            <div className="flex justify-end gap-3">
              <button type="button" onClick={closeDeleteDialog} disabled={deleting} className="btn-secondary min-h-[40px]">Cancel</button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="min-h-[40px] px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg text-sm font-semibold text-white inline-flex items-center gap-2"
              >
                {deleting ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
                Delete
              </button>
            </div>
          }
        >
          <p className="text-sm text-[var(--text-secondary)]">
            Recall <span className="font-mono font-semibold">{confirmDelete.recall_number}</span> ({confirmDelete.brand}) will be removed from the registry. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  )
}
