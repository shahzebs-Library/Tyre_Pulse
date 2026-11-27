/// Profile's "Sync queue": what is still waiting on this phone, what failed,
/// what was sent, and one honest "Sync now".
///
/// Opened from Profile's "Pending sync" tile and row. Pushed with
/// [Navigator] (like Report a problem and QR sign-in) so no route table file
/// changes. Every figure comes from `sync_queue_providers.dart`; see that
/// file's library comment for what is read and what the two actions reuse.
///
/// The two actions live in `sync_queue_actions.dart`, shared with the quick
/// sync sheet (`sync_queue_sheet.dart`), which is what Profile and Home open
/// first; this screen is the sheet's "See all".
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/features/profile/presentation/sync_queue_actions.dart';
import 'package:tyre_pulse/features/profile/sync_queue_providers.dart';

/// Opens the sync queue screen.
Future<void> openSyncQueue(BuildContext context) {
  return Navigator.of(context).push<void>(
    MaterialPageRoute<void>(
      builder: (BuildContext _) => const SyncQueueScreen(),
    ),
  );
}

/// Stable finders for tests.
@visibleForTesting
abstract final class SyncQueueScreenKeys {
  static const Key statPending = Key('syncQueue.stat.pending');
  static const Key statAttention = Key('syncQueue.stat.attention');
  static const Key statSent = Key('syncQueue.stat.sent');
  static const Key lastAttempt = Key('syncQueue.lastAttempt');
  static const Key syncNow = Key('syncQueue.syncNow');
  static const Key syncNowReason = Key('syncQueue.syncNowReason');
  static const Key empty = Key('syncQueue.empty');
  static const Key error = Key('syncQueue.error');
  static ValueKey<String> item(String id) => ValueKey<String>('syncQueue.$id');
  static ValueKey<String> retry(String id) =>
      ValueKey<String>('syncQueue.retry.$id');
}

/// The plain-English name of a queue row: "Inspection ASSET" for a
/// submitted inspection, otherwise the command's own name.
String syncQueueEntryLabel(AppLocalizations l10n, SyncQueueEntry entry) {
  final String? asset = entry.inspectionAsset;
  if (asset != null) {
    return asset.isEmpty
        ? l10n.profileDraftKindInspection
        : l10n.syncTypeInspection(asset);
  }
  return syncQueueTypeLabel(l10n, entry.commandType);
}

/// The plain-English name of a queued command type.
String syncQueueTypeLabel(AppLocalizations l10n, CommandType? type) {
  return switch (type) {
    null => l10n.syncTypeUnknown,
    CommandType.tyreChange => l10n.syncTypeTyreChange,
    CommandType.workOrder => l10n.syncTypeWorkOrder,
    CommandType.rca => l10n.syncTypeRca,
    CommandType.reportIssue => l10n.syncTypeReportIssue,
    CommandType.stockAdjust => l10n.syncTypeStockAdjust,
    CommandType.workOrderStatus => l10n.syncTypeWorkOrderStatus,
    CommandType.correctiveActionStatus => l10n.syncTypeCorrectiveActionStatus,
    CommandType.checklistSubmission => l10n.syncTypeChecklistSubmission,
    CommandType.checklistAssignmentStatus =>
      l10n.syncTypeChecklistAssignmentStatus,
    CommandType.odometerLog => l10n.syncTypeOdometerLog,
    CommandType.engineHoursLog => l10n.syncTypeEngineHoursLog,
    CommandType.reportAccident => l10n.syncTypeReportAccident,
    CommandType.washRecord => l10n.syncTypeWashRecord,
    CommandType.workshopEvent => l10n.syncTypeWorkshopEvent,
    CommandType.inventoryCountLine => l10n.syncTypeInventoryCountLine,
  };
}

/// The icon for a queued command type.
IconData syncQueueTypeIcon(CommandType? type) {
  return switch (type) {
    null => Icons.help_outline_rounded,
    CommandType.tyreChange => Icons.tire_repair_outlined,
    CommandType.workOrder ||
    CommandType.workOrderStatus =>
      Icons.build_outlined,
    CommandType.rca => Icons.account_tree_outlined,
    CommandType.reportIssue ||
    CommandType.correctiveActionStatus =>
      Icons.report_problem_outlined,
    CommandType.stockAdjust ||
    CommandType.inventoryCountLine =>
      Icons.inventory_2_outlined,
    CommandType.checklistSubmission ||
    CommandType.checklistAssignmentStatus =>
      Icons.fact_check_outlined,
    CommandType.odometerLog || CommandType.engineHoursLog => Icons.speed,
    CommandType.reportAccident => Icons.car_crash_outlined,
    CommandType.washRecord => Icons.local_car_wash_outlined,
    CommandType.workshopEvent => Icons.handyman_outlined,
  };
}

/// The plain-English label of a queue state.
String syncQueueStateLabel(AppLocalizations l10n, SyncQueueItemState state) {
  return switch (state) {
    SyncQueueItemState.waiting => l10n.syncQueueStateWaiting,
    SyncQueueItemState.sending => l10n.syncQueueStateSending,
    SyncQueueItemState.retrying => l10n.syncQueueStateRetrying,
    SyncQueueItemState.onHold => l10n.syncQueueStateOnHold,
    SyncQueueItemState.needsAttention => l10n.syncQueueStateNeedsAttention,
    SyncQueueItemState.sent => l10n.syncQueueStateSent,
  };
}

/// The status tone of a queue state.
TpStatus syncQueueStateTone(SyncQueueItemState state) {
  return switch (state) {
    SyncQueueItemState.waiting => TpStatus.info,
    SyncQueueItemState.sending => TpStatus.info,
    SyncQueueItemState.retrying => TpStatus.warning,
    SyncQueueItemState.onHold => TpStatus.neutral,
    SyncQueueItemState.needsAttention => TpStatus.critical,
    SyncQueueItemState.sent => TpStatus.ok,
  };
}

/// The icon of a queue row: a tyre for a submitted inspection, otherwise the
/// command's own icon.
IconData syncQueueEntryIcon(SyncQueueEntry entry) => entry.isInspection
    ? Icons.tire_repair_outlined
    : syncQueueTypeIcon(entry.commandType);

String _formatTime(BuildContext context, DateTime at) {
  final String locale = Localizations.localeOf(context).toLanguageTag();
  return DateFormat('d MMM, HH:mm', locale).format(at.toLocal());
}

class SyncQueueScreen extends ConsumerStatefulWidget {
  const SyncQueueScreen({super.key});

  @override
  ConsumerState<SyncQueueScreen> createState() => _SyncQueueScreenState();
}

class _SyncQueueScreenState extends ConsumerState<SyncQueueScreen>
    with WidgetsBindingObserver, SyncQueueActionsMixin<SyncQueueScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  void _refresh() => refreshSyncQueue();

  @override
  void showSyncMessage(String message) {
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<SyncQueueEntry>> entries = ref.watch(
      syncQueueEntriesProvider,
    );

    return TpScaffold(
      appBar: TpAppBar(
        title: l10n.profileSyncQueueTitle,
        onBack: () => unawaited(Navigator.of(context).maybePop()),
      ),
      body: entries.when(
        loading: () => const TpLoadingState(),
        error: (Object error, StackTrace stackTrace) => TpStateView(
          key: SyncQueueScreenKeys.error,
          icon: Icons.error_outline_rounded,
          tone: TpStatus.critical,
          title: l10n.syncQueueLoadFailedTitle,
          message: l10n.syncQueueLoadFailedMessage,
          primaryActionLabel: l10n.actionRetry,
          onPrimaryAction: _refresh,
        ),
        data: (List<SyncQueueEntry> items) => _buildData(context, l10n, items),
      ),
    );
  }

  Widget _buildData(
    BuildContext context,
    AppLocalizations l10n,
    List<SyncQueueEntry> items,
  ) {
    final SyncRunState run =
        ref.watch(syncRunStateProvider).asData?.value ?? const SyncRunState();
    final AsyncValue<bool> online = ref.watch(syncQueueOnlineProvider);
    final bool syncing = run.isSyncingAt(DateTime.now());

    final int pending = items.where((e) => e.state.isPending).length;
    final int attention =
        items.where((e) => e.state == SyncQueueItemState.needsAttention).length;
    final int sent =
        items.where((e) => e.state == SyncQueueItemState.sent).length;

    final Widget lastAttempt = Text(
      key: SyncQueueScreenKeys.lastAttempt,
      run.lastAttemptAt == null
          ? l10n.syncQueueNoAttempt
          : l10n.syncQueueLastAttempt(_formatTime(context, run.lastAttemptAt!)),
      style: Theme.of(context)
          .textTheme
          .bodySmall
          ?.copyWith(color: TpPalette.of(context).textMuted),
    );

    if (pending == 0 && attention == 0 && sent == 0) {
      return TpStateView(
        key: SyncQueueScreenKeys.empty,
        icon: Icons.cloud_done_outlined,
        tone: TpStatus.ok,
        title: l10n.syncQueueEmptyTitle,
        message: l10n.syncQueueEmptyMessage,
        detail: run.lastAttemptAt == null
            ? l10n.syncQueueNoAttempt
            : l10n.syncQueueLastAttempt(
                _formatTime(context, run.lastAttemptAt!),
              ),
      );
    }

    final String? disabledReason = syncNowDisabledReason(
      l10n,
      isOffline: online.asData?.value == false,
      isSyncing: syncing,
      hasUnsent: pending > 0 || attention > 0,
    );
    final bool canSync = disabledReason == null && !isRequestingSync;

    return RefreshIndicator(
      onRefresh: () async => _refresh(),
      child: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: TpStatCard.count(
                  key: SyncQueueScreenKeys.statPending,
                  label: l10n.syncQueueStatPending,
                  count: pending,
                  status: pending > 0 ? TpStatus.warning : TpStatus.ok,
                  icon: Icons.cloud_upload_outlined,
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: TpStatCard.count(
                  key: SyncQueueScreenKeys.statAttention,
                  label: l10n.syncQueueStatAttention,
                  count: attention,
                  status: attention > 0 ? TpStatus.critical : TpStatus.ok,
                  icon: Icons.error_outline_rounded,
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: TpStatCard.count(
                  key: SyncQueueScreenKeys.statSent,
                  label: l10n.syncQueueStatSent,
                  caption: l10n.syncQueueStatSentCaption,
                  count: sent,
                  status: TpStatus.ok,
                  icon: Icons.cloud_done_outlined,
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          lastAttempt,
          const SizedBox(height: TpSpace.md),
          TpButton(
            key: SyncQueueScreenKeys.syncNow,
            label: l10n.syncQueueSyncNow,
            icon: Icons.sync_rounded,
            isFullWidth: true,
            isBusy: isRequestingSync || syncing,
            onPressed: canSync ? () => unawaited(syncNow(items)) : null,
          ),
          if (disabledReason != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(
              disabledReason,
              key: SyncQueueScreenKeys.syncNowReason,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: TpPalette.of(context).textSecondary),
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          Text(
            l10n.syncQueueSectionItems,
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: TpSpace.sm),
          for (final SyncQueueEntry entry in items) ...<Widget>[
            _SyncQueueItemCard(
              entry: entry,
              isRetrying: isRetryingEntry(entry.id),
              onRetry: entry.state == SyncQueueItemState.needsAttention
                  ? () => unawaited(retryEntry(entry))
                  : null,
            ),
            const SizedBox(height: TpSpace.sm),
          ],
        ],
      ),
    );
  }
}

class _SyncQueueItemCard extends StatelessWidget {
  const _SyncQueueItemCard({
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
    final DateTime? next = entry.nextAttemptAt;
    final List<String> meta = <String>[
      l10n.syncQueueItemQueued(_formatTime(context, entry.queuedAt)),
      l10n.syncQueueAttempts(entry.attempts),
      if (entry.state == SyncQueueItemState.retrying && next != null)
        l10n.syncQueueNextAttempt(_formatTime(context, next)),
    ];

    return TpCard(
      key: SyncQueueScreenKeys.item(entry.id),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              TpIcon(
                syncQueueEntryIcon(entry),
                size: 22,
                color: palette.primary,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  syncQueueEntryLabel(l10n, entry),
                  style: text.bodyMedium?.copyWith(
                    color: palette.text,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              TpStatusChip(
                status: syncQueueStateTone(entry.state),
                label: syncQueueStateLabel(l10n, entry.state),
                isCompact: true,
              ),
            ],
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            meta.join(' · '),
            style: text.bodySmall?.copyWith(color: palette.textMuted),
          ),
          if (error != null &&
              entry.state != SyncQueueItemState.sent) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              error,
              style: text.bodySmall?.copyWith(
                color: entry.state == SyncQueueItemState.needsAttention
                    ? palette.critical.base
                    : palette.textSecondary,
              ),
            ),
          ],
          if (onRetry != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TpButton(
                key: SyncQueueScreenKeys.retry(entry.id),
                label: l10n.syncQueueRetry,
                icon: Icons.refresh_rounded,
                variant: TpButtonVariant.secondary,
                isCompact: true,
                isBusy: isRetrying,
                onPressed: isRetrying ? null : onRetry,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
