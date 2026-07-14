/**
 * Canonical severity / fault / defect / VOR vocabulary — THE single source of
 * truth for "how bad is it" across every module (alerts, inspections, defects,
 * breakdowns, anomalies, notifications, dashboards, TV boards, reports, AI).
 *
 * Before this module the codebase had ~25 divergent severity ladders
 * (Critical/High/Medium/Low vs low/medium/high vs Minor/Major vs numbers vs
 * urgent/normal...). Consumers should import from here instead of re-declaring.
 *
 * Design:
 *  - The operational ladder is CRITICAL > HIGH > MEDIUM > LOW (+ INFO as a
 *    non-actionable floor). `normalizeSeverity` folds every known variant onto
 *    it, so old stored values keep working (backward compatible, non-breaking).
 *  - Accident *damage* severity (Minor / Major / Total Loss) is a distinct
 *    domain axis and stays in accidentVocab.js; `severityFromAccidentDamage`
 *    provides the bridge when a unified rank is needed.
 *  - VOR (Vehicle Off Road) is a first-class operational state: a vehicle that
 *    cannot be safely/legally operated. Helpers classify it honestly from
 *    explicit status/flags — never fabricated.
 */

/* ── Operational severity ladder ────────────────────────────────────────────── */

export const SEVERITY = Object.freeze({
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  INFO: 'Info',
})

/** Actionable levels, worst-first (Info is excluded — it is not actionable). */
export const SEVERITY_LEVELS = [SEVERITY.CRITICAL, SEVERITY.HIGH, SEVERITY.MEDIUM, SEVERITY.LOW]

/** All levels including the informational floor, worst-first. */
export const SEVERITY_LEVELS_ALL = [...SEVERITY_LEVELS, SEVERITY.INFO]

/** Numeric rank — higher = worse. Unknown → 0. Stable across the app. */
export const SEVERITY_RANK = Object.freeze({
  Critical: 4, High: 3, Medium: 2, Low: 1, Info: 0,
})

/** Dropdown options [{ value, label }] for the actionable levels. */
export const SEVERITY_OPTS = SEVERITY_LEVELS.map((s) => ({ value: s, label: s }))

/**
 * Presentation metadata per level. `badge` is a Tailwind class string that works
 * in both themes; `dot`/`hex` are for inline styles / charts.
 */
export const SEVERITY_META = Object.freeze({
  Critical: { rank: 4, hex: '#dc2626', dot: 'bg-red-500',    badge: 'bg-red-500/15 text-red-400 border border-red-500/30' },
  High:     { rank: 3, hex: '#f97316', dot: 'bg-orange-500', badge: 'bg-orange-500/15 text-orange-400 border border-orange-500/30' },
  Medium:   { rank: 2, hex: '#f59e0b', dot: 'bg-amber-500',  badge: 'bg-amber-500/15 text-amber-400 border border-amber-500/30' },
  Low:      { rank: 1, hex: '#16a34a', dot: 'bg-green-500',  badge: 'bg-green-500/15 text-green-400 border border-green-500/30' },
  Info:     { rank: 0, hex: '#3b82f6', dot: 'bg-blue-500',   badge: 'bg-blue-500/15 text-blue-400 border border-blue-500/30' },
})

// Synonym → canonical map. Lowercased keys; covers every variant found in the
// codebase plus common inputs from imports/ERP feeds.
const SYNONYMS = {
  // Critical
  critical: SEVERITY.CRITICAL, crit: SEVERITY.CRITICAL, severe: SEVERITY.CRITICAL,
  blocker: SEVERITY.CRITICAL, emergency: SEVERITY.CRITICAL, fatal: SEVERITY.CRITICAL,
  'total loss': SEVERITY.CRITICAL, 'out of service': SEVERITY.CRITICAL, danger: SEVERITY.CRITICAL,
  // High
  high: SEVERITY.HIGH, major: SEVERITY.HIGH, serious: SEVERITY.HIGH, urgent: SEVERITY.HIGH,
  important: SEVERITY.HIGH, 'major repair': SEVERITY.HIGH, elevated: SEVERITY.HIGH,
  // Medium
  medium: SEVERITY.MEDIUM, moderate: SEVERITY.MEDIUM, warning: SEVERITY.MEDIUM,
  warn: SEVERITY.MEDIUM, normal: SEVERITY.MEDIUM, standard: SEVERITY.MEDIUM, structural: SEVERITY.MEDIUM,
  // Low
  low: SEVERITY.LOW, minor: SEVERITY.LOW, cosmetic: SEVERITY.LOW, trivial: SEVERITY.LOW,
  negligible: SEVERITY.LOW, ok: SEVERITY.LOW,
  // Info
  info: SEVERITY.INFO, informational: SEVERITY.INFO, notice: SEVERITY.INFO, none: SEVERITY.INFO,
}

// Numeric scales: 1..4 (Low..Critical) and 1..5 (Low..Critical). Both supported.
const NUMERIC = {
  1: SEVERITY.LOW, 2: SEVERITY.MEDIUM, 3: SEVERITY.HIGH, 4: SEVERITY.CRITICAL, 5: SEVERITY.CRITICAL,
}

/**
 * Fold any input onto the canonical ladder. Returns `fallback` (default null)
 * for unrecognised input so callers can decide how to treat "unknown".
 * @param {*} value
 * @param {string|null} [fallback]
 * @returns {string|null}
 */
export function normalizeSeverity(value, fallback = null) {
  if (value == null || value === '') return fallback
  if (typeof value === 'number') return NUMERIC[value] ?? fallback
  const raw = String(value).trim()
  if (!raw) return fallback
  // exact canonical (fast path, preserves capitalisation)
  const cap = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
  if (SEVERITY_RANK[cap] != null) return cap
  const key = raw.toLowerCase()
  if (SYNONYMS[key]) return SYNONYMS[key]
  const asNum = Number(raw)
  if (!Number.isNaN(asNum) && NUMERIC[asNum]) return NUMERIC[asNum]
  return fallback
}

/** Numeric rank of any input (higher = worse). Unknown → 0. */
export function severityRank(value) {
  const s = normalizeSeverity(value)
  return s ? SEVERITY_RANK[s] : 0
}

/** Array sort comparator: worst-first. `sortBySeverity(rows, r => r.severity)`. */
export function bySeverityDesc(getter = (x) => x) {
  return (a, b) => severityRank(getter(b)) - severityRank(getter(a))
}

/** True when `a` is at least as severe as `b`. */
export function isAtLeast(a, b) {
  return severityRank(a) >= severityRank(b)
}

/** Tailwind badge class for a severity (normalised first). */
export function severityBadgeClass(value) {
  const s = normalizeSeverity(value, SEVERITY.LOW)
  return SEVERITY_META[s]?.badge ?? SEVERITY_META.Low.badge
}

/** Hex colour for charts. */
export function severityColor(value) {
  const s = normalizeSeverity(value, SEVERITY.LOW)
  return SEVERITY_META[s]?.hex ?? SEVERITY_META.Low.hex
}

/* ── Accident damage bridge ─────────────────────────────────────────────────── */

// Accident damage severity (Minor / Major / Total Loss) → operational rank.
const ACCIDENT_DAMAGE = {
  minor: SEVERITY.LOW,
  major: SEVERITY.HIGH,
  'total loss': SEVERITY.CRITICAL,
}

/** Map an accident damage-severity label to the unified operational ladder. */
export function severityFromAccidentDamage(value, fallback = SEVERITY.MEDIUM) {
  if (value == null || value === '') return fallback
  return ACCIDENT_DAMAGE[String(value).trim().toLowerCase()] ?? normalizeSeverity(value, fallback)
}

/* ── VOR — Vehicle Off Road ─────────────────────────────────────────────────── */

// Status strings (from any module / ERP feed) that mean the asset cannot be
// operated. Lowercased for matching.
const VOR_STATUS_SET = new Set([
  'vor', 'off road', 'off-road', 'offroad', 'vehicle off road', 'grounded',
  'out of service', 'oos', 'down', 'breakdown', 'immobilised', 'immobilized',
  'unroadworthy', 'not roadworthy',
])

/** Canonical VOR labels for pickers. */
export const VOR_STATUS = Object.freeze({ ON_ROAD: 'On Road', OFF_ROAD: 'Off Road' })
export const VOR_OPTS = [
  { value: VOR_STATUS.ON_ROAD, label: 'On Road' },
  { value: VOR_STATUS.OFF_ROAD, label: 'Off Road (VOR)' },
]

/**
 * Decide whether an asset/record represents a Vehicle-Off-Road state, honestly:
 *  - an explicit boolean flag (vor / off_road / is_vor / grounded), OR
 *  - a status/availability string that means out-of-service.
 * Never inferred from severity alone (a critical defect is not automatically a
 * VOR — that is an operational decision), so this stays truthful.
 * @param {object|string|boolean} input
 * @returns {boolean}
 */
export function isVehicleOffRoad(input) {
  if (input == null) return false
  if (typeof input === 'boolean') return input
  if (typeof input === 'string') return VOR_STATUS_SET.has(input.trim().toLowerCase())
  if (typeof input === 'object') {
    if (input.vor === true || input.off_road === true || input.is_vor === true || input.grounded === true) return true
    const candidates = [input.vor_status, input.availability, input.status, input.operational_status, input.vehicle_status]
    return candidates.some((c) => typeof c === 'string' && VOR_STATUS_SET.has(c.trim().toLowerCase()))
  }
  return false
}

/** Normalise any availability/status value to 'On Road' | 'Off Road'. */
export function normalizeVorStatus(value) {
  return isVehicleOffRoad(value) ? VOR_STATUS.OFF_ROAD : VOR_STATUS.ON_ROAD
}
