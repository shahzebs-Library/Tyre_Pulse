/**
 * Centralised Role-Based Access Control (RBAC) for the mobile app.
 *
 * Single source of truth for "what a role is allowed to see / do". Screens and
 * the tab navigator derive their visible surface from here so that navigation
 * auto-adjusts per user and access never drifts between layers.
 *
 * Roles (see lib/types.ts): admin · manager · director · inspector · tyre_man · reporter
 */

import { UserRole, isAdminOrAbove, isAdmin } from './types'

// ── Capability predicates ───────────────────────────────────────────────────
// Role scopes (least-privilege):
//   tyre_man  → inspections, tyre change, scan, vehicles(view), alerts, tasks,
//               report issue, history  (NO accidents dashboard / stock / work
//               orders / RCA / overview / team / AI / admin)
//   inspector → tyre_man scope + accidents + RCA + work orders
//   manager/director → all operational + overview/reports + stock (NOT user mgmt)
//   admin     → everything incl. user management + admin console

/** Field staff who record tyre inspections, tyre changes, scans. */
export function canInspect(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || role === 'tyre_man' || isAdminOrAbove(role)
}

/** Field staff may file an accident report. */
export function canReportAccident(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || role === 'tyre_man' || isAdminOrAbove(role)
}

/** Accident dashboard / list - review surface. Tyre techs excluded. */
export function canViewAccidents(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || isAdminOrAbove(role)
}

/** Browse vehicles & raise tasks/alerts - operational field staff. */
export function canViewFleet(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || role === 'tyre_man' || isAdminOrAbove(role)
}

/** Maintenance work orders. */
export function canManageWorkOrders(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || isAdminOrAbove(role)
}

/** Root-cause analysis. */
export function canDoRca(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || isAdminOrAbove(role)
}

/** Stock / inventory management - management only. */
export function canManageStock(role: UserRole | null | undefined): boolean {
  return isAdminOrAbove(role)
}

/**
 * Count / adjust stock on hand (daily stock-take). Broader than stock master
 * data management: storekeepers and tyre handlers do the physical counts, so
 * tyre_man is included alongside management. The DB RPCs enforce approved +
 * unlocked + org boundary regardless.
 */
export function canCountStock(role: UserRole | null | undefined): boolean {
  return role === 'tyre_man' || isAdminOrAbove(role)
}

/** Fleet KPI overview / reports - management only. */
export function canViewOverview(role: UserRole | null | undefined): boolean {
  return isAdminOrAbove(role)
}

/** Elevated management console (admin snapshot, AI, reviews). */
export function canAccessAdmin(role: UserRole | null | undefined): boolean {
  return isAdminOrAbove(role)
}

/** User management - create/approve/edit accounts. Admin only. */
export function canManageUsers(role: UserRole | null | undefined): boolean {
  return isAdmin(role)
}

/** Fleet AI assistant. */
export function canUseAI(role: UserRole | null | undefined): boolean {
  return isAdminOrAbove(role)
}

/** Approve/review accident reports (close, change status). */
export function canReviewAccidents(role: UserRole | null | undefined): boolean {
  return isAdminOrAbove(role)
}

/**
 * Approve/reject submitted checklists that require sign-off. Mirrors the V212
 * RLS gate (Admin/Manager/Director/Maintenance Supervisor); Maintenance
 * Supervisor is not a distinct mobile role, so the mobile subset is
 * admin/manager/director.
 */
export function canApproveChecklists(role: UserRole | null | undefined): boolean {
  return isAdminOrAbove(role)
}

/**
 * Log a daily odometer / engine-hour meter reading. This is routine field data
 * capture (especially for drivers in markets without telematics), so every
 * operational role may do it; RLS still enforces the org/country boundary.
 */
export function canLogMeter(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || role === 'tyre_man' || role === 'reporter' || isAdminOrAbove(role)
}

/** Tyre records list - all roles with operational access. */
export function canViewRecords(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || role === 'tyre_man' || role === 'reporter' || isAdminOrAbove(role)
}

/** Can edit tyre records inline (admin and manager). */
export function canEditRecords(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'manager'
}

/** Fleet analytics - management roles only. */
export function canViewAnalytics(role: UserRole | null | undefined): boolean {
  return isAdminOrAbove(role)
}

/** Corrective actions / work orders - field staff + management. */
export function canViewWorkOrders(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || role === 'tyre_man' || isAdminOrAbove(role)
}

/** Can update work order status. */
export function canUpdateWorkOrders(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || role === 'tyre_man' || isAdminOrAbove(role)
}

/** PDF report generation - management + reporter. */
export function canViewReports(role: UserRole | null | undefined): boolean {
  return isAdminOrAbove(role) || role === 'reporter'
}

// ── Navigation model ────────────────────────────────────────────────────────
//
// The tab bar is rendered from this descriptor so a single change here keeps
// routing, icons and RBAC in lockstep.

export interface TabDescriptor {
  /** expo-router route name within (app)/ */
  name: string
  /** i18n key for the tab label */
  labelKey: string
  /** Ionicons glyph */
  icon: string
  /** Optional active tint override (e.g. accident = red, admin = purple) */
  activeTint?: string
  /** Returns true when this tab should be visible for the given role */
  visible: (role: UserRole | null | undefined) => boolean
  /**
   * Shown in the bottom tab bar. Only a small set are primary; the rest stay
   * routable (reached from the Home hub) but are kept OUT of the bar so it never
   * crowds. A non-primary descriptor is still declared as a screen (href:null)
   * so expo-router never auto-adds it as a stray tab.
   */
  primary?: boolean
}

export const TAB_BAR: TabDescriptor[] = [
  {
    name: 'index',
    labelKey: 'tabs.home',
    icon: 'home-outline',
    visible: () => true,
    primary: true,
  },
  {
    name: 'inspection/new',
    labelKey: 'tabs.inspect',
    icon: 'clipboard-outline',
    visible: canInspect,
    primary: true,
  },
  {
    name: 'records/index',
    labelKey: 'tabs.records',
    icon: 'layers-outline',
    visible: canViewRecords,
    primary: true,
  },
  {
    name: 'accident/dashboard',
    labelKey: 'tabs.accident',
    icon: 'warning-outline',
    activeTint: '#dc2626',
    visible: canViewAccidents,
    primary: true,
  },
  {
    name: 'workorders/index',
    labelKey: 'tabs.workorders',
    icon: 'construct-outline',
    visible: canViewWorkOrders,
  },
  {
    name: 'analytics/index',
    labelKey: 'tabs.analytics',
    icon: 'bar-chart-outline',
    activeTint: '#3b82f6',
    visible: canViewAnalytics,
  },
  {
    name: 'reports/index',
    labelKey: 'tabs.reports',
    icon: 'document-text-outline',
    visible: canViewReports,
  },
  {
    name: 'ai/index',
    labelKey: 'tabs.ai',
    icon: 'sparkles-outline',
    activeTint: '#7c3aed',
    visible: canUseAI,
  },
  {
    name: 'admin/index',
    labelKey: 'tabs.admin',
    icon: 'shield-outline',
    activeTint: '#7c3aed',
    visible: canAccessAdmin,
  },
  {
    name: 'profile',
    labelKey: 'tabs.profile',
    icon: 'person-outline',
    visible: () => true,
    primary: true,
  },
]
