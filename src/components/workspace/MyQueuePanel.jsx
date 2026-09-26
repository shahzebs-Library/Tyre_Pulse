/**
 * MyQueuePanel - the personal work queue on My Workspace. Everything shown is
 * the signed-in person's own work, bounded by RLS; failed sources are named,
 * never rendered as an empty queue.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, AlertTriangle, Clock, CheckSquare, ClipboardList, RefreshCw, FileSpreadsheet, FileText } from 'lucide-react'
import { loadMyQueue, QUEUE_LIST_LIMIT } from '../../lib/api/myQueue'
import { buildMyQueue, queueKpis, filterQueue, sortQueue, queueExportRows, QUEUE_KINDS } from '../../lib/myQueueAnalytics'
import { toUserMessage } from '../../lib/safeError'

const APPROVER_ROLES = new Set(['Admin', 'Manager', 'Director', 'Maintenance Supervisor', 'PMV Manager', 'Workshop Area Manager', 'Workshop Maintenance Area Manager', 'Workshop Supervisor'])
const SOURCE_LABELS = { workOrders: 'work orders', checklistAssignments: 'checklist assignments', myInspections: 'your inspections', myChecklists: 'your checklists', approvals: 'approvals' }
const EXPORT_COLS = ['type', 'title', 'detail', 'status', 'due', 'due_state', 'age_days']
const EXPORT_HEADERS = ['Type', 'Item', 'Detail', 'Status', 'Due', 'Due state', 'Age (days)']
const DUE_TONE = { overdue: 'text-red-500', due_soon: 'text-amber-500', later: 'text-[var(--text-secondary)]', none: 'text-[var(--text-muted)]' }
const DUE_TEXT = { overdue: 'Overdue', due_soon: 'Due soon', later: 'Scheduled', none: '' }

function Tile({ label, value, icon: Icon, tone = '' }) {
  return <div className="card"><div className="flex items-center justify-between"><p className="text-xs text-[var(--text-muted)]">{label}</p>{Icon && <Icon size={15} className={tone} aria-hidden="true" />}</div><p className={`text-2xl font-bold mt-1 ${tone}`}>{value == null ? 'N/A' : value.toLocaleString()}</p></div>
}

export default function MyQueuePanel({ profile, country, isSuperAdmin = false }) {
  const [state, setState] = useState({ loading: true, error: '', data: null })
  const [attempt, setAttempt] = useState(0)
  const [group, setGroup] = useState('all')
  const [due, setDue] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('urgency')
  const [exportError, setExportError] = useState('')
  const profileId = profile?.id
  const role = profile?.role
  const canApprove = isSuperAdmin || APPROVER_ROLES.has(role)

  useEffect(() => {
    if (!profileId) return undefined
    const controller = new AbortController()
    setState({ loading: true, error: '', data: null })
    loadMyQueue({ profileId, role, country, canApprove, signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ loading: false, error: '', data }) })
      .catch(err => { if (!controller.signal.aborted) setState({ loading: false, error: toUserMessage(err, 'Your queue could not be loaded.'), data: null }) })
    return () => controller.abort()
  }, [profileId, role, country, canApprove, attempt])

  const items = useMemo(() => (state.data ? buildMyQueue(state.data.sources) : []), [state.data])
  const kpis = useMemo(() => queueKpis(items, state.data?.unavailable || {}), [items, state.data])
  const shown = useMemo(() => sortQueue(filterQueue(items, { group, due, search }), sort), [items, group, due, search, sort])
  const retry = useCallback(() => setAttempt(n => n + 1), [])
  const failed = Object.keys(state.data?.unavailable || {}).filter(k => SOURCE_LABELS[k])
  const woTotal = state.data?.totals?.workOrders

  async function doExport(kind) {
    setExportError('')
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await import('../../lib/exportUtils')
      const rows = queueExportRows(shown)
      const name = reportFileName('My Work Queue')
      if (kind === 'excel') await exportToExcel(rows, EXPORT_COLS, EXPORT_HEADERS, name)
      else await exportToPdf(rows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'My Work Queue', name, 'landscape')
    } catch (err) { setExportError(toUserMessage(err, 'The export could not be created.')) }
  }

  if (!profileId) return null
  return <section className="space-y-4" aria-label="My work queue">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-lg font-semibold text-[var(--text-primary)]">My work queue</h2><p className="text-xs text-[var(--text-muted)]">Work assigned to you, approvals waiting on your role and your own recent records.</p></div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={retry} disabled={state.loading}><RefreshCw size={14} aria-hidden="true" /> Refresh queue</button>
        <button className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={() => doExport('excel')} disabled={!shown.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
        <button className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={() => doExport('pdf')} disabled={!shown.length}><FileText size={14} aria-hidden="true" /> PDF</button>
      </div>
    </div>
    {state.loading && <div className="card text-sm text-[var(--text-muted)]">Loading your queue...</div>}
    {state.error && <div className="card text-sm"><p className="text-red-500">{state.error}</p><button className="btn-secondary mt-2" onClick={retry}>Retry</button></div>}
    {state.data && <>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile label="My open work orders" value={kpis.openWork} icon={ClipboardList} />
        <Tile label="Overdue" value={kpis.overdue} icon={AlertTriangle} tone={kpis.overdue ? 'text-red-500' : ''} />
        <Tile label="Due in 3 days" value={kpis.dueSoon} icon={Clock} tone={kpis.dueSoon ? 'text-amber-500' : ''} />
        <Tile label="Approvals waiting" value={canApprove ? kpis.approvals : null} icon={CheckSquare} />
        <Tile label="Checklists due" value={kpis.checklistsDue} icon={ClipboardList} />
        <Tile label="My recent records" value={kpis.recent} icon={Inbox} />
      </div>
      {!canApprove && <p className="text-xs text-[var(--text-muted)]">Approvals show N/A because your role does not sign off approvals.</p>}
      {failed.length > 0 && <p className="text-xs text-amber-500">Could not read {failed.map(k => SOURCE_LABELS[k]).join(', ')}. Those counts show N/A. <button className="underline" onClick={retry}>Retry</button></p>}
      {woTotal != null && woTotal > QUEUE_LIST_LIMIT && <p className="text-xs text-[var(--text-muted)]">Showing the {QUEUE_LIST_LIMIT} most urgent of {woTotal.toLocaleString()} open work orders assigned to you. <Link className="underline" to="/work-orders">Open Work Orders</Link> for the full list.</p>}
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <input className="input flex-1 min-w-[180px]" aria-label="Search my queue" placeholder="Search job, asset, site, status" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="input" aria-label="Queue type" value={group} onChange={e => setGroup(e.target.value)}><option value="all">All types</option><option value="work">Work orders</option><option value="approval">Approvals</option><option value="due">Checklists due</option><option value="recent">My recent records</option></select>
          <select className="input" aria-label="Due state" value={due} onChange={e => setDue(e.target.value)}><option value="all">Any due date</option><option value="overdue">Overdue</option><option value="due_soon">Due soon</option><option value="later">Later</option><option value="none">No due date</option></select>
          <select className="input" aria-label="Sort queue" value={sort} onChange={e => setSort(e.target.value)}><option value="urgency">Most urgent first</option><option value="age">Oldest first</option><option value="title">Name</option></select>
        </div>
        {!items.length ? <p className="text-sm text-[var(--text-muted)] py-6 text-center">Nothing is assigned to you or waiting on you right now.</p>
          : !shown.length ? <p className="text-sm text-[var(--text-muted)] py-6 text-center">No queue items match these filters.</p>
          : <ul className="divide-y divide-[var(--hairline)]">{shown.map(i => <li key={i.id}><Link to={i.link} className="flex flex-wrap items-center gap-3 py-2.5 hover:bg-[var(--surface-hover)] rounded px-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] w-36 shrink-0">{QUEUE_KINDS[i.kind].label}</span>
            <span className="flex-1 min-w-[160px]"><span className="font-medium text-[var(--text-primary)]">{i.title}</span>{i.subtitle && <span className="block text-xs text-[var(--text-muted)]">{i.subtitle}</span>}</span>
            <span className="text-xs text-[var(--text-secondary)]">{i.status}</span>
            <span className={`text-xs w-40 text-end ${DUE_TONE[i.dueState]}`}>{i.due ? `${DUE_TEXT[i.dueState]} ${String(i.due).slice(0, 10)}` : i.age != null ? `${i.age} days old` : ''}</span>
          </Link></li>)}</ul>}
        {exportError && <p className="text-sm text-red-500">{exportError}</p>}
      </div>
    </>}
  </section>
}
