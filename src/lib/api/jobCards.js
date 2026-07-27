/**
 * Daily job cards - the front page's "what is happening today" read.
 *
 * Sourced from work_orders, which the V381 job card intake fills from the
 * customer's own export. The value it adds over the old job card data is the
 * availability cycle: Production Out, Workshop In, Workshop Out, Production In.
 * Those four let the two halves of downtime be separated for the first time,
 * which is the difference between "the mixer was down 30 hours" and "it waited
 * 26 hours before anyone touched it".
 *
 * @module api/jobCards
 */
import { supabase } from './_client'

const missing = (error) => {
  const m = String(error?.message || error?.code || '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find')
    || m.includes('schema cache') || m === 'pgrst202'
}

/**
 * One call for the whole daily panel. Degrades to { ok:false } when the backend
 * predates V381 so the section simply does not render.
 * @param {{ country?:string, on?:string }} [opts] `on` is a YYYY-MM-DD day.
 */
export async function getDailyJobCards({ country, on } = {}) {
  const { data, error } = await supabase.rpc('get_daily_job_cards', {
    p_country: country && country !== 'All' ? country : null,
    p_on: on || null,
  })
  if (error) {
    if (missing(error)) return { ok: false }
    throw error
  }
  return data && data.ok ? data : { ok: false }
}
