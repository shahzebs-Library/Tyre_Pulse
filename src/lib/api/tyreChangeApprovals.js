import { supabase, unwrap } from './_client'

export async function getTyreChangeApprovalContext(vehicleId) {
  const data = unwrap(await supabase.rpc('tyre_change_approval_context', { p_vehicle_id: vehicleId }))
  if (!data || !['legacy', 'enforced'].includes(data.mode) || typeof data.can_submit !== 'boolean'
    || !Array.isArray(data.requests) || data.vehicle?.id !== vehicleId) {
    throw new Error('Tyre change authority could not be verified. Refresh before making changes.')
  }
  return data
}

export async function requestTyreChangeApproval(intent) {
  const data = unwrap(await supabase.rpc('request_tyre_change_approval', intent))
  if (!data?.id) throw new Error('The server did not confirm the request. Retry the saved request to check its result.')
  return data
}

export async function executeApprovedTyreChange(intent) {
  const data = unwrap(await supabase.rpc('execute_approved_tyre_change', intent))
  if (data?.ok !== true || data.request_id !== intent.p_request_id || data.operation_id !== intent.p_operation_id
    || data.status !== 'executed' || !data.executed_at) {
    throw new Error('The server did not confirm execution. Retry the saved operation to check its result.')
  }
  return data
}

export function tyreChangePayload(form) {
  const number = value => {
    if (value === '' || value == null) return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Meter and cost values must be non-negative numbers.')
    return parsed
  }
  if (!['install', 'replace', 'remove', 'move'].includes(form.action)) throw new Error('Choose a tyre operation.')
  if (form.action !== 'install' && !form.tyreId) throw new Error('Choose the current tyre.')
  if (form.action === 'remove') return { action: form.action, tyre_id: form.tyreId, reason: form.reason.trim(), km: number(form.km), date: form.date }
  if (form.action === 'move') {
    if (!form.position?.trim()) throw new Error('Choose a target position.')
    return { action: form.action, tyre_id: form.tyreId, to_asset_no: form.targetAsset?.trim() || null, to_position: form.position.trim(), km: number(form.km) }
  }
  if (!form.position?.trim() || !form.serial?.trim()) throw new Error('Position and replacement serial are required.')
  return { action: form.action, position: form.position.trim(), removed_record_id: form.action === 'replace' ? form.tyreId : null,
    serial_no: form.serial.trim(), brand: form.brand?.trim() || null, km_at_fitment: number(form.km), cost_per_tyre: number(form.cost),
    issue_date: form.date, removal_reason: form.reason.trim(), km_at_removal: number(form.km), removal_date: form.date }
}
