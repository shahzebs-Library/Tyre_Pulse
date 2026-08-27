/// [AuthController] wired end to end, over hand-written fakes rather than
/// mocks - so the RECORDED CALL LIST is part of the assertion, exactly the
/// reasoning `test/core/workspace/workspace_switch_test.dart` gives for the
/// same choice: the sign-out guarantee below is a rule about what is NOT
/// called, and a call list is the only way to test that.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/session.dart';
import 'package:tyre_pulse/core/auth/app_version.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/auth/auth_profile_repository.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/auth/auth_version_gate_repository.dart';
import 'package:tyre_pulse/core/auth/foreground_signal.dart';
import 'package:tyre_pulse/core/auth/profile_cache.dart';
import 'package:tyre_pulse/core/auth/sign_in_outcome.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';
import 'package:tyre_pulse/core/storage/secure_read.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/// Every method call this fake session store was ever asked for, in order.
/// Deliberately the SAME shape `workspace_switch_test.dart`'s `FakeDependencies`
/// uses: the list itself is the proof, not just a stub returning canned data.
final class FakeAuthRepository implements AuthRepository {
  final StreamController<AuthSessionSignal> _controller =
      StreamController<AuthSessionSignal>.broadcast();

  AuthSessionSignal _current = const AuthSessionSignal.none();
  final List<String> calls = <String>[];

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
    return const SignInSucceeded();
  }

  @override
  Future<void> signOut() async {
    calls.add('signOut');
    // Deliberately does NOT emit a signedOut signal on its own. This is what
    // proves `AuthController.signOut()` reaches the signed-out state by its
    // own explicit transition, not by depending on this firing - see the
    // 'signOut works even when no session event follows it' test below.
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
/// [ProfileCache] is exercised over this instead - which also means the cache
/// logic is genuinely tested, not stubbed away.
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
// Harness
// ---------------------------------------------------------------------------

final class Harness {
  Harness({Duration restoreTimeout = const Duration(milliseconds: 30)}) {
    container = ProviderContainer(
      overrides: [
        authRepositoryProvider.overrideWith((Ref ref) => auth),
        profileRepositoryProvider.overrideWith((Ref ref) => profiles),
        versionGateRepositoryProvider.overrideWith((Ref ref) => versionGate),
        profileCacheProvider.overrideWith((Ref ref) => cache),
        foregroundSignalProvider.overrideWith((Ref ref) => foreground),
        sessionRestoreTimeoutDurationProvider.overrideWith(
          (Ref ref) => restoreTimeout,
        ),
      ],
    );
  }

  final FakeAuthRepository auth = FakeAuthRepository();
  final FakeProfileRepository profiles = FakeProfileRepository();
  final FakeVersionGateRepository versionGate = FakeVersionGateRepository();
  final FakeSecureStore store = FakeSecureStore();
  final FakeForegroundSignal foreground = FakeForegroundSignal();
  late final ProfileCache cache = ProfileCache(store);

  late final ProviderContainer container;

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
  group('build() - the initial state', () {
    test(
        'nothing readable synchronously starts as restoring, bounded by the '
        'session-restore timeout', () async {
      final Harness h = Harness();
      addTearDown(h.dispose);

      // Reading the provider is what triggers build().
      expect(h.state.sessionPhase, AuthSessionPhase.restoring);
    });

    test(
        'an already-resolved session at build time adopts it immediately, '
        'without waiting for the stream to deliver it', () async {
      final Harness h = Harness();
      addTearDown(h.dispose);
      h.profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
        profileWith(),
      );
      // Seed the "already restored" session BEFORE the controller is ever
      // read, so build() observes it via `currentSession` rather than
      // through a later stream event.
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));

      // The FIRST read of the provider is what runs build().
      expect(h.state.sessionPhase, AuthSessionPhase.authenticated);
      expect(h.state.userId, 'user-1');
      expect(h.state.profileStatus, ProfileStatus.loading);

      await pumpEventQueue(times: 40);
      expect(h.state.profileStatus, ProfileStatus.loaded);
    });
  });

  group('THE TIMEOUT PATH', () {
    test(
        'a session that never resolves ends in timedOut, not a spinner that '
        'runs forever', () async {
      final Harness h = Harness(
        restoreTimeout: const Duration(milliseconds: 15),
      );
      addTearDown(h.dispose);

      // Force the read so build() runs and arms the timer.
      expect(h.state.sessionPhase, AuthSessionPhase.restoring);

      await pumpEventQueue(times: 40);
      await Future<void>.delayed(const Duration(milliseconds: 60));
      await pumpEventQueue(times: 40);

      expect(h.state.sessionPhase, AuthSessionPhase.timedOut);
      expect(deriveSession(h.state).phase, TpSessionPhase.timedOut);
    });

    test(
        'a session that resolves AFTER the timeout still recovers - the '
        'stream keeps listening and this is a temporary state, not a dead '
        'end', () async {
      final Harness h = Harness(
        restoreTimeout: const Duration(milliseconds: 10),
      );
      addTearDown(h.dispose);
      h.profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
        profileWith(),
      );

      expect(h.state.sessionPhase, AuthSessionPhase.restoring);
      await Future<void>.delayed(const Duration(milliseconds: 40));
      await pumpEventQueue(times: 20);
      expect(h.state.sessionPhase, AuthSessionPhase.timedOut);

      // A late session arrives.
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      await pumpEventQueue(times: 40);

      expect(h.state.sessionPhase, AuthSessionPhase.authenticated);
      expect(h.state.profileStatus, ProfileStatus.loaded);
    });
  });

  group('a full sign-in reaches signedIn, gated correctly', () {
    test(
        'an approved, unlocked profile with a passing version gate is '
        'signed in with no gate', () async {
      final Harness h = Harness();
      addTearDown(h.dispose);
      h.profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
        profileWith(),
      );
      h.versionGate.result = const VersionGateResult(
        reason: VersionGateReason.buildMeetsMinimum,
        currentVersion: '2.0.0',
        minimumVersion: '1.0.0',
      );

      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      // `build()` only runs on the FIRST read of the provider, and the
      // profile fetch + version-gate check it kicks off from
      // `initial.hasSession` are fire-and-forget (`unawaited`). Forcing that
      // first read HERE - mirroring "an already-resolved session at build
      // time adopts it immediately" above - is what gives `pumpEventQueue`
      // below something to actually settle: called before any read has ever
      // happened, it flushes nothing, because nothing has been scheduled yet.
      expect(h.state.profileStatus, ProfileStatus.loading);
      await pumpEventQueue(times: 40);

      final TpSession session = deriveSession(h.state);
      expect(session.phase, TpSessionPhase.signedIn);
      expect(session.gate, TpShellGate.none);
      expect(h.profiles.calls, contains('fetchProfile:user-1'));
      expect(h.versionGate.callCount, greaterThanOrEqualTo(1));
    });

    test(
      'a locked profile resolves accessBlocked through the real wiring',
      () async {
        final Harness h = Harness();
        addTearDown(h.dispose);
        h.profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
          profileWith(locked: true),
        );

        h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
        // See the identical comment in the test above: this forces build()
        // to run and adopt the session before the queue is pumped.
        expect(h.state.profileStatus, ProfileStatus.loading);
        await pumpEventQueue(times: 40);

        expect(deriveSession(h.state).gate, TpShellGate.accessBlocked);
      },
    );

    test('an unapproved profile resolves accessBlocked', () async {
      final Harness h = Harness();
      addTearDown(h.dispose);
      h.profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
        profileWith(approved: false),
      );

      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      // See the identical comment further up this group: this forces
      // build() to run and adopt the session before the queue is pumped.
      expect(h.state.profileStatus, ProfileStatus.loading);
      await pumpEventQueue(times: 40);

      expect(deriveSession(h.state).gate, TpShellGate.accessBlocked);
    });

    test(
        'a profile fetch failure resolves profileUnavailable, and offers a '
        'working retry', () async {
      final Harness h = Harness();
      addTearDown(h.dispose);
      h.profiles.outcomeByUserId['user-1'] = const ProfileFetchFailed(
        AppError(kind: AppErrorKind.network, message: 'offline'),
      );

      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      // See the identical comment further up this group: this forces
      // build() to run and adopt the session before the queue is pumped.
      expect(h.state.profileStatus, ProfileStatus.loading);
      await pumpEventQueue(times: 40);

      expect(deriveSession(h.state).gate, TpShellGate.profileUnavailable);

      // Retry, now with a working fixture, recovers it.
      h.profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
        profileWith(),
      );
      await h.controller.retryProfile();
      await pumpEventQueue(times: 40);

      expect(deriveSession(h.state).gate, TpShellGate.none);
    });

    test(
        'a blocking version gate reaches updateRequired through the real '
        'wiring', () async {
      final Harness h = Harness();
      addTearDown(h.dispose);
      h.profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
        profileWith(),
      );
      h.versionGate.result = const VersionGateResult(
        reason: VersionGateReason.buildBelowMinimum,
        currentVersion: '1.0.0',
        minimumVersion: '2.0.0',
      );

      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      // See the identical comment further up this group: this forces
      // build() to run and adopt the session before the queue is pumped.
      expect(h.state.profileStatus, ProfileStatus.loading);
      await pumpEventQueue(times: 40);

      expect(deriveSession(h.state).gate, TpShellGate.updateRequired);
    });
  });

  group('SIGN-OUT NEVER TOUCHES ANYTHING OUTSIDE THE AUTH SESSION', () {
    test(
        'it works even with no session already established - "any gate '
        'state" includes the very first screen', () async {
      final Harness h = Harness();
      addTearDown(h.dispose);

      await h.controller.signOut();

      expect(h.auth.calls, contains('signOut'));
      expect(h.state.sessionPhase, AuthSessionPhase.signedOut);
    });

    test(
      'it reaches signedOut even when no session event follows the '
      'signOut() call - it does not depend on the SDK reporting back',
      () async {
        final Harness h = Harness();
        addTearDown(h.dispose);
        h.profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
          profileWith(),
        );
        h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
        await pumpEventQueue(times: 40);
        expect(h.state.sessionPhase, AuthSessionPhase.authenticated);

        await h.controller.signOut();

        // FakeAuthRepository.signOut() deliberately never calls `emit(...)`.
        expect(h.state.sessionPhase, AuthSessionPhase.signedOut);
      },
    );

    test(
        'the fake auth repository is called with EXACTLY signOut and '
        'stopAutoRefresh, and the fake profile cache store sees EXACTLY one '
        'delete - nothing more, nothing else', () async {
      final Harness h = Harness();
      addTearDown(h.dispose);
      h.profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
        profileWith(),
      );
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));

      // Force the sign-in to fully settle BEFORE taking the baseline, so the
      // call logs below record ONLY what signOut() itself does.
      expect(h.state.sessionPhase, AuthSessionPhase.authenticated);
      await pumpEventQueue(times: 40);
      expect(h.state.profileStatus, ProfileStatus.loaded);
      h.auth.calls.clear();
      h.store.calls.clear();

      await h.controller.signOut();
      await pumpEventQueue(times: 40);

      // Exact list equality, not merely "contains": this is the strongest
      // form of the negative proof spec section 60 asks for - not just that
      // sign-out did the two things it must, but that it did NOTHING else.
      expect(h.auth.calls, <String>['signOut', 'stopAutoRefresh']);

      // The cache store sees exactly one operation: a delete of this lane's
      // own single slot. `AuthController` and every file it imports (see
      // this repository's own import list) hold no reference to any offline
      // command queue, draft table, or `core/database` type at all - there is
      // no code path by which signOut() could reach one, and this call list
      // is the observable proof of that for the one piece of durable storage
      // this lane DOES own.
      expect(h.store.calls, <String>['delete:tp_profile_cache_v1']);
    });

    test('signing out clears the adopted workspace', () async {
      final Harness h = Harness();
      addTearDown(h.dispose);
      h.profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
        profileWith(),
      );
      h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
      await pumpEventQueue(times: 40);

      await h.controller.signOut();

      expect(h.container.read(workspaceContextProvider), isNull);
    });
  });

  group('a session becoming null - however it happens - is signedOut', () {
    test(
      'an organic sign-out event (not through signOut()) is honoured too',
      () async {
        final Harness h = Harness();
        addTearDown(h.dispose);
        h.profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
          profileWith(),
        );
        h.auth.emit(const AuthSessionSignal(userId: 'user-1'));
        await pumpEventQueue(times: 40);
        expect(h.state.sessionPhase, AuthSessionPhase.authenticated);

        h.auth.emit(const AuthSessionSignal.none());
        await pumpEventQueue(times: 40);

        expect(h.state.sessionPhase, AuthSessionPhase.signedOut);
      },
    );
  });
}
