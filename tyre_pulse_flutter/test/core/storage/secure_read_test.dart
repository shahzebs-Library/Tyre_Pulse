import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';

void main() {
  group('SecureRead.ok', () {
    test('carries the value and reports isOk', () {
      const read = SecureRead.ok('the-session-token');

      expect(read.value, 'the-session-token');
      expect(read.status, SecureReadStatus.ok);
      expect(read.isOk, isTrue);
      expect(read.failed, isFalse);
      expect(read.provesNothingIsStored, isFalse);
    });
  });

  group('SecureRead.absent', () {
    test('is the ONLY status a caller may act on as emptiness', () {
      const read = SecureRead.absent();

      expect(read.value, isNull);
      expect(read.status, SecureReadStatus.absent);
      expect(read.isOk, isFalse);
      expect(read.failed, isFalse, reason: 'absent is not a failure');
      expect(read.provesNothingIsStored, isTrue);
    });
  });

  group('SecureRead.unreadable', () {
    test('reports failed and never provesNothingIsStored', () {
      const read = SecureRead.unreadable();

      expect(read.value, isNull);
      expect(read.status, SecureReadStatus.unreadable);
      expect(read.isOk, isFalse);
      expect(read.failed, isTrue);
      expect(
        read.provesNothingIsStored,
        isFalse,
        reason: 'a refused read says nothing about whether a value exists',
      );
    });
  });

  group('SecureRead.torn', () {
    test('reports failed and never provesNothingIsStored', () {
      const read = SecureRead.torn();

      expect(read.value, isNull);
      expect(read.status, SecureReadStatus.torn);
      expect(read.isOk, isFalse);
      expect(read.failed, isTrue);
      expect(
        read.provesNothingIsStored,
        isFalse,
        reason: 'metadata was committed - something WAS stored here',
      );
    });
  });

  group('failed', () {
    test('is true for exactly unreadable and torn, nothing else', () {
      const cases = <SecureRead, bool>{
        SecureRead.ok('x'): false,
        SecureRead.absent(): false,
        SecureRead.unreadable(): true,
        SecureRead.torn(): true,
      };

      for (final entry in cases.entries) {
        expect(
          entry.key.failed,
          entry.value,
          reason: '${entry.key.status.name}.failed should be ${entry.value}',
        );
      }
    });
  });

  group('equality and hashCode', () {
    test('two reads with the same value and status are equal', () {
      expect(const SecureRead.ok('abc'), const SecureRead.ok('abc'));
      expect(
        const SecureRead.ok('abc').hashCode,
        const SecureRead.ok('abc').hashCode,
      );
    });

    test('reads with different statuses are not equal', () {
      expect(const SecureRead.absent(), isNot(const SecureRead.unreadable()));
    });

    test('reads with the same status but different values are not equal', () {
      expect(const SecureRead.ok('abc'), isNot(const SecureRead.ok('xyz')));
    });
  });

  group('toString', () {
    test('never includes the stored value', () {
      const secret = 'do-not-leak-this-session-token';
      const read = SecureRead.ok(secret);

      final text = read.toString();

      expect(text, isNot(contains(secret)));
      expect(text, contains('status: ok'));
      expect(text, contains('length: ${secret.length}'));
    });

    test('reports "none" for a length-less status', () {
      const read = SecureRead.unreadable();

      expect(read.toString(), contains('length: none'));
    });
  });
}
