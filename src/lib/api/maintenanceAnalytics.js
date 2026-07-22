/**
 * maintenanceAnalytics.js - service for the Maintenance Cost & Tasks board.
 *
 * Reads the server-side aggregate RPC `get_maintenance_snapshot` (org-scoped,
 * aggregates work_orders + work_order_line_items) so the browser never pulls the
 * ~145k line items. Returns the JSON snapshot as-is; the page shapes/renders it.
 * On a missing-function/relation error we degrade to `{ ok:false }` so the page
 * shows an honest empty state rather than crashing.
 */
import { supabase } from './_client'

/** True when the error means the RPC / relation does not exist yet. */
function isMissingRelation(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return (
    code === 'PGRST202' || code === '42883' || code === '42P01' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('undefined function') ||
    msg.includes('undefined_function') ||
    msg.includes('undefined table')
  )
}

/**
 * Fetch the maintenance snapshot for the given scope.
 * @param {{ site?:string, country?:string, from?:string, to?:string }} [opts]
 * @returns {Promise<object>} the snapshot JSON, or { ok:false } if unavailable.
 */
export async function getMaintenanceSnapshot({ site, country, from, to } = {}) {
  const { data, error } = await supabase.rpc('get_maintenance_snapshot', {
    p_site: site ?? null,
    p_country: country ?? null,
    p_from: from ?? null,
    p_to: to ?? null,
  })
  if (error) {
    if (isMissingRelation(error)) return { ok: false }
    throw new Error(error.message || 'Could not load the maintenance snapshot.')
  }
  return data ?? { ok: false }
}
