/**
 * Speed limiters — pure helpers (no I/O) for the Speed Limiter Registry module.
 *
 * Rolls a list of per-asset speed-limiter records up into status counts, a total,
 * a fault count, and the mean governed limit (km/h). Deterministic and free of
 * ambient state (no Date.now(), no globals) so it is fully unit-testable, with
 * the aggregation logic living in exactly one place.
 */

export const SPEED_LIMITER_STATUSES = ['active', 'disabled', 'fault']

export const SPEED_LIMITER_STATUS_META = {
  active: { label: 'Active', tone: 'green' },
  disabled: { label: 'Disabled', tone: 'slate' },
  fault: { label: 'Fault', tone: 'red' },
}

/** Coerce a value to a finite number, or null. */
function toNumber(value) {
  if (value === '' || value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Roll a list of speed limiters up into { total, byStatus, faults, avgLimit }.
 * `byStatus` counts every lifecycle bucket; `faults` mirrors byStatus.fault for
 * convenient KPI access; `avgLimit` is the mean of all present limit_kph values
 * (rounded to one decimal), or null when none exist.
 */
export function summarizeSpeedLimiters(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { active: 0, disabled: 0, fault: 0 }
  let limitSum = 0
  let limitCount = 0

  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    const limit = toNumber(r?.limit_kph)
    if (limit != null) { limitSum += limit; limitCount += 1 }
  }

  return {
    total: list.length,
    byStatus,
    faults: byStatus.fault,
    avgLimit: limitCount ? Math.round((limitSum / limitCount) * 10) / 10 : null,
  }
}
