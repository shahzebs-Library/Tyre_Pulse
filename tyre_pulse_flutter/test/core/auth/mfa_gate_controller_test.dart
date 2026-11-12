/// The second sign-in step, at the controller: a session that owes a
/// multi-factor code is held at the gate, reads nothing about the account
/// until the code passes, and a broken assurance read never locks anyone out.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/session.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_profile_repository.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/auth/mfa_repository.dart';

import 'auth_test_support.dart';

final class _Harness {
  _Harness() {
    container = ProviderContainer(
      overrides: authTestOverrides(
        auth: auth,
        profiles: profiles,
        versionGate: versionGate,
        secureStore: store,
        foreground: foreground,
        mfa: mfa,
      ),
    );
    profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(profileWith());
  }

  final FakeAuthRepository auth = FakeAuthRepository();
  final FakeProfileRepository profiles = FakeProfileRepository();
  final FakeVersionGateRepository versionGate = FakeVersionGateRepository();
  final FakeSecureStore store = FakeSecureStore();
  final FakeForegroundSignal foreground = FakeForegroundSignal();
  final FakeMfaRepository mfa = FakeMfaRepository();

  late final ProviderContainer container;

  AuthController get controller =>
      container.read(authControllerProvider.notifier);

  AuthState get state => container.read(authControllerProvider);

  TpSession get session => deriveSession(state);

  Future<void> dispose() async {
    container.dispose();
    await auth.dispose();
    foreground.dispose();
  }
}

void main() {
  group('mfaAssuranceFor - the web rule (hasUnmetMfa)', () {
    test('aal1 with aal2 available owes a code', () {
      expect(
        mfaAssuranceFor(current: 'aal1', next: 'aal2'),
        MfaAssurance.challengeRequired,
      );
    });

    test('no factor, already verified, or unreadable owes nothing', () {
      expect(
        mfaAssuranceFor(current: 'aal1', next: 'aal1'),
        MfaAssurance.satisfied,
      );
      expect(
        mfaAssuranceFor(current: 'aal2', next: 'aal2'),
        MfaAssurance.satisfied,
      );
      expect(mfaAssuranceFor(), MfaAssurance.satisfied);
      expect(mfaAssuranceFor(next: 'aal2'), MfaAssurance.satisfied);
    });
  });

  group('deriveSession', () {
    test('an owed code gates ahead of every profile rule', () {
      const AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.authenticated,
        userId: 'user-1',
        profileStatus: ProfileStatus.loading,
        mfaStatus: MfaStatus.required,
      );
      expect(deriveSession(state).phase, TpSessionPhase.signedIn);
      expect(deriveSession(state).gate, TpShellGate.mfaRequired);
    });

    test('an owed code means nothing without a session', () {
      const AuthState state = AuthState(
        sessionPhase: AuthSessionPhase.signedOut,
        mfaStatus: MfaStatus.required,
      );
      expect(deriveSession(state), const TpSession.signedOut());
    });
  });

  group('after a password sign-in', () {
    test('an unmet factor shows the challenge and reads no profile', () async {
      final _Harness h = _Harness();
      addTearDown(h.dispose);
      h.mfa.assurance = MfaAssurance.challengeRequired;

      expect(h.state.sessionPhase, AuthSessionPhase.restoring);
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      await pumpEventQueue(times: 40);

      expect(h.state.mfaStatus, MfaStatus.required);
      expect(h.session.gate, TpShellGate.mfaRequired);
      expect(h.profiles.calls, isEmpty);
      expect(h.store.calls.where((String c) => c.startsWith('write')), isEmpty);
    });

    test('no factor goes straight through', () async {
      final _Harness h = _Harness();
      addTearDown(h.dispose);

      expect(h.state.sessionPhase, AuthSessionPhase.restoring);
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      await pumpEventQueue(times: 40);

      expect(h.state.mfaStatus, MfaStatus.satisfied);
      expect(h.session, const TpSession.signedIn());
      expect(h.mfa.verifiedCodes, isEmpty);
    });

    test('an unreadable assurance fails OPEN', () async {
      final _Harness h = _Harness();
      addTearDown(h.dispose);
      h.mfa.assuranceThrows = true;

      expect(h.state.sessionPhase, AuthSessionPhase.restoring);
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      await pumpEventQueue(times: 40);

      expect(h.session, const TpSession.signedIn());
    });
  });

  group('on session restore', () {
    test('a restored session that owes a code is gated from build()', () async {
      final _Harness h = _Harness();
      addTearDown(h.dispose);
      h.mfa.assurance = MfaAssurance.challengeRequired;
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));

      // The first read runs build().
      expect(h.session.gate, TpShellGate.mfaRequired);
      await pumpEventQueue(times: 40);
      expect(h.session.gate, TpShellGate.mfaRequired);
      expect(h.profiles.calls, isEmpty);
    });

    test('a restored, already-verified session goes straight through',
        () async {
      final _Harness h = _Harness();
      addTearDown(h.dispose);
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));

      expect(h.state.mfaStatus, MfaStatus.satisfied);
      await pumpEventQueue(times: 40);
      expect(h.session, const TpSession.signedIn());
    });

    test('returning to the foreground at the gate reads no profile', () async {
      final _Harness h = _Harness();
      addTearDown(h.dispose);
      h.mfa.assurance = MfaAssurance.challengeRequired;
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      expect(h.session.gate, TpShellGate.mfaRequired);

      h.foreground.resume();
      await pumpEventQueue(times: 40);

      expect(h.profiles.calls, isEmpty);
      expect(h.session.gate, TpShellGate.mfaRequired);
    });
  });

  group('verifyMfa', () {
    Future<_Harness> gated() async {
      final _Harness h = _Harness();
      addTearDown(h.dispose);
      h.mfa.assurance = MfaAssurance.challengeRequired;
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      expect(h.session.gate, TpShellGate.mfaRequired);
      await pumpEventQueue(times: 40);
      return h;
    }

    test('an accepted code loads the profile and opens the app', () async {
      final _Harness h = await gated();

      final MfaVerifyOutcome outcome = await h.controller.verifyMfa(' 123456 ');
      expect(outcome, isA<MfaVerified>());
      expect(h.mfa.verifiedCodes, <String>['123456']);
      // Never "signed in, no gate" before the profile has settled.
      expect(h.session, const TpSession.resolving());

      await pumpEventQueue(times: 40);
      expect(h.state.profileStatus, ProfileStatus.loaded);
      expect(h.session, const TpSession.signedIn());
      expect(h.profiles.calls, <String>['fetchProfile:user-1']);
    });

    test('the upgraded-token session event does not restart the session',
        () async {
      final _Harness h = await gated();
      await h.controller.verifyMfa('123456');
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      await pumpEventQueue(times: 40);

      expect(h.session, const TpSession.signedIn());
      expect(h.profiles.calls, <String>['fetchProfile:user-1']);
    });

    test('a refused code keeps the gate', () async {
      final _Harness h = await gated();
      h.mfa.verifyOutcome = const MfaCodeRejected();

      expect(await h.controller.verifyMfa('000000'), isA<MfaCodeRejected>());
      await pumpEventQueue(times: 40);
      expect(h.session.gate, TpShellGate.mfaRequired);
      expect(h.profiles.calls, isEmpty);
    });

    test('an unreachable server keeps the gate', () async {
      final _Harness h = await gated();
      h.mfa.verifyOutcome = const MfaVerifyUnavailable();

      expect(
        await h.controller.verifyMfa('123456'),
        isA<MfaVerifyUnavailable>(),
      );
      expect(h.session.gate, TpShellGate.mfaRequired);
    });

    test('signing out from the gate reaches signed out', () async {
      final _Harness h = await gated();
      await h.controller.signOut();
      expect(h.session, const TpSession.signedOut());
      expect(h.state.mfaStatus, MfaStatus.satisfied);
    });

    test('with nothing owed it does not call the server', () async {
      final _Harness h = _Harness();
      addTearDown(h.dispose);
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      expect(h.state.mfaStatus, MfaStatus.satisfied);
      await pumpEventQueue(times: 40);

      expect(await h.controller.verifyMfa('123456'), isA<MfaVerified>());
      expect(h.mfa.verifiedCodes, isEmpty);
    });
  });
}
