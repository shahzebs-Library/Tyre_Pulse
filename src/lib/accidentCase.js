/**
 * accidentCase.js — the pure, deterministic "case brain" for the accident module.
 *
 * THE JOB. An accident case is not one Open/Closed switch. It is a set of
 * WORKSTREAMS (each owned by a real team), a ROUTE (the path a case takes, which
 * decides which workstreams are actually required), a five-part COMPLETENESS
 * reading computed from the required workstreams ONLY, and a CLOSURE GATE that a
 * case can pass only when every required piece is genuinely done. This file is
 * the single source for all of that.
 *
 * DESIGN CONTRACT (identical to accidentWorkflow.js / accidentStages.js):
 *   - Pure and deterministic. No I/O, no supabase, no React, no clock read: a
 *     `now` is injected wherever time is needed.
 *   - Honest nulls. A percentage that has nothing in scope is `null`, never a
 *     flattering 100 — the same rule as accidentStages.stageCompletion.pct.
 *   - Route-based, never field-count. The single most emphasised rule in the
 *     brief (§4, §9): "Do not calculate completeness from all available fields."
 *     Only the workstreams the route REQUIRES count.
 *   - It is the SPEC the SQL mirrors. The Postgres functions
 *     accident_required_workstreams / accident_completeness / accident_can_close /
 *     accident_derive_case_status / accident_transition_allowed copy this file
 *     verbatim (the same discipline as accident_stage_order <-> STAGE_FLOW).
 *
 * REUSE, do not fork: WORKFLOW_STAGES / STAGE_FLOW (the 12-stage ledger axis) and
 * stageCompletion (the required-field coverage per team) come from the existing
 * engines. `case_status` is a finer overlay on top of `workflow_stage`, not a
 * competing lifecycle.
 *
 * Ref: docs/accident-module/03_WORKFLOW_ENGINE.md, ACCIDENT_MODULE_BRIEF.md §4-9.
 */

import { stageCompletion } from './accidentStages'

// ── tiny shared helpers (same shapes as the sibling engines) ──────────────────
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
const str = (v) => (v == null ? '' : String(v).trim())
const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1'
const arr = (v) => (Array.isArray(v) ? v : [])
const lower = (v) => str(v).toLowerCase()

// ═════════════════════════════════════════════════════════════════════════════
// 1. WORKSTREAMS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The ten canonical workstreams (§2.1). Each maps 1:1 to a closure requirement,
 * carries its owning team, the completeness DIMENSION it feeds (§4.2), and the
 * near-term `workflow_stage` its derived status reads from (§2.3). The stage is
 * the FALLBACK source used only when no explicit workstream row exists — the
 * explicit team-set row is always the truth when present.
 */
export const WORKSTREAMS = Object.freeze([
  { key: 'incident_evidence', name: 'Incident & Evidence',   domain: 'A', team: 'Fleet Incident Officer', dimension: 'incident',  stage: 'reported' },
  { key: 'fleet_validation',  name: 'Fleet Validation',      domain: 'A', team: 'Fleet Supervisor',       dimension: 'incident',  stage: 'initial_review' },
  { key: 'liability',         name: 'Safety & Liability',    domain: 'B', team: 'HSE Officer / Fleet Mgr', dimension: 'incident',  stage: 'hse_investigation' },
  { key: 'insurance',         name: 'Insurance & Claim',     domain: 'C', team: 'Insurance Claims Officer', dimension: 'insurance', stage: 'insurance_claim' },
  { key: 'assessment',        name: 'Technical Assessment',  domain: 'D', team: 'Workshop Planner',        dimension: 'repair',    stage: 'workshop_assessment' },
  { key: 'repair',            name: 'Repair',                domain: 'D', team: 'Workshop',                dimension: 'repair',    stage: 'repair_in_progress' },
  { key: 'workshop_qc',       name: 'Workshop Quality Control', domain: 'D', team: 'Workshop QC',          dimension: 'repair',    stage: 'final_inspection' },
  { key: 'handover',          name: 'Fleet Handover',        domain: 'E', team: 'Fleet Inspector / Ops',   dimension: 'repair',    stage: 'vehicle_release' },
  { key: 'finance',           name: 'Finance & Settlement',  domain: 'F', team: 'Finance / Cost Controller', dimension: 'financial', stage: 'cost_recovery' },
  { key: 'corrective',        name: 'Corrective Actions',    domain: 'B', team: 'HSE Officer',             dimension: 'incident',  stage: 'hse_investigation' },
])

export const WORKSTREAM_KEYS = WORKSTREAMS.map((w) => w.key)
const WORKSTREAM_BY_KEY = Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w]))
/** workstream key -> the 12-stage ledger stage it reads (near-term fallback). */
export const WORKSTREAM_STAGE = Object.freeze(
  Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w.stage])),
)
/** workstream key -> completeness dimension (§4.2). */
export const DIMENSION_OF = Object.freeze(
  Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w.dimension])),
)
export const DIMENSIONS = ['incident', 'insurance', 'repair', 'financial']
/** Pipeline order for deriving the case headline (§3). */
export const PIPELINE_ORDER = [
  'incident_evidence', 'fleet_validation', 'liability', 'insurance',
  'assessment', 'repair', 'workshop_qc', 'handover', 'finance', 'corrective',
]

// ── workstream status enum (§2.2) ─────────────────────────────────────────────
export const WORKSTREAM_STATUS = Object.freeze({
  NOT_REQUIRED: 'not_required',
  NOT_STARTED: 'not_started',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  WAITING_INFO: 'waiting_info',
  WAITING_APPROVAL: 'waiting_approval',
  WAITING_EXTERNAL: 'waiting_external',
  ON_HOLD: 'on_hold',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  REOPENED: 'reopened',
  CANCELLED: 'cancelled',
})
export const WORKSTREAM_STATUS_TOKENS = Object.freeze(Object.values(WORKSTREAM_STATUS))

/**
 * The statuses that SATISFY a workstream for progress purposes (§2.2):
 *   completed      — the work is done
 *   not_required   — out of scope (NA with a reason on record, or route-excluded)
 *   cancelled      — withdrawn with a reason
 * Everything else (not_started / assigned / in_progress / waiting_* / on_hold /
 * rejected / reopened) BLOCKS completion.
 */
export const WORKSTREAM_SATISFIED = new Set(['completed', 'not_required', 'cancelled'])
export function workstreamSatisfied(status) { return WORKSTREAM_SATISFIED.has(str(status)) }

/**
 * The status of one workstream (§2.4).
 *
 * An explicit `accident_case_workstreams` row (team-set truth) wins. Absent one,
 * the status is DERIVED from how much of the workstream's owning stage is filled
 * (reusing stageCompletion): every required field filled -> completed, some ->
 * in_progress, none -> not_started. A stage with no required fields at all is
 * structurally out of scope -> not_required.
 *
 * @param {object} record accidents row
 * @param {string} workstream one of WORKSTREAM_KEYS
 * @param {object[]} [rows] explicit accident_case_workstreams rows
 */
export function workstreamStatus(record, workstream, rows = []) {
  const explicit = arr(rows).find(
    (w) => w && (w.workstream === workstream || w.key === workstream),
  )
  if (explicit && str(explicit.status)) return str(explicit.status)

  const stage = WORKSTREAM_STAGE[workstream]
  if (!stage) return WORKSTREAM_STATUS.NOT_REQUIRED
  const c = stageCompletion(record || {}, stage)
  if (c.total === 0) return WORKSTREAM_STATUS.NOT_REQUIRED
  if (c.complete) return WORKSTREAM_STATUS.COMPLETED
  return c.filled.length > 0 ? WORKSTREAM_STATUS.IN_PROGRESS : WORKSTREAM_STATUS.NOT_STARTED
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. NOT-APPLICABLE ENVELOPE (§5.2)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A workstream (or field) marked Not Applicable must carry a reason envelope:
 * WHO decided, WHEN, and WHY. A bare "switched off" with no reason does NOT
 * satisfy closure (brief §8.3). This is the minimal validity test.
 *
 *   { reason, by, at }            -> valid for scoring
 *   { reason, by, at, approved_by }-> valid where the route demands approval
 *
 * @param {object} entry the na envelope
 * @param {{ requireApproval?: boolean }} [opts]
 */
export function naEnvelopeValid(entry, { requireApproval = false } = {}) {
  if (!entry || typeof entry !== 'object') return false
  if (!str(entry.reason)) return false
  if (!str(entry.by)) return false
  if (!str(entry.at)) return false
  if (requireApproval && !str(entry.approved_by)) return false
  return true
}

/** Find the NA envelope for a workstream: explicit row `na_reason`/`na` first,
 *  else the near-term `accidents.stage_waivers[stage]` fallback. */
function naEnvelopeFor(record, workstream, rows) {
  const explicit = arr(rows).find(
    (w) => w && (w.workstream === workstream || w.key === workstream),
  )
  if (explicit && (explicit.na_reason || explicit.na)) return explicit.na_reason || explicit.na
  const stage = WORKSTREAM_STAGE[workstream]
  const w = record?.stage_waivers?.[stage]
  return w || null
}

/**
 * True when a workstream is formally marked Not Applicable — an NA envelope is
 * present and valid (and approved where the route demands it).
 * @param {object} record
 * @param {object[]} rows explicit workstream rows
 * @param {string} workstream
 * @param {{ requireApproval?: boolean }} [opts]
 */
export function markedNA(record, rows, workstream, { requireApproval = false } = {}) {
  return naEnvelopeValid(naEnvelopeFor(record, workstream, rows), { requireApproval })
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. ROUTES (§4.1) — the required workstream set per case path
// ═════════════════════════════════════════════════════════════════════════════

/** A physical repair actually took place (drives workshop_qc requirement, §4.1). */
export function repairOccurred(record) {
  const rt = lower(record?.repair_type)
  if (truthy(record?.no_repair) || rt === 'none' || rt === 'no repair' || rt === 'temporary') return false
  if (rt === 'internal' || rt === 'external') return true
  if (num(record?.repair_cost) > 0) return true
  if (num(record?.approved_repair_amount) > 0) return true
  return truthy(record?.repair_started)
}

/** Corrective actions are required (injury cases, or when the toggle is set). */
export function correctiveRequired(record) {
  return truthy(record?.corrective_action_required) ||
    truthy(record?.injuries) || num(record?.injury_count) > 0
}

/**
 * Core routes (§4.1). `conditional` workstreams are required only when their
 * predicate holds against the record ("workshop QC where repair occurred",
 * "corrective actions when the toggle is on"). The full route matrix lives in
 * config (workflow_route_profiles) — these are the deterministic fallback set so
 * the module never stalls waiting for configuration.
 */
export const CASE_ROUTES = Object.freeze({
  standard: {
    key: 'standard', label: 'Standard',
    required: ['incident_evidence', 'fleet_validation', 'liability', 'assessment', 'repair', 'handover', 'finance'],
    conditional: [{ ws: 'workshop_qc', when: repairOccurred }, { ws: 'corrective', when: correctiveRequired }],
  },
  minor_no_insurance: {
    key: 'minor_no_insurance', label: 'Minor accident without insurance',
    required: ['incident_evidence', 'fleet_validation', 'liability', 'assessment', 'repair', 'handover', 'finance'],
    conditional: [{ ws: 'corrective', when: correctiveRequired }],
  },
  internal_repair_insurance: {
    key: 'internal_repair_insurance', label: 'Internal repair with insurance',
    required: ['incident_evidence', 'fleet_validation', 'liability', 'insurance', 'assessment', 'repair', 'workshop_qc', 'handover', 'finance'],
    conditional: [{ ws: 'corrective', when: correctiveRequired }],
  },
  external_repair_insurance: {
    key: 'external_repair_insurance', label: 'External repair with insurance',
    required: ['incident_evidence', 'fleet_validation', 'liability', 'insurance', 'assessment', 'repair', 'workshop_qc', 'handover', 'finance'],
    conditional: [{ ws: 'corrective', when: correctiveRequired }],
  },
  total_loss: {
    key: 'total_loss', label: 'Total loss',
    // No repair path — the vehicle is written off; insurance + settlement instead.
    required: ['incident_evidence', 'fleet_validation', 'liability', 'insurance', 'assessment', 'finance'],
    conditional: [{ ws: 'corrective', when: correctiveRequired }],
  },
  injury: {
    key: 'injury', label: 'Injury accident',
    // Corrective actions are ALWAYS required for an injury case; the repair chain
    // is required only if the vehicle itself needed repair.
    required: ['incident_evidence', 'fleet_validation', 'liability', 'insurance', 'corrective', 'finance'],
    conditional: [
      { ws: 'assessment', when: repairOccurred },
      { ws: 'repair', when: repairOccurred },
      { ws: 'workshop_qc', when: repairOccurred },
      { ws: 'handover', when: repairOccurred },
    ],
  },
})

// ── route detection (fallback classifier, §4.1) ───────────────────────────────
function isTotalLoss(r) {
  return truthy(r?.total_loss_route) || truthy(r?.total_loss) ||
    truthy(r?.total_loss_possibility) || lower(r?.repair_type) === 'total loss' ||
    /total.?loss/i.test(str(r?.accident_type))
}
function isInjury(r) {
  return truthy(r?.injuries) || num(r?.injury_count) > 0 ||
    /injur|fatal/i.test(str(r?.accident_type))
}
/** Insurance is in play: explicit toggle, or an insurer/policy/claim on record. */
export function insuranceInvolved(r) {
  if (r?.insurance_involved === false) return false
  if (truthy(r?.insurance_involved)) return true
  return !!(str(r?.insurer) || str(r?.policy_no) || num(r?.claim_amount) > 0)
}
function isMinorSeverity(r) {
  const sev = lower(r?.severity)
  return sev === 'minor' || sev === 'low' || sev === 'small'
}

/** Does a config rule row match this case's attributes (§8.1)? */
function ruleMatches(rule, record) {
  if (!rule || rule.active === false) return false
  const eq = (col, val) => {
    if (col == null || col === '' || (Array.isArray(col) && col.length === 0)) return true // unset = wildcard
    const vals = Array.isArray(col) ? col.map(str) : [str(col)]
    return vals.includes(str(val))
  }
  if (!eq(rule.country, record?.country)) return false
  if (!eq(rule.accident_type, record?.accident_type)) return false
  if (!eq(rule.severity, record?.severity)) return false
  if (!eq(rule.vehicle_type, record?.vehicle_type)) return false
  if (rule.insurance_involved != null && truthy(rule.insurance_involved) !== insuranceInvolved(record)) return false
  if (rule.injury_involved != null && truthy(rule.injury_involved) !== isInjury(record)) return false
  if (rule.third_party_involved != null && truthy(rule.third_party_involved) !== truthy(record?.third_party_involved)) return false
  return true
}

/**
 * Resolve the route a case takes (§4.1, §8.3).
 *
 * A configured `workflow_route_profiles` rule wins (most specific — lowest
 * `priority` integer — first), so adding a route is a config row, not a code
 * change. When none matches, a deterministic fallback classifier picks a core
 * route from the case's own attributes, so the module never stalls on missing
 * configuration.
 *
 * @param {object} record accidents row
 * @param {object[]} [ruleProfiles] workflow_route_profiles rows
 * @returns {{ key: string, source: 'rule'|'fallback', profile: object|null }}
 */
export function buildCaseRoute(record, ruleProfiles = []) {
  const matched = arr(ruleProfiles)
    .filter((p) => ruleMatches(p, record))
    .sort((a, b) => (num(a.priority) ?? 1e9) - (num(b.priority) ?? 1e9))
  if (matched.length) {
    const p = matched[0]
    return { key: str(p.route_key) || 'standard', source: 'rule', profile: p }
  }

  // Fallback classifier. Order is deliberate and documented: a total loss removes
  // the entire repair path, so it is decided before the insurance repair routes;
  // an injury forces the HSE/corrective path; insurance routes split on repair
  // type; a genuinely minor uninsured case takes the light path; else standard.
  let key = 'standard'
  if (isTotalLoss(record)) key = 'total_loss'
  else if (isInjury(record)) key = 'injury'
  else if (insuranceInvolved(record)) {
    key = lower(record?.repair_type) === 'external' ? 'external_repair_insurance' : 'internal_repair_insurance'
  } else if (isMinorSeverity(record)) key = 'minor_no_insurance'
  return { key, source: 'fallback', profile: null }
}

/** Normalise any route shape (key string, CASE_ROUTES def, or buildCaseRoute
 *  result) to a route definition, preferring a config profile's explicit list. */
function resolveRoute(route) {
  if (!route) return CASE_ROUTES.standard
  if (typeof route === 'string') return CASE_ROUTES[route] || CASE_ROUTES.standard
  if (route.profile && Array.isArray(route.profile.required_workstreams)) {
    return { key: str(route.key) || 'config', label: 'Config', profile: route.profile,
      required: route.profile.required_workstreams.slice(), conditional: [] }
  }
  if (Array.isArray(route.required)) return route
  if (route.key && CASE_ROUTES[route.key]) return { ...CASE_ROUTES[route.key], profile: route.profile || null }
  return CASE_ROUTES.standard
}

/**
 * The set of workstreams this case actually requires (§4). Conditionals are
 * resolved against the record. Adding a route is a config row (its
 * `required_workstreams` is used verbatim), never a code change.
 * @returns {Set<string>}
 */
export function requiredWorkstreams(route, record = {}) {
  const def = resolveRoute(route)
  const out = new Set(arr(def.required).filter((k) => WORKSTREAM_BY_KEY[k]))
  for (const c of arr(def.conditional)) {
    if (WORKSTREAM_BY_KEY[c.ws] && typeof c.when === 'function' && c.when(record)) out.add(c.ws)
  }
  return out
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. COMPLETENESS (§4.3) — five percentages, from required workstreams ONLY
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Scoring-grade satisfaction for a REQUIRED workstream. Completed satisfies. A
 * workstream marked not_required / cancelled satisfies only "once a reason is on
 * record" (brief §9) — an NA without a reason envelope does NOT pad the score.
 * (This is a strict superset of workstreamSatisfied, which is the bare token
 * check used by the case-status projection.)
 */
function scored(record, rows, ws) {
  const status = workstreamStatus(record, ws, rows)
  if (status === WORKSTREAM_STATUS.COMPLETED) return true
  if (status === WORKSTREAM_STATUS.NOT_REQUIRED || status === WORKSTREAM_STATUS.CANCELLED) {
    return markedNA(record, rows, ws)
  }
  return false
}

/**
 * The five completeness percentages (§4.3): incident, insurance, repair,
 * financial, overall. Computed from REQUIRED workstreams only. A dimension with
 * no required items in scope returns `null` (N/A) — NEVER 100, which would read
 * as "this team finished" when nothing was ever in scope.
 *
 * Re-derive this from scratch after EVERY transition (never increment): a
 * rejected handover legitimately drops the repair percentage (§4.3, §7).
 *
 * @param {object} record accidents row
 * @param {object[]} wsRows explicit workstream rows (optional)
 * @param {object|string} route a route def, key, or buildCaseRoute result
 * @returns {{ incident:number|null, insurance:number|null, repair:number|null, financial:number|null, overall:number|null }}
 */
export function completeness(record, wsRows, route) {
  const required = requiredWorkstreams(route, record)
  const per = { incident: { req: 0, sat: 0 }, insurance: { req: 0, sat: 0 }, repair: { req: 0, sat: 0 }, financial: { req: 0, sat: 0 } }

  for (const ws of required) {
    const dim = DIMENSION_OF[ws]
    if (!per[dim]) continue
    per[dim].req += 1
    if (scored(record, arr(wsRows), ws)) per[dim].sat += 1
  }

  const pct = (d) => (d.req === 0 ? null : Math.round((100 * d.sat) / d.req))
  const reqTotal = DIMENSIONS.reduce((a, d) => a + per[d].req, 0)
  const satTotal = DIMENSIONS.reduce((a, d) => a + per[d].sat, 0)

  return {
    incident: pct(per.incident),
    insurance: pct(per.insurance),
    repair: pct(per.repair),
    financial: pct(per.financial),
    overall: reqTotal === 0 ? null : Math.round((100 * satTotal) / reqTotal),
  }
}

/**
 * Every required workstream that is not satisfied — the list that names who owes
 * what. Same shape the Overview "closure blockers" panel renders. `reason` is a
 * plain-English description of the blocking state.
 * @returns {Array<{ workstream:string, name:string, dimension:string, status:string, reason:string }>}
 */
export function closureBlockers(record, wsRows, route) {
  const required = requiredWorkstreams(route, record)
  const rows = arr(wsRows)
  const out = []
  for (const ws of PIPELINE_ORDER) {
    if (!required.has(ws)) continue
    if (closureGradeSatisfied(record, rows, ws, route)) continue
    const status = workstreamStatus(record, ws, rows)
    out.push({
      workstream: ws,
      name: WORKSTREAM_BY_KEY[ws]?.name || ws,
      dimension: DIMENSION_OF[ws],
      status,
      reason: `${WORKSTREAM_BY_KEY[ws]?.name || ws} is ${status.replace(/_/g, ' ')}`,
    })
  }
  return out
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. CLOSURE GATE (§5)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Closure-grade satisfaction: completed, OR formally NA (valid envelope, and
 * approved where the route profile demands `na_requires_approval`). Stricter than
 * scoring — this is what the fully-closed gate uses.
 */
function closureGradeSatisfied(record, rows, ws, route) {
  const status = workstreamStatus(record, ws, rows)
  if (status === WORKSTREAM_STATUS.COMPLETED) return true
  if (status === WORKSTREAM_STATUS.NOT_REQUIRED || status === WORKSTREAM_STATUS.CANCELLED) {
    const requireApproval = truthy(resolveRoute(route)?.profile?.na_requires_approval)
    return markedNA(record, rows, ws, { requireApproval })
  }
  return false
}

/** Case is explicitly closed. */
function isClosedCase(record) {
  const st = lower(record?.case_status || record?.status)
  return st === 'closed'
}
function closureReviewApproved(record) {
  return truthy(record?.closure_review_approved) || !!str(record?.closure_approved_by)
}

/**
 * "Operationally completed" = the incident + repair dimensions are done: the
 * vehicle is back in service. Money / claim / corrective may still be open.
 * (§5.1: handover satisfied + workshop QC where repair occurred + repair chain.)
 */
function operationallyComplete(record, wsRows, route) {
  const required = requiredWorkstreams(route, record)
  const rows = arr(wsRows)
  for (const ws of required) {
    const dim = DIMENSION_OF[ws]
    if (dim === 'incident' || dim === 'repair') {
      // corrective is an incident-dimension workstream but is a settlement-phase
      // control, not an operational gate — it may lag operational completion.
      if (ws === 'corrective') continue
      if (!closureGradeSatisfied(record, rows, ws, route)) return false
    }
  }
  return true
}
function financiallyComplete(record, wsRows, route) {
  const required = requiredWorkstreams(route, record)
  const rows = arr(wsRows)
  for (const ws of required) {
    if (DIMENSION_OF[ws] === 'insurance' || DIMENSION_OF[ws] === 'financial') {
      if (!closureGradeSatisfied(record, rows, ws, route)) return false
    }
  }
  return true
}
function correctiveComplete(record, wsRows, route) {
  const required = requiredWorkstreams(route, record)
  if (!required.has('corrective')) return true
  return closureGradeSatisfied(record, arr(wsRows), 'corrective', route)
}

/**
 * Which of the three closure levels a case is at (§5.1), or `null` when the case
 * is still operationally open.
 *
 *   null                      — open: vehicle not yet back in service
 *   'financially_open'        — operationally done, but claim/money/CA outstanding
 *   'operationally_completed' — operationally done, nothing financial outstanding,
 *                               awaiting the closure-review sign-off
 *   'fully_closed'            — everything done and closure review approved
 *
 * @returns {'operationally_completed'|'financially_open'|'fully_closed'|null}
 */
export function closureLevel(record, wsRows, route) {
  if (isClosedCase(record)) return 'fully_closed'
  if (!operationallyComplete(record, wsRows, route)) return null
  const moneyDone = financiallyComplete(record, wsRows, route) && correctiveComplete(record, wsRows, route)
  if (!moneyDone) return 'financially_open'
  return closureReviewApproved(record) ? 'fully_closed' : 'operationally_completed'
}

// ── overdue-task / pending-approval / missing-doc checks (§5.3) ───────────────
function overdueMandatoryTasks(record, now) {
  const ref = new Date(now).getTime()
  return arr(record?.tasks).filter((t) => {
    if (!t || !truthy(t.mandatory)) return false
    if (truthy(t.resolved) || lower(t.status) === 'done' || lower(t.status) === 'resolved') return false
    const due = t.due ? new Date(t.due).getTime() : null
    return due != null && Number.isFinite(due) && due < ref
  })
}
function pendingApprovals(record) {
  const list = arr(record?.pending_approvals)
  if (list.length) return list
  return arr(record?.approvals).filter((a) => a && lower(a.status) === 'pending')
}
function missingRequiredDocuments(record, route) {
  const need = arr(resolveRoute(route)?.profile?.required_documents).map(str).filter(Boolean)
  if (!need.length) return []
  const have = new Set(
    arr(record?.documents).map((d) => str(typeof d === 'string' ? d : (d?.type || d?.key || d?.name))),
  )
  return need.filter((doc) => !have.has(doc))
}

/**
 * The fully-closed boolean AND (brief §8.3). Returns `{ ok, blockers }` where
 * `ok` is the exact conjunction and `blockers` is every clause that failed, each
 * `{ check|workstream, reason }` — the same shape the closure screen renders.
 *
 * This is the JS spec of the server-side `accident_can_close` guard: an API call
 * cannot skip it (brief acceptance criterion §31). Pure — inject `now` for the
 * overdue-task check.
 *
 * @param {object} record accidents row
 * @param {object[]} wsRows explicit workstream rows
 * @param {object|string} route route def / key / buildCaseRoute result
 * @param {{ now?: Date|string|number }} [opts]
 * @returns {{ ok: boolean, blockers: Array<object> }}
 */
export function canFullyClose(record, wsRows, route, { now = Date.now() } = {}) {
  const rows = arr(wsRows)
  const required = requiredWorkstreams(route, record)
  const blockers = []

  // Every required workstream must be complete (or formally NA). This one loop is
  // the "no workstream remains open" clause plus the per-workstream clauses of
  // §8.3 (incident, validation, liability, insurance, assessment, repair,
  // handover, finance, corrective).
  for (const ws of PIPELINE_ORDER) {
    if (!required.has(ws)) continue
    if (closureGradeSatisfied(record, rows, ws, route)) continue
    const status = workstreamStatus(record, ws, rows)
    blockers.push({
      workstream: ws,
      reason: `${WORKSTREAM_BY_KEY[ws]?.name || ws} is not complete (${status.replace(/_/g, ' ')})`,
    })
  }

  // Workshop QC required only where a repair actually occurred (§8.3).
  if (repairOccurred(record) && required.has('workshop_qc') &&
      !closureGradeSatisfied(record, rows, 'workshop_qc', route)) {
    // already captured above if workshop_qc is required; keep the explicit guard
    // for the case where a repair occurred but QC was mistakenly not required.
    if (!required.has('workshop_qc')) {
      blockers.push({ check: 'workshop_qc', reason: 'Workshop quality control required where repair occurred' })
    }
  }

  // Meta gates.
  const overdue = overdueMandatoryTasks(record, now)
  if (overdue.length) blockers.push({ check: 'mandatory_task', reason: `${overdue.length} mandatory task(s) overdue and unresolved` })

  const pending = pendingApprovals(record)
  if (pending.length) blockers.push({ check: 'pending_approval', reason: `${pending.length} approval(s) still pending` })

  const missingDocs = missingRequiredDocuments(record, route)
  if (missingDocs.length) blockers.push({ check: 'required_document', reason: `Missing required document(s): ${missingDocs.join(', ')}` })

  if (!closureReviewApproved(record)) {
    blockers.push({ check: 'closure_review', reason: 'Closure review not approved' })
  }

  return { ok: blockers.length === 0, blockers }
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. CASE-STATUS OVERLAY + TRANSITION MACHINE (§1, §3)
// ═════════════════════════════════════════════════════════════════════════════

/** The 30 case statuses (§1.1): token, label, parent workflow_stage, owning team,
 *  kind. `stage` mirrors the SQL accident_case_status_stage. */
export const CASE_STATUSES = Object.freeze([
  { token: 'draft', label: 'Draft', stage: 'reported', team: 'Fleet', kind: 'linear' },
  { token: 'submitted', label: 'Submitted', stage: 'reported', team: 'Fleet', kind: 'linear' },
  { token: 'evidence_incomplete', label: 'Evidence incomplete', stage: 'reported', team: 'Fleet', kind: 'return' },
  { token: 'under_fleet_validation', label: 'Under Fleet validation', stage: 'initial_review', team: 'Fleet Supervisor', kind: 'linear' },
  { token: 'liability_assessment', label: 'Liability assessment', stage: 'hse_investigation', team: 'HSE / Fleet Mgr', kind: 'linear' },
  { token: 'insurance_review', label: 'Insurance review', stage: 'insurance_claim', team: 'Insurance', kind: 'linear' },
  { token: 'claim_registration_pending', label: 'Claim registration pending', stage: 'insurance_claim', team: 'Insurance', kind: 'linear' },
  { token: 'awaiting_insurer_response', label: 'Awaiting insurer response', stage: 'insurance_claim', team: 'Insurance', kind: 'wait-external' },
  { token: 'technical_assessment', label: 'Technical assessment', stage: 'workshop_assessment', team: 'Workshop', kind: 'linear' },
  { token: 'repair_decision_pending', label: 'Repair decision pending', stage: 'repair_approval', team: 'Fleet / Insurance', kind: 'linear' },
  { token: 'repair_planning', label: 'Repair planning', stage: 'repair_approval', team: 'Workshop Planner', kind: 'linear' },
  { token: 'awaiting_fleet_approval', label: 'Awaiting Fleet approval', stage: 'repair_approval', team: 'Fleet', kind: 'wait-approval' },
  { token: 'awaiting_parts', label: 'Awaiting parts', stage: 'repair_approval', team: 'Store / Procurement', kind: 'wait-external' },
  { token: 'awaiting_quotation', label: 'Awaiting quotation', stage: 'repair_approval', team: 'Procurement', kind: 'wait-external' },
  { token: 'awaiting_po', label: 'Awaiting PO', stage: 'repair_approval', team: 'Procurement / Finance', kind: 'wait-external' },
  { token: 'awaiting_external_workshop', label: 'Awaiting external workshop', stage: 'repair_approval', team: 'Workshop coord.', kind: 'wait-external' },
  { token: 'repair_in_progress', label: 'Repair in progress', stage: 'repair_in_progress', team: 'Workshop / Vendor', kind: 'linear' },
  { token: 'workshop_quality_inspection', label: 'Workshop quality inspection', stage: 'repair_in_progress', team: 'Workshop QC', kind: 'linear' },
  { token: 'fleet_inspection', label: 'Fleet inspection', stage: 'final_inspection', team: 'Fleet Inspector', kind: 'linear' },
  { token: 'rectification_required', label: 'Rectification required', stage: 'final_inspection', team: 'Workshop', kind: 'return' },
  { token: 'operationally_completed', label: 'Operationally completed', stage: 'vehicle_release', team: 'Fleet Ops', kind: 'milestone' },
  { token: 'insurance_settlement_pending', label: 'Insurance settlement pending', stage: 'cost_recovery', team: 'Insurance / Finance', kind: 'linear' },
  { token: 'financial_closure_pending', label: 'Financial closure pending', stage: 'cost_recovery', team: 'Finance', kind: 'linear' },
  { token: 'corrective_actions_pending', label: 'Corrective actions pending', stage: 'cost_recovery', team: 'HSE', kind: 'linear' },
  { token: 'closure_review', label: 'Closure review', stage: 'closed', team: 'Fleet Manager', kind: 'gate' },
  { token: 'closed', label: 'Closed', stage: 'closed', team: 'Fleet Manager', kind: 'terminal' },
  { token: 'reopened', label: 'Reopened', stage: null, team: 'Fleet Manager', kind: 'cross-cutting' },
  { token: 'cancelled_duplicate', label: 'Cancelled as duplicate', stage: 'cancelled', team: 'Any authorised', kind: 'terminal' },
  { token: 'total_loss_processing', label: 'Total loss processing', stage: 'insurance_claim', team: 'Insurance / Fleet Mgr', kind: 'cross-cutting' },
  { token: 'legal_hold', label: 'Legal hold', stage: null, team: 'Legal', kind: 'cross-cutting' },
])

export const CASE_STATUS_TOKENS = CASE_STATUSES.map((c) => c.token)
const CASE_STATUS_BY_TOKEN = Object.fromEntries(CASE_STATUSES.map((c) => [c.token, c]))
/** case_status token -> parent workflow_stage (§1.1). Mirrors SQL
 *  accident_case_status_stage. `legal_hold`/`reopened` keep the previous stage
 *  (null = do not move the stage). */
export const CASE_STATUS_STAGE = Object.freeze(
  Object.fromEntries(CASE_STATUSES.map((c) => [c.token, c.stage])),
)
export function caseStatusStage(token) { return CASE_STATUS_STAGE[str(token)] ?? null }
export function caseStatusLabel(token) { return CASE_STATUS_BY_TOKEN[str(token)]?.label || str(token) }
export const TERMINAL_STATUSES = new Set(['closed', 'cancelled_duplicate'])

// ── transition machine (§1.2) ─────────────────────────────────────────────────
// Each tuple: [from, to, action, cap, guard]. Universal transitions (cancel /
// legal-hold from any non-terminal state) are appended in allowedTransitions.
const TRANSITION_ROWS = [
  ['draft', 'submitted', 'Reporter submits', 'submit', 'incident min-fields + mandatory photos complete'],
  ['draft', 'draft', 'Autosave', 'create', ''],
  ['submitted', 'evidence_incomplete', 'Validation finds gaps', 'validate', 'any required evidence missing'],
  ['submitted', 'under_fleet_validation', 'Supervisor opens for validation', 'validate', ''],
  ['evidence_incomplete', 'submitted', 'Reporter re-submits fixed evidence', 'submit', 'missing items now filled'],
  ['under_fleet_validation', 'evidence_incomplete', 'Supervisor rejects to reporter', 'validate', 'reason recorded'],
  ['under_fleet_validation', 'liability_assessment', 'Validation accepted', 'validate', 'asset/driver/report/photos confirmed'],
  ['liability_assessment', 'insurance_review', 'Liability approved (insurance route)', 'approve_liability', 'liability complete; insurance applies'],
  ['liability_assessment', 'technical_assessment', 'Liability approved, no insurance', 'approve_liability', 'insurance_involved = false'],
  ['insurance_review', 'claim_registration_pending', 'Coverage confirmed, claim required', 'edit_insurance', 'policy valid on incident date'],
  ['insurance_review', 'technical_assessment', 'Insurance not applicable', 'edit_insurance', 'NA reason + approval'],
  ['claim_registration_pending', 'awaiting_insurer_response', 'Claim registered', 'edit_insurance', 'claim no. + registration date present'],
  ['awaiting_insurer_response', 'technical_assessment', 'Insurer decision recorded', 'edit_insurance', ''],
  ['awaiting_insurer_response', 'awaiting_insurer_response', 'Insurer requests documents (loop)', 'edit_insurance', 'missing-doc task created'],
  ['technical_assessment', 'repair_decision_pending', 'Assessment approved', 'assess', 'damage + estimate recorded'],
  ['technical_assessment', 'total_loss_processing', 'Assessment flags total loss', 'assess', 'total-loss possibility set'],
  ['repair_decision_pending', 'repair_planning', 'Repair route selected', 'approve_repair', 'route recorded; SoD'],
  ['repair_decision_pending', 'operationally_completed', 'No-repair decision', 'approve_repair', 'route = none/temporary + reason'],
  ['repair_planning', 'awaiting_fleet_approval', 'Plan submitted to Fleet', 'approve_repair', 'plan + dates + off-road present'],
  ['awaiting_fleet_approval', 'awaiting_parts', 'Fleet accepts; parts needed', 'approve_repair', 'parts request raised'],
  ['awaiting_fleet_approval', 'awaiting_quotation', 'Fleet accepts; external quote needed', 'approve_repair', ''],
  ['awaiting_fleet_approval', 'repair_in_progress', 'Fleet accepts; parts on hand', 'approve_repair', ''],
  ['awaiting_quotation', 'awaiting_po', 'Quotation received & compared', 'request_parts', 'quote attached'],
  ['awaiting_po', 'awaiting_external_workshop', 'PO issued to external workshop', 'request_parts', 'PO ref recorded'],
  ['awaiting_parts', 'repair_in_progress', 'Parts issued', 'request_parts', 'parts request fulfilled'],
  ['awaiting_external_workshop', 'repair_in_progress', 'External workshop starts', 'execute_repair', ''],
  ['repair_in_progress', 'workshop_quality_inspection', 'Workshop marks repair complete', 'execute_repair', 'repair tasks done'],
  ['workshop_quality_inspection', 'fleet_inspection', 'Workshop QC passed', 'qc_repair', 'QC checklist pass'],
  ['workshop_quality_inspection', 'repair_in_progress', 'QC failed', 'qc_repair', 'reason recorded'],
  ['fleet_inspection', 'operationally_completed', 'Fleet accepts vehicle', 'accept_handover', 'handover accepted; downtime recorded'],
  ['fleet_inspection', 'rectification_required', 'Fleet rejects handover', 'accept_handover', 'remarks + rectification task'],
  ['rectification_required', 'repair_in_progress', 'Rectification task opened', 'execute_repair', ''],
  ['operationally_completed', 'insurance_settlement_pending', 'Vehicle in service, claim open', 'auto', 'insurance route not complete'],
  ['operationally_completed', 'financial_closure_pending', 'No claim, costs to clear', 'auto', 'finance not complete'],
  ['operationally_completed', 'closure_review', 'All required workstreams complete', 'auto', 'closure gate passes'],
  ['insurance_settlement_pending', 'financial_closure_pending', 'Settlement recorded', 'edit_insurance', 'settlement/recovery posted'],
  ['financial_closure_pending', 'corrective_actions_pending', 'Finance confirms closure', 'post_cost', 'financial complete'],
  ['corrective_actions_pending', 'closure_review', 'Corrective actions closed', 'approve_liability', 'CAs complete'],
  ['closure_review', 'closed', 'Manager fully closes', 'close_case', 'closure gate true; SoD'],
  ['closed', 'reopened', 'Manager reopens', 'reopen_case', 'reason + new owner + due date'],
  ['reopened', 'technical_assessment', 'Reopen assigns to workstream', 'reopen_case', ''],
  ['legal_hold', 'closure_review', 'Hold released', 'legal_hold', ''],
]

/** Map<fromToken, Array<{ to, action, cap, guard }>> built from the table (§1.2). */
export const TRANSITIONS = (() => {
  const m = new Map()
  for (const [from, to, action, cap, guard] of TRANSITION_ROWS) {
    if (!m.has(from)) m.set(from, [])
    m.get(from).push({ to, action, cap, guard })
  }
  return m
})()

/** Transitions leaving a status, including the universal cancel / legal-hold
 *  branches reachable from any non-terminal state (§1.2). */
export function allowedTransitions(fromStatus) {
  const from = str(fromStatus)
  const base = (TRANSITIONS.get(from) || []).slice()
  if (!TERMINAL_STATUSES.has(from)) {
    if (from !== 'cancelled_duplicate') base.push({ to: 'cancelled_duplicate', action: 'Marked duplicate', cap: 'cancel_case', guard: 'primary case linked; never a hard delete' })
    if (from !== 'legal_hold') base.push({ to: 'legal_hold', action: 'Legal hold applied', cap: 'legal_hold', guard: 'reason recorded; SLA timers pause' })
  }
  return base
}
export function canTransition(fromStatus, toStatus) {
  return allowedTransitions(fromStatus).some((t) => t.to === str(toStatus))
}
export function transitionSpec(fromStatus, toStatus) {
  return allowedTransitions(fromStatus).find((t) => t.to === str(toStatus)) || null
}

// ── case-status projection (§3) ───────────────────────────────────────────────
// A blocking workstream state -> the fine case_status that describes it.
const CASE_STATUS_FOR = {
  fleet_validation: { default: 'under_fleet_validation' },
  liability: { default: 'liability_assessment' },
  insurance: { in_progress: 'insurance_review', waiting_approval: 'claim_registration_pending', waiting_external: 'awaiting_insurer_response', default: 'insurance_review' },
  assessment: { default: 'technical_assessment' },
  repair: { in_progress: 'repair_in_progress', waiting_approval: 'awaiting_fleet_approval', waiting_external: 'awaiting_external_workshop', waiting_info: 'awaiting_parts', default: 'repair_decision_pending' },
  workshop_qc: { default: 'workshop_quality_inspection' },
  handover: { default: 'fleet_inspection' },
  finance: { default: 'financial_closure_pending' },
  corrective: { default: 'corrective_actions_pending' },
}

/**
 * Derive the headline `case_status` from the workstream states, honouring the
 * route (§3). Never written directly — it is a projection. Mirrors SQL
 * accident_derive_case_status. Picks the earliest unsatisfied required workstream
 * in pipeline order, unless a terminal / hold / branch flag overrides.
 *
 * @param {object} record accidents row (carries the override flags)
 * @param {object[]} wsRows explicit workstream rows
 * @param {object|string} route route def / key / buildCaseRoute result
 * @returns {string} a CASE_STATUS token
 */
export function deriveCaseStatus(record, wsRows, route) {
  const rec = record || {}
  const rows = arr(wsRows)

  // 0. terminal + cross-cutting overrides win.
  if (truthy(rec.legal_hold_active) || truthy(rec.legal_hold)) return 'legal_hold'
  if (truthy(rec.cancelled) || truthy(rec.cancelled_duplicate)) return 'cancelled_duplicate'
  if (truthy(rec.reopened_flag) || truthy(rec.reopened)) return 'reopened'
  if (truthy(rec.total_loss_route) || truthy(rec.total_loss)) return 'total_loss_processing'
  if (isClosedCase(rec)) return 'closed'

  const required = requiredWorkstreams(route, rec)
  const statusOf = (ws) => workstreamStatus(rec, ws, rows)

  // 1. draft / submission gate.
  if (!truthy(rec.submitted)) return truthy(rec.returned) ? 'evidence_incomplete' : 'draft'
  if (required.has('incident_evidence') && !workstreamSatisfied(statusOf('incident_evidence'))) {
    return truthy(rec.returned) ? 'evidence_incomplete' : 'submitted'
  }

  // 2. walk the required pipeline; first unsatisfied workstream sets the headline.
  for (const ws of PIPELINE_ORDER) {
    if (ws === 'incident_evidence' || !required.has(ws)) continue
    const s = statusOf(ws)
    if (workstreamSatisfied(s)) continue
    const map = CASE_STATUS_FOR[ws]
    if (!map) continue
    return map[s] || map.default
  }

  // 3. everything required is satisfied -> settlement / review / closed.
  if (!financiallyComplete(rec, rows, route)) {
    return required.has('insurance') && !closureGradeSatisfied(rec, rows, 'insurance', route)
      ? 'insurance_settlement_pending'
      : 'financial_closure_pending'
  }
  if (!correctiveComplete(rec, rows, route)) return 'corrective_actions_pending'
  if (!closureReviewApproved(rec)) return 'closure_review'
  return 'closed'
}
