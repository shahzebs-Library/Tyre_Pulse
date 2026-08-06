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

/**
 * A feed whose date column is only the row's insert time answers a DIFFERENT
 * question - "when did the file land" rather than "which day does the data
 * cover" - so a late upload backdates nothing and the squares read as arrival.
 * Say so on the card; a reader who assumes business dates would misread it.
 */
export function feedBasisNote(src) {
  return src?.date_basis === 'arrival'
    ? 'Counted by the day the rows landed in the system, not the day the work happened - this table carries no business date.'
    : ''
}

/* -------------------------------------------------------------------------
 * The watched-feed registry.
 *
 * Coverage used to hardcode four tables, so anything else the owner uploaded
 * could go stale in silence. The feed list now lives in `upload_feeds` and both
 * the panel and the morning alert read it, which is what lets a new table be
 * watched without a code change. Writes are super-admin only (RLS), and a
 * database trigger refuses any table or column that does not exist, so a typo
 * is rejected at the point of saving rather than breaking the whole panel.
 * ---------------------------------------------------------------------- */

const FEED_COLS = 'id,src,label,table_name,date_column,site_column,active,sort_order,site_day_policed,date_basis'

/** Every registered feed, watched or paused. `[]` if the registry is absent. */
export async function listUploadFeeds() {
  const { data, error } = await supabase
    .from('upload_feeds').select(FEED_COLS).order('sort_order').order('src')
  if (error) {
    const m = String(error.message || error.code || '').toLowerCase()
    if (m.includes('does not exist') || m.includes('schema cache') || m.includes('could not find')) return []
    throw error
  }
  return data || []
}

/**
 * Tables that COULD be watched: they carry organisation_id and country (so
 * coverage can scope to the company and a country that stops is not hidden
 * behind the ones that did not) and at least one date column. Super-admin only.
 */
export async function listUploadFeedCandidates() {
  const { data, error } = await supabase.rpc('list_upload_feed_candidates')
  if (error) {
    const m = String(error.message || error.code || '').toLowerCase()
    if (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache')) return []
    throw error
  }
  return Array.isArray(data?.tables) ? data.tables : []
}

/** Add or update one feed. `src` is the stable key the alert dedupes on. */
export async function saveUploadFeed(feed) {
  const row = {
    src: String(feed.src || '').trim(),
    label: String(feed.label || '').trim(),
    table_name: feed.table_name,
    date_column: feed.date_column,
    site_column: feed.site_column || null,
    active: feed.active !== false,
    sort_order: Number.isFinite(Number(feed.sort_order)) ? Number(feed.sort_order) : 100,
    site_day_policed: feed.site_day_policed === true,
    date_basis: feed.date_basis === 'arrival' ? 'arrival' : 'business',
  }
  const q = feed.id
    ? supabase.from('upload_feeds').update(row).eq('id', feed.id)
    : supabase.from('upload_feeds').insert(row)
  const { error } = await q
  if (error) throw error
  return true
}

/**
 * Pause or resume a feed. Pausing is the right move for a table that genuinely
 * stopped being uploaded on purpose - deleting the row would lose the label and
 * the alert's dedupe history along with it.
 */
export async function setUploadFeedActive(id, active) {
  const { error } = await supabase.from('upload_feeds').update({ active: !!active }).eq('id', id)
  if (error) throw error
  return true
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
