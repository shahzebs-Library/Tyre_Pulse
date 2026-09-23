import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';

void main() {
  group('PrivateStorageReference.tryParse', () {
    test('keeps the verified bucket and full nested object path', () {
      final PrivateStorageReference? parsed = PrivateStorageReference.tryParse(
        'tp-storage://tyre-photos/org-a/inspections/i 42/F1L.jpg',
      );

      expect(parsed?.bucket, 'tyre-photos');
      expect(parsed?.path, 'org-a/inspections/i 42/F1L.jpg');
    });

    test('refuses incomplete and unsafe control-character references', () {
      expect(
        PrivateStorageReference.tryParse('https://example.test/a.jpg'),
        isNull,
      );
      expect(PrivateStorageReference.tryParse('tp-storage:///a.jpg'), isNull);
      expect(PrivateStorageReference.tryParse('tp-storage://bucket/'), isNull);
      expect(
        PrivateStorageReference.tryParse('tp-storage://bucket/a\n.jpg'),
        isNull,
      );
    });
  });

  group('PrivateStorageReferenceResolver', () {
    test('re-signs legacy inspection URLs only from the configured backend',
        () async {
      final paths = <String>[];
      final resolver = PrivateStorageReferenceResolver(
        (bucket, path, ttl) async {
          paths.add('$bucket/$path');
          return 'https://signed.test/photo';
        },
        storageOrigin: Uri.parse('https://project.supabase.co'),
      );
      expect(
        await resolver.resolve(
          'https://project.supabase.co/storage/v1/object/public/tyre-photos/inspections/a%20b.jpg',
        ),
        'https://signed.test/photo',
      );
      expect(paths, ['tyre-photos/inspections/a b.jpg']);
      await expectLater(
        resolver.resolve(
          'https://attacker.test/storage/v1/object/public/tyre-photos/private.jpg',
        ),
        throwsA(isA<FormatException>()),
      );
      expect(paths, hasLength(1));
    });

    test('signs through the injected authenticated storage capability',
        () async {
      String? bucket;
      String? path;
      int? ttl;
      final PrivateStorageReferenceResolver resolver =
          PrivateStorageReferenceResolver((b, p, expiresIn) async {
        bucket = b;
        path = p;
        ttl = expiresIn;
        return 'https://storage.test/signed-evidence';
      });

      expect(
        await resolver.resolve('tp-storage://tyre-photos/org/i/F1L.jpg'),
        'https://storage.test/signed-evidence',
      );
      expect(bucket, 'tyre-photos');
      expect(path, 'org/i/F1L.jpg');
      expect(ttl, privateStorageSignedUrlTtlSeconds);
    });

    test('maps a Storage failure instead of exposing a raw exception',
        () async {
      final PrivateStorageReferenceResolver resolver =
          PrivateStorageReferenceResolver((bucket, path, expiresIn) async {
        throw const StorageException('Object not found', statusCode: '404');
      });

      await expectLater(
        resolver.resolve('tp-storage://tyre-photos/missing.jpg'),
        throwsA(isA<SupabaseFailure>()),
      );
    });

    test('does not call storage for an invalid reference', () async {
      var calls = 0;
      final PrivateStorageReferenceResolver resolver =
          PrivateStorageReferenceResolver((bucket, path, expiresIn) async {
        calls += 1;
        return 'unused';
      });

      await expectLater(
        resolver.resolve('tp-storage://bucket/'),
        throwsA(isA<FormatException>()),
      );
      expect(calls, 0);
    });
  });
}
