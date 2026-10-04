/**
 * Unused and risky access (pure, no I/O).
 *
 * Shapes access_unused_summary() for the console Access Control page, builds
 * the finding list, and suggests a review decision per person. Suggestions are
 * a hint for the reviewer, never an automatic change: nothing here writes.
 *
 * Rules that must hold (pinned by tests):
 *   - an admin or super admin is NEVER suggested for removal;
 *   - a person who signed in within the idle window is suggested Keep;
 *   - "never signed in" and "idle" are separate, because a provisioned-but-
 *     unused account and a stale one call for different decisions.
 */

export const DEFAULT_GRANT_DAYS = 90
export const IDLE_DAYS = 30
const DAY_MS = 86400000

/** YYYY-MM-DD for today + days (local date), the default end of a new rule. */
export function defaultGrantEndDate(days = DEFAULT_GRANT_DAYS, now = new Date()) {
  const d = new Date((now instanceof Date ? now : new Date(now)).getTime() + days * DAY_MS)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function shapeUnusedSummary(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    generatedAt: raw.generated_at || null,
    idleDays: num(raw.idle_days) ?? IDLE_DAYS,
    canSignIn: num(raw.can_sign_in),
    active30: num(raw.active_30d),
    never: num(raw.never_signed_in),
    neverByRole: raw.never_by_role || {},
    neverFirstCreated: raw.never_first_created || null,
    idle: num(raw.idle),
    idleByRole: raw.idle_by_role || {},
    roleTotals: raw.role_totals || {},
    admins: num(raw.admins),
    rulesTotal: num(raw.rules_total),
    rulesGrants: num(raw.rules_grants),
    rulesBlocks: num(raw.rules_blocks),
    rulesWithEnd: num(raw.rules_with_end),
    rulesPeople: num(raw.rules_people),
    emptyCustomRoles: Array.isArray(raw.empty_custom_roles) ? raw.empty_custom_roles : [],
    reviewsEver: num(raw.reviews_ever),
    reviewsClosed: num(raw.reviews_closed),
    pageViewsRecorded: raw.page_views_recorded === true,
    people: Array.isArray(raw.people) ? raw.people : [],
  }
}

/** "Tyre Man 12, Workshop Supervisor 4 and 6 more" from a {role: n} map. */
export function roleBreakdownText(byRole = {}, top = 4) {
  const entries = Object.entries(byRole || {}).filter(([, n]) => Number(n) > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (!entries.length) return ''
  const shown = entries.slice(0, top).map(([r, n]) => `${r} ${n}`)
  const rest = entries.slice(top).reduce((s, [, n]) => s + Number(n), 0)
  return rest ? `${shown.join(', ')} and ${rest} more` : shown.join(', ')
}

function pct(part, whole) {
  if (part === null || whole === null || !whole) return null
  return Math.round((part / whole) * 100)
}

function fmtDay(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Headline figures. Unknowns stay null (rendered N/A). */
export function unusedKpis(s) {
  if (!s) return null
  return [
    { key: 'can', label: 'Can sign in', value: s.canSignIn, sub: 'all approved' },
    { key: 'active', label: `Signed in, ${s.idleDays} days`, value: s.active30, sub: pct(s.active30, s.canSignIn) === null ? 'N/A' : `${pct(s.active30, s.canSignIn)}%` },
    { key: 'never', label: 'Never signed in', value: s.never, sub: roleBreakdownText(s.neverByRole, 2) || 'none' },
    {
      key: 'end', label: 'Rules with an end date',
      value: s.rulesTotal === null ? null : `${s.rulesWithEnd ?? 0} of ${s.rulesTotal}`,
      sub: s.rulesWithEnd ? `${s.rulesTotal - s.rulesWithEnd} never expire` : 'none expire',
    },
    { key: 'reviews', label: 'Reviews ever run', value: s.reviewsEver, sub: `${s.reviewsClosed ?? 0} completed` },
  ]
}

/**
 * The findings list. Each carries a suggested next step and an action key the
 * page maps to a real control. Page-view usage is always N/A (not recorded).
 */
export function unusedFindings(s) {
  if (!s) return []
  const out = []
  const neverDrivers = Number(s.neverByRole?.Driver || 0)
  const neverOthers = (s.never || 0) - neverDrivers
  if (neverDrivers > 0) {
    const since = fmtDay(s.neverFirstCreated)
    out.push({
      key: 'never_drivers', tone: 'danger',
      title: `${neverDrivers} Driver accounts have never signed in`,
      detail: `Approved and able to sign in${since ? ` since ${since}` : ''}. ${s.roleTotals?.Driver ?? 'N/A'} Drivers in total.`,
      suggestion: 'Keep, or lock until first use (owner decision)',
      action: 'review_never',
    })
  }
  if (neverOthers > 0) {
    out.push({
      key: 'never_other', tone: 'warning',
      title: `${neverOthers} other ${neverOthers === 1 ? 'person has' : 'people have'} never signed in`,
      detail: roleBreakdownText(Object.fromEntries(Object.entries(s.neverByRole || {}).filter(([r]) => r !== 'Driver'))),
      suggestion: 'Ask whether the account is still needed',
      action: 'review_never',
    })
  }
  if ((s.idle || 0) > 0) {
    out.push({
      key: 'idle', tone: 'warning',
      title: `${s.idle} ${s.idle === 1 ? 'person has' : 'people have'} not signed in for ${s.idleDays} days`,
      detail: roleBreakdownText(s.idleByRole, 5),
      suggestion: 'Ask their manager',
      action: 'review_idle',
    })
  }
  if (s.rulesTotal !== null && s.rulesTotal > 0 && (s.rulesWithEnd ?? 0) < s.rulesTotal) {
    out.push({
      key: 'no_end', tone: 'warning',
      title: `${s.rulesWithEnd ?? 0} of ${s.rulesTotal} personal rules have an end date`,
      detail: `${s.rulesGrants ?? 'N/A'} grants and ${s.rulesBlocks ?? 'N/A'} blocks across ${s.rulesPeople ?? 'N/A'} people. A rule with no end date stays until someone removes it.`,
      suggestion: `${DEFAULT_GRANT_DAYS} days for grants`,
      action: 'end_dates',
    })
  }
  if (s.emptyCustomRoles.length) {
    out.push({
      key: 'empty_roles', tone: 'info',
      title: `${s.emptyCustomRoles.length} custom ${s.emptyCustomRoles.length === 1 ? 'role has' : 'roles have'} nobody in them`,
      detail: s.emptyCustomRoles.join(', '),
      suggestion: 'Keep if they are new',
      action: 'roles',
    })
  }
  out.push({
    key: 'page_views', tone: 'quiet',
    title: 'Which areas a person actually opens',
    detail: 'Not recorded. Page views per person are not stored, so unused areas inside a role cannot be found yet.',
    suggestion: 'Needs page-view logging',
    action: null,
    na: true,
  })
  return out
}

export const SUGGESTION_META = {
  keep: { label: 'Keep', tone: 'good' },
  ask: { label: 'Ask manager', tone: 'warning' },
  lock_until_used: { label: 'Lock until used', tone: 'info' },
  remove: { label: 'Remove?', tone: 'danger' },
}

/**
 * Suggested review decision for one person. Admins are never Remove.
 * @returns {'keep'|'ask'|'lock_until_used'|'remove'}
 */
export function suggestDecision(person, now = new Date(), idleDays = IDLE_DAYS) {
  if (!person) return 'keep'
  const admin = person.is_super_admin === true || person.role === 'Admin'
  const last = person.last_sign_in_at ? new Date(person.last_sign_in_at).getTime() : null
  const n = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (last !== null && Number.isFinite(last) && n - last < idleDays * DAY_MS) return 'keep'
  if (admin) return last === null ? 'ask' : 'keep'
  if (last === null) return person.role === 'Driver' ? 'lock_until_used' : 'remove'
  return 'ask'
}

export const REVIEW_SCOPES = [
  { key: 'all', label: 'Everyone' },
  { key: 'never', label: 'Never signed in' },
  { key: 'idle', label: 'Idle' },
  { key: 'rules', label: 'Has personal rules' },
  { key: 'admins', label: 'Admins' },
]

export function inScope(person, scope, now = new Date(), idleDays = IDLE_DAYS) {
  const n = now instanceof Date ? now.getTime() : new Date(now).getTime()
  const last = person?.last_sign_in_at ? new Date(person.last_sign_in_at).getTime() : null
  switch (scope) {
    case 'never': return last === null
    case 'idle': return last !== null && n - last >= idleDays * DAY_MS
    case 'rules': return Number(person?.rules) > 0
    case 'admins': return person?.is_super_admin === true || person?.role === 'Admin'
    default: return true
  }
}

/**
 * Map a drawer decision to the Access Review decision vocabulary
 * (keep | modify | revoke). Pending stays undecided.
 */
export function toReviewDecision(d) {
  if (d === 'keep') return 'keep'
  if (d === 'edit') return 'modify'
  if (d === 'remove') return 'revoke'
  return null
}

/** Decision counts for the drawer header. */
export function decisionCounts(decisions = {}) {
  const out = { keep: 0, edit: 0, remove: 0 }
  for (const v of Object.values(decisions || {})) if (out[v] !== undefined) out[v] += 1
  out.decided = out.keep + out.edit + out.remove
  return out
}
