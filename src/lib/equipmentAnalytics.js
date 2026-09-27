/**
 * equipmentAnalytics - register filtering for the Tool & Equipment Registry
 * (/equipment). The KPI, calibration and age maths already live in
 * `src/lib/equipment.js` (summarizeEquipment / equipmentAnalytics /
 * calibrationState); this module reuses calibrationState so the register's
 * calibration filter and the calibration KPIs can never disagree.
 * Pure, no I/O, `now` injectable.
 */
import { calibrationState } from './equipment'

const lower = (v) => (v == null ? '' : String(v).trim().toLowerCase())
const on = (v) => v != null && v !== '' && v !== 'all'

/**
 * @param {Array<object>} rows
 * @param {{status?,type?,site?,calibration?:'overdue'|'due_soon'|'ok'|'none',search?}} f
 * @param {number} now epoch ms
 */
export function filterEquipment(rows = [], f = {}, now = Date.now()) {
  const q = lower(f.search)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (on(f.status) && r?.status !== f.status) return false
    if (on(f.type) && r?.equipment_type !== f.type) return false
    if (on(f.site) && r?.site !== f.site) return false
    if (on(f.calibration) && calibrationState(r, now) !== f.calibration) return false
    if (q) {
      const hay = [r?.name, r?.serial_no, r?.equipment_type, r?.site, r?.condition].map(lower).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Distinct sorted non-blank values of a key. */
export function distinctValues(rows = [], key) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.[key]).filter(Boolean))].sort()
}
