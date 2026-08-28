library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/notifications/notifications_screen_registrations.dart';
import 'package:tyre_pulse/features/notifications/presentation/notifications_screen.dart';

void main() {
  test('registers the existing authenticated Notifications route', () {
    expect(notificationsScreenRegistrations.keys, <String>[
      TpRouteId.notifications,
    ]);
  });

  testWidgets('the registration builds the implemented inbox', (
    WidgetTester tester,
  ) async {
    final TpScreenBuilder builder =
        notificationsScreenRegistrations[TpRouteId.notifications]!;
    late Widget built;
    await tester.pumpWidget(
      Builder(
        builder: (BuildContext context) {
          built = builder(context, const NotificationsRoute());
          return const SizedBox.shrink();
        },
      ),
    );
    expect(built, isA<NotificationsScreen>());
  });
}
