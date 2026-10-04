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
    test('a decline sends no number', () {
      expect(
        qrLoginApproveParams(
          id: _id,
          secret: _secret,
          approve: false,
          match: '37',
        ),
        <String, Object?>{'p_id': _id, 'p_secret': _secret, 'p_approve': false},
      );
    });

    test('an approval carries the tapped number as p_match', () {
      expect(
        qrLoginApproveParams(
          id: _id,
          secret: _secret,
          approve: true,
          match: ' 37 ',
        ),
        <String, Object?>{
          'p_id': _id,
          'p_secret': _secret,
          'p_approve': true,
          'p_match': '37',
        },
      );
    });

    test('peek sends only the id and the secret', () {
      expect(
        qrLoginPeekParams(id: _id, secret: _secret),
        <String, Object?>{'p_id': _id, 'p_secret': _secret},
      );
    });

    test('the hardened RPCs are created by a committed migration', () {
      expect(SupabaseRpcs.qrLoginPeek, 'qr_login_peek');
      expect(SupabaseRpcs.all, contains(SupabaseRpcs.qrLoginPeek));
      final File migration = File(
        '../supabase/migrations/20261004150000_qr_login_hardening.sql',
      );
      if (migration.existsSync()) {
        final String sql = migration.readAsStringSync();
        expect(
          sql,
          contains(
            'function public.qr_login_peek(p_id uuid, p_secret text)',
          ),
        );
        expect(
          sql,
          contains(
            'function public.qr_login_approve(p_id uuid, p_secret text, '
            'p_approve boolean default true, p_match text default null)',
          ),
        );
      }
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
      expect(reasonOf('mismatch'), QrLoginFailure.mismatch);
      expect(reasonOf('admin'), QrLoginFailure.admin);
      expect(reasonOf('something new'), QrLoginFailure.failed);
    });

    test('a reply that is not a map is a failure, never a success', () {
      expect(
        qrLoginOutcomeFromReply(null, approve: true),
        isA<QrLoginRefused>(),
      );
    });
  });

  group('qrLoginPeekFromReply', () {
    test('reads the browser, address, age and options', () {
      final QrLoginPeekResult result = qrLoginPeekFromReply(<String, Object?>{
        'ok': true,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
        'ip': '203.0.113.7',
        'age_seconds': 12,
        'options': <Object?>['37', '82', '15'],
      });
      final QrLoginRequestInfo info = (result as QrLoginPeekReady).info;
      expect(info.ip, '203.0.113.7');
      expect(info.ageSeconds, 12);
      expect(info.options, <String>['37', '82', '15']);
      expect(info.userAgent, contains('Chrome'));
    });

    test('a missing address and age stay null, never invented', () {
      final QrLoginPeekResult result = qrLoginPeekFromReply(<String, Object?>{
        'ok': true,
        'user_agent': null,
        'ip': null,
        'options': <Object?>['37', '82', '15'],
      });
      final QrLoginRequestInfo info = (result as QrLoginPeekReady).info;
      expect(info.ip, isNull);
      expect(info.ageSeconds, isNull);
      expect(info.userAgent, isNull);
    });

    test('without enough valid numbers it refuses to ask', () {
      expect(
        qrLoginPeekFromReply(<String, Object?>{
          'ok': true,
          'options': <Object?>['37'],
        }),
        isA<QrLoginPeekRefused>(),
      );
      expect(
        qrLoginPeekFromReply(<String, Object?>{
          'ok': true,
          'options': <Object?>['7', 'abc', null],
        }),
        isA<QrLoginPeekRefused>(),
      );
      expect(qrLoginPeekFromReply(null), isA<QrLoginPeekRefused>());
    });

    test('maps the refusal reasons', () {
      QrLoginFailure reasonOf(String r) => (qrLoginPeekFromReply(
            <String, Object?>{'ok': false, 'reason': r},
          ) as QrLoginPeekRefused)
              .reason;
      expect(reasonOf('expired'), QrLoginFailure.expired);
      expect(reasonOf('invalid'), QrLoginFailure.invalid);
      expect(reasonOf('approved'), QrLoginFailure.alreadyApproved);
      expect(reasonOf('consumed'), QrLoginFailure.consumed);
    });
  });

  group('describeUserAgent', () {
    ({String? browser, String? os}) d(String ua) => describeUserAgent(ua);

    test('names the common desktop browsers', () {
      expect(
        d('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'),
        (browser: 'Chrome', os: 'Windows'),
      );
      expect(
        d('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 '
            'Edg/129.0.0.0'),
        (browser: 'Edge', os: 'Windows'),
      );
      expect(
        d('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
            'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 '
            'Safari/605.1.15'),
        (browser: 'Safari', os: 'macOS'),
      );
      expect(
        d('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:130.0) '
            'Gecko/20100101 Firefox/130.0'),
        (browser: 'Firefox', os: 'Linux'),
      );
      expect(
        d('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/129.0 Safari/537.36 OPR/114.0'),
        (browser: 'Opera', os: 'Windows'),
      );
    });

    test('Android is not reported as Linux, iPad not as macOS', () {
      expect(
        d('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 '
            '(KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 '
            'Mobile Safari/537.36'),
        (browser: 'Samsung Internet', os: 'Android'),
      );
      expect(
        d('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) '
            'AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 '
            'Mobile/15E148 Safari/604.1'),
        (browser: 'Chrome', os: 'iOS'),
      );
      expect(
        d('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/129.0 Safari/537.36'),
        (browser: 'Chrome', os: 'ChromeOS'),
      );
    });

    test('blank or unrecognised says nothing rather than guessing', () {
      expect(describeUserAgent(null), (browser: null, os: null));
      expect(describeUserAgent('  '), (browser: null, os: null));
      expect(describeUserAgent('curl/8.5.0'), (browser: null, os: null));
    });
  });

  group('SupabaseQrLoginRepository', () {
    test('peek calls qr_login_peek and reads the options', () async {
      final List<String> names = <String>[];
      final SupabaseQrLoginRepository repo = SupabaseQrLoginRepository(
        rpc: (String name, Map<String, Object?> params) async {
          names.add(name);
          expect(params, <String, Object?>{'p_id': _id, 'p_secret': _secret});
          return <String, Object?>{
            'ok': true,
            'options': <Object?>['37', '82', '15'],
          };
        },
        hasSession: () => true,
      );
      final QrLoginPeekResult result =
          await repo.peek(id: _id, secret: _secret);
      expect(names.single, 'qr_login_peek');
      expect(result, isA<QrLoginPeekReady>());
    });

    test('approving sends p_match and reads a mismatch', () async {
      final List<Map<String, Object?>> calls = <Map<String, Object?>>[];
      final SupabaseQrLoginRepository repo = SupabaseQrLoginRepository(
        rpc: (String name, Map<String, Object?> params) async {
          expect(name, 'qr_login_approve');
          calls.add(params);
          return <String, Object?>{'ok': false, 'reason': 'mismatch'};
        },
        hasSession: () => true,
      );
      final QrLoginOutcome outcome = await repo.decide(
        id: _id,
        secret: _secret,
        approve: true,
        match: '82',
      );
      expect(calls.single['p_match'], '82');
      expect(
        outcome,
        isA<QrLoginRefused>()
            .having((r) => r.reason, 'reason', QrLoginFailure.mismatch),
      );
    });

    test('peek without a session never calls the server', () async {
      bool called = false;
      final SupabaseQrLoginRepository repo = SupabaseQrLoginRepository(
        rpc: (String name, Map<String, Object?> params) async {
          called = true;
          return null;
        },
        hasSession: () => false,
      );
      final QrLoginPeekResult result =
          await repo.peek(id: _id, secret: _secret);
      expect(called, isFalse);
      expect(
        result,
        isA<QrLoginPeekRefused>()
            .having((r) => r.reason, 'reason', QrLoginFailure.signedOut),
      );
    });

    test('peek maps SQLSTATE 42501 to not allowed', () async {
      final SupabaseQrLoginRepository repo = SupabaseQrLoginRepository(
        rpc: (String name, Map<String, Object?> params) async {
          throw const PostgrestException(
            message: 'Sign in on the phone first',
            code: '42501',
          );
        },
        hasSession: () => true,
      );
      expect(
        await repo.peek(id: _id, secret: _secret),
        isA<QrLoginPeekRefused>()
            .having((r) => r.reason, 'reason', QrLoginFailure.notAllowed),
      );
    });

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
