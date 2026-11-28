// Pins the bottom bar per role after the 2026-11-28 release merge, so the
// owner's own (Admin) bar cannot quietly lose a tab again.
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/shell_tabs.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/inspection_signers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

List<String> _barFor(RoleId id, {bool superAdmin = false}) {
  final UserRole role = UserRole.known(id);
  final AccessState access = AccessState(role: role, isSuperAdmin: superAdmin);
  final TpShellTabLayout layout = resolveShellTabs(
    destinations: TpShell.destinations,
    // Every module open: the test is about the role policy, not the matrix.
    canAccess: (RouteGuard _) => true,
    preferredPrimary: preferredPrimaryTabsFor(role),
    canSignApprovals: canSignInspectionApprovals(access),
  );
  return <String>[for (final TpShellDestination d in layout.visible) d.routeId];
}

void main() {
  test('Admin (and super admin) keep the default bar with Approvals', () {
    for (final List<String> bar in <List<String>>[
      _barFor(RoleId.admin),
      _barFor(RoleId.admin, superAdmin: true),
    ]) {
      expect(bar.first, TpRouteId.home);
      expect(bar.last, TpRouteId.profile);
      expect(bar, contains(TpRouteId.newInspection));
      expect(bar, contains(TpRouteId.inspectionApprovals));
      expect(bar, contains(TpRouteId.accidentDashboard));
    }
  });

  test('Store Keeper has no preferred bar (default order)', () {
    expect(
      preferredPrimaryTabsFor(const UserRole.known(RoleId.storeKeeper)),
      isNull,
    );
  });

  test('owner-requested bars: Driver, Tyre Man, Tyre Data Collector', () {
    expect(_barFor(RoleId.driver), <String>[
      TpRouteId.home,
      TpRouteId.meterLog,
      TpRouteId.washing,
      TpRouteId.profile,
    ]);
    expect(_barFor(RoleId.tyreMan), <String>[
      TpRouteId.home,
      TpRouteId.newInspection,
      TpRouteId.checklists,
      TpRouteId.profile,
    ]);
    expect(_barFor(RoleId.tyreDataCollector), <String>[
      TpRouteId.home,
      TpRouteId.newInspection,
      TpRouteId.inspectionApprovals,
      TpRouteId.profile,
    ]);
  });
}
