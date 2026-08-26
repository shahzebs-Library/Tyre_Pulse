/// This feature's contribution to the application-wide screen registry.
///
/// `records_screen_registrations.dart`'s own library comment explains why a
/// registry exists at all - so the router never has to import the feature
/// directly. What this file proves is the feature's half of that contract:
/// it registers exactly the one route it owns, the builder it registers
/// produces the register screen (not a placeholder, not something else's
/// screen), and merging its map into a larger registry never drops or
/// clobbers an entry that was already there.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/records/presentation/tyre_records_list_screen.dart';
import 'package:tyre_pulse/features/records/records_screen_registrations.dart';

void main() {
  test('registers exactly the tyre records route, and nothing else', () {
    expect(recordsScreenRegistrations.keys.toList(), <String>[
      TpRouteId.tyreRecords,
    ]);
  });

  testWidgets(
    'the registered builder produces the register screen for its route',
    (WidgetTester tester) async {
      final TpScreenBuilder builder =
          recordsScreenRegistrations[TpRouteId.tyreRecords]!;
      const TyreRecordsRoute route = TyreRecordsRoute();

      late final Widget built;
      await tester.pumpWidget(
        Builder(
          builder: (BuildContext context) {
            built = builder(context, route);
            return const SizedBox.shrink();
          },
        ),
      );

      expect(built, isA<TyreRecordsListScreen>());
      expect(
        (built as TyreRecordsListScreen).backFallback,
        isNotEmpty,
        reason: 'a route with no fallback would leave Back with nowhere '
            'to go if this screen is ever reached with an empty stack',
      );
    },
  );

  test(
      'merges cleanly into a larger registry without dropping or '
      'overwriting an entry that was already there', () {
    const String otherRouteId = 'someOtherFeatureRoute';
    final TpScreenRegistry base = TpScreenRegistry.empty.withAll(
      <String, TpScreenBuilder>{
        otherRouteId: (BuildContext context, TpRoute route) =>
            const SizedBox.shrink(),
      },
    );

    final TpScreenRegistry merged = base.withAll(recordsScreenRegistrations);

    expect(merged.builders.containsKey(otherRouteId), isTrue);
    expect(merged.builders.containsKey(TpRouteId.tyreRecords), isTrue);
    expect(merged.builders.length, 2);
  });
}
