/// The route guard registry: one ordered table mapping every route to what it
/// requires, and the narrow interface that answers whether the current user
/// has it.
///
/// Artifact 03 section 5.4: the production app already contains this idea, in
/// `mobile/lib/routeAccess.ts`, written because "the tab bar's href:null only
/// hides a tab, it does NOT block a router.push() or a cold deep link". It has
/// ZERO consumers. The path-based guard the app documents does not run.
///
/// Here it runs. It is the table the router builds guards from, so hiding a tab
/// and blocking a route are two views of one fact.
///
/// THREE DIVERGENCES FROM THE PRODUCTION REGISTRY ARE FIXED HERE. Each one
/// LOOSENED access, which is why they had to be reconciled before the table
/// could be made live (artifact 03 section 5.4):
///
/// | Route          | routeAccess.ts said | The screen enforced | Taken here  |
/// |----------------|---------------------|---------------------|-------------|
/// | admin/approvals| module `approvals`  | admin only          | admin only  |
/// | admin/access   | module `users`      | super admin only    | super admin |
/// | admin/ai-chat  | module `ai`         | module `admin`      | `admin`     |
/// | repair-request | no rule at all      | module `repairRequest` | that module |
///
/// The production registry's `stockManage` rule is dropped: no screen file
/// exists for it, so it was a rule about nothing.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/routes.dart';

/// The module a route requires, named from the ROUTE side.
///
/// Deliberately NOT the permissions layer's own `ModuleKey` enum, and
/// deliberately not called `ModuleKey` either - two types with one name in one
/// application is a trap. This layer states what a route NEEDS; the permissions
/// layer decides who HAS it. Coupling the router to that enum would make the
/// navigation table recompile every time the permission model moved.
///
/// [value] is the wire key, so the adapter between the two is one line:
/// `ModuleKey.values.byName(routeModule.value)`. Every constant below matches a
/// `ModuleKey` enum name exactly, which is what makes that lookup total.
@immutable
final class RouteModule {
  const RouteModule(this.value);

  /// The wire key. These are the names behind the `mobile:`-prefixed rows in
  /// the `module_permissions` table.
  final String value;

  // --- Field work ---
  static const RouteModule inspect = RouteModule('inspect');
  static const RouteModule scan = RouteModule('scan');
  static const RouteModule serial = RouteModule('serial');
  static const RouteModule tyreChange = RouteModule('tyreChange');
  static const RouteModule checklists = RouteModule('checklists');
  static const RouteModule meter = RouteModule('meter');
  static const RouteModule washing = RouteModule('washing');
  static const RouteModule reportIssue = RouteModule('reportIssue');
  static const RouteModule repairRequest = RouteModule('repairRequest');

  // --- Fleet ---
  static const RouteModule records = RouteModule('records');
  static const RouteModule vehicles = RouteModule('vehicles');
  static const RouteModule history = RouteModule('history');
  static const RouteModule alerts = RouteModule('alerts');
  static const RouteModule calendar = RouteModule('calendar');

  // --- Maintenance ---
  static const RouteModule accidents = RouteModule('accidents');
  static const RouteModule reportAccident = RouteModule('reportAccident');
  static const RouteModule workorders = RouteModule('workorders');
  static const RouteModule workshop = RouteModule('workshop');
  static const RouteModule pm = RouteModule('pm');
  static const RouteModule tasks = RouteModule('tasks');
  static const RouteModule rca = RouteModule('rca');
  static const RouteModule stock = RouteModule('stock');

  // --- Management ---
  static const RouteModule overview = RouteModule('overview');
  static const RouteModule reports = RouteModule('reports');
  static const RouteModule analytics = RouteModule('analytics');
  static const RouteModule ai = RouteModule('ai');
  static const RouteModule team = RouteModule('team');

  // --- Admin ---
  static const RouteModule approvals = RouteModule('approvals');
  static const RouteModule admin = RouteModule('admin');
  static const RouteModule users = RouteModule('users');

  /// The modules that FAIL CLOSED when permissions cannot be read.
  ///
  /// Ported verbatim from the production `SENSITIVE_MODULES`. Everything else
  /// fails open, and the asymmetry is deliberate: a transient permission
  /// lookup failure must never strand a field worker mid shift, but it must
  /// never hand a non-admin a user management console either.
  static const Set<RouteModule> sensitive = <RouteModule>{
    admin,
    users,
    approvals,
  };

  @override
  bool operator ==(Object other) =>
      identical(this, other) || (other is RouteModule && other.value == value);

  @override
  int get hashCode => value.hashCode;

  @override
  String toString() => value;
}

/// What a route requires.
@immutable
sealed class RouteGuard {
  const RouteGuard();
}

/// Reachable without a session at all: sign in, register, the boot decider.
final class PublicRoute extends RouteGuard {
  const PublicRoute();
}

/// Needs a session and nothing more.
///
/// An UNMAPPED route resolves to this, never to a gated module. A screen
/// somebody forgot to add to the table must not become a hole that silently
/// grants access it should not have.
final class AuthenticatedOnly extends RouteGuard {
  const AuthenticatedOnly();
}

/// Needs a module.
final class ModuleGuarded extends RouteGuard {
  const ModuleGuarded(this.module);

  final RouteModule module;
}

/// Stricter than any module can express.
///
/// The production `admin/approvals` screen uses this rather than the
/// `approvals` module, because that module admits manager and director and
/// using it there would LOOSEN an admin gate.
final class AdminOnly extends RouteGuard {
  const AdminOnly();
}

/// The platform owner only. The Access Manager.
final class SuperAdminOnly extends RouteGuard {
  const SuperAdminOnly();
}

/// The guard for every route, by route id.
abstract final class TpRouteGuards {
  static const Map<String, RouteGuard> byRouteId = <String, RouteGuard>{
    // Root and authentication.
    TpRouteId.boot: PublicRoute(),
    TpRouteId.login: PublicRoute(),
    TpRouteId.register: PublicRoute(),

    // Authenticated with no module. All three are explicit in production.
    TpRouteId.home: AuthenticatedOnly(),
    TpRouteId.notifications: AuthenticatedOnly(),
    TpRouteId.profile: AuthenticatedOnly(),

    // Field work.
    TpRouteId.newInspection: ModuleGuarded(RouteModule.inspect),
    TpRouteId.scanner: ModuleGuarded(RouteModule.scan),
    TpRouteId.serialSearch: ModuleGuarded(RouteModule.serial),
    TpRouteId.tyreChange: ModuleGuarded(RouteModule.tyreChange),
    TpRouteId.meterLog: ModuleGuarded(RouteModule.meter),
    TpRouteId.washing: ModuleGuarded(RouteModule.washing),
    TpRouteId.reportIssue: ModuleGuarded(RouteModule.reportIssue),
    TpRouteId.repairRequest: ModuleGuarded(RouteModule.repairRequest),

    // Checklists.
    TpRouteId.checklists: ModuleGuarded(RouteModule.checklists),
    TpRouteId.checklistFill: ModuleGuarded(RouteModule.checklists),
    TpRouteId.checklistHistory: ModuleGuarded(RouteModule.checklists),

    // Approvals. All four queues and reviews.
    TpRouteId.inspectionApprovals: ModuleGuarded(RouteModule.approvals),
    TpRouteId.inspectionApprovalReview: ModuleGuarded(RouteModule.approvals),
    TpRouteId.checklistApprovals: ModuleGuarded(RouteModule.approvals),
    TpRouteId.checklistApprovalReview: ModuleGuarded(RouteModule.approvals),

    // Fleet and records.
    TpRouteId.tyreRecords: ModuleGuarded(RouteModule.records),
    TpRouteId.vehicles: ModuleGuarded(RouteModule.vehicles),
    TpRouteId.activityHistory: ModuleGuarded(RouteModule.history),
    // An inspection detail is an inspection, not a history entry. Production
    // gates it on `inspect`.
    TpRouteId.inspectionDetail: ModuleGuarded(RouteModule.inspect),
    TpRouteId.alerts: ModuleGuarded(RouteModule.alerts),
    TpRouteId.calendar: ModuleGuarded(RouteModule.calendar),

    // Accidents. Filing one is a separate module from reading the register.
    TpRouteId.accidentDashboard: ModuleGuarded(RouteModule.accidents),
    TpRouteId.accidentDetail: ModuleGuarded(RouteModule.accidents),
    TpRouteId.accidentCase: ModuleGuarded(RouteModule.accidents),
    TpRouteId.accidentReport: ModuleGuarded(RouteModule.reportAccident),

    // Maintenance and workshop.
    TpRouteId.workOrders: ModuleGuarded(RouteModule.workorders),
    TpRouteId.workOrderDetail: ModuleGuarded(RouteModule.workorders),
    TpRouteId.workshop: ModuleGuarded(RouteModule.workshop),
    TpRouteId.preventiveMaintenance: ModuleGuarded(RouteModule.pm),
    TpRouteId.tasks: ModuleGuarded(RouteModule.tasks),
    TpRouteId.rca: ModuleGuarded(RouteModule.rca),
    TpRouteId.stockCount: ModuleGuarded(RouteModule.stock),

    // Management.
    TpRouteId.overview: ModuleGuarded(RouteModule.overview),
    TpRouteId.reports: ModuleGuarded(RouteModule.reports),
    TpRouteId.analytics: ModuleGuarded(RouteModule.analytics),
    TpRouteId.fleetAi: ModuleGuarded(RouteModule.ai),
    TpRouteId.team: ModuleGuarded(RouteModule.team),

    // Admin. See the divergence table in the library comment.
    TpRouteId.adminConsole: ModuleGuarded(RouteModule.admin),
    TpRouteId.adminUsers: ModuleGuarded(RouteModule.users),
    TpRouteId.adminSites: ModuleGuarded(RouteModule.admin),
    TpRouteId.adminAiChat: ModuleGuarded(RouteModule.admin),
    TpRouteId.adminApprovals: AdminOnly(),
    TpRouteId.adminAccess: SuperAdminOnly(),
  };

  /// The guard for [routeId].
  ///
  /// An unknown route is [AuthenticatedOnly]: a session is still required, but
  /// a route nobody mapped never silently becomes an open door.
  static RouteGuard forRouteId(String routeId) =>
      byRouteId[routeId] ?? const AuthenticatedOnly();
}

// ---------------------------------------------------------------------------
// The narrow permission interface
// ---------------------------------------------------------------------------

/// Why access was refused. The UI turns this into a sentence, so a refusal can
/// always explain itself.
enum ModuleDenialReason {
  /// The user simply does not hold this module.
  notGranted,

  /// The screen is administrators only.
  adminOnly,

  /// The screen is the platform owner only.
  superAdminOnly,

  /// The permission lookup itself failed and this module fails closed.
  permissionsUnavailable,
}

/// The answer to "may this user open this route".
@immutable
sealed class ModuleAccessDecision {
  const ModuleAccessDecision();
}

final class ModuleAccessAllowed extends ModuleAccessDecision {
  const ModuleAccessAllowed();
}

/// Permissions are still being read.
///
/// A real, temporary state - and the ONLY one of the three that may render a
/// spinner. It must be reachable only while a lookup is genuinely in flight,
/// never as a resting state, or it becomes the permanent spinner the product
/// owner reported as "I feel is spinner but in actual no access".
final class ModuleAccessResolving extends ModuleAccessDecision {
  const ModuleAccessResolving();
}

final class ModuleAccessDenied extends ModuleAccessDecision {
  const ModuleAccessDenied(this.reason);

  final ModuleDenialReason reason;
}

/// Answers whether the current user satisfies a [RouteGuard].
///
/// The narrow surface this navigation layer needs from the permissions layer.
/// The real implementation - effective access as role default plus grants minus
/// revocations, per spec section 9 - belongs to `lib/core/permissions/` and is
/// wired in by overriding [moduleAccessResolverProvider].
abstract interface class ModuleAccessResolver {
  ModuleAccessDecision decide(RouteGuard guard);
}

/// The resolver used until the permissions layer overrides it.
///
/// It does NOT allow everything. It models the state it is actually in -
/// permissions are unavailable - and applies the production rule for that
/// state: sensitive modules fail closed, everything else fails open. That is
/// the same asymmetry `resolveGuardedAccess` uses when the permission RPC
/// fails, so the placeholder behaves like the real thing having a bad day
/// rather than like a bypass.
class PermissionsUnavailableResolver implements ModuleAccessResolver {
  const PermissionsUnavailableResolver();

  @override
  ModuleAccessDecision decide(RouteGuard guard) {
    return switch (guard) {
      PublicRoute() => const ModuleAccessAllowed(),
      AuthenticatedOnly() => const ModuleAccessAllowed(),
      ModuleGuarded(module: final RouteModule module) =>
        RouteModule.sensitive.contains(module)
            ? const ModuleAccessDenied(
                ModuleDenialReason.permissionsUnavailable,
              )
            : const ModuleAccessAllowed(),
      AdminOnly() =>
        const ModuleAccessDenied(ModuleDenialReason.permissionsUnavailable),
      SuperAdminOnly() =>
        const ModuleAccessDenied(ModuleDenialReason.permissionsUnavailable),
    };
  }
}

/// Override this from the permissions layer.
final Provider<ModuleAccessResolver> moduleAccessResolverProvider =
    Provider<ModuleAccessResolver>(
  (ref) => const PermissionsUnavailableResolver(),
);
