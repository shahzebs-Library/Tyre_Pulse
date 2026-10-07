/**
 * Workshop Status vehicle history service (Loop 9, spec section 14).
 *
 * READ ONLY. public.workshop_status_events is append-only in the database
 * (UPDATE / DELETE / TRUNCATE raise for every role, including the record
 * owner and super admins), and authenticated holds SELECT only. Nothing in
 * this module writes to it.
 *
 * Visibility is RLS (migration 20261007100000, workshop_status_events_read):
 * the module, then view_activity, the caller's own events, or the history of
 * a record the caller can see under org / country / site scope.
 */
import { supabase, toServiceError } from './_client'
import { collectPersonIds } from '../workshopStatus/history'

const EVENT_COLS = 'id,record_id,asset_no,upload_id,event_type,field_name,old_value,new_value,reason,source,details,actor_id,actor_name,created_at'
const DEFAULT_PAGE = 60
const MAX_PAGE = 200
const PROFILE_CHUNK = 100

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

/**
 * One page of a record's history, newest first (created_at desc, id desc).
 *
 * Every row one action writes shares ONE created_at (the transaction time),
 * so a page must never end in the middle of that timestamp: a full page drops
 * its oldest timestamp and the next page starts AT it (inclusive). Only when a
 * whole page shares one timestamp is it returned as is and the next page
 * starts strictly before it.
 *
 * Resolves to { events, hasMore, nextBefore, nextInclusive }.
 */
export async function listRecordHistory(recordId, { limit = DEFAULT_PAGE, before = null, inclusive = false } = {}) {
  if (blank(recordId)) return { events: [], hasMore: false, nextBefore: null, nextInclusive: false }
  const size = Math.max(1, Math.min(Number(limit) || DEFAULT_PAGE, MAX_PAGE))
  let q = supabase.from('workshop_status_events').select(EVENT_COLS).eq('record_id', recordId)
  if (!blank(before)) q = inclusive ? q.lte('created_at', before) : q.lt('created_at', before)
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, size)
  if (error) throw toServiceError(error, 'Could not load the vehicle history.')
  const rows = data || []
  if (rows.length <= size) return { events: rows, hasMore: false, nextBefore: null, nextInclusive: false }

  const page = rows.slice(0, size)
  const oldest = page[page.length - 1].created_at
  const kept = page.filter((r) => r.created_at !== oldest)
  if (kept.length) return { events: kept, hasMore: true, nextBefore: oldest, nextInclusive: true }
  return { events: page, hasMore: true, nextBefore: oldest, nextInclusive: false }
}

/**
 * Display names for the person ids found in a set of events. Profiles are
 * scoped to the caller's organisation by RLS; an id that cannot be read stays
 * out of the map and renders as "Unknown person".
 */
export async function resolveHistoryNames(events) {
  const ids = collectPersonIds(events)
  const out = {}
  for (let i = 0; i < ids.length; i += PROFILE_CHUNK) {
    const chunk = ids.slice(i, i + PROFILE_CHUNK)
    const { data, error } = await supabase
      .from('profiles').select('id,full_name,username').in('id', chunk).limit(PROFILE_CHUNK)
    if (error) throw toServiceError(error, 'Could not load the names in the history.')
    for (const p of data || []) {
      const name = (p.full_name && String(p.full_name).trim()) || (p.username && String(p.username).trim()) || ''
      if (p.id && name) out[p.id] = name
    }
  }
  return out
}
