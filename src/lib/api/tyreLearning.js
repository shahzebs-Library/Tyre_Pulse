/**
 * Tyre Learning service (V471) - the Supabase boundary for the confirm-once,
 * auto-fix-now-and-future learning layer. Faithful pass-throughs over the
 * security-definer RPCs (tyre_learn_suggestions / tyre_learn_confirm /
 * tyre_learn_undo) and the tyre_learned_facts table (RLS-scoped).
 *
 * AUTH-SENSITIVE: every RPC self-gates server-side on app_is_elevated() and is
 * org-scoped. This layer never re-implements the gate. Read paths never throw
 * (return [] / honest empty). Write paths surface the error so the UI can report.
 */
import { supabase, unwrap } from './_client'

/**
 * Blank serials with a recoverable value (self/master) for a field. Only 'brand'
 * and 'size' are serial-recoverable. Never throws (returns [] on error).
 */
export async function listTyreSuggestions({ country = null, field = 'brand', limit = 200 } = {}) {
  try {
    const { data, error } = await supabase.rpc('tyre_learn_suggestions', {
      p_country: country && country !== 'All' ? country : null,
      p_limit: limit,
      p_field: field,
    })
    if (error) return []
    return Array.isArray(data?.suggestions) ? data.suggestions : []
  } catch {
    return []
  }
}

/**
 * Field-level gap overview (blank + recoverable counts per target field).
 * Never throws; returns the json object or { ok:false }.
 */
export async function getTyreGapOverview({ country = null } = {}) {
  try {
    const { data, error } = await supabase.rpc('get_tyre_gap_overview', {
      p_country: country && country !== 'All' ? country : null,
    })
    if (error || !data) return { ok: false }
    return data
  } catch {
    return { ok: false }
  }
}

/**
 * Per-column completeness of the KSA master upload staging table.
 * Never throws; returns the json object or { ok:false }.
 */
export async function getMasterCompleteness() {
  try {
    const { data, error } = await supabase.rpc('get_master_file_completeness')
    if (error || !data) return { ok: false }
    return data
  } catch {
    return { ok: false }
  }
}

/** The learned facts (confirmed rules) for this org. Never throws. */
export async function listLearnedFacts({ country = null } = {}) {
  try {
    let q = supabase
      .from('tyre_learned_facts')
      .select('id,country,match_type,match_value,target_field,target_value,source,active,confirmed_by,created_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(500)
    if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
    const { data, error } = await q
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * Confirm a fact. Dry-run returns the count that would be filled; apply upserts
 * the rule, fills current rows and future-proofs via the trigger.
 * @returns {Promise<{ok,dry_run,matched,filled,fact_id,batch_id}>}
 */
export async function confirmTyreFact({
  matchType, matchValue, targetField = 'brand', targetValue, country = null, source = 'manual', dryRun = true,
}) {
  return unwrap(
    await supabase.rpc('tyre_learn_confirm', {
      p_match_type: matchType,
      p_match_value: matchValue,
      p_target_field: targetField,
      p_target_value: targetValue,
      p_country: country && country !== 'All' ? country : null,
      p_source: source,
      p_dry_run: dryRun,
    }),
  )
}

/** Undo a confirm batch (deactivates the rule + restores the filled rows). */
export async function undoTyreBatch(batchId) {
  return unwrap(await supabase.rpc('tyre_learn_undo', { p_batch_id: batchId }))
}

/** Turn a learned rule off (stops future auto-apply; does not revert past fills). */
export async function deactivateLearnedFact(id) {
  return unwrap(
    await supabase.from('tyre_learned_facts').update({ active: false }).eq('id', id).select('id').single(),
  )
}

/** Turn a learned rule back on. */
export async function reactivateLearnedFact(id) {
  return unwrap(
    await supabase.from('tyre_learned_facts').update({ active: true }).eq('id', id).select('id').single(),
  )
}
