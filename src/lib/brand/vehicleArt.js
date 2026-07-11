/**
 * vehicleArt — map a free-text `vehicle_type` to a registered
 * `vehicle/*` illustration name from the Tyre Pulse illustration system.
 *
 *   import { vehicleArt } from '@/lib/brand/vehicleArt'
 *   <Illustration name={vehicleArt(row.vehicle_type)} size={120} />
 *
 * The real fleet's `vehicle_type` values are messy free text (Excel/ERP
 * imports, mixed casing, synonyms, separators). This helper normalises the
 * input and resolves it to the closest silhouette, always returning a valid
 * name so callers never have to guard the illustration lookup.
 *
 * Pure + side-effect free — safe to call in render.
 */

/** Fallback silhouette when the type is missing or unrecognised. */
const DEFAULT_ART = 'vehicle/rigid-truck'

/**
 * Ordered keyword → art rules. Order matters: the FIRST rule whose keyword is
 * found in the normalised string wins, so more specific / compound types are
 * listed before broader ones (e.g. `low-loader` before `loader`/`trailer`,
 * `semi`/`artic` before a bare `trailer`, `reefer` before generic `van`).
 * Each `keywords` entry is matched with a word-ish substring test.
 */
const RULES = [
  { art: 'vehicle/low-loader',      keywords: ['low-loader', 'low loader', 'lowloader', 'lowboy', 'low bed', 'lowbed', 'float'] },
  { art: 'vehicle/trailer-flatbed', keywords: ['flatbed', 'flat bed', 'flat-bed', 'platform trailer', 'flat'] },
  { art: 'vehicle/reefer',          keywords: ['reefer', 'refrigerated', 'refrigerator', 'fridge', 'chiller trailer', 'cold chain'] },
  { art: 'vehicle/tanker',         keywords: ['tanker', 'tank', 'fuel bowser', 'bowser', 'water carrier'] },
  { art: 'vehicle/tipper',          keywords: ['tipper', 'dump', 'dumper', 'dump truck', 'skip'] },
  { art: 'vehicle/semi-articulated', keywords: ['semi', 'artic', 'articulated', 'tractor unit', 'tractor-unit', 'prime mover', 'primemover', 'curtain', 'hgv', '18 wheeler', '18-wheeler'] },
  { art: 'vehicle/coach',           keywords: ['coach', 'touring'] },
  { art: 'vehicle/bus',             keywords: ['bus', 'minibus', 'mini bus', 'coaster', 'shuttle'] },
  { art: 'vehicle/pickup',          keywords: ['pickup', 'pick up', 'pick-up', 'ute', 'double cab', 'twin cab', '4x4', 'bakkie'] },
  { art: 'vehicle/box-van',         keywords: ['box van', 'box-van', 'boxvan', 'panel van', 'cargo van', 'luton', 'van', 'box'] },
  { art: 'vehicle/forklift',        keywords: ['forklift', 'fork lift', 'fork-lift', 'reach truck', 'lift truck'] },
  { art: 'vehicle/trailer-flatbed', keywords: ['trailer'] },
  { art: 'vehicle/rigid-truck',     keywords: ['rigid', 'truck', 'lorry', 'rigid truck'] },
]

/** Public list of the canonical vehicle art names this helper can return. */
export const VEHICLE_ART_TYPES = Object.freeze([
  'vehicle/rigid-truck',
  'vehicle/semi-articulated',
  'vehicle/tanker',
  'vehicle/tipper',
  'vehicle/box-van',
  'vehicle/pickup',
  'vehicle/bus',
  'vehicle/coach',
  'vehicle/trailer-flatbed',
  'vehicle/low-loader',
  'vehicle/reefer',
  'vehicle/forklift',
])

/**
 * Resolve a `vehicle_type` string to a `vehicle/*` illustration name.
 *
 * @param {string} [type] Free-text vehicle type (case-insensitive; tolerant of
 *   synonyms, separators and mixed casing). Missing/blank → default silhouette.
 * @returns {string} A valid registered illustration name (never null).
 */
export function vehicleArt(type) {
  if (type == null) return DEFAULT_ART
  const s = String(type).toLowerCase().replace(/[_/]+/g, ' ').trim()
  if (!s) return DEFAULT_ART

  for (const { art, keywords } of RULES) {
    for (const kw of keywords) {
      if (s.includes(kw)) return art
    }
  }
  return DEFAULT_ART
}

export default vehicleArt
