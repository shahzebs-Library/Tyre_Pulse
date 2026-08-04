/**
 * Approval matrix service (V477).
 *
 * Reads/writes the rules that decide who signs a submission. Degrades to an
 * empty list when the table is absent (pre-migration) so the page renders an
 * honest empty state instead of an error.
 */
import { supabase, unwrap, isMissingRelation } from './_client'

const COLS = `id,entity_type,match_country,match_site,match_role,match_user_id,
  approver_user_id,approver_role,level,escalate_after_days,active,note,created_at,updated_at`
  .replace(/\s+/g, '')

/** Every rule for the org, most specific first is applied by the engine, not here. */
export async function listApprovalRules() {
  try {
    const { data, error } = await supabase
      .from('approval_matrix')
      .select(COLS)
      .order('entity_type')
      .order('level')
      .order('created_at')
    if (error) throw error
    return data || []
  } catch (e) {
    if (isMissingRelation(e)) return []
    throw e
  }
}

/** Create a rule. Blank match fields are stored as NULL = "any". */
export async function createApprovalRule(values) {
  const blankToNull = (v) => (v == null || String(v).trim() === '' ? null : v)
  return unwrap(
    supabase.from('approval_matrix').insert({
      entity_type: values.entity_type,
      match_country: blankToNull(values.match_country),
      match_site: blankToNull(values.match_site),
      match_role: blankToNull(values.match_role),
      match_user_id: blankToNull(values.match_user_id),
      approver_user_id: blankToNull(values.approver_user_id),
      approver_role: blankToNull(values.approver_role),
      level: Number(values.level) || 1,
      escalate_after_days: blankToNull(values.escalate_after_days) == null
        ? null : Number(values.escalate_after_days),
      note: blankToNull(values.note),
      active: values.active !== false,
    }).select(COLS).single(),
  )
}

export async function updateApprovalRule(id, patch) {
  return unwrap(supabase.from('approval_matrix').update(patch).eq('id', id).select(COLS).single())
}

export async function deleteApprovalRule(id) {
  return unwrap(supabase.from('approval_matrix').delete().eq('id', id))
}

/**
 * Ask the SERVER who would approve a given submission. Used by the page's
 * preview so what an admin sees is what the database will actually do, rather
 * than a second opinion computed in the browser.
 */
export async function previewApprovers({ entityType, country, site, role, userId } = {}) {
  try {
    const { data, error } = await supabase.rpc('resolve_approvers', {
      p_entity_type: entityType,
      p_country: country || null,
      p_site: site || null,
      p_role: role || null,
      p_user_id: userId || null,
    })
    if (error) throw error
    return data || []
  } catch (e) {
    if (isMissingRelation(e)) return []
    throw e
  }
}
