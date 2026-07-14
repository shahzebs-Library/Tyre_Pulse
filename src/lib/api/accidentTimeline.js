/**
 * Accident case-timeline service — status transitions for ONE accident.
 *
 * Reads the rows the existing `log_accident_change()` trigger writes to
 * `accident_audit_log` (action = 'status_change'). Selects a LEAN projection —
 * only the status token is pulled out of the old/new full-row JSONB snapshots
 * (`old_values->>status` / `new_values->>status`) so payloads stay tiny even
 * on long-lived cases. Read access for non-admin org members is granted by
 * V223 (EXISTS against the parent accident, inheriting its org/country RLS).
 * Missing relation → [] so the UI degrades to the honest single-step timeline.
 */
import { supabase, ServiceError } from './_client'

const COLS =
  'id,accident_id,changed_at,action,old_status:old_values->>status,new_status:new_values->>status'

/** True when the table isn't present yet (pre-migration) — callers degrade to []. */
function isMissingRelation(err) {
  const m = String(err?.message || err?.code || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table') || m === '42p01'
}

/**
 * Ordered (oldest → newest) status transitions for one accident. Feed the
 * result to `buildCaseTimeline()` in `src/lib/accidentTimeline.js`.
 */
export async function listStatusTransitions(accidentId) {
  if (!accidentId) return []
  const { data, error } = await supabase
    .from('accident_audit_log')
    .select(COLS)
    .eq('accident_id', accidentId)
    .eq('action', 'status_change')
    .order('changed_at', { ascending: true })
  if (error) {
    if (isMissingRelation(error)) return []
    throw new ServiceError(error.message, error.code)
  }
  return data ?? []
}
