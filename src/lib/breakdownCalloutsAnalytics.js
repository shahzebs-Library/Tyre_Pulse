/**
 * breakdownCalloutsAnalytics - pure presentation engine for the Breakdown
 * Callouts page (/breakdown-callouts). Response/resolution timing and the fleet
 * summary live in `./breakdownCallouts.js` and are REUSED here, never
 * re-derived. This module shapes that output for the page: filters, the KPI
 * strip, cost per currency, the by-type and by-provider breakdowns, SLA bands,
 * table rows and export rows.
 *
 * CURRENCY IS THE HARD RULE. Callouts carry their own currency and a fleet can
 * span SAR, AED and EGP. Costs are therefore summed PER CURRENCY and a single
 * total is only reported when exactly one currency is present; otherwise the
 * total is null (N/A) and the per-currency list is the answer. A callout with
 * no cost recorded contributes nothing, never a fabricated 0.
 *
 * No I/O and no clock read.
 */
import { summariseCallouts, responseMinutes, resolutionMinutes, toFiniteNumber } from './breakdownCallouts'

export { responseMinutes, resolutionMinutes }

export const CALLOUT_TYPES = Object.freeze(['tyre', 'engine', 'electrical', 'brakes', 'transmission', 'accident', 'fuel', 'other'])
export const CALLOUT_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical'])
export const CALLOUT_STATUSES = Object.freeze(['reported', 'dispatched', 'on_site', 'resolved', 'cancelled'])
export const CALLOUT_STATUS_LABEL = Object.freeze({
  reported: 'Reported', dispatched: 'Dispatched', on_site: 'On site', resolved: 'Resolved', cancelled: 'Cancelled',
})

/** Response SLA bands in minutes: within an hour is on target. */
export const RESPONSE_SLA_MIN = 60

export const titleCase = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1).replace(/_/g, ' ') : 'N/A')
export const calloutStatusLabel = (s) => CALLOUT_STATUS_LABEL[s] || (s ? String(s) : 'N/A')

export function isCalloutOpen(c) {
  const s = String(c?.status || '').toLowerCase()
  return s !== 'resolved' && s !== 'cancelled'
}

export function fmtMinutes(m) {
  if (m == null || !Number.isFinite(Number(m))) return 'N/A'
  const n = Math.round(Number(m))
  if (n < 60) return `${n} min`
  const h = Math.floor(n / 60)
  const r = n % 60
  if (h >= 48) return `${Math.round(h / 24)} days`
  return r ? `${h}h ${r}m` : `${h}h`
}

export const EMPTY_CALLOUT_FILTERS = Object.freeze({
  search: '', country: '', status: '', severity: '', type: '', openOnly: false,
})

export function activeCalloutFilterCount(f = {}) {
  return ['search', 'country', 'status', 'severity', 'type'].filter((k) => String(f[k] || '').trim()).length
    + (f.openOnly ? 1 : 0)
}

export function filterCallouts(rows = [], f = {}) {
  const q = String(f.search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r) return false
    if (f.country && r.country !== f.country) return false
    if (f.status && r.status !== f.status) return false
    if (f.severity && r.severity !== f.severity) return false
    if (f.type && r.breakdown_type !== f.type) return false
    if (f.openOnly && !isCalloutOpen(r)) return false
    if (q) {
      const hay = [r.callout_no, r.asset_no, r.driver_name, r.location, r.provider, r.resolution, r.notes]
        .map((x) => (x == null ? '' : String(x))).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Sum of costs per currency. Rows with no cost are skipped; unknown currency is ''. */
export function costByCurrency(rows = []) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const cost = toFiniteNumber(r?.cost)
    if (cost == null) continue
    const cur = String(r?.currency || '').trim().toUpperCase()
    map.set(cur, (map.get(cur) || 0) + cost)
  }
  return [...map.entries()].map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total)
}

/**
 * KPI strip. Reuses summariseCallouts for counts and timings but replaces its
 * blended totalCost with a currency-safe total (null when mixed or absent).
 */
export function calloutKpis(rows = []) {
  const s = summariseCallouts(rows)
  const list = Array.isArray(rows) ? rows : []
  const costs = costByCurrency(list)
  const withResp = list.map(responseMinutes).filter((m) => m != null)
  const onTarget = withResp.filter((m) => m <= RESPONSE_SLA_MIN).length
  const resolved = list.filter((r) => String(r?.status || '').toLowerCase() === 'resolved').length
  return {
    totalCallouts: s.totalCallouts,
    openCount: s.openCount,
    criticalOpenCount: s.criticalOpenCount,
    avgResponseMinutes: s.avgResponseMinutes,
    avgResolutionMinutes: s.avgResolutionMinutes,
    resolvedCount: resolved,
    responseMeasured: withResp.length,
    responseSlaPct: withResp.length ? Math.round((onTarget / withResp.length) * 100) : null,
    costs,
    singleCurrencyCost: costs.length === 1 ? costs[0] : null,
    mixedCurrency: costs.length > 1,
  }
}

/** Callouts grouped by type with a count and per-currency cost. */
export function calloutsByType(rows = []) {
  const groups = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = r?.breakdown_type ? String(r.breakdown_type).trim() || 'other' : 'other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  return [...groups.entries()].map(([type, list]) => ({
    type, label: titleCase(type), count: list.length,
    open: list.filter(isCalloutOpen).length, costs: costByCurrency(list),
  })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
}

/** Provider league: callouts attended and average response, slowest first. */
export function providerPerformance(rows = []) {
  const groups = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = String(r?.provider || '').trim()
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  return [...groups.entries()].map(([provider, list]) => {
    const resp = list.map(responseMinutes).filter((m) => m != null)
    return {
      provider,
      callouts: list.length,
      avgResponseMinutes: resp.length ? Math.round(resp.reduce((a, b) => a + b, 0) / resp.length) : null,
      measured: resp.length,
    }
  }).sort((a, b) => (b.avgResponseMinutes ?? -1) - (a.avgResponseMinutes ?? -1) || b.callouts - a.callouts)
}

export function countryOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.country).filter(Boolean))].sort()
}

export function calloutTableRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    ...r,
    _response: responseMinutes(r),
    _resolution: resolutionMinutes(r),
    _cost: toFiniteNumber(r.cost),
    _open: isCalloutOpen(r),
    _statusLabel: calloutStatusLabel(r.status),
  }))
}

export const CALLOUT_EXPORT_COLUMNS = Object.freeze([
  ['callout_no', 'Callout #'], ['asset_no', 'Asset'], ['breakdown_type', 'Type'], ['severity', 'Severity'],
  ['status', 'Status'], ['driver_name', 'Driver'], ['location', 'Location'], ['provider', 'Provider'],
  ['reported_at', 'Reported'], ['response_minutes', 'Response (min)'], ['resolution_minutes', 'Resolution (min)'],
  ['cost', 'Cost'], ['currency', 'Currency'],
])

export function calloutExportRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    callout_no: r.callout_no || '',
    asset_no: r.asset_no || '',
    breakdown_type: r.breakdown_type ? titleCase(r.breakdown_type) : '',
    severity: r.severity ? titleCase(r.severity) : '',
    status: r.status ? calloutStatusLabel(r.status) : '',
    driver_name: r.driver_name || '',
    location: r.location || '',
    provider: r.provider || '',
    reported_at: r.reported_at ? String(r.reported_at).replace('T', ' ').slice(0, 16) : '',
    response_minutes: responseMinutes(r) ?? '',
    resolution_minutes: resolutionMinutes(r) ?? '',
    cost: toFiniteNumber(r.cost) ?? '',
    currency: r.currency || '',
  }))
}
