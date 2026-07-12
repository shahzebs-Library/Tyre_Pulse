/**
 * Pure, dependency-free helpers for the Tool & Equipment Registry.
 *
 * No Supabase, no React, no clock of their own — every function that needs
 * "now" takes it as an argument, so results are fully deterministic and
 * unit-testable. The page/service layers wire these to live data.
 */

export const EQUIPMENT_STATUSES = ['available', 'in_use', 'maintenance', 'retired']

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000

/** Calibration is considered "due" when it falls due within the next 30 days. */
export const CALIBRATION_WINDOW_DAYS = 30

/** Parse a date-ish value to epoch ms, or null if unusable. */
function toTime(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * True when an item's calibration is due — i.e. its `calibration_due` date is
 * on or before `now + CALIBRATION_WINDOW_DAYS` (includes already-overdue items).
 * Retired equipment is never flagged. Items without a date are not due.
 *
 * @param {object} item  equipment row (uses `calibration_due`, `status`)
 * @param {number} now   reference epoch ms
 * @returns {boolean}
 */
export function calibrationDue(item, now = Date.now()) {
  if (!item || item.status === 'retired') return false
  const due = toTime(item.calibration_due)
  if (due == null) return false
  const threshold = now + CALIBRATION_WINDOW_DAYS * DAY_MS
  return due <= threshold
}

/**
 * Aggregate a set of equipment rows into registry KPIs.
 *
 * @param {object[]} rows  equipment records
 * @param {number}   now   reference epoch ms
 * @returns {{
 *   total: number,
 *   available: number,
 *   in_use: number,
 *   maintenance: number,
 *   retired: number,
 *   calibrationDue: number,
 *   types: number,
 * }}
 */
export function summarizeEquipment(rows = [], now = Date.now()) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { available: 0, in_use: 0, maintenance: 0, retired: 0 }
  const typeSet = new Set()
  let calibrationDueCount = 0

  for (const r of list) {
    if (!r) continue
    if (byStatus[r.status] != null) byStatus[r.status] += 1
    const type = typeof r.equipment_type === 'string' ? r.equipment_type.trim() : ''
    if (type) typeSet.add(type.toLowerCase())
    if (calibrationDue(r, now)) calibrationDueCount += 1
  }

  return {
    total: list.length,
    ...byStatus,
    calibrationDue: calibrationDueCount,
    types: typeSet.size,
  }
}
