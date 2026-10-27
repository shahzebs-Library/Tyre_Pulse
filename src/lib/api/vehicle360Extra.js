/**
 * Extra reads for the Vehicle 360 page that the base service does not carry:
 * the fleet register's document dates. Read-only, one row, scoped by the
 * vehicle's own id (RLS still decides what the caller may see).
 */
import { supabase, unwrap } from './_client'

const DOC_COLS = 'insurance_expiry,mvip_expiry,operating_card_expiry,driver_licence_expiry'

export async function getVehicleDocumentDates(vehicleId) {
  if (vehicleId == null || vehicleId === '') return null
  return unwrap(await supabase.from('vehicle_fleet').select(DOC_COLS).eq('id', vehicleId).limit(1).maybeSingle())
}
