/**
 * Load Planning page view model (pure, no I/O, injectable `now`).
 *
 * Joins `load_plans` (V167) with the real fleet register (`vehicle_fleet`) for
 * the redesigned Load Planning screen: headline tiles, vehicle availability,
 * constraint cards, the weekly tonnage chart, the load-band distribution, the
 * 14 day capacity outlook and the planned-load tabs.
 *
 * Honesty rules:
 *   - a figure with no source column is null and the page says why;
 *   - an average over zero measured plans is null, never 0;
 *   - nothing is inferred about drivers, axles or routes the tables do not hold.
 */
import { utilization, isOverloaded, toFiniteNumber } from './loadPlans'
import { loadBand } from './loadPlanningAnalytics'

const DAY = 86400000
const text = (v) => (v == null ? '' : String(v).trim())
const lower = (v) => text(v).toLowerCase()
const assetKey = (v) => text(v).toUpperCase().replace(/\s+/g, '')
const isoDay = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
const planDay = (r) => {
  const s = text(r?.plan_date).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
const mean = (vals) => {
  const v = vals.filter((x) => x != null)
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null
}
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null)

/** Statuses that mean the asset is committed to a load right now. */
export const IN_USE_STATUSES = Object.freeze(['loaded', 'dispatched'])
/** Operational states that take a vehicle off the road. */
export const MAINTENANCE_OPS = Object.freeze(['breakdown', 'planned_scrap'])

const isActiveAsset = (v) => {
  if (v?.is_active === false) return false
  const s = lower(v?.status)
  return !s || s === 'active'
}

/**
 * Split the active fleet into Available / In use / Under maintenance.
 *   - Under maintenance: ops_status breakdown or planned scrap.
 *   - In use: the asset carries a load plan that is loaded or dispatched.
 *   - Available: everything else that is active.
 * Inactive (historical) assets are left out entirely.
 */
export function fleetAvailability(fleet = [], plans = []) {
  const committed = new Map()
  for (const p of Array.isArray(plans) ? plans : []) {
    if (!IN_USE_STATUSES.includes(lower(p?.status))) continue
    const k = assetKey(p?.asset_no)
    if (k && !committed.has(k)) committed.set(k, p)
  }
  const out = { available: [], inUse: [], maintenance: [] }
  for (const v of Array.isArray(fleet) ? fleet : []) {
    if (!isActiveAsset(v)) continue
    const k = assetKey(v?.asset_no)
    const plan = committed.get(k) || null
    if (MAINTENANCE_OPS.includes(lower(v?.ops_status))) out.maintenance.push({ ...v, _state: 'maintenance', _plan: plan })
    else if (plan) out.inUse.push({ ...v, _state: 'inUse', _plan: plan, _util: peak(plan) })
    else out.available.push({ ...v, _state: 'available', _plan: null })
  }
  const byNo = (a, b) => text(a.asset_no).localeCompare(text(b.asset_no), undefined, { numeric: true })
  out.available.sort(byNo); out.inUse.sort(byNo); out.maintenance.sort(byNo)
  return { ...out, counts: { available: out.available.length, inUse: out.inUse.length, maintenance: out.maintenance.length } }
}

function peak(plan) {
  const { weightPct, volumePct } = utilization(plan)
  if (weightPct == null && volumePct == null) return null
  return Math.max(weightPct ?? -Infinity, volumePct ?? -Infinity)
}

/** Depots (sites) that occur in the active fleet. */
export function depotOptions(fleet = []) {
  return [...new Set((Array.isArray(fleet) ? fleet : []).filter(isActiveAsset).map((v) => text(v?.site)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
}

/** Filter a vehicle list by depot and free text (asset, type, make, model). */
export function filterVehicles(rows = [], { depot = '', search = '' } = {}) {
  const q = lower(search)
  return (Array.isArray(rows) ? rows : []).filter((v) => {
    if (depot && text(v?.site) !== depot) return false
    if (q) {
      const hay = `${v?.asset_no || ''} ${v?.vehicle_type || ''} ${v?.make || ''} ${v?.model || ''} ${v?.site || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

const isOpenPlan = (p) => lower(p?.status) !== 'delivered'

/**
 * Headline tiles over the (already filtered) plans.
 *   planned       - plans not yet delivered
 *   capacityUtil  - mean weight utilisation over plans with a rated payload
 *   overweight    - plans over payload or volume capacity
 *   pending       - open plans with no asset assigned
 *   dispatchReady - share of planned/loaded plans that have an asset and are
 *                   measured within capacity (null when there are none)
 */
export function headlineTiles(plans = []) {
  const list = Array.isArray(plans) ? plans : []
  const open = list.filter(isOpenPlan)
  const ready = list.filter((p) => ['planned', 'loaded'].includes(lower(p?.status)))
  const readyOk = ready.filter((p) => text(p?.asset_no) && ['ok', 'near'].includes(loadBand(p)))
  return {
    total: list.length,
    planned: open.length,
    capacityUtil: mean(list.map((p) => utilization(p).weightPct)),
    measured: list.filter((p) => utilization(p).weightPct != null).length,
    overweight: list.filter(isOverloaded).length,
    pending: open.filter((p) => !text(p?.asset_no)).length,
    dispatchReady: pct(readyOk.length, ready.length),
    readyCount: readyOk.length,
    readyBase: ready.length,
  }
}

/**
 * Constraint cards. Only weight capacity is measurable from load_plans; the
 * others have no column and come back null with the reason.
 */
export function constraintCards(plans = []) {
  const list = Array.isArray(plans) ? plans : []
  const measured = list.filter((p) => utilization(p).weightPct != null)
  const within = measured.filter((p) => utilization(p).weightPct <= 100)
  const atRisk = list.filter((p) => planTabMatch(p, 'risk')).length
  const assigned = list.filter(isOpenPlan).filter((p) => text(p?.asset_no)).length
  const open = list.filter(isOpenPlan).length
  return [
    { key: 'weight', title: 'Payload compliance', value: pct(within.length, measured.length), sub: 'Within rated payload', side: `${atRisk} at risk`, reason: measured.length ? null : 'No plan records a rated payload yet' },
    { key: 'vehicle', title: 'Vehicle assignment', value: pct(assigned, open), sub: 'Open plans with an asset', side: `${open - assigned} unassigned`, reason: open ? null : 'No open plans' },
    { key: 'driver', title: 'Driver availability', value: null, sub: 'Drivers assigned', side: null, notRecorded: true, reason: 'Load plans hold no driver field' },
    { key: 'route', title: 'Route compliance', value: null, sub: 'Compliant routes', side: null, notRecorded: true, reason: 'Load plans hold no route rules or geometry' },
  ]
}

/** Load band counts in display order. */
export function bandDistribution(plans = []) {
  const counts = { ok: 0, near: 0, overloaded: 0, unmeasured: 0 }
  for (const p of Array.isArray(plans) ? plans : []) counts[loadBand(p)] += 1
  return [
    { key: 'ok', label: 'Within limit', short: 'Within', count: counts.ok, color: 'var(--cc-green)' },
    { key: 'near', label: 'Near limit', short: 'Near', count: counts.near, color: 'var(--cc-amber)' },
    { key: 'overloaded', label: 'Over limit', short: 'Over', count: counts.overloaded, color: 'var(--cc-red)' },
    { key: 'unmeasured', label: 'No rated capacity', short: 'No rating', count: counts.unmeasured, color: 'var(--cc-ink-3)' },
  ]
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Planned cargo vs rated payload per day for the 7 days ending today (by
 * plan_date). Days with no measured plan read null, never 0.
 */
export function weekTonnage(plans = [], now = new Date()) {
  const end = new Date(now); end.setHours(12, 0, 0, 0)
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end.getTime() - i * DAY)
    days.push({ day: isoDay(d), label: DOW[d.getDay()], planned: null, capacity: null, plans: 0 })
  }
  const idx = new Map(days.map((d, i) => [d.day, i]))
  for (const p of Array.isArray(plans) ? plans : []) {
    const i = idx.get(planDay(p))
    if (i == null) continue
    const d = days[i]
    d.plans += 1
    const w = toFiniteNumber(p?.cargo_weight_kg)
    const c = toFiniteNumber(p?.max_payload_kg)
    if (w != null) d.planned = (d.planned || 0) + w
    if (c != null) d.capacity = (d.capacity || 0) + c
  }
  return days
}

/**
 * Next N days (today included): plans scheduled per day and their mean weight
 * utilisation (null when no plan that day has a rated payload).
 */
export function capacityOutlook(plans = [], now = new Date(), days = 14) {
  const start = new Date(now); start.setHours(12, 0, 0, 0)
  const out = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * DAY)
    out.push({ day: isoDay(d), label: `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`, plans: 0, utils: [] })
  }
  const idx = new Map(out.map((d, i) => [d.day, i]))
  for (const p of Array.isArray(plans) ? plans : []) {
    const i = idx.get(planDay(p))
    if (i == null || !isOpenPlan(p)) continue
    out[i].plans += 1
    out[i].utils.push(utilization(p).weightPct)
  }
  return out.map(({ utils, ...d }) => ({ ...d, util: mean(utils) }))
}

/** Tabs over the planned-load register. */
export const PLAN_TABS = Object.freeze([
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'risk', label: 'At risk' },
  { key: 'dispatched', label: 'Dispatched' },
])

export function planTabMatch(p, tab) {
  const s = lower(p?.status)
  switch (tab) {
    case 'pending': return s === 'draft' || s === 'planned' || !s
    case 'assigned': return !!text(p?.asset_no) && s !== 'delivered'
    case 'risk': return s !== 'delivered' && ['overloaded', 'near'].includes(loadBand(p))
    case 'dispatched': return s === 'dispatched' || s === 'delivered'
    default: return true
  }
}

export function planTabCounts(plans = []) {
  const list = Array.isArray(plans) ? plans : []
  return Object.fromEntries(PLAN_TABS.map((t) => [t.key, list.filter((p) => planTabMatch(p, t.key)).length]))
}

/** Origins / destinations that occur in the plans. */
export function placeOptions(plans = []) {
  const list = Array.isArray(plans) ? plans : []
  const uniq = (k) => [...new Set(list.map((p) => text(p?.[k])).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  return { origins: uniq('origin'), destinations: uniq('destination') }
}

/** Planner status pill tone: the risk band wins over the lifecycle status. */
export function plannerStatus(p) {
  const band = loadBand(p)
  if (band === 'overloaded') return { label: 'Over capacity', tone: 'bad' }
  const s = lower(p?.status)
  if (s === 'delivered') return { label: 'Delivered', tone: 'muted' }
  if (s === 'dispatched') return { label: 'Dispatched', tone: 'info' }
  if (s === 'loaded') return { label: 'Loaded', tone: 'good' }
  if (band === 'near') return { label: 'Near limit', tone: 'warn' }
  if (!text(p?.asset_no)) return { label: 'Unassigned', tone: 'warn' }
  if (s === 'planned') return { label: 'Assigned', tone: 'good' }
  return { label: 'Draft', tone: 'muted' }
}

/** Lookup of active fleet rows by asset number for the "Vehicle class" column. */
export function fleetIndex(fleet = []) {
  const m = new Map()
  for (const v of Array.isArray(fleet) ? fleet : []) {
    const k = assetKey(v?.asset_no)
    if (k && (!m.has(k) || lower(m.get(k)?.status) !== 'active')) m.set(k, v)
  }
  return (asset) => m.get(assetKey(asset)) || null
}

/** Route rollup for the overview card (origin -> destination with counts). */
export function routeLegs(plans = [], limit = 6) {
  const m = new Map()
  for (const p of Array.isArray(plans) ? plans : []) {
    const o = text(p?.origin); const d = text(p?.destination)
    if (!o && !d) continue
    const key = `${o || 'N/A'}|${d || 'N/A'}`
    const cur = m.get(key) || { origin: o || 'N/A', destination: d || 'N/A', plans: 0, over: 0 }
    cur.plans += 1
    if (isOverloaded(p)) cur.over += 1
    m.set(key, cur)
  }
  return [...m.values()].sort((a, b) => b.plans - a.plans || a.origin.localeCompare(b.origin)).slice(0, limit)
}

// ── Optimize plan (assignment suggestions) ─────────────────────────────────

/**
 * Rated payload in kg stated on the fleet register's free-text `capacity`
 * column, ONLY when it is written as a weight ("26T", "6 TON", "26000 KG").
 * Volume figures (litres, m3) are ignored because a tank size says nothing
 * about how much weight the vehicle may carry. Returns null when no weight is
 * stated.
 */
export function capacityKg(capacity) {
  const s = lower(capacity)
  if (!s) return null
  const kg = s.match(/(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilo(?:gram)?s?)\b/)
  if (kg) { const n = Number(kg[1]); return n > 0 ? Math.round(n) : null }
  const t = s.match(/(\d+(?:\.\d+)?)\s*(?:t|tn|ton|tons|tonne|tonnes|mt)\b/)
  if (t) { const n = Number(t[1]); return n > 0 ? Math.round(n * 1000) : null }
  return null
}

/**
 * Rated payload of one vehicle and where it came from:
 *   1. the fleet register capacity when it states a weight ("register"),
 *   2. else the newest `max_payload_kg` recorded on that vehicle's own load
 *      plans ("plan history").
 * Null when neither source holds a figure.
 */
export function vehiclePayload(vehicle, plans = []) {
  const reg = capacityKg(vehicle?.capacity)
  if (reg != null) return { kg: reg, source: 'register' }
  const k = assetKey(vehicle?.asset_no)
  if (!k) return { kg: null, source: null }
  let best = null
  for (const p of Array.isArray(plans) ? plans : []) {
    if (assetKey(p?.asset_no) !== k) continue
    const kg = toFiniteNumber(p?.max_payload_kg)
    if (kg == null || kg <= 0) continue
    const when = text(p?.updated_at) || text(p?.plan_date) || ''
    if (!best || when > best.when) best = { kg, when }
  }
  return best ? { kg: best.kg, source: 'plan history' } : { kg: null, source: null }
}

/** Open plans that still need a vehicle: no asset and not loaded/dispatched/delivered. */
export function unassignedPlans(plans = []) {
  return (Array.isArray(plans) ? plans : []).filter((p) => {
    const s = lower(p?.status)
    return !text(p?.asset_no) && (s === '' || s === 'draft' || s === 'planned')
  })
}

const fmtT = (kg) => `${(Math.round(kg / 100) / 10).toLocaleString('en-GB')} t`

/**
 * Suggest a vehicle for every unassigned planned load.
 *
 *   - candidates are the vehicles passed in (the page passes the Available
 *     list: active, not broken down, not on a loaded/dispatched plan);
 *   - a vehicle qualifies only when its rated payload is known and is at least
 *     the load's cargo weight;
 *   - best fit: the smallest payload that carries the load, so big vehicles stay
 *     free for heavy loads; heaviest loads are placed first;
 *   - no double booking: a vehicle already on another open plan for that date,
 *     or suggested for another load that date, is skipped.
 *
 * Returns { suggestions, unplaced, candidates } where each unplaced row says why
 * no suggestion could be made. Nothing is guessed: a load without a weight or a
 * date is reported, never forced onto a vehicle.
 */
export function suggestAssignments(plans = [], vehicles = []) {
  const all = Array.isArray(plans) ? plans : []
  const booked = new Map() // day -> Set(assetKey)
  const book = (day, k) => { if (!booked.has(day)) booked.set(day, new Set()); booked.get(day).add(k) }
  for (const p of all) {
    const k = assetKey(p?.asset_no); const d = planDay(p)
    if (k && d && lower(p?.status) !== 'delivered') book(d, k)
  }

  const candidates = (Array.isArray(vehicles) ? vehicles : [])
    .map((v) => ({ vehicle: v, key: assetKey(v?.asset_no), ...vehiclePayload(v, all) }))
    .filter((c) => c.key)
  const rated = candidates.filter((c) => c.kg != null)
    .sort((a, b) => a.kg - b.kg || text(a.vehicle.asset_no).localeCompare(text(b.vehicle.asset_no), undefined, { numeric: true }))

  const open = unassignedPlans(all)
  const unplaced = []
  const ready = []
  for (const p of open) {
    const w = toFiniteNumber(p?.cargo_weight_kg)
    if (w == null || w <= 0) { unplaced.push({ plan: p, reason: 'No cargo weight recorded, so no payload can be matched.' }); continue }
    if (!planDay(p)) { unplaced.push({ plan: p, reason: 'No plan date, so double booking cannot be checked.' }); continue }
    ready.push({ plan: p, weight: w, day: planDay(p) })
  }
  ready.sort((a, b) => b.weight - a.weight || text(a.plan.reference).localeCompare(text(b.plan.reference)))

  const suggestions = []
  for (const r of ready) {
    if (!rated.length) {
      unplaced.push({ plan: r.plan, reason: candidates.length ? 'No available vehicle has a known rated payload.' : 'No vehicle is available.' })
      continue
    }
    const busy = booked.get(r.day) || new Set()
    const fits = rated.filter((c) => c.kg >= r.weight)
    const pick = fits.find((c) => !busy.has(c.key))
    if (!pick) {
      unplaced.push({
        plan: r.plan,
        reason: fits.length
          ? `Every vehicle that can carry ${fmtT(r.weight)} is already booked on ${r.day}.`
          : `No available vehicle is rated for ${fmtT(r.weight)} (largest known payload ${fmtT(rated[rated.length - 1].kg)}).`,
      })
      continue
    }
    book(r.day, pick.key)
    suggestions.push({
      plan: r.plan,
      vehicle: pick.vehicle,
      payloadKg: pick.kg,
      payloadSource: pick.source,
      slackKg: pick.kg - r.weight,
      utilPct: Math.round((r.weight / pick.kg) * 100),
      volumeUnchecked: toFiniteNumber(r.plan?.volume_m3) != null,
    })
  }
  return { suggestions, unplaced, candidates: candidates.length, ratedCandidates: rated.length }
}

/**
 * Patch written when a suggestion is accepted: the asset, its rated payload when
 * the plan holds none, and draft promoted to planned (an assigned plan is no
 * longer a draft). Other fields are untouched.
 */
export function assignmentPatch(s) {
  const patch = { asset_no: text(s?.vehicle?.asset_no) }
  if (toFiniteNumber(s?.plan?.max_payload_kg) == null && s?.payloadKg != null) patch.max_payload_kg = s.payloadKg
  const st = lower(s?.plan?.status)
  if (st === '' || st === 'draft') patch.status = 'planned'
  return patch
}
