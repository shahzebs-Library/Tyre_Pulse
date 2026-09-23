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
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_docs_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_liability_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_responsibility.dart';

const WorkspaceContext _context = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  fullName: 'Signed-in reviewer',
  activeCountry: 'KSA',
);

const AccidentCaseSnapshot _snapshot = AccidentCaseSnapshot(
  accident: AccidentRecord(
    id: 'case-1',
    assetNo: 'CP-045',
    site: 'Riyadh yard',
    incidentDate: '2026-09-16',
    policeReportNo: 'POL-77',
    najmStatus: 'pending',
  ),
  provisioned: true,
  workstreams: <AccidentWorkstream>[
    AccidentWorkstream(id: 'l', key: 'liability', team: 'Fleet'),
    AccidentWorkstream(
      id: 'i',
      key: 'insurance',
      team: 'Insurance',
      ownerRole: 'Insurance Officer',
    ),
  ],
);

/// In-memory secure store so the device draft is real in the test.
final class _MemoryStore extends SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    final String? value = values[key];
    return value == null ? const SecureRead.absent() : SecureRead.ok(value);
  }

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

final class _Fakes {
  final List<Map<String, dynamic>> assessments = <Map<String, dynamic>>[];
  final List<Map<String, dynamic>> authority = <Map<String, dynamic>>[];
  final List<Map<String, dynamic>> evidence = <Map<String, dynamic>>[];
  final List<Map<String, Object?>> inserts = <Map<String, Object?>>[];
  final List<Map<String, Object?>> updates = <Map<String, Object?>>[];
  final _MemoryStore store = _MemoryStore();
  bool extendedProvisioned = true;
  int _ids = 0;

  List<Override> overrides() => <Override>[
        workspaceContextProvider.overrideWithValue(_context),
        secureStoreProvider.overrideWithValue(store),
        accidentLiabilityRepositoryProvider.overrideWithValue(
          AccidentLiabilityRepository(
            read: (String table, String columns, Map<String, Object> f) async {
              if (table == 'accident_authority_reports') return authority;
              if (columns.contains('field_audit') && !extendedProvisioned) {
                throw const PostgrestException(message: 'x', code: '42703');
              }
              return assessments;
            },
            insert: (String table, Map<String, Object?> row) async {
              inserts.add(<String, Object?>{'table': table, ...row});
              return <String, dynamic>{...row, 'id': 'new-${++_ids}'};
            },
            update: (String table, String id, Map<String, Object?> p) async {
              updates.add(<String, Object?>{'table': table, 'id': id, ...p});
              return <String, dynamic>{...p, 'id': id};
            },
          ),
        ),
        accidentCaseDocsRepositoryProvider.overrideWithValue(
          AccidentCaseDocsRepository(
            read: (_) async => evidence,
            insert: (String table, Map<String, Object?> row) async {
              inserts.add(<String, Object?>{'table': table, ...row});
              return <String, dynamic>{...row, 'id': 'c${++_ids}'};
            },
            upload: (_, __, ___, ____) async {},
            currentUserId: () => 'user-1',
          ),
        ),
      ];
}

Future<void> _pump(
  WidgetTester tester,
  _Fakes fakes, {
  void Function(String key)? onNavigate,
}) async {
  tester.view.physicalSize = const Size(360, 1400);
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
            child: AccidentResponsibilityMockWorkspace(
              snapshot: _snapshot,
              onNavigate: onNavigate ?? (_) {},
              now: DateTime(2026, 9, 16, 15),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tapKey(WidgetTester tester, String key) async {
  final Finder finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('eyebrow, owners, tiles and derived rows follow the record',
      (WidgetTester tester) async {
    final _Fakes fakes = _Fakes();
    await _pump(tester, fakes);

    expect(find.text('4 of 7 · Responsibility and payment'), findsOneWidget);
    expect(
      find.text('Owner: Fleet | Insurance review: Insurance / '
          'Insurance Officer'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('accident.resp.draftChip')), findsNothing);
    expect(find.text('Who was at fault?'), findsOneWidget);
    expect(find.text('Who will pay?'), findsOneWidget);
    expect(find.text('Third-party and authority details'), findsOneWidget);
    expect(find.text('Responsibility documents'), findsOneWidget);
    expect(find.text('0 of 6 required documents'), findsOneWidget);
    expect(find.text('POL-77'), findsOneWidget);
    expect(
      find.text('Provisional until authority/insurer confirmation.'),
      findsOneWidget,
    );
    expect(find.textContaining('Ms.'), findsNothing);
    expect(find.textContaining('Al Noor'), findsNothing);
    expect(tester.takeException(), isNull);

    await _tapKey(tester, 'accident.resp.fault.third_party_full');
    expect(find.text('Non-faulty'), findsOneWidget);
    expect(find.text('0%'), findsOneWidget);
    expect(find.text('100%'), findsOneWidget);
    expect(
      find.byKey(const Key('accident.resp.draftChip')),
      findsOneWidget,
      reason: 'an unsaved edit is a real device draft',
    );
    expect(find.text('Draft saved on device'), findsOneWidget);
    expect(fakes.store.values, isNotEmpty);

    await _tapKey(tester, 'accident.resp.payer.other_party_insurance');
    expect(find.text('Other party'), findsWidgets);
    expect(find.text('Yes · Auto'), findsOneWidget);
  });

  testWidgets('save writes the assessment and clears the device draft',
      (WidgetTester tester) async {
    final _Fakes fakes = _Fakes();
    String? navigated;
    await _pump(tester, fakes, onNavigate: (String key) => navigated = key);

    await _tapKey(tester, 'accident.resp.fault.our_driver_full');
    await _tapKey(tester, 'accident.resp.payer.our_insurance');
    await _tapKey(tester, 'accident.resp.row.taqdeer_required');
    final TpSegmented<String> editor = tester.widget<TpSegmented<String>>(
      find.byKey(const Key('accident.resp.editor.taqdeerRequired')),
    );
    editor.onChanged!('yes');
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('accident.resp.taqdeerWarning')),
      findsOneWidget,
    );
    expect(
      tester
          .widget<TpButton>(
            find.byKey(const Key('accident.resp.requestTaqdeer')),
          )
          .onPressed,
      isNotNull,
    );

    await _tapKey(tester, 'accident.resp.save');
    final Map<String, Object?> saved = fakes.inserts.firstWhere(
      (Map<String, Object?> row) =>
          row['table'] == 'accident_liability_assessments',
    );
    expect(saved['accident_id'], 'case-1');
    expect(saved['liability_type'], 'our_driver_full');
    expect(saved['our_liability_pct'], 100);
    expect(saved['payer'], 'our_insurance');
    expect(saved['taqdeer_required'], isTrue);
    final Map<String, Object?> audit = (saved['field_audit']!
        as Map<String, Object?>)['taqdeer_required']! as Map<String, Object?>;
    expect(audit['recorded_by'], 'Signed-in reviewer');
    expect(find.text('Responsibility details saved'), findsOneWidget);
    expect(find.byKey(const Key('accident.resp.draftChip')), findsNothing);
    expect(fakes.store.values, isEmpty);

    await _tapKey(tester, 'accident.resp.requestTaqdeer');
    expect(
      fakes.inserts.last['table'],
      'accident_case_communications',
    );
    expect(
      fakes.inserts.last['subject'],
      'Missing Taqdeer document requested',
    );

    // Two queued toasts (saved, then requested) sit over the footer on a
    // phone; let both expire before pressing Continue.
    for (int i = 0; i < 2; i++) {
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
    }
    await _tapKey(tester, 'accident.resp.continue');
    expect(navigated, 'damage_map');
  });

  testWidgets('without the migration the base fields still save',
      (WidgetTester tester) async {
    final _Fakes fakes = _Fakes()..extendedProvisioned = false;
    fakes.assessments.add(<String, dynamic>{
      'id': 'existing',
      'liability_type': 'shared',
      'our_liability_pct': 50,
      'third_party_pct': 50,
    });
    await _pump(tester, fakes);
    expect(
      find.byKey(const Key('accident.resp.notProvisioned')),
      findsOneWidget,
    );
    final TpSegmented<String> verify = tester.widget<TpSegmented<String>>(
      find.byKey(const Key('accident.resp.verify.third_party_plate')),
    );
    expect(verify.onChanged, isNull);

    await _tapKey(tester, 'accident.resp.save');
    expect(fakes.updates, hasLength(1));
    expect(fakes.updates.single['id'], 'existing');
    expect(fakes.updates.single['liability_type'], 'shared');
    expect(fakes.updates.single.containsKey('payer'), isFalse);
    expect(tester.takeException(), isNull);
  });
}
