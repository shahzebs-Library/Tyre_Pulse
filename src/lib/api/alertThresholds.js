/**
 * Alert Thresholds service — alert_thresholds records. Personal notification
 * rules scoped to the signed-in user. Explicit column lists (no SELECT *);
 * additive, mirrors correctiveActions.js. Single boundary for this table as the
 * AlertThresholds page migrates onto it.
 */
import { supabase, unwrap } from './_client'

// Least-privilege column set covering the AlertThresholds page (list cards +
// edit form + stats). Omits user_id and org_id (used only as write-time scoping
// / RLS-managed, never read back into the UI).
const COLS =
  'id,name,metric,operator,threshold,site_filter,brand_filter,notify_email,notify_in_app,active,triggered_count,last_triggered_at,created_at,updated_at'

/**
 * List a user's alert thresholds, newest first. Strict per-user scoping
 * (`user_id` eq) to match the page's prior behaviour.
 * @param {{userId:string}} opts
 */
export async function listAlertThresholds({ userId } = {}) {
  return unwrap(
    await supabase
      .from('alert_thresholds')
      .select(COLS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
  )
}

/** Get one alert threshold by id (or null if not found). */
export async function getAlertThreshold(id) {
  return unwrap(await supabase.from('alert_thresholds').select(COLS).eq('id', id).maybeSingle())
}

/** Create an alert threshold; returns the inserted row. */
export async function createAlertThreshold(values) {
  return unwrap(await supabase.from('alert_thresholds').insert(values).select(COLS).single())
}

/** Update an alert threshold by id. */
export async function updateAlertThreshold(id, patch) {
  return unwrap(await supabase.from('alert_thresholds').update(patch).eq('id', id))
}

/** Delete an alert threshold by id. */
export async function deleteAlertThreshold(id) {
  return unwrap(await supabase.from('alert_thresholds').delete().eq('id', id))
}
