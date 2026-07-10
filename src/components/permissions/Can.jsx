/**
 * <Can> — declarative render-guard for the centralized permission engine.
 *
 * Usage:
 *   <Can I="inspections.daily.approve" this={{ site, ownerId }}>
 *     <ApproveButton />
 *   </Can>
 *
 *   <Can I="finance.costs.view_financial" fallback={<Locked />}>
 *     <CostColumn />
 *   </Can>
 *
 * Renders `children` only when the current user can perform the permission key
 * in the given context; otherwise renders `fallback` (default: nothing).
 * `children` may be a render-prop function `(allowed) => ReactNode` for cases
 * that need both branches inline.
 *
 * SECURITY: this only controls what renders. It is NOT authorization — the
 * backend + Supabase RLS enforce access. Do not rely on <Can> to keep data
 * safe; rely on it to keep the UI honest.
 */

import { useCan } from '../../hooks/useCan'

export function Can({ I, this: context = {}, fallback = null, children }) {
  const { can } = useCan()
  const allowed = typeof I === 'string' && I.length > 0 ? can(I, context) : false

  if (typeof children === 'function') return children(allowed)
  return allowed ? children : fallback
}

export default Can
