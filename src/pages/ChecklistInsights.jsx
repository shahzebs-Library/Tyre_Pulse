/**
 * ChecklistInsights (route /checklist-insights, gated to CHECKLIST_AUTHOR_ROLES
 * in App.jsx) - analytics across checklist templates and submissions.
 *
 * Every figure comes from the pure `src/lib/checklistInsightsAnalytics.js`
 * engine over rows this page reads (templates, submissions, the scheduled
 * compliance monitor and the approval-age monitor). The two monitors are read
 * best-effort: a failed monitor read is SAID on screen, never rendered as
 * "nothing due" or "nothing pending".
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BarChart3, ClipboardList, Inbox, CalendarClock, ShieldCheck, CheckCircle2,
  AlertTriangle, RefreshCw, Search, ListChecks, TrendingUp, Layers,
  FileSpreadsheet, FileText, ChevronUp, ChevronDown, ChevronsUpDown, X, MapPin, Hourglass,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { useSettings } from '../contexts/SettingsContext'
import { listSubmissions, listTemplates } from '../lib/api/checklists'
import { getApprovalAgeMonitor, getComplianceMonitor } from '../lib/api/checklistSchedules'
import { isValueField } from '../lib/checklist/fieldTypes'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  WEEKS, PERIODS, STATUS_KEYS, STATUS_LABELS,
  filterSubmissions, siteOptions, computeMetrics, rateTone, weeklySeries, bySite,
  byTemplate, boolPassRates, complianceSummary, approvalAgeSummary, sortRows,
  templateExportRows, TEMPLATE_EXPORT_COLS, TEMPLATE_EXPORT_HEADERS,
  passRateExportRows, PASS_EXPORT_COLS, PASS_EXPORT_HEADERS,
} from '../lib/checklistInsightsAnalytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')

// Chart colours resolve through chartVarPlugin, so both themes stay legible.
function chartOpts(horizontal = false, yLabel = '', xLabel = '') {
  const axisText = { color: 'var(--text-muted)', font: { size: 11 } }
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'var(--panel)', titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)',
        borderColor: 'var(--hairline)', borderWidth: 1,
      },
    },
    scales: {
      x: {
        grid: { color: 'var(--panel-2)' },
        ticks: { ...axisText, autoSkip: true },
        title: xLabel ? { display: true, text: xLabel, ...axisText } : { display: false },
      },
      y: {
        beginAtZero: true,
        grid: { color: 'var(--panel-2)' },
        ticks: { ...axisText, precision: 0 },
        title: yLabel ? { display: true, text: yLabel, ...axisText } : { display: false },
      },
    },
  }
}

const fmtPct = (v) => (v == null ? 'N/A' : `${v.toFixed(1)}%`)
const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())
const fmtHours = (v) => (v == null ? 'N/A' : `${Number(v).toFixed(1)} h`)
const fmtDate = (d) => (d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A')
const fmtShort = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

const TONE_TEXT = { good: 'text-green-400', warn: 'text-amber-400', bad: 'text-red-400' }
const TONE_WORD = { good: 'On target', warn: 'Watch', bad: 'Below target' }

const STATUS_CHIP = {
  submitted: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  approved: 'bg-green-900/40 text-green-300 border border-green-700/50',
  rejected: 'bg-red-900/40 text-red-300 border border-red-700/50',
  draft: 'bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border-dim)]',
}

function KpiCard({ title, value, sub, icon: Icon, tone }) {
  return (
    <div className="card flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={15} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />}
        <span className="text-xs font-medium text-[var(--text-muted)] truncate">{title}</span>
      </div>
      <p className={`text-2xl font-bold leading-tight tabular-nums ${tone ? TONE_TEXT[tone] : 'text-[var(--text-primary)]'}`}>{value}</p>
      {(sub || tone) && (
        <p className="text-xs text-[var(--text-muted)] leading-snug">
          {tone ? `${TONE_WORD[tone]}${sub ? '. ' : ''}` : ''}{sub}
        </p>
      )}
    </div>
  )
}

function SortButton({ label, active, dir, onClick, align }) {
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 min-h-[32px] rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-bright)] ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-[var(--text-primary)]' : ''}`}
      aria-label={`Sort by ${label}${active ? `, currently ${dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
    >
      {label}
      <Icon size={12} aria-hidden="true" />
    </button>
  )
}

/**
 * Sortable, paged register. Sorting runs over the FULL row set before paging
 * (usePagedRows), so a column sort never re-orders only the visible page.
 */
function SortedPagedTable({ columns, rows, defaultSort, getRowId, emptyMessage, onRowClick, maxHeight = 520 }) {
  const [sort, setSort] = useState(defaultSort)
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === sort?.id)
    return col?.sortValue ? sortRows(rows, col.sortValue, sort.dir) : rows
  }, [rows, columns, sort])
  const pager = usePagedRows(sorted, { pageSize: 25 })
  const tableColumns = useMemo(() => columns.map((c) => ({
    id: c.id,
    accessorFn: c.sortValue || ((r) => r[c.id]),
    header: c.sortValue
      ? () => (
        <SortButton
          label={c.header} align={c.align}
          active={sort?.id === c.id} dir={sort?.dir}
          onClick={() => setSort((s) => (s?.id === c.id
            ? { id: c.id, dir: s.dir === 'asc' ? 'desc' : 'asc' }
            : { id: c.id, dir: c.firstDir || 'desc' }))}
        />
      )
      : c.header,
    cell: c.cell ? ({ row }) => c.cell(row.original) : undefined,
    size: c.size,
    meta: { align: c.align },
  })), [columns, sort])
  return (
    <div className="space-y-2">
      <EnterpriseTable
        columns={tableColumns}
        data={pager.pageRows}
        getRowId={getRowId}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableSorting={false}
        enableExport={false}
        virtual
        maxHeight={maxHeight}
        emptyMessage={emptyMessage}
        onRowClick={onRowClick}
      />
      <TablePagination {...pager} />
    </div>
  )
}

function SectionCard({ title, description, icon: Icon, actions, children }) {
  return (
    <section className="card space-y-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            {Icon && <Icon size={15} className="text-[var(--text-muted)]" aria-hidden="true" />}{title}
          </h2>
          {description && <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function MonitorUnavailable({ what, error, onRetry }) {
  const missing = isMissingRelation(error)
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-700/50 px-3 py-3">
      <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="text-sm flex-1 min-w-[200px]">
        <p className="text-[var(--text-primary)] font-medium">The {what} could not be read.</p>
        <p className="text-[var(--text-muted)] mt-0.5">
          {missing
            ? 'Its database migration is not applied yet, so no figure is shown rather than a zero.'
            : toUserMessage(error, 'An unexpected error occurred.')}
        </p>
      </div>
      {!missing && (
        <button type="button" onClick={onRetry} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-2">
          <RefreshCw size={14} aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  )
}

const HEADER_TITLE = 'Checklist Insights'
const HEADER_SUB = 'Analytics across checklist templates and submissions'

export default function ChecklistInsights() {
  const { activeCountry } = useSettings()
  const navigate = useNavigate()

  const [templates, setTemplates] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [complianceRows, setComplianceRows] = useState([])
  const [complianceError, setComplianceError] = useState(null)
  const [approvalAgeRows, setApprovalAgeRows] = useState([])
  const [approvalAgeError, setApprovalAgeError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadedAt, setLoadedAt] = useState(null)

  const [templateFilter, setTemplateFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [period, setPeriod] = useState('all')
  const [search, setSearch] = useState('')

  const reqIdRef = useRef(0)
  const country = activeCountry && activeCountry !== 'All' ? activeCountry : undefined

  const loadData = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const today = new Date()
      const from = new Date(today)
      from.setDate(from.getDate() - 29)
      const isoDay = (date) => date.toISOString().slice(0, 10)
      const [tpls, subs, compliance, approvalAges] = await Promise.all([
        listTemplates({ country }),
        listSubmissions({ country }),
        getComplianceMonitor({ from: isoDay(from), to: isoDay(today), country })
          .then((rows) => ({ rows, error: null }))
          .catch((monitorError) => ({ rows: [], error: monitorError })),
        getApprovalAgeMonitor({ country })
          .then((rows) => ({ rows, error: null }))
          .catch((monitorError) => ({ rows: [], error: monitorError })),
      ])
      if (myReq !== reqIdRef.current) return
      setTemplates(Array.isArray(tpls) ? tpls : [])
      setSubmissions(Array.isArray(subs) ? subs : [])
      setComplianceRows(Array.isArray(compliance.rows) ? compliance.rows : [])
      setComplianceError(compliance.error)
      setApprovalAgeRows(Array.isArray(approvalAges.rows) ? approvalAges.rows : [])
      setApprovalAgeError(approvalAges.error)
      setLoadedAt(new Date())
    } catch (err) {
      if (myReq === reqIdRef.current) setError(err)
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [country])

  useEffect(() => { loadData() }, [loadData])

  // `now` is pinned to the load, so every figure on screen agrees with itself.
  const now = loadedAt || new Date()
  const filters = { template: templateFilter, status: statusFilter, site: siteFilter, period, search }
  const filteredSubs = useMemo(
    () => filterSubmissions(submissions, filters, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [submissions, templateFilter, statusFilter, siteFilter, period, search, loadedAt],
  )
  const sites = useMemo(() => siteOptions(submissions), [submissions])
  const metrics = useMemo(() => computeMetrics(templates, filteredSubs, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, filteredSubs, loadedAt])
  const weekly = useMemo(() => weeklySeries(filteredSubs, now, WEEKS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredSubs, loadedAt])
  const siteVolume = useMemo(() => bySite(filteredSubs, 12), [filteredSubs])
  const templateRows = useMemo(() => byTemplate(filteredSubs, templates), [filteredSubs, templates])
  const passRates = useMemo(() => boolPassRates(templates, filteredSubs, {
    template: templateFilter,
    isBoolField: (f) => f?.type === 'boolean' && isValueField(f.type),
  }), [templates, filteredSubs, templateFilter])
  const compliance = useMemo(() => complianceSummary(complianceRows, templateFilter), [complianceRows, templateFilter])
  const approvalAges = useMemo(() => approvalAgeSummary(approvalAgeRows, templateFilter), [approvalAgeRows, templateFilter])

  const hasFilters = templateFilter !== 'all' || statusFilter !== 'all' || siteFilter !== 'all' || period !== 'all' || search
  const clearFilters = () => {
    setTemplateFilter('all'); setStatusFilter('all'); setSiteFilter('all'); setPeriod('all'); setSearch('')
  }

  const weeklyChart = useMemo(() => (weekly.inWindow ? {
    labels: weekly.weeks.map(fmtShort),
    datasets: [{
      label: 'Submissions', data: weekly.counts,
      backgroundColor: withAlpha(colorAt(0), 0.7), borderColor: colorAt(0), borderWidth: 1, borderRadius: 3,
    }],
  } : null), [weekly])
  const siteChart = useMemo(() => (siteVolume.rows.length ? {
    labels: siteVolume.rows.map((s) => s.site),
    datasets: [{
      label: 'Submissions', data: siteVolume.rows.map((s) => s.count),
      backgroundColor: withAlpha(colorAt(1), 0.7), borderColor: colorAt(1), borderWidth: 1, borderRadius: 3,
    }],
  } : null), [siteVolume])

  async function exportExcel() {
    const { exportSheetsToExcel, reportFileName, reportDateLabel } = await loadExportUtils()
    exportSheetsToExcel([
      { name: 'By template', rows: templateExportRows(templateRows), columns: TEMPLATE_EXPORT_COLS, headers: TEMPLATE_EXPORT_HEADERS },
      { name: 'Question pass rates', rows: passRateExportRows(passRates), columns: PASS_EXPORT_COLS, headers: PASS_EXPORT_HEADERS },
    ], reportFileName('TyrePulse Checklist Insights', country, reportDateLabel()))
  }
  async function exportPdf() {
    const { exportToPdf, reportFileName, reportDateLabel } = await loadExportUtils()
    exportToPdf(
      templateExportRows(templateRows),
      TEMPLATE_EXPORT_COLS.map((key, i) => ({ key, header: TEMPLATE_EXPORT_HEADERS[i] })),
      'Checklist Insights by Template',
      reportFileName('TyrePulse Checklist Insights', country, reportDateLabel()),
      'landscape',
    )
  }

  const templateColumns = useMemo(() => [
    { id: 'name', header: 'Template', sortValue: (r) => r.name, firstDir: 'asc', size: 260,
      cell: (r) => <span className="font-medium text-[var(--text-primary)]">{r.name}</span> },
    { id: 'count', header: 'Submissions', sortValue: (r) => r.count, align: 'right', size: 120,
      cell: (r) => <span className="tabular-nums">{r.count.toLocaleString()}</span> },
    { id: 'approvalRate', header: 'Approval rate', sortValue: (r) => r.approvalRate, align: 'right', size: 130,
      cell: (r) => <span className={`tabular-nums ${r.approvalRate == null ? 'text-[var(--text-muted)]' : TONE_TEXT[rateTone(r.approvalRate)]}`}>{fmtPct(r.approvalRate)}</span> },
    { id: 'last', header: 'Last submitted', sortValue: (r) => (r.last ? r.last.getTime() : null), size: 140,
      cell: (r) => <span className="text-[var(--text-muted)]">{fmtDate(r.last)}</span> },
    { id: 'mix', header: 'Status mix', size: 280,
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          {STATUS_KEYS.filter((k) => r[k] > 0).map((k) => (
            <span key={k} className={`text-[11px] px-1.5 py-0.5 rounded ${STATUS_CHIP[k]}`}>{r[k]} {STATUS_LABELS[k].toLowerCase()}</span>
          ))}
        </div>
      ) },
  ], [])

  const passColumns = useMemo(() => [
    { id: 'template', header: 'Template', sortValue: (r) => r.template, firstDir: 'asc', size: 200,
      cell: (r) => <span className="text-[var(--text-muted)]">{r.template}</span> },
    { id: 'question', header: 'Question', sortValue: (r) => r.question, firstDir: 'asc', size: 320,
      cell: (r) => <span className="text-[var(--text-primary)]">{r.question}</span> },
    { id: 'yesPct', header: 'Yes %', sortValue: (r) => r.yesPct, firstDir: 'asc', align: 'right', size: 110,
      cell: (r) => {
        const tone = rateTone(r.yesPct)
        return <span className={`tabular-nums font-semibold ${TONE_TEXT[tone]}`} title={TONE_WORD[tone]}>{r.yesPct.toFixed(1)}%</span>
      } },
    { id: 'no', header: 'No answers', sortValue: (r) => r.no, align: 'right', size: 110,
      cell: (r) => <span className="tabular-nums">{r.no}</span> },
    { id: 'responses', header: 'Responses', sortValue: (r) => r.responses, align: 'right', size: 110,
      cell: (r) => <span className="tabular-nums text-[var(--text-muted)]">{r.responses}</span> },
  ], [])

  const complianceColumns = useMemo(() => [
    { id: 'template', header: 'Template / site', sortValue: (r) => r.template, firstDir: 'asc', size: 260,
      cell: (r) => (
        <div><div className="text-[var(--text-primary)]">{r.template}</div>
          <div className="text-xs text-[var(--text-muted)]">{[r.site, r.country].filter(Boolean).join(', ')}</div></div>
      ) },
    { id: 'due', header: 'Due', sortValue: (r) => r.due, align: 'right', size: 90, cell: (r) => <span className="tabular-nums">{fmtNum(r.due)}</span> },
    { id: 'completed', header: 'Completed', sortValue: (r) => r.completed, align: 'right', size: 110, cell: (r) => <span className="tabular-nums">{fmtNum(r.completed)}</span> },
    { id: 'overdue', header: 'Overdue', sortValue: (r) => r.overdue, align: 'right', size: 100,
      cell: (r) => <span className={`tabular-nums ${r.overdue ? 'text-amber-400' : ''}`}>{fmtNum(r.overdue)}</span> },
    { id: 'compliancePct', header: 'Compliance', sortValue: (r) => r.compliancePct, firstDir: 'asc', align: 'right', size: 120,
      cell: (r) => <span className="tabular-nums">{fmtPct(r.compliancePct)}</span> },
    { id: 'evidenceGaps', header: 'Evidence gaps', sortValue: (r) => r.evidenceGaps, align: 'right', size: 130,
      cell: (r) => <span className={`tabular-nums ${r.evidenceGaps ? 'text-amber-400' : ''}`}>{fmtNum(r.evidenceGaps)}</span> },
  ], [])

  const ageColumns = useMemo(() => [
    { id: 'template', header: 'Template / site', sortValue: (r) => r.template, firstDir: 'asc', size: 240,
      cell: (r) => (
        <div><div className="text-[var(--text-primary)]">{r.template}</div>
          <div className="text-xs text-[var(--text-muted)]">{[r.site, r.country].filter(Boolean).join(', ')}</div></div>
      ) },
    { id: 'stage', header: 'Stage', sortValue: (r) => r.stage, firstDir: 'asc', size: 150, cell: (r) => <span className="text-[var(--text-muted)]">{r.stage}</span> },
    { id: 'pending', header: 'Pending', sortValue: (r) => r.pending, align: 'right', size: 100, cell: (r) => <span className="tabular-nums">{fmtNum(r.pending)}</span> },
    { id: 'oldestHours', header: 'Oldest age', sortValue: (r) => r.oldestHours, align: 'right', size: 120, cell: (r) => <span className="tabular-nums">{fmtHours(r.oldestHours)}</span> },
    { id: 'averageHours', header: 'Average age', sortValue: (r) => r.averageHours, align: 'right', size: 120, cell: (r) => <span className="tabular-nums">{fmtHours(r.averageHours)}</span> },
    { id: 'breached', header: 'SLA / breached', sortValue: (r) => r.breached, align: 'right', size: 150,
      cell: (r) => (
        <span className={`tabular-nums ${r.breached > 0 ? 'text-red-400 font-medium' : 'text-green-400'}`}>
          {fmtHours(r.targetHours)} / {r.breached > 0 ? `${r.breached} breached` : 'none breached'}
        </span>
      ) },
  ], [])

  const header = (extra = {}) => (
    <PageHeader title={HEADER_TITLE} subtitle={HEADER_SUB} icon={BarChart3} {...extra} />
  )

  if (loading && !loadedAt) {
    return (
      <div className="space-y-6" aria-busy="true">
        {header()}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="card animate-pulse h-24" />)}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="card animate-pulse h-72" /><div className="card animate-pulse h-72" />
        </div>
        <span className="sr-only">Loading checklist insights</span>
      </div>
    )
  }

  if (error) {
    const missing = isMissingRelation(error)
    return (
      <div className="space-y-6">
        {header()}
        <div className="card border border-red-800/50" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-[var(--text-primary)] font-semibold">Couldn&apos;t load checklist insights.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">
                {missing
                  ? <>The checklist tables aren&apos;t applied to this database yet. Apply{' '}
                    <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V123_CHECKLIST_TEMPLATES.sql</span>, then reload.</>
                  : toUserMessage(error, 'An unexpected error occurred.')}
              </p>
              <button type="button" onClick={loadData} className="btn-secondary text-sm mt-3 min-h-[44px] inline-flex items-center gap-2">
                <RefreshCw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (submissions.length === 0 && templates.length === 0) {
    return (
      <div className="space-y-6">
        {header({ onRefresh: loadData, refreshing: loading, updatedAt: loadedAt })}
        <div className="card text-center py-16 space-y-3">
          <ListChecks size={34} className="mx-auto text-[var(--text-muted)]" aria-hidden="true" />
          <p className="text-[var(--text-primary)] font-semibold">No checklist activity yet</p>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
            Once teams publish templates and capture submissions, this page fills with submission trends,
            approval rates, per-site volume, and question-level pass rates.
          </p>
          <Link to="/checklists" className="btn-primary inline-flex items-center gap-2 text-sm mt-2 min-h-[44px]">
            <ClipboardList size={15} aria-hidden="true" /> Go to Checklists
          </Link>
        </div>
      </div>
    )
  }

  const noMatch = hasFilters ? 'No submissions match the current filters.' : 'No submissions recorded yet.'

  return (
    <div className="space-y-6">
      <PageHeader
        title={HEADER_TITLE}
        subtitle={`Analytics across ${templates.length} template${templates.length === 1 ? '' : 's'} and ${submissions.length} submission${submissions.length === 1 ? '' : 's'}${country ? `, ${country}` : ''}`}
        icon={BarChart3}
        updatedAt={loadedAt}
        onRefresh={loadData}
        refreshing={loading}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportExcel} disabled={!templateRows.length && !passRates.length}
              className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5">
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={exportPdf} disabled={!templateRows.length}
              className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5">
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
          </div>
        )}
      />

      {/* Filters */}
      <div className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        <div className="flex flex-col gap-1 lg:col-span-2">
          <label htmlFor="ci-search" className="text-xs text-[var(--text-muted)]">Search</label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="ci-search" type="search" className="input w-full text-sm pl-9 min-h-[44px]"
              placeholder="Site, template, asset or title" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ci-template" className="text-xs text-[var(--text-muted)]">Template</label>
          <select id="ci-template" className="input w-full text-sm min-h-[44px]" value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)}>
            <option value="all">All templates</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name || 'Untitled'}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ci-status" className="text-xs text-[var(--text-muted)]">Status</label>
          <select id="ci-status" className="input w-full text-sm min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {STATUS_KEYS.map((k) => <option key={k} value={k}>{STATUS_LABELS[k]}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ci-site" className="text-xs text-[var(--text-muted)]">Site</label>
          <select id="ci-site" className="input w-full text-sm min-h-[44px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
            <option value="all">All sites</option>
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ci-period" className="text-xs text-[var(--text-muted)]">Period</label>
          <select id="ci-period" className="input w-full text-sm min-h-[44px]" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-6 flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]" aria-live="polite">
          <span>{metrics.total.toLocaleString()} of {submissions.length.toLocaleString()} submissions</span>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-xs min-h-[36px] px-3 inline-flex items-center gap-1">
              <X size={12} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard title="Published templates" value={metrics.publishedTemplates} sub={`${metrics.totalTemplates} total`} icon={Layers} />
        <KpiCard title="Submissions" value={metrics.total.toLocaleString()}
          sub={metrics.undated ? `${metrics.undated} without a date` : (hasFilters ? 'Filtered' : 'All in scope')} icon={Inbox} />
        <KpiCard title="This month" value={metrics.thisMonth.toLocaleString()} sub="By capture date" icon={CalendarClock} />
        <KpiCard title="Active sites" value={metrics.activeSites.toLocaleString()} sub="With at least one submission" icon={MapPin} />
        <KpiCard title="Approval rate" value={fmtPct(metrics.approvalRate)} tone={rateTone(metrics.approvalRate)}
          sub={metrics.decided ? `${metrics.approved} approved, ${metrics.rejected} rejected` : 'No decided submissions'} icon={CheckCircle2} />
        <KpiCard title="Approval pass rate" value={fmtPct(metrics.approvalPassRate)} tone={rateTone(metrics.approvalPassRate)}
          sub={metrics.requiresApproval ? `${metrics.requiresApprovalPassed} of ${metrics.requiresApproval} required` : 'No approval-required templates used'} icon={ShieldCheck} />
      </div>

      {/* Scheduled compliance */}
      <SectionCard
        title="Scheduled compliance, last 30 days" icon={ShieldCheck}
        description="Calculated from due assignments, with skipped work excluded from the denominator."
        actions={!complianceError && <span className="text-xs text-[var(--text-muted)]">{compliance.rows.length} template/site group{compliance.rows.length === 1 ? '' : 's'}</span>}
      >
        {complianceError ? (
          <MonitorUnavailable what="compliance monitor" error={complianceError} onRetry={loadData} />
        ) : compliance.due === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No scheduled assignments exist in this period, so a compliance percentage cannot be reported yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              <KpiCard title="Due" value={fmtNum(compliance.due)} icon={CalendarClock} />
              <KpiCard title="Completed" value={fmtNum(compliance.completed)} icon={CheckCircle2} />
              <KpiCard title="Compliance" value={fmtPct(compliance.compliancePct)} tone={rateTone(compliance.compliancePct)} icon={ShieldCheck} />
              <KpiCard title="On time" value={fmtPct(compliance.onTimePct)} tone={rateTone(compliance.onTimePct)} icon={TrendingUp} />
              <KpiCard title="Evidence gaps" value={fmtNum(compliance.evidenceGaps)} sub={`${compliance.overdue} overdue`} icon={AlertTriangle} />
            </div>
            <SortedPagedTable
              columns={complianceColumns} rows={compliance.rows}
              defaultSort={{ id: 'compliancePct', dir: 'asc' }} getRowId={(r) => r.key}
              emptyMessage="No compliance groups for this template." maxHeight={420}
            />
          </>
        )}
      </SectionCard>

      {/* Pending approval age */}
      <SectionCard
        title="Pending approval age" icon={Hourglass}
        description="Measured from submission or supervisor sign-off against the organisation's configured stage SLA."
        actions={!approvalAgeError && approvalAges.rows.length > 0 && (
          <span className="text-xs text-[var(--text-muted)]">
            {approvalAges.pending} pending, {approvalAges.breached} past SLA, oldest {fmtHours(approvalAges.oldestHours)}
          </span>
        )}
      >
        {approvalAgeError ? (
          <MonitorUnavailable what="approval-age monitor" error={approvalAgeError} onRetry={loadData} />
        ) : (
          <SortedPagedTable
            columns={ageColumns} rows={approvalAges.rows}
            defaultSort={{ id: 'oldestHours', dir: 'desc' }} getRowId={(r) => r.key}
            emptyMessage="No pending checklist approvals in this scope." maxHeight={420}
          />
        )}
      </SectionCard>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard title="Submissions over time" icon={TrendingUp}
          actions={<span className="text-xs text-[var(--text-muted)]">Last {WEEKS} weeks, by week</span>}>
          {weeklyChart ? (
            <div style={{ height: 280 }} role="img"
              aria-label={`Weekly submissions over the last ${WEEKS} weeks: ${weekly.inWindow} in total, peak ${Math.max(...weekly.counts)} in one week.`}>
              <Bar data={weeklyChart} options={chartOpts(false, 'Submissions', 'Week starting')} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-[var(--text-muted)] text-sm">No dated submissions in the last {WEEKS} weeks.</div>
          )}
        </SectionCard>
        <SectionCard title="Top sites by volume" icon={BarChart3}
          actions={<span className="text-xs text-[var(--text-muted)]">Top {siteVolume.rows.length} of {siteVolume.total}</span>}>
          {siteChart ? (
            <div style={{ height: 280 }} role="img"
              aria-label={`Submissions by site. Highest: ${siteVolume.rows[0].site} with ${siteVolume.rows[0].count}.`}>
              <Bar data={siteChart} options={chartOpts(true, '', 'Submissions')} />
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-[var(--text-muted)] text-sm">{noMatch}</div>
          )}
        </SectionCard>
      </div>

      {/* By template */}
      <SectionCard title="By template" icon={Layers}
        description="Select a row to open that template's submissions."
        actions={<span className="text-xs text-[var(--text-muted)]">{templateRows.length} active</span>}>
        <SortedPagedTable
          columns={templateColumns} rows={templateRows}
          defaultSort={{ id: 'count', dir: 'desc' }} getRowId={(r) => String(r.id)}
          emptyMessage={noMatch}
          onRowClick={(r) => { if (r.id !== 'unknown') navigate(`/checklists?template=${encodeURIComponent(r.id)}`) }}
        />
      </SectionCard>

      {/* Boolean pass rates */}
      <SectionCard title="Yes / No question pass rates" icon={CheckCircle2}
        description="Lowest pass rate first. Only answered questions are counted."
        actions={<span className="text-xs text-[var(--text-muted)]">{passRates.length} question{passRates.length === 1 ? '' : 's'}</span>}>
        <SortedPagedTable
          columns={passColumns} rows={passRates}
          defaultSort={{ id: 'yesPct', dir: 'asc' }} getRowId={(r) => r.key}
          emptyMessage={hasFilters ? 'No answered Yes/No questions match these filters.' : 'No answered Yes/No questions yet. Add boolean fields to templates to surface quality signals here.'}
        />
      </SectionCard>
    </div>
  )
}
