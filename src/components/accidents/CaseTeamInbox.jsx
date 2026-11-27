import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Clock, AlertTriangle, CheckCircle2, User, Users, MapPin, RefreshCw } from 'lucide-react'
import { listMyAccidentTasks } from '../../lib/api/accidentOwnership'
import { splitTasks, taskCounts } from '../../lib/accidentOwnership'
import useAccidentOwnershipText from './useAccidentOwnershipText'
import { toUserMessage } from '../../lib/safeError'

/**
 * My accident tasks (B1), built on accident_my_tasks(): the open case steps owned
 * by me ("Assigned to me") and by my role in my country / site ("For my team").
 * Overdue first, then due soonest, then longest in the step.
 *
 * Pass `items` to render a ready list (tests, the Command Center card); leave it
 * undefined and the component loads the signed-in user's tasks itself.
 * Honest states: loading, not switched on yet, error with retry, empty.
 */
const PILL = {
  // 500-level ink on a 10% tint reads in both the light and the dark theme.
  danger: 'border-red-500/40 bg-red-500/10 text-red-500',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-600',
  good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600',
  quiet: 'border-[var(--input-border)] bg-[var(--input-bg)]/40 text-[var(--text-dim)]',
}
function slaTone(t) {
  if (t.overdue) return 'danger'
  if (t.sla_state === 'warning') return 'warning'
  if (t.sla_state === 'running' || t.sla_state === 'met') return 'good'
  return 'quiet'
}
function dueText(dueAt) {
  if (!dueAt) return null
  const d = new Date(dueAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const rowKey = (t) => t.workstream_id || `${t.accident_id}-${t.workstream_key}`

function TaskRow({ task }) {
  const L = useAccidentOwnershipText()
  const { tx } = L
  const tone = slaTone(task)
  const due = dueText(task.due_at)
  return (
    <li className="py-2.5">
      <Link
        to={`/accidents/${task.accident_id}?tab=workstreams`}
        className="block rounded-lg px-2 -mx-2 py-1 hover:bg-[var(--surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-[var(--text-primary)]">{task.reference_no ? tx('inbox.case', { ref: task.reference_no }) : tx('inbox.caseNoRef')}</span>
          <span className="text-sm text-[var(--text-secondary)]">{L.step(task.workstream_key) || task.workstream_name}</span>
          <span className={`ms-auto inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${PILL[tone]}`}>
            {tone === 'danger' ? <AlertTriangle size={11} aria-hidden="true" /> : <Clock size={11} aria-hidden="true" />}
            {L.slaState(task)}{due && !task.overdue ? ` · ${due}` : ''}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
          {task.asset_no && <span>{task.asset_no}</span>}
          {(task.site || task.country) && (
            <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" />{[task.site, task.country].filter(Boolean).join(', ')}</span>
          )}
          <span dir="auto">{tx('inbox.inStep', { days: L.days(task.days_in_step) })}</span>
          {!task.assigned_to_me && task.owner_role && <span className="inline-flex items-center gap-1"><Users size={11} aria-hidden="true" />{L.role(task.owner_role)}</span>}
        </div>
      </Link>
    </li>
  )
}

function Section({ icon: Icon, title, tasks, emptyText }) {
  return (
    <div>
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)] mb-1">
        <Icon size={13} aria-hidden="true" /> {title} ({tasks.length})
      </h4>
      {tasks.length === 0
        ? <p className="text-xs text-[var(--text-muted)] py-2">{emptyText}</p>
        : <ul className="divide-y divide-[var(--input-border)]">{tasks.map((t) => <TaskRow key={rowKey(t)} task={t} />)}</ul>}
    </div>
  )
}

export default function CaseTeamInbox({ items, title, compact = false }) {
  const { tx } = useAccidentOwnershipText()
  const heading = title || tx('inbox.title')
  const selfLoad = items === undefined
  const [state, setState] = useState({ loading: selfLoad, ok: true, rows: selfLoad ? null : items })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await listMyAccidentTasks()
      setState({ loading: false, ok: res.ok, rows: res.rows })
    } catch (e) {
      setState({ loading: false, ok: true, error: toUserMessage(e, tx('inbox.loadFailed')) })
    }
  }, [tx])
  useEffect(() => { if (selfLoad) load() }, [selfLoad, load])
  useEffect(() => { if (!selfLoad) setState({ loading: items == null, ok: true, rows: items }) }, [items, selfLoad])

  const rows = state.rows
  const groups = useMemo(() => splitTasks(rows || []), [rows])
  const counts = useMemo(() => taskCounts(rows || []), [rows])

  let body
  if (state.loading && !rows) {
    body = <p className="text-sm text-[var(--text-muted)] py-3">{tx('inbox.loading')}</p>
  } else if (state.error) {
    body = (
      <div className="flex items-center gap-2 py-3" role="alert">
        <AlertTriangle size={16} className="text-red-400" aria-hidden="true" />
        <p className="text-sm text-[var(--text-primary)] flex-1">{state.error}</p>
        <button type="button" onClick={load} className="text-sm text-[var(--accent)] hover:underline">{tx('common.tryAgain')}</button>
      </div>
    )
  } else if (state.ok === false) {
    body = <p className="text-sm text-[var(--text-muted)] py-3">{tx('common.notOn')}</p>
  } else if (!rows || rows.length === 0) {
    body = (
      <p className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-3">
        <CheckCircle2 size={16} className="text-emerald-400" aria-hidden="true" />{' '}{tx('inbox.empty')}
      </p>
    )
  } else if (compact) {
    body = <ul className="divide-y divide-[var(--input-border)]">{[...groups.mine, ...groups.team].slice(0, 5).map((t) => <TaskRow key={rowKey(t)} task={t} />)}</ul>
  } else {
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={User} title={tx('inbox.mine')} tasks={groups.mine} emptyText={tx('inbox.mineEmpty')} />
        <Section icon={Users} title={tx('inbox.team')} tasks={groups.team} emptyText={tx('inbox.teamEmpty')} />
      </div>
    )
  }

  return (
    <section className="card" aria-label={heading}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Inbox size={16} className="text-[var(--accent)]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{heading}</h3>
        {rows && rows.length > 0 && (
          <span dir="auto" className="text-xs text-[var(--text-muted)]">
            {tx('inbox.open', { n: counts.total })}{counts.overdue ? tx('inbox.overdue', { n: counts.overdue }) : ''}{counts.dueSoon ? tx('inbox.dueSoon', { n: counts.dueSoon }) : ''}
          </span>
        )}
        {selfLoad && (
          <button type="button" onClick={load} aria-label={tx('inbox.refresh')}
            className="ms-auto inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]">
            <RefreshCw size={14} className={state.loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>
      {body}
    </section>
  )
}
