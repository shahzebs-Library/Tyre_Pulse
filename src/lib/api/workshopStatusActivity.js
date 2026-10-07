/**
 * Workshop Status -> Activity log and Team workload reads (Loop 10).
 *
 * Read-only. Everything goes through RLS: workshop_status_events is readable
 * in full only with the view_activity permission (without it a person sees
 * their own events and the history of records they can see), and org,
 * country and site isolation apply on top. Nothing here mutates.
 *
 * The activity log is keyset paged newest first (created_at desc, id desc) so
 * "Load more" can never drop or repeat a row at a page boundary, and each page
 * is bounded well below the 1000-row server cap. Server-side filters are used
 * for everything the events table itself carries; the record's current stage
 * and delay reason are joined client-side (see activityView.filterActivity).
 */
import { supabase, fetchAllPages, toServiceError } from './_client'
import { escapeLike } from '../searchFilter'
import { loadPeopleNames, loadActiveVehicles } from './workshopStatusActive'
import { collectPersonIds, serverFilterFor, shapeActivity } from '../workshopStatus/activityView'

export const ACTIVITY_PAGE_SIZE = 100
const MAX_PAGE = 500
const LOOKUP_CHUNK = 200
const RECENT_UPLOADS = 100

const EVENT_COLS = [
  'id', 'country', 'site', 'record_id', 'asset_no', 'upload_id', 'event_type', 'field_name',
  'old_value', 'new_value', 'reason', 'source', 'details', 'actor_id', 'actor_name', 'created_at',
].join(',')
const RECORD_COLS = 'id,asset_no,country,site,current_stage,delay_reason,daily_report_status,current_active,deleted_at'
const UPLOAD_COLS = 'id,upload_no,file_name,status,uploaded_at,uploaded_by_name,confirmed_at,confirmed_by_name,report_date,country'

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

function uniqueIds(values) {
  const out = []
  const seen = new Set()
  for (const v of values || []) {
    if (blank(v)) continue
    const s = String(v)
    if (!seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out
}

function chunks(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Rows of `table` by id, in chunks: Map(id -> row). Best effort (a failed read leaves the join empty). */
async function loadById(table, cols, ids) {
  const out = new Map()
  for (const part of chunks(uniqueIds(ids), LOOKUP_CHUNK)) {
    const { data, error } = await fetchAllPages((from, to) =>
      supabase.from(table).select(cols).in('id', part).order('id', { ascending: true }).range(from, to),
    { max: LOOKUP_CHUNK })
    if (error) return out
    for (const row of data || []) out.set(String(row.id), row)
  }
  return out
}

/**
 * One page of the activity log, joined to record, upload and people.
 *
 * @param {object} p
 * @param {string} [p.from]      ISO lower bound on created_at (inclusive)
 * @param {string} [p.to]        ISO upper bound on created_at (exclusive)
 * @param {string} [p.userId]    actor profile id
 * @param {string} [p.assetNo]   vehicle (partial, case-insensitive)
 * @param {string} [p.site]
 * @param {string} [p.eventType] action group key (activityView.ACTION_GROUPS)
 * @param {string} [p.uploadId]
 * @param {string} [p.country]   blank / 'All' = every country the caller may see
 * @param {number} [p.limit]
 * @param {{ at: string, id: string }} [p.before]  keyset cursor from the previous page
 * @returns {Promise<{ rows: object[], hasMore: boolean, truncated: boolean, nextCursor: { at: string, id: string } | null }>}
 */
export async function listActivity({
  from, to, userId, assetNo, site, eventType, uploadId, country, limit = ACTIVITY_PAGE_SIZE, before,
} = {}) {
  const size = Math.max(1, Math.min(MAX_PAGE, Number(limit) || ACTIVITY_PAGE_SIZE))
  let q = supabase.from('workshop_status_events').select(EVENT_COLS)
  if (!blank(from)) q = q.gte('created_at', from)
  if (!blank(to)) q = q.lt('created_at', to)
  if (!blank(userId)) q = q.eq('actor_id', userId)
  if (!blank(assetNo)) {
    const term = String(assetNo).replace(/\s+/g, '').toUpperCase()
    if (term) q = q.ilike('asset_no', `%${escapeLike(term)}%`)
  }
  if (!blank(site)) q = q.eq('site', String(site))
  if (!blank(uploadId)) q = q.eq('upload_id', uploadId)
  if (!blank(country) && country !== 'All') q = q.eq('country', String(country).trim())
  const f = blank(eventType) ? null : serverFilterFor(eventType)
  if (f) {
    q = q.in('event_type', f.eventTypes)
    if (f.fields) q = q.in('field_name', f.fields)
    if (f.excludeFields) q = q.not('field_name', 'in', `(${f.excludeFields.join(',')})`)
  }
  // PostgREST logic trees: at most one `or` param, so two groups are AND-ed
  // inside a single tree rather than sent as two repeated params.
  const orGroups = []
  if (f?.orFilter) orGroups.push(f.orFilter)
  if (before?.at && before?.id) {
    const at = `"${String(before.at)}"`
    orGroups.push(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${before.id})`)
  }
  if (orGroups.length === 1) q = q.or(orGroups[0])
  else if (orGroups.length > 1) q = q.or(`and(${orGroups.map((g) => `or(${g})`).join(',')})`)
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(size + 1)
  if (error) throw toServiceError(error, 'Could not load the workshop activity log.')

  const all = data || []
  const hasMore = all.length > size
  const events = hasMore ? all.slice(0, size) : all

  const [records, uploads, people] = await Promise.all([
    loadById('workshop_status_records', RECORD_COLS, events.map((e) => e.record_id)),
    loadById('workshop_status_uploads', UPLOAD_COLS, events.map((e) => e.upload_id)),
    loadPeopleNames(collectPersonIds(events)),
  ])
  const rows = shapeActivity(events, { records, uploads, people })
  const last = events[events.length - 1]
  return {
    rows,
    people,
    hasMore,
    truncated: hasMore,
    nextCursor: hasMore && last ? { at: last.created_at, id: last.id } : null,
  }
}

/**
 * Recent uploads for the upload filter: [{ id, upload_no, file_name, ... }],
 * newest first, bounded to the last RECENT_UPLOADS files.
 */
export async function listRecentUploads({ country } = {}) {
  let q = supabase.from('workshop_status_uploads').select(UPLOAD_COLS)
  if (!blank(country) && country !== 'All') q = q.eq('country', String(country).trim())
  const { data, error } = await q
    .order('uploaded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(RECENT_UPLOADS)
  if (error) throw toServiceError(error, 'Could not load the workshop uploads.')
  return data || []
}

/**
 * Records for the Team workload view: the active report with responsible
 * names joined (reuses the Active vehicles read, so both screens agree).
 */
export async function loadWorkloadRecords({ country } = {}) {
  return loadActiveVehicles({ country })
}
