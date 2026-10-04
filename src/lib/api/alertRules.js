/**
 * Alert Rules service (Console Module 5) - a thin, honest boundary over the
 * EXISTING `alert_thresholds` table. It does NOT create a new table: alert rules
 * ARE alert_thresholds rows (owner-scoped by RLS: auth.uid() = user_id), and the
 * rows are evaluated hourly by an existing cron job which fans notifications out
 * through the user's notification_preferences (channels + min_priority + digest).
 *
 * This module powers the no-code console rule builder (ConsoleAlertRules.jsx):
 * "if [metric] [operator] [value] then notify via [in-app / email]". It mirrors
 * the sibling service modules - explicit column list (least-privilege select),
 * `unwrap`/`ServiceError` error surfacing (no raw Supabase errors), and a
 * graceful [] when the relation is unavailable.
 *
 * Owner scoping: the DB RLS is the real boundary. We never send org_id (DB
 * default / RLS handles it) and only stamp user_id from the authenticated
 * session on INSERT because the column is NOT NULL and has no default.
 */
import { supabase, unwrap } from './_client'

/**
 * The honest set of metrics the hourly evaluator can plausibly compute from
 * existing operational tables. Kept deliberately small - only signals that map
 * to a real, countable condition. Extend ONLY when the evaluator can back it.
 */
export const ALERT_METRICS = [
  { key: 'high_risk_tyres', label: 'High-risk tyres' },
  { key: 'overdue_work_orders', label: 'Overdue work orders' },
  { key: 'open_accidents', label: 'Open accidents' },
  { key: 'pm_overdue', label: 'Overdue PM plans' },
  { key: 'open_breakdowns', label: 'Machines broken down' },
  { key: 'stock_below_min', label: 'Stock items at or below minimum' },
  { key: 'pending_approvals', label: 'Inspections waiting for approval' },
  { key: 'open_corrective_actions', label: 'Open corrective actions' },
]

/**
 * Metrics an older builder offered that the hourly check (evaluate_alert_thresholds)
 * never computes. A rule on one of these can never fire, so the page says so.
 */
export const LEGACY_METRICS = { low_pressure: 'Low pressure readings (not checked)' }

/** True when the hourly check really computes this metric. */
export function isEvaluatedMetric(key) {
  return ALERT_METRICS.some((m) => m.key === key)
}

/** Comparison operators offered by the rule builder (DB stores the key). */
export const ALERT_OPERATORS = [
  { key: 'gt', label: 'greater than' },
  { key: 'gte', label: 'at least' },
  { key: 'lt', label: 'less than' },
  { key: 'lte', label: 'at most' },
  { key: 'eq', label: 'equals' },
]

/** Human label for a metric key (falls back to the raw key). */
export function metricLabel(key) {
  return ALERT_METRICS.find((m) => m.key === key)?.label || LEGACY_METRICS[key] || key || ''
}

/** Human label for an operator key (falls back to the raw key). */
export function operatorLabel(key) {
  return ALERT_OPERATORS.find((o) => o.key === key)?.label || key || ''
}

// Least-privilege column set covering the console list cards + edit form + the
// evaluation stats (triggered_count / last_triggered_at). Omits user_id / org_id
// which are write-time scoping only, never surfaced back into the UI.
const COLS =
  'id,name,metric,operator,threshold,site_filter,brand_filter,' +
  'notify_email,notify_in_app,active,triggered_count,last_triggered_at,' +
  'created_at,updated_at,pending_checks,renotify_minutes,renotify_max,recover_after_hours'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('alert_thresholds'))
  )
}

/**
 * Map the builder's camelCase rule shape onto alert_thresholds columns. Only
 * defined fields are emitted so updates stay sparse (patch semantics).
 */
function mapRuleFields(rule = {}) {
  const out = {}
  if (rule.name !== undefined) out.name = rule.name
  if (rule.metric !== undefined) out.metric = rule.metric
  if (rule.operator !== undefined) out.operator = rule.operator
  if (rule.threshold !== undefined) {
    const n = Number(rule.threshold)
    out.threshold = Number.isFinite(n) ? n : null
  }
  if (rule.siteFilter !== undefined) out.site_filter = rule.siteFilter || null
  if (rule.brandFilter !== undefined) out.brand_filter = rule.brandFilter || null
  if (rule.notifyEmail !== undefined) out.notify_email = !!rule.notifyEmail
  if (rule.notifyInApp !== undefined) out.notify_in_app = !!rule.notifyInApp
  if (rule.active !== undefined) out.active = !!rule.active
  return out
}

/**
 * List the signed-in user's alert rules, newest first. RLS scopes the rows to
 * the owner, so no explicit user_id filter is required. Returns [] when the
 * relation has not been provisioned yet (honest empty state, not an error).
 *
 * @returns {Promise<Array<object>>}
 */
export async function listAlertRules() {
  try {
    return (
      unwrap(
        await supabase
          .from('alert_thresholds')
          .select(COLS)
          .order('created_at', { ascending: false }),
      ) || []
    )
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Create an alert rule (an alert_thresholds row). org_id is left to the DB
 * default / RLS; user_id is stamped from the authenticated session because the
 * column is NOT NULL with no default. Returns the inserted row.
 *
 * @param {object}  rule
 * @param {string}  rule.name
 * @param {string}  rule.metric        one of ALERT_METRICS keys
 * @param {string}  rule.operator      one of ALERT_OPERATORS keys
 * @param {number}  rule.threshold
 * @param {string?} [rule.siteFilter]
 * @param {string?} [rule.brandFilter]
 * @param {boolean} [rule.notifyEmail]
 * @param {boolean} [rule.notifyInApp]
 * @param {boolean} [rule.active=true]
 * @returns {Promise<object>} the inserted row
 */
export async function createAlertRule(rule = {}) {
  const row = mapRuleFields({ active: true, notifyInApp: true, ...rule })
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth?.user?.id
  if (uid) row.user_id = uid
  return unwrap(
    await supabase.from('alert_thresholds').insert(row).select(COLS).single(),
  )
}

/**
 * Update an alert rule by id with a mapped, sparse patch. Only fields present in
 * the patch are written (never clobbers untouched columns).
 *
 * @param {string} id
 * @param {object} patch  camelCase subset of the rule shape
 * @returns {Promise<object|null>}
 */
export async function updateAlertRule(id, patch = {}) {
  const mapped = mapRuleFields(patch)
  return unwrap(
    await supabase
      .from('alert_thresholds')
      .update(mapped)
      .eq('id', id)
      .select(COLS)
      .maybeSingle(),
  )
}

/**
 * Enable or disable an alert rule by id.
 *
 * @param {string}  id
 * @param {boolean} active
 * @returns {Promise<object|null>}
 */
export async function toggleAlertRule(id, active) {
  return unwrap(
    await supabase
      .from('alert_thresholds')
      .update({ active: !!active })
      .eq('id', id)
      .select(COLS)
      .maybeSingle(),
  )
}

/**
 * Pause or activate several rules at once. Returns how many rows changed.
 * @param {string[]} ids
 * @param {boolean} active
 */
export async function setAlertRulesActive(ids = [], active) {
  const list = [...new Set((ids || []).filter(Boolean))].slice(0, 500)
  if (!list.length) return 0
  const rows = unwrap(
    await supabase.from('alert_thresholds').update({ active: !!active }).in('id', list).select('id').limit(500),
  ) || []
  return rows.length
}

/**
 * Plain-English impact of saving a rule. Pure.
 * @returns {{change:string, who:string, undo:string}}
 */
export function ruleImpact(form = {}) {
  const scope = [form.siteFilter ? `site ${form.siteFilter}` : 'every site', form.brandFilter ? `brand ${form.brandFilter}` : 'every brand'].join(', ')
  return {
    change: form.active === false
      ? 'The rule is saved switched off. It is not evaluated until you activate it.'
      : `From the next hourly check, ${metricLabel(form.metric) || 'the metric'} is watched across ${scope}.`,
    who: form.notifyInApp
      ? `You, the rule owner, get an in-app notification when it fires (at most once a day per rule). Other admins are not notified by this rule.${form.notifyEmail ? ' Email is saved on the rule but the hourly check does not send email yet.' : ''}`
      : form.notifyEmail
        ? 'Nobody yet: only email is chosen, and the hourly check does not send email yet. Add in-app to be told.'
        : 'Nobody: no channel is chosen, so the rule can fire without telling anyone.',
    undo: 'Yes. Edit, pause or delete the rule at any time.',
  }
}

/**
 * Delete an alert rule by id.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteAlertRule(id) {
  return unwrap(await supabase.from('alert_thresholds').delete().eq('id', id))
}
