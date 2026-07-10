/**
 * permissions/engine.js — the pure, framework-free authorization engine for the
 * centralized Master Access Control model.
 *
 * This is the ONE place all permission checks resolve to `can(subject, key,
 * context)`. It has no React and no Supabase imports so it can run in the
 * browser, in a test, in an edge function, or on a server unchanged.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SECURITY BOUNDARY                                                          │
 * │                                                                           │
 * │ This engine is a CONVENIENCE layer. It decides what UI to show and which  │
 * │ actions to offer. It is NOT the security boundary. The real boundary is   │
 * │ Supabase Row Level Security plus validated backend writes. Never trust a  │
 * │ role, permission, or location value that originated only in the frontend  │
 * │ (see the master spec: "Hiding buttons is not security. Every permission   │
 * │ must also be validated on the backend and through Supabase RLS.").        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Model:
 *   subject = {
 *     role,               // primary role name (title-case, e.g. 'Inspector')
 *     roles?,             // optional extra roles; all are unioned
 *     permissions?,       // explicit grants/denies that beat role defaults:
 *                         //   ['tyres.records.*']  (array = allow list), OR
 *                         //   { allow: [...], deny: [...] }  (explicit both)
 *     locations?,         // scope grants: [{ scope, country?, site?, ... }]
 *                         //   or a convenience shorthand (see normalizeLocations)
 *     isSuperAdmin?,      // Platform Super Admin — cross-tenant isolation applies
 *     orgId?,             // the subject's tenant
 *   }
 *   context = {
 *     orgId?,             // tenant that owns the record being acted on
 *     country?, site?,    // record location
 *     ownerId?,           // record owner (for own-record scope)
 *     scope?,             // explicit required scope override
 *   }
 *
 * Resolution order (deny-by-default):
 *   1. Cross-tenant isolation: if subject.orgId and context.orgId disagree,
 *      DENY — unless the subject is a Platform Super Admin (isolated global
 *      role). A super admin is the only actor allowed across tenants.
 *   2. Effective permission set = union of role-template keys for every role,
 *      plus explicit `allow`. Explicit `deny` is removed and always wins.
 *   3. Wildcard match the requested key against that set (`*`, `module.*`,
 *      `module.resource.*`, exact).
 *   4. Location-scope check against the subject's location grants and the
 *      record context (company / country / site / own-record).
 */

import {
  ROLE_TEMPLATES,
  isValidActionKey,
} from './registry'

// ── Scope constants ──────────────────────────────────────────────────────────
export const SCOPES = Object.freeze({
  COMPANY: 'company',
  COUNTRY: 'country',
  SITE: 'site',
  OWN: 'own',
})

// Broadness ordering — a grant at a broader scope satisfies a narrower need.
// company ⊇ country ⊇ site ⊇ own.
const SCOPE_RANK = Object.freeze({
  [SCOPES.COMPANY]: 3,
  [SCOPES.COUNTRY]: 2,
  [SCOPES.SITE]: 1,
  [SCOPES.OWN]: 0,
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Normalize `subject.permissions` into `{ allow: string[], deny: string[] }`.
 * Accepts:
 *   - an array of grant keys           → { allow: [...], deny: [] }
 *   - { allow?, deny? } explicit form  → passed through (arrays coerced)
 *   - a `!key` prefix inside an array   → treated as an explicit deny
 */
export function normalizeGrants(permissions) {
  const out = { allow: [], deny: [] }
  if (!permissions) return out
  if (Array.isArray(permissions)) {
    for (const raw of permissions) {
      if (typeof raw !== 'string') continue
      if (raw.startsWith('!')) out.deny.push(raw.slice(1))
      else out.allow.push(raw)
    }
    return out
  }
  if (typeof permissions === 'object') {
    for (const k of asArray(permissions.allow)) if (typeof k === 'string') out.allow.push(k)
    for (const k of asArray(permissions.deny)) if (typeof k === 'string') out.deny.push(k)
  }
  return out
}

/**
 * Normalize `subject.locations` into a list of scope grants:
 *   [{ scope, country?, site? }]
 *
 * Accepts:
 *   - undefined/null                     → [] (no explicit scope grant)
 *   - a string scope ('company')         → [{ scope: 'company' }]
 *   - { scope, country?, site? }         → [that]
 *   - an array mixing the above
 *   - convenience { country, site }      → inferred site-scope grant
 */
export function normalizeLocations(locations) {
  const out = []
  for (const raw of asArray(locations)) {
    if (typeof raw === 'string') {
      if (SCOPE_RANK[raw] !== undefined) out.push({ scope: raw })
      continue
    }
    if (raw && typeof raw === 'object') {
      let scope = raw.scope
      if (!scope) {
        if (raw.site) scope = SCOPES.SITE
        else if (raw.country) scope = SCOPES.COUNTRY
        else scope = SCOPES.COMPANY
      }
      if (SCOPE_RANK[scope] === undefined) continue
      out.push({
        scope,
        ...(raw.country != null ? { country: raw.country } : {}),
        ...(raw.site != null ? { site: raw.site } : {}),
      })
    }
  }
  return out
}

/** Does a granted wildcard/exact key `pattern` cover requested `key`? */
export function keyMatches(pattern, key) {
  if (typeof pattern !== 'string' || typeof key !== 'string') return false
  if (pattern === '*') return true
  if (pattern === key) return true
  // 'module.*' or 'module.resource.*' — the '*' must be a whole trailing segment.
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1) // keep the trailing '.', e.g. 'tyres.'
    return key.startsWith(prefix)
  }
  return false
}

/** True when any pattern in `patterns` covers `key`. */
function anyMatch(patterns, key) {
  for (const p of patterns) if (keyMatches(p, key)) return true
  return false
}

/**
 * Resolve the effective permission grant/deny sets for a subject:
 *   { allow: string[], deny: string[] }
 * = union of role-template keys for the primary role + every extra role, plus
 * explicit allow; explicit deny is surfaced separately (it always wins in can()).
 * Super admins resolve to a single `['*']` allow.
 */
export function resolveEffectivePermissions(subject) {
  if (!subject || typeof subject !== 'object') return { allow: [], deny: [] }

  if (subject.isSuperAdmin) return { allow: ['*'], deny: [] }

  const roles = [subject.role, ...asArray(subject.roles)].filter(
    (r) => typeof r === 'string' && r.length > 0,
  )

  const allow = new Set()
  for (const role of roles) {
    const template = ROLE_TEMPLATES[role]
    if (template) for (const key of template) allow.add(key)
  }

  const grants = normalizeGrants(subject.permissions)
  for (const key of grants.allow) allow.add(key)

  return { allow: [...allow], deny: [...new Set(grants.deny)] }
}

// ── Location scope ───────────────────────────────────────────────────────────

/**
 * Which scope does this check REQUIRE? Explicit `context.scope` wins; otherwise
 * infer from the record context (a record with an owner and no location still
 * defaults to company-level so an unscoped subject with a company grant passes).
 */
function requiredScope(context) {
  if (context && SCOPE_RANK[context.scope] !== undefined) return context.scope
  return SCOPES.COMPANY
}

/**
 * Does the subject's location grants satisfy the record context?
 *
 * Rules:
 *   - No location grants at all → treated as company-wide (back-compat: existing
 *     users have no per-location assignment yet; RLS remains the real fence).
 *   - A `company` grant satisfies anything.
 *   - A `country` grant satisfies records in that country (or with no country).
 *   - A `site` grant satisfies records at that site (or with no site).
 *   - An `own` grant satisfies only when context.ownerId === subject.id/ownerId.
 *   - When context.scope is 'own', ONLY ownership (or a broader company grant
 *     explicitly, no — own must be ownership) passes.
 */
export function locationAllows(subject, context) {
  const grants = normalizeLocations(subject?.locations)
  const ctx = context || {}
  const need = requiredScope(ctx)

  // Own-record requirement: must be the owner. No location grant overrides
  // ownership semantics — this is the "your own records" fence.
  if (need === SCOPES.OWN) {
    const owner = ctx.ownerId
    const me = subject?.id ?? subject?.ownerId ?? subject?.userId
    return owner != null && me != null && String(owner) === String(me)
  }

  // No explicit grants → company-wide (see rule above).
  if (grants.length === 0) return true

  for (const g of grants) {
    // A broader-or-equal grant is a prerequisite; then match the record fields.
    if (SCOPE_RANK[g.scope] < SCOPE_RANK[need]) {
      // Grant is narrower than required (e.g. site grant, company record):
      // only passes if the record actually sits inside the grant's location.
      // Fall through to field matching below.
    }
    if (g.scope === SCOPES.COMPANY) return true
    if (g.scope === SCOPES.COUNTRY) {
      if (g.country == null) return true
      if (ctx.country == null || String(ctx.country) === String(g.country)) return true
      continue
    }
    if (g.scope === SCOPES.SITE) {
      const siteOk = g.site == null || ctx.site == null || String(ctx.site) === String(g.site)
      const countryOk = g.country == null || ctx.country == null || String(ctx.country) === String(g.country)
      if (siteOk && countryOk) return true
      continue
    }
    if (g.scope === SCOPES.OWN) {
      const me = subject?.id ?? subject?.ownerId ?? subject?.userId
      if (ctx.ownerId != null && me != null && String(ctx.ownerId) === String(me)) return true
      continue
    }
  }
  return false
}

// ── Tenant isolation ─────────────────────────────────────────────────────────

/**
 * Cross-tenant isolation. A Platform Super Admin is a globally isolated role
 * and may act across tenants. Every other subject is confined to their own
 * org: if both orgIds are known and differ, DENY.
 */
export function tenantAllows(subject, context) {
  if (subject?.isSuperAdmin) return true
  const subjectOrg = subject?.orgId
  const recordOrg = context?.orgId
  if (subjectOrg == null || recordOrg == null) return true // unknown → let RLS decide
  return String(subjectOrg) === String(recordOrg)
}

// ── Core decision ────────────────────────────────────────────────────────────

/**
 * Can `subject` perform `permissionKey` in `context`?
 *
 * Deny-by-default. Returns a boolean. Never throws — a malformed subject/key
 * resolves to `false` (fail closed), because this gates access.
 *
 * @param {object} subject      see file header
 * @param {string} permissionKey  a `module.resource.action` key
 * @param {object} [context]    see file header
 * @returns {boolean}
 */
export function can(subject, permissionKey, context = {}) {
  // Fail closed on garbage input.
  if (!subject || typeof subject !== 'object') return false
  if (typeof permissionKey !== 'string' || permissionKey.length === 0) return false

  // 1. Tenant isolation first — a wrong tenant is denied regardless of role,
  //    except the isolated Platform Super Admin.
  if (!tenantAllows(subject, context)) return false

  // Super admin: full access within tenant isolation already cleared above.
  if (subject.isSuperAdmin) return true

  // A well-formedness guard: unknown-shaped keys can never match a canonical
  // grant except via a wildcard the caller explicitly configured, so we still
  // evaluate them — but a totally malformed key (no dots) cannot match.
  if (!isValidActionKey(permissionKey) && !permissionKey.includes('.')) return false

  const { allow, deny } = resolveEffectivePermissions(subject)

  // 2. Explicit deny always wins.
  if (anyMatch(deny, permissionKey)) return false

  // 3. Must be granted by role template or explicit allow (wildcards included).
  if (!anyMatch(allow, permissionKey)) return false

  // 4. Location scope must permit the record context.
  if (!locationAllows(subject, context)) return false

  return true
}

/** Convenience inverse of can(). */
export function cannot(subject, permissionKey, context = {}) {
  return !can(subject, permissionKey, context)
}

export default {
  can,
  cannot,
  resolveEffectivePermissions,
  locationAllows,
  tenantAllows,
  keyMatches,
  normalizeGrants,
  normalizeLocations,
  SCOPES,
}
