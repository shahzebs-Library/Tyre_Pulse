/**
 * Automation Rules analytics - pure helpers (no I/O, deterministic).
 *
 * Works over `business_rules` rows (src/lib/api/businessRules.js:
 * `id, name, description, trigger_type, event_types, conditions, actions,
 * active, cooldown_minutes, triggered_count, last_triggered_at, created_at,
 * updated_at`) and `rule_executions` rows (`id, rule_id, event_id, status,
 * detail, created_at`).
 *
 * Execution statuses: actioned | conditions_not_met | skipped_cooldown | error.
 *   - a SUCCESSFUL run is any run that did not error (the engine evaluated the
 *     rule cleanly, whether or not its conditions matched)
 *   - a FAILED run is status 'error'
 *
 * HONESTY: execution figures come from a recent SAMPLE of rule_executions (the
 * newest N). A rate whose denominator is zero is null, never 0. A rule with no
 * recorded trigger count and no last-triggered time has never fired.
 *
 * Every time-dependent function takes an injectable `now`.
 */

export const EXECUTION_STATUSES = ['actioned', 'conditions_not_met', 'skipped_cooldown', 'error']

export const EXECUTION_STATUS_LABEL = {
  actioned: 'Actioned',
  conditions_not_met: 'Conditions not met',
  skipped_cooldown: 'Cooldown',
  error: 'Error',
}

/** Size of the recent execution sample the page loads. */
export const EXECUTION_SAMPLE_LIMIT = 500

/** An active rule silent for longer than this is flagged as dormant. */
export const DORMANT_DAYS = 30

export const OPERATOR_SYMBOL = {
  lt: '<', lte: '<=', gt: '>', gte: '>=', eq: '=', neq: '!=', contains: 'contains',
}

export const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', director: 'Director' }

const MS_DAY = 86400000

function toMs(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

function nowMs(now) {
  const t = toMs(now == null ? new Date() : now)
  return t == null ? Date.now() : t
}

function list(v) {
  return Array.isArray(v) ? v : []
}

function count(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function normExecStatus(s) {
  return EXECUTION_STATUSES.includes(s) ? s : 'error'
}

/** "field < value AND ..." or "Always (no conditions)". ASCII only. */
export function conditionSummary(conditions) {
  const cs = list(conditions)
  if (!cs.length) return 'Always (no conditions)'
  return cs.map((c) => `${c?.field ?? '?'} ${OPERATOR_SYMBOL[c?.operator] || c?.operator || '?'} ${c?.value ?? ''}`.trim()).join(' AND ')
}

/** "Notify Manager | Emit rule.x" or 'N/A'. ASCII only. */
export function actionSummary(actions) {
  const as = list(actions)
  if (!as.length) return 'N/A'
  return as.map((a) => (a?.type === 'notify_role'
    ? `Notify ${ROLE_LABEL[a.role] || a.role || 'role'}`
    : `Emit rule.${a?.event_type || 'event'}`)).join(' | ')
}

/** True when the rule has never fired (no count and no last-triggered time). */
export function hasNeverFired(rule) {
  const n = count(rule?.triggered_count)
  return (n == null || n === 0) && toMs(rule?.last_triggered_at) == null
}

/** Per-rule execution stats from the sample: { [rule_id]: {...} }. */
export function executionsByRule(executions) {
  const out = {}
  for (const ex of list(executions)) {
    const id = ex?.rule_id
    if (id == null) continue
    const row = out[id] || { total: 0, actioned: 0, conditions_not_met: 0, skipped_cooldown: 0, error: 0, lastMs: null }
    row.total += 1
    row[normExecStatus(ex?.status)] += 1
    const t = toMs(ex?.created_at)
    if (t != null && (row.lastMs == null || t > row.lastMs)) row.lastMs = t
    out[id] = row
  }
  for (const r of Object.values(out)) {
    r.successRate = r.total > 0 ? (r.total - r.error) / r.total : null
    r.failureRate = r.total > 0 ? r.error / r.total : null
  }
  return out
}

/** Execution status breakdown for the sample. */
export function executionStatusBreakdown(executions) {
  const out = { actioned: 0, conditions_not_met: 0, skipped_cooldown: 0, error: 0 }
  for (const ex of list(executions)) out[normExecStatus(ex?.status)] += 1
  const total = list(executions).length
  return EXECUTION_STATUSES.map((s) => ({
    status: s, label: EXECUTION_STATUS_LABEL[s], count: out[s], share: total > 0 ? out[s] / total : null,
  }))
}

/**
 * Activity bucket for a rule relative to `now`:
 *   never   - never fired
 *   dormant - active but last fired more than DORMANT_DAYS ago
 *   recent  - fired within DORMANT_DAYS
 *   fired   - fired, but paused, or the last-fired time was not recorded
 */
export function ruleActivity(rule, { now, dormantDays = DORMANT_DAYS } = {}) {
  if (hasNeverFired(rule)) return 'never'
  const last = toMs(rule?.last_triggered_at)
  if (last == null) return 'fired'
  const age = nowMs(now) - last
  if (age <= dormantDays * MS_DAY) return 'recent'
  return rule?.active ? 'dormant' : 'fired'
}

/**
 * Filter rules.
 * @param {object} f  { search, status: 'all'|'active'|'paused', activity: 'all'|'never'|'dormant'|'recent', eventType }
 */
export function filterRules(rules, { search = '', status = 'all', activity = 'all', eventType = 'all', now } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return list(rules).filter((r) => {
    if (status === 'active' && !r?.active) return false
    if (status === 'paused' && r?.active) return false
    if (eventType !== 'all' && !list(r?.event_types).includes(eventType)) return false
    if (activity !== 'all' && ruleActivity(r, { now }) !== activity) return false
    if (!q) return true
    return (r?.name || '').toLowerCase().includes(q)
      || (r?.description || '').toLowerCase().includes(q)
      || list(r?.event_types).some((ev) => String(ev).toLowerCase().includes(q))
  })
}

/** Distinct event types referenced by any rule, sorted. */
export function ruleEventTypes(rules) {
  return [...new Set(list(rules).flatMap((r) => list(r?.event_types)).filter(Boolean))].sort()
}

/** Headline KPIs across all rules plus the execution sample. */
export function automationKpis({ rules, executions = null, now, limit = EXECUTION_SAMPLE_LIMIT } = {}) {
  const rs = list(rules)
  const active = rs.filter((r) => r?.active).length
  let triggered = 0
  let triggeredKnown = false
  for (const r of rs) {
    const n = count(r?.triggered_count)
    if (n != null) { triggered += n; triggeredKnown = true }
  }
  const neverFired = rs.filter(hasNeverFired).length
  const dormant = rs.filter((r) => ruleActivity(r, { now }) === 'dormant').length

  const ex = executions == null ? null : list(executions)
  const runs = ex == null ? null : ex.length
  const errors = ex == null ? null : ex.filter((e) => normExecStatus(e?.status) === 'error').length
  const actioned = ex == null ? null : ex.filter((e) => e?.status === 'actioned').length
  return {
    total: rs.length,
    active,
    paused: rs.length - active,
    triggeredTotal: rs.length ? (triggeredKnown ? triggered : null) : null,
    neverFired,
    dormant,
    runs,
    errors,
    actioned,
    successRate: runs ? (runs - errors) / runs : null,
    failureRate: runs ? errors / runs : null,
    actionRate: runs ? actioned / runs : null,
    sampleTruncated: ex != null && limit > 0 && ex.length >= limit,
  }
}

/** Table rows: one per rule, joined with its sample execution stats. */
export function ruleTableRows(rules, executions, { now } = {}) {
  const stats = executionsByRule(executions)
  return list(rules).map((r) => {
    const s = stats[r?.id] || null
    return {
      ...r,
      activity: ruleActivity(r, { now }),
      conditionText: conditionSummary(r?.conditions),
      actionText: actionSummary(r?.actions),
      triggered: count(r?.triggered_count),
      lastTriggeredMs: toMs(r?.last_triggered_at),
      sampleRuns: s ? s.total : 0,
      sampleErrors: s ? s.error : 0,
      sampleFailureRate: s ? s.failureRate : null,
    }
  })
}

export const RULE_EXPORT_COLS = ['name', 'status', 'event_types', 'conditions', 'actions', 'cooldown', 'triggered', 'last_triggered', 'activity', 'sample_runs', 'sample_errors']
export const RULE_EXPORT_HEADERS = ['Rule', 'Status', 'Event Types', 'Conditions', 'Actions', 'Cooldown (min)', 'Times Triggered', 'Last Triggered', 'Activity', 'Recent Runs', 'Recent Errors']

const ACTIVITY_LABEL = { never: 'Never fired', dormant: 'Dormant', recent: 'Recently fired', fired: 'Fired' }

export function activityLabel(a) {
  return ACTIVITY_LABEL[a] || 'Unknown'
}

export function ruleExportRows(rows) {
  return list(rows).map((r) => ({
    name: r?.name || 'N/A',
    status: r?.active ? 'Active' : 'Paused',
    event_types: list(r?.event_types).join(', ') || 'N/A',
    conditions: r?.conditionText ?? conditionSummary(r?.conditions),
    actions: r?.actionText ?? actionSummary(r?.actions),
    cooldown: count(r?.cooldown_minutes) ?? 'N/A',
    triggered: r?.triggered ?? count(r?.triggered_count) ?? 'N/A',
    last_triggered: r?.last_triggered_at || 'Never',
    activity: activityLabel(r?.activity),
    sample_runs: r?.sampleRuns ?? 'N/A',
    sample_errors: r?.sampleErrors ?? 'N/A',
  }))
}
