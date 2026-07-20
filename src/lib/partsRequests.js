/**
 * partsRequests.js - pure, deterministic analytics + lifecycle rules for the
 * Parts Request module. No I/O, no Date.now() reads except where a `now` is
 * injected, so the output is fully testable. Consumed by PartsRequests.jsx for
 * its KPI tiles and charts, and reusable by any headless caller.
 *
 * A technician raises a parts request for a job (status 'requested'); a foreman
 * or storekeeper approves ('approved'), issues ('issued') and marks it fulfilled
 * ('fulfilled') - which is what resolves the technician's blocked-for-parts time.
 * 'rejected' and 'cancelled' are terminal exits.
 *
 * A "parts request" row has (at least): status, qty, part_name, requested_at
 * (ISO), fulfilled_at (ISO or null), needed_by (ISO or null).
 *
 * All maths degrade honestly on empty / missing data - never NaN, never a
 * fabricated figure. Averages are null (not 0) when there is nothing to average.
 */

/** Canonical status vocabulary (mirrors the DB CHECK on parts_requests.status). */
export const PARTS_STATUS = Object.freeze([
  'requested',
  'approved',
  'issued',
  'fulfilled',
  'rejected',
  'cancelled',
])

/** Human labels per status. */
export const PARTS_STATUS_LABEL = Object.freeze({
  requested: 'Requested',
  approved: 'Approved',
  issued: 'Issued',
  fulfilled: 'Fulfilled',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
})

/** Priority vocabulary + labels (advisory; the DB column is free text). */
export const PARTS_PRIORITIES = Object.freeze(['low', 'medium', 'high', 'critical'])
export const PARTS_PRIORITY_LABEL = Object.freeze({
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
})

/**
 * Forward lifecycle flow. Each open status advances to the next; the two
 * terminal exits (reject / cancel) are reachable from any open status.
 *   requested -> approved -> issued -> fulfilled
 * Terminal statuses have no onward transitions.
 */
export const PARTS_STATUS_FLOW = Object.freeze({
  requested: Object.freeze(['approved', 'rejected', 'cancelled']),
  approved: Object.freeze(['issued', 'rejected', 'cancelled']),
  issued: Object.freeze(['fulfilled', 'rejected', 'cancelled']),
  fulfilled: Object.freeze([]),
  rejected: Object.freeze([]),
  cancelled: Object.freeze([]),
})

/** Terminal statuses that close a request (no more work). */
const TERMINAL = new Set(['fulfilled', 'rejected', 'cancelled'])

/** Statuses that still occupy the workshop (a tech may be blocked waiting). */
const OPEN = new Set(['requested', 'approved', 'issued'])

/** Normalise a raw status to a known lowercase token, or '' when unknown. */
export function normalizePartsStatus(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase()
  return PARTS_STATUS.includes(s) ? s : ''
}

/** True when a request is still open (not fulfilled / rejected / cancelled). */
export function isOpenParts(status) {
  return OPEN.has(normalizePartsStatus(status))
}

/** True when a status is terminal (fulfilled / rejected / cancelled). */
export function isTerminalParts(status) {
  return TERMINAL.has(normalizePartsStatus(status))
}

/**
 * The next status a given action advances to, or null when the move is not
 * allowed from the current status. `to` may be any target in the flow.
 */
export function canAdvanceParts(from, to) {
  const f = normalizePartsStatus(from)
  const t = normalizePartsStatus(to)
  if (!f || !t) return false
  return (PARTS_STATUS_FLOW[f] || []).includes(t)
}

/** The single "primary" forward step (skips the reject/cancel exits), or null. */
export function nextPartsStatus(from) {
  const f = normalizePartsStatus(from)
  const onward = PARTS_STATUS_FLOW[f] || []
  // The first non-terminal-exit target is the forward step.
  return onward.find((s) => s !== 'rejected' && s !== 'cancelled') || null
}

/** Parse an ISO-ish timestamp to epoch ms, or null when unparseable / empty. */
function ms(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Age of a request in hours = requested_at -> (fulfilled_at OR now).
 * Returns null when requested_at is missing / unparseable. Never negative.
 */
export function partAgeHours(row, now = new Date()) {
  const start = ms(row && row.requested_at)
  if (start == null) return null
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now()
  const end = ms(row && row.fulfilled_at) ?? nowMs
  const hrs = (end - start) / 3600000
  return hrs < 0 ? 0 : Math.round(hrs * 10) / 10
}

/** Coerce a qty to a finite non-negative number (default 0). */
function qtyOf(row) {
  const n = Number(row && row.qty)
  return Number.isFinite(n) && n > 0 ? n : (Number.isFinite(n) ? n : 0)
}

/** Best display name for the requested part. */
function partLabel(row) {
  const name = row && row.part_name != null ? String(row.part_name).trim() : ''
  return name || 'Unspecified part'
}

/**
 * Headline summary over the given rows. Honest zeros / nulls on empty input.
 *
 * @param {object[]} rows
 * @param {{now?:Date}} [opts]
 * @returns {{
 *   total:number, open:number, fulfilled:number, overdue:number,
 *   byStatus:Object<string,number>,
 *   avgFulfilOreHours:(number|null),
 *   byPart:{part:string,count:number,qty:number}[]
 * }}
 */
export function summarizeParts(rows, { now = new Date() } = {}) {
  const src = Array.isArray(rows) ? rows : []
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now()

  const byStatus = PARTS_STATUS.reduce((acc, s) => { acc[s] = 0; return acc }, {})
  let open = 0
  let fulfilled = 0
  let overdue = 0

  // Fulfil-time accumulation (requested_at -> fulfilled_at) for the average.
  let fulfilHoursSum = 0
  let fulfilCount = 0

  const partMap = new Map()

  for (const r of src) {
    if (!r) continue
    const status = normalizePartsStatus(r.status)
    if (status) byStatus[status] += 1

    const openNow = OPEN.has(status)
    if (openNow) open += 1
    if (status === 'fulfilled') fulfilled += 1

    // Overdue: past its needed_by and not yet fulfilled (and not a terminal exit).
    const need = ms(r.needed_by)
    if (need != null && need < nowMs && status !== 'fulfilled' && !TERMINAL.has(status)) {
      overdue += 1
    }
    // A rejected/cancelled request that also had a needed_by is not "overdue"
    // (it will never be worked) - deliberately excluded above.

    // Average time-to-fulfil, only over rows that actually reached fulfilled.
    if (status === 'fulfilled') {
      const start = ms(r.requested_at)
      const end = ms(r.fulfilled_at)
      if (start != null && end != null && end >= start) {
        fulfilHoursSum += (end - start) / 3600000
        fulfilCount += 1
      }
    }

    const key = partLabel(r)
    const cur = partMap.get(key) || { part: key, count: 0, qty: 0 }
    cur.count += 1
    cur.qty += qtyOf(r)
    partMap.set(key, cur)
  }

  const byPart = [...partMap.values()].sort(
    (a, b) => b.count - a.count || b.qty - a.qty || a.part.localeCompare(b.part),
  )

  const avgFulfilOreHours = fulfilCount > 0
    ? Math.round((fulfilHoursSum / fulfilCount) * 10) / 10
    : null

  return {
    total: src.length,
    open,
    fulfilled,
    overdue,
    byStatus,
    avgFulfilOreHours,
    byPart,
  }
}
