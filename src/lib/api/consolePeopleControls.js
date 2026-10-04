/**
 * consolePeopleControls service - the Supabase boundary for the super-admin
 * controls added to the People screens by migration
 * 20261004104000_console_people_controls.sql. Every RPC self-gates on
 * is_super_admin() and writes a console audit row; this layer only relocates
 * the call and turns failures into a safe ServiceError.
 */
import { supabase, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { deleteOrgRefusal } from '../consolePeopleControls'

async function rpc(name, args, fallback) {
  let res
  try {
    res = await supabase.rpc(name, args)
  } catch (err) {
    throw new ServiceError(toUserMessage(err, fallback), err?.code, err)
  }
  if (res?.error) throw new ServiceError(toUserMessage(res.error, fallback), res.error.code, res.error)
  return res?.data ?? null
}

/** Every registered phone with its app (Flutter or retired). The push token is never returned. */
export async function listAllDevices() {
  const data = await rpc('admin_list_user_devices', {}, 'Could not load the device list.')
  return Array.isArray(data) ? data : []
}

/** Stop push to one device. Audited with the reason. */
export async function revokeDevice(deviceId, reason) {
  const res = await rpc('admin_revoke_user_device', { p_device_id: deviceId, p_reason: reason }, 'Could not stop push to this device.')
  if (res?.ok) return res
  throw new ServiceError('This device was already stopped or no longer exists.')
}

/** End one support session (any owner), or every lapsed one when id is null. Returns how many ended. */
export async function endSupportSessions(id, reason) {
  const res = await rpc('admin_end_support_sessions', { p_id: id || null, p_reason: reason }, 'Could not end the support session.')
  return Number(res?.ended ?? 0)
}

/** Delete an organisation that has no members and no records. Refusals are thrown in plain English. */
export async function deleteEmptyOrg(orgId, reason) {
  const res = await rpc('admin_delete_empty_org', { p_org_id: orgId, p_reason: reason }, 'Could not delete the organisation.')
  if (res?.ok) return res
  throw new ServiceError(deleteOrgRefusal(res))
}

/** Re-grade an open incident; the change lands on its timeline. */
export async function changeIncidentSeverity(id, severity, reason) {
  const res = await rpc('incident_change_severity', { p_id: id, p_severity: severity, p_reason: reason }, 'Could not change the severity.')
  if (res?.ok) return res
  if (res?.reason === 'unchanged') throw new ServiceError('The incident already has this severity.')
  throw new ServiceError('Could not change the severity.')
}
