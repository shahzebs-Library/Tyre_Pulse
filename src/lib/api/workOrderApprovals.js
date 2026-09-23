import { supabase, unwrap } from './_client'

function envelope(data, id) {
  if (!data || !['legacy', 'enforced'].includes(data.mode) || typeof data.can_submit !== 'boolean'
    || typeof data.can_execute !== 'boolean' || data.work_order?.id !== id
    || (data.request_id && (data.review?.entity_id !== data.request_id || data.review?.entity_type !== 'work_order'))) {
    throw new Error('The server did not confirm the work-order approval state.')
  }
  return data
}
export async function getWorkOrderApproval(id) {
  return envelope(unwrap(await supabase.rpc('work_order_approval_context', { p_work_order_id: id })), id)
}
export async function requestWorkOrderApproval(id, operationId, reason) {
  if (!operationId || !String(reason || '').trim()) throw new Error('An operation ID and submission reason are required.')
  const data = envelope(unwrap(await supabase.rpc('request_work_order_approval', {
    p_work_order_id: id, p_operation_id: operationId, p_reason: reason.trim(),
  })), id)
  if (!data.request_id) throw new Error('The server did not confirm the work-order approval request. Retry the saved request.')
  return data
}
