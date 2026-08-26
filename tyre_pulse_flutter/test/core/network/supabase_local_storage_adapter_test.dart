import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/network/supabase_local_storage_adapter.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';

/// A hand-written fake, not a mock: the RECORDED CALL LIST is part of the
/// assertion. Whether a failed read causes a destructive write or delete is a
/// rule about what is NOT called, and a call list is the only way to test
/// that.
final class FakeSecureKeyValueStore extends SecureKeyValueStore {
  final Map<String, String> _values = <String, String>{};

  /// Every call this fake was asked for, in order.
  final List<String> calls = <String>[];

  /// When set, every `read` reports this status instead of a real lookup. A
  /// failing status increments [readFailureCount], exactly as the real
  /// staged store does.
  SecureReadStatus? forcedReadStatus;

  int _readFailures = 0;

  @override
  int get readFailureCount => _readFailures;

  @override
  Future<SecureRead> read(String key) async {
    calls.add('read:$key');

    final SecureReadStatus status = forcedReadStatus ??
        (_values.containsKey(key)
            ? SecureReadStatus.ok
            : SecureReadStatus.absent);

    final SecureRead result = switch (status) {
      SecureReadStatus.ok => SecureRead.ok(_values[key] ?? ''),
      SecureReadStatus.absent => const SecureRead.absent(),
      SecureReadStatus.unreadable => const SecureRead.unreadable(),
      SecureReadStatus.torn => const SecureRead.torn(),
    };
    if (result.failed) {
      _readFailures++;
    }
    return result;
  }

  @override
  Future<void> write(String key, String value) async {
    calls.add('write:$key');
    _values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    calls.add('delete:$key');
    _values.remove(key);
  }
}

void main() {
  group('round trip', () {
    test('before anything is persisted, there is no session', () async {
      final FakeSecureKeyValueStore store = FakeSecureKeyValueStore();
      final SupabaseLocalStorageAdapter adapter =
          SupabaseLocalStorageAdapter(store);

      expect(await adapter.accessToken(), isNull);
      expect(await adapter.hasAccessToken(), isFalse);
    });

    test('persistSession then accessToken returns the same string', () async {
      final FakeSecureKeyValueStore store = FakeSecureKeyValueStore();
      final SupabaseLocalStorageAdapter adapter =
          SupabaseLocalStorageAdapter(store);

      await adapter.persistSession('the-session-blob');

      expect(await adapter.accessToken(), 'the-session-blob');
      expect(await adapter.hasAccessToken(), isTrue);
    });

    test('removePersistedSession clears a previously persisted session',
        () async {
      final FakeSecureKeyValueStore store = FakeSecureKeyValueStore();
      final SupabaseLocalStorageAdapter adapter =
          SupabaseLocalStorageAdapter(store);

      await adapter.persistSession('the-session-blob');
      await adapter.removePersistedSession();

      expect(await adapter.accessToken(), isNull);
      expect(await adapter.hasAccessToken(), isFalse);
    });

    test('persist and remove land under the documented storage key, and '
        'nothing else', () async {
      final FakeSecureKeyValueStore store = FakeSecureKeyValueStore();
      final SupabaseLocalStorageAdapter adapter =
          SupabaseLocalStorageAdapter(store);

      await adapter.persistSession('blob');
      await adapter.removePersistedSession();

      expect(store.calls, <String>[
        'write:${SupabaseLocalStorageAdapter.sessionStorageKey}',
        'delete:${SupabaseLocalStorageAdapter.sessionStorageKey}',
      ]);
    });

    test('initialize completes without touching the store', () async {
      final FakeSecureKeyValueStore store = FakeSecureKeyValueStore();
      final SupabaseLocalStorageAdapter adapter =
          SupabaseLocalStorageAdapter(store);

      await adapter.initialize();

      expect(store.calls, isEmpty);
    });
  });

  group('a failed underlying read does not silently report "no session"', () {
    test('accessToken answers null - the only thing a bool/String? '
        'contract can say - rather than throwing out of session restore',
        () async {
      final FakeSecureKeyValueStore store = FakeSecureKeyValueStore()
        ..forcedReadStatus = SecureReadStatus.unreadable;
      final SupabaseLocalStorageAdapter adapter =
          SupabaseLocalStorageAdapter(store);

      expect(await adapter.accessToken(), isNull);
      expect(await adapter.hasAccessToken(), isFalse);
    });

    test('never compounds the failure into a destructive write or delete: '
        'only read calls are made', () async {
      final FakeSecureKeyValueStore store = FakeSecureKeyValueStore()
        ..forcedReadStatus = SecureReadStatus.unreadable;
      final SupabaseLocalStorageAdapter adapter =
          SupabaseLocalStorageAdapter(store);

      await adapter.accessToken();
      await adapter.hasAccessToken();

      expect(store.calls, isNotEmpty);
      expect(store.calls, everyElement(startsWith('read:')));
    });

    test('a session persisted before reads started failing is still there '
        'once reads work again - the adapter never deleted it', () async {
      final FakeSecureKeyValueStore store = FakeSecureKeyValueStore();
      final SupabaseLocalStorageAdapter adapter =
          SupabaseLocalStorageAdapter(store);
      await adapter.persistSession('still-there');

      store.forcedReadStatus = SecureReadStatus.unreadable;
      expect(await adapter.accessToken(), isNull);

      store.forcedReadStatus = null;
      expect(await adapter.accessToken(), 'still-there');
    });

    test('a torn read - a committed value that could not be reassembled - '
        'is handled the same way: null, and nothing destroyed', () async {
      final FakeSecureKeyValueStore store = FakeSecureKeyValueStore()
        ..forcedReadStatus = SecureReadStatus.torn;
      final SupabaseLocalStorageAdapter adapter =
          SupabaseLocalStorageAdapter(store);

      expect(await adapter.accessToken(), isNull);
      expect(store.calls, everyElement(startsWith('read:')));
    });

    test('remains observable through readFailureCount, which is exactly the '
        'signal a session-restore caller needs because the LocalStorage '
        'contract itself cannot carry it', () async {
      final FakeSecureKeyValueStore store = FakeSecureKeyValueStore()
        ..forcedReadStatus = SecureReadStatus.unreadable;
      final SupabaseLocalStorageAdapter adapter =
          SupabaseLocalStorageAdapter(store);

      expect(adapter.readFailureCount, 0);

      await adapter.accessToken();

      expect(adapter.readFailureCount, 1);
      expect(store.readFailureCount, 1);
    });

    test('a genuinely absent session increments nothing, so the failure '
        'count really does distinguish the two cases', () async {
      final FakeSecureKeyValueStore store = FakeSecureKeyValueStore();
      final SupabaseLocalStorageAdapter adapter =
          SupabaseLocalStorageAdapter(store);

      await adapter.accessToken();

      expect(adapter.readFailureCount, 0);
    });
  });
}
