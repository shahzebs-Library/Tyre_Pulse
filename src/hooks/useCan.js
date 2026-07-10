/**
 * useCan — React binding for the centralized permission engine
 * (src/lib/permissions/engine.js).
 *
 * Builds a permission subject from the current auth profile (AuthContext) and
 * tenant (TenantContext) and returns `{ can, cannot, subject }`. Both helpers
 * take `(permissionKey, context)` and are memoized so consumers only re-render
 * when the underlying identity actually changes.
 *
 * Degrades to DENY when identity is unknown (no profile yet, loading) — never
 * a flash of unauthorized UI. This is the exact fail-closed posture of the
 * engine.
 *
 * SECURITY: convenience only. Rendering a button here does not authorize the
 * action — Supabase RLS + backend validation are the real boundary.
 */

import { useCallback, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { can as engineCan, cannot as engineCannot } from '../lib/permissions/engine'

/**
 * Map an app profile + tenant into an engine subject.
 * - role/roles: title-case role names from the profile (matches ROLE_TEMPLATES).
 * - locations: derived from the profile's assigned country/site until per-user
 *   location assignment lands; absence means company-wide (RLS still fences).
 * - isSuperAdmin: reserved for the Platform Super Admin role.
 * - orgId: the subject's tenant, for cross-tenant isolation.
 */
export function buildSubject(profile, orgId) {
  if (!profile) return null
  const role = profile.role
  const locations = []
  if (profile.country || profile.site) {
    locations.push({
      scope: profile.site ? 'site' : 'country',
      ...(profile.country ? { country: profile.country } : {}),
      ...(profile.site ? { site: profile.site } : {}),
    })
  }
  return {
    id: profile.id,
    role,
    roles: Array.isArray(profile.roles) ? profile.roles : undefined,
    permissions: profile.permissions ?? undefined,
    locations,
    isSuperAdmin: role === 'Platform Super Admin',
    orgId: orgId ?? profile.org_id ?? null,
  }
}

export function useCan() {
  const auth = useAuth()
  const tenant = useTenant()
  const profile = auth?.profile ?? null
  const orgId = tenant?.orgId ?? null

  const subject = useMemo(() => buildSubject(profile, orgId), [profile, orgId])

  const can = useCallback(
    (permissionKey, context = {}) => (subject ? engineCan(subject, permissionKey, context) : false),
    [subject],
  )

  const cannot = useCallback(
    (permissionKey, context = {}) => (subject ? engineCannot(subject, permissionKey, context) : true),
    [subject],
  )

  return { can, cannot, subject }
}

export default useCan
