/**
 * repairRequests.js - THE single source of truth for the Request For Repair
 * (RFR): the document a driver or operator raises BEFORE a job card exists.
 *
 * WHY THIS EXISTS. The chain the workshop actually runs is
 *   RFR -> Job Card (work_orders) -> MIS store issue -> parts lines,
 * and only the last three links were ever in the system. `work_orders.rfr_no`
 * has carried the reference all along - measured live, 57,192 of 90,535 job
 * cards name one and every one of those 57,192 is distinct - but the request
 * itself, the hours before somebody carded it, and the requests nobody ever
 * carded were invisible. A workshop that can only see the cards it opened
 * cannot see the work it declined to open.
 *
 * Pure + deterministic: no I/O, and every function that needs "now" takes it
 * explicitly, so a render and a test read the same number.
 *
 * TWO RULES RUN THROUGH THE WHOLE FILE, and they are the reason it is a
 * separate module rather than arithmetic inlined in the page:
 *
 *  1. AN UNMEASURABLE FIGURE IS null, NEVER 0. "Median hours to convert" over a
 *     set where nothing converted is not zero hours - zero reads as instant,
 *     which is the most flattering possible lie about a workshop's response
 *     time. Every average, median and rate here returns null when its own
 *     denominator is empty, and the caller renders "Not measurable".
 *  2. NOTHING IS INFERRED FROM A NEIGHBOURING FIELD. An RFR with no
 *     `reported_at` has an unknown age, not an age of zero, and is never
 *     counted as overdue.
 *
 * MIRROR RULE: RFR_PRIORITIES must stay a SUBSET of JOB_CARD_PRIORITIES - an
 * RFR becomes a job card, and a priority the card cannot express would be lost
 * (or rejected by the work_orders CHECK) at exactly the moment it matters.
 * It is imported, not retyped, and a test pins the subset relationship.
 */

import { JOB_CARD_PRIORITIES, readField } from './jobCard'
import { normalizeWoStatus } from './workOrderStatus'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The lifecycle of a request. Deliberately SHORT, and deliberately not a copy
 * of the job-card status ladder: an RFR only answers "has the workshop taken
 * this on", and once it becomes a card the card's own status is authoritative.
 * Duplicating the eleven work-order statuses here would create a second place
 * for a job's state to be recorded, which is the defect this module exists to
 * avoid rather than repeat.
 */
export const RFR_STATUSES = Object.freeze([
  'submitted',
  'acknowledged',
  'converted',
  'rejected',
  'cancelled',
])

/** Plain-English labels. The stored value stays the lowercase token. */
export const RFR_STATUS_LABEL = Object.freeze({
  submitted: 'Submitted',
  acknowledged: 'Acknowledged',
  converted: 'Converted to job card',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
})

/**
 * Presentation metadata. `tone` is the console kit's vocabulary so a consumer
 * can map it without inventing a second colour scheme.
 */
export const RFR_STATUS_META = Object.freeze({
  submitted:    { tone: 'warning', hex: '#f59e0b', order: 0, open: true,  label: RFR_STATUS_LABEL.submitted },
  acknowledged: { tone: 'info',    hex: '#3b82f6', order: 1, open: true,  label: RFR_STATUS_LABEL.acknowledged },
  converted:    { tone: 'good',    hex: '#16a34a', order: 2, open: false, label: RFR_STATUS_LABEL.converted },
  rejected:     { tone: 'danger',  hex: '#ef4444', order: 3, open: false, label: RFR_STATUS_LABEL.rejected },
  cancelled:    { tone: 'quiet',   hex: '#94a3b8', order: 4, open: false, label: RFR_STATUS_LABEL.cancelled },
})

/**
 * Priorities. A FROZEN COPY of the job-card list, not a new ladder, because a
 * converted RFR carries its priority onto the card.
 */
export const RFR_PRIORITIES = Object.freeze([...JOB_CARD_PRIORITIES])

/**
 * Fault categories for a concrete / mixer / pump fleet, chosen so a request can
 * be routed before anybody has diagnosed it: an operator knows the drum will not
 * turn without knowing whether that is hydraulics or the PTO.
 *
 * Free text is still accepted on the row - an unrecognised category is kept
 * verbatim and reported under itself rather than being folded into "Other",
 * which would quietly hide a category the fleet actually uses.
 */
export const RFR_FAULT_CATEGORIES = Object.freeze([
  'Engine',
  'Transmission',
  'Brakes',
  'Tyres',
  'Hydraulics',
  'Electrical',
  'Body',
  'Drum / Mixer',
  'Pump',
  'Air System',
  'Cooling',
  'Other',
])

/**
 * DEFAULT response targets, in hours, by priority. A POLICY DEFAULT, not a
 * measurement: nothing in the data states an agreed SLA, so this is the
 * threshold the page is transparent about rather than a figure derived from
 * anything. Callers may override it wholesale.
 *
 * A request with no `reported_at` is never overdue - its age is unknown, and an
 * unknown age must not be presented as a breach.
 */
export const RFR_TARGET_HOURS = Object.freeze({
  Critical: 4,
  High: 12,
  Medium: 24,
  Low: 72,
})

/** The target used when a request carries no recognisable priority. */
export const RFR_DEFAULT_TARGET_HOURS = 24

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function key(raw) {
  return String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * Legacy and synonym tokens folded onto the canonical five. Kept generous
 * because an RFR can arrive from a phone, an import or a hand-typed correction,
 * and a status nobody recognises silently drops the row out of every count.
 */
const STATUS_SYNONYMS = Object.freeze({
  submitted: 'submitted',
  new: 'submitted',
  open: 'submitted',
  raised: 'submitted',
  reported: 'submitted',
  pending: 'submitted',
  requested: 'submitted',

  acknowledged: 'acknowledged',
  acknowledge: 'acknowledged',
  ack: 'acknowledged',
  accepted: 'acknowledged',
  received: 'acknowledged',
  under_review: 'acknowledged',
  reviewing: 'acknowledged',
  in_review: 'acknowledged',

  converted: 'converted',
  convert: 'converted',
  carded: 'converted',
  job_card_created: 'converted',
  closed: 'converted',
  completed: 'converted',

  rejected: 'rejected',
  reject: 'rejected',
  declined: 'rejected',
  refused: 'rejected',

  cancelled: 'cancelled',
  canceled: 'cancelled',
  withdrawn: 'cancelled',
  void: 'cancelled',
  voided: 'cancelled',
})

/**
 * Fold any raw status onto a canonical token.
 * An unknown value returns '' rather than being guessed at, so a caller can
 * render "Not recorded" instead of asserting a state nobody chose.
 */
export function normalizeRfrStatus(raw) {
  const k = key(raw)
  if (!k) return ''
  return STATUS_SYNONYMS[k] || ''
}

/**
 * Fold any raw priority onto the canonical ladder. Unknown returns null, so a
 * request with no priority reads as "not set" rather than silently becoming
 * Medium - the busiest bucket, which would flatter every response figure.
 */
export function canonRfrPriority(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return null
  const lower = s.toLowerCase()
  for (const p of RFR_PRIORITIES) {
    if (p.toLowerCase() === lower) return p
  }
  const alias = {
    urgent: 'Critical', emergency: 'Critical', severe: 'Critical', p1: 'Critical',
    major: 'High', important: 'High', p2: 'High',
    normal: 'Medium', standard: 'Medium', moderate: 'Medium', p3: 'Medium',
    minor: 'Low', routine: 'Low', p4: 'Low',
  }
  return alias[lower] || null
}

/** Label for a status token; an unrecognised value renders as "Not recorded". */
export function rfrStatusLabel(raw) {
  const s = normalizeRfrStatus(raw)
  return s ? RFR_STATUS_LABEL[s] : 'Not recorded'
}

/** Presentation metadata for a status, or null when it is unrecognised. */
export function rfrStatusMeta(raw) {
  const s = normalizeRfrStatus(raw)
  return s ? RFR_STATUS_META[s] : null
}

/** True while the request is still waiting on the workshop. */
export function isOpenRfr(status) {
  const s = normalizeRfrStatus(status)
  // An unrecognised status is treated as OPEN. A request nobody can classify is
  // still a request somebody made, and hiding it from the open queue is how it
  // stops being answered.
  if (!s) return true
  return RFR_STATUS_META[s].open
}

/** True once the request has reached a terminal state. */
export function isTerminalRfrStatus(status) {
  return !isOpenRfr(status)
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * The legal next states. Terminal states have none: a converted request is
 * represented by its JOB CARD from that point on, and re-opening it here would
 * put the same job in two places with two statuses.
 */
const TRANSITIONS = Object.freeze({
  submitted: Object.freeze(['acknowledged', 'rejected', 'cancelled']),
  acknowledged: Object.freeze(['converted', 'rejected', 'cancelled']),
  converted: Object.freeze([]),
  rejected: Object.freeze([]),
  cancelled: Object.freeze([]),
})

/**
 * Statuses a request may legally move to from where it is now.
 * An unrecognised current status is treated as `submitted`, so a row with a
 * status nobody recognises can still be triaged rather than being stranded.
 */
export function nextRfrStatuses(status) {
  const s = normalizeRfrStatus(status) || 'submitted'
  return TRANSITIONS[s] || []
}

/** True when moving `from` to `to` is one of the legal transitions. */
export function canTransitionRfr(from, to) {
  const target = normalizeRfrStatus(to)
  if (!target) return false
  return nextRfrStatuses(from).includes(target)
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const HOUR_MS = 3600000
const DAY_MS = 86400000

/** Parse a value to epoch ms, or null. Accepts ISO strings, Date and numbers. */
function ts(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const d = v instanceof Date ? v : new Date(v)
  const n = d.getTime()
  return Number.isFinite(n) ? n : null
}

/**
 * The day a value falls on, as 'YYYY-MM-DD'. A date-only string is taken as
 * written (never re-parsed through a timezone, which is how a day silently
 * shifts); anything else is formatted from its UTC instant, matching how the
 * database stores it.
 */
export function dayKey(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const n = ts(v)
  if (n === null) return null
  return new Date(n).toISOString().slice(0, 10)
}

/** The month a value falls on, as 'YYYY-MM', or null. */
export function monthKey(v) {
  const d = dayKey(v)
  return d ? d.slice(0, 7) : null
}

/** The moment a request stopped waiting: converted, else rejected/cancelled. */
function resolvedAt(row) {
  if (!row) return null
  const converted = ts(row.converted_at)
  if (converted !== null) return converted
  // rejected / cancelled carry no dedicated timestamp in the schema, so the
  // resolution instant is genuinely unknown for those. Reporting updated_at
  // here would be a guess dressed as a measurement: any later edit moves it.
  return null
}

/**
 * How long the request has been open, in hours.
 *
 * null when `reported_at` is missing - an unknown start is an unknown age, and
 * a zero would sort the least documented request as the freshest one on the
 * queue. A resolved request measures to its resolution, an open one to `now`.
 */
export function rfrAgeHours(row, now) {
  const start = ts(row && row.reported_at)
  if (start === null) return null
  const end = resolvedAt(row) ?? ts(now)
  if (end === null) return null
  const h = (end - start) / HOUR_MS
  // A negative age is a data error (a reported_at in the future), not a
  // duration. Report it as unmeasurable rather than as a negative wait.
  return h < 0 ? null : h
}

/** The same figure in whole days, or null. */
export function rfrAgeDays(row, now) {
  const h = rfrAgeHours(row, now)
  return h === null ? null : Math.floor(h / 24)
}

/**
 * Hours from the request being raised to somebody acknowledging it.
 *
 * MEASURABLE ONLY WHEN THE ROW CARRIES AN acknowledged_at. The column is read
 * through `row.acknowledged_at` and then `custom_data.acknowledged_at`, so it
 * works whether the timestamp is a promoted column or still in jsonb. Where
 * neither exists this returns null and every consumer reports "not recorded"
 * rather than substituting `updated_at`, which any later edit would move.
 */
export function hoursToAcknowledge(row) {
  const start = ts(row && row.reported_at)
  if (start === null) return null
  const raw = row && (row.acknowledged_at ?? (row.custom_data && row.custom_data.acknowledged_at))
  const end = ts(raw)
  if (end === null) return null
  const h = (end - start) / HOUR_MS
  return h < 0 ? null : h
}

/** Hours from the request being raised to the job card being opened, or null. */
export function hoursToConvert(row) {
  const start = ts(row && row.reported_at)
  const end = ts(row && row.converted_at)
  if (start === null || end === null) return null
  const h = (end - start) / HOUR_MS
  return h < 0 ? null : h
}

/** The response target for a row's priority, in hours. */
export function targetHoursFor(row, targets = RFR_TARGET_HOURS) {
  const p = canonRfrPriority(row && row.priority)
  const t = p ? targets[p] : null
  return Number.isFinite(t) ? t : RFR_DEFAULT_TARGET_HOURS
}

/**
 * True when an OPEN request has been waiting longer than its own target.
 * A resolved request is never overdue, and neither is one whose age cannot be
 * measured.
 */
export function isRfrOverdue(row, now, targets = RFR_TARGET_HOURS) {
  if (!row || !isOpenRfr(row.status)) return false
  const age = rfrAgeHours(row, now)
  if (age === null) return false
  return age > targetHoursFor(row, targets)
}

// ---------------------------------------------------------------------------
// The RFR document number
// ---------------------------------------------------------------------------

/**
 * Read the structure out of an RFR number. The live format, measured over the
 * 57,192 job cards that carry one, is `<entity>/RFR/<4-digit seq>/<MMYY>` -
 * `GC/RFR/0948/1225` is sequence 948 of December 2025.
 *
 * Returns null on anything that does not match, so a hand-typed or imported
 * reference is never bent into a period it does not state. That matters: the
 * period derived here is used to bucket history, and a wrong month is worse
 * than no month.
 */
export function parseRfrNo(no) {
  const s = String(no == null ? '' : no).trim()
  if (!s) return null
  const m = /^([A-Za-z0-9]+)\s*\/\s*RFR\s*\/\s*(\d{1,6})\s*\/\s*(\d{2})(\d{2})$/i.exec(s)
  if (!m) return null
  const month = Number(m[3])
  const yy = Number(m[4])
  if (!(month >= 1 && month <= 12)) return null
  const year = 2000 + yy
  return {
    entity: m[1].toUpperCase(),
    seqText: m[2],
    seq: Number(m[2]),
    month,
    year,
    period: `${year}-${String(month).padStart(2, '0')}`,
  }
}

/** The 'YYYY-MM' the RFR number itself states, or null when it does not. */
export function rfrPeriod(no) {
  const parsed = parseRfrNo(no)
  return parsed ? parsed.period : null
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export const EMPTY_RFR_FILTERS = Object.freeze({
  search: '',
  status: '',
  priority: '',
  site: '',
  country: '',
  assetNo: '',
  faultCategory: '',
  from: '',
  to: '',
})

const lower = (v) => String(v == null ? '' : v).trim().toLowerCase()

/**
 * Apply the on-screen filters. Every filter is exact except `search`, which
 * sweeps the identity and free-text fields.
 *
 * A blank filter never removes a row, and a row missing the field a filter
 * names is EXCLUDED while that filter is set - a request with no site recorded
 * is not evidence that it happened at the site being asked about.
 */
export function filterRfrs(rows = [], filters = {}) {
  const f = { ...EMPTY_RFR_FILTERS, ...(filters || {}) }
  const q = lower(f.search)
  const status = normalizeRfrStatus(f.status)
  const priority = canonRfrPriority(f.priority)
  const site = String(f.site || '').trim()
  const country = String(f.country || '').trim()
  const assetNo = String(f.assetNo || '').trim().toUpperCase().replace(/\s+/g, '')
  const fault = String(f.faultCategory || '').trim()
  const from = String(f.from || '').trim()
  const to = String(f.to || '').trim()

  return (rows || []).filter((r) => {
    if (!r) return false
    if (f.status && normalizeRfrStatus(r.status) !== status) return false
    if (f.priority && canonRfrPriority(r.priority) !== priority) return false
    if (site && String(r.site || '') !== site) return false
    if (country && String(r.country || '') !== country) return false
    if (fault && String(r.fault_category || '') !== fault) return false
    if (assetNo) {
      const a = String(r.asset_no || '').trim().toUpperCase().replace(/\s+/g, '')
      if (a !== assetNo) return false
    }
    if (from || to) {
      const day = dayKey(r.reported_at)
      if (!day) return false
      if (from && day < from) return false
      if (to && day > to) return false
    }
    if (q) {
      const hay = [
        r.rfr_no, r.asset_no, r.plate_no, r.asset_description, r.description,
        r.fault_category, r.site, r.reported_by_name, r.work_order_no,
        r.rejected_reason,
      ].map(lower).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function median(values) {
  const nums = (values || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!nums.length) return null
  const mid = nums.length >> 1
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}

function round1(n) {
  return n === null || n === undefined ? null : Math.round(n * 10) / 10
}

/**
 * Every headline figure for a set of requests, computed over the SAME array the
 * table renders, so a tile and the rows beneath it can never describe different
 * requests.
 *
 * NULL, NOT ZERO, wherever the denominator is empty:
 *   medianHoursToConvert  - null when nothing in the set converted with both
 *                           timestamps present
 *   medianHoursToAcknowledge - null unless acknowledged_at is actually recorded
 *   conversionRate        - null when there are no requests at all, because a
 *                           rate over nothing is not 0 percent
 *   medianOpenAgeHours    - null when nothing is open
 */
export function summarizeRfrs(rows = [], now, targets = RFR_TARGET_HOURS) {
  const list = (rows || []).filter(Boolean)
  const byStatus = {}
  for (const s of RFR_STATUSES) byStatus[s] = 0
  let unknownStatus = 0

  let open = 0
  let overdue = 0
  let awaitingAck = 0
  const convertHours = []
  const ackHours = []
  const openAges = []
  const assets = new Set()
  const sites = new Set()
  let withoutReportedAt = 0

  for (const r of list) {
    const s = normalizeRfrStatus(r.status)
    if (s) byStatus[s] += 1
    else unknownStatus += 1

    if (isOpenRfr(r.status)) {
      open += 1
      if (s === 'submitted' || !s) awaitingAck += 1
      const age = rfrAgeHours(r, now)
      if (age !== null) openAges.push(age)
      if (isRfrOverdue(r, now, targets)) overdue += 1
    }

    const c = hoursToConvert(r)
    if (c !== null) convertHours.push(c)
    const a = hoursToAcknowledge(r)
    if (a !== null) ackHours.push(a)

    if (ts(r.reported_at) === null) withoutReportedAt += 1
    const asset = String(r.asset_no || '').trim()
    if (asset) assets.add(asset.toUpperCase())
    const site = String(r.site || '').trim()
    if (site) sites.add(site)
  }

  const total = list.length
  const converted = byStatus.converted

  return {
    total,
    open,
    overdue,
    awaitingAcknowledgement: awaitingAck,
    byStatus,
    unknownStatus,
    converted,
    rejected: byStatus.rejected,
    cancelled: byStatus.cancelled,
    assets: assets.size,
    sites: sites.size,

    // A rate over an empty set is not zero percent - it is unmeasurable.
    conversionRate: total ? Math.round((converted / total) * 1000) / 10 : null,

    medianHoursToConvert: round1(median(convertHours)),
    longestHoursToConvert: convertHours.length ? round1(Math.max(...convertHours)) : null,
    convertMeasured: convertHours.length,

    // Zero here is the honest reading when the schema has no acknowledged_at:
    // "we never recorded it", surfaced as a count so the page can say so
    // instead of printing a median of nothing.
    medianHoursToAcknowledge: round1(median(ackHours)),
    acknowledgeMeasured: ackHours.length,

    medianOpenAgeHours: round1(median(openAges)),
    longestOpenAgeHours: openAges.length ? round1(Math.max(...openAges)) : null,

    // Requests whose age cannot be measured at all. Stated rather than hidden,
    // because every duration figure above silently excludes them.
    withoutReportedAt,
  }
}

/**
 * The conversion funnel: how many requests reached each stage.
 *
 * CUMULATIVE BY CONSTRUCTION. A converted request was necessarily submitted and
 * acknowledged, even when nobody stamped the acknowledgement, so counting only
 * rows whose CURRENT status is 'acknowledged' would draw a funnel that widens
 * in the middle. Rejected and cancelled are reported separately: they left the
 * funnel, they did not fail to progress through it.
 */
export function rfrConversionFunnel(rows = []) {
  const list = (rows || []).filter(Boolean)
  const counts = { submitted: 0, acknowledged: 0, converted: 0, rejected: 0, cancelled: 0 }
  for (const r of list) {
    const s = normalizeRfrStatus(r.status) || 'submitted'
    counts[s] = (counts[s] || 0) + 1
  }
  const submitted = list.length
  const acknowledged = counts.acknowledged + counts.converted
  const converted = counts.converted
  return [
    { key: 'submitted', label: 'Submitted', count: submitted,
      pct: submitted ? 100 : null },
    { key: 'acknowledged', label: 'Acknowledged', count: acknowledged,
      pct: submitted ? Math.round((acknowledged / submitted) * 1000) / 10 : null },
    { key: 'converted', label: 'Converted to job card', count: converted,
      pct: submitted ? Math.round((converted / submitted) * 1000) / 10 : null },
    { key: 'rejected', label: 'Rejected', count: counts.rejected,
      pct: submitted ? Math.round((counts.rejected / submitted) * 1000) / 10 : null },
    { key: 'cancelled', label: 'Cancelled', count: counts.cancelled,
      pct: submitted ? Math.round((counts.cancelled / submitted) * 1000) / 10 : null },
  ]
}

/**
 * Count by an arbitrary field, biggest first. A blank value is reported under
 * "Not recorded" rather than dropped, so a chart's total always matches the
 * table's row count and a data gap is visible instead of silently shrinking
 * the picture.
 */
export function byRfrGroup(rows = [], field = 'site', { limit = 0 } = {}) {
  const map = new Map()
  for (const r of (rows || [])) {
    if (!r) continue
    const raw = r[field]
    const label = String(raw == null ? '' : raw).trim() || 'Not recorded'
    map.set(label, (map.get(label) || 0) + 1)
  }
  const out = [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return limit > 0 ? out.slice(0, limit) : out
}

/**
 * Time-to-convert distribution. Bands are hours, chosen so the first two
 * separate "same shift" from "next day" - the distinction a foreman acts on.
 * Requests that have not converted are NOT counted as a long conversion; they
 * are reported as `unconverted` so the distribution describes only what it can
 * actually measure.
 */
export const RFR_CONVERT_BANDS = Object.freeze([
  { key: 'lt4', label: 'Under 4 hours', max: 4 },
  { key: 'lt12', label: '4 to 12 hours', max: 12 },
  { key: 'lt24', label: '12 to 24 hours', max: 24 },
  { key: 'lt72', label: '1 to 3 days', max: 72 },
  { key: 'gte72', label: 'Over 3 days', max: Infinity },
])

export function timeToConvertBands(rows = []) {
  const bands = RFR_CONVERT_BANDS.map((b) => ({ ...b, count: 0 }))
  let unconverted = 0
  for (const r of (rows || [])) {
    if (!r) continue
    const h = hoursToConvert(r)
    if (h === null) { unconverted += 1; continue }
    const hit = bands.find((b) => h < b.max) || bands[bands.length - 1]
    hit.count += 1
  }
  return { bands: bands.map(({ max, ...rest }) => rest), unconverted }
}

/**
 * A contiguous monthly series, anchored to the LATEST month present in the data
 * rather than to the clock.
 *
 * That anchoring is deliberate and follows this codebase's standing rule: a
 * historical feed whose newest row is months old would otherwise render as a
 * run of empty months, which reads as "the fleet stopped raising requests"
 * rather than "nothing has been uploaded since". `now` is used only when the
 * set carries no usable date at all. The anchor is returned so a caller can
 * label the window honestly.
 */
export function rfrMonthlyTrend(rows = [], { months = 12, now, dateField = 'reported_at' } = {}) {
  const keys = []
  for (const r of (rows || [])) {
    if (!r) continue
    const k = monthKey(r[dateField]) || (dateField === 'reported_at' ? rfrPeriod(r.rfr_no) : null)
    if (k) keys.push(k)
  }
  const latest = keys.length ? keys.reduce((a, b) => (a > b ? a : b)) : monthKey(ts(now) ?? Date.now())
  if (!latest) return { anchor: null, points: [], anchoredToData: false }

  const [ay, am] = latest.split('-').map(Number)
  const points = []
  for (let i = months - 1; i >= 0; i -= 1) {
    // Date.UTC normalises a month underflow (month 0 - 3 rolls the year back).
    const d = new Date(Date.UTC(ay, am - 1 - i, 1))
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    points.push({ month: k, count: 0, converted: 0 })
  }
  const index = new Map(points.map((p) => [p.month, p]))
  for (const r of (rows || [])) {
    if (!r) continue
    const k = monthKey(r[dateField]) || (dateField === 'reported_at' ? rfrPeriod(r.rfr_no) : null)
    const p = k && index.get(k)
    if (!p) continue
    p.count += 1
    if (normalizeRfrStatus(r.status) === 'converted') p.converted += 1
  }
  return { anchor: latest, points, anchoredToData: keys.length > 0 }
}

// ---------------------------------------------------------------------------
// The historical view: RFRs recorded on job cards
// ---------------------------------------------------------------------------

/**
 * Shape a `work_orders` row into the RFR view.
 *
 * `raised_by` / `raised_at` are read through `readField` from jobCard.js, which
 * already knows they live in `custom_data`. They are NOT re-implemented here,
 * and `raised_at` is NOT re-parsed into a date: the job-card catalog keeps it
 * exactly as the ERP wrote it precisely so it can never be silently mis-dated,
 * and that decision is respected rather than overridden.
 */
export function jobCardRfrView(row) {
  if (!row) return null
  const parsed = parseRfrNo(row.rfr_no)
  return {
    rfr_no: row.rfr_no || null,
    rfr_period: parsed ? parsed.period : null,
    rfr_seq: parsed ? parsed.seq : null,
    rfr_entity: parsed ? parsed.entity : null,
    raised_by: readField(row, 'raised_by'),
    raised_at: readField(row, 'raised_at'),
    work_order_no: row.work_order_no || null,
    asset_no: row.asset_no || null,
    asset_description: readField(row, 'asset_description'),
    site: row.site || null,
    country: row.country || null,
    work_type: row.work_type || null,
    priority: canonRfrPriority(row.priority),
    status: normalizeWoStatus(row.status),
    opened_at: row.opened_at || null,
    description: row.description || null,
    id: row.id,
  }
}

/**
 * Headline figures for the historical set.
 *
 * `distinctRfrNumbers` is reported beside `total` on purpose. Measured live all
 * 57,192 job-card RFR numbers are distinct, so the two figures agreeing is the
 * evidence the reference really is one-per-request; the day they diverge, one
 * request has been carded twice and this is where it shows.
 */
export function summarizeJobCardRfrs(rows = []) {
  const list = (rows || []).filter(Boolean)
  const numbers = new Set()
  const raisers = new Set()
  let withRaisedBy = 0
  let parseable = 0
  const sites = new Set()

  for (const r of list) {
    const no = String(r.rfr_no || '').trim()
    if (no) numbers.add(no.toUpperCase())
    if (parseRfrNo(no)) parseable += 1
    const by = String(r.raised_by || '').trim()
    if (by) { withRaisedBy += 1; raisers.add(by.toUpperCase()) }
    const site = String(r.site || '').trim()
    if (site) sites.add(site)
  }

  const total = list.length
  return {
    total,
    distinctRfrNumbers: numbers.size,
    duplicateRfrNumbers: total - numbers.size,
    withRaisedBy,
    // A share over an empty set is unmeasurable, not zero.
    raisedByCoveragePct: total ? Math.round((withRaisedBy / total) * 1000) / 10 : null,
    distinctRaisers: raisers.size,
    parseableRfrNumbers: parseable,
    unparseableRfrNumbers: total - parseable,
    sites: sites.size,
  }
}

/** Filter the historical job-card view. Mirrors filterRfrs on the shared keys. */
export function filterJobCardRfrs(rows = [], filters = {}) {
  const f = { ...EMPTY_RFR_FILTERS, ...(filters || {}) }
  const q = lower(f.search)
  const site = String(f.site || '').trim()
  const priority = canonRfrPriority(f.priority)
  const assetNo = String(f.assetNo || '').trim().toUpperCase().replace(/\s+/g, '')
  const from = String(f.from || '').trim()
  const to = String(f.to || '').trim()

  return (rows || []).filter((r) => {
    if (!r) return false
    if (site && String(r.site || '') !== site) return false
    if (f.priority && canonRfrPriority(r.priority) !== priority) return false
    if (assetNo) {
      const a = String(r.asset_no || '').trim().toUpperCase().replace(/\s+/g, '')
      if (a !== assetNo) return false
    }
    if (from || to) {
      const day = dayKey(r.opened_at)
      if (!day) return false
      if (from && day < from) return false
      if (to && day > to) return false
    }
    if (q) {
      const hay = [
        r.rfr_no, r.work_order_no, r.asset_no, r.asset_description, r.site,
        r.raised_by, r.description, r.work_type,
      ].map(lower).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const NA = 'N/A'
const blank = (v) => {
  const s = v === null || v === undefined ? '' : String(v).trim()
  return s || NA
}

/**
 * Rows for the Excel / PDF export of the live queue.
 *
 * Every blank renders "N/A" rather than a dash, and every unmeasurable duration
 * renders "Not measurable" rather than 0, so a sheet opened months later cannot
 * be misread as a fleet with instant response times.
 */
export function rfrExportRows(rows = [], now) {
  const columns = [
    'rfr_no', 'reported_at', 'asset_no', 'plate_no', 'site', 'fault_category',
    'priority', 'status', 'age_hours', 'reported_by_name', 'work_order_no',
    'hours_to_convert', 'description', 'rejected_reason',
  ]
  const headers = [
    'RFR No', 'Raised on', 'Asset', 'Plate', 'Site', 'Fault',
    'Priority', 'Status', 'Hours open', 'Raised by', 'Job card',
    'Hours to job card', 'Reported fault', 'Rejection reason',
  ]
  return {
    columns,
    headers,
    rows: (rows || []).filter(Boolean).map((r) => {
      const age = rfrAgeHours(r, now)
      const conv = hoursToConvert(r)
      return {
        rfr_no: blank(r.rfr_no),
        reported_at: blank(dayKey(r.reported_at)),
        asset_no: blank(r.asset_no),
        plate_no: blank(r.plate_no),
        site: blank(r.site),
        fault_category: blank(r.fault_category),
        priority: blank(canonRfrPriority(r.priority)),
        status: rfrStatusLabel(r.status),
        age_hours: age === null ? 'Not measurable' : round1(age),
        reported_by_name: blank(r.reported_by_name),
        work_order_no: blank(r.work_order_no),
        hours_to_convert: conv === null ? 'Not measurable' : round1(conv),
        description: blank(r.description),
        rejected_reason: blank(r.rejected_reason),
      }
    }),
  }
}

/** Rows for the Excel / PDF export of the historical job-card view. */
export function jobCardRfrExportRows(rows = []) {
  const columns = [
    'rfr_no', 'rfr_period', 'raised_by', 'raised_at', 'work_order_no',
    'asset_no', 'asset_description', 'site', 'work_type', 'status', 'opened_at',
  ]
  const headers = [
    'RFR No', 'RFR period', 'Raised by', 'Raised on (as recorded)', 'Job card',
    'Asset', 'Asset description', 'Site', 'Job type', 'Card status', 'Card opened',
  ]
  return {
    columns,
    headers,
    rows: (rows || []).filter(Boolean).map((r) => ({
      rfr_no: blank(r.rfr_no),
      rfr_period: blank(r.rfr_period),
      raised_by: blank(r.raised_by),
      raised_at: blank(r.raised_at),
      work_order_no: blank(r.work_order_no),
      asset_no: blank(r.asset_no),
      asset_description: blank(r.asset_description),
      site: blank(r.site),
      work_type: blank(r.work_type),
      status: blank(r.status),
      opened_at: blank(dayKey(r.opened_at)),
    })),
  }
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/**
 * Plain-English points worth acting on, derived only from what is on screen.
 * Returns an EMPTY array when there is nothing to say - a panel that always
 * finds something to warn about is a panel nobody reads.
 */
export function rfrFindings(rows = [], summary, now, targets = RFR_TARGET_HOURS) {
  const s = summary || summarizeRfrs(rows, now, targets)
  const out = []

  if (s.overdue > 0) {
    out.push({
      tone: 'danger',
      text: `${s.overdue} open request${s.overdue === 1 ? '' : 's'} past the response target for its priority.`,
    })
  }
  if (s.awaitingAcknowledgement > 0) {
    out.push({
      tone: 'warning',
      text: `${s.awaitingAcknowledgement} request${s.awaitingAcknowledgement === 1 ? '' : 's'} nobody has acknowledged yet.`,
    })
  }
  if (s.withoutReportedAt > 0) {
    out.push({
      tone: 'info',
      text: `${s.withoutReportedAt} request${s.withoutReportedAt === 1 ? '' : 's'} carry no raised date, so their age is not measurable and they are excluded from every timing figure above.`,
    })
  }
  // DELIBERATELY NOT A FINDING: "time to acknowledge is not measurable". The
  // schema carries no acknowledged_at, so that statement is true of EVERY view
  // and would fire forever - and a panel that always finds something to warn
  // about is a panel nobody reads. It belongs beside the tile it describes,
  // where `summary.acknowledgeMeasured === 0` renders "Not recorded".
  if (s.rejected > 0 && s.total > 0) {
    const pct = Math.round((s.rejected / s.total) * 1000) / 10
    if (pct >= 20) {
      out.push({
        tone: 'warning',
        text: `${pct} percent of requests in this view were rejected. Worth checking what is being raised and why.`,
      })
    }
  }
  return out
}
