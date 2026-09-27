import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { correctiveActions } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import {
  Plus, Save, X, CheckCircle, Clock, AlertCircle, Download, FileText,
  Camera, ClipboardCheck, Search, LayoutList, LayoutGrid,
  TrendingUp, AlertTriangle, Timer, Filter, BarChart2, RefreshCw,
  MapPin, User, Truck, CircleDot, Calendar, Wrench,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { SkeletonTable } from '../components/ui/Skeleton'
import { formatDate } from '../lib/formatters'
import { RISK_BADGE_DARK } from '../lib/formatters'
import { useLanguage } from '../contexts/LanguageContext'
import { toUserMessage } from '../lib/safeError'
import { compareValues } from '../lib/consoleTable'
import { colorAt } from '../lib/reportColors'
import {
  overdueDays, daysOpen, avgDaysToClose as avgDaysToCloseAt, matchesSearch, overdueRate,
  rootCauseDistribution, siteBreakdown, sortActions, actionRows, actionExportRows,
  EXPORT_COLS, EXPORT_HEADERS, STATUSES, PRIORITIES,
} from '../lib/correctiveActionsAnalytics'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

// ── Constants ──────────────────────────────────────────────────────────────────
// Semantic status colours. The status name is always printed beside the colour.
const STATUS_META = {
  Open:          { icon: AlertCircle, color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/40' },
  'In Progress': { icon: Clock,       color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/40' },
  Closed:        { icon: CheckCircle, color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/40' },
}

const PRIORITY_BADGE = {
  High:   RISK_BADGE_DARK.Critical,
  Medium: RISK_BADGE_DARK.Medium,
  Low:    RISK_BADGE_DARK.Low,
}

const EMPTY_FORM = {
  title: '', priority: 'Medium', site: '', description: '', assigned_to: '',
  status: 'Open', asset_no: '', tyre_serial: '', root_cause: '', due_date: '',
  photo_data: null,
}

const ROOT_CAUSES = [
  'Under Inflation', 'Over Inflation', 'Alignment Issue', 'Overloading',
  'Driver Behavior', 'Road Damage', 'Mechanical Fault', 'Mounting Error',
  'Wear Limit Reached', 'Other',
]

const SORT = { sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)), sortUndefined: 'last' }
const undef = (v) => (v == null || v === '' ? undefined : v)

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const ctrlCls = `min-h-[44px] sm:min-h-[36px] ${FOCUS}`
const iconBtn = (active) =>
  `w-11 h-11 sm:w-9 sm:h-9 inline-flex items-center justify-center rounded-lg border transition-colors ${FOCUS} `
  + (active
    ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]'
    : 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]')

// ── Sub-components ─────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color = 'text-[var(--text-primary)]', onClick, active }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      {...(onClick ? { type: 'button', 'aria-pressed': !!active } : {})}
      className={`min-w-0 p-4 rounded-xl border transition-all text-left ${onClick ? FOCUS : ''} ${
        active ? 'border-[var(--accent)] ring-1 ring-[var(--accent)] bg-[var(--surface-2)]' : 'card hover:border-[var(--border-bright)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide truncate">{label}</p>
          <p className={`text-2xl font-bold tabular-nums mt-0.5 ${color}`}>{value}</p>
          {sub !== undefined && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
        </div>
        {Icon && <Icon size={20} className={`${color} opacity-60 flex-shrink-0 mt-0.5`} aria-hidden="true" />}
      </div>
    </Tag>
  )
}

function RootCauseBar({ actions }) {
  const { t } = useLanguage()
  const rows = useMemo(() => rootCauseDistribution(actions), [actions])
  const withCause = actions.filter(a => a.root_cause).length
  const max = rows[0]?.count || 0
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 size={14} className="text-[var(--accent)]" aria-hidden="true" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">{t('correctiveactions.analytics.rootCauseDistribution')}</span>
        <span className="text-xs text-[var(--text-muted)] ml-auto">{t('correctiveactions.analytics.withCause', { count: withCause })}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No action in this scope records a root cause.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.cause} className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-secondary)] w-32 truncate flex-shrink-0" title={r.cause}>{r.cause}</span>
              <div className="flex-1 h-2 bg-[var(--panel-2)] rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: colorAt(i) }} />
              </div>
              <span className="text-xs text-[var(--text-secondary)] w-6 text-right tabular-nums">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusSelect({ a, onStatusChange, compact }) {
  const meta = STATUS_META[a.status] ?? STATUS_META.Open
  return (
    <select
      value={a.status}
      aria-label={`Status of ${a.title}`}
      onClick={e => e.stopPropagation()}
      onChange={e => onStatusChange(a.id, e.target.value)}
      className={`text-xs border rounded-md px-2 ${compact ? 'min-h-[36px]' : ctrlCls} cursor-pointer text-[var(--text-primary)] ${FOCUS} ${meta.bg}`}
    >
      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}

function Meta({ icon: Icon, children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 ${className}`}><Icon size={12} aria-hidden="true" />{children}</span>
}

function ActionCard({ a, onEdit, onStatusChange, onRaiseJob, raisingJob, country, now }) {
  const { t } = useLanguage()
  const od = overdueDays(a.due_date, a.status, now)
  const age = daysOpen(a.created_at, a.closed_at, now)
  const meta = STATUS_META[a.status] ?? STATUS_META.Open
  const Icon = meta.icon

  return (
    <article className={`card transition-all hover:border-[var(--border-bright)] ${od ? 'border-red-500/50' : ''}`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon size={14} className={meta.color} aria-hidden="true" />
            <span className="sr-only">{a.status}</span>
            <h3 className="font-semibold text-[var(--text-primary)] text-sm">
              {a.title}
              {a.photo_data && <Camera className="inline w-3 h-3 ml-1.5 text-[var(--text-muted)]" aria-label={t('correctiveactions.card.hasPhoto')} />}
            </h3>
            <span className={`badge text-xs px-2 py-0.5 rounded-full border font-medium ${PRIORITY_BADGE[a.priority] || ''}`}>{a.priority || 'N/A'}</span>
            {od && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/40 font-medium">
                {t('correctiveactions.card.overdueDays', { count: od })}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-[var(--text-secondary)]">
            {a.site && <Meta icon={MapPin}>{a.site}</Meta>}
            {a.assigned_to && <Meta icon={User}>{a.assigned_to}</Meta>}
            {a.asset_no && <Meta icon={Truck}>{a.asset_no}</Meta>}
            {a.tyre_serial && <Meta icon={CircleDot}>{a.tyre_serial}</Meta>}
            {a.due_date && (
              <Meta icon={Calendar} className={od ? 'text-red-400' : ''}>
                {t('correctiveactions.card.due')} {formatDate(a.due_date, country)}
              </Meta>
            )}
            <span className="text-[var(--text-muted)]">
              {age == null ? 'Age N/A' : `${age}d ${a.status === 'Closed' ? t('correctiveactions.card.daysToClose') : t('correctiveactions.card.daysOpen')}`}
            </span>
          </div>

          {a.description && <p className="text-xs text-[var(--text-muted)] mt-2 line-clamp-2">{a.description}</p>}
          <div className="flex flex-wrap gap-2 mt-1.5">
            {a.root_cause && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-[var(--panel-2)] text-[var(--text-secondary)] border border-[var(--border)]">
                <Wrench size={11} aria-hidden="true" /> {a.root_cause}
              </span>
            )}
            {a.source_type && a.source_type !== 'manual' && (
              <span className="text-xs text-[var(--text-muted)]">Raised from {a.source_type}{a.source_detail ? ` (${a.source_detail})` : ''}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <StatusSelect a={a} onStatusChange={onStatusChange} />
          <button onClick={() => onEdit(a)} className={`btn-secondary text-xs px-3 ${ctrlCls}`}>
            {t('correctiveactions.card.edit')}
          </button>
          {a.work_order_id ? (
            <span className="text-xs text-green-400 inline-flex items-center gap-1"><CheckCircle size={12} aria-hidden="true" /> Job raised</span>
          ) : a.asset_no ? (
            <button onClick={() => onRaiseJob(a)} disabled={raisingJob === a.id} className={`btn-secondary text-xs px-3 disabled:opacity-50 ${ctrlCls}`}>
              {raisingJob === a.id ? 'Raising...' : 'Raise job'}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CorrectiveActions() {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const { activeCountry } = useSettings()

  const [actions, setActions]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  // Filters
  const [search, setSearch]               = useState('')
  const [statusFilter, setStatusFilter]   = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [siteFilter, setSiteFilter]       = useState('')
  const [overdueOnly, setOverdueOnly]     = useState(false)
  const [sortBy, setSortBy]               = useState('created_at')

  // UI
  const [viewMode, setViewMode]   = useState('cards')
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [editId, setEditId]       = useState(null)
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState('')
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [raisingJob, setRaisingJob] = useState(null)
  const [jobNotice, setJobNotice] = useState(null)

  const photoRef = useRef(null)

  // ── Data ──────────────────────────────────────────────────────────────────────
  // A failed read is reported as a failure, never rendered as "no actions".
  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    try {
      const data = await correctiveActions.listCorrectiveActions({ country: activeCountry })
      setActions(data ?? [])
      setLoadError(null)
    } catch (err) {
      setLoadError(toUserMessage(err, 'Could not load corrective actions.'))
      if (!quiet) setActions([])
    } finally {
      setNow(Date.now())
      quiet ? setRefreshing(false) : setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Derived ───────────────────────────────────────────────────────────────────
  const sites = useMemo(() =>
    [...new Set(actions.map(a => a.site).filter(Boolean))].sort(),
    [actions]
  )

  /**
   * One predicate, with an opt-out, so every tile and the table narrow the same
   * way. `skip` names the dimension a figure REPORTS ON and must therefore not
   * apply to itself: the Open/In Progress/Closed tiles ARE the status toggles
   * and the Overdue tile IS the overdue toggle, so counting them over a set
   * already narrowed by their own filter makes each one restate the table's row
   * count the moment it is pressed, and stops it being a target you can aim at.
   *
   * Everything else (site, priority, search) DOES apply.
   */
  const narrow = useCallback((arr, skip) => {
    let out = arr
    if (skip !== 'status' && statusFilter) out = out.filter(a => a.status === statusFilter)
    if (priorityFilter) out = out.filter(a => a.priority === priorityFilter)
    if (siteFilter) out = out.filter(a => a.site === siteFilter)
    if (skip !== 'overdue' && overdueOnly) out = out.filter(a => overdueDays(a.due_date, a.status, now) !== null)
    if (search) out = out.filter(a => matchesSearch(a, search))
    return out
  }, [statusFilter, priorityFilter, siteFilter, overdueOnly, search, now])

  // The status tiles hold out the status filter; their denominator is the same
  // base, so the breakdown bar's percentages add up to what the tiles show.
  const statusBase = useMemo(() => narrow(actions, 'status'), [actions, narrow])
  const counts = useMemo(() => {
    const c = { Open: 0, 'In Progress': 0, Closed: 0 }
    statusBase.forEach(a => { if (c[a.status] !== undefined) c[a.status]++ })
    return c
  }, [statusBase])

  const overdueCount = useMemo(() =>
    narrow(actions, 'overdue').filter(a => overdueDays(a.due_date, a.status, now) !== null).length,
    [actions, narrow, now]
  )

  // Not a toggle, so it covers the fully filtered set.
  const avgDaysToClose = useCallback(arr => avgDaysToCloseAt(arr, now), [now])
  const avgClose = useMemo(() => avgDaysToClose(narrow(actions, null)), [actions, narrow, avgDaysToClose])
  const odRate = useMemo(() => overdueRate(statusBase, now), [statusBase, now])
  const bySite = useMemo(() => siteBreakdown(narrow(actions, null), now), [actions, narrow, now])

  // True only while the tiles cover less than the whole register.
  const scopeNarrowed = statusBase.length !== actions.length

  const filtered = useMemo(() => {
    const arr = narrow(actions, null)
    return sortActions(arr, sortBy, now)
  }, [actions, narrow, sortBy, now])
  const tableRows = useMemo(() => actionRows(filtered, now), [filtered, now])
  const actionsPager = usePagedRows(filtered)

  const hasFilters = !!(search || statusFilter || priorityFilter || siteFilter || overdueOnly)
  function clearAll() { setSearch(''); setStatusFilter(''); setPriorityFilter(''); setSiteFilter(''); setOverdueOnly(false) }

  // ── Mutations ─────────────────────────────────────────────────────────────────
  function startAdd() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setShowForm(true)
    setFormError('')
  }

  function startEdit(a) {
    setForm({
      title:        a.title,
      priority:     a.priority,
      site:         a.site ?? '',
      description:  a.description ?? '',
      assigned_to:  a.assigned_to ?? '',
      status:       a.status,
      asset_no:     a.asset_no ?? '',
      tyre_serial:  a.tyre_serial ?? '',
      root_cause:   a.root_cause ?? '',
      due_date:     a.due_date ? a.due_date.split('T')[0] : '',
      photo_data:   a.photo_data ?? null,
    })
    setEditId(a.id)
    setShowForm(true)
    setFormError('')
  }

  async function save(e) {
    e.preventDefault()
    if (!form.title.trim()) { setFormError(t('correctiveactions.errors.titleRequired')); return }
    setSaving(true)
    setFormError('')
    const payload = {
      ...form,
      due_date:    form.due_date || null,
      created_by:  editId ? undefined : profile?.id,
      ...(form.status === 'Closed'
        ? { closed_by: profile?.id, closed_at: new Date().toISOString() }
        : { closed_by: null, closed_at: null }),
    }
    try {
      if (editId) await correctiveActions.updateCorrectiveAction(editId, payload)
      else await correctiveActions.createCorrectiveAction(payload)
    } catch (err) { setFormError(toUserMessage(err, 'Something went wrong. Please try again.')); setSaving(false); return }
    setShowForm(false)
    load(true)
    setSaving(false)
  }

  async function handleStatusChange(id, newStatus) {
    setActionError(null)
    try {
      await correctiveActions.updateCorrectiveAction(id, {
        status: newStatus,
        ...(newStatus === 'Closed'
          ? { closed_by: profile?.id, closed_at: new Date().toISOString() }
          : { closed_by: null, closed_at: null }),
      })
    } catch (err) {
      setActionError(toUserMessage(err, 'The status could not be changed.'))
    }
    load(true)
  }

  /**
   * Turn an action into scheduled work. Delegates to the service, which reuses
   * the ONE work-order creator (workshopLive.createJob) and writes the link back.
   * Errors surface instead of failing silently.
   */
  async function handleRaiseJob(a) {
    setRaisingJob(a.id)
    setJobNotice(null)
    try {
      const job = await correctiveActions.createWorkOrderForAction(a)
      setJobNotice({ ok: true, text: `Job ${job.work_order_no} raised for ${a.asset_no}.` })
      load(true)
    } catch (e) {
      setJobNotice({ ok: false, text: toUserMessage(e) })
    } finally {
      setRaisingJob(null)
    }
  }

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setForm(f => ({ ...f, photo_data: ev.target.result }))
    reader.readAsDataURL(file)
  }

  // ── Export (the whole filtered set) ───────────────────────────────────────────
  async function doExcelExport() {
    const { exportToExcel, reportFileName } = await loadExportUtils()
    exportToExcel(actionExportRows(filtered, now), EXPORT_COLS, EXPORT_HEADERS, reportFileName('TyrePulse Corrective Actions'), 'Actions')
  }

  async function doPdfExport() {
    const { exportToPdf, reportFileName } = await loadExportUtils()
    const cols = ['title', 'priority', 'status', 'site', 'assigned_to', 'asset_no', 'root_cause', 'due_date', 'overdue_days', 'age_days']
    exportToPdf(
      actionExportRows(filtered, now),
      cols.map(k => ({ key: k, header: EXPORT_HEADERS[EXPORT_COLS.indexOf(k)] })),
      'Corrective Actions Register',
      reportFileName('TyrePulse Corrective Actions'),
      'landscape'
    )
  }

  const na = <span className="text-[var(--text-muted)]">N/A</span>
  const columns = useMemo(() => [
    {
      id: 'title', header: t('correctiveactions.table.columns.titleRootCause'), accessorFn: r => r.title, size: 240, ...SORT,
      cell: ({ row }) => {
        const a = row.original
        const meta = STATUS_META[a.status] ?? STATUS_META.Open
        const Icon = meta.icon
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Icon size={12} className={meta.color} aria-hidden="true" />
              <span className="text-sm text-[var(--text-primary)] font-medium">{a.title}</span>
              {a.photo_data && <Camera size={10} className="text-[var(--text-muted)]" aria-label="Has photo" />}
            </div>
            {a.root_cause && <span className="text-xs text-[var(--text-secondary)]">{a.root_cause}</span>}
            {a.source_type && a.source_type !== 'manual' && (
              <span className="block text-xs text-[var(--text-muted)]">Raised from {a.source_type}{a.source_detail ? ` (${a.source_detail})` : ''}</span>
            )}
          </div>
        )
      },
    },
    {
      id: 'priority', header: t('correctiveactions.table.columns.priority'), accessorFn: r => r._priorityRank ?? undefined, size: 90, ...SORT,
      meta: { exportValue: r => r.priority },
      cell: ({ row }) => <span className={`badge text-xs px-2 py-0.5 rounded-full border ${PRIORITY_BADGE[row.original.priority] || ''}`}>{row.original.priority || 'N/A'}</span>,
    },
    { id: 'site', header: t('correctiveactions.table.columns.site'), accessorFn: r => undef(r.site), size: 110, ...SORT, cell: ({ getValue }) => getValue() ?? na },
    { id: 'assigned', header: t('correctiveactions.table.columns.assignedTo'), accessorFn: r => undef(r.assigned_to), size: 120, ...SORT, cell: ({ getValue }) => getValue() ?? na },
    { id: 'asset', header: t('correctiveactions.table.columns.asset'), accessorFn: r => undef(r.asset_no), size: 100, ...SORT, cell: ({ getValue }) => getValue() ?? na },
    {
      id: 'due', header: t('correctiveactions.table.columns.dueDate'), accessorFn: r => undef(r.due_date), size: 120, ...SORT,
      cell: ({ row }) => {
        const a = row.original
        if (a._overdue) return <span className="text-red-400 text-xs">{t('correctiveactions.card.overdueDays', { count: a._overdue })}</span>
        return a.due_date ? <span className="text-xs">{formatDate(a.due_date, activeCountry)}</span> : na
      },
    },
    { id: 'age', header: t('correctiveactions.table.columns.age'), accessorFn: r => undef(r._age), size: 70, meta: { align: 'right' }, ...SORT, cell: ({ getValue }) => (getValue() == null ? na : `${getValue()}d`) },
    {
      id: 'status', header: t('correctiveactions.table.columns.status'), accessorFn: r => r.status, size: 130, meta: { filterVariant: 'select', filterOptions: STATUSES }, ...SORT,
      cell: ({ row }) => <StatusSelect a={row.original} onStatusChange={handleStatusChange} compact />,
    },
    {
      id: 'actions', header: 'Actions', enableSorting: false, size: 150, meta: { export: false },
      cell: ({ row }) => {
        const a = row.original
        return (
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <button onClick={() => startEdit(a)} className={`text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] min-h-[36px] px-1 ${FOCUS}`}>
              {t('correctiveactions.card.edit')}
            </button>
            {a.work_order_id ? (
              <span className="text-xs text-green-400" title="A job has been raised for this action">Job raised</span>
            ) : a.asset_no ? (
              <button onClick={() => handleRaiseJob(a)} disabled={raisingJob === a.id} className={`text-xs text-[var(--text-secondary)] hover:text-green-400 disabled:opacity-50 min-h-[36px] px-1 ${FOCUS}`}>
                {raisingJob === a.id ? 'Raising...' : 'Raise job'}
              </button>
            ) : null}
          </div>
        )
      },
    },
  ], [t, activeCountry, raisingJob]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('correctiveactions.header.title')}
        subtitle={t('correctiveactions.header.subtitleTemplate', {
          total: actions.length,
          open: counts['Open'],
          overdue: overdueCount > 0
            ? t('correctiveactions.header.overdueCount', { count: overdueCount })
            : t('correctiveactions.header.noneOverdue'),
        })}
        icon={ClipboardCheck}
      />

      {loadError && (
        <div role="alert" className="card border border-red-500/40 flex flex-wrap items-center gap-3">
          <AlertTriangle size={18} className="text-red-400 shrink-0" aria-hidden="true" />
          <p className="text-sm text-red-400 flex-1">{loadError}</p>
          <button onClick={() => load()} className={`btn-secondary inline-flex items-center gap-1.5 text-sm px-3 ${ctrlCls}`}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Open" value={counts.Open}
          icon={AlertCircle} color="text-red-400"
          active={statusFilter === 'Open'}
          onClick={() => setStatusFilter(statusFilter === 'Open' ? '' : 'Open')}
        />
        <KpiCard
          label="In Progress" value={counts['In Progress']}
          icon={Clock} color="text-amber-400"
          active={statusFilter === 'In Progress'}
          onClick={() => setStatusFilter(statusFilter === 'In Progress' ? '' : 'In Progress')}
        />
        <KpiCard
          label="Closed" value={counts.Closed}
          icon={CheckCircle} color="text-green-400"
          active={statusFilter === 'Closed'}
          onClick={() => setStatusFilter(statusFilter === 'Closed' ? '' : 'Closed')}
        />
        <KpiCard
          label={t('correctiveactions.kpi.overdue')} value={overdueCount}
          sub={overdueCount > 0 ? t('correctiveactions.kpi.overdueSubNeedsAttention') : t('correctiveactions.kpi.overdueSubOnTrack')}
          icon={AlertTriangle} color={overdueCount > 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}
          active={overdueOnly}
          onClick={() => setOverdueOnly(!overdueOnly)}
        />
        <KpiCard
          label={t('correctiveactions.kpi.avgResolution')} value={avgClose === null ? 'N/A' : `${avgClose}d`}
          sub={avgClose === null ? 'No closed action with dates' : t('correctiveactions.kpi.avgResolutionSub')}
          icon={Timer} color="text-[var(--text-primary)]"
        />
        <KpiCard
          label="Overdue rate" value={odRate == null ? 'N/A' : `${Math.round(odRate)}%`}
          sub={odRate == null ? 'Nothing open' : 'of open actions'}
          icon={TrendingUp} color={odRate ? 'text-red-400' : 'text-[var(--text-primary)]'}
        />
      </div>

      {/* When the tiles cover a narrowed set, say so. A silently narrowed KPI is
          the same defect one level down. */}
      {scopeNarrowed && (
        <p className="text-xs text-[var(--text-muted)] -mt-1">
          These figures cover the {statusBase.length} action{statusBase.length === 1 ? '' : 's'} matching
          your site, priority and search filters, of {actions.length} in total. Each tile ignores its own
          filter so it stays something you can aim at.
        </p>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="relative flex-1 min-w-[200px] max-w-xs">
          <span className="sr-only">{t('correctiveactions.toolbar.searchPlaceholder')}</span>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            type="search"
            className={`input pl-9 text-sm ${ctrlCls}`}
            placeholder={t('correctiveactions.toolbar.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>

        <div className="flex items-center gap-1" role="group" aria-label="Filter by priority">
          {PRIORITIES.map(p => (
            <button key={p}
              onClick={() => setPriorityFilter(priorityFilter === p ? '' : p)}
              aria-pressed={priorityFilter === p}
              className={`px-3 rounded text-xs font-medium border transition-colors ${ctrlCls} ${
                priorityFilter === p ? `${PRIORITY_BADGE[p]} ring-1 ring-[var(--accent)]` : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]'
              }`}
            >{p}</button>
          ))}
        </div>

        {sites.length > 0 && (
          <label>
            <span className="sr-only">Site</span>
            <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} className={`input text-sm pr-7 max-w-[180px] ${ctrlCls}`}>
              <option value="">{t('correctiveactions.toolbar.allSites')}</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}

        {viewMode === 'cards' && (
          <label>
            <span className="sr-only">Sort cards</span>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className={`input text-sm max-w-[160px] ${ctrlCls}`}>
              <option value="created_at">{t('correctiveactions.toolbar.sortNewest')}</option>
              <option value="priority">{t('correctiveactions.toolbar.sortByPriority')}</option>
              <option value="due_date">{t('correctiveactions.toolbar.sortByDueDate')}</option>
              <option value="overdue">{t('correctiveactions.toolbar.sortMostOverdue')}</option>
            </select>
          </label>
        )}

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            aria-pressed={showAnalytics}
            className={`btn-secondary inline-flex items-center gap-1.5 text-sm px-3 ${ctrlCls} ${showAnalytics ? 'border-[var(--accent)] text-[var(--accent)]' : ''}`}
          >
            <BarChart2 size={14} aria-hidden="true" /> {t('correctiveactions.toolbar.analytics')}
          </button>

          <div role="group" aria-label="View mode" className="flex gap-1">
            <button onClick={() => setViewMode('cards')} aria-label="Card view" aria-pressed={viewMode === 'cards'} className={iconBtn(viewMode === 'cards')}>
              <LayoutGrid size={15} aria-hidden="true" />
            </button>
            <button onClick={() => setViewMode('table')} aria-label="Table view" aria-pressed={viewMode === 'table'} className={iconBtn(viewMode === 'table')}>
              <LayoutList size={15} aria-hidden="true" />
            </button>
          </div>

          <button onClick={() => load(true)} disabled={refreshing} aria-label="Refresh corrective actions" className={iconBtn(false)}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          </button>

          <button onClick={doExcelExport} disabled={!filtered.length} className={`btn-secondary inline-flex items-center gap-1.5 text-sm px-3 disabled:opacity-40 ${ctrlCls}`}>
            <Download size={14} aria-hidden="true" /> {t('correctiveactions.toolbar.excel')}
          </button>
          <button onClick={doPdfExport} disabled={!filtered.length} className={`btn-secondary inline-flex items-center gap-1.5 text-sm px-3 disabled:opacity-40 ${ctrlCls}`}>
            <FileText size={14} aria-hidden="true" /> {t('correctiveactions.toolbar.pdf')}
          </button>

          <button onClick={startAdd} className={`btn-primary inline-flex items-center gap-2 text-sm ${ctrlCls}`}>
            <Plus size={16} aria-hidden="true" /> {t('correctiveactions.toolbar.newAction')}
          </button>
        </div>
      </div>

      {hasFilters && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Filter size={12} className="text-[var(--text-muted)]" aria-hidden="true" />
          <span className="text-[var(--text-muted)]">{t('correctiveactions.filtersBar.label')}</span>
          {statusFilter   && <Chip label={statusFilter}   onRemove={() => setStatusFilter('')} />}
          {priorityFilter && <Chip label={priorityFilter} onRemove={() => setPriorityFilter('')} />}
          {siteFilter     && <Chip label={siteFilter}     onRemove={() => setSiteFilter('')} />}
          {overdueOnly    && <Chip label={t('correctiveactions.filtersBar.overdueOnly')} onRemove={() => setOverdueOnly(false)} />}
          {search         && <Chip label={`"${search}"`}  onRemove={() => setSearch('')} />}
          <button onClick={clearAll} className={`text-[var(--text-muted)] hover:text-red-400 transition-colors ml-1 min-h-[32px] px-1 ${FOCUS}`}>
            {t('correctiveactions.filtersBar.clearAll')}
          </button>
          <span className="ml-auto text-[var(--text-muted)]" aria-live="polite">{t('correctiveactions.filtersBar.results', { count: filtered.length })}</span>
        </div>
      )}

      {showAnalytics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <RootCauseBar actions={narrow(actions, null)} />
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={14} className="text-[var(--accent)]" aria-hidden="true" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">{t('correctiveactions.analytics.resolutionPerformance')}</span>
            </div>
            <div className="space-y-2">
              {[
                { label: 'Open', count: counts.Open, pct: statusBase.length ? Math.round(counts.Open / statusBase.length * 100) : 0, color: 'bg-red-500' },
                { label: 'In Progress', count: counts['In Progress'], pct: statusBase.length ? Math.round(counts['In Progress'] / statusBase.length * 100) : 0, color: 'bg-amber-500' },
                { label: 'Closed', count: counts.Closed, pct: statusBase.length ? Math.round(counts.Closed / statusBase.length * 100) : 0, color: 'bg-green-500' },
              ].map(row => (
                <div key={row.label} className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)] w-20">{row.label}</span>
                  <div className="flex-1 h-2 bg-[var(--panel-2)] rounded-full overflow-hidden">
                    <div className={`h-full ${row.color} rounded-full`} style={{ width: `${row.pct}%` }} />
                  </div>
                  <span className="text-xs text-[var(--text-secondary)] w-16 text-right tabular-nums">{row.count} ({row.pct}%)</span>
                </div>
              ))}
              {avgClose !== null && (
                <p className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border)] mt-2">
                  {t('correctiveactions.analytics.avgTimeToClose')} <span className="text-[var(--text-primary)] font-medium">{t('correctiveactions.analytics.daysValue', { count: avgClose })}</span>
                </p>
              )}
              <p className="text-xs text-[var(--text-muted)]">
                {t('correctiveactions.analytics.overdueRate')}{' '}
                <span className={`font-medium ${odRate ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>
                  {odRate == null ? 'N/A' : `${Math.round(odRate)}%`}
                </span>
              </p>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={14} className="text-[var(--accent)]" aria-hidden="true" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Open actions by site</span>
            </div>
            {bySite.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No actions in this scope.</p>
            ) : (
              <ul className="space-y-1.5">
                {bySite.slice(0, 6).map(s => (
                  <li key={s.site} className="flex items-center justify-between text-xs gap-2">
                    <span className="text-[var(--text-secondary)] truncate">{s.site}</span>
                    <span className="tabular-nums text-[var(--text-primary)]">
                      {s.open} open{s.overdue ? <span className="text-red-400">, {s.overdue} overdue</span> : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Outcome of raising a job, or of a status change that failed. Shown
          rather than toasted so it stays on screen until read. */}
      {jobNotice && (
        <div role={jobNotice.ok ? 'status' : 'alert'}
          className={`rounded-lg border px-4 py-2.5 text-sm flex items-start justify-between gap-4 ${
            jobNotice.ok ? 'border-green-500/40 bg-green-500/10 text-green-400' : 'border-red-500/40 bg-red-500/10 text-red-400'}`}>
          <span>{jobNotice.text}</span>
          <button onClick={() => setJobNotice(null)} className={`opacity-70 hover:opacity-100 ${FOCUS}`} aria-label="Dismiss">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {actionError && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 px-4 py-2.5 text-sm flex items-start justify-between gap-4">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className={`opacity-70 hover:opacity-100 ${FOCUS}`} aria-label="Dismiss">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <LoadingState />
      ) : loadError && actions.length === 0 ? null : filtered.length === 0 && viewMode === 'cards' ? (
        <EmptyState hasFilters={hasFilters} onAdd={startAdd} onClear={clearAll} />
      ) : viewMode === 'cards' ? (
        <div className="space-y-2.5">
          {actionsPager.pageRows.map(a => (
            <ActionCard key={a.id} a={a} country={activeCountry} now={now} onEdit={startEdit} onStatusChange={handleStatusChange}
              onRaiseJob={handleRaiseJob} raisingJob={raisingJob} />
          ))}
          <TablePagination {...actionsPager} />
        </div>
      ) : (
        <EnterpriseTable
          viewKey="corrective-actions"
          columns={columns}
          data={tableRows}
          getRowId={r => String(r.id)}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          onRowClick={startEdit}
          emptyMessage={hasFilters ? t('correctiveactions.empty.noMatch') : t('correctiveactions.empty.noneYet')}
        />
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        size="lg"
        title={(
          <span className="flex items-center gap-2">
            <ClipboardCheck size={16} className="text-[var(--accent)]" aria-hidden="true" />
            {editId ? t('correctiveactions.form.editTitle') : t('correctiveactions.form.newTitle')}
          </span>
        )}
        footer={(
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className={`btn-secondary ${ctrlCls}`}>{t('correctiveactions.form.cancel')}</button>
            <button type="submit" form="ca-form" disabled={saving} className={`btn-primary inline-flex items-center gap-2 disabled:opacity-50 ${ctrlCls}`}>
              <Save size={15} aria-hidden="true" /> {saving ? t('correctiveactions.form.saving') : t('correctiveactions.form.save')}
            </button>
          </div>
        )}
      >
        {formError && (
          <div role="alert" className="bg-red-500/10 border border-red-500/40 text-red-400 rounded-lg px-4 py-2.5 mb-4 text-sm">{formError}</div>
        )}
        <form id="ca-form" onSubmit={save} className="space-y-3">
          <div>
            <label className="label" htmlFor="ca-title">{t('correctiveactions.form.titleLabel')} <span aria-hidden="true">*</span></label>
            <input id="ca-title" className="input" placeholder={t('correctiveactions.form.titlePlaceholder')} value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ca-priority">{t('correctiveactions.form.priority')}</label>
              <select id="ca-priority" className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ca-status">{t('correctiveactions.form.status')}</label>
              <select id="ca-status" className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ca-site">{t('correctiveactions.form.site')}</label>
              <input id="ca-site" className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
                list="ca-sites" placeholder={t('correctiveactions.form.sitePlaceholder')} />
              <datalist id="ca-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label className="label" htmlFor="ca-due">{t('correctiveactions.form.dueDate')}</label>
              <input id="ca-due" type="date" className="input" value={form.due_date}
                onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ca-assigned">{t('correctiveactions.form.assignedTo')}</label>
              <input id="ca-assigned" className="input" value={form.assigned_to}
                onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="ca-asset">{t('correctiveactions.form.assetNo')}</label>
              <input id="ca-asset" className="input" value={form.asset_no}
                onChange={e => setForm(f => ({ ...f, asset_no: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="ca-serial">{t('correctiveactions.form.tyreSerial')}</label>
            <input id="ca-serial" className="input" value={form.tyre_serial}
              onChange={e => setForm(f => ({ ...f, tyre_serial: e.target.value }))}
              placeholder={t('correctiveactions.form.tyreSerialPlaceholder')} />
          </div>

          <div>
            <label className="label" htmlFor="ca-cause">{t('correctiveactions.form.rootCause')}</label>
            <select id="ca-cause" className="input" value={form.root_cause}
              onChange={e => setForm(f => ({ ...f, root_cause: e.target.value }))}>
              <option value="">{t('correctiveactions.form.selectRootCause')}</option>
              {ROOT_CAUSES.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="ca-desc">{t('correctiveactions.form.description')}</label>
            <textarea id="ca-desc" className="input" rows={3} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder={t('correctiveactions.form.descriptionPlaceholder')} />
          </div>

          <div>
            <span className="label">{t('correctiveactions.form.photo')}</span>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={() => photoRef.current?.click()} className={`btn-secondary text-sm inline-flex items-center gap-2 px-3 ${ctrlCls}`}>
                <Camera size={14} aria-hidden="true" /> {form.photo_data ? t('correctiveactions.form.changePhoto') : t('correctiveactions.form.attachPhoto')}
              </button>
              {form.photo_data && (
                <button type="button" onClick={() => setForm(f => ({ ...f, photo_data: null }))} className={`text-xs text-red-400 hover:text-red-300 min-h-[36px] px-1 ${FOCUS}`}>
                  {t('correctiveactions.form.removePhoto')}
                </button>
              )}
              <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} aria-label={t('correctiveactions.form.photo')} />
            </div>
            {form.photo_data && (
              <img src={form.photo_data} alt={t('correctiveactions.form.evidenceAlt')} className="mt-2 rounded-lg max-h-40 border border-[var(--border)] object-cover w-full" />
            )}
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ── Util sub-components ────────────────────────────────────────────────────────
function Chip({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-[var(--surface-2)] text-[var(--text-primary)] border border-[var(--border)] rounded-full">
      {label}
      <button onClick={onRemove} aria-label={`Remove filter ${label}`} className={`w-6 h-6 inline-flex items-center justify-center rounded-full hover:text-red-400 ${FOCUS}`}>
        <X size={10} aria-hidden="true" />
      </button>
    </span>
  )
}

function LoadingState() {
  return <SkeletonTable rows={8} cols={8} />
}

function EmptyState({ hasFilters, onAdd, onClear }) {
  const { t } = useLanguage()
  return (
    <div className="card text-center py-16">
      <ClipboardCheck size={40} className="mx-auto text-[var(--text-dim)] mb-3" aria-hidden="true" />
      <p className="text-[var(--text-secondary)] font-medium">
        {hasFilters ? t('correctiveactions.empty.noMatch') : t('correctiveactions.empty.noneYet')}
      </p>
      <p className="text-[var(--text-muted)] text-sm mt-1">
        {hasFilters ? t('correctiveactions.empty.noMatchHint') : t('correctiveactions.empty.noneYetHint')}
      </p>
      {hasFilters ? (
        <button onClick={onClear} className="btn-secondary mt-4 inline-flex items-center gap-2 text-sm min-h-[44px] px-4">
          <X size={14} aria-hidden="true" /> {t('correctiveactions.filtersBar.clearAll')}
        </button>
      ) : (
        <button onClick={onAdd} className="btn-primary mt-4 inline-flex items-center gap-2 text-sm min-h-[44px]">
          <Plus size={14} aria-hidden="true" /> {t('correctiveactions.toolbar.newAction')}
        </button>
      )}
    </div>
  )
}
