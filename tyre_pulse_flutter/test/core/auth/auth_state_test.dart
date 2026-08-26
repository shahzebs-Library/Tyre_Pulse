/// Pins the rule this whole lane exists to get right: [deriveSession] must
/// never report a signed-in session, and must never stop reporting
/// [TpSession.isResolving], while the profile fetch is still in flight.
///
/// Every value here is constructed directly - no controller, no async gap, no
/// widget - because the joint-resolving rule is a property of a pure function
/// over a value, and that is exactly what makes it provable without a device.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/session.dart';
import 'package:tyre_pulse/core/auth/app_version.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

WorkspaceProfile profileWith({
  bool approved = true,
  bool locked = false,
  String role = 'Manager',
}) =>
    WorkspaceProfile.fromRow(<String, Object?>{
      'id': 'user-1',
      'role': role,
      'country': const <String>['ALL'],
      'sites': const <String>['ALL'],
      'org_id': 'org-1',
      'organisation_id': 'org-1',
      'is_super_admin': false,
      'approved': approved,
      'locked': locked,
      'site': null,
      'full_name': 'Test User',
    });

const AppError sampleError = AppError(
  kind: AppErrorKind.network,
  message: 'No connection.',
  technical: 'test fixture',
);

void main() {
  group('the underlying session phase passes straight through', () {
    test('restoring', () {
      expect(deriveSession(const AuthState.restoring()).phase,
          TpSessionPhase.resolving);
    });

    test('timedOut', () {
      expect(deriveSession(const AuthState.timedOut()).phase,
          TpSessionPhase.timedOut);
    });

    test('signedOut', () {
      expect(deriveSession(const AuthState.signedOut()).phase,
          TpSessionPhase.signedOut);
    });

    test('none of the three carries a gate, and none is `isResolving` except '
        'restoring', () {
      expect(
        deriveSession(const AuthState.restoring()).isResolving,
        isTrue,
      );
      expect(
        deriveSession(const AuthState.timedOut()).isResolving,
        isFalse,
      );
      expect(
        deriveSession(const AuthState.signedOut()).isResolving,
        isFalse,
      );
    });

    test(
        'a stray profile or version-gate value on a non-authenticated phase '
        'changes nothing - only sessionPhase decides these three', () {
      final AuthState withExtras = AuthState(
        sessionPhase: AuthSessionPhase.signedOut,
        profileStatus: ProfileStatus.loaded,
        profile: profileWith(),
        versionGate: const VersionGateResult(
          reason: VersionGateReason.buildBelowMinimum,
          currentVersion: '1.0.0',
          minimumVersion: '2.0.0',
        ),
      );
      expect(deriveSession(withExtras).phase, TpSessionPhase.signedOut);
      expect(deriveSession(withExtras).gate, TpShellGate.none);
    });
  });

  group('THE JOINT-RESOLVING RULE', () {
    test(
        'a session exists but the profile fetch has not even started yet - '
        'this is resolving, never signedIn', () {
      const AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
      ); // profileStatus defaults to ProfileStatus.none

      final TpSession session = deriveSession(state);
      expect(session.phase, TpSessionPhase.resolving);
      expect(session.isResolving, isTrue);
      expect(session.isSignedIn, isFalse);
    });

    test(
        'a session exists and the profile fetch is in flight - still '
        'resolving, still not signedIn', () {
      const AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.loading,
      );

      final TpSession session = deriveSession(state);
      expect(session.phase, TpSessionPhase.resolving);
      expect(session.isResolving, isTrue);
    });

    test(
        'this is exactly the shape of the bug this rule exists to make '
        'unwritable: a session phase alone is never enough to report '
        'signed in', () {
      // The React Native `AuthContext` cleared its `loading` flag as soon as
      // the SESSION resolved, before the profile did. Reproduced here as the
      // state a guard reading only session-phase would be tempted to treat as
      // "ready": authenticated, with a profile fetch that has not settled.
      for (final ProfileStatus notSettled in <ProfileStatus>[
        ProfileStatus.none,
        ProfileStatus.loading,
      ]) {
        final AuthState state = AuthState(
          sessionPhase: AuthSessionPhase.authenticated,
          userId: 'user-1',
          profileStatus: notSettled,
        );
        final TpSession session = deriveSession(state);
        expect(
          session.isSignedIn,
          isFalse,
          reason: 'profileStatus was ${notSettled.name}',
        );
        expect(
          session.isResolving,
          isTrue,
          reason: 'profileStatus was ${notSettled.name}',
        );
      }
    });

    test(
        'only once the profile has actually settled - loaded OR failed - may '
        'isResolving become false', () {
      final AuthState loaded = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.loaded,
        profile: profileWith(),
      );
      expect(deriveSession(loaded).isResolving, isFalse);

      const AuthState failed = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.failed,
        profileError: sampleError,
      );
      expect(deriveSession(failed).isResolving, isFalse);
    });
  });

  group('a profile that failed to load fails CLOSED', () {
    test('profileUnavailable, never a guess', () {
      const AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.failed,
        profileError: sampleError,
      );
      final TpSession session = deriveSession(state);
      expect(session.phase, TpSessionPhase.signedIn);
      expect(session.gate, TpShellGate.profileUnavailable);
    });

    test(
        'loaded with no profile value (a controller bug, not a reachable '
        'user state) fails exactly the same way rather than crashing', () {
      const AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.loaded,
      ); // profile deliberately omitted
      expect(
        deriveSession(state).gate,
        TpShellGate.profileUnavailable,
      );
    });
  });

  group('locked or unapproved reports accessBlocked', () {
    test('locked', () {
      final AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.loaded,
        profile: profileWith(locked: true),
      );
      expect(deriveSession(state).gate, TpShellGate.accessBlocked);
    });

    test('not approved', () {
      final AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.loaded,
        profile: profileWith(approved: false),
      );
      expect(deriveSession(state).gate, TpShellGate.accessBlocked);
    });

    test('an approved, unlocked profile is not blocked on this account alone',
        () {
      final AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.loaded,
        profile: profileWith(),
      );
      expect(deriveSession(state).gate, TpShellGate.none);
    });

    test(
        'accessBlocked wins over a simultaneous blocking version gate - '
        'updating the app cannot fix a locked account', () {
      final AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.loaded,
        profile: profileWith(locked: true),
        versionGate: const VersionGateResult(
          reason: VersionGateReason.buildBelowMinimum,
          currentVersion: '1.0.0',
          minimumVersion: '2.0.0',
        ),
      );
      expect(deriveSession(state).gate, TpShellGate.accessBlocked);
    });
  });

  group('the version gate only blocks on the ONE blocking reason', () {
    // This is the whole point of app_version.dart's fail-open design, tested
    // again from the session-derivation side: every reason except
    // buildBelowMinimum must sail through to `TpShellGate.none`.
    final Map<VersionGateReason, VersionGateResult> nonBlocking =
        <VersionGateReason, VersionGateResult>{
      VersionGateReason.notChecked: const VersionGateResult.notChecked(),
      VersionGateReason.noMinimumConfigured: const VersionGateResult(
        reason: VersionGateReason.noMinimumConfigured,
        currentVersion: '1.0.0',
      ),
      VersionGateReason.minimumUnparseable: const VersionGateResult(
        reason: VersionGateReason.minimumUnparseable,
        currentVersion: '1.0.0',
        minimumVersion: 'not-a-version',
      ),
      VersionGateReason.minimumUnreadable: const VersionGateResult(
        reason: VersionGateReason.minimumUnreadable,
        currentVersion: '1.0.0',
      ),
      VersionGateReason.buildMeetsMinimum: const VersionGateResult(
        reason: VersionGateReason.buildMeetsMinimum,
        currentVersion: '2.0.0',
        minimumVersion: '1.0.0',
      ),
    };

    for (final MapEntry<VersionGateReason, VersionGateResult> entry
        in nonBlocking.entries) {
      test('${entry.key.name} never gates the shell', () {
        final AuthState state = AuthState(
          sessionPhase: AuthSessionPhase.authenticated,
          userId: 'user-1',
          profileStatus: ProfileStatus.loaded,
          profile: profileWith(),
          versionGate: entry.value,
        );
        final TpSession session = deriveSession(state);
        expect(session.gate, TpShellGate.none);
        expect(session.isSignedIn, isTrue);
      });
    }

    test('buildBelowMinimum is the ONLY reason that reaches updateRequired',
        () {
      final AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.loaded,
        profile: profileWith(),
        versionGate: const VersionGateResult(
          reason: VersionGateReason.buildBelowMinimum,
          currentVersion: '1.0.0',
          minimumVersion: '2.0.0',
        ),
      );
      expect(deriveSession(state).gate, TpShellGate.updateRequired);
    });

    test('a version check still in flight (notChecked) never blocks sign-in',
        () {
      // This is the specific race this rule protects: the profile can settle
      // before the version-gate fetch does (they run in parallel), and that
      // must render an ordinary signed-in app, not a stuck gate.
      final AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.loaded,
        profile: profileWith(),
      ); // versionGate defaults to VersionGateResult.notChecked()
      expect(deriveSession(state).gate, TpShellGate.none);
    });
  });

  group('the fully healthy path', () {
    test('an approved, unlocked profile with a passing version gate is '
        'simply signed in', () {
      final AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.loaded,
        profile: profileWith(),
        versionGate: const VersionGateResult(
          reason: VersionGateReason.buildMeetsMinimum,
          currentVersion: '2.0.0',
          minimumVersion: '1.0.0',
        ),
      );
      final TpSession session = deriveSession(state);
      expect(session.phase, TpSessionPhase.signedIn);
      expect(session.gate, TpShellGate.none);
      expect(session.isResolving, isFalse);
    });
  });
}
