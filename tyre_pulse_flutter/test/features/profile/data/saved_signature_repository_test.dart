/// The saved-signature store: what counts as a mark, and how each call
/// fails. Reads never throw (but keep "none" and "could not check" apart);
/// explicit writes always throw, including with no session.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/features/profile/data/saved_signature_repository.dart';

void main() {
  group('normaliseSavedSignature', () {
    test('keeps svg markup, case-insensitively and trimmed', () {
      expect(normaliseSavedSignature('  <svg x="1"/> '), '<svg x="1"/>');
      expect(normaliseSavedSignature('<SVG></SVG>'), '<SVG></SVG>');
    });

    test('keeps a data URL', () {
      expect(
        normaliseSavedSignature('data:image/png;base64,AAAA'),
        'data:image/png;base64,AAAA',
      );
    });

    test('refuses an over-length value', () {
      final String huge = 'data:${'A' * kSavedSignatureMaxLength}';
      expect(normaliseSavedSignature(huge), isNull);
    });

    test('refuses junk, blanks and non-strings', () {
      expect(normaliseSavedSignature('hello'), isNull);
      expect(normaliseSavedSignature('https://x/y.png'), isNull);
      expect(normaliseSavedSignature('   '), isNull);
      expect(normaliseSavedSignature(''), isNull);
      expect(normaliseSavedSignature(null), isNull);
      expect(normaliseSavedSignature(42), isNull);
      expect(normaliseSavedSignature('<sv'), isNull);
    });
  });

  group('SupabaseSavedSignatureRepository', () {
    late HttpServer server;
    late StreamSubscription<HttpRequest> subscription;
    late SupabaseClient client;
    final List<HttpRequest> requests = <HttpRequest>[];
    int status = HttpStatus.ok;
    Object body = <Object?>[];

    setUp(() async {
      requests.clear();
      status = HttpStatus.ok;
      body = <Object?>[];
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      subscription = server.listen((HttpRequest request) async {
        requests.add(request);
        await utf8.decoder.bind(request).join();
        request.response.statusCode = status;
        request.response.headers.contentType = ContentType.json;
        request.response.write(
          status == HttpStatus.ok
              ? jsonEncode(body)
              : jsonEncode(<String, String>{
                  'code': '42501',
                  'message': 'denied',
                }),
        );
        await request.response.close();
      });
      client = SupabaseClient('http://127.0.0.1:${server.port}', 'test-key');
    });

    tearDown(() async {
      await client.dispose();
      await subscription.cancel();
      await server.close(force: true);
    });

    SupabaseSavedSignatureRepository repo({String? uid = 'user-1'}) =>
        SupabaseSavedSignatureRepository(client, currentUserId: () => uid);

    test('lookup finds a stored mark', () async {
      body = <Map<String, Object?>>[
        <String, Object?>{
          'signature': 'data:image/png;base64,AAAA',
          'updated_at': '2026-08-12T10:00:00Z',
        },
      ];
      final SavedSignatureLookup found = await repo().lookup();
      expect(found.status, SavedSignatureStatus.found);
      expect(found.signature?.value, 'data:image/png;base64,AAAA');
      expect(found.signature?.updatedAt, DateTime.utc(2026, 8, 12, 10));
      expect(requests.single.uri.path, '/rest/v1/user_signatures');
      expect(requests.single.uri.queryParameters['user_id'], 'eq.user-1');
    });

    test('lookup reports none for no row and for an unusable value', () async {
      expect((await repo().lookup()).status, SavedSignatureStatus.none);
      body = <Map<String, Object?>>[
        <String, Object?>{'signature': 'not a mark', 'updated_at': null},
      ];
      final SavedSignatureLookup junk = await repo().lookup();
      expect(junk.status, SavedSignatureStatus.none);
      expect(junk.signature, isNull);
    });

    test('a failed read is unavailable, never none, and mine() is null',
        () async {
      status = HttpStatus.forbidden;
      final SavedSignatureLookup failed = await repo().lookup();
      expect(failed.status, SavedSignatureStatus.unavailable);
      expect(await repo().mine(), isNull);
    });

    test('no session: lookup is unavailable without a request', () async {
      final SavedSignatureLookup noSession = await repo(uid: null).lookup();
      expect(noSession.status, SavedSignatureStatus.unavailable);
      expect(await repo(uid: '').mine(), isNull);
      expect(requests, isEmpty);
    });

    test('save refuses an unusable mark before any request', () async {
      await expectLater(repo().save('junk'), throwsArgumentError);
      expect(requests, isEmpty);
    });

    test('save and clear throw StateError with no session', () async {
      await expectLater(
        repo(uid: null).save('data:image/png;base64,AAAA'),
        throwsStateError,
      );
      await expectLater(repo(uid: null).clear(), throwsStateError);
      expect(requests, isEmpty);
    });

    test('save upserts the caller row and returns the stored value', () async {
      final SavedSignature saved =
          await repo().save('  data:image/png;base64,AAAA ');
      expect(saved.value, 'data:image/png;base64,AAAA');
      expect(requests.single.method, 'POST');
      expect(requests.single.uri.queryParameters['on_conflict'], 'user_id');
    });

    test('a refused save or clear throws', () async {
      status = HttpStatus.forbidden;
      await expectLater(
        repo().save('data:image/png;base64,AAAA'),
        throwsA(anything),
      );
      await expectLater(repo().clear(), throwsA(anything));
    });

    test('clear deletes only the caller row', () async {
      await repo().clear();
      expect(requests.single.method, 'DELETE');
      expect(requests.single.uri.queryParameters['user_id'], 'eq.user-1');
    });
  });
}
