/**
 * cpkDrivers - client boundary for the CPK DRIVER decomposition (RPC
 * get_cpk_drivers, V447): "why did my cost per km / hour move?".
 *
 * The RPC returns jsonb:
 *   {
 *     ok, windows: { current:{from,to,days}, previous:{from,to,days} },
 *     segments: [{ country, unit, currency, c0, d0, c1, d1,
 *                  matched_prev, matched_now,
 *                  causes: { price, volume, mix, new_equipment, stopped_equipment } }]
 *   }
 * Each segment is one (country, unit); cost is tyre_records.cost_per_tyre, the
 * denominator is fleet km / engine-hours. The exact-closing maths + honesty gates
 * live in the pure engine src/lib/cpkDrivers.js.
 *
 * INTENTIONALLY forgiving: a missing function (org not migrated), an empty result
 * or any RPC error degrades to a shaped empty payload so the page renders an honest
 * empty state - it never throws to the UI.
 */
import { supabase } from './_client'

function emptyResult() {
  return { ok: false, windows: null, segments: [] }
}

/**
 * Fetch the period-over-period CPK driver decomposition.
 *
 * @param {{ country?:string, from?:string, to?:string,
 *           prevFrom?:string, prevTo?:string }} [opts]
 *   country: a single country ('KSA'/'UAE'/'Egypt') or 'All'/null for every one.
 *   from/to: the CURRENT window (ISO YYYY-MM-DD). Default last 365 days.
 *   prevFrom/prevTo: the PRIOR window. Default: the same-length window immediately
 *     before the current one.
 * @returns {Promise<{ ok:boolean, windows:object|null, segments:Array }>}
 *   Always resolves; never rejects.
 */
export async function getCpkDrivers({ country, from, to, prevFrom, prevTo } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_cpk_drivers', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
      p_prev_from: prevFrom || null,
      p_prev_to: prevTo || null,
    })
    if (error || !data || data.ok === false) return emptyResult()
    return {
      ok: true,
      windows: data.windows || null,
      segments: Array.isArray(data.segments) ? data.segments : [],
    }
  } catch {
    return emptyResult()
  }
}
