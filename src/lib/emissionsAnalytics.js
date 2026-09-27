/**
 * emissionsAnalytics - pure engine behind the Emissions Tests page
 * (/emissions). Builds on `src/lib/emissionsTests.js` (the one home of expiry
 * classification: daysUntilExpiry, expiryStatus, latestPerAsset,
 * EXPIRING_SOON_DAYS) and adds filtering, an honest pass rate, the per-asset
 * compliance snapshot, a renewal pipeline, pollutant reading averages and a
 * per-currency cost split.
 *
 * No I/O, no React, no Date.now(): `nowMs` is always injected.
 *
 * Honesty rules:
 *   - pass rate is null when no test has a pass/fail result (the older
 *     summariseEmissions reports 0 there, which reads as "everything failed");
 *   - a pollutant average is null when no test recorded that pollutant;
 *   - cost is never summed across currencies.
 */
import {
  daysUntilExpiry, expiryStatus, latestPerAsset, toFiniteNumber, EXPIRING_SOON_DAYS,
} from './emissionsTests'

export { EXPIRING_SOON_DAYS, daysUntilExpiry, expiryStatus }

export const EXPIRY_ORDER = ['expired', 'expiring_soon', 'valid', 'unknown']
export const EXPIRY_LABELS = {
  expired: 'Expired',
  expiring_soon: 'Expiring soon',
  valid: 'Valid',
  unknown: 'No expiry',
}

export const POLLUTANTS = [
  { key: 'co_pct', label: 'CO', unit: '%' },
  { key: 'hc_ppm', label: 'HC', unit: 'ppm' },
  { key: 'nox_ppm', label: 'NOx', unit: 'ppm' },
  { key: 'opacity_pct', label: 'Opacity', unit: '%' },
  { key: 'co2_pct', label: 'CO2', unit: '%' },
]

/**
 * Filter tests. All criteria optional.
 * @param {{ asset?:string, result?:string, expiry?:string, search?:string, nowMs:number }} f
 */
export function filterEmissionsTests(rows, f = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  return list.filter((r) => {
    if (!r) return false
    if (f.asset && r.asset_no !== f.asset) return false
    if (f.result) {
      const res = String(r.result || '').toLowerCase()
      if (f.result === 'none' ? res !== '' : res !== f.result) return false
    }
    if (f.expiry && expiryStatus(r, f.nowMs) !== f.expiry) return false
    if (q) {
      const hay = [r.asset_no, r.certificate_no, r.test_center, r.standard, r.notes].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Latest certificate per asset with its expiry status, soonest expiry first. */
export function complianceSnapshot(rows, nowMs) {
  return latestPerAsset(Array.isArray(rows) ? rows : [])
    .map((r) => ({
      ...r,
      expiry_status: expiryStatus(r, nowMs),
      days_to_expiry: daysUntilExpiry(r, nowMs),
    }))
    .sort((a, b) => (a.days_to_expiry ?? Infinity) - (b.days_to_expiry ?? Infinity)
      || String(a.asset_no).localeCompare(String(b.asset_no)))
}

/** Pass rate over tests that carry a pass/fail result; null when none do. */
export function passRate(rows) {
  let pass = 0
  let fail = 0
  let conditional = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const res = String(r?.result || '').trim().toLowerCase()
    if (res === 'pass') pass += 1
    else if (res === 'fail') fail += 1
    else if (res === 'conditional') conditional += 1
  }
  const decided = pass + fail
  return {
    pass, fail, conditional,
    rate: decided > 0 ? Math.round((pass / decided) * 1000) / 10 : null,
  }
}

/**
 * Renewals due, bucketed by how far out the latest certificate expires:
 * overdue, 0-30, 31-60, 61-90 days. Assets with no expiry are counted apart.
 */
export function renewalPipeline(rows, nowMs) {
  const buckets = { overdue: 0, d30: 0, d60: 0, d90: 0, later: 0, unknown: 0 }
  for (const r of complianceSnapshot(rows, nowMs)) {
    const d = r.days_to_expiry
    if (d == null) buckets.unknown += 1
    else if (d < 0) buckets.overdue += 1
    else if (d <= 30) buckets.d30 += 1
    else if (d <= 60) buckets.d60 += 1
    else if (d <= 90) buckets.d90 += 1
    else buckets.later += 1
  }
  return buckets
}

/** Average of each pollutant reading across the tests that recorded it. */
export function pollutantAverages(rows) {
  const list = Array.isArray(rows) ? rows : []
  return POLLUTANTS.map((p) => {
    let sum = 0
    let n = 0
    for (const r of list) {
      const v = toFiniteNumber(r?.[p.key])
      if (v == null) continue
      sum += v
      n += 1
    }
    return { ...p, samples: n, average: n > 0 ? Math.round((sum / n) * 100) / 100 : null }
  })
}

/** One cost line per currency; never a blended total. */
export function costByCurrency(rows) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const cost = toFiniteNumber(r?.cost)
    if (cost == null) continue
    const cur = r?.currency && String(r.currency).trim() ? String(r.currency).trim().toUpperCase() : 'Unspecified'
    const g = map.get(cur) || { currency: cur, cost: 0, tests: 0 }
    g.cost += cost
    g.tests += 1
    map.set(cur, g)
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost)
}

/** KPI block for the header strip. */
export function emissionsKpis(rows, nowMs) {
  const list = Array.isArray(rows) ? rows : []
  const snap = complianceSnapshot(list, nowMs)
  const count = (s) => snap.filter((r) => r.expiry_status === s).length
  const pr = passRate(list)
  const withExpiry = snap.filter((r) => r.expiry_status !== 'unknown').length
  return {
    totalTests: list.length,
    assets: snap.length,
    passRate: pr.rate,
    passCount: pr.pass,
    failCount: pr.fail,
    expired: count('expired'),
    expiringSoon: count('expiring_soon'),
    valid: count('valid'),
    noExpiry: count('unknown'),
    // Share of assets whose latest certificate is currently valid; null with no assets.
    compliantShare: snap.length ? Math.round((count('valid') + count('expiring_soon')) / snap.length * 1000) / 10 : null,
    expiryCoverage: snap.length ? Math.round((withExpiry / snap.length) * 1000) / 10 : null,
  }
}
