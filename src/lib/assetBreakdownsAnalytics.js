/**
 * assetBreakdownsAnalytics - pure presentation engine for the Breakdown
 * Register page (/asset-breakdowns). All downtime arithmetic (downDays,
 * daysToReturn, isOverdue, severityOf, the summary, bands, groups, findings and
 * the export) lives in `./assetBreakdowns.js` and is REUSED here, never
 * re-derived. This module only shapes that output for the page: the register
 * rows, the return-date label, filter bookkeeping, site bars and the options.
 *
 * THE RULE THIS PAGE INHERITS: a breakdown closes ONLY when a return to service
 * is recorded, never because the promised date passed. And a machine whose
 * downtime cannot be measured reads "Not recorded", never 0 days - zero would
 * sort it as the healthiest machine in the fleet.
 *
 * No I/O and no clock read: `now` is always injected.
 */
import {
  downDays, daysToReturn, isOverdue, severityOf, repairLabel, EMPTY_BREAKDOWN_FILTERS,
} from './assetBreakdowns'

export const NOT_RECORDED = 'Not recorded'

/** Days-down text: a real number of days, or Not recorded. Never 0 by default. */
export function downDaysLabel(d) {
  if (d == null || !Number.isFinite(Number(d))) return NOT_RECORDED
  const n = Number(d)
  return `${n} day${n === 1 ? '' : 's'}`
}

/** Plain-English distance to the promised return date. */
export function returnLabel(dtr) {
  if (dtr == null) return null
  if (dtr < 0) return `${Math.abs(dtr)} day${Math.abs(dtr) === 1 ? '' : 's'} late`
  if (dtr === 0) return 'due today'
  return `in ${dtr} day${dtr === 1 ? '' : 's'}`
}

/** How many filters differ from the default view (state defaults to 'open'). */
export function activeBreakdownFilterCount(filters = {}) {
  const f = { ...EMPTY_BREAKDOWN_FILTERS, ...(filters || {}) }
  return Object.entries(f).filter(([k, v]) => (k === 'state' ? v !== 'open' : !!String(v || '').trim())).length
}

/**
 * Register rows, longest down first. Rows with unmeasurable downtime sort LAST
 * rather than as zero, so they never masquerade as the freshest breakdowns.
 */
export function breakdownRegisterRows(rows = [], now) {
  const shaped = (Array.isArray(rows) ? rows : []).filter(Boolean).map((r) => {
    const d = downDays(r, now)
    const dtr = daysToReturn(r, now)
    return {
      ...r,
      _down: d,
      _downLabel: downDaysLabel(d),
      _dtr: dtr,
      _returnLabel: r.returned_to_service ? null : returnLabel(dtr),
      _overdue: isOverdue(r, now),
      _severity: severityOf(r, now),
      _repairLabel: repairLabel(r.repair_location),
      _state: r.returned_to_service ? 'Back in service' : isOverdue(r, now) ? 'Past promised date' : 'Down',
    }
  })
  return shaped.sort((a, b) => {
    if (a._down == null && b._down == null) return 0
    if (a._down == null) return 1
    if (b._down == null) return -1
    return b._down - a._down
  })
}

/** Distinct sites for the filter, sorted. */
export function breakdownSiteOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.site).filter(Boolean))].sort()
}

/**
 * Site bars from the byGroup output: width is each site's share of the most
 * days lost, so the worst site reads full width. A site with days unknown keeps
 * a thin sliver so it still shows it exists.
 */
export function siteBars(groups = [], limit = 8) {
  const list = (Array.isArray(groups) ? groups : []).slice(0, limit)
  const max = Math.max(1, ...list.map((g) => Number(g.days) || 0))
  return list.map((g) => ({
    ...g,
    widthPct: Math.max(3, Math.round(((Number(g.days) || 0) / max) * 100)),
  }))
}

/** Share of open breakdowns that have missed their promised date (null when none open). */
export function overdueShare(summary) {
  if (!summary || !summary.open) return null
  return Math.round((summary.overdue / summary.open) * 100)
}
