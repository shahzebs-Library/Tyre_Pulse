/**
 * Journeys service — the single seam between the Journey Log page (/journeys)
 * and Supabase (table `journeys`, V139). Keeps an explicit column list
 * (least-privilege selects), null-safe country scoping, and validation via the
 * pure `src/lib/journeys.js` helpers. RLS enforces org isolation; this layer
 * never trusts client input blindly.
 *
 * Mirrors support.js / geofences.js. A missing `journeys` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { JOURNEY_STATUSES, toFiniteNumber } from '../journeys'

export const COLS =
  'id,organisation_id,country,asset_no,driver_name,origin,destination,purpose,' +
  'start_time,end_time,distance_km,site,status,notes,created_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('journeys'))
  )
}

/**
 * List journeys (newest first by start_time, then created_at). Optional
 * `status` and `country` filters. Returns [] when the table has not been
 * provisioned yet.
 */
export async function listJourneys({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('journeys').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('start_time', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getJourney(id) {
  return unwrap(await supabase.from('journeys').select(COLS).eq('id', id).maybeSingle())
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Build a clean, typed insert payload from raw form values. */
function toInsertPayload(values = {}) {
  const status = JOURNEY_STATUSES.includes(values.status) ? values.status : 'planned'
  return {
    asset_no: asText(values.asset_no, 120),
    driver_name: asText(values.driver_name, 160),
    origin: asText(values.origin, 240),
    destination: asText(values.destination, 240),
    purpose: asText(values.purpose, 240),
    start_time: asTimestamp(values.start_time),
    end_time: asTimestamp(values.end_time),
    distance_km: toFiniteNumber(values.distance_km),
    site: asText(values.site, 200),
    status,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
}

/** Create a journey. Requires an asset number to anchor the trip to a vehicle. */
export async function createJourney(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset (vehicle) number is required.')
  const payload = toInsertPayload(values)
  return unwrap(await supabase.from('journeys').insert(payload).select(COLS).single())
}

/** Patch a journey. Strips immutable/ownership fields; coerces each field present. */
export async function updateJourney(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset (vehicle) number is required.')
    clean.asset_no = asset_no
  }
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 160)
  if (patch.origin !== undefined) clean.origin = asText(patch.origin, 240)
  if (patch.destination !== undefined) clean.destination = asText(patch.destination, 240)
  if (patch.purpose !== undefined) clean.purpose = asText(patch.purpose, 240)
  if (patch.start_time !== undefined) clean.start_time = asTimestamp(patch.start_time)
  if (patch.end_time !== undefined) clean.end_time = asTimestamp(patch.end_time)
  if (patch.distance_km !== undefined) clean.distance_km = toFiniteNumber(patch.distance_km)
  if (patch.site !== undefined) clean.site = asText(patch.site, 200)
  if (patch.status !== undefined) {
    clean.status = JOURNEY_STATUSES.includes(patch.status) ? patch.status : 'planned'
  }
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null
  return unwrap(await supabase.from('journeys').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteJourney(id) {
  return unwrap(await supabase.from('journeys').delete().eq('id', id))
}
