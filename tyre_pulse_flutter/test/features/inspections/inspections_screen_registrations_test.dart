library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/inspections/inspections_screen_registrations.dart';
import 'package:tyre_pulse/features/inspections/presentation/inspection_detail_screen.dart';
import 'package:tyre_pulse/features/inspections/presentation/inspection_history_screen.dart';
import 'package:tyre_pulse/features/inspections/presentation/new_inspection_screen.dart';

void main() {
  test('registers capture, detail, and the real activity-history route', () {
    expect(inspectionsScreenRegistrations.keys, <String>[
      TpRouteId.newInspection,
      TpRouteId.inspectionDetail,
      TpRouteId.activityHistory,
    ]);
  });

  testWidgets('every registered route builds its implemented screen', (
    WidgetTester tester,
  ) async {
    final Map<TpRoute, Type> cases = <TpRoute, Type>{
      const NewInspectionRoute(): NewInspectionScreen,
      const InspectionDetailRoute(
        inspectionId: InspectionId('inspection-1'),
      ): InspectionDetailScreen,
      const ActivityHistoryRoute(): InspectionHistoryScreen,
    };

    for (final MapEntry<TpRoute, Type> entry in cases.entries) {
      final TpScreenBuilder builder =
          inspectionsScreenRegistrations[entry.key.routeId]!;
      late final Widget built;
      await tester.pumpWidget(
        Builder(
          builder: (BuildContext context) {
            built = builder(context, entry.key);
            return const SizedBox.shrink();
          },
        ),
      );
      expect(built.runtimeType, entry.value);
    }
  });

  testWidgets('activity-history registration refuses the wrong route type', (
    WidgetTester tester,
  ) async {
    final TpScreenBuilder builder =
        inspectionsScreenRegistrations[TpRouteId.activityHistory]!;
    late final Widget built;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          built = builder(context, const HomeRoute());
          return const SizedBox.shrink();
        },
      ),
    );
    expect(built, isA<TpScreenNotAvailable>());
  });
}
