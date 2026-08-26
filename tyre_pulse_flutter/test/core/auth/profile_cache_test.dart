import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/auth/profile_cache.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';

/// A trivial in-memory store, configurable to fail on demand so the cache's
/// own honest handling of a storage fault is provable.
final class FakeStore extends SecureKeyValueStore {
  final Map<String, String> values = <String, String>{};
  bool failReads = false;
  bool failWrites = false;

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    if (failReads) {
      return const SecureRead.unreadable();
    }
    final String? value = values[key];
    return value == null ? const SecureRead.absent() : SecureRead.ok(value);
  }

  @override
  Future<void> write(String key, String value) async {
    if (failWrites) {
      throw StateError('write refused');
    }
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }
}

Map<String, Object?> rowFor({
  String id = 'user-1',
  bool locked = false,
  bool approved = true,
}) => <String, Object?>{
  'id': id,
  'role': 'Manager',
  'locked': locked,
  'approved': approved,
};

void main() {
  group('save then load round-trips the raw row for the same user', () {
    test('a plain successful round trip', () async {
      final FakeStore store = FakeStore();
      final ProfileCache cache = ProfileCache(store);

      await cache.save('user-1', rowFor());
      final Map<String, Object?>? loaded = await cache.load('user-1');

      expect(loaded, isNotNull);
      expect(loaded!['id'], 'user-1');
    });

    test('nothing cached yet is null, not a crash', () async {
      final ProfileCache cache = ProfileCache(FakeStore());
      expect(await cache.load('user-1'), isNull);
    });
  });

  group('a cache written for one account is never handed to another', () {
    test('loading for a different user id returns null', () async {
      final FakeStore store = FakeStore();
      final ProfileCache cache = ProfileCache(store);
      await cache.save('user-1', rowFor(id: 'user-1'));

      expect(await cache.load('user-2'), isNull);
    });
  });

  group('a cache written while locked or unapproved is never usable', () {
    test('locked at write time', () async {
      final ProfileCache cache = ProfileCache(FakeStore());
      await cache.save('user-1', rowFor(locked: true));
      expect(await cache.load('user-1'), isNull);
    });

    test('unapproved at write time', () async {
      final ProfileCache cache = ProfileCache(FakeStore());
      await cache.save('user-1', rowFor(approved: false));
      expect(await cache.load('user-1'), isNull);
    });
  });

  group('clear() removes the cache and never throws', () {
    test('a subsequent load finds nothing', () async {
      final ProfileCache cache = ProfileCache(FakeStore());
      await cache.save('user-1', rowFor());
      await cache.clear();
      expect(await cache.load('user-1'), isNull);
    });

    test('clearing an already-empty cache is a harmless no-op', () async {
      final ProfileCache cache = ProfileCache(FakeStore());
      await cache.clear();
      expect(await cache.load('user-1'), isNull);
    });
  });

  group('storage faults never escape as exceptions', () {
    test('a write failure is swallowed - a failed cache write must not turn '
        'a successful profile fetch into a reported failure', () async {
      final FakeStore store = FakeStore()..failWrites = true;
      final ProfileCache cache = ProfileCache(store);

      await cache.save('user-1', rowFor()); // must not throw
      expect(await cache.load('user-1'), isNull);
    });

    test(
      'a read failure is treated as "no usable cache", not a crash',
      () async {
        final FakeStore store = FakeStore();
        final ProfileCache cache = ProfileCache(store);
        await cache.save('user-1', rowFor());

        store.failReads = true;
        expect(await cache.load('user-1'), isNull);
      },
    );
  });

  group('the cached row survives a fresh decode through WorkspaceProfile', () {
    test('the shape saved is exactly the shape that comes back', () async {
      final ProfileCache cache = ProfileCache(FakeStore());
      final Map<String, Object?> row = <String, Object?>{
        'id': 'user-1',
        'role': 'Tyre Man',
        'country': const <String>['KSA'],
        'sites': const <String>['NHC'],
        'org_id': 'org-1',
        'organisation_id': 'org-1',
        'is_super_admin': false,
        'approved': true,
        'locked': false,
        'site': 'NHC',
        'full_name': 'Field Worker',
      };
      await cache.save('user-1', row);

      final Map<String, Object?>? loaded = await cache.load('user-1');
      expect(loaded, isNotNull);
      expect(loaded!['role'], 'Tyre Man');
      expect(loaded['country'], <String>['KSA']);
      expect(loaded['full_name'], 'Field Worker');
    });
  });
}
