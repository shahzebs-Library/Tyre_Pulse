// ─────────────────────────────────────────────────────────────────────────────
// supplierScorecard.js - Pure supplier scorecard (no AI tokens, no network).
// Joins tyre_records + warranty_claims + purchase_orders by supplier.
// Cost is ACTUAL only (cost_per_tyre); missing → 0, never a settings default.
//
// The base composite `score` (0-100) is UNCHANGED and remains the ranking key:
//   cpk 0.30, fail 0.30, warrantyRecovery 0.15, onTime 0.25 — with missing
//   sub-metrics excluded from that supplier's weighted mean (re-normalized).
//
// Additive dimensions (ported from tyre_saas vendor_scorecard_engine.py +
// vendor_scorecard_lifecycle.py), surfaced as extra fields on each supplier row
// WITHOUT altering the base `score`, `rank`, or existing totals keys:
//   • grade                    A/B/C/D/F on the base score
//   • band                     lifecycle band {band,label,urgency,score}
//   • warrantyAcceptanceRate   accepted|approved claims / total claims (1 = 100%, default 1)
//   • priceCompetitiveness     0-100 from supplier unit cost vs fleet market avg
//   • flags                    threshold-driven issue strings
//   • trend / trendDelta       period-over-period (issue_date buckets) score delta
//   • scoreExpanded            OPTIONAL composite that also folds acceptance+price
//                              (documented, supplementary — never used for grade/band/rank)
//
// Not derivable from this dataset (honestly omitted, no fabrication):
//   • invoice accuracy  — needs goods_receipts (not in schema/read path)
//   • returns-days      — needs a returns table (not in schema/read path)
// ─────────────────────────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const clamp = (v) => Math.max(0, Math.min(100, v))
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10)

/** Actual cost of one tyre_records row: cost_per_tyre × qty (qty defaults to 1). */
function tyreSpend(r) {
  return num(r?.cost_per_tyre) * (r?.qty == null ? 1 : num(r.qty))
}

/** CPK for one tyre_records row, or null when km data is missing/invalid. */
function recordCpk(r) {
  if (!r) return null
  const fit = r.km_at_fitment
  const rem = r.km_at_removal
  if (fit == null || rem == null) return null
  const kmRun = num(rem) - num(fit)
  if (kmRun <= 0) return null
  return num(r.cost_per_tyre) / kmRun
}

/** Normalise a raw supplier label; empty/nullish → 'Unknown'. */
function supKey(v) {
  const s = (v == null ? '' : String(v)).trim()
  return s || 'Unknown'
}

/** PO supplier label: supplier_name first, then vendor_name. */
function poKey(po) {
  return supKey(po?.supplier_name ?? po?.vendor_name)
}

/** On-time = actual_delivery present AND actual_delivery <= expected_delivery. */
function isOnTime(po) {
  if (!po?.actual_delivery || !po?.expected_delivery) return null
  const a = new Date(po.actual_delivery)
  const e = new Date(po.expected_delivery)
  if (isNaN(a.getTime()) || isNaN(e.getTime())) return null
  return a.getTime() <= e.getTime()
}

/** Parse a date-ish value to epoch ms, or null. */
function toMs(v) {
  if (v == null || v === '') return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

const APPROVED = new Set(['approved'])
// Warranty "accepted" set for acceptance-rate (approved OR accepted), matching
// vendor_scorecard_engine.py's acceptance formula.
const ACCEPTED = new Set(['approved', 'accepted'])

// ── Documented constants (thresholds / bands / periods) ──────────────────────
/** Base composite weights (UNCHANGED — the canonical ranking score). */
export const WEIGHTS = { cpk: 0.30, fail: 0.30, recov: 0.15, ot: 0.25 }

/** Optional expanded composite weights (supplementary; folds acceptance+price). */
export const EXPANDED_WEIGHTS = { cpk: 0.25, fail: 0.25, recov: 0.10, ot: 0.20, acceptance: 0.10, price: 0.10 }

/** Letter-grade cutoffs applied to the base 0-100 score. */
export const GRADE_CUTOFFS = { A: 85, B: 70, C: 55, D: 40 }

/** Flag thresholds (documented; mirror vendor_scorecard_engine.py flag rules). */
export const FLAG_THRESHOLDS = { onTimePct: 80, acceptancePct: 80, defectPct: 5 }

/** Trend period length (days) and improving/declining delta band (points). */
export const TREND_PERIOD_DAYS = 90
export const TREND_DELTA_PTS = 5

/**
 * Letter grade for a 0-100 score. A≥85, B≥70, C≥55, D≥40, else F.
 * @param {number|null} score
 * @returns {'A'|'B'|'C'|'D'|'F'}
 */
export function scoreGrade(score) {
  const s = Number(score)
  if (!Number.isFinite(s)) return 'F'
  if (s >= GRADE_CUTOFFS.A) return 'A'
  if (s >= GRADE_CUTOFFS.B) return 'B'
  if (s >= GRADE_CUTOFFS.C) return 'C'
  if (s >= GRADE_CUTOFFS.D) return 'D'
  return 'F'
}

/**
 * Vendor lifecycle band from a 0-100 score (mirrors vendor_scorecard_lifecycle.py):
 *   preferred ≥80 · approved 65-79 · watch 50-64 · probation 30-49 · disqualified <30.
 * @param {number|null} score
 * @returns {{band:string,label:string,urgency:string,score:number|null}}
 */
export function lifecycleBand(score) {
  const s = Number(score)
  if (score == null || !Number.isFinite(s)) {
    return { band: 'unknown', label: 'Unscored', urgency: 'none', score: null }
  }
  const r = round1(s)
  const n = Math.trunc(s)
  if (s < 30) return { band: 'disqualified', label: 'Disqualified', urgency: 'critical', score: r }
  if (s < 50) return { band: 'probation', label: `Probation — ${n}/100`, urgency: 'high', score: r }
  if (s < 65) return { band: 'watch', label: `Watch — ${n}/100`, urgency: 'medium', score: r }
  if (s < 80) return { band: 'approved', label: `Approved — ${n}/100`, urgency: 'none', score: r }
  return { band: 'preferred', label: `Preferred — ${n}/100`, urgency: 'none', score: r }
}

/**
 * Price competitiveness 0-100 from supplier vs market average unit cost.
 * clamp(0,100, round((2 - supplierAvg/marketAvg) × 50)); default 50 when data is
 * insufficient. A supplier at the market average scores 50; cheaper → higher.
 * @param {number|null} supplierAvg
 * @param {number|null} marketAvg
 * @returns {number}
 */
export function priceCompetitivenessScore(supplierAvg, marketAvg) {
  if (supplierAvg == null || !Number.isFinite(supplierAvg)) return 50
  if (marketAvg == null || !Number.isFinite(marketAvg) || marketAvg <= 0) return 50
  return clamp(Math.round((2 - supplierAvg / marketAvg) * 50))
}

/**
 * Threshold-driven flagged issues for one supplier row.
 * @param {{onTimeRate:number|null, warrantyAcceptanceRate:number|null, failureRate:number|null, warrantyClaims:number}} m
 * @returns {string[]}
 */
export function deriveFlags(m) {
  const flags = []
  if (m.onTimeRate != null && m.onTimeRate * 100 < FLAG_THRESHOLDS.onTimePct) {
    flags.push('Low on-time delivery rate')
  }
  if ((m.warrantyClaims || 0) > 0 && m.warrantyAcceptanceRate != null &&
      m.warrantyAcceptanceRate * 100 < FLAG_THRESHOLDS.acceptancePct) {
    flags.push('Low warranty claim acceptance')
  }
  if (m.failureRate != null && m.failureRate * 100 > FLAG_THRESHOLDS.defectPct) {
    flags.push('High failure/defect rate')
  }
  return flags
}

/**
 * Self-contained quality proxy (0-100) for one period bucket, used only for the
 * period-over-period trend delta (no cross-supplier normalization).
 * @returns {number|null} null when the bucket has no scorable signal.
 */
function periodQuality(b) {
  const parts = []
  if (b.tyres > 0) parts.push([clamp(100 - (b.claims / b.tyres) * 100), 0.4])
  if (b.poTotal > 0) parts.push([clamp((b.poOnTime / b.poTotal) * 100), 0.35])
  if (b.claims > 0) parts.push([clamp((b.accepted / b.claims) * 100), 0.25])
  const w = parts.reduce((s, [, x]) => s + x, 0)
  return w ? parts.reduce((s, [v, x]) => s + v * x, 0) / w : null
}

/**
 * Classify a trend from two period-quality proxies.
 * @returns {{trend:'improving'|'declining'|'stable', trendDelta:number|null}}
 */
function classifyTrend(cur, prior) {
  if (cur == null || prior == null) return { trend: 'stable', trendDelta: null }
  const delta = round1(cur - prior)
  const trend = delta > TREND_DELTA_PTS ? 'improving' : delta < -TREND_DELTA_PTS ? 'declining' : 'stable'
  return { trend, trendDelta: delta }
}

/**
 * Compute a per-supplier scorecard from actual operational data.
 * @param {{tyres?:Array, warranty?:Array, purchaseOrders?:Array}} input
 * @returns {{ suppliers: Array, totals: object }}
 */
export function computeSupplierScorecard({ tyres = [], warranty = [], purchaseOrders = [] } = {}) {
  const tyreRows = Array.isArray(tyres) ? tyres : []
  const warrantyRows = Array.isArray(warranty) ? warranty : []
  const poRows = Array.isArray(purchaseOrders) ? purchaseOrders : []

  // ── Period anchor: latest date across all inputs (fallback: now). ──────────
  const tyreMs = (r) => toMs(r?.issue_date)
  const warrMs = (w) => toMs(w?.created_at ?? w?.credit_date ?? w?.claim_date)
  const poMs = (po) => toMs(po?.order_date ?? po?.actual_delivery ?? po?.expected_delivery)
  let anchor = null
  for (const r of tyreRows) { const t = tyreMs(r); if (t != null && (anchor == null || t > anchor)) anchor = t }
  for (const w of warrantyRows) { const t = warrMs(w); if (t != null && (anchor == null || t > anchor)) anchor = t }
  for (const po of poRows) { const t = poMs(po); if (t != null && (anchor == null || t > anchor)) anchor = t }
  if (anchor == null) anchor = Date.now()
  const DAY = 86_400_000
  const curStart = anchor - TREND_PERIOD_DAYS * DAY
  const priorStart = anchor - 2 * TREND_PERIOD_DAYS * DAY
  const bucketOf = (ms) => {
    if (ms == null) return null
    if (ms > curStart && ms <= anchor) return 'cur'
    if (ms > priorStart && ms <= curStart) return 'prior'
    return null
  }

  const map = new Map()
  const emptyBucket = () => ({ tyres: 0, claims: 0, accepted: 0, poTotal: 0, poOnTime: 0 })
  const acc = (name) => {
    const key = supKey(name)
    if (!map.has(key)) {
      map.set(key, {
        supplier: key, tyreCount: 0, totalSpend: 0, cpkSum: 0, cpkN: 0,
        warrantyClaims: 0, warrantyCredit: 0, warrantyAccepted: 0,
        costSum: 0, costN: 0, poTotal: 0, poOnTime: 0,
        cur: emptyBucket(), prior: emptyBucket(),
      })
    }
    return map.get(key)
  }

  // Fleet-wide market average unit cost (all suppliers, cost_per_tyre > 0).
  let marketSum = 0
  let marketN = 0

  for (const r of tyreRows) {
    const a = acc(r?.supplier)
    a.tyreCount += 1
    a.totalSpend += tyreSpend(r)
    const cpk = recordCpk(r)
    if (cpk != null) { a.cpkSum += cpk; a.cpkN += 1 }
    const unit = num(r?.cost_per_tyre)
    if (unit > 0) { a.costSum += unit; a.costN += 1; marketSum += unit; marketN += 1 }
    const bkt = bucketOf(tyreMs(r))
    if (bkt) a[bkt].tyres += 1
  }

  for (const w of warrantyRows) {
    const a = acc(w?.supplier)
    a.warrantyClaims += 1
    const status = String(w?.claim_status ?? '').trim().toLowerCase()
    if (APPROVED.has(status)) a.warrantyCredit += num(w?.credit_amount)
    const isAccepted = ACCEPTED.has(status)
    if (isAccepted) a.warrantyAccepted += 1
    const bkt = bucketOf(warrMs(w))
    if (bkt) { a[bkt].claims += 1; if (isAccepted) a[bkt].accepted += 1 }
  }

  for (const po of poRows) {
    const a = acc(poKey(po))
    const ot = isOnTime(po)
    if (ot != null) { a.poTotal += 1; if (ot) a.poOnTime += 1 }
    const bkt = bucketOf(poMs(po))
    if (bkt) { a[bkt].poTotal += 1; if (ot) a[bkt].poOnTime += 1 }
  }

  const marketAvgCost = marketN ? marketSum / marketN : null

  const rows = Array.from(map.values()).map((a) => {
    const avgCpk = a.cpkN ? a.cpkSum / a.cpkN : null
    const failureRate = a.tyreCount ? a.warrantyClaims / a.tyreCount : null
    const warrantyRecoveryRate = a.warrantyClaims ? a.warrantyCredit / a.warrantyClaims : null
    const onTimeRate = a.poTotal ? a.poOnTime / a.poTotal : null
    // Acceptance %: accepted|approved / total claims; 1 (100%) when no claims.
    const warrantyAcceptanceRate = a.warrantyClaims ? a.warrantyAccepted / a.warrantyClaims : 1
    const supplierAvgCost = a.costN ? a.costSum / a.costN : null
    const priceCompetitiveness = priceCompetitivenessScore(supplierAvgCost, marketAvgCost)
    const { trend, trendDelta } = classifyTrend(periodQuality(a.cur), periodQuality(a.prior))
    return {
      supplier: a.supplier, tyreCount: a.tyreCount, totalSpend: a.totalSpend, avgCpk,
      failureRate, warrantyClaims: a.warrantyClaims, warrantyCredit: a.warrantyCredit,
      warrantyRecoveryRate, poTotal: a.poTotal, onTimeRate,
      // ── additive dimensions ──
      warrantyAccepted: a.warrantyAccepted, warrantyAcceptanceRate,
      supplierAvgCost, marketAvgCost, priceCompetitiveness,
      trend, trendDelta,
    }
  })

  // Base composite score (0-100, higher = better); missing sub-metrics excluded
  // from that supplier's weighted mean so absent data doesn't penalise. UNCHANGED.
  const cpks = rows.map((r) => r.avgCpk).filter((v) => v != null && v > 0)
  const bestCpk = cpks.length ? Math.min(...cpks) : null
  const recos = rows.map((r) => r.warrantyRecoveryRate).filter((v) => v != null)
  const maxReco = recos.length ? Math.max(...recos) : null

  rows.forEach((r) => {
    const parts = []
    const cpkPart = (r.avgCpk != null && r.avgCpk > 0 && bestCpk != null) ? clamp((bestCpk / r.avgCpk) * 100) : null
    const failPart = r.failureRate != null ? clamp(100 - r.failureRate * 100) : null
    const recovPart = (r.warrantyRecoveryRate != null && maxReco && maxReco > 0) ? clamp((r.warrantyRecoveryRate / maxReco) * 100) : null
    const otPart = r.onTimeRate != null ? clamp(r.onTimeRate * 100) : null
    if (cpkPart != null) parts.push([cpkPart, WEIGHTS.cpk])
    if (failPart != null) parts.push([failPart, WEIGHTS.fail])
    if (recovPart != null) parts.push([recovPart, WEIGHTS.recov])
    if (otPart != null) parts.push([otPart, WEIGHTS.ot])
    const wSum = parts.reduce((s, [, w]) => s + w, 0)
    r.score = wSum ? Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / wSum) : 0

    // Grade + lifecycle band derive from the (unchanged) base score.
    r.grade = scoreGrade(r.score)
    r.band = lifecycleBand(r.score)
    r.flags = deriveFlags(r)

    // Optional expanded composite — supplementary only; folds acceptance + price.
    // Never feeds grade/band/rank (keeps base semantics + backward-compat stable).
    const xParts = []
    if (cpkPart != null) xParts.push([cpkPart, EXPANDED_WEIGHTS.cpk])
    if (failPart != null) xParts.push([failPart, EXPANDED_WEIGHTS.fail])
    if (recovPart != null) xParts.push([recovPart, EXPANDED_WEIGHTS.recov])
    if (otPart != null) xParts.push([otPart, EXPANDED_WEIGHTS.ot])
    xParts.push([clamp(r.warrantyAcceptanceRate * 100), EXPANDED_WEIGHTS.acceptance])
    xParts.push([clamp(r.priceCompetitiveness), EXPANDED_WEIGHTS.price])
    const xSum = xParts.reduce((s, [, w]) => s + w, 0)
    r.scoreExpanded = xSum ? Math.round(xParts.reduce((s, [v, w]) => s + v * w, 0) / xSum) : 0
  })

  rows.sort((a, b) => b.score - a.score || b.tyreCount - a.tyreCount)
  rows.forEach((r, i) => { r.rank = i + 1 })

  const bandCount = (name) => rows.filter((r) => r.band?.band === name).length
  const totals = {
    supplierCount: rows.length,
    totalSpend: rows.reduce((s, r) => s + r.totalSpend, 0),
    totalTyres: rows.reduce((s, r) => s + r.tyreCount, 0),
    totalWarrantyClaims: rows.reduce((s, r) => s + r.warrantyClaims, 0),
    totalWarrantyCredit: rows.reduce((s, r) => s + r.warrantyCredit, 0),
    // ── additive totals (existing keys above unchanged) ──
    avgScore: rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0,
    preferredCount: bandCount('preferred'),
    atRiskCount: bandCount('probation') + bandCount('disqualified'),
    flaggedCount: rows.filter((r) => r.flags && r.flags.length > 0).length,
    marketAvgCost,
  }
  return { suppliers: rows, totals }
}

export default computeSupplierScorecard
