library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/calendar/calendar_screen_registrations.dart';
import 'package:tyre_pulse/features/calendar/presentation/calendar_screen.dart';

void main() {
  testWidgets('calendar registration accepts only CalendarRoute', (
    WidgetTester tester,
  ) async {
    final TpScreenBuilder builder =
        calendarScreenRegistrations[TpRouteId.calendar]!;
    late Widget screen;
    late Widget refused;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          screen = builder(context, const CalendarRoute());
          refused = builder(context, const HomeRoute());
          return const SizedBox.shrink();
        },
      ),
    );
    expect(screen, isA<CalendarScreen>());
    expect(refused, isA<TpScreenNotAvailable>());
  });
}
