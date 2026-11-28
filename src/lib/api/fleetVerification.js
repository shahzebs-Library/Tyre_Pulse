/**
 * Fleet "Verify on site" - service layer.
 *
 * Every write goes through the SECURITY DEFINER RPCs in migration
 * 20261127180000_fleet_onsite_verification.sql; the table has no client write
 * grant. Until that migration is applied every call answers
 * { notSetUp: true } instead of throwing, so the UI can say so honestly.
 */
import { supabase, isNotProvisioned, isMissingColumn, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { fetchAllPages } from '../fetchAll'
import { verificationPhotoPath } from '../fleetVerification'

const BUCKET = 'vehicle-photos'
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function fail(error, fallback) {
  return new ServiceError(toUserMessage(error, fallback), error?.code, error)
}

/** True when the migration has not been applied (function/table/column missing). */
export function isVerificationNotSetUp(error) {
  return isNotProvisioned(error) || isMissingColumn(error)
}

export function newVerificationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  // RFC 4122 v4 fallback for old browsers.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function validateVerificationPhoto(file) {
  if (!file) return null
  if (!PHOTO_TYPES.includes(file.type)) throw new ServiceError('Use a JPG, PNG or WebP photo.')
  if (file.size > MAX_PHOTO_BYTES) throw new ServiceError('The photo is larger than 10 MB.')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  return ext
}

/** Upload the verification photo to its own unique path. Returns the path. */
export async function uploadVerificationPhoto({ file, vehicle, verificationId }) {
  const ext = validateVerificationPhoto(file)
  if (!ext) return null
  const path = verificationPhotoPath({
    orgId: vehicle.organisation_id, country: vehicle.country, assetNo: vehicle.asset_no, verificationId, ext,
  })
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false, contentType: file.type, cacheControl: '3600',
  })
  // A retry of the same verification finds its own photo already there: fine.
  if (error && !/exist|duplicate/i.test(String(error.message || ''))) throw fail(error, 'Photo upload failed.')
  return path
}

/** Best-effort browser location. Never rejects, never blocks: resolves null. */
export function currentPosition({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const geo = globalThis.navigator?.geolocation
    if (!geo) return resolve(null)
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      geo.getCurrentPosition(
        (p) => { clearTimeout(timer); finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }) },
        () => { clearTimeout(timer); finish(null) },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
      )
    } catch {
      clearTimeout(timer); finish(null)
    }
  })
}

/**
 * Submit one verification. `input`: { verificationId, vehicle, outcome, observedAssetNo,
 * observedPlate, observedChassis, photoPath, position, otherCountry, note }.
 */
export async function submitFleetVerification(input) {
  const { verificationId, vehicle, outcome, position } = input
  const { data, error } = await supabase.rpc('submit_fleet_verification', {
    p_client_uuid: verificationId,
    p_vehicle_id: vehicle.id,
    p_outcome: outcome,
    p_observed_asset_no: input.observedAssetNo || null,
    p_observed_plate: input.observedPlate || null,
    p_observed_chassis: input.observedChassis || null,
    p_photo_path: input.photoPath || null,
    p_lat: position?.lat ?? null,
    p_lng: position?.lng ?? null,
    p_accuracy_m: position?.accuracy ?? null,
    p_other_country: outcome === 'other_country' ? (input.otherCountry || null) : null,
    p_note: input.note || null,
  })
  if (error) {
    if (isVerificationNotSetUp(error)) return { notSetUp: true }
    throw fail(error, 'Could not save the verification.')
  }
  return data
}

export async function decideFleetVerification(id, approve, note) {
  const { data, error } = await supabase.rpc('decide_fleet_verification', {
    p_id: id, p_approve: Boolean(approve), p_note: note || null,
  })
  if (error) {
    if (isVerificationNotSetUp(error)) return { notSetUp: true }
    throw fail(error, 'Could not record the decision.')
  }
  return data
}

/** { rows, notSetUp }. Rows newest-waiting-first come from the server. */
export async function listPendingFleetVerifications(country) {
  const { data, error } = await supabase.rpc('list_pending_fleet_verifications', {
    p_country: country && country !== 'All' ? country : null,
  })
  if (error) {
    if (isVerificationNotSetUp(error)) return { rows: [], notSetUp: true }
    throw fail(error, 'Could not load pending verifications.')
  }
  return { rows: data || [], notSetUp: false }
}

/** Read-only review list (same asset number in another country is NOT proof - V376). */
export async function listPossibleTransfers(country = 'KSA') {
  const { data, error } = await supabase.rpc('list_possible_transfers', { p_country: country })
  if (error) {
    if (isVerificationNotSetUp(error)) return { rows: [], notSetUp: true }
    throw fail(error, 'Could not load the transfer review list.')
  }
  return { rows: data || [], notSetUp: false }
}

/** Same company + country plates/chassis, for the duplicate preview. Best effort. */
export async function listPeerIdentifiers(vehicle) {
  if (!vehicle?.organisation_id) return []
  const { data, error } = await fetchAllPages((from, to) => {
    let q = supabase.from('vehicle_fleet').select('id,registration_no,chassis_no')
      .eq('organisation_id', vehicle.organisation_id)
    q = vehicle.country ? q.eq('country', vehicle.country) : q.is('country', null)
    return q.order('id').range(from, to)
  }, { max: 20000 })
  return error ? [] : (data || [])
}

/** Signed URL (1 hour) for a verification photo, or null. */
export async function verificationPhotoUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  return error ? null : (data?.signedUrl ?? null)
}

/**
 * Whole-register progress for one country (or all): exact server counts, so
 * the tile never describes only the page on screen. { verified, pending, total, notSetUp }.
 */
export async function countVerification(country) {
  const scoped = (q) => (country && country !== 'All' ? q.eq('country', country) : q)
  const head = () => scoped(supabase.from('vehicle_fleet').select('id', { count: 'exact', head: true }))
  const [all, done, wait] = await Promise.all([
    head(),
    head().eq('verification_status', 'verified'),
    // A pending check does not change the machine's stamp; count the queue.
    scoped(supabase.from('fleet_verifications').select('id', { count: 'exact', head: true })).eq('status', 'pending'),
  ])
  const err = all.error || done.error || wait.error
  if (err) {
    if (isVerificationNotSetUp(err)) return { verified: 0, pending: 0, total: all.count ?? 0, notSetUp: true }
    throw fail(err, 'Could not count verified machines.')
  }
  return { verified: done.count ?? 0, pending: wait.count ?? 0, total: all.count ?? 0, notSetUp: false }
}
