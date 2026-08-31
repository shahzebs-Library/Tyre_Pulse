/// "My Inspections" - this inspector's own work, whatever state it is in.
///
/// Artifact 01 section 2.11 records production's `app/(app)/history.tsx` as
/// inspection history: the signed-in person's queued and synced inspections,
/// with status filtering and detail/PDF access. This implementation adds the
/// device-only unfinished drafts that production could lose, then merges the
/// queued submission and confirmed server row through
/// [InspectionHistoryEntry]/[sortInspectionHistory]. Drafts remain a separate
/// section because "still being filled in" is not a submitted state.
///
/// The screen is registered for [TpRouteId.activityHistory] and is also opened
/// from [NewInspectionScreen] with an ordinary [MaterialPageRoute]. Both entry
/// points intentionally share the same truthful data and detail navigation.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_draft_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_history_entry.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';

class InspectionHistoryScreen extends ConsumerStatefulWidget {
  const InspectionHistoryScreen({super.key});

  @override
  ConsumerState<InspectionHistoryScreen> createState() =>
      _InspectionHistoryScreenState();
}

class _InspectionHistoryScreenState
    extends ConsumerState<InspectionHistoryScreen> {
  bool _didStartInitialLoad = false;
  bool _loading = true;
  AppError? _error;
  List<InspectionDraftSummary> _drafts = const <InspectionDraftSummary>[];
  List<InspectionHistoryEntry> _entries = const <InspectionHistoryEntry>[];
  int _attentionCount = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_didStartInitialLoad) return;
    _didStartInitialLoad = true;
    unawaited(_load(flushFirst: true));
  }

  Future<void> _load({bool flushFirst = false}) async {
    setState(() {
      _loading = true;
      _error = null;
    });

    final String userId = ref.read(workspaceContextProvider)?.userId ?? '';

    if (flushFirst) {
      // Opportunistic - "when the My Inspections screen opens", per
      // `InspectionSyncEngine.flushQueue`'s own doc comment. Best-effort:
      // a failure here must not stop the list itself from loading.
      try {
        await ref.read(inspectionSyncEngineProvider).flushQueue();
      } on Object {
        // Ignored - the queue read below reports the real, current state
        // regardless of whether this pass moved anything forward.
      }
    }

    try {
      final InspectionDraftRepository draftRepo = ref.read(
        inspectionDraftRepositoryProvider,
      );
      final List<InspectionDraftSummary> drafts = userId.isEmpty
          ? const <InspectionDraftSummary>[]
          : await draftRepo.draftsForUser(userId);

      final InspectionQueueReadResult queueRead =
          await ref.read(inspectionSubmissionQueueProvider).list();
      final List<InspectionHistoryEntry> queuedEntries = queueRead.isReadable
          ? <InspectionHistoryEntry>[
              for (final QueuedInspection q in queueRead.items)
                InspectionHistoryEntry.fromQueued(q),
            ]
          : const <InspectionHistoryEntry>[];

      final List<InspectionHistoryEntry> syncedEntries = userId.isEmpty
          ? const <InspectionHistoryEntry>[]
          : <InspectionHistoryEntry>[
              for (final record in await ref
                  .read(inspectionRemoteRepositoryProvider)
                  .myInspections(createdBy: userId))
                InspectionHistoryEntry(
                  source: InspectionHistorySource.synced,
                  id: record.id,
                  recordId: record.id,
                  assetNo: record.assetNo,
                  site: record.site,
                  inspectionDate: DateTime.tryParse(record.inspectionDate) ??
                      DateTime.now(),
                  updatedAt: DateTime.tryParse(record.createdAt ?? '') ??
                      DateTime.now(),
                  approvalStatus: record.approvalStatus,
                ),
            ];

      final List<InspectionHistoryEntry> merged = sortInspectionHistory(
        <InspectionHistoryEntry>[...queuedEntries, ...syncedEntries],
      );

      setState(() {
        _drafts = drafts;
        _entries = merged;
        _attentionCount =
            merged.where((InspectionHistoryEntry e) => e.needsAttention).length;
        _loading = false;
      });

      if (!queueRead.isReadable && mounted) {
        // Refuse-rather-than-guess: the queue could not be listed, so a
        // caller must not act as though it is empty. Surfaced as a soft
        // warning banner rather than the hard error state, because the
        // draft and synced halves of the screen ARE still trustworthy.
        final AppLocalizations l10n = AppLocalizations.of(context);
        setState(() {
          _error = AppError(
            kind: AppErrorKind.storage,
            message: l10n.inspectionHistoryQueueReadErrorMessage,
            technical: 'InspectionSubmissionQueue.list() unreadable',
            isRetryable: true,
          );
        });
      }
    } on Object {
      if (!mounted) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      setState(() {
        _error = AppError(
          kind: AppErrorKind.unknown,
          message: l10n.inspectionHistoryLoadErrorMessage,
          technical: 'InspectionHistoryScreen._load failed',
          isRetryable: true,
        );
        _loading = false;
      });
    }
  }

  void _openDetail(InspectionHistoryEntry entry) {
    final String id = entry.source == InspectionHistorySource.synced
        ? (entry.recordId ?? entry.id)
        : entry.id;
    GoRouter.of(context)
        .push(InspectionDetailRoute(inspectionId: InspectionId(id)).location);
  }

  void _resumeDraft(InspectionDraftSummary draft) {
    GoRouter.of(context)
        .push(NewInspectionRoute(assetNo: AssetNo(draft.assetNo)).location);
  }

  void _startNew() {
    GoRouter.of(context).push(const NewInspectionRoute().location);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return TpScaffold(
      backFallback: TpRoutePaths.home,
      appBar: TpAppBar(
        title: l10n.inspectionHistoryTitle,
        backFallback: TpRoutePaths.home,
        actions: <Widget>[
          Padding(
            padding: const EdgeInsets.only(right: TpSpace.md),
            child: TpSyncIndicator(
              summary: TpSyncSummary(
                connectivity: TpConnectivity.unknown,
                pendingCount: _entries
                    .where((e) => e.isLocalOnly && !e.needsAttention)
                    .length,
                attentionCount: _attentionCount,
              ),
            ),
          ),
        ],
      ),
      body: _body(l10n),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _startNew,
        icon: const Icon(Icons.add),
        label: Text(l10n.inspectionNewInspection),
      ),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();
    if (_error != null && _drafts.isEmpty && _entries.isEmpty) {
      return TpErrorState(error: _error!, onRetry: _load);
    }
    if (_drafts.isEmpty && _entries.isEmpty) {
      return RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          children: <Widget>[
            SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.7,
              child: TpEmptyState(
                title: l10n.inspectionHistoryEmptyTitle,
                message: l10n.inspectionHistoryEmptyMessage,
                icon: Icons.assignment_outlined,
                actionLabel: l10n.inspectionNewInspection,
                onAction: _startNew,
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl * 2,
        ),
        children: <Widget>[
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.lg),
              child: _InlineWarning(message: _error!.message, onRetry: _load),
            ),
          if (_drafts.isNotEmpty) ...<Widget>[
            _SectionHeader(label: l10n.inspectionHistoryInProgressSection),
            for (final InspectionDraftSummary draft in _drafts)
              _DraftRow(draft: draft, onTap: () => _resumeDraft(draft)),
            const SizedBox(height: TpSpace.lg),
          ],
          if (_entries.isNotEmpty) ...<Widget>[
            _SectionHeader(label: l10n.inspectionHistorySubmittedSection),
            for (final InspectionHistoryEntry entry in _entries)
              _HistoryRow(entry: entry, onTap: () => _openDetail(entry)),
          ],
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .labelLarge
            ?.copyWith(color: TpPalette.of(context).textMuted),
      ),
    );
  }
}

class _InlineWarning extends StatelessWidget {
  const _InlineWarning({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpStatusColors colors =
        TpPalette.of(context).forStatus(TpStatus.warning);
    return Container(
      padding: const EdgeInsets.all(TpSpace.md),
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base),
      ),
      child: Row(
        children: <Widget>[
          Icon(Icons.warning_amber_outlined, color: colors.onSoft),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.onSoft),
            ),
          ),
          TpButton.text(label: l10n.actionRetry, onPressed: onRetry),
        ],
      ),
    );
  }
}

class _DraftRow extends StatelessWidget {
  const _DraftRow({required this.draft, required this.onTap});

  final InspectionDraftSummary draft;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      onTap: onTap,
      child: Row(
        children: <Widget>[
          Icon(
            Icons.edit_note_outlined,
            color: TpPalette.of(context).info.base,
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  draft.assetNo,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                Text(
                  l10n.inspectionResumeProgress(draft.filled, draft.total),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right),
        ],
      ),
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.entry, required this.onTap});

  final InspectionHistoryEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final (IconData icon, TpStatus tone, String label) = _statusOf(l10n);

    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      onTap: onTap,
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  entry.assetNo,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                Text(entry.site, style: Theme.of(context).textTheme.bodySmall),
                Text(
                  _formatDate(entry.inspectionDate),
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
          ),
          TpStatusChip(status: tone, label: label, icon: icon, isCompact: true),
        ],
      ),
    );
  }

  (IconData, TpStatus, String) _statusOf(AppLocalizations l10n) {
    if (entry.source == InspectionHistorySource.synced) {
      return (
        Icons.cloud_done_outlined,
        TpStatus.ok,
        entry.approvalStatus ?? l10n.inspectionStatusSynced,
      );
    }
    return switch (entry.queueStatus) {
      InspectionQueueStatus.failed => (
          Icons.error_outline,
          TpStatus.critical,
          l10n.inspectionQueueFailedLabel,
        ),
      InspectionQueueStatus.synced => (
          Icons.cloud_done_outlined,
          TpStatus.ok,
          l10n.inspectionStatusSynced,
        ),
      InspectionQueueStatus.pending || null => (
          Icons.cloud_upload_outlined,
          TpStatus.info,
          l10n.inspectionQueuePendingLabel,
        ),
    };
  }

  static String _formatDate(DateTime d) {
    final DateTime local = d.toLocal();
    final String y = local.year.toString().padLeft(4, '0');
    final String m = local.month.toString().padLeft(2, '0');
    final String day = local.day.toString().padLeft(2, '0');
    return '$y-$m-$day';
  }
}
