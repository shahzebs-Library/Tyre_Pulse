/**
 * permissionMatrix.js — per-role, per-module capability matrix (Roadmap #17).
 *
 * Extends the EXISTING access-control mechanism rather than replacing it:
 *
 *   - The `view` capability IS enforced today. AuthContext.hasPermission()
 *     grants module access from the `module_permissions` table (via the
 *     `get_user_module_permissions` RPC) and, when no DB rows exist, from the
 *     hardcoded ROLE_DEFAULTS fallback. View changes made in the Permission
 *     Matrix page are persisted through the existing Admin-gated
 *     `set_module_permissions` RPC (see src/lib/api/modulePermissions.js), so
 *     they flow through the already-live enforcement path.
 *
 *   - The extended capabilities (`create`, `edit`, `delete`, `export`,
 *     `approve`) have no enforcement hooks in the app yet. They are STORED
 *     (not yet enforced) as a sparse diff-from-defaults in `app_settings`
 *     under the `permission_overrides` key — the exact persistence pattern of
 *     src/lib/api/erp.js (authenticated read, admin-only write via RLS).
 *
 * `resolvePermissions(role, overrides, viewMap)` is the single function
 * AuthContext (or any enforcement point) can later consume to answer
 * "can <role> <capability> in <module>?" without touching this page.
 *
 * Pure helpers are unit-tested in src/test/permissionMatrix.test.js, including
 * a defaults-mirror test asserting the default matrix reproduces AuthContext's
 * ROLE_DEFAULTS behaviour exactly — a regression there fails loudly.
 */

import { supabase } from './supabase'
import { MODULE_GROUPS, ACCESS_ROLES, ALL_MODULES, MODULE_LABEL } from './moduleCatalog'

// ── Vocabulary (single source of truth: moduleCatalog.js) ────────────────────

/** Flat [{key,label,group}] module registry — same keys as <ModuleRoute> / module_permissions. */
export const MODULES = ALL_MODULES
export { MODULE_GROUPS, MODULE_LABEL }

/** Roles, in the column order used by the existing Access Control matrix. */
export const ROLES = ACCESS_ROLES

/**
 * Capability dimensions. `enforced: true` means the app enforces it TODAY
 * (view → AuthContext.hasPermission + <ModuleRoute>). The rest are stored for
 * progressive enforcement and must be labelled as such in any UI.
 */
export const CAPABILITIES = [
  { key: 'view',    label: 'View',    enforced: true,  description: 'Open the module (routes + navigation). Enforced now via hasPermission.' },
  { key: 'create',  label: 'Create',  enforced: false, description: 'Add new records in the module.' },
  { key: 'edit',    label: 'Edit',    enforced: false, description: 'Modify existing records.' },
  { key: 'delete',  label: 'Delete',  enforced: false, description: 'Remove records.' },
  { key: 'export',  label: 'Export',  enforced: false, description: 'Download / export module data.' },
  { key: 'approve', label: 'Approve', enforced: false, description: 'Approve workflow items (uploads, work orders…).' },
]

export const CAPABILITY_KEYS = CAPABILITIES.map((c) => c.key)
export const ENFORCED_CAPABILITY_KEYS = CAPABILITIES.filter((c) => c.enforced).map((c) => c.key)

export const PERMISSION_OVERRIDES_KEY = 'permission_overrides'
export const OVERRIDES_VERSION = 1

const MODULE_KEYS = new Set(MODULES.map((m) => m.key))
const ROLE_SET = new Set(ROLES)
const CAP_SET = new Set(CAPABILITY_KEYS)

// ── Defaults (EXACT mirror of AuthContext ROLE_DEFAULTS) ─────────────────────
// src/contexts/AuthContext.jsx ROLE_DEFAULTS is the hardcoded fallback used
// when no DB permissions are configured. This block must stay byte-equivalent
// in behaviour; the defaults-mirror test guards it.

const ADMIN_ONLY_MODULES = ['user_management', 'erp_sync', 'data_cleaning', 'audit_trail']

/** @type {Record<string, {type:'all'}|{type:'allExcept',keys:string[]}|{type:'only',keys:string[]}>} */
export const ROLE_VIEW_DEFAULTS = {
  Admin:     { type: 'all' },
  Manager:   { type: 'allExcept', keys: ADMIN_ONLY_MODULES },
  Director:  { type: 'allExcept', keys: ADMIN_ONLY_MODULES },
  Inspector: { type: 'only', keys: ['dashboard', 'tyre_records', 'inspections', 'alerts', 'fleet_master', 'gate_pass', 'daily_ops'] },
  'Tyre Man': { type: 'only', keys: ['dashboard', 'tyre_records', 'inspections', 'alerts', 'stock', 'work_orders', 'gate_pass'] },
  Reporter:  { type: 'only', keys: ['dashboard', 'analytics', 'kpi_scorecard', 'reports', 'executive_report', 'tyre_records'] },
  Driver:    { type: 'only', keys: ['dashboard', 'inspections', 'alerts'] },
  'Integration Admin': { type: 'only', keys: ['dashboard', 'alerts', 'erp_sync', 'data_cleaning', 'upload_data', 'custom_data', 'audit_trail'] },
  'Data Engineer':     { type: 'only', keys: ['dashboard', 'alerts', 'erp_sync', 'data_cleaning', 'upload_data', 'custom_data', 'tyre_records', 'fleet_master', 'analytics'] },
  Automation:          { type: 'only', keys: ['dashboard', 'alerts', 'erp_sync', 'upload_data', 'custom_data'] },
  'Data Monitor Officer': { type: 'only', keys: ['accidents'] },
}

/** Default view access for a role/module — mirrors AuthContext exactly. Unknown role → false. */
export function defaultViewAccess(role, moduleKey) {
  const def = ROLE_VIEW_DEFAULTS[role]
  if (!def) return false
  if (def.type === 'all') return true
  if (def.type === 'allExcept') return !def.keys.includes(moduleKey)
  return def.keys.includes(moduleKey)
}

/**
 * Build the full default matrix: { [role]: { [moduleKey]: { view, create, … } } }.
 * Today the app has NO per-capability enforcement inside a module — a role that
 * can open a module can use all of its actions. The defaults mirror that:
 * every capability defaults to the module's default view access.
 */
export function buildDefaultMatrix() {
  const matrix = {}
  for (const role of ROLES) {
    const row = {}
    for (const m of MODULES) {
      const v = defaultViewAccess(role, m.key)
      const caps = {}
      for (const c of CAPABILITY_KEYS) caps[c] = v
      row[m.key] = caps
    }
    matrix[role] = row
  }
  return matrix
}

// ── Effective matrix ─────────────────────────────────────────────────────────

/**
 * Defaults + live DB view rows + stored capability overrides.
 *
 * @param {object|null} overrides sparse {role:{module:{cap:bool}}} (view + Admin ignored)
 * @param {object|null} viewMap   {role:{module:bool}} global module_permissions rows.
 *   Mirrors hasPermission semantics: when a role has ANY DB rows, the DB map
 *   fully defines view for that role (missing key ⇒ false); a role with no
 *   rows keeps the hardcoded defaults. Admin is always full access.
 */
export function getEffectiveMatrix(overrides = null, viewMap = null) {
  const matrix = buildDefaultMatrix()
  // 1. DB view rows (existing enforcement source)
  if (viewMap && typeof viewMap === 'object') {
    for (const role of ROLES) {
      if (role === 'Admin') continue
      const rows = viewMap[role]
      if (!rows || typeof rows !== 'object' || Object.keys(rows).length === 0) continue
      for (const m of MODULES) matrix[role][m.key].view = rows[m.key] === true
    }
  }
  // 2. Stored capability overrides (view excluded — DB owns view)
  if (overrides && typeof overrides === 'object') {
    for (const [role, mods] of Object.entries(overrides)) {
      if (role === 'Admin' || !ROLE_SET.has(role) || !mods || typeof mods !== 'object') continue
      for (const [mod, caps] of Object.entries(mods)) {
        if (!MODULE_KEYS.has(mod) || !caps || typeof caps !== 'object') continue
        for (const [cap, val] of Object.entries(caps)) {
          if (cap === 'view' || !CAP_SET.has(cap)) continue
          matrix[role][mod][cap] = val === true
        }
      }
    }
  }
  return matrix
}

/**
 * Immutable single-cell update. Admin is locked (always full access — mirrors
 * the code's Admin bypass and the server-side V64 guard): returns the matrix
 * unchanged. Throws on unknown role/module/capability.
 */
export function setPermission(matrix, role, moduleKey, capability, value) {
  if (!ROLE_SET.has(role)) throw new Error(`Unknown role: ${role}`)
  if (!MODULE_KEYS.has(moduleKey)) throw new Error(`Unknown module: ${moduleKey}`)
  if (!CAP_SET.has(capability)) throw new Error(`Unknown capability: ${capability}`)
  if (role === 'Admin') return matrix
  return {
    ...matrix,
    [role]: {
      ...matrix[role],
      [moduleKey]: { ...matrix[role][moduleKey], [capability]: Boolean(value) },
    },
  }
}

// ── Diffing ──────────────────────────────────────────────────────────────────

/** Sparse diff of `next` vs `base`: {role:{module:{cap:bool}}} (Admin excluded). */
export function matrixDiff(base, next) {
  const diff = {}
  for (const role of ROLES) {
    if (role === 'Admin') continue
    for (const m of MODULES) {
      for (const cap of CAPABILITY_KEYS) {
        const a = base?.[role]?.[m.key]?.[cap] === true
        const b = next?.[role]?.[m.key]?.[cap] === true
        if (a !== b) ((diff[role] ||= {})[m.key] ||= {})[cap] = b
      }
    }
  }
  return diff
}

/** Sparse diff of a matrix vs the hardcoded defaults. */
export function diffFromDefaults(matrix) {
  return matrixDiff(buildDefaultMatrix(), matrix)
}

/** True when the sparse diff object carries no changes. */
export function isEmptyDiff(diff) {
  return !diff || Object.keys(diff).length === 0
}

/** Number of individual capability changes in a sparse diff. */
export function countDiff(diff) {
  let n = 0
  for (const mods of Object.values(diff || {}))
    for (const caps of Object.values(mods)) n += Object.keys(caps).length
  return n
}

/**
 * Extract the `view` changes from a sparse diff as the payload shape of the
 * existing `set_module_permissions` RPC: [{ role, module_key, enabled }].
 */
export function extractViewChanges(diff) {
  const out = []
  for (const [role, mods] of Object.entries(diff || {})) {
    for (const [mod, caps] of Object.entries(mods)) {
      if (Object.prototype.hasOwnProperty.call(caps, 'view')) {
        out.push({ role, module_key: mod, enabled: caps.view === true })
      }
    }
  }
  return out
}

/** Drop `view` from a sparse diff — what remains is stored in app_settings. */
export function stripView(diff) {
  const out = {}
  for (const [role, mods] of Object.entries(diff || {})) {
    for (const [mod, caps] of Object.entries(mods)) {
      const rest = {}
      for (const [cap, val] of Object.entries(caps)) if (cap !== 'view') rest[cap] = val === true
      if (Object.keys(rest).length) ((out[role] ||= {})[mod] = rest)
    }
  }
  return out
}

// ── Serialization (app_settings `permission_overrides`) ──────────────────────

/** Serialize sparse overrides into the stored JSON envelope. */
export function serializeOverrides(overrides) {
  return JSON.stringify({
    version: OVERRIDES_VERSION,
    updated_at: new Date().toISOString(),
    overrides: sanitizeOverrides(overrides),
  })
}

/**
 * Defensive parse of a stored value (string or object) → validated sparse
 * overrides. Unknown roles/modules/capabilities, `view` entries, Admin
 * entries and non-boolean values are dropped. Garbage → {}.
 */
export function parseOverrides(raw) {
  if (raw == null) return {}
  let v = raw
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { return {} }
  }
  if (!v || typeof v !== 'object') return {}
  const inner = v.overrides && typeof v.overrides === 'object' ? v.overrides : v
  return sanitizeOverrides(inner)
}

function sanitizeOverrides(overrides) {
  const out = {}
  if (!overrides || typeof overrides !== 'object') return out
  for (const [role, mods] of Object.entries(overrides)) {
    if (role === 'Admin' || !ROLE_SET.has(role) || !mods || typeof mods !== 'object') continue
    for (const [mod, caps] of Object.entries(mods)) {
      if (!MODULE_KEYS.has(mod) || !caps || typeof caps !== 'object') continue
      const clean = {}
      for (const [cap, val] of Object.entries(caps)) {
        if (cap === 'view' || !CAP_SET.has(cap) || typeof val !== 'boolean') continue
        clean[cap] = val
      }
      if (Object.keys(clean).length) ((out[role] ||= {})[mod] = clean)
    }
  }
  return out
}

// ── Resolution (the hook AuthContext can consume later) ──────────────────────

/**
 * Resolve the full capability map for one role:
 * { [moduleKey]: { view, create, edit, delete, export, approve } }.
 * Admin always resolves to full access. This is the function an enforcement
 * point (AuthContext, a useCapability hook, per-page action guards) consumes.
 */
export function resolvePermissions(role, overrides = null, viewMap = null) {
  const matrix = getEffectiveMatrix(overrides, viewMap)
  return matrix[role] ?? Object.fromEntries(
    MODULES.map((m) => [m.key, Object.fromEntries(CAPABILITY_KEYS.map((c) => [c, false]))]),
  )
}

// ── Persistence (app_settings — same pattern as src/lib/api/erp.js) ──────────

/** Read the org's stored capability overrides (authenticated read via RLS). */
export async function getPermissionOverrides() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', PERMISSION_OVERRIDES_KEY)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Could not load permission overrides.')
  return parseOverrides(data?.value)
}

/** Save capability overrides (admins only — enforced by app_settings RLS). */
export async function savePermissionOverrides(overrides) {
  const clean = sanitizeOverrides(overrides)
  const { error } = await supabase.from('app_settings').upsert(
    { key: PERMISSION_OVERRIDES_KEY, value: serializeOverrides(clean) },
    { onConflict: 'key' },
  )
  if (error) throw new Error(error.message || 'Could not save permission overrides.')
  return clean
}
