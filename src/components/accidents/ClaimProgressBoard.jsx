import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, SkipForward, AlertTriangle, Info, Hourglass, ClipboardList, Layers, RotateCcw,
  FileSpreadsheet, FileText,
} from 'lucide-react'
import { listOpenStageEvents } from '../../lib/api/accidentStages'
import { toUserMessage } from '../../lib/safeError'
import EnterpriseTable from '../ui/EnterpriseTable'
import { exportToExcel, exportToPdf, reportFileName } from '../../lib/exportUtils'
import {
  buildClaimBoard, claimBoardKpis, teamRows, waitingRows, skippedRows, teamExportRows,
  TEAM_EXPORT_COLS, TEAM_EXPORT_HEADERS, dayText,
} from '../../lib/claimProgressBoardAnalytics'

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

function Bar({ value, max, tone = 'bg-orange-500', label }) {
  const w = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0
  return (
    <div className="flex-1 h-2 rounded-full bg-[var(--input-border)] overflow-hidden min-w-[60px]" role="img" aria-label={label}>
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${w}%` }} />
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, tone = 'text-[var(--text-primary)]' }) {
  return (
    <div className="card !py-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)] truncate">{label}</p>
        <Icon size={14} className="text-orange-400 shrink-0" aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] truncate" title={sub}>{sub}</p>}
    </div>
  )
}

export default function ClaimProgressBoard({ records, country }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [nonce, setNonce] = useState(0)
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(null)
    listOpenStageEvents({ country })
      .then((rows) => { if (alive) setEvents(rows || []) })
      .catch((e) => { if (alive) setErr(toUserMessage(e, 'Could not load the stage ledger.')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [country, nonce])

  const nowMs = Date.now()
  const intel = useMemo(() => buildClaimBoard(records || [], events, nowMs), [records, events, nowMs])
  const kpis = useMemo(() => claimBoardKpis(intel), [intel])
  const teams = useMemo(() => teamRows(intel), [intel])
  const waiting = useMemo(() => waitingRows(intel), [intel])
  const skipped = useMemo(() => skippedRows(intel), [intel])
  const maxHolding = Math.max(1, ...teams.map((t) => t.holdingNow))

  const teamColumns = useMemo(() => [
    { id: 'department', header: 'Team', accessorKey: 'department', size: 170,
      cell: ({ row }) => <span className="text-[var(--text-primary)] whitespace-nowrap">{row.original.department}</span> },
    { id: 'holdingNow', header: 'Holding now', accessorKey: 'holdingNow', size: 170,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-[var(--text-primary)] w-6">{row.original.holdingNow}</span>
          <Bar value={row.original.holdingNow} max={maxHolding} label={`${row.original.holdingNow} of ${maxHolding}`} />
        </div>
      ) },
    { id: 'medianDays', header: 'Typical time held', accessorFn: (r) => r.medianDays ?? -1, size: 140,
      meta: { exportValue: (r) => `${dayText(r.medianDays)}${r.approx ? ' approx' : ''}` },
      cell: ({ row }) => (
        <span className="tabular-nums text-[var(--text-dim)] whitespace-nowrap">
          {dayText(row.original.medianDays)}
          {row.original.approx && <span className="text-[var(--text-muted)]"> approx</span>}
        </span>
      ) },
    { id: 'worstDays', header: 'Longest held', accessorFn: (r) => r.worstDays ?? -1, size: 120,
      meta: { exportValue: (r) => dayText(r.worstDays) },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-dim)]">{dayText(row.original.worstDays)}</span> },
    { id: 'missingFields', header: 'Fields still missing', accessorKey: 'missingFields', size: 160,
      cell: ({ row }) => (
        <span className={`tabular-nums ${row.original.missingFields ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
          {row.original.missingFields || '0'}
          {row.original.casesWithGaps > 0 && (
            <span className="text-[var(--text-muted)]"> on {row.original.casesWithGaps} case{row.original.casesWithGaps === 1 ? '' : 's'}</span>
          )}
        </span>
      ) },
    { id: 'skippedStages', header: 'Stages they never got', accessorKey: 'skippedStages', size: 150,
      cell: ({ row }) => (
        <span className={`tabular-nums ${row.original.skippedStages ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>{row.original.skippedStages || '0'}</span>
      ) },
  ], [maxHolding])

  const waitingColumns = useMemo(() => [
    { id: 'reference', header: 'Case', accessorKey: 'reference', size: 150,
      cell: ({ row }) => <span className="font-mono text-[var(--text-primary)]">{row.original.reference}</span> },
    { id: 'heldDays', header: 'Held', accessorFn: (r) => r.heldDays ?? -1, size: 90,
      meta: { exportValue: (r) => `${dayText(r.heldDays)}${r.estimated ? ' approx' : ''}` },
      cell: ({ row }) => (
        <span className="text-orange-400 tabular-nums">{dayText(row.original.heldDays)}{row.original.estimated && <span className="text-[var(--text-muted)]"> approx</span>}</span>
      ) },
    { id: 'stage', header: 'Stage', accessorKey: 'stage', size: 150 },
    { id: 'department', header: 'With team', accessorKey: 'department', size: 140 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 110 },
    { id: 'missingFields', header: 'Fields missing', accessorKey: 'missingFields', size: 120,
      cell: ({ row }) => (
        <span className={row.original.missingFields ? 'text-amber-400 tabular-nums' : 'text-[var(--text-muted)] tabular-nums'}>{row.original.missingFields}</span>
      ) },
  ], [])

  const skippedColumns = useMemo(() => [
    { id: 'reference', header: 'Case', accessorKey: 'reference', size: 150,
      cell: ({ row }) => <span className="font-mono text-[var(--text-primary)]">{row.original.reference}</span> },
    { id: 'count', header: 'Skipped', accessorKey: 'count', size: 90,
      cell: ({ row }) => <span className="text-amber-400 tabular-nums">{row.original.count} skipped</span> },
    { id: 'stages', header: 'Stages passed over', accessorKey: 'stages' },
  ], [])

  function exportTeams(kind) {
    const rows = teamExportRows(intel)
    const name = reportFileName('Claim Progress by Team')
    if (kind === 'pdf') exportToPdf(rows, TEAM_EXPORT_COLS.map((key, i) => ({ key, header: TEAM_EXPORT_HEADERS[i] })), 'Claim progress by team', name, 'landscape')
    else exportToExcel(rows, TEAM_EXPORT_COLS, TEAM_EXPORT_HEADERS, name, 'Teams')
  }

  if (loading) {
    return (
      <div className="card space-y-2" role="status" aria-live="polite">
        <p className="text-sm text-[var(--text-muted)]">Loading claim progress...</p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map((k) => <div key={k} className="h-14 rounded-lg bg-[var(--input-bg)] animate-pulse" />)}
        </div>
      </div>
    )
  }
  if (err) {
    return (
      <div className="card flex items-start gap-3" role="alert">
        <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-[var(--text-primary)] font-medium">Claim progress could not be loaded.</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{err}</p>
        </div>
        <button type="button" onClick={retry} className="btn-secondary text-xs inline-flex items-center gap-1.5"><RotateCcw size={13} /> Retry</button>
      </div>
    )
  }
  if (!intel.total) {
    return (
      <div className="card text-sm text-[var(--text-muted)] flex items-center gap-2">
        <ClipboardList size={15} aria-hidden="true" /> No incidents in the current view, so there is no claim progress to show.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── KPI strip ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi icon={ClipboardList} label="Open claims" value={num(kpis.open)} sub={`of ${num(kpis.total)} in view`} />
        <Kpi icon={Users} label="Teams holding cases" value={num(kpis.teamsHolding)} sub={`${num(teams.length)} teams tracked`} />
        <Kpi icon={Hourglass} label="Longest wait now"
          value={kpis.longestDays == null ? 'N/A' : dayText(kpis.longestDays)}
          sub={kpis.longestLabel ? `${kpis.longestLabel}${kpis.longestEstimated ? ' (approx)' : ''}` : 'No timed open case yet'}
          tone={kpis.longestDays == null ? 'text-[var(--text-muted)]' : 'text-orange-400'} />
        <Kpi icon={Layers} label="Cases with fields missing"
          value={kpis.casesMissingFields == null ? 'N/A' : num(kpis.casesMissingFields)}
          sub={kpis.casesMissingFields == null ? 'No timed open case yet' : `across ${num(waiting.length)} timed open cases`} />
        <Kpi icon={SkipForward} label="Stages skipped" value={num(kpis.skippedStages)}
          sub={`${num(kpis.skippedCases)} case${kpis.skippedCases === 1 ? '' : 's'} affected`}
          tone={kpis.skippedStages ? 'text-amber-400' : 'text-[var(--text-primary)]'} />
      </div>

      {/* ── What this rests on ──────────────────────────────────────────────── */}
      {(!intel.ledgerReady || intel.anyEstimated) && (
        <div className="card border-l-2 border-l-amber-500/60">
          <p className="text-xs text-[var(--text-secondary)] flex items-start gap-2">
            <Info size={13} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
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
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Users size={15} className="text-orange-400" aria-hidden="true" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Which team is holding claims</p>
          <span className="text-xs text-[var(--text-muted)]">{num(intel.open)} open of {num(intel.total)}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => exportTeams('excel')} className="btn-secondary text-xs inline-flex items-center gap-1.5"><FileSpreadsheet size={13} /> Excel</button>
            <button type="button" onClick={() => exportTeams('pdf')} className="btn-secondary text-xs inline-flex items-center gap-1.5"><FileText size={13} /> PDF</button>
          </div>
        </div>
        <EnterpriseTable
          columns={teamColumns}
          data={teams}
          getRowId={(r) => r.department}
          enableColumnFilters={false}
          enableExport={false}
          searchPlaceholder="Search teams"
          emptyMessage="No team is tracked for these cases."
          initialPageSize={25}
        />
        <p className="text-[11px] text-[var(--text-muted)] mt-2">
          "Time held" is how long a case sat with that team, not proof the team caused a delay. A claim
          waiting on an insurer's reply counts against Insurance without anyone there being slow.
        </p>
      </div>

      {/* ── Longest waiting ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Hourglass size={15} className="text-orange-400" aria-hidden="true" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Waiting longest right now</p>
          <span className="text-xs text-[var(--text-muted)] ml-auto">{num(waiting.length)} timed open case{waiting.length === 1 ? '' : 's'}</span>
        </div>
        <EnterpriseTable
          columns={waitingColumns}
          data={waiting}
          getRowId={(r) => String(r.id)}
          enableColumnFilters={false}
          searchPlaceholder="Search case, stage, team, site"
          emptyMessage={intel.ledgerReady
            ? 'No open case has a recorded time in its current stage.'
            : 'Timings begin once cases start moving between stages.'}
          initialPageSize={10}
          pageSizeOptions={[10, 25, 50]}
          exportFileName={reportFileName('Claims Waiting Longest')}
          reportMeta={{ title: 'Claims waiting longest' }}
        />
      </div>

      {/* ── Skipped stages: the direct answer to "why did it close itself" ─ */}
      <div className={`card ${intel.skips.total ? 'border-l-2 border-l-amber-500/60' : ''}`}>
        <div className="flex items-center gap-2 mb-3">
          <SkipForward size={15} className={intel.skips.total ? 'text-amber-400' : 'text-orange-400'} aria-hidden="true" />
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
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
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
                  <Bar value={t.count} max={Math.max(...intel.skips.byTeam.map((x) => x.count))} tone="bg-amber-500" label={`${t.count} skipped`} />
                  <span className="tabular-nums text-[var(--text-primary)] w-8 text-right">{t.count}</span>
                </div>
              ))}
            </div>
            <EnterpriseTable
              columns={skippedColumns}
              data={skipped}
              getRowId={(r) => String(r.id)}
              enableColumnFilters={false}
              searchPlaceholder="Search case or stage"
              emptyMessage="No skipped stages."
              initialPageSize={10}
              pageSizeOptions={[10, 25, 50]}
              exportFileName={reportFileName('Claims Skipped Stages')}
              reportMeta={{ title: 'Claim stages nobody worked' }}
            />
          </>
        )}
      </div>
    </div>
  )
}
