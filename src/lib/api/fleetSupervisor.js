/**
 * The shared driver pool: every Fleet Supervisor, Fleet Foreman and Fleet
 * Incharge in scope sees and manages any driver there. Nobody owns a driver;
 * driver type and region are filters, the responsible supervisor only a label.
 * Server contract: migration 20261127171000_fleet_supervisor_driver_management
 * (fleet_supervisor_drivers, fleet_supervisor_driver_filters,
 * fleet_supervisor_assignment_history, fleet_supervisor_command). Mirrors the
 * Flutter `features/fleet_supervisor` lane; charges and fines keep using the
 * existing driver workspace (charge_issue, create_fine).
 */
import { supabase, unwrap, toServiceError } from './_client'

export const TEAM_ACTIONS = Object.freeze(['assign_vehicle', 'unassign_vehicle', 'set_responsible', 'set_driver_profile'])
export const TEAM_VIEWS = Object.freeze(['all', 'with_vehicle', 'without_vehicle'])
export const SUGGESTED_CATEGORIES = Object.freeze(['Transit mixer driver', 'Pump driver', 'Bus driver', 'Light vehicle driver', 'Heavy equipment operator'])
const PAGE = 100

/** One page of the pool: view 'all' | 'with_vehicle' | 'without_vehicle', optional type and region filters. */
export async function listTeam(view = 'all', search = '', offset = 0, { category = null, region = null } = {}) {
  const result = unwrap(await supabase.rpc('fleet_supervisor_drivers', {
    p_view: view, p_search: String(search || '').trim(), p_offset: offset,
    p_category: category || null, p_region: region || null,
  }))
  if (!result || !Array.isArray(result.rows)) throw new Error('Driver list is unavailable.')
  return { rows: result.rows.slice(0, PAGE), hasMore: result.rows.length > PAGE }
}

/** Driver types, regions and sites present in scope, for the filters. */
export async function driverFilters() {
  const result = unwrap(await supabase.rpc('fleet_supervisor_driver_filters'))
  const list = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).sort() : [])
  return { categories: list(result?.categories), regions: list(result?.regions), sites: list(result?.sites) }
}

export async function assignmentHistory(driverId) {
  const result = unwrap(await supabase.rpc('fleet_supervisor_assignment_history', { p_driver_id: driverId }))
  if (!result || !Array.isArray(result.rows)) throw new Error('Assignment history is unavailable.')
  return result.rows
}

/**
 * Runs one team action. Resolves to { ok: true } or, when the vehicle is held
 * by another driver, { ok: false, conflict: { driver_id, driver_name, asset_no } }
 * with nothing written: ask the user, then call again with move_from_driver.
 */
export async function teamCommand(action, payload, requestId) {
  if (!TEAM_ACTIONS.includes(action)) throw new Error('Not a team action')
  const result = unwrap(await supabase.rpc('fleet_supervisor_command', {
    p_action: action, p_payload: payload, p_request_id: requestId,
  }))
  if (result?.ok === false && result.conflict) return { ok: false, conflict: result.conflict }
  if (result?.ok === true) return { ok: true }
  throw new Error('The server did not confirm the change.')
}

/** Vehicles the caller may assign (RLS scopes org, country and site). */
export async function searchTeamVehicles(country, search = '') {
  try {
    let q = supabase.from('vehicle_fleet').select('id,asset_no,registration_no,site,vehicle_type,country')
    if (country) q = q.eq('country', country)
    const term = String(search || '').trim().replace(/[%,()]/g, ' ')
    if (term) q = q.or(`asset_no.ilike.%${term}%,registration_no.ilike.%${term}%`)
    return unwrap(await q.order('asset_no').limit(40)) || []
  } catch (err) {
    throw toServiceError(err, 'Vehicles could not be loaded.')
  }
}

/** True when the error means "this account is not a supervisor here". */
export function isTeamDenied(err) {
  const code = String(err?.code || err?.cause?.code || '')
  return code === '42501'
}
