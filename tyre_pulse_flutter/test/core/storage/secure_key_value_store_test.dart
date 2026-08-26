import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/core/storage/staged_secure_store.dart';

import 'fake_secure_slot_store.dart';

/// Never sleeps, so retry-backoff runs instantly.
Future<void> _noSleep(Duration _) async {}

void main() {
  late FakeSecureSlotStore fake;
  late StagedSecureStore store;

  setUp(() {
    fake = FakeSecureSlotStore();
    store = StagedSecureStore(slots: fake, sleep: _noSleep);
  });

  group('updateValue - the read-modify-write guard', () {
    test('REFUSES and writes nothing when the read failed - this is the '
        'whole point of the method', () async {
      fake.failReadFor('queue_meta', StagedSecureStore.defaultReadAttempts);

      var updateWasCalled = false;

      await expectLater(
        () => store.updateValue('queue', (current) {
          updateWasCalled = true;
          return current ?? 'this must never be written';
        }),
        throwsA(isA<StorageReadFailure>()),
      );

      expect(
        updateWasCalled,
        isFalse,
        reason:
            'the update function must never run over a read that failed '
            '- a caller cannot fold an unreadable read into "[]" and lose '
            'what was actually queued',
      );

      // The real assertion: nothing was written. Not "an exception was
      // thrown", which could be true even if a write happened first.
      final writeOrDeleteCalls = fake.calls
          .where(
            (c) => c.startsWith('write:queue') || c.startsWith('delete:queue'),
          )
          .toList();
      expect(
        writeOrDeleteCalls,
        isEmpty,
        reason: 'the write path was never reached',
      );
      expect(fake.wasEverWritten('queue'), isFalse);
    });

    test('the thrown failure carries the key and the read status', () async {
      fake.failReadFor('locked_meta', StagedSecureStore.defaultReadAttempts);

      try {
        await store.updateValue('locked', (current) => current);
        fail('expected StorageReadFailure');
      } on StorageReadFailure catch (failure) {
        expect(failure.key, 'locked');
        expect(failure.status, SecureReadStatus.unreadable);
      }
    });

    test('a torn read also refuses, exactly like unreadable', () async {
      // Commit a chunked value for real, then take one chunk away - the
      // shape a torn read is built from throughout this suite.
      final chunkStore = StagedSecureStore(
        slots: fake,
        chunkSize: 4,
        sleep: _noSleep,
      );
      await chunkStore.write('note', 'a value long enough to need chunks');
      final chunkKey = fake.raw.keys.firstWhere((k) => k.contains('_chunk_'));
      fake.corrupt(chunkKey);

      await expectLater(
        () => chunkStore.updateValue('note', (current) => current),
        throwsA(
          isA<StorageReadFailure>().having(
            (f) => f.status,
            'status',
            SecureReadStatus.torn,
          ),
        ),
      );
    });

    test('passes the stored text to update() when a value exists', () async {
      await store.write('token', 'existing-value');

      String? seen;
      await store.updateValue('token', (current) {
        seen = current;
        return current;
      });

      expect(seen, 'existing-value');
    });

    test('passes null to update() when the store proved there is nothing '
        'stored - never an unread value mistaken for empty', () async {
      String? sentinel = 'not yet called';
      var receivedNull = false;

      await store.updateValue('never-written', (current) {
        sentinel = current;
        receivedNull = current == null;
        return null;
      });

      expect(sentinel, isNull);
      expect(receivedNull, isTrue);
    });

    test('writes the value update() returns', () async {
      await store.updateValue('queue', (current) => 'a,b,c');

      expect(await store.read('queue'), const SecureRead.ok('a,b,c'));
    });

    test('a null return from update() deletes the key - "clear this queue" '
        'without a second unguarded path', () async {
      await store.write('queue', 'a,b,c');

      await store.updateValue('queue', (current) => null);

      final after = await store.read('queue');
      expect(after.status, SecureReadStatus.absent);
    });

    test('update() may return a Future - updateValue awaits it before '
        'deciding whether to write or delete', () async {
      await store.updateValue(
        'async',
        (current) async => 'computed-asynchronously',
      );

      expect(
        await store.read('async'),
        const SecureRead.ok('computed-asynchronously'),
      );
    });
  });

  group('readValue - the bare-value passthrough for Supabase', () {
    test('returns the value for a complete read', () async {
      await store.write('session', 'abc');

      expect(await store.readValue('session'), 'abc');
    });

    test(
      'returns null for absent, unreadable AND torn alike - this method '
      'exists because the Supabase storage interface cannot express more',
      () async {
        expect(await store.readValue('never-written'), isNull);

        fake.failReadFor('broken_meta', StagedSecureStore.defaultReadAttempts);
        expect(await store.readValue('broken'), isNull);
      },
    );
  });
}
