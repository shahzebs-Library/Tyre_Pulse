/// The route guard registry.
///
/// Artifact 03 section 5.4 reconciled three divergences between
/// `mobile/lib/routeAccess.ts` and what the screens actually enforce, and every
/// one of them LOOSENED access. Those three are pinned here by name, because a
/// loosening is invisible in review: the table still looks like a table.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';

void main() {
  group('the reconciled divergences', () {
    test('admin approvals is admin only, NOT the approvals module', () {
      // The approvals module admits manager and director. Using it here would
      // loosen an admin gate.
      expect(
        TpRouteGuards.forRouteId(TpRouteId.adminApprovals),
        isA<AdminOnly>(),
      );
    });

    test('the access manager is super admin only, NOT the users module', () {
      expect(
        TpRouteGuards.forRouteId(TpRouteId.adminAccess),
        isA<SuperAdminOnly>(),
      );
    });

    test('admin ai chat requires admin, NOT the grantable ai module', () {
      final RouteGuard guard = TpRouteGuards.forRouteId(TpRouteId.adminAiChat);
      expect(guard, isA<ModuleGuarded>());
      expect((guard as ModuleGuarded).module, RouteModule.admin);
    });

    test('repair request has a rule at all', () {
      // The production registry has no rule for this route, so it fell through
      // to authenticated-only while the screen enforced a module.
      final RouteGuard guard = TpRouteGuards.forRouteId(
        TpRouteId.repairRequest,
      );
      expect(guard, isA<ModuleGuarded>());
      expect((guard as ModuleGuarded).module, RouteModule.repairRequest);
    });
  });

  group('coverage', () {
    test('an unmapped route is authenticated only, never a gated module', () {
      // A screen nobody remembered to map must not become a hole that silently
      // grants access it should not.
      expect(
        TpRouteGuards.forRouteId('a-route-that-does-not-exist'),
        isA<AuthenticatedOnly>(),
      );
    });

    test('the three public routes need no session', () {
      for (final String id in <String>[
        TpRouteId.boot,
        TpRouteId.login,
        TpRouteId.register,
      ]) {
        expect(TpRouteGuards.forRouteId(id), isA<PublicRoute>());
      }
    });

    test('exactly three routes are authenticated-only by design', () {
      // Home, notifications and profile. All three are explicit in the
      // production app; anything else being unguarded would be an omission.
      final List<String> authenticatedOnly = TpRouteGuards.byRouteId.entries
          .where(
            (MapEntry<String, RouteGuard> e) => e.value is AuthenticatedOnly,
          )
          .map((MapEntry<String, RouteGuard> e) => e.key)
          .toList();

      expect(authenticatedOnly.toSet(), <String>{
        TpRouteId.home,
        TpRouteId.notifications,
        TpRouteId.profile,
      });
    });

    test('filing an accident is a different module from reading them', () {
      expect(
        (TpRouteGuards.forRouteId(
          TpRouteId.accidentReport,
        ) as ModuleGuarded)
            .module,
        RouteModule.reportAccident,
      );
      expect(
        (TpRouteGuards.forRouteId(
          TpRouteId.accidentDashboard,
        ) as ModuleGuarded)
            .module,
        RouteModule.accidents,
      );
    });

    test('an inspection detail is gated on inspect, not on history', () {
      expect(
        (TpRouteGuards.forRouteId(
          TpRouteId.inspectionDetail,
        ) as ModuleGuarded)
            .module,
        RouteModule.inspect,
      );
    });

    test('all four approval routes share one module', () {
      for (final String id in <String>[
        TpRouteId.inspectionApprovals,
        TpRouteId.inspectionApprovalReview,
        TpRouteId.checklistApprovals,
        TpRouteId.checklistApprovalReview,
      ]) {
        expect(
          (TpRouteGuards.forRouteId(id) as ModuleGuarded).module,
          RouteModule.approvals,
        );
      }
    });
  });

  group('the default resolver', () {
    // It models "permissions are unavailable" and applies the production rule
    // for that state, rather than allowing everything.
    const PermissionsUnavailableResolver resolver =
        PermissionsUnavailableResolver();

    test('sensitive modules fail CLOSED', () {
      for (final RouteModule module in RouteModule.sensitive) {
        final ModuleAccessDecision decision = resolver.decide(
          ModuleGuarded(module),
        );
        expect(decision, isA<ModuleAccessDenied>());
        expect(
          (decision as ModuleAccessDenied).reason,
          ModuleDenialReason.permissionsUnavailable,
        );
      }
    });

    test('field work fails OPEN', () {
      // The asymmetry is deliberate: a transient permission failure must never
      // strand a field worker mid shift.
      for (final RouteModule module in <RouteModule>[
        RouteModule.inspect,
        RouteModule.meter,
        RouteModule.washing,
        RouteModule.checklists,
        RouteModule.scan,
      ]) {
        expect(
          resolver.decide(ModuleGuarded(module)),
          isA<ModuleAccessAllowed>(),
        );
      }
    });

    test('admin and super admin gates fail CLOSED', () {
      expect(resolver.decide(const AdminOnly()), isA<ModuleAccessDenied>());
      expect(
        resolver.decide(const SuperAdminOnly()),
        isA<ModuleAccessDenied>(),
      );
    });

    test('a refusal always carries a reason', () {
      // There is no constructor for a refusal without one, and this asserts
      // the resolver never produces one by another route.
      for (final RouteGuard guard in <RouteGuard>[
        const AdminOnly(),
        const SuperAdminOnly(),
        const ModuleGuarded(RouteModule.admin),
      ]) {
        final ModuleAccessDecision decision = resolver.decide(guard);
        expect(decision, isA<ModuleAccessDenied>());
        expect((decision as ModuleAccessDenied).reason, isNotNull);
      }
    });
  });

  group('module keys', () {
    test('compare by value', () {
      expect(const RouteModule('inspect'), RouteModule.inspect);
      expect(
        const RouteModule('inspect').hashCode,
        RouteModule.inspect.hashCode,
      );
      expect(RouteModule.inspect, isNot(RouteModule.admin));
    });

    test('the sensitive set is exactly the production one', () {
      expect(RouteModule.sensitive, <RouteModule>{
        RouteModule.admin,
        RouteModule.users,
        RouteModule.approvals,
      });
    });
  });
}
