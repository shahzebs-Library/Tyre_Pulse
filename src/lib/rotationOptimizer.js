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
    .map((r) => ({ row: r, tread: treadOf(r), serial: serialOf(r), position: positionOf(r) }))
    .filter((t) => t.tread != null)

  const base = {
    asset_no,
    eligible: false,
    reason: null,
    spread: null,
    priority: null,
    recommendations: [],
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

  const result = { asset_no, eligible, reason: null, spread, priority, recommendations: [], stats }

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
  const summary = {
    assetsAnalyzed: analyzed.length,
    assetsNeedingRotation: needing.length,
    highPriority: needing.filter((a) => a.priority === 'high').length,
    mediumPriority: needing.filter((a) => a.priority === 'medium').length,
    avgSpread: analyzed.length
      ? round1(analyzed.reduce((s, a) => s + (a.spread ?? 0), 0) / analyzed.length)
      : null,
  }

  return { assets: analyzed, summary }
}
