/**
 * adminHealth - pure composer for the super-admin "TyrePulse Health Score".
 *
 * This engine turns four independent operational signals into a single 0 to 100
 * platform health score that a System Health dashboard renders big at the top:
 *
 *   1. Data freshness      - are the operational streams still receiving data?
 *   2. Error rate          - how many requests / logs are failing?
 *   3. Subsystem reach     - are the database / storage / edge functions up?
 *   4. Anomaly rate        - how many derived anomalies per fleet asset?
 *
 * Design rules (mirrors opsIntelligence.computeFleetHealth + systemHealth):
 *  - PURE and deterministic. No I/O, no Date.now: callers inject an explicit
 *    `now` (ms or Date) wherever a time reference is needed, so results are
 *    reproducible in tests.
 *  - Every input is null-safe. A signal that cannot be computed is EXCLUDED
 *    (never fabricated) and the remaining weights renormalize honestly.
 *  - Sub-scores are all on the same 0 to 100 scale so they compose cleanly and
 *    can be shown side by side. The band vocabulary matches the ops engine's
 *    good / warning / critical language.
 *
 * It intentionally re-uses IDEAS from:
 *  - systemHealth.summarizeResults -> reachabilityScore consumes its
 *    { ok, degraded, down, total } shape.
 *  - opsIntelligence.computeFleetHealth -> penalty / clamp banding style.
 *  - analyticsEngine.computeFleetHealthScore -> rate-to-score decay style.
 * without importing their heavy (I/O bound) logic.
 */

// -- Bands ---------------------------------------------------------------------

/** Score bands shown on the hero tile. Ordered high to low. */
export const HEALTH_BANDS = Object.freeze({
  good: { min: 80, label: 'Healthy', tone: 'green' },
  warning: { min: 50, label: 'Needs attention', tone: 'amber' },
  critical: { min: 0, label: 'Critical', tone: 'red' },
})

/** Resolve a 0 to 100 score into its band object. Non-finite input -> critical. */
export function healthBand(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return HEALTH_BANDS.critical
  if (n >= HEALTH_BANDS.good.min) return HEALTH_BANDS.good
  if (n >= HEALTH_BANDS.warning.min) return HEALTH_BANDS.warning
  return HEALTH_BANDS.critical
}

// -- Staleness budgets ---------------------------------------------------------

/**
 * Per-stream staleness budget (days). A stream fresher than its budget scores
 * 100; it decays to 0 at 3x the budget. Values reflect how often each stream is
 * realistically written by an active fleet.
 */
export const STREAM_STALE_DAYS = Object.freeze({
  tyre_records: 14,
  inspections: 7,
  accidents: 30,
  work_orders: 14,
})

const DAY_MS = 24 * 3600 * 1000

const clamp01to100 = (n) => Math.max(0, Math.min(100, n))
const round1 = (n) => Math.round(n * 10) / 10

/** Coerce a ms/Date/ISO reference into epoch ms, or null when unusable. */
function toMs(v) {
  if (v == null) return null
  if (v instanceof Date) {
    const ms = v.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const ms = new Date(v).getTime()
  return Number.isFinite(ms) ? ms : null
}

// -- Sub-scores (each 0 to 100) ------------------------------------------------

/**
 * Data freshness score from the newest timestamp of each operational stream.
 *
 * @param {Record<string,string|number|Date|null>} latestByStream
 *   e.g. { tyre_records: iso, inspections: iso, accidents: null, work_orders: iso }
 * @param {number|Date} now injected reference time.
 * @returns {number} 0 to 100. Present streams are averaged; null / missing /
 *   unparseable streams are excluded. When NO known stream is present, returns 0
 *   (a platform with zero fresh data is not healthy).
 */
export function freshnessScore(latestByStream, now) {
  const src = latestByStream && typeof latestByStream === 'object' ? latestByStream : {}
  const nowMs = toMs(now)
  const scores = []
  for (const [stream, budgetDays] of Object.entries(STREAM_STALE_DAYS)) {
    if (!(stream in src)) continue
    const latestMs = toMs(src[stream])
    if (latestMs == null || nowMs == null) continue // unknown -> excluded
    const days = Math.max(0, (nowMs - latestMs) / DAY_MS)
    const maxDays = budgetDays * 3
    let s
    if (days <= budgetDays) s = 100
    else if (days >= maxDays) s = 0
    else s = 100 * (1 - (days - budgetDays) / (maxDays - budgetDays))
    scores.push(clamp01to100(s))
  }
  if (!scores.length) return 0 // all null / missing -> honest 0
  return round1(scores.reduce((a, b) => a + b, 0) / scores.length)
}

/**
 * Error-rate score (0 to 100). Supports TWO input shapes, detected by keys:
 *
 *   A) { errors, total }
 *      rate = errors / max(total, 1); 0 errors -> 100, decaying linearly so a
 *      ~20% error rate -> ~0.
 *   B) { unresolvedCritical, unresolvedError }
 *      100 minus a heavy penalty per unresolved item (critical weighs most),
 *      clamped to 0 to 100.
 */
export function errorRateScore(input = {}) {
  const o = input && typeof input === 'object' ? input : {}
  const isBacklog = 'unresolvedCritical' in o || 'unresolvedError' in o
  if (isBacklog) {
    const crit = Number(o.unresolvedCritical) || 0
    const err = Number(o.unresolvedError) || 0
    return round1(clamp01to100(100 - crit * 20 - err * 8))
  }
  const errors = Number(o.errors) || 0
  const totalRaw = Number(o.total)
  const total = Number.isFinite(totalRaw) ? totalRaw : 0
  const rate = Math.max(0, errors) / Math.max(total, 1)
  // 0% -> 100, 20% -> 0 (linear).
  return round1(clamp01to100(100 * (1 - rate / 0.2)))
}

/**
 * Subsystem reachability score from a systemHealth.summarizeResults-style
 * summary: { ok, degraded, down, total }. `down` weighs most (zero credit),
 * `degraded` gives half credit. 100 when all ok, 0 when all down.
 * Returns null when there is nothing to measure (total <= 0).
 */
export function reachabilityScore(summary = {}) {
  const s = summary && typeof summary === 'object' ? summary : {}
  const ok = Number(s.ok) || 0
  const degraded = Number(s.degraded) || 0
  const down = Number(s.down) || 0
  const totalRaw = Number(s.total)
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : ok + degraded + down
  if (!total || total <= 0) return null
  const credit = ok * 1 + degraded * 0.5 + down * 0
  return round1(clamp01to100((credit / total) * 100))
}

/**
 * Anomaly-rate score (0 to 100): fewer derived anomalies per fleet asset scores
 * higher. rate = anomalies / max(assets, 1); score = 100 * (1 - rate), so one
 * anomaly per asset -> 0. Null-safe: a null/undefined anomaly count -> null
 * (unknown, excluded from the composite rather than assumed perfect).
 */
export function anomalyScore({ anomalies = null, assets = null } = {}) {
  const a = Number(anomalies)
  if (anomalies == null || !Number.isFinite(a)) return null
  const assetN = Number(assets)
  const denom = Number.isFinite(assetN) && assetN > 0 ? assetN : 1
  const rate = Math.max(0, a) / denom
  return round1(clamp01to100(100 * (1 - rate)))
}

// -- Composite -----------------------------------------------------------------

/** Default composite weights. errorRate / freshness / reachability dominate. */
export const DEFAULT_HEALTH_WEIGHTS = Object.freeze({
  freshness: 0.3,
  errorRate: 0.3,
  reachability: 0.3,
  anomaly: 0.1,
})

const FACTOR_LABELS = {
  freshness: 'Data freshness',
  errorRate: 'Error rate',
  reachability: 'Subsystem reachability',
  anomaly: 'Anomaly rate',
}

/**
 * Compose the overall TyrePulse Health Score from the four sub-scores.
 *
 * @param {{ freshness, errorRate, reachability, anomaly }} sub  each 0 to 100 or null.
 * @param {object} [weights] override DEFAULT_HEALTH_WEIGHTS (per key).
 * @returns {{ score: number|null, band: object|null, factors: Array }}
 *   Any null sub-score is EXCLUDED and the remaining weights are renormalized so
 *   they still sum to 1. When every sub-score is null, score and band are null
 *   (honest "not enough data"). `factors` always lists all four for display,
 *   with the renormalized effective weight (0 for excluded factors).
 */
export function computeHealthScore(sub = {}, weights = DEFAULT_HEALTH_WEIGHTS) {
  const w = { ...DEFAULT_HEALTH_WEIGHTS, ...(weights || {}) }
  const keys = ['freshness', 'errorRate', 'reachability', 'anomaly']

  // A sub-score counts only when explicitly provided AND finite. Number(null)
  // is 0, so guard against null/undefined before coercing.
  const scoreOf = (key) => {
    const raw = sub?.[key]
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }

  const present = keys
    .map((key) => ({ key, score: scoreOf(key), weight: Number(w[key]) || 0 }))
    .filter((f) => f.score != null && f.weight > 0)

  const totalWeight = present.reduce((acc, f) => acc + f.weight, 0)

  if (!present.length || totalWeight <= 0) {
    return {
      score: null,
      band: null,
      factors: keys.map((key) => {
        const raw = scoreOf(key)
        return {
          key,
          label: FACTOR_LABELS[key],
          score: raw == null ? null : clamp01to100(raw),
          weight: 0,
        }
      }),
    }
  }

  const weighted = present.reduce(
    (acc, f) => acc + clamp01to100(f.score) * (f.weight / totalWeight),
    0,
  )
  const score = round1(clamp01to100(weighted))

  const effWeight = new Map(present.map((f) => [f.key, round1((f.weight / totalWeight) * 100) / 100]))

  const factors = keys.map((key) => {
    const raw = scoreOf(key)
    const has = raw != null && (Number(w[key]) || 0) > 0
    return {
      key,
      label: FACTOR_LABELS[key],
      score: raw == null ? null : clamp01to100(raw),
      weight: has ? effWeight.get(key) : 0,
    }
  })

  return { score, band: healthBand(score), factors }
}
