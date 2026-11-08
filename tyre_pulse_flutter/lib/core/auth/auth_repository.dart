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
/// A username / employee id is first looked up with `get_email_by_identifier`,
/// which since migration 20261108130000 returns ONLY made-up
/// `@users.tyrepulse.app` addresses (they reveal nothing). Those accounts -
/// nearly all field staff - sign in directly from the phone. A real-email
/// account or an unknown name gets null and is sent to the `sign-in` edge
/// function (`supabase/functions/sign-in/index.ts`), which resolves the email
/// with the service role, enforces and records the lockout, and returns only
/// session tokens. An identifier containing '@' signs in directly.
library;

import 'dart:async';
import 'dart:convert';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/auth/login_lockout.dart';
import 'package:tyre_pulse/core/auth/sign_in_outcome.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// The `sign-in` edge function (`supabase/functions/sign-in/index.ts`). It
/// replaced the anonymous `get_email_by_identifier` lookup, which returned a
/// real email for any username (migration 20261108130000 narrows that RPC to
/// synthetic `@users.tyrepulse.app` addresses for the retired Expo app).
const String _signInFunction = 'sign-in';

/// Returns only made-up `@users.tyrepulse.app` addresses (see library doc).
const String _getEmailByIdentifierRpc = 'get_email_by_identifier';

/// What the `sign-in` edge function answered, decoded. Pure, so it is unit
/// tested without a network.
sealed class SignInFunctionResult {
  const SignInFunctionResult();
}

/// A correct password: the session tokens to adopt.
final class SignInFunctionSession extends SignInFunctionResult {
  const SignInFunctionSession({
    required this.accessToken,
    required this.refreshToken,
  });
  final String accessToken;
  final String refreshToken;
}

/// Unknown identifier OR wrong password - deliberately indistinguishable.
/// Already counted towards the lockout by the function.
final class SignInFunctionRejected extends SignInFunctionResult {
  const SignInFunctionRejected();
}

/// Locked out (already recorded server-side).
final class SignInFunctionLocked extends SignInFunctionResult {
  const SignInFunctionLocked(this.lock);
  final LoginLockStatus lock;
}

/// The auth backend could not be reached or was busy. Not counted, and never
/// shown as "wrong password".
final class SignInFunctionUnavailable extends SignInFunctionResult {
  const SignInFunctionUnavailable(this.error);
  final AppError error;
}

const AppError _signInUnavailableError = AppError(
  kind: AppErrorKind.server,
  message: 'Sign-in is unavailable right now. Try again shortly.',
  technical: 'sign-in edge function returned an unexpected or 5xx response',
);

/// Decodes a `sign-in` edge-function response. [body] is a decoded JSON map
/// normally, but may be a raw string or null; anything unrecognised is
/// "unavailable", never "wrong password".
SignInFunctionResult interpretSignInFunction(int status, Object? body) {
  Object? decoded = body;
  if (decoded is String) {
    try {
      decoded = jsonDecode(decoded);
    } on FormatException {
      decoded = null;
    }
  }
  final Map<Object?, Object?> map =
      decoded is Map ? decoded : const <Object?, Object?>{};
  final Object? access = map['access_token'];
  final Object? refresh = map['refresh_token'];
  if (status >= 200 &&
      status < 300 &&
      access is String &&
      access.isNotEmpty &&
      refresh is String &&
      refresh.isNotEmpty) {
    return SignInFunctionSession(accessToken: access, refreshToken: refresh);
  }
  switch (map['error']) {
    case 'invalid_credentials':
      return const SignInFunctionRejected();
    case 'locked':
      return SignInFunctionLocked(
        LoginLockStatus.fromRpcResult(<String, Object?>{
          'enabled': true,
          'locked': true,
          'retry_after_seconds': map['retry_after_seconds'],
        }),
      );
  }
  return const SignInFunctionUnavailable(_signInUnavailableError);
}

/// Pure interpretation of a `sso_password_login_check` response, exposed for
/// tests. Anything unclear (null, non-map, missing key) ALLOWS - identical to
/// `interpretSsoCheck` in `mobile/lib/ssoPolicy.ts`. Only an explicit
/// `allowed: false` refuses.
bool ssoCheckAllows(Object? result) {
  if (result is! Map) return true;
  return result['allowed'] != false;
}

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
  String toString() => 'AuthSessionSignal(${userId ?? 'no session'})';
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

  /// "Forgot password": asks the account's administrator for a new password
  /// via `request_password_reset`. The server always answers ok (no
  /// enumeration), so this only reports whether the request could be SENT.
  /// Never throws.
  Future<bool> requestPasswordReset(String identifier);

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
  AuthSessionSignal get currentSession =>
      _signalFor(_client.auth.currentSession);

  @override
  Stream<AuthSessionSignal> get sessionChanges => _client.auth.onAuthStateChange
      .map((AuthState event) => _signalFor(event.session));

  static AuthSessionSignal _signalFor(Session? session) =>
      AuthSessionSignal(userId: session?.user.id);

  @override
  Future<void> startAutoRefresh() async {
    try {
      _client.auth.startAutoRefresh();
    } on Object {
      // Best-effort. See the interface doc.
    }
  }

  @override
  Future<void> stopAutoRefresh() async {
    try {
      _client.auth.stopAutoRefresh();
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
  Future<bool> requestPasswordReset(String identifier) async {
    final String trimmed = identifier.trim();
    if (trimmed.isEmpty) return false;
    try {
      await _client.rpc<Object?>(
        SupabaseRpcs.requestPasswordReset,
        params: <String, Object?>{'p_identifier': trimmed},
      );
      return true;
    } on Object {
      return false;
    }
  }

  @override
  Future<SignInOutcome> signIn({
    required String identifier,
    required String password,
  }) async {
    final String trimmedIdentifier = identifier.trim();
    if (trimmedIdentifier.isEmpty || password.isEmpty) {
      return const SignInRejected(
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

    // Field accounts carry a made-up @users.tyrepulse.app address that reveals
    // nothing, so the lookup still returns it and the sign-in goes straight
    // from this phone (its own IP and auth rate limit). A real-email account
    // or an unknown name gets null and goes through the `sign-in` function,
    // which never discloses the address. Sending every username through the
    // function would put all field sign-ins behind one server IP.
    final String loginEmail = trimmedIdentifier.contains('@')
        ? trimmedIdentifier
        : (await _madeUpEmailFor(trimmedIdentifier)) ?? trimmedIdentifier;

    if (loginEmail.contains('@')) {
      try {
        await _client.auth.signInWithPassword(
          email: loginEmail,
          password: password,
        );
      } on Object catch (error) {
        final SupabaseFailure failure = classifySupabaseError(error);
        if (failure.isConnectivity) {
          return SignInFailed(failure.error);
        }
        final LoginLockStatus lockAfter = await _recordFailure(
          trimmedIdentifier,
        );
        return lockAfter.locked
            ? SignInLocked(lockAfter.lockoutMinutes)
            : const SignInRejected(_invalidCredentialsError);
      }
    } else {
      // Username / employee id: the `sign-in` edge function resolves the email
      // SERVER-SIDE and never returns it, so knowing a username no longer
      // reveals the person's email. It checks AND records the V287 lockout
      // itself, so a refusal here must NOT be recorded again (double count).
      final SignInFunctionResult result = await _signInThroughFunction(
        trimmedIdentifier,
        password,
      );
      switch (result) {
        case SignInFunctionSession(
            :final String accessToken,
            :final String refreshToken
          ):
          try {
            await _client.auth.setSession(
              refreshToken,
              accessToken: accessToken,
            );
          } on Object catch (error) {
            return SignInFailed(classifySupabaseError(error).error);
          }
        case SignInFunctionRejected():
          return const SignInRejected(_invalidCredentialsError);
        case SignInFunctionLocked(:final LoginLockStatus lock):
          return SignInLocked(lock.lockoutMinutes);
        case SignInFunctionUnavailable(:final AppError error):
          return SignInFailed(error);
      }
    }

    // Access Policies: an organisation that requires SSO refuses PASSWORD
    // sign-in for its non-super-admin users. Asked only AFTER the password is
    // proven, so it is never an account-enumeration oracle. FAILS OPEN on any
    // error - a broken check must never lock field staff out (mirrors
    // `mobile/lib/ssoPolicy.ts`). A refusal signs the session out again and is
    // NOT recorded as a failed attempt: the password was correct.
    if (!await _ssoAllowsPasswordLogin()) {
      await signOut();
      return const SignInSsoRequired(_ssoRequiredError);
    }

    // Best-effort housekeeping: a successful sign-in must never be reported as
    // failed because the counter-reset call afterwards could not reach the
    // server. `reset_login_attempts` is AUTHENTICATED-only by design (V287) -
    // this call runs after `signInWithPassword` has already succeeded, so the
    // session it needs exists.
    unawaited(_resetLockout());

    return const SignInSucceeded();
  }

  /// The account's made-up sign-in address, or null (real email, unknown
  /// name, or the lookup failed). Never throws.
  Future<String?> _madeUpEmailFor(String identifier) async {
    try {
      final Object? result = await _client.rpc<Object?>(
        _getEmailByIdentifierRpc,
        params: <String, Object?>{'identifier': identifier},
      );
      return result is String && result.contains('@') ? result : null;
    } on Object {
      return null;
    }
  }

  /// Calls the `sign-in` edge function. Never throws.
  Future<SignInFunctionResult> _signInThroughFunction(
    String identifier,
    String password,
  ) async {
    try {
      final FunctionResponse response = await _client.functions.invoke(
        _signInFunction,
        body: <String, Object?>{
          'identifier': identifier,
          'password': password,
        },
      );
      return interpretSignInFunction(response.status, response.data);
    } on FunctionException catch (error) {
      return interpretSignInFunction(error.status, error.details);
    } on Object catch (error) {
      final SupabaseFailure failure = classifySupabaseError(error);
      return SignInFunctionUnavailable(failure.error);
    }
  }

  static const AppError _ssoRequiredError = AppError(
    kind: AppErrorKind.authentication,
    message: 'Your organisation requires single sign-on (SSO). Password '
        'sign-in is not allowed for this account. Please contact your '
        'administrator.',
    technical: 'sso_password_login_check returned allowed=false '
        '(reason sso_required); session signed out',
  );

  /// True unless the server DEFINITELY answered `allowed: false`.
  Future<bool> _ssoAllowsPasswordLogin() async {
    try {
      final Object? result = await _client.rpc<Object?>(
        SupabaseRpcs.ssoPasswordLoginCheck,
      );
      return ssoCheckAllows(result);
    } on Object {
      return true;
    }
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
      await _client.rpc<Object?>(SupabaseRpcs.resetLoginAttempts);
    } on Object {
      // Best-effort. See the call site.
    }
  }
}
