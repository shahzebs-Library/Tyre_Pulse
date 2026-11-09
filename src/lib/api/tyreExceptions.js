import { supabase, toServiceError } from './_client'

/** Tyre data-quality exceptions (public.get_tyre_exceptions). RLS scopes rows. */
export async function getTyreExceptions({ country } = {}) {
  const p_country = country && country !== 'All' ? country : null
  const { data, error } = await supabase.rpc('get_tyre_exceptions', { p_country })
  if (error) throw toServiceError(error)
  return data || {}
}

/**
 * Rotation closer (public.tyre_close_rotations). Dry run by default; a real run
 * is logged to tyre_replacement_log and reversed by tyre_replacement_undo(batch).
 */
export async function closeRotations({ dryRun = true, country } = {}) {
  const p_country = country && country !== 'All' ? country : null
  const { data, error } = await supabase.rpc('tyre_close_rotations', { p_dry_run: dryRun, p_country })
  if (error) throw toServiceError(error)
  return data || { rotations: 0, rows: [] }
}

const scope = (country) => (country && country !== 'All' ? country : null)

/**
 * Every outstanding tyre exception (public.get_tyre_exceptions_v2, migration
 * 20261110113000): counts per kind and country plus one page of rows with the
 * review status. Read-only; the rotation list inside comes from the rotation
 * closer's DRY RUN only.
 */
export async function getTyreExceptionsV2({ country, kind, status, limit = 100, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('get_tyre_exceptions_v2', {
    p_country: scope(country), p_kind: kind || null, p_status: status || null, p_limit: limit, p_offset: offset,
  })
  if (error) throw toServiceError(error)
  return data || { counts: [], rows: [], total: 0 }
}

/** All rows for the current filter, paged 1,000 at a time (export). Stops at `max`. */
export async function getAllTyreExceptionsV2({ country, kind, status, max = 20000 } = {}) {
  const out = []
  let total = null
  for (let offset = 0; offset < max; offset += 1000) {
    const page = await getTyreExceptionsV2({ country, kind, status, limit: 1000, offset })
    total = Number(page.total ?? 0)
    const rows = Array.isArray(page.rows) ? page.rows : []
    out.push(...rows)
    if (rows.length < 1000 || out.length >= total) break
  }
  return { rows: out, total, truncated: total != null && out.length < total }
}

/**
 * Record a review (open / accepted / rejected / deferred + note). Writes only
 * the review tables; the server refuses protected exceptions and checks role,
 * organisation and country. Nothing in the tyre register changes.
 */
export async function setTyreExceptionReview({ key, kind, country, status, note } = {}) {
  const { data, error } = await supabase.rpc('set_tyre_exception_review', {
    p_key: key, p_kind: kind, p_country: country || null, p_status: status, p_note: note || null,
  })
  if (error) throw toServiceError(error)
  return data
}
