/**
 * Vehicle 360 service — one vehicle's master data, photo, GPS and tyres for the
 * per-vehicle telematics page. Reads the `vehicles` view; writes the base
 * `vehicle_fleet` table. Photos live in the private `vehicle-photos` bucket and
 * are served via short-lived signed URLs (never public).
 */
import { supabase, unwrap } from './_client'

const BUCKET = 'vehicle-photos'
const V_COLS =
  'id,asset_no,fleet_number,make,model,vehicle_type,year,department,operator_name,' +
  'site,country,region,status,tyre_size,expected_km_per_tyre,monthly_tyre_budget,notes,' +
  'image_path,latitude,longitude,location_updated_at,gps_source'

/** One vehicle by asset number (case-insensitive). */
export async function getVehicle(assetNo) {
  return unwrap(
    await supabase.from('vehicles').select(V_COLS).ilike('asset_no', assetNo).limit(1).maybeSingle(),
  )
}

/** Every tyre record for this vehicle, newest first (for the per-vehicle panels). */
export async function getVehicleTyres(assetNo) {
  return unwrap(
    await supabase.from('tyre_records')
      .select('id,serial_no,asset_no,brand,size,position,issue_date,removal_date,km_at_fitment,km_at_removal,cost_per_tyre,qty,risk_level,category,tread_depth,pressure_reading')
      .ilike('asset_no', assetNo)
      .order('issue_date', { ascending: false })
      .limit(500),
  )
}

/** Signed URL for a stored vehicle photo path (1 hour). null when no path. */
export async function vehiclePhotoUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) return null
  return data?.signedUrl ?? null
}

/**
 * Upload/replace a vehicle's photo. Stores at `<asset_no>/photo.<ext>` (upsert),
 * records the path on vehicle_fleet, and returns { path, url }.
 */
export async function uploadVehiclePhoto(assetNo, file) {
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const safe = String(assetNo).replace(/[^a-zA-Z0-9_-]/g, '_')
  const path = `${safe}/photo.${ext}`
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true, contentType: file.type || 'image/jpeg', cacheControl: '3600',
  })
  if (upErr) throw new Error(upErr.message || 'Photo upload failed.')
  const { error: dbErr } = await supabase.from('vehicle_fleet')
    .update({ image_path: path, updated_at: new Date().toISOString() })
    .ilike('asset_no', assetNo)
  if (dbErr) throw new Error(dbErr.message || 'Could not save the photo reference.')
  const url = await vehiclePhotoUrl(path)
  return { path, url }
}

/** Save a manual GPS position on the vehicle (used until a provider feed is wired). */
export async function saveVehicleGps(assetNo, latitude, longitude, source = 'manual') {
  const lat = Number(latitude), lng = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Enter a valid latitude (-90..90) and longitude (-180..180).')
  }
  const { error } = await supabase.from('vehicle_fleet')
    .update({ latitude: lat, longitude: lng, location_updated_at: new Date().toISOString(), gps_source: source })
    .ilike('asset_no', assetNo)
  if (error) throw new Error(error.message || 'Could not save the location.')
  return { latitude: lat, longitude: lng }
}
