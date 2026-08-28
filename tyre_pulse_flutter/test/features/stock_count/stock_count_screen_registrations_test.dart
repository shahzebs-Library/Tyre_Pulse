library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/stock_count/presentation/stock_count_screen.dart';
import 'package:tyre_pulse/features/stock_count/stock_count_screen_registrations.dart';

void main() {
  testWidgets('stock registration accepts only StockCountRoute', (
    WidgetTester tester,
  ) async {
    final TpScreenBuilder builder =
        stockCountScreenRegistrations[TpRouteId.stockCount]!;
    late Widget screen;
    late Widget refused;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          screen = builder(context, const StockCountRoute());
          refused = builder(context, const HomeRoute());
          return const SizedBox.shrink();
        },
      ),
    );
    expect(screen, isA<StockCountScreen>());
    expect(refused, isA<TpScreenNotAvailable>());
  });
}
