/// The accident register is a StatefulShellBranch root (indexed stack), so it
/// is built ONCE and kept alive. The Home "Open accidents" drill-down must
/// therefore work on every tap while the screen stays mounted, and must never
/// leak into a later normal visit.
///
/// The Home tile is stood in for by a button that runs the same two calls the
/// real tile runs (`listDrilldownProvider.notifier.request(...)` then
/// `context.go(AccidentDashboardRoute)`); the real Home panel needs the whole
/// role/permission stack, which is not what this test is about.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/navigation/list_drilldown.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_dashboard_screen.dart';

const AccidentRecord _open = AccidentRecord(
  id: 'acc-open',
  referenceNo: 'ACC-2026-0001',
  assetNo: 'TM100',
  site: 'NHC',
  incidentDate: '2026-05-11',
  status: 'under_review',
);

const AccidentRecord _closed = AccidentRecord(
  id: 'acc-closed',
  referenceNo: 'ACC-2026-0002',
  assetNo: 'TM200',
  site: 'NHC',
  incidentDate: '2026-05-10',
  status: 'closed',
);

final class _Repo implements AccidentRepository {
  @override
  Future<AccidentListPage> list({
    required int offset,
    required int pageSize,
    String? country,
    String? reporterId,
  }) async =>
      AccidentListPage(
        items: offset == 0
            ? const <AccidentRecord>[_open, _closed]
            : const <AccidentRecord>[],
        hasMore: false,
      );

  @override
  Future<AccidentRecord?> byId(String id) async => null;

  @override
  Future<AccidentCaseSnapshot?> caseById(String id, {String? country}) async =>
      null;
}

const Key _tile = Key('test.home.openAccidentsTile');
const Key _plainLink = Key('test.home.plainAccidentsLink');
const Key _otherTab = Key('test.otherTab');

Future<GoRouter> _pump(
  WidgetTester tester,
  DateTime Function() clock,
) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final GoRouter router = GoRouter(
    initialLocation: '/home',
    routes: <RouteBase>[
      StatefulShellRoute.indexedStack(
        builder: (
          BuildContext context,
          GoRouterState state,
          StatefulNavigationShell shell,
        ) =>
            shell,
        branches: <StatefulShellBranch>[
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/home',
                builder: (BuildContext context, GoRouterState state) =>
                    Consumer(
                  builder: (BuildContext context, WidgetRef ref, _) => Scaffold(
                    body: Column(
                      children: <Widget>[
                        TextButton(
                          key: _tile,
                          onPressed: () {
                            ref
                                .read(listDrilldownProvider.notifier)
                                .request(ListDrilldown.openAccidents);
                            context.go(const AccidentDashboardRoute().location);
                          },
                          child: const Text('Open accidents'),
                        ),
                        TextButton(
                          key: _plainLink,
                          onPressed: () => context
                              .go(const AccidentDashboardRoute().location),
                          child: const Text('Accidents'),
                        ),
                        TextButton(
                          key: _otherTab,
                          onPressed: () => context.go('/other'),
                          child: const Text('Other'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/other',
                builder: (BuildContext context, GoRouterState state) =>
                    const Scaffold(body: Text('other tab')),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: TpRoutePaths.accidentDashboard,
                builder: (BuildContext context, GoRouterState state) =>
                    const AccidentDashboardScreen(
                  route: AccidentDashboardRoute(),
                ),
              ),
            ],
          ),
        ],
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        accidentRepositoryProvider.overrideWithValue(_Repo()),
        listDrilldownClockProvider.overrideWithValue(clock),
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
  return router;
}

void _expectOpenOnly() {
  expect(
    find.byKey(AccidentDashboardScreenKeys.card(_open.id)),
    findsOneWidget,
  );
  expect(
    find.byKey(AccidentDashboardScreenKeys.card(_closed.id)),
    findsNothing,
  );
}

void _expectAll() {
  expect(
    find.byKey(AccidentDashboardScreenKeys.card(_open.id)),
    findsOneWidget,
  );
  expect(
    find.byKey(AccidentDashboardScreenKeys.card(_closed.id)),
    findsOneWidget,
  );
}

void main() {
  testWidgets(
    'the Open accidents tile lands on Open every time, even though the '
    'register stays mounted in the shell',
    (WidgetTester tester) async {
      final GoRouter router = await _pump(tester, DateTime.now);

      // First tap: the register is built for the first time.
      await tester.tap(find.byKey(_tile));
      await tester.pumpAndSettle();
      _expectOpenOnly();

      // The user widens the filter, then visits another tab.
      await tester.tap(
        find.byKey(AccidentDashboardScreenKeys.status('all')),
      );
      await tester.pumpAndSettle();
      _expectAll();
      router.go('/home');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(_otherTab));
      await tester.pumpAndSettle();
      router.go('/home');
      await tester.pumpAndSettle();

      // Second tap: the register is still mounted (initState does not rerun).
      await tester.tap(find.byKey(_tile));
      await tester.pumpAndSettle();
      _expectOpenOnly();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a normal visit after a drill-down is not pre-filtered',
    (WidgetTester tester) async {
      final GoRouter router = await _pump(tester, DateTime.now);

      await tester.tap(find.byKey(_tile));
      await tester.pumpAndSettle();
      _expectOpenOnly();
      await tester.tap(
        find.byKey(AccidentDashboardScreenKeys.status('all')),
      );
      await tester.pumpAndSettle();

      router.go('/home');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(_plainLink));
      await tester.pumpAndSettle();
      _expectAll();
    },
  );

  testWidgets(
    'a request nobody consumed expires and never filters a later visit',
    (WidgetTester tester) async {
      DateTime now = DateTime(2026, 11, 28, 9);
      final GoRouter router = await _pump(tester, () => now);
      final ProviderContainer container = ProviderScope.containerOf(
        tester.element(find.byKey(_tile)),
      );
      // A tap whose navigation never happened.
      container
          .read(listDrilldownProvider.notifier)
          .request(ListDrilldown.openAccidents);
      now = now.add(kListDrilldownTtl + const Duration(seconds: 1));

      router.go(const AccidentDashboardRoute().location);
      await tester.pumpAndSettle();
      _expectAll();
      expect(container.read(listDrilldownProvider), isNull);
    },
  );
}
