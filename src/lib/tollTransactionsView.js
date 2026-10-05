/**
 * tollTransactionsView - pure shaping for the rebuilt Toll Transactions page
 * (owner mockup "Toll Transactions"). Builds on tollTransactionsAnalytics and
 * never re-derives its money rules: money is per currency, never blended.
 *
 * Column honesty (toll_transactions, V169): there is no operator, toll-point id,
 * trip link, evidence or dispute-history column. The page shows the mockup's
 * places for those with "Not recorded", never an invented value.
 *   Route      -> highway
 *   Toll point -> plaza_name
 *   Tag        -> tag_id
 *   Reconciled -> status 'reconciled' | 'refunded'
 *   Disputed   -> status 'disputed'
 *   Unreconciled -> anything else (posted or no status)
 *
 * No I/O, no React. `now` is injected.
 */
import { toFiniteNumber } from './tollTransactions'
import { currencyOf } from './tollTransactionsAnalytics'

const DAY_MS = 86400000
const lc = (v) => String(v ?? '').trim().toLowerCase()

/** Reconciliation bucket of one row. */
export function reconBucket(row) {
  const s = lc(row?.status)
  if (s === 'disputed') return 'disputed'
  if (s === 'reconciled' || s === 'refunded') return 'reconciled'
  return 'unreconciled'
}

export const RECON_META = {
  reconciled: { label: 'Reconciled', color: '#22c55e', tone: 'good' },
  unreconciled: { label: 'Unreconciled', color: '#f59e0b', tone: 'warn' },
  disputed: { label: 'Disputed', color: '#ef4444', tone: 'bad' },
}

/** Status pill for the stored status (or the bucket when none is stored). */
export function statusPill(row) {
  const s = lc(row?.status)
  if (s === 'disputed') return { label: 'Disputed', tone: 'bad' }
  if (s === 'reconciled') return { label: 'Reconciled', tone: 'good' }
  if (s === 'refunded') return { label: 'Refunded', tone: 'info' }
  if (s === 'posted') return { label: 'Unreconciled', tone: 'warn' }
  return { label: 'No status', tone: 'muted' }
}

/** Counts per reconciliation bucket plus shares (null when there are no rows). */
export function reconOverview(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const c = { reconciled: 0, unreconciled: 0, disputed: 0 }
  for (const r of list) c[reconBucket(r)] += 1
  const total = list.length
  const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : null)
  return {
    total,
    ...c,
    reconciledPct: pct(c.reconciled),
    unreconciledPct: pct(c.unreconciled),
    disputedPct: pct(c.disputed),
    segments: ['reconciled', 'unreconciled', 'disputed'].map((k) => ({
      key: k, label: RECON_META[k].label, color: RECON_META[k].color, count: c[k],
    })),
  }
}

/**
 * Spend by route (highway) for ONE currency, top `limit` plus "Others".
 * Returns [] when no currency is given (a mixed scope cannot be ranked).
 */
export function routeSpend(rows = [], currency, { limit = 7 } = {}) {
  if (!currency) return []
  const m = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (currencyOf(r) !== currency) continue
    const a = toFiniteNumber(r?.amount)
    if (a == null) continue
    const k = String(r?.highway || '').trim() || 'Route not recorded'
    const e = m.get(k) || { route: k, amount: 0, count: 0 }
    e.amount += a
    e.count += 1
    m.set(k, e)
  }
  const all = [...m.values()].sort((a, b) => b.amount - a.amount || a.route.localeCompare(b.route))
  if (all.length <= limit + 1) return all
  const top = all.slice(0, limit)
  const rest = all.slice(limit)
  top.push({
    route: 'Others',
    amount: rest.reduce((s, x) => s + x.amount, 0),
    count: rest.reduce((s, x) => s + x.count, 0),
  })
  return top
}

const dayKey = (t) => new Date(t).toISOString().slice(0, 10)

/**
 * Daily series over the last `days` days ending at `to` (or `now`). Amount is
 * summed only for `currency`; with no single currency the series counts
 * transactions instead (`metric: 'count'`).
 */
export function dailyTrend(rows = [], { now = Date.now(), to = '', days = 30, currency = null } = {}) {
  const endMs = to ? new Date(`${to}T00:00:00Z`).getTime() : (now instanceof Date ? now.getTime() : Number(now))
  const end = Number.isFinite(endMs) ? endMs : Date.now()
  const keys = []
  for (let i = days - 1; i >= 0; i -= 1) keys.push(dayKey(end - i * DAY_MS))
  const buckets = new Map(keys.map((k) => [k, { day: k, count: 0, amount: currency ? 0 : null }]))
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = r?.transaction_at ? String(r.transaction_at).slice(0, 10) : ''
    const b = buckets.get(k)
    if (!b) continue
    b.count += 1
    if (currency && currencyOf(r) === currency) {
      const a = toFiniteNumber(r.amount)
      if (a != null) b.amount += a
    }
  }
  const series = keys.map((k) => buckets.get(k))
  return { metric: currency ? 'amount' : 'count', series, any: series.some((s) => s.count > 0) }
}

/** Distinct tag ids and the assets they span. */
export function tagSummary(rows = []) {
  const tags = new Set()
  const assets = new Set()
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = String(r?.tag_id || '').trim()
    if (!t) continue
    tags.add(t)
    const a = String(r?.asset_no || '').trim()
    if (a) assets.add(a)
  }
  return { tags: tags.size, assets: assets.size }
}

/** The window of equal length immediately before [from, to], or null. */
export function previousWindow(from, to) {
  if (!from || !to) return null
  const f = new Date(`${from}T00:00:00Z`).getTime()
  const t = new Date(`${to}T00:00:00Z`).getTime()
  if (!Number.isFinite(f) || !Number.isFinite(t) || t < f) return null
  const len = t - f + DAY_MS
  return { from: dayKey(f - len), to: dayKey(f - DAY_MS) }
}

/** Percent change, null when the previous value is not measurable (0 or null). */
export function changePct(cur, prev) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}

/** Index navigation over the filtered ledger for the details panel. */
export function selectionNav(rows = [], id) {
  const list = Array.isArray(rows) ? rows : []
  const i = list.findIndex((r) => String(r.id) === String(id))
  return {
    index: i,
    total: list.length,
    prev: i > 0 ? list[i - 1] : null,
    next: i >= 0 && i < list.length - 1 ? list[i + 1] : null,
  }
}

/* ── Import ─────────────────────────────────────────────────────────────── */

const HEADER_MAP = {
  asset_no: ['asset', 'asset no', 'asset_no', 'asset number', 'vehicle', 'plate'],
  driver_name: ['driver', 'driver name', 'driver_name'],
  tag_id: ['tag', 'tag id', 'tag_id', 'tag number'],
  plaza_name: ['plaza', 'plaza name', 'plaza_name', 'toll point', 'toll plaza', 'gantry'],
  highway: ['highway', 'route', 'road'],
  transaction_at: ['transaction at', 'transaction_at', 'date', 'date time', 'datetime', 'date and time', 'transaction date'],
  amount: ['amount', 'charge', 'toll', 'cost', 'fee'],
  currency: ['currency', 'ccy'],
  payment_method: ['payment method', 'payment_method', 'payment type', 'method'],
  status: ['status'],
  notes: ['notes', 'note', 'remarks', 'comment'],
}

const normHead = (h) => lc(h).replace(/[_\s]+/g, ' ')

/** Map one sheet header to a toll field, or null. */
export function fieldForHeader(header) {
  const h = normHead(header)
  for (const [field, aliases] of Object.entries(HEADER_MAP)) {
    if (aliases.some((a) => normHead(a) === h)) return field
  }
  return null
}

/**
 * Turn parsed sheet rows (objects keyed by header) into toll payloads. Rows
 * without an asset number are reported as skipped, never invented.
 */
export function mapImportRows(sheetRows = []) {
  const rows = []
  let skipped = 0
  for (const raw of Array.isArray(sheetRows) ? sheetRows : []) {
    const out = {}
    for (const [k, v] of Object.entries(raw || {})) {
      const f = fieldForHeader(k)
      if (f && v !== '' && v != null && out[f] == null) out[f] = typeof v === 'string' ? v.trim() : v
    }
    if (!out.asset_no) { skipped += 1; continue }
    if (out.amount != null) {
      const n = toFiniteNumber(String(out.amount).replace(/,/g, ''))
      out.amount = n == null ? '' : n
    }
    rows.push(out)
  }
  return { rows, skipped }
}

export const IMPORT_TEMPLATE_HEADERS = ['Asset', 'Driver', 'Tag ID', 'Plaza', 'Highway', 'Transaction at', 'Amount', 'Currency', 'Payment method', 'Status', 'Notes']

/** Card period pickers: rows whose transaction falls in the period ending at `now`. */
export const CARD_PERIODS = [
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'all', label: 'All in scope' },
]
export function periodRows(rows = [], period = 'all', now = Date.now()) {
  const list = Array.isArray(rows) ? rows : []
  if (period !== 'month' && period !== 'quarter') return list
  const d = new Date(now instanceof Date ? now.getTime() : Number(now))
  if (Number.isNaN(d.getTime())) return list
  const startMonth = period === 'month' ? d.getUTCMonth() : d.getUTCMonth() - (d.getUTCMonth() % 3)
  const start = Date.UTC(d.getUTCFullYear(), startMonth, 1)
  return list.filter((r) => {
    const t = r?.transaction_at ? new Date(r.transaction_at).getTime() : NaN
    return Number.isFinite(t) && t >= start && t <= d.getTime()
  })
}
