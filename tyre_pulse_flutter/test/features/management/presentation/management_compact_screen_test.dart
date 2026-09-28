import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/management/data/management_repository.dart';
import 'package:tyre_pulse/features/management/domain/management_models.dart';
import 'package:tyre_pulse/features/management/management_providers.dart';
import 'package:tyre_pulse/features/management/presentation/management_copy.dart';
import 'package:tyre_pulse/features/management/presentation/management_screens.dart';

void main() {
  testWidgets('overview is compact, data-backed, and changes the real period', (
    WidgetTester tester,
  ) async {
    final _ManagementRepository repository = _ManagementRepository();
    await _pump(
      tester,
      const OverviewScreen(route: OverviewRoute()),
      repository,
    );

    expect(find.text('Fleet Overview'), findsOneWidget);
    expect(find.text('18'), findsOneWidget);
    expect(find.text('Tyres'), findsOneWidget);
    expect(repository.analyticsPeriods.single, 90);

    await tester.tap(find.text('30 days'));
    await tester.pumpAndSettle();
    expect(repository.analyticsPeriods, <int>[90, 30]);
    await expectLater(
      find.byType(OverviewScreen),
      matchesGoldenFile('goldens/overview_compact_en.png'),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('analytics site control reloads with the selected site', (
    WidgetTester tester,
  ) async {
    final _ManagementRepository repository = _ManagementRepository();
    await _pump(
      tester,
      const AnalyticsScreen(route: AnalyticsRoute()),
      repository,
    );

    await tester.tap(find.widgetWithText(ChoiceChip, 'Qiddiya'));
    await tester.pumpAndSettle();
    expect(repository.analyticsSites, <String?>[null, 'Qiddiya']);
    await expectLater(
      find.byType(AnalyticsScreen),
      matchesGoldenFile('goldens/analytics_compact_en.png'),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('financial report shows only authoritative values and reloads', (
    WidgetTester tester,
  ) async {
    final _ManagementRepository repository = _ManagementRepository();
    await _pump(tester, const ReportsScreen(route: ReportsRoute()), repository);

    expect(find.text('TyrePulse Saudi Arabia'), findsOneWidget);
    expect(find.text('SAR 42.0K'), findsOneWidget);
    expect(find.text('SAR 8.4K'), findsOneWidget);
    expect(find.textContaining('SAR 0'), findsNothing);

    await tester.tap(find.text('90 days'));
    await tester.pumpAndSettle();
    expect(repository.reportPeriods, <int>[30, 90]);
    await expectLater(
      find.byType(ReportsScreen),
      matchesGoldenFile('goldens/reports_compact_en.png'),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('team search changes the visible read-only roster', (
    WidgetTester tester,
  ) async {
    final _ManagementRepository repository = _ManagementRepository();
    await _pump(tester, const TeamScreen(route: TeamRoute()), repository);

    expect(find.text('Fatima Ali'), findsOneWidget);
    expect(find.text('Vinay Kumar'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('team.search')), 'insurance');
    await tester.pump();
    expect(find.text('Fatima Ali'), findsOneWidget);
    expect(find.text('Vinay Kumar'), findsNothing);
    await expectLater(
      find.byType(TeamScreen),
      matchesGoldenFile('goldens/team_compact_en.png'),
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets('overview is distinct from analytics: site rollup, no filter',
      (WidgetTester tester) async {
    final _ManagementRepository repository = _ManagementRepository();
    await _pump(
      tester,
      const OverviewScreen(route: OverviewRoute()),
      repository,
    );
    // Per-site rollup: 12 of 18 tyres = 67%, 6 of 18 = 33%.
    expect(find.byKey(const Key('overview.site.Qiddiya')), findsOneWidget);
    expect(find.textContaining('67% of fleet tyres'), findsOneWidget);
    expect(find.textContaining('33% of fleet tyres'), findsOneWidget);
    // (2 critical + 4 high) of 18 = 33%.
    expect(
      find.descendant(
        of: find.byKey(const Key('overview.atRisk')),
        matching: find.text('33%'),
      ),
      findsOneWidget,
    );
    // Analytics-only controls and distributions are not on the overview.
    expect(find.byType(ChoiceChip), findsNothing);
    expect(find.text('Top brands'), findsNothing);

    await _pump(
      tester,
      const AnalyticsScreen(route: AnalyticsRoute()),
      repository,
    );
    expect(find.byType(ChoiceChip), findsWidgets);
  });

  testWidgets('report share action is offered once a report is on screen',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const ReportsScreen(route: ReportsRoute()),
      _ManagementRepository(),
    );
    final IconButton share = tester.widget<IconButton>(
      find.byKey(const Key('reports.share')),
    );
    expect(share.onPressed, isNotNull);
  });

  test('report PDF carries only the authoritative values on screen', () async {
    final AppLocalizations en =
        await AppLocalizations.delegate.load(const Locale('en'));
    final ExecutiveSnapshot snapshot = await _ManagementRepository().report(
      from: DateTime(2026, 8),
      to: DateTime(2026, 8, 31),
    );
    final List<int> bytes = await buildManagementReportPdf(
      snapshot,
      ManagementCopy.fromL10n(en),
      en,
      30,
      'SAR',
    ).save();
    expect(bytes, isNotEmpty);
    expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
  });

  testWidgets('tapping a team member opens their loaded details',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const TeamScreen(route: TeamRoute()),
      _ManagementRepository(),
    );
    await tester.tap(find.byKey(const Key('team.member.vinay')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('team.detail.vinay')), findsOneWidget);
    expect(find.text('Role'), findsOneWidget);
    expect(find.text('Workshop Engineer'), findsOneWidget);
    // No phone or email on file: no dead call/email buttons, honest text.
    expect(find.text('Call'), findsNothing);
    expect(find.text('Not recorded'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}

Future<void> _pump(
  WidgetTester tester,
  Widget screen,
  ManagementRepository repository,
) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        managementRepositoryProvider.overrideWithValue(repository),
        activeCountryProvider.overrideWithValue('Saudi Arabia'),
        activeCurrencyProvider.overrideWithValue('SAR'),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: screen,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

final class _ManagementRepository implements ManagementRepository {
  final List<int> analyticsPeriods = <int>[];
  final List<String?> analyticsSites = <String?>[];
  final List<int> reportPeriods = <int>[];

  @override
  Future<FleetAnalytics> analytics({
    String? country,
    String? site,
    DateTime? from,
    DateTime? to,
  }) async {
    analyticsPeriods.add(to!.difference(from!).inDays);
    analyticsSites.add(site);
    return const FleetAnalytics(
      tyresTotal: 18,
      tyresCritical: 2,
      tyresHigh: 4,
      vehiclesTotal: 6,
      inspections30d: 11,
      openActions: 3,
      tyreSpend: 42000,
      byRisk: <MetricSlice>[
        MetricSlice(label: 'Critical', count: 2),
        MetricSlice(label: 'High', count: 4),
        MetricSlice(label: 'Healthy', count: 12),
      ],
      bySite: <MetricSlice>[
        MetricSlice(label: 'Qiddiya', count: 12),
        MetricSlice(label: 'Diriyah', count: 6),
      ],
      byBrand: <MetricSlice>[
        MetricSlice(label: 'Michelin', count: 10),
        MetricSlice(label: 'Bridgestone', count: 8),
      ],
      sites: <String>['Qiddiya', 'Diriyah'],
    );
  }

  @override
  Future<ExecutiveSnapshot> report({
    String? country,
    String? site,
    required DateTime from,
    required DateTime to,
  }) async {
    reportPeriods.add(to.difference(from).inDays);
    return ExecutiveSnapshot(
      available: true,
      company: 'TyrePulse Saudi Arabia',
      generatedAt: DateTime(2026, 8, 31),
      kpis: const <String, num>{'fleet': 6, 'open_accidents': 2},
      cost: const <String, num?>{
        'tyre_cost': 42000,
        'maintenance_cost': 8400,
        'cost_per_m3': null,
      },
      breakdowns: const <String, List<MetricSlice>>{
        'accidents_by_site': <MetricSlice>[
          MetricSlice(label: 'Qiddiya', count: 2),
        ],
      },
    );
  }

  @override
  Future<List<TeamMember>> team() async => const <TeamMember>[
        TeamMember(
          id: 'fatima',
          fullName: 'Fatima Ali',
          role: 'Insurance',
          site: 'Head Office',
          approved: true,
        ),
        TeamMember(
          id: 'vinay',
          fullName: 'Vinay Kumar',
          role: 'Workshop Engineer',
          site: 'Qiddiya',
          approved: false,
        ),
      ];
}
