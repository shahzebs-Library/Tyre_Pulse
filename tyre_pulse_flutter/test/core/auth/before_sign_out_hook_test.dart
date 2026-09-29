import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/auth/auth_profile_repository.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';

import 'auth_test_support.dart';

/// The push token is revoked through `beforeSignOutProvider`, which must run
/// while the session still exists and must never keep someone from signing
/// out.
void main() {
  late FakeAuthRepository auth;
  late FakeProfileRepository profiles;
  late FakeForegroundSignal foreground;
  late List<String> order;

  ProviderContainer build(Future<void> Function() hook) {
    final ProviderContainer container = ProviderContainer(
      overrides: [
        ...authTestOverrides(
          auth: auth,
          profiles: profiles,
          versionGate: FakeVersionGateRepository(),
          secureStore: FakeSecureStore(),
          foreground: foreground,
          permissions: FakeAccessPermissionsRepository(),
        ),
        beforeSignOutProvider.overrideWithValue(hook),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  Future<void> signIn(ProviderContainer container) async {
    auth.emit(const AuthSessionSignal(userId: 'user-1'));
    container.read(authControllerProvider);
    await pumpEventQueue(times: 40);
  }

  setUp(() {
    auth = FakeAuthRepository();
    profiles = FakeProfileRepository();
    foreground = FakeForegroundSignal();
    order = <String>[];
    profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(profileWith());
  });

  tearDown(() async {
    await auth.dispose();
    foreground.dispose();
  });

  test('the hook runs before the session is ended', () async {
    final ProviderContainer container = build(() async {
      order
        ..add('hook')
        ..addAll(auth.calls.where((String c) => c == 'signOut'));
    });
    await signIn(container);
    await container.read(authControllerProvider.notifier).signOut();
    expect(order, <String>['hook']);
    expect(auth.calls, contains('signOut'));
    expect(
      container.read(authControllerProvider).sessionPhase,
      AuthSessionPhase.signedOut,
    );
  });

  test('a failing hook still signs out', () async {
    final ProviderContainer container =
        build(() async => throw StateError('offline'));
    await signIn(container);
    await container.read(authControllerProvider.notifier).signOut();
    expect(auth.calls, contains('signOut'));
    expect(
      container.read(authControllerProvider).sessionPhase,
      AuthSessionPhase.signedOut,
    );
  });

  test(
    'a hook that never finishes is abandoned',
    () async {
      final ProviderContainer container = build(() => Completer<void>().future);
      await signIn(container);
      await container.read(authControllerProvider.notifier).signOut();
      expect(auth.calls, contains('signOut'));
    },
    timeout: const Timeout(Duration(seconds: 15)),
  );
}
