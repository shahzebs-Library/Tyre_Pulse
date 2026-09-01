import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_detail_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';

const String _dataImage =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

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
    expect(find.text('Accident'), findsOneWidget);
    expect(find.text('Mixer 3208'), findsOneWidget);
    expect(find.text('Reported on 11 May 2026'), findsOneWidget);
    expect(find.text('PROGRESS'), findsOneWidget);
    expect(find.text('Register insurance claim'), findsOneWidget);
    expect(find.text('Insurance Team'), findsOneWidget);
    expect(find.text('2026-09-03'), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.progress), findsOneWidget);
    expect(find.byType(AccidentProgressLadder), findsOneWidget);
    expect(find.bySemanticsLabel('Insurance, In progress'), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.nextAction), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.responsible), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.dueDate), findsOneWidget);
    expect(find.text('View Case Details'), findsOneWidget);
    expect(find.text('DESCRIPTION'), findsNothing);
    expect(find.text('EVIDENCE (4)'), findsNothing);
    await expectLater(
      find.byType(AccidentDetailScreen),
      matchesGoldenFile('goldens/accident_case_overview_light.png'),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('case detail exposes seven exclusive real-data role workspaces', (
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
    expect(find.byKey(AccidentCaseScreenKeys.incident), findsOneWidget);
    expect(find.text('Case Details'), findsOneWidget);
    expect(find.text('Step 1 of 7'), findsOneWidget);
    expect(find.text('Incident & damage'), findsWidgets);
    expect(find.textContaining('ACC-2026-0182'), findsWidgets);
    expect(find.textContaining('Mixer 3208'), findsOneWidget);
    expect(find.text('11 May 2026 • 08:15'), findsOneWidget);
    expect(
      find.text('Vehicle collided with barrier while reversing.'),
      findsOneWidget,
    );
    expect(find.text('CLM-8821'), findsNothing);
    expect(find.text('Central Workshop'), findsNothing);
    expect(find.text('Local workflow preview'), findsNothing);

    await tester.ensureVisible(find.text('2 Fleet validation'));
    await tester.tap(find.text('2 Fleet validation'));
    await tester.pumpAndSettle();
    expect(find.byKey(AccidentCaseScreenKeys.fleet), findsOneWidget);
    expect(find.text('Step 2 of 7'), findsOneWidget);
    expect(
      find.text('Vehicle collided with barrier while reversing.'),
      findsNothing,
    );

    await tester.ensureVisible(find.text('3 Responsibility & payer'));
    await tester.tap(find.text('3 Responsibility & payer'));
    await tester.pumpAndSettle();
    expect(find.byKey(AccidentCaseScreenKeys.responsibility), findsOneWidget);
    expect(find.text('Step 3 of 7'), findsOneWidget);
    expect(find.text('Driver'), findsOneWidget);
    expect(find.text('CLM-8821'), findsNothing);

    await tester.ensureVisible(find.text('4 Insurance / Claims'));
    await tester.tap(find.text('4 Insurance / Claims'));
    await tester.pumpAndSettle();
    expect(find.byKey(AccidentCaseScreenKeys.insurance), findsOneWidget);
    expect(find.text('Step 4 of 7'), findsOneWidget);
    expect(find.text('CLM-8821'), findsOneWidget);
    expect(
      find.text('Vehicle collided with barrier while reversing.'),
      findsNothing,
    );

    await tester.ensureVisible(find.text('5 Workshop assessment'));
    await tester.tap(find.text('5 Workshop assessment'));
    await tester.pumpAndSettle();
    expect(find.byKey(AccidentCaseScreenKeys.assessment), findsOneWidget);
    expect(find.text('Step 5 of 7'), findsOneWidget);
    expect(find.text('Central Workshop'), findsOneWidget);
    expect(find.text('CLM-8821'), findsNothing);

    await tester.ensureVisible(find.text('6 External workshop'));
    await tester.tap(find.text('6 External workshop'));
    await tester.pumpAndSettle();
    expect(find.byKey(AccidentCaseScreenKeys.externalWorkshop), findsOneWidget);
    expect(find.text('Step 6 of 7'), findsOneWidget);

    await tester.ensureVisible(find.text('7 Timeline & notifications'));
    await tester.tap(find.text('7 Timeline & notifications'));
    await tester.pumpAndSettle();
    expect(find.byKey(AccidentCaseScreenKeys.timeline), findsOneWidget);
    expect(find.text('Step 7 of 7'), findsOneWidget);
    expect(find.text('CLM-8821'), findsNothing);
    expect(find.text('Local workflow preview'), findsNothing);

    expect(find.byKey(AccidentCaseScreenKeys.readOnlyAction), findsOneWidget);
    await tester.tap(find.byKey(AccidentCaseScreenKeys.boundaryAction));
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
        privateStorageReferenceResolverProvider.overrideWithValue(
          PrivateStorageReferenceResolver(
            (String bucket, String path, int expiresIn) async => _dataImage,
          ),
        ),
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
