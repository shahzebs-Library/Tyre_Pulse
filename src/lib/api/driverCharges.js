/**
 * Driver charge cases (migration 20261126170000). Every write goes through
 * driver_workspace_command, the same RPC as traffic fines, so idempotency,
 * audit events and access rules are shared. Contract:
 * docs/document-specs/driver-charge-contract.md
 */
import { supabase, unwrap } from './_client'

export async function listDriverCharges(filters = {}, offset = 0) {
  const result = unwrap(await supabase.rpc('driver_charges_list', { p_filters: filters, p_offset: offset }))
  if (!result || !Array.isArray(result.rows)) throw new Error('Driver charges are unavailable.')
  return result
}

export async function getDriverCharge(chargeId) {
  const result = unwrap(await supabase.rpc('driver_charge_detail', { p_charge_id: chargeId }))
  if (!result || !result.charge) throw new Error('Charge details are unavailable.')
  return result
}

export async function driverChargeSources(sourceType, driverId, search = '', offset = 0) {
  return unwrap(await supabase.rpc('driver_charge_sources', {
    p_source_type: sourceType, p_driver_id: driverId, p_search: search, p_offset: offset,
  })) || []
}

export async function driverChargeCommand(action, payload, requestId) {
  if (!String(action).startsWith('charge_')) throw new Error('Unsupported charge action.')
  return unwrap(await supabase.rpc('driver_workspace_command', {
    p_action: action, p_payload: payload, p_request_id: requestId,
  }))
}
