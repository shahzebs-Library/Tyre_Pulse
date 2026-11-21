import 'package:flutter_test/flutter_test.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:tyre_pulse/core/telemetry/sentry_scrubber.dart';

void main() {
  group('scrubText', () {
    test('redacts secrets in key/value pairs', () {
      expect(scrubText('password=hunter2&x=1'), 'password=[redacted]&x=1');
      expect(scrubText('{"otp": "123456"}'), '{"otp": "[redacted]"}');
    });

    test('redacts a whole quoted secret, spaces and punctuation included', () {
      expect(
        scrubText('{"password": "correct horse battery staple"}'),
        '{"password": "[redacted]"}',
      );
      expect(
        scrubText('{"password": "&private123"}'),
        '{"password": "[redacted]"}',
      );
      expect(
        scrubText(r'{"token": "a\"b, c;d"} next'),
        '{"token": "[redacted]"} next',
      );
      expect(
        scrubText("password='it is, ok' done"),
        "password='[redacted]' done",
      );
    });

    test('redacts an unquoted secret that starts with punctuation', () {
      expect(scrubText('pin=&secret99 next'), 'pin=[redacted] next');
      expect(scrubText('(otp=123456)'), '(otp=[redacted])');
    });

    test('redacts JWTs, bearer values and Supabase keys', () {
      final String out = scrubText(
        'token eyJhbGciOiJIUzI1.eyJzdWIiOiIx.sig Bearer abc.def '
        'sb_secret_abcDEF123',
      );
      expect(out, isNot(contains('eyJ')));
      expect(out, isNot(contains('abc.def')));
      expect(out, isNot(contains('sb_secret_abcDEF123')));
    });

    test('removes URL query strings that carry customer filters', () {
      expect(
        scrubText('GET https://x.supabase.co/rest/v1/stock?serial=eq.ABC123'),
        'GET https://x.supabase.co/rest/v1/stock?[redacted-query]',
      );
    });

    test('redacts evidence photo references, e-mails and phone numbers', () {
      final String out = scrubText(
        'photo /data/user/0/app/cache/IMG_001.jpg tp-storage://inv/a/b.jpg '
        'mail ahmed@example.com call +966 55 123 4567',
      );
      expect(out, isNot(contains('IMG_001')));
      expect(out, isNot(contains('tp-storage')));
      expect(out, isNot(contains('ahmed@example.com')));
      expect(out, isNot(contains('4567')));
    });

    test('leaves ordinary diagnostics readable', () {
      const String text = 'error code 23505 on 2026-11-21 row 42';
      expect(scrubText(text), text);
    });
  });

  group('scrubEvent', () {
    test('keeps only the opaque user id and drops the request', () {
      final SentryEvent event = SentryEvent(
        user: SentryUser(id: 'user-1', email: 'a@b.com', username: 'ahmed'),
        request: SentryRequest(url: 'https://x.example.com/?token=abc'),
        serverName: "Ahmed's phone",
      );

      final SentryEvent? out = scrubEvent(event, Hint());

      expect(out, isNotNull);
      expect(out!.user?.id, 'user-1');
      expect(out.user?.email, isNull);
      expect(out.user?.username, isNull);
      expect(out.request, isNull);
      expect(out.serverName, isNull);
    });

    test('scrubs exception values, messages, tags and breadcrumbs', () {
      final SentryEvent event = SentryEvent(
        message: SentryMessage('login failed password=hunter2'),
        exceptions: <SentryException>[
          SentryException(type: 'StateError', value: 'otp=998877 rejected'),
        ],
        tags: <String, String>{'route': '/x?serial=eq.ABC'},
        breadcrumbs: <Breadcrumb>[
          Breadcrumb(category: 'console', message: 'debug print'),
          Breadcrumb(
            category: 'navigation',
            data: <String, dynamic>{
              'to': '/inventory?item=1',
              'to_arguments': <String, String>{'serial': 'ABC'},
            },
          ),
        ],
      );

      final SentryEvent out = scrubEvent(event, Hint())!;

      expect(out.message!.formatted, isNot(contains('hunter2')));
      expect(out.exceptions!.single.value, isNot(contains('998877')));
      expect(out.tags!['route'], isNot(contains('ABC')));
      expect(out.breadcrumbs, hasLength(1));
      final Map<String, dynamic> data = out.breadcrumbs!.single.data!;
      expect(data.containsKey('to_arguments'), isFalse);
      expect(data['to'], isNot(contains('item=1')));
    });
  });
}
