import { useAuth } from '../contexts/AuthContext'

/**
 * useCapabilities — ergonomic access to the current user's effective
 * capabilities (role access merged with Super Admin per-user grant overrides).
 *
 * Thin wrapper over useAuth so pages/components can guard UI without reaching
 * for the whole auth context:
 *   const { isSuperAdmin, hasPermission, grantedModules } = useCapabilities()
 *
 * @returns {{
 *   isSuperAdmin: boolean,
 *   hasPermission: (moduleKey: string) => boolean,
 *   grantedModules: Set<string>,
 *   grantOverrides: Record<string,'grant'|'revoke'>,
 * }}
 */
export function useCapabilities() {
  const { isSuperAdmin, hasPermission, grantedModules, grantOverrides } = useAuth()
  return { isSuperAdmin, hasPermission, grantedModules, grantOverrides }
}

export default useCapabilities
