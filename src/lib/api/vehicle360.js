/**
 * Vehicle 360 service — one vehicle's master data, photo, GPS and tyres for the
 * per-vehicle telematics page. Reads the `vehicles` view; writes the base
 * `vehicle_fleet` table. Photos live in the private `vehicle-photos` bucket and
 * are served via short-lived signed URLs (never public).
 */
import { supabase, unwrap, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { escapeLike } from '../searchFilter'
import { firstForCallerCompany, isOrgId } from './companyScope'

const BUCKET = 'vehicle-photos'

/** Allowed image MIME types mapped to their canonical storage extension. */
const PHOTO_MIME_EXT = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
})
const MAX_PHOTO_BYTES = 20 * 1024 * 1024

/**
 * Validate a user-supplied image before upload. Returns the canonical extension
 * derived from the (trusted) MIME type — never the raw client filename, so a
 * spoofed extension can't influence the storage path. Throws on invalid input.
 */
export function validatePhotoFile(file) {
  if (!file || typeof file !== 'object') {
    throw new Error('No image file was provided.')
  }
  const ext = PHOTO_MIME_EXT[file.type]
  if (!ext) {
    throw new Error('Only JPEG, PNG, WebP, or HEIC images are allowed.')
  }
  if (Number(file.size) > MAX_PHOTO_BYTES) {
    throw new Error('Image must be 20 MB or smaller.')
  }
  return ext
}
// Read from the base table, not the `vehicles` view: the view carries no
// organisation_id, and a super admin's read spans every company, so the row's
// own company is what pins every later read and write on this page.
const V_COLS =
  'id,organisation_id,asset_no,fleet_number,make,model,vehicle_type,year,department,operator_name,' +
  'site,country,region,status,tyre_size,expected_km_per_tyre,monthly_tyre_budget,notes,' +
  'image_path,latitude,longitude,location_updated_at,gps_source'

/** A real country (not blank, not the All sentinel) or null. */
const scopedCountry = (c) => (c && c !== 'All' ? c : null)

/**
 * One vehicle by asset number (case-insensitive, exact - `%`/`_` in the code are
 * escaped so they cannot act as wildcards). Pass `country` when known: the same
 * asset code in two countries is usually a DIFFERENT machine, so an unscoped
 * read could open the wrong one. The same code can also exist in two
 * companies: the caller's company wins, a code only one company holds opens
 * that company's machine, and a code held only by two OTHER companies opens
 * nothing (null) rather than an arbitrary one.
 */
export async function getVehicle(assetNo, { country } = {}) {
  let q = supabase.from('vehicle_fleet').select(V_COLS).ilike('asset_no', escapeLike(String(assetNo ?? '').trim()))
  const c = scopedCountry(country)
  if (c) q = q.eq('country', c)
  const rows = unwrap(await q.order('id').limit(20))
  return firstForCallerCompany(rows || [])
}

/**
 * Every tyre record for this vehicle, newest first (for the per-vehicle panels).
 * `country` scopes it to the vehicle's own country: without it a tyre fitted to
 * the same-numbered machine in another country was listed as this vehicle's.
 * `orgId` (the vehicle row's company) does the same across companies.
 */
export async function getVehicleTyres(assetNo, { country, orgId } = {}) {
  let q = supabase.from('tyre_records')
    .select('id,serial_no,asset_no,brand,size,position,issue_date,removal_date,km_at_fitment,km_at_removal,cost_per_tyre,qty,risk_level,category,tread_depth,pressure_reading,country')
    .ilike('asset_no', escapeLike(String(assetNo ?? '').trim()))
  const c = scopedCountry(country)
  if (c) q = q.eq('country', c)
  if (isOrgId(orgId)) q = q.eq('organisation_id', orgId)
  return unwrap(
    await q
      .order('issue_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(500),
  )
}

/**
 * Narrow a vehicle_fleet write to ONE machine: its row id when known, else asset
 * code + country + company. A write by asset code alone reached every
 * same-numbered machine the caller could see, which for a super admin meant
 * other companies' vehicles.
 */
function oneVehicle(q, assetNo, { id, country, orgId } = {}) {
  if (id != null && id !== '') return q.eq('id', id)
  let out = q.ilike('asset_no', escapeLike(String(assetNo ?? '').trim()))
  const c = scopedCountry(country)
  if (c) out = out.eq('country', c)   // never touch a same-numbered machine elsewhere
  if (isOrgId(orgId)) out = out.eq('organisation_id', orgId)
  return out
}

/** Signed URL for a stored vehicle photo path (1 hour). null when no path. */
export async function vehiclePhotoUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) return null
  return data?.signedUrl ?? null
}

/** One storage path segment: only [A-Za-z0-9_-], never empty, never a traversal. */
function pathSegment(v, fallback) {
  const s = String(v ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '')
  return s || fallback
}

/**
 * Storage path for a vehicle photo: `<org>/<COUNTRY>/<ASSET>/photo.<ext>`.
 * The same asset code in two countries (or two tenants) is a DIFFERENT machine,
 * so the path carries organisation and country; the old `<ASSET>/photo.<ext>`
 * shape let one machine's upload overwrite (upsert) the other's photo.
 * Asset and country are upper-cased so spelling variants land on one object.
 */
export function vehiclePhotoPath({ orgId, country, assetNo, ext }) {
  const org = pathSegment(orgId, 'no-org').toLowerCase()
  const ctry = pathSegment(scopedCountry(country), 'NO-COUNTRY').toUpperCase()
  const asset = pathSegment(assetNo, 'NO-ASSET').toUpperCase()
  const e = pathSegment(ext, 'jpg').toLowerCase()
  return `${org}/${ctry}/${asset}/photo.${e}`
}

/** The pre-fix path shape, kept only so old rows are recognisable. */
export function legacyVehiclePhotoPath(assetNo, ext) {
  return `${String(assetNo).replace(/[^a-zA-Z0-9_-]/g, '_')}/photo.${ext}`
}

/**
 * Path to read for a vehicle: whatever is stored on its row (`image_path`).
 * Legacy rows keep their old `<ASSET>/photo.<ext>` path and still render; new
 * uploads store the org/country path. null when the vehicle has no photo.
 */
export function resolveVehiclePhotoPath(vehicle) {
  const p = vehicle?.image_path
  return typeof p === 'string' && p.trim() ? p.trim() : null
}

/** The vehicle's own organisation (the row's, not the viewer's), or null. */
async function vehicleOrgId(assetNo, country) {
  let q = supabase.from('vehicle_fleet').select('organisation_id')
    .ilike('asset_no', escapeLike(String(assetNo ?? '').trim()))
  const c = scopedCountry(country)
  if (c) q = q.eq('country', c)
  // One machine per company can carry this code; prefer the caller's company.
  const { data, error } = await q.order('id').limit(20)
  if (error) return null
  return (await firstForCallerCompany(data || []))?.organisation_id ?? null
}

/**
 * Upload/replace a vehicle's photo. Stores at `<org>/<COUNTRY>/<ASSET>/photo.<ext>`
 * (upsert), records the path on vehicle_fleet, and returns { path, url }.
 * `orgId` is optional; when omitted the vehicle row's own organisation is used.
 */
export async function uploadVehiclePhoto(assetNo, file, { country, orgId, id } = {}) {
  const ext = validatePhotoFile(file)
  const org = orgId || await vehicleOrgId(assetNo, country)
  const path = vehiclePhotoPath({ orgId: org, country, assetNo, ext })
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true, contentType: file.type || 'image/jpeg', cacheControl: '3600',
  })
  if (upErr) throw new ServiceError(toUserMessage(upErr, 'Photo upload failed.'), upErr.statusCode, upErr)
  const upd = oneVehicle(
    supabase.from('vehicle_fleet').update({ image_path: path, updated_at: new Date().toISOString() }),
    assetNo, { id, country, orgId: org },
  )
  const { error: dbErr } = await upd
  if (dbErr) throw new ServiceError(toUserMessage(dbErr, 'Could not save the photo reference.'), dbErr.code, dbErr)
  const url = await vehiclePhotoUrl(path)
  return { path, url }
}

/** Save a manual GPS position on the vehicle (used until a provider feed is wired). */
export async function saveVehicleGps(assetNo, latitude, longitude, source = 'manual', { country, orgId, id } = {}) {
  const lat = Number(latitude), lng = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Enter a valid latitude (-90..90) and longitude (-180..180).')
  }
  // One machine only (row id, else code + country + company), so a
  // same-numbered machine in another country or company never moves.
  const q = oneVehicle(
    supabase.from('vehicle_fleet')
      .update({ latitude: lat, longitude: lng, location_updated_at: new Date().toISOString(), gps_source: source }),
    assetNo, { id, country, orgId },
  )
  const { error } = await q
  if (error) throw new ServiceError(toUserMessage(error, 'Could not save the location.'), error.code, error)
  return { latitude: lat, longitude: lng }
}
