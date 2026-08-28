library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/alerts/alerts_screen_registrations.dart';
import 'package:tyre_pulse/features/alerts/presentation/alerts_screen.dart';

void main() {
  test('registers only AlertsRoute', () {
    expect(alertsScreenRegistrations.keys, <String>[TpRouteId.alerts]);
  });

  testWidgets('registered builder returns the implemented Alerts screen', (
    WidgetTester tester,
  ) async {
    final TpScreenBuilder builder =
        alertsScreenRegistrations[TpRouteId.alerts]!;
    late final Widget built;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          built = builder(context, const AlertsRoute());
          return const SizedBox.shrink();
        },
      ),
    );

    expect(built, isA<AlertsScreen>());
    expect((built as AlertsScreen).backFallback, isNotEmpty);
  });
}
