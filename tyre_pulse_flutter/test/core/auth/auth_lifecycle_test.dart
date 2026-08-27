import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/auth/auth_lifecycle.dart';

/// Distinguishes "the caller did not say, use the helper's own fresh
/// default" from "the caller explicitly passed `null`" - a plain `??`
/// default on a nullable named parameter cannot tell those apart when the
/// explicit value IS `null`, and `isCachedProfileUsable`'s `cachedAt` is
/// genuinely nullable in the real signature (a row with no cached timestamp
/// at all), so a test that wants to exercise exactly that case needs a
/// sentinel rather than the usual default-parameter shorthand.
const Object _defaultCachedAt = Object();

void main() {
  group('classifyRestore', () {
    test('a session found is always signedIn, whatever storage reported', () {
      expect(
        classifyRestore(hasSession: true, storageReadFailed: false),
        RestoreOutcome.signedIn,
      );
      expect(
        classifyRestore(hasSession: true, storageReadFailed: true),
        RestoreOutcome.signedIn,
      );
    });

    test('no session and a clean read is genuinely signed out', () {
      expect(
        classifyRestore(hasSession: false, storageReadFailed: false),
        RestoreOutcome.signedOut,
      );
    });

    test('no session but a failed read must not be believed as signed out', () {
      expect(
        classifyRestore(hasSession: false, storageReadFailed: true),
        RestoreOutcome.restoreFailed,
      );
    });
  });

  group('isCachedProfileUsable', () {
    final DateTime now = DateTime.utc(2026, 6, 1);

    bool usable({
      String? cachedForUserId = 'user-1',
      String wantUserId = 'user-1',
      Object? cachedAt = _defaultCachedAt,
      bool? locked,
      bool? approved = true,
    }) =>
        isCachedProfileUsable(
          cachedForUserId: cachedForUserId,
          wantUserId: wantUserId,
          cachedAt: identical(cachedAt, _defaultCachedAt)
              ? now.subtract(const Duration(days: 1))
              : cachedAt as DateTime?,
          now: now,
          locked: locked,
          approved: approved,
        );

    test('a fresh cache for the right user is usable', () {
      expect(usable(), isTrue);
    });

    test('a cache written for a different user is never usable', () {
      expect(usable(cachedForUserId: 'user-2'), isFalse);
      expect(usable(cachedForUserId: null), isFalse);
    });

    test('a missing cache timestamp is not usable', () {
      expect(usable(cachedAt: null), isFalse);
    });

    test(
      'exactly at the boundary is still usable; a moment past it is not',
      () {
        expect(
          usable(cachedAt: now.subtract(profileCacheMaxAge)),
          isTrue,
          reason: 'exactly profileCacheMaxAge old is not OLDER than the bound',
        );
        expect(
          usable(
            cachedAt: now.subtract(
              profileCacheMaxAge + const Duration(seconds: 1),
            ),
          ),
          isFalse,
        );
      },
    );

    test('a cache written while locked is never usable, however fresh', () {
      expect(usable(locked: true), isFalse);
    });

    test('a cache written while unapproved is never usable', () {
      expect(usable(approved: false), isFalse);
    });

    test(
      'an unknown (null) locked or approved value does not itself refuse',
      () {
        // Mirrors the ported rule exactly: only an EXPLICIT false/true refuses.
        // A row that never carried these columns must not be treated as if it
        // asserted the worst case.
        expect(usable(locked: null, approved: null), isTrue);
      },
    );
  });

  group('shouldRevalidateOnForeground', () {
    final DateTime now = DateTime.utc(2026, 6, 1, 12);

    test('never checked before means revalidate immediately', () {
      expect(
        shouldRevalidateOnForeground(lastCheckedAt: null, now: now),
        isTrue,
      );
    });

    test('checked recently means do not revalidate again yet', () {
      expect(
        shouldRevalidateOnForeground(
          lastCheckedAt: now.subtract(const Duration(seconds: 5)),
          now: now,
        ),
        isFalse,
      );
    });

    test(
      'checked exactly at the interval revalidates; a moment before does not',
      () {
        expect(
          shouldRevalidateOnForeground(
            lastCheckedAt: now.subtract(foregroundRevalidateMinInterval),
            now: now,
          ),
          isTrue,
        );
        expect(
          shouldRevalidateOnForeground(
            lastCheckedAt: now.subtract(
              foregroundRevalidateMinInterval - const Duration(seconds: 1),
            ),
            now: now,
          ),
          isFalse,
        );
      },
    );
  });

  group('the timeout constants are what the field app was tuned to', () {
    test('the session-restore bound is 8 seconds, ported verbatim', () {
      // See the constant's own doc comment: shorter risks a merely-slow
      // device, longer traps the user behind an endless spinner. This value
      // is not this port's to re-tune without new evidence.
      expect(sessionRestoreTimeout, const Duration(seconds: 8));
    });

    test('the offline profile cache window is 90 days, ported verbatim', () {
      expect(profileCacheMaxAge, const Duration(days: 90));
    });

    test(
      'the foreground revalidation floor is 60 seconds, ported verbatim',
      () {
        expect(foregroundRevalidateMinInterval, const Duration(minutes: 1));
      },
    );
  });
}
