/**
 * photoUpload
 *
 * Uploads a local file:// URI to Supabase Storage `inspection-photos` bucket.
 * Returns the permanent public URL on success, null on failure.
 * Used by the offline queue sync loop before inserting inspection records.
 */

import * as FileSystem from 'expo-file-system'
import { supabase } from './supabase'
import { storageRef } from './storageRefs'

const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif'])
const MAX_PHOTO_BYTES = 20 * 1024 * 1024 // 20 MB

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
    const rawExt = localUri.split('.').pop()?.toLowerCase() ?? 'jpg'
    if (!ALLOWED_EXTS.has(rawExt)) return null

    // Normalise extension — some devices return HEIC; storage serves as jpeg
    const ext = rawExt === 'heic' || rawExt === 'heif' ? 'jpg' : rawExt
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'

    const info = await FileSystem.getInfoAsync(localUri)
    if (info.exists && (info as any).size > MAX_PHOTO_BYTES) return null

    // Build deterministic storage path:  inspections/<id>/<position>_<timestamp>.<ext>
    const sanitisedPosition = tyrePosition.replace(/[^a-zA-Z0-9_-]/g, '_')
    const path = `inspections/${inspectionId}/${sanitisedPosition}_${Date.now()}.${ext}`

    // Read file as base64 — required for RN where Blob is not a true File
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: 'base64',
    })

    const bytes = decodeBase64(base64)

    const { error } = await supabase.storage
      .from('inspection-photos')
      .upload(path, bytes, { contentType, upsert: false })

    if (error) {
      if (__DEV__) console.warn('[photoUpload] Storage upload error:', error.message)
      return null
    }

    return storageRef('inspection-photos', path)
  } catch (err: any) {
    if (__DEV__) console.warn('[photoUpload] Unexpected error:', err?.message)
    return null
  }
}

/**
 * Upload a captured accident photo to the PRIVATE `accident-photos` bucket.
 * Uses base64 → Uint8Array (RN's fetch().blob() yields empty files in Expo).
 * Returns a tp-storage:// ref (resolved to a short-lived signed URL on display
 * via storageRefs.resolveStorageUrl) — never a permanent public URL — or null
 * on failure.
 *
 * Path is collision-resistant: accidents/<uid>/<timestamp>_<index>_<random4>.<ext>
 */
export async function uploadAccidentPhoto(localUri: string, index = 0): Promise<string | null> {
  // Reject anything that isn't a local file URI — never store http/data URIs directly
  if (!localUri || !localUri.startsWith('file://')) return null
  try {
    const rawExt = localUri.split('.').pop()?.toLowerCase() ?? 'jpg'
    if (!ALLOWED_EXTS.has(rawExt)) return null

    const ext = rawExt === 'heic' || rawExt === 'heif' ? 'jpg' : rawExt
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'

    const info = await FileSystem.getInfoAsync(localUri)
    if (info.exists && (info as any).size > MAX_PHOTO_BYTES) return null

    // Collision-resistant path: include user uid + timestamp + random suffix
    const { data: { user } } = await supabase.auth.getUser()
    const uid = user?.id?.slice(0, 8) ?? 'anon'
    const rand = Math.random().toString(36).slice(2, 6)
    const path = `accidents/${uid}/${Date.now()}_${index}_${rand}.${ext}`

    const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' })
    const bytes = decodeBase64(base64)

    const { error } = await supabase.storage
      .from('accident-photos')
      .upload(path, bytes, { contentType, upsert: false })
    if (error) {
      if (__DEV__) console.warn('[photoUpload] accident upload error:', error.message)
      return null
    }

    // Return a storage ref (resolved to signed URL on display) — keeps bucket private
    return storageRef('accident-photos', path)
  } catch (err: any) {
    if (__DEV__) console.warn('[photoUpload] accident upload failed:', err?.message)
    return null
  }
}

/**
 * Decode a base64 string into a Uint8Array.
 * atob is available globally in React Native via hermes.
 */
function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
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
