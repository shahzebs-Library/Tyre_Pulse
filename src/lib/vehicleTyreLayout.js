/**
 * vehicleTyreLayout - THE single source of truth for "which wheel arrangement
 * does this machine have?" on the web app.
 *
 * Why this module exists: the same keyword chain used to be copy-pasted into
 * four places (VehicleTyreDiagram.jsx, tyreBay.js, Inspections.jsx,
 * exportUtils.js). They drifted, and the whole pump family collapsed onto the
 * 14-tyre truck-mounted concrete pump - a stationary pump has no tyres at all
 * and a placing boom is not a truck. Every consumer now resolves through here.
 *
 * It is a faithful mirror of mobile/lib/tyreDiagramLayouts.ts, whose mapping the
 * fleet owner confirmed machine by machine. CHANGE BOTH TOGETHER: a web/mobile
 * split is exactly what produced the bug this module fixes.
 *
 * Pure, no I/O, safe to call in render.
 */

// ── Tyreless (stationary / non-wheeled) equipment ─────────────────────────────
// Matching here short-circuits BOTH the diagram and the position list, so an
// inspector is asked for nothing rather than for wheels the machine lacks.
// Mirrors mobile NO_TYRE_EQUIPMENT.
export const NO_TYRE_EQUIPMENT = [
  'generator', 'genset', 'chiller', 'reclaimer', 'compressor',
  'tower light', 'light tower',
  // ANY plant is a fixed installation - bt-plant, ice plant, batching plant,
  // water treatment plant. One word covers every spelling in the register.
  'plant', 'batch',
  // A placing boom is mast-mounted concrete placing gear, not a vehicle. It is
  // a different machine from the truck-mounted concrete pump and must not
  // borrow that pump's 14 tyres.
  'placing boom', 'placing',
  // A stationary pump is skid-mounted concrete pumping gear with NO wheels
  // (fleet owner confirmed). It used to draw a 14-wheel pump truck.
  'stationary',
  'building',
]

/** True when the machine carries no tyres at all. */
export function isTyrelessEquipment(vt) {
  if (!vt) return false
  const s = String(vt).toLowerCase().trim()
  return NO_TYRE_EQUIPMENT.some((k) => s.includes(k))
}

// ── Slot ids per layout key ───────────────────────────────────────────────────
// These ids ARE the diagram's tyre ids and the stored inspection keys, so a
// layout and its position vocabulary can never disagree.
const FR4 = ['FL', 'FR', 'RL', 'RR']
const DUAL_REAR = ['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo']
const DRIVE_2_AXLE = ['R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li', 'R2Ri', 'R2Ro']

export const LAYOUT_SLOTS = Object.freeze({
  Pickup: FR4,
  'Wheel loader': FR4,
  'Skid loader': FR4,
  Canter: DUAL_REAR,
  Bus: DUAL_REAR,
  Tata: DUAL_REAR,
  'Ashok Leyland': DUAL_REAR,
  // Diesel / water tanker: 1 single-tyre steer axle + 1 dual-tyre drive axle
  // = 6 tyres (fleet owner confirmed). Same chassis class as the Canter.
  Tanker: DUAL_REAR,
  // Towed trailer: 2 dual-tyre axles, no steer axle = 8 tyres.
  Trailer: DRIVE_2_AXLE,
  // Heavy 6x4 (spider pump, crane, generic truck, 8/10-wheeler):
  // 1 steer axle + 2 dual-tyre drive axles = 10 tyres.
  'Truck 6x4': ['FL', 'FR', ...DRIVE_2_AXLE],
  'Tri-mixer': ['F1L', 'F1R', 'F2L', 'F2R', ...DRIVE_2_AXLE],
  // Line pump: 2 single-tyre steer axles + 2 dual-tyre drive axles = 12 tyres
  // (fleet owner confirmed). It rides a shorter chassis than the truck-mounted
  // concrete pump, which carries a THIRD steer axle and 14 tyres.
  'Line pump': ['F1L', 'F1R', 'F2L', 'F2R', ...DRIVE_2_AXLE],
  // MP concrete pump: 3 single-tyre steer axles + 2 dual-tyre drive axles.
  'Concrete pump': ['F1L', 'F1R', 'F2L', 'F2R', 'F3L', 'F3R', ...DRIVE_2_AXLE],
})

/** Every layout key this app knows how to draw. */
export const LAYOUT_KEYS = Object.freeze(Object.keys(LAYOUT_SLOTS))

/** Slot ids for a raw vehicle type. Empty array for tyreless equipment. */
export function layoutSlotsFor(vehicleType, assetNo) {
  if (isTyrelessEquipment(vehicleType)) return []
  return LAYOUT_SLOTS[resolveLayoutKey(vehicleType, assetNo)] || LAYOUT_SLOTS.Pickup
}

// Case/spacing-insensitive index of the layout keys, so "TR-MIXER", "tri mixer"
// and "Tri-mixer" all land on the same entry (site data carries mixed casing).
const KEY_INDEX = {}
LAYOUT_KEYS.forEach((k) => { KEY_INDEX[k.toLowerCase().replace(/[\s\-_]+/g, '')] = k })

// Asset-code prefixes, for callers that pass an asset number instead of a type.
const PREFIX_MAP = {
  TM: 'Tri-mixer',
  MP: 'Concrete pump',
  WL: 'Wheel loader',
  SL: 'Skid loader',
  PL: 'Pickup',
}

/**
 * Resolve ONE string, returning null when nothing matched rather than falling
 * back to a pickup. The null is what lets resolveLayoutKey try the asset number
 * instead of settling for a wrong machine.
 */
function resolveOne(vt) {
  const raw = String(vt ?? '').trim()
  if (!raw) return null

  const s = raw.toLowerCase()
  const compact = s.replace(/[\s\-_]+/g, '')

  // Exact layout-key match first.
  if (KEY_INDEX[compact]) return KEY_INDEX[compact]

  // Asset-code prefix. It MUST require letters immediately followed by a digit:
  // matching leading letters alone read "PLACING BOOM" as a PL-prefixed pickup
  // and drew 4 tyres, because the check ran before the keyword rules below
  // could ever see the word "boom".
  const assetCode = raw.match(/^([A-Za-z]{2,3})\s*\d/)
  if (assetCode) {
    const prefix = assetCode[1].toUpperCase().slice(0, 2)
    if (PREFIX_MAP[prefix]) return PREFIX_MAP[prefix]
  }

  // Explicit "N-Wheeler" names FIRST - "wheeler" contains "wheel" and would
  // otherwise fall into the 4-tyre Wheel loader layout.
  const wheeler = compact.match(/(\d+)wheeler/)
  if (wheeler) {
    const n = parseInt(wheeler[1], 10)
    if (n >= 12) return 'Tri-mixer'
    if (n >= 8) return 'Truck 6x4'
    if (n >= 6) return 'Canter'
    return 'Pickup'
  }

  if (s.includes('tri') || s.includes('mixer') || s.includes('transit')) return 'Tri-mixer'

  // Tyreless gear (placing boom, stationary pump, plant, generator) is
  // short-circuited by isTyrelessEquipment() before any caller gets here. This
  // is a DEFENSIVE stop so a caller that skips that check can never fall
  // through to the 'pump' rule below and draw a 14-wheel truck for a machine
  // with no wheels. It must sit ABOVE the boom/pump rules.
  if (s.includes('placing') || s.includes('stationary')) return 'Pickup'

  // Line pump: its own 12-tyre pump layout, NOT the concrete pump's 14.
  if (compact.includes('linepump')) return 'Line pump'
  // Spider pump rides a standard 6x4 truck chassis (10 tyres).
  if (compact.includes('spiderpump') || s.includes('spider')) return 'Truck 6x4'
  // A boom pump truck IS the truck-mounted concrete pump (14 tyres); a PLACING
  // boom was already caught above.
  if (s.includes('boom')) return 'Concrete pump'
  if (s.includes('concrete') || s.includes('pump')) return 'Concrete pump'

  if (s.includes('skid')) return 'Skid loader'
  if (s.includes('wheel') || s.includes('loader') || s.includes('load')) return 'Wheel loader'
  if (s.includes('canter')) return 'Canter'
  if (s.includes('bus') || s.includes('coaster')) return 'Bus'
  if (s.includes('tata')) return 'Tata'
  if (s.includes('ashok') || s.includes('leyland')) return 'Ashok Leyland'
  if (s.includes('pickup') || s.includes('pick up') || s.includes('pick-up')) return 'Pickup'
  // Tankers are 2-axle rigids: 6 tyres.
  if (s.includes('tanker')) return 'Tanker'
  // A towed trailer: 2 dual axles, 8 tyres, no steer axle.
  if (s.includes('trailer') || compact.includes('trl')) return 'Trailer'
  // Heavy 6x4 chassis family (cranes, generic trucks): 10 tyres.
  if (s.includes('crane') || s.includes('truck')) return 'Truck 6x4'

  // Nothing recognised. Report that rather than guessing.
  return null
}

/**
 * Map a vehicle type onto a layout key, optionally using the ASSET NUMBER when
 * the type says nothing useful (the register carries junk catch-all types, and
 * in those rows the asset number is the only thing identifying the machine).
 * The type always wins when it resolves, so a real type is never overridden.
 *
 * @param {string} [vehicleType]
 * @param {string} [assetNo]
 * @returns {string} a key of LAYOUT_SLOTS, never null
 */
export function resolveLayoutKey(vehicleType, assetNo) {
  return resolveOne(vehicleType) ?? resolveOne(assetNo) ?? 'Pickup'
}

export default resolveLayoutKey
