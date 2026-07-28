/**
 * Upload coverage - "did yesterday's file actually arrive, and for where?".
 *
 * The daily files are uploaded by hand, so a missed day is otherwise silent:
 * the app simply shows less data and nothing says why. This reads a per-country,
 * per-source, per-area, per-day grid so a gap is visible instead of inferred.
 *
 * The date used is the BUSINESS date of the row, not when it was inserted, so
 * "no data covering Tuesday" is the question being answered. A file uploaded
 * late still fills its own day and correctly stops being reported as missing.
 *
 * The earlier flat reader was removed rather than kept alongside: it aggregated
 * every country into one figure, which is the defect this replaced. The server
 * function it called still exists and is what the morning cron notice reads.
 *
 * @module api/uploadCoverage
 */
import { supabase } from './_client'

const EMPTY_DETAIL = { ok: false, countries: [], files: [] }

/**
 * The same question asked per COUNTRY and per AREA (V394).
 *
 * The flat version aggregates every country, which hides the case that matters:
 * one country stops uploading and the others carry the total, so the panel
 * reads healthy. Measured at build time - KSA job cards had been silent for
 * three weeks while Egypt and UAE ran to yesterday, and the old view reported
 * the newest date of the three.
 *
 * @param {{ days?:number, country?:string }} [opts]
 * @returns {Promise<{ok:boolean, countries:Array, files:Array, today?:string}>}
 */
export async function getUploadCoverageDetail({ days = 30, country } = {}) {
  const { data, error } = await supabase.rpc('get_upload_coverage_detail', {
    p_days: days,
    p_country: country && country !== 'All' ? country : null,
  })
  if (error) {
    const m = String(error.message || error.code || '').toLowerCase()
    // pre-V394 backend: show "not available yet", never an error page
    if (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache')) return EMPTY_DETAIL
    throw error
  }
  if (!data || data.ok !== true) return EMPTY_DETAIL
  return {
    ...data,
    countries: Array.isArray(data.countries) ? data.countries : [],
    files: Array.isArray(data.files) ? data.files : [],
  }
}

/**
 * Why a feed is or is not being policed, in the user's words.
 *
 * Two rules, and they are deliberately disjoint. A DAILY feed is judged on the
 * days it skipped. A non-daily feed cannot be - it was never meant to arrive
 * every day - so it is judged against its own typical gap instead. Saying both
 * about the same feed double counts every weekend.
 */
export function feedCadenceLabel(src) {
  if (!src) return ''
  const base = src.base_data_days
  if (src.expect_daily) {
    return `Arrives daily - data on ${base} days in the last 6 months`
  }
  const gap = Number(src.typical_gap_days) || 1
  return `Arrives in batches - normally at most ${gap} day${gap === 1 ? '' : 's'} between uploads`
}

/** The one-line state of a feed, or '' when there is nothing wrong with it. */
export function feedProblem(src) {
  if (!src) return ''
  if (src.expect_daily && Number(src.missing_count) > 0) {
    const n = Number(src.missing_count)
    return `${n} day${n === 1 ? '' : 's'} with no upload`
  }
  if (src.quiet) {
    const d = Number(src.days_since_last)
    return `Nothing for ${d} day${d === 1 ? '' : 's'}, longer than usual for this feed`
  }
  return ''
}

/**
 * Areas that missed a day their own country and source DID receive. A site is
 * never blamed for a day nobody uploaded, and a site dormant across the whole
 * recent window is reported as dormant rather than missing - a closed site must
 * not alarm forever.
 */
export function problemAreas(src) {
  return (src?.sites || []).filter((s) => !s.dormant && Number(s.missing_count) > 0)
}

/** Countries worst first: most problems, then most rows at stake. */
export function sortCountries(countries = []) {
  return [...(countries || [])].sort((a, b) => {
    const pa = (Number(a.missing_count) || 0) + (Number(a.quiet_count) || 0)
    const pb = (Number(b.missing_count) || 0) + (Number(b.quiet_count) || 0)
    if (pa !== pb) return pb - pa
    return (Number(b.total_rows) || 0) - (Number(a.total_rows) || 0)
  })
}
