/**
 * Daily upload coverage - "did yesterday's file actually arrive?".
 *
 * The daily files are uploaded by hand, so a missed day is otherwise silent:
 * the app simply shows less data and nothing says why. This reads a per-source,
 * per-day grid so a gap is visible instead of inferred.
 *
 * The date used is the BUSINESS date of the row, not when it was inserted, so
 * "no data covering Tuesday" is the question being answered. A file uploaded
 * late still fills its own day and correctly stops being reported as missing.
 *
 * @module api/uploadCoverage
 */
import { supabase } from './_client'

const EMPTY = { ok: false, sources: [], alerts: [] }

/**
 * @param {{ days?:number, country?:string }} [opts]
 * @returns {Promise<{ok:boolean, today?:string, sources:Array, alerts:Array}>}
 */
export async function getUploadCoverage({ days = 30, country } = {}) {
  const { data, error } = await supabase.rpc('get_upload_coverage', {
    p_days: days,
    p_country: country && country !== 'All' ? country : null,
  })
  if (error) {
    const m = String(error.message || error.code || '').toLowerCase()
    // pre-V389 backend: the tab shows a "not available yet" state, not an error
    if (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache')) return EMPTY
    throw error
  }
  if (!data || data.ok !== true) return EMPTY
  return {
    ...data,
    sources: Array.isArray(data.sources) ? data.sources : [],
    alerts: Array.isArray(data.alerts) ? data.alerts : [],
  }
}

/**
 * A source is only worth policing if it has actually behaved like a daily feed.
 * The server decides this from history (`expect_daily`); this mirrors the label
 * so the UI can explain WHY something is or is not being watched, rather than
 * showing a rule the user has to guess at.
 */
export function cadenceLabel(src) {
  if (!src) return ''
  if (src.expect_daily) {
    return `Watched daily - arrived on ${src.days_with_data} of the last ${src.days_elapsed} days`
  }
  return `Not watched - only ${src.days_with_data} of the last ${src.days_elapsed} days have data, so this is not a daily feed`
}

/** Worst-first, so the thing most likely to be forgotten is at the top. */
export function sortByUrgency(sources = []) {
  return [...sources].sort((a, b) => {
    if (a.expect_daily !== b.expect_daily) return a.expect_daily ? -1 : 1
    return (b.days_since_last ?? -1) - (a.days_since_last ?? -1)
  })
}
