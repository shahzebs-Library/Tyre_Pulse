/**
 * CaseSlaHeader — the four header chips from the case-timeline mockup: how long
 * the case has been open, who currently owns it, which SLA is next, and how
 * much time is left (or how overdue it is). Mounted in the case header card in
 * AccidentDetailModal.jsx, right below the severity/status badges.
 *
 * "Current owner" is derived from the workstreams the page already loaded
 * (loadCase) — the most recently started in_progress one, falling back to the
 * most recently assigned one. No SLA/ownership fact here is invented: every
 * chip that has nothing to show renders "Not set"/"No active SLA" rather than
 * a fabricated value, matching this module's SHIP-BEFORE-MIGRATE convention.
 */
import { useEffect, useState } from 'react'
import { Clock, User, Timer, AlarmClock } from 'lucide-react'
import { listSlaInstances, nextDueInstance } from '../../lib/api/accidentSla'
import { caseAgeLabel } from '../../lib/accidentReport'
import { WORKSTREAMS } from '../../lib/accidentCase'

const WS_NAME = Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w.name]))
const WS_TEAM = Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w.team]))

/** Most recently started in_progress workstream, else the most recently
 *  assigned one, else null — the same "who's actually working this" question
 *  the Teams tab answers per-team, condensed to one chip. */
function currentOwnerWorkstream(workstreams) {
  const list = workstreams || []
  const byRecency = (a, b) => new Date(b.started_at || b.assigned_at || 0) - new Date(a.started_at || a.assigned_at || 0)
  const inProgress = list.filter((w) => w.status === 'in_progress').sort(byRecency)
  if (inProgress.length) return inProgress[0]
  const assigned = list.filter((w) => w.status === 'assigned').sort(byRecency)
  return assigned[0] || null
}

/** "52m" / "3h 12m" / "2d 4h" for a millisecond duration; sign-agnostic — the
 *  caller decides whether it reads as "Due in" or "Overdue by". */
function durationLabel(ms) {
  const abs = Math.abs(ms)
  const minutes = Math.round(abs / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMin = minutes % 60
  if (hours < 24) return restMin ? `${hours}h ${restMin}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function Chip({ icon: Icon, label, value, tone = 'neutral' }) {
  const toneClass = {
    neutral: 'text-[var(--text-primary)]',
    warn: 'text-amber-400',
    bad: 'text-red-400',
    good: 'text-green-400',
  }[tone]
  return (
    <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/50 px-3 py-2 flex items-center gap-2 min-w-0">
      <Icon size={16} className="text-[var(--text-muted)] shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] truncate">{label}</p>
        <p className={`text-sm font-semibold truncate ${toneClass}`}>{value}</p>
      </div>
    </div>
  )
}

export default function CaseSlaHeader({ acc, workstreams }) {
  const [instances, setInstances] = useState(null) // null = loading

  useEffect(() => {
    let live = true
    if (!acc?.id) { setInstances([]); return }
    listSlaInstances(acc.id).then((rows) => { if (live) setInstances(rows) }).catch(() => { if (live) setInstances([]) })
    return () => { live = false }
  }, [acc?.id])

  const openLabel = caseAgeLabel(acc) ?? 'Not set'
  const owner = currentOwnerWorkstream(workstreams)
  const ownerLabel = owner ? (WS_TEAM[owner.workstream_key] || WS_NAME[owner.workstream_key] || owner.workstream_key) : 'Unassigned'

  const next = instances ? nextDueInstance(instances) : null
  const nextName = next ? (next.name || WS_NAME[next.workstream_key] || next.workstream_key) : null
  const dueMs = next?.due_at ? new Date(next.due_at) - Date.now() : null
  const overdue = dueMs != null && dueMs < 0
  const dueLabel = instances == null ? 'Loading…' : dueMs == null ? 'No active SLA' : `${overdue ? 'Overdue by' : 'Due in'} ${durationLabel(dueMs)}`

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
      <Chip icon={Clock} label="Open" value={openLabel} />
      <Chip icon={User} label="Current owner" value={ownerLabel} />
      <Chip icon={Timer} label="Next SLA" value={nextName || 'None active'} />
      <Chip icon={AlarmClock} label="Due in" value={dueLabel} tone={overdue ? 'bad' : dueMs != null && dueMs < 3600000 ? 'warn' : 'neutral'} />
    </div>
  )
}
