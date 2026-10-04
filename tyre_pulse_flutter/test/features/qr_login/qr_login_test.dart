import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/qr_login/data/qr_login_repository.dart';
import 'package:tyre_pulse/features/qr_login/domain/qr_login.dart';

const String _id = '3f2a9c1e-7b4d-4e8a-9f10-2b3c4d5e6f70';
final String _secret = 'ab' * 24; // 48 hex chars, what qr_login_start mints.

void main() {
  group('parseQrLoginPayload', () {
    test('reads id and secret off a real payload', () {
      final ({String id, String secret})? code =
          parseQrLoginPayload('tyrepulse://qr-login?id=$_id&s=$_secret');
      expect(code, isNotNull);
      expect(code!.id, _id);
      expect(code.secret, _secret);
    });

    test('tolerates whitespace and an upper-case scheme and host', () {
      expect(
        parseQrLoginPayload('  TYREPULSE://QR-LOGIN?id=$_id&s=$_secret \n'),
        isNotNull,
      );
    });

    test('keeps the secret case as written', () {
      final String mixed = 'AbCd' * 10;
      expect(
        parseQrLoginPayload('tyrepulse://qr-login?id=$_id&s=$mixed')!.secret,
        mixed,
      );
    });

    test('accepts 32 and 128 hex characters, refuses 31 and 129', () {
      String payload(int n) => 'tyrepulse://qr-login?id=$_id&s=${'a' * n}';
      expect(parseQrLoginPayload(payload(32)), isNotNull);
      expect(parseQrLoginPayload(payload(128)), isNotNull);
      expect(parseQrLoginPayload(payload(31)), isNull);
      expect(parseQrLoginPayload(payload(129)), isNull);
    });

    test('refuses a non-hex secret', () {
      expect(
        parseQrLoginPayload('tyrepulse://qr-login?id=$_id&s=${'z' * 48}'),
        isNull,
      );
    });

    test('refuses an id that is not a uuid', () {
      expect(
        parseQrLoginPayload('tyrepulse://qr-login?id=12345&s=$_secret'),
        isNull,
      );
      expect(
        parseQrLoginPayload('tyrepulse://qr-login?id=$_id-extra&s=$_secret'),
        isNull,
      );
    });

    test('refuses a missing id or secret', () {
      expect(parseQrLoginPayload('tyrepulse://qr-login?s=$_secret'), isNull);
      expect(parseQrLoginPayload('tyrepulse://qr-login?id=$_id'), isNull);
    });

    test('refuses another scheme, host, asset codes and junk', () {
      expect(
        parseQrLoginPayload('https://qr-login?id=$_id&s=$_secret'),
        isNull,
      );
      expect(
        parseQrLoginPayload('tyrepulse://asset?id=$_id&s=$_secret'),
        isNull,
      );
      expect(parseQrLoginPayload('TM514'), isNull);
      expect(parseQrLoginPayload('{"asset_no":"TM514"}'), isNull);
      expect(parseQrLoginPayload(''), isNull);
      expect(parseQrLoginPayload('::::'), isNull);
    });
  });

  group('looksLikeQrLoginPayload', () {
    test('is true for the scheme and host even when the code is broken', () {
      expect(looksLikeQrLoginPayload('tyrepulse://qr-login?id=x'), isTrue);
      expect(
        looksLikeQrLoginPayload('tyrepulse://qr-login?id=$_id&s=$_secret'),
        isTrue,
      );
    });

    test('is false for asset and tyre codes', () {
      expect(looksLikeQrLoginPayload('TM514'), isFalse);
      expect(looksLikeQrLoginPayload('https://app/asset/TM514'), isFalse);
      expect(looksLikeQrLoginPayload(''), isFalse);
    });
  });

  group('qrLoginApproveParams', () {
    test('matches the live RPC signature', () {
      expect(
        qrLoginApproveParams(id: _id, secret: _secret, approve: false),
        <String, Object?>{'p_id': _id, 'p_secret': _secret, 'p_approve': false},
      );
    });

    test('the RPC is created by a committed migration', () {
      expect(SupabaseRpcs.qrLoginApprove, 'qr_login_approve');
      expect(SupabaseRpcs.all, contains(SupabaseRpcs.qrLoginApprove));
      final File migration = File(
        '../supabase/migrations/20261004121000_login_showcase_and_qr_login.sql',
      );
      if (migration.existsSync()) {
        expect(
          migration.readAsStringSync(),
          contains(
            'function public.qr_login_approve(p_id uuid, p_secret text, '
            'p_approve boolean default true)',
          ),
        );
      }
    });
  });

  group('qrLoginOutcomeFromReply', () {
    test('reads approved and denied', () {
      expect(
        qrLoginOutcomeFromReply(
          <String, Object?>{'ok': true, 'status': 'approved'},
          approve: true,
        ),
        isA<QrLoginDecided>().having((d) => d.approved, 'approved', isTrue),
      );
      expect(
        qrLoginOutcomeFromReply(
          <String, Object?>{'ok': true, 'status': 'denied'},
          approve: false,
        ),
        isA<QrLoginDecided>().having((d) => d.approved, 'approved', isFalse),
      );
    });

    test('maps every refusal reason', () {
      QrLoginFailure reasonOf(String r) => (qrLoginOutcomeFromReply(
            <String, Object?>{'ok': false, 'reason': r},
            approve: true,
          ) as QrLoginRefused)
              .reason;
      expect(reasonOf('invalid'), QrLoginFailure.invalid);
      expect(reasonOf('expired'), QrLoginFailure.expired);
      expect(reasonOf('consumed'), QrLoginFailure.consumed);
      expect(reasonOf('approved'), QrLoginFailure.alreadyApproved);
      expect(reasonOf('denied'), QrLoginFailure.alreadyDenied);
      expect(reasonOf('something new'), QrLoginFailure.failed);
    });

    test('a reply that is not a map is a failure, never a success', () {
      expect(
        qrLoginOutcomeFromReply(null, approve: true),
        isA<QrLoginRefused>(),
      );
    });
  });

  group('SupabaseQrLoginRepository', () {
    test('sends the decision and reads the reply', () async {
      final List<Map<String, Object?>> calls = <Map<String, Object?>>[];
      final SupabaseQrLoginRepository repo = SupabaseQrLoginRepository(
        rpc: (String name, Map<String, Object?> params) async {
          expect(name, 'qr_login_approve');
          calls.add(params);
          return <String, Object?>{'ok': true, 'status': 'denied'};
        },
        hasSession: () => true,
      );
      final QrLoginOutcome outcome =
          await repo.decide(id: _id, secret: _secret, approve: false);
      expect(calls.single['p_approve'], isFalse);
      expect(outcome, isA<QrLoginDecided>());
    });

    test('refuses without a session and never calls the server', () async {
      bool called = false;
      final SupabaseQrLoginRepository repo = SupabaseQrLoginRepository(
        rpc: (String name, Map<String, Object?> params) async {
          called = true;
          return null;
        },
        hasSession: () => false,
      );
      final QrLoginOutcome outcome =
          await repo.decide(id: _id, secret: _secret, approve: true);
      expect(called, isFalse);
      expect(
        outcome,
        isA<QrLoginRefused>()
            .having((r) => r.reason, 'reason', QrLoginFailure.signedOut),
      );
    });

    test('maps SQLSTATE 42501 to not allowed', () async {
      final SupabaseQrLoginRepository repo = SupabaseQrLoginRepository(
        rpc: (String name, Map<String, Object?> params) async {
          throw const PostgrestException(
            message: 'Sign in on the phone first',
            code: '42501',
          );
        },
        hasSession: () => true,
      );
      final QrLoginOutcome outcome =
          await repo.decide(id: _id, secret: _secret, approve: true);
      expect(
        outcome,
        isA<QrLoginRefused>()
            .having((r) => r.reason, 'reason', QrLoginFailure.notAllowed),
      );
    });
  });
}
