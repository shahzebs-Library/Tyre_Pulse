/**
 * Vehicle 360 analytics - pure, I/O-free roll-ups for ONE vehicle.
 *
 * The page (`src/pages/Vehicle360.jsx`) loads every per-asset source through
 * the existing `loadAssetHistory` service (country-scoped, paged, each source
 * settled on its own) plus the insurance schedule lines, and hands the raw rows
 * here. Everything is deterministic: the clock is injected as `now`.
 *
 * Honesty rules held here, and tested:
 *  - Money is NEVER summed across currencies. The expense grid carries a
 *    currency on every line; totals are returned per currency.
 *  - A value that cannot be derived is null (rendered N/A), never 0.
 *  - A source that could not be read is reported as unreadable by the page,
 *    not as an empty list - this module only ever sees rows that were read.
 */
import { isOpenWoStatus, isClosedWoStatus } from './workOrderStatus'
import { isIncidentClosed, canonSeverity } from './accidentVocab'

const DAY_MS = 86400000

export function num(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** 'YYYY-MM-DD' from a date-ish value, or '' when unreadable. */
export function isoDay(v) {
  if (!v) return ''
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export function daysBetween(fromDay, now) {
  const d = isoDay(fromDay)
  if (!d) return null
  const t = Date.parse(`${d}T00:00:00Z`)
  const n = typeof now === 'number' ? now : Date.parse(now)
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null
  return Math.max(0, Math.floor((n - t) / DAY_MS))
}

const currencyOf = (r) => String(r?.currency || '').trim().toUpperCase() || 'Unknown'

/**
 * Expense-grid cost for this vehicle, one entry per currency. The grid is the
 * authoritative cost source (the tyre bucket is the classified tyre spend);
 * `total` is line_cost, which already contains tyre + spare + oil.
 */
export function costByCurrency(partsLines = []) {
  const map = new Map()
  for (const r of partsLines || []) {
    const cur = currencyOf(r)
    const e = map.get(cur) || { currency: cur, tyre: 0, spare: 0, oil: 0, total: 0, lines: 0 }
    e.tyre += num(r.tyre_cost) || 0
    e.spare += num(r.spare_cost) || 0
    e.oil += num(r.oil_cost) || 0
    e.total += num(r.line_cost) || 0
    e.lines += 1
    map.set(cur, e)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

/** Month keys 'YYYY-MM' for the `months` months ending at `now`. */
export function monthKeys(now, months = 12) {
  const n = new Date(typeof now === 'number' ? now : Date.parse(now))
  if (Number.isNaN(n.getTime())) return []
  const out = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - i, 1))
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}

/**
 * Monthly grid cost for ONE currency (the chart cannot mix currencies).
 * Returns { labels, tyre[], other[] } where other = spare + oil.
 */
export function monthlyCost(partsLines = [], currency, { now, months = 12 } = {}) {
  const labels = monthKeys(now, months)
  const idx = new Map(labels.map((k, i) => [k, i]))
  const tyre = labels.map(() => 0)
  const other = labels.map(() => 0)
  for (const r of partsLines || []) {
    if (currencyOf(r) !== currency) continue
    const key = isoDay(r.event_date || r.txn_date).slice(0, 7)
    if (!idx.has(key)) continue
    const i = idx.get(key)
    tyre[i] += num(r.tyre_cost) || 0
    other[i] += (num(r.spare_cost) || 0) + (num(r.oil_cost) || 0)
  }
  return { labels, tyre, other }
}

export function workOrderSummary(jobCards = []) {
  let open = 0, closed = 0, breakdown = 0, breakdownKnown = 0
  let last = ''
  for (const w of jobCards || []) {
    if (isOpenWoStatus(w.status)) open++
    else if (isClosedWoStatus(w.status)) closed++
    const h = num(w.breakdown_hours)
    if (h != null && isClosedWoStatus(w.status)) { breakdown += h; breakdownKnown++ }
    const d = isoDay(w.opened_at)
    if (d && d > last) last = d
  }
  const total = (jobCards || []).length
  return { total, open, closed, lastOpened: last || null, breakdownHours: breakdownKnown ? breakdown : null }
}

export function accidentSummary(accidents = []) {
  let open = 0
  let last = ''
  const bySeverity = {}
  for (const a of accidents || []) {
    if (!isIncidentClosed(a)) open++
    const sev = canonSeverity(a.severity) || 'Not recorded'
    bySeverity[sev] = (bySeverity[sev] || 0) + 1
    const d = isoDay(a.incident_date)
    if (d && d > last) last = d
  }
  return { total: (accidents || []).length, open, lastIncident: last || null, bySeverity }
}

export function inspectionSummary(inspections = [], { now } = {}) {
  let last = ''
  let lastRow = null
  for (const r of inspections || []) {
    const d = isoDay(r.inspection_date || r.completed_date)
    if (d && d > last) { last = d; lastRow = r }
  }
  return {
    total: (inspections || []).length,
    lastDate: last || null,
    lastInspector: lastRow?.inspector || null,
    daysSince: last ? daysBetween(last, now) : null,
  }
}

function latestReading(rows, field) {
  let best = null
  for (const r of rows || []) {
    const v = num(r[field])
    if (v == null) continue
    const d = isoDay(r.reading_date)
    if (!best || d > best.date || (d === best.date && v > best.value)) best = { value: v, date: d || null }
  }
  return best
}

/**
 * Current meters. The fleet register's current_km is the monotonic
 * authoritative value (advanced by the odometer pipe); the latest logged
 * reading carries the date. Engine hours have no register column, so the
 * latest reading is the value.
 */
export function meterSummary(fleet, odometer = [], hours = []) {
  const km = latestReading(odometer, 'odometer_km')
  const hr = latestReading(hours, 'engine_hours')
  const registerKm = num(fleet?.current_km)
  const candidates = [registerKm, km?.value].filter((v) => v != null)
  return {
    currentKm: candidates.length ? Math.max(...candidates) : null,
    kmDate: km?.date || null,
    kmReadings: (odometer || []).length,
    engineHours: hr?.value ?? null,
    hoursDate: hr?.date || null,
    hoursReadings: (hours || []).length,
  }
}

export function tyreSummary(tyres = []) {
  const fitted = (tyres || []).filter((t) => !t.removal_date)
  return { total: (tyres || []).length, fitted: fitted.length, removed: (tyres || []).length - fitted.length }
}

/**
 * Insurance schedule lines for this vehicle. A line is active when today sits
 * inside cover_from..cover_to (an open bound counts as covering). Sum insured
 * is reported per currency.
 */
export function insuranceSummary(lines = [], { now } = {}) {
  const today = isoDay(new Date(typeof now === 'number' ? now : Date.parse(now)).toISOString())
  let active = 0, expired = 0, upcoming = 0
  let nextExpiry = null
  const insured = new Map()
  for (const l of lines || []) {
    const from = isoDay(l.cover_from)
    const to = isoDay(l.cover_to)
    const isActive = (!from || from <= today) && (!to || to >= today)
    if (isActive) {
      active++
      const cur = currencyOf(l)
      insured.set(cur, (insured.get(cur) || 0) + (num(l.sum_insured) || 0))
      if (to && (!nextExpiry || to < nextExpiry)) nextExpiry = to
    } else if (to && to < today) expired++
    else upcoming++
  }
  return {
    lines: (lines || []).length,
    active, expired, upcoming,
    nextExpiry,
    daysToExpiry: nextExpiry ? Math.round((Date.parse(`${nextExpiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS) : null,
    sumInsured: [...insured.entries()].map(([currency, amount]) => ({ currency, amount })),
  }
}

export const ACTIVITY_TYPES = Object.freeze([
  { key: 'work_order', label: 'Work order' },
  { key: 'tyre', label: 'Tyre' },
  { key: 'accident', label: 'Accident' },
  { key: 'inspection', label: 'Inspection' },
  { key: 'expense', label: 'Expense line' },
])

/** One flat activity list across every source, for the searchable table. */
export function activityRows({ jobCards = [], tyres = [], accidents = [], inspections = [], partsLines = [] } = {}) {
  const out = []
  for (const w of jobCards) out.push({ key: `wo:${w.id}`, type: 'work_order', date: isoDay(w.opened_at), ref: w.work_order_no || '', detail: w.description || w.work_type || '', status: w.status || '', amount: null, currency: '' })
  for (const t of tyres) out.push({ key: `ty:${t.id}`, type: 'tyre', date: isoDay(t.issue_date), ref: t.serial_no || '', detail: [t.position, t.brand, t.size].filter(Boolean).join(' | '), status: t.removal_date ? 'Removed' : 'Fitted', amount: null, currency: '' })
  for (const a of accidents) out.push({ key: `ac:${a.id}`, type: 'accident', date: isoDay(a.incident_date), ref: a.accident_type || '', detail: a.location || '', status: a.status || '', amount: null, currency: '' })
  for (const i of inspections) out.push({ key: `in:${i.id}`, type: 'inspection', date: isoDay(i.inspection_date), ref: i.inspection_type || i.title || '', detail: i.inspector || '', status: i.status || '', amount: null, currency: '' })
  for (const p of partsLines) out.push({ key: `pl:${p.id}`, type: 'expense', date: isoDay(p.event_date || p.txn_date), ref: p.work_order_no || p.issue_number || '', detail: p.item_description || '', status: '', amount: num(p.line_cost), currency: currencyOf(p) })
  return out
}

export function filterActivity(rows = [], { type = 'all', search = '', from = '', to = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((r) => (type === 'all' || r.type === type)
    && (!from || (r.date && r.date >= from))
    && (!to || (r.date && r.date <= to))
    && (!q || `${r.ref} ${r.detail} ${r.status}`.toLowerCase().includes(q)))
}

export function sortActivity(rows = [], key = 'date', dir = 'desc') {
  const m = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key]
    if (x == null || x === '') return (y == null || y === '') ? 0 : 1
    if (y == null || y === '') return -1
    if (typeof x === 'number' && typeof y === 'number') return m * (x - y)
    return m * String(x).localeCompare(String(y))
  })
}

/** Every roll-up in one call. */
export function buildVehicle360({ fleet = null, jobCards = [], tyres = [], accidents = [], inspections = [], partsLines = [], odometer = [], hours = [], insurance = [], now = Date.now() } = {}) {
  const cost = costByCurrency(partsLines)
  return {
    cost,
    // Only chart money when there is exactly one currency - two currencies on
    // one axis would read as one total.
    chartCurrency: cost.length === 1 ? cost[0].currency : null,
    workOrders: workOrderSummary(jobCards),
    accidents: accidentSummary(accidents),
    inspections: inspectionSummary(inspections, { now }),
    meters: meterSummary(fleet, odometer, hours),
    tyres: tyreSummary(tyres),
    insurance: insuranceSummary(insurance, { now }),
  }
}

// ── Per-tyre metrics for the Vehicle 360 tyre register ──────────────────────

/** Tyre risk counted as critical (High or Critical risk_level). */
export const isHighRiskTyre = (t) => t?.risk_level === 'High' || t?.risk_level === 'Critical'

/** Upper bound on a believable single-tyre life; above it the km is a data error. */
export const MAX_TYRE_LIFE_KM = 400000

/**
 * Distance a tyre ran (removal minus fitment odometer), or null when either
 * reading is missing or the run is implausible. A fitted tyre with no removal
 * reading has no measured life yet - that is not 0 km.
 */
export function tyreKmRun(t) {
  const a = num(t?.km_at_fitment)
  const b = num(t?.km_at_removal)
  if (a == null || b == null) return null
  const km = b - a
  return km > 0 && km < MAX_TYRE_LIFE_KM ? km : null
}

/** Price x qty for one tyre, or null when it carries no price (unpriced is not free). */
export function tyreCost(t) {
  const p = num(t?.cost_per_tyre)
  if (p == null || p <= 0) return null
  const q = num(t?.qty)
  return p * (q != null && q > 0 ? q : 1)
}

/**
 * Tyre register roll-up. Every ratio is null when its denominator is empty:
 *  - highRate / health: no tyres -> null (a vehicle with no tyres is not 100% healthy)
 *  - avgLifeKm: no tyre with a measured run -> null
 *  - cpk: mean cost-per-km over tyres that have BOTH a price and a measured run.
 *    An unpriced tyre is left out rather than read as costing nothing.
 *  - lifeVsTargetPct: needs a stated expected_km_per_tyre; no default is invented.
 */
export function tyreMetrics(tyres = [], { targetKm = null } = {}) {
  const list = tyres || []
  const total = list.length
  const critical = list.filter(isHighRiskTyre).length
  const highRate = total ? (critical / total) * 100 : null
  const health = highRate == null ? null : Math.max(0, Math.min(100, Math.round(100 - highRate * 0.4)))
  const lives = list.map(tyreKmRun).filter((k) => k != null)
  const avgLifeKm = lives.length ? Math.round(lives.reduce((a, b) => a + b, 0) / lives.length) : null
  const cpks = []
  let priced = 0
  for (const t of list) {
    const c = tyreCost(t)
    if (c != null) priced += 1
    const km = tyreKmRun(t)
    if (c != null && km != null) cpks.push(c / km)
  }
  const cpk = cpks.length ? cpks.reduce((a, b) => a + b, 0) / cpks.length : null
  const target = num(targetKm)
  const lifeVsTargetPct = avgLifeKm != null && target != null && target > 0
    ? Math.min(100, (avgLifeKm / target) * 100)
    : null
  return { total, critical, highRate, health, avgLifeKm, cpk, cpkSample: cpks.length, priced, lifeVsTargetPct }
}
