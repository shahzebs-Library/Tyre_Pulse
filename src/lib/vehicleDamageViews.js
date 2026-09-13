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
 * functional diagram rather than a traced vehicle silhouette this codebase has
 * no source art for. Region/component names are the thing that carries the
 * information; their on-screen position is illustrative, not to scale.
 */

/** Vehicle "families" this tool knows a layout for; anything else falls back
 *  to 'generic'. Matched case-insensitively against vehicle_fleet.vehicle_type. */
export const FAMILIES = ['bus', 'pickup', 'concrete_pump', 'generic']

const FAMILY_PATTERNS = [
  { family: 'bus', re: /bus/i },
  { family: 'concrete_pump', re: /concrete.?pump|placing.?boom|boom.?pump|pump.?truck/i },
  { family: 'pickup', re: /pick.?up/i },
]

/**
 * Resolve a fleet `vehicle_type` string to one of FAMILIES. Unknown/blank
 * types resolve to 'generic' - a reasonable 4-view layout that applies to
 * most on-road vehicles, rather than pretending to know a type it does not.
 * @param {string} vehicleType
 * @returns {'bus'|'pickup'|'concrete_pump'|'generic'}
 */
export function familyForVehicleType(vehicleType) {
  const s = String(vehicleType ?? '')
  for (const { family, re } of FAMILY_PATTERNS) {
    if (re.test(s)) return family
  }
  return 'generic'
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
