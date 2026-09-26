/**
 * rotationScheduleAnalytics - the pure engine behind /rotation (Rotation
 * Compliance Tracker). No I/O; every date-dependent result takes `now`.
 *
 * A ROTATION is detected when the same tyre serial appears on consecutive
 * tyre_records rows (ordered by issue_date) at a different axle group. There
 * is no separate rotation log, so this is the only honest source.
 *
 * HONESTY RULES (pinned by src/test/rotationScheduleAnalytics.test.js):
 *   - A vehicle whose rotations carry no odometer reading is `Unmeasured`,
 *     never "On Schedule". Distance since rotation cannot be invented.
 *   - No vehicle odometer seen = currentKm null, not 0.
 *   - Compliance is null for an empty fleet, not 0% or 100%.
 *   - Average tyre cost is weighted over PRICED rows only; with none priced it
 *     is null. There is no `Math.max(qty, 1)` placeholder denominator.
 *   - The life-extension value is derived from measured life with and without
 *     rotation; without both it is null, never a flat assumption factor.
 */
import { normalizePosition } from './tyrePositions'

export const DEFAULT_INTERVAL = 20_000
export const MIN_INTERVAL = 10_000
export const MAX_INTERVAL = 40_000
export const DUE_SOON_BUFFER = 2_000
export const WEAR_IMBALANCE_MM = 3
export const LOW_TREAD_MM = 4

export const STATUSES = ['Overdue', 'Due Soon', 'Unmeasured', 'No History', 'On Schedule']
export const URGENCY_ORDER = { Overdue: 0, 'Due Soon': 1, Unmeasured: 2, 'No History': 3, 'On Schedule': 4 }
export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low']

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const mean = (vals) => (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null)
const serialOf = (r) => String(r?.serial_number || r?.serial_no || '').trim()
const time = (d) => { const t = new Date(d).getTime(); return Number.isFinite(t) ? t : null }

/** Collapse the canonical position vocabulary to this page's axle groups. */
export function normPos(pos) {
  const g = normalizePosition(pos)
  if (g === 'Lift Axle') return 'Lift'
  if (g === 'Tag Axle') return 'Tag'
  return g
}

/** serial -> [{from,to,date,km,asset}] for every position change. */
export function detectRotations(records = []) {
  const bySerial = new Map()
  for (const r of records) {
    const sn = serialOf(r)
    if (!sn) continue
    if (!bySerial.has(sn)) bySerial.set(sn, [])
    bySerial.get(sn).push(r)
  }
  const out = {}
  for (const [sn, arr] of bySerial) {
    arr.sort((a, b) => (time(a.issue_date) ?? 0) - (time(b.issue_date) ?? 0))
    const events = []
    for (let i = 1; i < arr.length; i++) {
      const from = normPos(arr[i - 1].position)
      const to = normPos(arr[i].position)
      if (from !== to) {
        events.push({ from, to, date: arr[i].issue_date, km: num(arr[i].km_at_fitment), asset: arr[i].asset_no })
      }
    }
    if (events.length) out[sn] = events
  }
  return out
}

export function classifyStatus({ totalRotations, sinceLastKm, dueInKm }, interval = DEFAULT_INTERVAL) {
  if (!totalRotations) return 'No History'
  if (sinceLastKm == null || dueInKm == null) return 'Unmeasured'
  if (sinceLastKm >= interval) return 'Overdue'
  if (dueInKm <= DUE_SOON_BUFFER) return 'Due Soon'
  return 'On Schedule'
}

export function buildVehicles(records = [], interval = DEFAULT_INTERVAL, rotations = detectRotations(records)) {
  const byAsset = new Map()
  for (const r of records) {
    const asset = String(r.asset_no || '').trim()
    if (!asset) continue
    if (!byAsset.has(asset)) byAsset.set(asset, [])
    byAsset.get(asset).push(r)
  }

  const vehicles = []
  for (const [asset, recs] of byAsset) {
    const latestBySn = {}
    for (const r of recs) {
      const sn = serialOf(r)
      if (!sn) continue
      if (!latestBySn[sn] || (time(r.issue_date) ?? 0) > (time(latestBySn[sn].issue_date) ?? 0)) latestBySn[sn] = r
    }
    const activeTyres = Object.values(latestBySn)

    let lastRotationDate = null
    let lastRotationKm = null
    const rotationEvents = []
    for (const sn of Object.keys(latestBySn)) {
      for (const ev of (rotations[sn] || []).filter((e) => e.asset === asset)) {
        rotationEvents.push({ serial: sn, ...ev })
        if (!lastRotationDate || (time(ev.date) ?? 0) > (time(lastRotationDate) ?? 0)) {
          lastRotationDate = ev.date
          lastRotationKm = ev.km
        }
      }
    }
    rotationEvents.sort((a, b) => (time(b.date) ?? 0) - (time(a.date) ?? 0))

    const kms = activeTyres.map((r) => num(r.km_at_fitment)).filter((k) => k != null && k > 0)
    const currentKm = kms.length ? Math.max(...kms) : null
    const sinceLastKm = lastRotationKm != null && currentKm != null ? Math.max(0, currentKm - lastRotationKm) : null
    const dueInKm = sinceLastKm != null ? interval - sinceLastKm : null

    const treadByPos = {}
    for (const r of activeTyres) {
      const td = num(r.tread_depth)
      if (td == null) continue
      const pos = normPos(r.position)
      ;(treadByPos[pos] ||= []).push(td)
    }
    const avgTread = (pos) => (treadByPos[pos] ? mean(treadByPos[pos]) : null)
    const steerTread = avgTread('Steer')
    const driveTread = avgTread('Drive')
    const status = classifyStatus({ totalRotations: rotationEvents.length, sinceLastKm, dueInKm }, interval)

    vehicles.push({
      asset,
      site: recs.find((r) => r.site)?.site || 'Unassigned',
      country: recs.find((r) => r.country)?.country || null,
      activeTyreCount: activeTyres.length,
      activeTyres,
      lastRotationDate,
      lastRotationKm,
      currentKm,
      sinceLastKm,
      dueInKm,
      status,
      totalRotations: rotationEvents.length,
      rotationEvents,
      steerTread,
      driveTread,
      wearImbalance: steerTread != null && driveTread != null ? Math.abs(steerTread - driveTread) : null,
      treadByPos,
    })
  }
  vehicles.sort((a, b) => {
    const uo = (URGENCY_ORDER[a.status] ?? 9) - (URGENCY_ORDER[b.status] ?? 9)
    if (uo) return uo
    if (a.sinceLastKm != null && b.sinceLastKm != null && a.sinceLastKm !== b.sinceLastKm) return b.sinceLastKm - a.sinceLastKm
    return a.asset.localeCompare(b.asset)
  })
  return vehicles
}

/** Average of consecutive rotation intervals (km) across all serials. */
export function averageRotationInterval(rotations = {}) {
  const gaps = []
  for (const evts of Object.values(rotations)) {
    for (let i = 1; i < evts.length; i++) {
      const a = evts[i - 1].km
      const b = evts[i].km
      if (a != null && b != null && b > a) gaps.push(b - a)
    }
  }
  const m = mean(gaps)
  return { avgInterval: m != null ? Math.round(m) : null, samples: gaps.length }
}

/** Measured tyre life for tyres that were rotated vs never rotated. */
export function lifeComparison(records = [], rotations = {}) {
  const withRotation = []
  const withoutRotation = []
  for (const r of records) {
    const a = num(r.km_at_fitment)
    const b = num(r.km_at_removal)
    if (a == null || b == null || b <= a) continue
    ;(rotations[serialOf(r)] ? withRotation : withoutRotation).push(b - a)
  }
  const w = mean(withRotation)
  const wo = mean(withoutRotation)
  return {
    avgLifeWith: w != null ? Math.round(w) : null,
    avgLifeWithout: wo != null ? Math.round(wo) : null,
    withSamples: withRotation.length,
    withoutSamples: withoutRotation.length,
  }
}

/** Qty-weighted average tyre price over PRICED rows only; null when none priced. */
export function averageTyreCost(records = []) {
  let spend = 0
  let qty = 0
  for (const r of records) {
    const c = num(r.cost_per_tyre)
    if (c == null || c <= 0) continue
    const q = num(r.qty) != null && num(r.qty) > 0 ? num(r.qty) : 1
    spend += c * q
    qty += q
  }
  return qty > 0 ? spend / qty : null
}

/**
 * Value of the tyre life the non-compliant fleet is leaving on the table:
 * if a tyre lasts L_with when rotated and L_without when not, each non-rotated
 * tyre consumes (1 - L_without / L_with) of a tyre's price extra. Multiplied by
 * the active tyres on vehicles that are not on schedule. Null unless both
 * lives and a price are measured and rotation actually helps.
 */
export function lifeExtensionValue({ avgLifeWith, avgLifeWithout, avgCost, tyresAtRisk }) {
  if (!avgLifeWith || !avgLifeWithout || avgCost == null || avgLifeWith <= avgLifeWithout) {
    return { perTyre: null, total: null }
  }
  const perTyre = (1 - avgLifeWithout / avgLifeWith) * avgCost
  return { perTyre, total: tyresAtRisk != null ? perTyre * tyresAtRisk : null }
}

export function siteCompliance(vehicles = []) {
  const map = new Map()
  for (const v of vehicles) {
    const s = map.get(v.site) || { site: v.site, total: 0, compliant: 0, overdue: 0 }
    s.total += 1
    if (v.status === 'On Schedule') s.compliant += 1
    if (v.status === 'Overdue') s.overdue += 1
    map.set(v.site, s)
  }
  return [...map.values()]
    .map((s) => ({ ...s, pct: s.total ? Math.round((s.compliant / s.total) * 100) : null }))
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || a.site.localeCompare(b.site))
}

export function statusDistribution(vehicles = []) {
  const total = vehicles.length
  return STATUSES.map((status) => {
    const count = vehicles.filter((v) => v.status === status).length
    return { status, count, pct: total ? Math.round((count / total) * 100) : null }
  })
}

/** Rotations performed per month for the 12 months ending in `now`. */
export function monthlyRotations(rotations = {}, now = new Date()) {
  const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1))
  const counts = months.map(() => 0)
  for (const evts of Object.values(rotations)) {
    for (const ev of evts) {
      const t = time(ev.date)
      if (t == null) continue
      for (let i = 0; i < 12; i++) {
        const start = months[i].getTime()
        const end = new Date(months[i].getFullYear(), months[i].getMonth() + 1, 1).getTime()
        if (t >= start && t < end) { counts[i] += 1; break }
      }
    }
  }
  return months.map((d, i) => ({
    key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
    count: counts[i],
  }))
}

export function imbalancedVehicles(vehicles = [], threshold = WEAR_IMBALANCE_MM) {
  return vehicles
    .filter((v) => v.wearImbalance != null && v.wearImbalance > threshold)
    .sort((a, b) => b.wearImbalance - a.wearImbalance)
}

export function filterVehicles(vehicles = [], { site = 'All', status = 'All', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return vehicles.filter((v) => {
    if (site !== 'All' && v.site !== site) return false
    if (status !== 'All' && v.status !== status) return false
    if (!q) return true
    return v.asset.toLowerCase().includes(q) || String(v.site).toLowerCase().includes(q)
  })
}

export function buildRotationAnalytics(records = [], interval = DEFAULT_INTERVAL, now = new Date()) {
  const rotations = detectRotations(records)
  const vehicles = buildVehicles(records, interval, rotations)
  const total = vehicles.length
  const count = (s) => vehicles.filter((v) => v.status === s).length
  const compliant = count('On Schedule')
  const { avgInterval, samples: intervalSamples } = averageRotationInterval(rotations)
  const life = lifeComparison(records, rotations)
  const avgCost = averageTyreCost(records)
  const tyresAtRisk = vehicles
    .filter((v) => v.status !== 'On Schedule')
    .reduce((s, v) => s + v.activeTyreCount, 0)
  const value = lifeExtensionValue({ ...life, avgCost, tyresAtRisk })
  const monthly = monthlyRotations(rotations, now)
  return {
    vehicles,
    total,
    compliant,
    overdue: count('Overdue'),
    dueSoon: count('Due Soon'),
    unmeasured: count('Unmeasured'),
    noHistory: count('No History'),
    compliancePct: total ? Math.round((compliant / total) * 100) : null,
    avgInterval,
    intervalSamples,
    ...life,
    avgCost,
    tyresAtRisk,
    lifeValuePerTyre: value.perTyre,
    lifeValueTotal: value.total,
    siteCompliance: siteCompliance(vehicles),
    statusDistribution: statusDistribution(vehicles),
    monthly,
    hasMonthlyRotations: monthly.some((m) => m.count > 0),
    imbalanced: imbalancedVehicles(vehicles),
    rotationsDetected: Object.values(rotations).reduce((s, e) => s + e.length, 0),
  }
}

/**
 * Schedule entries for Overdue and Due Soon vehicles that have no open
 * schedule yet, spread two days apart starting three days out.
 */
export function autoScheduleEntries(vehicles = [], schedules = [], interval = DEFAULT_INTERVAL, now = new Date()) {
  const open = new Set(schedules.filter((s) => s.status === 'Open').map((s) => s.asset))
  return vehicles
    .filter((v) => (v.status === 'Overdue' || v.status === 'Due Soon') && !open.has(v.asset))
    .map((v, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3 + i * 2)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return {
        asset: v.asset,
        site: v.site,
        scheduledDate: iso,
        priority: v.status === 'Overdue' ? 'Critical' : 'High',
        notes: v.status === 'Overdue'
          ? `Auto-scheduled. Overdue by ${Math.round(v.sinceLastKm - interval).toLocaleString('en-US')} km.`
          : `Auto-scheduled. Due in ${Math.round(v.dueInKm).toLocaleString('en-US')} km.`,
        currentKm: v.currentKm,
        status: 'Open',
      }
    })
}

/** Open schedules grouped by priority (earliest first) plus the completed list. */
export function scheduleSummary(schedules = [], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const open = schedules.filter((s) => s.status === 'Open')
  const completed = schedules.filter((s) => s.status === 'Completed')
  const late = open.filter((s) => { const t = time(s.scheduledDate); return t != null && t < today }).length
  return {
    open: open.length,
    completed: completed.length,
    late,
    byPriority: Object.fromEntries(PRIORITIES.map((p) => [p, open.filter((s) => s.priority === p).length])),
  }
}
