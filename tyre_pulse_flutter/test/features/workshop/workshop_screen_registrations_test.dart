library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_screen.dart';
import 'package:tyre_pulse/features/workshop/workshop_screen_registrations.dart';

void main() {
  testWidgets('Workshop opens the implemented actionable job-card board', (
    WidgetTester tester,
  ) async {
    final TpScreenBuilder builder =
        workshopScreenRegistrations[TpRouteId.workshop]!;
    late Widget built;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          built = builder(context, const WorkshopRoute());
          return const SizedBox.shrink();
        },
      ),
    );
    expect(built, isA<WorkshopScreen>());
  });
}
