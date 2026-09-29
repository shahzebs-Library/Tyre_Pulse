/**
 * Rotations service - tyre rotation schedule (tyre_rotations) plus the
 * paginated tyre_records read the Rotation Compliance page runs to build its
 * analytics. Explicit column lists (no SELECT *), single boundary for the
 * tyre_rotations table as pages migrate off inline supabase.from(...) calls.
 *
 * Scoping mirrors the page exactly:
 *   - tyre_rotations  → null-safe country scoping (country OR NULL) via applyCountry
 *   - tyre_records    → STRICT country eq (matches the page's .eq('country', ...))
 */
import { supabase, unwrap, applyCountry, fetchAllPages, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { resolveStorageUrl } from '../storageRefs'

// Least-privilege column set for the schedule table. Omits organisation_id
// (RLS-managed) and updated_at (write-only bookkeeping the page does not read).
const COLS =
  'id,asset_no,site,scheduled_date,priority,status,notes,current_km,country,created_at,' +
  'rotation_type,from_positions,to_positions,technician_id,technician_name,attachments,completed_at,completed_km'

// Columns the analytics engine consumes from tyre_records. Kept local to this
// service (the page's read is a specialised ascending, fully-paged scan that
// does not match tyres.js listTyreRecords).
/** Ceiling on the rotation history read (tyre_records holds ~11k rows today). */
export const ROTATION_RECORD_MAX = 100000

const RECORD_COLS =
  // serial_number is a dead legacy column (0 of 7,504 populated): alias the
  // canonical serial_no under that name so every reader gets the real serial.
  'id,asset_no,serial_number:serial_no,serial_no,position,brand,size,tread_depth,cost_per_tyre,issue_date,km_at_fitment,km_at_removal,risk_level,site,country'

/**
 * List scheduled rotations, earliest first. Null-safe country scoping so
 * uncategorised rows are never silently dropped.
 * @param {{country?:string}} [opts]
 */
export async function listRotations({ country } = {}) {
  let q = supabase
    .from('tyre_rotations')
    .select(COLS)
    .order('scheduled_date', { ascending: true })
  q = applyCountry(q, country)
  return unwrap(await q)
}

/** Get one scheduled rotation by id (or null if not found). */
export async function getRotation(id) {
  return unwrap(await supabase.from('tyre_rotations').select(COLS).eq('id', id).maybeSingle())
}

/** Insert one or more schedule rows. Accepts an array; returns the new ids ([{id}]). */
export async function createRotations(rows) {
  return unwrap(await supabase.from('tyre_rotations').insert(rows).select('id')) || []
}

/** Update a scheduled rotation by id. */
export async function updateRotation(id, patch) {
  return unwrap(await supabase.from('tyre_rotations').update(patch).eq('id', id))
}

/** Delete a scheduled rotation by id. */
export async function deleteRotation(id) {
  return unwrap(await supabase.from('tyre_rotations').delete().eq('id', id))
}

/**
 * Fully-paged tyre_records read for rotation analytics: ascending by issue_date
 * with STRICT country scoping (exact match, no NULL inclusion) to match the
 * page's prior .eq('country', ...) behaviour. Returns the complete dataset.
 * @param {{country?:string}} [opts]
 * @returns {Promise<Array>} all matching records
 */
export async function listRotationRecords({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    let query = supabase
      .from('tyre_records')
      .select(RECORD_COLS)
      .order('issue_date', { ascending: true })
    if (country && country !== 'All') {
      query = query.eq('country', country)
    }
    return query.order('id', { ascending: true }).range(from, to)
  }, { max: ROTATION_RECORD_MAX })
  if (error) throw new ServiceError(toUserMessage(error), error.code, error)
  return data || []
}

// ── Attachments (private `tyre-photos` bucket, signed URLs on display) ──────

export const ATTACHMENT_BUCKET = 'tyre-photos'
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
const ATTACHMENT_TYPES = Object.freeze({
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'application/pdf': ['pdf'],
})
export const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf'

/** Filename safe for a storage key: letters, digits, dot, dash, underscore. */
export function safeFileName(name) {
  const cleaned = String(name || 'file').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '')
  return (cleaned || 'file').slice(-80)
}

/** Validate a file before upload. Returns an error message or ''. */
export function validateAttachment(file) {
  if (!file || typeof file !== 'object') return 'No file was chosen.'
  const exts = ATTACHMENT_TYPES[file.type]
  const ext = String(file.name || '').split('.').pop().toLowerCase()
  if (!exts || !exts.includes(ext)) return 'Only JPG, PNG or PDF files are allowed.'
  if (!(Number(file.size) > 0)) return 'The file is empty.'
  if (Number(file.size) > ATTACHMENT_MAX_BYTES) return 'Each file must be 10 MB or smaller.'
  return ''
}

/** Storage key for a rotation attachment. */
export function attachmentPath(orgId, rotationId, fileName, now = Date.now()) {
  return `${orgId}/rotations/${rotationId}/${now}-${safeFileName(fileName)}`
}

/**
 * Upload one file and return its attachment entry. The caller appends it to
 * the row's attachments array with updateRotation.
 */
export async function uploadRotationAttachment(file, { orgId, rotationId }) {
  const msg = validateAttachment(file)
  if (msg) throw new ServiceError(msg)
  if (!orgId || !rotationId) throw new ServiceError('Save the schedule before adding files.')
  const path = attachmentPath(orgId, rotationId, file.name)
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, file, {
    upsert: false, contentType: file.type, cacheControl: '3600',
  })
  if (error) throw new ServiceError(toUserMessage(error, 'The file could not be uploaded.'), error.code, error)
  return { path, name: String(file.name || 'file').slice(0, 200), type: file.type, size: Number(file.size) || 0, uploaded_at: new Date().toISOString() }
}

/** Short-lived signed URL for an attachment entry; null when it cannot be resolved. */
export async function attachmentUrl(att) {
  if (!att?.path) return null
  return resolveStorageUrl(`tp-storage://${ATTACHMENT_BUCKET}/${att.path}`)
}
