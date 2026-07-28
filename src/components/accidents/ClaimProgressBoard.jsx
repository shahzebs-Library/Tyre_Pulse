import { useEffect, useMemo, useState } from 'react'
import { Users, Clock, SkipForward, AlertTriangle, Info, Hourglass } from 'lucide-react'
import { buildStageIntelligence } from '../../lib/accidentStages'
import { listOpenStageEvents } from '../../lib/api/accidentStages'
import { toUserMessage } from '../../lib/safeError'

/**
 * Where every claim is sitting, and which team is holding it.
 *
 * WHAT IT CAREFULLY DOES NOT CLAIM. It reports how long a team HELD a case, never
 * that the team caused the delay. A claim can sit at Insurance for forty days
 * because the insurer has not replied, which is not the insurance team being
 * slow. The data records where the time went; who is at fault is a judgement
 * about the real world that a table cannot make. Every label here says "held".
 *
 * And it states its own basis. The stage ledger began on the day it was created,
 * so today most durations start from each record's last-modified time rather than
 * from a watched transition. That is said out loud rather than dressed up as a
 * measurement - a report that overstates its own precision is worse than one that
 * admits a gap.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString() : 'N/A')
const dayText = (d) => (d == null ? 'N/A' : d < 1 ? `${Math.round(d * 24)}h` : `${d}d`)

function Bar({ value, max, tone = 'bg-orange-500' }) {
  const w = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0
  return (
    <div className="flex-1 h-2 rounded-full bg-[var(--input-border)] overflow-hidden min-w-[60px]">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${w}%` }} />
    </div>
  )
}

export default function ClaimProgressBoard({ records, country }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(null)
    listOpenStageEvents({ country })
      .then((rows) => { if (alive) setEvents(rows || []) })
      .catch((e) => { if (alive) setErr(toUserMessage(e, 'could not load the stage ledger')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [country])

  const intel = useMemo(() => buildStageIntelligence(records || [], events), [records, events])

  if (loading) {
    return <div className="card text-sm text-[var(--text-muted)]">Loading claim progress...</div>
  }
  if (err) {
    return (
      <div className="card">
        <p className="text-sm text-red-300">{err}</p>
      </div>
    )
  }
  if (!intel.total) return null

  const maxHolding = Math.max(1, ...intel.teams.map((t) => t.holdingNow))

  return (
    <div className="space-y-4">
      {/* ── What this rests on ──────────────────────────────────────────────── */}
      {(!intel.ledgerReady || intel.anyEstimated) && (
        <div className="card border-l-2 border-l-amber-500/60">
          <p className="text-xs text-amber-200 flex items-start gap-2">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>
              {!intel.ledgerReady
                ? 'No stage history has been recorded yet, so no team timings can be shown. They start '
                  + 'accumulating from the next time a case moves between stages.'
                : 'Stage tracking started recently. Where a case entered its stage before tracking began, '
                  + 'the clock starts from when that record was last changed rather than from a watched '
                  + 'handover, so those figures are approximate and marked as such. They become exact as '
                  + 'cases move from here on.'}
            </span>
          </p>
        </div>
      )}

      {/* ── Who is holding what ─────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Users size={15} className="text-orange-400" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Which team is holding claims</p>
          <span className="text-xs text-[var(--text-muted)] ml-auto">
            {num(intel.open)} open of {num(intel.total)}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--text-muted)] text-left">
                <th className="pb-2 pr-3 font-medium">Team</th>
                <th className="pb-2 pr-3 font-medium">Holding now</th>
                <th className="pb-2 pr-3 font-medium">Typical time held</th>
                <th className="pb-2 pr-3 font-medium">Longest held</th>
                <th className="pb-2 pr-3 font-medium">Fields still missing</th>
                <th className="pb-2 font-medium">Stages they never got</th>
              </tr>
            </thead>
            <tbody>
              {intel.teams.map((t) => (
                <tr key={t.department} className="border-t border-[var(--input-border)]/60">
                  <td className="py-2 pr-3 text-[var(--text-primary)] whitespace-nowrap">{t.department}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-[var(--text-primary)] w-6">{t.holdingNow}</span>
                      <Bar value={t.holdingNow} max={maxHolding} />
                    </div>
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-[var(--text-dim)] whitespace-nowrap">
                    {dayText(t.medianDays)}
                    {t.anyEstimated && t.medianDays != null && (
                      <span className="text-[var(--text-muted)]"> approx</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-[var(--text-dim)]">{dayText(t.worstDays)}</td>
                  <td className={`py-2 pr-3 tabular-nums ${t.missingFields ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
                    {t.missingFields || '0'}
                    {t.casesWithGaps > 0 && (
                      <span className="text-[var(--text-muted)]"> on {t.casesWithGaps} case{t.casesWithGaps === 1 ? '' : 's'}</span>
                    )}
                  </td>
                  <td className={`py-2 tabular-nums ${t.skippedStages ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
                    {t.skippedStages || '0'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-2">
          "Time held" is how long a case sat with that team, not proof the team caused a delay. A claim
          waiting on an insurer's reply counts against Insurance without anyone there being slow.
        </p>
      </div>

      {/* ── Longest waiting ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Hourglass size={15} className="text-orange-400" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Waiting longest right now</p>
          </div>
          {intel.waiting.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              {intel.ledgerReady
                ? 'No open case has a recorded time in its current stage.'
                : 'Timings begin once cases start moving between stages.'}
            </p>
          ) : (
            <div className="space-y-1.5">
              {intel.waiting.map((w) => (
                <div key={w.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-mono text-[var(--text-primary)]">{w.reference || w.asset || 'Case'}</span>
                  <span className="text-orange-400 tabular-nums">{dayText(w.heldDays)}</span>
                  <span className="text-[var(--text-dim)]">at {w.label}</span>
                  <span className="text-[var(--text-muted)]">
                    with {w.department || 'no team'}{w.estimated ? ' (approx)' : ''}
                  </span>
                  {w.outstanding.length > 0 && (
                    <span className="text-amber-400">
                      {w.outstanding.reduce((a, o) => a + o.missing.length, 0)} field(s) missing
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Skipped stages: the direct answer to "why did it close itself" ─ */}
        <div className={`card ${intel.skips.total ? 'border-l-2 border-l-amber-500/60' : ''}`}>
          <div className="flex items-center gap-2 mb-3">
            <SkipForward size={15} className={intel.skips.total ? 'text-amber-400' : 'text-orange-400'} />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Stages nobody worked</p>
          </div>
          {intel.skips.total === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              No case has been recorded jumping a stage since stage tracking began. Setting a case's status
              straight to a later value moves it past everything in between, and that will be listed here
              when it happens.
            </p>
          ) : (
            <>
              <p className="text-xs text-[var(--text-dim)] mb-2 flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />
                <span>
                  {num(intel.skips.total)} stage{intel.skips.total === 1 ? '' : 's'} across{' '}
                  {num(intel.skips.cases.length)} case{intel.skips.cases.length === 1 ? '' : 's'} were passed
                  over. Those cases can look finished while the teams below never received them.
                </span>
              </p>
              <div className="space-y-1 mb-3">
                {intel.skips.byTeam.map((t) => (
                  <div key={t.department} className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--text-dim)] w-32 truncate">{t.department}</span>
                    <Bar value={t.count} max={Math.max(...intel.skips.byTeam.map((x) => x.count))} tone="bg-amber-500" />
                    <span className="tabular-nums text-[var(--text-primary)] w-8 text-right">{t.count}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-0.5">
                {intel.skips.cases.slice(0, 8).map((c) => (
                  <div key={c.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-mono text-[var(--text-primary)]">{c.reference || c.asset}</span>
                    <span className="text-amber-400">{c.count} skipped</span>
                    <span className="text-[var(--text-muted)] truncate">
                      {c.stages.map((s) => s.label).join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
