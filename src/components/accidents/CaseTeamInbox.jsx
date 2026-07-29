import { useMemo } from 'react'
import {
  Inbox, Clock, AlertTriangle, CheckCircle2, CircleDot, Users, MapPin,
} from 'lucide-react'

/**
 * My team's accident cases (Phase 4 team inbox).
 *
 * A read-only, purely presentational inbox for a team member: it shows the case
 * workstreams routed to their team and nothing else. It fetches no data and computes
 * no completion; the parent passes a ready `items` array, so the component is inert
 * and trivially testable.
 *
 * Ordering answers "what needs me first": anything overdue (a due_at in the past)
 * sorts to the top, then everything else by a coarse status rank, so a team member
 * reads the queue top to bottom without hunting.
 *
 * Honest states: items === null is loading (nothing known yet), an empty array is a
 * genuine "no cases assigned to your team", and each row states its own status and
 * due badge from the data rather than inferring one.
 */

// ── status vocabulary -> tone + label ────────────────────────────────────────
// Tokens mirror the workstream status vocabulary; an unknown token still renders
// honestly with its raw text and a neutral tone rather than being dropped.
const STATUS_META = {
  open: { label: 'Open', tone: 'info', rank: 1 },
  in_progress: { label: 'In progress', tone: 'info', rank: 1 },
  blocked: { label: 'Blocked', tone: 'danger', rank: 0 },
  waiting: { label: 'Waiting', tone: 'warning', rank: 2 },
  on_hold: { label: 'On hold', tone: 'warning', rank: 2 },
  review: { label: 'In review', tone: 'warning', rank: 2 },
  done: { label: 'Done', tone: 'good', rank: 4 },
  closed: { label: 'Closed', tone: 'good', rank: 5 },
}

const PILL_CLASS = {
  good: 'border-emerald-700/50 bg-emerald-950/25 text-emerald-200',
  info: 'border-sky-700/50 bg-sky-950/25 text-sky-200',
  warning: 'border-amber-700/50 bg-amber-950/25 text-amber-200',
  danger: 'border-red-700/50 bg-red-950/25 text-red-200',
  quiet: 'border-[var(--input-border)] bg-[var(--input-bg)]/40 text-[var(--text-dim)]',
}

function statusMeta(status) {
  const key = String(status || '').toLowerCase().trim()
  if (STATUS_META[key]) return STATUS_META[key]
  const label = status ? String(status) : 'Unknown'
  return { label, tone: 'quiet', rank: 3 }
}

// A workstream key like "insurance_claim" reads better as "Insurance claim".
function humanizeKey(key) {
  const raw = String(key || '').replace(/[_-]+/g, ' ').trim()
  if (!raw) return 'Workstream'
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

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

function dueLabel(dueAt) {
  const t = toTime(dueAt)
  if (t == null) return 'No due date'
  try {
    return new Date(t).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch {
    return 'No due date'
  }
}

function rowKey(item, index) {
  const parts = [item?.accident_id, item?.workstream_key].filter((p) => p != null)
  return parts.length ? parts.join(':') : `row-${index}`
}

function DueBadge({ dueAt, overdue }) {
  if (overdue) {
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${PILL_CLASS.danger}`}>
        <AlertTriangle size={11} className="shrink-0" />
        Overdue {dueLabel(dueAt)}
      </span>
    )
  }
  const has = toTime(dueAt) != null
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${PILL_CLASS.quiet}`}>
      <Clock size={11} className="shrink-0" />
      {has ? `Due ${dueLabel(dueAt)}` : 'No due date'}
    </span>
  )
}

function CaseRow({ item, now }) {
  const meta = statusMeta(item?.status)
  const overdue = isOverdue(item?.due_at, now)
  const caseLabel = item?.case_no ? `Case ${item.case_no}` : (item?.accident_id ? `Case ${item.accident_id}` : 'Case')
  const place = [item?.site, item?.country].filter(Boolean).join(', ')

  return (
    <li
      className={`rounded-lg border p-3 ${
        overdue
          ? 'border-red-800/40 bg-red-950/15'
          : 'border-[var(--input-border)] bg-[var(--input-bg)]/30'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <CircleDot size={13} className="text-orange-400 shrink-0" />
          <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{caseLabel}</span>
          <span className="text-xs text-[var(--text-dim)] truncate">{humanizeKey(item?.workstream_key)}</span>
        </div>
        <span
          className={`ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
            PILL_CLASS[meta.tone] || PILL_CLASS.quiet
          }`}
        >
          {meta.label}
        </span>
        <DueBadge dueAt={item?.due_at} overdue={overdue} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
        {(item?.team || item?.owner_role) && (
          <span className="inline-flex items-center gap-1">
            <Users size={11} className="shrink-0" />
            {item?.team || item?.owner_role}
          </span>
        )}
        {place && (
          <span className="inline-flex items-center gap-1">
            <MapPin size={11} className="shrink-0" />
            {place}
          </span>
        )}
      </div>
    </li>
  )
}

export default function CaseTeamInbox({ items }) {
  const now = Date.now()

  const view = useMemo(() => {
    if (items == null) return { loading: true }
    if (!Array.isArray(items) || items.length === 0) return { empty: true }
    // Overdue first, then by status rank, keeping a stable order within each group.
    const decorated = items.map((item, index) => ({
      item,
      index,
      overdue: isOverdue(item?.due_at, now),
      rank: statusMeta(item?.status).rank,
      due: toTime(item?.due_at),
    }))
    decorated.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
      // Within overdue, the most-overdue (earliest due) first.
      if (a.overdue && b.overdue && a.due !== b.due) return (a.due || 0) - (b.due || 0)
      if (a.rank !== b.rank) return a.rank - b.rank
      return a.index - b.index
    })
    const overdueCount = decorated.filter((d) => d.overdue).length
    return { rows: decorated.map((d) => d.item), overdueCount }
  }, [items, now])

  if (view.loading) {
    return (
      <div className="card p-4 space-y-2" aria-busy="true">
        <div className="flex items-center gap-2">
          <Inbox size={16} className="text-[var(--text-muted)] shrink-0" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">My team's accident cases</p>
        </div>
        <div className="h-2.5 w-2/3 rounded-full bg-[var(--input-border)] animate-pulse" />
        <div className="h-2.5 w-1/2 rounded-full bg-[var(--input-border)] animate-pulse" />
        <p className="text-xs text-[var(--text-dim)]">Loading cases...</p>
      </div>
    )
  }

  if (view.empty) {
    return (
      <div className="card p-4 space-y-1.5">
        <div className="flex items-center gap-2">
          <Inbox size={16} className="text-[var(--text-muted)] shrink-0" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">My team's accident cases</p>
        </div>
        <p className="text-sm text-[var(--text-muted)] flex items-center gap-2">
          <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
          No cases assigned to your team.
        </p>
      </div>
    )
  }

  const { rows, overdueCount } = view

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <Inbox size={16} className="text-orange-400 shrink-0" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">My team's accident cases</p>
        </div>
        <span className="text-xs text-[var(--text-dim)]">
          {rows.length} {rows.length === 1 ? 'case' : 'cases'}
        </span>
        {overdueCount > 0 && (
          <span className={`ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${PILL_CLASS.danger}`}>
            <AlertTriangle size={11} className="shrink-0" />
            {overdueCount} overdue
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {rows.map((item, index) => (
          <CaseRow key={rowKey(item, index)} item={item} now={now} />
        ))}
      </ul>
    </div>
  )
}
