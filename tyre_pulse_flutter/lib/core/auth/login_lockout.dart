/// Server-enforced account lockout after repeated failed sign-ins.
///
/// Pure decoding of the `jsonb` shape returned by three RPCs, verified against
/// `MIGRATIONS_V287_LOGIN_LOCKOUT.sql`:
///
/// ```sql
/// create or replace function public.login_attempt_status(p_identifier text)
///   returns jsonb ...
/// create or replace function public.record_login_failure(p_identifier text)
///   returns jsonb ...
/// create or replace function public.reset_login_attempts()
///   returns void ...
/// ```
///
/// and against the production caller in `mobile/app/(auth)/login.tsx`, which
/// calls the first two with the exact parameter name `p_identifier` and reads
/// back `{enabled, locked, retry_after_seconds, remaining}`.
///
/// FAIL-SAFE BY CONSTRUCTION, matching the SQL's own `exception when others`
/// branch: any shape this file does not recognise - including a bare `null`,
/// which is what a network failure or a caught exception on the client side
/// leaves the caller with - decodes to "not locked". Whether `max_login_attempts`
/// is configured at all (`enabled`) is preserved because it is diagnostic
/// information, but it never gates anything here: the lock control is either
/// off, or it answers `locked` directly, and this file's only job is to relay
/// that answer without inventing a lock the server did not report.
library;

/// The account-lockout status for one identifier.
final class LoginLockStatus {
  const LoginLockStatus({
    required this.enabled,
    required this.locked,
    this.retryAfter,
    this.remainingAttempts,
  });

  /// Nothing was reachable, or nothing was reported. Never treated as a lock.
  const LoginLockStatus.notLocked()
    : enabled = false,
      locked = false,
      retryAfter = null,
      remainingAttempts = null;

  /// Decodes the `jsonb` body of `login_attempt_status` / `record_login_failure`.
  ///
  /// [raw] is whatever `SupabaseClient.rpc(...)` resolved to: normally a
  /// `Map<String, dynamic>` decoded from `jsonb`, but treated defensively -
  /// `null`, a bare scalar, or a shape missing `locked` all fall back to
  /// [LoginLockStatus.notLocked] rather than throwing. A caller must never be
  /// blocked by this file failing to understand the server's answer.
  factory LoginLockStatus.fromRpcResult(Object? raw) {
    if (raw is! Map) {
      return const LoginLockStatus.notLocked();
    }
    final Object? enabledValue = raw['enabled'];
    final Object? lockedValue = raw['locked'];
    final Object? retryValue = raw['retry_after_seconds'];
    final Object? remainingValue = raw['remaining'];

    return LoginLockStatus(
      enabled: enabledValue == true,
      locked: lockedValue == true,
      retryAfter: _durationFromSeconds(retryValue),
      remainingAttempts: remainingValue is num ? remainingValue.round() : null,
    );
  }

  /// Whether the server-side control is switched on at all
  /// (`system_config.max_login_attempts`). Diagnostic only - see the library
  /// comment.
  final bool enabled;

  /// Whether THIS identifier is currently locked out.
  final bool locked;

  /// How long until the lock clears, when [locked] is true and the server
  /// reported it. Null when not locked, or when locked without a duration -
  /// both are treated the same way by [lockoutMinutes].
  final Duration? retryAfter;

  /// Attempts remaining before a lock, when the server reported it.
  final int? remainingAttempts;

  /// Minutes to show a person, rounded up and never less than one.
  ///
  /// Ported from `lockMins` in `mobile/app/(auth)/login.tsx`:
  /// `Math.max(1, Math.ceil((Number(s?.retry_after_seconds) || 0) / 60))`. A
  /// lock with no reported duration still reads as "at least a minute" rather
  /// than "0 minutes", which would read as already over.
  int get lockoutMinutes {
    final Duration wait = retryAfter ?? Duration.zero;
    final double minutes = wait.inSeconds / 60;
    final int rounded = minutes.ceil();
    return rounded < 1 ? 1 : rounded;
  }

  static Duration? _durationFromSeconds(Object? value) {
    if (value is num && value > 0) {
      return Duration(milliseconds: (value * 1000).round());
    }
    return null;
  }
}
