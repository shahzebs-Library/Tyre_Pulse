import { supabase } from './supabase'

const REF_PREFIX = 'tp-storage://'
const SIGNED_URL_TTL_SECONDS = 60 * 60

export function storageRef(bucket: string, path: string): string {
  return `${REF_PREFIX}${bucket}/${path}`
}

export function parseStorageRef(value: string): { bucket: string; path: string } | null {
  if (!value.startsWith(REF_PREFIX)) return null

  const ref = value.slice(REF_PREFIX.length)
  const slashIndex = ref.indexOf('/')
  if (slashIndex <= 0) return null

  return {
    bucket: ref.slice(0, slashIndex),
    path: ref.slice(slashIndex + 1),
  }
}

export async function resolveStorageUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null
  if (value.startsWith('http') || value.startsWith('file://')) return value

  const ref = parseStorageRef(value)
  if (!ref) return value

  const { data, error } = await supabase.storage
    .from(ref.bucket)
    .createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS)

  if (error) {
    console.warn('[storageRefs] Failed to create signed URL:', error.message)
    return null
  }

  return data?.signedUrl ?? null
}

export async function resolveStorageUrls(values: string[]): Promise<string[]> {
  const urls = await Promise.all(values.map(value => resolveStorageUrl(value)))
  return urls.filter((url): url is string => Boolean(url))
}
