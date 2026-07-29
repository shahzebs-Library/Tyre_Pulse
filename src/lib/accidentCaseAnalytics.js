/**
 * Accident CASE analytics: honest KPIs over a set of cases (and, where given, the
 * workstream rows behind them).
 *
 * WHY THIS EXISTS. accidentAnalytics.js answers "what do the incident records
 * support?"; this file answers the case-model question one layer up: given the
 * multi-workstream case spine (accidentCase.js), where do cases sit, which team
 * or workstream holds them, how long do they take to close, and how often does
 * the SLA slip or a case reopen. Every figure here is computed only from what is
 * genuinely recorded and returns null - never a flattering 0 or 100 - when there
 * is nothing to measure.
 *
 * DESIGN CONTRACT (same discipline as accidentAnalytics.js / accidentCase.js):
 *   - Pure and deterministic. No I/O, no supabase, no React. A `now` is injected
 *     wherever an "is it overdue yet" comparison needs the clock.
 *   - Honest nulls. A rate with an empty denominator is null; "we did not measure
 *     this" and "the value is zero" are opposite statements and are kept distinct.
 *   - num()-style parsing. A blank string is "not measured", not 0. Number('') is
 *     0 and 0 is finite, so a naive Number() turns an empty field into a real
 *     reading of zero - the exact bug called out in the project rules.
 *   - Small samples are flagged, not trusted. A KPI computed from a handful of
 *     cases is not wrong, but presenting it as authoritative is; casesBasis()
 *     states the sample so the reader can judge it.
 *
 * REUSE, do not fork. The case-status vocabulary, the terminal set, the ten
 * workstreams and the "is this workstream satisfied" predicate all come from the
 * committed engine accidentCase.js - this file never re-defines them.
 */

import {
  CASE_STATUSES,
  TERMINAL_STATUSES,
  WORKSTREAMS,
  workstreamSatisfied,
  caseStatusLabel,
} from './accidentCase'

// ── tiny shared helpers (same shapes as the sibling engines) ──────────────────
const s = (v) => String(v ?? '').trim()
const lower = (v) => s(v).toLowerCase()
// A BLANK value (null / undefined / '' / whitespace) is "not measured", NOT 0.
const num = (v) => {
  if (v == null) return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const TRUTHY_TOKENS = new Set(['true', 't', 'yes', 'y', '1'])
const truthy = (v) => v === true || v === 1 || TRUTHY_TOKENS.has(lower(v))
const arr = (v) => (Array.isArray(v) ? v : [])
/** Parse a date-ish value to epoch ms, or null. Blank is not a date. */
const epoch = (v) => {
  const t = s(v)
  if (!t) return null
  const ms = new Date(t).getTime()
  return Number.isFinite(ms) ? ms : null
}
const DAY_MS = 86400000
const round1 = (n) => Math.round(n * 10) / 10

// ── shared lookups derived once from the engine vocabulary ────────────────────
/** case_status token -> owning team / parent stage (from CASE_STATUSES). */
const CASE_STATUS_META = Object.fromEntries(CASE_STATUSES.map((c) => [c.token, c]))
/** workstream key -> its display name + owning team (from WORKSTREAMS). */
const WORKSTREAM_META = Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w]))

/** A case is genuinely closed (resolved), NOT merely terminal. A cancelled
 *  duplicate is terminal but was withdrawn, not closed, so it never counts as a
 *  closure for timing or completion. */
export function isGenuinelyClosed(record) {
  return lower(record?.case_status) === 'closed' ||
    lower(record?.status) === 'closed' ||
    lower(record?.closure_level) === 'fully_closed'
}

/** A case is still open: it carries a case_status that is not a terminal token
 *  and has not otherwise closed. Blank status is treated as open (a case exists,
 *  it just has no recorded stage yet). */
export function isOpenCase(record) {
  if (isGenuinelyClosed(record)) return false
  const st = lower(record?.case_status)
  if (st && TERMINAL_STATUSES.has(st)) return false
  return true
}

// ═════════════════════════════════════════════════════════════════════════════
// BASIS - how much the figures rest on
// ═════════════════════════════════════════════════════════════════════════════

/** Below this many cases, a KPI is reported but explicitly flagged as thin, so a
 *  number computed from a handful of rows is never dressed as authoritative. */
export const MIN_AUTHORITATIVE = 10

/**
 * What the case KPIs rest on. Returns the sample sizes plus a plain-English note
 * that is '' when the sample is genuinely large enough - saying "based on 40
 * cases" on a healthy set is noise, but flagging a 3-case sample is the honest
 * thing to do.
 *
 * @returns {{ total:number, open:number, closed:number, authoritative:boolean, note:string }}
 */
export function casesBasis(records) {
  const list = arr(records)
  const total = list.length
  const closed = list.filter(isGenuinelyClosed).length
  const open = list.filter(isOpenCase).length
  const authoritative = total >= MIN_AUTHORITATIVE
  let note = ''
  if (total === 0) note = 'No cases in scope.'
  else if (!authoritative) {
    note = `Based on ${total} case${total === 1 ? '' : 's'}, too few to read as authoritative.`
  }
  return { total, open, closed, authoritative, note }
}

// ═════════════════════════════════════════════════════════════════════════════
// CASE-STATUS BREAKDOWN
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Cases grouped by their headline case_status, most common first. A case with no
 * recorded status is NOT invented into a bucket - it is counted separately as
 * `unrecorded`, because "we do not know where this case is" is a real state.
 *
 * @returns {{ rows:Array<{token:string,label:string,team:string|null,stage:string|null,value:number}>,
 *             total:number, distinct:number, unrecorded:number, top:object|null }}
 */
export function caseStatusBreakdown(records) {
  const list = arr(records)
  const counts = new Map()
  let unrecorded = 0
  for (const r of list) {
    const token = lower(r?.case_status)
    if (!token) { unrecorded += 1; continue }
    counts.set(token, (counts.get(token) || 0) + 1)
  }
  const rows = [...counts.entries()]
    .map(([token, value]) => ({
      token,
      label: caseStatusLabel(token),
      team: CASE_STATUS_META[token]?.team ?? null,
      stage: CASE_STATUS_META[token]?.stage ?? null,
      value,
    }))
    .sort((a, b) => b.value - a.value || a.token.localeCompare(b.token))
  return {
    rows,
    total: list.length,
    distinct: rows.length,
    unrecorded,
    top: rows[0] || null,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// WORKSTREAM BOTTLENECK - which workstream stalls the most cases
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Which workstream is holding cases up. A workstream STALLS a case when its row
 * is in a state that does not satisfy progress (anything other than completed /
 * not_required / cancelled - reusing the engine's own predicate). Counted per
 * CASE, not per row: a case is deduped on its accident_id so one case with two
 * blocking rows on the same workstream is one stall, not two.
 *
 * Takes the explicit workstream rows (accident_case_workstreams). Returns null-ish
 * empty shape when there are no workstream rows at all, because with no rows there
 * is genuinely nothing to attribute a bottleneck to.
 *
 * @param {object[]} wsRows accident_case_workstreams rows
 * @returns {{ rows:Array<{key:string,name:string,team:string|null,cases:number}>,
 *             measured:boolean, stalledCases:number, top:object|null }}
 */
export function byWorkstreamBottleneck(wsRows) {
  const rows = arr(wsRows)
  if (rows.length === 0) {
    return { rows: [], measured: false, stalledCases: 0, top: null }
  }
  // key -> Set of stalled case ids (dedupe per case).
  const byKey = new Map()
  const stalledCaseIds = new Set()
  for (const w of rows) {
    if (!w) continue
    const key = s(w.workstream_key || w.workstream || w.key)
    const status = s(w.status)
    if (!key || !status) continue
    if (workstreamSatisfied(status)) continue
    // A row with no case id still counts once under a synthetic id so it is not
    // silently dropped, but it can never merge with a real case's other rows.
    const caseId = s(w.accident_id || w.case_id || w.id) || `row:${key}:${byKey.size}`
    if (!byKey.has(key)) byKey.set(key, new Set())
    byKey.get(key).add(caseId)
    stalledCaseIds.add(caseId)
  }
  const out = [...byKey.entries()]
    .map(([key, ids]) => ({
      key,
      name: WORKSTREAM_META[key]?.name ?? key,
      team: WORKSTREAM_META[key]?.team ?? null,
      cases: ids.size,
    }))
    .sort((a, b) => b.cases - a.cases || a.key.localeCompare(b.key))
  return {
    rows: out,
    measured: true,
    stalledCases: stalledCaseIds.size,
    top: out[0] || null,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TIME TO CLOSE - measured only over genuinely closed cases
// ═════════════════════════════════════════════════════════════════════════════

/** The moment a case opened (created_at, else the incident date). */
function caseStart(record) {
  return epoch(record?.created_at) ?? epoch(record?.incident_date)
}
/** The moment a case closed. There is no single canonical column, so the known
 *  close-stamp fields are tried in order; a release date is the last resort. */
function caseEnd(record) {
  return epoch(record?.closed_at) ?? epoch(record?.closure_date) ??
    epoch(record?.closed_date) ?? epoch(record?.fully_closed_at) ??
    epoch(record?.release_date)
}

/**
 * Average (and median, and longest) days from open to close, measured ONLY over
 * cases that genuinely closed AND carry both a valid start and a valid, not-
 * earlier close timestamp. Everything is null when nothing could be measured -
 * an unmeasurable set does not average to 0, which would read as "every case
 * closed the same day it opened".
 *
 * `measured` vs `closedTotal` is the honest gap: it says how many closed cases
 * actually had the dates needed to time them.
 *
 * @returns {{ avgDays:number|null, medianDays:number|null, longestDays:number|null,
 *             measured:number, closedTotal:number }}
 */
export function avgTimeToClose(records) {
  const list = arr(records)
  const closed = list.filter(isGenuinelyClosed)
  const days = []
  for (const r of closed) {
    const a = caseStart(r)
    const b = caseEnd(r)
    if (a == null || b == null) continue
    const d = (b - a) / DAY_MS
    if (!Number.isFinite(d) || d < 0) continue
    days.push(d)
  }
  days.sort((a, b) => a - b)
  const median = days.length
    ? (days.length % 2
      ? days[(days.length - 1) / 2]
      : (days[days.length / 2 - 1] + days[days.length / 2]) / 2)
    : null
  return {
    avgDays: days.length ? round1(days.reduce((a, b) => a + b, 0) / days.length) : null,
    medianDays: median == null ? null : round1(median),
    longestDays: days.length ? round1(days[days.length - 1]) : null,
    measured: days.length,
    closedTotal: closed.length,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// OPEN BY TEAM - who is currently holding open cases
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Open cases grouped by the team that currently owns them (derived from each
 * case's case_status via the engine vocabulary). A case whose status carries no
 * team, or whose status is blank, is grouped under 'Unassigned' rather than being
 * dropped - an open case nobody owns is exactly what a workload view must surface.
 *
 * @returns {{ rows:Array<{team:string,value:number}>, openTotal:number, top:object|null }}
 */
export function openByTeam(records) {
  const open = arr(records).filter(isOpenCase)
  const counts = new Map()
  for (const r of open) {
    const token = lower(r?.case_status)
    const team = (token && CASE_STATUS_META[token]?.team) || 'Unassigned'
    counts.set(team, (counts.get(team) || 0) + 1)
  }
  const rows = [...counts.entries()]
    .map(([team, value]) => ({ team, value }))
    .sort((a, b) => b.value - a.value || a.team.localeCompare(b.team))
  return { rows, openTotal: open.length, top: rows[0] || null }
}

// ═════════════════════════════════════════════════════════════════════════════
// SLA BREACH RATE - null when there is no SLA data at all
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Share of SLA-tracked items that have breached. An item counts toward the
 * denominator ONLY if it carries a usable SLA due date (sla_due_at / due_at); an
 * item with no SLA is not "compliant", it is simply not tracked, so it is
 * excluded entirely. An item breaches when its due date has passed and it is not
 * yet satisfied (completed / cancelled / not_required, or carrying a completion
 * timestamp).
 *
 * Returns rate === null when NOTHING carries an SLA - that is the difference
 * between "0% breached" (measured, all fine) and "no SLA data" (unmeasurable).
 *
 * Pure: the "has the due date passed" test needs the clock, so `now` is injected.
 *
 * @param {object[]} items rows that may carry sla_due_at/due_at + status/completed_at
 * @param {{ now?: Date|string|number }} [opts]
 * @returns {{ tracked:number, breached:number, rate:number|null }}
 */
export function slaBreachRate(items, { now = Date.now() } = {}) {
  const ref = epoch(now) ?? Date.now()
  let tracked = 0
  let breached = 0
  for (const it of arr(items)) {
    if (!it) continue
    const due = epoch(it.sla_due_at) ?? epoch(it.due_at) ?? epoch(it.sla_due)
    if (due == null) continue
    tracked += 1
    if (slaSatisfied(it)) continue
    if (due < ref) breached += 1
  }
  return { tracked, breached, rate: tracked ? breached / tracked : null }
}

/** An SLA item is satisfied (so it cannot breach) when it carries a completion
 *  timestamp or a satisfying status. */
function slaSatisfied(item) {
  if (epoch(item.completed_at) != null) return true
  if (truthy(item.resolved)) return true
  const st = s(item.status)
  return st ? workstreamSatisfied(st) : false
}

// ═════════════════════════════════════════════════════════════════════════════
// CLOSURE-LEVEL BREAKDOWN
// ═════════════════════════════════════════════════════════════════════════════

/** The three recorded closure levels (accidentCase.closureLevel tokens), in
 *  lifecycle order. `open` is the fourth, implicit state (no level yet). */
export const CLOSURE_LEVEL_LABELS = Object.freeze({
  financially_open: 'Financially open',
  operationally_completed: 'Operationally completed',
  fully_closed: 'Fully closed',
})
const CLOSURE_LEVEL_ORDER = ['financially_open', 'operationally_completed', 'fully_closed']

/**
 * Cases grouped by closure level. A case with no closure_level (and not otherwise
 * closed) is counted as `open` rather than being forced into a level. Includes an
 * explicit row for every known level (value 0 when none) so the distribution
 * reads honestly rather than hiding an empty stage.
 *
 * @returns {{ rows:Array<{level:string,label:string,value:number}>, open:number,
 *             total:number, fullyClosed:number }}
 */
export function closureLevelBreakdown(records) {
  const list = arr(records)
  const counts = new Map(CLOSURE_LEVEL_ORDER.map((k) => [k, 0]))
  let open = 0
  for (const r of list) {
    let level = lower(r?.closure_level)
    // A genuinely closed case with no explicit level is still fully closed.
    if (!level && isGenuinelyClosed(r)) level = 'fully_closed'
    if (level && counts.has(level)) counts.set(level, counts.get(level) + 1)
    else open += 1
  }
  const rows = CLOSURE_LEVEL_ORDER.map((level) => ({
    level,
    label: CLOSURE_LEVEL_LABELS[level],
    value: counts.get(level),
  }))
  return { rows, open, total: list.length, fullyClosed: counts.get('fully_closed') }
}

// ═════════════════════════════════════════════════════════════════════════════
// REOPEN RATE
// ═════════════════════════════════════════════════════════════════════════════

/** A case has been reopened at least once. */
function wasReopened(record) {
  return truthy(record?.reopened_flag) || truthy(record?.reopened) ||
    lower(record?.case_status) === 'reopened' ||
    (num(record?.reopen_count) ?? 0) > 0
}

/**
 * Share of cases that have been reopened - a proxy for closures that did not
 * hold. Rate is null when there are no cases at all (an empty set has no rate,
 * it is not "0% reopened").
 *
 * @returns {{ reopened:number, total:number, rate:number|null }}
 */
export function reopenRate(records) {
  const list = arr(records)
  const reopened = list.filter(wasReopened).length
  return { reopened, total: list.length, rate: list.length ? reopened / list.length : null }
}

// ═════════════════════════════════════════════════════════════════════════════
// AGGREGATE - one object for the page and the report
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Everything above in one object, so the dashboard and any report describe the
 * same numbers. `wsRows` (explicit workstream rows) and `now` are optional; the
 * SLA rate is computed over the workstream rows when supplied.
 *
 * @param {object[]} records case rows (accidents + case columns)
 * @param {object[]} [wsRows] accident_case_workstreams rows
 * @param {{ now?: Date|string|number }} [opts]
 */
export function buildCaseAnalytics(records, wsRows = [], { now = Date.now() } = {}) {
  const list = arr(records)
  return {
    basis: casesBasis(list),
    status: caseStatusBreakdown(list),
    bottleneck: byWorkstreamBottleneck(wsRows),
    timeToClose: avgTimeToClose(list),
    openByTeam: openByTeam(list),
    sla: slaBreachRate(wsRows, { now }),
    closureLevel: closureLevelBreakdown(list),
    reopen: reopenRate(list),
  }
}
