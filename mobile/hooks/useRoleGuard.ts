/**
 * Route guards.
 *
 * `useModuleGuard(key)` is THE guard for any screen backed by a module in the
 * registry (lib/permissions.ts). It answers exactly the same question, with
 * exactly the same resolver, as <ModuleGuard> / the Home hub / the tab bar, so
 * the three layers can never disagree about who may open a screen.
 *
 * WHY THIS EXISTS
 * ---------------
 * Screens used to gate on `useRoleGuard(['a','b'])` — a hardcoded list per
 * screen — while Home and the tab bar gated on `canAccess(moduleKey)` (registry
 * + role matrix + per-user grants). The two DRIFTED. A user saw the tile, tapped
 * it, and the screen's own list redirected them straight back to Home. That
 * reads as "it never opens / it spins", and it is what the stock screen was
 * doing to inspectors and the meter log was doing to drivers on their own
 * primary tab.
 *
 * Three defects the list-based guard carried, all fixed here:
 *   1. It compared `allowedRoles.includes(role)` literally and never consulted
 *      `isSuperAdmin`, so a super-admin whose profiles.role is not the literal
 *      string 'admin' was redirected off every guarded screen.
 *   2. It ignored per-user grants entirely, so a module granted to one person in
 *      the web Access Manager produced a tile that bounced — silently breaking
 *      the per-user grant feature on mobile.
 *   3. It waited on `loading` only. AuthContext clears `loading` BEFORE the
 *      profile resolves (`profileLoading` covers that window), so on a cold
 *      start or deep link the guard evaluated `profile === null`, decided "not
 *      permitted" and redirected — bouncing EVERY role, including admin, off
 *      screens they are fully entitled to.
 *
 * Usage:
 *   const { allowed } = useModuleGuard('stock')
 *   if (!allowed) return null   // renders nothing while resolving / redirecting
 *
 * The client guard is UX + defense-in-depth only; the server (RLS + RPCs) is the
 * real authorization boundary.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { useAuth } from '../contexts/AuthContext'
import { UserRole, isAdmin } from '../lib/types'
import { ModuleKey, resolveGuardedAccess } from '../lib/permissions'

/**
 * Registry-backed guard. Resolves access through `resolveGuardedAccess` — the
 * SAME function <ModuleGuard> uses — so an inner guard can never turn away a
 * user the wrapper just admitted. Fails CLOSED for sensitive administration
 * modules when the permission RPCs errored (see SENSITIVE_MODULES).
 *
 * Never redirects while the session or the profile is still resolving.
 */
export function useModuleGuard(moduleKey: ModuleKey): { allowed: boolean; loading: boolean } {
  const {
    profile, loading, profileLoading, permissionsError,
    isSuperAdmin, grants, roleMatrix,
  } = useAuth()
  const [allowed, setAllowed] = useState(false)

  // The auth session or the profile is still being read. Deciding now would
  // judge the user on a null role and bounce them off a screen they own.
  const resolving = loading || profileLoading

  useEffect(() => {
    if (resolving) return

    const permitted = resolveGuardedAccess(
      moduleKey, profile?.role ?? null, grants, isSuperAdmin, roleMatrix, permissionsError,
    )

    // DELIBERATELY NO REDIRECT. This used to call router.replace('/'), which
    // threw the person back to Home - and a screen that vanishes and dumps you
    // on the main page reads as the app malfunctioning, not as "you do not have
    // access to this". The owner reported it exactly that way twice.
    //
    // A refusal now stays where it is and SAYS so: a wrapped screen gets
    // <NoAccess/> from withModuleGuard before its body ever runs, and the few
    // unwrapped screens render it themselves. Nothing renders blank.
    setAllowed(permitted)
  }, [
    moduleKey, resolving, profile?.role, isSuperAdmin,
    grants, roleMatrix, permissionsError,
  ])

  return { allowed, loading: resolving }
}

/**
 * Legacy role-list guard. RETAINED for the small number of gates that are
 * deliberately STRICTER than any registry module (see admin/approvals.tsx) and
 * must not be loosened to a module's role default.
 *
 * Do NOT use this for a screen that has a module key — use `useModuleGuard`, or
 * the two layers drift again. `__tests__/routeGuardRegistry.test.ts` enforces
 * that rule.
 *
 * Unlike the old implementation this admits a super-admin and waits for the
 * profile, so it carries neither the escalation gap nor the cold-start bounce.
 */
export function useRoleGuard(allowedRoles: UserRole[]): { allowed: boolean; loading: boolean } {
  const { profile, loading, profileLoading, isSuperAdmin } = useAuth()
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)
  const allowedRolesKey = allowedRoles.join('|')
  const resolving = loading || profileLoading

  useEffect(() => {
    if (resolving) return

    const role = profile?.role ?? null
    // A super-admin is never lockable, and the `admin` role is above every
    // per-screen list — matching resolveModuleAccess, which admits both.
    const permitted = isSuperAdmin === true
      || isAdmin(role)
      || (role !== null && allowedRoles.includes(role))

    if (!permitted) {
      setAllowed(false)
      // The legacy guard still redirects. Its ONE caller (admin/approvals) is
      // deliberately stricter than any module and renders <NoAccess/> itself
      // before this fires, so nobody sees the bounce - but do not adopt this
      // guard for a new screen expecting it to stay put.
      router.replace('/')
    } else {
      setAllowed(true)
    }
  }, [allowedRolesKey, resolving, profile?.role, isSuperAdmin, router])

  return { allowed, loading: resolving }
}

/** Convenience: admin + manager + director. */
export function useElevatedGuard() {
  return useRoleGuard(['admin', 'manager', 'director'])
}

/** Convenience: admin only (plus super-admin, via useRoleGuard). */
export function useAdminGuard() {
  return useRoleGuard(['admin'])
}
