import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_approvals_screen.dart';

import 'admin_test_support.dart';

void main() {
  testWidgets('switches between the two existing queues', (
    WidgetTester tester,
  ) async {
    await pumpAdmin(
      tester,
      AdminApprovalsScreen(
        route: const AdminApprovalsRoute(),
        inspectionsBuilder: (_) => const Text('inspection queue'),
        checklistsBuilder: (_) => const Text('checklist queue'),
      ),
      repository: FakeAdminRepository(),
    );

    expect(find.text('inspection queue'), findsOneWidget);
    expect(find.text('checklist queue', skipOffstage: true), findsNothing);

    await tester.tap(find.text('Checklists'));
    await tester.pumpAndSettle();
    expect(find.text('checklist queue'), findsOneWidget);
    expect(find.text('inspection queue'), findsNothing);
  });
}
