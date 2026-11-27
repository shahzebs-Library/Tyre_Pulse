/// Read models and actions behind Profile's "Sync queue" screen.
///
/// # What this reads, and what it deliberately does not do
///
/// Everything here is a READ of the two local offline queues - queued
/// commands (`pending_commands` and the sync run markers in
/// `sync_metadata`, through [QueueDao]) and submitted inspections
/// (`InspectionSubmissionQueue`, a polled file queue) - plus actions that
/// already exist elsewhere:
///
/// - "Sync now" calls [requestImmediateSync], the same one-off Workmanager
///   task the connectivity trigger uses. There is no second sync engine and
///   no foreground [SyncEngine] construction here; the background pass takes
///   the queue's single sync lock, so a request made while a run is in
///   flight simply finds the lock held.
/// - "Retry" on a failed item calls [QueueDao.retryFailedCommand], the
///   single-row sibling of the existing [QueueDao.retryFailed].
/// - Submitted inspections are retried and sent by
///   `InspectionSyncEngine.flushQueue`, that queue's own entry point (it has
///   no per-item reset: every flush tries each unsent submission again).
///
/// # Honest labels
///
/// The sync engine records only when a run ENDED (`sync.lastRunAt`, written
/// when the lock is released whether the run succeeded or not), so the
/// screen calls it the last sync ATTEMPT, never the last successful sync.
/// `synced` rows are only the ones still on this device (they are pruned once
/// their photos are verified), so "Sent" counts what is still listed here,
/// not everything ever sent.
library;

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart'
    show isLeakyMessage;
import 'package:tyre_pulse/core/sync/background_sync.dart'
    show requestImmediateSync;
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue_reads.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_sync_engine.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/profile/domain/combine_latest.dart';

/// How a queued row reads to the person holding the phone.
enum SyncQueueItemState {
  /// `pending` - waiting for the next sync run.
  waiting,

  /// `processing` - claimed by a run that is sending it now.
  sending,

  /// `retry` - an attempt failed and another is scheduled automatically.
  retrying,

  /// `blocked` - waiting on a decision (for example captured in another
  /// workspace), never pushed and never discarded.
  onHold,

  /// `failed` - attempts exhausted; it stays on the phone until somebody
  /// retries it.
  needsAttention,

  /// `synced` - delivered, still listed until its photos are verified and a
  /// run prunes the row.
  sent;

  /// The state for a raw `pending_commands.status`. An unknown value is
  /// treated as waiting (still on the phone, not yet sent), never as sent.
  static SyncQueueItemState fromStatus(String status) {
    return switch (status) {
      CommandStatus.processing => SyncQueueItemState.sending,
      CommandStatus.retry => SyncQueueItemState.retrying,
      CommandStatus.blocked => SyncQueueItemState.onHold,
      CommandStatus.failed => SyncQueueItemState.needsAttention,
      CommandStatus.synced => SyncQueueItemState.sent,
      _ => SyncQueueItemState.waiting,
    };
  }

  /// Still on the phone and not yet delivered (failed excluded - that one is
  /// counted on its own).
  bool get isPending =>
      this == SyncQueueItemState.waiting ||
      this == SyncQueueItemState.sending ||
      this == SyncQueueItemState.retrying ||
      this == SyncQueueItemState.onHold;
}

final Map<String, CommandType> _commandTypesByWire = <String, CommandType>{
  for (final CommandType type in CommandType.values) type.wireName: type,
};

/// One row of the queue, already decoded for display.
final class SyncQueueEntry {
  const SyncQueueEntry({
    required this.id,
    required this.wireType,
    required this.commandType,
    required this.state,
    required this.queuedAt,
    required this.attempts,
    this.nextAttemptAt,
    this.lastError,
    this.inspectionAsset,
  });

  /// A submitted inspection waiting in `InspectionSubmissionQueue`. Its file
  /// queue has three statuses: `pending` (waiting), `failed` (the last
  /// delivery attempt failed - every flush tries it again, so it is offered
  /// a Retry) and `synced`.
  factory SyncQueueEntry.fromInspection(QueuedInspection item) {
    final String? raw = item.error?.trim();
    return SyncQueueEntry(
      id: item.id,
      wireType: inspectionWireType,
      commandType: null,
      state: switch (item.status) {
        InspectionQueueStatus.pending => SyncQueueItemState.waiting,
        InspectionQueueStatus.failed => SyncQueueItemState.needsAttention,
        InspectionQueueStatus.synced => SyncQueueItemState.sent,
      },
      queuedAt: item.createdAt,
      attempts: item.attempts,
      lastError: raw == null || raw.isEmpty ? null : raw,
      inspectionAsset: item.payload.assetNo.trim(),
    );
  }

  factory SyncQueueEntry.fromRow(PendingCommand row) {
    final String? raw = row.lastError?.trim();
    return SyncQueueEntry(
      id: row.id,
      wireType: row.commandType,
      commandType: _commandTypesByWire[row.commandType],
      state: SyncQueueItemState.fromStatus(row.status),
      queuedAt: row.createdAt,
      attempts: row.retryCount,
      nextAttemptAt: row.nextRetryAt,
      lastError: raw == null || raw.isEmpty ? null : raw,
    );
  }

  /// The stand-in command name for a submitted inspection, which lives in
  /// its own queue rather than in `pending_commands`.
  static const String inspectionWireType = 'INSPECTION_SUBMISSION';

  final String id;

  /// The stored command name, kept for the "unknown entry" case.
  final String wireType;

  /// Null when this version of the app does not recognise the entry.
  final CommandType? commandType;
  final SyncQueueItemState state;
  final DateTime queuedAt;
  final int attempts;
  final DateTime? nextAttemptAt;

  /// The asset of a submitted inspection; null for a queued command.
  final String? inspectionAsset;

  /// Whether this is a submitted inspection (retried by flushing the
  /// inspection queue) rather than a queued command.
  bool get isInspection => inspectionAsset != null;

  /// The stored reason, sanitised before storage. Use [safeLastError] to
  /// display it.
  final String? lastError;

  /// [lastError] when it is safe to show a person, null when there is none,
  /// and [fallback] when it carries anything that looks technical. The
  /// queue sanitises before storage; this is the second check, using the
  /// app's one leak test (`isLeakyMessage`).
  String? safeLastError(String fallback) {
    final String? message = lastError;
    if (message == null) return null;
    if (message.length > 240 || isLeakyMessage(message)) return fallback;
    return message;
  }
}

/// The sync run markers: when the last attempt ended and whether a run holds
/// the lock right now.
final class SyncRunState {
  const SyncRunState({this.lastAttemptAt, this.lockAcquiredAt});

  factory SyncRunState.fromEntries(List<SyncMetadataEntry> entries) {
    DateTime? lastAttempt;
    DateTime? lock;
    for (final SyncMetadataEntry entry in entries) {
      final DateTime? value = DateTime.tryParse(entry.valueJson.trim());
      if (entry.key == SyncMetadataKeys.syncLastRunAt) lastAttempt = value;
      if (entry.key == SyncMetadataKeys.syncLockAcquiredAt) lock = value;
    }
    return SyncRunState(lastAttemptAt: lastAttempt, lockAcquiredAt: lock);
  }

  final DateTime? lastAttemptAt;
  final DateTime? lockAcquiredAt;

  /// A run holds a live lock. A lock older than the queue's claim timeout is
  /// an abandoned one (the next run breaks it), so it does not count.
  bool isSyncingAt(DateTime now) {
    final DateTime? lock = lockAcquiredAt;
    if (lock == null) return false;
    return now.toUtc().difference(lock.toUtc()).abs() <
        QueueRetryPolicy.claimTimeout;
  }
}

/// Every queue row for the active workspace (live Drift watch) plus this
/// person's submitted inspections (polled, see
/// `inspection_submission_queue_reads.dart`), newest first. Empty with no
/// workspace (nobody signed in has nothing queued for this screen). A read
/// failure of EITHER queue stays an error, never a partial or empty list.
final StreamProvider<List<SyncQueueEntry>> syncQueueEntriesProvider =
    StreamProvider<List<SyncQueueEntry>>((Ref ref) {
  final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
  if (workspace == null) {
    return Stream<List<SyncQueueEntry>>.value(const <SyncQueueEntry>[]);
  }
  final AppDatabase db = ref.watch(appDatabaseProvider);
  final Stream<List<PendingCommand>> commands =
      db.queueDao.watchQueuedCommands(workspaceId: workspaceIdFor(workspace));
  final Stream<List<QueuedInspection>> inspections =
      watchUserInspectionSubmissions(
    ref.watch(inspectionSubmissionQueueProvider),
    userId: workspace.userId,
  );
  return combineLatestPair<List<PendingCommand>, List<QueuedInspection>,
      List<SyncQueueEntry>>(
    commands,
    inspections,
    (List<PendingCommand> rows, List<QueuedInspection> submitted) =>
        mergeSyncQueueEntries(rows, submitted),
  );
});

/// Queued commands and submitted inspections as one list, newest first.
List<SyncQueueEntry> mergeSyncQueueEntries(
  List<PendingCommand> commands,
  List<QueuedInspection> inspections,
) {
  final List<SyncQueueEntry> all = <SyncQueueEntry>[
    ...commands.map(SyncQueueEntry.fromRow),
    ...inspections.map(SyncQueueEntry.fromInspection),
  ]..sort(
      (SyncQueueEntry a, SyncQueueEntry b) => b.queuedAt.compareTo(a.queuedAt),
    );
  return all;
}

/// The sync run markers, live.
final StreamProvider<SyncRunState> syncRunStateProvider =
    StreamProvider<SyncRunState>((Ref ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return db.queueDao.watchSyncRunMetadata().map(SyncRunState.fromEntries);
});

/// Whether the device has a usable connection: the current state first, then
/// every change.
final StreamProvider<bool> syncQueueOnlineProvider = StreamProvider<bool>((
  Ref ref,
) async* {
  bool online(List<ConnectivityResult> results) =>
      results.any((ConnectivityResult r) => r != ConnectivityResult.none);
  final Connectivity connectivity = Connectivity();
  yield online(await connectivity.checkConnectivity());
  yield* connectivity.onConnectivityChanged.map(online);
});

/// Requests one sync pass. Overridable so a widget test never touches the
/// Workmanager platform channel.
final Provider<Future<void> Function()> syncNowRequestProvider =
    Provider<Future<void> Function()>((Ref ref) => requestImmediateSync);

/// Puts one failed item back in the queue. Returns whether it was reset.
final Provider<Future<bool> Function(String id)> syncQueueRetryProvider =
    Provider<Future<bool> Function(String id)>((Ref ref) {
  final AppDatabase db = ref.watch(appDatabaseProvider);
  return (String id) =>
      db.queueDao.retryFailedCommand(id, now: DateTime.now().toUtc());
});

/// Tries to deliver every submitted inspection not yet synced, through the
/// one entry point the inspection queue already has:
/// [InspectionSyncEngine.flushQueue]. Single-flight: a second call while a
/// flush is running waits for that flush instead of starting another.
final Provider<Future<void> Function()> syncQueueInspectionFlushProvider =
    Provider<Future<void> Function()>((Ref ref) {
  Future<void>? running;
  return () {
    final Future<void>? current = running;
    if (current != null) return current;
    final Future<void> next = ref
        .read(inspectionSyncEngineProvider)
        .flushQueue()
        .then((_) {})
        .whenComplete(() => running = null);
    running = next;
    return next;
  };
});
