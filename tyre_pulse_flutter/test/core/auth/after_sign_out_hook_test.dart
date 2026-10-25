/// The post-sign-out clean-up hook (today: wiping the offline work-assignment
/// cache). It must run on an explicit sign-out and when the session ends by
/// itself, and a failing hook must never keep anyone from the login screen.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/auth/auth_profile_repository.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';

import 'auth_test_support.dart';

final class _Rig {
  _Rig({Future<void> Function()? hook}) {
    container = ProviderContainer(
      overrides: <Override>[
        ...authTestOverrides(
          auth: auth,
          profiles: profiles,
          versionGate: versionGate,
          secureStore: store,
          foreground: foreground,
        ),
        afterSignOutProvider.overrideWith(
          (Ref ref) => hook ??
              () async {
                runs++;
              },
        ),
      ],
    );
  }

  final FakeAuthRepository auth = FakeAuthRepository();
  final FakeProfileRepository profiles = FakeProfileRepository();
  final FakeVersionGateRepository versionGate = FakeVersionGateRepository();
  final FakeSecureStore store = FakeSecureStore();
  final FakeForegroundSignal foreground = FakeForegroundSignal();
  late final ProviderContainer container;
  int runs = 0;

  AuthController get controller =>
      container.read(authControllerProvider.notifier);

  AuthState get state => container.read(authControllerProvider);

  Future<void> dispose() async {
    container.dispose();
    await auth.dispose();
    foreground.dispose();
  }
}

void main() {
  test('an explicit sign-out runs the clean-up hook once', () async {
    final _Rig rig = _Rig();
    addTearDown(rig.dispose);
    // Build the controller first so it is listening to the session stream.
    expect(rig.state.sessionPhase, isNotNull);
    rig.profiles.outcomeByUserId['user-1'] =
        ProfileFetchSucceeded(profileWith());
    rig.auth.emit(const AuthSessionSignal(userId: 'user-1'));
    await pumpEventQueue(times: 40);

    await rig.controller.signOut();
    await pumpEventQueue(times: 20);

    expect(rig.runs, 1);
    expect(rig.state.sessionPhase, AuthSessionPhase.signedOut);
  });

  test('a session that ends by itself also runs the hook', () async {
    final _Rig rig = _Rig();
    addTearDown(rig.dispose);
    // Build the controller first so it is listening to the session stream.
    expect(rig.state.sessionPhase, isNotNull);
    rig.profiles.outcomeByUserId['user-1'] =
        ProfileFetchSucceeded(profileWith());
    rig.auth.emit(const AuthSessionSignal(userId: 'user-1'));
    await pumpEventQueue(times: 40);

    rig.auth.emit(const AuthSessionSignal.none());
    await pumpEventQueue(times: 40);

    expect(rig.runs, 1);
    expect(rig.state.sessionPhase, AuthSessionPhase.signedOut);
  });

  test('a throwing hook cannot stop sign-out', () async {
    final _Rig rig = _Rig(hook: () async => throw StateError('disk full'));
    addTearDown(rig.dispose);

    await rig.controller.signOut();
    await pumpEventQueue(times: 20);

    expect(rig.state.sessionPhase, AuthSessionPhase.signedOut);
  });
}
