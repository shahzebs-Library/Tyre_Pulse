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

/**
 * Page a SET-RETURNING `supabase.rpc(...)`, stopping when a page contributes
 * nothing new.
 *
 * WHY THIS IS NOT JUST fetchAllPages. PostgREST caps an RPC response at
 * db-max-rows (1,000 here) exactly as it caps a table read, so a set-returning
 * function MUST be paged - `reference_asset_options` returns 1,033 rows for a
 * real KSA-only Manager and `import_existing_keys` returns 8,432 for the tyre
 * module. But `.range()` on an RPC is a different code path from `.range()` on
 * a table, and this codebase had no prior instance of it, so I could not point
 * at a working precedent.
 *
 * The failure mode if a server ever ignored the range on an RPC is not a short
 * list - it is every page returning the SAME first 1,000 rows, and
 * `fetchAllPages` would keep asking until it hit its ceiling, doing thousands of
 * pointless round trips and returning the same rows over and over.
 *
 * So this pages by IDENTITY rather than by trusting the offset: each page is
 * folded into a Set through `keyOf`, and the moment a page adds NOTHING new the
 * read is finished. That is correct when ranging works (the last page is short
 * or empty) AND when it does not (page 2 repeats page 1 and we stop after one
 * wasted request instead of thousands). It also removes any chance of a
 * duplicate reaching the caller.
 *
 * @param {(from:number,to:number)=>PromiseLike} pageFn
 * @param {(row:any)=>string|null} keyOf  identity for a row; null drops it
 * @param {{pageSize?:number, max?:number}} [opts]
 * @returns {Promise<{data:any[], error:any, truncated:boolean}>}
 */
export async function fetchAllRpcPages(pageFn, keyOf, { pageSize = 1000, max = 100000 } = {}) {
  const seen = new Set()
  const out = []
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await pageFn(from, Math.min(from + pageSize, max) - 1)
    if (error) return { data: out, error, truncated: false }
    const batch = Array.isArray(data) ? data : []
    let added = 0
    for (const row of batch) {
      const k = keyOf(row)
      if (k == null || seen.has(k)) continue
      seen.add(k)
      out.push(row)
      added += 1
    }
    // A short page means the set is exhausted. A FULL page that added nothing
    // new means the server is not honouring the range, and asking again would
    // return the same rows forever.
    if (batch.length < pageSize || added === 0) {
      return { data: out, error: null, truncated: false }
    }
  }
  return { data: out, error: null, truncated: true }
}
