/**
 * One accident claim, divided among the teams that actually work it.
 *
 * THE PROBLEM THIS SOLVES. The stage ladder already existed (V300/V301) and the
 * stages already named their owning team, but nothing said WHICH FIELDS each team
 * is responsible for and nothing recorded WHEN a stage started or ended. So on
 * the live 35 incidents the pipeline was decorative: root_cause 0/35,
 * responsible_owner_id 0/35, approved_repair_amount 0/35, hse_investigation 0/35,
 * closure_evidence 0/35, target_date 0/35. No team had ever recorded doing
 * anything, and "who delayed this claim" had no answer at all.
 *
 * TWO DELIBERATE CHOICES:
 *
 *  1. NO NEW COLUMNS. Every field a team needs already exists on `accidents`.
 *     This file is an OWNERSHIP MAP over those columns, not a new data model. A
 *     team's work is visible because we finally say which columns are theirs.
 *
 *  2. A STAGE IS NEVER "COMPLETE" BY GUESSWORK. Completion is the share of that
 *     stage's REQUIRED fields that carry a value. Optional fields are shown but
 *     never counted, because counting them would let a team look incomplete for
 *     skipping something genuinely optional - and would let a stage look complete
 *     when it is padded with easy fields.
 *
 * Pure and deterministic: `now` is always injected, there is no I/O, and nothing
 * here reads the clock on its own.
 */
import { STAGE_FLOW, stageIndex, stageLabel, stageDept } from './accidentWorkflow'

const s = (v) => (v == null ? '' : String(v).trim())
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * A field carries a value when it is genuinely recorded.
 *
 * Money is the case that bites: `parts_cost` is present on all 35 live incidents
 * and EVERY value is 0.00, so a null check would mark the whole cost side
 * complete while it contributes nothing. A money field must be non-zero to count.
 * Same rule as coverageOf({money:true}) in accidentAnalytics - they must agree.
 */
export function fieldFilled(record, field) {
  const v = record?.[field.key]
  if (field.money) {
    const n = num(v)
    return n != null && n !== 0
  }
  if (field.kind === 'bool') return v === true || v === false
  if (Array.isArray(v)) return v.length > 0
  if (v && typeof v === 'object') return Object.keys(v).length > 0
  return s(v) !== ''
}

/**
 * Which team owns which stage, and the EXISTING accidents columns that team fills.
 *
 * `required` is what the stage cannot be considered done without. Everything else
 * is `optional`: shown to the team as theirs, never counted against them.
 *
 * The teams are the ones the stage ladder already names, so this map and
 * WORKFLOW_STAGES[].dept must stay in step - a test pins that.
 */
export const STAGE_FIELDS = Object.freeze({
  reported: {
    intent: 'Record what happened, where, and to which vehicle.',
    required: [
      { key: 'incident_date', label: 'Incident date' },
      { key: 'asset_no', label: 'Asset number' },
      { key: 'site', label: 'Site' },
      { key: 'description', label: 'What happened' },
    ],
    optional: [
      { key: 'driver_name', label: 'Driver' },
      { key: 'accident_type', label: 'Accident type' },
      { key: 'severity', label: 'Severity' },
      { key: 'photos', label: 'Scene photos' },
      { key: 'police_report_no', label: 'Police report number' },
    ],
  },
  initial_review: {
    intent: 'Decide who owns the case and by when it should be resolved.',
    required: [
      { key: 'responsible_owner_id', label: 'Responsible owner' },
      { key: 'target_date', label: 'Target resolution date' },
    ],
    optional: [
      { key: 'departments_involved', label: 'Departments involved' },
      { key: 'vor', label: 'Vehicle off road', kind: 'bool' },
    ],
  },
  hse_investigation: {
    intent: 'Establish why it happened and what stops it happening again.',
    required: [
      { key: 'root_cause', label: 'Root cause' },
      { key: 'corrective_action', label: 'Corrective action' },
    ],
    optional: [
      { key: 'preventive_action', label: 'Preventive action' },
      { key: 'hse_investigation', label: 'Investigation notes' },
      { key: 'fault_status', label: 'Fault status' },
    ],
  },
  workshop_assessment: {
    intent: 'Assess the damage and estimate what the repair will cost.',
    required: [
      { key: 'estimated_damage_cost', label: 'Estimated damage cost', money: true },
      { key: 'repair_type', label: 'Repair type (internal or external)' },
    ],
    optional: [
      { key: 'workshop_name', label: 'Workshop' },
      { key: 'workshop_location', label: 'Workshop location' },
      { key: 'expected_release_date', label: 'Expected release date' },
    ],
  },
  insurance_claim: {
    intent: 'File the claim and record what the insurer is being asked for.',
    required: [
      { key: 'insurer', label: 'Insurer' },
      { key: 'claim_amount', label: 'Amount claimed', money: true },
    ],
    optional: [
      { key: 'policy_no', label: 'Policy number' },
      { key: 'claim_status', label: 'Claim status' },
      { key: 'deductible', label: 'Deductible', money: true },
      { key: 'najm_status', label: 'Najm report' },
      { key: 'taqdeer_status', label: 'Taqdeer report' },
      { key: 'taqdeer_no', label: 'Taqdeer number' },
      { key: 'gcc_liability_ratio', label: 'Liability share' },
    ],
  },
  repair_approval: {
    intent: 'Approve a repair value before any spend is committed.',
    required: [
      { key: 'approved_repair_amount', label: 'Approved repair amount', money: true },
      { key: 'estimate_approved_by', label: 'Approved by' },
    ],
    optional: [
      { key: 'estimate_approved_at', label: 'Approved on' },
      { key: 'claim_approved_amount', label: 'Insurer approved amount', money: true },
    ],
  },
  repair_in_progress: {
    intent: 'Do the repair and record what it actually cost.',
    required: [
      { key: 'repair_cost', label: 'Repair cost', money: true },
    ],
    optional: [
      { key: 'parts_cost', label: 'Parts cost', money: true },
      { key: 'workshop_name', label: 'Workshop' },
    ],
  },
  final_inspection: {
    intent: 'Confirm the vehicle is fit to return to work.',
    required: [
      { key: 'closure_evidence', label: 'Inspection evidence' },
    ],
    optional: [
      { key: 'photos', label: 'Post-repair photos' },
    ],
  },
  vehicle_release: {
    intent: 'Hand the vehicle back and record the date it went back to work.',
    required: [
      { key: 'release_date', label: 'Release date' },
    ],
    optional: [
      { key: 'vor', label: 'Vehicle off road', kind: 'bool' },
    ],
  },
  cost_recovery: {
    intent: 'Recover what can be recovered and record what could not.',
    required: [
      { key: 'recovered_amount', label: 'Recovered amount', money: true },
      { key: 'recovery_status', label: 'Recovery decision' },
    ],
    optional: [
      { key: 'recovery_source', label: 'Recovered from' },
      { key: 'recovery_date', label: 'Recovery date' },
      { key: 'recovery_reference', label: 'Recovery reference' },
      { key: 'amount_transfer', label: 'Amount transferred', money: true },
    ],
  },
  closed: {
    intent: 'Close the case with the evidence that it is finished.',
    required: [
      { key: 'closure_evidence', label: 'Closure evidence' },
    ],
    optional: [],
  },
  cancelled: { intent: 'Case withdrawn.', required: [], optional: [] },
})

/** The team that owns a stage. `stageDept` (accidentWorkflow) is the one source;
 *  this only normalises its null to '' so callers can compare strings. */
export const stageDepartment = (stage) => stageDept(stage) || ''

/** Every team that owns at least one stage, in pipeline order. */
export const STAGE_TEAMS = Object.freeze(
  STAGE_FLOW.reduce((acc, k) => {
    const d = stageDepartment(k)
    if (d && !acc.includes(d)) acc.push(d)
    return acc
  }, []),
)

/**
 * How much of a stage's own work is recorded.
 * `pct` is null when the stage requires nothing - not 100, which would read as
 * "this team finished" when there was never anything to finish.
 */
export function stageCompletion(record, stage) {
  const spec = STAGE_FIELDS[stage] || { required: [], optional: [] }
  const req = spec.required || []
  const opt = spec.optional || []
  const filled = req.filter((f) => fieldFilled(record, f))
  const missing = req.filter((f) => !fieldFilled(record, f))
  return {
    stage,
    department: stageDepartment(stage),
    intent: spec.intent || '',
    required: req,
    optional: opt,
    optionalFilled: opt.filter((f) => fieldFilled(record, f)),
    filled,
    missing,
    total: req.length,
    pct: req.length ? Math.round((filled.length / req.length) * 100) : null,
    complete: req.length > 0 && missing.length === 0,
  }
}

const DAY = 86400000
const days = (from, to) => {
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, Math.round(((b - a) / DAY) * 10) / 10)
}

/**
 * The claim as a ladder: what each team did, how long they held it, what they
 * still owe, and which stages nobody worked.
 *
 * `events` are accident_stage_events rows. With none, the ladder still renders
 * from the record's current stage and every duration is null - an honest "not
 * recorded", never a zero that reads as instant.
 *
 * FOUR STATES, and the difference between two of them is the point:
 *   done    - the case moved past this stage
 *   skipped - the case moved past it WITHOUT stopping. Not the same as done, and
 *             showing it as done is what let a case look finished while five
 *             teams never touched it.
 *   current - the case is sitting here now
 *   pending - not reached yet
 */
export function caseProgress(record, events = [], now = Date.now()) {
  const list = Array.isArray(events) ? events : []
  const byStage = new Map()
  for (const e of list) {
    const k = s(e?.stage)
    if (!k) continue
    if (!byStage.has(k)) byStage.set(k, [])
    byStage.get(k).push(e)
  }

  const current = s(record?.workflow_stage) || 'reported'
  const curIdx = stageIndex(current)

  const rows = STAGE_FLOW.map((stage) => {
    const idx = stageIndex(stage)
    const occ = (byStage.get(stage) || []).slice()
      .sort((a, b) => new Date(a.entered_at) - new Date(b.entered_at))
    const open = occ.find((e) => !e.exited_at)
    const skippedOnly = occ.length > 0 && occ.every((e) => e.skipped)

    let state
    if (stage === current) state = 'current'
    else if (skippedOnly) state = 'skipped'
    else if (curIdx >= 0 && idx >= 0 && idx < curIdx) state = occ.length ? 'done' : 'skipped'
    else state = 'pending'

    // Total time this team held the case, across every visit (a case sent back
    // for rework visits a stage twice and both visits are that team's time).
    let held = null
    for (const e of occ) {
      if (e.skipped) continue
      const d = days(e.entered_at, e.exited_at || now)
      if (d != null) held = (held || 0) + d
    }

    const completion = stageCompletion(record, stage)
    return {
      ...completion,
      state,
      visits: occ.filter((e) => !e.skipped).length,
      enteredAt: occ.find((e) => !e.skipped)?.entered_at || null,
      exitedAt: occ.filter((e) => !e.skipped).slice(-1)[0]?.exited_at || null,
      heldDays: held,
      // A backfilled duration is the row's last-modified time, not a measured
      // transition. Callers must say so rather than present it as observed.
      estimated: occ.some((e) => !e.skipped && e.basis === 'backfilled'),
      holder: open?.entered_by || null,
      label: stageLabel(stage),
    }
  })

  const worked = rows.filter((r) => r.state === 'done' || r.state === 'current')
  const reqTotal = worked.reduce((a, r) => a + r.total, 0)
  const reqFilled = worked.reduce((a, r) => a + r.filled.length, 0)

  return {
    stage: current,
    rows,
    skipped: rows.filter((r) => r.state === 'skipped'),
    // Completeness of the work the case has actually REACHED. Measuring against
    // all eleven stages would make every young case look neglected.
    reachedRequired: reqTotal,
    reachedFilled: reqFilled,
    reachedPct: reqTotal ? Math.round((reqFilled / reqTotal) * 100) : null,
    // The teams that are past and left required fields empty. This is the list
    // that makes a claim reviewable: it names who owes what.
    outstanding: rows
      .filter((r) => (r.state === 'done' || r.state === 'current') && r.missing.length > 0)
      .map((r) => ({ stage: r.stage, department: r.department, label: r.label, missing: r.missing })),
    holdingTeam: rows.find((r) => r.state === 'current')?.department || '',
    heldDays: rows.find((r) => r.state === 'current')?.heldDays ?? null,
    estimated: rows.find((r) => r.state === 'current')?.estimated || false,
  }
}

/** Median. Reported alongside the mean because a single stalled claim drags an
 *  average far enough to hide that most cases move fine. */
export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10
}

/**
 * Per-team performance across a set of cases: how many they are holding right
 * now, how long they typically hold one, and their worst.
 *
 * WHAT THIS DELIBERATELY DOES NOT SAY. It reports how long a team HELD a case,
 * never that the team caused the delay. A claim can sit at Insurance for forty
 * days because the insurer has not replied, which is not the insurance team being
 * slow. The data records where the time went; who is at fault is a judgement
 * about the real world that a table cannot make. Every label here says "held".
 */
export function teamPerformance(cases = [], events = [], now = Date.now()) {
  const byCase = new Map()
  for (const e of (Array.isArray(events) ? events : [])) {
    const k = s(e?.accident_id)
    if (!k) continue
    if (!byCase.has(k)) byCase.set(k, [])
    byCase.get(k).push(e)
  }

  const teams = new Map()
  const team = (name) => {
    if (!teams.has(name)) {
      teams.set(name, {
        department: name, holdingNow: 0, completedVisits: 0, durations: [],
        skippedStages: 0, missingFields: 0, casesWithGaps: 0, estimatedVisits: 0,
      })
    }
    return teams.get(name)
  }
  for (const t of STAGE_TEAMS) team(t)

  for (const c of (Array.isArray(cases) ? cases : [])) {
    const prog = caseProgress(c, byCase.get(s(c?.id)) || [], now)
    let gapCounted = new Set()
    for (const r of prog.rows) {
      if (!r.department) continue
      const t = team(r.department)
      if (r.state === 'current') {
        t.holdingNow++
        if (r.heldDays != null) t.durations.push(r.heldDays)
        if (r.estimated) t.estimatedVisits++
      } else if (r.state === 'done') {
        t.completedVisits += r.visits || 1
        if (r.heldDays != null) t.durations.push(r.heldDays)
        if (r.estimated) t.estimatedVisits++
      } else if (r.state === 'skipped') {
        t.skippedStages++
      }
      if ((r.state === 'done' || r.state === 'current') && r.missing.length) {
        t.missingFields += r.missing.length
        if (!gapCounted.has(r.department)) { t.casesWithGaps++; gapCounted.add(r.department) }
      }
    }
  }

  return [...teams.values()]
    .map((t) => ({
      ...t,
      medianDays: median(t.durations),
      worstDays: t.durations.length ? Math.max(...t.durations) : null,
      // Any duration drawn partly from a backfilled entry time is an estimate.
      // Saying so is the difference between a measurement and a guess.
      anyEstimated: t.estimatedVisits > 0,
    }))
    .sort((a, b) => (b.medianDays ?? -1) - (a.medianDays ?? -1) || b.holdingNow - a.holdingNow)
}

/**
 * Cases sitting longer in their current stage than the threshold. Not called an
 * SLA breach: nobody has set a per-stage SLA (sla_due_at is empty on all 35 live
 * rows), so this is "longest waiting", which is true, rather than "overdue",
 * which would need a target nobody agreed.
 */
export function longestWaiting(cases = [], events = [], { limit = 10, now = Date.now() } = {}) {
  const byCase = new Map()
  for (const e of (Array.isArray(events) ? events : [])) {
    const k = s(e?.accident_id)
    if (!k) continue
    if (!byCase.has(k)) byCase.set(k, [])
    byCase.get(k).push(e)
  }
  return (Array.isArray(cases) ? cases : [])
    .map((c) => {
      const prog = caseProgress(c, byCase.get(s(c?.id)) || [], now)
      return {
        id: c?.id,
        reference: s(c?.reference_no) || s(c?.asset_no),
        asset: s(c?.asset_no),
        site: s(c?.site),
        stage: prog.stage,
        label: stageLabel(prog.stage),
        department: prog.holdingTeam,
        heldDays: prog.heldDays,
        estimated: prog.estimated,
        outstanding: prog.outstanding,
        skipped: prog.skipped.length,
      }
    })
    .filter((r) => r.heldDays != null && r.stage !== 'closed' && r.stage !== 'cancelled')
    .sort((a, b) => b.heldDays - a.heldDays)
    .slice(0, limit)
}

/**
 * Cases that reached a stage without anyone working it. The direct answer to
 * "why did this go to closed on its own": the register's Status dropdown moves a
 * case to closed in one write, and every stage in between is passed over.
 */
export function skippedStageReport(cases = [], events = []) {
  const byCase = new Map()
  for (const e of (Array.isArray(events) ? events : [])) {
    if (!e?.skipped) continue
    const k = s(e?.accident_id)
    if (!k) continue
    if (!byCase.has(k)) byCase.set(k, [])
    byCase.get(k).push(e)
  }
  const rows = (Array.isArray(cases) ? cases : [])
    .map((c) => {
      const skips = byCase.get(s(c?.id)) || []
      if (!skips.length) return null
      return {
        id: c?.id,
        reference: s(c?.reference_no) || s(c?.asset_no),
        asset: s(c?.asset_no),
        stage: s(c?.workflow_stage),
        count: skips.length,
        stages: skips.map((e) => ({ stage: e.stage, label: stageLabel(e.stage), department: e.department })),
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count)

  const byTeam = new Map()
  for (const r of rows) {
    for (const st of r.stages) {
      const k = st.department || 'Unassigned'
      byTeam.set(k, (byTeam.get(k) || 0) + 1)
    }
  }
  return {
    cases: rows,
    total: rows.reduce((a, r) => a + r.count, 0),
    byTeam: [...byTeam.entries()].map(([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count),
  }
}

/**
 * Everything the claim-progress board needs, from one pass.
 * `ledgerReady` is false when no stage events exist at all, so the board can say
 * that timings start from now rather than showing a page of nulls with no reason.
 */
export function buildStageIntelligence(cases = [], events = [], now = Date.now()) {
  const list = Array.isArray(cases) ? cases : []
  const evs = Array.isArray(events) ? events : []
  const teams = teamPerformance(list, evs, now)
  return {
    total: list.length,
    ledgerReady: evs.length > 0,
    // Any team figure that leans on a backfilled entry time is an estimate; the
    // board must label it rather than imply the clock was watched.
    anyEstimated: teams.some((t) => t.anyEstimated),
    teams,
    waiting: longestWaiting(list, evs, { now }),
    skips: skippedStageReport(list, evs),
    open: list.filter((c) => !['closed', 'cancelled'].includes(s(c?.workflow_stage))).length,
  }
}
