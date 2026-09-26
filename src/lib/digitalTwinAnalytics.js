/**
 * Digital Twin analytics - pure, I/O-free enrichment of a vehicle's twin.
 *
 * `buildTwin` (src/lib/digitalTwin.js) scores each fitted tyre from tread, age
 * and pressure. This module joins that with the running-life engine
 * (get_tyre_running_life, judged through `measureFor` - whichever budget runs
 * out first) and places each tyre on the vehicle's wheel layout so the shared
 * VehicleTyreDiagram can draw it. Nothing is re-derived here: remaining life
 * comes from measureFor, the layout from vehicleTyreLayout via tyreBay.
 *
 * Honesty rules:
 *  - A tyre whose position cannot be placed on the layout is COUNTED as
 *    unplaced, never forced onto a wheel.
 *  - An unknown vehicle type draws no diagram (the layout resolver answers
 *    "Pickup" for anything it does not know, which would be a fabricated
 *    four-wheel map).
 *  - No life measurement renders as unknown, never as healthy.
 */
import { measureFor, BAND_META } from './tyreRunningLife'
import { canonicalToSlotId, vehicleTypeIsKnown, displayPositionCode } from './tyreBay'
import { healthBand } from './digitalTwin'

const BAND_TO_RISK = { overdue: 'Critical', 'due-soon': 'High', 'mid-life': 'Medium', healthy: 'Low' }
const TONE_TO_RISK = { red: 'Critical', amber: 'Medium', green: 'Low' }
const BAND_ORDER = { overdue: 0, 'due-soon': 1, 'mid-life': 2, healthy: 3, unknown: 4 }

const key = (v) => String(v || '').trim().toUpperCase()

/** The string the layout resolver should read: the type, else the asset code. */
export function layoutHint(vehicleType, assetNo) {
  return String(vehicleType || '').trim() || String(assetNo || '').trim()
}

/** Risk token for the diagram: running-life band first, else the twin health band. */
export function riskFor(band, health) {
  if (band && BAND_TO_RISK[band]) return BAND_TO_RISK[band]
  const tone = healthBand(health).tone
  return TONE_TO_RISK[tone] || null
}

/**
 * @param {{ twin: object, lifeRows?: object[], assetNo?: string, vehicleType?: string }} args
 *   lifeRows are SHAPED running-life rows (shapeRow) for this asset.
 */
export function enrichTwin({ twin, lifeRows = [], assetNo = '', vehicleType = '' } = {}) {
  const positionsIn = twin?.positions || []
  const lifeType = (lifeRows.find((r) => r.vehicleType) || {}).vehicleType || ''
  const hint = layoutHint(vehicleType || lifeType, assetNo || twin?.asset_no)
  const layoutKnown = vehicleTypeIsKnown(hint)

  const bySerial = new Map()
  const byPos = new Map()
  for (const r of lifeRows) {
    if (r.serial) bySerial.set(key(r.serial), r)
    if (r.position) byPos.set(key(r.position), r)
  }

  const bandCounts = { overdue: 0, 'due-soon': 0, 'mid-life': 0, healthy: 0, unknown: 0 }
  let unplaced = 0
  let measured = 0
  const diagram = []
  const positions = positionsIn.map((p) => {
    const life = (p.serial && bySerial.get(key(p.serial))) || (p.position && byPos.get(key(p.position))) || null
    const m = life ? measureFor(life) : null
    const band = m ? m.band : 'unknown'
    if (m && m.dimension) measured++
    bandCounts[band] = (bandCounts[band] || 0) + 1
    const slot = layoutKnown && p.position ? canonicalToSlotId(hint, p.position) : null
    const risk = riskFor(band === 'unknown' ? null : band, p.health)
    if (slot) diagram.push({ position: slot, risk_level: risk || 'none' })
    else unplaced++
    return {
      ...p,
      displayPosition: layoutKnown ? (displayPositionCode(hint, p.position) || p.position) : p.position,
      slot,
      band,
      bandLabel: (BAND_META[band] || BAND_META.unknown).label,
      risk,
      remaining: m?.remaining ?? null,
      remainingUnit: m?.dimension || null,
      usedPct: m?.used ?? null,
      remainingDays: life?.remainingDays ?? null,
      kmRun: life?.kmRun ?? null,
      hoursRun: life?.hoursRun ?? null,
      expectedLifeKm: life?.expectedLifeKm ?? null,
      expectedLifeHours: life?.expectedLifeHours ?? null,
      fittedOn: life?.fittedOn || null,
      onFallback: Boolean(m?.onFallback),
    }
  })

  const withDays = positions.filter((p) => p.remainingDays != null)
  const nextDue = withDays.length
    ? withDays.reduce((a, b) => (b.remainingDays < a.remainingDays ? b : a))
    : null

  return {
    hint,
    layoutKnown,
    positions,
    diagram,
    unplaced,
    bandCounts,
    dueCount: bandCounts.overdue + bandCounts['due-soon'],
    measured,
    lifeCoveragePct: positions.length ? Math.round((measured / positions.length) * 100) : null,
    nextDue: nextDue ? { position: nextDue.displayPosition, days: nextDue.remainingDays } : null,
  }
}

export function filterPositions(positions = [], { search = '', band = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return positions.filter((p) => (band === 'all' || p.band === band)
    && (!q || `${p.displayPosition || ''} ${p.serial || ''} ${p.brand || ''} ${p.size || ''}`.toLowerCase().includes(q)))
}

const SORTERS = {
  position: (p) => String(p.displayPosition || ''),
  band: (p) => BAND_ORDER[p.band] ?? 9,
  remaining: (p) => p.remaining,
  usedPct: (p) => p.usedPct,
  health: (p) => p.health,
  remainingDays: (p) => p.remainingDays,
}

/** Sort with nulls always last, whatever the direction. */
export function sortPositions(positions = [], sortKey = 'band', dir = 'asc') {
  const fn = SORTERS[sortKey] || SORTERS.band
  const m = dir === 'desc' ? -1 : 1
  return [...positions].sort((a, b) => {
    const x = fn(a), y = fn(b)
    if (x == null) return y == null ? 0 : 1
    if (y == null) return -1
    if (typeof x === 'string') return m * x.localeCompare(y)
    return m * (x - y)
  })
}
