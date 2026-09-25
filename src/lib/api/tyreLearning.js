/**
 * Tyre Learning service (V471) - the Supabase boundary for the confirm-once,
 * auto-fix-now-and-future learning layer. Faithful pass-throughs over the
 * security-definer RPCs (tyre_learn_suggestions / tyre_learn_confirm /
 * tyre_learn_undo) and the tyre_learned_facts table (RLS-scoped).
 *
 * AUTH-SENSITIVE: every RPC self-gates server-side on app_is_elevated() and is
 * org-scoped. This layer never re-implements the gate. Read paths are HONEST:
 * they degrade only for a not-deployed RPC/table (by error code) and THROW on a
 * permission or network failure. Write paths surface the error too.
 */
import { supabase, unwrap, isNotProvisioned, ServiceError } from './_client'

const scope = (country) => (country && country !== 'All' ? country : null)

/**
 * A json RPC read. A not-deployed RPC returns `fallback`; any other failure
 * THROWS, and so does a payload the server itself marks `ok:false` (e.g. the
 * caller is not permitted) - shaping that would render "no gaps".
 */
function readJson(res, what, fallback) {
  if (res?.error && isNotProvisioned(res.error)) return fallback
  const data = unwrap(res)
  if (!data) throw new ServiceError(`${what} returned nothing.`, 'EMPTY', null)
  if (data.ok === false) {
    throw new ServiceError(`${what} could not be produced${data.reason ? ` (${data.reason})` : ''}.`, data.reason || 'NOT_OK', data)
  }
  return data
}

/**
 * Blank serials with a recoverable value (self/master) for a field. Only 'brand'
 * and 'size' are serial-recoverable. [] only for a not-deployed RPC or genuinely
 * no suggestions; a failed read THROWS (an empty list would read "nothing to
 * confirm"). `limit` is clamped to the 1,000-row response cap.
 */
export async function listTyreSuggestions({ country = null, field = 'brand', limit = 200 } = {}) {
  const res = await supabase.rpc('tyre_learn_suggestions', {
    p_country: scope(country),
    p_limit: Math.min(Math.max(1, Number(limit) || 200), 1000),
    p_field: field,
  })
  const data = readJson(res, 'Tyre suggestions', { suggestions: [] })
  return Array.isArray(data?.suggestions) ? data.suggestions : []
}

/**
 * Field-level gap overview (blank + recoverable counts per target field).
 * Returns the json object; `{ ok:false, reason:'not_provisioned' }` only when
 * the RPC is not deployed. A real failure THROWS.
 */
export async function getTyreGapOverview({ country = null } = {}) {
  return readJson(
    await supabase.rpc('get_tyre_gap_overview', { p_country: scope(country) }),
    'The gap overview',
    { ok: false, reason: 'not_provisioned' },
  )
}

/**
 * Per-column completeness of the KSA master upload staging table. Same
 * contract as getTyreGapOverview.
 */
export async function getMasterCompleteness() {
  return readJson(
    await supabase.rpc('get_master_file_completeness'),
    'The master-file completeness report',
    { ok: false, reason: 'not_provisioned' },
  )
}

/** Ceiling on learned facts read in one request (the response cap). */
export const LEARNED_FACTS_WINDOW = 1000

/**
 * The learned facts (confirmed rules) for this org, most recently updated
 * first. [] only when the table is not deployed; a failed read THROWS.
 * Read in one request up to the 1,000-row response cap (hundreds today).
 */
export async function listLearnedFacts({ country = null } = {}) {
  let q = supabase
    .from('tyre_learned_facts')
    .select('id,country,match_type,match_value,target_field,target_value,source,active,confirmed_by,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LEARNED_FACTS_WINDOW)
  if (scope(country)) q = q.or(`country.eq.${country},country.is.null`)
  const res = await q
  if (res?.error && isNotProvisioned(res.error)) return []
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
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
