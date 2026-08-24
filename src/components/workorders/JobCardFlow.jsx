// ─────────────────────────────────────────────────────────────────────────────
// JobCardFlow.jsx - the job card availability flow.
//
// WHY THIS EXISTS: the four ERP timestamps (Production Out / Workshop In /
// Workshop Out / Production In) are the reason that export was imported at all.
// They split downtime into three DIFFERENT problems:
//
//   Production Out -> Workshop In   the asset is down and nobody has started
//                                   = a SCHEDULING problem
//   Workshop In    -> Workshop Out  = the WORKSHOP's own repair time
//   Workshop Out   -> Production In repaired but not handed back
//                                   = a RELEASE problem
//
// One "downtime" number hides which of the three is costing availability. The
// two waiting columns then give the CAUSE of the pre-start wait: no part
// (procurement) versus no technician (scheduling).
//
// HONESTY RULES, which are the whole point and must not be "simplified":
//   - an unmeasurable gap renders "Not measurable", NEVER 0. A gap whose start
//     was never recorded is not a zero-hour gap, and 0 flatters every average.
//   - a gap still running renders "and counting", because an asset that went out
//     three weeks ago and was never booked in is exactly what this surfaces.
//   - a reversed pair renders a data error, not a negative duration.
// ─────────────────────────────────────────────────────────────────────────────
import { AlertTriangle, AlertCircle, Clock } from 'lucide-react'
import {
  JOB_CARD_STAGES,
  jobCardStage,
  jobCardDurations,
  waitingSplit,
  stageChronologyIssues,
  readField,
} from '../../lib/jobCard'
import { formatDateTime } from '../../lib/formatters'

/**
 * Humanise a duration in hours. Under 24h reads "6h 20m", above reads "3d 4h".
 * Returns 'N/A' for null so an unmeasurable gap can never print as a number.
 * Exported for the test - the boundary behaviour is easy to regress.
 */
export function fmtHours(h) {
  if (h === null || h === undefined || !Number.isFinite(Number(h))) return 'N/A'
  const hours = Number(h)
  if (hours < 0) return 'N/A'
  if (hours < 24) {
    const wholeH = Math.floor(hours)
    const mins = Math.round((hours - wholeH) * 60)
    if (wholeH === 0) return `${mins}m`
    return mins ? `${wholeH}h ${mins}m` : `${wholeH}h`
  }
  const days = Math.floor(hours / 24)
  const remH = Math.round(hours - days * 24)
  return remH ? `${days}d ${remH}h` : `${days}d`
}

/** One gap tile. `gap` is null OR { hours, running, reversed }. */
function GapTile({ label, meaning, gap, missingReason, emphasis }) {
  // Reversed: the two timestamps contradict each other. Report the fault, never
  // a duration derived from it.
  if (gap && gap.reversed) {
    return (
      <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/40">
        <div className="text-[var(--text-secondary)] text-[11px]">{label}</div>
        <div className="flex items-center gap-1.5 text-red-300 text-sm font-semibold mt-1">
          <AlertCircle size={13} />
          Data error
        </div>
        <div className="text-red-200/80 text-[10px] mt-1">The two timestamps are out of order.</div>
      </div>
    )
  }

  // Not measurable: say WHY, and never show a number.
  if (!gap || gap.hours === null) {
    return (
      <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-bright)]">
        <div className="text-[var(--text-secondary)] text-[11px]">{label}</div>
        <div className="text-[var(--text-muted)] text-sm font-medium mt-1">Not measurable</div>
        <div className="text-[var(--text-muted)] text-[10px] mt-1">{missingReason}</div>
      </div>
    )
  }

  const running = gap.running
  return (
    <div className={`p-3 rounded-lg border ${
      emphasis
        ? 'bg-[var(--surface-3)] border-[var(--border-bright)]'
        : 'bg-[var(--surface-2)] border-[var(--border-bright)]'
    }`}>
      <div className="text-[var(--text-secondary)] text-[11px]">{label}</div>
      <div className={`text-sm font-semibold mt-1 ${running ? 'text-amber-300' : 'text-[var(--text-primary)]'}`}>
        {fmtHours(gap.hours)}
        {running && <span className="font-normal text-[11px] ml-1">and counting</span>}
      </div>
      <div className="text-[var(--text-muted)] text-[10px] mt-1">{meaning}</div>
    </div>
  )
}

export default function JobCardFlow({ row, now = Date.now(), compact = false }) {
  const stage = jobCardStage(row)
  const durations = jobCardDurations(row, now)
  const waiting = waitingSplit(row, now)
  const issues = stageChronologyIssues(row)

  // No timestamp anywhere: say so rather than pushing the card onto stage 1,
  // which would assert a step nobody recorded.
  const notStarted = stage.index < 0

  return (
    <div className="space-y-3">
      {/* ── Stepper ────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[var(--text-primary)] text-xs font-semibold">Availability flow</span>
          {stage.closed && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-300">Card closed</span>
          )}
        </div>

        {notStarted ? (
          <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-muted)] text-xs">
            Flow not started. No job card timestamps recorded.
          </div>
        ) : (
          <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
            {JOB_CARD_STAGES.map((s, i) => {
              const at = readField(row, s.field)
              const reached = at !== null
              const isCurrent = i === stage.index
              return (
                <div key={s.key}
                  className={`flex-1 min-w-[104px] p-2 rounded-lg border text-center ${
                    isCurrent
                      ? 'bg-[var(--surface-3)] border-blue-500/60'
                      : reached
                        ? 'bg-[var(--surface-2)] border-[var(--border-bright)]'
                        : 'bg-transparent border-dashed border-[var(--border-bright)]'
                  }`}
                  title={s.hint}>
                  <div className={`text-[10px] font-semibold ${
                    reached ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                  }`}>
                    {s.label}
                  </div>
                  <div className={`text-[9px] mt-1 ${reached ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>
                    {reached ? formatDateTime(at) : 'Not recorded'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Gaps ───────────────────────────────────────────────────────────── */}
      {compact ? (
        <div className="grid grid-cols-1 gap-2">
          <GapTile
            label="Total downtime" meaning="Production Out to Production In"
            gap={durations.totalDown} emphasis
            missingReason="Production Out was never recorded." />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <GapTile
            label="Waiting for workshop" meaning="Scheduling gap: down, not started"
            gap={durations.awaitingWorkshop}
            missingReason="Production Out was never recorded." />
          <GapTile
            label="In workshop" meaning="The workshop own repair time"
            gap={durations.inWorkshop}
            missingReason="Workshop In was never recorded." />
          <GapTile
            label="Waiting for release" meaning="Repaired, not handed back"
            gap={durations.awaitingRelease}
            missingReason="Workshop Out was never recorded." />
          <GapTile
            label="Total downtime" meaning="Production Out to Production In"
            gap={durations.totalDown} emphasis
            missingReason="Production Out was never recorded." />
        </div>
      )}

      {/* ── Waiting cause ──────────────────────────────────────────────────── */}
      {!compact && (
        <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-bright)]">
          <div className="flex items-center gap-1.5 text-[var(--text-primary)] text-xs font-semibold mb-2">
            <Clock size={13} />
            Why it waited
          </div>

          {!waiting.recorded ? (
            <div className="text-[var(--text-muted)] text-[11px]">
              No waiting cause recorded. The export carries Waiting Part Hrs and Waiting Manpower Hrs but
              neither is filled on this card.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <div className="text-[var(--text-muted)]">Waiting for parts</div>
                  <div className="text-[var(--text-primary)] font-medium">{fmtHours(waiting.parts)}</div>
                  <div className="text-[var(--text-muted)] text-[10px]">Procurement</div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)]">Waiting for manpower</div>
                  <div className="text-[var(--text-primary)] font-medium">{fmtHours(waiting.manpower)}</div>
                  <div className="text-[var(--text-muted)] text-[10px]">Scheduling</div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)]">Unaccounted</div>
                  <div className="text-[var(--text-primary)] font-medium">{fmtHours(waiting.unexplained)}</div>
                  <div className="text-[var(--text-muted)] text-[10px]">Neither column explains it</div>
                </div>
              </div>
              {waiting.gapHours === null && (
                <div className="text-[var(--text-muted)] text-[10px] mt-2">
                  The wait itself is not measurable, so Unaccounted cannot be worked out.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Chronology warnings: reported, never auto-corrected ─────────────── */}
      {issues.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-center gap-1.5 text-amber-300 text-xs font-semibold mb-1">
            <AlertTriangle size={13} />
            Timestamps out of order
          </div>
          <ul className="list-disc list-inside text-amber-200/90 text-[11px] space-y-0.5">
            {issues.map((i, idx) => <li key={idx}>{i.message}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
