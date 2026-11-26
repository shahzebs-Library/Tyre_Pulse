import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
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
        'country': 'KSA',
      },
      'driver': <String, Object?>{'driver_name': 'Driver A'},
      'evidence': <DriverRow>[],
      'signatures': <DriverRow>[],
      'decisions': <DriverRow>[],
      'appeal': null,
      'instalments': <DriverRow>[],
      'events': <DriverRow>[],
      'statements': <String, Object?>{
        'deduction-consent-v3': <String, Object?>{
          'en': 'I accept and consent.',
          'ar': 'أوافق على الخصم.',
          'ur': 'میں کٹوتی کی اجازت دیتا ہوں۔',
        },
        'receipt-dispute-v2': <String, Object?>{
          'en': 'I received this and dispute it.',
          'ar': 'استلمت ولا أوافق.',
          'ur': 'مجھے ملا اور میں متفق نہیں ہوں۔',
        },
        'refusal-witness-v2': <String, Object?>{
          'en': 'I witnessed the refusal.',
          'ar': 'رأيت الرفض.',
          'ur': 'میں نے انکار دیکھا۔',
        },
      },
      'settings': <String, Object?>{
        'cap_pct': 20,
        'appeal_window_days': 7,
        'objection_last_day': '2026-12-17',
      },
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
      'statement_version': 'receipt-dispute-v2',
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

  test('KSA labour law rules mirror the server', () {
    expect(driverChargeCountryRule('KSA').statutory, isTrue);
    expect(driverChargeCountryRule('UAE').needsLegalConfirmation, isTrue);
    expect(driverChargeBucket('missing_item'), 'damage');
    expect(driverChargeBucket('traffic_fine'), 'consent');
    expect(driverChargeCountryKey('Saudi Arabia'), 'KSA');
    expect(driverChargeCountryKey('k.s.a.'), 'KSA');
    expect(driverChargeCountryRule('saudi').statutory, isTrue);
    expect(driverChargeCountryKey('United Arab Emirates'), 'UAE');
    expect(driverChargeBucket('other'), 'consent');
    expect(driverChargeNeedsPhoto('tyre_damage'), isTrue);
    expect(driverChargeNeedsPhoto('missing_item'), isFalse);
    expect(
      chargeWorkingDeadline(DateTime.parse('2026-11-26T09:00:00+03:00'), 15),
      DateTime.utc(2026, 12, 17, 21),
    );
    expect(defaultChargeStatementLanguage('ur'), 'ur');
    expect(defaultChargeStatementLanguage('fr'), 'en');
    final DriverChargeDetail detail = DriverChargeDetail(_detail());
    expect(
      detail.statement(chargeConsentStatement, language: 'ur'),
      'میں کٹوتی کی اجازت دیتا ہوں۔',
    );
    expect(detail.statement('deduction-consent-v1'), isNull);
    expect(detail.objectionLastDay, '2026-12-17');
    expect(
      chargeResponsePayload(
        charge: detail.charge,
        response: DriverChargeResponse.accept,
        explanation: '',
        signature: 'x',
        language: 'ar',
      )['statement_language'],
      'ar',
    );
  });

  test('never offers a schedule the server would refuse', () {
    DriverChargeDetail d(
      Map<String, Object?> charge,
      Map<String, Object?> settings, {
      DriverRow? appeal,
    }) =>
        DriverChargeDetail(<String, Object?>{
          'charge': <String, Object?>{'status': 'finance_approved', ...charge},
          'settings': settings,
          'appeal': appeal,
        });
    const Map<String, Object?> ksa = <String, Object?>{
      'country_rule': <String, Object?>{'statutory': true},
      'objection_deadline': '2026-12-17T21:00:00Z',
      'objection_last_day': '2026-12-17',
    };
    expect(
      d(
        <String, Object?>{'category': 'other', 'driver_response': 'disputed'},
        ksa,
      ).scheduleBlock()?.article,
      '92',
    );
    final DriverChargeDetail damage = d(
      <String, Object?>{
        'category': 'tyre_damage',
        'driver_response': 'refused',
      },
      ksa,
    );
    expect(
      damage.scheduleBlock(now: DateTime.utc(2026, 12, 10))?.until,
      '2026-12-17',
    );
    expect(damage.scheduleBlock(now: DateTime.utc(2026, 12, 18)), isNull);
    expect(
      d(<String, Object?>{
        'category': 'other',
        'driver_response': 'disputed',
      }, <String, Object?>{
        'country_rule': <String, Object?>{'statutory': false},
        'objection_deadline': '2026-12-01T00:00:00Z',
      }).scheduleBlock(now: DateTime.utc(2026, 12, 2)),
      isNull,
    );
    expect(
      d(<String, Object?>{
        'category': 'other',
        'driver_response': 'disputed',
      }, <String, Object?>{
        'schedule_block': <String, Object?>{
          'code': 'open_objection',
          'article': '91',
        },
      }).scheduleBlock()?.code,
      'open_objection',
    );
  });

  testWidgets('a blocked schedule is explained on the detail',
      (WidgetTester tester) async {
    final DriverRow data = _detail();
    (data['charge']! as Map<String, Object?>)
      ..['status'] = 'finance_approved'
      ..['driver_response'] = 'disputed'
      ..['category'] = 'other';
    (data['settings']! as Map<String, Object?>)['schedule_block'] =
        <String, Object?>{'code': 'consent_required', 'article': '92'};
    await tester.pumpWidget(
      _app(_FakeRepo(data), const DriverChargeDetailScreen(chargeId: 'c1')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Deduction cannot be scheduled yet'), findsOneWidget);
    expect(find.textContaining('Article 92'), findsOneWidget);
  });

  testWidgets('the driver sees the photos and signs in Urdu',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final DriverRow data = _detail(actions: <String>['charge_respond']);
    data['evidence'] = <DriverRow>[
      <String, Object?>{
        'id': 'e1',
        'kind': 'photo',
        'ref': 'tp-storage://tyre-photos/modules/driver-charge/u/1.jpg',
        'label': 'Broken mirror',
      },
    ];
    final _FakeRepo repo = _FakeRepo(data);
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          driverChargeRepositoryProvider.overrideWithValue(repo),
          privateStorageImageUrlProvider.overrideWith(
            (Ref ref, String reference) async => throw StateError('offline'),
          ),
        ],
        child: MaterialApp(
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: DriverChargeResponseSheet(detail: DriverChargeDetail(data)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Broken mirror'), findsOneWidget);
    expect(find.text('Photo could not be loaded.'), findsOneWidget);
    expect(find.textContaining('Saudi Labour Law'), findsOneWidget);
    await tester.tap(find.text('اردو'));
    await tester.pumpAndSettle();
    expect(find.text('میں کٹوتی کی اجازت دیتا ہوں۔'), findsOneWidget);
  });

  testWidgets('a photo that failed to load blocks signing until retried',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final DriverRow data = _detail(actions: <String>['charge_respond']);
    data['evidence'] = <DriverRow>[
      <String, Object?>{
        'id': 'e1',
        'kind': 'photo',
        'ref': 'tp-storage://tyre-photos/modules/driver-charge/u/1.jpg',
        'label': 'Broken mirror',
      },
    ];
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          driverChargeRepositoryProvider.overrideWithValue(_FakeRepo(data)),
          privateStorageImageUrlProvider.overrideWith(
            (Ref ref, String reference) async => throw StateError('offline'),
          ),
        ],
        child: MaterialApp(
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: DriverChargeResponseSheet(detail: DriverChargeDetail(data)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('You must see every photo'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    final Finder submit = find.widgetWithText(FilledButton, 'Sign and submit');
    await tester.ensureVisible(submit);
    expect(tester.widget<FilledButton>(submit).onPressed, isNull);
  });

  testWidgets('statement language buttons are 48dp tall and fit 360dp at 2x',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final DriverRow data = _detail(actions: <String>['charge_respond']);
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          driverChargeRepositoryProvider.overrideWithValue(_FakeRepo(data)),
        ],
        child: MaterialApp(
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          builder: (BuildContext context, Widget? child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: DriverChargeResponseSheet(detail: DriverChargeDetail(data)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    final Finder picker = find.byType(SegmentedButton<String>);
    expect(tester.getSize(picker).height, greaterThanOrEqualTo(48));
    expect(tester.getSize(picker).width, lessThanOrEqualTo(360));
    expect(find.text('English'), findsOneWidget);
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
        _FakeRepo(_detail()),
        const DriverChargeDetailScreen(chargeId: 'c1'),
      ),
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
    await tester.ensureVisible(find.text('Dispute'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Dispute'));
    await tester.pumpAndSettle();
    expect(find.text('I received this and dispute it.'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Sign and submit'),
      200,
      scrollable: find
          .descendant(
            of: find.byType(DriverChargeResponseSheet),
            matching: find.byType(Scrollable),
          )
          .first,
    );
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
      _app(
        repo,
        DriverChargeAppealSheet(detail: DriverChargeDetail(repo.detailData)),
      ),
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
        'statement_version': 'refusal-witness-v2',
        'statement_language': 'en',
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
      find.textContaining('Waiting for the named witness'),
      findsOneWidget,
    );
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

  test('appeal is never offered once a deduction is recorded', () {
    final DriverRow data = _detail(actions: <String>['charge_appeal']);
    expect(DriverChargeDetail(data).mobileActions, <String>{'charge_appeal'});
    (data['charge']! as Map<String, Object?>)['deducted_amount'] = 50;
    expect(DriverChargeDetail(data).mobileActions, isEmpty);
  });

  testWidgets('an unconfirmed source link is stated on the detail',
      (WidgetTester tester) async {
    final DriverRow data = _detail();
    (data['charge']! as Map<String, Object?>)['source_link_unverified'] = true;
    await tester.pumpWidget(
      _app(_FakeRepo(data), const DriverChargeDetailScreen(chargeId: 'c1')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Link to source not confirmed by record'), findsOneWidget);
  });
}
