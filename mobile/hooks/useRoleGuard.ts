/**
 * useRoleGuard
 *
 * Redirects unauthorized users away from protected screens.
 * Runs after profile is loaded — shows a spinner during the check.
 *
 * Usage:
 *   const { allowed } = useRoleGuard(['admin'])           // admin only
 *   const { allowed } = useRoleGuard(['admin','manager']) // elevated only
 *   if (!allowed) return null                             // guard renders nothing while redirecting
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { useAuth } from '../contexts/AuthContext'
import { UserRole, isAdminOrAbove } from '../lib/types'

export function useRoleGuard(allowedRoles: UserRole[]): { allowed: boolean; loading: boolean } {
  const { profile, loading } = useAuth()
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)
  const allowedRolesKey = allowedRoles.join('|')

  useEffect(() => {
    if (loading) return

    const role = profile?.role ?? null
    const permitted = role !== null && allowedRoles.includes(role)

    if (!permitted) {
      // Redirect to home — user lacks required role
      setAllowed(false)
      router.replace('/')
    } else {
      setAllowed(true)
    }
  }, [allowedRolesKey, loading, profile?.role, router])

  return { allowed, loading }
}

/** Convenience: admin + manager + director */
export function useElevatedGuard() {
  return useRoleGuard(['admin', 'manager', 'director'])
}

/** Convenience: admin only */
export function useAdminGuard() {
  return useRoleGuard(['admin'])
}
