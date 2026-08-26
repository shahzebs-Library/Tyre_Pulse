/// Runs [SyncEngine] outside the foreground app: a periodic Workmanager task,
/// and an immediate one-shot trigger the moment connectivity is regained.
///
/// # Why a background isolate has to bootstrap itself from scratch
///
/// `workmanager` runs [callbackDispatcher] in a SEPARATE Dart isolate from the
/// one `main()` started - on Android this isolate can be spawned by the OS
/// even while the foreground app is not running at all. It shares no memory
/// with the app's Riverpod `ProviderContainer`, its already-constructed
/// `AppDatabase`, or its already-initialised Supabase client; every one of
/// those has to be built again, fresh, inside [callbackDispatcher] itself.
/// That is why `_runBackgroundSync` calls `initializeSupabase` and constructs
/// its own `AppDatabase` and its own [SyncEngine] rather than reading
/// anything from a provider - there is nothing here for a provider to read
/// FROM.
///
/// # Not wired into `main.dart` by this file
///
/// [registerBackgroundSync] and [ConnectivitySyncTrigger] are meant to be
/// called once each from the composition root (`lib/main.dart`), in the same
/// later integration pass that wires `initializeSupabase` itself - see that
/// function's own library comment. Nothing in this file calls itself.
///
/// # The 15-minute floor
///
/// Android does not run a periodic `WorkManager` job more often than every 15
/// minutes; a shorter request is silently clamped by the platform, not a
/// tuning choice available here. [backgroundSyncFrequency] is set at exactly
/// that floor. [ConnectivitySyncTrigger] exists precisely because 15 minutes
/// is too slow for the case that matters most to a field worker - the moment
/// their signal comes back after being offline - and a ONE-OFF task has no
/// such floor.
///
/// # UNVERIFIED
///
/// There is no Flutter SDK and no resolvable pub cache in this environment
/// (`docs/BOOTSTRAP.md`'s local-dev path could not be exercised), so nothing
/// below has been compiled. Two things in particular were written against
/// this project's best understanding rather than against installed source,
/// and should be the first places checked if CI reports a compile error in
/// this file:
///
/// - `connectivity_plus: ^7.3.1`'s `Connectivity().onConnectivityChanged`
///   returning `Stream<List<ConnectivityResult>>` (a list, not a single
///   value - the package moved to reporting every simultaneously-active
///   connection type several majors before 7.x and has not moved back).
/// - `workmanager: ^0.10.9`'s `Workmanager().initialize`,
///   `registerPeriodicTask`, `registerOneOffTask` and `executeTask` accepting
///   the exact named parameters used below (`isInDebugMode`, `frequency`,
///   `constraints`, and the `Future&lt;bool&gt; Function(String,
///   Map&lt;String, dynamic&gt;?)` task-handler shape). These have been
///   stable across many
///   releases of this package and were used here at the narrowest, most
///   long-standing part of its surface on purpose - no `existingWorkPolicy`
///   or `backoffPolicy` argument is passed, specifically because this file
///   could not confirm their exact current names and omitting them is
///   correct-by-omission rather than a guess.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/app/config/app_config.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/network/supabase_bootstrap.dart';
import 'package:tyre_pulse/core/storage/secure_slot_store_impl.dart';
import 'package:tyre_pulse/core/storage/staged_secure_store.dart';
import 'package:tyre_pulse/core/sync/supabase_command_pusher.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart';
import 'package:uuid/uuid.dart';
import 'package:workmanager/workmanager.dart';

/// The unique name of the periodic background sync task.
const String backgroundSyncTaskName = 'tyre_pulse.background_sync';

/// The unique name of the connectivity-triggered one-off sync task.
///
/// A stable name rather than a fresh one per trigger is deliberate: a device
/// that regains and loses connectivity in rapid succession should coalesce
/// into one pending run, not queue several. Whatever the plugin's default
/// behaviour is for re-registering a one-off task under a name already
/// pending, that behaviour is what this relies on - never a guessed
/// `existingWorkPolicy` override.
const String backgroundSyncOneOffTaskName = 'tyre_pulse.connectivity_sync';

/// Android's own floor for a periodic task. Requesting anything shorter is
/// clamped by the platform; it is not a value this file is free to tune down.
const Duration backgroundSyncFrequency = Duration(minutes: 15);

/// The Workmanager entry point.
///
/// Must be a top-level or static function, annotated exactly like this - the
/// annotation is what stops the Dart compiler tree-shaking it away as
/// apparently unused: nothing in this codebase calls [callbackDispatcher]
/// directly, it is invoked by the native Android side by name.
@pragma('vm:entry-point')
void callbackDispatcher() {
  // First statement, before anything else in this fresh isolate touches a
  // plugin channel - `flutter_secure_storage`, `path_provider` (used inside
  // `drift_flutter`) and `supabase_flutter` all need a Flutter engine binding
  // to exist before their first platform-channel call.
  WidgetsFlutterBinding.ensureInitialized();

  Workmanager().executeTask((
    String taskName,
    Map<String, dynamic>? inputData,
  ) async {
    try {
      return await _runBackgroundSync();
    } on Object {
      // A failure here means the run could not even complete - a local
      // database error, a Supabase client that could not start. Individual
      // command failures never reach this catch: `SyncEngine.runOnce`
      // records and classifies every one of those itself and always returns
      // normally. Returning false lets Workmanager decide whether to retry
      // this task per its own policy; there is no UI in this isolate to show
      // anything to, so swallowing the error here rather than letting it
      // crash the isolate is the only reporting available.
      return false;
    }
  });
}

/// Does the actual work: bootstraps this isolate's own dependencies, runs one
/// [SyncEngine] pass if there is a signed-in workspace to run it for, and
/// tears everything down again.
///
/// Returns true whenever a pass was attempted (or genuinely had nothing to
/// do), regardless of how many individual commands within it failed - those
/// failures are already durably recorded in the local queue with their own
/// backoff schedule, which is a QUEUE concern, not a Workmanager-retry
/// concern. Only a failure to even START a pass reaches [callbackDispatcher]'s
/// catch block and returns false.
Future<bool> _runBackgroundSync() async {
  final AppConfigResult configResult = AppConfig.resolve();
  if (configResult is! AppConfigValid) {
    // Nothing this headless isolate can do about a misconfigured build - the
    // foreground app's own `ConfigurationProblemApp` is where that is
    // reported to a person. Reported as "attempted, nothing to do" rather
    // than a failure: repeatedly retrying will not fix a build-time problem.
    return true;
  }

  await initializeSupabase(
    config: configResult.config,
    // The real, production `SecureKeyValueStore` - constructed directly
    // rather than read from `secureStoreProvider`, because there is no
    // Riverpod container in this isolate to read it from. Mirrors exactly
    // what that provider builds.
    localStorage: StagedSecureStore(slots: FlutterSecureSlotStore()),
  );

  // The SAME on-disk database file the foreground app uses, opened through
  // the SAME helper (`openTyrePulseDatabase`) - never `NativeDatabase
  // .memory()`, which is a test-only seam documented as such on
  // `AppDatabase` itself.
  final AppDatabase db = AppDatabase(openTyrePulseDatabase());
  try {
    // There is no live `WorkspaceContext` in this isolate - that type is
    // rebuilt from a fresh profile read on every app start and workspace
    // switch, and nothing here can do that without signing back in. The
    // locally cached workspace scope (`CacheDao.activeWorkspace`) is exactly
    // the durable, on-device record of "which workspace is this device
    // currently working in", already used by the app for that same
    // question, so reading it here rather than inventing a second source is
    // what keeps this isolate's answer consistent with the foreground app's.
    final workspace = await db.cacheDao.activeWorkspace();
    if (workspace == null) {
      // Nobody has ever signed in and picked a workspace on this device, so
      // there is nothing it could possibly have queued.
      return true;
    }

    final SupabaseClient client = Supabase.instance.client;
    final SyncEngine engine = SyncEngine(
      queueDao: db.queueDao,
      mediaDao: db.mediaDao,
      pusher: SupabaseCommandPusher(client),
      uploader: SupabaseMediaUploader(client),
      // A fresh id per execution, not a fixed constant - see
      // `SyncEngine._holderId`'s own doc comment. A periodic run and a
      // connectivity-triggered one-off run are two DIFFERENT Workmanager
      // tasks that Android does not guarantee will never overlap; sharing a
      // holder id between them would let both believe they hold the sync
      // lock at once.
      holderId: const Uuid().v4(),
    );

    await engine.runOnce(
      workspaceId: workspace.workspaceId,
      now: DateTime.now().toUtc(),
    );
    return true;
  } finally {
    await db.close();
  }
}

/// Registers the periodic background sync task.
///
/// Call exactly once, before `runApp`, from the composition root. Safe to
/// call again on a later app start: re-registering a periodic task under the
/// same unique name is the normal, expected way this plugin is used across
/// every app restart, and this file adds no extra guard on top of whatever
/// the plugin itself does in that case.
Future<void> registerBackgroundSync() async {
  // `isInDebugMode` is deprecated in this resolved workmanager version and
  // now has no effect at all (its replacement, WorkmanagerDebug handlers,
  // is a different, opt-in mechanism this file does not register) - kept
  // out rather than left in as dead configuration that looks like it does
  // something.
  await Workmanager().initialize(callbackDispatcher);
  await Workmanager().registerPeriodicTask(
    backgroundSyncTaskName,
    backgroundSyncTaskName,
    frequency: backgroundSyncFrequency,
    constraints: Constraints(networkType: NetworkType.connected),
  );
}

/// Watches for the device regaining a usable connection and, on that exact
/// transition, asks Workmanager to run a sync pass immediately rather than
/// waiting for [backgroundSyncFrequency] to next elapse.
///
/// Deliberately routes through [Workmanager.registerOneOffTask] instead of
/// constructing a [SyncEngine] directly in the foreground: that keeps there
/// being exactly ONE execution path for "perform a sync pass" -
/// [callbackDispatcher] - rather than a second one that could run
/// concurrently with a periodic execution and race it for the sync lock
/// under two different holder identities from two different code paths.
///
/// A plain class with [start] and [dispose] rather than a Riverpod provider,
/// so the composition root can construct and hold one without this file
/// needing to depend on Riverpod at all - it is pure Dart plus
/// `connectivity_plus` and `workmanager`.
class ConnectivitySyncTrigger {
  ConnectivitySyncTrigger({Connectivity? connectivity})
      : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;
  StreamSubscription<List<ConnectivityResult>>? _subscription;

  /// Whether the most recently observed state had no usable connection.
  /// Starts false - a fresh subscriber that immediately observes "online" has
  /// not witnessed a transition and must not trigger a sync merely because
  /// the stream reported its current state.
  bool _wasOffline = false;

  /// Begins watching. Idempotent: calling this again while already watching
  /// does nothing, rather than creating a second subscription that would
  /// double-trigger every transition.
  void start() {
    _subscription ??= _connectivity.onConnectivityChanged.listen(_onChanged);
  }

  /// Stops watching and releases the subscription.
  Future<void> dispose() async {
    await _subscription?.cancel();
    _subscription = null;
  }

  void _onChanged(List<ConnectivityResult> results) {
    final bool isOnline = results.any(
      (ConnectivityResult result) => result != ConnectivityResult.none,
    );
    if (isOnline && _wasOffline) {
      // Fire-and-forget on purpose: this is a best-effort nudge to run
      // sooner, not a write anything downstream is waiting on, so there is
      // nothing meaningful to await it against.
      unawaited(_triggerOneOffSync());
    }
    _wasOffline = !isOnline;
  }

  Future<void> _triggerOneOffSync() {
    return Workmanager().registerOneOffTask(
      backgroundSyncOneOffTaskName,
      backgroundSyncOneOffTaskName,
      constraints: Constraints(networkType: NetworkType.connected),
    );
  }
}
