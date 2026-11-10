/** Approval configuration API. Failures remain errors; empty means a successful read with no rows. */
import { supabase, unwrap, fetchAllPages, ServiceError } from './_client'
import { ASSIGNABLE_BUILTIN_ROLES } from './customRoles'

// The flat approval_matrix rules engine (V477) was retired on 2026-11-11 in favour of the
// governed, versioned approval_policies engine below (owner: keep the enterprise one).
// Its CRUD helpers and resolve_approvers preview were unused and are removed.

// Governed policy contract. Missing migrations are errors, never empty policies.
const POLICY_COLS = 'id,organisation_id,name,entity_type,version,state,priority,match_country,match_region,match_site,match_role,match_user_id,stages,created_by,created_at,updated_at,published_by,published_at,effective_at,change_reason'
export async function listApprovalPolicies() {
  return unwrap(await fetchAllPages((from, to) => supabase.from('approval_policies')
    .select(POLICY_COLS).order('updated_at', { ascending: false }).order('id').range(from, to)))
}

async function policyRpc(name, args) {
  const data = unwrap(await supabase.rpc(name, args))
  const routePolicy = policy => policy && typeof policy.id === 'string' && typeof policy.name === 'string'
    && Array.isArray(policy.stages) && policy.stages.every(stage => stage && typeof stage.name === 'string')
  const valid = name === 'approval_policy_people'
    ? Array.isArray(data)
    : name === 'approval_policy_simulate'
      ? data && ['legacy', 'enforced'].includes(data.mode) && ['matched', 'no_route', 'ambiguous'].includes(data.status) && Array.isArray(data.candidates)
        && (data.status === 'matched' ? routePolicy(data.policy) : data.policy == null)
        && data.candidates.every(candidate => routePolicy(candidate) && Number.isInteger(candidate.rank) && candidate.rank >= 1
          && Number.isInteger(candidate.specificity) && candidate.specificity >= 0 && candidate.specificity <= 5 && Number.isInteger(candidate.priority))
      : data && !Array.isArray(data) && typeof data.id === 'string' && typeof data.updated_at === 'string'
  if (!valid) throw new ServiceError('The server did not confirm the operation.', 'invalid_response')
  return data
}

export const listApprovalPeople = () => policyRpc('approval_policy_people', {})
export async function listApprovalRoles() {
  const custom = unwrap(await fetchAllPages((from, to) => supabase.from('custom_roles')
    .select('id,name,active').eq('active', true).order('id').range(from, to)))
  return [...new Set([...ASSIGNABLE_BUILTIN_ROLES, ...custom.map(role => role.name)].filter(Boolean))]
}
export const saveApprovalPolicy = (policy, expectedUpdatedAt = null) => {
  const fields = ['id', 'name', 'entity_type', 'priority', 'match_country', 'match_region', 'match_site', 'match_role', 'match_user_id', 'stages', 'change_reason']
  return policyRpc('approval_policy_save', {
    p_policy: Object.fromEntries(fields.filter(key => policy[key] !== undefined).map(key => [key, policy[key]])),
    p_expected_updated_at: expectedUpdatedAt,
  })
}
export const publishApprovalPolicy = (policy, reason, effectiveAt = null) => policyRpc('approval_policy_publish', {
  p_policy_id: policy.id, p_expected_updated_at: policy.updated_at, p_reason: reason,
  ...(effectiveAt ? { p_effective_at: effectiveAt } : {}),
})
export const retireApprovalPolicy = (policy, reason) => policyRpc('approval_policy_retire', {
  p_policy_id: policy.id, p_expected_updated_at: policy.updated_at, p_reason: reason,
})
export const simulateApprovalPolicy = (context, draftId = null) => policyRpc('approval_policy_simulate', {
  p_entity_type: context.entity_type, p_country: context.country || null,
  p_site: context.site || null, p_role: context.role || null,
  p_user_id: context.user_id || null, p_draft_id: draftId,
  // Sent only when chosen, so a server without regional routing still answers.
  ...(context.region ? { p_region: context.region } : {}),
  // A vehicle's base site decides its region, exactly as a real submission would.
  ...(context.asset_no ? { p_asset_no: String(context.asset_no).trim() } : {}),
})
/** Vehicles per region and the published route each region currently gets. */
export async function getApprovalRegionCoverage(entityType = 'inspection') {
  const data = unwrap(await supabase.rpc('approval_region_coverage', { p_entity_type: entityType }))
  if (!data || !Array.isArray(data.regions)) throw new ServiceError('The server did not confirm the operation.', 'invalid_response')
  return data
}
export async function listApprovalPolicyEvents(policyId) {
  return unwrap(await fetchAllPages((from, to) => supabase.from('approval_policy_events')
    .select('id,policy_id,action,actor_id,reason,created_at,snapshot')
    .eq('policy_id', policyId).order('created_at', { ascending: false }).order('id').range(from, to)))
}
