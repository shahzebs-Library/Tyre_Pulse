/**
 * Run `fn(item, index)` over `items` with at most `limit` calls in flight, and
 * resolve to the results IN INPUT ORDER (never completion order).
 *
 * Why: every Supabase round trip from Riyadh costs ~250-450 ms of network
 * (docs/performance/REGION_LATENCY_AUDIT.md) while the server answers in
 * ~10 ms, so a loop that awaits one chunk at a time spends almost all of its
 * time waiting. Running a few chunks together cuts the wall clock roughly
 * `limit` times without changing what is read or written.
 *
 * Errors: the first rejection stops NEW calls from starting, waits for the
 * calls already in flight to settle (so nothing is left running behind the
 * caller's back), then rejects with the error of the EARLIEST failing index.
 * That is the same error a sequential loop would have thrown when every item
 * before it succeeded.
 *
 * Use it only where each call is independent of the others. Where a server
 * assigns numbers in arrival order, or a later call depends on an earlier
 * result, keep the sequential loop.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit  maximum calls in flight (>= 1)
 * @param {(item:T, index:number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.isArray(items) ? items : []
  const results = new Array(list.length)
  if (!list.length) return results
  const width = Math.max(1, Math.min(list.length, Math.floor(Number(limit)) || 1))
  let cursor = 0
  let failedAt = -1
  let failure
  const worker = async () => {
    for (;;) {
      if (failedAt !== -1) return
      const index = cursor
      cursor += 1
      if (index >= list.length) return
      try {
        results[index] = await fn(list[index], index)
      } catch (err) {
        if (failedAt === -1 || index < failedAt) { failedAt = index; failure = err }
        return
      }
    }
  }
  await Promise.all(Array.from({ length: width }, worker))
  if (failedAt !== -1) throw failure
  return results
}

/** Split `arr` into consecutive slices of `size` (last slice may be shorter). */
export function chunkArray(arr, size) {
  const list = Array.isArray(arr) ? arr : []
  const n = Math.max(1, Math.floor(Number(size)) || 1)
  const out = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

/**
 * Like mapWithConcurrency, but never rejects: every item runs and the result
 * for each is `{ ok: true, value }` or `{ ok: false, reason }`, in input order.
 * Use it to replay a sequential loop's decisions in order (for example "the
 * first failing chunk decides") without letting a later rejection win.
 */
export function mapSettled(items, limit, fn) {
  return mapWithConcurrency(items, limit, (item, index) =>
    Promise.resolve()
      .then(() => fn(item, index))
      .then((value) => ({ ok: true, value }), (reason) => ({ ok: false, reason })))
}

/** Unwrap one mapSettled entry: return the value, or rethrow the original error. */
export function settledValue(entry) {
  if (entry.ok) return entry.value
  throw entry.reason
}
