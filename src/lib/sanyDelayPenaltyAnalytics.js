/**
 * SANY repair-delay penalty analytics (pure, no I/O, no Supabase).
 *
 * The business rule (V464, KSA): a vehicle sent to a SANY workshop whose repair
 * ran longer than 5 days is charged 43 SAR per hour of TOTAL repair downtime,
 * and that amount is deducted from the SANY invoice. The penalty is a
 * STANDALONE figure. It never feeds Cost per M3 (that reads the SANY invoice
 * gross), so nothing here is ever blended into an operating-cost total.
 *
 * Deterministic: the reference clock (`now`) is always injectable so ageing
 * and overdue maths are stable in tests.
 *
 * Honesty rules applied throughout:
 *  - a missing or non-numeric amount is null, never 0 (N/A in the UI);
 *  - a row whose stored penalty disagrees with hours x rate is FLAGGED, not
 *    silently recomputed;
 *  - a row in a currency other than SAR is flagged rather than summed, because
 *    every figure on this page is labelled SAR.
 */

export const PENALTY_RULE = Object.freeze({
  ratePerHour: 43,
  minDays: 5,
  currency: 'SAR',
})

export const PENALTY_STATUSES = ['draft', 'deducted', 'waived']

/** A draft penalty older than this many days is overdue for deduction. */
export const DRAFT_OVERDUE_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** Number or null (never coerces a blank to 0). */
export function numOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function toMillis(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime()
  const s = String(v).trim()
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s)
  return Number.isNaN(ms) ? null : ms
}

function nowMs(now) {
  const n = toMillis(now ?? new Date())
  return n == null ? Date.now() : n
}

/** Penalty for a number of downtime hours. null when hours are unknown. */
export function penaltyForHours(hours, rate = PENALTY_RULE.ratePerHour) {
  const h = numOrNull(hours)
  const r = numOrNull(rate)
  if (h == null || r == null || h < 0 || r < 0) return null
  return Math.round(h * r * 100) / 100
}

/**
 * Downtime hours for a candidate: the RPC's own figure when present, otherwise
 * derived from Production Out to Production In. null when neither is usable.
 */
export function downtimeHoursOf(c) {
  const direct = numOrNull(c?.downtime_hours)
  if (direct != null) return direct
  const out = toMillis(c?.production_out_at ?? c?.repair_start)
  const inn = toMillis(c?.production_in_at ?? c?.repair_end)
  if (out == null || inn == null || inn < out) return null
  return Math.round(((inn - out) / HOUR_MS) * 10) / 10
}

/**
 * Evaluate one job-card candidate against the rule.
 * @returns {{hours:number|null, days:number|null, eligible:boolean, penalty:number|null, reason:string}}
 */
export function evaluateCandidate(c, { minDays = PENALTY_RULE.minDays, rate = PENALTY_RULE.ratePerHour } = {}) {
  const hours = downtimeHoursOf(c)
  if (hours == null) return { hours: null, days: null, eligible: false, penalty: null, reason: 'Downtime not measurable' }
  const days = Math.round((hours / 24) * 10) / 10
  const eligible = hours > minDays * 24
  return {
    hours,
    days,
    eligible,
    penalty: eligible ? penaltyForHours(hours, rate) : null,
    reason: eligible ? `Over ${minDays} days` : `Within ${minDays} days`,
  }
}

/** Summary of a candidate list (before anything is saved). */
export function summarizeCandidates(candidates = [], opts = {}) {
  const list = Array.isArray(candidates) ? candidates : []
  let eligible = 0; let unmeasurable = 0; let hours = 0; let penalty = 0; let longest = null
  for (const c of list) {
    const ev = evaluateCandidate(c, opts)
    if (ev.hours == null) { unmeasurable += 1; continue }
    if (!ev.eligible) continue
    eligible += 1
    hours += ev.hours
    penalty += ev.penalty ?? 0
    if (longest == null || ev.hours > longest) longest = ev.hours
  }
  return {
    count: list.length,
    eligible,
    unmeasurable,
    hours: eligible ? Math.round(hours * 10) / 10 : null,
    potentialPenalty: eligible ? Math.round(penalty * 100) / 100 : null,
    longestDays: longest == null ? null : Math.round((longest / 24) * 10) / 10,
  }
}

function statusOf(r) {
  return PENALTY_STATUSES.includes(r?.status) ? r.status : 'draft'
}

/** Stored penalty, or null when the generated column is absent/garbage. */
export function storedPenalty(r) {
  return numOrNull(r?.penalty_amount)
}

/** Issues found on one ledger row (data quality, never auto-fixed). */
export function rowIssues(r) {
  const issues = []
  const hours = numOrNull(r?.downtime_hours)
  const rate = numOrNull(r?.rate_per_hour)
  const stored = storedPenalty(r)
  if (hours == null || hours <= 0) issues.push('missing_hours')
  if (rate != null && rate !== PENALTY_RULE.ratePerHour) issues.push('non_standard_rate')
  if (hours != null && rate != null && stored != null && Math.abs(stored - hours * rate) > 0.5) issues.push('amount_mismatch')
  if (hours != null && hours > 0 && hours <= PENALTY_RULE.minDays * 24) issues.push('under_threshold')
  if (statusOf(r) === 'deducted' && !String(r?.sany_invoice_no || '').trim()) issues.push('deducted_no_invoice')
  if (r?.currency && r.currency !== PENALTY_RULE.currency) issues.push('non_sar_currency')
  if (!String(r?.asset_no || '').trim()) issues.push('missing_asset')
  return issues
}

export const ISSUE_LABELS = {
  missing_hours: 'Downtime hours missing',
  non_standard_rate: 'Rate is not 43 SAR/h',
  amount_mismatch: 'Penalty does not equal hours x rate',
  under_threshold: 'Downtime is within 5 days',
  deducted_no_invoice: 'Deducted with no SANY invoice number',
  non_sar_currency: 'Currency is not SAR',
  missing_asset: 'Asset number missing',
}

/** Days a row has been sitting since it was created (null if undated). */
export function ageDays(r, now) {
  const c = toMillis(r?.created_at)
  if (c == null) return null
  return Math.max(0, Math.floor((nowMs(now) - c) / DAY_MS))
}

/**
 * Full ledger summary for the KPI strip and breakdowns.
 * Money is SAR only; a non-SAR row is excluded from the totals and counted.
 */
export function summarizeLedger(rows = [], { now } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { draft: 0, deducted: 0, waived: 0 }
  const countByStatus = { draft: 0, deducted: 0, waived: 0 }
  let hours = 0; let hoursRows = 0; let unpriced = 0; let foreignCurrency = 0
  let overdueDrafts = 0; let overdueDraftAmount = 0; let withInvoice = 0; let issueRows = 0
  const invoices = new Set()
  for (const r of list) {
    const st = statusOf(r)
    countByStatus[st] += 1
    const issues = rowIssues(r)
    if (issues.length) issueRows += 1
    if (issues.includes('non_sar_currency')) { foreignCurrency += 1; continue }
    const amt = storedPenalty(r)
    if (amt == null) unpriced += 1
    else byStatus[st] += amt
    const h = numOrNull(r.downtime_hours)
    if (h != null && h > 0) { hours += h; hoursRows += 1 }
    const inv = String(r.sany_invoice_no || '').trim()
    if (inv) { withInvoice += 1; invoices.add(inv) }
    if (st === 'draft') {
      const a = ageDays(r, now)
      if (a != null && a > DRAFT_OVERDUE_DAYS) { overdueDrafts += 1; overdueDraftAmount += amt ?? 0 }
    }
  }
  const priced = list.length - unpriced - foreignCurrency
  const toDeduct = byStatus.draft + byStatus.deducted
  const round2 = (n) => Math.round(n * 100) / 100
  return {
    count: list.length,
    countByStatus,
    byStatus: { draft: round2(byStatus.draft), deducted: round2(byStatus.deducted), waived: round2(byStatus.waived) },
    toDeduct: priced > 0 ? round2(toDeduct) : null,
    outstanding: priced > 0 ? round2(byStatus.draft) : null,
    deductedPct: toDeduct > 0 ? Math.round((byStatus.deducted / toDeduct) * 1000) / 10 : null,
    hours: hoursRows ? Math.round(hours * 10) / 10 : null,
    avgDowntimeDays: hoursRows ? Math.round((hours / hoursRows / 24) * 10) / 10 : null,
    unpriced,
    foreignCurrency,
    overdueDrafts,
    overdueDraftAmount: round2(overdueDraftAmount),
    invoiceCoveragePct: list.length ? Math.round((withInvoice / list.length) * 1000) / 10 : null,
    distinctInvoices: invoices.size,
    issueRows,
  }
}

/** Grouped totals (SAR penalty + hours + rows) by a key function, largest first. */
export function groupPenalties(rows = [], keyFn, { limit = 10 } = {}) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (rowIssues(r).includes('non_sar_currency')) continue
    const k = String(keyFn(r) || '').trim() || 'Not recorded'
    const cur = map.get(k) || { key: k, rows: 0, penalty: 0, hours: 0 }
    cur.rows += 1
    cur.penalty += storedPenalty(r) ?? 0
    cur.hours += numOrNull(r.downtime_hours) ?? 0
    map.set(k, cur)
  }
  return [...map.values()]
    .map((g) => ({ ...g, penalty: Math.round(g.penalty * 100) / 100, hours: Math.round(g.hours * 10) / 10 }))
    .sort((a, b) => b.penalty - a.penalty || b.rows - a.rows || a.key.localeCompare(b.key))
    .slice(0, limit)
}

/** Monthly trend of penalty by period_date (YYYY-MM), oldest first. */
export function monthlyTrend(rows = []) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (rowIssues(r).includes('non_sar_currency')) continue
    const m = String(r?.period_date || '').slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(m)) continue
    const cur = map.get(m) || { month: m, penalty: 0, deducted: 0, rows: 0 }
    const amt = storedPenalty(r) ?? 0
    cur.rows += 1
    if (statusOf(r) !== 'waived') cur.penalty += amt
    if (statusOf(r) === 'deducted') cur.deducted += amt
    map.set(m, cur)
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
}

/** Assets penalised more than once (repeat offenders). */
export function repeatAssets(rows = [], { min = 2 } = {}) {
  return groupPenalties(rows, (r) => r.asset_no, { limit: 1000 })
    .filter((g) => g.key !== 'Not recorded' && g.rows >= min)
}

/**
 * Filter ledger rows. `invoice` is 'all' | 'with' | 'without'; `issues` true
 * keeps only rows with at least one data-quality issue.
 */
export function filterLedger(rows = [], { search = '', status = 'all', site = 'all', invoice = 'all', issues = false } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (status !== 'all' && statusOf(r) !== status) return false
    if (site !== 'all' && String(r.site || '') !== site) return false
    const hasInv = !!String(r.sany_invoice_no || '').trim()
    if (invoice === 'with' && !hasInv) return false
    if (invoice === 'without' && hasInv) return false
    if (issues && rowIssues(r).length === 0) return false
    if (!q) return true
    return [r.asset_no, r.site, r.work_order_no, r.sany_invoice_no, r.notes]
      .some((v) => String(v || '').toLowerCase().includes(q))
  })
}

/** Distinct site options present in the rows (sorted). */
export function siteOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => String(r.site || '').trim()).filter(Boolean))].sort()
}

/** Flat rows for Excel/PDF export. Missing money stays blank, never 0. */
export function ledgerExportRows(rows = [], { now } = {}) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const amt = storedPenalty(r)
    return {
      asset_no: r.asset_no || '',
      site: r.site || '',
      work_order_no: r.work_order_no || '',
      period: String(r.period_date || '').slice(0, 7),
      downtime_hours: numOrNull(r.downtime_hours) ?? '',
      downtime_days: numOrNull(r.downtime_hours) == null ? '' : Math.round((numOrNull(r.downtime_hours) / 24) * 10) / 10,
      rate_per_hour: numOrNull(r.rate_per_hour) ?? '',
      penalty_amount: amt == null ? '' : Math.round(amt),
      status: statusOf(r),
      sany_invoice_no: r.sany_invoice_no || '',
      age_days: ageDays(r, now) ?? '',
      issues: rowIssues(r).map((k) => ISSUE_LABELS[k] || k).join('; '),
    }
  })
}
