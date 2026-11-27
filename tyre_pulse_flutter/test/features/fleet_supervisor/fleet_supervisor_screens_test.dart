import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/fleet_supervisor/fleet_supervisor_providers.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/fleet_driver_detail_screen.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/issue_charge_screen.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/my_drivers_screen.dart';

import 'fake_fleet_team_repository.dart';

Future<void> _pump(
  WidgetTester tester,
  Widget home,
  FakeFleetTeamRepository repo, {
  Locale locale = const Locale('en'),
  double textScale = 1,
}) async {
  tester.view.physicalSize = const Size(360, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        fleetTeamRepositoryProvider.overrideWithValue(repo),
        fleetPhotoPickerProvider.overrideWithValue(
          ({required bool camera}) async => '/tmp/photo.jpg',
        ),
      ],
      child: MaterialApp(
        locale: locale,
        theme: TpTheme.light,
        localizationsDelegates: TpLocalizations.delegates,
        supportedLocales: TpLocalizations.supportedLocales,
        builder: (BuildContext c, Widget? child) => MediaQuery(
          data: MediaQuery.of(c)
              .copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: home,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Drivers lists the whole pool with vehicle and counts',
      (WidgetTester tester) async {
    await _pump(tester, const MyDriversScreen(), FakeFleetTeamRepository());
    expect(find.text('ADIL ABBAS SYED'), findsOneWidget);
    expect(find.text('TM655'), findsOneWidget);
    expect(find.text('Open charges: 1'), findsOneWidget);
    expect(find.text('Open fines: 2'), findsOneWidget);
  });

  testWidgets('every driver in the pool is listed, nobody owns one',
      (WidgetTester tester) async {
    await _pump(tester, const MyDriversScreen(), FakeFleetTeamRepository());
    expect(find.text('ADIL ABBAS SYED'), findsOneWidget);
    expect(find.text('SARFARAJ TASLIM'), findsOneWidget);
    expect(find.text('Responsible: Firozuddin Kayal'), findsOneWidget);
    await tester.tap(find.text('No vehicle').first);
    await tester.pumpAndSettle();
    expect(find.text('ADIL ABBAS SYED'), findsNothing);
    expect(find.text('SARFARAJ TASLIM'), findsOneWidget);
  });

  testWidgets('driver type filter is sent to the server',
      (WidgetTester tester) async {
    final FakeFleetTeamRepository repo = FakeFleetTeamRepository();
    await _pump(tester, const MyDriversScreen(), repo);
    await tester.tap(find.byKey(MyDriversKeys.filterType));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Transit mixer driver').last);
    await tester.pumpAndSettle();
    expect(repo.lastCategory, 'Transit mixer driver');
    expect(find.text('SARFARAJ TASLIM'), findsNothing);
  });

  testWidgets('an empty pool says so', (WidgetTester tester) async {
    await _pump(
      tester,
      const MyDriversScreen(),
      FakeFleetTeamRepository(mine: const [], available: const []),
    );
    expect(find.text('No drivers here'), findsOneWidget);
  });

  testWidgets('a refused role sees a reason, not a spinner',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const MyDriversScreen(),
      FakeFleetTeamRepository(failWith: deniedError),
    );
    expect(find.textContaining('Only a Fleet Supervisor'), findsOneWidget);
  });

  testWidgets('offline shows the offline sentence with Retry',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const MyDriversScreen(),
      FakeFleetTeamRepository(failWith: const FleetOfflineFailure()),
    );
    expect(find.textContaining('No connection'), findsWidgets);
  });

  testWidgets('any driver offers every action; type and region are saved',
      (WidgetTester tester) async {
    final FakeFleetTeamRepository repo = FakeFleetTeamRepository();
    await _pump(
      tester,
      const FleetDriverDetailScreen(driver: sarfaraj),
      repo,
    );
    expect(find.byKey(FleetDriverKeys.assign), findsOneWidget);
    expect(find.byKey(FleetDriverKeys.charge), findsOneWidget);
    expect(find.byKey(FleetDriverKeys.fine), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(FleetDriverKeys.profile),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(FleetDriverKeys.profile));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pump driver'));
    await tester.enterText(
      find.byKey(const Key('fleetSup.profile.region')),
      'Western',
    );
    await tester.enterText(
      find.byKey(const Key('fleetSup.profile.reason')),
      'Moved to pumps',
    );
    await tester.tap(find.byKey(const Key('fleetSup.profile.save')));
    await tester.pumpAndSettle();
    expect(repo.commands.single.$1, 'set_driver_profile');
    expect(repo.commands.single.$2['driver_category'], 'Pump driver');
    expect(repo.commands.single.$2['region'], 'Western');
  });

  testWidgets('assigning a held vehicle asks before moving it',
      (WidgetTester tester) async {
    final FakeFleetTeamRepository repo =
        FakeFleetTeamRepository(conflictFirst: true);
    await _pump(
      tester,
      const FleetDriverDetailScreen(driver: sarfaraj),
      repo,
    );
    await tester.tap(find.byKey(FleetDriverKeys.assign));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(find.byKey(FleetDriverKeys.vehicle('v-tm655')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.enterText(find.byType(TextField).last, 'Swap for the pour');
    await tester.tap(find.byKey(const Key('fleetSup.reason.save')));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Vehicle already assigned'), findsOneWidget);
    await tester.tap(find.text('Move vehicle'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(repo.commands, hasLength(2));
    expect(repo.commands.last.$2['move_from_driver'], 'd-adil');
  });

  testWidgets('a charge is refused locally until it is complete, then sent',
      (WidgetTester tester) async {
    final FakeFleetTeamRepository repo = FakeFleetTeamRepository();
    await _pump(
      tester,
      IssueChargeScreen(
        driver: adil,
        mode: FleetIssueMode.charge,
        now: DateTime(2026, 11, 27, 12),
      ),
      repo,
    );
    await tester.tap(find.byKey(IssueChargeKeys.send));
    await tester.pumpAndSettle();
    expect(repo.charges, isEmpty);
    expect(
      find.text('Enter an amount above 0 and at most 1,000,000.'),
      findsOneWidget,
    );

    await tester.enterText(find.byKey(IssueChargeKeys.amount).first, '450');
    await tester.enterText(
      find.byKey(IssueChargeKeys.basis).first,
      'Sidewall cut after kerb strike at the plant gate',
    );
    await tester.scrollUntilVisible(
      find.byKey(IssueChargeKeys.camera),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(IssueChargeKeys.camera));
    await tester.pumpAndSettle();
    final Finder fault = find.byType(TpDropdown<String>).last;
    await tester.scrollUntilVisible(
      fault,
      -200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(fault);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Driver fault').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(IssueChargeKeys.send));
    await tester.pumpAndSettle();
    expect(repo.charges, hasLength(1));
    expect(repo.charges.single['currency'], 'SAR');
    expect(repo.charges.single['vehicle_id'], 'v-tm655');
  });

  testWidgets('screens fit 360 dp at 2x text without overflow',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const MyDriversScreen(),
      FakeFleetTeamRepository(),
      textScale: 2,
    );
    expect(tester.takeException(), isNull);
    await _pump(
      tester,
      const FleetDriverDetailScreen(driver: adil),
      FakeFleetTeamRepository(),
      textScale: 2,
      locale: const Locale('ar'),
    );
    expect(tester.takeException(), isNull);
    await _pump(
      tester,
      IssueChargeScreen(
        driver: adil,
        mode: FleetIssueMode.fine,
        now: DateTime(2026, 11, 27),
      ),
      FakeFleetTeamRepository(),
      textScale: 2,
    );
    expect(tester.takeException(), isNull);
  });
}
