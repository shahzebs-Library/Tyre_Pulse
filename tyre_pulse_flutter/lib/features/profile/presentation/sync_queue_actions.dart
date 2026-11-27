/// The two sync-queue actions ("Sync now" and "Retry"), shared by the quick
/// sync sheet and the full Sync queue screen so both behave identically.
///
/// Nothing here is a second sync path: "Sync now" calls
/// [syncNowRequestProvider] (the one-off background sync task) and, for
/// submitted inspections, [syncQueueInspectionFlushProvider] (that queue's own
/// flush). "Retry" resets one failed command through [syncQueueRetryProvider].
/// See `sync_queue_providers.dart` for what each one reuses.
///
/// # Why the list is re-read while a requested sync runs
///
/// "Sync now" asks the background Workmanager task to run, and that task
/// writes through its OWN database connection in its own isolate. A Drift
/// watch query only re-emits for writes through the same connection, so the
/// surface re-reads the queue every few seconds for a short while after a
/// request instead of showing a list that silently stopped updating.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/profile/sync_queue_providers.dart';

/// Whether [entry] still needs sending (waiting, retrying, failed...).
bool syncQueueEntryUnsent(SyncQueueEntry entry) =>
    entry.state.isPending || entry.state == SyncQueueItemState.needsAttention;

/// Why "Sync now" is unavailable, or null when it can run. One line, shown
/// under the button. Offline wins over "running", which wins over "nothing
/// waiting".
String? syncNowDisabledReason(
  AppLocalizations l10n, {
  required bool isOffline,
  required bool isSyncing,
  required bool hasUnsent,
}) {
  if (isOffline) return l10n.syncQueueOfflineReason;
  if (isSyncing) return l10n.syncQueueRunning;
  if (!hasUnsent) return l10n.syncQueueNothingToSend;
  return null;
}

/// The sync-queue actions for a [ConsumerState]. The host decides how a
/// result message is shown ([showSyncMessage]): a snackbar on the full
/// screen, an inline line inside the sheet (a snackbar would sit behind the
/// sheet's barrier).
mixin SyncQueueActionsMixin<T extends ConsumerStatefulWidget>
    on ConsumerState<T> {
  static const Duration _pollEvery = Duration(seconds: 5);
  static const Duration _pollFor = Duration(minutes: 2);

  bool _requesting = false;
  final Set<String> _retrying = <String>{};
  Timer? _poll;
  DateTime? _pollUntil;

  /// A "Sync now" request is in flight.
  bool get isRequestingSync => _requesting;

  /// Whether [id] is being retried right now.
  bool isRetryingEntry(String id) => _retrying.contains(id);

  /// Shows the outcome of an action to the person.
  void showSyncMessage(String message);

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  /// Re-reads both queue providers.
  void refreshSyncQueue() {
    ref
      ..invalidate(syncQueueEntriesProvider)
      ..invalidate(syncRunStateProvider);
  }

  void _startPolling() {
    _pollUntil = DateTime.now().add(_pollFor);
    _poll?.cancel();
    _poll = Timer.periodic(_pollEvery, (Timer timer) {
      if (!mounted || DateTime.now().isAfter(_pollUntil!)) {
        timer.cancel();
        return;
      }
      refreshSyncQueue();
    });
  }

  /// Sync now covers both queues: queued commands go to the background sync
  /// task ([syncNowRequestProvider]); submitted inspections are flushed
  /// through their queue's own entry point
  /// ([syncQueueInspectionFlushProvider]).
  Future<void> syncNow(List<SyncQueueEntry> items) async {
    if (_requesting) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool commands =
        items.any((e) => !e.isInspection && syncQueueEntryUnsent(e));
    final bool inspections =
        items.any((e) => e.isInspection && syncQueueEntryUnsent(e));
    setState(() => _requesting = true);
    bool failed = false;
    try {
      if (commands) {
        try {
          await ref.read(syncNowRequestProvider)();
        } on Object {
          failed = true;
        }
      }
      if (inspections) {
        try {
          await ref.read(syncQueueInspectionFlushProvider)();
        } on Object {
          failed = true;
        }
      }
      if (!mounted) return;
      refreshSyncQueue();
      if (commands && !failed) _startPolling();
      showSyncMessage(
        failed ? l10n.syncQueueRequestFailed : l10n.syncQueueRequested,
      );
    } finally {
      if (mounted) setState(() => _requesting = false);
    }
  }

  /// Puts one failed item back in the queue and, when online, asks for a
  /// sync straight away.
  Future<void> retryEntry(SyncQueueEntry entry) async {
    if (_retrying.contains(entry.id)) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() => _retrying.add(entry.id));
    try {
      if (entry.isInspection) {
        // The inspection queue has no per-item reset: every flush tries each
        // unsent submission again, so Retry is a flush.
        await ref.read(syncQueueInspectionFlushProvider)();
        if (!mounted) return;
        refreshSyncQueue();
        showSyncMessage(l10n.syncQueueInspectionRetried);
        return;
      }
      final bool reset = await ref.read(syncQueueRetryProvider)(entry.id);
      if (!mounted) return;
      refreshSyncQueue();
      showSyncMessage(
        reset ? l10n.syncQueueRetried : l10n.syncQueueRetryNotNeeded,
      );
      // Send it now if the device is online; the next periodic run picks it
      // up otherwise.
      if (reset && ref.read(syncQueueOnlineProvider).asData?.value == true) {
        try {
          await ref.read(syncNowRequestProvider)();
          if (mounted) _startPolling();
        } on Object {
          // The row is back in the queue; the next run sends it.
        }
      }
    } on Object {
      if (mounted) showSyncMessage(l10n.syncQueueRetryFailed);
    } finally {
      if (mounted) setState(() => _retrying.remove(entry.id));
    }
  }
}
