/// Work Orders - the maintenance job card list.
///
/// Ported from `mobile/app/(app)/work-orders.tsx` (`mobile/` is READ-ONLY
/// reference material - see `AGENTS.md`). See `domain/work_order_status
/// .dart`'s own library comment for why this is the ONE "work orders"
/// feature this port builds - `workorders/index.tsx`, which reads
/// `corrective_actions`, is a different, deliberately deferred feature.
///
/// Lists every work order this workspace's country scope can see, newest
/// first, with an Active/All filter matching the reference's own two
/// chips, a "New work order" action that opens
/// [showCreateWorkOrderSheet], and a status-advance action per row
/// (`domain/work_order_status.dart`'s [nextWorkOrderStatus]) that is
/// hidden the moment there is nothing further to advance to - matching the
/// reference's own `{next && mayEdit && (...)}` guard, minus the `mayEdit`
/// half: see the next section.
///
/// # Reaching this screen at all already IS the authorisation to act on it
///
/// The reference's own `mayEdit = canManageWorkOrders(profile?.role)` and
/// the `allowed` its `useModuleGuard('workorders')` produces are NOT the
/// same check, and that is a real, confirmed defect in the reference, not
/// a deliberate two-tier design: `canManageWorkOrders` tests
/// `profile?.role` against the module's registry ROLE DEFAULT ONLY
/// (`mobile/lib/permissions.ts`'s `moduleAllowedByRole`), while
/// `useModuleGuard` resolves through `resolveGuardedAccess`, which ALSO
/// honours a per-user GRANT. Since `workorders`' role default is an empty
/// list (admin-only; see `M('workorders', ..., [])` in the reference's own
/// `permissions.ts`), a person granted this module individually - exactly
/// the mechanism this whole permission layer exists to support - would see
/// `allowed === true` and `mayEdit === false`: the screen, with no way to
/// ever create or advance anything on it.
///
/// This port's own permission layer
/// (`core/permissions/access_resolver.dart`) makes exactly one decision
/// per module - [resolveModuleAccess] - precisely so a widget never tests
/// a role string a second time with a different, narrower rule ("A widget
/// must never test a role string. `if (role == admin)` belongs here and
/// nowhere else", that file's own library comment). [ModuleKey.workorders]
/// is `ModuleDef.adminOnly` here too (`core/permissions/module_registry
/// .dart`, matching the reference's empty role list exactly), and both
/// [TpRouteId.workOrders] and [TpRouteId.workOrderDetail] are
/// `ModuleGuarded(RouteModule.workorders)` in `app/router/route_access
/// .dart` - so by the time [WorkOrdersListScreen] is ever built at all,
/// the router's own `_GuardedScreen` has already resolved that SAME
/// decision and admitted the user. There is no second, narrower gate left
/// to apply, and inventing one here - by re-reading a raw role, ignoring
/// the grant the router already honoured - would reproduce the reference's
/// own bug rather than port the feature it was trying to build. So this
/// screen shows the "New work order" action and every row's advance
/// action unconditionally: reaching the screen already answers "may I act
/// here" the same way it answers "may I view this".
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
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_item.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_repository.dart';
import 'package:tyre_pulse/features/work_orders/domain/work_order_status.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/create_work_order_sheet.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/work_order_badges.dart';
import 'package:tyre_pulse/features/work_orders/work_orders_providers.dart';

enum _WorkOrdersFilter { active, all }

class WorkOrdersListScreen extends ConsumerStatefulWidget {
  const WorkOrdersListScreen({required this.route, super.key});

  final WorkOrdersRoute route;

  @override
  ConsumerState<WorkOrdersListScreen> createState() =>
      _WorkOrdersListScreenState();
}

class _WorkOrdersListScreenState extends ConsumerState<WorkOrdersListScreen> {
  bool _loading = true;
  bool _refreshing = false;
  AppError? _error;
  List<WorkOrderItem> _items = const <WorkOrderItem>[];
  _WorkOrdersFilter _filter = _WorkOrdersFilter.active;
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
    final String? country = ref.read(activeCountryProvider);
    try {
      final List<WorkOrderItem> items = await ref
          .read(workOrderRepositoryProvider)
          .listRecent(country: country);
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

  Future<void> _refresh() async {
    setState(() => _refreshing = true);
    await _load();
    if (mounted) setState(() => _refreshing = false);
  }

  Future<void> _openCreateSheet() async {
    final bool? created = await showCreateWorkOrderSheet(context);
    if (!mounted || created != true) return;
    _showSnack(AppLocalizations.of(context).workOrderSavedMessage);
    unawaited(_load());
  }

  void _open(WorkOrderItem item) {
    context.push(
      WorkOrderDetailRoute(workOrderId: WorkOrderId(item.id)).location,
    );
  }

  Future<void> _advance(WorkOrderItem item) async {
    if (_advancingId != null) return;
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) return;

    setState(() => _advancingId = item.id);
    try {
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

  /// Mirrors `WashingScreen._showSnack`'s own shape.
  void _showSnack(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  List<WorkOrderItem> get _shown => switch (_filter) {
    _WorkOrdersFilter.all => _items,
    _WorkOrdersFilter.active =>
      _items
          .where((WorkOrderItem w) => isWorkOrderStatusOpenLike(w.status))
          .toList(growable: false),
  };

  int get _activeCount => _items
      .where((WorkOrderItem w) => isWorkOrderStatusOpenLike(w.status))
      .length;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.workOrdersNavTitle,
        subtitle: _loading ? null : l10n.workOrdersActiveCount(_activeCount),
        backFallback: fallback,
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: l10n.workOrderNewTitle,
            onPressed: () => unawaited(_openCreateSheet()),
          ),
        ],
      ),
      body: _body(l10n),
    );
  }

  Widget _body(AppLocalizations l10n) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      return TpErrorState(error: _error!, onRetry: _load);
    }

    final List<WorkOrderItem> shown = _shown;

    return Column(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.md,
            TpSpace.lg,
            TpSpace.sm,
          ),
          child: Row(
            children: <Widget>[
              ChoiceChip(
                label: Text(l10n.workOrdersFilterActive),
                selected: _filter == _WorkOrdersFilter.active,
                onSelected: (_) =>
                    setState(() => _filter = _WorkOrdersFilter.active),
              ),
              const SizedBox(width: TpSpace.sm),
              ChoiceChip(
                label: Text(l10n.workOrdersFilterAll),
                selected: _filter == _WorkOrdersFilter.all,
                onSelected: (_) =>
                    setState(() => _filter = _WorkOrdersFilter.all),
              ),
            ],
          ),
        ),
        Expanded(
          child: shown.isEmpty
              ? RefreshIndicator(
                  onRefresh: _refresh,
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
                  onRefresh: _refresh,
                  child: ListView.builder(
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

/// Mirrors `inspection_approvals_queue_screen.dart`'s own private
/// `_asAppError`: any [AppError]/[SupabaseFailure] carries a message
/// already safe to show; anything else falls back to a translated generic
/// sentence rather than a raw driver message.
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
    final bool isRtl = TpDirection.isRtl(context);
    final TextAlign textAlign = isRtl ? TextAlign.right : TextAlign.left;
    final String? next = nextWorkOrderStatus(item.status);
    final String? priority = item.priority?.trim();

    final List<String> metaParts = <String>[
      workOrderWorkTypeLabel(l10n, item.workType),
      if (item.site != null && item.site!.trim().isNotEmpty) item.site!,
    ];

    return TpCard(
      onTap: onTap,
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    Flexible(
                      child: TpIdentifierText(
                        item.assetNo ?? l10n.valueNotMeasured,
                        style: Theme.of(context).textTheme.titleSmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (item.workOrderNo != null) ...<Widget>[
                      const SizedBox(width: TpSpace.sm),
                      TpIdentifierText(
                        item.workOrderNo!,
                        style: Theme.of(context).textTheme.labelSmall
                            ?.copyWith(color: palette.textMuted),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  metaParts.join(' · '),
                  textAlign: textAlign,
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: palette.textSecondary),
                ),
                if (item.description != null &&
                    item.description!.trim().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      item.description!,
                      textAlign: textAlign,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall
                          ?.copyWith(color: palette.textMuted),
                    ),
                  ),
                const SizedBox(height: TpSpace.xs),
                Wrap(
                  spacing: TpSpace.xs,
                  children: <Widget>[
                    WorkOrderStatusChip(status: item.status, isCompact: true),
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
              label: next == kWorkOrderStatusInProgress
                  ? l10n.workOrderAdvanceToInProgress
                  : l10n.workOrderAdvanceToCompleted,
              isBusy: isAdvancing,
              onPressed: onAdvance,
            ),
          ],
        ],
      ),
    );
  }
}

class _AdvanceButton extends StatelessWidget {
  const _AdvanceButton({
    required this.label,
    required this.isBusy,
    required this.onPressed,
  });

  final String label;
  final bool isBusy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return SizedBox(
      width: 76,
      child: InkWell(
        onTap: isBusy ? null : onPressed,
        borderRadius: BorderRadius.circular(TpRadius.md),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (isBusy)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                Icon(
                  Icons.arrow_forward_ios_rounded,
                  size: TpSizing.iconSm,
                  color: palette.primary,
                ),
              const SizedBox(height: 2),
              Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall
                    ?.copyWith(color: palette.primaryDark),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
