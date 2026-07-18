/**
 * Tyre Bay - pure helpers (no React, no I/O) for the per-vehicle Tyre Bay view
 * on the Asset Detail page. Given a vehicle's flat `tyre_records` rows this:
 *   - groups them by fitment position into a current tyre + full history,
 *   - maps a canonical GCC position code (LHF1, LHR1-O ...) back to the internal
 *     VehicleTyreDiagram slot id (F1L, R1Lo ...) so the current tyre's risk can
 *     light up the wheel diagram,
 *   - derives per-record life-km / CPK / days-fitted for the detail panel.
 *
 * `canonicalToSlotId` is the INVERSE of `legacyPositionCode` in
 * src/lib/tyrePositions.js: the diagram relabels each slot id to its canonical
 * code via `legacyPositionCode(layoutKey, slotId)`, so inverting that mapping
 * over the layout's slot set turns a stored position back into the slot id the
 * diagram hit-tests on. Returns null when no slot matches so callers degrade
 * gracefully (render the diagram without lighting that wheel).
 *
 * Everything here is deterministic (inject `now` for date math) and safe for
 * vitest / Node.
 */
import { legacyPositionCode, canonicalCode } from './tyrePositions'

/** Serial across the three storage columns (mirrors tyrePassport.serialOfRecord). */
export const serialOf = (r) =>
  (r?.serial_no || r?.serial_number || r?.tyre_serial || '').toString().trim()

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

/** Effective date used to order a stint (removal first, else fitment, else issue). */
export function stintDate(r) {
  return r?.removal_date || r?.fitment_date || r?.issue_date || r?.created_at || null
}

const dateMs = (d) => {
  const t = d ? new Date(d).getTime() : NaN
  return Number.isFinite(t) ? t : 0
}

/** A record is "fitted now" when it carries no removal signal. */
export function isCurrentlyFitted(r) {
  if (!r) return false
  return num(r.km_at_removal) == null && !r.removal_date
}

/** Position key for a record (canonical code kept verbatim; blank -> 'Unassigned'). */
export function positionKeyOf(r) {
  const raw = r?.position || r?.tyre_position || ''
  const s = String(raw).trim()
  return s || 'Unassigned'
}

/**
 * Group tyre_records rows by fitment position.
 * @param {object[]} rows
 * @returns {Record<string,{current:object|null, history:object[]}>}
 *   current = the newest still-fitted record at that position (null when none);
 *   history = every other record, sorted newest-first by removal/fitment/issue date.
 */
export function groupTyresByPosition(rows) {
  const out = {}
  const list = Array.isArray(rows) ? rows.filter(Boolean) : []
  for (const r of list) {
    const key = positionKeyOf(r)
    if (!out[key]) out[key] = { current: null, history: [] }
    out[key]._all = out[key]._all || []
    out[key]._all.push(r)
  }
  for (const key of Object.keys(out)) {
    const all = out[key]._all
    delete out[key]._all
    // The current tyre is the newest still-fitted record; everything else is history.
    const fitted = all
      .filter(isCurrentlyFitted)
      .sort((a, b) => dateMs(b.fitment_date || b.issue_date) - dateMs(a.fitment_date || a.issue_date))
    const current = fitted[0] || null
    const history = all
      .filter((r) => r !== current)
      .sort((a, b) => dateMs(stintDate(b)) - dateMs(stintDate(a)))
    out[key] = { current, history }
  }
  return out
}

/** Distance run on a record: km_at_removal - km_at_fitment, else total_km. */
export function tyreLifeKm(r) {
  const fit = num(r?.km_at_fitment)
  const rem = num(r?.km_at_removal)
  if (fit != null && rem != null) {
    const d = rem - fit
    return d > 0 ? d : null
  }
  const total = num(r?.total_km)
  return total != null && total > 0 ? total : null
}

/** Cost per km for a record (cost_per_tyre / life km) or null when not derivable. */
export function cpk(r) {
  const cost = num(r?.cost_per_tyre)
  const km = tyreLifeKm(r)
  if (cost == null || cost <= 0 || km == null || km <= 0) return null
  return Math.round((cost / km) * 10000) / 10000
}

/** Whole days a record has been fitted (fitment/issue -> removal or `now`). */
export function daysFitted(r, now = Date.now()) {
  const start = r?.fitment_date || r?.issue_date
  if (!start) return null
  const startMs = new Date(start).getTime()
  if (!Number.isFinite(startMs)) return null
  const endMs = r?.removal_date ? new Date(r.removal_date).getTime() : now
  if (!Number.isFinite(endMs) || endMs < startMs) return null
  return Math.floor((endMs - startMs) / 86_400_000)
}

// ── Vehicle type -> built-in diagram layout ────────────────────────────────────
// Mirrors resolveVehicleType() in src/components/VehicleTyreDiagram.jsx so this
// pure module can pick the same slot-id set the diagram renders, without importing
// the React component. Keep in sync if the component's keyword mapping changes.
const PREFIX_MAP = { TM: 'Tri-mixer', MP: 'Concrete pump', WL: 'Wheel loader', SL: 'Skid loader', PL: 'Pickup' }

export function resolveLayoutKey(vt) {
  if (!vt) return 'Pickup'
  if (BUILTIN_LAYOUT_SLOTS[vt]) return vt
  const s = String(vt).toLowerCase().trim()
  const prefix = (String(vt).match(/^[A-Za-z]+/) || [''])[0].toUpperCase().slice(0, 2)
  if (PREFIX_MAP[prefix]) return PREFIX_MAP[prefix]
  if (s.includes('tri') || s.includes('mixer') || s.includes('transit')) return 'Tri-mixer'
  if (s.includes('boom') || s.includes('placing')) return 'Concrete pump'
  if (s.includes('concrete') || s.includes('pump')) return 'Concrete pump'
  if (s.includes('skid')) return 'Skid loader'
  if (s.includes('wheel') || s.includes('loader') || s.includes('load')) return 'Wheel loader'
  if (s.includes('canter')) return 'Canter'
  if (s.includes('bus') || s.includes('coaster')) return 'Bus'
  if (s.includes('tata')) return 'Tata'
  if (s.includes('ashok') || s.includes('leyland')) return 'Ashok Leyland'
  if (s.includes('pickup') || s.includes('pick up') || s.includes('pick-up')) return 'Pickup'
  return 'Pickup'
}

// Slot-id sets for each built-in layout (mirrors the LAYOUTS map in
// VehicleTyreDiagram.jsx). A vehicle type uses EITHER FL/FR OR F1L/F1R naming,
// never both, so inverting legacyPositionCode over the correct set is injective.
const FR4 = ['FL', 'FR', 'RL', 'RR']
const DUAL_REAR = ['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo']
export const BUILTIN_LAYOUT_SLOTS = {
  Pickup: FR4,
  'Wheel loader': FR4,
  'Skid loader': FR4,
  Canter: DUAL_REAR,
  Bus: DUAL_REAR,
  Tata: DUAL_REAR,
  'Ashok Leyland': DUAL_REAR,
  'Tri-mixer': ['F1L', 'F1R', 'F2L', 'F2R', 'R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li', 'R2Ri', 'R2Ro'],
  'Concrete pump': ['F1L', 'F1R', 'F2L', 'F2R', 'F3L', 'F3R', 'R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li', 'R2Ri', 'R2Ro'],
}

/**
 * The full set of wheel positions for a vehicle type, as canonical GCC codes
 * (for the Move/Swap target-position dropdown). Empty array when the type has no
 * built-in layout.
 * @returns {{slot:string, code:string}[]}
 */
export function layoutPositionsFor(vehicleTypeKey) {
  const layoutKey = resolveLayoutKey(vehicleTypeKey)
  const slots = BUILTIN_LAYOUT_SLOTS[layoutKey] || []
  return slots.map((slot) => ({ slot, code: canonicalCode(legacyPositionCode(layoutKey, slot)) || slot }))
}

/**
 * Map a canonical tyre_records.position (e.g. 'LHF1', 'LHR1-O') to the diagram's
 * internal slot id (e.g. 'F1L', 'R1Lo') for a given vehicle type. Inverse of
 * legacyPositionCode over the resolved layout's slot set. Returns null when the
 * position does not correspond to any slot on that vehicle (caller degrades).
 */
export function canonicalToSlotId(vehicleTypeKey, positionCode) {
  if (!positionCode) return null
  const layoutKey = resolveLayoutKey(vehicleTypeKey)
  const slots = BUILTIN_LAYOUT_SLOTS[layoutKey] || BUILTIN_LAYOUT_SLOTS.Pickup
  const target = canonicalCode(String(positionCode).trim())
  if (!target) return null
  const targetU = String(target).toUpperCase()
  for (const slot of slots) {
    // Already a slot id? (e.g. inspection-stored internal id)
    if (slot.toUpperCase() === targetU) return slot
    const label = legacyPositionCode(layoutKey, slot)
    const canon = canonicalCode(label)
    if (canon && String(canon).toUpperCase() === targetU) return slot
  }
  return null
}
