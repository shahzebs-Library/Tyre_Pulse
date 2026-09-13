/**
 * Supabase boundary for the repair order / repair task / quality-check tables
 * behind the "Workshop assessment report" recommendation and the repair
 * execution that follows it. Every write goes through the accident-module RPCs
 * (verified live: accident_repair_order_upsert, accident_repair_task_add/
 * _complete, accident_repair_qc, accident_repair_complete) - accident_repair_qc
 * moves the order to qc_passed/qc_failed/qc_pending, and accident_repair_complete
 * re-checks for a passing QC itself (unless the case's workshop_qc workstream is
 * explicitly waived) before it will mark the order completed, so a completion can
 * never skip quality control by racing a direct write.
 *
 * SHIP-BEFORE-MIGRATE, same as accidentCase.js: reads degrade to an honest
 * empty/null state via isMissingRelation.
 */
import { supabase, unwrap, isMissingRelation } from './_client'

const ORDER_COLS =
  'id,accident_id,country,site,repair_route,workshop_type,workshop_name,vendor_id,' +
  'external_workshop,po_required,po_reference,insurer_approval_required,insurer_approved,' +
  'quotation_amount,approved_amount,planned_start,planned_completion,actual_start,' +
  'actual_completion,offroad_start,status,recommended_by,approved_by,approved_at,' +
  'approval_remarks,delay_reason,created_by,created_at,updated_at'

const TASK_COLS =
  'id,accident_id,repair_order_id,country,site,title,description,estimated_hours,' +
  'actual_hours,assignee_id,assignee_name,status,sort_order,created_by,created_at,updated_at'

const QC_COLS =
  'id,accident_id,repair_order_id,country,site,inspector_id,inspector_name,inspected_at,' +
  'checklist,road_test_done,alignment_ok,tyres_ok,no_leaks,warning_lights_clear,result,' +
  'remarks,created_by,created_at,updated_at'

/** repair_route tokens (accident_repair_orders CHECK, verified live). */
export const REPAIR_ROUTES = [
  'none', 'temporary', 'internal', 'external', 'insurer_approved',
  'dealer', 'specialist', 'replacement', 'total_loss', 'disposal', 'under_review',
]
/** workshop_type tokens (accident_repair_orders CHECK, verified live). */
export const WORKSHOP_TYPES = ['internal', 'external', 'insurer_approved', 'dealer', 'specialist']
/** Quality-check result tokens (accident_repair_qc CHECK, verified live). */
export const QC_RESULTS = ['pass', 'fail', 'conditional']

async function readOrEmpty(fn, empty) {
  try {
    return await fn()
  } catch (err) {
    if (isMissingRelation(err)) return empty
    throw err
  }
}

function unwrapRpc(result, key) {
  const envelope = unwrap(result)
  if (!envelope?.ok) throw new Error('The request could not be completed.')
  return key ? envelope[key] : envelope
}

// ── reads ───────────────────────────────────────────────────────────────────

/** The latest OPEN repair order for a case (not completed/cancelled), or null. */
export async function getOpenRepairOrder(accidentId) {
  if (!accidentId) return null
  return readOrEmpty(
    async () =>
      unwrap(
        await supabase
          .from('accident_repair_orders')
          .select(ORDER_COLS)
          .eq('accident_id', accidentId)
          .not('status', 'in', '("completed","cancelled")')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    null,
  )
}

/** Every repair order for a case (open and closed), newest first. */
export async function listRepairOrders(accidentId) {
  if (!accidentId) return []
  return readOrEmpty(async () => {
    return (
      unwrap(
        await supabase
          .from('accident_repair_orders')
          .select(ORDER_COLS)
          .eq('accident_id', accidentId)
          .order('created_at', { ascending: false }),
      ) || []
    )
  }, [])
}

/** Tasks for one repair order, in their set order. */
export async function listRepairTasks(repairOrderId) {
  if (!repairOrderId) return []
  return readOrEmpty(async () => {
    return (
      unwrap(
        await supabase
          .from('accident_repair_tasks')
          .select(TASK_COLS)
          .eq('repair_order_id', repairOrderId)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
      ) || []
    )
  }, [])
}

/** Quality checks recorded against one repair order, newest first. */
export async function listQualityChecks(repairOrderId) {
  if (!repairOrderId) return []
  return readOrEmpty(async () => {
    return (
      unwrap(
        await supabase
          .from('accident_repair_quality_checks')
          .select(QC_COLS)
          .eq('repair_order_id', repairOrderId)
          .order('inspected_at', { ascending: false }),
      ) || []
    )
  }, [])
}

// ── writes (all via RPC) ────────────────────────────────────────────────────

/** Open or update this case's repair order (one active order per case; a second
 *  call while one is still open updates it rather than opening a duplicate). */
export async function upsertRepairOrder(accidentId, { repairRoute, workshopType, workshopName, quotationAmount, plannedCompletion } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  if (repairRoute && !REPAIR_ROUTES.includes(repairRoute)) throw new Error(`Invalid repair route "${repairRoute}".`)
  if (workshopType && !WORKSHOP_TYPES.includes(workshopType)) throw new Error(`Invalid workshop type "${workshopType}".`)
  return unwrapRpc(
    await supabase.rpc('accident_repair_order_upsert', {
      p_accident_id: accidentId,
      p_repair_route: repairRoute ?? null,
      p_workshop_type: workshopType ?? null,
      p_workshop_name: workshopName ?? null,
      p_quotation_amount: quotationAmount ?? null,
      p_planned_completion: plannedCompletion ?? null,
    }),
    'repair_order',
  )
}

/** Add a repair task under a repair order. */
export async function addRepairTask(repairOrderId, { title, description, estimatedHours, assigneeId, assigneeName } = {}) {
  if (!repairOrderId) throw new Error('A repair order is required.')
  if (!title || !String(title).trim()) throw new Error('A task title is required.')
  return unwrapRpc(
    await supabase.rpc('accident_repair_task_add', {
      p_repair_order_id: repairOrderId,
      p_title: title,
      p_description: description ?? null,
      p_estimated_hours: estimatedHours ?? null,
      p_assignee_id: assigneeId ?? null,
      p_assignee_name: assigneeName ?? null,
    }),
    'task',
  )
}

/** Mark a repair task completed. */
export async function completeRepairTask(taskId, { actualHours, note } = {}) {
  if (!taskId) throw new Error('A task is required.')
  return unwrapRpc(
    await supabase.rpc('accident_repair_task_complete', {
      p_task_id: taskId,
      p_actual_hours: actualHours ?? null,
      p_note: note ?? null,
    }),
    'task',
  )
}

/** Record a quality-check result against a repair order. Returns `{result, passed}`. */
export async function recordQualityCheck(repairOrderId, { result, notes } = {}) {
  if (!repairOrderId) throw new Error('A repair order is required.')
  if (!QC_RESULTS.includes(result)) throw new Error(`Invalid quality-check result "${result}".`)
  const envelope = unwrap(
    await supabase.rpc('accident_repair_qc', {
      p_repair_order_id: repairOrderId,
      p_result: result,
      p_notes: notes ?? null,
    }),
  )
  if (!envelope?.ok) throw new Error('The quality check could not be recorded.')
  return { qualityCheck: envelope.quality_check, passed: envelope.passed }
}

/**
 * Complete a repair order. The server refuses this unless a passing QC exists
 * (or the case's workshop_qc workstream is explicitly waived) - surface that
 * refusal to the user rather than retrying, it is a real gate, not a glitch.
 */
export async function completeRepairOrder(repairOrderId, { actualCompletion, approvedAmount } = {}) {
  if (!repairOrderId) throw new Error('A repair order is required.')
  if (!actualCompletion) throw new Error('An actual completion date is required.')
  return unwrapRpc(
    await supabase.rpc('accident_repair_complete', {
      p_repair_order_id: repairOrderId,
      p_actual_completion: actualCompletion,
      p_approved_amount: approvedAmount ?? null,
    }),
    'repair_order',
  )
}
