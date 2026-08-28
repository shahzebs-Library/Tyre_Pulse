/// One live work order, reached independently from a list or notification.
///
/// The light layout follows the approved Work Order mock and the dark layout
/// follows the approved Job Details mock. Only columns already decoded by
/// [WorkOrderItem] are rendered. The existing status advance remains queued
/// through [WorkOrderRepository.advanceStatus] and retains its disclosure.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
import 'package:tyre_pulse/features/work_orders/presentation/widgets/work_order_badges.dart';
import 'package:tyre_pulse/features/work_orders/work_orders_providers.dart';

enum _DetailMenu { refresh }

abstract final class WorkOrderDetailScreenKeys {
  static const Key header = Key('workOrder.detail.header');
  static const Key tabs = Key('workOrder.detail.tabs');
  static const Key lifecycle = Key('workOrder.detail.lifecycle');
  static const Key bottomAction = Key('workOrder.detail.bottomAction');
}

class WorkOrderDetailScreen extends ConsumerStatefulWidget {
  const WorkOrderDetailScreen({required this.route, super.key});

  final WorkOrderDetailRoute route;

  @override
  ConsumerState<WorkOrderDetailScreen> createState() =>
      _WorkOrderDetailScreenState();
}

class _WorkOrderDetailScreenState extends ConsumerState<WorkOrderDetailScreen> {
  bool _loading = true;
  AppError? _error;
  WorkOrderItem? _item;
  bool _advancing = false;

  String get _workOrderId => widget.route.workOrderId.value;

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
      final WorkOrderItem? item =
          await ref.read(workOrderRepositoryProvider).byId(_workOrderId);
      if (!mounted) return;
      setState(() {
        _item = item;
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

  Future<void> _advance() async {
    final WorkOrderItem? item = _item;
    if (item == null || _advancing) return;
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;

    setState(() => _advancing = true);
    try {
      await ref
          .read(workOrderRepositoryProvider)
          .advanceStatus(workspace: workspace, current: item);
      if (!mounted) return;
      await _load();
      if (!mounted) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(content: Text(l10n.workOrderStatusQueuedMessage)),
        );
    } on Object {
      if (!mounted) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(content: Text(l10n.workOrderSaveFailedMessage)),
        );
    } finally {
      if (mounted) setState(() => _advancing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final WorkOrderItem? item = _item;
    final TpPalette palette = TpPalette.of(context);
    final bool isDark = Theme.of(context).brightness == Brightness.dark;

    return DefaultTabController(
      length: 4,
      child: TpScaffold(
        backFallback: fallback,
        backgroundColor: isDark ? palette.background : palette.surface,
        appBar: TpAppBar(
          title: l10n.workOrderDetailTitle,
          backFallback: fallback,
          actions: item == null
              ? null
              : <Widget>[
                  PopupMenuButton<_DetailMenu>(
                    icon: const Icon(Icons.more_vert_rounded),
                    onSelected: (_) => unawaited(_load()),
                    itemBuilder: (BuildContext context) =>
                        <PopupMenuEntry<_DetailMenu>>[
                      PopupMenuItem<_DetailMenu>(
                        value: _DetailMenu.refresh,
                        child: Text(l10n.actionRetry),
                      ),
                    ],
                  ),
                ],
        ),
        body: _body(l10n, item, isDark: isDark),
        bottomNavigationBar: _bottomAction(l10n, item),
      ),
    );
  }

  Widget? _bottomAction(AppLocalizations l10n, WorkOrderItem? item) {
    if (item == null || _loading || _error != null) return null;
    final String? next = nextWorkOrderStatus(item.status);
    if (next == null) return null;
    final TpPalette palette = TpPalette.of(context);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(top: BorderSide(color: palette.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.sm,
            TpSpace.lg,
            TpSpace.sm,
          ),
          child: TpButton.primary(
            key: WorkOrderDetailScreenKeys.bottomAction,
            label: next == kWorkOrderStatusInProgress
                ? l10n.workOrderAdvanceToInProgress
                : l10n.workOrderAdvanceToCompleted,
            icon: Icons.play_arrow_rounded,
            isBusy: _advancing,
            isFullWidth: true,
            onPressed: _advancing ? null : _advance,
          ),
        ),
      ),
    );
  }

  Widget _body(
    AppLocalizations l10n,
    WorkOrderItem? item, {
    required bool isDark,
  }) {
    if (_loading) return const TpLoadingState();
    if (_error != null) return TpErrorState(error: _error!, onRetry: _load);
    if (item == null) {
      return TpEmptyState(
        icon: Icons.help_outline,
        title: l10n.workOrderNotFoundTitle,
        message: l10n.workOrderNotFoundMessage,
      );
    }
    return isDark
        ? _DarkJobBody(item: item, l10n: l10n, onRefresh: _load)
        : _LightWorkOrderBody(item: item, l10n: l10n, onRefresh: _load);
  }
}

class _LightWorkOrderBody extends StatelessWidget {
  const _LightWorkOrderBody({
    required this.item,
    required this.l10n,
    required this.onRefresh,
  });

  final WorkOrderItem item;
  final AppLocalizations l10n;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String workType = workOrderWorkTypeLabel(l10n, item.workType);
    return Column(
      children: <Widget>[
        Padding(
          key: WorkOrderDetailScreenKeys.header,
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.md,
            TpSpace.lg,
            TpSpace.sm,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: WorkOrderStatusChip(
                  status: item.status,
                  isCompact: true,
                ),
              ),
              const SizedBox(height: TpSpace.xs),
              TpIdentifierText(
                item.assetNo ?? l10n.valueNotMeasured,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
              const SizedBox(height: 2),
              Text(
                _display(item.description, l10n),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              if (item.site?.trim().isNotEmpty == true) ...<Widget>[
                const SizedBox(height: TpSpace.xs),
                Text(
                  item.site!.trim(),
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textMuted),
                ),
              ],
              const SizedBox(height: TpSpace.md),
              Divider(height: 1, color: palette.border),
              const SizedBox(height: TpSpace.md),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: _CompactFact(
                      label: l10n.workOrderPriorityLabel,
                      child: item.priority?.trim().isNotEmpty == true
                          ? WorkOrderPriorityChip(
                              priority: item.priority!.trim(),
                              isCompact: true,
                            )
                          : Text(l10n.valueNotMeasured),
                    ),
                  ),
                  const SizedBox(width: TpSpace.md),
                  Expanded(
                    child: _CompactFact(
                      label: l10n.workOrderFieldOpened,
                      child: Text(
                        _formatTimestamp(item.openedAt) ??
                            l10n.valueNotMeasured,
                        textAlign: TextAlign.end,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: TpSpace.sm),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: _CompactFact(
                      label: l10n.workOrderFieldWorkType,
                      child: Text(workType),
                    ),
                  ),
                  const SizedBox(width: TpSpace.md),
                  Expanded(
                    child: _CompactFact(
                      label: l10n.workOrderFieldStarted,
                      child: Text(
                        _formatTimestamp(item.startedAt) ??
                            l10n.valueNotMeasured,
                        textAlign: TextAlign.end,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        TabBar(
          key: WorkOrderDetailScreenKeys.tabs,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          indicatorColor: palette.primary,
          labelColor: palette.primary,
          unselectedLabelColor: palette.textSecondary,
          tabs: <Widget>[
            Tab(text: l10n.workOrderDescriptionLabel),
            Tab(text: l10n.tabChecklists),
            Tab(text: l10n.inspectionNotesLabel),
            Tab(text: l10n.tabHistory),
          ],
        ),
        Expanded(
          child: TabBarView(
            children: <Widget>[
              _DetailTab(item: item, l10n: l10n, onRefresh: onRefresh),
              _NotConfiguredTab(l10n: l10n),
              _NotConfiguredTab(l10n: l10n),
              _HistoryTab(item: item, l10n: l10n, onRefresh: onRefresh),
            ],
          ),
        ),
      ],
    );
  }
}

class _DarkJobBody extends StatelessWidget {
  const _DarkJobBody({
    required this.item,
    required this.l10n,
    required this.onRefresh,
  });

  final WorkOrderItem item;
  final AppLocalizations l10n;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final String workType = workOrderWorkTypeLabel(l10n, item.workType);
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.md,
          TpSpace.md,
          TpSpace.md,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          TpCard(
            margin: const EdgeInsets.only(bottom: TpSpace.xs),
            child: Column(
              key: WorkOrderDetailScreenKeys.header,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: TpIdentifierText(
                        item.workOrderNo ?? l10n.valueNotMeasured,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ),
                    WorkOrderStatusChip(status: item.status, isCompact: true),
                  ],
                ),
                const SizedBox(height: TpSpace.md),
                Row(
                  children: <Widget>[
                    DecoratedBox(
                      decoration: BoxDecoration(
                        color: TpPalette.of(context).surfaceAlt,
                        borderRadius: BorderRadius.circular(TpRadius.sm),
                      ),
                      child: const SizedBox(
                        width: 52,
                        height: 44,
                        child: Icon(Icons.local_shipping_outlined),
                      ),
                    ),
                    const SizedBox(width: TpSpace.sm),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          TpIdentifierText(
                            item.assetNo ?? l10n.valueNotMeasured,
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                          Text(workType),
                          if (item.description?.trim().isNotEmpty == true)
                            Text(
                              item.description!.trim(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          TpCard(
            margin: const EdgeInsets.only(bottom: TpSpace.xs),
            padding: const EdgeInsets.all(TpSpace.md),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: _CompactFact(
                    label: l10n.workOrderFieldSite,
                    child: Text(_display(item.site, l10n)),
                  ),
                ),
                const SizedBox(width: TpSpace.md),
                Expanded(
                  child: _CompactFact(
                    label: l10n.workOrderFieldCountry,
                    child: Text(_display(item.country, l10n)),
                  ),
                ),
              ],
            ),
          ),
          _LifecycleCard(item: item, l10n: l10n),
        ],
      ),
    );
  }
}

class _DetailTab extends StatelessWidget {
  const _DetailTab({
    required this.item,
    required this.l10n,
    required this.onRefresh,
  });

  final WorkOrderItem item;
  final AppLocalizations l10n;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: onRefresh,
        child: ListView(
          padding: const EdgeInsets.all(TpSpace.lg),
          children: <Widget>[
            _SectionLabel(l10n.workOrderFieldDescription),
            const SizedBox(height: TpSpace.sm),
            Text(_display(item.description, l10n)),
            const SizedBox(height: TpSpace.xl),
            _FieldRow(
              label: l10n.workOrderFieldWorkOrderNo,
              value: item.workOrderNo,
            ),
            _FieldRow(
              label: l10n.workOrderFieldWorkType,
              value: workOrderWorkTypeLabel(l10n, item.workType),
            ),
            _FieldRow(label: l10n.workOrderFieldCountry, value: item.country),
          ],
        ),
      );
}

class _HistoryTab extends StatelessWidget {
  const _HistoryTab({
    required this.item,
    required this.l10n,
    required this.onRefresh,
  });

  final WorkOrderItem item;
  final AppLocalizations l10n;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: onRefresh,
        child: ListView(
          padding: const EdgeInsets.all(TpSpace.lg),
          children: <Widget>[
            _LifecycleCard(item: item, l10n: l10n),
          ],
        ),
      );
}

class _NotConfiguredTab extends StatelessWidget {
  const _NotConfiguredTab({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) => TpNotConfiguredState(
        title: l10n.stateNotConfiguredTitle,
        detail: l10n.stateNotConfiguredMessage,
      );
}

class _LifecycleCard extends StatelessWidget {
  const _LifecycleCard({required this.item, required this.l10n});

  final WorkOrderItem item;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final List<(String, String?)> steps = <(String, String?)>[
      (l10n.workOrderFieldOpened, _formatTimestamp(item.openedAt)),
      (l10n.workOrderFieldStarted, _formatTimestamp(item.startedAt)),
      (l10n.workOrderFieldCompleted, _formatTimestamp(item.completedAt)),
    ];
    final int complete = steps.where((step) => step.$2 != null).length;
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      key: WorkOrderDetailScreenKeys.lifecycle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  l10n.tabHistory,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Text('$complete/${steps.length}'),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          LinearProgressIndicator(
            value: complete / steps.length,
            minHeight: 5,
            borderRadius: BorderRadius.circular(TpRadius.pill),
            backgroundColor: palette.surfaceSunken,
          ),
          const SizedBox(height: TpSpace.md),
          for (final (String label, String? value) in steps)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
              child: Row(
                children: <Widget>[
                  Icon(
                    value == null
                        ? Icons.radio_button_unchecked_rounded
                        : Icons.check_circle_rounded,
                    color: value == null ? palette.textMuted : palette.ok.base,
                    size: 20,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(child: Text(label)),
                  const SizedBox(width: TpSpace.sm),
                  Text(
                    value ?? l10n.valueNotMeasured,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _CompactFact extends StatelessWidget {
  const _CompactFact({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: Theme.of(context).textTheme.labelSmall),
          const SizedBox(height: 2),
          DefaultTextStyle.merge(
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
            child: child,
          ),
        ],
      );
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Text(
        label.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: TpPalette.of(context).textSecondary,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.5,
            ),
      );
}

class _FieldRow extends StatelessWidget {
  const _FieldRow({required this.label, required this.value});

  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Container(
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: TpPalette.of(context).border),
        ),
      ),
      padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
      child: Row(
        children: <Widget>[
          Expanded(child: Text(label)),
          const SizedBox(width: TpSpace.md),
          Expanded(
            child: Text(
              _display(value, l10n),
              textAlign: TextAlign.end,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

AppError _asAppError(BuildContext context, Object error) {
  if (error is AppError) return error;
  if (error is SupabaseFailure) return error.error;
  return AppError(
    kind: AppErrorKind.unknown,
    message: AppLocalizations.of(context).workOrderLoadErrorMessage,
    technical: error.toString(),
    cause: error,
    isRetryable: true,
  );
}

String _display(String? value, AppLocalizations l10n) {
  final String text = value?.trim() ?? '';
  return text.isEmpty ? l10n.valueNotMeasured : text;
}

String? _formatTimestamp(String? iso) {
  if (iso == null || iso.isEmpty) return null;
  final DateTime? parsed = DateTime.tryParse(iso);
  if (parsed == null) return null;
  final DateTime local = parsed.toLocal();
  final String y = local.year.toString().padLeft(4, '0');
  final String m = local.month.toString().padLeft(2, '0');
  final String d = local.day.toString().padLeft(2, '0');
  final String hh = local.hour.toString().padLeft(2, '0');
  final String mm = local.minute.toString().padLeft(2, '0');
  return TpDirection.isolateLtr('$y-$m-$d $hh:$mm');
}
