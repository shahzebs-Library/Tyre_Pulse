import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/driver_workspace/data/driver_charge_repository.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_charge.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_workspace.dart';
import 'package:tyre_pulse/features/driver_workspace/presentation/driver_charges_panel.dart';

DriverRow _detail({List<String> actions = const <String>[]}) =>
    <String, Object?>{
      'access': 'driver',
      'actions': actions,
      'charge': <String, Object?>{
        'id': 'c1',
        'driver_id': 'd1',
        'charge_no': 'DC-2026-00001',
        'version': 3,
        'category': 'traffic_fine',
        'source_type': 'driver_fine',
        'source_summary': <String, Object?>{'label': 'RTA-55'},
        'amount': 250,
        'currency': 'SAR',
        'deducted_amount': 0,
        'status': 'notified',
        'basis': 'Speeding fine while assigned.',
      },
      'driver': <String, Object?>{'driver_name': 'Driver A'},
      'evidence': <DriverRow>[],
      'signatures': <DriverRow>[],
      'decisions': <DriverRow>[],
      'appeal': null,
      'instalments': <DriverRow>[],
      'events': <DriverRow>[],
      'statements': <String, Object?>{
        'deduction-consent-v1': 'I accept and consent.',
        'receipt-dispute-v1': 'I received this and dispute it.',
        'refusal-witness-v1': 'I witnessed the refusal.',
      },
      'settings': <String, Object?>{'cap_pct': 20, 'appeal_window_days': 7},
    };

final class _FakeRepo implements DriverChargeRepository {
  _FakeRepo(this.detailData, {this.offline = false});
  final DriverRow detailData;
  final bool offline;
  final List<(String, DriverRow, String)> commands =
      <(String, DriverRow, String)>[];

  @override
  Future<DriverRow> command(
    String action,
    DriverRow payload,
    String requestId,
  ) async {
    if (offline) throw const ChargeOfflineFailure();
    commands.add((action, payload, requestId));
    return <String, Object?>{'id': 'c1', 'action': action};
  }

  @override
  Future<DriverChargeDetail> detail(String chargeId) async =>
      DriverChargeDetail(detailData);

  @override
  Future<DriverChargePage> list({
    required String driverId,
    int offset = 0,
  }) async =>
      const DriverChargePage(rows: <DriverRow>[], hasMore: false);
}

Widget _app(_FakeRepo repo, Widget child) => ProviderScope(
      overrides: <Override>[
        driverChargeRepositoryProvider.overrideWithValue(repo),
      ],
      child: MaterialApp(
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: child,
      ),
    );

void main() {
  test('outstanding is grouped per currency and never summed across them', () {
    expect(
      chargeOutstandingByCurrency(<DriverRow>[
        <String, Object?>{
          'currency': 'SAR',
          'amount': 100,
          'deducted_amount': 20,
          'status': 'scheduled',
        },
        <String, Object?>{
          'currency': 'AED',
          'amount': 50,
          'status': 'notified',
        },
        <String, Object?>{'currency': 'SAR', 'amount': 70, 'status': 'waived'},
        <String, Object?>{
          'currency': 'SAR',
          'outstanding': 10.01,
          'status': 'accepted',
        },
      ]),
      <ChargeOutstanding>[
        const ChargeOutstanding('SAR', 90.01),
        const ChargeOutstanding('AED', 50),
      ],
    );
  });

  test('a response needs the statement confirmed and a signature', () {
    expect(
      validateChargeResponse(
        response: DriverChargeResponse.dispute,
        explanation: 'no',
        acknowledged: true,
        signature: 'x',
      ),
      DriverChargeIssue.explanation,
    );
    expect(
      validateChargeResponse(
        response: DriverChargeResponse.accept,
        explanation: '',
        acknowledged: false,
        signature: 'x',
      ),
      DriverChargeIssue.acknowledgement,
    );
    expect(
      validateChargeResponse(
        response: DriverChargeResponse.accept,
        explanation: '',
        acknowledged: true,
        signature: null,
      ),
      DriverChargeIssue.signature,
    );
    expect(validateChargeAppeal('too short'), DriverChargeIssue.reason);
    expect(
      validateChargeAppeal('The fine was issued to another vehicle.'),
      isNull,
    );
  });

  test('payloads carry the contract fields, version and statement', () {
    final DriverRow payload = chargeResponsePayload(
      charge: DriverChargeDetail(_detail()).charge,
      response: DriverChargeResponse.dispute,
      explanation: '  I was not driving that day.  ',
      signature: 'data:image/png;base64,AAAA',
    );
    expect(payload, <String, Object?>{
      'driver_id': 'd1',
      'charge_id': 'c1',
      'version': 3,
      'response': 'dispute',
      'statement_version': 'receipt-dispute-v1',
      'statement_language': 'en',
      'acknowledged': true,
      'signature': 'data:image/png;base64,AAAA',
      'explanation': 'I was not driving that day.',
    });
    expect(
      chargeAppealPayload(
        charge: DriverChargeDetail(_detail()).charge,
        reason: ' The vehicle was in the workshop. ',
      ),
      <String, Object?>{
        'driver_id': 'd1',
        'charge_id': 'c1',
        'version': 3,
        'reason': 'The vehicle was in the workshop.',
      },
    );
  });

  test('the phone only offers driver actions the server returned', () {
    final DriverChargeDetail detail = DriverChargeDetail(
      _detail(
        actions: <String>[
          'charge_respond',
          'charge_waive',
          'charge_finance_review',
        ],
      ),
    );
    expect(detail.mobileActions, <String>{'charge_respond'});
    expect(
      DriverChargeDetail(
        _detail(actions: <String>['charge_witness_confirm', 'charge_waive']),
      ).mobileActions,
      <String>{'charge_witness_confirm'},
    );
    expect(DriverChargeDetail(_detail()).mobileActions, isEmpty);
  });

  testWidgets('no respond button unless the server allows it',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _app(
          _FakeRepo(_detail()), const DriverChargeDetailScreen(chargeId: 'c1'),),
    );
    await tester.pumpAndSettle();
    expect(find.text('Respond to this charge'), findsNothing);
    expect(
      find.text('No action is waiting for you on this charge.'),
      findsOneWidget,
    );
  });

  testWidgets('the exact server statement is shown before signing',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final _FakeRepo repo =
        _FakeRepo(_detail(actions: <String>['charge_respond']));
    await tester.pumpWidget(
      _app(repo, const DriverChargeDetailScreen(chargeId: 'c1')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Respond to this charge'));
    await tester.pumpAndSettle();
    expect(find.text('I accept and consent.'), findsOneWidget);
    await tester.tap(find.text('Dispute'));
    await tester.pumpAndSettle();
    expect(find.text('I received this and dispute it.'), findsOneWidget);
    await tester.tap(find.text('Sign and submit'));
    await tester.pumpAndSettle();
    expect(repo.commands, isEmpty);
  });

  testWidgets('offline, a response is refused with a plain message',
      (WidgetTester tester) async {
    final _FakeRepo repo = _FakeRepo(
      _detail(actions: <String>['charge_appeal']),
      offline: true,
    );
    await tester.pumpWidget(
      _app(repo,
          DriverChargeAppealSheet(detail: DriverChargeDetail(repo.detailData)),),
    );
    await tester.enterText(
      find.byType(TextField),
      'The vehicle was in the workshop that day.',
    );
    await tester.tap(find.text('Submit appeal'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('A charge response is recorded only online'),
      findsOneWidget,
    );
  });

  testWidgets('section shows an honest empty state',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _app(
        _FakeRepo(_detail()),
        const Scaffold(body: DriverChargesSection(driverId: 'd1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('No charges recorded for this driver.'), findsOneWidget);
  });

  testWidgets('detail fits 360dp at text scale 2 in Arabic',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          driverChargeRepositoryProvider.overrideWithValue(
            _FakeRepo(_detail(actions: <String>['charge_respond'])),
          ),
        ],
        child: MaterialApp(
          locale: const Locale('ar'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          builder: (BuildContext context, Widget? child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: const DriverChargeDetailScreen(chargeId: 'c1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(
      find.text('الرد على هذه المطالبة'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('الرد على هذه المطالبة'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('witness payload carries the refusal statement version', () {
    expect(
      chargeWitnessPayload(
        charge: DriverChargeDetail(_detail()).charge,
        signature: 'data:image/png;base64,AAAA',
      ),
      <String, Object?>{
        'driver_id': 'd1',
        'charge_id': 'c1',
        'version': 3,
        'statement_version': 'refusal-witness-v1',
        'acknowledged': true,
        'signature': 'data:image/png;base64,AAAA',
      },
    );
    expect(
      chargeAwaitsWitness(<String, Object?>{
        'status': 'notified',
        'refusal_witness_id': 'u2',
      }),
      isTrue,
    );
  });

  testWidgets('witness confirm is offered only when the server allows it',
      (WidgetTester tester) async {
    final DriverRow data = _detail(actions: <String>['charge_witness_confirm']);
    (data['charge']! as Map<String, Object?>)['refusal_witness_id'] = 'u2';
    await tester.pumpWidget(
      _app(_FakeRepo(data), const DriverChargeDetailScreen(chargeId: 'c1')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Confirm the refusal you witnessed'), findsOneWidget);
    expect(
        find.textContaining('Waiting for the named witness'), findsOneWidget,);
    await tester.tap(find.text('Confirm the refusal you witnessed'));
    await tester.pumpAndSettle();
    expect(find.text('I witnessed the refusal.'), findsOneWidget);
  });

  testWidgets('an unknown status still reads as words',
      (WidgetTester tester) async {
    final DriverRow data = _detail();
    (data['charge']! as Map<String, Object?>)['status'] =
        'pending_payroll_lock';
    await tester.pumpWidget(
      _app(_FakeRepo(data), const DriverChargeDetailScreen(chargeId: 'c1')),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('pending payroll lock'), findsOneWidget);
  });
}
