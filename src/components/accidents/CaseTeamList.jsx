import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ListChecks, Clock, AlertTriangle, CheckCircle2, CircleDot, Users, MapPin,
} from 'lucide-react'
import useAccidentOwnershipText from './useAccidentOwnershipText'
import { useLanguage } from '../../contexts/LanguageContext'

/**
 * Every open case step routed to the teams (the full team list).
 *
 * This is the list the Accident Cases page showed before "My accident tasks"
 * replaced it. The owner asked to keep both (2026-11-28): "My accident tasks" is
 * the personal queue, this is the whole picture across every team in scope.
 *
 * Purely presentational: the page passes board.inbox from loadAccidentCaseBoard
 * (open accident_case_tasks, already country scoped by RLS and the board
 * service). Overdue first, then by a coarse status rank.
 *
 * Honest states: items === null is loading, an empty array is a genuine
 * "nothing open", and each row states its own status and due date.
 */

const STATUS_RANK = {
  blocked: 0, open: 1, in_progress: 1, waiting: 2, on_hold: 2, review: 2, done: 4, closed: 5,
}
const STATUS_TONE = {
  blocked: 'danger', open: 'info', in_progress: 'info', waiting: 'warning',
  on_hold: 'warning', review: 'warning', done: 'good', closed: 'good',
}

const PILL = {
  // 500-level ink on a 10% tint reads in both the light and the dark theme.
  good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-600',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-600',
  danger: 'border-red-500/40 bg-red-500/10 text-red-500',
  quiet: 'border-[var(--input-border)] bg-[var(--input-bg)]/40 text-[var(--text-dim)]',
}

const statusKey = (status) => String(status || '').toLowerCase().trim()

function toTime(value) {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

// Overdue = a real due date that has already passed. No due date is never overdue.
function isOverdue(dueAt, now) {
  const t = toTime(dueAt)
  return t != null && t < now
}

function dateText(dueAt, language) {
  const t = toTime(dueAt)
  if (t == null) return null
  try {
    return new Date(t).toLocaleDateString(language === 'ar' ? 'ar' : undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch {
    return null
  }
}

function rowKey(item, index) {
  const parts = [item?.id, item?.accident_id, item?.workstream_key].filter((p) => p != null)
  return parts.length ? `${parts.join(':')}:${index}` : `row-${index}`
}

function CaseRow({ item, now }) {
  const { language } = useLanguage()
  const L = useAccidentOwnershipText()
  const { tx } = L
  const key = statusKey(item?.status)
  const tone = STATUS_TONE[key] || 'quiet'
  const statusLabel = STATUS_TONE[key]
    ? tx(`teamList.status.${key}`)
    : (item?.status ? String(item.status) : tx('teamList.status.unknown'))
  const overdue = isOverdue(item?.due_at, now)
  const due = dateText(item?.due_at, language)
  const ref = item?.case_no || item?.accident_id
  const place = [item?.site, item?.country].filter(Boolean).join(', ')
  const who = item?.team || (item?.owner_role ? L.role(item.owner_role) : '')

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <CircleDot size={13} className="text-orange-400 shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
            {ref ? tx('inbox.case', { ref }) : tx('inbox.caseNoRef')}
          </span>
          <span className="text-xs text-[var(--text-dim)] truncate">{L.step(item?.workstream_key)}</span>
        </div>
        <span className={`ms-auto inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${PILL[tone]}`}>
          {statusLabel}
        </span>
        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${overdue ? PILL.danger : PILL.quiet}`}>
          {overdue ? <AlertTriangle size={11} aria-hidden="true" /> : <Clock size={11} aria-hidden="true" />}
          {overdue
            ? tx('teamList.overdueOn', { date: due })
            : (due ? tx('teamList.dueOn', { date: due }) : tx('teamList.noDue'))}
        </span>
      </div>
      {(who || place) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
          {who && (
            <span className="inline-flex items-center gap-1"><Users size={11} aria-hidden="true" />{who}</span>
          )}
          {place && (
            <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" />{place}</span>
          )}
        </div>
      )}
    </>
  )

  return (
    <li className={`rounded-lg border p-3 ${overdue ? 'border-red-500/40 bg-red-500/5' : 'border-[var(--input-border)] bg-[var(--input-bg)]/30'}`}>
      {item?.accident_id ? (
        <Link
          to={`/accidents/${item.accident_id}?tab=workstreams`}
          className="block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {body}
        </Link>
      ) : body}
    </li>
  )
}

export default function CaseTeamList({ items }) {
  const { tx } = useAccidentOwnershipText()
  const now = Date.now()

  const view = useMemo(() => {
    if (items == null) return { loading: true }
    if (!Array.isArray(items) || items.length === 0) return { empty: true }
    const decorated = items.map((item, index) => ({
      item,
      index,
      overdue: isOverdue(item?.due_at, now),
      rank: STATUS_RANK[statusKey(item?.status)] ?? 3,
      due: toTime(item?.due_at),
    }))
    decorated.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
      // Within overdue, the most overdue (earliest due) first.
      if (a.overdue && b.overdue && a.due !== b.due) return (a.due || 0) - (b.due || 0)
      if (a.rank !== b.rank) return a.rank - b.rank
      return a.index - b.index
    })
    return { rows: decorated.map((d) => d.item), overdueCount: decorated.filter((d) => d.overdue).length }
  }, [items, now])

  const header = (
    <div className="flex items-center gap-2">
      <ListChecks size={16} className="text-orange-400 shrink-0" aria-hidden="true" />
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{tx('teamList.title')}</h3>
    </div>
  )

  if (view.loading) {
    return (
      <section className="card p-4 space-y-2" aria-busy="true">
        {header}
        <div className="h-2.5 w-2/3 rounded-full bg-[var(--input-border)] animate-pulse" />
        <div className="h-2.5 w-1/2 rounded-full bg-[var(--input-border)] animate-pulse" />
        <p className="text-xs text-[var(--text-dim)]">{tx('teamList.loading')}</p>
      </section>
    )
  }

  if (view.empty) {
    return (
      <section className="card p-4 space-y-1.5">
        {header}
        <p className="text-sm text-[var(--text-muted)] flex items-center gap-2">
          <CheckCircle2 size={15} className="text-emerald-500 shrink-0" aria-hidden="true" />
          {tx('teamList.empty')}
        </p>
      </section>
    )
  }

  const { rows, overdueCount } = view
  return (
    <section className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {header}
        <span className="text-xs text-[var(--text-dim)]">
          {rows.length === 1 ? tx('teamList.countOne') : tx('teamList.count', { n: rows.length })}
        </span>
        {overdueCount > 0 && (
          <span className={`ms-auto inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${PILL.danger}`}>
            <AlertTriangle size={11} aria-hidden="true" />
            {tx('teamList.overdueCount', { n: overdueCount })}
          </span>
        )}
      </div>
      <p className="text-[11px] text-[var(--text-dim)]">{tx('teamList.hint')}</p>
      <ul className="space-y-2">
        {rows.map((item, index) => (
          <CaseRow key={rowKey(item, index)} item={item} now={now} />
        ))}
      </ul>
    </section>
  )
}
