import { supabase } from './supabase'
import { safeImageSrc } from './safeUrl'

const REF_PREFIX = 'tp-storage://'
const SIGNED_URL_TTL_SECONDS = 60 * 60

export function parseStorageRef(value) {
  if (!value || typeof value !== 'string' || !value.startsWith(REF_PREFIX)) return null

  const ref = value.slice(REF_PREFIX.length)
  const slashIndex = ref.indexOf('/')
  if (slashIndex <= 0) return null

  return {
    bucket: ref.slice(0, slashIndex),
    path: ref.slice(slashIndex + 1),
  }
}

export async function resolveStorageUrl(value) {
  if (!value) return null
  if (typeof value !== 'string') return null
  // Direct URLs (http/https/data:image/blob) — pass through the scheme allowlist so
  // a poisoned value (javascript:, data:text/html, …) can never reach an href/src.
  if (value.startsWith('http') || value.startsWith('data:') || value.startsWith('blob:')) {
    return safeImageSrc(value) ?? null
  }

  const ref = parseStorageRef(value)
  // Not a tp-storage ref and not a recognised URL scheme → validate before returning.
  if (!ref) return safeImageSrc(value) ?? null

  const { data, error } = await supabase.storage
    .from(ref.bucket)
    .createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS)

  if (error) {
    if (import.meta.env?.DEV) console.warn('[storageRefs] Failed to create signed URL:', error.message)
    return null
  }

  return data?.signedUrl ?? null
}

export async function resolveStorageUrls(values) {
  const urls = await Promise.all((values ?? []).map(value => resolveStorageUrl(value)))
  return urls.filter(Boolean)
}

const SIGN_BATCH = 100

/**
 * Resolve many refs to URLs with ONE createSignedUrls call per bucket per 100 paths
 * (instead of one request per photo). Returns { [ref]: url | null }; a ref that
 * cannot be signed maps to null so callers can say "not available".
 */
export async function resolveStorageUrlMap(values) {
  const out = {}
  const byBucket = new Map()
  for (const value of new Set((values ?? []).filter(v => typeof v === 'string' && v))) {
    const ref = parseStorageRef(value)
    if (!ref) { out[value] = await resolveStorageUrl(value); continue }
    if (!byBucket.has(ref.bucket)) byBucket.set(ref.bucket, [])
    byBucket.get(ref.bucket).push({ value, path: ref.path })
  }
  for (const [bucket, items] of byBucket) {
    for (let i = 0; i < items.length; i += SIGN_BATCH) {
      const chunk = items.slice(i, i + SIGN_BATCH)
      let signed = null
      try {
        const { data, error } = await supabase.storage.from(bucket)
          .createSignedUrls(chunk.map(item => item.path), SIGNED_URL_TTL_SECONDS)
        if (!error) signed = data
      } catch { /* every ref in the chunk stays null */ }
      const byPath = new Map((signed ?? []).map(entry => [entry.path, entry]))
      for (const item of chunk) {
        const entry = byPath.get(item.path)
        out[item.value] = entry && !entry.error ? (entry.signedUrl ?? null) : null
      }
    }
  }
  return out
}
