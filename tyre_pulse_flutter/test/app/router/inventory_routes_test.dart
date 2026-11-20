// Inventory deep links (docs/inventory_reserved_patch.md section 1).
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';

void main() {
  const String id = '0b8a4c1e-2f3d-4a5b-9c6d-7e8f9a0b1c2d';

  test('a uuid audit id parses to the blind count of that audit', () {
    final TpRoute r = InventoryCountRoute.parse(
      const TpRouteParameters(path: <String, String>{'auditId': id}),
    );
    expect(r, isA<InventoryCountRoute>());
    expect((r as InventoryCountRoute).auditId, id);
    expect(r.location, '/stock/counts/$id');
  });

  test('anything else falls back to the audit list, never a count', () {
    for (final String bad in <String>[
      '',
      'not-a-uuid',
      'counts',
      "1' or 1=1",
    ]) {
      final TpRoute r = InventoryCountRoute.parse(
        TpRouteParameters(path: <String, String>{'auditId': bad}),
      );
      expect(r, isA<InventoryAuditsRoute>(), reason: bad);
    }
    expect(
      InventoryCountRoute.parse(const TpRouteParameters()),
      isA<InventoryAuditsRoute>(),
    );
  });

  test('the routes nest under /stock', () {
    expect(const InventoryAuditsRoute().location, '/stock/counts');
    expect(const InventoryTransfersRoute().location, '/stock/transfers');
  });

  test('all three are guarded by the stock module, like Stock Count', () {
    for (final String routeId in <String>[
      TpRouteId.inventoryAudits,
      TpRouteId.inventoryCount,
      TpRouteId.inventoryTransfers,
    ]) {
      final RouteGuard guard = TpRouteGuards.forRouteId(routeId);
      expect(guard, isA<ModuleGuarded>(), reason: routeId);
      expect((guard as ModuleGuarded).module, RouteModule.stock);
    }
  });
}
