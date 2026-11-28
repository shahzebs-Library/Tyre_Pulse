/// The quick sync sheet: one tap from Profile's or Home's "Pending sync", see
/// the status, act, done.
///
/// A compact modal sheet (not a page): one status line, up to
/// [syncQueueSheetMaxItems] of the most important unsent items (failed first,
/// each with an inline Retry), one "Sync now" with a one-line reason when it
/// cannot run (when everything is synced the status line alone is shown), and "See all (N)" to the full [SyncQueueScreen] only when the
/// queue holds more than the sheet shows.
///
/// Every figure and both actions are the same as the full screen's: the
/// providers in `sync_queue_providers.dart` and [SyncQueueActionsMixin].
library;

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/profile/presentation/sync_queue_actions.dart';
import 'package:tyre_pulse/features/profile/presentation/sync_queue_screen.dart';
import 'package:tyre_pulse/features/profile/sync_queue_providers.dart';

/// How many items the sheet lists before it offers "See all".
const int syncQueueSheetMaxItems = 3;

/// Opens the quick sync sheet over [context]. "See all" closes the sheet and
/// pushes the full [SyncQueueScreen] on [context]'s navigator.
Future<void> showSyncQueueSheet(BuildContext context) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  return TpBottomSheet.show<void>(
    context: context,
    title: l10n.profileSyncQueueTitle,
    builder: (BuildContext sheetContext) => SyncQueueSheet(
      onSeeAll: () {
        Navigator.of(sheetContext).pop();
        if (context.mounted) unawaited(openSyncQueue(context));
      },
    ),
  );
}

/// Stable finders for tests.
@visibleForTesting
abstract final class SyncQueueSheetKeys {
  static const Key sheet = Key('syncSheet');
  static const Key status = Key('syncSheet.status');
  static const Key syncNow = Key('syncSheet.syncNow');
  static const Key syncNowReason = Key('syncSheet.syncNowReason');
  static const Key feedback = Key('syncSheet.feedback');
  static const Key seeAll = Key('syncSheet.seeAll');
  static const Key error = Key('syncSheet.error');
  static ValueKey<String> item(String id) => ValueKey<String>('syncSheet.$id');
  static ValueKey<String> retry(String id) =>
      ValueKey<String>('syncSheet.retry.$id');
}

int _rank(SyncQueueItemState state) => switch (state) {
      SyncQueueItemState.needsAttention => 0,
      SyncQueueItemState.retrying => 1,
      SyncQueueItemState.sending => 2,
      SyncQueueItemState.waiting => 3,
      SyncQueueItemState.onHold => 4,
      SyncQueueItemState.sent => 5,
    };

/// The items the sheet shows: unsent only, failed first, then retrying,
/// sending, waiting and on hold; within a state the source order (newest
/// first) is kept. At most [max].
List<SyncQueueEntry> syncQueueSheetItems(
  List<SyncQueueEntry> entries, {
  int max = syncQueueSheetMaxItems,
}) {
  final List<(int, SyncQueueEntry)> indexed = <(int, SyncQueueEntry)>[
    for (int i = 0; i < entries.length; i++)
      if (syncQueueEntryUnsent(entries[i])) (i, entries[i]),
  ]..sort(((int, SyncQueueEntry) a, (int, SyncQueueEntry) b) {
      final int byRank = _rank(a.$2.state).compareTo(_rank(b.$2.state));
      return byRank != 0 ? byRank : a.$1.compareTo(b.$1);
    });
  return <SyncQueueEntry>[
    for (final (int, SyncQueueEntry) e in indexed.take(math.max(0, max))) e.$2,
  ];
}

/// "just now", "5 min ago", "3 h ago", "2 d ago". A time in the future (a
/// clock skew) reads as "just now".
String syncRelativeTime(AppLocalizations l10n, DateTime at, DateTime now) {
  final Duration ago = now.toUtc().difference(at.toUtc());
  if (ago.inMinutes < 1) return l10n.timeAgoJustNow;
  if (ago.inHours < 1) return l10n.timeAgoMinutes(ago.inMinutes);
  if (ago.inDays < 1) return l10n.timeAgoHours(ago.inHours);
  return l10n.timeAgoDays(ago.inDays);
}

class SyncQueueSheet extends ConsumerStatefulWidget {
  const SyncQueueSheet({required this.onSeeAll, this.now, super.key});

  /// Closes the sheet and opens the full screen.
  final VoidCallback onSeeAll;

  /// The clock, for tests.
  final DateTime Function()? now;

  @override
  ConsumerState<SyncQueueSheet> createState() => _SyncQueueSheetState();
}

class _SyncQueueSheetState extends ConsumerState<SyncQueueSheet>
    with SyncQueueActionsMixin<SyncQueueSheet> {
  String? _feedback;

  DateTime _now() => widget.now?.call() ?? DateTime.now();

  @override
  void showSyncMessage(String message) => setState(() => _feedback = message);

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<SyncQueueEntry>> entries =
        ref.watch(syncQueueEntriesProvider);
    final double maxHeight = MediaQuery.sizeOf(context).height * 0.6;

    return ConstrainedBox(
      key: SyncQueueSheetKeys.sheet,
      constraints: BoxConstraints(maxHeight: maxHeight),
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
        child: entries.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: TpSpace.lg),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (Object error, StackTrace stackTrace) => _ErrorLine(
            onRetry: refreshSyncQueue,
          ),
          data: (List<SyncQueueEntry> items) => _buildData(l10n, items),
        ),
      ),
    );
  }

  Widget _buildData(AppLocalizations l10n, List<SyncQueueEntry> items) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final SyncRunState run =
        ref.watch(syncRunStateProvider).asData?.value ?? const SyncRunState();
    final AsyncValue<bool> online = ref.watch(syncQueueOnlineProvider);
    final DateTime now = _now();
    final bool syncing = run.isSyncingAt(now);

    final int pending = items.where((e) => e.state.isPending).length;
    final int attention =
        items.where((e) => e.state == SyncQueueItemState.needsAttention).length;
    final List<SyncQueueEntry> shown = syncQueueSheetItems(items);

    final (IconData icon, TpStatusColors tone, String status) =
        switch ((pending, attention)) {
      (0, 0) => (
          Icons.cloud_done_rounded,
          palette.ok,
          <String>[
            l10n.syncSheetAllSynced,
            if (run.lastAttemptAt case final DateTime at)
              l10n.syncSheetLastAttempt(syncRelativeTime(l10n, at, now))
            else
              l10n.syncSheetNoAttempt,
          ].join(' · '),
        ),
      _ => (
          attention > 0
              ? Icons.error_outline_rounded
              : Icons.cloud_upload_outlined,
          attention > 0 ? palette.critical : palette.warning,
          <String>[
            if (pending > 0) l10n.syncSheetWaiting(pending),
            if (attention > 0) l10n.syncSheetNeedsAttention(attention),
          ].join(' · '),
        ),
    };

    final String? reason = syncNowDisabledReason(
      l10n,
      isOffline: online.asData?.value == false,
      isSyncing: syncing,
      hasUnsent: pending > 0 || attention > 0,
    );
    final bool canSync = reason == null && !isRequestingSync;
    final bool hasMore = items.length > shown.length;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          key: SyncQueueSheetKeys.status,
          children: <Widget>[
            TpIcon(icon, size: 22, color: tone.base),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                status,
                style: text.bodyMedium?.copyWith(
                  color: palette.text,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        if (shown.isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          for (final SyncQueueEntry entry in shown)
            _CompactRow(
              entry: entry,
              isRetrying: isRetryingEntry(entry.id),
              onRetry: entry.state == SyncQueueItemState.needsAttention
                  ? () => unawaited(retryEntry(entry))
                  : null,
            ),
        ],
        // Everything synced: the status line is the whole confirmation.
        if (pending > 0 || attention > 0) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          TpButton(
            key: SyncQueueSheetKeys.syncNow,
            label: l10n.syncQueueSyncNow,
            icon: Icons.sync_rounded,
            isFullWidth: true,
            isBusy: isRequestingSync || syncing,
            onPressed: canSync ? () => unawaited(syncNow(items)) : null,
          ),
          if (reason != null) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              reason,
              key: SyncQueueSheetKeys.syncNowReason,
              style: text.bodySmall?.copyWith(color: palette.textSecondary),
            ),
          ],
        ],
        if (_feedback case final String message) ...<Widget>[
          const SizedBox(height: TpSpace.xs),
          Text(
            message,
            key: SyncQueueSheetKeys.feedback,
            style: text.bodySmall?.copyWith(color: palette.textSecondary),
          ),
        ],
        if (hasMore) ...<Widget>[
          const SizedBox(height: TpSpace.xs),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: TpButton.text(
              key: SyncQueueSheetKeys.seeAll,
              label: l10n.sheetSeeAll(items.length),
              onPressed: widget.onSeeAll,
            ),
          ),
        ],
      ],
    );
  }
}

class _CompactRow extends StatelessWidget {
  const _CompactRow({
    required this.entry,
    required this.isRetrying,
    this.onRetry,
  });

  final SyncQueueEntry entry;
  final bool isRetrying;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String? error = entry.safeLastError(l10n.syncQueueErrorFallback);

    return Padding(
      key: SyncQueueSheetKeys.item(entry.id),
      padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
      child: Row(
        children: <Widget>[
          TpIcon(syncQueueEntryIcon(entry), size: 20, color: palette.primary),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  syncQueueEntryLabel(l10n, entry),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodyMedium?.copyWith(color: palette.text),
                ),
                Text(
                  error == null
                      ? syncQueueStateLabel(l10n, entry.state)
                      : '${syncQueueStateLabel(l10n, entry.state)} · $error',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodySmall?.copyWith(
                    color: entry.state == SyncQueueItemState.needsAttention
                        ? palette.critical.base
                        : palette.textMuted,
                  ),
                ),
              ],
            ),
          ),
          if (onRetry != null) ...<Widget>[
            const SizedBox(width: TpSpace.sm),
            TpButton(
              key: SyncQueueSheetKeys.retry(entry.id),
              label: l10n.syncQueueRetry,
              icon: Icons.refresh_rounded,
              variant: TpButtonVariant.secondary,
              isCompact: true,
              isBusy: isRetrying,
              onPressed: isRetrying ? null : onRetry,
            ),
          ],
        ],
      ),
    );
  }
}

class _ErrorLine extends StatelessWidget {
  const _ErrorLine({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Row(
      key: SyncQueueSheetKeys.error,
      children: <Widget>[
        TpIcon(
          Icons.error_outline_rounded,
          size: 22,
          color: palette.critical.base,
        ),
        const SizedBox(width: TpSpace.sm),
        Expanded(
          child: Text(
            l10n.syncQueueLoadFailedTitle,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
        TpButton.text(label: l10n.actionRetry, onPressed: onRetry),
      ],
    );
  }
}
