/// The controller: the one place session restore, profile loading, the
/// version gate, foreground revalidation and sign-out are actually wired
/// together into a live [AuthState].
///
/// # The joint-resolving rule, restated at the wiring layer
///
/// `auth_state.dart` proves the RULE is correct as a pure function. This file
/// is what makes sure the STATE it is fed can never violate the rule's
/// precondition: [AuthState.profileStatus] moves to [ProfileStatus.loading]
/// in the very same assignment that moves [AuthState.sessionPhase] to
/// [AuthSessionPhase.authenticated] - see [_applySessionSignal] - so there is
/// no observable moment where a session exists and the profile status still
/// reads [ProfileStatus.none] (which [deriveSession] would otherwise be free
/// to treat as "nothing in flight" rather than "still resolving").
///
/// # The re-entrancy defence
///
/// `PROJECT_MEMORY.md` records a real, previously-shipped incident in the web
/// sibling of this app: `supabase-js` emits its `INITIAL_SESSION` event from
/// INSIDE its own internal auth lock, and doing async work synchronously
/// inside that callback - specifically, awaiting another auth method that
/// re-enters the same lock - deadlocked the web app into a blank screen until
/// a second manual refresh. Nothing here has been able to confirm whether
/// `supabase_flutter`'s Dart client shares that exact hazard, and the defence
/// costs nothing if it does not: [_handleSessionSignal] always defers to a
/// fresh macrotask via `Timer.run` before touching anything, exactly as
/// `mobile/contexts/AuthContext.tsx` does with `setTimeout(fn, 0)` for the
/// identical reason.
///
/// # What signOut() does and does not touch
///
/// [signOut] ends the Supabase auth session, clears THIS lane's own offline
/// profile cache (a single `SecureKeyValueStore` slot this file owns
/// outright), and clears the adopted [WorkspaceContext] (an in-memory
/// Riverpod value, not storage). It imports nothing from `core/database` or
/// any sync/queue module, and calls nothing there - there is no code path by
/// which it COULD reach the offline command queue or a draft. See
/// `test/core/auth/auth_controller_test.dart` for the fake-based proof spec
/// section 60 asks for ("do not destroy unsynced local data during version
/// gating", generalised here to every path that ends a session).
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/auth/app_version.dart';
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/auth/auth_lifecycle.dart';
import 'package:tyre_pulse/core/auth/auth_profile_repository.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/auth/auth_version_gate_repository.dart';
import 'package:tyre_pulse/core/auth/foreground_signal.dart';
import 'package:tyre_pulse/core/auth/profile_cache.dart';
import 'package:tyre_pulse/core/auth/sign_in_outcome.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';

/// Orchestrates the auth lifecycle. See the library comment.
final class AuthController extends Notifier<AuthState> {
  late final AuthRepository _auth;
  late final ProfileRepository _profiles;
  late final VersionGateRepository _versionGate;
  late final ProfileCache _cache;
  late final Duration _restoreTimeout;

  StreamSubscription<AuthSessionSignal>? _sessionSub;
  StreamSubscription<void>? _foregroundSub;
  Timer? _restoreTimer;

  /// Bumped on every event that starts a new "epoch" of work: a new sign-in,
  /// a sign-out, or an explicit retry. An async fetch captures the generation
  /// it started under and discards its own result if the generation has since
  /// moved on - the standard defence against a slow, superseded response
  /// landing after a faster, newer one already decided the state.
  int _generation = 0;

  /// True once [_adoptWorkspace] has run for the CURRENT sign-in. Guards
  /// against re-adopting on every foreground revalidation, which would
  /// silently reset a user's chosen country/site scope every time the app
  /// comes back to the foreground.
  bool _workspaceAdopted = false;

  DateTime? _lastForegroundCheckAt;

  @override
  AuthState build() {
    // `ref.read`, not `ref.watch`: these dependencies are conceptually fixed
    // for the app's lifetime (nobody swaps the auth repository out from under
    // a running app), and `build()` reading them without watching is what
    // keeps this method running exactly once - the same reasoning
    // `WorkspaceController` already applies by reading `workspaceSwitcherProvider`
    // inside its methods rather than watching a dependency inside `build()`.
    _auth = ref.read(authRepositoryProvider);
    _profiles = ref.read(profileRepositoryProvider);
    _versionGate = ref.read(versionGateRepositoryProvider);
    _cache = ref.read(profileCacheProvider);
    _restoreTimeout = ref.read(sessionRestoreTimeoutDurationProvider);
    final ForegroundSignal foreground = ref.read(foregroundSignalProvider);

    ref.onDispose(_disposeSubscriptions);

    _sessionSub = _auth.sessionChanges.listen(_handleSessionSignal);
    _foregroundSub = foreground.onResumed.listen((_) => _handleForeground());

    final AuthSessionSignal initial = _auth.currentSession;
    if (initial.hasSession) {
      final String userId = initial.userId!;
      _generation++;
      unawaited(_startSession(userId, _generation));
      return AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: userId,
        profileStatus: ProfileStatus.loading,
      );
    }

    // Nothing readable synchronously. This does not mean signed out - it may
    // simply mean session restore has not resolved yet, which is precisely
    // what the bound timer exists to give up on. `_sessionSub` is already
    // listening and will pick up a session that resolves after this point.
    _restoreTimer = Timer(_restoreTimeout, _handleRestoreTimeout);
    return const AuthState.restoring();
  }

  // --------------------------------------------------------------------
  // Public actions
  // --------------------------------------------------------------------

  /// Runs the full sign-in rule. Never throws - every outcome is a value. The
  /// resulting session transition, if any, arrives through the SAME
  /// [AuthRepository.sessionChanges] listener as any other sign-in, so there
  /// is exactly one code path that ever moves this controller into
  /// [AuthSessionPhase.authenticated].
  Future<SignInOutcome> signIn({
    required String identifier,
    required String password,
  }) => _auth.signIn(identifier: identifier, password: password);

  /// Re-attempts reading the session after [TpSessionPhase.timedOut].
  Future<void> retrySession() async {
    _restoreTimer?.cancel();
    _restoreTimer = null;
    state = const AuthState.restoring();

    final AuthSessionSignal current = _auth.currentSession;
    if (current.hasSession) {
      _applySessionSignal(current);
      return;
    }

    // Still nothing readable. `_sessionSub` never stopped listening and will
    // pick up a late session on its own; this only re-arms the bound so a
    // second stall is reported again instead of waiting forever.
    _restoreTimer = Timer(_restoreTimeout, _handleRestoreTimeout);
  }

  /// Re-attempts the profile fetch after [TpShellGate.profileUnavailable].
  Future<void> retryProfile() async {
    final String? userId = state.userId;
    if (userId == null) {
      return;
    }
    _generation++;
    final int myGeneration = _generation;
    state = state.copyWith(
      profileStatus: ProfileStatus.loading,
      clearProfileError: true,
    );
    await _fetchAndApplyProfile(userId, myGeneration, hardFailOnError: true);
  }

  /// Ends the session. Works from any state, including [AuthSessionPhase.timedOut]
  /// and every [TpShellGate] - see the library comment for exactly what this
  /// does and does not touch.
  Future<void> signOut() async {
    _restoreTimer?.cancel();
    _restoreTimer = null;
    _generation++;
    _lastForegroundCheckAt = null;
    _workspaceAdopted = false;

    final String? outgoingUserId = state.userId;

    try {
      await _auth.signOut();
    } on Object {
      // Best-effort - `AuthRepository.signOut` already swallows its own
      // failures, but this must hold even against a repository that does not.
      // Pressing the one control meant to escape a stuck screen must always
      // reach the login screen.
    }
    unawaited(_auth.stopAutoRefresh());

    if (outgoingUserId != null) {
      // This lane's OWN cache slot only - see the library comment. Cleared so
      // the next account on this device can never inherit a profile that was
      // never theirs.
      unawaited(_cache.clear());
    }

    ref.read(workspaceControllerProvider.notifier).clear();
    state = const AuthState.signedOut();
  }

  // --------------------------------------------------------------------
  // Session events
  // --------------------------------------------------------------------

  void _handleSessionSignal(AuthSessionSignal signal) {
    // See the library comment: defer to a fresh macrotask before touching
    // anything, as a defence against the reentrancy hazard already proven in
    // this project's web sibling.
    Timer.run(() => _applySessionSignal(signal));
  }

  void _applySessionSignal(AuthSessionSignal signal) {
    _restoreTimer?.cancel();
    _restoreTimer = null;

    if (!signal.hasSession) {
      _generation++;
      _lastForegroundCheckAt = null;
      _workspaceAdopted = false;
      unawaited(_auth.stopAutoRefresh());
      ref.read(workspaceControllerProvider.notifier).clear();
      state = const AuthState.signedOut();
      return;
    }

    final String userId = signal.userId!;
    if (state.sessionPhase == AuthSessionPhase.authenticated &&
        state.userId == userId) {
      // Same user, already authenticated - a token-refresh event, or a
      // duplicate delivery of the initial session. Re-running the bootstrap
      // here would flash a spinner over a working session and duplicate the
      // version-gate check for nothing.
      return;
    }

    _generation++;
    final int myGeneration = _generation;
    state = AuthState(
      sessionPhase: AuthSessionPhase.authenticated,
      userId: userId,
      profileStatus: ProfileStatus.loading,
    );
    unawaited(_startSession(userId, myGeneration));
  }

  void _handleRestoreTimeout() {
    // One-shot; if this runs, nothing else resolved the boot race first. A
    // LATER session event is still honoured normally by `_applySessionSignal`
    // - this is a temporary, recoverable state, never a dead end.
    state = const AuthState.timedOut();
  }

  Future<void> _startSession(String userId, int myGeneration) async {
    unawaited(_auth.startAutoRefresh());
    // Grants/matrix are not read here (see this class's own header note in
    // `auth_dependency_providers.dart`'s absence of any such provider); the
    // version-gate check runs in parallel with the profile fetch, exactly as
    // the React Native reference runs its grants/matrix fetches alongside the
    // AWAITED profile fetch - the profile is the security-critical path.
    unawaited(_runVersionGateCheck(myGeneration));
    await _fetchAndApplyProfile(userId, myGeneration, hardFailOnError: true);
  }

  Future<void> _runVersionGateCheck(int myGeneration) async {
    final VersionGateResult result = await _versionGate.check();
    if (myGeneration != _generation) {
      return; // superseded by a newer sign-in or a sign-out
    }
    state = state.copyWith(versionGate: result);
  }

  // --------------------------------------------------------------------
  // Foreground revalidation
  // --------------------------------------------------------------------

  void _handleForeground() {
    unawaited(_revalidateForeground());
  }

  Future<void> _revalidateForeground() async {
    if (state.sessionPhase != AuthSessionPhase.authenticated) {
      return;
    }
    final String? userId = state.userId;
    if (userId == null) {
      return;
    }
    final DateTime now = DateTime.now();
    if (!shouldRevalidateOnForeground(
      lastCheckedAt: _lastForegroundCheckAt,
      now: now,
    )) {
      return;
    }
    _lastForegroundCheckAt = now;

    unawaited(_auth.startAutoRefresh());

    // Deliberately NOT a new generation: this is a refresh within the current
    // session epoch, not a new one, so it must be superseded by (not itself
    // supersede) a sign-in/out that happens to land first.
    await _fetchAndApplyProfile(userId, _generation, hardFailOnError: false);
  }

  // --------------------------------------------------------------------
  // Shared profile-fetch application
  // --------------------------------------------------------------------

  Future<void> _fetchAndApplyProfile(
    String userId,
    int myGeneration, {
    required bool hardFailOnError,
  }) async {
    final ProfileFetchOutcome outcome = await _profiles.fetchProfile(userId);
    if (myGeneration != _generation) {
      return; // superseded
    }
    _applyProfileOutcome(outcome, hardFailOnError: hardFailOnError);
  }

  /// Applies one fetch outcome to [state].
  ///
  /// [hardFailOnError] tells apart the two contexts this is called from. The
  /// FIRST load after a sign-in, and an explicit retry, have nothing better to
  /// show on failure than [ProfileStatus.failed]. A SILENT foreground
  /// revalidation must not report that: the user was already working on
  /// whatever the last successful load gave them, and a lost signal must never
  /// read as a reason to take that away - see `mobile/contexts/AuthContext.tsx`'s
  /// own `silent` parameter on `fetchProfile` for the same distinction in the
  /// reference implementation.
  void _applyProfileOutcome(
    ProfileFetchOutcome outcome, {
    required bool hardFailOnError,
  }) {
    switch (outcome) {
      case ProfileFetchSucceeded(
        profile: final WorkspaceProfile profile,
        stale: final bool stale,
      ):
        state = state.copyWith(
          profileStatus: ProfileStatus.loaded,
          profile: profile,
          profileStale: stale,
          clearProfileError: true,
        );
        if (!_workspaceAdopted) {
          _adoptWorkspace(profile);
        }
        break;
      case ProfileFetchFailed(error: final AppError error):
        if (hardFailOnError) {
          state = state.copyWith(
            profileStatus: ProfileStatus.failed,
            profileError: error,
            clearProfile: true,
          );
        } else if (state.profileStatus == ProfileStatus.loaded) {
          // Keep the existing profile exactly as it was; just mark it
          // unverified. Nothing to do when there was no loaded profile to
          // begin with - a silent revalidation must not invent a failure the
          // user was not already looking at.
          state = state.copyWith(profileStale: true);
        }
        break;
    }
  }

  // --------------------------------------------------------------------
  // Workspace handoff
  // --------------------------------------------------------------------

  /// Installs the workspace once a profile has resolved for the first time
  /// this sign-in.
  ///
  /// PARTIAL BY NECESSITY - see the accompanying report for the full account.
  /// In short: [WorkspaceContext.fromProfile] needs an [AccessState], and this
  /// lane has no verified way to call the two RPCs that would populate its
  /// per-user grants and role-matrix maps (`get_my_access_grants` and
  /// `get_user_module_permissions` - both documented in artifact 04, neither
  /// present in the `SupabaseRpcs` registry this lane may read but not edit).
  /// Reporting [AccessState.permissionsError] as `true` here is the SAME
  /// convention [AccessState.signedOut] already uses for "no identity
  /// resolved yet, or nothing trustworthy to decide from" - it makes the three
  /// SENSITIVE modules (admin, users, approvals) fail CLOSED, while every
  /// ordinary module still falls through to the role default, exactly the
  /// asymmetry `access_resolver.dart` documents as deliberate for a
  /// genuinely-unavailable permission source.
  ///
  /// No default country, site or currency is chosen - `WorkspaceContext
  /// .fromProfile` with neither supplied yields a context with no country
  /// filter and no currency, which is the honest state spec section 8
  /// requires ("Never hard-code Saudi Arabia, SAR, one company, one site").
  void _adoptWorkspace(WorkspaceProfile profile) {
    _workspaceAdopted = true;
    final AccessState access = AccessState(
      role: profile.role,
      isSuperAdmin: profile.isSuperAdmin,
      permissionsError: true,
    );
    ref
        .read(workspaceControllerProvider.notifier)
        .adopt(
          WorkspaceContext.fromProfile(profile, effectivePermissions: access),
        );
  }

  // --------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------

  void _disposeSubscriptions() {
    _restoreTimer?.cancel();
    unawaited(_sessionSub?.cancel());
    unawaited(_foregroundSub?.cancel());
  }
}

/// The controller's provider.
final NotifierProvider<AuthController, AuthState> authControllerProvider =
    NotifierProvider<AuthController, AuthState>(AuthController.new);
