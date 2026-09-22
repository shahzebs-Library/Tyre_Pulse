/**
 * WHO MAY SIGN OFF A TYRE INSPECTION - the one client-side copy of the rule.
 *
 * MIRRORS the role list inside the `decide_inspection_approval` RPC: V600 set
 * it (Admin, PMV Manager, Workshop Area Manager, Workshop Maintenance Area
 * Manager) and V606 widened it with Tyre Data Collector. CHANGE BOTH TOGETHER.
 *
 * The queue states the invariant itself - "show the button only to somebody the
 * server would actually let act" - and two screens were breaking it in opposite
 * directions:
 *
 *   - `/approvals` gated inspections on Admin/Manager/Director, so a Manager or
 *     a Director saw Approve and was refused by the RPC, while a PMV Manager,
 *     either area manager or a Tyre Data Collector - every role that CAN sign -
 *     saw no sign-off control at all.
 *   - `/inspections` carried its own list, which likewise admitted Manager,
 *     Director and Maintenance Supervisor (all refused) and omitted the two
 *     area-manager roles and PMV Manager (all accepted).
 *
 * DELIBERATELY ROLE-ONLY. A capability grant is NOT consulted, because the RPC
 * does not consult one either: it is a bare role test with an `is_super_admin()`
 * escape. Honouring `inspections:approve` here would put the button back in
 * front of somebody the database still refuses, which is the defect this module
 * exists to close.
 */
export const INSPECTION_SIGNER_ROLES = Object.freeze([
  'Admin',
  'PMV Manager',
  'Workshop Area Manager',
  'Workshop Maintenance Area Manager',
  'Tyre Data Collector',
])

/**
 * @param {string|null|undefined} role     profiles.role, in its stored Title Case
 * @param {{isSuperAdmin?: boolean}} opts
 * @returns {boolean} true when the RPC would accept this caller's signature
 */
export function canSignInspection(role, { isSuperAdmin = false } = {}) {
  if (isSuperAdmin === true) return true
  return typeof role === 'string' && INSPECTION_SIGNER_ROLES.includes(role)
}
