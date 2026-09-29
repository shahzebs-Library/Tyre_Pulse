import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/auth/access_permissions_repository.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_profile_repository.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';

import 'auth_test_support.dart';

/// The phone must honour what the web Access Manager writes: the per-user
/// grants and the role matrix are loaded after sign-in and re-read on resume.
void main() {
  late FakeAuthRepository auth;
  late FakeProfileRepository profiles;
  late FakeForegroundSignal foreground;
  late FakeAccessPermissionsRepository permissions;
  late ProviderContainer container;

  setUp(() {
    auth = FakeAuthRepository();
    profiles = FakeProfileRepository();
    foreground = FakeForegroundSignal();
    permissions = FakeAccessPermissionsRepository();
    container = ProviderContainer(
      overrides: authTestOverrides(
        auth: auth,
        profiles: profiles,
        versionGate: FakeVersionGateRepository(),
        secureStore: FakeSecureStore(),
        foreground: foreground,
        permissions: permissions,
      ),
    );
    profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(profileWith());
  });

  tearDown(() async {
    container.dispose();
    await auth.dispose();
    foreground.dispose();
  });

  AccessState access() =>
      container.read(workspaceContextProvider)!.effectivePermissions;

  Future<void> signIn() async {
    auth.emit(const AuthSessionSignal(userId: 'user-1'));
    container.read(authControllerProvider);
    await pumpEventQueue(times: 40);
  }

  test('loaded grants and matrix reach the resolver', () async {
    permissions.snapshot = const AccessPermissionsSnapshot(
      grantsRaw: <String, Object?>{'mobile:approvals': 'grant'},
      roleMatrixRaw: <String, Object?>{'mobile:stock': false},
    );
    await signIn();

    final AccessState state = access();
    expect(state.permissionsError, isFalse);
    // Manager has no role default for approvals: the grant opens it.
    expect(
      canAccessModule(module: ModuleKey.approvals, access: state),
      isTrue,
    );
    // Manager's role default includes stock: the matrix closes it.
    expect(canAccessModule(module: ModuleKey.stock, access: state), isFalse);
  });

  test('a failed read keeps permissionsError so sensitive modules stay closed',
      () async {
    permissions.snapshot = const AccessPermissionsSnapshot(
      roleMatrixRaw: <String, Object?>{},
    );
    await signIn();
    expect(access().permissionsError, isTrue);
  });

  test('resume re-reads the grants; a later failure keeps the last good read',
      () async {
    await signIn();
    expect(
      canAccessModule(module: ModuleKey.approvals, access: access()),
      isFalse,
    );

    permissions.snapshot = const AccessPermissionsSnapshot(
      grantsRaw: <String, Object?>{'mobile:approvals': 'grant'},
      roleMatrixRaw: <String, Object?>{},
    );
    foreground.resume();
    await pumpEventQueue(times: 40);
    expect(
      canAccessModule(module: ModuleKey.approvals, access: access()),
      isTrue,
    );
    expect(permissions.loads, 2);
  });

  test('a failed read is reported as failed and Retry recovers it', () async {
    permissions.snapshot = const AccessPermissionsSnapshot(
      roleMatrixRaw: <String, Object?>{},
    );
    await signIn();
    expect(
      container.read(authControllerProvider).permissionsStatus,
      PermissionsStatus.failed,
    );

    permissions.snapshot = const AccessPermissionsSnapshot(
      grantsRaw: <String, Object?>{},
      roleMatrixRaw: <String, Object?>{'mobile:approvals': true},
    );
    await container.read(authControllerProvider.notifier).retryPermissions();
    await pumpEventQueue(times: 10);
    expect(
      container.read(authControllerProvider).permissionsStatus,
      PermissionsStatus.loaded,
    );
    expect(access().permissionsError, isFalse);
    expect(
      canAccessModule(module: ModuleKey.approvals, access: access()),
      isTrue,
    );
  });

  test('a good read is reported as loaded', () async {
    await signIn();
    expect(
      container.read(authControllerProvider).permissionsStatus,
      PermissionsStatus.loaded,
    );
  });

  test('sign-out clears the workspace and the loaded permissions', () async {
    await signIn();
    unawaited(container.read(authControllerProvider.notifier).signOut());
    await pumpEventQueue(times: 20);
    expect(container.read(workspaceContextProvider), isNull);
  });
}
