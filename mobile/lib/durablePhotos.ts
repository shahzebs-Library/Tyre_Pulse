/**
 * durablePhotos - crash and eviction safe storage for photos awaiting upload.
 *
 * FINDING #14 (P1): an offline record queues its photos as local file:// URIs.
 * The camera and image picker hand back paths inside the OS CACHE directory
 * (Paths.cache), which Android and iOS are free to purge at any time when the
 * device runs low on storage. If that purge happens before the queued upload
 * runs, the photo is lost for good.
 *
 * FIX: before a photo is queued we COPY the (already resized and compressed)
 * image out of cache into the app DOCUMENT directory (Paths.document plus a
 * queued-photos/ subfolder), which the OS never evicts. The queue stores that
 * durable path and uploads from it. The durable copy is deleted only AFTER the
 * upload is confirmed. An orphan sweep removes any durable file that no queue
 * entry references so the folder can never grow without bound.
 *
 * SDK note: this uses the SDK 54 File / Directory / Paths class API. The legacy
 * function API (FileSystem.copyAsync / getInfoAsync / readAsStringAsync) throws
 * at runtime in expo-file-system 19, so it must not be used here.
 */
import { Directory, File, Paths } from 'expo-file-system'
import { prepareForUpload } from './photoUpload'

/** Document-dir subfolder that holds queued photo blobs (never cache). */
const QUEUE_DIR_NAME = 'queued-photos'

/**
 * Durable descriptor recorded for every queued photo.
 *
 *  - localPath : a file:// URI INSIDE the document directory (survives OS cache
 *                eviction and app restarts).
 *  - size      : file size in bytes (diagnostics + no-space handling).
 *  - mimeType  : best-effort content type derived from the extension.
 *  - checksum  : integrity token. Ideally the file MD5 (a real CONTENT hash);
 *                on a platform/path where md5 cannot be read we fall back to a
 *                lightweight "size:mtime" token so the entry is still verifiable.
 *  - createdAt : epoch millis the durable copy was written.
 */
export interface DurablePhoto {
  localPath: string
  size: number
  mimeType: string
  checksum: string
  createdAt: number
}

function basenameOf(uri: string): string {
  return uri.split('/').pop() || ''
}

function mimeFromExt(uri: string): string {
  const ext = (uri.split('.').pop() || '').toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  return 'image/jpeg'
}

/** Handle to the durable folder (does not create it). */
function queueDir(): Directory {
  return new Directory(Paths.document, QUEUE_DIR_NAME)
}

/** Ensure the durable folder exists and return it. */
function ensureQueueDir(): Directory {
  const dir = queueDir()
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return dir
}

/** True when a path lives in our durable queued-photos folder (vs a cache uri). */
export function isDurablePhotoPath(uri: string | null | undefined): boolean {
  if (!uri) return false
  return uri.includes(`/${QUEUE_DIR_NAME}/`)
}

/**
 * Resolve a stored durable path to a currently-valid file:// URI. iOS may change
 * the document container path across app launches, which would leave an absolute
 * path stale; if the exact stored uri no longer exists but a file with the same
 * basename exists in the current durable folder, that healed uri is returned.
 * Non-durable paths (cache uris, refs) pass through untouched.
 */
export function resolveDurablePath(storedUri: string): string {
  if (!isDurablePhotoPath(storedUri)) return storedUri
  try {
    const direct = new File(storedUri)
    if (direct.exists) return direct.uri
    const name = basenameOf(storedUri)
    if (name) {
      const healed = new File(queueDir(), name)
      if (healed.exists) return healed.uri
    }
  } catch (err: any) {
    if (__DEV__) console.warn('[durablePhotos] resolve failed:', err?.message)
  }
  return storedUri
}

/**
 * Copy a captured/picked image into durable document storage BEFORE it is queued.
 * Runs prepareForUpload first (resize + compress) so the durable copy stays small,
 * then persists it and records an integrity descriptor.
 *
 * @param uri file:// URI from expo-camera / expo-image-picker (cache path)
 * @returns a DurablePhoto descriptor, or null if it could not be persisted (for
 *          example the device is out of space) so the caller can keep the data
 *          row and drop only the un-persistable photo.
 */
export async function persistPhotoForQueue(uri: string): Promise<DurablePhoto | null> {
  try {
    if (!uri || !uri.startsWith('file://')) return null

    // Already durable (e.g. re-enqueued): describe in place, never copy again.
    if (isDurablePhotoPath(uri)) {
      const existing = new File(uri)
      if (!existing.exists) return null
      const size = existing.size
      return {
        localPath: existing.uri,
        size,
        mimeType: mimeFromExt(existing.uri),
        checksum: existing.md5 ?? `${size}:${existing.modificationTime ?? 0}`,
        createdAt: Date.now(),
      }
    }

    // Resize/compress FIRST so we persist the small JPEG, not the raw capture.
    const resized = await prepareForUpload(uri)
    const source = new File(resized)
    if (!source.exists) return null

    const dir = ensureQueueDir()
    const rawExt = (basenameOf(resized).split('.').pop() || 'jpg').toLowerCase()
    const ext = rawExt.replace(/[^a-z0-9]/g, '') || 'jpg'
    const name = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    const dest = new File(dir, name)

    // copy() throws if the destination cannot be written (e.g. no space); the
    // catch below turns that into a null return so the record is still queued.
    source.copy(dest)

    const size = dest.size
    return {
      localPath: dest.uri,
      size,
      // A real content hash (MD5) is the ideal integrity token; the size:mtime
      // fallback is only used when md5 is unreadable on the platform.
      checksum: dest.md5 ?? `${size}:${dest.modificationTime ?? 0}`,
      mimeType: mimeFromExt(dest.uri),
      createdAt: Date.now(),
    }
  } catch (err: any) {
    if (__DEV__) console.warn('[durablePhotos] persist failed:', err?.message)
    return null
  }
}

/** Delete a durable copy. No-op for non-durable paths (cache uris / refs). */
export function deleteDurablePhoto(uri: string | null | undefined): void {
  try {
    if (!uri || !isDurablePhotoPath(uri)) return
    const f = new File(uri)
    if (f.exists) f.delete()
  } catch (err: any) {
    if (__DEV__) console.warn('[durablePhotos] delete failed:', err?.message)
  }
}

/**
 * Remove any durable photo file that no live queue entry references. Comparison
 * is by BASENAME so it stays correct even if an absolute path drifted across an
 * iOS container change. Safe to call opportunistically (e.g. after every sync or
 * on app start): only files this module wrote live in the durable folder.
 *
 * @param activePaths the durable photo paths still referenced by pending records
 */
export function cleanupOrphanDurablePhotos(activePaths: Iterable<string>): void {
  try {
    const dir = queueDir()
    if (!dir.exists) return
    const activeNames = new Set<string>()
    for (const p of activePaths) {
      const n = basenameOf(p)
      if (n) activeNames.add(n)
    }
    for (const entry of dir.list()) {
      if (entry instanceof File && !activeNames.has(basenameOf(entry.uri))) {
        entry.delete()
      }
    }
  } catch (err: any) {
    if (__DEV__) console.warn('[durablePhotos] orphan sweep failed:', err?.message)
  }
}
