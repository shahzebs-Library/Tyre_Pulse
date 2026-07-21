/**
 * photoUpload
 *
 * Uploads a local file:// URI to Supabase Storage `inspection-photos` bucket.
 * Returns the permanent public URL on success, null on failure.
 * Used by the offline queue sync loop before inserting inspection records.
 */

import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { supabase } from './supabase'
import { storageRef } from './storageRefs'

const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif'])

// Resize/compress every captured photo BEFORE reading it into JS memory.
const MAX_UPLOAD_DIM = 1600 // px, resize target width (aspect preserved)
const UPLOAD_COMPRESS = 0.5 // JPEG quality after resize
const MAX_DECODE_BYTES = 12 * 1024 * 1024 // hard cap on the file we base64-decode

/**
 * Shrink and compress a locally captured image before it is read as base64.
 *
 * Camera photos are multi-megapixel and expo-image-picker's quality option
 * only compresses, it does NOT reduce dimensions. Reading several full-size
 * images into JS memory as base64 (atob -> Uint8Array) can exhaust native
 * memory and crash the app (a native OOM that try/catch cannot recover from).
 * Resizing to a max width + re-encoding as JPEG cuts the in-memory bytes
 * roughly 10x, so the decode stays small.
 *
 * Never throws: if manipulation fails for any reason the ORIGINAL uri is
 * returned so the upload still proceeds (just larger).
 *
 * @param localUri file:// URI from expo-camera / expo-image-picker
 * @returns a new (smaller) file:// URI, or the original on any failure
 */
export async function prepareForUpload(localUri: string): Promise<string> {
  if (!localUri || !localUri.startsWith('file://')) return localUri
  try {
    const context = ImageManipulator.manipulate(localUri)
    context.resize({ width: MAX_UPLOAD_DIM })
    const image = await context.renderAsync()
    const result = await image.saveAsync({ compress: UPLOAD_COMPRESS, format: SaveFormat.JPEG })
    return result?.uri || localUri
  } catch (err: any) {
    if (__DEV__) console.warn('[photoUpload] resize skipped:', err?.message)
    return localUri
  }
}

/**
 * Upload a locally captured photo to Supabase Storage.
 *
 * @param localUri   - file:// URI from expo-camera / expo-image-picker
 * @param inspectionId - logical inspection identifier (queue item id or UUID)
 * @param tyrePosition - tyre position label e.g. "FL", "RL1"
 * @returns permanent public URL or null if upload failed
 */
export async function uploadInspectionPhoto(
  localUri: string,
  inspectionId: string,
  tyrePosition: string
): Promise<string | null> {
  if (!localUri || !localUri.startsWith('file://')) return null

  try {
    // Resize/compress first so the base64 decode below stays small (avoids OOM).
    const uploadUri = await prepareForUpload(localUri)

    const rawExt = uploadUri.split('.').pop()?.toLowerCase() ?? 'jpg'
    if (!ALLOWED_EXTS.has(rawExt)) return null

    // Normalise extension - some devices return HEIC; storage serves as jpeg
    const ext = rawExt === 'heic' || rawExt === 'heif' ? 'jpg' : rawExt
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'

    if (fileSizeBytes(uploadUri) > MAX_DECODE_BYTES) return null

    // Build deterministic storage path:  inspections/<id>/<position>_<timestamp>.<ext>
    const sanitisedPosition = tyrePosition.replace(/[^a-zA-Z0-9_-]/g, '_')
    const path = `inspections/${inspectionId}/${sanitisedPosition}_${Date.now()}.${ext}`

    // Read file as raw bytes (SDK 54 File API) - RN Blob is not a true File
    const bytes = await readFileBytes(uploadUri)

    const { error } = await supabase.storage
      .from('tyre-photos')
      .upload(path, bytes, { contentType, upsert: true })

    if (error) {
      if (__DEV__) console.warn('[photoUpload] Storage upload error:', error.message)
      return null
    }

    return storageRef('tyre-photos', path)
  } catch (err: any) {
    if (__DEV__) console.warn('[photoUpload] Unexpected error:', err?.message)
    return null
  }
}

/**
 * Upload a captured accident photo to the PRIVATE `accident-photos` bucket.
 * Uses base64 → Uint8Array (RN's fetch().blob() yields empty files in Expo).
 * Returns a tp-storage:// ref (resolved to a short-lived signed URL on display
 * via storageRefs.resolveStorageUrl) - never a permanent public URL - or null
 * on failure.
 *
 * Path is collision-resistant: accidents/<uid>/<timestamp>_<index>_<random4>.<ext>
 */
export async function uploadAccidentPhoto(localUri: string, index = 0): Promise<string | null> {
  // Reject anything that isn't a local file URI - never store http/data URIs directly
  if (!localUri || !localUri.startsWith('file://')) return null
  try {
    // Resize/compress first so the base64 decode below stays small (avoids OOM).
    const uploadUri = await prepareForUpload(localUri)

    const rawExt = uploadUri.split('.').pop()?.toLowerCase() ?? 'jpg'
    if (!ALLOWED_EXTS.has(rawExt)) return null

    const ext = rawExt === 'heic' || rawExt === 'heif' ? 'jpg' : rawExt
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'

    if (fileSizeBytes(uploadUri) > MAX_DECODE_BYTES) return null

    // Collision-resistant path: include user uid + timestamp + random suffix
    const { data: { user } } = await supabase.auth.getUser()
    const uid = user?.id?.slice(0, 8) ?? 'anon'
    const rand = Math.random().toString(36).slice(2, 6)
    const path = `accidents/${uid}/${Date.now()}_${index}_${rand}.${ext}`

    const bytes = await readFileBytes(uploadUri)

    const { error } = await supabase.storage
      .from('accident-photos')
      .upload(path, bytes, { contentType, upsert: false })
    if (error) {
      if (__DEV__) console.warn('[photoUpload] accident upload error:', error.message)
      return null
    }

    // Return a storage ref (resolved to signed URL on display) - keeps bucket private
    return storageRef('accident-photos', path)
  } catch (err: any) {
    if (__DEV__) console.warn('[photoUpload] accident upload failed:', err?.message)
    return null
  }
}

/**
 * Upload a module photo (Tyre Change / RCA / Report Issue) to the PRIVATE
 * `tyre-photos` bucket, scoped by module + user. Returns a tp-storage:// ref
 * (resolved to a signed URL on display) or null on failure.
 *
 * Path: modules/<module>/<uid>/<timestamp>_<index>_<random4>.<ext>
 */
export async function uploadModulePhoto(
  localUri: string,
  module: string,
  index = 0,
): Promise<string | null> {
  if (!localUri || !localUri.startsWith('file://')) return null
  try {
    // Resize/compress first so the base64 decode below stays small (avoids OOM).
    const uploadUri = await prepareForUpload(localUri)

    const rawExt = uploadUri.split('.').pop()?.toLowerCase() ?? 'jpg'
    if (!ALLOWED_EXTS.has(rawExt)) return null

    const ext = rawExt === 'heic' || rawExt === 'heif' ? 'jpg' : rawExt
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'

    if (fileSizeBytes(uploadUri) > MAX_DECODE_BYTES) return null

    const { data: { user } } = await supabase.auth.getUser()
    const uid = user?.id?.slice(0, 8) ?? 'anon'
    const rand = Math.random().toString(36).slice(2, 6)
    const safeModule = (module || 'module').replace(/[^a-zA-Z0-9_-]/g, '-')
    const path = `modules/${safeModule}/${uid}/${Date.now()}_${index}_${rand}.${ext}`

    const bytes = await readFileBytes(uploadUri)

    const { error } = await supabase.storage
      .from('tyre-photos')
      .upload(path, bytes, { contentType, upsert: false })
    if (error) {
      if (__DEV__) console.warn('[photoUpload] module upload error:', error.message)
      return null
    }
    return storageRef('tyre-photos', path)
  } catch (err: any) {
    if (__DEV__) console.warn('[photoUpload] module upload failed:', err?.message)
    return null
  }
}

/**
 * Resolve a mixed array of photo references for a module record before DB
 * insert. Entries that are already permanent references (tp-storage:// or
 * http) pass through untouched; local file:// URIs are uploaded now and
 * replaced with their refs. Any file:// that still fails to upload (e.g.
 * offline) is DROPPED so no dead local URI is ever persisted - the caller
 * keeps the file:// in its queued payload and this runs again on the next
 * sync attempt.
 *
 * @returns the resolved refs and whether any local photo could not be uploaded
 *          (so the caller can keep the record pending instead of "synced").
 */
export async function uploadPendingPhotos(
  photos: string[],
  module: string,
): Promise<{ resolved: string[]; pending: boolean }> {
  const resolved: string[] = []
  let pending = false
  let index = 0
  for (const p of photos) {
    if (!p) { index++; continue }
    if (p.startsWith('file://')) {
      const ref = await uploadModulePhoto(p, module, index)
      if (ref) resolved.push(ref)
      else pending = true
    } else {
      resolved.push(p) // already a permanent ref/URL
    }
    index++
  }
  return { resolved, pending }
}

/**
 * Read a local file as raw bytes for upload using the SDK 54 File API.
 *
 * The legacy FileSystem.readAsStringAsync throws at runtime in expo-file-system
 * 19, so we read via new File(uri).bytes(), which also skips the intermediate
 * base64 string (less peak memory than atob decoding).
 */
async function readFileBytes(uri: string): Promise<Uint8Array> {
  return await new File(uri).bytes()
}

/** File size in bytes via the SDK 54 File API; 0 when unreadable. */
function fileSizeBytes(uri: string): number {
  try {
    const f = new File(uri)
    return f.exists ? f.size : 0
  } catch {
    return 0
  }
}

/**
 * Attempt to upload photos for all tyre positions in a payload.
 * Mutates the tyre_conditions map in-place:
 *   - sets photo_url to the remote URL on success
 *   - leaves photo_url as null if upload fails (degraded gracefully)
 *   - clears photo_uri after a successful upload to free local references
 *
 * @param tyreConditions - the tyre_conditions record from InspectionPayload
 * @param inspectionId   - logical identifier for this inspection (queue item id)
 * @returns the mutated record (same reference)
 */
export async function uploadAllPositionPhotos(
  tyreConditions: Record<string, { photo_uri: string | null; photo_url: string | null; [key: string]: any }>,
  inspectionId: string
): Promise<typeof tyreConditions> {
  const positions = Object.keys(tyreConditions)

  await Promise.all(
    positions.map(async pos => {
      const entry = tyreConditions[pos]
      // Only upload if there is a local URI and no permanent URL yet
      if (entry.photo_uri && !entry.photo_url) {
        const remoteUrl = await uploadInspectionPhoto(entry.photo_uri, inspectionId, pos)
        if (remoteUrl) {
          entry.photo_url = remoteUrl
          entry.photo_uri = null // clear local reference
        }
      }
    })
  )

  return tyreConditions
}
