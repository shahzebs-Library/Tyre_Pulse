/**
 * Which vehicle artwork represents a real fleet asset.
 *
 * A faithful port of the Flutter resolver
 * `tyre_pulse_flutter/lib/features/assets/presentation/vehicle_photo_resolver.dart`
 * (`vehicleMultiViewAssetFor` and everything it calls) plus its catalog
 * `vehicle_multiview_catalog.dart`, so the web resolves the SAME five-view
 * board the phone does for the same asset row.
 *
 * The artwork is presentation only. It is never treated as fleet data: it is a
 * visual class illustration chosen from the make / model / type already stored
 * on the asset. Several branches DELIBERATELY return null (a concrete pump
 * whose axle count is not proven, a wheel loader that is not a SANY, a pickup
 * that names a brand we hold no board for). Returning nothing is correct there
 * and the caller must render an honest empty state; showing the wrong body is
 * worse than showing none.
 *
 * Pure module: no React, no network, no DOM.
 */
import { ZONE_CATALOGS, ZONE_LABELS } from './vehicleDamageZones'

/** Web location of the per-view images copied out of the Flutter bundle. */
export const VEHICLE_VIEW_BASE_PATH = '/vehicle-views'

/** The five views every catalog board provides. */
export const VEHICLE_VIEWS = ['front', 'rear', 'left', 'right', 'top']

/**
 * The five-view catalog, id -> file stem.
 *
 * Mirrors `kVehicleMultiViewCatalog`; the stem is the Flutter `assetPath`
 * basename without its extension, which is how the per-view PNGs under
 * `public/vehicle-views/` are named (`<stem>_<view>.png`).
 */
export const VEHICLE_MULTIVIEW_CATALOG = Object.freeze({
  'transit-mixer-3axle': {
    stem: 'transit_mixer_3axle_five_view_v1',
    label: 'Transit mixer',
    make: 'Fleet reference',
    tyreBearing: true,
    axleCount: 3,
  },
  'sany-concrete-pump-5axle': {
    stem: 'sany_concrete_pump_5axle_five_view_v1',
    label: 'Concrete pump, 5 axle',
    make: 'SANY',
    tyreBearing: true,
    axleCount: 5,
  },
  'white-concrete-pump-4axle': {
    stem: 'white_concrete_pump_4axle_five_view_v1',
    label: 'Concrete pump, 4 axle',
    make: 'Fleet reference',
    tyreBearing: true,
    axleCount: 4,
  },
  'line-pump-4axle': {
    stem: 'line_pump_4axle_five_view_v1',
    label: 'Truck-mounted line pump, 4 axle',
    make: 'Fleet reference',
    tyreBearing: true,
    axleCount: 4,
  },
  'ashok-leyland-bus': {
    stem: 'ashok_leyland_bus_five_view_v1',
    label: 'Staff bus',
    make: 'Ashok Leyland',
    tyreBearing: true,
    axleCount: 2,
  },
  'tata-staff-bus': {
    stem: 'tata_staff_bus_five_view_v1',
    label: 'Staff bus',
    make: 'Tata',
    tyreBearing: true,
    axleCount: 2,
  },
  'toyota-hiace': {
    stem: 'toyota_hiace_five_view_v1',
    label: 'Hiace staff van',
    make: 'Toyota',
    tyreBearing: true,
    axleCount: 2,
  },
  'generic-staff-bus': {
    stem: 'generic_staff_bus_five_view_v1',
    label: 'Staff bus',
    make: 'Unspecified',
    tyreBearing: true,
    axleCount: 2,
  },
  'mitsubishi-double-cab': {
    stem: 'mitsubishi_double_cab_five_view_v1',
    label: 'Double-cab pickup',
    make: 'Mitsubishi',
    tyreBearing: true,
    axleCount: 2,
  },
  'tata-xenon-double-cab': {
    stem: 'tata_xenon_double_cab_five_view_v1',
    label: 'Double-cab pickup',
    make: 'Tata Xenon',
    tyreBearing: true,
    axleCount: 2,
  },
  'generic-double-cab': {
    stem: 'generic_double_cab_five_view_v1',
    label: 'Double-cab pickup',
    make: 'Unspecified',
    tyreBearing: true,
    axleCount: 2,
  },
  'sany-wheel-loader': {
    stem: 'sany_wheel_loader_five_view_v1',
    label: 'Wheel loader',
    make: 'SANY',
    tyreBearing: true,
    axleCount: 2,
  },
  'cat-skid-loader': {
    stem: 'cat_skid_loader_five_view_v1',
    label: 'Skid-steer loader',
    make: 'CAT',
    tyreBearing: true,
    axleCount: 2,
  },
  'sany-towable-pump': {
    stem: 'sany_towable_pump_five_view_v1',
    label: 'Towable concrete pump',
    make: 'SANY',
    tyreBearing: true,
    axleCount: 1,
  },
  'sany-stationary-pump': {
    stem: 'sany_stationary_pump_five_view_v1',
    label: 'Stationary concrete pump',
    make: 'SANY',
    tyreBearing: true,
    axleCount: 1,
  },
  'sany-generator': {
    stem: 'sany_generator_five_view_v1',
    label: 'Enclosed generator',
    make: 'SANY',
    tyreBearing: false,
    axleCount: null,
  },
  'snowkey-chiller': {
    stem: 'snowkey_chiller_five_view_v1',
    label: 'Industrial chiller',
    make: 'Snowkey',
    tyreBearing: false,
    axleCount: null,
  },
  'industrial-chiller': {
    stem: 'industrial_chiller_five_view_v1',
    label: 'Industrial water chiller',
    make: 'LG reference',
    tyreBearing: false,
    axleCount: null,
  },
  'sany-batching-plant': {
    stem: 'sany_batching_plant_five_view_v1',
    label: 'Concrete batching plant',
    make: 'SANY',
    tyreBearing: false,
    axleCount: null,
  },
  'placing-boom': {
    stem: 'placing_boom_five_view_v1',
    label: 'Freestanding placing boom',
    make: 'HAMAC reference',
    tyreBearing: false,
    axleCount: null,
  },
})

/** Visual classes the resolver can reach. Mirrors `_VehicleVisualKind`. */
export const VISUAL_KIND = Object.freeze({
  mixer: 'mixer',
  concretePump: 'concretePump',
  linePump: 'linePump',
  wheelLoader: 'wheelLoader',
  skidLoader: 'skidLoader',
  pickup: 'pickup',
  bus: 'bus',
  trailer: 'trailer',
  generator: 'generator',
  chiller: 'chiller',
  batchingPlant: 'batchingPlant',
  placingBoom: 'placingBoom',
  stationaryPump: 'stationaryPump',
  towablePump: 'towablePump',
  genericRoadVehicle: 'genericRoadVehicle',
  tyrelessEquipment: 'tyrelessEquipment',
  unknown: 'unknown',
})

/**
 * Equipment that carries no tyres at all. Mirrors `kNoTyreEquipmentKeywords`
 * (and through it the `NO_TYRE_EQUIPMENT` list the rest of the app uses).
 * Matching here short-circuits the whole road-vehicle keyword chain, so a
 * placing boom or a stationary pump can never borrow truck artwork.
 */
export const NO_TYRE_EQUIPMENT_KEYWORDS = Object.freeze([
  'generator',
  'genset',
  'chiller',
  'reclaimer',
  'compressor',
  'tower light',
  'light tower',
  // ANY plant is a fixed installation: bt-plant, ice plant, batching plant,
  // water treatment plant. One word covers every spelling.
  'plant',
  'batch',
  // A placing boom is mast-mounted concrete placing gear, not a vehicle.
  'placing boom',
  'placing',
  // A stationary pump is skid-mounted concrete pumping gear with NO wheels.
  'stationary',
  'building',
])

const LEADING_LETTERS = /^[A-Za-z]+/

/** Lowercase, fold `- _ /` to spaces, collapse runs, trim. Mirrors `_normalise`. */
export function normaliseText(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Leading letters of an asset number, uppercased. Mirrors `assetClassOf`. */
export function assetClassOf(assetNo) {
  const trimmed = String(assetNo == null ? '' : assetNo).trim()
  const match = LEADING_LETTERS.exec(trimmed)
  return match ? match[0].toUpperCase() : null
}

/** Whether a description names equipment with no tyres. Mirrors `isTyrelessEquipment`. */
export function isTyrelessEquipment(value) {
  if (value == null || value === '') return false
  const s = String(value).toLowerCase().trim()
  return NO_TYRE_EQUIPMENT_KEYWORDS.some((k) => s.includes(k))
}

/** type + make + model, normalised. Mirrors `_searchableVehicleDescriptionFor`. */
export function searchableVehicleDescription({ vehicleType, make, model } = {}) {
  return normaliseText([vehicleType, make, model].filter((v) => typeof v === 'string').join(' '))
}

/** Mirrors `_mentionsAxleCount`. */
function mentionsAxleCount(description, count) {
  const word = count === 4 ? 'four' : count === 5 ? 'five' : String(count)
  return (
    description.includes(`${count} axle`) ||
    description.includes(`${count}axle`) ||
    description.includes(`${word} axle`)
  )
}

/** Mirrors `_matchesIdentity`: a non-empty description containing any accepted identity. */
function matchesIdentity(description, acceptedIdentities) {
  return description.length > 0 && acceptedIdentities.some((id) => description.includes(id))
}

/** Mirrors `_brandIsMissing`. */
function brandIsMissing(make) {
  const normalised = normaliseText(make)
  return normalised === '' || normalised === 'n a' || normalised === 'na' || normalised === 'unknown'
}

/** Mirrors `_isGenericWheelLoaderIdentity`. */
function isGenericWheelLoaderIdentity({ make, model } = {}) {
  const identity = normaliseText([make, model].filter((v) => typeof v === 'string').join(' '))
  return identity === '' || identity === 'wheel loader' || identity === 'loader'
}

/**
 * Mirrors `_kindFromKnownMakeOrModel`.
 *
 * A model identity is stronger than a broad legacy type imported from an old
 * spreadsheet. Deliberately a short allow-list of models present in the
 * verified fleet data, not a heuristic classifier.
 */
function kindFromKnownMakeOrModel(value) {
  if (value.includes('hiace') || value.includes('hi ace')) return VISUAL_KIND.bus
  if (
    value.includes('xenon') ||
    value.includes('l200') ||
    value.includes('triton') ||
    value.includes('maxus t 60') ||
    value.includes('maxus t60')
  ) {
    return VISUAL_KIND.pickup
  }
  return null
}

/** Mirrors `_kindFromDescription`. The order of these checks is load bearing. */
function kindFromDescription(value, explicitVehicleType) {
  if (value.length === 0) return null

  if (value.includes('towable') && value.includes('pump')) return VISUAL_KIND.towablePump

  // This check must precede every pump / plant keyword.
  if (isTyrelessEquipment(value)) {
    if (value.includes('generator') || value.includes('genset')) return VISUAL_KIND.generator
    if (value.includes('chiller')) return VISUAL_KIND.chiller
    if (value.includes('batch') || value.includes('plant')) return VISUAL_KIND.batchingPlant
    if (value.includes('placing') && value.includes('boom')) return VISUAL_KIND.placingBoom
    if (value.includes('stationary') && value.includes('pump')) return VISUAL_KIND.stationaryPump
    return VISUAL_KIND.tyrelessEquipment
  }
  if (
    value.includes('transit mixer') ||
    value.includes('tri mixer') ||
    value.includes('tr mixer') ||
    value.includes('concrete mixer')
  ) {
    return VISUAL_KIND.mixer
  }
  if (value.includes('line pump') || (value.includes('truck mounted') && value.includes('pump'))) {
    return VISUAL_KIND.linePump
  }
  if (
    value.includes('boom pump') ||
    value.includes('concrete pump') ||
    value.includes('pump truck') ||
    value.includes('mobile pump')
  ) {
    return VISUAL_KIND.concretePump
  }
  if (value.includes('skid loader') || value.includes('skid steer')) return VISUAL_KIND.skidLoader
  if (
    value.includes('wheel loader') ||
    value.includes('front end loader') ||
    explicitVehicleType === 'loader'
  ) {
    return VISUAL_KIND.wheelLoader
  }
  if (
    value.includes('pickup') ||
    value.includes('pick up') ||
    value.includes('double cabin') ||
    value.includes('double cab') ||
    value.includes('xenon') ||
    (value.includes('mitsubishi') && (value.includes('l200') || value.includes('triton')))
  ) {
    return VISUAL_KIND.pickup
  }
  if (
    value.includes('bus') ||
    value.includes('coach') ||
    value.includes('coaster') ||
    value.includes('hiace') ||
    value.includes('hi ace') ||
    value.includes('minibus') ||
    value.includes('mini bus') ||
    value.includes('32 seater') ||
    value.includes('62 seater')
  ) {
    return VISUAL_KIND.bus
  }
  if (value.includes('trailer')) return VISUAL_KIND.trailer
  if (
    value.includes('truck') ||
    value.includes('canter') ||
    value.includes('tanker') ||
    value.includes('crane')
  ) {
    return VISUAL_KIND.genericRoadVehicle
  }
  return null
}

/**
 * The visual class for an asset. Mirrors `_vehicleVisualKindFor`.
 *
 * Make and model are considered BEFORE a broad imported type, then the full
 * description, and only then the asset-number class prefix.
 */
export function vehicleVisualKind({ assetNo, vehicleType, make, model } = {}) {
  const makeAndModel = normaliseText([make, model].filter((v) => typeof v === 'string').join(' '))
  const identifiedModel = kindFromKnownMakeOrModel(makeAndModel)
  if (identifiedModel != null) return identifiedModel

  const description = searchableVehicleDescription({ vehicleType, make, model })
  const described = kindFromDescription(description, normaliseText(vehicleType))
  if (described != null) return described

  switch (assetClassOf(assetNo)) {
    case 'TM':
      return VISUAL_KIND.mixer
    case 'CP':
    case 'MP':
      return VISUAL_KIND.concretePump
    case 'LP':
      return VISUAL_KIND.linePump
    case 'WL':
      return VISUAL_KIND.wheelLoader
    case 'SL':
      return VISUAL_KIND.skidLoader
    case 'PL':
      return VISUAL_KIND.pickup
    case 'BH':
    case 'MB':
      return VISUAL_KIND.bus
    case 'GN':
      return VISUAL_KIND.generator
    case 'BP':
      return VISUAL_KIND.batchingPlant
    case 'IP':
      return VISUAL_KIND.tyrelessEquipment
    case 'SP':
      return VISUAL_KIND.stationaryPump
    case 'PB':
      return VISUAL_KIND.placingBoom
    default:
      return VISUAL_KIND.unknown
  }
}

/** Catalog id -> file stem, or null for an id the catalog does not carry. */
export function catalogStem(id) {
  const entry = VEHICLE_MULTIVIEW_CATALOG[id]
  return entry ? entry.stem : null
}

/**
 * The catalog id of the five-view board for an asset, or null.
 *
 * Mirrors `vehicleMultiViewAssetFor` branch for branch, including every
 * deliberate null.
 */
export function artworkCatalogIdFor({ assetNo, vehicleType, make, model } = {}) {
  const description = searchableVehicleDescription({ vehicleType, make, model })

  switch (vehicleVisualKind({ assetNo, vehicleType, make, model })) {
    case VISUAL_KIND.mixer:
      return 'transit-mixer-3axle'
    case VISUAL_KIND.concretePump:
      if (mentionsAxleCount(description, 4)) return 'white-concrete-pump-4axle'
      if (mentionsAxleCount(description, 5) || description.includes('sany')) {
        if (!matchesIdentity(description, ['sany'])) return null
        return 'sany-concrete-pump-5axle'
      }
      // The class alone does not prove which of the two incompatible pump
      // bodies is installed. No board is safer than inventing an axle count
      // for inspection or accident marking.
      return null
    case VISUAL_KIND.linePump:
      return 'line-pump-4axle'
    case VISUAL_KIND.wheelLoader:
      if (!matchesIdentity(description, ['sany']) && !isGenericWheelLoaderIdentity({ make, model })) {
        return null
      }
      return 'sany-wheel-loader'
    case VISUAL_KIND.skidLoader:
      if (!matchesIdentity(description, ['cat', 'caterpillar', 'caterpiller', 'catapiller'])) {
        return null
      }
      return 'cat-skid-loader'
    case VISUAL_KIND.pickup:
      if (description.includes('mitsubishi')) return 'mitsubishi-double-cab'
      if (description.includes('tata') || description.includes('xenon')) {
        return 'tata-xenon-double-cab'
      }
      return brandIsMissing(make) ? 'generic-double-cab' : null
    case VISUAL_KIND.bus:
      if (description.includes('hiace') || description.includes('hi ace')) return 'toyota-hiace'
      if (description.includes('ashok')) return 'ashok-leyland-bus'
      if (description.includes('tata')) return 'tata-staff-bus'
      return brandIsMissing(make) ? 'generic-staff-bus' : null
    case VISUAL_KIND.generator:
      if (!matchesIdentity(description, ['sany'])) return null
      return 'sany-generator'
    case VISUAL_KIND.chiller:
      if (
        description.includes('industrial') ||
        description.includes('water chiller') ||
        description.includes('lg')
      ) {
        if (!matchesIdentity(description, ['lg'])) return null
        return 'industrial-chiller'
      }
      if (!matchesIdentity(description, ['snowkey'])) return null
      return 'snowkey-chiller'
    case VISUAL_KIND.batchingPlant:
      if (!matchesIdentity(description, ['sany'])) return null
      return 'sany-batching-plant'
    case VISUAL_KIND.placingBoom:
      if (!matchesIdentity(description, ['hamac'])) return null
      return 'placing-boom'
    case VISUAL_KIND.stationaryPump:
      if (!matchesIdentity(description, ['sany'])) return null
      return 'sany-stationary-pump'
    case VISUAL_KIND.towablePump:
      if (!matchesIdentity(description, ['sany'])) return null
      return 'sany-towable-pump'
    default:
      // trailer, genericRoadVehicle, tyrelessEquipment, unknown: there is no
      // truthful board for these classes in the current bundle. The caller
      // renders the class-appropriate empty state rather than borrowing
      // artwork from a materially different asset.
      return null
  }
}

/**
 * The file stem of the five-view board for an asset, or null when no board
 * truthfully represents it.
 */
export function artworkStemFor({ assetNo, vehicleType, make, model } = {}) {
  return catalogStem(artworkCatalogIdFor({ assetNo, vehicleType, make, model }))
}

/**
 * The web URL of one view of an asset's artwork, or null.
 *
 * Returns null for an asset with no board AND for a view name outside
 * [VEHICLE_VIEWS], so a typo can never produce a broken image URL.
 */
export function vehicleViewImage({ assetNo, vehicleType, make, model } = {}, view) {
  if (!VEHICLE_VIEWS.includes(view)) return null
  const stem = artworkStemFor({ assetNo, vehicleType, make, model })
  return stem ? `${VEHICLE_VIEW_BASE_PATH}/${stem}_${view}.png` : null
}

/** Every view URL for an asset, or null when it has no board. */
export function vehicleViewImages({ assetNo, vehicleType, make, model } = {}) {
  const stem = artworkStemFor({ assetNo, vehicleType, make, model })
  if (!stem) return null
  const out = {}
  for (const view of VEHICLE_VIEWS) out[view] = `${VEHICLE_VIEW_BASE_PATH}/${stem}_${view}.png`
  return out
}

/* ------------------------------------------------------------------ *
 * Damage-zone geometry: which component rectangles belong on a board.
 * ------------------------------------------------------------------ */

/**
 * The geometry families in [ZONE_CATALOGS]. Mirrors the Dart enum
 * `AccidentDamageAssetClass`.
 *
 * A road vehicle, a concrete pump and a wheel loader do not share body parts,
 * so a tap on a visible lamp, bucket or equipment panel must not be read
 * through another class's rectangles.
 */
export const DAMAGE_ASSET_CLASSES = Object.freeze([
  'roadVehicle', 'bus', 'heavyTruck', 'loader', 'fixedEquipment', 'legacy',
])

const LOADER_ASSET_RE = /(^|\s)(wl|sl)\s*\d/
const HEAVY_TRUCK_ASSET_RE = /(^|\s)(cp|mp|lp|tm)\s*\d/

/**
 * Which zone catalog an asset's components are drawn from. A faithful port of
 * `accidentDamageAssetClassFor`, keyword for keyword and in the same order, so
 * a mark placed on the phone lands on the same component here.
 *
 * Resolved from verified asset-master fields only. An unrecognised record
 * DELIBERATELY falls to 'legacy' - the older generic rectangles keep an
 * existing draft editable without pretending the asset is another class.
 */
export function damageAssetClassFor({ assetNo, vehicleType, make, model } = {}) {
  const value = normaliseText(
    [assetNo, vehicleType, make, model].filter((v) => typeof v === 'string').join(' '),
  )
  if (
    value.includes('wheel loader') ||
    value.includes('skid loader') ||
    value.includes('skid steer') ||
    LOADER_ASSET_RE.test(value)
  ) {
    return 'loader'
  }
  if (
    value.includes('chiller') ||
    value.includes('generator') ||
    value.includes('genset') ||
    value.includes('batching plant') ||
    value.includes('placing boom') ||
    value.includes('stationary pump')
  ) {
    return 'fixedEquipment'
  }
  if (
    value.includes('concrete pump') ||
    value.includes('line pump') ||
    value.includes('transit mixer') ||
    value.includes('concrete mixer') ||
    value.includes('pump truck') ||
    HEAVY_TRUCK_ASSET_RE.test(value)
  ) {
    return 'heavyTruck'
  }
  if (
    value.includes('bus') ||
    value.includes('coach') ||
    value.includes('hiace') ||
    value.includes('hi ace') ||
    value.includes('coaster') ||
    value.includes('seater')
  ) {
    return 'bus'
  }
  if (
    value.includes('pickup') ||
    value.includes('pick up') ||
    value.includes('double cab') ||
    value.includes('double cabin') ||
    value.includes('xenon') ||
    value.includes('l200') ||
    value.includes('triton')
  ) {
    return 'roadVehicle'
  }
  return 'legacy'
}

/** Every zone of one damage asset class (unknown class -> the legacy set). */
export function damageZonesForClass(assetClass) {
  return ZONE_CATALOGS[assetClass] || ZONE_CATALOGS.legacy
}

/**
 * The component rectangles to draw on one view of an asset's artwork.
 *
 * `view` is an ARTWORK view (one of [VEHICLE_VIEWS]); the caller resolves an
 * angled perspective such as `front_left` to its base view first (see
 * `baseViewFor` in vehicleDamageViews.js). A view the class has no zones for
 * returns [] - an honest empty face, never another view's parts.
 */
export function damageZonesFor(vehicle, view) {
  return damageZonesForClass(damageAssetClassFor(vehicle)).filter((z) => z.view === view)
}

/**
 * The component name for a zone id, or '' when the catalog does not carry it.
 * Never an invented label: a stored mark whose zone is gone falls back to its
 * own recorded label.
 */
export function zoneLabel(zoneId) {
  return ZONE_LABELS[zoneId] || ''
}
