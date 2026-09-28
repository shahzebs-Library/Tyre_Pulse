import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_hub_screen.dart';

import 'admin_test_support.dart';

GoRouter _router() => GoRouter(
      initialLocation: '/admin',
      routes: <RouteBase>[
        GoRoute(
          path: '/admin',
          builder: (_, __) => const AdminHubScreen(route: AdminConsoleRoute()),
          routes: <RouteBase>[
            GoRoute(
              path: 'users',
              builder: (_, __) => const Scaffold(body: Text('users page')),
            ),
          ],
        ),
      ],
    );

void main() {
  testWidgets('shows live counts and navigates to users', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo = FakeAdminRepository();
    await pumpAdmin(
      tester,
      const SizedBox(),
      repository: repo,
      router: _router(),
    );

    expect(find.text('Admin console'), findsOneWidget);
    // 3 inspections + 2 checklists.
    expect(find.text('5'), findsNWidgets(2)); // stat card + tile badge
    expect(find.text('Mobile access'), findsOneWidget);

    await tester.tap(find.byKey(const Key('admin.hub.users')));
    await tester.pumpAndSettle();
    expect(find.text('users page'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'a failed count is unavailable, not zero; no access tile for '
      'a plain admin', (WidgetTester tester) async {
    final FakeAdminRepository repo = FakeAdminRepository()
      ..countError = Exception('rls');
    await pumpAdmin(
      tester,
      const SizedBox(),
      repository: repo,
      access: plainAdmin,
      router: _router(),
    );

    expect(find.text('Could not load'), findsOneWidget);
    expect(find.byType(TpStatCard), findsNWidgets(3));
    expect(find.byKey(const Key('admin.hub.access')), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
