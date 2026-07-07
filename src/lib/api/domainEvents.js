/**
 * Domain Events service - read-only boundary over the V94 event-driven
 * architecture tables: the `domain_events` transactional outbox (Event Log UI)
 * and the `event_consumers` registry. All writes happen server-side via
 * SECURITY DEFINER functions / pg_cron; RLS limits reads to elevated users in
 * their organisation. Explicit column lists (no SELECT *), unwrap error
 * surfacing, mirrors alertThresholds.js.
 */
import { supabase, unwrap } from './_client'
import { sanitizeSearchTerm } from '../searchFilter'

// Least-privilege column set for the Event Log (list + detail drawer).
// Omits organisation_id / actor_id (RLS-scoped, never rendered).
const EVENT_COLS =
  'id,event_type,entity_type,entity_id,payload,status,attempts,last_error,created_at,processed_at'

// event_consumers registry columns (admin diagnostics view).
const CONSUMER_COLS = 'consumer,event_types,enabled,description,created_at'

/**
 * One page of domain events (exact count), newest first, with optional
 * event-type / status filters and a free-text search across event_type,
 * entity_type and entity_id.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=50]       page size
 * @param {number} [opts.offset=0]       range start (inclusive)
 * @param {string|null} [opts.eventType] exact event_type filter
 * @param {string|null} [opts.status]    'pending' | 'processed' | 'failed'
 * @param {string} [opts.search]         free-text search term
 * @returns {Promise<{rows: Array<object>, count: number}>}
 */
export async function listDomainEvents({
  limit = 50,
  offset = 0,
  eventType = null,
  status = null,
  search = '',
} = {}) {
  let q = supabase
    .from('domain_events')
    .select(EVENT_COLS, { count: 'exact' })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1)

  if (eventType) q = q.eq('event_type', eventType)
  if (status) q = q.eq('status', status)
  if (search) {
    const s = sanitizeSearchTerm(search)
    if (s) {
      q = q.or(`event_type.ilike.%${s}%,entity_type.ilike.%${s}%,entity_id.ilike.%${s}%`)
    }
  }

  const result = await q
  const rows = unwrap(result) ?? []
  return { rows, count: result.count ?? 0 }
}

/**
 * Distinct event types observed recently, for the Event Log filter dropdown.
 * Reads the last 500 events' event_type and dedupes client-side (cheap on the
 * partial/type indexes; avoids a full-table DISTINCT scan).
 * @returns {Promise<string[]>} sorted unique event types
 */
export async function listEventTypes() {
  const rows = unwrap(
    await supabase
      .from('domain_events')
      .select('event_type')
      .order('id', { ascending: false })
      .limit(500)
  )
  return [...new Set((rows ?? []).map(r => r.event_type).filter(Boolean))].sort()
}

/**
 * List registered event consumers (workflows, webhooks, rules, embeddings...)
 * with their subscriptions and enabled state, alphabetically.
 */
export async function listEventConsumers() {
  return unwrap(
    await supabase
      .from('event_consumers')
      .select(CONSUMER_COLS)
      .order('consumer', { ascending: true })
  )
}
