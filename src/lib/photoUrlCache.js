/**
 * Signed photo URL resolver for evidence galleries.
 *
 * Why this exists: the inspection drawer used to start one createSignedUrl request per
 * photo the moment it opened (a 13-tyre mixer = 13+ parallel requests, one React state
 * update each, again on every re-open). This resolver
 *  - de-duplicates identical refs (in flight and cached),
 *  - caches a successful URL for less than the signing lifetime (default 40 of 60 minutes),
 *  - never caches a failure for long (so a transient error can be retried),
 *  - runs at most `concurrency` lookups at once, in request order.
 * Callers resolve lazily (only photos on screen), so off-screen photos cost nothing.
 */
import { resolveStorageUrl } from './storageRefs'

export function createUrlResolver({
  resolve = resolveStorageUrl, ttlMs = 40 * 60 * 1000, failureTtlMs = 15 * 1000,
  concurrency = 4, now = () => Date.now(), maxEntries = 500,
} = {}) {
  const cache = new Map() // ref -> { url, expires }
  const inflight = new Map() // ref -> Promise
  const queue = []
  let active = 0
  const stats = { lookups: 0, hits: 0 }

  const pump = () => {
    while (active < concurrency && queue.length) {
      const job = queue.shift()
      active++
      Promise.resolve().then(() => resolve(job.ref)).then(
        url => job.done(url ?? null), () => job.done(null),
      ).finally(() => { active--; pump() })
    }
  }

  function get(ref) {
    if (!ref || typeof ref !== 'string') return Promise.resolve(null)
    const hit = cache.get(ref)
    if (hit && hit.expires > now()) { stats.hits++; return Promise.resolve(hit.url) }
    if (inflight.has(ref)) return inflight.get(ref)
    stats.lookups++
    const p = new Promise(res => {
      queue.push({
        ref,
        done: url => {
          if (cache.size >= maxEntries) cache.delete(cache.keys().next().value)
          cache.set(ref, { url, expires: now() + (url ? ttlMs : failureTtlMs) })
          inflight.delete(ref)
          res(url)
        },
      })
    })
    inflight.set(ref, p)
    pump()
    return p
  }
  return { get, stats, clear: () => { cache.clear() }, pending: () => active + queue.length }
}

/** Shared instance used by the AI inspection screens. */
export const photoUrlResolver = createUrlResolver()
