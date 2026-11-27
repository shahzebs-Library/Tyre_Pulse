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
  testWidgets('My drivers lists the team with vehicle and counts',
      (WidgetTester tester) async {
    await _pump(tester, const MyDriversScreen(), FakeFleetTeamRepository());
    expect(find.text('ADIL ABBAS SYED'), findsOneWidget);
    expect(find.text('TM655'), findsOneWidget);
    expect(find.text('Open charges: 1'), findsOneWidget);
    expect(find.text('Open fines: 2'), findsOneWidget);
  });

  testWidgets('switching to Add drivers shows drivers without a supervisor',
      (WidgetTester tester) async {
    await _pump(tester, const MyDriversScreen(), FakeFleetTeamRepository());
    await tester.tap(find.text('Add drivers'));
    await tester.pumpAndSettle();
    expect(find.text('SARFARAJ TASLIM'), findsOneWidget);
    expect(find.text('No vehicle'), findsOneWidget);
  });

  testWidgets('an empty team says what to do next',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const MyDriversScreen(),
      FakeFleetTeamRepository(mine: const []),
    );
    expect(find.text('No drivers on your team yet'), findsOneWidget);
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

  testWidgets('a driver not on the team offers only Add to my team',
      (WidgetTester tester) async {
    final FakeFleetTeamRepository repo = FakeFleetTeamRepository();
    await _pump(
      tester,
      const FleetDriverDetailScreen(driver: sarfaraj, onTeam: false),
      repo,
    );
    expect(find.byKey(FleetDriverKeys.take), findsOneWidget);
    expect(find.byKey(FleetDriverKeys.charge), findsNothing);
    await tester.tap(find.byKey(FleetDriverKeys.take));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'Joins my team');
    await tester.tap(find.text('Add to my team').last);
    await tester.pumpAndSettle();
    expect(repo.commands.single.$1, 'take_driver');
    expect(repo.commands.single.$2['reason'], 'Joins my team');
    expect(find.byKey(FleetDriverKeys.charge), findsOneWidget);
  });

  testWidgets('assigning a held vehicle asks before moving it',
      (WidgetTester tester) async {
    final FakeFleetTeamRepository repo =
        FakeFleetTeamRepository(conflictFirst: true);
    await _pump(
      tester,
      const FleetDriverDetailScreen(driver: sarfaraj, onTeam: true),
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
      const FleetDriverDetailScreen(driver: adil, onTeam: true),
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
