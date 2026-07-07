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

// Definition columns for the admin builder (list + edit form).
// Omits created_by (write-time scoping only).
const DEFINITION_COLS =
  'id,organisation_id,name,description,entity_type,trigger_event,steps,active,created_at,updated_at'

// Instance columns for the approvals inbox / instance list + detail.
// steps is the immutable snapshot taken at start. Omits organisation_id /
// source_event_id (RLS-scoped / internal linkage).
const INSTANCE_COLS =
  'id,definition_id,definition_name,entity_type,entity_id,entity_label,steps,current_step,step_started_at,status,context,started_by,started_at,completed_at'

// Append-only audit trail columns for the instance timeline.
const STEP_EVENT_COLS = 'id,instance_id,step_index,step_name,action,actor_id,comment,created_at'

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
 * Approvals inbox: pending instances currently waiting on MY role (admins see
 * every pending run in the organisation). Server-evaluated RPC.
 * @returns {Promise<Array<object>>} workflow_instances rows
 */
export async function myPendingApprovals() {
  return unwrap(await supabase.rpc('my_pending_approvals'))
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
 * Approve or reject the current step of a pending instance. Role checks are
 * enforced server-side (step approver_role or admin).
 * @param {string} instanceId
 * @param {'approve'|'reject'} action
 * @param {string|null} [comment]
 * @returns {Promise<object>} e.g. {status:'pending',current_step,step} | {status:'approved'|'rejected'}
 */
export async function actOnWorkflow(instanceId, action, comment = null) {
  return unwrap(
    await supabase.rpc('workflow_act', {
      p_instance_id: instanceId,
      p_action: action,
      p_comment: comment,
    })
  )
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
