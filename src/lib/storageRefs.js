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
    console.warn('[storageRefs] Failed to create signed URL:', error.message)
    return null
  }

  return data?.signedUrl ?? null
}

export async function resolveStorageUrls(values) {
  const urls = await Promise.all((values ?? []).map(value => resolveStorageUrl(value)))
  return urls.filter(Boolean)
}
