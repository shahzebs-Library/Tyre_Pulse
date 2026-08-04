/**
 * Approval matrix - who approves what.
 *
 * Pure: no I/O. The SQL function `resolve_approvers` (V477) mirrors the
 * precedence rule below; change BOTH together.
 *
 * THE RULE: three routing styles coexist and the NARROWEST matching rule wins.
 *   named person  (match_user_id) - "Ahmed's inspections go to Saleh"
 *   site          (match_site)    - "everything at NHC goes to NHC's supervisor"
 *   role          (match_role)    - "any Manager in KSA may sign"
 * A blank match field means "any", so one broad fallback plus a few narrow
 * exceptions covers a whole fleet without needing a row per person.
 *
 * Specificity is simply how many match fields a rule pins down, so a named
 * person (up to 4) always beats a site rule, which beats a bare role rule. This
 * is deliberately a count and not a hand-ranked list: a hand-ranked list has to
 * be re-argued every time a field is added, and quietly disagrees with the SQL.
 */

/** Things that can require approval. Extend here AND in the V477 CHECK. */
export const ENTITY_TYPES = Object.freeze([
  { key: 'inspection', label: 'Tyre inspection' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'accident', label: 'Accident report' },
  { key: 'work_order', label: 'Work order' },
  { key: 'tyre_change', label: 'Tyre change' },
])

export const entityLabel = (key) =>
  ENTITY_TYPES.find((e) => e.key === key)?.label || key || 'N/A'

/** How many match columns a rule pins down. Blank/null counts as "any". */
export function specificity(rule) {
  if (!rule) return 0
  const set = (v) => v != null && String(v).trim() !== ''
  return [rule.match_country, rule.match_site, rule.match_role, rule.match_user_id]
    .filter(set).length
}

/** Does this rule apply to the given submission? A blank field matches anything. */
export function ruleMatches(rule, ctx = {}) {
  if (!rule || rule.active === false) return false
  if (rule.entity_type !== ctx.entity_type) return false
  const ok = (ruleVal, ctxVal) => {
    const r = ruleVal == null ? '' : String(ruleVal).trim()
    if (!r) return true                        // wildcard
    return r === String(ctxVal ?? '').trim()
  }
  return ok(rule.match_country, ctx.country)
    && ok(rule.match_site, ctx.site)
    && ok(rule.match_role, ctx.role)
    && ok(rule.match_user_id, ctx.user_id)
}

/**
 * Every matching rule, most specific first, then by level. Mirrors the SQL
 * ORDER BY (level, specificity desc, created_at) so the page preview and the
 * server agree on who would actually be asked to sign.
 */
export function resolveApprovers(rules = [], ctx = {}) {
  return (Array.isArray(rules) ? rules : [])
    .filter((r) => ruleMatches(r, ctx))
    .map((r) => ({ ...r, _spec: specificity(r) }))
    .sort((a, b) =>
      (a.level || 1) - (b.level || 1)
      || b._spec - a._spec
      || String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

/** The single rule that decides the first signature, or null when none matches. */
export function primaryApprover(rules = [], ctx = {}) {
  return resolveApprovers(rules, ctx).find((r) => (r.level || 1) === 1) || null
}

/** Plain-English description of who a rule routes to. */
export function approverLabel(rule, usersById = {}) {
  if (!rule) return 'N/A'
  if (rule.approver_user_id) {
    const u = usersById[rule.approver_user_id]
    return u ? (u.full_name || u.username || 'Named person') : 'Named person'
  }
  return rule.approver_role ? `Any ${rule.approver_role}` : 'N/A'
}

/** Plain-English description of what a rule matches. */
export function scopeLabel(rule, usersById = {}) {
  if (!rule) return 'N/A'
  const bits = []
  if (rule.match_user_id) {
    const u = usersById[rule.match_user_id]
    bits.push(`from ${u ? (u.full_name || u.username) : 'one person'}`)
  }
  if (rule.match_site) bits.push(`at ${rule.match_site}`)
  if (rule.match_role) bits.push(`by ${rule.match_role}`)
  if (rule.match_country) bits.push(`in ${rule.match_country}`)
  return bits.length ? bits.join(', ') : 'Everything (fallback)'
}

/**
 * Validate before saving. Returns [] when the rule is usable.
 * The one-approver rule is enforced by a CHECK too; this is so the user gets a
 * sentence instead of a constraint violation.
 */
export function validateRule(rule) {
  const errs = []
  if (!rule?.entity_type) errs.push('Choose what needs approving.')
  const named = !!rule?.approver_user_id
  const byRole = !!(rule?.approver_role && String(rule.approver_role).trim())
  if (named === byRole) errs.push('Choose exactly one approver: a named person or a role.')
  const days = rule?.escalate_after_days
  if (days != null && String(days) !== '' && !(Number(days) > 0)) {
    errs.push('Escalate after must be a number of days above zero.')
  }
  const lvl = Number(rule?.level ?? 1)
  if (!Number.isInteger(lvl) || lvl < 1 || lvl > 5) errs.push('Level must be between 1 and 5.')
  return errs
}

/**
 * Rules that can never fire because an earlier, broader rule already covers
 * everything they match at the same level. Surfacing these is the difference
 * between a matrix an admin trusts and one they quietly stop believing.
 */
export function shadowedRules(rules = []) {
  const out = []
  const list = Array.isArray(rules) ? rules.filter((r) => r.active !== false) : []
  for (const r of list) {
    const broader = list.find((o) =>
      o !== r
      && o.entity_type === r.entity_type
      && (o.level || 1) === (r.level || 1)
      && specificity(o) === specificity(r)
      && specificity(o) === 0)
    // Only a total wildcard at the same level can fully shadow another rule of
    // equal specificity; anything narrower still wins on its own terms.
    if (broader && specificity(r) === 0 && r !== broader) out.push(r)
  }
  return out
}
