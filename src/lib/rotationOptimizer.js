/**
 * Rotation Optimizer — pure helpers (no I/O) for the Rotation Optimizer module.
 *
 * Analyses the tyres currently fitted to each vehicle (asset) and recommends
 * rotations/swaps that even out tread wear and so extend overall tyre life.
 *
 * Engineering rationale: steer and drive positions wear materially faster than
 * trailer/spare positions. Left unmanaged this produces a wide tread spread
 * across an axle set — the most-worn tyre scraps early while fresher tyres are
 * under-utilised. Relocating the most-worn tyre to a lower-wear position (and
 * placing fresher tread on the high-wear position) equalises wear and pushes out
 * the fleet replacement curve, lowering cost-per-kilometre.
 *
 * These functions are deterministic and unit-tested; the page and service
 * consume them so the rotation logic lives in exactly one place.
 */

// Default thresholds in MILLIMETRES of tread spread (max - min across positions).
export const DEFAULT_ROTATION_OPTS = {
  threshold: 3, // recommend a rotation once spread exceeds this
  highPriorityThreshold: 5, // spread at/above this is high priority
}

// Position wear classes. Steer/drive carry more of the load and wear fastest.
const HIGH_WEAR_KEYS = ['steer', 'drive', 'front']
const LOW_WEAR_KEYS = ['trailer', 'spare', 'tag', 'lift']

// ── Rotation engineering constants (ported verbatim from tyre_saas) ──────────
export const DELTA_WORTH_ROTATING_MM = 1.5 // min tread gain for a swap to be worth it
export const LEGAL_MIN_TREAD_MM = 1.6 // GCC legal minimum tread depth
export const BENEFIT_KM_PER_MM = 10000 // expected km recovered per mm of tread evened out
export const IMPACT_STEER_BONUS = 15 // swap impact bonus when moving a steer-position tyre
export const IMPACT_DEST_BONUS = 5 // swap impact bonus when destination is trailer/tag/pusher
export const IMPACT_DELTA_WEIGHT = 10 // impact contribution per mm of delta
export const IMPACT_MAX = 100
export const MAX_WORN_CANDIDATES = 6 // consider at most the 6 most-worn tyres for swaps
export const MAX_SWAPS = 8 // surface at most 8 swaps per asset
export const STEER_IMBALANCE_MM = 2.0 // heuristic steer-axle mismatch threshold (position-string only)

// Position keywords used for swap-impact scoring (distinct from wear classes).
const STEER_KEYS = ['steer', 'front']
const DEST_BONUS_KEYS = ['trailer', 'tag', 'pusher']

const lc = (s) => String(s == null ? '' : s).toLowerCase()
const isSteerPos = (pos) => STEER_KEYS.some((k) => lc(pos).includes(k))
const isDestBonusPos = (pos) => DEST_BONUS_KEYS.some((k) => lc(pos).includes(k))

/** Normalise a size string for equality (upper + trim); '' when unknown. */
export const normSize = (s) => (s == null ? '' : String(s).trim().toUpperCase())

/** Tyre `size` accessor (single column in this dataset), or null. */
export const sizeOf = (r) => (r?.size == null || r.size === '' ? null : r.size)

/** Best-effort serial accessor across the several column aliases in the data. */
export const serialOf = (r) =>
  r?.serial_no || r?.serial_number || r?.tyre_serial || null

/** Best-effort position accessor. */
export const positionOf = (r) => r?.position || r?.tyre_position || null

/** Numeric tread depth or null when unreadable. */
export function treadOf(r) {
  const raw = r?.tread_depth
  if (raw == null || raw === '') return null
  const v = Number(raw)
  return Number.isFinite(v) ? v : null
}

/**
 * Classify a position string into a wear category: 'high' (steer/drive/front),
 * 'low' (trailer/spare/tag/lift) or 'other' (unknown / rear / generic).
 */
export function wearClass(position) {
  if (!position) return 'other'
  const p = String(position).toLowerCase()
  if (HIGH_WEAR_KEYS.some((k) => p.includes(k))) return 'high'
  if (LOW_WEAR_KEYS.some((k) => p.includes(k))) return 'low'
  return 'other'
}

const round1 = (n) => Math.round(n * 10) / 10
const labelSerial = (s) => s || 'unknown serial'
const labelPos = (p) => p || 'unknown position'
const km = (n) => Number(n).toLocaleString()

// ── Deepened rotation engine (pure, ported from tyre_saas) ───────────────────

/**
 * Per-asset wear-balance score (0–100). Over the asset's in-service tread
 * values: mean, population std-dev, CV = std/mean*100, score = max(0, round(100
 * − CV*2)). 100 = perfectly even wear across the axle set.
 * @param {number[]} treads
 * @returns {number|null} null when fewer than 2 readings or mean ≤ 0.
 */
export function wearBalanceScore(treads) {
  const vals = (Array.isArray(treads) ? treads : []).map(Number).filter(Number.isFinite)
  if (vals.length < 2) return null
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  if (mean <= 0) return null
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length // population
  const cv = (Math.sqrt(variance) / mean) * 100
  return Math.max(0, Math.round(100 - cv * 2))
}

/**
 * Generate the worthwhile tyre swaps for one asset's fitted tyres.
 * worn = tyres asc by tread; fresh = desc. For up to the 6 most-worn tyres,
 * pair with the first fresh partner whose tread is ≥ 1.5mm greater; each tyre is
 * used at most once, and a swap is skipped when both sizes are known and differ.
 * Sorted by impact desc, capped at 8.
 * @param {{tread:number, serial:string|null, position:string|null, size:string|null}[]} tyres
 */
export function generateSwaps(tyres) {
  const list = (Array.isArray(tyres) ? tyres : [])
    .filter((t) => t && Number.isFinite(Number(t.tread)))
    .map((t, i) => ({ ...t, tread: Number(t.tread), _idx: i }))
  if (list.length < 2) return []

  const byTie = (a, b) => labelSerial(a.serial).localeCompare(labelSerial(b.serial))
  const worn = [...list].sort((a, b) => a.tread - b.tread || byTie(a, b))
  const fresh = [...list].sort((a, b) => b.tread - a.tread || byTie(a, b))

  const used = new Set()
  const swaps = []
  for (const w of worn.slice(0, MAX_WORN_CANDIDATES)) {
    if (used.has(w._idx)) continue
    for (const f of fresh) {
      if (f._idx === w._idx || used.has(f._idx)) continue
      const delta = round1(f.tread - w.tread)
      if (delta < DELTA_WORTH_ROTATING_MM) break // fresh is desc → no better partner remains
      const ws = normSize(w.size)
      const fs = normSize(f.size)
      if (ws && fs && ws !== fs) continue // size guard: never swap across different sizes
      const impact = Math.min(
        IMPACT_MAX,
        Math.round(delta * IMPACT_DELTA_WEIGHT) +
          (isSteerPos(w.position) ? IMPACT_STEER_BONUS : 0) +
          (isDestBonusPos(f.position) ? IMPACT_DEST_BONUS : 0),
      )
      const benefit = Math.round(delta * BENEFIT_KM_PER_MM)
      swaps.push({
        from_position: w.position || null,
        to_position: f.position || null,
        tyre: w.serial || null,
        from_tread_mm: round1(w.tread),
        to_tread_mm: round1(f.tread),
        tread_delta_mm: delta,
        impact_score: impact,
        expected_benefit_km: benefit,
        reason:
          `Relocate ${labelSerial(w.serial)} (${round1(w.tread)}mm) from ${labelPos(w.position)} to ` +
          `${labelPos(f.position)} (${round1(f.tread)}mm) — evens a ${delta}mm tread gap (~${km(benefit)} km recovered).`,
      })
      used.add(w._idx)
      used.add(f._idx)
      break
    }
  }
  swaps.sort((a, b) => b.impact_score - a.impact_score)
  return swaps.slice(0, MAX_SWAPS)
}

/**
 * Compliance / safety violations derivable honestly from this dataset.
 * • below_legal_minimum (critical): any tyre with tread < 1.6mm.
 * • steer_imbalance (critical, HEURISTIC): 2+ steer-labelled tyres whose tread
 *   differs by > 2mm. Flagged heuristic because axle/side data does not exist —
 *   the steer role is inferred from the free-text position string only.
 * (Retread-on-steer is intentionally omitted: no retread flag exists to derive it.)
 * @param {{tread:number, serial:string|null, position:string|null}[]} tyres
 */
export function detectViolations(tyres) {
  const list = (Array.isArray(tyres) ? tyres : []).filter((t) => t && Number.isFinite(Number(t.tread)))
  const out = []
  for (const t of list) {
    const tread = Number(t.tread)
    if (tread < LEGAL_MIN_TREAD_MM) {
      out.push({
        type: 'below_legal_minimum',
        severity: 'critical',
        tyre: t.serial || null,
        position: t.position || null,
        tread_mm: round1(tread),
        heuristic: false,
        message: `Tyre ${labelSerial(t.serial)} at ${labelPos(t.position)} is ${round1(tread)}mm — below the ${LEGAL_MIN_TREAD_MM}mm legal minimum.`,
      })
    }
  }
  const steer = list.filter((t) => isSteerPos(t.position)).map((t) => Number(t.tread))
  if (steer.length >= 2) {
    const gap = round1(Math.max(...steer) - Math.min(...steer))
    if (gap > STEER_IMBALANCE_MM) {
      out.push({
        type: 'steer_imbalance',
        severity: 'critical',
        heuristic: true,
        gap_mm: gap,
        message: `Steer-labelled tyres differ by ${gap}mm (heuristic — axle role inferred from position text; no axle/side data). Steer tyres should be closely matched.`,
      })
    }
  }
  return out
}

/**
 * Overall per-asset status from wear-balance score + violations.
 * 'critical' if any critical violation; else 'warning' if score < 50;
 * 'advisory' if score < 75; else 'good'.
 */
export function overallStatus(score, violations) {
  if ((violations || []).some((v) => v.severity === 'critical')) return 'critical'
  if (score != null && score < 50) return 'warning'
  if (score != null && score < 75) return 'advisory'
  return 'good'
}

/**
 * Fleet-ranking urgency from tread spread (max−min): 'critical' when > highPriorityThreshold,
 * 'warning' when > threshold, else 'advisory'.
 */
export function spreadUrgency(spread, opts = {}) {
  const { threshold, highPriorityThreshold } = { ...DEFAULT_ROTATION_OPTS, ...(opts || {}) }
  if (spread == null) return 'advisory'
  if (spread > highPriorityThreshold) return 'critical'
  if (spread > threshold) return 'warning'
  return 'advisory'
}

/**
 * Deterministic (no-LLM) narrative composed from violation count + top swap.
 */
export function buildNarrative(violations, swaps) {
  const vcount = (violations || []).length
  const top = (swaps || [])[0]
  if (!vcount && !top) return 'Fleet asset is well balanced; no rotation needed.'
  let s = ''
  if (vcount) s += `${vcount} compliance issue(s) detected. `
  if (top) {
    s +=
      `Top action: move ${labelSerial(top.tyre)} from ${labelPos(top.from_position)} to ` +
      `${labelPos(top.to_position)} for a ${top.tread_delta_mm}mm gain (~${km(top.expected_benefit_km)} km).`
  }
  return s.trim()
}

/**
 * Analyse a single asset's fitted tyres and produce rotation recommendations.
 *
 * @param {Array<object>} tyresOnAsset  rows for ONE asset (in-service tyres)
 * @param {object} [opts]  { threshold, highPriorityThreshold }
 * @returns {{
 *   asset_no: string|null,
 *   eligible: boolean,
 *   reason: string|null,
 *   spread: number|null,
 *   priority: 'high'|'medium'|null,
 *   recommendations: string[],
 *   stats: object
 * }}
 */
export function analyzeAsset(tyresOnAsset, opts = {}) {
  const { threshold, highPriorityThreshold } = { ...DEFAULT_ROTATION_OPTS, ...(opts || {}) }
  const rows = Array.isArray(tyresOnAsset) ? tyresOnAsset : []
  const asset_no = rows.find((r) => r?.asset_no != null)?.asset_no ?? null

  // Only tyres with a usable tread reading participate.
  const measured = rows
    .map((r) => ({ row: r, tread: treadOf(r), serial: serialOf(r), position: positionOf(r), size: sizeOf(r) }))
    .filter((t) => t.tread != null)

  // Deepened signals — independent of the spread-eligibility gate so they are
  // present in every return path (swaps need ≥2 readings; violations do not).
  const wbScore = wearBalanceScore(measured.map((t) => t.tread))
  const swaps = generateSwaps(measured)
  const violations = detectViolations(measured)
  const status = overallStatus(wbScore, violations)
  const narrative = buildNarrative(violations, swaps)

  const base = {
    asset_no,
    eligible: false,
    reason: null,
    spread: null,
    priority: null,
    recommendations: [],
    wearBalanceScore: wbScore,
    overallStatus: status,
    urgency: spreadUrgency(null, opts),
    swaps,
    violations,
    narrative,
    stats: {
      count: measured.length,
      min: null,
      max: null,
      avg: null,
      spread: null,
    },
  }

  if (measured.length < 2) {
    base.reason = 'Fewer than two fitted tyres have tread readings.'
    return base
  }

  const treads = measured.map((t) => t.tread)
  const min = Math.min(...treads)
  const max = Math.max(...treads)
  const avg = round1(treads.reduce((a, b) => a + b, 0) / treads.length)
  const spread = round1(max - min)

  // Deterministic extremes: lowest tread (ties → lexicographic serial), highest.
  const byTread = [...measured].sort(
    (a, b) => a.tread - b.tread || labelSerial(a.serial).localeCompare(labelSerial(b.serial)),
  )
  const worn = byTread[0]
  const fresh = byTread[byTread.length - 1]

  const stats = {
    count: measured.length,
    min,
    max,
    avg,
    spread,
    minSerial: worn.serial,
    maxSerial: fresh.serial,
    minPosition: worn.position,
    maxPosition: fresh.position,
    highWearPositions: measured.filter((t) => wearClass(t.position) === 'high').length,
    lowWearPositions: measured.filter((t) => wearClass(t.position) === 'low').length,
  }

  const eligible = spread > threshold
  const priority = spread >= highPriorityThreshold ? 'high' : spread >= threshold ? 'medium' : null

  const result = {
    asset_no,
    eligible,
    reason: null,
    spread,
    priority,
    recommendations: [],
    wearBalanceScore: wbScore,
    overallStatus: status,
    urgency: spreadUrgency(spread, opts),
    swaps,
    violations,
    narrative,
    stats,
  }

  if (!eligible) {
    result.reason = `Tread spread ${spread}mm is within the ${threshold}mm balance threshold — wear is even.`
    result.priority = null
    return result
  }

  // Primary swap: relocate the most-worn tyre to the freshest tyre's position and
  // vice-versa. Tailor the wording to the positions' wear classes.
  const wornClass = wearClass(worn.position)
  const freshClass = wearClass(fresh.position)
  const recs = []

  recs.push(
    `Swap tyre ${labelSerial(worn.serial)} (${round1(worn.tread)}mm, most worn) at ${labelPos(worn.position)} ` +
      `with tyre ${labelSerial(fresh.serial)} (${round1(fresh.tread)}mm, freshest) at ${labelPos(fresh.position)} — ` +
      `evens out a ${spread}mm tread spread across the axle set.`,
  )

  if (wornClass === 'high' && (freshClass === 'low' || freshClass === 'other')) {
    recs.push(
      `Move the most-worn tyre ${labelSerial(worn.serial)} off the high-wear ${labelPos(worn.position)} position ` +
        `to a lower-wear position (e.g. ${labelPos(fresh.position)}) to preserve its remaining ${round1(worn.tread)}mm of tread.`,
    )
  }
  if (freshClass === 'low' || (freshClass === 'other' && wornClass !== 'other')) {
    recs.push(
      `Place fresher tyre ${labelSerial(fresh.serial)} (${round1(fresh.tread)}mm) onto the higher-wear ${labelPos(worn.position)} position ` +
        `so its tread is consumed where wear is fastest.`,
    )
  }

  result.recommendations = recs
  return result
}

/**
 * Group a flat list of in-service tyre rows by asset_no and analyse each asset.
 *
 * @param {Array<object>} tyres  in-service tyre rows (removal_date IS NULL)
 * @param {object} [opts]
 * @returns {{ assets: Array<object>, summary: object }}
 */
export function optimizeFleet(tyres, opts = {}) {
  const rows = Array.isArray(tyres) ? tyres : []
  const groups = new Map()
  for (const r of rows) {
    const key = r?.asset_no
    if (key == null || key === '') continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  const analyzed = []
  for (const [, group] of groups) {
    const a = analyzeAsset(group, opts)
    // Only assets with >=2 fitted tyres that have tread readings are meaningful.
    if (a.stats.count >= 2) analyzed.push(a)
  }

  // Most-imbalanced assets first; needing-rotation before balanced.
  analyzed.sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0))

  const needing = analyzed.filter((a) => a.eligible)
  const wbScores = analyzed.map((a) => a.wearBalanceScore).filter((s) => s != null)
  const summary = {
    assetsAnalyzed: analyzed.length,
    assetsNeedingRotation: needing.length,
    highPriority: needing.filter((a) => a.priority === 'high').length,
    mediumPriority: needing.filter((a) => a.priority === 'medium').length,
    criticalAssets: analyzed.filter((a) => a.overallStatus === 'critical').length,
    totalSwaps: analyzed.reduce((s, a) => s + (a.swaps?.length || 0), 0),
    totalViolations: analyzed.reduce((s, a) => s + (a.violations?.length || 0), 0),
    avgWearBalance: wbScores.length
      ? Math.round(wbScores.reduce((s, v) => s + v, 0) / wbScores.length)
      : null,
    avgSpread: analyzed.length
      ? round1(analyzed.reduce((s, a) => s + (a.spread ?? 0), 0) / analyzed.length)
      : null,
  }

  return { assets: analyzed, summary }
}
