/**
 * vehicleCheckInOutView - pure view engine for the redesigned Vehicle Check In/Out
 * page (live status board, quick check-in and check-out forms).
 *
 * The handover log (`vehicle_checkinout`) records events, not a vehicle state, so
 * the live board is DERIVED: a vehicle's state is its latest recorded event.
 *   - latest event is an open check-out            -> 'out'
 *   - that check-out is older than the overdue rule -> 'overdue'
 *   - latest event is a check-in (or a closed out)  -> 'in'
 * No expected-return date is stored anywhere, so "Expected in" is the check-out
 * time plus the page's own overdue rule (OVERDUE_HOURS), and is labelled as such.
 *
 * No I/O, no React. `now` is injected so every result is deterministic.
 */
import { OVERDUE_HOURS } from './vehicleCheckInOutAnalytics'

export { OVERDUE_HOURS }

const HOUR_MS = 3600000

export const LIVE_STATES = ['out', 'overdue', 'in']
export const LIVE_STATE_META = {
  out: { label: 'Out', tone: 'info' },
  overdue: { label: 'Overdue', tone: 'bad' },
  in: { label: 'In', tone: 'good' },
}

function t(v) {
  if (!v) return null
  const x = new Date(v).getTime()
  return Number.isFinite(x) ? x : null
}
function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const nowMs = (now) => (now instanceof Date ? now.getTime() : Number(now))
export const assetKey = (v) => String(v ?? '').trim().toUpperCase()
const localDay = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const FUEL_WORDS = { empty: 0, '1/4': 25, '1/2': 50, '3/4': 75, full: 100 }

/**
 * Fuel level as a percentage. Reads both vocabularies the log holds: the
 * quarter words the full form offers (Empty, 1/4 ... Full) and the "NN%" the
 * quick forms write. Anything else is not a measurement and reads null.
 */
export function fuelPct(level) {
  if (level == null || level === '') return null
  if (typeof level === 'number') return Number.isFinite(level) ? Math.max(0, Math.min(100, level)) : null
  const s = String(level).trim().toLowerCase()
  if (s in FUEL_WORDS) return FUEL_WORDS[s]
  const m = s.match(/^(\d{1,3}(?:\.\d+)?)\s*%?$/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 0 && n <= 100 ? n : null
}

/** The value the quick forms store in the free-text fuel_level column. */
export const fuelLevelText = (pct) => (pct == null || pct === '' ? '' : `${Math.round(Number(pct))}%`)

/**
 * One row per vehicle in the log: its latest event decides the state, the
 * latest check-out gives "Check out" and "Expected in".
 */
export function liveStatus(rows = [], { now = Date.now(), overdueHours = OVERDUE_HOURS } = {}) {
  const at = nowMs(now)
  const byAsset = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = assetKey(r?.asset_no)
    const x = t(r?.checked_at)
    if (!k || x == null) continue
    if (!byAsset.has(k)) byAsset.set(k, [])
    byAsset.get(k).push({ r, x })
  }
  const out = []
  for (const [key, list] of byAsset) {
    list.sort((a, b) => b.x - a.x)
    const latest = list[0]
    const lastOut = list.find((e) => e.r.direction === 'out')
    const lastIn = list.find((e) => e.r.direction === 'in')
    const isOut = latest.r.direction === 'out' && latest.r.status !== 'closed'
    const expectedMs = isOut ? latest.x + overdueHours * HOUR_MS : null
    const hoursOut = isOut && latest.x <= at ? Math.round(((at - latest.x) / HOUR_MS) * 10) / 10 : null
    const state = isOut ? (hoursOut != null && hoursOut > overdueHours ? 'overdue' : 'out') : 'in'
    out.push({
      key,
      asset_no: latest.r.asset_no,
      driver_name: latest.r.driver_name || lastOut?.r.driver_name || null,
      site: latest.r.site || null,
      state,
      checkOutAt: lastOut ? lastOut.r.checked_at : null,
      expectedIn: expectedMs != null ? new Date(expectedMs).toISOString() : null,
      returnedAt: state === 'in' && lastIn ? lastIn.r.checked_at : null,
      hoursOut,
      odometer_km: num(latest.r.odometer_km),
      fuel_pct: fuelPct(latest.r.fuel_level),
      events: list.length,
      latest: latest.r,
    })
  }
  const rank = { overdue: 0, out: 1, in: 2 }
  return out.sort((a, b) => rank[a.state] - rank[b.state] || (t(b.latest.checked_at) - t(a.latest.checked_at)))
}

/** Headline tiles for the live board. `null` input means "not loaded". */
export function liveKpis(live, { now = Date.now() } = {}) {
  if (!Array.isArray(live)) return { currentlyOut: null, currentlyIn: null, overdue: null, dueToday: null }
  const today = localDay(nowMs(now))
  let o = 0; let i = 0; let od = 0; let due = 0
  for (const v of live) {
    if (v.state === 'in') { i += 1; continue }
    o += 1
    if (v.state === 'overdue') od += 1
    else if (v.expectedIn && localDay(t(v.expectedIn)) === today) due += 1
  }
  return { currentlyOut: o, currentlyIn: i, overdue: od, dueToday: due }
}

/**
 * Filter the board. `date` (YYYY-MM-DD) keeps a vehicle whose check-out,
 * return or latest event falls on that local day.
 */
export function filterLive(live = [], { site = '', state = '', date = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(live) ? live : []).filter((v) => {
    if (site && (v.site || '') !== site) return false
    if (state && v.state !== state) return false
    if (date) {
      const days = [v.checkOutAt, v.returnedAt, v.latest?.checked_at].map(t).filter((x) => x != null).map(localDay)
      if (!days.includes(date)) return false
    }
    if (q) {
      const hay = [v.asset_no, v.driver_name, v.site, v.make, v.model, v.fleet_number].map((x) => String(x ?? '').toLowerCase()).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Attach make, model, type and fleet number from the fleet register. */
export function withFleet(live = [], fleet = []) {
  const map = new Map()
  for (const f of Array.isArray(fleet) ? fleet : []) {
    const k = assetKey(f?.asset_no)
    if (k && !map.has(k)) map.set(k, f)
  }
  return (Array.isArray(live) ? live : []).map((v) => {
    const f = map.get(v.key)
    return f ? { ...v, make: f.make || null, model: f.model || null, vehicle_type: f.vehicle_type || null, fleet_number: f.fleet_number || null, fleetKm: num(f.current_km) } : v
  })
}

/** `Make Model`, or null when the register records neither. */
export const makeModel = (v) => ([v?.make, v?.model].filter(Boolean).join(' ') || null)

/** Highest odometer recorded for an asset in the loaded log, or null. */
export function lastOdometer(rows = [], assetNo) {
  const k = assetKey(assetNo)
  let best = null
  for (const r of Array.isArray(rows) ? rows : []) {
    if (assetKey(r?.asset_no) !== k) continue
    const n = num(r.odometer_km)
    if (n != null && (best == null || n > best)) best = n
  }
  return best
}

/**
 * Validate a quick check-in or check-out. Errors block the save; warnings are
 * shown and need a second press, because a meter can be replaced and the page
 * records a lower reading (flagged) rather than refusing it.
 */
export function validateQuickEntry(entry = {}, { rows = [], live = [], fleetKm = null } = {}) {
  const errors = []
  const warnings = []
  const asset = String(entry.asset_no || '').trim()
  if (!asset) errors.push('Select a vehicle.')
  const odoRaw = entry.odometer_km
  const odo = odoRaw === '' || odoRaw == null ? null : Number(odoRaw)
  if (odo == null) errors.push('Enter the current odometer reading.')
  else if (!Number.isFinite(odo) || odo < 0) errors.push('Odometer must be zero or more.')
  const fuelRaw = entry.fuel_pct
  if (fuelRaw !== '' && fuelRaw != null) {
    const f = Number(fuelRaw)
    if (!Number.isFinite(f) || f < 0 || f > 100) errors.push('Fuel level must be between 0 and 100%.')
  }
  if (asset && odo != null && Number.isFinite(odo)) {
    const last = lastOdometer(rows, asset)
    const floor = [last, num(fleetKm)].filter((x) => x != null)
    const max = floor.length ? Math.max(...floor) : null
    if (max != null && odo < max) warnings.push(`This reading is below the last recorded ${max.toLocaleString('en-US')} km for this vehicle.`)
  }
  if (asset) {
    const v = (Array.isArray(live) ? live : []).find((x) => x.key === assetKey(asset))
    if (entry.direction === 'out' && v && v.state !== 'in') warnings.push('This vehicle is already checked out and has no return recorded.')
    if (entry.direction === 'in' && (!v || v.state === 'in')) warnings.push('There is no open check-out for this vehicle.')
  }
  return { errors, warnings, ok: errors.length === 0 }
}

/** The payload a quick form sends through the existing createEntry service. */
export function quickPayload(entry = {}, { country = null, now = Date.now() } = {}) {
  const v = entry.site ? String(entry.site) : null
  return {
    asset_no: String(entry.asset_no || '').trim(),
    driver_name: entry.driver_name ? String(entry.driver_name).trim() : '',
    direction: entry.direction === 'in' ? 'in' : 'out',
    odometer_km: entry.odometer_km,
    fuel_level: fuelLevelText(entry.fuel_pct),
    condition_notes: entry.condition_notes ? String(entry.condition_notes).trim() : '',
    site: v || '',
    status: 'open',
    country,
    checked_at: new Date(nowMs(now)).toISOString(),
  }
}
