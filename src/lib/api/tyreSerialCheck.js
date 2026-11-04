/**
 * Reads the active tyres the fleet serial check runs over. Paged past the
 * 1000-row server cap with an id tiebreak; the checks themselves are the pure
 * engine in ../tyreSerialCheck.js.
 */
import { supabase, applyCountry, toServiceError } from './_client'
import { fetchAllPages } from '../fetchAll'
import { fleetSerialFindings } from '../tyreSerialCheck'

export async function loadFleetSerialFindings({ country } = {}) {
  const { data, error, truncated } = await fetchAllPages((from, to) => {
    let q = supabase.from('tyre_records')
      .select('id,asset_no,country,tyre_position,serial_no')
      .ilike('status', 'active')
      .not('serial_no', 'is', null)
    q = applyCountry(q, country)
    return q.order('id').range(from, to)
  }, { max: 50000 })
  if (error) throw toServiceError(error)
  return { ...fleetSerialFindings(data || []), scanned: (data || []).length, truncated: !!truncated }
}
