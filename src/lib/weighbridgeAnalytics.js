/**
 * weighbridgeAnalytics.js - pure analytics for /weighbridge (no I/O).
 *
 * Weight maths (net weight, overload, overweight test) and the base roll-up
 * live in `weighbridgeTickets.js` and are REUSED. This module adds filtering,
 * the honest-null KPI set (overweight rate over tickets that CAN be judged,
 * average net, average overload), a per-asset load profile, the monthly
 * tonnage trend and export rows.
 *
 * HONESTY NOTES
 * - A ticket with no gross weight or no legal limit cannot be judged over or
 *   under; it is excluded from the overweight rate denominator, and the count
 *   of such tickets is reported so the rate is never read as complete.
 * - summariseTickets reports avgNetKg 0 when no ticket has a net; this module
 *   reports null.
 * - Time-dependent functions take an injectable `now`.
 */
import { netWeight, overloadKg, isOverweight, summariseTickets, toFiniteNumber } from './weighbridgeTickets'

export const TICKET_STATUSES = ['draft', 'recorded', 'overweight', 'disputed', 'cleared']
export const TICKET_STATUS_LABEL = {
  draft: 'Draft', recorded: 'Recorded', overweight: 'Overweight', disputed: 'Disputed', cleared: 'Cleared',
}
export const NO_STATUS = 'No status'

const DAY = 86400000

function toMs(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
function nowMs(now) { return toMs(now ?? new Date()) ?? Date.now() }
function pct(part, whole) { return whole ? Math.round((part / whole) * 1000) / 10 : null }
function monthKey(ms) {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** A ticket is judgeable when it carries both a gross weight and a legal limit. */
export function isJudgeable(t) {
  return toFiniteNumber(t?.gross_weight_kg) != null && toFiniteNumber(t?.gross_limit_kg) != null
}

/** Load as a percentage of the legal limit (null when not judgeable or limit is 0). */
export function loadPct(t) {
  const gross = toFiniteNumber(t?.gross_weight_kg)
  const limit = toFiniteNumber(t?.gross_limit_kg)
  if (gross == null || limit == null || limit <= 0) return null
  return Math.round((gross / limit) * 1000) / 10
}

/** Filter by asset / status / site / overweight / text / weighed date range. */
export function filterTickets(rows = [], f = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  const fromMs = toMs(f.from)
  const toEnd = toMs(f.to)
  const toMsEnd = toEnd == null ? null : toEnd + DAY - 1
  return list.filter((r) => {
    if (f.asset && r?.asset_no !== f.asset) return false
    if (f.status) {
      const s = r?.status || NO_STATUS
      if (s !== f.status) return false
    }
    if (f.site && String(r?.site || '').trim() !== f.site) return false
    if (f.load === 'over' && !isOverweight(r)) return false
    if (f.load === 'within' && (!isJudgeable(r) || isOverweight(r))) return false
    if (f.load === 'unknown' && isJudgeable(r)) return false
    if (fromMs != null || toMsEnd != null) {
      const t = toMs(r?.weighed_at)
      if (t == null) return false
      if (fromMs != null && t < fromMs) return false
      if (toMsEnd != null && t > toMsEnd) return false
    }
    if (q) {
      const hay = `${r?.asset_no || ''} ${r?.ticket_no || ''} ${r?.driver_name || ''} ${r?.site || ''} ${r?.cargo_type || ''} ${r?.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** KPI set built on summariseTickets. */
export function weighbridgeKpis(rows = [], { now } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseTickets(list)
  const n = nowMs(now)
  let judgeable = 0
  let netN = 0
  let overSum = 0
  let last30 = 0
  let disputed = 0
  for (const t of list) {
    if (isJudgeable(t)) judgeable += 1
    if (netWeight(t) != null) netN += 1
    const o = overloadKg(t)
    if (o > 0) overSum += o
    const w = toMs(t?.weighed_at)
    if (w != null && w <= n && n - w <= 30 * DAY) last30 += 1
    if (t?.status === 'disputed') disputed += 1
  }
  return {
    ...base,
    judgeableTickets: judgeable,
    unjudgedTickets: list.length - judgeable,
    overweightRate: pct(base.overweightCount, judgeable),
    avgNetKg: netN ? Math.round(base.totalNetKg / netN) : null,
    totalNetKg: netN ? base.totalNetKg : null,
    avgOverloadKg: base.overweightCount ? Math.round(overSum / base.overweightCount) : null,
    maxOverloadKg: base.overweightCount ? base.maxOverloadKg : null,
    last30Days: last30,
    disputedCount: disputed,
  }
}

/** Per-asset load profile, most overweight first. */
export function assetLoadProfile(rows = [], limit = 10) {
  const map = new Map()
  for (const t of Array.isArray(rows) ? rows : []) {
    const asset = t?.asset_no != null ? String(t.asset_no).trim() : ''
    if (!asset) continue
    const b = map.get(asset) || { asset, tickets: 0, overweight: 0, judgeable: 0, maxOverloadKg: 0, netSum: 0, netN: 0 }
    b.tickets += 1
    if (isJudgeable(t)) b.judgeable += 1
    const o = overloadKg(t)
    if (o > 0) { b.overweight += 1; if (o > b.maxOverloadKg) b.maxOverloadKg = o }
    const net = netWeight(t)
    if (net != null) { b.netSum += net; b.netN += 1 }
    map.set(asset, b)
  }
  return [...map.values()]
    .map((b) => ({
      asset: b.asset, tickets: b.tickets, overweight: b.overweight,
      overweightRate: pct(b.overweight, b.judgeable),
      maxOverloadKg: b.overweight ? b.maxOverloadKg : null,
      avgNetKg: b.netN ? Math.round(b.netSum / b.netN) : null,
    }))
    .sort((a, b) => b.overweight - a.overweight || (b.maxOverloadKg || 0) - (a.maxOverloadKg || 0) || a.asset.localeCompare(b.asset))
    .slice(0, limit)
}

/** Net tonnes and overweight tickets per month for the last `months` months. */
export function monthlyTonnage(rows = [], { now, months = 12 } = {}) {
  const end = new Date(nowMs(now))
  const keys = []
  for (let i = months - 1; i >= 0; i--) keys.push(monthKey(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)))
  const map = new Map(keys.map((k) => [k, { month: k, netTonnes: 0, tickets: 0, overweight: 0 }]))
  for (const t of Array.isArray(rows) ? rows : []) {
    const w = toMs(t?.weighed_at)
    if (w == null) continue
    const b = map.get(monthKey(w))
    if (!b) continue
    b.tickets += 1
    const net = netWeight(t)
    if (net != null) b.netTonnes = Math.round((b.netTonnes + net / 1000) * 10) / 10
    if (isOverweight(t)) b.overweight += 1
  }
  return keys.map((k) => map.get(k))
}

export const WEIGHBRIDGE_EXPORT_COLUMNS = [
  ['ticket_no', 'Ticket'], ['asset_no', 'Asset'], ['driver_name', 'Driver'], ['site', 'Site'],
  ['weighed_at', 'Weighed at'], ['gross_weight_kg', 'Gross (kg)'], ['tare_weight_kg', 'Tare (kg)'],
  ['net_weight_kg', 'Net (kg)'], ['gross_limit_kg', 'Limit (kg)'], ['load_pct', 'Load of limit (%)'],
  ['overload_kg', 'Overload (kg)'], ['cargo_type', 'Cargo'], ['status', 'Status'], ['notes', 'Notes'],
]

export function weighbridgeExportRows(rows = [], { fmtDate = (v) => v || '' } = {}) {
  return (Array.isArray(rows) ? rows : []).map((t) => ({
    ticket_no: t?.ticket_no || '',
    asset_no: t?.asset_no || '',
    driver_name: t?.driver_name || '',
    site: t?.site || '',
    weighed_at: fmtDate(t?.weighed_at),
    gross_weight_kg: toFiniteNumber(t?.gross_weight_kg) ?? '',
    tare_weight_kg: toFiniteNumber(t?.tare_weight_kg) ?? '',
    net_weight_kg: netWeight(t) ?? '',
    gross_limit_kg: toFiniteNumber(t?.gross_limit_kg) ?? '',
    load_pct: loadPct(t) ?? '',
    // Blank (not 0) when the ticket cannot be judged.
    overload_kg: isJudgeable(t) ? overloadKg(t) : '',
    cargo_type: t?.cargo_type || '',
    status: TICKET_STATUS_LABEL[t?.status] || t?.status || '',
    notes: t?.notes || '',
  }))
}
