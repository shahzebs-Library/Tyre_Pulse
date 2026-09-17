import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/accidents/data/accident_claim_package_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_claim_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_insurance_claim.dart';

import 'accident_ws_test_support.dart';

const AccidentRecord _record = AccidentRecord(
  id: 'case-1',
  assetNo: 'CP045',
  site: 'Verified yard',
  incidentDate: '2026-09-01',
  referenceNo: 'ACC-2026-0148',
  insurer: 'Recorded insurer',
  policyNo: 'POL-77',
  claimAmount: 1000,
  deductible: 250,
  liableParty: 'Other Party',
);

const AccidentCaseSnapshot _snapshot = AccidentCaseSnapshot(
  accident: _record,
  provisioned: true,
  workstreams: <AccidentWorkstream>[
    AccidentWorkstream(
      id: 'ins',
      key: 'insurance',
      status: 'in_progress',
      team: 'Insurance',
      ownerRole: 'Insurance Officer',
    ),
    AccidentWorkstream(
      id: 'fleet',
      key: 'fleet_validation',
      status: 'completed',
      ownerRole: 'Fleet Supervisor',
    ),
  ],
);

void _seedDocs(FakeAccidentCaseRows rows, {Set<String> except = const {}}) {
  for (final VocabItem doc in claimPackageDocs) {
    if (except.contains(doc.key)) continue;
    final int copies = doc.countable ? 9 : 1;
    for (int i = 0; i < copies; i++) {
      rows.seed(SupabaseTables.accidentEvidence, <String, dynamic>{
        'accident_id': 'case-1',
        'workstream_key': 'insurance',
        'requirement_key': doc.key,
        'kind': 'document',
        'uploaded_at': '2026-09-15T10:0$i:00Z',
      });
    }
  }
}

List<Override> _overrides(
  FakeAccidentCaseRows rows, {
  Map<String, dynamic>? claimRow,
}) =>
    <Override>[
      accidentClaimPackageRepositoryProvider.overrideWithValue(
        AccidentClaimPackageRepository(
          rows,
          AccidentClaimRepository(
            (String id) async => claimRow,
            (String name, Map<String, dynamic> params) async =>
                <String, dynamic>{
              'ok': true,
              'claim': <String, dynamic>{
                'id': 'claim-1',
                'insurer': params['p_insurer'],
                'claim_no': params['p_claim_no'],
                'decision': 'registered',
              },
            },
          ),
        ),
      ),
    ];

Widget _widget({void Function(String)? onNavigate}) =>
    AccidentInsuranceClaimMockWorkspace(
      snapshot: _snapshot,
      onNavigate: onNavigate ?? (_) {},
    );

void main() {
  testWidgets('7 of 8 documents locks registration and derives net claimable',
      (WidgetTester tester) async {
    final FakeAccidentCaseRows rows = FakeAccidentCaseRows();
    _seedDocs(rows, except: <String>{'driving_licence'});
    await pumpAccidentWorkspace(
      tester,
      _widget(),
      overrides: _overrides(rows),
    );
    expect(find.text('7 of 8 required documents'), findsOneWidget);
    expect(find.text('9 received'), findsOneWidget);
    expect(find.text('Missing'), findsOneWidget);
    expect(
      find.text(
        'Claim registration unlocks when all required documents are complete.',
      ),
      findsOneWidget,
    );
    expect(find.text('Request driving licence'), findsOneWidget);
    expect(find.text('Auto-generated after registration'), findsOneWidget);
    expect(find.text('Not registered'), findsOneWidget);
    expect(find.text('Other Party'), findsOneWidget);
    expect(find.text('$testCurrency 750.00'), findsOneWidget);
    final TpButton register = tester.widget<TpButton>(
      find.byKey(const Key('accident.ws.insurance.register')),
    );
    expect(register.onPressed, isNull);
    expect(
      find.text('Enable once all required documents are complete.'),
      findsOneWidget,
    );
    expect(find.text('Fleet Supervisor · Fleet'), findsOneWidget);
    expect(find.textContaining('(for visibility)'), findsOneWidget);
    expect(
      find.textContaining('is monitoring SLA and missing documents.'),
      findsOneWidget,
    );
    expect(find.textContaining('Ms. Fatima'), findsNothing);
    expect(find.textContaining('SAR'), findsNothing);
    final TpButton recovery = tester.widget<TpButton>(
      find.byKey(const Key('accident.ws.insurance.updateRecovery')),
    );
    expect(recovery.onPressed, isNull);
  });

  testWidgets('requesting a missing document logs a case communication',
      (WidgetTester tester) async {
    final FakeAccidentCaseRows rows = FakeAccidentCaseRows();
    _seedDocs(rows, except: <String>{'driving_licence'});
    await pumpAccidentWorkspace(
      tester,
      _widget(),
      overrides: _overrides(rows),
    );
    final Finder request = find.text('Request driving licence');
    await reveal(tester, request);
    await tester.tap(request);
    await tester.pumpAndSettle();
    final List<Map<String, dynamic>> log =
        rows.table(SupabaseTables.accidentCaseCommunications);
    expect(log, hasLength(1));
    expect(log.single['channel'], 'in_app');
    expect(log.single['direction'], 'internal');
    expect(log.single['workstream_key'], 'insurance');
    expect(log.single['subject'], 'Document requested: Driving licence');
    expect(log.single['country'], 'UAE');
    expect(
      find.text('Request for Driving licence logged on the case.'),
      findsOneWidget,
    );
  });

  testWidgets(
      'a registered claim shows its status, allows recovery entry and says '
      'when recoveries are not provisioned', (WidgetTester tester) async {
    final FakeAccidentCaseRows rows = FakeAccidentCaseRows(
      missingTables: <String>{SupabaseTables.accidentClaimRecoveries},
    );
    _seedDocs(rows);
    rows.seed(SupabaseTables.accidentRepairOrders, <String, dynamic>{
      'accident_id': 'case-1',
      'repair_route': 'external',
    });
    await pumpAccidentWorkspace(
      tester,
      _widget(),
      overrides: _overrides(
        rows,
        claimRow: <String, dynamic>{
          'id': 'claim-1',
          'insurer': 'Recorded insurer',
          'policy_no': 'POL-77',
          'claim_no': 'INS-9',
          'deductible': 250,
          'approved_amount': 900,
          'decision': 'approved',
          'case_claim_amount': 1000,
        },
      ),
    );
    expect(find.text('8 of 8 required documents'), findsOneWidget);
    expect(find.text('External repair assessment'), findsOneWidget);
    expect(find.text('INS-9'), findsOneWidget);
    expect(find.text('Approved'), findsOneWidget);
    expect(find.text('$testCurrency 900.00'), findsWidgets);
    expect(
      find.text('Claim recoveries is not provisioned yet on this database.'),
      findsOneWidget,
    );
    final TpButton register = tester.widget<TpButton>(
      find.byKey(const Key('accident.ws.insurance.register')),
    );
    expect(register.onPressed, isNull);
    expect(find.text('Claim registered with insurer'), findsOneWidget);
    final Finder update =
        find.byKey(const Key('accident.ws.insurance.updateRecovery'));
    await reveal(tester, update);
    expect(tester.widget<TpButton>(update).onPressed, isNotNull);
    await tester.tap(update);
    await tester.pumpAndSettle();
    expect(find.text('Save recovery'), findsOneWidget);
  });
}
