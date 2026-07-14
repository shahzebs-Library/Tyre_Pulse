import { useAuth } from '../contexts/AuthContext'

/**
 * useCapability — ergonomic reader for per-capability UI gating.
 *
 * Pages/components use this to disable or hide Create / Edit / Delete / Export /
 * Approve actions without reaching for the whole auth context:
 *
 *   const { hasCapability } = useCapability()
 *   <button disabled={!hasCapability('tyre_records', 'create')}>Add tyre</button>
 *
 * IMPORTANT: hasCapability is a CLIENT-SIDE gate only for non-view capabilities.
 * Only `view` is server-enforced today. The authoritative boundary is the server
 * (app_user_can / RLS); never rely on this result for security decisions.
 *
 * @returns {{
 *   hasCapability: (moduleKey: string, cap?: string) => boolean,
 *   capabilities: Record<string, Record<string,'grant'|'revoke'>>,
 *   hasPermission: (moduleKey: string) => boolean,
 * }}
 */
export function useCapability() {
  const { hasCapability, capabilities, hasPermission } = useAuth()
  return { hasCapability, capabilities, hasPermission }
}

export default useCapability
