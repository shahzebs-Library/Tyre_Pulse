/// The full authentication lifecycle state, and the ONE function that turns it
/// into the narrow [TpSession] navigation depends on.
///
/// This file is pure: no Flutter, no Riverpod, no Supabase. [deriveSession] is
/// deliberately a plain function over an immutable value, not a method buried
/// inside a `Notifier`, so the rule it encodes - the joint-resolving rule below
/// - is testable by constructing a value and reading an answer, with no async
/// gap in which the two halves of the answer could be read apart.
///
/// # The rule this file exists to enforce
///
/// `session.dart`'s own doc comment states it as a warning, not a suggestion:
///
/// > This must cover BOTH the session read and the profile read. The React
/// > Native `AuthContext` clears its `loading` flag BEFORE the profile
/// > resolves, so a guard that waits only on the first one evaluates a null
/// > profile on a cold start or a deep link and denies everybody, admin
/// > included. Whoever implements this provider must not repeat that.
///
/// [deriveSession] cannot repeat that mistake by construction: it does not
/// look at "is there a session" in isolation. [TpSessionPhase.signedIn] and a
/// non-resolving answer are reachable ONLY once [TpAuthState.profileStatus]
/// has itself left [ProfileStatus.loading] - see the switch inside
/// [deriveSession]. There is no code path that reports "signed in" while a
/// profile fetch is still in flight, because that branch simply is not
/// written.
library;

import 'package:tyre_pulse/app/router/session.dart';
import 'package:tyre_pulse/core/auth/app_version.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

/// Where the underlying Supabase auth session is, independent of whether a
/// profile has been loaded for it.
///
/// This is the auth layer's OWN, richer phase - not [TpSessionPhase]. Keeping
/// them distinct is what lets [ProfileStatus] sit alongside
/// [AuthSessionPhase.authenticated] without inventing a fifth [TpSessionPhase]
/// value the navigation contract does not declare.
enum AuthSessionPhase {
  /// Reading the stored session. Bounded by `sessionRestoreTimeout`.
  restoring,

  /// The stored session could not be read in time.
  timedOut,

  /// No Supabase session.
  signedOut,

  /// A Supabase session exists. See [AuthState.profileStatus] for whether the
  /// app yet knows anything about who this is.
  authenticated,
}

/// Where the `profiles` row fetch is, for the current authenticated session.
enum ProfileStatus {
  /// No fetch has been attempted for the current session yet.
  none,

  /// A fetch is in flight.
  loading,

  /// The fetch succeeded. See [AuthState.profile].
  loaded,

  /// The fetch failed and there was no usable cached profile to fall back to.
  /// See [AuthState.profileError].
  failed,
}

/// The full picture the auth layer holds. Immutable; every change produces a
/// new value so a provider watching it sees a real change.
final class AuthState {
  const AuthState({
    this.sessionPhase = AuthSessionPhase.restoring,
    this.userId,
    this.profileStatus = ProfileStatus.none,
    this.profile,
    this.profileError,
    this.profileStale = false,
    this.versionGate = const VersionGateResult.notChecked(),
  });

  /// The state before anything has been read. The starting point of every
  /// session.
  const AuthState.restoring() : this();

  /// The stored session could not be read in time.
  const AuthState.timedOut() : this(sessionPhase: AuthSessionPhase.timedOut);

  /// No session. Everything user-scoped is cleared.
  const AuthState.signedOut() : this(sessionPhase: AuthSessionPhase.signedOut);

  final AuthSessionPhase sessionPhase;

  /// The signed-in user's id. Only meaningful when [sessionPhase] is
  /// [AuthSessionPhase.authenticated].
  final String? userId;

  final ProfileStatus profileStatus;

  /// The loaded profile. Only meaningful when [profileStatus] is
  /// [ProfileStatus.loaded]. May be a value read from the offline cache - see
  /// [profileStale].
  final WorkspaceProfile? profile;

  /// Why the profile fetch failed. Only meaningful when [profileStatus] is
  /// [ProfileStatus.failed].
  final AppError? profileError;

  /// True when [profile] was served from the offline cache rather than a live
  /// read, because the server could not be reached. Access is unchanged by
  /// this - every read still needs a live session and still passes RLS - it
  /// exists only so a screen may show a quiet "working offline" hint.
  final bool profileStale;

  /// The most recent minimum-version check. Defaults to
  /// [VersionGateResult.notChecked], which ALLOWS - see `app_version.dart`.
  /// A check still in flight or one that has not run yet must never block
  /// sign-in; only a definitive [VersionGateReason.buildBelowMinimum] does.
  final VersionGateResult versionGate;

  AuthState copyWith({
    AuthSessionPhase? sessionPhase,
    String? userId,
    bool clearUserId = false,
    ProfileStatus? profileStatus,
    WorkspaceProfile? profile,
    bool clearProfile = false,
    AppError? profileError,
    bool clearProfileError = false,
    bool? profileStale,
    VersionGateResult? versionGate,
  }) => AuthState(
    sessionPhase: sessionPhase ?? this.sessionPhase,
    userId: clearUserId ? null : (userId ?? this.userId),
    profileStatus: profileStatus ?? this.profileStatus,
    profile: clearProfile ? null : (profile ?? this.profile),
    profileError: clearProfileError
        ? null
        : (profileError ?? this.profileError),
    profileStale: profileStale ?? this.profileStale,
    versionGate: versionGate ?? this.versionGate,
  );

  @override
  String toString() =>
      'AuthState(session: ${sessionPhase.name}, user: $userId, '
      'profile: ${profileStatus.name}, stale: $profileStale, '
      'versionGate: ${versionGate.reason.name})';
}

/// Turns the full [AuthState] into the narrow [TpSession] navigation depends
/// on.
///
/// Precedence, checked in this order:
///
/// 1. The underlying Supabase session is not yet resolved, timed out, or
///    absent - reported straight through as the matching [TpSessionPhase].
/// 2. THE JOINT-RESOLVING RULE. A session existing is not enough: while the
///    profile fetch is still [ProfileStatus.none] or [ProfileStatus.loading],
///    this reports [TpSessionPhase.resolving] - never [TpShellGate.none] with
///    a null profile, which is the exact defect this file exists to make
///    unwritable. See the library comment.
/// 3. A profile that failed to load reports [TpShellGate.profileUnavailable].
///    Fails closed: without a profile the app cannot tell what the user may
///    do.
/// 4. A profile that loaded but says the account is locked or not approved
///    reports [TpShellGate.accessBlocked]. Checked before the version gate,
///    because a locked account is still locked after updating the app -
///    showing "update required" to somebody the version gate cannot actually
///    help would misdirect them toward a fix that will not work.
/// 5. A blocking version-gate result reports [TpShellGate.updateRequired].
///    Everything short of [VersionGateReason.buildBelowMinimum] allows - see
///    `app_version.dart` - so a check still in flight, unreadable, or simply
///    absent never reaches this branch.
/// 6. Otherwise, [TpSessionPhase.signedIn] with [TpShellGate.none].
TpSession deriveSession(AuthState state) {
  switch (state.sessionPhase) {
    case AuthSessionPhase.restoring:
      return const TpSession.resolving();
    case AuthSessionPhase.timedOut:
      return const TpSession.timedOut();
    case AuthSessionPhase.signedOut:
      return const TpSession.signedOut();
    case AuthSessionPhase.authenticated:
      break;
  }

  switch (state.profileStatus) {
    case ProfileStatus.none:
    case ProfileStatus.loading:
      // A Supabase session exists but the profile has not settled. Reporting
      // anything else here - including `signedIn` with no gate - is precisely
      // the bug recorded in this file's library comment.
      return const TpSession.resolving();
    case ProfileStatus.failed:
      return const TpSession.signedIn(gate: TpShellGate.profileUnavailable);
    case ProfileStatus.loaded:
      break;
  }

  final WorkspaceProfile? profile = state.profile;
  if (profile == null) {
    // `loaded` with no profile value is a controller bug, not a state a
    // person can reach through normal use. Treat it exactly like a failed
    // load rather than let a null reach anything downstream - fail closed,
    // never crash the shell over it.
    return const TpSession.signedIn(gate: TpShellGate.profileUnavailable);
  }

  if (profile.isBlockedFromApp) {
    return const TpSession.signedIn(gate: TpShellGate.accessBlocked);
  }

  if (state.versionGate.blocks) {
    return const TpSession.signedIn(gate: TpShellGate.updateRequired);
  }

  return const TpSession.signedIn();
}
