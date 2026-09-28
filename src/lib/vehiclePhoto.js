/**
 * Class artwork for a fleet asset, shared with the Flutter app.
 *
 * Mirrors tyre_pulse_flutter/lib/features/assets/presentation/vehicle_photo_resolver.dart
 * (the same photos, re-encoded under public/vehicle-photos). Change both together.
 *
 * The picture is presentation only, never fleet data. It is chosen from the
 * type, make and model already on the record, and branded artwork is returned
 * only when the stored make or model names that brand. Anything the rules
 * cannot place returns null, so the caller draws a neutral icon instead of
 * showing the wrong machine.
 */
import { isTyrelessEquipment } from './vehicleTyreLayout'

const P = (name) => `/vehicle-photos/${name}.webp`

const norm = (v) => String(v ?? '').toLowerCase().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Leading letters of an asset number, uppercased ('TM634' -> 'TM'). */
export function assetClassOf(assetNo) {
  const m = String(assetNo ?? '').trim().match(/^[A-Za-z]+/)
  return m ? m[0].toUpperCase() : null
}

const has = (desc, list) => desc.length > 0 && list.some((w) => desc.includes(w))
const brandMissing = (make) => ['', 'n a', 'na', 'unknown'].includes(norm(make))
const genericLoader = (make, model) => {
  const id = norm([make, model].filter(Boolean).join(' '))
  return id === '' || id === 'wheel loader' || id === 'loader'
}

function kindFromKnownModel(v) {
  if (v.includes('hiace') || v.includes('hi ace')) return 'bus'
  if (['xenon', 'l200', 'triton', 'maxus t 60', 'maxus t60'].some((w) => v.includes(w))) return 'pickup'
  return null
}

function kindFromDescription(v, explicitType) {
  if (!v) return null
  if (v.includes('towable') && v.includes('pump')) return 'towablePump'
  if (isTyrelessEquipment(v)) {
    if (v.includes('generator') || v.includes('genset')) return 'generator'
    if (v.includes('chiller')) return 'chiller'
    if (v.includes('batch') || v.includes('plant')) return 'batchingPlant'
    if (v.includes('placing') && v.includes('boom')) return 'placingBoom'
    if (v.includes('stationary') && v.includes('pump')) return 'stationaryPump'
    return 'tyreless'
  }
  if (['transit mixer', 'tri mixer', 'tr mixer', 'concrete mixer'].some((w) => v.includes(w))) return 'mixer'
  if (v.includes('line pump') || (v.includes('truck mounted') && v.includes('pump'))) return 'linePump'
  if (['boom pump', 'concrete pump', 'pump truck', 'mobile pump'].some((w) => v.includes(w))) return 'concretePump'
  if (v.includes('skid loader') || v.includes('skid steer')) return 'skidLoader'
  if (v.includes('wheel loader') || v.includes('front end loader') || explicitType === 'loader') return 'wheelLoader'
  if (['pickup', 'pick up', 'double cabin', 'double cab', 'xenon'].some((w) => v.includes(w))
    || (v.includes('mitsubishi') && (v.includes('l200') || v.includes('triton')))) return 'pickup'
  if (['bus', 'coach', 'coaster', 'hiace', 'hi ace', 'minibus', 'mini bus', '32 seater', '62 seater'].some((w) => v.includes(w))) return 'bus'
  if (v.includes('trailer')) return 'trailer'
  if (['truck', 'canter', 'tanker', 'crane'].some((w) => v.includes(w))) return 'road'
  return null
}

const CLASS_KIND = {
  TM: 'mixer', CP: 'concretePump', MP: 'concretePump', LP: 'linePump', WL: 'wheelLoader', SL: 'skidLoader',
  PL: 'pickup', BH: 'bus', MB: 'bus', GN: 'generator', BP: 'batchingPlant', IP: 'tyreless',
  SP: 'stationaryPump', PB: 'placingBoom',
}

/** The visual class of an asset: mixer, bus, generator, ... or 'unknown'. */
export function vehicleKind({ asset_no, vehicle_type, make, model } = {}) {
  const known = kindFromKnownModel(norm([make, model].filter(Boolean).join(' ')))
  if (known) return known
  const desc = norm([vehicle_type, make, model].filter(Boolean).join(' '))
  return kindFromDescription(desc, norm(vehicle_type)) || CLASS_KIND[assetClassOf(asset_no)] || 'unknown'
}

/** Public path of the class photo, or null when no truthful photo exists. */
export function vehiclePhoto(row = {}) {
  const { make, model } = row
  const desc = norm([row.vehicle_type, make, model].filter(Boolean).join(' '))
  switch (vehicleKind(row)) {
    case 'mixer': return P('tri-mixer-perspective')
    case 'concretePump': return P('concrete-pump')
    case 'linePump': return P('line-pump-fleet')
    case 'wheelLoader': return has(desc, ['sany']) || genericLoader(make, model) ? P('wheel-loader-fleet') : null
    case 'skidLoader': return has(desc, ['cat', 'caterpillar', 'caterpiller', 'catapiller']) ? P('skid-loader-fleet') : null
    case 'pickup':
      if (desc.includes('mitsubishi')) return P('mitsubishi-double-cab-front')
      if (desc.includes('tata') || desc.includes('xenon')) return P('tata-xenon-double-cab')
      return null
    case 'bus':
      if (desc.includes('hiace') || desc.includes('hi ace')) return P('hiace-fleet')
      if (desc.includes('ashok')) return P('ashok-bus-fleet')
      if (desc.includes('tata')) return P('tata-bus-fleet')
      return brandMissing(make) ? P('staff-bus') : null
    case 'generator': return has(desc, ['sany']) ? P('generator-fleet') : null
    case 'chiller':
      if (desc.includes('industrial') || desc.includes('water chiller') || desc.includes('lg')) {
        return has(desc, ['lg']) ? P('industrial-chiller-fleet') : null
      }
      return has(desc, ['snowkey']) ? P('chiller-fleet') : null
    case 'batchingPlant': return has(desc, ['sany']) ? P('batching-plant-fleet') : null
    case 'placingBoom': return has(desc, ['hamac']) ? P('placing-boom-vertical') : null
    case 'stationaryPump': return has(desc, ['sany']) ? P('stationary-pump-fleet') : null
    case 'towablePump': return has(desc, ['sany']) ? P('towable-pump-fleet') : null
    default: return null
  }
}

/** Human category label for a kind, used by composition charts and table cells. */
export const KIND_LABEL = {
  mixer: 'Transit Mixer', concretePump: 'Concrete Pump', linePump: 'Line Pump', wheelLoader: 'Wheel Loader',
  skidLoader: 'Skid Loader', pickup: 'Light Vehicle', bus: 'Bus', trailer: 'Trailer', road: 'Truck',
  generator: 'Generator', chiller: 'Chiller', batchingPlant: 'Batching Plant', placingBoom: 'Placing Boom',
  stationaryPump: 'Stationary Pump', towablePump: 'Towable Pump', tyreless: 'Plant & Equipment', unknown: 'Other',
}
