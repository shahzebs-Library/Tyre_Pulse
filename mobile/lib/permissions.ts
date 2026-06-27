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

/** Field staff who record tyre inspections. */
export function canInspect(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || role === 'tyre_man' || isAdminOrAbove(role)
}

/** Anyone operational may file an accident/incident report. */
export function canReportAccident(role: UserRole | null | undefined): boolean {
  return role != null
}

/** Who can open the accident dashboard tab. */
export function canViewAccidents(role: UserRole | null | undefined): boolean {
  return role != null
}

/** Elevated management console (admin snapshot, AI, reviews). */
export function canAccessAdmin(role: UserRole | null | undefined): boolean {
  return isAdminOrAbove(role)
}

/** User management — create/approve/edit accounts. Admin only. */
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

/** Tyre records list — all roles with operational access. */
export function canViewRecords(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || role === 'tyre_man' || role === 'reporter' || isAdminOrAbove(role)
}

/** Can edit tyre records inline (admin and manager). */
export function canEditRecords(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'manager'
}

/** Fleet analytics — management roles only. */
export function canViewAnalytics(role: UserRole | null | undefined): boolean {
  return isAdminOrAbove(role)
}

/** Corrective actions / work orders — field staff + management. */
export function canViewWorkOrders(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || role === 'tyre_man' || isAdminOrAbove(role)
}

/** Can update work order status. */
export function canUpdateWorkOrders(role: UserRole | null | undefined): boolean {
  return role === 'inspector' || role === 'tyre_man' || isAdminOrAbove(role)
}

/** PDF report generation — management + reporter. */
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
}

export const TAB_BAR: TabDescriptor[] = [
  {
    name: 'index',
    labelKey: 'tabs.home',
    icon: 'home-outline',
    visible: () => true,
  },
  {
    name: 'inspection/new',
    labelKey: 'tabs.inspect',
    icon: 'clipboard-outline',
    visible: canInspect,
  },
  {
    name: 'records/index',
    labelKey: 'tabs.records',
    icon: 'layers-outline',
    visible: canViewRecords,
  },
  {
    name: 'accident/dashboard',
    labelKey: 'tabs.accident',
    icon: 'warning-outline',
    activeTint: '#dc2626',
    visible: canViewAccidents,
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
  },
]
