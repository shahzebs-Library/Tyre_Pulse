/**
 * fleetRenewalAnalytics.js - pure (no I/O) analytics engine over Fleet Renewal
 * plans (`fleet_renewal_plans` rows). Deepens the Fleet Renewal Planning module
 * with replacement-pipeline, budget, due-band and overdue intelligence while the
 * lightweight status/priority aggregation stays in ./fleetRenewal (summarizeRenewal).
 *
 * Every clock-dependent function takes an injected `now`, so nothing here reads
 * a live clock implicitly and all results are deterministic + unit-testable.
 *
 * A "plan" is a fleet_renewal_plans row:
 *   { id, asset_no, current_km, age_years, recommendation, target_replace_date,
 *     est_cost, priority ('low'|'medium'|'high'),
 *     status ('planned'|'approved'|'deferred'|'completed'),
 *     site, notes, created_at, updated_at }
 * plus optional `vehicle_type` when the caller enriches rows from vehicle_fleet.
 *
 * HONEST BY DESIGN: every result degrades to null / 0 / [] when there is no
 * usable data. The estimated budget is null (render "N/A") when NO row carries a
 * cost - it is never faked or back-filled. Rows are grouped ONLY by columns that
 * exist on the record; a breakdown with no source data returns an empty list.
 */

export const RENEWAL_STATUSES = ['planned', 'approved', 'deferred', 'completed']
export const RENEWAL_PRIORITIES = ['low', 'medium', 'high']

export const RENEWAL_STATUS_LABEL = {
  planned: 'Planned',
  approved: 'Approved',
  deferred: 'Deferred',
  completed: 'Completed',
}
export const RENEWAL_PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' }

// Statuses that still represent an outstanding (not yet retired) asset.
const OPEN_STATUSES = ['planned', 'approved', 'deferred']

// Priority ordering for sort tie-breaks (higher rank = more urgent).
const PRIORITY_RANK = { high: 3, medium: 2, low: 1 }

/**
 * Age bands (years). Ordered low -> high, half-open [min, max).
 * Only rows with a finite age_years are counted.
 */
export const AGE_BANDS = [
  { key: 'under5', label: 'Under 5 yrs', min: 0, max: 5 },
  { key: '5to10', label: '5 to 10 yrs', min: 5, max: 10 },
  { key: '10to15', label: '10 to 15 yrs', min: 10, max: 15 },
  { key: '15plus', label: '15 yrs and over', min: 15, max: Infinity },
]

/**
 * Mileage bands (km). Ordered low -> high, half-open [min, max).
 * Only rows with a finite current_km are counted.
 */
export const MILEAGE_BANDS = [
  { key: 'under100k', label: 'Under 100k km', min: 0, max: 100000 },
  { key: '100to250k', label: '100k to 250k km', min: 100000, max: 250000 },
  { key: '250to500k', label: '250k to 500k km', min: 250000, max: 500000 },
  { key: '500kplus', label: '500k km and over', min: 500000, max: Infinity },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const asArray = (rows) => (Array.isArray(rows) ? rows : [])

/** Finite number or null (does NOT coerce blanks to 0 - preserves "unknown"). */
export function numOrNull(value) {
  if (value === '' || value == null) return null
  const n = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(n) ? n : null
}

/** Finite number or 0 (for summation). */
function num(value) {
  const n = numOrNull(value)
  return n == null ? 0 : n
}

/** Parse a date-ish value to a Date at UTC midnight, or null. */
export function toDate(value) {
  if (!value) return null
  const s = String(value).slice(0, 10)
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole days from `now` to `date` (positive = future). null when unparseable. */
export function daysUntil(dateValue, now = new Date()) {
  const d = toDate(dateValue)
  if (!d) return null
  const base = toDate(now) || new Date(now)
  if (Number.isNaN(base.getTime())) return null
  const b = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return Math.round((t - b) / 86400000)
}

const isOpen = (r) => OPEN_STATUSES.includes(r?.status)

// -- Distributions ------------------------------------------------------------

/** Count + summed est_cost per lifecycle status (fixed order). */
export function statusDistribution(rows) {
  const list = asArray(rows)
  return RENEWAL_STATUSES.map((status) => {
    const inStatus = list.filter((r) => r?.status === status)
    return {
      key: status,
      label: RENEWAL_STATUS_LABEL[status],
      count: inStatus.length,
      estCost: inStatus.reduce((s, r) => s + num(r?.est_cost), 0),
    }
  })
}

/** Count + summed est_cost per priority (fixed order low -> high). */
export function priorityDistribution(rows) {
  const list = asArray(rows)
  return RENEWAL_PRIORITIES.map((priority) => {
    const inPri = list.filter((r) => r?.priority === priority)
    return {
      key: priority,
      label: RENEWAL_PRIORITY_LABEL[priority],
      count: inPri.length,
      estCost: inPri.reduce((s, r) => s + num(r?.est_cost), 0),
    }
  })
}

/**
 * Generic breakdown by any column present on the row.
 * Returns [{ key, count, estCost, withCost }] sorted by count desc then key asc.
 * Rows missing the field are bucketed under `blankLabel` (default 'Unassigned').
 * A breakdown over a field NO row carries returns [] (honest empty).
 */
export function groupByField(rows, field, blankLabel = 'Unassigned') {
  const list = asArray(rows)
  if (!field) return []
  const anyPresent = list.some((r) => {
    const v = r?.[field]
    return v != null && String(v).trim() !== ''
  })
  if (!anyPresent) return []
  const map = new Map()
  for (const r of list) {
    const raw = r?.[field]
    const key = raw != null && String(raw).trim() !== '' ? String(raw).trim() : blankLabel
    const cur = map.get(key) || { key, count: 0, estCost: 0, withCost: 0 }
    cur.count += 1
    const c = numOrNull(r?.est_cost)
    if (c != null) { cur.estCost += c; cur.withCost += 1 }
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** Breakdown by site (real column). */
export function bySite(rows) {
  return groupByField(rows, 'site')
}

/** Breakdown by vehicle_type (present only on caller-enriched rows). */
export function byVehicleType(rows) {
  return groupByField(rows, 'vehicle_type')
}

// -- Renewal pipeline (by target_replace_date) --------------------------------

/**
 * Replacement pipeline bucketed by target_replace_date.
 *   granularity: 'month' -> key 'YYYY-MM', label 'Mon YYYY'
 *                'year'  -> key 'YYYY',    label 'YYYY'
 * Buckets appear only for periods that have dated plans, sorted ascending.
 * Rows with no target_replace_date are surfaced separately as `undated`.
 * `overdue`/`upcoming` split each dated bucket relative to `now`.
 * Every completed plan is excluded from overdue (it is already actioned).
 */
export function renewalPipeline(rows, { granularity = 'month', now = new Date() } = {}) {
  const list = asArray(rows)
  const buckets = new Map()
  let undatedCount = 0
  let undatedCost = 0

  for (const r of list) {
    const d = toDate(r?.target_replace_date)
    if (!d) {
      undatedCount += 1
      undatedCost += num(r?.est_cost)
      continue
    }
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth()
    const key = granularity === 'year' ? String(y) : `${y}-${String(m + 1).padStart(2, '0')}`
    const label = granularity === 'year' ? String(y) : `${MONTHS[m]} ${y}`
    const cur = buckets.get(key) || { key, label, count: 0, estCost: 0 }
    cur.count += 1
    cur.estCost += num(r?.est_cost)
    buckets.set(key, cur)
  }

  const periods = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))
  const overdue = overduePlans(list, now)
  return {
    granularity,
    periods,
    undated: { count: undatedCount, estCost: undatedCost },
    overdueCount: overdue.length,
    overdueCost: overdue.reduce((s, r) => s + num(r?.est_cost), 0),
    hasDated: periods.length > 0,
  }
}

// -- Budget -------------------------------------------------------------------

/**
 * Estimated renewal budget. HONEST: `total` is null when NO row carries a cost,
 * so the UI renders "N/A" rather than a fabricated 0. Also reports coverage so
 * the operator knows how much of the plan set is costed.
 */
export function estimateBudget(rows) {
  const list = asArray(rows)
  const costed = list.filter((r) => numOrNull(r?.est_cost) != null)
  const total = costed.reduce((s, r) => s + num(r?.est_cost), 0)
  const openCosted = costed.filter(isOpen)
  return {
    total: costed.length ? total : null,
    openTotal: openCosted.length ? openCosted.reduce((s, r) => s + num(r?.est_cost), 0) : null,
    withCost: costed.length,
    withoutCost: list.length - costed.length,
    total_plans: list.length,
    coverage: list.length ? costed.length / list.length : 0,
  }
}

// -- Due bands (age / mileage) ------------------------------------------------

function bandCounts(rows, field, bands) {
  const list = asArray(rows)
  const withValue = list.filter((r) => numOrNull(r?.[field]) != null)
  const out = bands.map((b) => ({ key: b.key, label: b.label, count: 0 }))
  for (const r of withValue) {
    const v = numOrNull(r?.[field])
    const idx = bands.findIndex((b) => v >= b.min && v < b.max)
    if (idx >= 0) out[idx].count += 1
  }
  return { bands: out, withData: withValue.length, hasData: withValue.length > 0 }
}

/** Distribution of plans across AGE_BANDS (only rows with age_years). */
export function ageBands(rows) {
  return bandCounts(rows, 'age_years', AGE_BANDS)
}

/** Distribution of plans across MILEAGE_BANDS (only rows with current_km). */
export function mileageBands(rows) {
  return bandCounts(rows, 'current_km', MILEAGE_BANDS)
}

// -- Overdue / upcoming -------------------------------------------------------

/** Open plans whose target_replace_date is on/before today. */
export function overduePlans(rows, now = new Date()) {
  return asArray(rows).filter((r) => {
    if (!isOpen(r)) return false
    const d = daysUntil(r?.target_replace_date, now)
    return d != null && d <= 0
  })
}

/** Open plans due within `days` from now (0 < days ahead <= window). */
export function dueWithin(rows, days = 90, now = new Date()) {
  return asArray(rows).filter((r) => {
    if (!isOpen(r)) return false
    const d = daysUntil(r?.target_replace_date, now)
    return d != null && d > 0 && d <= days
  })
}

/**
 * Sort by soonest action first: overdue/nearest target date first, undated last,
 * high priority breaking ties. Non-mutating (returns a new array).
 */
export function sortBySoonest(rows, now = new Date()) {
  return asArray(rows)
    .slice()
    .sort((a, b) => {
      const da = daysUntil(a?.target_replace_date, now)
      const db = daysUntil(b?.target_replace_date, now)
      if (da == null && db == null) {
        return (PRIORITY_RANK[b?.priority] || 0) - (PRIORITY_RANK[a?.priority] || 0)
      }
      if (da == null) return 1
      if (db == null) return -1
      if (da !== db) return da - db
      return (PRIORITY_RANK[b?.priority] || 0) - (PRIORITY_RANK[a?.priority] || 0)
    })
}

// -- KPIs ---------------------------------------------------------------------

/**
 * Headline KPIs for the module (8). Clock-dependent values use injected `now`.
 * Budget-derived tiles carry null when no row is costed so the UI shows "N/A".
 */
export function buildRenewalKpis(rows, now = new Date()) {
  const list = asArray(rows)
  const budget = estimateBudget(list)
  const overdue = overduePlans(list, now)
  const soon = dueWithin(list, 90, now)
  const open = list.filter(isOpen)
  const highOpen = open.filter((r) => r?.priority === 'high')
  const ages = list.map((r) => numOrNull(r?.age_years)).filter((v) => v != null)
  const avgAge = ages.length ? ages.reduce((s, v) => s + v, 0) / ages.length : null

  return {
    total: list.length,
    open: open.length,
    completed: list.filter((r) => r?.status === 'completed').length,
    highPriorityOpen: highOpen.length,
    overdue: overdue.length,
    dueSoon: soon.length,
    estBudget: budget.total,
    openBudget: budget.openTotal,
    avgAge,
    budgetCoverage: budget.coverage,
  }
}

/**
 * Deterministic, honest recommendations derived ONLY from loaded data.
 * Returns [] when nothing is noteworthy.
 */
export function buildRenewalInsights(rows, now = new Date()) {
  const list = asArray(rows)
  if (!list.length) return []
  const out = []
  const overdue = overduePlans(list, now)
  if (overdue.length) {
    out.push(`${overdue.length} open plan${overdue.length === 1 ? '' : 's'} past the target replacement date.`)
  }
  const soon = dueWithin(list, 90, now)
  if (soon.length) {
    out.push(`${soon.length} plan${soon.length === 1 ? '' : 's'} due for replacement within 90 days.`)
  }
  const highOpen = list.filter((r) => isOpen(r) && r?.priority === 'high')
  if (highOpen.length) {
    out.push(`${highOpen.length} high priority plan${highOpen.length === 1 ? '' : 's'} still open.`)
  }
  const budget = estimateBudget(list)
  if (budget.withoutCost > 0 && budget.total_plans > 0) {
    out.push(`${budget.withoutCost} of ${budget.total_plans} plans have no estimated cost, so the budget is understated.`)
  }
  return out
}
