import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/core/storage/staged_secure_store.dart';

import 'fake_secure_slot_store.dart';

/// True when [s] begins with a low (trailing) surrogate - meaning whatever
/// preceded it, if anything, was cut away from it.
bool _startsWithLowSurrogate(String s) {
  if (s.isEmpty) return false;
  final unit = s.codeUnitAt(0);
  return unit >= 0xDC00 && unit <= 0xDFFF;
}

/// True when [s] ends with a high (leading) surrogate - meaning whatever
/// should have followed it was cut away.
bool _endsWithHighSurrogate(String s) {
  if (s.isEmpty) return false;
  final unit = s.codeUnitAt(s.length - 1);
  return unit >= 0xD800 && unit <= 0xDBFF;
}

/// Never sleeps, so retry-backoff tests run instantly.
Future<void> _noSleep(Duration _) async {}

void main() {
  late FakeSecureSlotStore fake;

  setUp(() {
    fake = FakeSecureSlotStore();
  });

  StagedSecureStore store({int chunkSize = StagedSecureStore.defaultChunkSize}) {
    return StagedSecureStore(slots: fake, chunkSize: chunkSize, sleep: _noSleep);
  }

  group('chunking', () {
    test('splits a long value without cutting a surrogate pair, and '
        'reassembles it byte-identical', () async {
      // A supplementary-plane character (2 UTF-16 code units) placed so a
      // naive fixed-size split would land exactly between its two halves.
      const value = 'abc\u{1F600}def'; // a b c [hi lo] d e f = 8 code units
      final sut = store(chunkSize: 4);

      await sut.write('note', value);
      final read = await sut.read('note');

      expect(read, const SecureRead.ok(value));

      final chunkEntries = fake.raw.entries
          .where((e) => e.key.contains('_chunk_'))
          .toList()
        ..sort((a, b) {
          int indexOf(String k) =>
              int.parse(k.substring(k.lastIndexOf('_chunk_') + 7));
          return indexOf(a.key).compareTo(indexOf(b.key));
        });

      expect(chunkEntries, hasLength(3));
      expect(chunkEntries[0].value, 'abc');
      expect(chunkEntries[1].value, '\u{1F600}de');
      expect(chunkEntries[2].value, 'f');

      // The general invariant, independent of the exact split above: no
      // stored chunk may begin or end mid-pair.
      for (final entry in chunkEntries) {
        expect(_startsWithLowSurrogate(entry.value), isFalse,
            reason: 'chunk "${entry.key}" starts mid-surrogate-pair');
        expect(_endsWithHighSurrogate(entry.value), isFalse,
            reason: 'chunk "${entry.key}" ends mid-surrogate-pair');
      }
    });

    test('a value at or under the chunk size is not chunked at all',
        () async {
      final sut = store(chunkSize: 100);

      await sut.write('short', 'a short value');

      expect(fake.raw.keys.any((k) => k.contains('_chunk_')), isFalse);
      expect(await sut.read('short'), const SecureRead.ok('a short value'));
    });
  });

  group('the commit point', () {
    test('an interrupted write leaves the PREVIOUS value fully readable',
        () async {
      final sut = store(chunkSize: 4);
      const first = 'first-value-long-enough-to-chunk';
      const second = 'second-value-also-long-enough-to-chunk';

      await sut.write('session', first);
      expect(await sut.read('session'), const SecureRead.ok(first));

      // Every chunk of the SECOND write will land - it is only the commit
      // point, the metadata write, that is interrupted.
      fake.failNextWrite('session_meta');

      await expectLater(
        () => sut.write('session', second),
        throwsA(isA<AppError>()),
      );

      // The new chunks really were written; only the pointer to them never
      // committed. Proves this is a genuinely interrupted write, not merely
      // a write that failed before doing anything.
      final chunkWritesForSecondAttempt = fake.calls
          .where((c) => c.startsWith('write:session_g') && c.contains('_chunk_'))
          .length;
      expect(chunkWritesForSecondAttempt, greaterThan(0));

      final after = await sut.read('session');
      expect(
        after,
        const SecureRead.ok(first),
        reason: 'the interrupted write must not have become visible',
      );
    });
  });

  group('delete', () {
    test('removes metadata, then the plain slot, then the chunks, in that '
        'order', () async {
      final sut = store(chunkSize: 8);
      await sut.write('queue', 'this value is long enough to be split into '
          'several chunks');
      fake.calls.clear();

      await sut.delete('queue');

      expect(fake.calls[0], 'read:queue_meta');
      expect(fake.calls[1], 'delete:queue_meta');
      expect(fake.calls[2], 'delete:queue');
      expect(fake.calls.length, greaterThan(3),
          reason: 'a chunked value must have chunks to clean up');
      for (final call in fake.calls.skip(3)) {
        expect(call, startsWith('delete:queue_g'));
        expect(call, contains('_chunk_'));
      }
    });

    test('a failure to clean up a chunk still leaves the key reading '
        'absent, never torn - this is why the order matters', () async {
      final sut = store(chunkSize: 8);
      await sut.write('queue', 'this value is long enough to be split into '
          'several chunks');
      final chunkKey =
          fake.raw.keys.firstWhere((k) => k.contains('_chunk_'));
      fake.failNextDelete(chunkKey);

      // Best-effort chunk cleanup must not surface as a delete() failure.
      await sut.delete('queue');

      final after = await sut.read('queue');
      expect(
        after.status,
        SecureReadStatus.absent,
        reason: 'metadata is gone, so the reader must fall through to '
            '"nothing stored", not try to reassemble a chunk set it can '
            'no longer address',
      );
      expect(fake.raw.containsKey(chunkKey), isTrue,
          reason: 'the orphaned chunk is left behind - wasted space, never '
              'evidence of a fault');
    });

    test('a plain-slot delete failure is reported, not swallowed, because a '
        'sign-out that quietly failed must not leave a session behind',
        () async {
      final sut = store();
      await sut.write('session', 'short');
      fake.failNextDelete('session');

      await expectLater(
        () => sut.delete('session'),
        throwsA(isA<AppError>()),
      );

      // The value is genuinely still there - the delete really did not
      // happen, and the caller was told so rather than believing it did.
      expect(await sut.read('session'), const SecureRead.ok('short'));
    });
  });

  group('read retry', () {
    test('a slot that refuses every read is retried up to '
        'defaultReadAttempts times before being reported unreadable',
        () async {
      final sut = store();
      fake.failReadFor('session_meta', StagedSecureStore.defaultReadAttempts);

      final read = await sut.read('session');

      expect(read.status, SecureReadStatus.unreadable);
      final attempts =
          fake.calls.where((c) => c == 'read:session_meta').length;
      expect(attempts, StagedSecureStore.defaultReadAttempts);
    });

    test('a slot that recovers before the retry budget is exhausted is '
        'read normally', () async {
      final sut = store();
      fake.failReadFor(
        'session_meta',
        StagedSecureStore.defaultReadAttempts - 1,
      );

      final read = await sut.read('session');

      expect(read.status, SecureReadStatus.absent,
          reason: 'the retried read succeeded and genuinely found nothing');
    });

    test('readFailureCount increments only on a failed read, not on an '
        'ok or absent one', () async {
      final sut = store();
      expect(sut.readFailureCount, 0);

      await sut.read('never-written');
      expect(sut.readFailureCount, 0);

      await sut.write('present', 'value');
      await sut.read('present');
      expect(sut.readFailureCount, 0);

      fake.failReadFor('broken_meta', StagedSecureStore.defaultReadAttempts);
      await sut.read('broken');
      expect(sut.readFailureCount, 1);
    });
  });

  group('unreadable and torn are both failures, and neither is absent', () {
    test('unreadable, produced by the store itself', () async {
      final sut = store();
      fake.failReadFor('session_meta', StagedSecureStore.defaultReadAttempts);

      final read = await sut.read('session');

      expect(read.status, SecureReadStatus.unreadable);
      expect(read.failed, isTrue);
      expect(read.provesNothingIsStored, isFalse);
    });

    test('torn, produced by a genuinely committed value missing a chunk',
        () async {
      final sut = store(chunkSize: 4);
      await sut.write('note', 'a value long enough to need several chunks');
      final chunkKey =
          fake.raw.keys.firstWhere((k) => k.contains('_chunk_'));

      // Simulated external loss, bypassing the store's own delete path -
      // metadata still says three chunks exist.
      fake.corrupt(chunkKey);

      final read = await sut.read('note');

      expect(read.status, SecureReadStatus.torn);
      expect(read.failed, isTrue);
      expect(read.provesNothingIsStored, isFalse);
    });
  });

  group('absent vs failed', () {
    test('a key that was never written reports absent, not a failure',
        () async {
      final sut = store();

      final read = await sut.read('nobody-ever-wrote-this');

      expect(read.status, SecureReadStatus.absent);
      expect(read.failed, isFalse);
      expect(sut.readFailureCount, 0);
    });
  });

  group('key validation', () {
    test('an empty key is a programming error, not a runtime condition',
        () async {
      final sut = store();

      expect(() => sut.read(''), throwsArgumentError);
      expect(() => sut.write('', 'value'), throwsArgumentError);
      expect(() => sut.delete(''), throwsArgumentError);
    });
  });
}
