/// Checklist approvals - the reviewer's queue.
///
/// Lists submissions still waiting on a signature, newest first. Since
/// V594 there are TWO waiting states, not one: a sheet sits at `pending`
/// until a supervisor signs it off, then at `pending_area_manager` until
/// the area manager closes it - [ChecklistApprovalStatusChip] says which,
/// and the "Needs me" filter narrows the list to rows THIS reviewer can
/// act on right now, via `checklist_approval.dart`'s [canDecide].
///
/// Ported from `mobile/app/(app)/checklists/approvals/index.tsx`
/// (`mobile/` is READ-ONLY reference material - see `AGENTS.md`). Access
/// is gated by `RouteModule.approvals` at the router
/// (`app/router/route_access.dart`) AND by `checklist_submissions` RLS at
/// the database - "hiding the entry is never the only defence" - so this
/// screen, like its sibling `InspectionApprovalsQueueScreen`, does not
/// re-implement its own permission gate.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/approvals/checklist_approvals_providers.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_sync_engine.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_template_info.dart';
import 'package:tyre_pulse/features/approvals/data/queued_checklist_approval_decision.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/checklist_approval_status_chip.dart';

enum _QueueFilter { all, mine }

class ChecklistApprovalsQueueScreen extends ConsumerStatefulWidget {
  const ChecklistApprovalsQueueScreen({required this.route, super.key});

  final ChecklistApprovalsRoute route;

  @override
  ConsumerState<ChecklistApprovalsQueueScreen> createState() =>
      _ChecklistApprovalsQueueScreenState();
}

class _ChecklistApprovalsQueueScreenState
    extends ConsumerState<ChecklistApprovalsQueueScreen> {
  bool _loading = true;
  AppError? _error;
  List<ChecklistApprovalItem> _items = const <ChecklistApprovalItem>[];
  Map<String, ChecklistApprovalTemplateInfo> _templates =
      const <String, ChecklistApprovalTemplateInfo>{};
  _QueueFilter _filter = _QueueFilter.all;

  /// Decisions this device could not deliver AND will not retry on its own
  /// - see [ChecklistApprovalQueueStatus.blocked]'s own doc comment. Shown
  /// so "never remove offline persistence for convenience" (AGENTS.md rule
  /// 9) is something the reviewer can actually see and act on, not just a
  /// file sitting silently on the device.
  List<QueuedChecklistApprovalDecision> _blocked =
      const <QueuedChecklistApprovalDecision>[];
  String? _retryingId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final String? country = ref.read(activeCountryProvider);
    try {
      final List<ChecklistApprovalItem> items = await ref
          .read(checklistApprovalRepositoryProvider)
          .listPending(country: country);

      // Best-effort: templates decide the WORDING of a waiting state and
      // whether this reviewer may act on it right now. A template that
      // cannot be read leaves that one row on the generic "waiting for
      // approval" wording and out of the "Needs me" filter - it never
      // blocks the queue itself.
      final Set<String> templateIds = <String>{
        for (final ChecklistApprovalItem item in items)
          if (item.templateId != null) item.templateId!,
      };
      final Map<String, ChecklistApprovalTemplateInfo> templates = await ref
          .read(checklistApprovalRepositoryProvider)
          .templateInfoBatch(templateIds);

      // Opportunistic: connectivity may have returned since the last
      // decision was queued - never blocks the list itself.
      final ChecklistApprovalSyncEngine engine = ref.read(
        checklistApprovalSyncEngineProvider,
      );
      unawaited(engine.flushQueue());

      // Read back whatever is still on-device: a `pending` entry from the
      // flush just kicked off may still be in flight, but a `blocked` one
      // never resolves without the reviewer's own action, so it is worth
      // showing even mid-flush.
      final List<QueuedChecklistApprovalDecision> queued =
          await engine.listQueued();

      if (!mounted) return;
      setState(() {
        _items = items;
        _templates = templates;
        _blocked = queued
            .where((d) => d.status == ChecklistApprovalQueueStatus.blocked)
            .toList(growable: false);
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _asAppError(context, error);
        _loading = false;
      });
    }
  }

  Future<void> _refresh() => _load();

  ApprovalTemplateLike _templateLikeFor(ChecklistApprovalItem item) {
    final ChecklistApprovalTemplateInfo? info =
        item.templateId == null ? null : _templates[item.templateId];
    return info?.asTemplateLike ?? const ApprovalTemplateLike();
  }

  Future<void> _retryBlocked(String decisionId) async {
    if (_retryingId != null) return;
    setState(() => _retryingId = decisionId);
    try {
      await ref.read(checklistApprovalSyncEngineProvider).retryOne(decisionId);
    } on Object {
      // Any failure here is already recorded on the queue entry itself by
      // the engine - `_load` below re-reads it and shows the up-to-date
      // reason. Nothing further to do on this exception.
    }
    if (!mounted) return;
    setState(() => _retryingId = null);
    await _load();
  }

  void _open(ChecklistApprovalItem item) {
    context.push(
      ChecklistApprovalReviewRoute(submissionId: SubmissionId(item.id))
          .location,
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final workspace = ref.watch(workspaceContextProvider);
    final String? role = workspace?.role.rawValue;
    final bool isSuperAdmin = workspace?.isSuperAdmin ?? false;

    final Set<String> mine = <String>{
      for (final ChecklistApprovalItem item in _items)
        if (canDecide(
          _templateLikeFor(item),
          item.asSubmissionLike,
          role,
          isSuperAdmin: isSuperAdmin,
        ))
          item.id,
    };
    final List<ChecklistApprovalItem> visible = _filter == _QueueFilter.mine
        ? _items.where((item) => mine.contains(item.id)).toList(growable: false)
        : _items;

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.checklistApprovalsTitle,
        subtitle: _loading
            ? null
            : l10n.checklistApprovalsAwaitingCount(_items.length),
        backFallback: fallback,
      ),
      body: _body(l10n, visible, mine),
    );
  }

  Widget _body(
    AppLocalizations l10n,
    List<ChecklistApprovalItem> visible,
    Set<String> mine,
  ) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      return TpErrorState(error: _error!, onRetry: _load);
    }

    return RefreshIndicator(
      onRefresh: _refresh,
      child: Column(
        children: <Widget>[
          if (_blocked.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                TpSpace.lg,
                TpSpace.sm,
                TpSpace.lg,
                0,
              ),
              child: _BlockedDecisionsPanel(
                items: _blocked,
                retryingId: _retryingId,
                onRetry: _retryBlocked,
              ),
            ),
          if (_items.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                TpSpace.lg,
                TpSpace.sm,
                TpSpace.lg,
                0,
              ),
              child: _FilterRow(
                filter: _filter,
                allCount: _items.length,
                mineCount: mine.length,
                onChanged: (f) => setState(() => _filter = f),
              ),
            ),
          Expanded(
            child: visible.isEmpty
                ? ListView(
                    children: <Widget>[
                      SizedBox(
                        height: MediaQuery.sizeOf(context).height * 0.55,
                        child: TpEmptyState(
                          icon: Icons.checklist_rtl_outlined,
                          title: _filter == _QueueFilter.mine
                              ? l10n.checklistApprovalsEmptyMineTitle
                              : l10n.checklistApprovalsEmptyTitle,
                          message: _filter == _QueueFilter.mine
                              ? l10n.checklistApprovalsEmptyMineMessage
                              : l10n.checklistApprovalsEmptyMessage,
                        ),
                      ),
                    ],
                  )
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(
                      TpSpace.lg,
                      TpSpace.md,
                      TpSpace.lg,
                      TpSpace.xxl,
                    ),
                    itemCount: visible.length,
                    itemBuilder: (context, index) {
                      final ChecklistApprovalItem item = visible[index];
                      return _QueueRow(
                        item: item,
                        summary: statusSummary(
                          _templateLikeFor(item),
                          item.asSubmissionLike,
                        ),
                        isMine: mine.contains(item.id),
                        fallbackTitle: l10n.checklistApprovalFallbackTitle,
                        unavailableLabel: l10n.valueUnavailable,
                        yourTurnLabel: l10n.checklistApprovalsYourTurn,
                        onTap: () => _open(item),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

/// Mirrors `inspection_approvals_queue_screen.dart`'s own private
/// `_asAppError`: any [AppError]/[SupabaseFailure] already carries a
/// message safe to show; anything else falls back to a translated generic
/// sentence rather than a raw driver message.
AppError _asAppError(BuildContext context, Object error) {
  if (error is AppError) return error;
  if (error is SupabaseFailure) return error.error;
  return AppError(
    kind: AppErrorKind.unknown,
    message: AppLocalizations.of(context).checklistApprovalsLoadErrorMessage,
    technical: error.toString(),
    cause: error,
    isRetryable: true,
  );
}

class _FilterRow extends StatelessWidget {
  const _FilterRow({
    required this.filter,
    required this.allCount,
    required this.mineCount,
    required this.onChanged,
  });

  final _QueueFilter filter;
  final int allCount;
  final int mineCount;
  final ValueChanged<_QueueFilter> onChanged;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Row(
      children: <Widget>[
        ChoiceChip(
          label: Text('${l10n.checklistApprovalsFilterAll} ($allCount)'),
          selected: filter == _QueueFilter.all,
          onSelected: (_) => onChanged(_QueueFilter.all),
        ),
        const SizedBox(width: TpSpace.sm),
        ChoiceChip(
          label: Text('${l10n.checklistApprovalsFilterMine} ($mineCount)'),
          selected: filter == _QueueFilter.mine,
          onSelected: (_) => onChanged(_QueueFilter.mine),
        ),
      ],
    );
  }
}

/// Decisions this device made but could not deliver, and will not retry
/// automatically - see [ChecklistApprovalQueueStatus.blocked]'s own doc
/// comment. Each carries its own "Try again" action
/// ([ChecklistApprovalSyncEngine.retryOne]) and the reason it stopped,
/// which is either a genuine server refusal or this engine's own
/// detection that the submission moved on since the decision was made.
class _BlockedDecisionsPanel extends StatelessWidget {
  const _BlockedDecisionsPanel({
    required this.items,
    required this.retryingId,
    required this.onRetry,
  });

  final List<QueuedChecklistApprovalDecision> items;
  final String? retryingId;
  final ValueChanged<String> onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(TpStatus.critical);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(TpSpace.md),
      margin: const EdgeInsets.only(bottom: TpSpace.md),
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.error_outline,
                color: colors.base,
                size: TpSizing.iconMd,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  l10n.checklistApprovalsBlockedTitle(items.length),
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(color: colors.onSoft),
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            l10n.checklistApprovalsBlockedMessage,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: colors.onSoft),
          ),
          for (final QueuedChecklistApprovalDecision item in items)
            Padding(
              padding: const EdgeInsets.only(top: TpSpace.sm),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      item.error ?? l10n.checklistApprovalsBlockedMessage,
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: colors.onSoft),
                    ),
                  ),
                  const SizedBox(width: TpSpace.sm),
                  TpButton.secondary(
                    label: l10n.actionRetry,
                    isCompact: true,
                    isBusy: retryingId == item.id,
                    onPressed:
                        retryingId == null ? () => onRetry(item.id) : null,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _QueueRow extends StatelessWidget {
  const _QueueRow({
    required this.item,
    required this.summary,
    required this.isMine,
    required this.fallbackTitle,
    required this.unavailableLabel,
    required this.yourTurnLabel,
    required this.onTap,
  });

  final ChecklistApprovalItem item;
  final ApprovalStatusSummary summary;
  final bool isMine;
  final String fallbackTitle;
  final String unavailableLabel;
  final String yourTurnLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool isRtl = TpDirection.isRtl(context);
    final String heading = (item.title?.trim().isNotEmpty ?? false)
        ? item.title!.trim()
        : (item.templateName?.trim().isNotEmpty ?? false)
            ? item.templateName!.trim()
            : fallbackTitle;
    final String when = _formatDate(item.submittedAt) ?? unavailableLabel;

    return TpCard(
      onTap: onTap,
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Row(
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(
              color: palette.forStatus(TpStatus.warning).soft,
              shape: BoxShape.circle,
            ),
            child: Padding(
              padding: const EdgeInsets.all(TpSpace.sm),
              child: Icon(
                Icons.shield_outlined,
                size: TpSizing.iconMd,
                color: palette.forStatus(TpStatus.warning).onSoft,
              ),
            ),
          ),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  heading,
                  style: Theme.of(context).textTheme.titleSmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (item.documentNo != null)
                  _MetaRow(icon: Icons.sell_outlined, text: item.documentNo!),
                if (item.site != null || item.assetNo != null)
                  _MetaRow(
                    icon: Icons.place_outlined,
                    text: <String?>[
                      item.site,
                      item.assetNo,
                    ].where((v) => v != null && v.isNotEmpty).join(' - '),
                  ),
                _MetaRow(icon: Icons.event_outlined, text: when),
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Wrap(
                    spacing: TpSpace.xs,
                    children: <Widget>[
                      ChecklistApprovalStatusChip(
                        summary: summary,
                        isCompact: true,
                      ),
                      if (isMine)
                        TpStatusChip(
                          status: TpStatus.ok,
                          label: yourTurnLabel,
                          isCompact: true,
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.xs),
          Icon(
            isRtl ? Icons.chevron_left : Icons.chevron_right,
            color: palette.textMuted,
          ),
        ],
      ),
    );
  }

  static String? _formatDate(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    final DateTime? parsed = DateTime.tryParse(iso);
    if (parsed == null) return null;
    final DateTime local = parsed.toLocal();
    final String y = local.year.toString().padLeft(4, '0');
    final String m = local.month.toString().padLeft(2, '0');
    final String d = local.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }
}

class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextStyle? style = Theme.of(context)
        .textTheme
        .bodySmall
        ?.copyWith(color: palette.textMuted);
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Row(
        children: <Widget>[
          Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
          const SizedBox(width: TpSpace.xs),
          Flexible(
            child: Text(
              text,
              style: style,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
