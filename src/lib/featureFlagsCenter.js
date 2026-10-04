/**
 * featureFlagsCenter.js - pure helpers behind Feature Flags (/console/flags):
 * one registry over every web module (modules table), every org feature flag
 * (app_settings.feature_flags), every boolean platform switch (system_config)
 * and every phone screen (the mobile module list). No I/O.
 *
 * Kind and expected life (Unleash toggle types): a Release is temporary and is
 * reviewed 40 days after it appears; Permission (modules, org flags, phone
 * screens) and Kill switch (platform switches) are permanent and are never
 * flagged stale by age. Stale is measured from usage (on but unused, or a
 * duplicate of another switch), never guessed.
 */
import { webCell, phoneCell, mobileKeyFor } from './accessOverview'
import { MOBILE_MODULES } from './mobileModules'
import { FLAG_DEFS, isEnabled } from './featureFlags'

export const RELEASE_REVIEW_DAYS = 40
export const KIND_LABEL = Object.freeze({ release: 'Release', permission: 'Permanent', kill_switch: 'Kill switch' })
export const TYPE_LABEL = Object.freeze({ module: 'Module', org_flag: 'Org flag', switch: 'Platform switch', phone: 'Phone screen' })
export const STATE_LABEL = Object.freeze({ live: 'Live', maintenance: 'Maintenance', disabled: 'Off', beta: 'Beta', on: 'On', off: 'Off' })

/** Plain names for the boolean platform switches this database stores. */
export const SWITCH_LABELS = Object.freeze({
  ai_enabled: 'AI assistant',
  allow_signups: 'Allow sign-ups (old key)',
  registration_open: 'Registration open',
  accident_emails_enabled: 'Accident emails',
  dual_control_enabled: 'Dual control',
  maintenance_mode: 'Maintenance mode',
  require_approval: 'Approve new users',
  export_enabled: 'Exports',
  backup_enabled: 'Nightly backup',
  two_factor_required: 'Two-factor for admins',
  email_notifications: 'Email notifications',
  push_notifications: 'Push notifications',
  new_features_admin_only: 'New areas admin only',
  console_ip_allowlist_enabled: 'Console IP allowlist',
  sentry_alerts_enabled: 'Sentry crash alerts',
  cron_alert_enabled: 'Scheduled job alerts',
  upload_gap_push: 'Upload gap push',
  sentry_auto_incidents: 'Sentry incidents',
  new_shell: 'New app shell',
})

/** Switches that cannot be flipped from this screen (they have their own guarded flow). */
export const GUARDED_SWITCHES = Object.freeze({
  dual_control_enabled: 'Changed only in Security (admin_set_dual_control, second approval).',
  console_ip_allowlist_enabled: 'Changed only in Access Policies (guarded so you cannot lock yourself out).',
  maintenance_mode: 'Changed from Quick actions (typed PRODUCTION confirm).',
})

const isBoolText = (v) => {
  const s = String(v ?? '').trim().replace(/^"|"$/g, '').toLowerCase()
  return s === 'true' || s === 'false'
}
const boolOf = (v) => String(v ?? '').trim().replace(/^"|"$/g, '').toLowerCase() === 'true'

export function kindOf(type, row = {}) {
  if (row.kind && KIND_LABEL[row.kind]) return row.kind
  if (type === 'switch') return 'kill_switch'
  return 'permission'
}

/** Review date for a Release (created + 40 days); null for permanent kinds. */
export function reviewDate(kind, createdAt, reviewAfter) {
  if (kind !== 'release') return null
  if (reviewAfter) return new Date(`${String(reviewAfter).slice(0, 10)}T00:00:00Z`)
  const t = createdAt ? Date.parse(createdAt) : NaN
  return Number.isFinite(t) ? new Date(t + RELEASE_REVIEW_DAYS * 86400000) : null
}

/** People per role map from the usage RPC. */
export function peopleByRoleMap(usage) {
  const out = {}
  for (const r of usage?.roles || []) out[r.role] = Number(r.people) || 0
  return out
}

/** Roles (other than Admin) that see a web area, with people counts. */
export function webAudience(permMap, key, roles = {}) {
  const list = []
  for (const role of Object.keys(roles)) {
    if (role === 'Admin') continue
    const c = webCell(permMap, role, key)
    if (c?.on) list.push({ role, people: roles[role] || 0 })
  }
  return list
}

export function phoneAudience(permMap, mobileKey, roles = {}) {
  if (!mobileKey) return []
  const list = []
  for (const role of Object.keys(roles)) {
    if (role === 'Admin') continue
    const c = phoneCell(permMap, role, mobileKey)
    if (c?.on) list.push({ role, people: roles[role] || 0 })
  }
  return list
}

const sumPeople = (list) => list.reduce((a, r) => a + r.people, 0)

/** Measured usage text for a web module, or null when not measured. */
export function moduleUsage(moduleId, usage) {
  if (!usage) return null
  const n = usage.new_24h || {}
  switch (moduleId) {
    case 'vehicle_washing': return usage.wash_30d === undefined ? null : `${usage.wash_30d} washes 30d`
    case 'tyre_records': return n.tyre_records === undefined ? null : `${n.tyre_records} new/24h`
    case 'inspections': return n.inspections === undefined ? null : `${n.inspections} new/24h`
    case 'work_orders': return n.work_orders === undefined ? null : `${n.work_orders} new/24h`
    case 'accidents': return n.accidents === undefined ? null : `${n.accidents} new/24h`
    default: return null
  }
}

/**
 * Build every row of the unified flag list.
 * @param {object} p
 * @param {Array} p.modules    modules rows (module_id, name, category, status, visible_to, depends_on, last_updated, kind, created_at, review_after)
 * @param {object} p.permMap   role -> key -> enabled (module_permissions)
 * @param {object} p.orgFlags  merged feature flag map (key -> boolean)
 * @param {Array} p.config     system_config rows (key, value, updated_at)
 * @param {object} p.usage     admin_flag_usage payload
 * @param {number} [p.now]
 */
export function buildFlagRows({ modules = [], permMap = {}, orgFlags = null, config = [], usage = null, now = Date.now() } = {}) {
  const roles = peopleByRoleMap(usage)
  const rows = []

  for (const m of modules || []) {
    const kind = kindOf('module', m)
    const review = reviewDate(kind, m.created_at, m.review_after)
    const audience = webAudience(permMap, m.module_id, roles)
    const mk = mobileKeyFor(m.module_id)
    const adminOnly = m.visible_to === 'admin_only' || audience.length === 0
    const created = m.created_at ? Date.parse(m.created_at) : NaN
    const isNew = Number.isFinite(created) && now - created < RELEASE_REVIEW_DAYS * 86400000
    rows.push({
      id: `module:${m.module_id}`,
      type: 'module',
      key: m.module_id,
      name: m.name || m.module_id,
      category: m.category || 'Other',
      state: m.status || 'live',
      kind,
      review,
      adminOnly,
      audienceWeb: audience,
      audiencePhone: phoneAudience(permMap, mk, roles),
      mobileKey: mk,
      usage: moduleUsage(m.module_id, usage),
      changedAt: m.last_updated || null,
      dependsOn: Array.isArray(m.depends_on) ? m.depends_on : [],
      isNew,
      stale: review && review.getTime() < now ? { reason: `Past its ${RELEASE_REVIEW_DAYS}-day review date` } : null,
      raw: m,
    })
  }

  for (const def of FLAG_DEFS) {
    const on = orgFlags ? isEnabled(orgFlags, def.key) : null
    let stale = null
    if (on && def.key === 'billing' && usage && Number(usage.subscriptions) === 0) stale = { reason: '0 subscriptions' }
    if (on && def.key === 'ai_tools' && usage && Number(usage.ai_calls_35d) === 0) stale = { reason: '0 AI calls in 35 days' }
    rows.push({
      id: `org_flag:${def.key}`,
      type: 'org_flag',
      key: `feature_flags.${def.key}`,
      flagKey: def.key,
      name: def.label,
      category: def.category,
      state: on === null ? 'unknown' : on ? 'on' : 'off',
      kind: 'permission',
      review: null,
      adminOnly: false,
      audienceWeb: null,
      audiencePhone: null,
      usage: def.key === 'billing' && usage ? `${usage.subscriptions} subscriptions`
        : def.key === 'ai_tools' && usage ? `${usage.ai_calls_35d} calls in 35 days` : null,
      changedAt: null,
      dependsOn: [],
      isNew: false,
      stale,
      description: def.description,
    })
  }

  const cfgKeys = new Set((config || []).map((c) => c.key))
  for (const c of config || []) {
    if (!isBoolText(c.value)) continue
    const on = boolOf(c.value)
    let stale = null
    if (c.key === 'allow_signups' && cfgKeys.has('registration_open')) stale = { reason: 'Duplicate key: registration_open is the one the app reads' }
    if (on && c.key === 'ai_enabled' && usage && Number(usage.ai_calls_35d) === 0) stale = { reason: '0 AI calls in 35 days' }
    rows.push({
      id: `switch:${c.key}`,
      type: 'switch',
      key: c.key,
      name: SWITCH_LABELS[c.key] || c.key.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()),
      category: c.category || 'Platform',
      state: on ? 'on' : 'off',
      kind: 'kill_switch',
      review: null,
      adminOnly: false,
      audienceWeb: null,
      audiencePhone: null,
      usage: c.key === 'ai_enabled' && usage ? `${usage.ai_calls_35d} calls in 35 days` : null,
      changedAt: c.updated_at || null,
      dependsOn: [],
      isNew: false,
      stale,
      guarded: GUARDED_SWITCHES[c.key] || null,
      description: c.description || null,
    })
  }

  for (const pm of MOBILE_MODULES) {
    const audience = phoneAudience(permMap, pm.key, roles)
    rows.push({
      id: `phone:${pm.key}`,
      type: 'phone',
      key: `mobile:${pm.key}`,
      mobileKey: pm.key,
      name: `${pm.label} (phone)`,
      category: `Phone: ${pm.group}`,
      state: 'on',
      kind: 'permission',
      review: null,
      adminOnly: audience.length === 0,
      audienceWeb: null,
      audiencePhone: audience,
      usage: null,
      changedAt: null,
      dependsOn: [],
      isNew: false,
      stale: null,
    })
  }
  return rows.map((r) => ({ ...r, lifecycle: lifecycleOf(r) }))
}

export function lifecycleOf(r) {
  if (r.stale) return 'stale'
  if (r.isNew && r.adminOnly) return 'new_admin'
  if (r.isNew) return 'new_shared'
  return 'active'
}

export const LIFECYCLE_LABEL = Object.freeze({ new_admin: 'New, admin-only', new_shared: 'New, shared', active: 'Active', stale: 'Stale' })

/** Whether a row counts as "on" (live, beta, maintenance count as on for the headline). */
export function isOnState(state) { return state === 'live' || state === 'on' || state === 'beta' }

/** Counts behind the facet rail. */
export function facetCounts(rows = []) {
  const c = { type: {}, state: {}, kind: {}, lifecycle: {}, category: {} }
  for (const r of rows) {
    c.type[r.type] = (c.type[r.type] || 0) + 1
    const st = isOnState(r.state) ? 'on' : r.state === 'maintenance' ? 'maintenance' : r.state === 'unknown' ? 'unknown' : 'off'
    c.state[st] = (c.state[st] || 0) + 1
    if (r.adminOnly) c.state.admin_only = (c.state.admin_only || 0) + 1
    c.kind[r.kind] = (c.kind[r.kind] || 0) + 1
    c.lifecycle[r.lifecycle] = (c.lifecycle[r.lifecycle] || 0) + 1
    c.category[r.category] = (c.category[r.category] || 0) + 1
  }
  return c
}

/** Apply facet filters and a search term. */
export function filterFlagRows(rows = [], { types = [], states = [], kinds = [], lifecycles = [], categories = [], search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (types.length && !types.includes(r.type)) return false
    if (states.length) {
      const st = isOnState(r.state) ? 'on' : r.state === 'maintenance' ? 'maintenance' : 'off'
      if (!states.includes(st) && !(states.includes('admin_only') && r.adminOnly)) return false
    }
    if (kinds.length && !kinds.includes(r.kind)) return false
    if (lifecycles.length && !lifecycles.includes(r.lifecycle)) return false
    if (categories.length && !categories.includes(r.category)) return false
    if (q && ![r.name, r.key, r.category].some((v) => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
}

/** Who loses a web module when it is turned off, in plain numbers. */
export function turnOffImpact(row, navCount = 0) {
  if (!row || row.type !== 'module') return null
  const web = sumPeople(row.audienceWeb || [])
  return {
    webPeople: web,
    // Phones do not read module state (only the web app's route guard does),
    // so a module switched off keeps working on phones. Stated, not hidden.
    phonePeople: 0,
    phoneKeeps: sumPeople(row.audiencePhone || []),
    pagesHidden: navCount,
    total: web,
  }
}

/** "Web 4 roles, phone 4" style audience summary. */
export function audienceText(row) {
  if (row.type === 'switch' || row.type === 'org_flag') return row.key === 'dual_control_enabled' ? 'Super admins' : 'Everyone'
  const w = (row.audienceWeb || []).length
  const p = (row.audiencePhone || []).length
  if (row.adminOnly && !p) return 'Admin, Super Admin'
  if (row.type === 'phone') return p ? `Phone ${p} roles` : 'Admin, Super Admin'
  if (w && p) return `Web ${w} roles, phone ${p}`
  if (w) return `${w} roles`
  return p ? `Phone ${p} roles` : 'Admin, Super Admin'
}
