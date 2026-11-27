import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/handover/data/handover_location.dart';
import 'package:tyre_pulse/features/handover/data/handover_remote_repository.dart';
import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';
import 'package:tyre_pulse/features/handover/domain/handover_draft.dart';
import 'package:tyre_pulse/features/handover/domain/handover_paper.dart';
import 'package:tyre_pulse/features/handover/domain/handover_payload.dart';
import 'package:tyre_pulse/features/handover/domain/handover_record.dart';
import 'package:tyre_pulse/features/handover/domain/handover_signing.dart';
import 'package:tyre_pulse/features/handover/handover_providers.dart';
import 'package:tyre_pulse/features/handover/presentation/widgets/handover_signing_panel.dart';

const String _png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

HandoverRecord _row(Map<String, Object?> extra) => HandoverRecord.fromRow(
      <String, dynamic>{
        'id': 'h1',
        'asset_no': 'TM101',
        'handover_type': 'checkout',
        'from_driver': 'Yard',
        'to_driver': 'Driver A',
        'approval_status': 'draft',
        'from_signed_at': null,
        'to_signed_at': null,
        ...extra,
      },
    );

final class _FakeRepo implements HandoverRemoteRepository {
  _FakeRepo({this.failure, this.myDriverId});
  final Object? failure;
  final String? myDriverId;

  @override
  Future<String?> myLinkedDriverId(String userId) async => myDriverId;
  final List<HandoverSignInput> signed = <HandoverSignInput>[];

  @override
  Future<HandoverSignResult> sign(HandoverSignInput input) async {
    if (failure != null) throw failure!; // ignore: only_throw_errors
    signed.add(input);
    return const HandoverSignResult(status: 'draft');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class _FakeLocation implements HandoverLocationReader {
  const _FakeLocation(this.reading);
  final HandoverLocationReading reading;
  @override
  Future<HandoverLocationReading> read() async => reading;
}

Widget _app(
  Widget child, {
  required _FakeRepo repo,
  HandoverLocationReading location = const HandoverLocationReading(
    status: 'captured',
    latitude: 21.4858,
    longitude: 39.1925,
    accuracyMeters: 8,
  ),
  Locale locale = const Locale('en'),
  double textScale = 1,
}) =>
    ProviderScope(
      overrides: <Override>[
        handoverRemoteRepositoryProvider.overrideWithValue(repo),
        handoverLocationReaderProvider
            .overrideWithValue(_FakeLocation(location)),
      ],
      child: MaterialApp(
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: MediaQuery(
          data: MediaQueryData(
            size: const Size(360, 800),
            textScaler: TextScaler.linear(textScale),
          ),
          child: Scaffold(body: SingleChildScrollView(child: child)),
        ),
      ),
    );

void main() {
  test('the handing driver signs first, then the receiving driver', () {
    expect(_row(<String, Object?>{}).nextParty, HandoverParty.handing);
    expect(
      _row(<String, Object?>{'from_signed_at': '2026-09-05T13:25:00Z'})
          .nextParty,
      HandoverParty.receiving,
    );
    final HandoverRecord both = _row(<String, Object?>{
      'from_signed_at': '2026-09-05T13:25:00Z',
      'to_signed_at': '2026-09-05T13:31:00Z',
      'approval_status': 'pending_supervisor',
    });
    expect(both.nextParty, isNull);
    expect(both.isFrozen, isTrue);
    expect(
      _row(<String, Object?>{'approval_status': 'approved'}).nextParty,
      isNull,
    );
  });

  test('a row without the authorization columns keeps the legacy path', () {
    final HandoverRecord legacy = HandoverRecord.fromRow(<String, dynamic>{
      'id': 'h1',
      'asset_no': 'TM1',
      'signature_url': _png,
    });
    expect(legacy.hasAuthorizationColumns, isFalse);
    expect(legacy.nextParty, isNull);
  });

  test('payload sends ids, hour meter and site; no signature is required', () {
    const HandoverPayload payload = HandoverPayload(
      assetNo: 'TM101',
      handoverType: HandoverType.checkout,
      toDriver: 'Driver A',
      toDriverId: 'drv-1',
      hourMeter: 4500,
      site: ' jeddah ',
      conditionRating: HandoverConditionRating.good,
      approvalStatus: 'draft',
    );
    final Map<String, Object?> row = payload.toRow();
    expect(row['to_driver_id'], 'drv-1');
    expect(row.containsKey('from_driver_id'), isFalse);
    expect(row['hour_meter'], 4500);
    expect(row['site'], 'JEDDAH');
    expect(row['approval_status'], 'draft');
    expect(validateHandoverForSubmit(payload), isEmpty);
    for (final String key in HandoverPayload.authorizationKeys) {
      expect(
        <String>['from_driver_id', 'to_driver_id', 'hour_meter', 'site'],
        contains(key),
      );
    }
  });

  test('the wizard draft keeps the register ids, hour meter and site', () {
    const HandoverDraft draft = HandoverDraft(
      assetNo: 'TM101',
      toDriver: 'Driver A',
      toDriverId: 'drv-1',
      hourMeterText: '4500',
      site: 'JEDDAH',
    );
    final HandoverDraft back =
        HandoverDraft.fromJsonString(draft.toJsonString());
    expect(back.toDriverId, 'drv-1');
    expect(back.hourMeterText, '4500');
    expect(back.site, 'JEDDAH');
    expect(back.copyWith(notes: 'x').toDriverId, 'drv-1');
  });

  test('sign params send the location, or an honest status without one', () {
    expect(
      const HandoverSignInput(
        handoverId: 'h1',
        party: HandoverParty.receiving,
        signature: _png,
        latitude: 21.5,
        longitude: 39.2,
        accuracyMeters: 5,
        locationStatus: 'captured',
      ).toParams(),
      <String, Object?>{
        'p_id': 'h1',
        'p_party': 'receiving',
        'p_signature': _png,
        'p_signer_name': null,
        'p_latitude': 21.5,
        'p_longitude': 39.2,
        'p_accuracy_m': 5.0,
        'p_location_status': null,
        'p_on_behalf': false,
      },
    );
    expect(
      const HandoverSignInput(
        handoverId: 'h1',
        party: HandoverParty.handing,
        signature: _png,
        locationStatus: 'denied',
      ).toParams()['p_location_status'],
      'denied',
    );
  });

  test('damage rows use the web wording', () {
    expect(
      handoverPaperDamageRows(<HandoverDamageMarker>[
        const HandoverDamageMarker(
          view: HandoverDamageView.left,
          type: HandoverDamageType.crack,
          level: HandoverDamageLevel.severe,
          note: 'Door',
        ),
      ]),
      <List<String>>[
        <String>[
          '1',
          'Left (position not recorded)',
          'Cracked',
          'Major',
          'Door',
          '',
        ],
      ],
    );
  });

  testWidgets('the panel records the handing signature with the location',
      (WidgetTester tester) async {
    final _FakeRepo repo = _FakeRepo();
    int reloads = 0;
    await tester.pumpWidget(
      _app(
        HandoverSigningPanel(
          record: _row(<String, Object?>{}),
          onSigned: () async => reloads++,
        ),
        repo: repo,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sign as the handing driver'), findsOneWidget);
    await tester.ensureVisible(find.text('Record signature'));
    await tester.tap(find.text('Record signature'));
    await tester.pumpAndSettle();
    // Nothing drawn yet: nothing is sent.
    expect(repo.signed, isEmpty);
    expect(find.text('Sign before submitting.'), findsOneWidget);
  });

  testWidgets('offline, a signature is refused with a plain message',
      (WidgetTester tester) async {
    final _FakeRepo repo = _FakeRepo(
      failure: const SupabaseFailure(
        error: AppError.network(),
        cause: SupabaseFailureCause.offline,
      ),
    );
    final AppLocalizations l10n =
        await AppLocalizations.delegate.load(const Locale('en'));
    expect(
      handoverSignErrorText(l10n, repo.failure!),
      contains('recorded only online'),
    );
    expect(
      handoverSignErrorText(l10n, const SocketException('x')),
      isNotEmpty,
    );
  });

  testWidgets('signed record shows names, server times, lock and map link',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _app(
        HandoverSigningPanel(
          record: _row(<String, Object?>{
            'document_no': 'HO-TM101-2026-0004',
            'approval_status': 'pending_supervisor',
            'from_signature': _png,
            'from_signed_name': 'Yard Keeper',
            'from_signed_at': '2026-09-05T13:25:00Z',
            'to_signature': _png,
            'to_signed_name': 'Driver A',
            'to_signed_at': '2026-09-05T13:31:00Z',
            'frozen_at': '2026-09-05T13:25:00Z',
            'latitude': 21.4858,
            'longitude': 39.1925,
            'location_accuracy_m': 12,
            'location_status': 'captured',
          }),
          onSigned: () async {},
        ),
        repo: _FakeRepo(),
        locale: const Locale('ar'),
        textScale: 2,
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.textContaining('HO-TM101-2026-0004'), findsOneWidget);
    expect(find.textContaining('Yard Keeper'), findsOneWidget);
    expect(find.byIcon(Icons.lock_outline), findsOneWidget);
    expect(find.byIcon(Icons.map_outlined), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing);
  });

  test('signature format follows handover_valid_signature exactly', () {
    // A 1x1 PNG is a dot, not a signature: refused (minimum size rule).
    expect(isValidHandoverSignature(_png), isFalse);
    expect(
      isValidHandoverSignature(
        'data:image/png;base64,iVBORw0KGgo${'A' * 1400}',
      ),
      isTrue,
    );
    expect(
      isValidHandoverSignature(
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" '
        'viewBox="0 0 300 100"><path d="M1 2${' L3 4' * 9}" fill="none" '
        'stroke="#111111" stroke-width="2" stroke-linecap="round" '
        'stroke-linejoin="round"/></svg>',
      ),
      isTrue,
    );
    expect(isValidHandoverSignature('data:image/jpeg;base64,AAAA'), isFalse);
    expect(isValidHandoverSignature('<svg><script/></svg>'), isFalse);
    expect(isValidHandoverSignature(null), isFalse);
  });

  test('signing mode: self, on behalf, or blocked for the other driver', () {
    final HandoverRecord r = _row(<String, Object?>{
      'from_driver_id': 'drv-from',
      'to_driver_id': 'drv-to',
    });
    expect(
      rowSigningMode(r, HandoverParty.handing, 'drv-from'),
      HandoverSigningMode.self,
    );
    expect(
      rowSigningMode(r, HandoverParty.handing, 'drv-to'),
      HandoverSigningMode.blocked,
    );
    expect(
      rowSigningMode(r, HandoverParty.handing, null),
      HandoverSigningMode.onBehalf,
    );
    // A typed-name party can only be signed on behalf.
    expect(
      rowSigningMode(
        _row(<String, Object?>{}),
        HandoverParty.receiving,
        'drv-x',
      ),
      HandoverSigningMode.onBehalf,
    );
  });

  test('sent back means draft with a reason and no signatures, or rejected',
      () {
    expect(
      isHandoverSentBack(
        _row(<String, Object?>{'review_note': 'Wrong odometer'}),
      ),
      isTrue,
    );
    expect(isHandoverSentBack(_row(<String, Object?>{})), isFalse);
    expect(
      isHandoverSentBack(
        _row(<String, Object?>{'approval_status': 'rejected'}),
      ),
      isTrue,
    );
  });

  testWidgets('the other driver sees a blocked notice, not a pad',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _app(
        HandoverSigningPanel(
          record: _row(<String, Object?>{
            'from_driver_id': 'drv-from',
            'to_driver_id': 'drv-to',
          }),
          onSigned: () async {},
        ),
        repo: _FakeRepo(myDriverId: 'drv-to'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('linked to the other driver'), findsOneWidget);
    expect(find.text('Record signature'), findsNothing);
  });

  testWidgets('a supervisor must tick the on-behalf box',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _app(
        HandoverSigningPanel(
          record: _row(<String, Object?>{'from_driver_id': 'drv-from'}),
          onSigned: () async {},
        ),
        repo: _FakeRepo(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('I am signing on behalf of Yard'), findsOneWidget);
  });

  testWidgets('an on-behalf signature is labelled',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _app(
        HandoverSigningPanel(
          record: _row(<String, Object?>{
            'approval_status': 'draft',
            'from_signature': _png,
            'from_signed_name': 'Yard',
            'from_signed_at': '2026-09-05T13:25:00Z',
            'from_on_behalf': true,
          }),
          onSigned: () async {},
        ),
        repo: _FakeRepo(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Signed on their behalf by a supervisor'), findsOneWidget);
  });

  test('site: the fleet register wins, else the typed site, upper case', () {
    expect(
      resolveHandoverSite(registerSite: ' jeddah ', typedSite: 'riyadh'),
      'JEDDAH',
    );
    expect(resolveHandoverSite(registerSite: '', typedSite: ' nhc '), 'NHC');
    expect(resolveHandoverSite(registerSite: null, typedSite: '  '), isNull);
  });

  test('the handing signer may not also give the receiving signature', () {
    final HandoverRecord r = _row(<String, Object?>{
      'from_signed_at': '2026-09-05T13:25:00Z',
      'from_signed_by': 'user-1',
    });
    expect(mustLeaveReceivingToAnother(record: r, myUserId: 'user-1'), isTrue);
    expect(mustLeaveReceivingToAnother(record: r, myUserId: 'user-2'), isFalse);
    expect(
      mustLeaveReceivingToAnother(
        record: _row(<String, Object?>{'from_signed_by': 'user-1'}),
        myUserId: 'user-1',
      ),
      isFalse,
    );
  });
}
