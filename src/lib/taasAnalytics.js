/**
 * TaaS analytics: pure presentation engine for the Tyre-as-a-Service page
 * (/taas). Builds on the commercial primitives in ./taas (costPerKm,
 * kmUtilization, daysToRenewal, summariseTaas, byPlan) and adds filter, KPI,
 * renewal attention, currency-safety and export shaping.
 *
 * No I/O; the clock is injected (`now`).
 *
 * HONESTY RULES:
 *  - Money is never blended across currencies. When live contracts carry more
 *    than one currency, the single MRR headline is null (rendered N/A) and the
 *    per-currency breakdown is returned instead.
 *  - Average utilisation / cost per km are null when no contract is measurable.
 */
import {
  summariseTaas, byPlan, costPerKm, kmUtilization, daysToRenewal, toFiniteNumber,
  PLAN_TYPES, STATUSES,
} from './taas'

export { costPerKm, kmUtilization, daysToRenewal, byPlan, PLAN_TYPES, STATUSES }

export const PLAN_LABEL = {
  per_km: 'Per km', per_month: 'Per month', per_tyre: 'Per tyre', hybrid: 'Hybrid',
  unspecified: 'Unspecified',
}
export const STATUS_LABEL = {
  active: 'Active', trial: 'Trial', paused: 'Paused', cancelled: 'Cancelled', expired: 'Expired',
}
const LIVE = new Set(['active', 'trial'])

export function isLive(r) { return LIVE.has(r?.status) }

/** Filter by plan / status / country / free-text search. */
export function filterTaas(rows = [], { plan = '', status = '', country = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (plan && r.plan_type !== plan) return false
    if (status && r.status !== status) return false
    if (country && r.country !== country) return false
    if (q) {
      const hay = `${r.customer_name || ''} ${r.subscription_no || ''} ${r.asset_no || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Live-contract MRR per currency (row currency, else the fallback). */
export function mrrByCurrency(rows = [], fallbackCurrency = 'SAR') {
  const out = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isLive(r)) continue
    const fee = toFiniteNumber(r?.monthly_fee)
    if (fee == null) continue
    const cur = (r.currency || fallbackCurrency || '').toUpperCase()
    out[cur] = (out[cur] || 0) + fee
  }
  return out
}

/** Renewal chip text for a days-to-renewal value. */
export function renewalLabel(days) {
  if (days == null) return ''
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'due today'
  return `in ${days}d`
}

/** Live contracts renewing within `withinDays` (overdue included), soonest first. */
export function renewalsDue(rows = [], now = Date.now(), withinDays = 30, limit = 12) {
  return (Array.isArray(rows) ? rows : [])
    .filter(isLive)
    .map((r) => ({ r, days: daysToRenewal(r, now) }))
    .filter((x) => x.days != null && x.days <= withinDays)
    .sort((a, b) => a.days - b.days)
    .slice(0, limit)
}

/** KPI block for the header. */
export function taasKpis(rows = [], { now = Date.now(), currency = 'SAR' } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseTaas(list, now)
  const byCur = mrrByCurrency(list, currency)
  const currencies = Object.keys(byCur)
  let utilSum = 0; let utilN = 0; let overrun = 0; let overdue = 0
  for (const r of list) {
    const u = kmUtilization(r)
    if (u != null) { utilSum += u; utilN += 1; if (u > 100) overrun += 1 }
    if (isLive(r)) {
      const d = daysToRenewal(r, now)
      if (d != null && d < 0) overdue += 1
    }
  }
  const mixedCurrency = currencies.length > 1
  return {
    ...base,
    liveCount: base.activeCount + base.trialCount,
    mrrByCurrency: byCur,
    mixedCurrency,
    mrrCurrency: currencies.length === 1 ? currencies[0] : (currencies.length === 0 ? currency : null),
    mrr: mixedCurrency ? null : base.mrr,
    avgUtilization: utilN ? Math.round((utilSum / utilN) * 10) / 10 : null,
    overrunCount: overrun,
    renewalsOverdue: overdue,
  }
}

export const EXPORT_COLS = [
  'subscription_no', 'customer_name', 'asset_no', 'plan', 'status', 'tyres_covered',
  'rate', 'committed_km', 'actual_km', 'utilization', 'monthly_fee', 'currency', 'billed_to_date',
  'cost_per_km', 'start_date', 'renewal_date',
]
export const EXPORT_HEADERS = [
  'Subscription', 'Customer', 'Asset', 'Plan', 'Status', 'Tyres', 'Rate',
  'Committed km', 'Actual km', 'Utilisation %', 'Monthly fee', 'Currency', 'Billed to date',
  'Cost per km', 'Start date', 'Renewal date',
]

export function taasExportRows(rows = [], fallbackCurrency = 'SAR') {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const cpk = costPerKm(r)
    const util = kmUtilization(r)
    return {
      subscription_no: r.subscription_no || '',
      customer_name: r.customer_name || '',
      asset_no: r.asset_no || '',
      plan: PLAN_LABEL[r.plan_type] || r.plan_type || '',
      status: STATUS_LABEL[r.status] || r.status || '',
      tyres_covered: r.tyres_covered ?? '',
      rate: r.rate ?? '',
      committed_km: r.committed_km ?? '',
      actual_km: r.actual_km ?? '',
      utilization: util == null ? '' : Math.round(util),
      monthly_fee: r.monthly_fee ?? '',
      currency: r.currency || fallbackCurrency || '',
      billed_to_date: r.billed_to_date ?? '',
      cost_per_km: cpk == null ? '' : Math.round(cpk * 1000) / 1000,
      start_date: r.start_date || '',
      renewal_date: r.renewal_date || '',
    }
  })
}
