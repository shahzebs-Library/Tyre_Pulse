import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/auth/login_lockout.dart';

void main() {
  group('LoginLockStatus.fromRpcResult decodes the real jsonb shapes', () {
    test('not enabled, not locked - the control is switched off', () {
      final LoginLockStatus status = LoginLockStatus.fromRpcResult(
        <String, Object?>{'enabled': false, 'locked': false},
      );
      expect(status.enabled, isFalse);
      expect(status.locked, isFalse);
    });

    test('enabled and not locked, with a remaining count', () {
      final LoginLockStatus status = LoginLockStatus.fromRpcResult(
        <String, Object?>{'enabled': true, 'locked': false, 'remaining': 3},
      );
      expect(status.enabled, isTrue);
      expect(status.locked, isFalse);
      expect(status.remainingAttempts, 3);
    });

    test('locked, with a retry-after duration', () {
      final LoginLockStatus status = LoginLockStatus.fromRpcResult(
        <String, Object?>{
          'enabled': true,
          'locked': true,
          'retry_after_seconds': 300,
        },
      );
      expect(status.locked, isTrue);
      expect(status.retryAfter, const Duration(seconds: 300));
      expect(status.lockoutMinutes, 5);
    });
  });

  group('fail-safe on anything unrecognised - never blocks a sign-in itself',
      () {
    test('null - the RPC could not be reached', () {
      expect(LoginLockStatus.fromRpcResult(null).locked, isFalse);
    });

    test('a bare scalar instead of the expected object', () {
      expect(LoginLockStatus.fromRpcResult('unexpected').locked, isFalse);
      expect(LoginLockStatus.fromRpcResult(42).locked, isFalse);
    });

    test('an object missing `locked` entirely', () {
      expect(
        LoginLockStatus.fromRpcResult(<String, Object?>{'enabled': true})
            .locked,
        isFalse,
      );
    });

    test('a `locked` value that is not literally true is never truthy', () {
      // Mirrors the codebase-wide rule: a nullable boolean is compared to
      // `true`, never treated as truthy. A string "true" must not pass.
      expect(
        LoginLockStatus.fromRpcResult(<String, Object?>{'locked': 'true'})
            .locked,
        isFalse,
      );
      expect(
        LoginLockStatus.fromRpcResult(<String, Object?>{'locked': 1}).locked,
        isFalse,
      );
    });
  });

  group('lockoutMinutes', () {
    test('rounds up, and is never less than one minute', () {
      const LoginLockStatus almostAMinute = LoginLockStatus(
        enabled: true,
        locked: true,
        retryAfter: Duration(seconds: 1),
      );
      expect(almostAMinute.lockoutMinutes, 1);

      const LoginLockStatus overAMinute = LoginLockStatus(
        enabled: true,
        locked: true,
        retryAfter: Duration(seconds: 61),
      );
      expect(overAMinute.lockoutMinutes, 2);
    });

    test('a lock with no reported duration still reads as at least a minute',
        () {
      const LoginLockStatus noDuration = LoginLockStatus(
        enabled: true,
        locked: true,
      );
      expect(noDuration.lockoutMinutes, 1);
    });

    test('LoginLockStatus.notLocked reports zero minutes worth of nothing',
        () {
      const LoginLockStatus notLocked = LoginLockStatus.notLocked();
      expect(notLocked.locked, isFalse);
      // lockoutMinutes is still well-defined (floors at 1) even though no
      // caller should be showing it while `locked` is false.
      expect(notLocked.lockoutMinutes, 1);
    });
  });
}
