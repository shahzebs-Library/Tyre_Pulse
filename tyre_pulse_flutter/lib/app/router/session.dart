/// The narrow view of authentication that navigation needs.
///
/// The real authentication lifecycle - session restore, refresh, profile load,
/// lock and approval - belongs to the auth layer (spec section 6). Navigation
/// needs four facts and no more, so it depends on these four and not on the
/// whole auth model.
///
/// WIRING: the auth layer overrides [sessionProvider]. The default is
/// [TpSession.signedOut], which is honest: a build with no auth wired has no
/// session. It is deliberately NOT [TpSessionPhase.resolving] - a default of
/// "still resolving" would render the splash forever, which is the exact
/// failure this file's third phase exists to prevent.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Where the session is.
enum TpSessionPhase {
  /// Reading the stored session. A BOUNDED state - see [timedOut].
  resolving,

  /// The stored session could not be read in time.
  ///
  /// Artifact 03 section 1.1: this third state is not optional. Reading the
  /// session out of the Android keystore stalls on low-end hardware, and the
  /// boot screen used to spin forever. It is recoverable: try again, or sign in
  /// from the start. A redirect that only knows "signed in / not signed in"
  /// reproduces the permanent spinner.
  timedOut,

  /// No session. Sign in.
  signedOut,

  /// There is a session.
  signedIn,
}

/// A full-screen gate that runs BEFORE the tabs render.
///
/// Artifact 03 section 5.6: these are STATES, not routes. Putting them on
/// routes lets a deep link skip them.
enum TpShellGate {
  /// Nothing in the way.
  none,

  /// This build is too old to keep using.
  ///
  /// Fails OPEN by construction upstream: the check starts false and only flips
  /// when the server explicitly reports this build too old. Never lock a field
  /// worker out over a version check.
  updateRequired,

  /// The profile did not load, so the app cannot tell what the user may do.
  /// Fails CLOSED: guessing permissions is worse than saying so.
  profileUnavailable,

  /// The account is not approved, or is locked.
  accessBlocked,
}

/// What navigation knows about the current user.
@immutable
class TpSession {
  const TpSession({required this.phase, this.gate = TpShellGate.none});

  const TpSession.resolving()
      : phase = TpSessionPhase.resolving,
        gate = TpShellGate.none;

  const TpSession.timedOut()
      : phase = TpSessionPhase.timedOut,
        gate = TpShellGate.none;

  const TpSession.signedOut()
      : phase = TpSessionPhase.signedOut,
        gate = TpShellGate.none;

  const TpSession.signedIn({this.gate = TpShellGate.none})
      : phase = TpSessionPhase.signedIn;

  final TpSessionPhase phase;

  /// Only meaningful when [phase] is [TpSessionPhase.signedIn].
  final TpShellGate gate;

  bool get isSignedIn => phase == TpSessionPhase.signedIn;

  /// Whether the session is still being read.
  ///
  /// This must cover BOTH the session read and the profile read. The React
  /// Native `AuthContext` clears its `loading` flag BEFORE the profile
  /// resolves, so a guard that waits only on the first one evaluates a null
  /// profile on a cold start or a deep link and denies everybody, admin
  /// included. Whoever implements this provider must not repeat that.
  bool get isResolving => phase == TpSessionPhase.resolving;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TpSession && other.phase == phase && other.gate == gate);

  @override
  int get hashCode => Object.hash(phase, gate);

  @override
  String toString() => 'TpSession(${phase.name}, gate: ${gate.name})';
}

/// Override this from the authentication layer.
final Provider<TpSession> sessionProvider = Provider<TpSession>(
  (ref) => const TpSession.signedOut(),
);
