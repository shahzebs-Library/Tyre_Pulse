/**
 * Pure, unit-testable analytics for Driver Expenses (per-driver cost claims:
 * fuel, tolls, per-diem, repairs, etc.). NO I/O, NO Supabase, NO React.
 *
 * Complements src/lib/driverExpenses.js (which owns the lightweight
 * `summarizeExpenses` KPI reducer) with the deeper reporting the page needs:
 * spend by status, spend by category, top spenders, monthly trend, average
 * claim, approval rate and reimbursement outstanding. Every metric is derived
 * from the REAL columns on `driver_expenses` (V152, verified against the live
 * table): driver_name, category, amount, expense_date, asset_no, status,
 * description, created_at. Metrics degrade honestly to 0 / null when the data
 * cannot support them (NEVER fabricated).
 *
 * Real status vocab (CHECK constraint, V152): pending, approved, rejected,
 * reimbursed. Real category vocab (app default set): fuel, toll, parking,
 * meals, accommodation, maintenance, training, other. `category` is free text
 * in the DB, so unknown values are surfaced under their own label rather than
 * folded into "other" (honest reporting of whatever was entered).
 */

/** Canonical status lifecycle order (matches the DB CHECK constraint). */
export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected', 'reimbursed']

/** Statuses that count as an approved outcome (money the org has agreed to pay). */
export const APPROVED_STATUSES = ['approved', 'reimbursed']

/** Human labels for the four lifecycle statuses. */
export const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  reimbursed: 'Reimbursed',
}

/** Known category tokens (app default set). Unknown values are kept verbatim. */
export const KNOWN_CATEGORIES = [
  'fuel', 'toll', 'parking', 'meals', 'accommodation', 'maintenance', 'training', 'other',
]

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86400000

/** Coerce to a finite number or 0. */
export const toAmount = (v) => {
  if (v === '' || v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** Trimmed string or '' (never null). */
const str = (v) => (v == null ? '' : String(v).trim())

/** Round to 2 decimals (money). */
const money = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100

/** Round to 1 decimal (percentages). */
const pct1 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 10) / 10

const rows_ = (rows) => (Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [])

/** Normalise a status to one of the four known tokens (unknown -> 'pending'). */
export function normStatus(s) {
  const v = str(s).toLowerCase()
  return EXPENSE_STATUSES.includes(v) ? v : 'pending'
}

/** Human label for a status token. */
export function statusLabel(s) {
  const v = str(s).toLowerCase()
  return STATUS_LABELS[v] || (v ? v[0].toUpperCase() + v.slice(1) : 'Pending')
}

/** Normalise a category to a stable, lowercase key (blank -> 'other'). */
export function normCategory(c) {
  const v = str(c).toLowerCase()
  return v || 'other'
}

/** Title-case label for a category key. */
export function categoryLabel(c) {
  const v = normCategory(c)
  return v[0].toUpperCase() + v.slice(1)
}

/** Parse a claim's date (expense_date, else created_at) to epoch ms, or null. */
export function expenseTime(row) {
  const raw = row?.expense_date || row?.created_at
  if (!raw) return null
  const s = String(raw)
  // date-only strings ('YYYY-MM-DD') parse as UTC midnight
  const t = Date.parse(s.length <= 10 ? `${s.slice(0, 10)}T00:00:00Z` : s)
  return Number.isFinite(t) ? t : null
}

/** 'YYYY-MM' bucket key from a row, or null. */
function monthKeyOf(row) {
  const raw = row?.expense_date || row?.created_at
  if (!raw) return null
  const s = String(raw)
  if (s.length >= 7 && s[4] === '-') return s.slice(0, 7)
  const t = expenseTime(row)
  if (t == null) return null
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key) {
  const [y, m] = String(key).split('-')
  const idx = Number(m) - 1
  return idx >= 0 && idx < 12 ? `${MONTHS_SHORT[idx]} ${y}` : String(key)
}

// ─── Breakdown by status ────────────────────────────────────────────────────
/**
 * Count and value of claims per status. Returns the full `byStatus` map (all
 * four keys, zero-filled) plus `items` (only statuses that occur, in lifecycle
 * order) carrying label, count, value and share-of-total-value percentage.
 * @returns {{ total:number, totalValue:number, byStatus:Record<string,{count:number,value:number}>, items:Array }}
 */
export function statusBreakdown(rows = []) {
  const list = rows_(rows)
  const byStatus = EXPENSE_STATUSES.reduce((a, s) => { a[s] = { count: 0, value: 0 }; return a }, {})
  let totalValue = 0
  for (const r of list) {
    const s = normStatus(r.status)
    const amt = toAmount(r.amount)
    byStatus[s].count += 1
    byStatus[s].value += amt
    totalValue += amt
  }
  for (const s of EXPENSE_STATUSES) byStatus[s].value = money(byStatus[s].value)
  totalValue = money(totalValue)
  const items = EXPENSE_STATUSES
    .filter((s) => byStatus[s].count > 0)
    .map((s) => ({
      status: s,
      label: STATUS_LABELS[s],
      count: byStatus[s].count,
      value: byStatus[s].value,
      pct: totalValue ? pct1((byStatus[s].value / totalValue) * 100) : 0,
    }))
  return { total: list.length, totalValue, byStatus, items }
}

// ─── Breakdown by category ──────────────────────────────────────────────────
/**
 * Spend and claim count per category, sorted by value desc then label. Unknown
 * categories are surfaced under their own key (not folded into "other").
 * @returns {Array<{ category:string, label:string, count:number, value:number, pct:number }>}
 */
export function categoryBreakdown(rows = [], limit = 0) {
  const list = rows_(rows)
  const map = new Map()
  let totalValue = 0
  for (const r of list) {
    const key = normCategory(r.category)
    const amt = toAmount(r.amount)
    const cur = map.get(key) || { category: key, label: categoryLabel(key), count: 0, value: 0 }
    cur.count += 1
    cur.value += amt
    totalValue += amt
    map.set(key, cur)
  }
  const arr = [...map.values()]
    .map((x) => ({
      ...x,
      value: money(x.value),
      pct: totalValue ? pct1((x.value / totalValue) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value || b.count - a.count || a.label.localeCompare(b.label))
  return limit > 0 ? arr.slice(0, limit) : arr
}

// ─── Top spenders (by driver) ───────────────────────────────────────────────
/**
 * Spend, claim count, pending value and last-claim date per driver, ranked by
 * total value desc. Blank driver names are ignored.
 * @returns {Array<{ driver:string, count:number, value:number, pendingValue:number, approvedValue:number, lastDate:string|null }>}
 */
export function topDrivers(rows = [], limit = 10) {
  const map = new Map()
  for (const r of rows_(rows)) {
    const driver = str(r.driver_name)
    if (!driver) continue
    const key = driver.toLowerCase()
    const amt = toAmount(r.amount)
    const s = normStatus(r.status)
    const cur = map.get(key) || {
      driver, count: 0, value: 0, pendingValue: 0, approvedValue: 0, lastTime: null,
    }
    cur.count += 1
    cur.value += amt
    if (s === 'pending') cur.pendingValue += amt
    if (APPROVED_STATUSES.includes(s)) cur.approvedValue += amt
    const t = expenseTime(r)
    if (t != null && (cur.lastTime == null || t > cur.lastTime)) cur.lastTime = t
    map.set(key, cur)
  }
  const arr = [...map.values()]
    .map((x) => ({
      driver: x.driver,
      count: x.count,
      value: money(x.value),
      pendingValue: money(x.pendingValue),
      approvedValue: money(x.approvedValue),
      lastDate: x.lastTime == null ? null : new Date(x.lastTime).toISOString().slice(0, 10),
    }))
    .sort((a, b) => b.value - a.value || b.count - a.count || a.driver.localeCompare(b.driver))
  return limit > 0 ? arr.slice(0, limit) : arr
}

// ─── Monthly trend ──────────────────────────────────────────────────────────
/**
 * Claim value and count per calendar month for the last `months` months ending
 * at `ref`. Each bucket also carries `approvedValue` so the chart can overlay
 * approved spend against total submitted spend.
 * @returns {Array<{ key:string, label:string, count:number, value:number, approvedValue:number }>}
 */
export function monthlyTrend(rows = [], months = 12, ref = new Date()) {
  const n = Math.max(1, Math.floor(months))
  const base = ref instanceof Date && !Number.isNaN(ref.getTime()) ? ref : new Date()
  const buckets = []
  const index = new Map()
  let y = base.getUTCFullYear()
  let m = base.getUTCMonth() - (n - 1)
  while (m < 0) { m += 12; y -= 1 }
  for (let i = 0; i < n; i++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    const bucket = { key, label: monthLabel(key), count: 0, value: 0, approvedValue: 0 }
    buckets.push(bucket)
    index.set(key, bucket)
    m += 1
    if (m > 11) { m = 0; y += 1 }
  }
  for (const r of rows_(rows)) {
    const key = monthKeyOf(r)
    const bucket = key && index.get(key)
    if (bucket) {
      const amt = toAmount(r.amount)
      bucket.count += 1
      bucket.value += amt
      if (APPROVED_STATUSES.includes(normStatus(r.status))) bucket.approvedValue += amt
    }
  }
  for (const b of buckets) { b.value = money(b.value); b.approvedValue = money(b.approvedValue) }
  return buckets
}

// ─── KPI tiles ──────────────────────────────────────────────────────────────
/**
 * Headline KPIs for the page tiles.
 *
 * - total / totalValue: every claim and its combined amount.
 * - byStatusCount / byStatusValue: per-status count and value.
 * - avgClaim: mean amount across claims that carry an amount (null when none).
 * - approvalRate: share of DECIDED claims (approved + reimbursed + rejected)
 *   that were approved or reimbursed. null when nothing is decided yet.
 * - reimbursementOutstanding: value of claims approved but NOT yet reimbursed
 *   (money the org owes drivers). reimbursedValue: already paid out.
 * - pendingValue: value awaiting a decision.
 * - thisPeriodValue / thisPeriodCount: claims dated within `periodDays` of now.
 * - drivers: distinct driver names.
 */
export function computeKpis(rows = [], { periodDays = 30, now = new Date() } = {}) {
  const list = rows_(rows)
  const ref = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now()
  const since = ref - Math.max(1, periodDays) * DAY_MS

  const byStatusCount = EXPENSE_STATUSES.reduce((a, s) => { a[s] = 0; return a }, {})
  const byStatusValue = EXPENSE_STATUSES.reduce((a, s) => { a[s] = 0; return a }, {})
  const drivers = new Set()
  let totalValue = 0
  let amountedCount = 0
  let amountedValue = 0
  let thisPeriodValue = 0
  let thisPeriodCount = 0

  for (const r of list) {
    const s = normStatus(r.status)
    const amt = toAmount(r.amount)
    byStatusCount[s] += 1
    byStatusValue[s] += amt
    totalValue += amt
    if (r.amount != null && r.amount !== '') { amountedCount += 1; amountedValue += amt }
    const d = str(r.driver_name); if (d) drivers.add(d.toLowerCase())
    const t = expenseTime(r)
    if (t != null && t >= since && t <= ref) { thisPeriodValue += amt; thisPeriodCount += 1 }
  }

  const decided = byStatusCount.approved + byStatusCount.reimbursed + byStatusCount.rejected
  const approvedOutcome = byStatusCount.approved + byStatusCount.reimbursed

  return {
    total: list.length,
    totalValue: money(totalValue),
    byStatusCount,
    byStatusValue: EXPENSE_STATUSES.reduce((a, s) => { a[s] = money(byStatusValue[s]); return a }, {}),
    avgClaim: amountedCount ? money(amountedValue / amountedCount) : null,
    approvalRate: decided ? pct1((approvedOutcome / decided) * 100) : null,
    decidedCount: decided,
    pendingCount: byStatusCount.pending,
    pendingValue: money(byStatusValue.pending),
    reimbursementOutstanding: money(byStatusValue.approved),
    reimbursedValue: money(byStatusValue.reimbursed),
    rejectedValue: money(byStatusValue.rejected),
    thisPeriodValue: money(thisPeriodValue),
    thisPeriodCount,
    periodDays: Math.max(1, periodDays),
    drivers: drivers.size,
  }
}

// ─── Filtering (table) ──────────────────────────────────────────────────────
/**
 * Filter/search claim rows. All predicates are ANDed. Empty / 'all' filters are
 * no-ops. `search` matches driver, category, asset and description.
 * @param {Array<object>} rows
 * @param {{ status?:string, category?:string, driver?:string, from?:string, to?:string, search?:string }} [f]
 */
export function filterExpenses(rows = [], f = {}) {
  const status = f.status && f.status !== 'all' ? normStatus(f.status) : null
  const category = f.category && f.category !== 'all' ? normCategory(f.category) : null
  const driver = f.driver && f.driver !== 'all' ? str(f.driver).toLowerCase() : null
  const q = str(f.search).toLowerCase()
  const from = f.from ? Date.parse(`${String(f.from).slice(0, 10)}T00:00:00Z`) : null
  const to = f.to ? Date.parse(`${String(f.to).slice(0, 10)}T23:59:59Z`) : null
  return rows_(rows).filter((r) => {
    if (status && normStatus(r.status) !== status) return false
    if (category && normCategory(r.category) !== category) return false
    if (driver && str(r.driver_name).toLowerCase() !== driver) return false
    if (from != null || to != null) {
      const t = expenseTime(r)
      if (t == null) return false
      if (from != null && t < from) return false
      if (to != null && t > to) return false
    }
    if (q) {
      const hay = `${r.driver_name || ''} ${r.category || ''} ${r.asset_no || ''} ${r.description || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Sort claim rows by a field. Supported: driver_name, category, amount,
 * expense_date, status. Returns a NEW array (does not mutate input).
 * @param {Array<object>} rows
 * @param {string} field
 * @param {'asc'|'desc'} dir
 */
export function sortExpenses(rows = [], field = 'expense_date', dir = 'desc') {
  const list = rows_(rows).slice()
  const mul = dir === 'asc' ? 1 : -1
  const cmp = (a, b) => {
    switch (field) {
      case 'amount':
        return (toAmount(a.amount) - toAmount(b.amount)) * mul
      case 'expense_date': {
        const ta = expenseTime(a); const tb = expenseTime(b)
        if (ta == null && tb == null) return 0
        if (ta == null) return 1 // nulls always last
        if (tb == null) return -1
        return (ta - tb) * mul
      }
      case 'status':
        return str(a.status).localeCompare(str(b.status)) * mul
      case 'category':
        return normCategory(a.category).localeCompare(normCategory(b.category)) * mul
      default:
        return str(a[field]).localeCompare(str(b[field])) * mul
    }
  }
  return list.sort(cmp)
}

/** Distinct, sorted, non-empty values of a field (for filter dropdowns). */
export function distinctValues(rows = [], field) {
  const set = new Set()
  for (const r of rows_(rows)) { const v = str(r[field]); if (v) set.add(v) }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Distinct, sorted category keys present in the data (for the filter dropdown). */
export function distinctCategories(rows = []) {
  const set = new Set()
  for (const r of rows_(rows)) set.add(normCategory(r.category))
  return [...set].sort((a, b) => a.localeCompare(b))
}

// ─── Master roll-up ─────────────────────────────────────────────────────────
/**
 * Everything the page needs in one pass. Pure; safe on [] / null.
 * @param {Array<object>} rows
 * @param {{ periodDays?:number, months?:number, now?:Date, topN?:number }} [opts]
 */
export function analyzeExpenses(rows = [], opts = {}) {
  const { periodDays = 30, months = 12, now = new Date(), topN = 8 } = opts
  const list = rows_(rows)
  return {
    kpis: computeKpis(list, { periodDays, now }),
    status: statusBreakdown(list),
    categories: categoryBreakdown(list),
    topDrivers: topDrivers(list, topN),
    trend: monthlyTrend(list, months, now),
    drivers: distinctValues(list, 'driver_name'),
    categoryKeys: distinctCategories(list),
  }
}
