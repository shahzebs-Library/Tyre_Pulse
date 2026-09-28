import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/features/admin/domain/admin_models.dart';
import 'package:tyre_pulse/features/admin/presentation/admin_sites_screen.dart';

import 'admin_test_support.dart';

const Widget _screen = AdminSitesScreen(route: AdminSitesRoute());
const List<AdminSite> _sites = <AdminSite>[
  AdminSite(id: 's1', name: 'NHC', country: 'KSA', active: true),
  AdminSite(
    id: 's2',
    name: 'DIRIYAH',
    country: 'KSA',
    region: 'CENTRAL',
    active: false,
  ),
];

void main() {
  testWidgets('admin edits a site region and saves', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo = FakeAdminRepository(sites: _sites);
    await pumpAdmin(tester, _screen, repository: repo, access: plainAdmin);

    expect(find.text('NHC'), findsOneWidget);
    expect(find.textContaining('No region'), findsOneWidget);

    await tester.tap(find.byKey(const Key('admin.sites.row.s1')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('admin.sites.regionField')),
      'CENTRAL',
    );
    await tester.tap(find.byKey(const Key('admin.sites.save')));
    await tester.pumpAndSettle();
    expect(repo.calls, <String>['site:s1:CENTRAL:true']);
    expect(find.text('Site updated.'), findsOneWidget);
  });

  testWidgets('filters inactive sites; a reporter is read-only', (
    WidgetTester tester,
  ) async {
    final FakeAdminRepository repo = FakeAdminRepository(sites: _sites);
    await pumpAdmin(tester, _screen, repository: repo, access: reporter);

    expect(
      find.text('Only an Admin or Manager can edit sites.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Inactive').first);
    await tester.pumpAndSettle();
    expect(find.text('NHC'), findsNothing);
    expect(find.text('DIRIYAH'), findsOneWidget);

    await tester.tap(find.byKey(const Key('admin.sites.row.s2')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('admin.sites.save')), findsNothing);
  });
}
