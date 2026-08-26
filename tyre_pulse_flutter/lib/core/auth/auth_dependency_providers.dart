/// Riverpod wiring for the concrete auth-layer dependencies: the repositories,
/// the offline profile cache, the foreground signal, and the two values this
/// lane genuinely cannot supply itself.
///
/// Kept separate from `auth_controller.dart` so the dependency chain is
/// ACYCLIC: this file depends on nothing this lane defines except pure/domain
/// types, `auth_controller.dart` depends on THIS file, and `auth_providers.dart`
/// depends on `auth_controller.dart`. Folding all three into one file would
/// work too, but splitting them is what makes each piece overridable on its
/// own in a test - exactly the granularity spec section 4 asks for ("a widget
/// that watches a single module's decision must not rebuild because an
/// unrelated part of the session changed").
///
/// # Two values this lane forward-references and cannot supply
///
/// `supabaseClientProvider` (`Provider<SupabaseClient>`) and
/// `secureStoreProvider` (`Provider<SecureKeyValueStore>`) are declared by the
/// network and storage lanes respectively and are not yet present on disk at
/// the time this file was written - see this task's own brief, which
/// authorises forward-referencing them by name. Until those lanes land, this
/// file will not compile on its own; that is expected of a parallel four-lane
/// split and is resolved at the composition root, not here.
///
/// # Two values ONLY the composition root can supply
///
/// [currentAppVersionProvider] and `onOpenStore` (in `auth_providers.dart`)
/// both throw or omit by default for the same reason: `package_info_plus` and
/// `url_launcher` are not declared dependencies of this package, and spec
/// section 64 forbids adding one "to shorten five lines". See the accompanying
/// report for exactly what the composition root needs to supply and why this
/// lane did not add either package itself.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/auth/auth_lifecycle.dart';
import 'package:tyre_pulse/core/auth/auth_profile_repository.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/auth_version_gate_repository.dart';
import 'package:tyre_pulse/core/auth/foreground_signal.dart';
import 'package:tyre_pulse/core/auth/profile_cache.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';

/// This build's own version string, e.g. `1.4.0`.
///
/// **Must be overridden at the composition root.** Throws rather than
/// defaulting to something like `'0.0.0'`, because a silently-wrong version
/// would make the version gate compare against a value that is not this
/// build's real version - the gate could then block a build that is actually
/// current, or (worse, given the gate's fail-open design) simply always
/// compare as older than any configured minimum and read as permanently
/// blockable by a typo. See `package_info_plus`, if it is added later, or a
/// value baked in at build time.
final Provider<String> currentAppVersionProvider = Provider<String>((ref) {
  throw UnimplementedError(
    'currentAppVersionProvider has no value. Override it at the composition '
    'root with this build\'s real version string (e.g. from package_info_plus, '
    'once added - it is not a dependency of this package today).',
  );
});

/// The offline profile cache. One instance for the app's lifetime.
final Provider<ProfileCache> profileCacheProvider = Provider<ProfileCache>(
  (ref) => ProfileCache(ref.watch(secureStoreProvider)),
);

/// Sign-in, sign-out and session-change observation.
final Provider<AuthRepository> authRepositoryProvider =
    Provider<AuthRepository>(
  (ref) => SupabaseAuthRepository(ref.watch(supabaseClientProvider)),
);

/// Loading the `profiles` row, with an offline fallback.
final Provider<ProfileRepository> profileRepositoryProvider =
    Provider<ProfileRepository>(
  (ref) => SupabaseProfileRepository(
    ref.watch(supabaseClientProvider),
    ref.watch(profileCacheProvider),
  ),
);

/// The minimum-supported-version check.
final Provider<VersionGateRepository> versionGateRepositoryProvider =
    Provider<VersionGateRepository>(
  (ref) => SupabaseVersionGateRepository(
    ref.watch(supabaseClientProvider),
    currentVersion: ref.watch(currentAppVersionProvider),
  ),
);

/// The app-lifecycle foreground signal. See `foreground_signal.dart` for why
/// this sits behind a provider rather than being constructed inline: it is the
/// one piece of this lane that needs a live Flutter binding, and a plain unit
/// test of [AuthController] has neither reason nor obligation to provide one.
final Provider<ForegroundSignal> foregroundSignalProvider =
    Provider<ForegroundSignal>((ref) {
  final ForegroundSignal signal = AppLifecycleForegroundSignal();
  ref.onDispose(signal.dispose);
  return signal;
});

/// How long to wait for the stored session before reporting `timedOut`.
/// Overridable so a test can exercise the timeout path in milliseconds rather
/// than the real 8 seconds.
final Provider<Duration> sessionRestoreTimeoutDurationProvider =
    Provider<Duration>((ref) => sessionRestoreTimeout);
