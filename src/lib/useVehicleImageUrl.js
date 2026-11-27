/**
 * Signed URL for a machine's own photo (`vehicle_fleet.image_path`, private
 * bucket vehicle-photos). Thumbnails rendered in the same tick are signed in
 * ONE createSignedUrls call; each URL is reused for ~50 minutes. A path that
 * could not be signed is remembered as null for 30 s only, so a brief network
 * fault does not hide a real photo for the rest of the session. null means
 * "show the class artwork".
 */
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const BUCKET = 'vehicle-photos'
const TTL_MS = 50 * 60 * 1000
const FAIL_TTL_MS = 30 * 1000
const cache = new Map() // path -> { url, at, ttl }
const inflight = new Map() // path -> Promise<string|null>
let queue = new Map() // path -> resolve
let scheduled = false

export function readImagePath(row) {
  const p = row?.image_path
  return typeof p === 'string' && p.trim() ? p.trim() : null
}

function remember(path, url) {
  cache.set(path, { url, at: Date.now(), ttl: url ? TTL_MS : FAIL_TTL_MS })
  inflight.delete(path)
}

async function flushQueue() {
  scheduled = false
  const batch = queue
  queue = new Map()
  const paths = [...batch.keys()]
  if (!paths.length) return
  let byPath = new Map()
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
    if (!error && Array.isArray(data)) {
      byPath = new Map(data.map((d) => [d.path, d.error ? null : (d.signedUrl ?? null)]))
    }
  } catch {
    // Every path in this batch falls back to the artwork for 30 s.
  }
  for (const [path, resolve] of batch) {
    const url = byPath.get(path) ?? null
    remember(path, url)
    resolve(url)
  }
}

export function signedVehicleImageUrl(path) {
  if (!path) return Promise.resolve(null)
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.url)
  if (inflight.has(path)) return inflight.get(path)
  const p = new Promise((resolve) => { queue.set(path, resolve) })
  inflight.set(path, p)
  if (!scheduled) {
    scheduled = true
    setTimeout(flushQueue, 0)
  }
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
export function _clearVehicleImageCache() {
  cache.clear(); inflight.clear(); queue = new Map(); scheduled = false
}
