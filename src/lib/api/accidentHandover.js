/**
 * Supabase boundary for accident HANDOVER INSPECTIONS - the vehicle
 * dispatch/receipt-at-workshop step ("Vehicle dispatch and handover" screen).
 * Same shape as accidentLiability.js: no dedicated write RPC exists for this
 * table, so it is a direct RLS-governed read/write. SHIP-BEFORE-MIGRATE: a
 * missing table degrades to an honest empty state, never a thrown error.
 */
import { supabase, unwrap, isMissingRelation } from './_client'

const HANDOVER_COLS =
  'id,accident_id,country,site,inspector_id,inspector_name,inspected_at,' +
  'matches_approved_scope,operational_test_done,decision,rejection_reason,remarks,' +
  'return_to_service_date,actual_downtime_days,photos,created_by,created_at,updated_at'

async function readOrEmpty(fn, empty) {
  try {
    return await fn()
  } catch (err) {
    if (isMissingRelation(err)) return empty
    throw err
  }
}

/** Handover/receipt inspections for one case, newest first (one per leg - a
 *  vehicle can be dispatched, received, and later returned, each its own row). */
export async function listHandoverInspections(accidentId) {
  if (!accidentId) return []
  return readOrEmpty(async () => {
    return (
      unwrap(
        await supabase
          .from('accident_handover_inspections')
          .select(HANDOVER_COLS)
          .eq('accident_id', accidentId)
          .order('inspected_at', { ascending: false }),
      ) || []
    )
  }, [])
}

/**
 * Record the receiving party's inspection (the "Workshop receipt" form). Always
 * an INSERT - a receipt is a point-in-time record, never overwritten, so a
 * corrected receipt is a new row, not a silent edit of the original.
 *
 * @param {string} accidentId
 * @param {object} patch column values (see HANDOVER_COLS) - inspected_at
 *   defaults to now when omitted.
 */
export async function recordHandoverInspection(accidentId, patch) {
  if (!accidentId) throw new Error('An incident is required.')
  if (!patch?.decision) throw new Error('A handover decision is required.')
  const row = {
    accident_id: accidentId,
    inspected_at: new Date().toISOString(),
    ...patch,
  }
  return unwrap(
    await supabase.from('accident_handover_inspections').insert(row).select(HANDOVER_COLS).single(),
  )
}
