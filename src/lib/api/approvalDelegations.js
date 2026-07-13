/**
 * Approval Delegations service — the single Supabase boundary for the Approval
 * Delegation / Acting Approver capability (enterprise plan §6: acting managers,
 * leave delegation, backup approvers, temporary delegation). Table
 * `approval_delegations` (V203). Explicit column list (least-privilege selects),
 * input validation, and a missing-relation guard so the page can render its
 * "apply the migration" empty state instead of erroring.
 *
 * Additive and non-breaking: this sits alongside the V95 workflow engine and
 * never mutates it. The delegate inbox reuses `isActiveDelegation` (pure lib) via
 * `workflows.myDelegatedApprovals()`.
 *
 * Mirrors odometerLogs.js conventions (COLS, isMissingRelation, [] on missing).
 */
import { supabase, unwrap } from './_client'
import { isActiveDelegation } from '../approvalDelegations'

export const COLS =
  'id,organisation_id,delegator_id,delegate_id,entity_type,reason,' +
  'starts_at,ends_at,active,created_by,created_at,updated_at'

// Fields the client may never set/change directly (ownership / audit / scope).
const IMMUTABLE = new Set([
  'id', 'organisation_id', 'delegator_id', 'created_by', 'created_at', 'updated_at',
])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('approval_delegations'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * List delegations for the current organisation (RLS-scoped), newest first.
 * Returns [] when the table has not been provisioned yet.
 * @param {{ limit?:number }} [opts]
 */
export async function listDelegations({ limit = 200 } = {}) {
  try {
    return unwrap(
      await supabase
        .from('approval_delegations')
        .select(COLS)
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Delegations the current user CREATED (delegator_id = auth user), newest first.
 * Returns [] when unauthenticated or the table is not provisioned.
 */
export async function myDelegations() {
  try {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData?.user?.id
    if (!uid) return []
    return unwrap(
      await supabase
        .from('approval_delegations')
        .select(COLS)
        .eq('delegator_id', uid)
        .order('created_at', { ascending: false }),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getDelegation(id) {
  return unwrap(
    await supabase.from('approval_delegations').select(COLS).eq('id', id).maybeSingle(),
  )
}

/**
 * Create a delegation. Requires a delegate. The delegator defaults to the
 * authenticated caller (DB DEFAULT auth.uid()); when the caller passes an
 * explicit `delegator_id` (admin acting for another user) it is validated to
 * differ from the delegate. Dates are normalised and their order validated.
 */
export async function createDelegation(values = {}) {
  const delegate_id = asText(values.delegate_id, 64)
  if (!delegate_id) throw new Error('A delegate (who acts on your behalf) is required.')

  const delegator_id = asText(values.delegator_id, 64) // optional (DB default = auth.uid())
  if (delegator_id && delegator_id === delegate_id) {
    throw new Error('A delegation cannot name the same person as delegator and delegate.')
  }

  const starts_at = asTimestamp(values.starts_at)
  const ends_at = asTimestamp(values.ends_at)
  if (starts_at && ends_at && new Date(ends_at) < new Date(starts_at)) {
    throw new Error('The end date must be on or after the start date.')
  }

  const payload = {
    delegate_id,
    entity_type: asText(values.entity_type, 120),
    reason: values.reason ? String(values.reason).slice(0, 8000) : null,
    starts_at,
    ends_at,
    active: values.active === undefined ? true : Boolean(values.active),
  }
  if (delegator_id) payload.delegator_id = delegator_id

  return unwrap(
    await supabase.from('approval_delegations').insert(payload).select(COLS).single(),
  )
}

/**
 * Patch a delegation. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape. Validates
 * the window order using the effective (patched or existing) bounds is left to
 * the caller when only one bound changes; here we validate when both are present
 * in the patch.
 */
export async function updateDelegation(id, patch = {}) {
  const clean = {}
  for (const key of Object.keys(patch)) {
    if (IMMUTABLE.has(key)) continue
    switch (key) {
      case 'delegate_id': {
        const v = asText(patch.delegate_id, 64)
        if (!v) throw new Error('A delegate is required.')
        clean.delegate_id = v
        break
      }
      case 'entity_type':
        clean.entity_type = asText(patch.entity_type, 120)
        break
      case 'reason':
        clean.reason = patch.reason ? String(patch.reason).slice(0, 8000) : null
        break
      case 'starts_at':
        clean.starts_at = asTimestamp(patch.starts_at)
        break
      case 'ends_at':
        clean.ends_at = asTimestamp(patch.ends_at)
        break
      case 'active':
        clean.active = Boolean(patch.active)
        break
      default:
        break
    }
  }

  if (
    clean.starts_at && clean.ends_at &&
    new Date(clean.ends_at) < new Date(clean.starts_at)
  ) {
    throw new Error('The end date must be on or after the start date.')
  }

  return unwrap(
    await supabase.from('approval_delegations').update(clean).eq('id', id).select(COLS).single(),
  )
}

export async function deleteDelegation(id) {
  return unwrap(await supabase.from('approval_delegations').delete().eq('id', id))
}

/**
 * Convenience predicate re-exported for callers that already hold rows and want
 * the canonical "is this in effect now?" rule without importing the pure lib.
 * @param {object} d
 * @param {number} [nowMs=Date.now()]
 */
export function isDelegationActive(d, nowMs = Date.now()) {
  return isActiveDelegation(d, nowMs)
}
