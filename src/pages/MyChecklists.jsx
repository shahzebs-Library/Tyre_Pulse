import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ClipboardCheck, Play, SkipForward, Eye, RefreshCw, AlertTriangle,
  CheckCircle2, Clock, CalendarClock, ListChecks, Zap, MapPin, Boxes, Users,
  Search, X, FileSpreadsheet, FileText, Percent, CalendarDays,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  decorateAssignments, checklistKpis, filterByTab, filterAssignments, distinctValues,
  dueHint, prettyStatus, tabCount, assignmentExportRows, TABS,
} from '../lib/myChecklistsAnalytics'
import { compareValues } from '../lib/consoleTable'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { listAssignments, skipAssignment, generateNow } from '../lib/api/checklistSchedules'
import { listTemplates } from '../lib/api/checklists'
import {
  filterTemplatesForRole, filterAssignmentsForRole, roleTargetLabel, isOversightRole,
} from '../lib/checklist/checklistRoles'
import { resolveChecklistIcon, checklistIconComponent } from '../lib/checklist/checklistIcons'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

/**
 * The template's icon, resolved rather than printed raw - `icon` holds an emoji
 * on some rows and a lucide component name on others.
 */
function TemplateIcon({ template }) {
  const res = resolveChecklistIcon(template)
  if (res.kind === 'emoji') {
    return <span className="text-xl leading-none" role="img" aria-label="Checklist icon">{res.emoji}</span>
  }
  const Icon = checklistIconComponent(res.token)
  return <Icon size={18} className="text-brand-bright" aria-hidden="true" />
}

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? 'N/A'
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

const TONE_TEXT = {
  red: 'text-red-400',
  amber: 'text-amber-400',
  green: 'text-green-400',
  muted: 'text-[var(--text-muted)]',
}

const STATUS_BADGE = {
  overdue: 'bg-red-900/40 text-red-300 border border-red-700/50',
  pending: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  completed: 'bg-green-900/40 text-green-300 border border-green-700/50',
  skipped: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
function statusBadge(s) {
  return STATUS_BADGE[s] || STATUS_BADGE.skipped
}
export default function MyChecklists() {
  const navigate = useNavigate()
  const { activeCountry } = useSettings()
  const { profile, isSuperAdmin } = useAuth()
  const role = profile?.role || ''
  const roleOpts = useMemo(() => ({ isSuperAdmin: !!isSuperAdmin }), [isSuperAdmin])
  const seesEverything = isOversightRole(role, roleOpts)

  const [assignments, setAssignments] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [tab, setTab] = useState('todo')
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [templateFilter, setTemplateFilter] = useState('')
  const [generating, setGenerating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState(null) // { kind:'success'|'error', msg }

  const showToast = useCallback((kind, msg) => {
    setToast({ kind, msg })
    window.clearTimeout(showToast._t)
    showToast._t = window.setTimeout(() => setToast(null), 4000)
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(''); setMissing(false)
    try {
      // The published templates ride along so a person can see the checklists
      // WRITTEN for their trade even before a schedule has generated anything -
      // which is the whole state today, because no schedule exists yet. It is
      // best-effort: a failed template read must not empty the to-do list.
      const [rows, tpls] = await Promise.all([
        listAssignments({ country: activeCountry }),
        listTemplates({ status: 'published', country: activeCountry }).catch(() => []),
      ])
      setAssignments(Array.isArray(rows) ? rows : [])
      setTemplates(Array.isArray(tpls) ? tpls : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      else setError(toUserMessage(err, 'Could not load your checklists.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Decorate with derived status + sort once, reuse everywhere.
  // An assignment aimed at another trade is not this person's work. A row with
  // no assignee_role stays visible to everyone (that is what NULL means), and
  // oversight roles keep seeing all of them. Filtering here rather than in the
  // render keeps the KPI counts and the table describing the same set.
  const decorated = useMemo(
    () => decorateAssignments(filterAssignmentsForRole(assignments, role, roleOpts), new Date()),
    [assignments, role, roleOpts],
  )

  // The published checklists written for this person's trade. Untargeted
  // templates are everyone's; oversight roles see the lot.
  const myTemplates = useMemo(
    () => filterTemplatesForRole(templates, role, roleOpts),
    [templates, role, roleOpts],
  )
  // template_id -> template, so an assignment row can show the same icon and
  // the same "For:" chip as the card it came from.
  const templateById = useMemo(() => {
    const m = new Map()
    for (const t of templates) if (t?.id != null) m.set(String(t.id), t)
    return m
  }, [templates])
  // The search / site / checklist filters narrow what the KPIs and the table
  // describe together; the status tab is held out of the KPIs because the tiles
  // ARE the status readings (a tile restating the tab just picked is no reading).
  const scoped = useMemo(
    () => filterAssignments(decorated, { q: search, site: siteFilter, template: templateFilter }),
    [decorated, search, siteFilter, templateFilter],
  )
  const kpis = useMemo(() => checklistKpis(scoped), [scoped])
  const visible = useMemo(() => filterByTab(scoped, tab), [scoped, tab])
  const siteOptions = useMemo(() => distinctValues(decorated, 'site'), [decorated])
  const templateOptions = useMemo(() => distinctValues(decorated, 'template_name'), [decorated])
  const filtersActive = !!(search || siteFilter || templateFilter)
  const clearFilters = () => { setSearch(''); setSiteFilter(''); setTemplateFilter('') }

  const exportRows = () => assignmentExportRows(visible, new Date())
  const EXPORT_COLS = ['checklist', 'role', 'site', 'asset', 'due_date', 'due', 'status']
  const EXPORT_HEADERS = ['Checklist', 'Role', 'Site', 'Asset', 'Due date', 'Due', 'Status']
  const exportName = () => reportFileName('My Checklists', reportDateLabel())
  const doExcel = () => exportToExcel(exportRows(), EXPORT_COLS, EXPORT_HEADERS, exportName(), 'My Checklists')
  const doPdf = () => exportToPdf(exportRows(), EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'My Checklists', exportName(), 'landscape')

  const handleGenerate = useCallback(async () => {
    setGenerating(true); setError('')
    try {
      const res = await generateNow()
      const count = typeof res === 'number' ? res : (res?.count ?? res?.generated ?? null)
      await load()
      showToast('success', count != null
        ? `Generated ${count} due checklist${count === 1 ? '' : 's'}.`
        : 'Due checklists refreshed.')
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      showToast('error', toUserMessage(err, 'Could not generate due checklists.'))
    } finally {
      setGenerating(false)
    }
  }, [load, showToast])

  const handleSkip = useCallback(async (a) => {
    if (!a?.id) return
    const reason = window.prompt(`Why is "${a.template_name || 'this checklist'}" being skipped? This reason becomes part of the audit record.`)
    if (!reason?.trim()) return
    setBusyId(a.id); setError('')
    try {
      const updated = await skipAssignment(a.id, reason)
      setAssignments((prev) => prev.map((r) => r.id === a.id ? { ...r, ...updated } : r))
      showToast('success', 'Assignment skipped.')
    } catch (err) {
      showToast('error', toUserMessage(err, 'Could not skip this assignment.'))
    } finally {
      setBusyId(null)
    }
  }, [showToast])

  const start = useCallback((a) => {
    if (!a?.template_id || !a?.id) return
    navigate(`/checklists/${a.template_id}/run?assignment=${a.id}`)
  }, [navigate])

  const kpiCards = [
    { key: 'overdue', label: 'Overdue', value: kpis.overdue, icon: AlertTriangle,
      cls: 'text-red-400', ring: 'border-red-700/40 bg-red-900/10' },
    { key: 'pending', label: 'Due (pending)', value: kpis.pending, icon: Clock,
      cls: 'text-amber-400', ring: 'border-amber-700/40 bg-amber-900/10' },
    { key: 'week', label: 'Due in 7 days', value: kpis.dueThisWeek, icon: CalendarDays,
      cls: 'text-sky-400', ring: 'border-sky-700/40 bg-sky-900/10' },
    { key: 'completed', label: 'Completed', value: kpis.completed, icon: CheckCircle2,
      cls: 'text-green-400', ring: 'border-green-700/40 bg-green-900/10' },
    { key: 'rate', label: 'Completion rate', value: kpis.completionRate == null ? 'N/A' : `${kpis.completionRate}%`, icon: Percent,
      cls: 'text-[var(--text-primary)]', ring: 'border-[var(--border-dim)]',
      hint: 'Completed against every assignment that is overdue or was decided' },
  ]

  const columns = useMemo(() => [
    {
      id: 'checklist', header: 'Checklist', accessorFn: (a) => a.template_name || 'Checklist', size: 280, sortingFn: valueSort,
      cell: ({ row }) => {
        const a = row.original
        const tpl = templateById.get(String(a.template_id))
        return (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0"><TemplateIcon template={tpl || { name: a.template_name }} /></span>
            <div className="min-w-0">
              <div className="font-medium text-[var(--text-primary)]">{a.template_name || 'Checklist'}</div>
              {a.assignee_role && <div className="text-xs text-[var(--text-muted)] mt-0.5">Role: {a.assignee_role}</div>}
              {roleTargetLabel(tpl) && (
                <div className="text-xs text-amber-400 mt-0.5 inline-flex items-center gap-1">
                  <Users size={11} aria-hidden="true" /> For: {roleTargetLabel(tpl)}
                </div>
              )}
            </div>
          </div>
        )
      },
    },
    {
      id: 'target', header: 'Target', accessorFn: (a) => [a.site, a.asset_no].filter(Boolean).join(' ') || undefined, size: 180,
      sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => {
        const a = row.original
        return (
          <div className="flex flex-col gap-0.5 text-xs">
            {a.site && <span className="inline-flex items-center gap-1 text-[var(--text-primary)]"><MapPin size={12} className="text-[var(--text-muted)]" aria-hidden="true" /> {a.site}</span>}
            {a.asset_no && <span className="inline-flex items-center gap-1 text-[var(--text-muted)]"><Boxes size={12} aria-hidden="true" /> {a.asset_no}</span>}
            {!a.site && !a.asset_no && <span className="text-[var(--text-muted)]">N/A</span>}
          </div>
        )
      },
      meta: { exportValue: (a) => [a.site, a.asset_no].filter(Boolean).join(' / ') || 'N/A' },
    },
    {
      id: 'due', header: 'Due', accessorFn: (a) => a.due_date || undefined, size: 170, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => {
        const a = row.original
        const hint = dueHint(a.due_date, a._status)
        return (
          <div className="whitespace-nowrap">
            <div className="inline-flex items-center gap-1.5 text-[var(--text-primary)]">
              <CalendarClock size={13} className="text-[var(--text-muted)]" aria-hidden="true" /> {fmtDate(a.due_date)}
            </div>
            <div className={`text-xs mt-0.5 ${TONE_TEXT[hint.tone] || TONE_TEXT.muted}`}>{hint.text}</div>
          </div>
        )
      },
      meta: { exportValue: (a) => (a.due_date ? String(a.due_date).slice(0, 10) : 'N/A') },
    },
    {
      id: 'status', header: 'Status', accessorFn: (a) => prettyStatus(a._status), size: 120, sortingFn: valueSort,
      cell: ({ row }) => <span className={`badge text-xs ${statusBadge(row.original._status)}`}>{prettyStatus(row.original._status)}</span>,
    },
    {
      id: 'actions', header: 'Actions', enableSorting: false, size: 230, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const a = row.original
        const status = a._status
        const actionable = status === 'overdue' || status === 'pending'
        const rowBusy = busyId === a.id
        const name = a.template_name || 'checklist'
        return (
          <div className="flex items-center justify-end gap-2">
            {actionable && (
              <>
                <button type="button" onClick={() => start(a)} disabled={rowBusy}
                  className="btn-primary text-xs min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-50">
                  <Play size={13} aria-hidden="true" /> Start<span className="sr-only"> {name}</span>
                </button>
                <button type="button" onClick={() => handleSkip(a)} disabled={rowBusy}
                  className="btn-secondary text-xs min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-50">
                  {rowBusy ? <RefreshCw size={13} className="animate-spin" aria-hidden="true" /> : <SkipForward size={13} aria-hidden="true" />} Skip<span className="sr-only"> {name}</span>
                </button>
              </>
            )}
            {status === 'completed' && (
              a.submission_id ? (
                <Link to={`/checklists/submission/${a.submission_id}`} className="btn-secondary text-xs min-h-[44px] inline-flex items-center gap-1.5">
                  <Eye size={13} aria-hidden="true" /> View<span className="sr-only"> {name} submission</span>
                </Link>
              ) : (
                <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-green-400" aria-hidden="true" /> Done
                </span>
              )
            )}
            {status === 'skipped' && (
              <button type="button" onClick={() => start(a)} className="btn-secondary text-xs min-h-[44px] inline-flex items-center gap-1.5">
                <Play size={13} aria-hidden="true" /> Run anyway<span className="sr-only"> {name}</span>
              </button>
            )}
          </div>
        )
      },
    },
  ], [templateById, busyId, start, handleSkip])

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={doExcel} disabled={loading || !visible.length}
        className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-50">
        <FileSpreadsheet size={14} aria-hidden="true" /> Excel
      </button>
      <button type="button" onClick={doPdf} disabled={loading || !visible.length}
        className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-50">
        <FileText size={14} aria-hidden="true" /> PDF
      </button>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating || missing}
        className="btn-primary text-sm min-h-[44px] inline-flex items-center gap-2 disabled:opacity-50"
        title="Materialise any checklist assignments that are due right now"
      >
        <Zap size={15} className={generating ? 'animate-pulse' : ''} aria-hidden="true" />
        {generating ? 'Generating...' : 'Generate due now'}
      </button>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Checklists"
        subtitle="Checklist assignments due to you: start, complete, or skip scheduled inspections."
        icon={ClipboardCheck}
        badge={!loading && !missing && !error ? `${kpis.todo} to do` : undefined}
        actions={headerActions}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl px-4 py-3 text-sm shadow-lg border flex items-start gap-2 ${
            toast.kind === 'success'
              ? 'bg-green-900/80 border-green-700/60 text-green-100'
              : 'bg-red-900/80 border-red-700/60 text-red-100'
          }`}
        >
          {toast.kind === 'success'
            ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* KPI strip - covers the search / site / checklist filters, not the tab */}
      {!missing && !error && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {kpiCards.map(({ key, label, value, icon: Icon, cls, ring, hint }) => (
            <div key={key} className={`card flex items-center gap-3 border ${ring}`} title={hint}>
              <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] flex items-center justify-center shrink-0">
                <Icon size={18} className={cls} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{label}</p>
                {loading
                  ? <div className="h-7 w-10 mt-1 bg-[var(--input-bg)] rounded animate-pulse" />
                  : <p className={`text-2xl font-bold tabular-nums ${cls}`}>{value}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {!missing && !error && !loading && filtersActive && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">
          These figures cover the {scoped.length} assignment{scoped.length === 1 ? '' : 's'} matching your search and filters, of {decorated.length} in total.
        </p>
      )}

      {/* Filters */}
      {!missing && !error && (
        <div className="card">
          <div className="flex flex-wrap items-end gap-2">
            <label className="relative flex-1 min-w-[220px]">
              <span className="sr-only">Search checklists</span>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input w-full pl-9 min-h-[44px]" placeholder="Search checklist, role, site or asset" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label className="text-xs text-[var(--text-muted)]">
              <span className="sr-only">Site</span>
              <select className="input min-h-[44px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
                <option value="">All sites</option>
                {siteOptions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--text-muted)]">
              <span className="sr-only">Checklist</span>
              <select className="input min-h-[44px]" value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)} aria-label="Checklist">
                <option value="">All checklists</option>
                {templateOptions.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-1.5">
                <X size={14} aria-hidden="true" /> Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Status tabs */}
      {!missing && !error && (
        <div className="flex items-center gap-1 border-b border-[var(--border-dim)] overflow-x-auto" role="tablist" aria-label="Assignment status">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`px-4 min-h-[44px] text-sm font-medium flex items-center gap-2 border-b-2 -mb-px whitespace-nowrap transition-colors ${
                tab === key
                  ? 'border-green-500 text-green-400'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {label}
              {!loading && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)]">{tabCount(key, kpis)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Migration hint (tables not deployed) */}
      {missing && (
        <div className="card border border-amber-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-amber-300 font-medium">Checklist scheduling isn't enabled on this database yet.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">
                Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V124_CHECKLIST_SCHEDULES.sql</span> to create the
                {' '}<span className="font-mono">checklist_schedules</span> and <span className="font-mono">checklist_assignments</span> tables, then reload.
              </p>
              <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px] mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !missing && (
        <div className="card border border-red-800/50" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-red-300 font-medium">Couldn't load your checklists.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
              <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px] mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state: nothing assigned at all (a real answer, distinct from a filter miss) */}
      {!loading && !missing && !error && decorated.length === 0 && (
        <div className="card text-center py-16 space-y-3">
          <CheckCircle2 size={36} className="mx-auto text-green-400" aria-hidden="true" />
          <p className="text-[var(--text-primary)] font-semibold">You're all caught up, no checklists due</p>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
            Scheduled assignments will appear here as they come due. Browse published checklists to run one on demand.
          </p>
          <Link to="/checklists" className="btn-secondary text-sm min-h-[44px] inline-flex items-center gap-2 mx-auto">
            <ListChecks size={15} aria-hidden="true" /> Browse checklists
          </Link>
        </div>
      )}

      {/* Assignment register */}
      {!missing && !error && (loading || decorated.length > 0) && (
        <EnterpriseTable
          columns={columns}
          data={visible}
          getRowId={(a) => String(a.id)}
          loading={loading}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          initialPageSize={25}
          emptyMessage={filtersActive
            ? 'No assignments match these filters. Clear the search or filters to see more.'
            : tab === 'todo' ? 'Nothing is due. You are all caught up.' : 'No assignments in this view. Try the To do tab.'}
        />
      )}

      {/* ── Checklists written for this trade ──
          Assignments only exist once a schedule generates them. This section
          answers the question the owner actually asked - "which checklists are
          mine?" - straight from the published templates, filtered to the roles
          each one names. It is a shortcut to fill one on demand, not a to-do
          list, so nothing here is counted as due. */}
      {!loading && !missing && !error && myTemplates.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <ListChecks size={15} className="text-green-400" />
              {seesEverything ? 'Published checklists' : 'Checklists for your role'}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {seesEverything
                ? 'Every published checklist. Fill one on demand without waiting for a schedule.'
                : `Written for ${role || 'your role'}, plus the ones written for everyone. Fill one on demand.`}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {myTemplates.map((tpl) => (
              <div key={tpl.id} className="card flex flex-col">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-subtle border border-[rgba(22,163,74,0.2)] flex items-center justify-center shrink-0">
                    <TemplateIcon template={tpl} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[var(--text-primary)] font-semibold truncate">{tpl.name || 'Untitled checklist'}</h3>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{tpl.category || 'General'}</p>
                  </div>
                </div>
                {/* Nothing rendered for an untargeted checklist - an "Everyone"
                    chip on every card is noise, not information. */}
                {roleTargetLabel(tpl) && (
                  <span className="badge text-xs bg-amber-900/40 text-amber-300 border border-amber-700/50 inline-flex items-center gap-1 mt-3 self-start">
                    <Users size={11} /> For: {roleTargetLabel(tpl)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => navigate(`/checklists/${tpl.id}/run`)}
                  className="btn-primary text-sm min-h-[44px] inline-flex items-center gap-2 justify-center mt-4"
                >
                  <Play size={15} aria-hidden="true" /> Fill<span className="sr-only"> {tpl.name || 'checklist'}</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* An honest note when the register is published but none of it is aimed
          at this person - "nothing for you" is a real answer, and it is not the
          same as "nothing exists". */}
      {!loading && !missing && !error && templates.length > 0 && myTemplates.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          None of the published checklists is written for {role || 'your role'} yet.{' '}
          <Link to="/checklists" className="text-green-400 hover:underline">Browse all checklists</Link>
        </p>
      )}
    </div>
  )
}
