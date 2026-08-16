/**
 * Who may BUILD a report.
 *
 * Owner instruction: only an Admin may reach any kind of report builder. This is
 * the single place that decides it, because the builders are not all routes -
 * three of them are panels embedded inside ordinary pages (PresentationStudio on
 * Board Overview, Expenses and Cost per M3; the Report Builder tab inside
 * Accidents; the share-layout designer inside Report Sharing). Guarding only the
 * two builder ROUTES would have left those three open to every Manager and
 * Director who could already reach the host page.
 *
 * So the components self-gate on this predicate and the routes use it too. A new
 * mount of a builder inherits the rule without anyone remembering to add a guard.
 *
 * BUILDING is restricted; READING is not. Running, viewing, scheduling and
 * exporting an existing report are unchanged - taking those away would stop
 * managers doing their job, and the instruction was about builders.
 *
 * Super-admin passes as break-glass, matching RoleRoute's own behaviour, so the
 * platform owner can never lock themselves out of a surface they administer.
 */

/** Canonical Admin role name as stored on profiles.role. */
export const REPORT_BUILDER_ROLE = 'Admin'

/**
 * @param {{role?: string, is_super_admin?: boolean}|null|undefined} profile
 * @param {boolean} [isSuperAdmin] - from useAuth(); the profile flag is a fallback
 *   for callers that only have the profile to hand.
 * @returns {boolean}
 */
export function canUseReportBuilder(profile, isSuperAdmin) {
  if (isSuperAdmin === true) return true
  if (profile?.is_super_admin === true) return true
  return profile?.role === REPORT_BUILDER_ROLE
}

/** Routes whose whole purpose is building. Kept here so nav, routes and tests agree. */
export const REPORT_BUILDER_ROUTES = Object.freeze([
  '/report-builder',
  '/dashboard-builder',
  '/report-sharing',
])
