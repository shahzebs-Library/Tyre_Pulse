/**
 * claimProgressBoardAnalytics - pure engine behind the accident "Claim
 * progress" board (src/components/accidents/ClaimProgressBoard.jsx, mounted on
 * the Accidents Analytics tab).
 *
 * The stage maths lives in src/lib/accidentStages.js (buildStageIntelligence,
 * longestWaiting). This module only composes it for the board: the FULL waiting
 * list (the shared helper stops at ten for compact callers, which clipped this
 * board silently), a KPI strip, and flat rows for the tables and exports.
 *
 * It keeps the ledger's honesty rule: durations are how long a team HELD a case,
 * never a claim that the team caused the delay, and a figure resting on a
 * backfilled entry time is flagged approximate. Unmeasurable figures are null.
 * No I/O; the clock is injected.
 */
import { buildStageIntelligence, longestWaiting } from './accidentStages'

export const dayText = (d) => (d == null || !Number.isFinite(Number(d))
  ? 'N/A'
  : Number(d) < 1 ? `${Math.round(Number(d) * 24)}h` : `${Number(d)}d`)

/** Stage intelligence with the waiting list uncapped. */
export function buildClaimBoard(records = [], events = [], now = Date.now()) {
  const intel = buildStageIntelligence(records, events, now)
  return { ...intel, waiting: longestWaiting(records, events, { limit: Infinity, now }) }
}

/** KPI strip figures. */
export function claimBoardKpis(board) {
  const teams = board?.teams || []
  const waiting = board?.waiting || []
  const longest = waiting[0] || null
  const missingCases = waiting.filter((w) => (w.outstanding || []).some((o) => (o.missing || []).length)).length
  return {
    open: board?.open ?? 0,
    total: board?.total ?? 0,
    teamsHolding: teams.filter((t) => t.holdingNow > 0).length,
    longestDays: longest ? longest.heldDays : null,
    longestLabel: longest ? `${longest.reference || longest.asset || 'Case'} at ${longest.label}` : null,
    longestEstimated: Boolean(longest?.estimated),
    skippedStages: board?.skips?.total ?? 0,
    skippedCases: board?.skips?.cases?.length ?? 0,
    casesMissingFields: waiting.length ? missingCases : null,
    ledgerReady: Boolean(board?.ledgerReady),
  }
}

/** Team rows for the table and export. */
export function teamRows(board) {
  return (board?.teams || []).map((t) => ({
    department: t.department,
    holdingNow: t.holdingNow ?? 0,
    medianDays: t.medianDays ?? null,
    worstDays: t.worstDays ?? null,
    approx: Boolean(t.anyEstimated && t.medianDays != null),
    missingFields: t.missingFields ?? 0,
    casesWithGaps: t.casesWithGaps ?? 0,
    skippedStages: t.skippedStages ?? 0,
  }))
}

/** Waiting rows (longest first) for the table and export. */
export function waitingRows(board) {
  return (board?.waiting || []).map((w) => ({
    id: w.id,
    reference: w.reference || w.asset || 'Case',
    asset: w.asset || '',
    site: w.site || '',
    stage: w.label || 'Not set',
    department: w.department || 'No team',
    heldDays: w.heldDays ?? null,
    estimated: Boolean(w.estimated),
    missingFields: (w.outstanding || []).reduce((a, o) => a + (o.missing || []).length, 0),
  }))
}

/** Skipped-stage case rows. */
export function skippedRows(board) {
  return (board?.skips?.cases || []).map((c) => ({
    id: c.id,
    reference: c.reference || c.asset || 'Case',
    count: c.count ?? 0,
    stages: (c.stages || []).map((x) => x.label).join(', '),
  }))
}

export const TEAM_EXPORT_COLS = ['department', 'holdingNow', 'median', 'worst', 'missingFields', 'skippedStages']
export const TEAM_EXPORT_HEADERS = ['Team', 'Holding now', 'Typical time held', 'Longest held', 'Fields still missing', 'Stages they never got']

/** Team rows shaped for Excel/PDF (durations as text, approx flagged). */
export function teamExportRows(board) {
  return teamRows(board).map((t) => ({
    department: t.department,
    holdingNow: t.holdingNow,
    median: `${dayText(t.medianDays)}${t.approx ? ' approx' : ''}`,
    worst: dayText(t.worstDays),
    missingFields: t.missingFields,
    skippedStages: t.skippedStages,
  }))
}
