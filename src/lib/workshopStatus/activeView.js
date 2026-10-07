/**
 * Workshop Status -> Active Vehicles view engine (Loop 7). Pure: no I/O, and
 * every clock-dependent function takes `now` so tests are deterministic.
 *
 * Honesty rules:
 *  - days down is null when it cannot be measured (no OOC date and no Excel
 *    figure, or a future date). It is never invented as 0.
 *  - freshness is judged on last_manual_update_at only: an Excel refresh is not
 *    a person looking at the vehicle, so a record touched only by uploads reads
 *    "never updated by a person".
 */

export const DAY_MS = 24 * 60 * 60 * 1000
export const DAYS_DOWN_THRESHOLDS = Object.freeze([3, 7, 14])
export const UNASSIGNED = '__unassigned__'
export const FRESHNESS = Object.freeze({ TODAY: 'today', STALE: 'stale', NEVER: 'never' })
export const SORT_KEYS = Object.freeze(['days', 'asset', 'site', 'stage', 'updated', 'expected'])

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')
const pad = (n) => String(n).padStart(2, '0')

function toDate(now) {
  if (now instanceof Date) return now
  if (now == null) return new Date()
  return new Date(now)
}

/** Local calendar day of `d` as yyyy-mm-dd. Never toISOString (that is UTC). */
export function localDay(d) {
  const x = toDate(d)
  if (Number.isNaN(x.getTime())) return null
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

/** A date-only value (yyyy-mm-dd...) as local midnight, or null. */
function parseDay(v) {
  if (blank(v)) return null
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** A timestamp (ISO) as a Date, or null. */
function parseTs(v) {
  if (blank(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** The local calendar day of a timestamp/date value, or null. */
function dayOf(v) {
  if (blank(v)) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v)
  const d = parseTs(v)
  return d ? localDay(d) : null
}

/**
 * Whole days the vehicle has been down, from ooc_since. Falls back to the
 * Excel's own down-days figure when the file carried no date. Null when
 * neither is usable (or the date is in the future).
 */
export function daysDown(record, now) {
  const since = parseDay(record?.ooc_since)
  if (since) {
    const today = parseDay(localDay(now))
    const diff = Math.round((today.getTime() - since.getTime()) / DAY_MS)
    return diff >= 0 ? diff : null
  }
  const x = record?.excel_down_days
  if (x == null || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

/** today | stale | never, judged on the last manual (person) update. */
export function freshness(record, now) {
  const day = dayOf(record?.last_manual_update_at)
  if (!day) return FRESHNESS.NEVER
  return day === localDay(now) ? FRESHNESS.TODAY : FRESHNESS.STALE
}

/** When the record last changed and through which channel. */
export function lastUpdate(record) {
  const at = record?.last_manual_update_at || record?.excel_updated_at || record?.updated_at || null
  return {
    at,
    by: blank(record?.last_updated_by_name) ? null : String(record.last_updated_by_name).trim(),
    source: blank(record?.last_update_source) ? null : String(record.last_update_source),
  }
}

/** "07 Oct 2026" from a date or timestamp, or null. */
export function fmtDay(v) {
  if (blank(v)) return null
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? parseDay(v) : parseTs(v)
  if (!d) return null
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "07 Oct 2026, 09:42" (local time, 24h) from a timestamp, or null. */
export function fmtDateTime(v) {
  const d = parseTs(v)
  if (!d) return null
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function norm(v) {
  return String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Empty filter state. */
export function emptyFilters() {
  return {
    search: '',
    site: '',
    stage: '',
    delayReason: '',
    partsStatus: '',
    responsible: '',
    minDays: null,
    updated: '', // '' | 'today' | 'not_today'
    expectedToday: false,
    country: '',
  }
}

/** How many filters (other than search) are active. */
export function activeFilterCount(filters) {
  const f = filters || {}
  let n = 0
  for (const k of ['site', 'stage', 'delayReason', 'partsStatus', 'responsible', 'updated', 'country']) {
    if (!blank(f[k])) n += 1
  }
  if (f.minDays) n += 1
  if (f.expectedToday) n += 1
  return n
}

function matchesSearch(r, q) {
  if (!q) return true
  const compactQ = q.replace(/\s+/g, '')
  const hay = [r.asset_no, r.reg_no, r.complaint, r.site, r.job_card_ref]
  return hay.some((h) => {
    const s = norm(h)
    return s.includes(q) || s.replace(/\s+/g, '').includes(compactQ)
  })
}

/**
 * Apply the filter state. A record whose value is missing never matches an
 * active filter on that dimension, except `responsible === UNASSIGNED`, which
 * selects exactly the records with nobody responsible.
 */
export function filterRecords(records, filters, { now } = {}) {
  const f = { ...emptyFilters(), ...(filters || {}) }
  const q = norm(f.search)
  const today = localDay(now)
  return (records || []).filter((r) => {
    if (!r) return false
    if (!matchesSearch(r, q)) return false
    if (f.country && norm(r.country) !== norm(f.country)) return false
    if (f.site && norm(r.site) !== norm(f.site)) return false
    if (f.stage && norm(r.current_stage) !== norm(f.stage)) return false
    if (f.delayReason && norm(r.delay_reason) !== norm(f.delayReason)) return false
    if (f.partsStatus && norm(r.parts_status) !== norm(f.partsStatus)) return false
    if (f.responsible) {
      if (f.responsible === UNASSIGNED) { if (!blank(r.responsible_user_id)) return false }
      else if (String(r.responsible_user_id ?? '') !== String(f.responsible)) return false
    }
    if (f.minDays) {
      const d = daysDown(r, now)
      if (d == null || d <= Number(f.minDays)) return false
    }
    if (f.updated === 'today' && freshness(r, now) !== FRESHNESS.TODAY) return false
    if (f.updated === 'not_today' && freshness(r, now) === FRESHNESS.TODAY) return false
    if (f.expectedToday && dayOf(r.expected_release_date) !== today) return false
    return true
  })
}

function sortValue(r, key, now) {
  switch (key) {
    case 'days': return daysDown(r, now)
    case 'asset': return blank(r.asset_no) ? null : String(r.asset_no)
    case 'site': return blank(r.site) ? null : String(r.site)
    case 'stage': return blank(r.current_stage) ? null : String(r.current_stage)
    case 'updated': { const d = parseTs(lastUpdate(r).at); return d ? d.getTime() : null }
    case 'expected': { const d = parseDay(r.expected_release_date); return d ? d.getTime() : null }
    default: return null
  }
}

/**
 * Stable sort. Missing values ALWAYS sort last, in both directions, so an
 * unmeasured vehicle never masquerades as the longest or shortest down.
 * Ties break on asset number then id.
 */
export function sortRecords(records, { key = 'days', dir = 'desc' } = {}, { now } = {}) {
  const k = SORT_KEYS.includes(key) ? key : 'days'
  const sign = dir === 'asc' ? 1 : -1
  return [...(records || [])].sort((a, b) => {
    const va = sortValue(a, k, now)
    const vb = sortValue(b, k, now)
    if (va == null && vb != null) return 1
    if (vb == null && va != null) return -1
    if (va != null && vb != null && va !== vb) {
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      if (c !== 0) return c * sign
    }
    const ca = String(a.asset_no ?? '').localeCompare(String(b.asset_no ?? ''))
    if (ca !== 0) return ca
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
}

/** Counts for the KPI tiles. */
export function summarize(records, { now } = {}) {
  const out = {
    total: 0, updatedToday: 0, notUpdatedToday: 0, neverUpdated: 0,
    over3: 0, over7: 0, over14: 0, unknownDays: 0, expectedToday: 0, unassigned: 0,
  }
  const today = localDay(now)
  for (const r of records || []) {
    if (!r) continue
    out.total += 1
    const fr = freshness(r, now)
    if (fr === FRESHNESS.TODAY) out.updatedToday += 1
    else out.notUpdatedToday += 1
    if (fr === FRESHNESS.NEVER) out.neverUpdated += 1
    const d = daysDown(r, now)
    if (d == null) out.unknownDays += 1
    else {
      if (d > 3) out.over3 += 1
      if (d > 7) out.over7 += 1
      if (d > 14) out.over14 += 1
    }
    if (dayOf(r.expected_release_date) === today) out.expectedToday += 1
    if (blank(r.responsible_user_id)) out.unassigned += 1
  }
  return out
}

/** Distinct non-blank values of a field, sorted. */
export function distinctValues(records, field) {
  const seen = new Map()
  for (const r of records || []) {
    const v = r?.[field]
    if (blank(v)) continue
    const key = norm(v)
    if (!seen.has(key)) seen.set(key, String(v).trim())
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/**
 * Filter options for a controlled vocabulary: the vocabulary in its own order,
 * plus any stored value the vocabulary does not carry (an older spelling), so
 * every record stays reachable by a filter.
 */
export function vocabOptions(vocab, records, field) {
  const known = new Set((vocab || []).map(norm))
  const extra = distinctValues(records, field).filter((v) => !known.has(norm(v)))
  return [...(vocab || []), ...extra]
}

/** People who are responsible for at least one record: [{ id, name }], by name. */
export function responsibleOptions(records) {
  const map = new Map()
  for (const r of records || []) {
    if (blank(r?.responsible_user_id)) continue
    const id = String(r.responsible_user_id)
    if (!map.has(id)) map.set(id, r.responsible_name || null)
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => String(a.name ?? '~').localeCompare(String(b.name ?? '~')))
}
