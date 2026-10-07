import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/features/workshop_status/presentation/workshop_status_list_screen.dart';
import 'package:tyre_pulse/features/workshop_status/workshop_status_screen_registrations.dart';

void main() {
  testWidgets('Workshop Status opens the list screen', (
    WidgetTester tester,
  ) async {
    final TpScreenBuilder builder =
        workshopStatusScreenRegistrations[TpRouteId.workshopStatus]!;
    late Widget built;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          built = builder(context, const WorkshopStatusRoute());
          return const SizedBox.shrink();
        },
      ),
    );
    expect(built, isA<WorkshopStatusListScreen>());
  });

  test('the route is guarded by the workshopStatus module', () {
    final RouteGuard guard = TpRouteGuards.forRouteId(TpRouteId.workshopStatus);
    expect(guard, isA<ModuleGuarded>());
    final RouteModule module = (guard as ModuleGuarded).module;
    // The route-side name resolves to the permission layer's enum.
    expect(ModuleKey.values.byName(module.value), ModuleKey.workshopStatus);
    expect(const WorkshopStatusRoute().location, '/workshop-status');
  });

  test('the web composite key aliases to the phone module', () {
    expect(
      moduleKeyFromMobileAliasKey('mobile:daily_ops:workshop'),
      ModuleKey.workshopStatus,
    );
    // A bare web key (web-only scope) never reaches the phone.
    expect(moduleKeyFromMobileAliasKey('daily_ops:workshop'), isNull);
  });
}
