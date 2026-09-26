/**
 * Event Stream analytics - pure helpers (no I/O, deterministic).
 *
 * Works over `domain_events` rows as returned by src/lib/api/domainEvents.js
 * (`id, event_type, entity_type, entity_id, payload, status, attempts,
 * last_error, created_at, processed_at`) and `event_consumers` rows
 * (`consumer, event_types, enabled, description, created_at`).
 *
 * HONESTY: the page analyses a RECENT SAMPLE (the newest N events), not the
 * whole outbox. When the sample is full, any window reaching past its oldest
 * event is incomplete, and the figure is reported as a lower bound rather than
 * as a measurement. Exact status totals come from server counts and are passed
 * in separately; a count that could not be read is null, never 0.
 *
 * Every time-dependent function takes an injectable `now`.
 */

export const EVENT_STATUSES = ['pending', 'processed', 'failed']

export const EVENT_STATUS_LABEL = {
  pending: 'Pending',
  processed: 'Processed',
  failed: 'Failed',
}

/** Default size of the recent sample the page loads for analysis. */
export const EVENT_SAMPLE_LIMIT = 500

const MS_HOUR = 3600000
const MS_DAY = 86400000

function toMs(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

function nowMs(now) {
  const t = toMs(now == null ? new Date() : now)
  return t == null ? Date.now() : t
}

function list(v) {
  return Array.isArray(v) ? v : []
}

function normStatus(s) {
  const v = String(s || '').toLowerCase()
  return EVENT_STATUSES.includes(v) ? v : 'unknown'
}

function finiteCount(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Status counts across a list of events (unrecognised statuses go to `unknown`). */
export function statusCounts(events) {
  const out = { pending: 0, processed: 0, failed: 0, unknown: 0 }
  for (const e of list(events)) out[normStatus(e?.status)] += 1
  return out
}

/**
 * Coverage of a sample: how many events it holds, its oldest/newest
 * timestamps, and whether it was capped (so older history is missing).
 */
export function sampleCoverage(events, { limit = EVENT_SAMPLE_LIMIT } = {}) {
  const times = list(events).map((e) => toMs(e?.created_at)).filter((t) => t != null)
  const size = list(events).length
  return {
    size,
    oldestMs: times.length ? Math.min(...times) : null,
    newestMs: times.length ? Math.max(...times) : null,
    truncated: limit > 0 && size >= limit,
  }
}

/**
 * Events per type in the sample, busiest first, with failed/pending counts,
 * the share of the sample and the most recent occurrence.
 */
export function eventsByType(events) {
  const map = new Map()
  const all = list(events)
  for (const e of all) {
    const type = e?.event_type || 'unknown'
    const row = map.get(type) || { type, count: 0, failed: 0, pending: 0, processed: 0, lastMs: null }
    row.count += 1
    const s = normStatus(e?.status)
    if (s === 'failed') row.failed += 1
    else if (s === 'pending') row.pending += 1
    else if (s === 'processed') row.processed += 1
    const t = toMs(e?.created_at)
    if (t != null && (row.lastMs == null || t > row.lastMs)) row.lastMs = t
    map.set(type, row)
  }
  const total = all.length
  return [...map.values()]
    .map((r) => ({ ...r, share: total > 0 ? r.count / total : null, failureRate: r.count > 0 ? r.failed / r.count : null }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
}

/**
 * Hourly volume for the last `hours` hours ending at `now` (oldest first).
 * Buckets older than the oldest event of a TRUNCATED sample are marked
 * `complete: false`, because the sample simply does not reach them.
 */
export function volumeByHour(events, { now, hours = 24, limit = EVENT_SAMPLE_LIMIT } = {}) {
  return bucketVolume(events, { now, count: hours, size: MS_HOUR, limit, label: (d) => `${pad2(d.getHours())}:00` })
}

/** Daily volume for the last `days` days ending at `now` (oldest first). */
export function volumeByDay(events, { now, days = 7, limit = EVENT_SAMPLE_LIMIT } = {}) {
  return bucketVolume(events, {
    now, count: days, size: MS_DAY, limit,
    label: (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`,
  })
}

function bucketVolume(events, { now, count, size, limit, label }) {
  const end = nowMs(now)
  const cov = sampleCoverage(events, { limit })
  const buckets = []
  for (let i = count - 1; i >= 0; i--) {
    const to = end - i * size
    const from = to - size
    buckets.push({
      fromMs: from,
      toMs: to,
      label: label(new Date(from)),
      count: 0,
      failed: 0,
      complete: !cov.truncated || (cov.oldestMs != null && cov.oldestMs <= from),
    })
  }
  for (const e of list(events)) {
    const t = toMs(e?.created_at)
    if (t == null || t > end) continue
    const idx = count - 1 - Math.floor((end - t) / size)
    if (idx < 0 || idx >= count) continue
    // Guard the upper edge: floor maps t == end - k*size into the newer bucket.
    const b = buckets[idx]
    if (t < b.fromMs || t > b.toMs) continue
    b.count += 1
    if (normStatus(e?.status) === 'failed') b.failed += 1
  }
  return buckets
}

/**
 * Throughput over the last `hours` hours. When the sample was capped before
 * reaching the start of the window the count is a LOWER BOUND
 * (`complete: false`) and must be shown as "at least".
 */
export function throughput(events, { now, hours = 24, limit = EVENT_SAMPLE_LIMIT } = {}) {
  const end = nowMs(now)
  const start = end - hours * MS_HOUR
  const cov = sampleCoverage(events, { limit })
  const count = list(events).filter((e) => {
    const t = toMs(e?.created_at)
    return t != null && t >= start && t <= end
  }).length
  const complete = !cov.truncated || (cov.oldestMs != null && cov.oldestMs <= start)
  return {
    hours,
    count,
    perHour: hours > 0 ? count / hours : null,
    perDay: hours > 0 ? (count / hours) * 24 : null,
    complete,
  }
}

/** Age in ms of the newest event relative to `now`, or null when unknown. */
export function lastEventAgeMs(events, { now } = {}) {
  const cov = sampleCoverage(events, { limit: 0 })
  if (cov.newestMs == null) return null
  return Math.max(0, nowMs(now) - cov.newestMs)
}

/** Plain-English age ("4 min", "3 h", "2 days"), or 'N/A'. */
export function formatAge(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'N/A'
  if (ms < 60000) return 'under 1 min'
  if (ms < MS_HOUR) return `${Math.floor(ms / 60000)} min`
  if (ms < MS_DAY) return `${Math.floor(ms / MS_HOUR)} h`
  const d = Math.floor(ms / MS_DAY)
  return `${d} day${d === 1 ? '' : 's'}`
}

/**
 * Consumer health from the registry plus the sample. A consumer subscribes to
 * its `event_types`, or to every event when that list is empty.
 *   disabled  - the consumer is switched off
 *   attention - enabled, but an event it subscribes to is failed or still pending
 *   healthy   - enabled, nothing failed or pending in the sample for it
 */
export function consumerHealth(consumers, events) {
  const evs = list(events)
  return list(consumers).map((c) => {
    const types = list(c?.event_types).filter(Boolean)
    const matches = types.length ? evs.filter((e) => types.includes(e?.event_type)) : evs
    let failed = 0
    let pending = 0
    for (const e of matches) {
      const s = normStatus(e?.status)
      if (s === 'failed') failed += 1
      else if (s === 'pending') pending += 1
    }
    const enabled = c?.enabled !== false
    const state = !enabled ? 'disabled' : failed > 0 || pending > 0 ? 'attention' : 'healthy'
    return {
      consumer: c?.consumer || 'unknown',
      description: c?.description || '',
      enabled,
      subscribesAll: types.length === 0,
      eventTypes: types,
      matched: matches.length,
      failed,
      pending,
      state,
    }
  })
}

/**
 * Headline KPIs.
 * @param {object} args
 * @param {Array} args.events         recent sample (newest first or any order)
 * @param {object} [args.totals]      exact server counts { all, pending, processed, failed } (null = unread)
 * @param {Array} [args.consumers]    event_consumers rows (null = unread)
 */
export function eventStreamKpis({ events, totals = {}, consumers = null, now, limit = EVENT_SAMPLE_LIMIT } = {}) {
  const all = finiteCount(totals.all)
  const pending = finiteCount(totals.pending)
  const failed = finiteCount(totals.failed)
  const processed = finiteCount(totals.processed)
  const day = throughput(events, { now, hours: 24, limit })
  const health = consumers == null ? null : consumerHealth(consumers, events)
  return {
    total: all,
    pending,
    failed,
    processed,
    failureRate: all != null && failed != null && all > 0 ? failed / all : null,
    lastEventAgeMs: lastEventAgeMs(events, { now }),
    eventsLast24h: day.count,
    perHour: day.perHour,
    windowComplete: day.complete,
    distinctTypes: eventsByType(events).length,
    consumers: health == null ? null : health.length,
    consumersDisabled: health == null ? null : health.filter((h) => h.state === 'disabled').length,
    consumersAttention: health == null ? null : health.filter((h) => h.state === 'attention').length,
    sample: sampleCoverage(events, { limit }),
  }
}

/** Rows for Excel/PDF export (ASCII, empty values read N/A). */
export const EVENT_EXPORT_COLS = ['created_at', 'event_type', 'entity', 'status', 'attempts', 'processed_at', 'last_error']
export const EVENT_EXPORT_HEADERS = ['Time', 'Event Type', 'Entity', 'Status', 'Attempts', 'Processed At', 'Last Error']

export function eventExportRows(events) {
  return list(events).map((e) => ({
    created_at: e?.created_at || 'N/A',
    event_type: e?.event_type || 'N/A',
    entity: e?.entity_type ? `${e.entity_type}${e.entity_id ? ` #${e.entity_id}` : ''}` : 'N/A',
    status: EVENT_STATUS_LABEL[normStatus(e?.status)] || 'Unknown',
    attempts: finiteCount(e?.attempts) ?? 'N/A',
    processed_at: e?.processed_at || 'N/A',
    last_error: e?.last_error || 'N/A',
  }))
}
