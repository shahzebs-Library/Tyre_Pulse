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
 * The DATA (layouts, asset prefixes, keyword rules, tyreless list, axle
 * variants) is read from docs/document-specs/tyre-layouts.json through
 * tyreLayoutSpec.js. The Flutter app is generated from the same file, so web
 * and phone can no longer drift apart. This module keeps its exported names so
 * no caller changes, and holds no list of its own.
 *
 * Pure, no I/O, safe to call in render.
 */
import {
  NO_TYRE_EQUIPMENT as SPEC_TYRELESS, isTyrelessEquipment as specIsTyreless,
  LAYOUT_SLOT_IDS, resolveLayoutOne, AXLE_VARIANTS as SPEC_AXLE_VARIANTS, FALLBACK_LAYOUT,
} from './tyreLayoutSpec'

// ── Tyreless (stationary / non-wheeled) equipment ─────────────────────────────
// Matching here short-circuits BOTH the diagram and the position list, so an
// inspector is asked for nothing rather than for wheels the machine lacks.
export const NO_TYRE_EQUIPMENT = SPEC_TYRELESS

/** True when the machine carries no tyres at all. */
export const isTyrelessEquipment = specIsTyreless

// ── Slot ids per layout key ───────────────────────────────────────────────────
// These ids ARE the diagram's tyre ids and the stored inspection keys, so a
// layout and its position vocabulary can never disagree.
export const LAYOUT_SLOTS = LAYOUT_SLOT_IDS

/** Every layout key this app knows how to draw. */
export const LAYOUT_KEYS = Object.freeze(Object.keys(LAYOUT_SLOTS))

/** Slot ids for a raw vehicle type. Empty array for tyreless equipment. */
export function layoutSlotsFor(vehicleType, assetNo, country) {
  if (isTyrelessEquipment(vehicleType)) return []
  // The machine's recorded build (4- vs 5-axle pump) wins over the type default.
  const key = layoutForAsset(resolveLayoutKey(vehicleType, assetNo), assetNo, country)
  return LAYOUT_SLOTS[key] || LAYOUT_SLOTS[FALLBACK_LAYOUT]
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
  return resolveLayoutOne(vehicleType) ?? resolveLayoutOne(assetNo) ?? FALLBACK_LAYOUT
}

/**
 * The same resolution WITHOUT the pickup fallback: null when neither the type
 * nor the asset number identifies a machine. Position matching (see
 * tyrePositionService) must not place a wheel on a layout nobody established.
 */
export function resolveLayoutKeyStrict(vehicleType, assetNo) {
  return resolveLayoutOne(vehicleType) ?? resolveLayoutOne(assetNo) ?? null
}

// ── Per-machine axle counts ──────────────────────────────────────────────────
// Some types come in more than one build (4- and 5-axle concrete pumps), so the
// type alone cannot pick the layout. The fleet register records axle_count per
// machine; the app loads it once (src/lib/api/vehicleAxles.js) and registers it
// here so every diagram, live or in a report, resolves the same machine alike.
// Keyed by country AND asset, because the same asset code in another country is
// a different machine (V376). An asset-only key is kept only when exactly one
// country records it, so a caller without a country still resolves.
export const AXLE_VARIANTS = SPEC_AXLE_VARIANTS
const axleByCountryAsset = new Map()
const axleByAsset = new Map()
const normAsset = (a) => String(a || '').trim().toUpperCase().replace(/\s+/g, '')
const normCountry = (c) => String(c || '').trim().toUpperCase()

/** Register the machines' axle counts: rows of { asset_no, country, axle_count }. */
export function setAxleCounts(rows = []) {
  axleByCountryAsset.clear(); axleByAsset.clear()
  const countries = new Map()
  for (const r of rows || []) {
    const a = normAsset(r?.asset_no); const n = Number(r?.axle_count)
    if (!a || !Number.isFinite(n)) continue
    axleByCountryAsset.set(`${normCountry(r.country)}|${a}`, n)
    if (!countries.has(a)) countries.set(a, new Map())
    countries.get(a).set(normCountry(r.country), n)
  }
  for (const [a, byC] of countries) if (byC.size === 1) axleByAsset.set(a, [...byC.values()][0])
}

/** The recorded axle count for one machine, or null. */
export function axleCountFor(assetNo, country) {
  const a = normAsset(assetNo)
  if (!a) return null
  if (country && country !== 'All') {
    const hit = axleByCountryAsset.get(`${normCountry(country)}|${a}`)
    return hit ?? null
  }
  return axleByAsset.get(a) ?? null
}

/** A type's layout key adjusted to this machine's recorded build, if any. */
export function layoutForAsset(baseKey, assetNo, country) {
  const n = axleCountFor(assetNo, country)
  return (n != null && AXLE_VARIANTS[baseKey]?.[n]) || baseKey
}

export default resolveLayoutKey
