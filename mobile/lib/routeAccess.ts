// Client guard is UX + defense-in-depth only; the server (RLS + RPCs) is the
// real authorization boundary.
//
// SINGLE registry mapping every deep-linkable (app) route to the ModuleKey it
// requires (or null for authenticated-only screens like Home / Profile /
// Notifications). Finding #8: the tab bar's `href:null` only hides a tab, it
// does NOT block a router.push() or a cold deep link, so navigation permissions
// and route guards were out of sync. <ModuleGuard> consumes this map (or an
// explicit per-screen key) so a route can never be reached without the access
// its navigation entry implies.
//
// Keys are the EXISTING mobile ModuleKey values from ./permissions (records,
// inspect, workshop, accidents, stock, meter, washing, pm, ...). No new keys.

import { ModuleKey } from './permissions'

/** `null` = no module gate (still requires an authenticated, validated profile). */
export type RouteModuleKey = ModuleKey | null

/**
 * Ordered, most-specific-first. `test` matches a NORMALISED pathname (see
 * `normalisePath`) so both static ("scanner") and dynamic ("inspection/123")
 * routes resolve. First hit wins.
 */
interface RouteRule {
  test: RegExp
  moduleKey: RouteModuleKey
}

const ROUTE_RULES: RouteRule[] = [
  // Always-allowed authenticated screens (no module gate).
  { test: /^index$/,                                moduleKey: null },
  { test: /^profile$/,                              moduleKey: null },
  { test: /^notifications$/,                        moduleKey: null },

  // Admin surfaces (sensitive — fail closed on permission errors).
  { test: /^admin\/users$/,                         moduleKey: 'users' },
  { test: /^admin\/access$/,                        moduleKey: 'users' },
  { test: /^admin\/approvals$/,                     moduleKey: 'approvals' },
  { test: /^admin\/ai-chat$/,                       moduleKey: 'ai' },
  { test: /^admin\/sites$/,                         moduleKey: 'admin' },
  { test: /^admin(\/index)?$/,                      moduleKey: 'admin' },

  // Inspections.
  { test: /^inspection\/approvals(\/.*)?$/,         moduleKey: 'approvals' },
  { test: /^inspection\/new$/,                      moduleKey: 'inspect' },
  { test: /^inspection\/[^/]+$/,                    moduleKey: 'inspect' },

  // Checklists.
  { test: /^checklists\/approvals(\/.*)?$/,         moduleKey: 'approvals' },
  { test: /^checklists(\/[^/]+)?$/,                 moduleKey: 'checklists' },

  // Accidents.
  { test: /^accident\/report$/,                     moduleKey: 'reportAccident' },
  { test: /^accident\/dashboard$/,                  moduleKey: 'accidents' },
  { test: /^accident\/[^/]+$/,                       moduleKey: 'accidents' },

  // Records / fleet.
  { test: /^records(\/.*)?$/,                        moduleKey: 'records' },
  { test: /^vehicles$/,                              moduleKey: 'vehicles' },
  { test: /^history$/,                               moduleKey: 'history' },
  { test: /^alerts$/,                                moduleKey: 'alerts' },
  { test: /^calendar$/,                              moduleKey: 'calendar' },

  // Maintenance / workshop.
  { test: /^work-?orders(\/.*)?$/,                   moduleKey: 'workorders' },
  { test: /^rca$/,                                   moduleKey: 'rca' },
  { test: /^tasks$/,                                 moduleKey: 'tasks' },
  { test: /^stock$/,                                 moduleKey: 'stock' },
  { test: /^maintenance$/,                           moduleKey: 'pm' },
  { test: /^workshop$/,                              moduleKey: 'workshop' },

  // Field.
  { test: /^scanner$/,                               moduleKey: 'scan' },
  { test: /^serial-search$/,                         moduleKey: 'serial' },
  { test: /^tyre-change$/,                           moduleKey: 'tyreChange' },
  { test: /^meter-logs$/,                            moduleKey: 'meter' },
  { test: /^washing$/,                               moduleKey: 'washing' },
  { test: /^report-issue$/,                          moduleKey: 'reportIssue' },

  // Management.
  { test: /^overview$/,                              moduleKey: 'overview' },
  { test: /^reports(\/.*)?$/,                        moduleKey: 'reports' },
  { test: /^analytics(\/.*)?$/,                      moduleKey: 'analytics' },
  { test: /^ai(\/.*)?$/,                             moduleKey: 'ai' },
  { test: /^team$/,                                  moduleKey: 'team' },
  { test: /^stockManage$/,                           moduleKey: 'stockManage' },
]

/**
 * Normalise an expo-router pathname to the registry's route form: strip any
 * leading slash, the "(app)" group segment, a trailing slash and query/hash, so
 * "/(app)/inspection/123?x=1" -> "inspection/123".
 */
function normalisePath(pathname: string): string {
  let p = (pathname || '').split('?')[0].split('#')[0]
  p = p.replace(/^\/+/, '')
  p = p.replace(/^\(app\)\//, '')
  p = p.replace(/^\(app\)$/, 'index')
  p = p.replace(/\/+$/, '')
  if (p === '' || p === '(app)') return 'index'
  return p
}

/**
 * Resolve the ModuleKey a route requires. Returns:
 *   • a ModuleKey  -> gate on that module
 *   • null         -> authenticated-only (no module gate)
 *   • undefined    -> unknown route (caller decides; ModuleGuard treats as
 *                     authenticated-only so an unmapped screen is never a hole
 *                     that silently grants a gated module).
 */
export function moduleKeyForRoute(pathname: string): RouteModuleKey | undefined {
  const p = normalisePath(pathname)
  for (const rule of ROUTE_RULES) {
    if (rule.test.test(p)) return rule.moduleKey
  }
  return undefined
}
