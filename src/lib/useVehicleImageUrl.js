/**
 * Signed URL for a machine's own photo (`vehicle_fleet.image_path`, private
 * bucket vehicle-photos). One request per path per hour, shared by every
 * thumbnail on the page. null while loading, when there is no path, or when
 * the photo cannot be read - the caller then shows the class artwork.
 */
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const TTL_MS = 50 * 60 * 1000
const cache = new Map() // path -> { url, at } | Promise

export function readImagePath(row) {
  const p = row?.image_path
  return typeof p === 'string' && p.trim() ? p.trim() : null
}

export function signedVehicleImageUrl(path) {
  if (!path) return Promise.resolve(null)
  const hit = cache.get(path)
  if (hit instanceof Promise) return hit
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.url)
  const p = supabase.storage.from('vehicle-photos').createSignedUrl(path, 3600)
    .then(({ data, error }) => {
      const url = error ? null : (data?.signedUrl ?? null)
      cache.set(path, { url, at: Date.now() })
      return url
    })
    .catch(() => { cache.delete(path); return null })
  cache.set(path, p)
  return p
}

export function useVehicleImageUrl(row) {
  const path = readImagePath(row)
  const [state, setState] = useState({ path: null, url: null })
  useEffect(() => {
    if (!path) return undefined
    let alive = true
    signedVehicleImageUrl(path).then((url) => { if (alive) setState({ path, url }) })
    return () => { alive = false }
  }, [path])
  return path && state.path === path ? state.url : null
}

/** Test seam. */
export function _clearVehicleImageCache() { cache.clear() }
