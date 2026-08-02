import { supabase } from './supabase'

/**
 * Fetch ALL rows from a Supabase query, transparently paging past the
 * PostgREST max-rows cap (default 1000). Use for exports/analytics that must
 * see the complete dataset rather than the first page.
 *
 * Performance: page 0 is fetched alone (so a small result stays a single round
 * trip); once we know more rows exist, remaining pages are fetched in CONCURRENT
 * windows of `concurrency` requests instead of strictly one-at-a-time. On a large
 * table (e.g. 200k rows / 200 pages) this turns ~200 serial round trips into ~50
 * windowed batches, cutting wall-clock roughly `concurrency`x while preserving row
 * order, the `max` ceiling, and the error short-circuit exactly.
 *
 * @param {(from:number,to:number)=>PromiseLike} pageFn  builder invoked per page,
 *        e.g. (from,to) => supabase.from('tyre_records').select('...').range(from,to)
 * @param {object} [opts]
 * @param {number} [opts.pageSize=1000]     rows per request (must be <= PostgREST db_max_rows)
 * @param {number} [opts.max=Infinity]      safety ceiling on total rows
 * @param {number} [opts.concurrency=4]     pages fetched in parallel per window
 * @returns {Promise<{data:any[], error:any, truncated:boolean}>}
 */
export async function fetchAllPages(pageFn, { pageSize = 1000, max = Infinity, concurrency = 4 } = {}) {
  const all = []
  const sliceMax = () => (max === Infinity ? all : all.slice(0, max))
  const GUARD = 10000 // hard stop to avoid runaway loops
  const win = Math.max(1, concurrency | 0)

  // Page 0 alone: keeps the common small-result case a single round trip.
  {
    const { data, error } = await pageFn(0, pageSize - 1)
    if (error) return { data: all, error, truncated: false }
    if (data?.length) all.push(...data)
    if (!data || data.length < pageSize) return { data: sliceMax(), error: null, truncated: false }
    if (all.length >= max) return { data: sliceMax(), error: null, truncated: true }
  }

  // More rows exist: fetch remaining pages in concurrent windows, in page order.
  let nextPage = 1
  while (nextPage < GUARD) {
    const reqs = []
    for (let i = 0; i < win && nextPage + i < GUARD; i++) {
      const from = (nextPage + i) * pageSize
      reqs.push(pageFn(from, from + pageSize - 1))
    }
    const results = await Promise.all(reqs)
    let reachedEnd = false
    for (const { data, error } of results) {
      if (error) return { data: all, error, truncated: false }
      if (data?.length) all.push(...data)
      if (!data || data.length < pageSize) { reachedEnd = true; break }
    }
    if (reachedEnd) break
    if (all.length >= max) return { data: sliceMax(), error: null, truncated: true }
    nextPage += win
  }
  return { data: sliceMax(), error: null, truncated: false }
}
