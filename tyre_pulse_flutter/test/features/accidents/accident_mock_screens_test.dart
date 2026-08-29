import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_detail_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';

void main() {
  testWidgets('case overview matches the approved compact hierarchy', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const AccidentDetailScreen(
        route: AccidentDetailRoute(accidentId: AccidentId('acc-1')),
      ),
    );

    expect(find.text('ACC-2026-0182'), findsOneWidget);
    expect(find.text('Mixer 3208'), findsOneWidget);
    expect(find.text('Register insurance claim'), findsOneWidget);
    expect(find.text('Insurance Team'), findsOneWidget);
    expect(find.text('2026-09-03'), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.progress), findsOneWidget);
    expect(find.byType(AccidentProgressLadder), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.nextAction), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.responsible), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.dueDate), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('case detail exposes the five real-data tabs and read-only gate',
      (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const AccidentCaseScreen(
        route: AccidentCaseRoute(accidentId: AccidentId('acc-1')),
      ),
    );

    expect(find.byKey(AccidentCaseScreenKeys.tabs), findsOneWidget);
    expect(find.byKey(AccidentCaseScreenKeys.overview), findsOneWidget);
    expect(find.byKey(AccidentCaseScreenKeys.header), findsOneWidget);
    expect(find.text('ACC-2026-0182 • Mixer 3208'), findsOneWidget);
    expect(
      find.text('Vehicle collided with barrier while reversing.'),
      findsOneWidget,
    );
    expect(find.text('EVIDENCE (4)'), findsOneWidget);

    await tester.tap(find.text('Evidence'));
    await tester.pumpAndSettle();
    expect(find.byKey(AccidentCaseScreenKeys.evidence), findsOneWidget);

    await tester.tap(find.text('Insurance'));
    await tester.pumpAndSettle();
    expect(find.byKey(AccidentCaseScreenKeys.insurance), findsOneWidget);
    expect(find.text('CLM-8821'), findsOneWidget);

    await tester.tap(find.text('Repair'));
    await tester.pumpAndSettle();
    expect(find.byKey(AccidentCaseScreenKeys.repair), findsOneWidget);
    expect(find.text('Central Workshop'), findsOneWidget);

    await tester.ensureVisible(find.text('Closure controls'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Closure controls'));
    await tester.pumpAndSettle();
    expect(find.byKey(AccidentCaseScreenKeys.more), findsOneWidget);

    await tester.tap(find.byKey(AccidentCaseScreenKeys.readOnlyAction));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('require verified server actions'),
      findsWidgets,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('case detail preserves RTL without horizontal overflow', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const AccidentCaseScreen(
        route: AccidentCaseRoute(accidentId: AccidentId('acc-1')),
      ),
      locale: const Locale('ar'),
    );

    expect(
      Directionality.of(
        tester.element(find.byKey(AccidentCaseScreenKeys.overview)),
      ),
      TextDirection.rtl,
    );
    expect(tester.takeException(), isNull);
  });
}

Future<void> _pump(
  WidgetTester tester,
  Widget home, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        accidentRepositoryProvider.overrideWithValue(_FakeRepository()),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: home,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

final class _FakeRepository implements AccidentRepository {
  static const AccidentRecord record = AccidentRecord(
    id: 'acc-1',
    referenceNo: 'ACC-2026-0182',
    assetNo: 'Mixer 3208',
    site: 'Diriyah',
    incidentDate: '2026-05-11 08:15',
    location: 'Diriyah',
    caseStatus: 'under_insurance_review',
    workflowStage: 'insurance',
    description: 'Vehicle collided with barrier while reversing.',
    reporterName: 'Ahmed K.',
    photos: <String>[
      'tp-storage://accident-photos/evidence-1.jpg',
      'tp-storage://accident-photos/evidence-2.jpg',
      'tp-storage://accident-photos/evidence-3.jpg',
      'tp-storage://accident-photos/evidence-4.jpg',
    ],
    nextStep: 'Register insurance claim',
    insurer: 'Insurer record',
    insuranceClaimNo: 'CLM-8821',
    claimStatus: 'pending',
    repairType: 'internal',
    workshopName: 'Central Workshop',
    expectedReleaseDate: '2026-09-03',
    faultStatus: 'under_review',
    responsibleParty: 'driver',
    liableParty: 'pending',
    payer: 'pending',
  );

  static const AccidentCaseSnapshot snapshot = AccidentCaseSnapshot(
    accident: record,
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
      AccidentWorkstream(
        id: 'ws-repair',
        key: 'repair',
        status: 'not_started',
        required: true,
      ),
    ],
  );

  @override
  Future<AccidentRecord?> byId(String id) async => record;

  @override
  Future<AccidentCaseSnapshot?> caseById(String id, {String? country}) async =>
      snapshot;

  @override
  Future<AccidentListPage> list({
    required int offset,
    required int pageSize,
    String? country,
    String? reporterId,
  }) async =>
      const AccidentListPage(items: <AccidentRecord>[], hasMore: false);
}
