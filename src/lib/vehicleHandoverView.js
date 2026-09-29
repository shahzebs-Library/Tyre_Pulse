/**
 * Vehicle Handover wizard: pure view engine for the redesigned
 * /vehicle-handover page (owner mockup: a 5-step handover wizard).
 *
 * No Supabase, no React. The page loads the asset, the asset's latest handover,
 * its latest engine-hour reading and the driver list, and this module turns
 * them into what the wizard shows and what it saves.
 *
 * Storage rules (table `handover_reports`, V181):
 * - Damage is captured as numbered markers on the asset's own five-view
 *   picture (vehicleHandoverMarks.js) and stored in the existing `damages`
 *   jsonb, one entry per marker, so `damage_count` and every existing damage
 *   roll-up keep working unchanged. Older per-side zone entries still read.
 * - The driver chosen in the wizard is the receiving driver on a check-out
 *   (`to_driver`) and the returning driver on a check-in (`from_driver`).
 * - Contact number, engine hours and the previous readings are shown for
 *   context only; there is no column for them on a handover.
 */

import { damagesFromMarks } from './vehicleHandoverMarks'

export const WIZARD_STEPS = [
  { key: 'vehicle', label: 'Vehicle Details' },
  { key: 'condition', label: 'Condition Check' },
  { key: 'photos', label: 'Photos & Notes' },
  { key: 'signatures', label: 'Signatures' },
  { key: 'complete', label: 'Complete' },
]

export const ZONES = [
  { key: 'front', label: 'Front' },
  { key: 'left', label: 'Left' },
  { key: 'rear', label: 'Rear' },
  { key: 'right', label: 'Right' },
]

export const ZONE_CONDITIONS = [
  { key: 'good', label: 'Good', tone: 'good' },
  { key: 'minor_scratch', label: 'Minor scratch', tone: 'warn' },
  { key: 'dent', label: 'Dent', tone: 'orange' },
  { key: 'damaged', label: 'Damaged', tone: 'bad' },
]
const ZONE_KEYS = new Set(ZONES.map((z) => z.key))
const CONDITION_KEYS = new Set(ZONE_CONDITIONS.map((c) => c.key))

export function zoneConditionMeta(key) {
  return ZONE_CONDITIONS.find((c) => c.key === key) || null
}

export const EMPTY_WIZARD = {
  asset_no: '',
  handover_type: 'checkout',
  driver_name: '',
  driver_phone: '',
  other_party: '',
  report_no: '',
  handover_at: '',
  odometer_km: '',
  fuel_level_pct: '',
  condition_rating: 'good',
  cleanliness: 'clean',
  zones: { front: 'good', left: 'good', rear: 'good', right: 'good' },
  marks: [],
  artwork_stem: null,
  photo_url: '',
  notes: '',
  signature: null,
}

/** Finite number or null. Blank stays null (never a fabricated 0). */
export function num(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/**
 * Read a stored `damages` payload back into a zone map. Anything that is not a
 * recognised zone entry is ignored; zones with no entry read as good.
 */
export function zonesFromDamages(damages) {
  const out = { front: 'good', left: 'good', rear: 'good', right: 'good' }
  if (!Array.isArray(damages)) return out
  for (const d of damages) {
    const zone = d && typeof d === 'object' ? String(d.zone || '').toLowerCase() : ''
    const cond = d && typeof d === 'object' ? String(d.condition || '').toLowerCase() : ''
    if (ZONE_KEYS.has(zone) && CONDITION_KEYS.has(cond)) out[zone] = cond
  }
  return out
}

/** Zone map to the stored damages array: only zones that are not good. */
export function damagesFromZones(zones = {}) {
  return ZONES
    .filter((z) => CONDITION_KEYS.has(zones[z.key]) && zones[z.key] !== 'good')
    .map((z) => ({ zone: z.key, condition: zones[z.key], label: `${z.label}: ${zoneConditionMeta(zones[z.key]).label}` }))
}

/** The asset's most recent handover among the loaded rows (by handover_at). */
export function latestHandoverFor(rows = [], assetNo) {
  const key = String(assetNo || '').trim().toUpperCase()
  if (!key) return null
  let best = null
  let bestT = -Infinity
  for (const r of Array.isArray(rows) ? rows : []) {
    if (String(r?.asset_no || '').trim().toUpperCase() !== key) continue
    const t = r.handover_at ? new Date(r.handover_at).getTime() : NaN
    const tt = Number.isFinite(t) ? t : -Infinity
    if (!best || tt > bestT) { best = r; bestT = tt }
  }
  return best
}

/**
 * Previous readings for the "Odometer & Fuel" card. Previous odometer is the
 * higher of the last handover's odometer and the register's current km (a
 * meter never runs backwards), and says which source it came from. Previous
 * fuel is only known from the last handover.
 */
export function previousReadings({ lastHandover = null, asset = null, engineHours = null } = {}) {
  const hoOdo = num(lastHandover?.odometer_km)
  const fleetOdo = num(asset?.current_km)
  let prevOdometer = null
  let odometerSource = null
  if (hoOdo != null && (fleetOdo == null || hoOdo >= fleetOdo)) { prevOdometer = hoOdo; odometerSource = 'Last handover' }
  else if (fleetOdo != null) { prevOdometer = fleetOdo; odometerSource = 'Fleet register' }
  return {
    prevOdometer,
    odometerSource,
    prevFuel: num(lastHandover?.fuel_level_pct),
    prevHandoverAt: lastHandover?.handover_at || null,
    prevType: lastHandover?.handover_type || null,
    engineHours: num(engineHours?.engine_hours),
    engineHoursDate: engineHours?.reading_date || null,
  }
}

/**
 * Step validation. Returns a list of plain-English problems; empty = can move on.
 * Step indexes follow WIZARD_STEPS (0 based).
 */
export function validateStep(step, form, prev = {}) {
  const errs = []
  if (step === 0) {
    if (!String(form.asset_no || '').trim()) errs.push('Choose the vehicle being handed over.')
    if (!['checkout', 'checkin'].includes(form.handover_type)) errs.push('Choose a handover type.')
    if (!String(form.driver_name || '').trim()) errs.push('Choose or enter the driver.')
    const odo = num(form.odometer_km)
    if (form.odometer_km !== '' && form.odometer_km != null && odo == null) errs.push('Current odometer must be a number.')
    if (odo != null && odo < 0) errs.push('Current odometer cannot be negative.')
    if (odo != null && prev.prevOdometer != null && odo < prev.prevOdometer) {
      errs.push(`Current odometer cannot be lower than the previous reading (${prev.prevOdometer.toLocaleString('en-US')} km).`)
    }
    const fuel = num(form.fuel_level_pct)
    if (form.fuel_level_pct !== '' && form.fuel_level_pct != null && fuel == null) errs.push('Fuel level must be a number.')
    if (fuel != null && (fuel < 0 || fuel > 100)) errs.push('Fuel level must be between 0 and 100%.')
  }
  if (step === 2) {
    const url = String(form.photo_url || '').trim()
    if (url && !/^https?:\/\//i.test(url)) errs.push('The photo link must start with http:// or https://.')
  }
  return errs
}

/** Every step up to (not including) `upTo` is valid. */
export function firstInvalidStep(form, prev, upTo = WIZARD_STEPS.length) {
  for (let i = 0; i < upTo; i++) if (validateStep(i, form, prev).length) return i
  return -1
}

/** done / active / todo for the stepper. */
export function stepState(index, current) {
  if (index < current) return 'done'
  if (index === current) return 'active'
  return 'todo'
}

/** Wizard form to the service payload for createHandoverReport. */
export function buildHandoverPayload(form, { country = null } = {}) {
  const driver = String(form.driver_name || '').trim() || null
  const other = String(form.other_party || '').trim() || null
  const checkout = form.handover_type !== 'checkin'
  // Numbered picture markers are the current capture; the per-side zone map is
  // only used when no marker was placed (older drafts and callers).
  const damages = Array.isArray(form.marks) && form.marks.length
    ? damagesFromMarks(form.marks, { stem: form.artwork_stem })
    : damagesFromZones(form.zones)
  return {
    asset_no: String(form.asset_no || '').trim().toUpperCase(),
    report_no: String(form.report_no || '').trim() || null,
    handover_type: checkout ? 'checkout' : 'checkin',
    from_driver: checkout ? other : driver,
    to_driver: checkout ? driver : other,
    handover_at: form.handover_at ? new Date(form.handover_at).toISOString() : null,
    odometer_km: num(form.odometer_km),
    fuel_level_pct: num(form.fuel_level_pct),
    condition_rating: form.condition_rating || null,
    cleanliness: form.cleanliness || null,
    damages: damages.length ? damages : null,
    damage_count: damages.length,
    photo_url: String(form.photo_url || '').trim() || null,
    signature_url: form.signature || null,
    notes: String(form.notes || '').trim() || null,
    country: country && country !== 'All' ? country : null,
  }
}

/** Distance and fuel change since the previous handover, or null when unknown. */
export function readingDeltas(form, prev = {}) {
  const odo = num(form.odometer_km)
  const fuel = num(form.fuel_level_pct)
  return {
    kmSince: odo != null && prev.prevOdometer != null ? odo - prev.prevOdometer : null,
    fuelChange: fuel != null && prev.prevFuel != null ? fuel - prev.prevFuel : null,
  }
}

/** Driver list rows to picker options (active drivers first, then by name). */
export function driverOptions(drivers = []) {
  return (Array.isArray(drivers) ? drivers : [])
    .filter((d) => d && (d.driver_name || d.driver_id))
    .map((d) => ({
      id: d.id,
      name: d.driver_name || d.driver_id,
      code: d.driver_name ? (d.driver_id || '') : '',
      phone: d.phone || '',
      asset: d.assigned_asset_no || '',
      active: String(d.status || 'active').toLowerCase() === 'active',
    }))
    .sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name))
}

/** Case-insensitive driver lookup by typed text (name or id). */
export function matchDriver(options = [], text) {
  const q = String(text || '').trim().toLowerCase()
  if (!q) return null
  return options.find((o) => o.name.toLowerCase() === q || (o.code && o.code.toLowerCase() === q)) || null
}
