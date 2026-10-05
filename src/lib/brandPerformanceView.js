/**
 * brandPerformanceView - pure shaping for the rebuilt Brand Performance page
 * (/brand-perf). No I/O, no React, no clock reads.
 *
 * Builds on brandPerformanceAnalytics (rated-subset failure rate, priced-only
 * cost) and kpiEngine (tyre life and CPK from fitment and removal km), so no
 * maths is re-implemented. Adds what the owner's mockup asks for:
 *   - one scoreboard row per brand: tyres, avg life km, failure %, avg CPK,
 *     purchase cost from priced tyre records, retread share, warranty claims
 *     and credit recovered, and a composite score
 *   - asset class (vehicle_type) and size filters on top of site and risk
 *   - plain-language insight lines drawn only from those measured figures
 *
 * Honest rules: a figure with no source rows is null (N/A), never 0. Money is
 * null on the All-countries scope (SAR, AED and EGP are never added). The
 * composite score only exists when at least two of its components are
 * measured for the brand, and it says which components it used.
 */
import { buildBrandMetrics } from './brandPerformanceAnalytics'
import { computeAvgTyreLife, computeCpkByBrand } from './kpiEngine'

const norm = (v) => (v == null ? '' : String(v).trim())
const brandKey = (r) => r?.brand || 'Unknown'

/** Statuses that mean the supplier paid out on the claim. */
export const CREDITED = ['Credit Issued', 'Closed']
/** Statuses that mean the supplier has decided the claim. */
export const DECIDED = ['Approved', 'Rejected', 'Credit Issued', 'Closed']
const ACCEPTED = ['Approved', 'Credit Issued', 'Closed']

/** Score weights. Renormalised over the components a brand actually has. */
export const SCORE_WEIGHTS = { life: 0.3, cpk: 0.3, failure: 0.25, warranty: 0.15 }
export const SCORE_LABEL = { life: 'tyre life', cpk: 'cost per km', failure: 'failure rate', warranty: 'warranty acceptance' }

/** Asset classes and sizes present in the rows, for the filter selects. */
export function brandFilterOptions(records = []) {
  const uniq = (k) => [...new Set(records.map((r) => norm(r?.[k])).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  return { sites: uniq('site'), classes: uniq('vehicle_type'), sizes: uniq('size') }
}

/** Asset class and size filters (site and risk stay in filterBrandRecords). */
export function filterByClassAndSize(records = [], { assetClass = '', size = '' } = {}) {
  return records.filter((r) => {
    if (assetClass && norm(r?.vehicle_type) !== assetClass) return false
    if (size && norm(r?.size) !== size) return false
    return true
  })
}

/** Warranty claims grouped by brand: count, decided, accepted, credited money. */
export function warrantyByBrand(claims = []) {
  const map = new Map()
  for (const c of claims || []) {
    const k = norm(c?.brand) || 'Unknown'
    if (!map.has(k)) map.set(k, { claims: 0, decided: 0, accepted: 0, credit: 0, credited: 0 })
    const w = map.get(k)
    w.claims += 1
    const s = norm(c?.claim_status)
    if (DECIDED.includes(s)) w.decided += 1
    if (ACCEPTED.includes(s)) w.accepted += 1
    const amt = Number(c?.credit_amount)
    if (CREDITED.includes(s) && Number.isFinite(amt) && amt > 0) { w.credit += amt; w.credited += 1 }
  }
  return map
}

/**
 * One row per brand. `money` false (All countries) nulls every money figure.
 * Sorted by score (best first), unscored brands after, then by tyre count.
 */
export function brandScoreboard(records = [], { claims = [], money = true } = {}) {
  const metrics = buildBrandMetrics(records)
  const life = new Map((computeAvgTyreLife(records).byBrand || []).map((b) => [b.brand, b]))
  const cpk = new Map(computeCpkByBrand(records).map((b) => [b.brand, b]))
  const warranty = warrantyByBrand(claims)

  const byBrand = new Map()
  for (const r of records) {
    const k = brandKey(r)
    if (!byBrand.has(k)) byBrand.set(k, [])
    byBrand.get(k).push(r)
  }

  const rows = metrics.map((m) => {
    const recs = byBrand.get(m.brand) || []
    const categorised = recs.filter((r) => norm(r?.category))
    const retreads = categorised.filter((r) => /retread/i.test(norm(r.category))).length
    const l = life.get(m.brand)
    const c = cpk.get(m.brand)
    const w = warranty.get(m.brand) || null
    return {
      brand: m.brand,
      tyres: m.count,
      ratedCount: m.ratedCount,
      pricedCount: m.pricedCount,
      lifeCount: l ? l.count : 0,
      avgLifeKm: l ? Math.round(l.avgKm) : null,
      failurePct: m.failureRate,
      cpkCount: c ? c.validCount : 0,
      avgCpk: money && c ? c.avgCpk : null,
      purchaseCost: money ? m.totalCost : null,
      retreadPct: categorised.length ? (retreads / categorised.length) * 100 : null,
      warrantyClaims: w ? w.claims : 0,
      warrantyAcceptPct: w && w.decided ? (w.accepted / w.decided) * 100 : null,
      warrantyRecovery: money && w && w.credited ? w.credit : null,
      score: null,
      scoreParts: [],
    }
  })

  // Normalise each component against the best brand that has it.
  const vals = (k) => rows.map((r) => r[k]).filter((v) => v != null && Number.isFinite(v))
  const maxLife = Math.max(0, ...vals('avgLifeKm'))
  const cpks = vals('avgCpk').filter((v) => v > 0)
  const minCpk = cpks.length ? Math.min(...cpks) : null
  for (const r of rows) {
    const parts = {}
    if (r.avgLifeKm != null && maxLife > 0) parts.life = r.avgLifeKm / maxLife
    if (r.avgCpk != null && r.avgCpk > 0 && minCpk) parts.cpk = minCpk / r.avgCpk
    if (r.failurePct != null) parts.failure = 1 - r.failurePct / 100
    if (r.warrantyAcceptPct != null) parts.warranty = r.warrantyAcceptPct / 100
    const keys = Object.keys(parts)
    if (keys.length >= 2) {
      const wsum = keys.reduce((s, k) => s + SCORE_WEIGHTS[k], 0)
      r.score = Math.round((keys.reduce((s, k) => s + parts[k] * SCORE_WEIGHTS[k], 0) / wsum) * 100)
      r.scoreParts = keys
    }
  }

  return rows.sort((a, b) => {
    if (a.score != null && b.score != null) return b.score - a.score || b.tyres - a.tyres
    if (a.score != null) return -1
    if (b.score != null) return 1
    return b.tyres - a.tyres
  })
}

/** Score tone: good at 80+, warn at 60+, bad below. null when unscored. */
export function scoreTone(score) {
  if (score == null) return null
  if (score >= 80) return 'good'
  if (score >= 60) return 'warn'
  return 'bad'
}

/** Failure tone matching the existing failure bands (15 / 30). */
export function failureTone(pct) {
  if (pct == null) return null
  if (pct > 30) return 'bad'
  if (pct > 15) return 'warn'
  return 'good'
}

/** Headline picks: best score, worst failure rate, highest CPK. */
export function brandHeadlines(rows = []) {
  const scored = rows.filter((r) => r.score != null)
  const rated = rows.filter((r) => r.failurePct != null).sort((a, b) => b.failurePct - a.failurePct || b.ratedCount - a.ratedCount)
  const priced = rows.filter((r) => r.avgCpk != null).sort((a, b) => b.avgCpk - a.avgCpk)
  const longest = rows.filter((r) => r.avgLifeKm != null).sort((a, b) => b.avgLifeKm - a.avgLifeKm)
  return {
    best: scored[0] || null,
    worstFailure: rated.length > 1 ? rated[0] : null,
    worstCpk: priced.length > 1 ? priced[0] : null,
    longestLife: longest[0] || null,
  }
}

const fmtN = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

/**
 * Insight sentences for the whole scope or one brand. Only measured figures
 * are named; nothing is said about a brand that has no data for it.
 */
export function brandInsight(rows = [], selected = null) {
  if (selected) {
    const r = rows.find((x) => x.brand === selected)
    if (!r) return []
    const out = [`${r.brand} has ${fmtN(r.tyres)} tyre records in this scope.`]
    if (r.avgLifeKm != null) out.push(`Average life is ${fmtN(r.avgLifeKm)} km over ${fmtN(r.lifeCount)} tyres with fitment and removal km.`)
    else out.push('No tyre of this brand has both fitment and removal km, so life and CPK cannot be measured.')
    if (r.failurePct != null) out.push(`Failure rate is ${r.failurePct.toFixed(1)}% over ${fmtN(r.ratedCount)} risk-rated tyres.`)
    else out.push('None of its records carries a risk rating, so failure rate is not measured.')
    if (r.warrantyClaims) out.push(`${fmtN(r.warrantyClaims)} warranty claims recorded against this brand.`)
    return out
  }
  const h = brandHeadlines(rows)
  const out = []
  if (h.best) out.push(`${h.best.brand} has the best composite score (${h.best.score}), built from ${h.best.scoreParts.map((k) => SCORE_LABEL[k]).join(', ')}.`)
  if (h.worstFailure) out.push(`${h.worstFailure.brand} shows the highest failure rate at ${h.worstFailure.failurePct.toFixed(1)}% of rated tyres.`)
  if (h.worstCpk && (!h.worstFailure || h.worstCpk.brand !== h.worstFailure.brand)) out.push(`${h.worstCpk.brand} carries the highest cost per km in this scope.`)
  if (h.longestLife) out.push(`${h.longestLife.brand} delivers the longest measured life at ${fmtN(h.longestLife.avgLifeKm)} km.`)
  return out
}

/** Bar data for the ranking card: top n scored brands. */
export function rankingBars(rows = [], n = 6) {
  return rows.filter((r) => r.score != null).slice(0, n).map((r) => ({ brand: r.brand, value: r.score }))
}

/** Bar data for the failure card: rated brands, lowest failure first. */
export function failureBars(rows = [], n = 6) {
  return rows
    .filter((r) => r.failurePct != null)
    .sort((a, b) => a.failurePct - b.failurePct || b.ratedCount - a.ratedCount)
    .slice(0, n)
    .map((r) => ({ brand: r.brand, value: r.failurePct, rated: r.ratedCount }))
}

/** Two-letter label for a bar axis. */
export function brandInitials(brand) {
  const words = norm(brand).split(/\s+/).filter(Boolean)
  if (!words.length) return 'NA'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Export rows for the scoreboard. Money columns read N/A on mixed scope. */
export const SCOREBOARD_EXPORT_COLS = ['brand', 'tyres', 'avg_life_km', 'failure_pct', 'rated', 'avg_cpk', 'purchase_cost', 'retread_pct', 'warranty_claims', 'warranty_recovery', 'score']
export const SCOREBOARD_EXPORT_HEADERS = ['Brand', 'Tyres', 'Avg life km', 'Failure %', 'Rated tyres', 'Avg CPK', 'Purchase cost', 'Retread %', 'Warranty claims', 'Warranty recovery', 'Score']
export function scoreboardExportRows(rows = []) {
  const f = (v, d) => (v == null ? 'N/A' : Number(Number(v).toFixed(d)))
  return rows.map((r) => ({
    brand: r.brand,
    tyres: r.tyres,
    avg_life_km: f(r.avgLifeKm, 0),
    failure_pct: f(r.failurePct, 1),
    rated: r.ratedCount,
    avg_cpk: f(r.avgCpk, 3),
    purchase_cost: f(r.purchaseCost, 2),
    retread_pct: f(r.retreadPct, 1),
    warranty_claims: r.warrantyClaims,
    warranty_recovery: f(r.warrantyRecovery, 2),
    score: r.score == null ? 'N/A' : r.score,
  }))
}
