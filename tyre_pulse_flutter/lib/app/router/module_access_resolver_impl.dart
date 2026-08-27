/// The real [ModuleAccessResolver] - the module a route needs, decided
/// against the actual signed-in [AccessState].
///
/// # The gap this file closes
///
/// `moduleAccessResolverProvider`'s own doc comment in `route_access.dart`
/// says "Override this from the permissions layer." Nothing ever did.
/// `app_shell.dart`'s tab bar and `module_guard.dart`'s `TpModuleGuard` -
/// used by `vehicle_detail_screen.dart`, `vehicles_list_screen.dart` and
/// `serial_search_screen.dart` - both read [moduleAccessResolverProvider]
/// directly, so with no override every one of them ran on the fallback
/// [PermissionsUnavailableResolver] for the entire life of a signed-in
/// session: fail OPEN for every non-sensitive [ModuleGuarded] route
/// regardless of the signed-in user's actual role, and fail CLOSED,
/// UNCONDITIONALLY, for the three sensitive ones (`admin`, `users`,
/// `approvals`) - even for a genuine super-admin, because that fallback has
/// no [AccessState] to consult at all.
///
/// That is a second, independent decision engine running in parallel with
/// `core/permissions/access_resolver.dart`'s real [resolveModuleAccess],
/// which `home_screen.dart` and every other module-gated screen body
/// already consult via [canAccessModuleProvider]. Two resolvers that can
/// disagree is exactly how a tab can appear reachable on the bar while the
/// screen it leads to renders its own, differently-computed refusal - or,
/// as here, how the bar and every `TpModuleGuard`-wrapped screen could
/// admit a role the real resolver would deny, while permanently locking
/// every user, including the platform's own super-admin, out of the
/// Approvals tab and the Admin Console.
///
/// This resolver is the missing bridge: it holds the exact [AccessState] and
/// [AdminRevokePrecedence] `permission_providers.dart` already resolves, and
/// answers every [RouteGuard] by delegating to [resolveModuleAccess] for the
/// one case that is not already a permission a `RouteGuard` states outright
/// ([PublicRoute], [AuthenticatedOnly], [AdminOnly], [SuperAdminOnly]).
/// Override [moduleAccessResolverProvider] with it at the composition root;
/// see `main.dart`.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';

/// [ModuleAccessResolver] over the real, signed-in [AccessState].
///
/// A `switch` over the sealed [RouteGuard] hierarchy - covering every
/// existing subtype explicitly rather than falling through to a default -
/// so a future [RouteGuard] variant fails to compile here instead of
/// silently inheriting whatever the last branch happened to do.
final class RealModuleAccessResolver implements ModuleAccessResolver {
  const RealModuleAccessResolver(this._access, this._precedence);

  final AccessState _access;
  final AdminRevokePrecedence _precedence;

  @override
  ModuleAccessDecision decide(RouteGuard guard) {
    return switch (guard) {
      PublicRoute() => const ModuleAccessAllowed(),
      // By construction, both consumers of this resolver reach it only after
      // a signed-in, gate-clear session: `app_shell.dart`'s own five
      // full-screen gates run BEFORE the tab bar or any branch route is
      // built, and every `TpModuleGuard` this application registers sits
      // inside that same shell. There is nothing further for this guard to
      // decide - matching `PermissionsUnavailableResolver`'s identical
      // answer for this one guard, so this override changes nothing about
      // it.
      AuthenticatedOnly() => const ModuleAccessAllowed(),
      ModuleGuarded(module: final RouteModule module) => _decideModule(module),
      AdminOnly() => _isAdminOrAbove
          ? const ModuleAccessAllowed()
          : const ModuleAccessDenied(ModuleDenialReason.adminOnly),
      SuperAdminOnly() => _access.isSuperAdmin
          ? const ModuleAccessAllowed()
          : const ModuleAccessDenied(ModuleDenialReason.superAdminOnly),
    };
  }

  /// [AdminOnly] is deliberately stricter than routing a bare `admin`
  /// [ModuleGuarded] through [resolveModuleAccess] would be - see
  /// `route_access.dart`'s own library comment on why `admin/approvals`
  /// uses this guard rather than the `approvals` module: using the module
  /// there would loosen an admin-only gate to admit every role the
  /// `approvals` module's own role default lists.
  bool get _isAdminOrAbove => _access.isSuperAdmin || _access.role.isAdministrator;

  ModuleAccessDecision _decideModule(RouteModule module) {
    // `RouteModule.value` and `ModuleKey.wireKey` share one string space by
    // construction - `route_access.dart`'s own comment states the adapter is
    // exactly this lookup, and every `RouteModule` constant name matches a
    // `ModuleKey` enum value name so the lookup is total for every module
    // this file's own registry actually declares a route for. An unmapped
    // value would be a real configuration gap - a route wired to a module
    // string this app version's registry does not carry - and denying it,
    // rather than defaulting to an allow, matches the same posture
    // `TpRouteGuards.forRouteId` already takes for an unmapped ROUTE: never
    // let a gap read as an open door.
    final ModuleKey? key = moduleKeyFromWireKey(module.value);
    if (key == null) {
      return const ModuleAccessDenied(ModuleDenialReason.notGranted);
    }

    final AccessDecision decision = resolveModuleAccess(
      module: key,
      access: _access,
      precedence: _precedence,
    );
    if (decision.isAllowed) {
      return const ModuleAccessAllowed();
    }
    // Every [AccessReason] denial EXCEPT `permissionDataUnavailable` is a
    // real "you do not hold this" answer - role default excluded, per-user
    // revoked, role-matrix disabled, role unrecognised, or the module
    // itself being admin-only (which [AdminOnly] and [SuperAdminOnly]
    // express as their own guards, not through here). Only the permission
    // DATA being untrustworthy deserves the distinct "we could not tell"
    // wording [ModuleDenialReason.permissionsUnavailable] carries.
    return decision.reason == AccessReason.permissionDataUnavailable
        ? const ModuleAccessDenied(ModuleDenialReason.permissionsUnavailable)
        : const ModuleAccessDenied(ModuleDenialReason.notGranted);
  }
}

/// Builds a [RealModuleAccessResolver] from the same two providers
/// `permission_providers.dart` already exposes, so a workspace or precedence
/// change invalidates the resolver exactly when it invalidates every other
/// module decision in the app.
final Provider<ModuleAccessResolver> realModuleAccessResolverProvider =
    Provider<ModuleAccessResolver>(
  (ref) => RealModuleAccessResolver(
    ref.watch(accessStateProvider),
    ref.watch(adminRevokePrecedenceProvider),
  ),
);
