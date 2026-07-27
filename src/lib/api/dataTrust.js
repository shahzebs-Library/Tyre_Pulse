/**
 * Data Trust Centre service - the single Supabase boundary for the KPI
 * confidence layer (V375 `get_data_trust_overview`).
 *
 * AUTH-SENSITIVE: the RPC is SECURITY DEFINER and self-gates server-side on
 * `app_current_org()` + `app_is_active()`, returning `{ok:false,
 * reason:'unauthorized'}` rather than raising. This layer never re-implements
 * that gate; it only relocates the call.
 *
 * DEGRADES, NEVER THROWS: a missing relation or a failed RPC returns a payload
 * shaped exactly like the real one with `ok:false`, so `buildTrustReport` in the
 * pure engine produces an honest empty report and the page renders an empty
 * state instead of an error boundary. A trust panel that crashes is worse than
 * one that says it cannot measure anything.
 */
import { supabase } from './_client'

/** The shape returned whenever the real payload cannot be obtained. */
const unavailable = (reason) => ({ ok: false, reason, countries: [], window: null })

/**
 * Fetch the raw data-quality measures behind every KPI confidence score.
 *
 * Money is returned per country and never summed, because KSA reports in SAR,
 * UAE in AED and Egypt in EGP.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.country] restrict to one country; omit or 'All' for every country
 * @param {string}  [opts.from]    ISO date, start of the expense window (default: trailing 365 days)
 * @param {string}  [opts.to]      ISO date, end of the expense window (default: today)
 * @returns {Promise<{ok:boolean, reason?:string, window:object|null, countries:Array}>}
 */
export async function getDataTrustOverview({ country, from, to } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_data_trust_overview', {
      p_country: country && country !== 'All' ? country : null,
      p_from: from || null,
      p_to: to || null,
    })
    if (error) return unavailable('unavailable')
    if (!data || typeof data !== 'object') return unavailable('unavailable')
    return data
  } catch {
    return unavailable('unavailable')
  }
}
