import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_docs_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_fleet_validation_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_sla_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_workstream_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_fleet_validation.dart';

const WorkspaceContext _context = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  fullName: 'Signed-in reviewer',
  activeCountry: 'KSA',
);

const AccidentRecord _record = AccidentRecord(
  id: 'case-1',
  assetNo: 'CP-045',
  site: 'Riyadh yard',
  location: 'Gate 3',
  incidentDate: '2026-09-16',
  accidentType: 'collision',
  severity: 'severe',
  status: 'reported',
  driverName: 'Recorded driver',
  injuries: false,
  thirdPartyInvolved: true,
  policeReportNo: 'POL-77',
  photos: <String>['tp-storage://accident-photos/a/1.jpg'],
);

const AccidentCaseSnapshot _snapshot = AccidentCaseSnapshot(
  accident: _record,
  provisioned: true,
  workstreams: <AccidentWorkstream>[
    AccidentWorkstream(id: 'f', key: 'fleet_validation', team: 'Fleet'),
    AccidentWorkstream(id: 'i', key: 'insurance', team: 'Insurance'),
    AccidentWorkstream(id: 'a', key: 'assessment', status: 'completed'),
  ],
);

final class _Fakes {
  final List<Map<String, dynamic>> items = <Map<String, dynamic>>[];
  final List<Map<String, Object?>> upserts = <Map<String, Object?>>[];
  final List<Map<String, Object?>> inserts = <Map<String, Object?>>[];
  final List<Map<String, dynamic>> rpcCalls = <Map<String, dynamic>>[];
  bool provisioned = true;

  List<Override> overrides() => <Override>[
        workspaceContextProvider.overrideWithValue(_context),
        accidentSlaRepositoryProvider.overrideWithValue(
          AccidentSlaRepository((_) async => <Map<String, dynamic>>[]),
        ),
        accidentFleetValidationRepositoryProvider.overrideWithValue(
          AccidentFleetValidationRepository(
            read: (_) async {
              if (!provisioned) {
                throw const PostgrestException(message: 'x', code: '42P01');
              }
              return items;
            },
            upsert: (Map<String, Object?> row) async {
              upserts.add(row);
              return <String, dynamic>{...row, 'id': 'row-${upserts.length}'};
            },
          ),
        ),
        accidentCaseDocsRepositoryProvider.overrideWithValue(
          AccidentCaseDocsRepository(
            read: (_) async => <Map<String, dynamic>>[],
            insert: (String table, Map<String, Object?> row) async {
              inserts.add(<String, Object?>{'table': table, ...row});
              return <String, dynamic>{...row, 'id': 'c1'};
            },
            upload: (_, __, ___, ____) async {},
            currentUserId: () => 'user-1',
          ),
        ),
        accidentWorkstreamRepositoryProvider.overrideWithValue(
          AccidentWorkstreamRepository((String name, Map<String, dynamic> p) {
            rpcCalls.add(<String, dynamic>{'name': name, ...p});
            return Future<dynamic>.value(<String, dynamic>{'ok': true});
          }),
        ),
      ];
}

Future<void> _pump(
  WidgetTester tester,
  _Fakes fakes, {
  void Function(String key)? onNavigate,
}) async {
  tester.view.physicalSize = const Size(360, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: fakes.overrides(),
      child: MaterialApp(
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(
          body: SingleChildScrollView(
            child: AccidentFleetValidationMockWorkspace(
              snapshot: _snapshot,
              onNavigate: onNavigate ?? (_) {},
              onOpenIncident: () {},
              now: DateTime(2026, 9, 16, 15),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

TpButton _button(WidgetTester tester, String key) =>
    tester.widget<TpButton>(find.byKey(Key(key)));

void main() {
  testWidgets('summary, checklist and notify block read only recorded facts',
      (WidgetTester tester) async {
    final _Fakes fakes = _Fakes()
      ..items.add(<String, dynamic>{
        'id': 'p',
        'item_key': 'required_photographs',
        'state': 'done',
        'count_done': 7,
        'count_required': 7,
        'checked_by_name': 'Recorded checker',
        'checked_at': '2026-09-16T14:40:00Z',
      });
    await _pump(tester, fakes);

    expect(find.text('Major accident'), findsOneWidget);
    expect(find.text('Open'), findsOneWidget);
    expect(
      find.text('Workstream 1 of 7: Fleet validation | Owner: Fleet'),
      findsOneWidget,
    );
    expect(find.text('Incident summary'), findsOneWidget);
    expect(find.text('Type: Collision'), findsOneWidget);
    expect(find.text('Location: Riyadh yard · Gate 3'), findsOneWidget);
    expect(find.text('0 marked damage areas · 1 photos'), findsOneWidget);
    expect(find.text('No injuries'), findsOneWidget);
    expect(find.text('Third party involved'), findsOneWidget);
    expect(find.text('View complete incident report'), findsOneWidget);

    expect(find.text('Fleet validation checklist'), findsOneWidget);
    expect(
      find.textContaining('7 of 7'),
      findsOneWidget,
      reason: 'the stored count is printed as done of required',
    );
    expect(find.textContaining('Recorded checker'), findsOneWidget);
    expect(
      find.textContaining('1 missing'),
      findsOneWidget,
      reason: 'police number exists, Najm does not',
    );
    expect(
      find.text('Najm report is missing. Claim registration cannot start.'),
      findsOneWidget,
    );
    expect(find.text('Assigned recipient'), findsOneWidget);
    expect(find.text('Insurance'), findsWidgets);
    expect(find.text('Send when required documents complete'), findsOneWidget);
    expect(find.text('Command Center is monitoring SLA'), findsOneWidget);
    expect(
      find.text('Complete Fleet validation and notify Insurance'),
      findsOneWidget,
    );
    expect(
      _button(tester, 'accident.fleet.complete').onPressed,
      isNull,
      reason: 'the checklist is not complete',
    );
    expect(find.textContaining('Ms.'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tapping a row upserts it and completing calls the RPC',
      (WidgetTester tester) async {
    final _Fakes fakes = _Fakes();
    for (final String key in <String>[
      'asset_driver_confirmed',
      'incident_facts_confirmed',
      'damage_map_reviewed',
      'required_photographs',
    ]) {
      fakes.items.add(<String, dynamic>{
        'id': key,
        'item_key': key,
        'state': 'done',
      });
    }
    await _pump(tester, fakes);
    expect(_button(tester, 'accident.fleet.complete').onPressed, isNull);

    final Finder police =
        find.byKey(const Key('accident.fleet.item.police_najm_documents'));
    await tester.ensureVisible(police);
    await tester.tap(police);
    await tester.pumpAndSettle();

    expect(fakes.upserts, hasLength(1));
    expect(fakes.upserts.single['item_key'], 'police_najm_documents');
    expect(fakes.upserts.single['state'], 'done');
    expect(fakes.upserts.single['checked_by_name'], 'Signed-in reviewer');
    expect(fakes.upserts.single['accident_id'], 'case-1');

    expect(
      _button(tester, 'accident.fleet.complete').onPressed,
      isNotNull,
      reason: 'the assessment workstream is completed, all six satisfied',
    );
    await tester.ensureVisible(
      find.byKey(const Key('accident.fleet.complete')),
    );
    await tester.tap(find.byKey(const Key('accident.fleet.complete')));
    await tester.pumpAndSettle();

    expect(fakes.rpcCalls, hasLength(1));
    expect(fakes.rpcCalls.single['name'], 'accident_ws_set_status');
    expect(fakes.rpcCalls.single['p_workstream_key'], 'fleet_validation');
    expect(fakes.rpcCalls.single['p_status'], 'completed');
    expect(fakes.inserts.last['table'], 'accident_case_communications');
    expect(find.text('Fleet validation completed'), findsOneWidget);
  });

  testWidgets('request missing document logs a timeline row',
      (WidgetTester tester) async {
    final _Fakes fakes = _Fakes();
    String? navigated;
    await _pump(tester, fakes, onNavigate: (String key) => navigated = key);

    final Finder request = find.byKey(const Key('accident.fleet.requestDoc'));
    await tester.ensureVisible(request);
    await tester.tap(request);
    await tester.pumpAndSettle();

    expect(fakes.inserts, hasLength(1));
    expect(fakes.inserts.single['table'], 'accident_case_communications');
    expect(fakes.inserts.single['channel'], 'in_app');
    expect(fakes.inserts.single['direction'], 'internal');
    expect(fakes.inserts.single['workstream_key'], 'fleet_validation');
    expect(fakes.inserts.single['body'], 'Najm Report');
    expect(find.text('Logged on the case timeline'), findsOneWidget);

    await tester.ensureVisible(
      find.byKey(const Key('accident.fleet.open.police_najm_documents')),
    );
    await tester.tap(
      find.byKey(const Key('accident.fleet.open.police_najm_documents')),
    );
    expect(navigated, 'liability');
  });

  testWidgets('a missing checklist table is stated, never ticked',
      (WidgetTester tester) async {
    final _Fakes fakes = _Fakes()..provisioned = false;
    await _pump(tester, fakes);
    expect(
      find.byKey(const Key('accident.fleet.notProvisioned')),
      findsOneWidget,
    );
    final Finder row =
        find.byKey(const Key('accident.fleet.item.asset_driver_confirmed'));
    await tester.ensureVisible(row);
    await tester.tap(row);
    await tester.pumpAndSettle();
    expect(fakes.upserts, isEmpty);
    expect(_button(tester, 'accident.fleet.complete').onPressed, isNull);
    expect(tester.takeException(), isNull);
  });
}
