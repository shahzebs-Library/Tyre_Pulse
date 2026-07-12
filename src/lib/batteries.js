/**
 * Batteries — pure helpers (no I/O) for the Battery Lifecycle module.
 *
 * Derives a battery's warranty expiry from its install date + warranty term,
 * flags records that need attention (weak/replace status or low health), and
 * rolls a list of records up into counts + average health.
 *
 * Functions are deterministic and take no ambient state (Date.now() is never
 * read here) so they are fully unit-testable.
 */

// A battery needs attention below this state-of-health percentage.
export const HEALTH_ATTENTION_PCT = 50

export const BATTERY_STATUSES = ['healthy', 'weak', 'replace', 'retired']

export const BATTERY_STATUS_META = {
  healthy: { label: 'Healthy', tone: 'green' },
  weak: { label: 'Weak', tone: 'amber' },
  replace: { label: 'Replace', tone: 'red' },
  retired: { label: 'Retired', tone: 'slate' },
}

/** Parse a date-ish value to a Date, or null when unusable. */
function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Coerce a value to a finite number, or null. */
function toNumber(value) {
  if (value === '' || value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * The battery's warranty expiry date: install_date advanced by warranty_months.
 * Returns a Date, or null when either input is missing/unusable. Month arithmetic
 * is calendar-correct (clamps to end-of-month on overflow, e.g. Jan 31 + 1mo).
 */
export function warrantyExpiry(battery) {
  const start = toDate(battery?.install_date)
  const months = toNumber(battery?.warranty_months)
  if (!start || months == null) return null
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  const day = d.getUTCDate()
  d.setUTCMonth(d.getUTCMonth() + Math.trunc(months))
  // Guard against month overflow (e.g. Jan 31 + 1mo -> Mar 3): clamp to last day.
  if (d.getUTCDate() < day) d.setUTCDate(0)
  return d
}

/**
 * True when a battery warrants operator attention: its status is 'weak' or
 * 'replace', or its state-of-health has fallen below HEALTH_ATTENTION_PCT.
 * A 'retired' battery is out of service and never flagged.
 */
export function batteryNeedsAttention(battery) {
  if (!battery || battery.status === 'retired') return false
  if (battery.status === 'weak' || battery.status === 'replace') return true
  const health = toNumber(battery.health_pct)
  return health != null && health < HEALTH_ATTENTION_PCT
}

/**
 * Roll a list of batteries up into { total, byStatus, needingAttention,
 * avgHealth }. `byStatus` counts every lifecycle bucket; `needingAttention`
 * counts rows flagged by batteryNeedsAttention; `avgHealth` is the mean of all
 * present health_pct values (rounded to one decimal), or null when none exist.
 */
export function summarizeBatteries(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { healthy: 0, weak: 0, replace: 0, retired: 0 }
  let needingAttention = 0
  let healthSum = 0
  let healthCount = 0

  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    if (batteryNeedsAttention(r)) needingAttention += 1
    const health = toNumber(r?.health_pct)
    if (health != null) { healthSum += health; healthCount += 1 }
  }

  return {
    total: list.length,
    byStatus,
    needingAttention,
    avgHealth: healthCount ? Math.round((healthSum / healthCount) * 10) / 10 : null,
  }
}
