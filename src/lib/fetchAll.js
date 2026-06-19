import { supabase } from './supabase'

/**
 * Fetch ALL rows from a Supabase query, transparently paging past the
 * PostgREST max-rows cap (default 1000). Use for exports/analytics that must
 * see the complete dataset rather than the first page.
 *
 * @param {(from:number,to:number)=>PromiseLike} pageFn  builder invoked per page,
 *        e.g. (from,to) => supabase.from('tyre_records').select('...').range(from,to)
 * @param {object} [opts]
 * @param {number} [opts.pageSize=1000]  rows per request (must be <= PostgREST db_max_rows)
 * @param {number} [opts.max=Infinity]   safety ceiling on total rows
 * @returns {Promise<{data:any[], error:any, truncated:boolean}>}
 */
export async function fetchAllPages(pageFn, { pageSize = 1000, max = Infinity } = {}) {
  const all = []
  let from = 0
  let truncated = false
  // hard stop to avoid runaway loops
  for (let guard = 0; guard < 10000; guard++) {
    const to = from + pageSize - 1
    const { data, error } = await pageFn(from, to)
    if (error) return { data: all, error, truncated }
    if (!data?.length) break
    all.push(...data)
    if (data.length < pageSize) break
    if (all.length >= max) { truncated = true; break }
    from += pageSize
  }
  return { data: max === Infinity ? all : all.slice(0, max), error: null, truncated }
}
