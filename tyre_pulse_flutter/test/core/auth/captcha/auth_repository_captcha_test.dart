/// [SupabaseAuthRepository] and [SupabaseSelfRegistrationRepository] against
/// a real `SupabaseClient` talking to a loopback HTTP server, so the exact
/// request bodies are asserted: the CAPTCHA token reaches GoTrue and the
/// `sign-in` function, and a CAPTCHA refusal is never recorded as a failed
/// sign-in.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/sign_in_outcome.dart';
import 'package:tyre_pulse/features/extras/data/self_registration_repository.dart';

final class _Recorded {
  _Recorded(this.path, this.body);
  final String path;
  final Map<String, Object?> body;
}

final class _FakeBackend {
  _FakeBackend._(this._server);

  final HttpServer _server;
  final List<_Recorded> requests = <_Recorded>[];

  /// Path (without query) -> (status, json body).
  final Map<String, (int, Object?)> routes = <String, (int, Object?)>{};

  String get url => 'http://${_server.address.host}:${_server.port}';

  static Future<_FakeBackend> start() async {
    final HttpServer server =
        await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final _FakeBackend backend = _FakeBackend._(server);
    server.listen(backend._handle);
    return backend;
  }

  Future<void> _handle(HttpRequest request) async {
    final String raw = await utf8.decoder.bind(request).join();
    Object? decoded;
    try {
      decoded = raw.isEmpty ? null : jsonDecode(raw);
    } on FormatException {
      decoded = null;
    }
    requests.add(
      _Recorded(
        request.uri.path,
        decoded is Map<String, Object?> ? decoded : <String, Object?>{},
      ),
    );
    final (int, Object?) route =
        routes[request.uri.path] ?? (404, <String, Object?>{'message': 'nf'});
    request.response
      ..statusCode = route.$1
      ..headers.contentType = ContentType.json
      ..write(jsonEncode(route.$2));
    await request.response.close();
  }

  _Recorded? first(String path) {
    for (final _Recorded r in requests) {
      if (r.path == path) return r;
    }
    return null;
  }

  Future<void> close() => _server.close(force: true);
}

const Map<String, Object?> _captchaRefusal = <String, Object?>{
  'code': 400,
  'error_code': 'captcha_failed',
  'msg': 'captcha protection: request disallowed (captcha-failed)',
};

void main() {
  late _FakeBackend backend;
  late SupabaseClient client;

  setUp(() async {
    backend = await _FakeBackend.start();
    backend.routes['/rest/v1/rpc/login_attempt_status'] =
        (200, <String, Object?>{'enabled': true, 'locked': false});
    backend.routes['/rest/v1/rpc/record_login_failure'] =
        (200, <String, Object?>{'enabled': true, 'locked': false});
    client = SupabaseClient(
      backend.url,
      'anon-key',
      // Implicit flow: PKCE needs an async storage this bare client has not
      // got, and the flow type does not change the request body under test.
      authOptions: const AuthClientOptions(
        autoRefreshToken: false,
        authFlowType: AuthFlowType.implicit,
      ),
    );
  });

  tearDown(() async {
    await client.dispose();
    await backend.close();
  });

  test(
      'direct password sign-in sends the token and a captcha refusal is not '
      'recorded as a failed attempt', () async {
    backend.routes['/rest/v1/rpc/get_email_by_identifier'] =
        (200, 'ali@users.tyrepulse.app');
    backend.routes['/auth/v1/token'] = (400, _captchaRefusal);

    final SignInOutcome outcome = await SupabaseAuthRepository(client).signIn(
      identifier: 'ali',
      password: 'pw',
      captchaToken: 'tok-1',
    );

    expect(outcome, isA<SignInCaptchaFailed>());
    final Map<String, Object?> body = backend.first('/auth/v1/token')!.body;
    expect(
      (body['gotrue_meta_security'] as Map<String, Object?>)['captcha_token'],
      'tok-1',
    );
    expect(backend.first('/rest/v1/rpc/record_login_failure'), isNull);
  });

  test('a wrong password is still recorded and rejected', () async {
    backend.routes['/rest/v1/rpc/get_email_by_identifier'] =
        (200, 'ali@users.tyrepulse.app');
    backend.routes['/auth/v1/token'] = (
      400,
      <String, Object?>{
        'code': 400,
        'error_code': 'invalid_credentials',
        'msg': 'Invalid login credentials',
      },
    );

    final SignInOutcome outcome = await SupabaseAuthRepository(client).signIn(
      identifier: 'ali',
      password: 'pw',
      captchaToken: 'tok-1',
    );

    expect(outcome, isA<SignInRejected>());
    expect(backend.first('/rest/v1/rpc/record_login_failure'), isNotNull);
  });

  test('the sign-in function receives captcha_token and its refusal maps',
      () async {
    backend.routes['/rest/v1/rpc/get_email_by_identifier'] = (200, null);
    backend.routes['/functions/v1/sign-in'] =
        (400, <String, Object?>{'error': 'captcha_failed'});

    final SignInOutcome outcome = await SupabaseAuthRepository(client).signIn(
      identifier: 'ali',
      password: 'pw',
      captchaToken: 'tok-2',
    );

    expect(outcome, isA<SignInCaptchaFailed>());
    final Map<String, Object?> body =
        backend.first('/functions/v1/sign-in')!.body;
    expect(body['captcha_token'], 'tok-2');
    expect(body['identifier'], 'ali');
  });

  test('with no token the sign-in function body is unchanged', () async {
    backend.routes['/rest/v1/rpc/get_email_by_identifier'] = (200, null);
    backend.routes['/functions/v1/sign-in'] =
        (401, <String, Object?>{'error': 'invalid_credentials'});

    final SignInOutcome outcome = await SupabaseAuthRepository(client).signIn(
      identifier: 'ali',
      password: 'pw',
    );

    expect(outcome, isA<SignInRejected>());
    expect(
      backend.first('/functions/v1/sign-in')!.body.keys.toSet(),
      <String>{'identifier', 'password'},
    );
  });

  test('sign-up sends the token and a refusal asks for the check again',
      () async {
    backend.routes['/rest/v1/rpc/get_public_config'] =
        (200, <String, Object?>{'registration_open': 'true'});
    backend.routes['/auth/v1/signup'] = (400, _captchaRefusal);

    final SelfRegistrationResult result =
        await SupabaseSelfRegistrationRepository(client).register(
      username: 'new.user',
      employeeId: 'E1',
      password: 'password1',
      captchaToken: 'tok-3',
    );

    expect(result, SelfRegistrationResult.captchaFailed);
    final Map<String, Object?> body = backend.first('/auth/v1/signup')!.body;
    expect(
      (body['gotrue_meta_security'] as Map<String, Object?>)['captcha_token'],
      'tok-3',
    );
  });

  test('sign-up with no token and a server CAPTCHA reads as closed', () async {
    backend.routes['/rest/v1/rpc/get_public_config'] =
        (200, <String, Object?>{'registration_open': 'true'});
    backend.routes['/auth/v1/signup'] = (400, _captchaRefusal);

    final SelfRegistrationResult result =
        await SupabaseSelfRegistrationRepository(client).register(
      username: 'new.user',
      employeeId: 'E1',
      password: 'password1',
    );

    expect(result, SelfRegistrationResult.closed);
  });
}
