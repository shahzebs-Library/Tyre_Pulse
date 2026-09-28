import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_access_screen.dart';

import 'admin_test_support.dart';

const Widget _screen = AdminAccessScreen(route: AdminAccessRoute());

void main() {
  testWidgets('switching Allow to Deny clears the old row first', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo = FakeAdminRepository(
      users: <AdminUser>[alice],
      grants: <ModuleKey, AdminMobileGrant>{
        ModuleKey.inspect: const AdminMobileGrant(
          id: 'g1',
          module: ModuleKey.inspect,
          effect: AdminGrantEffect.grant,
        ),
      },
    );
    await pumpAdmin(tester, _screen, repository: repo);

    await tester.tap(find.byKey(const Key('admin.access.user.u-alice')));
    await tester.pumpAndSettle();
    expect(find.text('New Inspection'), findsOneWidget);
    expect(find.text('Role default: allowed'), findsWidgets);

    final Finder row = find.byKey(const Key('admin.access.module.inspect'));
    await tester.tap(find.descendant(of: row, matching: find.text('Deny')));
    await tester.pumpAndSettle();

    expect(repo.calls, <String>['clear:g1', 'set:u-alice:inspect:revoke']);
    expect(find.text('Access updated.'), findsOneWidget);
  });

  testWidgets('Default removes the override without writing a new one', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo = FakeAdminRepository(
      users: <AdminUser>[alice],
      grants: <ModuleKey, AdminMobileGrant>{
        ModuleKey.scan: const AdminMobileGrant(
          id: 'g2',
          module: ModuleKey.scan,
          effect: AdminGrantEffect.revoke,
        ),
      },
    );
    await pumpAdmin(tester, _screen, repository: repo);
    await tester.tap(find.byKey(const Key('admin.access.user.u-alice')));
    await tester.pumpAndSettle();

    final Finder row = find.byKey(const Key('admin.access.module.scan'));
    await tester.tap(find.descendant(of: row, matching: find.text('Default')));
    await tester.pumpAndSettle();
    expect(repo.calls, <String>['clear:g2']);
  });
}
