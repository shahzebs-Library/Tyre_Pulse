/**
 * Supabase boundary for the accident CASE + WORKSTREAM model (V417).
 *
 * An accident is ONE case that flows through Fleet, Safety, Insurance, Workshop,
 * Store, Procurement, Finance and external workshops, and closes through ONE
 * controlled gate. The relational spine for that (accidents case columns +
 * accident_case_workstreams + accident_case_tasks + accident_case_approvals +
 * accident_closure_reviews + accident_route_profiles) is V417. This module reads
 * and writes it, and NOTHING here re-implements the case logic: the maths live in
 * the committed pure engine src/lib/accidentCase.js (completeness / canFullyClose /
 * requiredWorkstreams / buildCaseRoute). This layer only fetches, assembles and
 * persists.
 *
 * SHIP-BEFORE-MIGRATE. V417 is a review artifact, not yet applied. Every read here
 * degrades to an empty / partial result via the shared isMissingRelation helper -
 * a missing case table or case column is a "not provisioned yet" state, not an
 * error - so the case screen can render from the plain accidents row alone and the
 * module ships before the migration lands. loadCase reports this with
 * `capabilities.casesModel`.
 *
 * Conventions copied verbatim from accidents.js / accidentStages.js: explicit
 * column lists (no SELECT *), unwrap() at every write, null-safe country scoping
 * via applyCountry, and org/role/country/site isolation enforced server-side by
 * RLS (not by this layer).
 */
import { supabase, unwrap, applyCountry, isMissingRelation } from './_client'
import { getAccident } from './accidents'
import {
  completeness,
  canFullyClose,
  WORKSTREAM_KEYS,
  WORKSTREAM_STATUS_TOKENS,
} from '../accidentCase'

// ── column lists (explicit; least-privilege) ──────────────────────────────────

// The accidents row the engine needs: the base incident fields PLUS the V300/V399
// structured fields (workflow_stage, repair_type, stage_waivers, documents, ...)
// and the V417 case columns. Read as one query post-migration; on a missing case
// column pre-V417 it degrades to the base accidents read (getAccident) below.
const CASE_RECORD_COLS =
  'id,asset_no,site,country,incident_date,severity,status,accident_type,claim_amount,' +
  'claim_status,recovered_amount,recovery_status,repair_cost,estimated_damage_cost,' +
  'driver_name,location,created_at,workflow_stage,closure_status,repair_type,' +
  'approved_repair_amount,insurer,policy_no,injuries,injury_count,third_party_involved,' +
  'stage_waivers,documents,case_no,case_status,route_key,closure_level,' +
  'completion_incident,completion_insurance,completion_repair,completion_financial,' +
  'completion_overall,legal_hold,reopened_flag,total_loss_route'

const WS_COLS =
  'id,accident_id,country,site,workstream_key,status,required,owner_id,owner_role,team,' +
  'progress_pct,assigned_at,started_at,completed_at,not_applicable,na_reason,na_by,na_at,' +
  'notes,created_at,updated_at'

const TASK_COLS =
  'id,accident_id,country,site,workstream_key,title,description,assignee_id,assignee_role,' +
  'team,priority,due_at,status,completed_at,created_at'

const APPROVAL_COLS =
  'id,accident_id,country,site,approval_type,workstream_key,amount,requested_by,' +
  'requested_at,decided_by,decided_at,decision,reason,reference,created_at'

const REVIEW_COLS =
  'id,accident_id,country,site,level,reviewer_id,reviewed_at,decision,blockers,remarks,created_at'

const ROUTE_PROFILE_COLS =
  'id,route_key,name,description,match_types,required_workstreams,required_evidence,' +
  'required_documents,closure_requirements,is_default,active'

/** The three closure levels a review can carry (accident_closure_reviews.level
 *  CHECK / accidentCase.closureLevel tokens). */
const CLOSURE_LEVELS = new Set(['operationally_completed', 'financially_open', 'fully_closed'])

const lower = (v) => String(v ?? '').trim().toLowerCase()

/** Run a read that may hit an unprovisioned V417 relation; on a missing relation
 *  return the given empty value instead of throwing (ship-before-migrate). */
async function readOrEmpty(fn, empty) {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    if (isMissingRelation(err)) return { ok: false, data: empty }
    throw err
  }
}

// ── workstream hydration ──────────────────────────────────────────────────────

/**
 * Adapt a stored workstream row into the shape the pure engine reads. The engine
 * (naEnvelopeFor) expects an `na` envelope object { reason, by, at }; the table
 * stores those as separate columns, so fold them back into one envelope when the
 * row is marked NA. Everything else is passed through untouched.
 */
function hydrateWorkstream(row) {
  if (!row) return row
  if (row.not_applicable && (row.na_reason || row.na_by || row.na_at)) {
    return { ...row, na: { reason: row.na_reason, by: row.na_by, at: row.na_at } }
  }
  return row
}

// ═════════════════════════════════════════════════════════════════════════════
// READS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Workstream rows for one case. Country-scoped (null-safe) and degrades to [] when
 * the V417 table is not provisioned. Each row is hydrated for the engine.
 */
export async function listWorkstreams(caseId, { country } = {}) {
  if (!caseId) return []
  const { data } = await readOrEmpty(async () => {
    let q = supabase
      .from('accident_case_workstreams')
      .select(WS_COLS)
      .eq('accident_id', caseId)
      .order('created_at', { ascending: true })
    q = applyCountry(q, country)
    return unwrap(await q) || []
  }, [])
  return (data || []).map(hydrateWorkstream)
}

/** Open case tasks for the closure/inbox gates. `due`/`resolved` are mapped to the
 *  shape the engine's overdue-task check reads. */
async function listOpenTasks(caseId, country) {
  const { data } = await readOrEmpty(async () => {
    let q = supabase
      .from('accident_case_tasks')
      .select(TASK_COLS)
      .eq('accident_id', caseId)
      .not('status', 'in', '("completed","cancelled")')
      .order('due_at', { ascending: true })
      .limit(500)
    q = applyCountry(q, country)
    return unwrap(await q) || []
  }, [])
  return (data || []).map((t) => ({
    ...t,
    due: t.due_at,
    resolved: t.status === 'completed' || t.status === 'cancelled',
  }))
}

/** Pending case approvals. `status` is mapped from `decision` so the engine's
 *  pending-approval gate (which reads `.status === 'pending'`) matches. */
async function listPendingApprovals(caseId, country) {
  const { data } = await readOrEmpty(async () => {
    let q = supabase
      .from('accident_case_approvals')
      .select(APPROVAL_COLS)
      .eq('accident_id', caseId)
      .eq('decision', 'pending')
      .order('created_at', { ascending: true })
      .limit(200)
    q = applyCountry(q, country)
    return unwrap(await q) || []
  }, [])
  return (data || []).map((a) => ({ ...a, status: a.decision }))
}

/** Closure-review rows for one case, newest first. Degrades to []. */
export async function listClosureReviews(caseId, { country } = {}) {
  if (!caseId) return []
  const { data } = await readOrEmpty(async () => {
    let q = supabase
      .from('accident_closure_reviews')
      .select(REVIEW_COLS)
      .eq('accident_id', caseId)
      .order('created_at', { ascending: false })
      .limit(50)
    q = applyCountry(q, country)
    return unwrap(await q) || []
  }, [])
  return data || []
}

/**
 * Load ONE case as a single object the pure engine can consume: the accident row
 * (base incident fields + V300 structured fields + V417 case columns) with its
 * workstreams, open tasks, pending approvals and closure reviews attached.
 *
 * SHIP-BEFORE-MIGRATE. When the V417 case tables/columns are absent the object is
 * still returned - the accident row from the existing accidents read, empty
 * workstream/task/approval arrays, and `capabilities.casesModel === false` so the
 * screen knows to render the pre-case view rather than treating it as a failure.
 * NEVER throws for a missing relation.
 *
 * @param {string} id accidents.id
 * @param {{ country?: string }} [opts]
 * @returns {Promise<object|null>} the assembled case, or null if the incident does not exist
 */
export async function loadCase(id, { country } = {}) {
  if (!id) return null

  // The case record: try the rich read (case columns included); on a missing V417
  // column fall back to the existing base accidents read. Either way we get the
  // incident, and casesModel records whether the case columns were available.
  let record = null
  let recordHasCaseCols = true
  try {
    record = unwrap(
      await supabase.from('accidents').select(CASE_RECORD_COLS).eq('id', id).maybeSingle(),
    )
  } catch (err) {
    if (!isMissingRelation(err)) throw err
    recordHasCaseCols = false
    record = await getAccident(id) // reuse the existing accidents read (base cols)
  }
  if (!record) return null

  const [workstreams, tasks, approvals, closureReviews] = await Promise.all([
    listWorkstreams(id, { country }),
    listOpenTasks(id, country),
    listPendingApprovals(id, country),
    listClosureReviews(id, { country }),
  ])

  // The workstream table is the spine of the case model. If it is not provisioned,
  // the case model is unavailable regardless of which accident columns exist.
  const wsProvisioned = await workstreamTableProvisioned(id)
  const casesModel = recordHasCaseCols && wsProvisioned

  // Derive the closure-review approval the engine reads (there is no boolean column
  // for it - it lives in an approved fully_closed review row).
  const closureApproved = closureReviews.some(
    (r) => lower(r.level) === 'fully_closed' && lower(r.decision) === 'approved',
  )

  return {
    ...record,
    workstreams,
    tasks,
    approvals,
    pending_approvals: approvals,
    closureReviews,
    closure_review_approved: record.closure_review_approved ?? closureApproved,
    capabilities: { casesModel },
  }
}

/** Cheap existence probe for the workstream table so casesModel is honest even
 *  when the accidents row happens to carry the case columns. */
async function workstreamTableProvisioned(caseId) {
  const { ok } = await readOrEmpty(async () => {
    return unwrap(
      await supabase.from('accident_case_workstreams').select('id').eq('accident_id', caseId).limit(1),
    )
  }, null)
  return ok
}

/**
 * Route/type configuration profiles for the route matrix (§8). Best-effort:
 * returns [] when the config table is not provisioned yet.
 */
export async function listRoutableProfiles() {
  const { data } = await readOrEmpty(async () => {
    return unwrap(
      await supabase
        .from('accident_route_profiles')
        .select(ROUTE_PROFILE_COLS)
        .eq('active', true)
        .order('route_key'),
    ) || []
  }, [])
  return data || []
}

// ═════════════════════════════════════════════════════════════════════════════
// ENGINE DELEGATION (client-side, no I/O)
// ═════════════════════════════════════════════════════════════════════════════

/** The route a case object carries: an explicit route def if present, else the
 *  stored route_key string (the engine resolves either). */
function routeOf(caseObj) {
  return caseObj?.route ?? caseObj?.route_key ?? null
}

/**
 * The five completeness percentages for a loaded case. Pure delegation to the
 * engine `completeness()` - the maths are NOT recomputed here.
 * @param {object} caseObj a loadCase() result
 */
export function caseCompletion(caseObj) {
  if (!caseObj) return completeness({}, [], null)
  return completeness(caseObj, caseObj.workstreams || [], routeOf(caseObj))
}

/**
 * Whether a loaded case may be fully closed, with the failing clauses. Pure
 * delegation to the engine `canFullyClose()` (the JS spec of the server guard).
 * @param {object} caseObj a loadCase() result
 * @param {{ now?: Date|string|number }} [opts]
 */
export function canClose(caseObj, { now } = {}) {
  if (!caseObj) return { ok: false, blockers: [{ check: 'case', reason: 'No case loaded' }] }
  return canFullyClose(caseObj, caseObj.workstreams || [], routeOf(caseObj), now != null ? { now } : {})
}

// ═════════════════════════════════════════════════════════════════════════════
// WRITES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Set the status (and optional fields) of one workstream on a case. Upserts the
 * (accident_id, workstream_key) row.
 *
 * VALIDATION IS THE POINT: the key must be one of the ten engine workstreams and
 * the status (when supplied) must be one of the engine's status tokens, so a typo
 * can never land a row the completeness/closure engine cannot read. RLS + the
 * per-capability write policy (V417 PART E) enforce WHO may write server-side.
 *
 * @param {string} caseId accidents.id
 * @param {string} workstreamKey one of WORKSTREAM_KEYS
 * @param {object} [patch] { status, required, owner_id, owner_role, team, progress_pct, notes, ... }
 * @returns {Promise<object>} the upserted workstream row (hydrated)
 */
export async function setWorkstreamStatus(caseId, workstreamKey, patch = {}) {
  if (!caseId) throw new Error('An incident is required.')
  if (!WORKSTREAM_KEYS.includes(workstreamKey)) {
    throw new Error(`Unknown workstream "${workstreamKey}".`)
  }
  if (patch.status != null && !WORKSTREAM_STATUS_TOKENS.includes(patch.status)) {
    throw new Error(`Invalid workstream status "${patch.status}".`)
  }
  const row = { accident_id: caseId, workstream_key: workstreamKey, ...patch }
  const saved = unwrap(
    await supabase
      .from('accident_case_workstreams')
      .upsert(row, { onConflict: 'accident_id,workstream_key' })
      .select(WS_COLS)
      .single(),
  )
  return hydrateWorkstream(saved)
}

/**
 * Mark a workstream Not Applicable with the reason envelope closure requires
 * (WHO / WHEN / WHY - a bare switch-off does not satisfy the gate, brief §8.3).
 * Writes status not_required + the na_* columns.
 *
 * @param {string} caseId
 * @param {string} key one of WORKSTREAM_KEYS
 * @param {{ reason:string, by?:string, at?:string }} envelope
 */
export async function markWorkstreamNA(caseId, key, { reason, by, at } = {}) {
  if (!reason || !String(reason).trim()) {
    throw new Error('A reason is required to mark a workstream not applicable.')
  }
  return setWorkstreamStatus(caseId, key, {
    status: 'not_required',
    required: false,
    not_applicable: true,
    na_reason: reason,
    na_by: by ?? null,
    na_at: at ?? new Date().toISOString(),
  })
}

/**
 * Submit a case for closure review at a level. Records a closure-review row so the
 * manager sign-off is on the ledger. The engine `canClose()` still governs whether
 * a fully_closed review may be approved - this only records the request.
 *
 * @param {string} caseId
 * @param {string} level one of operationally_completed | financially_open | fully_closed
 * @param {object} [extra] { reviewer_id, remarks, blockers, decision }
 */
export async function requestClosure(caseId, level, extra = {}) {
  if (!caseId) throw new Error('An incident is required.')
  if (!CLOSURE_LEVELS.has(level)) throw new Error(`Invalid closure level "${level}".`)
  const row = { accident_id: caseId, level, decision: 'returned', ...extra }
  return unwrap(
    await supabase.from('accident_closure_reviews').insert(row).select(REVIEW_COLS).single(),
  )
}

/**
 * Record a manager's closure-review decision at a level. Distinct from
 * requestClosure only in that a decision is explicit and required.
 *
 * @param {string} caseId
 * @param {{ level:string, decision?:string, reviewerId?:string, blockers?:any[], remarks?:string }} values
 */
export async function recordClosureReview(caseId, { level, decision = 'approved', reviewerId, blockers, remarks } = {}) {
  if (!caseId) throw new Error('An incident is required.')
  if (!CLOSURE_LEVELS.has(level)) throw new Error(`Invalid closure level "${level}".`)
  if (!['approved', 'rejected', 'returned'].includes(decision)) {
    throw new Error(`Invalid closure decision "${decision}".`)
  }
  const row = {
    accident_id: caseId,
    level,
    decision,
    reviewer_id: reviewerId ?? null,
    reviewed_at: new Date().toISOString(),
    blockers: Array.isArray(blockers) ? blockers : [],
    remarks: remarks ?? null,
  }
  return unwrap(
    await supabase.from('accident_closure_reviews').insert(row).select(REVIEW_COLS).single(),
  )
}
