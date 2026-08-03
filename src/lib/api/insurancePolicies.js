/**
 * Insurance Policies service - the insurance_policies + insurance_policy_conditions
 * tables (RLS restricts every row to Admin + super-admin). Explicit column lists
 * (no SELECT *); degrades to [] / null on error rather than throwing, so the
 * admin knowledge-base page never white-screens on an RLS denial or a table that
 * is not provisioned in some org.
 *
 * Additive only - mirrors accidents.js / assets.js conventions.
 */
import { supabase, applyCountry, isMissingRelation } from './_client'
import { toUserMessage } from '../safeError'

const POLICY_COLS =
  'id,country,policy_no,policy_type,insurer,insured_name,period_from,period_to,premium,sum_insured,limit_of_liability,currency,deductible_text,total_loss_threshold_pct,coverage_summary,covers_vehicle_types,source_file,notes,created_at,updated_at'

const CONDITION_COLS =
  'id,policy_id,seq,category,clause_text,causes_rejection,causes_delay,keywords,created_at'

/** {data, error} shape helper: never throws; error carries a user-safe message. */
function ok(data) { return { data, error: null } }
function fail(e, fallback) {
  if (isMissingRelation(e)) return { data: [], error: null }
  return { data: [], error: toUserMessage(e, fallback) }
}

/** List policies (newest period first), null-safe country scoped. */
export async function listPolicies({ country } = {}) {
  try {
    let q = supabase.from('insurance_policies').select(POLICY_COLS).order('period_from', { ascending: false })
    q = applyCountry(q, country)
    const { data, error } = await q
    if (error) throw error
    return ok(Array.isArray(data) ? data : [])
  } catch (e) { return fail(e, 'Could not load insurance policies.') }
}

/** Get one policy plus its conditions (ordered by seq). */
export async function getPolicy(id) {
  try {
    const { data: policy, error: pe } = await supabase
      .from('insurance_policies').select(POLICY_COLS).eq('id', id).maybeSingle()
    if (pe) throw pe
    if (!policy) return { data: null, error: null }
    const { data: conditions } = await listConditions(id)
    return ok({ ...policy, conditions: Array.isArray(conditions) ? conditions : [] })
  } catch (e) {
    if (isMissingRelation(e)) return { data: null, error: null }
    return { data: null, error: toUserMessage(e, 'Could not load the policy.') }
  }
}

/** List a policy's conditions, ordered by seq. */
export async function listConditions(policyId) {
  try {
    const { data, error } = await supabase
      .from('insurance_policy_conditions').select(CONDITION_COLS)
      .eq('policy_id', policyId).order('seq', { ascending: true })
    if (error) throw error
    return ok(Array.isArray(data) ? data : [])
  } catch (e) { return fail(e, 'Could not load policy conditions.') }
}

/** Create a policy; returns {data, error}. */
export async function createPolicy(row) {
  try {
    const { data, error } = await supabase
      .from('insurance_policies').insert(row).select(POLICY_COLS).single()
    if (error) throw error
    return { data, error: null }
  } catch (e) { return { data: null, error: toUserMessage(e, 'Could not create the policy.') } }
}

/** Patch a policy by id. */
export async function updatePolicy(id, patch) {
  try {
    const { data, error } = await supabase
      .from('insurance_policies').update(patch).eq('id', id).select(POLICY_COLS).single()
    if (error) throw error
    return { data, error: null }
  } catch (e) { return { data: null, error: toUserMessage(e, 'Could not update the policy.') } }
}

/** Delete a policy by id (conditions cascade in the DB). */
export async function deletePolicy(id) {
  try {
    const { error } = await supabase.from('insurance_policies').delete().eq('id', id)
    if (error) throw error
    return { data: true, error: null }
  } catch (e) { return { data: null, error: toUserMessage(e, 'Could not delete the policy.') } }
}

/** Add a condition; returns {data, error}. */
export async function addCondition(row) {
  try {
    const { data, error } = await supabase
      .from('insurance_policy_conditions').insert(row).select(CONDITION_COLS).single()
    if (error) throw error
    return { data, error: null }
  } catch (e) { return { data: null, error: toUserMessage(e, 'Could not add the condition.') } }
}

/** Patch a condition by id. */
export async function updateCondition(id, patch) {
  try {
    const { data, error } = await supabase
      .from('insurance_policy_conditions').update(patch).eq('id', id).select(CONDITION_COLS).single()
    if (error) throw error
    return { data, error: null }
  } catch (e) { return { data: null, error: toUserMessage(e, 'Could not update the condition.') } }
}

/** Delete a condition by id. */
export async function deleteCondition(id) {
  try {
    const { error } = await supabase.from('insurance_policy_conditions').delete().eq('id', id)
    if (error) throw error
    return { data: true, error: null }
  } catch (e) { return { data: null, error: toUserMessage(e, 'Could not delete the condition.') } }
}
