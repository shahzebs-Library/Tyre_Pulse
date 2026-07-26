/**
 * Fetch ALL rows from a Supabase query, transparently paging past the
 * PostgREST max-rows cap (default 1000).
 *
 * Mobile port of the web helper `src/lib/fetchAll.js`, deliberately sharing its
 * contract so both codebases page identically. Use this for ANY read whose
 * result feeds a user-visible TOTAL, COUNT or ranking: an un-paged read is
 * silently capped by PostgREST, so every figure derived from it is understated
 * with no error and no warning.
 *
 * Two rules for the caller:
 *  1. `pageFn` MUST build a FRESH query per call. A Supabase query builder can
 *     only be awaited once, so a single pre-built builder cannot be re-ranged.
 *  2. The query MUST carry a deterministic `.order()` on a unique column
 *     (normally the primary key). Without a total order, PostgREST may repeat
 *     or skip rows across page boundaries.
 *
 * This module is intentionally dependency-free (it takes the page builder as a
 * parameter) so it stays unit-testable under the pure ts-jest suite.
 */

/** The subset of a Supabase response this helper needs. */
export interface PageResult<T> {
  data: T[] | null
  error: any
}

export interface FetchAllOptions {
  /** Rows per request. Must be <= the PostgREST db_max_rows setting. */
  pageSize?: number
  /** Safety ceiling on total rows accumulated. Reaching it sets `truncated`. */
  max?: number
}

export interface FetchAllResult<T> {
  /** Every row fetched. On error, the pages that succeeded before it. */
  data: T[]
  /** The first page error, or null. Never thrown: callers decide. */
  error: any
  /** True only when the `max` ceiling cut the result short. */
  truncated: boolean
}

/** Default rows per request: matches the standard PostgREST db_max_rows. */
export const FETCH_PAGE_SIZE = 1000

/** Absolute loop ceiling so a misbehaving endpoint can never spin forever. */
const MAX_ITERATIONS = 10000

export async function fetchAllPages<T>(
  pageFn: (from: number, to: number) => PromiseLike<PageResult<T>>,
  { pageSize = FETCH_PAGE_SIZE, max = Infinity }: FetchAllOptions = {},
): Promise<FetchAllResult<T>> {
  // Clamp a nonsensical page size rather than issuing invalid ranges forever.
  const size = Math.max(1, Math.floor(pageSize) || FETCH_PAGE_SIZE)
  const all: T[] = []
  let from = 0
  let truncated = false

  for (let guard = 0; guard < MAX_ITERATIONS; guard++) {
    const { data, error } = await pageFn(from, from + size - 1)
    if (error) return { data: all, error, truncated }
    if (!data || data.length === 0) break
    all.push(...data)
    // A short page is the last page.
    if (data.length < size) break
    if (all.length >= max) { truncated = true; break }
    from += size
  }

  return {
    data: max === Infinity ? all : all.slice(0, max),
    error: null,
    truncated,
  }
}
