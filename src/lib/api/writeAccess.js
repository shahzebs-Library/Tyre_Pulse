/**
 * Ask the server what the signed-in user may write.
 *
 * `app_user_can(module, capability)` is the function the row policies
 * themselves call, so its answer is exactly what an INSERT or UPDATE will meet.
 * A failed read returns null for that capability (unknown), never false: a page
 * must not hide a control because a request dropped.
 */
import { supabase } from './_client'

/**
 * @param {string} moduleKey  e.g. 'fleet_master', 'budgets', 'work_orders'
 * @param {string[]} [caps]
 * @returns {Promise<Record<string, boolean|null>>}
 */
export async function getServerCapabilities(moduleKey, caps = ['create', 'edit']) {
  const out = {}
  await Promise.all(caps.map(async (cap) => {
    try {
      const { data, error } = await supabase.rpc('app_user_can', { p_key: moduleKey, p_cap: cap })
      out[cap] = error ? null : data === true
    } catch {
      out[cap] = null
    }
  }))
  return out
}
