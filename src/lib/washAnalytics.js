/**
 * washAnalytics.js - pure, deterministic analytics for the Vehicle Washing
 * module. No I/O, no Date.now() reads except where a `now` is injected, so the
 * output is fully testable. Consumed by VehicleWashing.jsx for its reporting KPIs
 * and charts, and reused by the export path.
 *
 * A "wash record" row has (at least): wash_date (YYYY-MM-DD), asset_no,
 * wash_type, site, area, status.
 *
 * Cost / water / duration were removed per field feedback - the module now
 * reports on wash VOLUME (counts) only. All maths degrade honestly to zero on
 * empty / missing data - never NaN, never a fabricated figure.
 *
 * THE LOAD-BEARING RULE HERE: **a scheduled wash is not work done.** The status
 * vocabulary is Completed | Scheduled | Missed | Cancelled, and a Scheduled row
 * is a PLAN for a future date, a Missed row is a recorded non-event and a
 * Cancelled row never happened. Counting any of the three as a wash would report
 * intentions as compliance, which is the one number this module exists to get
 * right. Every count, rate and trend below therefore measures COMPLETED washes
 * only; `filterWashes` is deliberately status-agnostic because the log view has
 * to show plans and cancellations too.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Statuses that are NOT a wash performed. Mirrors the wash_records CHECK.
 *
 * 'In Progress' belongs here and it is the one worth explaining: the machine is
 * in the bay right now, so the wash has started and has not finished. Counting
 * it would report work as done while it is still being done, which on a
 * compliance measure overstates - the direction that matters, because a fleet
 * reading itself as washed does not go and wash anything.
 */
export const NON_WORK_STATUSES = Object.freeze(['In Progress', 'Scheduled', 'Missed', 'Cancelled'])

/** Default wash cadence in days (matches the field rule used on mobile). */
export const WASH_INTERVAL_DAYS = 7

/**
 * True when the row records a wash that actually took place.
 * A blank status is treated as completed: rows logged before the status
 * vocabulary existed are a record of work, and none of them can be a plan.
 */
export function isCompletedWash(row) {
  if (!row) return false
  const s = String(row.status || '').trim()
  if (!s) return true
  return !NON_WORK_STATUSES.includes(s)
}

/** Only the rows that record work done. */
export function completedWashes(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isCompletedWash)
}

/** Parse a YYYY-MM-DD (or ISO) value to a midnight-anchored Date, else null. */
function parseDay(v) {
  if (!v) return null
  const iso = String(v).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Local-time YYYY-MM-DD for a Date (toISOString would roll the day back). */
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Resolve an injected `now` (Date or YYYY-MM-DD) to a midnight-anchored Date. */
function resolveToday(now) {
  if (now instanceof Date && !Number.isNaN(now.getTime())) return parseDay(toISODate(now))
  const p = typeof now === 'string' ? parseDay(now) : null
  return p || parseDay(toISODate(new Date()))
}

/** Whole days between two midnight-anchored dates (b - a). */
function dayDiff(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** Add whole days to a YYYY-MM-DD string, returning YYYY-MM-DD (null on bad input). */
function addDays(iso, n) {
  const d = parseDay(iso)
  if (!d) return null
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

/** Normalise a row date to a YYYY-MM-DD string (first 10 chars), or ''. */
function dayOf(row) {
  const v = row && row.wash_date
  if (!v) return ''
  return String(v).slice(0, 10)
}

/**
 * Filter wash rows by an optional date range (inclusive on both ends),
 * site, area, wash type, status and asset. Any filter left blank / 'All' is
 * ignored. Rows with a blank wash_date are excluded only when a date bound is
 * set.
 *
 * DELIBERATELY status-agnostic: this feeds the log view, which must be able to
 * show plans, misses and cancellations. Everything that COUNTS washes runs
 * through completedWashes instead.
 *
 * @param {object[]} rows
 * @param {{from?:string,to?:string,site?:string,area?:string,type?:string,
 *   status?:string,assetNo?:string}} [filters]
 * @returns {object[]}
 */
export function filterWashes(rows, filters = {}) {
  if (!Array.isArray(rows)) return []
  const { from, to, site, area, type, status, assetNo } = filters || {}
  const wantStatus = status && status !== 'All' ? String(status) : null
  const wantAsset = assetNo && String(assetNo).trim() !== ''
    ? String(assetNo).trim().toUpperCase()
    : null
  const hasFrom = from && String(from).trim() !== ''
  const hasTo = to && String(to).trim() !== ''
  const wantSite = site && site !== 'All' ? String(site) : null
  const wantArea = area && area !== 'All' ? String(area) : null
  const wantType = type && type !== 'All' ? String(type) : null

  return rows.filter((r) => {
    if (!r) return false
    const d = dayOf(r)
    if (hasFrom) {
      if (!d || d < String(from).slice(0, 10)) return false
    }
    if (hasTo) {
      if (!d || d > String(to).slice(0, 10)) return false
    }
    if (wantSite && String(r.site || '') !== wantSite) return false
    if (wantArea && String(r.area || '') !== wantArea) return false
    if (wantType && String(r.wash_type || '') !== wantType) return false
    if (wantStatus && String(r.status || '') !== wantStatus) return false
    if (wantAsset && String(r.asset_no || '').trim().toUpperCase() !== wantAsset) return false
    return true
  })
}

/** Group rows by a string key, returning [{ key, count }] sorted by count desc. */
function groupBy(rows, keyName) {
  const map = new Map()
  for (const r of rows) {
    const raw = r && r[keyName]
    const key = raw == null || String(raw).trim() === '' ? 'Unspecified' : String(raw).trim()
    const cur = map.get(key) || { key, count: 0 }
    cur.count += 1
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * Washes PERFORMED, grouped by wash type: [{ key, count }] (count desc).
 * Scheduled / Missed / Cancelled rows are excluded - see the header rule.
 */
export function byType(rows) {
  return groupBy(completedWashes(rows), 'wash_type')
}

/**
 * Washes PERFORMED, grouped by site: [{ key, count }] (count desc).
 */
export function bySite(rows) {
  return groupBy(completedWashes(rows), 'site')
}

/**
 * 12-month trend of washes PERFORMED, ending at (and including) the month of
 * `now`. A future scheduled wash must never draw a bar on a trend of work done.
 * @returns {{ month:string, label:string, count:number }[]}
 */
export function monthlyTrend(rows, now = new Date()) {
  const anchor = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  const buckets = []
  const index = new Map()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = d.getMonth()
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    const bucket = { month: key, label: `${MONTHS_SHORT[m]} ${String(y).slice(2)}`, count: 0 }
    buckets.push(bucket)
    index.set(key, bucket)
  }
  for (const r of completedWashes(rows)) {
    const d = dayOf(r)
    if (d.length < 7) continue
    const key = d.slice(0, 7)
    const bucket = index.get(key)
    if (!bucket) continue
    bucket.count += 1
  }
  return buckets
}

/**
 * Headline KPIs over the given rows (optionally pre-filtered). Honest zeros on
 * empty input.
 *
 * `totalWashes` counts washes PERFORMED. Plans, misses and cancellations are
 * reported as their own counts so a reader can see them without them ever
 * inflating the compliance figures.
 *
 * @param {object[]} rows
 * @param {{from?:string,to?:string,site?:string,area?:string,type?:string,
 *   status?:string,assetNo?:string}} [filters]
 *   When provided, rows are filtered first via filterWashes.
 * @param {Date} [now] anchor for the monthly trend.
 */
export function summarizeWashes(rows, filters = {}, now = new Date()) {
  const src = Array.isArray(rows) ? rows : []
  const data = filters && Object.keys(filters).length ? filterWashes(src, filters) : src
  const done = completedWashes(data)

  const assets = new Set()
  for (const r of done) {
    const a = r && r.asset_no != null ? String(r.asset_no).trim() : ''
    if (a) assets.add(a)
  }

  let scheduled = 0
  let missed = 0
  let cancelled = 0
  for (const r of data) {
    const s = String((r && r.status) || '').trim()
    if (s === 'Scheduled') scheduled += 1
    else if (s === 'Missed') missed += 1
    else if (s === 'Cancelled') cancelled += 1
  }

  return {
    totalWashes: done.length,
    distinctAssets: assets.size,
    // Every record in scope, plans included. Distinct from totalWashes on
    // purpose: one is work done, the other is rows held.
    totalRecords: data.length,
    scheduledCount: scheduled,
    missedCount: missed,
    cancelledCount: cancelled,
    byType: byType(data),
    bySite: bySite(data),
    monthlyTrend: monthlyTrend(data, now),
  }
}

/**
 * Assets due for a wash: the last COMPLETED wash is at or past its interval, or
 * the asset has never been washed at all.
 *
 * @param {object[]} rows wash records (any status; only completed ones count)
 * @param {object[]} [fleet] optional asset list ({asset_no, site, vehicle_type}).
 *   When supplied, an asset with NO wash on record is reported with
 *   basis 'never' - a null due date, never a guessed one.
 * @param {{now?:Date|string, intervalDays?:number}} [opts]
 * @returns {{asset_no:string,last_wash_date:string|null,next_due_date:string|null,
 *   days_overdue:number|null,site:string|null,vehicle_type:string|null,
 *   basis:'washed'|'never'}[]} most overdue first, never-washed last.
 */
export function washDue(rows, fleet = null, opts = {}) {
  const iv = Number.isFinite(opts.intervalDays) && opts.intervalDays > 0
    ? Math.floor(opts.intervalDays)
    : WASH_INTERVAL_DAYS
  const today = resolveToday(opts.now)

  // Latest completed wash per asset.
  const latest = new Map()
  for (const r of completedWashes(rows)) {
    const asset = String((r && r.asset_no) || '').trim()
    const d = parseDay(r && r.wash_date)
    if (!asset || !d) continue
    const prev = latest.get(asset)
    if (!prev || d.getTime() > prev.date.getTime()) {
      latest.set(asset, { date: d, row: r })
    }
  }

  const out = []
  for (const [asset, { date, row }] of latest) {
    const nextDue = addDays(toISODate(date), iv)
    const overdue = dayDiff(parseDay(nextDue), today)
    if (overdue < 0) continue
    out.push({
      asset_no: asset,
      last_wash_date: toISODate(date),
      next_due_date: nextDue,
      days_overdue: overdue,
      site: row.site || null,
      vehicle_type: row.vehicle_type || null,
      basis: 'washed',
    })
  }

  const never = []
  for (const a of Array.isArray(fleet) ? fleet : []) {
    const asset = String((a && a.asset_no) || '').trim()
    if (!asset || latest.has(asset)) continue
    if (never.some((n) => n.asset_no === asset)) continue
    never.push({
      asset_no: asset,
      last_wash_date: null,
      next_due_date: null,
      days_overdue: null,
      site: a.site || null,
      vehicle_type: a.vehicle_type || null,
      basis: 'never',
    })
  }

  out.sort((x, y) => y.days_overdue - x.days_overdue || x.asset_no.localeCompare(y.asset_no))
  never.sort((x, y) => x.asset_no.localeCompare(y.asset_no))
  return [...out, ...never]
}

/**
 * Scheduled washes whose date has passed with no completed wash recorded for
 * that asset on or after the scheduled day.
 *
 * A scheduled wash that WAS carried out is not a failure even if nobody went
 * back and closed the plan, so the completed record clears it.
 */
export function overdueSchedules(rows, opts = {}) {
  const today = resolveToday(opts.now)
  const src = Array.isArray(rows) ? rows : []

  // Completed wash days per asset, so a plan can be cleared by the work itself.
  const doneByAsset = new Map()
  for (const r of completedWashes(src)) {
    const asset = String((r && r.asset_no) || '').trim()
    const d = parseDay(r && r.wash_date)
    if (!asset || !d) continue
    const list = doneByAsset.get(asset) || []
    list.push(d)
    doneByAsset.set(asset, list)
  }

  const out = []
  for (const r of src) {
    if (String((r && r.status) || '').trim() !== 'Scheduled') continue
    const due = parseDay(r && r.wash_date)
    if (!due) continue
    if (dayDiff(due, today) <= 0) continue // today or later is still upcoming
    const asset = String((r && r.asset_no) || '').trim()
    const done = doneByAsset.get(asset) || []
    if (done.some((d) => d.getTime() >= due.getTime())) continue
    out.push({ ...r, days_late: dayDiff(due, today) })
  }
  return out.sort((a, b) => b.days_late - a.days_late)
}

/** Scheduled washes still ahead (today or later), soonest first. */
export function upcomingSchedules(rows, opts = {}) {
  const today = resolveToday(opts.now)
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => {
      if (String((r && r.status) || '').trim() !== 'Scheduled') return false
      const due = parseDay(r && r.wash_date)
      return !!due && dayDiff(due, today) <= 0
    })
    .sort((a, b) => String(a.wash_date).localeCompare(String(b.wash_date)))
}

/**
 * What the cost column on these records actually says.
 *
 * Washing is done in house and carries no charge, so a stored 0 is a DELIBERATE
 * FACT ("it cost nothing") while a null means nobody entered anything. Those are
 * different statements and collapsing them is how a measurement gap gets read as
 * a measurement. The page renders them with distinct words and never totals
 * washing into any cost report.
 *
 * @returns {{records:number, noCharge:number, charged:number, notRecorded:number,
 *   chargedTotal:number|null, allNoCharge:boolean, note:string}}
 */
export function costBasis(rows) {
  const src = Array.isArray(rows) ? rows : []
  let noCharge = 0
  let charged = 0
  let notRecorded = 0
  let chargedTotal = 0
  for (const r of src) {
    const raw = r ? r.cost : null
    if (raw === null || raw === undefined || raw === '') { notRecorded += 1; continue }
    const n = Number(raw)
    if (!Number.isFinite(n)) { notRecorded += 1; continue }
    if (n === 0) noCharge += 1
    else { charged += 1; chargedTotal += n }
  }
  let note
  if (!src.length) note = 'No wash records in scope, so there is nothing to state about cost.'
  else if (charged === 0 && noCharge === 0) note = 'No cost has been recorded on any of these washes.'
  else if (charged === 0) note = 'Washing is done in house at no charge. Every wash in scope is recorded as costing nothing.'
  else note = `${charged} of these washes were charged by a vendor. The rest were done in house at no charge.`

  return {
    records: src.length,
    noCharge,
    charged,
    notRecorded,
    chargedTotal: charged > 0 ? chargedTotal : null,
    allNoCharge: src.length > 0 && charged === 0 && noCharge > 0,
    note,
  }
}

/**
 * Render one record's cost. Zero is "No charge" (a fact), null is
 * "Not recorded" (a gap). Never render them the same way.
 */
export function formatWashCost(value) {
  if (value === null || value === undefined || value === '') return 'Not recorded'
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Not recorded'
  if (n === 0) return 'No charge'
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
