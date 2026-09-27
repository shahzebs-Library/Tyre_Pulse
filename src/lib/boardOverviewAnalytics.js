/**
 * boardOverviewAnalytics - pure presentation helpers for the Board Overview
 * report (/board-overview). The KPI, trend, breakdown and recommendation maths
 * live in `./boardOverview.js` (over kpiEngine + claimsAnalytics) and the
 * currency split lives in `./boardScope.js`; both are reused by the page, never
 * re-derived here. This module owns only what the page used to compute inline:
 *
 *   - the persisted section toggles (merge + visible count),
 *   - the client-side date range applied to the loaded rows,
 *   - the "worst asset types by CPK" table rows,
 *   - the headline tiles as rows for the Excel summary export.
 *
 * No I/O and no clock read.
 *
 * DATES. The range test is a string prefix comparison on 'YYYY-MM-DD', never
 * `new Date(string)` (the timezone trap). With no range active every row passes;
 * with a range active a row with no usable date is excluded, never a crash.
 */

export const SECTION_KEYS = Object.freeze([
  'kpis', 'trends', 'yearlyTrend', 'charts', 'costSplit', 'fleetCpk', 'builder', 'recommendations',
])
export const SECTION_DEFAULTS = Object.freeze(Object.fromEntries(SECTION_KEYS.map((k) => [k, true])))

/** Merge a persisted toggle map over the defaults, ignoring unknown keys and non-booleans. */
export function mergeSections(stored) {
  const out = { ...SECTION_DEFAULTS }
  if (stored && typeof stored === 'object') {
    for (const k of SECTION_KEYS) {
      if (typeof stored[k] === 'boolean') out[k] = stored[k]
    }
  }
  return out
}

export function visibleSectionCount(sections = {}) {
  return SECTION_KEYS.filter((k) => sections[k]).length
}

export function inDateRange(d, from, to) {
  const s = d ? String(d).slice(0, 10) : ''
  if (!s) return !(from || to)
  if (from && s < from) return false
  if (to && s > to) return false
  return true
}

/**
 * Apply the board's date range to the loaded rows: tyres by issue_date,
 * accidents by incident_date, inspections by completed_date (falling back to
 * scheduled_date) and work orders by completed_at (falling back to created_at).
 * With no range the arrays pass through untouched (same references).
 */
export function applyBoardDateRange(raw, from, to) {
  if (!raw) return null
  const active = Boolean(from || to)
  const pick = (rows, dateOf) => (active ? (rows || []).filter((r) => inDateRange(dateOf(r), from, to)) : (rows || []))
  return {
    active,
    tyres: pick(raw.tyres, (r) => r.issue_date),
    accidents: pick(raw.accidents, (r) => r.incident_date),
    inspections: pick(raw.inspections, (r) => r.completed_date || r.scheduled_date),
    workOrders: pick(raw.workOrders, (r) => r.completed_at || r.created_at),
  }
}

/**
 * Rows for the "worst asset types by CPK" table. Each keeps its own country and
 * currency; nothing is added across rows. A missing CPK stays null.
 */
export function cpkTypeRows(types = []) {
  return (Array.isArray(types) ? types : []).map((r, i) => {
    // Number(null) is 0 and 0 is finite: test the blank BEFORE coercing, or a
    // missing reading turns into a measured zero.
    const blank = (v) => v == null || v === ''
    const d = blank(r?.distance_or_hours) ? NaN : Number(r.distance_or_hours)
    const cpk = blank(r?.cpk_total) ? null : Number(r.cpk_total)
    return {
      id: `${r?.country || ''}-${r?.vehicle_type || ''}-${r?.unit || ''}-${i}`,
      vehicle_type: r?.vehicle_type || 'Unspecified',
      country: r?.country || '',
      currency: r?.currency || r?.country || '',
      unit: r?.unit || 'km',
      distance: Number.isFinite(d) ? d : null,
      cpk: Number.isFinite(cpk) ? cpk : null,
      rank: i + 1,
    }
  })
}

/** Headline tiles [[label, value], ...] as rows for the summary export. */
export function tileExportRows(tiles = [], scope = '') {
  return (Array.isArray(tiles) ? tiles : []).map(([label, value]) => ({
    metric: String(label ?? ''),
    value: value == null || value === '' ? 'N/A' : String(value),
    scope: String(scope || ''),
  }))
}
