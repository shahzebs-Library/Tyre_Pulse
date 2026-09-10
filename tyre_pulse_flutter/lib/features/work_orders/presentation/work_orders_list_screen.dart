/// Work Orders - the permission-gated, live maintenance job-card list.
///
/// Reads stay bounded through [WorkOrderRepository.listRecent]. Create and
/// status changes keep their existing queued command paths; this presentation
/// pass changes hierarchy only and never presents a queued change as synced.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/features/approvals/presentation/execution_approval_review_screen.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_item.dart';
import 'package:tyre_pulse/features/work_orders/domain/work_order_status.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/create_work_order_sheet.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/work_order_badges.dart';
import 'package:tyre_pulse/features/work_orders/work_orders_providers.dart';

enum _WorkOrdersFilter { all, inProgress, completed }

abstract final class WorkOrdersListScreenKeys {
  static const Key filters = Key('workOrders.list.filters');
  static const Key results = Key('workOrders.list.results');
  static Key row(String id) => Key('workOrders.list.row.$id');
  static Key advance(String id) => Key('workOrders.list.advance.$id');
}

class WorkOrdersListScreen extends ConsumerStatefulWidget {
  const WorkOrdersListScreen({required this.route, super.key});

  final WorkOrdersRoute route;

  @override
  ConsumerState<WorkOrdersListScreen> createState() =>
      _WorkOrdersListScreenState();
}

class _WorkOrdersListScreenState extends ConsumerState<WorkOrdersListScreen> {
  bool _loading = true;
  AppError? _error;
  List<WorkOrderItem> _items = const <WorkOrderItem>[];
  _WorkOrdersFilter _filter = _WorkOrdersFilter.inProgress;
  String? _advancingId;

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
    try {
      final List<WorkOrderItem> items = await ref
          .read(workOrderRepositoryProvider)
          .listRecent(country: ref.read(activeCountryProvider));
      if (!mounted) return;
      setState(() {
        _items = items;
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

  Future<void> _openCreateSheet() async {
    final bool? created = await showCreateWorkOrderSheet(context);
    if (!mounted || created != true) return;
    _showSnack(AppLocalizations.of(context).workOrderSavedMessage);
    unawaited(_load());
  }

  void _open(WorkOrderItem item) => context.push(
        WorkOrderDetailRoute(workOrderId: WorkOrderId(item.id)).location,
      );

  Future<void> _advance(WorkOrderItem item) async {
    if (_advancingId != null) return;
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;

    setState(() => _advancingId = item.id);
    try {
      if (nextWorkOrderStatus(item.status) == kWorkOrderStatusInProgress) {
        final allowed = await ensureWorkOrderApproval(context, ref, item.id);
        if (!allowed || !mounted) return;
      }
      await ref
          .read(workOrderRepositoryProvider)
          .advanceStatus(workspace: workspace, current: item);
      if (!mounted) return;
      _showSnack(AppLocalizations.of(context).workOrderStatusQueuedMessage);
      await _load();
    } on Object {
      if (!mounted) return;
      _showSnack(AppLocalizations.of(context).workOrderSaveFailedMessage);
    } finally {
      if (mounted) setState(() => _advancingId = null);
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  List<WorkOrderItem> get _shown => switch (_filter) {
        _WorkOrdersFilter.all => _items,
        _WorkOrdersFilter.inProgress => _items
            .where(
              (WorkOrderItem item) =>
                  item.status?.trim().toLowerCase() == 'in progress',
            )
            .toList(growable: false),
        _WorkOrdersFilter.completed => _items
            .where(
              (WorkOrderItem item) =>
                  item.status?.trim().toLowerCase() == 'completed',
            )
            .toList(growable: false),
      };

  int get _activeCount => _items
      .where((WorkOrderItem item) => isWorkOrderStatusOpenLike(item.status))
      .length;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    return TpScaffold(
      backFallback: fallback,
      backgroundColor: TpPalette.of(context).surface,
      appBar: TpAppBar(
        title: l10n.workOrdersNavTitle,
        subtitle: _loading ? null : l10n.workOrdersActiveCount(_activeCount),
        backFallback: fallback,
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.filter_alt_outlined),
            tooltip: l10n.workOrdersFilterAll,
            onPressed: () => unawaited(_showFilterSheet(l10n)),
          ),
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: l10n.workOrderNewTitle,
            onPressed: () => unawaited(_openCreateSheet()),
          ),
        ],
      ),
      body: _body(l10n),
    );
  }

  Future<void> _showFilterSheet(AppLocalizations l10n) async {
    final _WorkOrdersFilter? selected =
        await showModalBottomSheet<_WorkOrdersFilter>(
      context: context,
      showDragHandle: true,
      builder: (BuildContext context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            ListTile(
              leading: Icon(
                _filter == _WorkOrdersFilter.all
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_unchecked_rounded,
              ),
              title: Text(l10n.workOrdersFilterAll),
              onTap: () => Navigator.pop(context, _WorkOrdersFilter.all),
            ),
            ListTile(
              leading: Icon(
                _filter == _WorkOrdersFilter.inProgress
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_unchecked_rounded,
              ),
              title: Text(l10n.workOrderAdvanceToInProgress),
              onTap: () => Navigator.pop(context, _WorkOrdersFilter.inProgress),
            ),
            ListTile(
              leading: Icon(
                _filter == _WorkOrdersFilter.completed
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_unchecked_rounded,
              ),
              title: Text(l10n.workOrderAdvanceToCompleted),
              onTap: () => Navigator.pop(context, _WorkOrdersFilter.completed),
            ),
          ],
        ),
      ),
    );
    if (selected != null && mounted) setState(() => _filter = selected);
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();
    if (_error != null) return TpErrorState(error: _error!, onRetry: _load);
    final List<WorkOrderItem> shown = _shown;

    return Column(
      children: <Widget>[
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.md,
            TpSpace.lg,
            TpSpace.sm,
          ),
          child: Row(
            key: WorkOrdersListScreenKeys.filters,
            children: <Widget>[
              ChoiceChip(
                label: Text(l10n.workOrdersFilterAll),
                selected: _filter == _WorkOrdersFilter.all,
                onSelected: (_) =>
                    setState(() => _filter = _WorkOrdersFilter.all),
              ),
              const SizedBox(width: TpSpace.sm),
              ChoiceChip(
                label: Text(l10n.workOrderAdvanceToInProgress),
                selected: _filter == _WorkOrdersFilter.inProgress,
                onSelected: (_) =>
                    setState(() => _filter = _WorkOrdersFilter.inProgress),
              ),
              const SizedBox(width: TpSpace.sm),
              ChoiceChip(
                label: Text(l10n.workOrderAdvanceToCompleted),
                selected: _filter == _WorkOrdersFilter.completed,
                onSelected: (_) =>
                    setState(() => _filter = _WorkOrdersFilter.completed),
              ),
            ],
          ),
        ),
        Expanded(
          child: shown.isEmpty
              ? RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    children: <Widget>[
                      SizedBox(
                        height: MediaQuery.sizeOf(context).height * 0.55,
                        child: TpEmptyState(
                          icon: Icons.build_circle_outlined,
                          title: l10n.workOrdersEmptyTitle,
                          message: l10n.workOrdersEmptyMessage,
                        ),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    key: WorkOrdersListScreenKeys.results,
                    padding: const EdgeInsets.fromLTRB(
                      TpSpace.lg,
                      0,
                      TpSpace.lg,
                      TpSpace.xxl,
                    ),
                    itemCount: shown.length,
                    itemBuilder: (BuildContext context, int index) {
                      final WorkOrderItem item = shown[index];
                      return _WorkOrderRow(
                        item: item,
                        isAdvancing: _advancingId == item.id,
                        onTap: () => _open(item),
                        onAdvance: () => unawaited(_advance(item)),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }
}

AppError _asAppError(BuildContext context, Object error) {
  if (error is AppError) return error;
  if (error is SupabaseFailure) return error.error;
  return AppError(
    kind: AppErrorKind.unknown,
    message: AppLocalizations.of(context).workOrdersLoadErrorMessage,
    technical: error.toString(),
    cause: error,
    isRetryable: true,
  );
}

class _WorkOrderRow extends StatelessWidget {
  const _WorkOrderRow({
    required this.item,
    required this.isAdvancing,
    required this.onTap,
    required this.onAdvance,
  });

  final WorkOrderItem item;
  final bool isAdvancing;
  final VoidCallback onTap;
  final VoidCallback onAdvance;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String? next = nextWorkOrderStatus(item.status);
    final String? priority = item.priority?.trim();
    final WorkOrderTone accentTone = priority?.isNotEmpty == true
        ? workOrderPriorityTone(priority)
        : workOrderStatusTone(item.status);
    final Color accent =
        palette.forStatus(workOrderToneToStatus(accentTone)).base;
    final String title = item.description?.trim().isNotEmpty == true
        ? item.description!.trim()
        : workOrderWorkTypeLabel(l10n, item.workType);

    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Material(
        color: palette.surface,
        borderRadius: BorderRadius.circular(TpRadius.md),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: WorkOrdersListScreenKeys.row(item.id),
          onTap: onTap,
          borderRadius: BorderRadius.circular(TpRadius.md),
          child: Container(
            decoration: BoxDecoration(
              border: BorderDirectional(
                start: BorderSide(color: accent, width: TpBorderWidth.strong),
                top: BorderSide(color: palette.border),
                end: BorderSide(color: palette.border),
                bottom: BorderSide(color: palette.border),
              ),
            ),
            padding: const EdgeInsets.all(TpSpace.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Expanded(
                            child: TpIdentifierText(
                              item.workOrderNo ?? l10n.valueNotMeasured,
                              style: Theme.of(context)
                                  .textTheme
                                  .labelSmall
                                  ?.copyWith(color: palette.textMuted),
                            ),
                          ),
                          WorkOrderStatusChip(
                            status: item.status,
                            isCompact: true,
                          ),
                        ],
                      ),
                      const SizedBox(height: TpSpace.xs),
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                      ),
                      const SizedBox(height: 2),
                      TpIdentifierText(
                        item.assetNo ?? l10n.valueNotMeasured,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: TpSpace.sm),
                      Wrap(
                        spacing: TpSpace.md,
                        runSpacing: TpSpace.xs,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: <Widget>[
                          if (item.site?.trim().isNotEmpty == true)
                            _MetaLine(
                              icon: Icons.location_on_outlined,
                              value: item.site!.trim(),
                            ),
                          if (item.openedAt?.trim().isNotEmpty == true)
                            _MetaLine(
                              icon: Icons.schedule_outlined,
                              value: _formatTimestamp(item.openedAt!) ??
                                  l10n.valueNotMeasured,
                            ),
                          if (priority != null && priority.isNotEmpty)
                            WorkOrderPriorityChip(
                              priority: priority,
                              isCompact: true,
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (next != null) ...<Widget>[
                  const SizedBox(width: TpSpace.sm),
                  _AdvanceButton(
                    key: WorkOrdersListScreenKeys.advance(item.id),
                    label: next == kWorkOrderStatusInProgress
                        ? l10n.workOrderAdvanceToInProgress
                        : l10n.workOrderAdvanceToCompleted,
                    isBusy: isAdvancing,
                    onPressed: onAdvance,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AdvanceButton extends StatelessWidget {
  const _AdvanceButton({
    required this.label,
    required this.isBusy,
    required this.onPressed,
    super.key,
  });

  final String label;
  final bool isBusy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return SizedBox(
      width: TpSizing.minTouchTarget,
      height: TpSizing.minTouchTarget,
      child: InkWell(
        onTap: isBusy ? null : onPressed,
        borderRadius: BorderRadius.circular(TpRadius.md),
        child: Center(
          child: isBusy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Tooltip(
                  message: label,
                  child: Icon(
                    Icons.arrow_forward_ios_rounded,
                    size: TpSizing.iconSm,
                    color: palette.primary,
                  ),
                ),
        ),
      ),
    );
  }
}

class _MetaLine extends StatelessWidget {
  const _MetaLine({required this.icon, required this.value});

  final IconData icon;
  final String value;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 14, color: TpPalette.of(context).textMuted),
          const SizedBox(width: TpSpace.xs),
          Text(value, style: Theme.of(context).textTheme.labelSmall),
        ],
      );
}

String? _formatTimestamp(String iso) {
  final DateTime? parsed = DateTime.tryParse(iso);
  if (parsed == null) return null;
  final DateTime local = parsed.toLocal();
  final String y = local.year.toString().padLeft(4, '0');
  final String m = local.month.toString().padLeft(2, '0');
  final String d = local.day.toString().padLeft(2, '0');
  final String hh = local.hour.toString().padLeft(2, '0');
  final String mm = local.minute.toString().padLeft(2, '0');
  return '$y-$m-$d $hh:$mm';
}
