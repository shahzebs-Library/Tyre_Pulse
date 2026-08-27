/// Shared test doubles for the authentication layer.
///
/// Extracted from `auth_controller_test.dart` (which imports these from here
/// rather than declaring them itself) so a second suite exercising the same
/// wiring - `test/features/auth/presentation/login_screen_test.dart` - does
/// not need a second hand-written copy. Mirrors the established pattern in
/// this codebase for sharing fakes across sibling test files: see
/// `test/features/records/records_test_support.dart` and its own callers
/// (`tyre_records_list_screen_test.dart`, `tyre_detail_sheet_test.dart`,
/// `tyre_records_list_controller_test.dart`), which is what this file's own
/// shape is modelled on.
///
/// [authTestOverrides] is the one addition beyond a straight extraction: both
/// callers need the IDENTICAL six-provider override list
/// [AuthController.build] requires just to run at all (it reads
/// `authRepositoryProvider`, `profileRepositoryProvider`,
/// `versionGateRepositoryProvider`, `profileCacheProvider`,
/// `foregroundSignalProvider` and `sessionRestoreTimeoutDurationProvider`
/// unconditionally - see that method's own body), so writing it once here is
/// what stops a future third caller reproducing it a third time, slightly
/// differently, and drifting.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
// `Override` is deliberately not exported by the main flutter_riverpod
// barrel in Riverpod 3.x - see `vehicles_list_screen_test.dart`'s own
// identical comment for why `misc.dart` is the sanctioned way to name it
// explicitly, needed here because [authTestOverrides] returns a typed list
// rather than relying on inline list-literal inference.
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:tyre_pulse/core/auth/app_version.dart';
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/auth/auth_profile_repository.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/auth_version_gate_repository.dart';
import 'package:tyre_pulse/core/auth/foreground_signal.dart';
import 'package:tyre_pulse/core/auth/profile_cache.dart';
import 'package:tyre_pulse/core/auth/sign_in_outcome.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/// Every method call this fake session store was ever asked for, in order.
/// Deliberately the SAME shape `workspace_switch_test.dart`'s
/// `FakeDependencies` uses: the list itself is the proof, not just a stub
/// returning canned data.
final class FakeAuthRepository implements AuthRepository {
  final StreamController<AuthSessionSignal> _controller =
      StreamController<AuthSessionSignal>.broadcast();

  AuthSessionSignal _current = const AuthSessionSignal.none();
  final List<String> calls = <String>[];

  /// What [signIn] returns, and how long it takes to return it. Overridable
  /// per test - defaults to succeeding immediately, which is the only
  /// behaviour `auth_controller_test.dart`'s own suite has ever needed (it
  /// drives a sign-in through [emit] instead of through this method).
  /// `login_screen_test.dart` sets this per case to drive
  /// [LoginScreen] through every [SignInOutcome] branch, and can hold it
  /// open indefinitely (a `Completer` that never completes) to exercise the
  /// screen's in-flight busy state.
  Future<SignInOutcome> Function(String identifier, String password)
      signInHandler =
      (String identifier, String password) async => const SignInSucceeded();

  /// Pushes a new session signal, as a real `onAuthStateChange` event would.
  void emit(AuthSessionSignal signal) {
    _current = signal;
    _controller.add(signal);
  }

  @override
  AuthSessionSignal get currentSession => _current;

  @override
  Stream<AuthSessionSignal> get sessionChanges => _controller.stream;

  @override
  Future<SignInOutcome> signIn({
    required String identifier,
    required String password,
  }) async {
    calls.add('signIn');
    return signInHandler(identifier, password);
  }

  @override
  Future<void> signOut() async {
    calls.add('signOut');
    // Deliberately does NOT emit a signedOut signal on its own. This is what
    // proves `AuthController.signOut()` reaches the signed-out state by its
    // own explicit transition, not by depending on this firing - see
    // `auth_controller_test.dart`'s "signOut works even when no session
    // event follows it" test.
  }

  @override
  Future<void> startAutoRefresh() async {
    calls.add('startAutoRefresh');
  }

  @override
  Future<void> stopAutoRefresh() async {
    calls.add('stopAutoRefresh');
  }

  Future<void> dispose() => _controller.close();
}

final class FakeProfileRepository implements ProfileRepository {
  final Map<String, ProfileFetchOutcome> outcomeByUserId =
      <String, ProfileFetchOutcome>{};
  final List<String> calls = <String>[];

  @override
  Future<ProfileFetchOutcome> fetchProfile(String userId) async {
    calls.add('fetchProfile:$userId');
    return outcomeByUserId[userId] ??
        ProfileFetchFailed(
          AppError(
            kind: AppErrorKind.unknown,
            message: 'no fixture registered for $userId',
          ),
        );
  }
}

final class FakeVersionGateRepository implements VersionGateRepository {
  VersionGateResult result = const VersionGateResult.notChecked();
  int callCount = 0;

  @override
  Future<VersionGateResult> check() async {
    callCount++;
    return result;
  }
}

final class FakeForegroundSignal implements ForegroundSignal {
  final StreamController<void> _controller = StreamController<void>.broadcast();
  bool disposed = false;

  void resume() => _controller.add(null);

  @override
  Stream<void> get onResumed => _controller.stream;

  @override
  void dispose() {
    disposed = true;
    unawaited(_controller.close());
  }
}

/// A trivial in-memory [SecureKeyValueStore]. [ProfileCache] is a `final`
/// class and cannot itself be faked from another library, so the real
/// [ProfileCache] is exercised over this instead - which also means the
/// cache logic is genuinely tested, not stubbed away.
final class FakeSecureStore extends SecureKeyValueStore {
  final Map<String, String> _values = <String, String>{};
  final List<String> calls = <String>[];

  @override
  int get readFailureCount => 0;

  @override
  Future<SecureRead> read(String key) async {
    calls.add('read:$key');
    final String? value = _values[key];
    return value == null ? const SecureRead.absent() : SecureRead.ok(value);
  }

  @override
  Future<void> write(String key, String value) async {
    calls.add('write:$key');
    _values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    calls.add('delete:$key');
    _values.remove(key);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

Map<String, Object?> profileRow({
  String id = 'user-1',
  bool approved = true,
  bool locked = false,
}) =>
    <String, Object?>{
      'id': id,
      'role': 'Manager',
      'country': const <String>['ALL'],
      'sites': const <String>['ALL'],
      'org_id': 'org-1',
      'organisation_id': 'org-1',
      'is_super_admin': false,
      'approved': approved,
      'locked': locked,
      'site': null,
      'full_name': 'Test User',
    };

WorkspaceProfile profileWith({
  String id = 'user-1',
  bool approved = true,
  bool locked = false,
}) =>
    WorkspaceProfile.fromRow(
      profileRow(id: id, approved: approved, locked: locked),
    );

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

/// The complete override set [AuthController.build] needs to run at all -
/// see the library comment. Usable both with a raw [ProviderContainer]
/// (`auth_controller_test.dart`'s own `Harness`) and with a widget-level
/// `ProviderScope` (`login_screen_test.dart`): both accept a plain
/// `List<Override>`.
List<Override> authTestOverrides({
  required FakeAuthRepository auth,
  required FakeProfileRepository profiles,
  required FakeVersionGateRepository versionGate,
  required FakeSecureStore secureStore,
  required FakeForegroundSignal foreground,
  Duration restoreTimeout = const Duration(milliseconds: 30),
}) =>
    <Override>[
      authRepositoryProvider.overrideWith((Ref ref) => auth),
      profileRepositoryProvider.overrideWith((Ref ref) => profiles),
      versionGateRepositoryProvider.overrideWith((Ref ref) => versionGate),
      profileCacheProvider.overrideWith(
        (Ref ref) => ProfileCache(secureStore),
      ),
      foregroundSignalProvider.overrideWith((Ref ref) => foreground),
      sessionRestoreTimeoutDurationProvider.overrideWith(
        (Ref ref) => restoreTimeout,
      ),
    ];
