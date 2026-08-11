/**
 * Free-text tyre candidates + tyre-life cap flags - the Supabase boundary for
 * the two reconciliation sections added in V502/V503.
 *
 * WHAT A CANDIDATE IS. Some job cards record a tyre change ONLY as the
 * mechanic's sentence in the work-done box, with no structured tyre row behind
 * it. `extract_tyre_freetext_candidates` reads those sentences and files what it
 * found in `tyre_freetext_candidates`. A row there is a PROPOSAL, never a tyre
 * record - it is not counted anywhere, it does not appear in CPK, and nothing
 * downstream reads it.
 *
 * THE SERIAL IS THE PRODUCT HERE; THE POSITION IS NOT. Owner's ruling, and the
 * text bears it out: the serial numbers read out of these sentences are reliable,
 * the positions are not.
 *   "CHANGE THE TYRE 4TH AXLE LEFT SIDE RHBB1-YMT93964" - the words say left, the
 *   position code says right. The serial is unambiguous; the wheel is not.
 *   "REPAIRED TYRE FIXED IN LHRI & LHRO - YMY10885 & YMA12933" - two positions,
 *   two serials, and which belongs to which is word order, not grammar.
 * So `position_text` is kept only as EVIDENCE of what the sentence said and must
 * not be treated as the tyre's position. It still earns its place in the
 * extraction itself: the position token is what anchors the serial match, which is
 * how the engine avoids dragging in part numbers and job references. Finding a
 * serial by its neighbour is sound; publishing that neighbour as fact is not.
 *
 * `event_kind` is the field that matters most when reviewing. "REPLACED TYRE OLD
 * ONE LHF2-YMY32586" names the tyre that came OFF, not one going on - accepting
 * that as a fitment would put a removed tyre back on the vehicle.
 *
 * AUTH-SENSITIVE: the extractor self-gates on super-admin in the database and is
 * revoked from anon. This layer never re-implements the gate.
 *
 * Reads NEVER throw - they return an empty result so a section can degrade to an
 * honest empty state. The extractor DOES throw, so a real failure is visible.
 */
import { supabase } from './_client'

/** Row shape returned by {@link listFreetextCandidates}. */
export const CANDIDATE_COLS =
  'id,country,job_card,asset_no,job_card_date,position_text,serial_no,brand_text,' +
  'source_text,confidence,serial_is_new,event_kind,status,review_note,created_at'

/**
 * What each `event_kind` means in plain words, for the reviewer.
 * `unclear` is a real answer, not a failure: the sentence says a tyre was
 * changed without saying which one is being named.
 */
export const EVENT_KIND_LABEL = {
  fitted_new: 'New tyre fitted',
  fitted_used: 'Used tyre refitted',
  removed_old: 'Old tyre removed',
  unclear: 'Not stated',
}

/**
 * List extracted candidates.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.country]  country filter; 'All' or blank reads every country the user may see
 * @param {string}  [opts.status]   'pending' | 'accepted' | 'rejected'; blank reads all
 * @param {boolean} [opts.newOnly]  only serials never seen in tyre_records
 * @param {number}  [opts.max]      row ceiling (default 2000)
 * @returns {Promise<{rows: Array<object>, truncated: boolean, error: string|null}>}
 */
export async function listFreetextCandidates({
  country,
  status = 'pending',
  newOnly = false,
  max = 2000,
} = {}) {
  try {
    let q = supabase
      .from('tyre_freetext_candidates')
      .select(CANDIDATE_COLS)
      .order('job_card_date', { ascending: false })
      .order('id')
      .limit(max + 1)

    if (country && country !== 'All') q = q.eq('country', country)
    if (status) q = q.eq('status', status)
    if (newOnly) q = q.eq('serial_is_new', true)

    const { data, error } = await q
    if (error) return { rows: [], truncated: false, error: error.message }
    const all = Array.isArray(data) ? data : []
    return { rows: all.slice(0, max), truncated: all.length > max, error: null }
  } catch {
    return { rows: [], truncated: false, error: null }
  }
}

/**
 * Counts for the section header. Returns nulls rather than zeros when a count
 * could not be read - "we could not look" and "there are none" are opposite
 * statements and must not render alike.
 *
 * @param {object} [opts]
 * @param {string} [opts.country]
 * @returns {Promise<{pending: number|null, newSerials: number|null, accepted: number|null}>}
 */
export async function getFreetextSummary({ country } = {}) {
  const head = async (build) => {
    try {
      const { count, error } = await build()
      return error ? null : (count ?? null)
    } catch {
      return null
    }
  }
  const base = () => {
    let q = supabase
      .from('tyre_freetext_candidates')
      .select('id', { count: 'exact', head: true })
    if (country && country !== 'All') q = q.eq('country', country)
    return q
  }

  const [pending, newSerials, accepted] = await Promise.all([
    head(() => base().eq('status', 'pending')),
    head(() => base().eq('status', 'pending').eq('serial_is_new', true)),
    head(() => base().eq('status', 'accepted')),
  ])
  return { pending, newSerials, accepted }
}

/**
 * Run the extractor. Dry run by default - it reports what it would file and
 * writes nothing. Throws on failure so a real error is visible.
 *
 * @param {boolean} [dryRun=true]
 * @returns {Promise<object>} the RPC's own report
 */
export async function extractFreetextCandidates(dryRun = true) {
  const { data, error } = await supabase.rpc('extract_tyre_freetext_candidates', {
    p_dry_run: dryRun,
  })
  if (error) throw error
  return data || {}
}

/**
 * Record a reviewer's decision on one candidate.
 *
 * This marks the proposal only. It deliberately does NOT create a tyre record:
 * writing one needs a fitment date, meters and a confirmed position, none of
 * which the sentence reliably carries. Accepting here means "this reads as a
 * real tyre event" and hands it to whoever enters it, with the original sentence
 * kept beside it as the evidence.
 *
 * @param {string} id
 * @param {'accepted'|'rejected'} status
 * @param {string} [note]
 * @returns {Promise<void>}
 */
export async function decideCandidate(id, status, note) {
  const { error } = await supabase
    .from('tyre_freetext_candidates')
    .update({
      status,
      review_note: note || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

/**
 * Tyres whose recorded life is above the owner's ceiling for their class
 * (transit mixer 80,000 km, pump 56,000, wheel loader 15,000, everything else
 * 100,000). Flags for correction - nothing here is auto-changed, because an
 * over-cap life is usually a placeholder fitment km rather than a fake tyre.
 *
 * @param {object} [opts]
 * @param {string} [opts.country]
 * @param {number} [opts.max]
 * @returns {Promise<{rows: Array<object>, truncated: boolean}>}
 */
export async function listLifeOverCap({ country, max = 1000 } = {}) {
  try {
    let q = supabase
      .from('v_tyre_life_over_cap')
      .select(
        'id,country,asset_no,tyre_position,serial_no,brand,vehicle_type,' +
          'issue_date,removal_date,km_at_fitment,km_at_removal,total_km,' +
          'life_cap_km,over_by_km,likely_cause',
      )
      .order('over_by_km', { ascending: false })
      .limit(max + 1)
    if (country && country !== 'All') q = q.eq('country', country)

    const { data, error } = await q
    if (error) return { rows: [], truncated: false }
    const all = Array.isArray(data) ? data : []
    return { rows: all.slice(0, max), truncated: all.length > max }
  } catch {
    return { rows: [], truncated: false }
  }
}
