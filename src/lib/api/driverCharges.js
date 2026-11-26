/**
 * Driver charge cases (migration 20261126170000). Every write goes through
 * driver_workspace_command, the same RPC as traffic fines, so idempotency,
 * audit events and access rules are shared. Contract:
 * docs/document-specs/driver-charge-contract.md
 */
import { supabase, unwrap, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { validateHandoverPhoto } from './handoverReports'

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

// Evidence photos live in the PRIVATE `tyre-photos` bucket under
// modules/driver-charge/, the same bucket and checks as handover photos, so
// they resolve through src/lib/storageRefs.js and the Flutter resolver. The
// charge stores the tp-storage:// reference, never a public URL; the server
// refuses a photo evidence row that is not such a reference.
const PHOTO_BUCKET = 'tyre-photos'

export async function uploadDriverChargePhoto(file, index = 0) {
  const ext = validateHandoverPhoto(file)
  const { data: { user } = {} } = await supabase.auth.getUser()
  const uid = (user?.id || 'anon').slice(0, 8)
  const rand = Math.random().toString(36).slice(2, 6)
  const path = `modules/driver-charge/${uid}/${Date.now()}_${index}_${rand}.${ext}`
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    upsert: false, contentType: file.type || 'image/jpeg', cacheControl: '3600',
  })
  if (error) throw new ServiceError(toUserMessage(error, 'Photo upload failed.'), error.code, error)
  return `tp-storage://${PHOTO_BUCKET}/${path}`
}
