/**
 * tyreConsumption service - loads the V513 get_tyre_consumption aggregate
 * (tyre fitment COUNTS and the daily rate for a bounded period).
 *
 * Counts only. tyre_records is authoritative for how many tyres were fitted; it
 * is never a money source - that stays with the expense grid.
 *
 * Every failure carries its reason, because "we could not look" and "there is
 * nothing" are opposite statements and the screen must be able to say which.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

export async function getTyreConsumption({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_tyre_consumption', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
    })
    if (error) return { ok: false, reason: toUserMessage(error) }
    if (!data) return { ok: false, reason: 'The tyre consumption service returned nothing.' }
    if (data.ok === false) {
      const map = {
        no_org: 'Your account is not linked to an organisation, so this view cannot be built.',
        forbidden: 'You do not have access to that country.',
        empty_period: 'The selected period is empty. Pick a start date on or before the end date.',
      }
      return { ok: false, reason: map[data.reason] || 'The tyre consumption service could not build this view.' }
    }
    return data
  } catch (e) {
    return { ok: false, reason: toUserMessage(e) }
  }
}
