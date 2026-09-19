/**
 * vehicleDamageViews.js - pure data + helpers behind the "Mark vehicle/
 * equipment damage" tool (mock screens M8 bus, M9 concrete pump, M10 pickup).
 * No I/O; the panel component (DamageMapPanel.jsx) and the damage-assessment
 * service (readMarks) are the only callers.
 *
 * Marks are stored as entries in accident_damage_assessments.damage_areas
 * (jsonb; see accidentDamageAssessment.js's upsertDamageMark/removeDamageMark),
 * shape { view, region_key, region_label, damage_type, severity, action, note,
 * photo_refs[] }. A mark's identity is (view, region_key), matching
 * upsertDamageMark's own upsert key exactly. The phone stores the same marks in
 * accidents.damage_description as JSON {"version":2,"marks":[...]}; that is
 * READ here as a fallback source (parsePhoneMarks) and never written to.
 *
 * DIAGRAMS ARE DELIBERATELY ABSTRACT, NOT PHOTOREALISTIC. Each view is a small
 * CSS-grid "floor plan" of named, clickable cells - honest about being a
 * functional diagram rather than a traced vehicle silhouette. The mocks show a
 * rotatable 3D model; the web equivalent is this orthographic multi-view mapper
 * (the M10 title), which is what the panel labels it as.
 *
 * FAMILY RESOLUTION DELEGATES TO src/lib/vehicleTyreLayout.js - THE single,
 * fleet-owner-confirmed classifier the rest of the app already uses for "what
 * shape is this machine". Do NOT re-inline a second vehicle-type keyword list
 * here: that is exactly the drift that once collapsed the whole pump family
 * onto the wrong body (see vehicleTyreLayout.js's own header). It also lets a
 * blank/junk `vehicle_type` fall back to the ASSET NUMBER (TM.../MP.../WL...),
 * which this file's own resolver never could.
 *
 * VIEW ORDER AND LABELS come from accidentCaseVocab.js (FAMILY_VIEW_ORDER,
 * VIEW_LABELS, DAMAGE_LEVELS, DAMAGE_TYPES) - the ONE vocabulary the web and the
 * Flutter case screens share. Nothing view-related is re-declared here.
 */
import { resolveLayoutKey, isTyrelessEquipment } from './vehicleTyreLayout'
import {
  FAMILY_VIEW_ORDER, VIEW_LABELS, DAMAGE_LEVELS, DAMAGE_TYPES, canonDamageType, DAMAGE_NOTE_MAX,
} from './accidentCaseVocab'

/** Vehicle "families" this tool knows a click-surface layout for; anything
 *  else falls back to 'generic'. */
export const FAMILIES = ['bus', 'pickup', 'concrete_pump', 'generic']

// Canonical layout key (vehicleTyreLayout.LAYOUT_KEYS) -> damage-marking
// family. Only the machines whose real body genuinely matches the
// component-tap pump grid (a truck-mounted chassis cab + boom + outriggers)
// route to 'concrete_pump' - a mast-mounted PLACING BOOM has no chassis or
// outriggers at all and is caught by isTyrelessEquipment() below instead.
const LAYOUT_KEY_TO_FAMILY = {
  Pickup: 'pickup',
  'Wheel loader': 'generic',
  'Skid loader': 'generic',
  Canter: 'generic',
  Bus: 'bus',
  Tata: 'generic',
  'Ashok Leyland': 'generic',
  Tanker: 'generic',
  Trailer: 'generic',
  'Truck 6x4': 'generic',
  'Tri-mixer': 'generic',
  'Line pump': 'concrete_pump',
  'Concrete pump': 'concrete_pump',
}

/**
 * Resolve a fleet `vehicle_type` (and, when it is blank/junk, the asset
 * number) to one of FAMILIES via the canonical resolver.
 * @param {string} [vehicleType]
 * @param {string} [assetNo]
 * @returns {'bus'|'pickup'|'concrete_pump'|'generic'}
 */
export function familyForVehicleType(vehicleType, assetNo) {
  const hasType = String(vehicleType ?? '').trim() !== ''
  const hasAsset = String(assetNo ?? '').trim() !== ''
  if (!hasType && !hasAsset) return 'generic' // nothing to resolve - say so, never guess
  // Fixed/mast-mounted equipment (placing boom, stationary pump, generator,
  // plant...) has no chassis/wheels, so it gets the plain 4-side grid, never
  // the truck-mounted pump's chassis+outrigger component layout.
  if (isTyrelessEquipment(vehicleType)) return 'generic'
  return LAYOUT_KEY_TO_FAMILY[resolveLayoutKey(vehicleType, assetNo)] || 'generic'
}

/** View keys per family, in the order the MOCK offers them (accidentCaseVocab
 *  FAMILY_VIEW_ORDER is the source; this is a frozen mirror so a caller cannot
 *  mutate the shared list). */
export const FAMILY_VIEWS = Object.freeze(
  Object.fromEntries(FAMILIES.map((f) => [f, Object.freeze([...(FAMILY_VIEW_ORDER[f] || FAMILY_VIEW_ORDER.generic)])])),
)

/** Views offered for a family (unknown family -> generic order). */
export function viewsForFamily(family) { return FAMILY_VIEWS[family] || FAMILY_VIEWS.generic }

/**
 * The pump used to have a single 'overview' view; the mock calls that screen
 * Top. Old marks stored under view 'overview' must keep rendering under the
 * Top chip, so 'overview' is an ALIAS of 'top' everywhere a view is compared.
 * Writes keep whatever view the mark already carries (see the panel) so an
 * edit never duplicates an old mark under a new key.
 */
export const VIEW_ALIAS = Object.freeze({ overview: 'top' })
export function canonicalView(view) { return VIEW_ALIAS[view] || view }

/** A phone mark that recorded no face lands here: listed, never drawn. */
export const UNPLACED_VIEW = 'unplaced'

export function viewLabel(view) {
  if (view === UNPLACED_VIEW) return 'Position not recorded'
  const v = canonicalView(view)
  return VIEW_LABELS[v] || VIEW_LABELS[view] || view
}

// Each region: {key, label, col:[start,end], row:[start,end]} - 1-indexed CSS
// grid-line coordinates. `cols`/`rows` on the view entry size the grid itself.
const FRONT_REGIONS = [
  { key: 'windshield', label: 'Windshield', col: [1, 4], row: [1, 2] },
  { key: 'left_headlight', label: 'Left headlight', col: [1, 2], row: [2, 3] },
  { key: 'grille', label: 'Grille / bonnet', col: [2, 3], row: [2, 3] },
  { key: 'right_headlight', label: 'Right headlight', col: [3, 4], row: [2, 3] },
  { key: 'front_bumper', label: 'Front bumper', col: [1, 4], row: [3, 4] },
]
const REAR_REGIONS = [
  { key: 'rear_window', label: 'Rear window', col: [1, 4], row: [1, 2] },
  { key: 'left_taillight', label: 'Left taillight', col: [1, 2], row: [2, 3] },
  { key: 'rear_panel', label: 'Rear panel / tailgate', col: [2, 3], row: [2, 3] },
  { key: 'right_taillight', label: 'Right taillight', col: [3, 4], row: [2, 3] },
  { key: 'rear_bumper', label: 'Rear bumper', col: [1, 4], row: [3, 4] },
]
// M10 side elevation: fender, door, bumper panels.
const SIDE_REGIONS_GENERIC = [
  { key: 'roof', label: 'Roof', col: [1, 5], row: [1, 2] },
  { key: 'front_fender', label: 'Front fender', col: [1, 2], row: [2, 3] },
  { key: 'front_door', label: 'Front door', col: [2, 3], row: [2, 3] },
  { key: 'rear_door', label: 'Rear door', col: [3, 4], row: [2, 3] },
  { key: 'rear_fender', label: 'Rear fender', col: [4, 5], row: [2, 3] },
  { key: 'mirror', label: 'Mirror', col: [1, 5], row: [3, 4] },
]
// Top (plan) view of a pickup / generic on-road vehicle: bonnet, cab roof,
// load bed, with the two bumpers at the ends.
const TOP_REGIONS_GENERIC = [
  { key: 'front_bumper_top', label: 'Front bumper', col: [1, 4], row: [1, 2] },
  { key: 'bonnet', label: 'Bonnet', col: [1, 4], row: [2, 3] },
  { key: 'left_pillar', label: 'Left pillar / rail', col: [1, 2], row: [3, 5] },
  { key: 'cab_roof', label: 'Cab roof', col: [2, 3], row: [3, 4] },
  { key: 'load_bed', label: 'Load bed / rear roof', col: [2, 3], row: [4, 5] },
  { key: 'right_pillar', label: 'Right pillar / rail', col: [3, 4], row: [3, 5] },
  { key: 'rear_bumper_top', label: 'Rear bumper', col: [1, 4], row: [5, 6] },
]
const SIDE_REGIONS_BUS = [
  { key: 'roof', label: 'Roof', col: [1, 6], row: [1, 2] },
  { key: 'windows', label: 'Window band', col: [1, 6], row: [2, 3] },
  { key: 'front_panel', label: 'Front panel', col: [1, 2], row: [3, 4] },
  { key: 'mid_panel_1', label: 'Mid panel 1', col: [2, 3], row: [3, 4] },
  { key: 'mid_panel_2', label: 'Mid panel 2', col: [3, 4], row: [3, 4] },
  { key: 'mid_panel_3', label: 'Mid panel 3', col: [4, 5], row: [3, 4] },
  { key: 'rear_panel', label: 'Rear panel', col: [5, 6], row: [3, 4] },
]
// M8 Front-left 3/4 view: the front face (left column) meeting the left side
// (right columns), with the "Front-left bumper corner" the mock hatches.
const FRONT_LEFT_REGIONS_BUS = [
  { key: 'windshield', label: 'Windshield', col: [1, 2], row: [1, 3] },
  { key: 'left_a_pillar', label: 'Left A-pillar', col: [2, 3], row: [1, 3] },
  { key: 'roof_left_edge', label: 'Roof, left edge', col: [3, 6], row: [1, 2] },
  { key: 'left_windows_front', label: 'Left window band, front', col: [3, 6], row: [2, 3] },
  { key: 'left_headlight', label: 'Left headlight', col: [1, 2], row: [3, 4] },
  { key: 'left_mirror', label: 'Left mirror', col: [2, 3], row: [3, 4] },
  { key: 'front_door', label: 'Front door', col: [3, 4], row: [3, 4] },
  { key: 'left_front_panel', label: 'Left front panel', col: [4, 6], row: [3, 4] },
  { key: 'front_left_bumper_corner', label: 'Front-left bumper corner', col: [1, 3], row: [4, 5] },
  { key: 'left_front_wheel_arch', label: 'Left front wheel arch', col: [3, 6], row: [4, 5] },
]
// Bus top (plan) view: roof sections front to rear, hatches, AC unit.
const TOP_REGIONS_BUS = [
  { key: 'roof_front', label: 'Roof, front section', col: [1, 4], row: [1, 2] },
  { key: 'roof_left_rail', label: 'Roof rail, left', col: [1, 2], row: [2, 5] },
  { key: 'ac_unit', label: 'AC unit', col: [2, 3], row: [2, 3] },
  { key: 'roof_hatch', label: 'Roof hatch', col: [2, 3], row: [3, 4] },
  { key: 'roof_mid', label: 'Roof, mid section', col: [2, 3], row: [4, 5] },
  { key: 'roof_right_rail', label: 'Roof rail, right', col: [3, 4], row: [2, 5] },
  { key: 'roof_rear', label: 'Roof, rear section', col: [1, 4], row: [5, 6] },
]

// M9 blueprint-style TOP view of a truck-mounted concrete pump: boom sections
// folded over the chassis, the pump unit and hopper at the rear, the four
// outriggers at the corners. Components keep their NAMES (Boom section 1..n,
// outriggers, hopper) - these are the numbered components the mock shows.
const PUMP_COMPONENTS_TOP = [
  { key: 'outrigger_front_left', label: 'Outrigger, front left', col: [1, 2], row: [1, 2] },
  { key: 'boom_section_4', label: 'Boom section 4', col: [2, 3], row: [1, 2] },
  { key: 'boom_section_3', label: 'Boom section 3', col: [3, 4], row: [1, 2] },
  { key: 'boom_section_2', label: 'Boom section 2', col: [4, 5], row: [1, 2] },
  { key: 'outrigger_rear_left', label: 'Outrigger, rear left', col: [5, 6], row: [1, 2] },
  { key: 'chassis_cab', label: 'Chassis cab', col: [1, 2], row: [2, 3] },
  { key: 'boom_section_1', label: 'Boom section 1', col: [2, 4], row: [2, 3] },
  { key: 'boom_base', label: 'Boom base / turret', col: [4, 5], row: [2, 3] },
  { key: 'hopper', label: 'Hopper', col: [5, 6], row: [2, 3] },
  { key: 'outrigger_front_right', label: 'Outrigger, front right', col: [1, 2], row: [3, 4] },
  { key: 'deck_left', label: 'Deck / walkway', col: [2, 4], row: [3, 4] },
  { key: 'pump_unit', label: 'Pump unit', col: [4, 5], row: [3, 4] },
  { key: 'outrigger_rear_right', label: 'Outrigger, rear right', col: [5, 6], row: [3, 4] },
]
// Pump side elevation (chassis cab at the front, boom folded above the deck,
// pump unit and hopper at the rear, two outriggers on that side).
const PUMP_COMPONENTS_SIDE = [
  { key: 'boom_folded', label: 'Boom (folded)', col: [2, 6], row: [1, 2] },
  { key: 'chassis_cab', label: 'Chassis cab', col: [1, 2], row: [1, 3] },
  { key: 'boom_base', label: 'Boom base / turret', col: [2, 3], row: [2, 3] },
  { key: 'deck', label: 'Deck / walkway', col: [3, 5], row: [2, 3] },
  { key: 'hopper', label: 'Hopper', col: [5, 6], row: [2, 3] },
  { key: 'cab_step', label: 'Cab step / fuel tank', col: [1, 2], row: [3, 4] },
  { key: 'outrigger_front', label: 'Outrigger, front', col: [2, 3], row: [3, 4] },
  { key: 'chassis_rail', label: 'Chassis rail', col: [3, 4], row: [3, 4] },
  { key: 'outrigger_rear', label: 'Outrigger, rear', col: [4, 5], row: [3, 4] },
  { key: 'pump_unit', label: 'Pump unit', col: [5, 6], row: [3, 4] },
]
const PUMP_COMPONENTS_FRONT = [
  { key: 'boom_tip', label: 'Boom tip (over cab)', col: [1, 4], row: [1, 2] },
  { key: 'windshield', label: 'Windshield', col: [1, 4], row: [2, 3] },
  { key: 'left_headlight', label: 'Left headlight', col: [1, 2], row: [3, 4] },
  { key: 'grille', label: 'Grille', col: [2, 3], row: [3, 4] },
  { key: 'right_headlight', label: 'Right headlight', col: [3, 4], row: [3, 4] },
  { key: 'front_bumper', label: 'Front bumper', col: [1, 4], row: [4, 5] },
]
const PUMP_COMPONENTS_REAR = [
  { key: 'boom_base', label: 'Boom base / turret', col: [1, 4], row: [1, 2] },
  { key: 'hopper', label: 'Hopper', col: [2, 3], row: [2, 3] },
  { key: 'outrigger_rear_left', label: 'Outrigger, rear left', col: [1, 2], row: [2, 4] },
  { key: 'outrigger_rear_right', label: 'Outrigger, rear right', col: [3, 4], row: [2, 4] },
  { key: 'pump_unit', label: 'Pump unit', col: [2, 3], row: [3, 4] },
  { key: 'rear_bumper', label: 'Rear bumper / lights', col: [1, 4], row: [4, 5] },
]

const PUMP_TOP = { cols: 5, rows: 3, regions: PUMP_COMPONENTS_TOP }
const VIEW_LAYOUTS = {
  generic: {
    front: { cols: 3, rows: 3, regions: FRONT_REGIONS },
    rear: { cols: 3, rows: 3, regions: REAR_REGIONS },
    left: { cols: 4, rows: 3, regions: SIDE_REGIONS_GENERIC },
    right: { cols: 4, rows: 3, regions: SIDE_REGIONS_GENERIC },
    top: { cols: 3, rows: 5, regions: TOP_REGIONS_GENERIC },
  },
  pickup: {
    front: { cols: 3, rows: 3, regions: FRONT_REGIONS },
    rear: { cols: 3, rows: 3, regions: REAR_REGIONS },
    left: { cols: 4, rows: 3, regions: SIDE_REGIONS_GENERIC },
    right: { cols: 4, rows: 3, regions: SIDE_REGIONS_GENERIC },
    top: { cols: 3, rows: 5, regions: TOP_REGIONS_GENERIC },
  },
  bus: {
    front: { cols: 3, rows: 3, regions: FRONT_REGIONS },
    rear: { cols: 3, rows: 3, regions: REAR_REGIONS },
    left: { cols: 5, rows: 3, regions: SIDE_REGIONS_BUS },
    right: { cols: 5, rows: 3, regions: SIDE_REGIONS_BUS },
    front_left: { cols: 5, rows: 4, regions: FRONT_LEFT_REGIONS_BUS },
    top: { cols: 3, rows: 5, regions: TOP_REGIONS_BUS },
  },
  concrete_pump: {
    top: PUMP_TOP,
    overview: PUMP_TOP, // legacy alias - old marks stored under 'overview'
    left: { cols: 5, rows: 3, regions: PUMP_COMPONENTS_SIDE },
    right: { cols: 5, rows: 3, regions: PUMP_COMPONENTS_SIDE },
    front: { cols: 3, rows: 4, regions: PUMP_COMPONENTS_FRONT },
    rear: { cols: 3, rows: 4, regions: PUMP_COMPONENTS_REAR },
  },
}

/**
 * The grid layout (cols/rows/regions) for one family + view. Falls back to the
 * 'generic' family's layout for that view (or 'front' if the view itself is
 * unrecognised) so a bad combination never renders nothing.
 * @param {string} family
 * @param {string} view
 */
export function layoutFor(family, view) {
  const v = canonicalView(view)
  const byFamily = VIEW_LAYOUTS[family] || VIEW_LAYOUTS.generic
  return byFamily[v] || byFamily[view] || VIEW_LAYOUTS.generic[v] || VIEW_LAYOUTS.generic.front
}

/** The label of one region in a family+view layout, or '' when the region is
 *  not part of that layout (a stored mark whose region no longer exists
 *  falls back to its own stored label - never an invented one). */
export function regionLabel(family, view, regionKey) {
  const r = layoutFor(family, view).regions.find((x) => x.key === regionKey)
  return r ? r.label : ''
}

/** Damage level a mark carries - the accidentCaseVocab DAMAGE_LEVELS ladder,
 *  stored as the SAME lowercase tokens (minor/moderate/severe, 'severe'
 *  labelled Major). Kept under the older export name for existing callers. */
export const MARK_SEVERITIES = DAMAGE_LEVELS.map((l) => ({ value: l.key, label: l.label }))
export const SEVERITY_DOT_TONE = { minor: '#facc15', moderate: '#fb923c', severe: '#ef4444' }
export function severityLabel(sev) { return DAMAGE_LEVELS.find((l) => l.key === sev)?.label || (sev ? String(sev) : '') }
export function damageTypeLabel(type) {
  const k = canonDamageType(type)
  return DAMAGE_TYPES.find((d) => d.key === k)?.label || (type ? String(type) : '')
}

/** Build a Map keyed "view::region_key" -> mark, for O(1) hotspot lookups.
 *  The view half of the key is CANONICAL (overview -> top) so an old pump mark
 *  lights up the Top view's component. */
export function groupMarksByKey(damageAreas) {
  const map = new Map()
  for (const m of Array.isArray(damageAreas) ? damageAreas : []) {
    if (!m || !m.view || !m.region_key) continue
    map.set(markKey(m.view, m.region_key), m)
  }
  return map
}

/** The identity key a mark is looked up under (view canonicalised). */
export function markKey(view, regionKey) { return `${canonicalView(view)}::${regionKey}` }

/**
 * Number the marks 1..N in array order (the order they were recorded), which is
 * the number the marker on the diagram and the "Marked areas" list both show.
 * Returns a Map markKey -> n.
 */
export function numberMarks(damageAreas) {
  const map = new Map()
  let n = 0
  for (const m of Array.isArray(damageAreas) ? damageAreas : []) {
    if (!m || !m.view || !m.region_key) continue
    const k = markKey(m.view, m.region_key)
    if (!map.has(k)) map.set(k, ++n)
  }
  return map
}

/** Photo count on a mark - never NaN, tolerant of the phone's `photos` key. */
export function markPhotoCount(mark) {
  const refs = Array.isArray(mark?.photo_refs) ? mark.photo_refs : Array.isArray(mark?.photos) ? mark.photos : []
  return refs.length
}

/** Clamp a note to DAMAGE_NOTE_MAX characters (the mock's 0/200 counter). */
export function clampNote(note) {
  const s = String(note ?? '')
  return s.length > DAMAGE_NOTE_MAX ? s.slice(0, DAMAGE_NOTE_MAX) : s
}

/**
 * Normalise ONE mark from either source into the damage_areas shape. Tolerates
 * the phone's alternate key names (region_label vs component_label, level vs
 * severity, photos vs photo_refs). Returns null when the mark has no identity
 * (no view or no region) - such an entry is dropped, never invented into one.
 */
export function normalizeMark(raw, source) {
  if (!raw || typeof raw !== 'object') return null
  // The phone (tyre_pulse_flutter AccidentDamageMark.toJson) writes zone_id /
  // area / photo_references and MAY omit view (a mark placed on the 3D model
  // with no face recorded). A mark with no view is still a recorded fact, so
  // it is kept under the honest 'unplaced' view and listed, never drawn on a
  // face it was not made on and never dropped.
  const regionKey = String(raw.region_key || raw.regionKey || raw.component_key || raw.zone_id || raw.zoneId || '').trim()
  if (!regionKey) return null
  let view = String(raw.view || '').trim()
  if (!view) {
    if (source !== 'mobile') return null
    view = UNPLACED_VIEW
  }
  const sev = String(raw.severity || raw.level || '').trim().toLowerCase()
  const label = raw.region_label || raw.component_label || raw.label || raw.area || ''
  const photos = Array.isArray(raw.photo_refs) ? raw.photo_refs
    : Array.isArray(raw.photo_references) ? raw.photo_references
      : Array.isArray(raw.photos) ? raw.photos : []
  const out = {
    ...raw,
    view,
    region_key: regionKey,
    region_label: label,
    component_label: label,
    damage_type: canonDamageType(raw.damage_type || raw.type),
    severity: DAMAGE_LEVELS.some((l) => l.key === sev) ? sev : (sev || 'minor'),
    action: raw.action || null,
    note: clampNote(raw.note),
    photo_refs: photos.filter((p) => typeof p === 'string' && p),
  }
  if (source) out.source = source
  delete out.photos
  delete out.photo_references
  delete out.level
  delete out.area
  return out
}

/**
 * Parse accidents.damage_description as the Flutter v2 mark payload
 * {"version":2,"marks":[...]}. Anything else (free text, older versions,
 * malformed JSON) yields [] - the field is ALSO a free-text description on
 * older incidents, so a non-JSON value is normal, not an error.
 * @param {string|object|null} raw
 * @returns {object[]} normalised marks tagged source:'mobile'
 */
export function parsePhoneMarks(raw) {
  if (raw == null) return []
  let obj = raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s.startsWith('{')) return []
    try { obj = JSON.parse(s) } catch { return [] }
  }
  if (!obj || typeof obj !== 'object') return []
  if (Number(obj.version) !== 2 || !Array.isArray(obj.marks)) return []
  return obj.marks.map((m) => normalizeMark(m, 'mobile')).filter(Boolean)
}

/**
 * Merge the assessment's own marks (authoritative, written by the web) with the
 * phone's marks. The assessment wins on a shared (view, region) identity; a
 * phone-only mark is appended so it appears on web but keeps source:'mobile'
 * (the web never writes it back into damage_description).
 */
export function mergeMarks(assessmentAreas, phoneMarks) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(assessmentAreas) ? assessmentAreas : []) {
    const m = normalizeMark(raw, 'assessment')
    if (!m) continue
    seen.add(markKey(m.view, m.region_key))
    out.push(m)
  }
  for (const m of Array.isArray(phoneMarks) ? phoneMarks : []) {
    if (!m) continue
    const k = markKey(m.view, m.region_key)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(m)
  }
  return out
}
