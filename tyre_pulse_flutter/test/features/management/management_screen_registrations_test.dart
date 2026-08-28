library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/management/management_screen_registrations.dart';
import 'package:tyre_pulse/features/management/presentation/management_screens.dart';

void main() {
  testWidgets('management registrations build their typed screens', (
    WidgetTester tester,
  ) async {
    late List<Widget> screens;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          screens = <Widget>[
            managementScreenRegistrations[TpRouteId.overview]!(
              context,
              const OverviewRoute(),
            ),
            managementScreenRegistrations[TpRouteId.analytics]!(
              context,
              const AnalyticsRoute(),
            ),
            managementScreenRegistrations[TpRouteId.reports]!(
              context,
              const ReportsRoute(),
            ),
            managementScreenRegistrations[TpRouteId.team]!(
              context,
              const TeamRoute(),
            ),
          ];
          return const SizedBox.shrink();
        },
      ),
    );
    expect(screens[0], isA<OverviewScreen>());
    expect(screens[1], isA<AnalyticsScreen>());
    expect(screens[2], isA<ReportsScreen>());
    expect(screens[3], isA<TeamScreen>());
  });

  testWidgets('management registration rejects the wrong route type', (
    WidgetTester tester,
  ) async {
    late Widget refused;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          refused = managementScreenRegistrations[TpRouteId.team]!(
            context,
            const HomeRoute(),
          );
          return const SizedBox.shrink();
        },
      ),
    );
    expect(refused, isA<TpScreenNotAvailable>());
  });
}
