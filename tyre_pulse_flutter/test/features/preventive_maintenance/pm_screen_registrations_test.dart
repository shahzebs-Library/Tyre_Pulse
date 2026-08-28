library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/preventive_maintenance/pm_screen_registrations.dart';
import 'package:tyre_pulse/features/preventive_maintenance/presentation/pm_screen.dart';

void main() {
  testWidgets('PM registration accepts only the typed maintenance route', (
    WidgetTester tester,
  ) async {
    final TpScreenBuilder builder =
        pmScreenRegistrations[TpRouteId.preventiveMaintenance]!;
    late Widget screen;
    late Widget refused;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          screen = builder(context, const PreventiveMaintenanceRoute());
          refused = builder(context, const HomeRoute());
          return const SizedBox.shrink();
        },
      ),
    );
    expect(screen, isA<PreventiveMaintenanceScreen>());
    expect(refused, isA<TpScreenNotAvailable>());
  });
}
