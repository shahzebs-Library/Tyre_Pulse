/**
 * User Dashboards service - the V100 Dashboard Builder boundary:
 * `user_dashboards` stores saved widget-grid layouts
 * ({"widgets":[{"id","type","size","config"}]}, max 40 widgets, enforced by a
 * DB CHECK). RLS: owners get full CRUD; `shared` rows are org-readable, so a
 * plain list returns own + shared dashboards. Explicit column lists
 * (no SELECT *), unwrap error surfacing, mirrors businessRules.js.
 */
import { supabase, unwrap } from './_client'

// Dashboard columns for the picker + builder. organisation_id is included so
// the UI can distinguish own vs org-shared rows; it is never written by the
// client (DB default app_current_org()).
const DASHBOARD_COLS =
  'id,user_id,organisation_id,name,layout,is_default,shared,created_at,updated_at'

/**
 * List dashboards visible to the current user (own + org-shared via RLS),
 * most recently updated first.
 * @returns {Promise<Array<object>>}
 */
export async function listDashboards() {
  return unwrap(
    await supabase
      .from('user_dashboards')
      .select(DASHBOARD_COLS)
      .order('updated_at', { ascending: false })
  )
}

/**
 * Create a dashboard; returns the inserted row.
 * @param {{user_id:string, name:string,
 *   layout?:{widgets:Array<{id:string,type:string,size:'sm'|'md'|'lg'|'xl',config:object}>},
 *   is_default?:boolean, shared?:boolean}} values
 * @returns {Promise<object>}
 */
export async function createDashboard(values) {
  return unwrap(
    await supabase.from('user_dashboards').insert(values).select(DASHBOARD_COLS).single()
  )
}

/**
 * Update a dashboard by id (layout save, rename, share / default toggles).
 * RLS restricts writes to the owner.
 * @param {string} id
 * @param {object} patch
 */
export async function updateDashboard(id, patch) {
  return unwrap(await supabase.from('user_dashboards').update(patch).eq('id', id))
}

/**
 * Delete a dashboard by id (owner only via RLS).
 * @param {string} id
 */
export async function deleteDashboard(id) {
  return unwrap(await supabase.from('user_dashboards').delete().eq('id', id))
}
