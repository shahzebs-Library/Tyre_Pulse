/**
 * fetchAllRows - paged reads for mobile pickers.
 *
 * Supabase/PostgREST caps EVERY response at 1000 rows (server max-rows), so a
 * `.limit(2000)` still returns 1000 - the KSA fleet crossed 1022 assets and
 * pickers silently lost the tail. The only way past the cap is `.range()` pages.
 *
 * buildQuery receives the (from, to) row window and must return a PostgREST
 * query that is ALREADY filtered/ordered - the order MUST include a unique
 * tiebreak (e.g. .order('asset_no').order('id')) or rows can drop/repeat at a
 * page boundary (asset_no is unique per COUNTRY, not globally).
 */
export async function fetchAllRows<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  opts: { pageSize?: number; max?: number } = {},
): Promise<T[]> {
  const pageSize = Math.max(1, Math.min(1000, opts.pageSize ?? 1000))
  const max = Math.max(pageSize, opts.max ?? 5000)
  const rows: T[] = []
  for (let from = 0; from < max; from += pageSize) {
    const to = Math.min(from + pageSize, max) - 1
    const { data, error } = await buildQuery(from, to)
    if (error) throw error
    const batch = Array.isArray(data) ? data : []
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows
}
