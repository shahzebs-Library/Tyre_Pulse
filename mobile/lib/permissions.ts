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
    name: 'accident/dashboard',
    labelKey: 'tabs.accident',
    icon: 'warning-outline',
    activeTint: '#dc2626',
    visible: canViewAccidents,
  },
  {
    name: 'history',
    labelKey: 'tabs.history',
    icon: 'time-outline',
    visible: () => true,
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
