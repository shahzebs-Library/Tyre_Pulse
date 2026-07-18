/**
 * Contract commercial-analytics engine (pure, no I/O, no Supabase).
 *
 * Deterministic: the reference clock is always injectable, so every derivation
 * (lifecycle bands, annualized value, renewal pipeline, breakdowns) is stable
 * and unit-testable. Consumed by the Contracts page for KPI tiles, charts, and
 * the renewal-planning views.
 *
 * Reuses the canonical lifecycle helpers in ./contracts (contractStatus /
 * daysUntilEnd) so status semantics are defined in ONE place. This module adds
 * the spend, term, and pipeline maths on top.
 *
 * Real columns only (contracts table, V131): title, vendor, contract_type,
 * start_date, end_date, value, currency, status. There is NO auto_renew or
 * renewal_date column, so renewal date == end_date and auto-renew analytics are
 * only produced when a row actually carries an auto_renew field (honest N/A
 * otherwise). Nothing is fabricated.
 */
import { contractStatus, daysUntilEnd } from './contracts'

const DAY_MS = 24 * 60 * 60 * 1000

/** Lifecycle bands, in display order, with a stable label + tone key. */
export const STATUS_BANDS = [
  { key: 'active', label: 'Active', tone: 'ok' },
  { key: 'expiring-soon', label: 'Expiring soon', tone: 'warn' },
  { key: 'expired', label: 'Expired', tone: 'bad' },
  { key: 'pending', label: 'Pending', tone: 'info' },
  { key: 'cancelled', label: 'Cancelled', tone: 'muted' },
  { key: 'unknown', label: 'Unknown', tone: 'muted' },
]

/** A live commitment counts toward "live value" (not expired/cancelled). */
export function isLiveStatus(status) {
  return status === 'active' || status === 'expiring-soon' || status === 'pending'
}

function toMillis(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s)
  const ms = Date.parse(dateOnly ? `${s}T00:00:00.000Z` : s)
  return Number.isNaN(ms) ? null : ms
}

function numOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Term length in whole days from start_date to end_date, else null. */
export function termDays(contract) {
  const start = toMillis(contract?.start_date)
  const end = toMillis(contract?.end_date)
  if (start == null || end == null) return null
  const d = Math.round((end - start) / DAY_MS)
  return d > 0 ? d : null
}

/**
 * Annualized contract value = value scaled to a 365-day year over its term.
 * Requires a numeric value AND a valid start+end term. Returns null (honest,
 * not zero) when either is missing so callers can show N/A. When the term is
 * shorter than a year the annualized figure is higher than the face value; for
 * multi-year terms it is lower.
 */
export function annualizedValue(contract) {
  const value = numOrNull(contract?.value)
  const days = termDays(contract)
  if (value == null || days == null) return null
  return (value * 365) / days
}

function monthKey(ms) {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(key) {
  const [y, m] = String(key).split('-')
  const idx = Number(m) - 1
  if (idx < 0 || idx > 11) return key
  return `${MONTH_LABELS[idx]} ${y}`
}

/**
 * Enrich a raw contract with derived lifecycle fields. Non-mutating.
 * Adds: _status, _days (to end), _annualized, _termDays, _value (numeric|null).
 */
export function enrichContract(contract, now = Date.now(), opts = {}) {
  return {
    ...contract,
    _status: contractStatus(contract, now, opts),
    _days: daysUntilEnd(contract, now),
    _annualized: annualizedValue(contract),
    _termDays: termDays(contract),
    _value: numOrNull(contract?.value),
  }
}

/** Enrich a whole list (stable, single reference clock). */
export function enrichContracts(rows = [], now = Date.now(), opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  return list.map((c) => enrichContract(c, now, opts))
}

/**
 * Headline KPIs. `soonDays`/`urgentDays` are the two expiry windows (default
 * 60 / 30). Value totals count only LIVE commitments (management "live spend").
 */
export function buildContractKpis(rows = [], now = Date.now(), opts = {}) {
  const { soonDays = 60, urgentDays = 30, expiringSoonDays = soonDays } = opts
  const enriched = enrichContracts(rows, now, { expiringSoonDays })

  let totalValue = 0
  let liveAnnualized = 0
  let liveAnnualizedKnown = 0
  let active = 0
  let expiring30 = 0
  let expiring60 = 0
  let expired = 0
  let pending = 0
  let cancelled = 0

  for (const c of enriched) {
    const live = isLiveStatus(c._status)
    if (live && c._value != null) totalValue += c._value
    if (live && c._annualized != null) { liveAnnualized += c._annualized; liveAnnualizedKnown += 1 }
    if (c._status === 'active') active += 1
    if (c._status === 'pending') pending += 1
    if (c._status === 'cancelled') cancelled += 1
    if (c._status === 'expired') expired += 1
    if (c._days != null && c._days >= 0 && c._days <= soonDays && c._status !== 'cancelled') expiring60 += 1
    if (c._days != null && c._days >= 0 && c._days <= urgentDays && c._status !== 'cancelled') expiring30 += 1
  }

  return {
    total: enriched.length,
    active,
    pending,
    cancelled,
    expired,
    expiringSoonCount: expiring60,
    expiringUrgentCount: expiring30,
    soonDays,
    urgentDays,
    totalValue,
    // annualized live spend is only meaningful when at least one live contract
    // carries a term; null flags "not computable" rather than a misleading 0.
    liveAnnualizedValue: liveAnnualizedKnown > 0 ? liveAnnualized : null,
    nextRenewal: nextRenewal(rows, now),
  }
}

/** Status distribution for a doughnut: [{ key, label, tone, count }] (nonzero). */
export function statusDistribution(rows = [], now = Date.now(), opts = {}) {
  const enriched = enrichContracts(rows, now, opts)
  const counts = {}
  for (const c of enriched) counts[c._status] = (counts[c._status] || 0) + 1
  return STATUS_BANDS
    .map((b) => ({ ...b, count: counts[b.key] || 0 }))
    .filter((b) => b.count > 0)
}

/**
 * Breakdown by contract_type: [{ type, label, count, value, annualized }].
 * `value` sums numeric face values across ALL contracts of the type (spend
 * exposure); sorted by value desc then count desc. Missing type -> 'Unspecified'.
 */
export function valueByType(rows = [], now = Date.now(), opts = {}) {
  return breakdownBy(rows, 'contract_type', 'Unspecified', now, opts)
}

/** Breakdown by vendor/counterparty (top-N when `limit` given). */
export function valueByVendor(rows = [], now = Date.now(), opts = {}) {
  const all = breakdownBy(rows, 'vendor', 'Unassigned', now, opts)
  const limit = opts.limit
  return typeof limit === 'number' && limit > 0 ? all.slice(0, limit) : all
}

function breakdownBy(rows, field, fallback, now, opts) {
  const enriched = enrichContracts(rows, now, opts)
  const map = new Map()
  for (const c of enriched) {
    const raw = c?.[field]
    const key = raw == null || String(raw).trim() === '' ? fallback : String(raw).trim()
    const cur = map.get(key) || { type: key, label: labelize(key), count: 0, value: 0, annualized: 0, live: 0 }
    cur.count += 1
    if (c._value != null) cur.value += c._value
    if (c._annualized != null) cur.annualized += c._annualized
    if (isLiveStatus(c._status)) cur.live += 1
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => b.value - a.value || b.count - a.count)
}

function labelize(s) {
  const str = String(s)
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Renewal pipeline: contracts grouped by the calendar month of their end_date
 * (== renewal date), starting from the month of `now` for `months` buckets
 * forward. Every bucket in the window is present (count 0 allowed) so a chart
 * shows a continuous timeline. Rows with no end_date are omitted (honest).
 * Returns [{ key, label, count, value, contracts: [enriched...] }].
 */
export function renewalPipeline(rows = [], now = Date.now(), opts = {}) {
  const { months = 12 } = opts
  const enriched = enrichContracts(rows, now, opts)

  const base = new Date(now)
  const startY = base.getUTCFullYear()
  const startM = base.getUTCMonth()
  const buckets = []
  const index = new Map()
  for (let i = 0; i < months; i += 1) {
    const d = new Date(Date.UTC(startY, startM + i, 1))
    const key = monthKey(d.getTime())
    const bucket = { key, label: monthLabel(key), count: 0, value: 0, contracts: [] }
    buckets.push(bucket)
    index.set(key, bucket)
  }

  for (const c of enriched) {
    const end = toMillis(c?.end_date)
    if (end == null) continue
    const key = monthKey(end)
    const bucket = index.get(key)
    if (!bucket) continue // outside the window
    bucket.count += 1
    if (c._value != null) bucket.value += c._value
    bucket.contracts.push(c)
  }
  return buckets
}

/**
 * The single soonest UPCOMING renewal (end_date >= now, not cancelled).
 * Returns { contract, daysRemaining } or null when none is upcoming.
 */
export function nextRenewal(rows = [], now = Date.now()) {
  const list = Array.isArray(rows) ? rows : []
  let best = null
  for (const c of list) {
    if (c?.status === 'cancelled') continue
    const days = daysUntilEnd(c, now)
    if (days == null || days < 0) continue
    if (best == null || days < best.daysRemaining) best = { contract: c, daysRemaining: days }
  }
  return best
}

/**
 * Auto-renew split, ONLY when the data carries an auto_renew field. The V131
 * contracts table has no such column, so this returns { available: false }
 * unless a row actually provides it (future schema). No fabrication.
 */
export function autoRenewSplit(rows = [], now = Date.now(), opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const has = list.some((c) => c && Object.prototype.hasOwnProperty.call(c, 'auto_renew'))
  if (!has) return { available: false, auto: 0, manual: 0 }
  const enriched = enrichContracts(list, now, opts)
  let auto = 0
  let manual = 0
  for (const c of enriched) {
    if (c.auto_renew === true) auto += 1
    else manual += 1
  }
  return { available: true, auto, manual }
}

/**
 * Contracts expiring within `days` (default 60), not cancelled/expired, soonest
 * first, each tagged with daysRemaining. Drives the action banner + urgent list.
 */
export function expiringWithin(rows = [], now = Date.now(), days = 60, opts = {}) {
  const enriched = enrichContracts(rows, now, opts)
  return enriched
    .filter((c) => c._days != null && c._days >= 0 && c._days <= days && c._status !== 'cancelled')
    .map((c) => ({ ...c, daysRemaining: c._days }))
    .sort((a, b) => a.daysRemaining - b.daysRemaining)
}
