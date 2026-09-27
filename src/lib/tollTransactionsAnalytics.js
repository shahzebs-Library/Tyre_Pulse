/**
 * tollTransactionsAnalytics - pure analytics for the Toll Transactions page.
 *
 * Builds on the roll-up primitives in `./tollTransactions` (never re-derives
 * them) and adds what the register needs to be decision-grade:
 *   - one filter predicate shared by the table, the KPIs and the exports
 *   - money split PER CURRENCY. A toll charge in SAR and one in AED are never
 *     added together; a total across currencies is reported as null (N/A).
 *   - monthly trend, payment-method mix, dispute rate, recency.
 *
 * No I/O, no React. `now` is injected so every figure is reproducible.
 */
import { toFiniteNumber, byAsset, byPlaza } from './tollTransactions'

export const TOLL_STATUSES = ['posted', 'disputed', 'reconciled', 'refunded']
export const TOLL_METHODS = ['tag', 'cash', 'card', 'account', 'other']
export const UNSPECIFIED_CURRENCY = 'Unspecified'

const DAY_MS = 86400000
const lc = (v) => String(v ?? '').trim().toLowerCase()

export const titleCase = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '')

/** Normalised currency code for a row, or 'Unspecified' when none was recorded. */
export function currencyOf(row) {
  const c = String(row?.currency ?? '').trim().toUpperCase()
  return c || UNSPECIFIED_CURRENCY
}

function toTime(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Shared filter. `from`/`to` are 'YYYY-MM-DD' strings compared on the date part
 * of transaction_at; a row with no date is excluded once a range is active.
 */
export function filterTolls(rows = [], f = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = lc(f.search)
  return list.filter((r) => {
    if (f.country && r.country !== f.country) return false
    if (f.status && lc(r.status) !== lc(f.status)) return false
    if (f.method && lc(r.payment_method) !== lc(f.method)) return false
    if (f.currency && currencyOf(r) !== f.currency) return false
    if (f.asset && String(r.asset_no || '').trim() !== f.asset) return false
    if (f.from || f.to) {
      const d = r.transaction_at ? String(r.transaction_at).slice(0, 10) : ''
      if (!d) return false
      if (f.from && d < f.from) return false
      if (f.to && d > f.to) return false
    }
    if (q) {
      const hay = [r.asset_no, r.driver_name, r.tag_id, r.plaza_name, r.highway, r.notes, r.currency]
        .map((v) => lc(v)).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Per-currency money totals. Never blended across currencies. */
export function currencyBreakdown(rows = []) {
  const m = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const cur = currencyOf(r)
    const e = m.get(cur) || { currency: cur, count: 0, priced: 0, amount: 0, disputedAmount: 0 }
    e.count += 1
    const a = toFiniteNumber(r?.amount)
    if (a != null) {
      e.priced += 1
      e.amount += a
      if (lc(r.status) === 'disputed') e.disputedAmount += a
    }
    m.set(cur, e)
  }
  return [...m.values()]
    .map((e) => ({ ...e, avgAmount: e.priced > 0 ? e.amount / e.priced : null }))
    .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency))
}

/**
 * KPI summary. Money figures are only emitted when exactly one currency is in
 * scope; otherwise they are null and `mixedCurrency` is true.
 */
export function summarizeTollAnalytics(rows = [], { now = Date.now() } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const assets = new Set()
  let disputed = 0
  let reconciled = 0
  let unpriced = 0
  let last30 = 0
  for (const r of list) {
    const a = String(r?.asset_no || '').trim()
    if (a) assets.add(a)
    const s = lc(r?.status)
    if (s === 'disputed') disputed += 1
    if (s === 'reconciled') reconciled += 1
    if (toFiniteNumber(r?.amount) == null) unpriced += 1
    const t = toTime(r?.transaction_at)
    if (t != null && t <= nowMs && nowMs - t <= 30 * DAY_MS) last30 += 1
  }
  const currencies = currencyBreakdown(list)
  const single = currencies.length === 1 ? currencies[0] : null
  const total = list.length
  return {
    total,
    distinctAssets: assets.size,
    disputedCount: disputed,
    disputeRatePct: total > 0 ? Math.round((disputed / total) * 1000) / 10 : null,
    reconciledPct: total > 0 ? Math.round((reconciled / total) * 1000) / 10 : null,
    unpricedCount: unpriced,
    last30Count: last30,
    currencies,
    mixedCurrency: currencies.length > 1,
    currency: single ? single.currency : null,
    totalAmount: single && single.priced > 0 ? single.amount : null,
    disputedAmount: single && single.priced > 0 ? single.disputedAmount : null,
    avgAmount: single ? single.avgAmount : null,
  }
}

/** Last `months` calendar months ending at `now`: counts always, amount only for one currency. */
export function monthlyTrend(rows = [], { now = Date.now(), months = 12, currency = null } = {}) {
  const end = new Date(now instanceof Date ? now.getTime() : Number(now))
  const keys = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  const buckets = new Map(keys.map((k) => [k, { month: k, count: 0, amount: currency ? 0 : null }]))
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = r?.transaction_at ? String(r.transaction_at).slice(0, 7) : ''
    const b = buckets.get(k)
    if (!b) continue
    b.count += 1
    if (currency && currencyOf(r) === currency) {
      const a = toFiniteNumber(r.amount)
      if (a != null) b.amount += a
    }
  }
  return keys.map((k) => buckets.get(k))
}

/** Transactions per payment method (unrecorded method counted as 'Not recorded'). */
export function methodMix(rows = []) {
  const m = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = lc(r?.payment_method) ? titleCase(lc(r.payment_method)) : 'Not recorded'
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

/**
 * Asset and plaza roll-ups for ONE currency (reusing byAsset / byPlaza), so a
 * ranking is never an addition of riyals and dirhams.
 */
export function rollupsForCurrency(rows = [], currency) {
  const scoped = currency ? (rows || []).filter((r) => currencyOf(r) === currency) : []
  return { assets: byAsset(scoped), plazas: byPlaza(scoped) }
}

export const EXPORT_COLS = ['asset_no', 'driver_name', 'tag_id', 'plaza_name', 'highway', 'transaction_at', 'amount', 'currency', 'payment_method', 'status', 'notes']
export const EXPORT_HEADERS = ['Asset', 'Driver', 'Tag ID', 'Plaza', 'Highway', 'Transaction at', 'Amount', 'Currency', 'Payment method', 'Status', 'Notes']

export function tollExportRows(rows = []) {
  return (rows || []).map((r) => ({
    asset_no: r.asset_no || 'N/A',
    driver_name: r.driver_name || 'N/A',
    tag_id: r.tag_id || 'N/A',
    plaza_name: r.plaza_name || 'N/A',
    highway: r.highway || 'N/A',
    transaction_at: r.transaction_at || 'N/A',
    amount: toFiniteNumber(r.amount) ?? 'N/A',
    currency: currencyOf(r),
    payment_method: r.payment_method ? titleCase(lc(r.payment_method)) : 'N/A',
    status: r.status ? titleCase(lc(r.status)) : 'N/A',
    notes: r.notes || '',
  }))
}
