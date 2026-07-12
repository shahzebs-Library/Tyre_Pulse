/**
 * Geofences service — the single seam between the Geofencing page (/geofencing)
 * and Supabase (table `geofences`, V133). Keeps an explicit column list
 * (least-privilege selects), null-safe country scoping, and validation via the
 * pure `src/lib/geofences.js` helpers. RLS enforces org isolation and the
 * read/write role split; this layer never trusts client input blindly.
 *
 * Mirrors support.js / tyreAgeCompliance.js. A missing `geofences` relation
 * (org has not run the migration) degrades listing to an empty array so the
 * page can render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { validateGeofence, toFiniteNumber, ZONE_TYPES } from '../geofences'

export const COLS =
  'id,organisation_id,country,name,zone_type,center_lat,center_lng,radius_m,' +
  'site,active,notes,created_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('geofences'))
  )
}

/**
 * List geofences (newest first). Optional `active` (boolean) and `country`
 * filters. Returns [] when the table has not been provisioned yet.
 */
export async function listGeofences({ country, active, limit = 500 } = {}) {
  try {
    let q = supabase.from('geofences').select(COLS)
    if (typeof active === 'boolean') q = q.eq('active', active)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getGeofence(id) {
  return unwrap(await supabase.from('geofences').select(COLS).eq('id', id).maybeSingle())
}

/** Build a clean, typed insert/update payload from raw form values. */
function toPayload(values = {}) {
  const zone_type = ZONE_TYPES.includes(values.zone_type) ? values.zone_type : 'custom'
  return {
    name: String(values.name || '').trim().slice(0, 160),
    zone_type,
    center_lat: toFiniteNumber(values.center_lat),
    center_lng: toFiniteNumber(values.center_lng),
    radius_m: toFiniteNumber(values.radius_m),
    site: values.site ? String(values.site).trim().slice(0, 200) : null,
    active: values.active === false ? false : true,
    notes: values.notes ? String(values.notes).slice(0, 4000) : null,
    country: values.country ?? null,
  }
}

/** Create a geofence zone. Validates name + numeric lat/lng/radius. */
export async function createGeofence(values = {}) {
  const errors = validateGeofence(values)
  if (Object.keys(errors).length) {
    throw new Error(Object.values(errors)[0])
  }
  const payload = toPayload(values)
  return unwrap(await supabase.from('geofences').insert(payload).select(COLS).single())
}

/** Patch a geofence. Re-validates and strips immutable/ownership fields. */
export async function updateGeofence(id, patch = {}) {
  // Validate only against the fields present: default `name` so a partial patch
  // (e.g. toggling `active`) is allowed, but any supplied coordinate/radius/name
  // is still checked for sanity.
  const errors = validateGeofence({ name: patch.name ?? 'placeholder', ...patch })
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0])
  const clean = {}
  if (patch.name != null) clean.name = String(patch.name).trim().slice(0, 160)
  if (patch.zone_type != null) clean.zone_type = ZONE_TYPES.includes(patch.zone_type) ? patch.zone_type : 'custom'
  if (patch.center_lat !== undefined) clean.center_lat = toFiniteNumber(patch.center_lat)
  if (patch.center_lng !== undefined) clean.center_lng = toFiniteNumber(patch.center_lng)
  if (patch.radius_m !== undefined) clean.radius_m = toFiniteNumber(patch.radius_m)
  if (patch.site !== undefined) clean.site = patch.site ? String(patch.site).trim().slice(0, 200) : null
  if (patch.active !== undefined) clean.active = !!patch.active
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 4000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null
  return unwrap(await supabase.from('geofences').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteGeofence(id) {
  return unwrap(await supabase.from('geofences').delete().eq('id', id))
}
