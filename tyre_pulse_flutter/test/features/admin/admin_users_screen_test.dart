import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_users_screen.dart';

import 'admin_test_support.dart';

const Widget _screen = AdminUsersScreen(route: AdminUsersRoute());

void main() {
  testWidgets('lists users and filters by search and status', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo =
        FakeAdminRepository(users: <AdminUser>[alice, bilal]);
    await pumpAdmin(tester, _screen, repository: repo);

    expect(find.text('Alice Noor'), findsOneWidget);
    expect(find.text('Bilal Khan'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'bil');
    await tester.pump();
    expect(find.text('Alice Noor'), findsNothing);
    expect(find.text('Bilal Khan'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, '');
    await tester.tap(find.text('Pending').first);
    await tester.pumpAndSettle();
    expect(find.text('Alice Noor'), findsOneWidget);
    expect(find.text('Bilal Khan'), findsNothing);
  });

  testWidgets('super admin approves a pending user through the RPC', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo =
        FakeAdminRepository(users: <AdminUser>[alice]);
    await pumpAdmin(tester, _screen, repository: repo);

    await tester.tap(find.byKey(const Key('admin.users.row.u-alice')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('admin.users.action.approve')));
    await tester.pumpAndSettle();
    expect(find.text('Approve this user?'), findsOneWidget);
    await tester.tap(find.widgetWithText(TpButton, 'Approve').last);
    await tester.pumpAndSettle();

    expect(repo.calls, <String>['user:u-alice:approve:-:-']);
    expect(find.text('Saved.'), findsOneWidget);
  });

  testWidgets('deactivate requires a reason before calling the RPC', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo =
        FakeAdminRepository(users: <AdminUser>[bilal]);
    await pumpAdmin(tester, _screen, repository: repo);

    await tester.tap(find.byKey(const Key('admin.users.row.u-bilal')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('admin.users.action.deactivate')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('admin.users.reasonConfirm')));
    await tester.pumpAndSettle();
    expect(find.text('Enter a reason.'), findsOneWidget);
    expect(repo.calls, isEmpty);

    await tester.enterText(
      find.byKey(const Key('admin.users.reasonField')),
      'Left the company',
    );
    await tester.tap(find.byKey(const Key('admin.users.reasonConfirm')));
    await tester.pumpAndSettle();
    expect(repo.calls, <String>['user:u-bilal:deactivate:Left the company:-']);
  });

  testWidgets('non super admin sees the list read-only', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo =
        FakeAdminRepository(users: <AdminUser>[alice]);
    await pumpAdmin(tester, _screen, repository: repo, access: plainAdmin);

    expect(
      find.text('Only a super admin can change users. You can view the list.'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('admin.users.row.u-alice')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('admin.users.action.approve')), findsNothing);
  });

  testWidgets('a failed load renders the error state with retry', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo = FakeAdminRepository()
      ..usersError = Exception('boom');
    await pumpAdmin(tester, _screen, repository: repo);
    expect(find.byKey(TpStateKeys.error), findsOneWidget);
    expect(find.text('Could not load users.'), findsOneWidget);
  });
}
