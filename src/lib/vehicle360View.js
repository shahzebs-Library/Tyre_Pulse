/**
 * Vehicle 360 view model - pure, I/O-free shapers for the redesigned page.
 *
 * Everything here reads rows the page has ALREADY loaded through the existing
 * services (getVehicle, getVehicleTyres, loadAssetHistory) and reuses the
 * existing roll-ups in vehicle360Analytics.js. It adds presentation shapes
 * only, never a second calculation of a KPI that already has a home.
 *
 * Honesty rules (tested): money is per currency and never added across
 * currencies; a value with no source is null (rendered N/A with a reason);
 * a fitted tyre with no risk level is "not rated", never "normal"; a vehicle
 * with no tyres is not "healthy".
 */
import { isCurrentlyFitted, canonicalToSlotId } from './tyreBay'
import { resolveLayoutKey, isTyrelessEquipment, LAYOUT_SLOTS } from './vehicleTyreLayout'
import { num, isoDay, tyreCost } from './vehicle360Analytics'
import { isOpenWoStatus } from './workOrderStatus'

export const TAB_KEYS = Object.freeze([
  'overview', 'layout', 'tyres', 'inspections', 'maintenance', 'costs', 'history', 'documents', 'compliance',
])
export const MORE_KEYS = Object.freeze(['location', 'health', 'ai'])

/** Tab key from the URL, falling back to overview for anything unknown. */
export function normalizeTab(v) {
  const k = String(v || '').toLowerCase()
  return TAB_KEYS.includes(k) || MORE_KEYS.includes(k) ? k : 'overview'
}

/** normal | warning | critical | unrated, from tyre_records.risk_level. */
export function riskBand(level) {
  const s = String(level ?? '').trim().toLowerCase()
  if (s === 'high' || s === 'critical') return 'critical'
  if (s === 'medium' || s === 'moderate' || s === 'warning') return 'warning'
  if (s === 'low' || s === 'good' || s === 'normal') return 'normal'
  return 'unrated'
}

/** Rows that are on the vehicle now (no removal signal). */
export function fittedTyres(tyres = []) {
  return (tyres || []).filter((t) => t && !t.removal_date && isCurrentlyFitted(t))
}

/** Mean of a numeric field over the fitted tyres that carry it (> 0), else null. */
export function averageField(rows = [], field) {
  const vals = (rows || []).map((r) => num(r?.[field])).filter((v) => v != null && v > 0)
  return vals.length ? { value: vals.reduce((a, b) => a + b, 0) / vals.length, sample: vals.length } : null
}

/**
 * Tyre layout status for the legend: how many wheel slots are normal, warning,
 * critical, fitted-but-unrated and empty. `slots` is null (not 0) when the
 * layout is unknown or the equipment carries no tyres.
 */
export function layoutStatus(vehicleType, tyres = [], assetNo) {
  if (isTyrelessEquipment(vehicleType)) {
    return { tyreless: true, slots: null, normal: 0, warning: 0, critical: 0, unrated: 0, notFitted: null, unmapped: 0 }
  }
  const key = resolveLayoutKey(vehicleType, assetNo)
  const slots = LAYOUT_SLOTS[key] || []
  const bySlot = new Map()
  let unmapped = 0
  for (const t of fittedTyres(tyres)) {
    const slot = canonicalToSlotId(vehicleType, t.position)
    if (!slot || !slots.includes(slot)) { unmapped += 1; continue }
    // newest fitted tyre at the slot wins
    const prev = bySlot.get(slot)
    if (!prev || String(t.issue_date || '') > String(prev.issue_date || '')) bySlot.set(slot, t)
  }
  const out = { tyreless: false, slots: slots.length, normal: 0, warning: 0, critical: 0, unrated: 0, notFitted: 0, unmapped }
  for (const t of bySlot.values()) out[riskBand(t.risk_level)] += 1
  out.notFitted = Math.max(0, slots.length - bySlot.size)
  return out
}

/** Slot-id keyed positions for VehicleTyreDiagram, from the current tyres. */
export function diagramPositions(vehicleType, tyres = []) {
  const out = []
  for (const t of fittedTyres(tyres)) {
    const slot = canonicalToSlotId(vehicleType, t.position)
    if (slot) out.push({ position: slot, risk_level: t.risk_level })
  }
  return out
}

const yearOf = (r) => isoDay(r?.event_date || r?.txn_date).slice(0, 4)
const currencyOf = (r) => String(r?.currency || '').trim().toUpperCase() || 'Unknown'

export const COST_PERIODS = Object.freeze([
  { key: 'year', label: 'This year' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'all', label: 'All time' },
])

function inPeriod(row, period, now) {
  if (period === 'all') return true
  const d = isoDay(row?.event_date || row?.txn_date)
  if (!d) return false
  const n = new Date(typeof now === 'number' ? now : Date.parse(now))
  if (period === 'year') return d.slice(0, 4) === String(n.getUTCFullYear())
  const from = new Date(Date.UTC(n.getUTCFullYear() - 1, n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10)
  return d >= from && d <= n.toISOString().slice(0, 10)
}

/**
 * Expense-grid cost split for the period, one entry per currency:
 *  tyre / spare / oil as classified by the grid, `other` = the part of the
 *  line total the three buckets do not explain (never negative).
 */
export function costSplit(partsLines = [], { period = 'year', now = Date.now() } = {}) {
  const map = new Map()
  for (const r of partsLines || []) {
    if (!inPeriod(r, period, now)) continue
    const cur = currencyOf(r)
    const e = map.get(cur) || { currency: cur, tyre: 0, spare: 0, oil: 0, other: 0, total: 0, lines: 0 }
    const tyre = num(r.tyre_cost) || 0
    const spare = num(r.spare_cost) || 0
    const oil = num(r.oil_cost) || 0
    const line = num(r.line_cost) || 0
    e.tyre += tyre; e.spare += spare; e.oil += oil
    e.other += Math.max(0, line - tyre - spare - oil)
    e.total += line
    e.lines += 1
    map.set(cur, e)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

/** Tyre spend this calendar year per currency (grid tyre bucket). */
export function tyreSpendYtd(partsLines = [], now = Date.now()) {
  return costSplit(partsLines, { period: 'year', now }).map((e) => ({ currency: e.currency, amount: e.tyre }))
}

/** Mean price of tyres that carry a price (unpriced is excluded, not free). */
export function costPerTyre(tyres = []) {
  const costs = (tyres || []).map(tyreCost).filter((c) => c != null)
  return costs.length ? { value: costs.reduce((a, b) => a + b, 0) / costs.length, sample: costs.length } : null
}

/** Tyres whose category says retread (same test as kpiEngine.computeRetreadPerformance). */
export function retreadCount(tyres = []) {
  return (tyres || []).filter((t) => /retread/i.test(String(t?.category ?? ''))).length
}

/** Open job cards, newest first. */
export function openWorkOrders(jobCards = []) {
  return (jobCards || [])
    .filter((w) => isOpenWoStatus(w.status))
    .sort((a, b) => String(isoDay(b.opened_at)).localeCompare(String(isoDay(a.opened_at))))
}

/** Most recent inspection row, or null. */
export function latestInspection(inspections = []) {
  let best = null
  let bestDay = ''
  for (const r of inspections || []) {
    const d = isoDay(r.inspection_date || r.completed_date)
    if (d && d >= bestDay) { best = r; bestDay = d }
  }
  return best ? { ...best, day: bestDay } : null
}

/** Whole days between an ISO day and now; "Today" / "Yesterday" / "N days ago". */
export function relativeDay(day, now = Date.now()) {
  const d = isoDay(day)
  if (!d) return 'N/A'
  const diff = Math.floor((Date.parse(`${isoDay(new Date(now).toISOString())}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000)
  if (diff <= 0) return diff === 0 ? 'Today' : d
  if (diff === 1) return 'Yesterday'
  if (diff < 31) return `${diff} days ago`
  return d
}

/** Newest-first activity feed for the timeline card. */
export function recentActivity(rows = [], limit = 6) {
  return [...(rows || [])]
    .filter((r) => r.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, limit)
}

/**
 * Compliance lines from the fleet register's document dates. Each line states
 * its own status; a missing date is "Not recorded", never "valid".
 */
export function complianceLines(fleet, now = Date.now()) {
  const today = isoDay(new Date(now).toISOString())
  const defs = [
    ['Insurance expiry', ['insurance_expiry']],
    ['MVPI (inspection) expiry', ['mvip_expiry', 'mvpi_expiry']],
    ['Operating card expiry', ['operating_card_expiry']],
    ['Driver licence expiry', ['driver_licence_expiry']],
  ]
  return defs.map(([label, keys]) => {
    const raw = keys.map((k) => fleet?.[k]).find((v) => v)
    const day = isoDay(raw)
    if (!day) return { label, day: null, status: 'unknown' }
    const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
    return { label, day, days, status: days < 0 ? 'expired' : days <= 30 ? 'due-soon' : 'valid' }
  })
}
