/**
 * driverTrainingAnalytics - pure analytics for the Driver Training register
 * (/driver-training). Builds ON the certification-currency primitives in
 * `src/lib/driverTraining.js` (daysUntilExpiry / expiryStatus / toFiniteNumber)
 * rather than re-deriving them, so expiry maths lives in exactly one place.
 *
 * No I/O. Every "now"-dependent function takes an explicit `nowMs`.
 * Honest nulls: a rate with no denominator is null (rendered N/A), never 0;
 * a cost total across more than one currency is null with `mixedCurrency`.
 */
import { daysUntilExpiry, expiryStatus, toFiniteNumber } from './driverTraining'

export const EXPIRY_BUCKETS = ['expired', 'expiring_soon', 'valid', 'unknown']
export const EXPIRY_BUCKET_LABEL = {
  expired: 'Expired',
  expiring_soon: 'Expiring in 30 days',
  valid: 'Valid',
  unknown: 'No expiry recorded',
}

const norm = (v) => (v == null ? '' : String(v).trim())
const lower = (v) => norm(v).toLowerCase()

/**
 * Filter records by the register's controls. Blank / 'all' means no filter.
 * @param {Array<object>} rows
 * @param {{category?:string,result?:string,country?:string,expiry?:string,search?:string}} f
 * @param {number} nowMs
 */
export function filterTraining(rows = [], f = {}, nowMs = 0) {
  const list = Array.isArray(rows) ? rows : []
  const q = lower(f.search)
  const on = (v) => v != null && v !== '' && v !== 'all'
  return list.filter((r) => {
    if (on(f.category) && r?.category !== f.category) return false
    if (on(f.result) && lower(r?.result) !== lower(f.result)) return false
    if (on(f.country) && r?.country !== f.country) return false
    if (on(f.expiry) && expiryStatus(r, nowMs) !== f.expiry) return false
    if (q) {
      const hay = [r?.driver_name, r?.course_name, r?.provider, r?.certificate_no, r?.notes]
        .map(lower).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Records needing attention: expired first (most overdue), then soonest expiring. */
export function attentionList(rows = [], nowMs = 0) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ r, status: expiryStatus(r, nowMs), days: daysUntilExpiry(r, nowMs) }))
    .filter((x) => x.status === 'expired' || x.status === 'expiring_soon')
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
}

/**
 * Full analysis of a (filtered) record set.
 * @returns {{kpis:object, expiry:Array, categories:Array}}
 */
export function analyzeTraining(rows = [], nowMs = 0) {
  const list = Array.isArray(rows) ? rows : []
  const drivers = new Set()
  const expiredDrivers = new Set()
  const buckets = { expired: 0, expiring_soon: 0, valid: 0, unknown: 0 }
  const cats = new Map()
  const currencies = new Set()
  let pass = 0
  let fail = 0
  let scoreSum = 0
  let scoreN = 0
  let cost = 0
  let costN = 0

  for (const r of list) {
    const driver = lower(r?.driver_name)
    if (driver) drivers.add(driver)
    const status = expiryStatus(r, nowMs)
    buckets[status] += 1
    if (status === 'expired' && driver) expiredDrivers.add(driver)

    const result = lower(r?.result)
    if (result === 'pass') pass += 1
    else if (result === 'fail') fail += 1

    const score = toFiniteNumber(r?.score)
    if (score != null) { scoreSum += score; scoreN += 1 }

    const c = toFiniteNumber(r?.cost)
    if (c != null) {
      cost += c
      costN += 1
      const cur = norm(r?.currency).toUpperCase()
      if (cur) currencies.add(cur)
    }

    const cat = norm(r?.category) || 'uncategorised'
    const e = cats.get(cat) || { category: cat, count: 0, pass: 0, fail: 0, expired: 0 }
    e.count += 1
    if (result === 'pass') e.pass += 1
    else if (result === 'fail') e.fail += 1
    if (status === 'expired') e.expired += 1
    cats.set(cat, e)
  }

  const decided = pass + fail
  const known = buckets.expired + buckets.expiring_soon + buckets.valid
  const mixedCurrency = currencies.size > 1
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)

  return {
    kpis: {
      totalRecords: list.length,
      distinctDrivers: drivers.size,
      passCount: pass,
      failCount: fail,
      passRate: pct(pass, decided),
      avgScore: scoreN > 0 ? Math.round((scoreSum / scoreN) * 10) / 10 : null,
      // Share of certifications with a known expiry that are still current.
      currencyRate: pct(buckets.valid + buckets.expiring_soon, known),
      expiredCount: buckets.expired,
      expiringSoonCount: buckets.expiring_soon,
      driversWithExpired: expiredDrivers.size,
      totalCost: costN > 0 && !mixedCurrency ? Math.round(cost * 100) / 100 : null,
      costCurrency: currencies.size === 1 ? [...currencies][0] : null,
      mixedCurrency,
      costedCount: costN,
    },
    expiry: EXPIRY_BUCKETS.map((key) => ({ key, label: EXPIRY_BUCKET_LABEL[key], count: buckets[key] })),
    categories: [...cats.values()]
      .map((c) => ({ ...c, passRate: pct(c.pass, c.pass + c.fail) }))
      .sort((a, b) => b.count - a.count),
  }
}
