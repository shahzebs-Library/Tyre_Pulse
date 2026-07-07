/**
 * Business Rules service - the V98 rules-engine boundary: `business_rules`
 * (org-configurable "if condition then action" rules evaluated server-side
 * against domain events; direct RLS-guarded CRUD for elevated users) and the
 * append-only `rule_executions` evaluation audit (read-only). Explicit column
 * lists (no SELECT *), unwrap error surfacing, mirrors alertThresholds.js.
 */
import { supabase, unwrap } from './_client'

// Rule columns for the rules list + builder form. Omits organisation_id /
// created_by (write-time scoping / RLS-managed).
const RULE_COLS =
  'id,name,description,trigger_type,event_types,conditions,actions,active,cooldown_minutes,triggered_count,last_triggered_at,created_at,updated_at'

// Execution audit columns for the per-rule history drawer. Omits
// organisation_id (RLS-scoped).
const EXECUTION_COLS = 'id,rule_id,event_id,status,detail,created_at'

/**
 * List the organisation's business rules, newest first.
 * @returns {Promise<Array<object>>}
 */
export async function listBusinessRules() {
  return unwrap(
    await supabase
      .from('business_rules')
      .select(RULE_COLS)
      .order('created_at', { ascending: false })
  )
}

/**
 * Create a business rule; returns the inserted row. Server-side
 * validate_business_rule enforces: trigger_type 'event', >=1 event_types,
 * conditions [{field, operator: lt|lte|gt|gte|eq|neq|contains, value}] (<=10,
 * ANDed), actions [{type:'notify_role',role,title?,message?} |
 * {type:'emit_event',event_type}] (1-5), and the rule->rule emit-loop guard.
 * @param {{name:string, description?:string, trigger_type?:'event',
 *   event_types:string[], conditions?:Array<object>, actions:Array<object>,
 *   active?:boolean, cooldown_minutes?:number}} values
 */
export async function createBusinessRule(values) {
  return unwrap(await supabase.from('business_rules').insert(values).select(RULE_COLS).single())
}

/**
 * Update a business rule by id (same server-side validation as create).
 * @param {string} id
 * @param {object} patch
 */
export async function updateBusinessRule(id, patch) {
  return unwrap(await supabase.from('business_rules').update(patch).eq('id', id))
}

/**
 * Delete a business rule by id (its executions cascade).
 * @param {string} id
 */
export async function deleteBusinessRule(id) {
  return unwrap(await supabase.from('business_rules').delete().eq('id', id))
}

/**
 * Recent rule executions (actioned / conditions_not_met / skipped_cooldown /
 * error), newest first, optionally scoped to one rule.
 * @param {object} [opts]
 * @param {string|null} [opts.ruleId]
 * @param {number} [opts.limit=50]
 * @returns {Promise<Array<object>>}
 */
export async function listRuleExecutions({ ruleId = null, limit = 50 } = {}) {
  let q = supabase
    .from('rule_executions')
    .select(EXECUTION_COLS)
    .order('id', { ascending: false })
    .limit(limit)

  if (ruleId) q = q.eq('rule_id', ruleId)

  return unwrap(await q)
}
