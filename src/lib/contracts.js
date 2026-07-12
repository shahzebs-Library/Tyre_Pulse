/**
 * Pure contract-lifecycle helpers (no I/O, no Supabase). Deterministic: the
 * reference clock is always injected, so status derivation and summaries are
 * unit-testable and stable. Consumed by the Contracts page and its service
 * layer for expiry tracking and KPI tiles.
 */

/** Contracts expiring within this many days count as "expiring soon". */
export const EXPIRING_SOON_DAYS = 60

const DAY_MS = 24 * 60 * 60 * 1000

/** Parse a value into epoch millis (date string / Date / number), else null. */
function toMillis(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  // Treat bare YYYY-MM-DD as an end-of-day boundary so a contract remains
  // "active" for the whole of its final day, in UTC to stay deterministic.
  const s = String(v).trim()
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s)
  // Anchor bare YYYY-MM-DD to UTC midnight. Combined with Math.ceil in
  // daysUntilEnd, a contract reads as 0 days (not yet expired) throughout the
  // whole of its final day and only flips negative once that day has passed.
  const ms = Date.parse(dateOnly ? `${s}T00:00:00.000Z` : s)
  return Number.isNaN(ms) ? null : ms
}

/** Whole days from `now` until the contract's end date (negative once past). */
export function daysUntilEnd(contract, now = Date.now()) {
  const end = toMillis(contract?.end_date)
  if (end == null) return null
  return Math.ceil((end - now) / DAY_MS)
}

/**
 * Derive the effective lifecycle status of a contract at `now`.
 * Precedence: an explicit terminal status the user set (cancelled/pending)
 * is respected; otherwise expiry is derived from end_date.
 * Returns one of: 'cancelled' | 'pending' | 'expired' | 'expiring-soon' | 'active' | 'unknown'.
 */
export function contractStatus(contract, now = Date.now(), { expiringSoonDays = EXPIRING_SOON_DAYS } = {}) {
  if (!contract || typeof contract !== 'object') return 'unknown'
  if (contract.status === 'cancelled') return 'cancelled'
  if (contract.status === 'pending') return 'pending'

  const days = daysUntilEnd(contract, now)
  if (days == null) {
    // No end date: fall back to a stored status when it is meaningful.
    return contract.status === 'expired' ? 'expired' : 'active'
  }
  if (days < 0) return 'expired'
  if (days <= expiringSoonDays) return 'expiring-soon'
  return 'active'
}

/**
 * Summarise a set of contracts against `now`: lifecycle counts, total value,
 * and the list of contracts expiring soon (soonest first). Value totals only
 * count contracts that are not expired/cancelled (i.e. live commitments),
 * matching what management reads as "active spend".
 */
export function summarizeContracts(rows = [], now = Date.now(), opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const counts = { active: 0, 'expiring-soon': 0, expired: 0, pending: 0, cancelled: 0, unknown: 0 }
  const expiringSoon = []
  let totalValue = 0

  for (const c of list) {
    const status = contractStatus(c, now, opts)
    counts[status] = (counts[status] || 0) + 1

    const isLive = status === 'active' || status === 'expiring-soon' || status === 'pending'
    const val = Number(c?.value)
    if (isLive && Number.isFinite(val)) totalValue += val

    if (status === 'expiring-soon') {
      expiringSoon.push({ ...c, daysRemaining: daysUntilEnd(c, now) })
    }
  }

  expiringSoon.sort((a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity))

  return {
    total: list.length,
    counts,
    active: counts.active,
    expiringSoon,
    expiringSoonCount: counts['expiring-soon'],
    expired: counts.expired,
    totalValue,
  }
}
