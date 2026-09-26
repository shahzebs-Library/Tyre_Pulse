/**
 * Install base of the field app by version, via the super-admin RPC
 * console_mobile_device_versions (migration 20260926130000).
 *
 * The page used to count user_devices directly, but that table's only SELECT
 * policy is own-rows, so a super admin counted THEIR OWN phones (1-2) rather
 * than the fleet. The RPC returns aggregates only: no token, no user, no id.
 *
 * Throws on failure so the page can say the figures could not be read instead
 * of printing zeros.
 */
import { supabase } from '../../../lib/supabase'
import { ServiceError } from '../../../lib/api/_client'
import { toUserMessage } from '../../../lib/safeError'

export async function getDeviceVersions() {
  const { data, error } = await supabase.rpc('console_mobile_device_versions')
  if (error) throw new ServiceError(toUserMessage(error, 'The device install base could not be read.'), error?.code, error)
  if (!data || data.ok !== true) throw new ServiceError('The device install base could not be read.')
  return {
    total: Number(data.total) || 0,
    active: Number(data.active) || 0,
    revoked: Number(data.revoked) || 0,
    seen7d: Number(data.seen_7d) || 0,
    seen30d: Number(data.seen_30d) || 0,
    users: Number(data.users) || 0,
    byVersion: Array.isArray(data.by_version) ? data.by_version : [],
  }
}
