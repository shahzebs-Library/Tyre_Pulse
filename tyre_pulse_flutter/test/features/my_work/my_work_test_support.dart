import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/my_work_providers.dart';

final DateTime myWorkTestNow = DateTime(2026, 8, 28, 10, 5);

const AccessState myWorkAdminAccess =
    AccessState(role: UserRole.known(RoleId.admin));

const WorkspaceContext myWorkTestWorkspace = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: myWorkAdminAccess,
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  activeCountry: 'UAE',
  currency: 'AED',
  fullName: 'Field Operator',
);

Future<void> pumpMyWork(
  WidgetTester tester,
  Widget screen, {
  required MyWorkGateway gateway,
  AccessState access = myWorkAdminAccess,
  int pendingSync = 0,
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(390, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        myWorkGatewayProvider.overrideWithValue(gateway),
        myWorkClockProvider.overrideWithValue(() => myWorkTestNow),
        myWorkPendingSyncProvider.overrideWith((Ref ref) async => pendingSync),
        accessStateProvider.overrideWithValue(access),
        workspaceContextProvider.overrideWithValue(myWorkTestWorkspace),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: screen,
      ),
    ),
  );
  await tester.pumpAndSettle();
}
