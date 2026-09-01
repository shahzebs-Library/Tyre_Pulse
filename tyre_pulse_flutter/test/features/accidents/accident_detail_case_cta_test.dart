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
import 'package:tyre_pulse/features/accidents/presentation/accident_case_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_detail_screen.dart';

const AccidentRecord _record = AccidentRecord(
  id: 'acc-1',
  referenceNo: 'ACC-2026-0182',
  assetNo: 'Mixer 3208',
  site: 'Diriyah',
  incidentDate: '2026-05-11 08:15',
  caseStatus: 'under_insurance_review',
  workflowStage: 'insurance',
  nextStep: 'Register insurance claim',
  expectedReleaseDate: '2026-09-03',
);

const AccidentCaseSnapshot _snapshot = AccidentCaseSnapshot(
  accident: _record,
  provisioned: true,
  workstreams: <AccidentWorkstream>[
    AccidentWorkstream(
      id: 'ws-evidence',
      key: 'incident_evidence',
      status: 'completed',
      required: true,
    ),
    AccidentWorkstream(
      id: 'ws-insurance',
      key: 'insurance',
      status: 'in_progress',
      required: true,
      team: 'Insurance Team',
    ),
  ],
);

final class _CaseRepository implements AccidentRepository {
  @override
  Future<AccidentRecord?> byId(String id) async => _record;

  @override
  Future<AccidentCaseSnapshot?> caseById(
    String id, {
    String? country,
  }) async =>
      _snapshot;

  @override
  Future<AccidentListPage> list({
    required int offset,
    required int pageSize,
    String? country,
    String? reporterId,
  }) async =>
      const AccidentListPage(items: <AccidentRecord>[], hasMore: false);
}

Future<GoRouter> _pumpFlow(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final GoRouter router = GoRouter(
    initialLocation: '/accidents/acc-1',
    routes: <RouteBase>[
      GoRoute(
        path: '/accidents/:accidentId/case',
        builder: (BuildContext context, GoRouterState state) =>
            AccidentCaseScreen(
          route: AccidentCaseRoute(
            accidentId: AccidentId(state.pathParameters['accidentId']!),
          ),
        ),
      ),
      GoRoute(
        path: '/accidents/:accidentId',
        builder: (BuildContext context, GoRouterState state) =>
            AccidentDetailScreen(
          route: AccidentDetailRoute(
            accidentId: AccidentId(state.pathParameters['accidentId']!),
          ),
        ),
      ),
    ],
  );
  addTearDown(router.dispose);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        accidentRepositoryProvider.overrideWithValue(_CaseRepository()),
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

Future<void> _dismissBoundary(WidgetTester tester) async {
  await tester.tapAt(const Offset(12, 120));
  await tester.pumpAndSettle();
  expect(find.text('Control boundary'), findsNothing);
}

void main() {
  testWidgets('detail menu explains its boundary and case CTA routes', (
    WidgetTester tester,
  ) async {
    await _pumpFlow(tester);

    await tester.tap(find.byKey(AccidentDetailScreenKeys.boundaryAction));
    await tester.pumpAndSettle();
    expect(find.text('Control boundary'), findsOneWidget);
    expect(
      find.textContaining('require verified server actions'),
      findsOneWidget,
    );
    await _dismissBoundary(tester);

    await tester.tap(find.widgetWithText(FilledButton, 'View Case Details'));
    await tester.pumpAndSettle();
    expect(find.byType(AccidentCaseScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('case shows read-only status and overflow explains boundary', (
    WidgetTester tester,
  ) async {
    final GoRouter router = await _pumpFlow(tester);
    router.go('/accidents/acc-1/case');
    await tester.pumpAndSettle();

    expect(find.byKey(AccidentCaseScreenKeys.readOnlyAction), findsOneWidget);
    expect(
      find.textContaining('offers no unsafe direct edits'),
      findsOneWidget,
    );

    await tester.tap(find.byKey(AccidentCaseScreenKeys.boundaryAction));
    await tester.pumpAndSettle();
    expect(find.text('Control boundary'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
