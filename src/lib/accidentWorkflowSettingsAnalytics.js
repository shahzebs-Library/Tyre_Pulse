/**
 * accidentWorkflowSettingsAnalytics - pure engine behind the Accident Workflow
 * settings page (/accident-workflow-settings).
 *
 * The page configures THREE things the accident notification engine reads
 * (departments, routing rules, approved email templates) plus a master email
 * switch. This module answers the questions an administrator actually has
 * before turning emails on:
 *
 *   - how many of each are live (KPI strip),
 *   - which rules would fire but reach nobody (no departments AND no to-roles),
 *   - which rules name a department that is inactive or no longer exists,
 *   - which templates cannot be used yet (inactive or not approved),
 *   - which {{tokens}} in a template body the engine does not know (typos).
 *
 * No I/O, no clock. Search/filter helpers are here so the page holds no
 * business logic. Routing evaluation itself stays in accidentWorkflow.js
 * (evaluateRouting) - this file never re-derives who an accident reaches.
 */
import { severityLabel } from './accidentWorkflow'

const arr = (v) => (Array.isArray(v) ? v : [])
const isActive = (row) => row?.active !== false
const norm = (v) => String(v ?? '').trim().toLowerCase()

/** The {{tokens}} an approved email body may use (legend + preview + typo check). */
export const TEMPLATE_TOKENS = [
  'reference_no', 'company', 'site', 'asset_no', 'plate_number', 'driver_name',
  'incident_date', 'location', 'severity', 'stage_label', 'vor_label',
  'estimated_cost', 'approved_cost', 'claim_status', 'department',
  'pending_action', 'due_date', 'link',
]

/** Sample values for the local preview. Illustrative only, never persisted. */
export const SAMPLE_TOKEN_VALUES = {
  reference_no: 'ACC-2026-0142',
  company: 'Company A',
  site: 'DHAHBAN',
  asset_no: 'TRK-1187',
  plate_number: '4821 ABC',
  driver_name: 'Ahmed Ali',
  incident_date: '2026-07-20',
  location: 'Gate 3, North Yard',
  severity: 'Major',
  stage_label: 'Insurance Claim',
  vor_label: 'Vehicle Off Road',
  estimated_cost: '12,500 SAR',
  approved_cost: '9,800 SAR',
  claim_status: 'Submitted',
  department: 'Insurance',
  pending_action: 'Submit insurer estimate',
  due_date: '2026-07-27',
  link: 'https://app.tyrepulse.app/accidents/ACC-2026-0142',
}

const TOKEN_RE = /{{\s*([a-zA-Z0-9_]+)\s*}}/g

/** Replace known {{token}}s with sample values; unknown tokens stay visible. */
export function renderTemplatePreview(html, samples = SAMPLE_TOKEN_VALUES) {
  return String(html || '').replace(TOKEN_RE, (whole, key) => (
    Object.prototype.hasOwnProperty.call(samples, key) ? samples[key] : whole
  ))
}

/** Distinct tokens used in a body, in first-seen order. */
export function tokensUsed(html) {
  const out = []
  const s = String(html || '')
  let m
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(s)) !== null) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** Tokens in a body that the notification engine will not substitute. */
export function unknownTokens(html, known = TEMPLATE_TOKENS) {
  const set = new Set(known)
  return tokensUsed(html).filter((t) => !set.has(t))
}

/** One-line human summary of a rule's match conditions. */
export function ruleMatchSummary(r) {
  if (!r) return 'Any accident'
  const parts = []
  if (arr(r.match_severities).length) parts.push(arr(r.match_severities).map(severityLabel).join('/'))
  if (arr(r.match_types).length) parts.push(`${arr(r.match_types).length} type(s)`)
  if (arr(r.match_sites).length) parts.push(`${arr(r.match_sites).length} site(s)`)
  if (arr(r.match_countries).length) parts.push(`${arr(r.match_countries).length} country`)
  if (r.min_cost != null && r.min_cost !== '') parts.push(`cost >= ${r.min_cost}`)
  if (r.require_injury) parts.push('injury')
  if (r.require_vor) parts.push('VOR')
  if (r.require_third_party) parts.push('3rd party')
  return parts.length ? parts.join(', ') : 'Any accident'
}

/** A rule that reaches nobody: no recipient departments and no to-roles. */
export function ruleHasNoRecipients(r) {
  return arr(r?.departments).length === 0 && arr(r?.to_roles).length === 0
}

/**
 * Departments a rule names that are not an ACTIVE department today. A rule
 * keeps the department name as text, so a renamed or deactivated department
 * leaves the rule pointing at nothing.
 */
export function ruleOrphanDepartments(r, departments) {
  const active = new Set(arr(departments).filter(isActive).map((d) => norm(d.name)))
  return arr(r?.departments).filter((name) => !active.has(norm(name)))
}

/** Count of ACTIVE rules that route to each department (by name). */
export function departmentUsage(departments, rules) {
  const counts = new Map()
  for (const r of arr(rules)) {
    if (!isActive(r)) continue
    for (const name of arr(r.departments)) counts.set(norm(name), (counts.get(norm(name)) || 0) + 1)
  }
  return arr(departments).map((d) => ({ ...d, rule_count: counts.get(norm(d.name)) || 0 }))
}

export function templateState(t) {
  const active = isActive(t)
  const approved = t?.approved === true
  if (active && approved) return 'usable'
  if (!approved) return 'unapproved'
  return 'inactive'
}

export const TEMPLATE_STATE_LABEL = {
  usable: 'Ready to send',
  unapproved: 'Needs approval',
  inactive: 'Inactive',
}

/**
 * The KPI strip + readiness checklist. `recipientsConfigured` is optional: it
 * is null when the fixed-mailbox config could not be read, and the issue list
 * then says so rather than claiming a clean bill of health.
 */
export function workflowOverview({ departments, rules, templates, emailsEnabled, recipientsConfigured = null } = {}) {
  const depts = arr(departments)
  const rs = arr(rules)
  const tpls = arr(templates)
  const activeRules = rs.filter(isActive)
  const silentRules = activeRules.filter(ruleHasNoRecipients)
  const orphanRules = activeRules.filter((r) => ruleOrphanDepartments(r, depts).length > 0)
  const usable = tpls.filter((t) => templateState(t) === 'usable')
  const unapproved = tpls.filter((t) => templateState(t) === 'unapproved')
  const typoTemplates = tpls.filter((t) => unknownTokens(t.body_html).length > 0 || unknownTokens(t.subject).length > 0)

  const issues = []
  if (activeRules.length === 0) issues.push({ level: 'crit', text: 'No active routing rule: no accident would notify anyone.' })
  if (silentRules.length) issues.push({ level: 'warn', text: `${silentRules.length} active rule(s) name no department and no to-role, so they reach nobody.` })
  if (orphanRules.length) issues.push({ level: 'warn', text: `${orphanRules.length} active rule(s) route to a department that is inactive or no longer exists.` })
  if (tpls.length && usable.length === 0) issues.push({ level: 'crit', text: 'No template is both active and approved, so no email can be rendered.' })
  else if (unapproved.length) issues.push({ level: 'info', text: `${unapproved.length} template(s) still need approval before they are used.` })
  if (typoTemplates.length) issues.push({ level: 'warn', text: `${typoTemplates.length} template(s) use a {{token}} the engine does not recognise.` })
  if (emailsEnabled && recipientsConfigured === false) issues.push({ level: 'crit', text: 'Delivery is ON but no recipient address is configured, so nothing is sent.' })

  return {
    departments: { total: depts.length, active: depts.filter(isActive).length },
    rules: { total: rs.length, active: activeRules.length, silent: silentRules.length, orphan: orphanRules.length },
    templates: { total: tpls.length, usable: usable.length, unapproved: unapproved.length, withUnknownTokens: typoTemplates.length },
    emailsEnabled: emailsEnabled === true,
    issues,
    ready: issues.every((i) => i.level === 'info'),
  }
}

// ── search / filter helpers (the page holds no filtering logic) ──────────────

function matchesQuery(fields, q) {
  const needle = norm(q)
  if (!needle) return true
  return fields.some((f) => norm(f).includes(needle))
}

function matchesStatus(row, status) {
  if (!status || status === 'all') return true
  return status === 'active' ? isActive(row) : !isActive(row)
}

export function filterDepartments(rows, { q = '', status = 'all' } = {}) {
  return arr(rows).filter((d) => matchesStatus(d, status) && matchesQuery([d.name, d.code, d.description], q))
}

export function filterRules(rows, { q = '', status = 'all', event = 'all' } = {}) {
  return arr(rows).filter((r) => {
    if (!matchesStatus(r, status)) return false
    if (event !== 'all' && (r.event_key || '') !== event) return false
    return matchesQuery([r.name, r.description, ...arr(r.departments), ...arr(r.to_roles), ...arr(r.cc_roles)], q)
  })
}

export function filterTemplates(rows, { q = '', state = 'all' } = {}) {
  return arr(rows).filter((t) => (state === 'all' || templateState(t) === state)
    && matchesQuery([t.name, t.key, t.subject], q))
}

export function sortDepartments(a, b) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || '').localeCompare(String(b.name || ''))
}

export function sortRules(a, b) {
  return (a.priority ?? 0) - (b.priority ?? 0) || String(a.name || '').localeCompare(String(b.name || ''))
}
