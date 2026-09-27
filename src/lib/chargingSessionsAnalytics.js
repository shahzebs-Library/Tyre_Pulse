/**
 * chargingSessionsAnalytics - the pure engine behind EV Charging Sessions
 * (/charging-sessions). Builds on the primitives in ./chargingSessions
 * (costPerKwh, summariseCharging, toFiniteNumber) and adds what the page used
 * to compute inline: register filtering, the currency check, the per-asset
 * roll-up, the monthly energy trend, the status mix and the export rows.
 *
 * No I/O. Time is injected (`now`) for the monthly window.
 *
 * HONEST NULLS
 *   - Cost totals are only added up inside ONE currency. When sessions carry
 *     more than one currency the money figures are null (N/A) with the
 *     currencies listed; adding SAR to AED is not a number.
 *   - Cost per kWh with no measured energy is null, never 0.
 */
import { costPerKwh, summariseCharging, toFiniteNumber } from './chargingSessions'

export const STATUS_OPTIONS = [
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'interrupted', label: 'Interrupted' },
  { value: 'failed', label: 'Failed' },
]

export const statusLabel = (v) => STATUS_OPTIONS.find((s) => s.value === v)?.label || (v ? String(v) : 'Not set')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The text a register search looks through. */
export function sessionSearchText(r) {
  return `${r?.asset_no || ''} ${r?.station_name || ''} ${r?.connector_type || ''} ${r?.notes || ''}`.toLowerCase()
}

/** Narrow sessions by asset, status, station and free text. */
export function filterSessions(rows = [], { asset = '', status = '', station = '', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (asset && r?.asset_no !== asset) return false
    if (status && r?.status !== status) return false
    if (station && (r?.station_name || '') !== station) return false
    if (q && !sessionSearchText(r).includes(q)) return false
    return true
  })
}

/** Distinct non-blank values of a field, sorted. */
export function distinctValues(rows = [], field) {
  return [...new Set((rows || []).map((r) => (r?.[field] == null ? '' : String(r[field]).trim())).filter(Boolean))].sort()
}

/**
 * Which currencies the costed sessions are in. `single` is the one currency
 * when there is exactly one; `mixed` is true when more than one appears.
 */
export function currencyMix(rows = []) {
  const set = new Set()
  for (const r of rows || []) {
    if (toFiniteNumber(r?.cost) == null) continue
    const c = String(r?.currency || '').trim().toUpperCase()
    if (c) set.add(c)
  }
  const currencies = [...set].sort()
  return { currencies, single: currencies.length === 1 ? currencies[0] : null, mixed: currencies.length > 1 }
}

/**
 * The KPI summary, currency-safe. Energy and counts always add up; money only
 * when the sessions share one currency.
 */
export function summarizeSessions(rows = []) {
  const base = summariseCharging(rows)
  const mix = currencyMix(rows)
  const costed = (rows || []).filter((r) => toFiniteNumber(r?.cost) != null).length
  const measured = (rows || []).filter((r) => toFiniteNumber(r?.energy_kwh) != null).length
  const statusCounts = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, 0]))
  let unset = 0
  for (const r of rows || []) {
    if (statusCounts[r?.status] != null) statusCounts[r.status] += 1
    else unset += 1
  }
  const failedOrInterrupted = statusCounts.failed + statusCounts.interrupted
  return {
    ...base,
    totalCost: mix.mixed || costed === 0 ? null : base.totalCost,
    avgCostPerKwh: mix.mixed ? null : base.avgCostPerKwh,
    currency: mix.single,
    currencies: mix.currencies,
    mixedCurrency: mix.mixed,
    costedSessions: costed,
    measuredSessions: measured,
    statusCounts,
    unsetStatus: unset,
    issueRatePct: base.totalSessions > 0 ? (failedOrInterrupted / base.totalSessions) * 100 : null,
  }
}

/** Per-asset roll-up, ordered by energy delivered. */
export function sessionsByAsset(rows = []) {
  const map = new Map()
  for (const r of rows || []) {
    const asset = String(r?.asset_no || '').trim() || 'Unassigned'
    const cur = map.get(asset) || { asset, sessions: 0, kwh: 0, cost: 0, costed: 0 }
    cur.sessions += 1
    const kwh = toFiniteNumber(r?.energy_kwh)
    if (kwh != null) cur.kwh += kwh
    const cost = toFiniteNumber(r?.cost)
    if (cost != null) { cur.cost += cost; cur.costed += 1 }
    map.set(asset, cur)
  }
  return [...map.values()]
    .map((a) => ({ ...a, cost: a.costed > 0 ? a.cost : null, costPerKwh: a.costed > 0 && a.kwh > 0 ? a.cost / a.kwh : null }))
    .sort((a, b) => b.kwh - a.kwh || a.asset.localeCompare(b.asset))
}

/**
 * Energy and session count per calendar month for the `months` months ending
 * with the month of `now`. Sessions with no start time are left out and
 * counted in `undated`.
 */
export function monthlyEnergy(rows = [], now = Date.now(), months = 12) {
  const end = new Date(now)
  const buckets = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1)
    buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, kwh: 0, sessions: 0 })
  }
  const index = new Map(buckets.map((b) => [b.key, b]))
  let undated = 0
  for (const r of rows || []) {
    const t = r?.started_at ? new Date(r.started_at) : null
    if (!t || Number.isNaN(t.getTime())) { undated += 1; continue }
    const b = index.get(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`)
    if (!b) continue
    b.sessions += 1
    const kwh = toFiniteNumber(r?.energy_kwh)
    if (kwh != null) b.kwh += kwh
  }
  return { buckets, undated }
}

export const SESSION_EXPORT_COLUMNS = [
  { key: 'asset_no', header: 'Asset' },
  { key: 'station_name', header: 'Station' },
  { key: 'connector_type', header: 'Connector' },
  { key: 'started_at', header: 'Started' },
  { key: 'ended_at', header: 'Ended' },
  { key: 'energy_kwh', header: 'Energy (kWh)' },
  { key: 'cost', header: 'Cost' },
  { key: 'currency', header: 'Currency' },
  { key: 'cost_per_kwh', header: 'Cost/kWh' },
  { key: 'start_soc', header: 'Start SoC' },
  { key: 'end_soc', header: 'End SoC' },
  { key: 'duration_min', header: 'Duration (min)' },
  { key: 'status', header: 'Status' },
  { key: 'notes', header: 'Notes' },
]

export function sessionExportRows(rows = []) {
  return (rows || []).map((r) => {
    const cpk = costPerKwh(r)
    return {
      asset_no: r.asset_no || '', station_name: r.station_name || '',
      connector_type: r.connector_type || '', started_at: r.started_at || '',
      ended_at: r.ended_at || '', energy_kwh: r.energy_kwh ?? '',
      cost: r.cost ?? '', currency: r.currency || '',
      cost_per_kwh: cpk == null ? '' : Math.round(cpk * 1000) / 1000,
      start_soc: r.start_soc ?? '', end_soc: r.end_soc ?? '',
      duration_min: r.duration_min ?? '', status: statusLabel(r.status),
      notes: r.notes || '',
    }
  })
}
