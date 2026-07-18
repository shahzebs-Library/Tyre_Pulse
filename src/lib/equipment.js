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

// ── Calibration / service-due lifecycle ──────────────────────────────────────
// The `equipment` table carries exactly one due-date column, `calibration_due`.
// There is NO purchase-cost, purchase-date or warranty-date column, so value /
// depreciation and warranty analytics are intentionally NOT computed here (see
// the module note) rather than fabricated from proxies.

/** Days-until threshold below which a due date counts as "due soon". */
export const SERVICE_DUE_SOON_DAYS = CALIBRATION_WINDOW_DAYS

/**
 * Classify an item's calibration state relative to `now`.
 * Retired items and items with no date are 'none' (nothing to service).
 *   'overdue'  - due date already passed
 *   'due_soon' - due within the next SERVICE_DUE_SOON_DAYS
 *   'ok'       - due further out than the soon window
 *   'none'     - retired, or no calibration date on record
 * @returns {'overdue'|'due_soon'|'ok'|'none'}
 */
export function calibrationState(item, now = Date.now()) {
  if (!item || item.status === 'retired') return 'none'
  const due = toTime(item.calibration_due)
  if (due == null) return 'none'
  if (due < now) return 'overdue'
  if (due <= now + SERVICE_DUE_SOON_DAYS * DAY_MS) return 'due_soon'
  return 'ok'
}

/** Whole days from `now` until an item's calibration date (negative = overdue); null when no date. */
export function daysUntilCalibration(item, now = Date.now()) {
  const due = toTime(item?.calibration_due)
  if (due == null) return null
  return Math.round((due - now) / DAY_MS)
}

// ── Age on record (from created_at) ──────────────────────────────────────────
// The registry has no purchase/commission date, so "age" is measured from when
// the asset was entered on record (`created_at`). It is labelled as such in the
// UI - it is registry tenure, not true in-service age (which the schema lacks).

/** Age bands (in years, on record). Ordered oldest-last for stable chart axes. */
export const AGE_BANDS = ['< 1y', '1 to 3y', '3 to 5y', '5 to 10y', '10y+']

/** Years since an item was entered on record (from created_at); null when unknown. */
export function ageOnRecordYears(item, now = Date.now()) {
  const t = toTime(item?.created_at)
  if (t == null || t > now) return t == null ? null : 0
  return (now - t) / (365.25 * DAY_MS)
}

/** Map a year count to one of AGE_BANDS; null years -> null. */
export function ageBand(years) {
  if (years == null || !Number.isFinite(years)) return null
  if (years < 1) return '< 1y'
  if (years < 3) return '1 to 3y'
  if (years < 5) return '3 to 5y'
  if (years < 10) return '5 to 10y'
  return '10y+'
}

/** Non-empty trimmed string, else a fallback label. */
function labelOr(v, fallback) {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || fallback
}

/**
 * Full analytics rollup over the equipment set. Pure and deterministic.
 * Only aggregates columns that exist on the table (status, equipment_type,
 * site, calibration_due, created_at) - no value/depreciation (no cost column).
 *
 * @returns {{
 *   total:number,
 *   byStatus:{available:number,in_use:number,maintenance:number,retired:number},
 *   byCategory:Array<{label:string,count:number}>,
 *   bySite:Array<{label:string,count:number}>,
 *   calibration:{overdue:number,dueSoon:number,ok:number,none:number,tracked:number},
 *   ageBands:Array<{band:string,count:number}>,
 *   avgAgeYears:(number|null),
 *   datedCount:number,
 *   availability:{operational:number,down:number,retired:number,active:number,availabilityPct:(number|null)},
 *   dataQuality:{missingCategory:number,missingSerial:number,missingSite:number,
 *     missingCalibration:number,overdueCalibration:number,flagged:number},
 *   types:number,
 * }}
 */
export function equipmentAnalytics(rows = [], now = Date.now()) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean)
  const byStatus = { available: 0, in_use: 0, maintenance: 0, retired: 0 }
  const category = new Map()
  const site = new Map()
  const calibration = { overdue: 0, dueSoon: 0, ok: 0, none: 0 }
  const ageCount = new Map(AGE_BANDS.map((b) => [b, 0]))

  let ageSum = 0
  let datedCount = 0
  const dq = {
    missingCategory: 0, missingSerial: 0, missingSite: 0,
    missingCalibration: 0, overdueCalibration: 0,
  }
  const flaggedIds = new Set()
  const flag = (r, key) => { dq[key] += 1; flaggedIds.add(r.id ?? `${category.size}:${key}:${Math.random()}`) }

  for (const r of list) {
    if (byStatus[r.status] != null) byStatus[r.status] += 1

    const cat = labelOr(r.equipment_type, 'Uncategorised')
    category.set(cat, (category.get(cat) || 0) + 1)
    const st = labelOr(r.site, 'Unassigned')
    site.set(st, (site.get(st) || 0) + 1)

    const cs = calibrationState(r, now)
    if (cs === 'overdue') calibration.overdue += 1
    else if (cs === 'due_soon') calibration.dueSoon += 1
    else if (cs === 'ok') calibration.ok += 1
    else calibration.none += 1

    const years = ageOnRecordYears(r, now)
    if (years != null) {
      ageSum += years
      datedCount += 1
      const band = ageBand(years)
      if (band) ageCount.set(band, (ageCount.get(band) || 0) + 1)
    }

    if (!labelOr(r.equipment_type, '')) flag(r, 'missingCategory')
    if (!labelOr(r.serial_no, '')) flag(r, 'missingSerial')
    if (!labelOr(r.site, '')) flag(r, 'missingSite')
    if (r.status !== 'retired' && !toTime(r.calibration_due)) flag(r, 'missingCalibration')
    if (cs === 'overdue') flag(r, 'overdueCalibration')
  }

  const sortDesc = (m) => [...m.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  const active = byStatus.available + byStatus.in_use + byStatus.maintenance
  const operational = byStatus.available + byStatus.in_use

  return {
    total: list.length,
    byStatus,
    byCategory: sortDesc(category),
    bySite: sortDesc(site),
    calibration: { ...calibration, tracked: calibration.overdue + calibration.dueSoon + calibration.ok },
    ageBands: AGE_BANDS.map((band) => ({ band, count: ageCount.get(band) || 0 })),
    avgAgeYears: datedCount ? ageSum / datedCount : null,
    datedCount,
    availability: {
      operational,
      down: byStatus.maintenance,
      retired: byStatus.retired,
      active,
      availabilityPct: active ? (operational / active) * 100 : null,
    },
    dataQuality: { ...dq, flagged: flaggedIds.size },
    types: category.has('Uncategorised') ? category.size - 1 : category.size,
  }
}

/**
 * Build the "Needs attention" work-lists from the equipment set. Pure.
 * Each entry is the original row plus a short ASCII `reason`.
 *
 * @returns {{
 *   overdue:Array<object & {reason:string}>,
 *   dueSoon:Array<object & {reason:string}>,
 *   dataQuality:Array<object & {reason:string}>,
 * }}
 */
export function equipmentAttention(rows = [], now = Date.now()) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean)
  const overdue = []
  const dueSoon = []
  const dataQuality = []

  for (const r of list) {
    const cs = calibrationState(r, now)
    if (cs === 'overdue') {
      const d = daysUntilCalibration(r, now)
      overdue.push({ ...r, reason: `Calibration overdue by ${Math.abs(d)}d` })
    } else if (cs === 'due_soon') {
      const d = daysUntilCalibration(r, now)
      dueSoon.push({ ...r, reason: d === 0 ? 'Calibration due today' : `Calibration due in ${d}d` })
    }

    const issues = []
    if (!labelOr(r.equipment_type, '')) issues.push('no category')
    if (!labelOr(r.serial_no, '')) issues.push('no serial')
    if (!labelOr(r.site, '')) issues.push('no site')
    if (r.status !== 'retired' && !toTime(r.calibration_due)) issues.push('no calibration date')
    if (issues.length) dataQuality.push({ ...r, reason: issues.join(', ') })
  }

  const byDue = (a, b) => (toTime(a.calibration_due) || 0) - (toTime(b.calibration_due) || 0)
  overdue.sort(byDue)
  dueSoon.sort(byDue)
  return { overdue, dueSoon, dataQuality }
}
