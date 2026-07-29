import { useMemo } from 'react'
import {
  ShieldCheck, Lock, Unlock, CheckCircle2, AlertCircle,
  ClipboardCheck, Wrench, Coins, ShieldAlert, Gauge,
} from 'lucide-react'
import {
  completionRows, closureBadge, blockerList, TONE,
} from '../../lib/caseCompletionView'

/**
 * Case completion — the visible half of the Overview.
 *
 * It answers three questions and nothing else: how complete is each part of the
 * case (Incident, Insurance, Repair, Finance, and overall), what closure level the
 * case sits at, and exactly what is blocking full closure. Every number comes from
 * the pure engine via caseCompletionView; this panel renders and never computes.
 *
 * Honesty is the point of the "Not in scope" state: a dimension the case route
 * never required is drawn as an empty, muted track, never a filled bar, so a
 * reader is never told a team finished work that was never theirs to do.
 */

// ── tone -> classes (dark-first, theme tokens elsewhere) ──────────────────────
const BAR_FILL = {
  [TONE.GOOD]: 'bg-emerald-500',
  [TONE.INFO]: 'bg-sky-500',
  [TONE.WARNING]: 'bg-amber-500',
  [TONE.DANGER]: 'bg-red-500',
  [TONE.QUIET]: 'bg-transparent',
}
const STATUS_TEXT = {
  [TONE.GOOD]: 'text-emerald-400',
  [TONE.INFO]: 'text-sky-400',
  [TONE.WARNING]: 'text-amber-400',
  [TONE.DANGER]: 'text-red-400',
  [TONE.QUIET]: 'text-[var(--text-muted)]',
}
const BADGE_CLASS = {
  [TONE.GOOD]: 'border-emerald-700/50 bg-emerald-950/25 text-emerald-200',
  [TONE.INFO]: 'border-sky-700/50 bg-sky-950/25 text-sky-200',
  [TONE.WARNING]: 'border-amber-700/50 bg-amber-950/25 text-amber-200',
  [TONE.DANGER]: 'border-red-700/50 bg-red-950/25 text-red-200',
  [TONE.QUIET]: 'border-[var(--input-border)] bg-[var(--input-bg)]/40 text-[var(--text-dim)]',
}

const DIM_ICON = {
  incident: ShieldAlert,
  insurance: Coins,
  repair: Wrench,
  financial: Coins,
  overall: Gauge,
}

const BADGE_ICON = { fully_closed: Lock }

function CompletionBar({ row }) {
  const Icon = DIM_ICON[row.key] || Gauge
  const pctLabel = row.inScope ? `${row.pct}%` : 'N/A'
  return (
    <div className={row.summary ? 'pt-2.5 mt-1 border-t border-[var(--input-border)]/60' : ''}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={13} className="text-[var(--text-muted)] shrink-0" />
        <span className={`text-xs ${row.summary ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-dim)]'}`}>
          {row.label}
        </span>
        <span className={`text-[11px] ml-auto ${STATUS_TEXT[row.tone] || STATUS_TEXT[TONE.QUIET]}`}>
          {row.status}
        </span>
        <span className="text-xs tabular-nums text-[var(--text-primary)] w-10 text-right">{pctLabel}</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--input-border)] overflow-hidden">
        {row.inScope && (
          <div
            className={`h-2 rounded-full transition-all ${BAR_FILL[row.tone] || BAR_FILL[TONE.QUIET]}`}
            style={{ width: `${Math.max(row.pct, row.pct > 0 ? 2 : 0)}%` }}
          />
        )}
      </div>
    </div>
  )
}

export default function CaseCompletionPanel({ caseData }) {
  const view = useMemo(() => {
    if (caseData == null) return { empty: true }
    // Honesty gate: when the case workflow is not provisioned for this incident
    // (pre-V417, loadCase returns capabilities.casesModel === false with no
    // workstreams), there is nothing real to measure. Painting every dimension
    // "Not started" 0% with a full blocker list is a confident fabrication, so we
    // stop BEFORE computing completion rows and say plainly that it is not enabled.
    if (caseData?.capabilities?.casesModel === false) return { notEnabled: true }
    try {
      return {
        rows: completionRows(caseData),
        badge: closureBadge(caseData),
        blockers: blockerList(caseData),
      }
    } catch {
      return { error: true }
    }
  }, [caseData])

  if (view.empty) {
    return (
      <div className="card p-4">
        <p className="text-sm text-[var(--text-muted)]">No case selected.</p>
      </div>
    )
  }
  if (view.notEnabled) {
    return (
      <div className="card p-4 space-y-1.5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-[var(--text-muted)] shrink-0" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Case completion</p>
        </div>
        <p className="text-sm text-[var(--text-muted)]">
          Case workflow not yet enabled for this incident.
        </p>
        <p className="text-xs text-[var(--text-dim)]">
          Completion tracking appears once the case workflow is provisioned for this record.
        </p>
      </div>
    )
  }
  if (view.error) {
    return (
      <div className="card p-4">
        <p className="text-sm text-red-300 flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0" />
          This case could not be read. The record may be incomplete.
        </p>
      </div>
    )
  }

  const { rows, badge, blockers } = view
  const BadgeIcon = BADGE_ICON[badge.level] || Unlock
  const ready = blockers.length === 0

  return (
    <div className="card p-4 space-y-4">
      {/* header + closure badge */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-orange-400 shrink-0" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Case completion</p>
        </div>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
            BADGE_CLASS[badge.tone] || BADGE_CLASS[TONE.QUIET]
          }`}
        >
          <BadgeIcon size={12} className="shrink-0" />
          {badge.label}
        </span>
      </div>

      {/* five completeness bars */}
      <div className="space-y-2.5">
        {rows.map((row) => <CompletionBar key={row.key} row={row} />)}
      </div>

      {/* blocking full closure */}
      <div className="pt-1">
        <p className="text-xs font-medium text-[var(--text-dim)] mb-1.5">Blocking full closure</p>
        {ready ? (
          <p className="text-xs text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 size={13} className="shrink-0" />
            Ready to close. Every required step is complete.
          </p>
        ) : (
          <ul className="space-y-1">
            {blockers.map((b) => (
              <li
                key={`${b.kind}:${b.key}`}
                className="text-xs text-[var(--text-muted)] flex items-start gap-1.5"
              >
                {b.kind === 'check'
                  ? <ClipboardCheck size={12} className="text-amber-400 mt-0.5 shrink-0" />
                  : <AlertCircle size={12} className="text-amber-400 mt-0.5 shrink-0" />}
                <span>{b.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
