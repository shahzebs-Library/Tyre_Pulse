/**
 * Workflows service - the V95 approval-workflow engine boundary:
 * `workflow_definitions` (admin-configured chains; direct RLS-guarded CRUD),
 * `workflow_instances` + `workflow_step_events` (durable runs / audit trail;
 * read-only), and the SECURITY DEFINER RPCs that perform every state change
 * (start_workflow, workflow_act, workflow_cancel, my_pending_approvals).
 * Explicit column lists (no SELECT *), unwrap error surfacing, mirrors
 * alertThresholds.js.
 */
import { supabase, unwrap } from './_client'
import { isActiveDelegation } from '../approvalDelegations'

// Definition columns for the admin builder (list + edit form).
// Omits created_by (write-time scoping only).
const DEFINITION_COLS =
  'id,organisation_id,name,description,entity_type,trigger_event,steps,active,created_at,updated_at'

// Instance columns for the approvals inbox / instance list + detail.
// steps is the immutable snapshot taken at start. Omits organisation_id /
// source_event_id (RLS-scoped / internal linkage).
const INSTANCE_COLS =
  'id,definition_id,definition_name,entity_type,entity_id,entity_label,steps,current_step,step_started_at,status,context,started_by,started_at,completed_at'

// Append-only audit trail columns for the instance timeline. Includes the
// V116 capture columns (signature_data / printed_name / photo_urls / gps /
// device_info) so the trail can render the full signature block.
const STEP_EVENT_COLS =
  'id,instance_id,step_index,step_name,action,actor_id,comment,signature_data,printed_name,photo_urls,gps,device_info,created_at'

/**
 * List workflow definitions for the current organisation, newest first.
 * @returns {Promise<Array<object>>}
 */
export async function listWorkflowDefinitions() {
  return unwrap(
    await supabase
      .from('workflow_definitions')
      .select(DEFINITION_COLS)
      .order('created_at', { ascending: false })
  )
}

/**
 * Create a workflow definition; returns the inserted row. `steps` must be
 * [{name, approver_role: 'admin'|'manager'|'director', sla_hours?}] (1-10
 * steps - enforced server-side by validate_workflow_steps).
 * @param {{name:string, description?:string, entity_type:string,
 *   trigger_event?:string|null, steps:Array<object>, active?:boolean}} values
 */
export async function createWorkflowDefinition(values) {
  return unwrap(
    await supabase.from('workflow_definitions').insert(values).select(DEFINITION_COLS).single()
  )
}

/**
 * Update a workflow definition by id. In-flight instances are unaffected -
 * they run on their steps snapshot.
 * @param {string} id
 * @param {object} patch
 */
export async function updateWorkflowDefinition(id, patch) {
  return unwrap(await supabase.from('workflow_definitions').update(patch).eq('id', id))
}

/**
 * Delete a workflow definition by id (instances keep their snapshot;
 * definition_id becomes NULL via ON DELETE SET NULL).
 * @param {string} id
 */
export async function deleteWorkflowDefinition(id) {
  return unwrap(await supabase.from('workflow_definitions').delete().eq('id', id))
}

/**
 * One page of workflow instances (exact count), most recently started first,
 * optionally filtered by status.
 * @param {object} [opts]
 * @param {string|null} [opts.status] 'pending'|'approved'|'rejected'|'cancelled'
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {Promise<{rows: Array<object>, count: number}>}
 */
export async function listWorkflowInstances({ status = null, limit = 50, offset = 0 } = {}) {
  let q = supabase
    .from('workflow_instances')
    .select(INSTANCE_COLS, { count: 'exact' })
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) q = q.eq('status', status)

  const result = await q
  const rows = unwrap(result) ?? []
  return { rows, count: result.count ?? 0 }
}

/**
 * Chronological audit trail (started/approved/rejected/escalated/cancelled)
 * for one workflow instance.
 * @param {string} instanceId
 */
export async function listStepEvents(instanceId) {
  return unwrap(
    await supabase
      .from('workflow_step_events')
      .select(STEP_EVENT_COLS)
      .eq('instance_id', instanceId)
      .order('created_at', { ascending: true })
  )
}

/**
 * Latest workflow instance attached to a specific business entity, or null.
 * Used by module pages (via useEntityWorkflow) to show the approval state of
 * the document the user is looking at.
 * @param {string} entityType
 * @param {string|number} entityId
 * @returns {Promise<object|null>}
 */
export async function getWorkflowForEntity(entityType, entityId) {
  if (!entityType || entityId == null) return null
  const rows = unwrap(
    await supabase
      .from('workflow_instances')
      .select(INSTANCE_COLS)
      .eq('entity_type', entityType)
      .eq('entity_id', String(entityId))
      .order('started_at', { ascending: false })
      .limit(1)
  )
  return rows?.[0] ?? null
}

/**
 * Active workflow definitions for one entity type (for the "start approval"
 * picker on a module page). Filters the org's definitions to active ones whose
 * entity_type matches.
 * @param {string} entityType
 * @returns {Promise<Array<object>>}
 */
export async function listDefinitionsForEntity(entityType) {
  const all = await listWorkflowDefinitions()
  return (all ?? []).filter((d) => d.active && d.entity_type === entityType)
}

/**
 * Approvals inbox: pending instances currently waiting on MY role (admins see
 * every pending run in the organisation). Server-evaluated RPC.
 * @returns {Promise<Array<object>>} workflow_instances rows
 */
export async function myPendingApprovals() {
  return unwrap(await supabase.rpc('my_pending_approvals'))
}

/**
 * Delegate inbox (enterprise plan §6 — acting approver): pending instances the
 * current user may act on BECAUSE an active delegation names them as the
 * delegate of an approver. Returned SEPARATELY from `myPendingApprovals` (that
 * RPC is an opaque server evaluation — a safe in-query union isn't possible), so
 * this is strictly additive: the original inbox is untouched and callers opt in.
 *
 * Fully defensive: any failure (table `approval_delegations` not provisioned,
 * RLS blocking a non-admin from reading org-wide pending instances, an auth gap)
 * degrades to an empty array — never to a thrown error — so existing behaviour
 * is preserved wherever this is called.
 *
 * Matching model: the V95 engine gates each step by `approver_role`, while a
 * delegation is user→user. So a delegated instance is one whose current step's
 * `approver_role` equals the ROLE of a delegator who has actively delegated to
 * me, honouring the delegation's optional `entity_type` scope (null = all types).
 * Each returned row carries `viaDelegation: true` and the acting-for context.
 *
 * @returns {Promise<Array<object>>} pending workflow_instances rows, each tagged
 *   `{ viaDelegation:true, delegatedFrom:<delegator_id> }`
 */
export async function myDelegatedApprovals() {
  try {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) return []

    // Active delegations naming me as the delegate.
    const delegations =
      unwrap(
        await supabase
          .from('approval_delegations')
          .select('id,delegator_id,delegate_id,entity_type,active,starts_at,ends_at')
          .eq('delegate_id', uid),
      ) || []
    const nowMs = Date.now()
    const active = delegations.filter((d) => isActiveDelegation(d, nowMs))
    if (!active.length) return []

    // Roles of the delegators — role-based steps are matched by approver_role.
    const delegatorIds = [...new Set(active.map((d) => d.delegator_id).filter(Boolean))]
    if (!delegatorIds.length) return []
    const profiles =
      unwrap(await supabase.from('profiles').select('id,role').in('id', delegatorIds)) || []
    const roleById = new Map(
      profiles.map((p) => [p.id, String(p.role || '').toLowerCase()]),
    )

    // Pending instances in the org (RLS-scoped). Match each to a delegation whose
    // delegator holds the approver_role of the instance's current step, within
    // the delegation's entity_type scope.
    const pending =
      unwrap(
        await supabase
          .from('workflow_instances')
          .select(INSTANCE_COLS)
          .eq('status', 'pending')
          .order('started_at', { ascending: false })
          .limit(200),
      ) || []

    const out = []
    for (const inst of pending) {
      const steps = Array.isArray(inst.steps) ? inst.steps : []
      const idx = Math.min(
        Math.max(inst.current_step ?? 0, 0),
        Math.max(steps.length - 1, 0),
      )
      const stepRole = String(steps[idx]?.approver_role || '').toLowerCase()
      if (!stepRole) continue
      const match = active.find((d) => {
        if (d.entity_type && d.entity_type !== inst.entity_type) return false
        return roleById.get(d.delegator_id) === stepRole
      })
      if (match) out.push({ ...inst, viaDelegation: true, delegatedFrom: match.delegator_id })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Start a workflow run from a definition. Idempotent server-side: one pending
 * run per (definition, entity).
 * @param {{definitionId:string, entityType:string, entityId?:string|null,
 *   entityLabel?:string|null, context?:object}} opts
 * @returns {Promise<string>} the instance uuid
 */
export async function startWorkflow({
  definitionId,
  entityType,
  entityId = null,
  entityLabel = null,
  context = {},
} = {}) {
  return unwrap(
    await supabase.rpc('start_workflow', {
      p_definition_id: definitionId,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_entity_label: entityLabel,
      p_context: context,
    })
  )
}

/**
 * Act on the current step of an open instance (pending / in_review / returned).
 * All authorisation, per-step requirement enforcement (signature / photo /
 * GPS), conditional auto-skip on advance, and status transitions are performed
 * server-side by the `workflow_act` RPC — this client call is convenience only.
 *
 * Backward-compatible signature. Both forms are supported:
 *   actOnWorkflow(id, 'approve', 'looks good')          // legacy positional comment
 *   actOnWorkflow(id, 'approve', {                       // new options object
 *     comment, signature, printedName, photos, gps, deviceInfo,
 *   })
 *
 * @param {string} instanceId
 * @param {'approve'|'reject'|'return'} action
 * @param {string|null|{
 *   comment?:string|null, signature?:string|null, printedName?:string|null,
 *   photos?:string[]|null, gps?:object|null, deviceInfo?:object|null
 * }} [optionsOrComment] a plain comment string (legacy) or an options object.
 * @returns {Promise<object>} e.g. {status:'in_review',current_step,step}
 *   | {status:'approved'|'rejected'|'returned'}
 */
export async function actOnWorkflow(instanceId, action, optionsOrComment = null) {
  const opts =
    optionsOrComment && typeof optionsOrComment === 'object'
      ? optionsOrComment
      : { comment: optionsOrComment }

  return unwrap(
    await supabase.rpc('workflow_act', {
      p_instance_id: instanceId,
      p_action: action,
      p_comment: opts.comment ?? null,
      p_signature_data: opts.signature ?? opts.signatureData ?? null,
      p_printed_name: opts.printedName ?? null,
      p_photo_urls: opts.photos ?? opts.photoUrls ?? null,
      p_gps: opts.gps ?? null,
      p_device_info: opts.deviceInfo ?? null,
    })
  )
}

/**
 * Return the current document to the prior step for correction. Requires a
 * comment (enforced server-side). The initiator is notified and a `returned`
 * step event is recorded; history is preserved.
 * @param {string} instanceId
 * @param {{comment:string, signature?:string|null, printedName?:string|null,
 *   photos?:string[]|null, gps?:object|null, deviceInfo?:object|null}} payload
 * @returns {Promise<object>} {status:'returned', current_step}
 */
export async function returnWorkflow(instanceId, payload = {}) {
  return actOnWorkflow(instanceId, 'return', payload)
}

/**
 * Manager approval dashboard: org-scoped buckets (pending, overdue, returned,
 * rejected, recently_approved) plus headline metrics (counts, avg approval
 * time). Server-evaluated, org-scoped RPC.
 * @returns {Promise<{metrics:object, buckets:{pending:Array,overdue:Array,
 *   returned:Array,rejected:Array,recently_approved:Array}}>}
 */
export async function getApprovalDashboard() {
  return unwrap(await supabase.rpc('approval_dashboard'))
}

/**
 * Cancel a pending instance (initiator or admin only - enforced server-side).
 * @param {string} instanceId
 * @param {string|null} [comment]
 */
export async function cancelWorkflow(instanceId, comment = null) {
  return unwrap(
    await supabase.rpc('workflow_cancel', {
      p_instance_id: instanceId,
      p_comment: comment,
    })
  )
}
