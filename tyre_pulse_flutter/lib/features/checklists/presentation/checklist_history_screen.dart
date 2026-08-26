/// "My checklist history" - this operator's own completed submissions,
/// merged with whatever of their own work is still in the offline queue.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_history_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_history_row.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_history_view.dart';

class ChecklistHistoryScreen extends ConsumerStatefulWidget {
  const ChecklistHistoryScreen({super.key});

  @override
  ConsumerState<ChecklistHistoryScreen> createState() =>
      _ChecklistHistoryScreenState();
}

class _ChecklistHistoryScreenState
    extends ConsumerState<ChecklistHistoryScreen> {
  bool _loading = true;
  String? _errorMessage;
  ChecklistHistory _history =
      const ChecklistHistory(completed: <ChecklistHistoryRow>[], queued: <QueuedChecklistSubmission>[]);
  String _search = '';
  ChecklistHistoryState? _stateFilter;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      setState(() {
        _loading = false;
        _errorMessage = 'Your workspace is still loading.';
      });
      return;
    }

    String workspaceId;
    try {
      workspaceId = workspaceIdFor(workspace);
    } on ArgumentError {
      workspaceId = '';
    }

    try {
      final repository = ref.read(checklistHistoryRepositoryProvider);
      final ChecklistHistory history = await repository.load(
        userId: workspace.userId,
        workspaceId: workspaceId,
      );
      if (!mounted) return;
      setState(() {
        _history = history;
        _loading = false;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _errorMessage = 'Your checklist history could not be loaded. Pull '
            'down to try again.';
      });
    }
  }

  List<ChecklistHistoryRow> get _filteredCompleted {
    return _history.completed.where((ChecklistHistoryRow r) {
      if (_stateFilter != null &&
          checklistHistoryStateOf(r.approvalStatus) != _stateFilter) {
        return false;
      }
      return matchesChecklistHistorySearch(
        ChecklistHistorySearchRow(
          documentNo: r.documentNo,
          templateName: r.templateName,
          title: r.title,
          assetNo: r.assetNo,
          site: r.site,
        ),
        _search,
      );
    }).toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return TpScaffold(
      backFallback: TpRoutePaths.checklists,
      appBar: TpAppBar(
        title: l10n.checklistHistoryTitle,
        backFallback: TpRoutePaths.checklists,
      ),
      body: _body(l10n),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();

    final List<ChecklistHistoryRow> completed = _filteredCompleted;
    final bool nothingAtAll =
        completed.isEmpty && _history.queued.isEmpty && _search.isEmpty;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          if (_errorMessage != null)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.lg),
              child: _InlineWarning(message: _errorMessage!, onRetry: _load),
            ),
          TpSearchField(
            hint: l10n.checklistHistorySearchHint,
            onChanged: (String v) => setState(() => _search = v),
          ),
          const SizedBox(height: TpSpace.md),
          Wrap(
            spacing: TpSpace.sm,
            children: <Widget>[
              _StateFilterChip(
                label: l10n.checklistHistoryFilterAll,
                selected: _stateFilter == null,
                onTap: () => setState(() => _stateFilter = null),
              ),
              _StateFilterChip(
                label: l10n.checklistHistoryFilterWaiting,
                selected: _stateFilter == ChecklistHistoryState.waiting,
                onTap: () =>
                    setState(() => _stateFilter = ChecklistHistoryState.waiting),
              ),
              _StateFilterChip(
                label: l10n.checklistHistoryFilterClosed,
                selected: _stateFilter == ChecklistHistoryState.closed,
                onTap: () =>
                    setState(() => _stateFilter = ChecklistHistoryState.closed),
              ),
              _StateFilterChip(
                label: l10n.checklistHistoryFilterSentBack,
                selected: _stateFilter == ChecklistHistoryState.sentBack,
                onTap: () => setState(
                  () => _stateFilter = ChecklistHistoryState.sentBack,
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.lg),
          if (nothingAtAll)
            SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.5,
              child: TpEmptyState(
                title: l10n.checklistHistoryEmptyTitle,
                message: l10n.checklistHistoryEmptyMessage,
                icon: Icons.fact_check_outlined,
              ),
            ),
          if (_history.queued.isNotEmpty) ...<Widget>[
            _SectionHeader(label: l10n.checklistHistoryQueuedSection),
            for (final QueuedChecklistSubmission q in _history.queued)
              _QueuedRow(item: q),
            const SizedBox(height: TpSpace.lg),
          ],
          if (completed.isNotEmpty) ...<Widget>[
            _SectionHeader(label: l10n.checklistHistoryCompletedSection),
            for (final ChecklistHistoryRow row in completed) _CompletedRow(row: row),
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
  final Future<void> Function() onRetry;

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

class _StateFilterChip extends StatelessWidget {
  const _StateFilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ChoiceChip(label: Text(label), selected: selected, onSelected: (_) => onTap());
  }
}

class _QueuedRow extends StatelessWidget {
  const _QueuedRow({required this.item});

  final QueuedChecklistSubmission item;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final (IconData icon, TpStatus tone, String label) = item.needsAttention
        ? (Icons.error_outline, TpStatus.critical, l10n.checklistQueueFailedLabel)
        : (Icons.cloud_upload_outlined, TpStatus.info, l10n.checklistQueuePendingLabel);

    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  item.templateName ?? '',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                Text(
                  <String?>[item.assetNo, item.site]
                      .where((v) => v != null && v.isNotEmpty)
                      .join(' - '),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          TpStatusChip(status: tone, label: label, icon: icon, isCompact: true),
        ],
      ),
    );
  }
}

class _CompletedRow extends StatelessWidget {
  const _CompletedRow({required this.row});

  final ChecklistHistoryRow row;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ChecklistHistoryState state = checklistHistoryStateOf(row.approvalStatus);
    final (TpStatus tone, String label) = switch (state) {
      ChecklistHistoryState.closed => (TpStatus.ok, l10n.checklistHistoryStatusClosed),
      ChecklistHistoryState.sentBack => (
          TpStatus.critical,
          l10n.checklistHistoryStatusSentBack,
        ),
      ChecklistHistoryState.waiting => (
          TpStatus.warning,
          l10n.checklistHistoryStatusWaiting,
        ),
      ChecklistHistoryState.noApproval => (
          TpStatus.neutral,
          l10n.checklistHistoryStatusNoApproval,
        ),
    };

    return TpCard(
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  row.documentNo ?? (row.templateName ?? ''),
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                Text(
                  <String?>[row.assetNo, row.site]
                      .where((v) => v != null && v.isNotEmpty)
                      .join(' - '),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                Text(
                  row.submittedAt ?? '',
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
          ),
          TpStatusChip(status: tone, label: label, isCompact: true),
        ],
      ),
    );
  }
}
