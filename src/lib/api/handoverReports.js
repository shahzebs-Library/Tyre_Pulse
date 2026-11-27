/**
 * Vehicle Handover / Condition Reports service — the single seam between the
 * Vehicle Handover page (/vehicle-handover) and Supabase (table
 * `handover_reports`, V181). Keeps an explicit column list (least-privilege
 * selects), null-safe country scoping, input validation, and enum
 * whitelisting. RLS enforces org isolation; this layer never trusts client
 * input blindly.
 *
 * Mirrors odometerLogs.js. A missing `handover_reports` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry, ServiceError, isMissingColumn } from './_client'
import { toFiniteNumber } from '../handoverReports'
import { safeHref } from '../safeUrl'
import { toUserMessage } from '../safeError'

/** Scheme-guard a URL on write: safe → the string, anything unsafe/blank → null. */
const asUrl = (v) => { const s = safeHref(v); return s === undefined ? null : s }

/**
 * A signature is either a safe URL or the self-contained `<svg>` markup the
 * shared SignatureCapture pad emits (same format as the field app). Markup is
 * never truncated (a cut SVG is not a signature); oversize markup is refused.
 */
function asSignature(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  if (/^<svg[\s>]/i.test(s)) {
    if (s.length > 200000) throw new Error('The signature is too large to save. Clear it and sign again.')
    return /<\/svg>$/i.test(s) ? s : null
  }
  return asUrl(s.slice(0, 2000))
}

export const COLS =
  'id,organisation_id,country,report_no,asset_no,handover_type,from_driver,' +
  'to_driver,handover_at,odometer_km,fuel_level_pct,condition_rating,damages,' +
  'damage_count,cleanliness,signature_url,photo_url,photos,notes,created_by,' +
  'created_at,updated_at,document_no,approval_status,review_note,' +
  'supervisor_name,supervisor_signature,supervisor_at,supervisor_by,' +
  'incharge_name,incharge_signature,incharge_at,incharge_by'

/**
 * The authorization paper columns (the handover authorization paper migration). Selected on top of
 * COLS; when the database has not had that migration applied PostgREST refuses
 * the whole select (42703 / PGRST204), so every read retries with COLS alone and
 * the screen falls back to the single legacy signature.
 */
export const AUTH_COLS =
  'from_driver_id,to_driver_id,hour_meter,site,from_signature,from_signed_name,' +
  'from_signed_at,from_signed_by,to_signature,to_signed_name,to_signed_at,' +
  'to_signed_by,latitude,longitude,location_accuracy_m,location_status,' +
  'location_captured_at,frozen_at,from_on_behalf,to_on_behalf'
export const FULL_COLS = `${COLS},${AUTH_COLS}`
const AUTH_WRITE_KEYS = ['from_driver_id', 'to_driver_id', 'hour_meter', 'site']

async function withColumnFallback(run) {
  try {
    return await run(FULL_COLS)
  } catch (err) {
    if (isMissingColumn(err)) return run(COLS)
    throw err
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const asUuid = (v) => (v && UUID_RE.test(String(v).trim()) ? String(v).trim().toLowerCase() : null)
const asSite = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim().toUpperCase().slice(0, 120))

// Photos live in the PRIVATE `tyre-photos` bucket, the same bucket the wash and
// inspection modules use, so a handover's photos resolve identically through
// src/lib/storageRefs.js. The `photos` jsonb column holds `tp-storage://` refs
// (never a public URL); the single legacy `photo_url` column is still read.
const PHOTO_BUCKET = 'tyre-photos'
const PHOTO_MIME_EXT = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
})
const MAX_PHOTO_BYTES = 20 * 1024 * 1024
const MAX_PHOTOS = 24

/**
 * Validate a user-supplied handover image before upload. Returns the canonical
 * extension derived from the (trusted) MIME type, never the raw filename, so a
 * spoofed extension cannot influence the storage path. Throws on invalid input.
 */
export function validateHandoverPhoto(file) {
  if (!file || typeof file !== 'object') throw new Error('No image file was provided.')
  const ext = PHOTO_MIME_EXT[file.type]
  if (!ext) throw new Error('Only JPEG, PNG, WebP, or HEIC images are allowed.')
  if (Number(file.size) > MAX_PHOTO_BYTES) throw new Error('Image must be 20 MB or smaller.')
  return ext
}

/**
 * Upload one handover photo to the private bucket and return a tp-storage:// ref.
 * Path is collision-resistant: modules/handover/<uid>/<timestamp>_<index>_<rand>.<ext>
 */
export async function uploadHandoverPhoto(file, index = 0) {
  const ext = validateHandoverPhoto(file)
  const { data: { user } = {} } = await supabase.auth.getUser()
  const uid = (user?.id || 'anon').slice(0, 8)
  const rand = Math.random().toString(36).slice(2, 6)
  const path = `modules/handover/${uid}/${Date.now()}_${index}_${rand}.${ext}`
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    upsert: false, contentType: file.type || 'image/jpeg', cacheControl: '3600',
  })
  if (error) throw new ServiceError(toUserMessage(error, 'Photo upload failed.'), error.code, error)
  return `tp-storage://${PHOTO_BUCKET}/${path}`
}

/**
 * Normalise a photos payload to an array of stored refs. Each entry is kept only
 * when it is a tp-storage:// ref or a safe http(s) URL; anything else is dropped
 * so a poisoned value can never reach display. Capped at MAX_PHOTOS.
 */
function asPhotos(v) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const item of v) {
    const s = typeof item === 'string' ? item.trim() : ''
    if (!s) continue
    if (s.startsWith('tp-storage://')) { out.push(s.slice(0, 500)); continue }
    const safe = asUrl(s.slice(0, 2000))
    if (safe) out.push(safe)
    if (out.length >= MAX_PHOTOS) break
  }
  return out
}

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('handover_reports'))
  )
}

// ── Allowed enum values (whitelist; anything else becomes null) ──────────────
const HANDOVER_TYPES = new Set(['checkout', 'checkin'])
const CONDITION_RATINGS = new Set(['excellent', 'good', 'fair', 'poor'])
const CLEANLINESS = new Set(['clean', 'acceptable', 'dirty'])

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asEnum = (v, allowed) => {
  const s = v == null ? '' : String(v).trim().toLowerCase()
  return allowed.has(s) ? s : null
}
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Non-negative numeric coercion with a field-named error. Returns null when blank. */
function asNonNegative(v, label) {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/** Store damages as-is when it's an array/object, else null. */
function asDamages(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') return v
  return null
}

/** Derive a damage count from an explicit value or the damages payload. */
function deriveDamageCount(explicit, damages) {
  const n = toFiniteNumber(explicit)
  if (n != null && n >= 0) return Math.trunc(n)
  if (Array.isArray(damages)) return damages.length
  return null
}

/**
 * List handover reports (newest first by handover_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listHandoverReports({ country, limit = 500 } = {}) {
  try {
    return await withColumnFallback(async (cols) => {
      let q = supabase.from('handover_reports').select(cols)
      q = applyCountry(q, country)
      return unwrap(
        await q
          .order('handover_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(limit),
      ) || []
    })
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getHandoverReport(id) {
  return withColumnFallback(async (cols) =>
    unwrap(await supabase.from('handover_reports').select(cols).eq('id', id).maybeSingle()))
}

/**
 * Record a handover. Requires an asset number (which vehicle). Numerics are
 * validated non-negative; enum fields are whitelisted; handover_at defaults to
 * now when omitted. Damages are stored as provided (array/object) or null.
 */
export async function createHandoverReport(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  const odometer_km = asNonNegative(values.odometer_km, 'Odometer reading (km)')
  const fuel_level_pct = asNonNegative(values.fuel_level_pct, 'Fuel level (%)')
  const damages = asDamages(values.damages)

  const payload = {
    asset_no,
    report_no: asText(values.report_no, 120),
    handover_type: asEnum(values.handover_type, HANDOVER_TYPES),
    from_driver: asText(values.from_driver, 200),
    to_driver: asText(values.to_driver, 200),
    handover_at: asTimestamp(values.handover_at) || new Date().toISOString(),
    odometer_km,
    fuel_level_pct,
    condition_rating: asEnum(values.condition_rating, CONDITION_RATINGS),
    damages,
    damage_count: deriveDamageCount(values.damage_count, damages),
    cleanliness: asEnum(values.cleanliness, CLEANLINESS),
    signature_url: asSignature(values.signature_url),
    photo_url: asUrl(asText(values.photo_url, 2000)),
    photos: asPhotos(values.photos),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
    // A new handover is a draft until both drivers have signed; the receiving
    // signature (sign_handover) submits it for supervisor sign-off.
    approval_status: values.approval_status === 'pending_supervisor' ? 'pending_supervisor' : 'draft',
    from_driver_id: asUuid(values.from_driver_id),
    to_driver_id: asUuid(values.to_driver_id),
    hour_meter: asNonNegative(values.hour_meter, 'Hour meter (hours)'),
    site: asSite(values.site),
  }
  try {
    return unwrap(await supabase.from('handover_reports').insert(payload).select(FULL_COLS).single())
  } catch (err) {
    if (!isMissingColumn(err)) throw err
    // Pre-migration database: keep the legacy shape (single signature, submitted
    // straight for sign-off as it always was).
    const legacy = { ...payload, approval_status: 'pending_supervisor' }
    for (const k of AUTH_WRITE_KEYS) delete legacy[k]
    const row = unwrap(await supabase.from('handover_reports').insert(legacy).select(COLS).single())
    return row ? { ...row, _legacy: true } : row
  }
}

/**
 * Patch a handover report. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updateHandoverReport(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.report_no !== undefined) clean.report_no = asText(patch.report_no, 120)
  if (patch.handover_type !== undefined) clean.handover_type = asEnum(patch.handover_type, HANDOVER_TYPES)
  if (patch.from_driver !== undefined) clean.from_driver = asText(patch.from_driver, 200)
  if (patch.to_driver !== undefined) clean.to_driver = asText(patch.to_driver, 200)
  if (patch.handover_at !== undefined) clean.handover_at = asTimestamp(patch.handover_at)
  if (patch.odometer_km !== undefined) clean.odometer_km = asNonNegative(patch.odometer_km, 'Odometer reading (km)')
  if (patch.fuel_level_pct !== undefined) clean.fuel_level_pct = asNonNegative(patch.fuel_level_pct, 'Fuel level (%)')
  if (patch.condition_rating !== undefined) clean.condition_rating = asEnum(patch.condition_rating, CONDITION_RATINGS)
  if (patch.damages !== undefined) {
    clean.damages = asDamages(patch.damages)
    // Keep damage_count consistent with the new damages payload unless caller
    // supplies an explicit count below.
    clean.damage_count = deriveDamageCount(patch.damage_count, clean.damages)
  } else if (patch.damage_count !== undefined) {
    clean.damage_count = deriveDamageCount(patch.damage_count, null)
  }
  if (patch.cleanliness !== undefined) clean.cleanliness = asEnum(patch.cleanliness, CLEANLINESS)
  if (patch.signature_url !== undefined) clean.signature_url = asSignature(patch.signature_url)
  if (patch.photo_url !== undefined) clean.photo_url = asUrl(asText(patch.photo_url, 2000))
  if (patch.photos !== undefined) clean.photos = asPhotos(patch.photos)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null
  if (patch.from_driver_id !== undefined) clean.from_driver_id = asUuid(patch.from_driver_id)
  if (patch.to_driver_id !== undefined) clean.to_driver_id = asUuid(patch.to_driver_id)
  if (patch.hour_meter !== undefined) clean.hour_meter = asNonNegative(patch.hour_meter, 'Hour meter (hours)')
  if (patch.site !== undefined) clean.site = asSite(patch.site)

  return withColumnFallback(async (cols) => {
    const body = cols === COLS ? Object.fromEntries(Object.entries(clean).filter(([k]) => !AUTH_WRITE_KEYS.includes(k))) : clean
    return unwrap(await supabase.from('handover_reports').update(body).eq('id', id).select(cols).single())
  })
}

/**
 * Record one driver's signature through `sign_handover`. The server stamps the
 * time (now()) and the signing account (auth.uid()); the driver's name comes
 * from the driver register when a driver id is set. The handing party signs
 * first; the receiving signature freezes the record and submits it for sign-off.
 *
 * @param {string} id
 * @param {'handing'|'receiving'} party
 * `onBehalf` must be true when the signing account is NOT the account linked to
 * that party's driver: only a supervisor-level account may do that, and the
 * flag is stored on the record and in the audit trail.
 *
 * @param {{ signature:string, name?:string|null, location?:{latitude,longitude,accuracy,status}, onBehalf?:boolean }} opts
 * @returns {Promise<{ok:boolean, party:string, signed_name:string, signed_at:string, signed_by:string, on_behalf:boolean, status:string}>}
 */
export async function signHandover(id, party, { signature, name = null, location = null, onBehalf = false } = {}) {
  if (!id) throw new Error('A handover is required to sign.')
  if (party !== 'handing' && party !== 'receiving') throw new Error('Choose who is signing.')
  const sig = asSignature(signature)
  if (!sig) throw new Error('A signature is required.')
  const loc = location || {}
  const { data, error } = await supabase.rpc('sign_handover', {
    p_id: id,
    p_party: party,
    p_signature: sig,
    p_signer_name: asText(name, 200),
    p_latitude: Number.isFinite(loc.latitude) ? loc.latitude : null,
    p_longitude: Number.isFinite(loc.longitude) ? loc.longitude : null,
    p_accuracy_m: Number.isFinite(loc.accuracy) ? loc.accuracy : null,
    p_location_status: loc.status === 'denied' ? 'denied' : loc.status === 'captured' ? 'captured' : 'unavailable',
    p_on_behalf: onBehalf === true,
  })
  if (error) throw new ServiceError(toUserMessage(error, 'Could not record the signature.'), error.code, error)
  if (!data || data.ok !== true) throw new ServiceError('The server did not confirm the signature. Refresh before retrying.')
  return data
}

let myDriverPromise = null
/**
 * The driver-register id linked to the signed-in account (driver_account_links),
 * or null. Cached for the session; any read failure resolves to null, which only
 * means the screen asks "signing on behalf" and the server decides.
 */
export function getMyLinkedDriverId({ refresh = false } = {}) {
  if (!myDriverPromise || refresh) {
    myDriverPromise = (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser()
        const uid = auth?.user?.id
        if (!uid) return null
        const { data, error } = await supabase.from('driver_account_links').select('driver_id').eq('user_id', uid).maybeSingle()
        if (error) return null
        return data?.driver_id || null
      } catch {
        return null
      }
    })()
  }
  return myDriverPromise
}

/** The signed-in account id, or null. */
export async function getMyUserId() {
  try {
    const { data } = await supabase.auth.getUser()
    return data?.user?.id || null
  } catch {
    return null
  }
}

/** Append-only audit trail of one handover, oldest first. [] before the migration. */
export async function listHandoverEvents(id) {
  if (!id) return []
  try {
    return unwrap(await supabase.from('handover_report_events')
      .select('id,handover_id,action,actor,actor_name,changes,at')
      .eq('handover_id', id)
      .order('at', { ascending: true })
      .order('id', { ascending: true })
      .limit(500)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function deleteHandoverReport(id) {
  return unwrap(await supabase.from('handover_reports').delete().eq('id', id))
}

/**
 * Decide a handover's two-stage sign-off. The database RPC
 * `decide_handover_approval` is the authority: it resolves which rung this is,
 * derives the signer identity and timestamp from the session, enforces the role
 * gates and refuses a rung skip or a non-signer write. This layer never writes
 * approval_status directly.
 *
 * @param {string} id
 * @param {{ approved:boolean, signature?:string|null, note?:string|null }} opts
 * @returns {Promise<{ok:boolean, decision:string, status:string, both_steps:boolean}>}
 */
export async function decideHandover(id, { approved, signature = null, note = null } = {}) {
  if (!id) throw new Error('A handover is required to sign off.')
  const sig = asSignature(signature)
  try {
    const { data, error } = await supabase.rpc('decide_handover_approval', {
      p_id: id,
      p_approved: approved === true,
      p_signature: approved ? sig : null,
      p_note: note == null || note === '' ? null : String(note).slice(0, 2000),
    })
    if (error) throw new ServiceError(toUserMessage(error, 'Could not record the decision.'), error.code, error)
    return data || { ok: true, decision: approved ? 'approved' : 'rejected', status: '', both_steps: false }
  } catch (err) {
    if (err instanceof ServiceError) throw err
    throw new ServiceError(toUserMessage(err, 'Could not record the decision.'), err?.code, err)
  }
}

/**
 * Drivers for the handover picker (table `drivers`, V50). Country-scoped
 * (null-safe). Returns [] when the table is not provisioned.
 */
export async function listHandoverDrivers({ country, limit = 1000 } = {}) {
  try {
    let q = supabase.from('drivers').select('id,driver_id,driver_name,phone,assigned_asset_no,site,country,status')
    q = applyCountry(q, country)
    return unwrap(await q.order('driver_name', { ascending: true }).order('id', { ascending: true }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}
