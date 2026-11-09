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
