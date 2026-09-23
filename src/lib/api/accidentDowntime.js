/**
 * Supabase boundary for `accident_vehicle_downtime` - the vehicle off-road /
 * recovery / dispatch-to-workshop tracking behind the "Dispatch details"
 * section of the Vehicle Dispatch & Handover tab. The vehicle carries ONE
 * downtime record per case (accident_downtime_set's own convention, from
 * docs/accident-module/15_REPAIR_FINANCE.sql section 14c) - this module
 * mirrors that: getDowntime reads the latest row, saveDowntime updates it in
 * place once it exists.
 *
 * `vehicle_status` is CHECK-constrained server-side; every other field here
 * has no dedicated RPC (same class as accidentLiability.js/
 * accidentHandover.js) so it is a direct RLS-governed read/write.
 * SHIP-BEFORE-MIGRATE: a missing table degrades to an honest null/[] state.
 */
import { supabase, unwrap, isMissingRelation } from './_client'

const DOWNTIME_COLS =
  'id,accident_id,country,site,offroad_reason,vehicle_status,offroad_start,offroad_end,' +
  'planned_downtime_days,actual_downtime_days,replacement_required,replacement_asset_no,' +
  'replacement_allocated_at,recovery_required,towing_reference,delivered_to_workshop_at,' +
  'expected_return_date,created_by,created_at,updated_at'

/** vehicle_status tokens (accident_vehicle_downtime CHECK, verified live). */
export const VEHICLE_STATUSES = [
  'operational', 'restricted', 'awaiting_recovery', 'off_road_accident', 'under_inspection',
  'under_repair', 'ready_for_inspection', 'rejected_after_repair', 'returned_to_operation',
  'total_loss', 'disposed',
]

async function readOrEmpty(fn, empty) {
  try {
    return await fn()
  } catch (err) {
    if (isMissingRelation(err)) return empty
    throw err
  }
}

/** The current (latest) downtime/dispatch record for a case, or null. */
export async function getDowntime(accidentId) {
  if (!accidentId) return null
  return readOrEmpty(
    async () =>
      unwrap(
        await supabase
          .from('accident_vehicle_downtime')
          .select(DOWNTIME_COLS)
          .eq('accident_id', accidentId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    null,
  )
}

/** Save (insert or update) the case's downtime/dispatch record. */
export async function saveDowntime(accidentId, patch, { existingId } = {}) {
  if (!accidentId) throw new Error('An incident is required.')
  if (patch.vehicle_status && !VEHICLE_STATUSES.includes(patch.vehicle_status)) {
    throw new Error(`Invalid vehicle status "${patch.vehicle_status}".`)
  }
  const row = { accident_id: accidentId, ...patch }
  if (existingId) {
    return unwrap(
      await supabase.from('accident_vehicle_downtime').update(row).eq('id', existingId).select(DOWNTIME_COLS).single(),
    )
  }
  return unwrap(
    await supabase.from('accident_vehicle_downtime').insert(row).select(DOWNTIME_COLS).single(),
  )
}
