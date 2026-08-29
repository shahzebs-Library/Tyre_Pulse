/// [RealModuleAccessResolver] - the bridge from [RouteGuard] onto
/// [resolveModuleAccess].
///
/// # What this guards against
///
/// Before this resolver existed, `moduleAccessResolverProvider` was never
/// overridden anywhere, so every consumer (`app_shell.dart`'s tab bar,
/// every `TpModuleGuard`) ran on the fallback `PermissionsUnavailableResolver`
/// permanently: fail-open for every non-sensitive module regardless of
/// role, fail-closed unconditionally for the three sensitive ones even for
/// a genuine super-admin. These tests pin the REAL behaviour this resolver
/// now provides instead - one decision engine, not two that can disagree.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/module_access_resolver_impl.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

const AccessState _admin = AccessState(role: UserRole.known(RoleId.admin));
const AccessState _superAdmin = AccessState(
  role: UserRole.known(RoleId.reporter),
  isSuperAdmin: true,
);
const AccessState _reporter = AccessState(
  role: UserRole.known(RoleId.reporter),
);
const AccessState _tyreMan = AccessState(role: UserRole.known(RoleId.tyreMan));
const AccessState _permissionsUnavailable = AccessState(
  role: UserRole.known(RoleId.reporter),
  permissionsError: true,
);

RealModuleAccessResolver _resolverFor(AccessState access) =>
    RealModuleAccessResolver(access, AdminRevokePrecedence.serverAppUserCan);

void main() {
  group('PublicRoute and AuthenticatedOnly are unconditional', () {
    test('PublicRoute is allowed with no identity at all', () {
      const AccessState noRole = AccessState(role: UserRole.absent);
      expect(
        _resolverFor(noRole).decide(const PublicRoute()),
        isA<ModuleAccessAllowed>(),
      );
    });

    test('AuthenticatedOnly is allowed for any resolvable role', () {
      expect(
        _resolverFor(_reporter).decide(const AuthenticatedOnly()),
        isA<ModuleAccessAllowed>(),
      );
    });
  });

  group('ModuleGuarded delegates to resolveModuleAccess', () {
    test('the admin break-glass reaches an admin-only module', () {
      final ModuleAccessDecision decision =
          _resolverFor(_admin).decide(const ModuleGuarded(RouteModule.records));
      expect(decision, isA<ModuleAccessAllowed>());
    });

    test('super-admin reaches every module too', () {
      final ModuleAccessDecision decision = _resolverFor(
        _superAdmin,
      ).decide(const ModuleGuarded(RouteModule.records));
      expect(decision, isA<ModuleAccessAllowed>());
    });

    test(
        'a role with no default for the module is refused, not silently '
        'let through', () {
      // ModuleKey.records is admin-only; Reporter holds no role default and
      // no grant.
      final ModuleAccessDecision decision = _resolverFor(
        _reporter,
      ).decide(const ModuleGuarded(RouteModule.records));
      expect(decision, isA<ModuleAccessDenied>());
      expect(
        (decision as ModuleAccessDenied).reason,
        ModuleDenialReason.notGranted,
      );
    });

    test('a role that DOES hold the module by default is allowed', () {
      // ModuleKey.vehicles' role default includes tyreMan.
      final ModuleAccessDecision decision = _resolverFor(
        _tyreMan,
      ).decide(const ModuleGuarded(RouteModule.vehicles));
      expect(decision, isA<ModuleAccessAllowed>());
    });

    test(
        'a sensitive module with unreadable permission data fails closed '
        'with the distinct "unavailable" reason, not "not granted"', () {
      final ModuleAccessDecision decision = _resolverFor(
        _permissionsUnavailable,
      ).decide(const ModuleGuarded(RouteModule.approvals));
      expect(decision, isA<ModuleAccessDenied>());
      expect(
        (decision as ModuleAccessDenied).reason,
        ModuleDenialReason.permissionsUnavailable,
      );
    });

    test(
        'a non-sensitive module still fails open when permission data is '
        'unreadable, matching resolveModuleAccess\'s own asymmetry', () {
      final ModuleAccessDecision decision = _resolverFor(
        _permissionsUnavailable,
      ).decide(const ModuleGuarded(RouteModule.meter));
      expect(decision, isA<ModuleAccessAllowed>());
    });

    test(
        'a module string this app version does not recognise is refused, '
        'never silently allowed', () {
      final ModuleAccessDecision decision = _resolverFor(
        _admin,
      ).decide(const ModuleGuarded(RouteModule('not-a-real-module')));
      expect(decision, isA<ModuleAccessDenied>());
      expect(
        (decision as ModuleAccessDenied).reason,
        ModuleDenialReason.notGranted,
      );
    });
  });

  group('AdminOnly is stricter than the approvals module', () {
    test('the Admin role passes', () {
      expect(
        _resolverFor(_admin).decide(const AdminOnly()),
        isA<ModuleAccessAllowed>(),
      );
    });

    test('super-admin passes', () {
      expect(
        _resolverFor(_superAdmin).decide(const AdminOnly()),
        isA<ModuleAccessAllowed>(),
      );
    });

    test('a role the approvals module WOULD admit is still refused here', () {
      // Director holds the approvals module by default but is not the
      // hard Admin role - AdminOnly must refuse it, or admin/approvals
      // loosens exactly the way route_access.dart's own comment warns
      // against.
      const AccessState director = AccessState(
        role: UserRole.known(RoleId.director),
      );
      final ModuleAccessDecision decision =
          _resolverFor(director).decide(const AdminOnly());
      expect(decision, isA<ModuleAccessDenied>());
      expect(
        (decision as ModuleAccessDenied).reason,
        ModuleDenialReason.adminOnly,
      );
    });
  });

  group('SuperAdminOnly refuses even the Admin role', () {
    test('super-admin passes', () {
      expect(
        _resolverFor(_superAdmin).decide(const SuperAdminOnly()),
        isA<ModuleAccessAllowed>(),
      );
    });

    test('the plain Admin role is refused', () {
      final ModuleAccessDecision decision =
          _resolverFor(_admin).decide(const SuperAdminOnly());
      expect(decision, isA<ModuleAccessDenied>());
      expect(
        (decision as ModuleAccessDenied).reason,
        ModuleDenialReason.superAdminOnly,
      );
    });
  });
}
