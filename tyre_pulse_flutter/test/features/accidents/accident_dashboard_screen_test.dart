import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_dashboard_screen.dart';

const AccidentRecord _rearEnd = AccidentRecord(
  id: 'acc-rear-end',
  referenceNo: 'ACC-2026-0182',
  assetNo: 'Mixer 3208',
  site: 'Diriyah',
  incidentDate: '2026-05-11 08:15',
  location: 'Gate 4',
  accidentType: 'rear_end',
  severity: 'moderate',
  status: 'under_review',
  reporterName: 'Ahmed K.',
);

const AccidentRecord _rollover = AccidentRecord(
  id: 'acc-rollover',
  referenceNo: 'ACC-2026-0183',
  assetNo: 'Pump 3012',
  site: 'Qiddiya',
  incidentDate: '2026-05-12',
  accidentType: 'rollover',
  severity: 'severe',
  status: 'closed',
);

final class _DashboardRepository implements AccidentRepository {
  _DashboardRepository({this.hasMoreOnFirstPage = false});

  final bool hasMoreOnFirstPage;
  int listCalls = 0;
  final List<int> offsets = <int>[];

  @override
  Future<AccidentListPage> list({
    required int offset,
    required int pageSize,
    String? country,
    String? reporterId,
  }) async {
    listCalls++;
    offsets.add(offset);
    return AccidentListPage(
      items: offset == 0
          ? const <AccidentRecord>[_rearEnd, _rollover]
          : const <AccidentRecord>[],
      hasMore: hasMoreOnFirstPage && offset == 0,
    );
  }

  @override
  Future<AccidentRecord?> byId(String id) async =>
      id == _rearEnd.id ? _rearEnd : _rollover;

  @override
  Future<AccidentCaseSnapshot?> caseById(
    String id, {
    String? country,
  }) async =>
      null;
}

Future<(GoRouter, _DashboardRepository)> _pumpDashboard(
  WidgetTester tester, {
  bool hasMoreOnFirstPage = false,
}) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final _DashboardRepository repository = _DashboardRepository(
    hasMoreOnFirstPage: hasMoreOnFirstPage,
  );
  final GoRouter router = GoRouter(
    initialLocation: TpRoutePaths.accidentDashboard,
    routes: <RouteBase>[
      GoRoute(
        path: TpRoutePaths.accidentReport,
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('report destination')),
      ),
      GoRoute(
        path: '/accidents/:accidentId',
        builder: (BuildContext context, GoRouterState state) => Scaffold(
          body: Text('detail ${state.pathParameters['accidentId']}'),
        ),
      ),
      GoRoute(
        path: TpRoutePaths.accidentDashboard,
        builder: (BuildContext context, GoRouterState state) =>
            const AccidentDashboardScreen(route: AccidentDashboardRoute()),
      ),
    ],
  );
  addTearDown(router.dispose);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        accidentRepositoryProvider.overrideWithValue(repository),
      ],
      child: MaterialApp.router(
        debugShowCheckedModeBanner: false,
        routerConfig: router,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (router, repository);
}

void main() {
  testWidgets('dashboard matches the approved command-centre hierarchy', (
    WidgetTester tester,
  ) async {
    await _pumpDashboard(tester);

    expect(find.text('Accident command centre'), findsOneWidget);
    expect(find.text('Every case, one accountable trail'), findsOneWidget);
    expect(find.byKey(AccidentDashboardScreenKeys.search), findsOneWidget);
    expect(find.byKey(AccidentDashboardScreenKeys.allCases), findsOneWidget);
    expect(
      find.byKey(AccidentDashboardScreenKeys.reportedByMe),
      findsOneWidget,
    );
    expect(
      find.byKey(AccidentDashboardScreenKeys.card(_rearEnd.id)),
      findsOneWidget,
    );
    await expectLater(
      find.byType(AccidentDashboardScreen),
      matchesGoldenFile('goldens/accident_dashboard_light.png'),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('human-readable type, status and severity remain searchable', (
    WidgetTester tester,
  ) async {
    await _pumpDashboard(tester);

    await tester.enterText(
      find.byKey(AccidentDashboardScreenKeys.search),
      'Rear End',
    );
    await tester.pump();

    expect(
      find.byKey(AccidentDashboardScreenKeys.card(_rearEnd.id)),
      findsOneWidget,
    );
    expect(
      find.byKey(AccidentDashboardScreenKeys.card(_rollover.id)),
      findsNothing,
    );
  });

  testWidgets('every dashboard CTA performs its defined action', (
    WidgetTester tester,
  ) async {
    final (GoRouter router, _DashboardRepository repository) =
        await _pumpDashboard(tester);

    tester
        .widget<IconButton>(
          find.byKey(AccidentDashboardScreenKeys.reportAction),
        )
        .onPressed!();
    await tester.pumpAndSettle();
    expect(find.text('report destination'), findsOneWidget);

    router.go(TpRoutePaths.accidentDashboard);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(AccidentDashboardScreenKeys.reportFab));
    await tester.pumpAndSettle();
    expect(find.text('report destination'), findsOneWidget);

    router.go(TpRoutePaths.accidentDashboard);
    await tester.pumpAndSettle();
    final int callsBeforeFilter = repository.listCalls;
    await tester.tap(find.byKey(AccidentDashboardScreenKeys.reportedByMe));
    await tester.pumpAndSettle();
    expect(repository.listCalls, callsBeforeFilter + 1);

    await tester.tap(find.byKey(AccidentDashboardScreenKeys.allCases));
    await tester.pumpAndSettle();
    expect(repository.listCalls, callsBeforeFilter + 2);

    await tester.tap(find.byKey(AccidentDashboardScreenKeys.status('open')));
    await tester.pump();
    expect(
      find.byKey(AccidentDashboardScreenKeys.card(_rearEnd.id)),
      findsOneWidget,
    );
    expect(
      find.byKey(AccidentDashboardScreenKeys.card(_rollover.id)),
      findsNothing,
    );

    await tester.tap(find.byKey(AccidentDashboardScreenKeys.status('closed')));
    await tester.pump();
    expect(
      find.byKey(AccidentDashboardScreenKeys.card(_rearEnd.id)),
      findsNothing,
    );
    expect(
      find.byKey(AccidentDashboardScreenKeys.card(_rollover.id)),
      findsOneWidget,
    );

    await tester.tap(find.byKey(AccidentDashboardScreenKeys.status('all')));
    await tester.pump();
    await tester.tap(
      find.byKey(AccidentDashboardScreenKeys.card(_rearEnd.id)),
    );
    await tester.pumpAndSettle();
    expect(find.text('detail acc-rear-end'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('load more requests the next real repository page', (
    WidgetTester tester,
  ) async {
    final (_, _DashboardRepository repository) = await _pumpDashboard(
      tester,
      hasMoreOnFirstPage: true,
    );

    await tester.scrollUntilVisible(
      find.text('Load more cases'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.drag(find.byType(ListView), const Offset(0, -80));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Load more cases'));
    await tester.pumpAndSettle();

    expect(repository.offsets, <int>[0, 2]);
    expect(find.text('Load more cases'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
