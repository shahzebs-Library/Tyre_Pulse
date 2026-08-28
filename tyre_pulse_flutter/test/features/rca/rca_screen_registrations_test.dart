library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/rca/presentation/rca_screen.dart';
import 'package:tyre_pulse/features/rca/rca_screen_registrations.dart';

void main() {
  testWidgets('RCA registration accepts only the typed route', (
    WidgetTester tester,
  ) async {
    final TpScreenBuilder builder = rcaScreenRegistrations[TpRouteId.rca]!;
    late Widget screen;
    late Widget refused;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          screen = builder(context, const RcaRoute());
          refused = builder(context, const HomeRoute());
          return const SizedBox.shrink();
        },
      ),
    );
    expect(screen, isA<RcaScreen>());
    expect(refused, isA<TpScreenNotAvailable>());
  });
}
