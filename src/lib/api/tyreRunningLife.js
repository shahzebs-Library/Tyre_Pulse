/**
 * tyreRunningLife service - loads the V488 get_tyre_running_life aggregate
 * (per active tyre: km/hours run vs current meters + projected remaining km).
 * Degrades to { ok: false } so the section renders an honest error state.
 */
import { supabase } from './_client'

export async function getTyreRunningLife({ country } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_tyre_running_life', {
      p_country: country && country !== 'All' ? country : null,
    })
    if (error) return { ok: false }
    return data && data.ok ? data : { ok: false }
  } catch {
    return { ok: false }
  }
}
