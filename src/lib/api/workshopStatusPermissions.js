/**
 * Daily Ops -> Workshop Status - the caller's permission map (Loop 2).
 *
 * One RPC, public.workshop_status_my_permissions(), returns { action: boolean }
 * computed by the same server function that RLS and every writer use. This is
 * for showing / hiding actions only; the server refuses anything not allowed.
 *
 * Fails closed: an error, a missing function (migration not applied yet) or a
 * malformed answer yields every action false - never an optimistic default.
 */
import { supabase, toServiceError } from './_client'
import { resolveWorkshopPermissions, NO_WORKSHOP_PERMISSIONS } from '../workshopStatus/permissions'

/**
 * @returns {Promise<{ permissions: Readonly<Record<string, boolean>>, error: import('./_client').ServiceError|null }>}
 */
export async function loadMyWorkshopPermissions() {
  try {
    const { data, error } = await supabase.rpc('workshop_status_my_permissions')
    if (error) {
      return { permissions: NO_WORKSHOP_PERMISSIONS, error: toServiceError(error, 'Could not load your workshop permissions.') }
    }
    return { permissions: resolveWorkshopPermissions({ myPermissions: data }), error: null }
  } catch (err) {
    return { permissions: NO_WORKSHOP_PERMISSIONS, error: toServiceError(err, 'Could not load your workshop permissions.') }
  }
}

/**
 * The permission object alone (all false on any failure).
 * @returns {Promise<Readonly<Record<string, boolean>>>}
 */
export async function getMyWorkshopPermissions() {
  const { permissions } = await loadMyWorkshopPermissions()
  return permissions
}
