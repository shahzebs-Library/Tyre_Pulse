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
 * THE DRAWING SURFACE IS THE ASSET'S OWN ARTWORK. The panel renders the same
 * five-view vehicle board the phone shows (src/lib/vehicleArtwork.js) with the
 * component rectangles from src/lib/vehicleDamageZones.js placed on top, so a
 * component tapped here is the component tapped there. THIS FILE OWNS THE MARK
 * MODEL ONLY - identity, merging, numbering, labels, vocabulary. It holds no
 * geometry: asking it for a rectangle is how a second, drifting component
 * catalog gets started.
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

/**
 * The five artwork faces every catalog board ships. Mirrors the Dart
 * `AccidentDamageView` enum, which is what the zone catalogs are keyed on.
 */
export const ARTWORK_VIEWS = Object.freeze(['front', 'rear', 'left', 'right', 'top'])

/**
 * The artwork face a view chip is captured on. Mirrors the Dart
 * `AccidentDamagePerspective.baseView`: the mock's angled "Front-left" chip is
 * a perspective on the FRONT artwork, not a sixth image, and the legacy pump
 * 'overview' is the Top face. A chip with no face of its own (an unplaced
 * phone mark) returns null so the caller can say so instead of drawing it on a
 * face it was never made on.
 */
export function baseViewFor(view) {
  if (view === 'front_left') return 'front'
  const v = canonicalView(view)
  return ARTWORK_VIEWS.includes(v) ? v : null
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
