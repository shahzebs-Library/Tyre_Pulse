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

/**
 * Page a SET-RETURNING `supabase.rpc(...)`, stopping when a page adds nothing new.
 *
 * An RPC is capped at 1,000 rows just like a table read, so it has to be paged -
 * `reference_asset_options` returns 1,033 for a real KSA-only Manager. But
 * `.range()` on an RPC is a different server path from `.range()` on a table,
 * and if it were ever ignored the loop above would ask for the same first 1,000
 * rows over and over until it hit `max`: 20 wasted round trips on a field phone,
 * on a screen the user is waiting on.
 *
 * Paging by IDENTITY removes that risk entirely. Each page is folded into a Set
 * through `keyOf`; the first page that contributes nothing new ends the read.
 * Correct when ranging works (the last page is short) and when it does not (page
 * two repeats page one and we stop). Duplicates can never reach the caller.
 */
export async function fetchAllRpcRows<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  keyOf: (row: T) => string | null,
  opts: { pageSize?: number; max?: number } = {},
): Promise<T[]> {
  const pageSize = Math.max(1, Math.min(1000, opts.pageSize ?? 1000))
  const max = Math.max(pageSize, opts.max ?? 20000)
  const seen = new Set<string>()
  const out: T[] = []
  for (let from = 0; from < max; from += pageSize) {
    const to = Math.min(from + pageSize, max) - 1
    const { data, error } = await buildQuery(from, to)
    if (error) throw error
    const batch = Array.isArray(data) ? data : []
    let added = 0
    for (const row of batch) {
      const k = keyOf(row)
      if (k == null || seen.has(k)) continue
      seen.add(k)
      out.push(row)
      added += 1
    }
    if (batch.length < pageSize || added === 0) break
  }
  return out
}
