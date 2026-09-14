/**
 * vehicleDamageViews.js — pure data + helpers behind the "Mark vehicle/
 * equipment damage" tool (the multi-view / component-tapping mockups). No I/O;
 * the panel component (DamageMapPanel.jsx) is the only caller.
 *
 * Marks are stored as entries in accident_damage_assessments.damage_areas
 * (jsonb; see accidentDamageAssessment.js's upsertDamageMark/removeDamageMark),
 * a deliberate reuse of the existing column rather than a new table/migration -
 * the plan's own recommendation, confirmed by the layout already built for it
 * in step 1. A mark's identity is (view, region_key), matching
 * upsertDamageMark's own upsert key exactly.
 *
 * DIAGRAMS ARE DELIBERATELY ABSTRACT, NOT PHOTOREALISTIC. Each view is a small
 * CSS-grid "floor plan" of named, clickable cells - honest about being a
 * functional diagram rather than a traced vehicle silhouette. The REAL vehicle
 * picture for the asset (correct body art per type) is shown separately by
 * DamageMapPanel via VehicleTyreDiagram, for visual confirmation; this grid is
 * only the click surface for recording a mark.
 *
 * FAMILY RESOLUTION DELEGATES TO src/lib/vehicleTyreLayout.js - THE single,
 * fleet-owner-confirmed classifier the rest of the app already uses for "what
 * shape is this machine". Do NOT re-inline a second vehicle-type keyword list
 * here: that is exactly the drift that once collapsed the whole pump family
 * onto the wrong body (see vehicleTyreLayout.js's own header). It also lets a
 * blank/junk `vehicle_type` fall back to the ASSET NUMBER (TM.../MP.../WL...),
 * which this file's own resolver never could.
 */
import { resolveLayoutKey, isTyrelessEquipment } from './vehicleTyreLayout'

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

/** View keys per family, in the order they should be offered/rotated through. */
export const FAMILY_VIEWS = {
  generic: ['front', 'left', 'right', 'rear'],
  pickup: ['front', 'left', 'right', 'rear'],
  bus: ['front', 'left', 'right', 'rear'],
  concrete_pump: ['overview'],
}

const VIEW_LABEL = { front: 'Front', left: 'Left side', right: 'Right side', rear: 'Rear', overview: 'Overview' }
export function viewLabel(view) { return VIEW_LABEL[view] || view }

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
const SIDE_REGIONS_GENERIC = [
  { key: 'roof', label: 'Roof', col: [1, 5], row: [1, 2] },
  { key: 'front_fender', label: 'Front fender', col: [1, 2], row: [2, 3] },
  { key: 'front_door', label: 'Front door', col: [2, 3], row: [2, 3] },
  { key: 'rear_door', label: 'Rear door', col: [3, 4], row: [2, 3] },
  { key: 'rear_fender', label: 'Rear fender', col: [4, 5], row: [2, 3] },
  { key: 'mirror', label: 'Mirror', col: [1, 5], row: [3, 4] },
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
const PUMP_COMPONENTS = [
  { key: 'boom_base', label: 'Boom base', col: [1, 2], row: [1, 2] },
  { key: 'boom_section_1', label: 'Boom section 1', col: [2, 3], row: [1, 2] },
  { key: 'boom_section_2', label: 'Boom section 2', col: [3, 4], row: [1, 2] },
  { key: 'boom_section_3', label: 'Boom section 3', col: [4, 5], row: [1, 2] },
  { key: 'boom_section_4', label: 'Boom section 4', col: [5, 6], row: [1, 2] },
  { key: 'chassis_cab', label: 'Chassis cab', col: [1, 3], row: [2, 3] },
  { key: 'pump_unit', label: 'Pump unit', col: [3, 4], row: [2, 3] },
  { key: 'hopper', label: 'Hopper', col: [4, 6], row: [2, 3] },
  { key: 'outrigger_front_left', label: 'Outrigger, front left', col: [1, 2], row: [3, 4] },
  { key: 'outrigger_rear_left', label: 'Outrigger, rear left', col: [2, 3], row: [3, 4] },
  { key: 'outrigger_rear_right', label: 'Outrigger, rear right', col: [4, 5], row: [3, 4] },
  { key: 'outrigger_front_right', label: 'Outrigger, front right', col: [5, 6], row: [3, 4] },
]

const VIEW_LAYOUTS = {
  generic: {
    front: { cols: 3, rows: 3, regions: FRONT_REGIONS },
    rear: { cols: 3, rows: 3, regions: REAR_REGIONS },
    left: { cols: 4, rows: 3, regions: SIDE_REGIONS_GENERIC },
    right: { cols: 4, rows: 3, regions: SIDE_REGIONS_GENERIC },
  },
  pickup: {
    front: { cols: 3, rows: 3, regions: FRONT_REGIONS },
    rear: { cols: 3, rows: 3, regions: REAR_REGIONS },
    left: { cols: 4, rows: 3, regions: SIDE_REGIONS_GENERIC },
    right: { cols: 4, rows: 3, regions: SIDE_REGIONS_GENERIC },
  },
  bus: {
    front: { cols: 3, rows: 3, regions: FRONT_REGIONS },
    rear: { cols: 3, rows: 3, regions: REAR_REGIONS },
    left: { cols: 5, rows: 3, regions: SIDE_REGIONS_BUS },
    right: { cols: 5, rows: 3, regions: SIDE_REGIONS_BUS },
  },
  concrete_pump: {
    overview: { cols: 5, rows: 3, regions: PUMP_COMPONENTS },
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
  const byFamily = VIEW_LAYOUTS[family] || VIEW_LAYOUTS.generic
  return byFamily[view] || VIEW_LAYOUTS.generic[view] || VIEW_LAYOUTS.generic.front
}

/** Damage severity a mark carries - shares the app's Minor/Moderate/Major
 *  ladder (accidentVocab.js SEVERITIES), stored as the same lowercase tokens
 *  (toDbSeverity: minor/moderate/severe) so nothing invents a fourth
 *  vocabulary for what is, semantically, the same idea at a finer grain. */
export const MARK_SEVERITIES = [
  { value: 'minor', label: 'Minor' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Major' },
]
export const SEVERITY_DOT_TONE = { minor: '#facc15', moderate: '#fb923c', severe: '#ef4444' }

/** Build a Map keyed "view::region_key" -> mark, for O(1) hotspot lookups. */
export function groupMarksByKey(damageAreas) {
  const map = new Map()
  for (const m of Array.isArray(damageAreas) ? damageAreas : []) {
    if (!m || !m.view || !m.region_key) continue
    map.set(`${m.view}::${m.region_key}`, m)
  }
  return map
}

/** The identity key a mark is upserted/looked-up under. */
export function markKey(view, regionKey) { return `${view}::${regionKey}` }
