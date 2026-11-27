import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/data/wash_repository.dart';
import 'package:tyre_pulse/features/washing/presentation/wash_history_screen.dart';
import 'package:tyre_pulse/features/washing/presentation/washing_screen.dart';
import 'package:tyre_pulse/features/washing/presentation/widgets/wash_type_grid.dart';
import 'package:tyre_pulse/features/washing/washing_providers.dart';

const WorkspaceContext _workspace = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  activeCountry: 'KSA',
  fullName: 'Field Driver',
);

String _daysAgo(int days) {
  final DateTime d = DateTime.now().subtract(Duration(days: days));
  return '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}

final class _Repo implements WashRepository {
  _Repo({this.history = const <WashRecord>[], this.failHistory = false});

  final List<WashRecord> history;
  final bool failHistory;
  final List<SubmitWashInput> submitted = <SubmitWashInput>[];

  @override
  Future<String?> currentUserDisplayName(String userId) async => 'Ahmed Saleh';

  @override
  Future<List<WashRecord>> listRecentWashes({int limit = 200}) async {
    if (failHistory) throw StateError('offline');
    return history;
  }

  @override
  Future<Set<String>> submitWash({
    required WorkspaceContext workspace,
    required SubmitWashInput input,
  }) async {
    submitted.add(input);
    return const <String>{};
  }
}

class _Fleet implements VehicleFleetSource {
  @override
  Future<Map<String, dynamic>?> fetchByAssetNo({
    required String assetNo,
    required String? country,
    String? organisationId,
  }) async =>
      <String, dynamic>{
        'id': 'v1',
        'asset_no': assetNo,
        'vehicle_type': 'TR-MIXER',
        'site': 'DIRIYAH-G1',
      };

  @override
  Future<List<Map<String, dynamic>>> fetchPage({
    required int from,
    required int to,
    required String? country,
  }) async =>
      const <Map<String, dynamic>>[];
}

Future<void> _pump(
  WidgetTester tester,
  Widget home, {
  required _Repo repo,
  Size size = const Size(420, 900),
  String locale = 'en',
  bool dark = false,
  double textScale = 1,
  bool? online = false,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        workspaceContextProvider.overrideWithValue(_workspace),
        washRepositoryProvider.overrideWithValue(repo),
        washOnlineCheckProvider.overrideWithValue(() async => online),
        vehicleFleetRepositoryProvider.overrideWithValue(
          VehicleFleetRepository(_Fleet()),
        ),
      ],
      child: MaterialApp(
        theme: dark ? TpTheme.dark : TpTheme.light,
        locale: Locale(locale),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        builder: (BuildContext context, Widget? child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(textScale),
          ),
          child: child!,
        ),
        home: home,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tapKey(WidgetTester tester, Key key) async {
  await tester.ensureVisible(find.byKey(key));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
}

Future<void> _enterAsset(WidgetTester tester, String asset) async {
  await tester.enterText(find.byType(TextField).first, asset);
  await tester.pump(const Duration(milliseconds: 400));
  await tester.pumpAndSettle();
}

String _saveLabel(WidgetTester tester) {
  final TpButton button =
      tester.widget<TpButton>(find.byKey(WashingScreenKeys.save));
  return button.label;
}

void main() {
  testWidgets('shows five numbered steps and who is logging it once',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const WashingScreen(route: WashingRoute()),
      repo: _Repo(),
      size: const Size(420, 4000),
    );

    expect(find.text('0 of 5 steps done'), findsOneWidget);
    expect(find.textContaining('Logged by Ahmed Saleh'), findsOneWidget);
    expect(find.textContaining('Ahmed Saleh'), findsOneWidget);
    expect(find.textContaining('Entered by'), findsNothing);
    for (final String title in <String>[
      'Vehicle',
      'Wash type',
      'Checklist and chemicals',
      'Photos',
      'Review and save',
    ]) {
      expect(find.textContaining(title), findsWidgets, reason: title);
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('save button names what is missing and does not submit',
      (WidgetTester tester) async {
    final _Repo repo = _Repo();
    await _pump(tester, const WashingScreen(route: WashingRoute()), repo: repo);

    expect(_saveLabel(tester), 'Pick a vehicle');
    await tester.tap(find.byKey(WashingScreenKeys.save));
    await tester.pumpAndSettle();
    expect(repo.submitted, isEmpty);

    await _enterAsset(tester, 'TM514');
    expect(_saveLabel(tester), 'Choose a wash type');

    await tester.scrollUntilVisible(
      find.byKey(WashTypeGrid.tileKey('Full')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(WashTypeGrid.tileKey('Full')));
    await tester.pumpAndSettle();
    expect(_saveLabel(tester), 'Save Wash');
    expect(find.text('Inside and out'), findsOneWidget);
  });

  testWidgets('saves the same record and confirms offline',
      (WidgetTester tester) async {
    final _Repo repo = _Repo();
    await _pump(tester, const WashingScreen(route: WashingRoute()), repo: repo);

    await _enterAsset(tester, 'TM514');
    await tester.scrollUntilVisible(
      find.byKey(WashTypeGrid.tileKey('Exterior')),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(WashTypeGrid.tileKey('Exterior')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WashingScreenKeys.save));
    await tester.pumpAndSettle();

    final SubmitWashInput input = repo.submitted.single;
    expect(input.assetNo, 'TM514');
    expect(input.washType, 'Exterior');
    expect(input.site, 'DIRIYAH-G1');
    expect(input.vehicleType, 'TR-MIXER');
    expect(input.washedBy, 'Ahmed Saleh');
    expect(input.status, kWashDefaultStatus);
    expect(input.photoLocalPaths, isEmpty);
    expect(input.washDetails?['chemical_status'], 'not_recorded');

    expect(find.byKey(WashingScreenKeys.savedSheet), findsOneWidget);
    expect(find.text('Wash saved'), findsOneWidget);
    expect(find.textContaining('You are offline'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('vehicle card shows last wash and overdue from history',
      (WidgetTester tester) async {
    final _Repo repo = _Repo(
      history: <WashRecord>[
        WashRecord.fromRow(<String, dynamic>{
          'id': 'w1',
          'asset_no': 'TM514',
          'wash_date': _daysAgo(10),
          'wash_type': 'Steam',
        }),
        WashRecord.fromRow(<String, dynamic>{
          'id': 'w0',
          'asset_no': 'TM514',
          'wash_date': _daysAgo(30),
          'wash_type': 'Exterior',
        }),
      ],
    );
    await _pump(tester, const WashingScreen(route: WashingRoute()), repo: repo);
    await _enterAsset(tester, 'TM514');

    expect(find.byKey(WashingScreenKeys.vehicleStatus), findsOneWidget);
    expect(find.text('Last wash ${_daysAgo(10)}'), findsOneWidget);
    expect(find.text('10 days ago'), findsOneWidget);
    expect(find.text('3 days overdue'), findsOneWidget);
  });

  testWidgets('a vehicle with no history says so', (WidgetTester tester) async {
    await _pump(
      tester,
      const WashingScreen(route: WashingRoute()),
      repo: _Repo(),
    );
    await _enterAsset(tester, 'TM514');
    expect(find.text('No wash recorded yet'), findsOneWidget);
  });

  testWidgets('history that cannot load is not shown as never washed',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const WashingScreen(route: WashingRoute()),
      repo: _Repo(failHistory: true),
    );
    await _enterAsset(tester, 'TM514');
    expect(find.text('Wash history could not be checked'), findsOneWidget);
    expect(find.text('No wash recorded yet'), findsNothing);
  });

  testWidgets('checklist header counts checked items',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const WashingScreen(route: WashingRoute()),
      repo: _Repo(),
      size: const Size(420, 4000),
    );
    expect(find.text('0 of 5 checked'), findsNWidgets(2));
    final Finder header = find.byType(ExpansionTile).first;
    await tester.scrollUntilVisible(
      header,
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(header);
    await tester.pumpAndSettle();
    final Finder pass = find.byKey(
      const ValueKey<String>('washing.checkResult.pass'),
    );
    await tester.ensureVisible(pass.first);
    await tester.tap(pass.first);
    await tester.pumpAndSettle();
    expect(find.text('1 of 5 checked'), findsWidgets);
  });

  for (final String lang in <String>['en', 'ar', 'ur']) {
    for (final bool dark in <bool>[false, true]) {
      testWidgets(
          '360dp, text x2, $lang, ${dark ? 'dark' : 'light'}: '
          'no overflow', (WidgetTester tester) async {
        await _pump(
          tester,
          const WashingScreen(route: WashingRoute()),
          repo: _Repo(),
          size: const Size(360, 780),
          locale: lang,
          dark: dark,
          textScale: 2,
        );
        await _enterAsset(tester, 'TM514');
        final Finder scroll = find.byType(Scrollable).first;
        for (int i = 0; i < 30; i++) {
          await tester.drag(scroll, const Offset(0, -500));
          await tester.pump();
        }
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  }

  group('history', () {
    final DateTime now = DateTime(2026, 11, 20, 10);
    List<WashRecord> rows() => <WashRecord>[
          WashRecord.fromRow(<String, dynamic>{
            'id': 'a',
            'asset_no': 'TM514',
            'wash_date': '2026-11-19',
            'wash_type': 'Interior',
            'site': 'NHC',
            'entry_name': 'Ahmed Saleh',
            'photos': <String>['p1', 'p2'],
          }),
          WashRecord.fromRow(<String, dynamic>{
            'id': 'b',
            'asset_no': 'TM514',
            'wash_date': '2026-11-05',
            'wash_type': 'Full',
          }),
          WashRecord.fromRow(<String, dynamic>{
            'id': 'c',
            'asset_no': 'MP090',
            'wash_date': '2026-10-01',
            'wash_type': 'Exterior',
          }),
        ];

    testWidgets('stats come from the rows', (WidgetTester tester) async {
      await _pump(
        tester,
        WashHistoryScreen(now: now),
        repo: _Repo(history: rows()),
      );
      expect(find.byKey(WashHistoryKeys.stats), findsOneWidget);
      // 7 days: only the 19th. This month: 19th and 5th. Top asset TM514.
      expect(find.text('1'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('Most washed this month · 2 washes'), findsOneWidget);
      expect(find.text('3 washes'), findsOneWidget);
      expect(find.text('2 photos'), findsOneWidget);
    });

    testWidgets('type, date and search filters narrow the list',
        (WidgetTester tester) async {
      await _pump(
        tester,
        WashHistoryScreen(now: now),
        repo: _Repo(history: rows()),
      );
      await _tapKey(tester, WashHistoryKeys.typeFilter('Interior'));
      expect(find.text('1 wash'), findsOneWidget);

      await _tapKey(tester, WashHistoryKeys.typeFilter(null));
      await _tapKey(tester, WashHistoryKeys.range('30'));
      expect(find.text('2 washes'), findsOneWidget);

      await _tapKey(tester, WashHistoryKeys.range('all'));
      await tester.enterText(find.byKey(WashHistoryKeys.search), 'mp09');
      await tester.pumpAndSettle();
      expect(find.text('1 wash'), findsOneWidget);
      expect(find.text('MP090'), findsOneWidget);

      await tester.enterText(find.byKey(WashHistoryKeys.search), 'zzz');
      await tester.pumpAndSettle();
      expect(find.text('No washes match these filters'), findsOneWidget);
      await tester.tap(find.text('Clear filters'));
      await tester.pumpAndSettle();
      expect(find.text('3 washes'), findsOneWidget);
    });

    testWidgets('error state offers retry', (WidgetTester tester) async {
      await _pump(
        tester,
        WashHistoryScreen(now: now),
        repo: _Repo(failHistory: true),
      );
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('empty history', (WidgetTester tester) async {
      await _pump(tester, WashHistoryScreen(now: now), repo: _Repo());
      expect(find.byKey(WashHistoryKeys.stats), findsNothing);
    });

    for (final String lang in <String>['en', 'ar', 'ur']) {
      testWidgets('360dp text x2 dark $lang history has no overflow',
          (WidgetTester tester) async {
        await _pump(
          tester,
          WashHistoryScreen(now: now),
          repo: _Repo(history: rows()),
          size: const Size(360, 780),
          locale: lang,
          dark: true,
          textScale: 2,
        );
        expect(tester.takeException(), isNull);
      });
    }
  });
}
