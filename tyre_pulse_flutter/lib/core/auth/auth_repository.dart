/// Sign-in, sign-out, and session-change observation.
///
/// # Why this file is the ONLY one in this lane that imports `supabase_flutter`
/// for auth events
///
/// [AuthSessionSignal] is deliberately narrower than the SDK's own `Session` /
/// `AuthState` types: it carries exactly the one fact the rest of this layer
/// needs - whether a session exists, and for whom. Depending on the full SDK
/// shape at [AuthController]'s boundary would mean every test double for this
/// interface also has to construct a real `Session`/`User`, whose exact
/// required fields cannot be verified without the SDK installed on this
/// machine (see AGENTS.md's verification note: nothing here is claimed to
/// compile until CI checks it). Confining that risk to this one small mapping
/// - [SupabaseAuthRepository._signalFor] - matches spec section 63's
/// DTO-versus-domain split and this project's own precedent
/// (`WorkspaceDependencies` in `workspace_switch.dart` is the same shape: a
/// narrow interface a fake can satisfy trivially, with the real SDK shape
/// isolated to one implementation).
///
/// # The login business rule lives here, not in a screen
///
/// `mobile/app/(auth)/login.tsx` performs the lockout check, the failure
/// recording and the identifier resolution itself, inline in the screen.
/// AGENTS.md's layering rule ("No permission logic inside a button... No tyre
/// business rule inside UI code") applies exactly as much to an authentication
/// rule: [SupabaseAuthRepository.signIn] is the single place this runs, so a
/// login screen built later is a thin renderer over [SignInOutcome].
///
/// # Verification, per AGENTS.md rule 3 and spec section 62
///
/// `login_attempt_status`, `record_login_failure` and `reset_login_attempts`
/// are declared in `SupabaseRpcs` (network lane, already verified). Their
/// exact argument name - `p_identifier` - is confirmed against the live
/// function bodies in `MIGRATIONS_V287_LOGIN_LOCKOUT.sql`.
///
/// `get_email_by_identifier(identifier text) returns text` is verified the
/// same way, against `MIGRATIONS_V69_LOGIN_IDENTIFIER.sql`, and against its
/// live caller in `mobile/contexts/AuthContext.tsx`. IT IS NOT YET PRESENT IN
/// `SupabaseRpcs` (`lib/core/network/supabase_tables.dart`), which is outside
/// this lane's ownership for this task. [_getEmailByIdentifierRpc] below is a
/// single, clearly-marked exception to "reference a constant in the shared
/// registry" for exactly this reason - see this file's header for the
/// reasoning, and the accompanying report for the flag to the network lane.
library;

import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/auth/login_lockout.dart';
import 'package:tyre_pulse/core/auth/sign_in_outcome.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// See this file's header. Verified against
/// `MIGRATIONS_V69_LOGIN_IDENTIFIER.sql`; not yet in `SupabaseRpcs`.
const String _getEmailByIdentifierRpc = 'get_email_by_identifier';

/// The minimal shape this layer needs from a Supabase auth event: whether a
/// session exists, and if so, which user it belongs to.
final class AuthSessionSignal {
  const AuthSessionSignal({this.userId});

  /// No session at all.
  const AuthSessionSignal.none() : userId = null;

  /// The signed-in user's id, or null when there is no session.
  final String? userId;

  bool get hasSession => userId != null;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is AuthSessionSignal && other.userId == userId);

  @override
  int get hashCode => userId.hashCode;

  @override
  String toString() =>
      'AuthSessionSignal(${userId == null ? 'no session' : userId})';
}

/// The narrow surface [AuthController] needs from Supabase authentication.
abstract interface class AuthRepository {
  /// The session RIGHT NOW, synchronously. On a cold start this answers
  /// correctly only once whatever earlier step recovers a persisted session
  /// (composition-root concern) has actually completed - see this
  /// implementation's own note on that. It exists so a controller can adopt an
  /// already-resolved session immediately, without waiting on the first event
  /// from [sessionChanges], on the path where recovery has already finished by
  /// the time this is read.
  AuthSessionSignal get currentSession;

  /// Fires on every session transition - sign-in, sign-out, token refresh, and
  /// the client's own initial-session event. A controller must treat EVERY
  /// event uniformly by [AuthSessionSignal.hasSession] rather than switching on
  /// which kind of event it was; see [AuthController] for why.
  Stream<AuthSessionSignal> get sessionChanges;

  /// Runs the full sign-in rule: lock check, identifier resolution, the sign-in
  /// call itself, and failure recording / lockout reset. Never throws; every
  /// outcome, including a network failure, is a [SignInOutcome] value.
  Future<SignInOutcome> signIn({
    required String identifier,
    required String password,
  });

  /// Ends the session. Best-effort in the sense that it clears whatever local
  /// auth state the SDK holds even when the server request itself fails -
  /// pressing "sign out" from a screen offering no other way forward must
  /// always be able to get somebody to the login screen.
  Future<void> signOut();

  /// Nudges the SDK to renew its access token now, rather than waiting for its
  /// own internal schedule. Intended to be called when the app returns to the
  /// foreground - React Native suspends JS timers while backgrounded, and a
  /// phone left overnight wakes with a token that has been dead for hours;
  /// `PROJECT_MEMORY.md` names this "the single most likely cause of 'it
  /// signed me out by itself'". Best-effort: a refresh that could not be
  /// started leaves the token exactly as it was, which is not a reason to
  /// disturb whoever is using the app.
  Future<void> startAutoRefresh();

  /// The background half of [startAutoRefresh]. Best-effort for the same
  /// reason.
  Future<void> stopAutoRefresh();
}

/// The real implementation, over a live [SupabaseClient].
final class SupabaseAuthRepository implements AuthRepository {
  SupabaseAuthRepository(this._client);

  final SupabaseClient _client;

  static const AppError _invalidCredentialsError = AppError(
    kind: AppErrorKind.authentication,
    // Deliberately one identical sentence for "no such identifier", "the
    // identifier-resolution RPC failed", and "wrong password" - see the file
    // header. Distinguishing them would tell an attacker which accounts exist.
    message: 'Invalid username, employee ID, or password.',
    technical: 'sign-in rejected: identifier could not be resolved, or '
        'signInWithPassword rejected the credentials',
  );

  @override
  AuthSessionSignal get currentSession => _signalFor(_client.auth.currentSession);

  @override
  Stream<AuthSessionSignal> get sessionChanges => _client.auth.onAuthStateChange
      .map((AuthState event) => _signalFor(event.session));

  static AuthSessionSignal _signalFor(Session? session) =>
      AuthSessionSignal(userId: session?.user.id);

  @override
  Future<void> startAutoRefresh() async {
    try {
      await _client.auth.startAutoRefresh();
    } on Object {
      // Best-effort. See the interface doc.
    }
  }

  @override
  Future<void> stopAutoRefresh() async {
    try {
      await _client.auth.stopAutoRefresh();
    } on Object {
      // Best-effort. See the interface doc.
    }
  }

  @override
  Future<void> signOut() async {
    try {
      await _client.auth.signOut();
    } on Object {
      // A failed sign-OUT request must not strand the person who pressed the
      // one control meant to get them out of a stuck state. The SDK's own
      // local session state is cleared regardless of whether the server call
      // succeeded; [AuthController] does not rely on a `sessionChanges` event
      // firing afterwards to reach the signed-out state - see its own
      // `signOut` for the explicit local transition that guarantees it.
    }
  }

  @override
  Future<SignInOutcome> signIn({
    required String identifier,
    required String password,
  }) async {
    final String trimmedIdentifier = identifier.trim();
    if (trimmedIdentifier.isEmpty || password.isEmpty) {
      return SignInRejected(
        AppError(
          kind: AppErrorKind.validation,
          message: 'Enter your username or employee ID and your password.',
          technical: 'signIn called with a blank identifier or password',
        ),
      );
    }

    final LoginLockStatus lockBefore = await _lockStatus(trimmedIdentifier);
    if (lockBefore.locked) {
      return SignInLocked(lockBefore.lockoutMinutes);
    }

    final String email;
    if (trimmedIdentifier.contains('@')) {
      email = trimmedIdentifier;
    } else {
      final Object? resolved;
      try {
        resolved = await _client.rpc(
          _getEmailByIdentifierRpc,
          params: <String, Object?>{'identifier': trimmedIdentifier},
        );
      } on Object catch (error) {
        final SupabaseFailure failure = classifySupabaseError(error);
        if (failure.isConnectivity) {
          // Honest, and a deliberate improvement over the React Native
          // reference: a spotty connection during identifier resolution must
          // never be told to a field worker as "wrong password", and must
          // never cost them one of their limited login attempts either.
          return SignInFailed(failure.error);
        }
        resolved = null;
      }
      if (resolved is! String || resolved.isEmpty) {
        // Matches `record_login_failure`'s own designed behaviour: it only
        // counts against a REAL account (`_login_identifier_exists`), so
        // calling it for an identifier that does not exist is safe and adds
        // no enumeration signal - see MIGRATIONS_V287's header.
        final LoginLockStatus lockAfter = await _recordFailure(trimmedIdentifier);
        return lockAfter.locked
            ? SignInLocked(lockAfter.lockoutMinutes)
            : const SignInRejected(_invalidCredentialsError);
      }
      email = resolved;
    }

    try {
      await _client.auth.signInWithPassword(email: email, password: password);
    } on Object catch (error) {
      final SupabaseFailure failure = classifySupabaseError(error);
      if (failure.isConnectivity) {
        return SignInFailed(failure.error);
      }
      final LoginLockStatus lockAfter = await _recordFailure(trimmedIdentifier);
      return lockAfter.locked
          ? SignInLocked(lockAfter.lockoutMinutes)
          : const SignInRejected(_invalidCredentialsError);
    }

    // Best-effort housekeeping: a successful sign-in must never be reported as
    // failed because the counter-reset call afterwards could not reach the
    // server. `reset_login_attempts` is AUTHENTICATED-only by design (V287) -
    // this call runs after `signInWithPassword` has already succeeded, so the
    // session it needs exists.
    unawaited(_resetLockout());

    return const SignInSucceeded();
  }

  Future<LoginLockStatus> _lockStatus(String identifier) async {
    try {
      final Object? result = await _client.rpc(
        SupabaseRpcs.loginAttemptStatus,
        params: <String, Object?>{'p_identifier': identifier},
      );
      return LoginLockStatus.fromRpcResult(result);
    } on Object {
      // Fail-safe: an unreachable lockout check must never itself block a
      // sign-in attempt. Mirrors MIGRATIONS_V287's own `exception when others`
      // branch, which answers the identical way.
      return const LoginLockStatus.notLocked();
    }
  }

  Future<LoginLockStatus> _recordFailure(String identifier) async {
    try {
      final Object? result = await _client.rpc(
        SupabaseRpcs.recordLoginFailure,
        params: <String, Object?>{'p_identifier': identifier},
      );
      return LoginLockStatus.fromRpcResult(result);
    } on Object {
      return const LoginLockStatus.notLocked();
    }
  }

  Future<void> _resetLockout() async {
    try {
      await _client.rpc(SupabaseRpcs.resetLoginAttempts);
    } on Object {
      // Best-effort. See the call site.
    }
  }
}
