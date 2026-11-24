/**
 * A small in-memory read cache: one request per key at a time (concurrent
 * callers share it) and a short time-to-live for the settled value.
 *
 * Only for setup reads that change rarely (configuration, branding, module
 * status). Callers MUST put the signed-in user and organisation in the key and
 * clear the cache when that identity changes, so one person's answer is never
 * served to another. Failed reads are never cached: the next call asks again.
 */
export function createRequestCache({ ttlMs = 60000, now = () => Date.now() } = {}) {
  const values = new Map() // key -> { value, at }
  const inflight = new Map() // key -> promise
  let generation = 0

  return {
    /**
     * @param {string} key
     * @param {() => Promise<any>} loader
     * @param {{ force?: boolean, cacheIf?: (value:any) => boolean }} [opts]
     */
    get(key, loader, { force = false, cacheIf = () => true } = {}) {
      if (!force) {
        const hit = values.get(key)
        if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value)
        const pending = inflight.get(key)
        if (pending) return pending
      }
      const startedIn = generation
      const run = Promise.resolve().then(loader)
      const tracked = run.then((value) => {
        // A clear or invalidate while this was in flight means the answer may
        // describe the old state; hand it to this caller but do not keep it.
        if (startedIn === generation && cacheIf(value)) values.set(key, { value, at: now() })
        return value
      })
      inflight.set(key, tracked)
      const release = () => { if (inflight.get(key) === tracked) inflight.delete(key) }
      tracked.then(release, release)
      return tracked
    },
    /** Drop every entry whose key starts with `prefix` (all entries when omitted). */
    invalidate(prefix = '') {
      generation += 1
      for (const k of [...values.keys()]) if (k.startsWith(prefix)) values.delete(k)
      for (const k of [...inflight.keys()]) if (k.startsWith(prefix)) inflight.delete(k)
    },
    clear() {
      generation += 1
      values.clear()
      inflight.clear()
    },
  }
}
