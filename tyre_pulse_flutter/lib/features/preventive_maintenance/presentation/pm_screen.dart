library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/maintenance_work_order.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';
import 'package:tyre_pulse/features/preventive_maintenance/pm_providers.dart';
import 'package:tyre_pulse/features/preventive_maintenance/presentation/pm_copy.dart';
import 'package:tyre_pulse/features/work_orders/domain/work_order_status.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/create_work_order_sheet.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/work_order_badges.dart';

class PreventiveMaintenanceScreen extends ConsumerStatefulWidget {
  const PreventiveMaintenanceScreen({required this.route, super.key});
  final PreventiveMaintenanceRoute route;

  @override
  ConsumerState<PreventiveMaintenanceScreen> createState() =>
      _PreventiveMaintenanceScreenState();
}

class _PreventiveMaintenanceScreenState
    extends ConsumerState<PreventiveMaintenanceScreen> {
  bool dueOnly = true;

  @override
  Widget build(BuildContext context) {
    final PmCopy copy = PmCopy.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    // The bell badge is driven by the real unread inbox. It is shown only
    // when the inbox has actually been read AND holds unread rows: a loading
    // or failed inbox is not "you have mail", and zero is not a dot.
    final int unread = switch (ref.watch(unreadNotificationsCountProvider)) {
      AsyncData<int>(:final int value) => value,
      _ => 0,
    };
    return TpScaffold(
      backFallback: fallback,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: TpPalette.of(context).surface,
        surfaceTintColor: Colors.transparent,
        titleSpacing: TpSpace.lg,
        title: const TpBrandLockup(),
        actions: <Widget>[
          IconButton(
            key: const Key('pm.notifications'),
            tooltip: MaterialLocalizations.of(context).showMenuTooltip,
            onPressed: () => context.push(const NotificationsRoute().location),
            icon: Badge(
              key: const Key('pm.notificationsBadge'),
              isLabelVisible: unread > 0,
              label: Text(unread > 99 ? '99+' : '$unread'),
              child: const Icon(Icons.notifications_none_rounded),
            ),
          ),
          const SizedBox(width: TpSpace.sm),
        ],
      ),
      body: _content(copy),
    );
  }

  void _retryAll() {
    ref
      ..invalidate(activePmPlansProvider)
      ..invalidate(openBreakdownsCountProvider)
      ..invalidate(activeWorkOrdersCountProvider)
      ..invalidate(maintenanceQueueWorkOrdersProvider);
  }

  Widget _content(PmCopy copy) {
    final DateTime now = DateTime.now();
    final AsyncValue<List<PmPlan>> planState = ref.watch(
      activePmPlansProvider,
    );
    final AsyncValue<List<MaintenanceWorkOrder>> orderState = ref.watch(
      maintenanceQueueWorkOrdersProvider,
    );
    final bool plansFailed = planState.hasError && !planState.isLoading;
    final bool ordersFailed = orderState.hasError && !orderState.isLoading;
    final List<PmPlan> plans =
        plansFailed ? const <PmPlan>[] : planState.value ?? const <PmPlan>[];
    final List<MaintenanceWorkOrder> orders = ordersFailed
        ? const <MaintenanceWorkOrder>[]
        : orderState.value ?? const <MaintenanceWorkOrder>[];
    final bool queueLoading = (!planState.hasValue && planState.isLoading) ||
        (!orderState.hasValue && orderState.isLoading);
    final AsyncValue<int> pmDueCount = planState.whenData(
      (List<PmPlan> value) => value
          .where(
            (PmPlan plan) => <PmDueBand>{
              PmDueBand.overdue,
              PmDueBand.dueSoon,
            }.contains(plan.dueBand(now)),
          )
          .length,
    );
    final AsyncValue<int> overdueCount = planState.whenData(
      (List<PmPlan> value) => value
          .where((PmPlan plan) => plan.dueBand(now) == PmDueBand.overdue)
          .length,
    );
    final List<PmPlan> visible = dueOnly
        ? plans
            .where(
              (PmPlan plan) => <PmDueBand>{
                PmDueBand.overdue,
                PmDueBand.dueSoon,
              }.contains(plan.dueBand(now)),
            )
            .toList(growable: false)
        : plans;
    final bool canWorkOrders = ref.watch(
      canAccessModuleProvider(ModuleKey.workorders),
    );
    final bool canInspect = ref.watch(
      canAccessModuleProvider(ModuleKey.inspect),
    );
    final bool canStock = ref.watch(canAccessModuleProvider(ModuleKey.stock));
    final bool canTyres = ref.watch(canAccessModuleProvider(ModuleKey.records));
    final TpPalette palette = TpPalette.of(context);
    final List<MaintenanceQueueEntry> queue = buildMaintenanceQueue(
      workOrders: orders,
      plans: visible,
      now: now,
    );

    return RefreshIndicator(
      onRefresh: () async {
        _retryAll();
        // A failed source renders its own error row; the pull itself must
        // still finish.
        await Future.wait<Object?>(<Future<Object?>>[
          ref.read(activePmPlansProvider.future).catchError((Object _) {
            return const <PmPlan>[];
          }),
          ref
              .read(maintenanceQueueWorkOrdersProvider.future)
              .catchError((Object _) {
            return const <MaintenanceWorkOrder>[];
          }),
        ]);
      },
      child: ListView(
        key: const Key('pm.list'),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      copy('title'),
                      style:
                          Theme.of(context).textTheme.headlineSmall?.copyWith(
                                fontWeight: FontWeight.w900,
                                letterSpacing: -0.4,
                              ),
                    ),
                    const SizedBox(height: TpSpace.xs),
                    Text(
                      copy('subtitle'),
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(color: palette.textSecondary),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: TpSpace.md),
              _PmInitialsAvatar(
                fullName: ref.watch(workspaceContextProvider)?.fullName,
              ),
            ],
          ),
          const SizedBox(height: TpSpace.lg),
          if (canWorkOrders) ...<Widget>[
            DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(TpRadius.md),
                boxShadow: palette.brightness == Brightness.light
                    ? <BoxShadow>[
                        BoxShadow(
                          color: palette.primary.withValues(alpha: 0.26),
                          blurRadius: 18,
                          offset: const Offset(0, 8),
                        ),
                      ]
                    : null,
              ),
              child: SizedBox(
                height: 58,
                child: FilledButton(
                  key: const Key('pm.createWorkOrder'),
                  onPressed: () => unawaited(_createWorkOrder()),
                  style: FilledButton.styleFrom(
                    backgroundColor: palette.primary,
                    foregroundColor: palette.onPrimary,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(TpRadius.md),
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: palette.onPrimary,
                          shape: BoxShape.circle,
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(4),
                          child: Icon(
                            Icons.add_rounded,
                            color: palette.primary,
                            size: 24,
                          ),
                        ),
                      ),
                      const SizedBox(width: TpSpace.md),
                      Flexible(
                        child: Text(
                          copy('createWorkOrder'),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style:
                              Theme.of(context).textTheme.titleMedium?.copyWith(
                                    color: palette.onPrimary,
                                    fontWeight: FontWeight.w800,
                                  ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: TpSpace.xl),
          ],
          IntrinsicHeight(
            child: Row(
              key: const Key('pm.kpis'),
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(
                  child: _PmMetric(
                    metricKey: const Key('pm.kpi.pmDue'),
                    value: pmDueCount,
                    label: copy('pmDue'),
                    icon: Icons.handyman_outlined,
                    status: TpStatus.warning,
                    retryLabel: copy('countFailed'),
                    onRetry: () => ref.invalidate(activePmPlansProvider),
                  ),
                ),
                const _PmMetricDivider(),
                Expanded(
                  child: _PmMetric(
                    metricKey: const Key('pm.kpi.breakdowns'),
                    value: ref.watch(openBreakdownsCountProvider),
                    label: copy('openBreakdowns'),
                    icon: Icons.warning_rounded,
                    status: TpStatus.critical,
                    retryLabel: copy('countFailed'),
                    onRetry: () => ref.invalidate(openBreakdownsCountProvider),
                  ),
                ),
                const _PmMetricDivider(),
                Expanded(
                  child: _PmMetric(
                    metricKey: const Key('pm.kpi.activeWorkOrders'),
                    value: ref.watch(activeWorkOrdersCountProvider),
                    label: copy('activeWorkOrders'),
                    icon: Icons.assignment_outlined,
                    status: TpStatus.info,
                    retryLabel: copy('countFailed'),
                    onRetry: () =>
                        ref.invalidate(activeWorkOrdersCountProvider),
                  ),
                ),
                const _PmMetricDivider(),
                Expanded(
                  child: _PmMetric(
                    metricKey: const Key('pm.kpi.overdue'),
                    value: overdueCount,
                    label: copy('overdue'),
                    icon: Icons.event_busy_rounded,
                    status: TpStatus.critical,
                    retryLabel: copy('countFailed'),
                    onRetry: () => ref.invalidate(activePmPlansProvider),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          const _SectionDivider(),
          const SizedBox(height: TpSpace.sm),
          _SectionHeading(
            title: copy('priorityQueue'),
            action: copy('viewAll'),
            onAction: canWorkOrders
                ? () => context.push(const WorkOrdersRoute().location)
                : null,
          ),
          // A quiet filter, not a control that competes with the queue. The
          // PM schedule quick-access tile flips it to "All plans".
          _QuietFilter(
            dueLabel: copy('due'),
            allLabel: copy('all'),
            dueOnly: dueOnly,
            onChanged: (bool value) => setState(() => dueOnly = value),
          ),
          const _SectionDivider(),
          if (queueLoading)
            const _QueueLoading()
          else ...<Widget>[
            if (ordersFailed)
              _QueueError(
                key: const Key('pm.queue.workOrdersError'),
                message: copy('woLoadFailed'),
                retryLabel: copy('retry'),
                onRetry: () =>
                    ref.invalidate(maintenanceQueueWorkOrdersProvider),
              ),
            if (plansFailed)
              _QueueError(
                key: const Key('pm.queue.plansError'),
                message: copy('loadFailed'),
                retryLabel: copy('retry'),
                onRetry: () => ref.invalidate(activePmPlansProvider),
              ),
            if (queue.isEmpty && !ordersFailed && !plansFailed)
              SizedBox(
                height: 220,
                child: TpEmptyState(
                  icon: Icons.build_circle_outlined,
                  title: copy('queueEmpty'),
                  message: dueOnly ? copy('emptyDue') : copy('emptyAll'),
                ),
              ),
            for (int index = 0; index < queue.length; index++)
              switch (queue[index]) {
                WorkOrderQueueEntry(:final MaintenanceWorkOrder workOrder) =>
                  _WorkOrderRow(
                    order: workOrder,
                    now: now,
                    copy: copy,
                    showDivider: index < queue.length - 1,
                    onOpen: canWorkOrders
                        ? () => context.push(
                              WorkOrderDetailRoute(
                                workOrderId: WorkOrderId(workOrder.id),
                              ).location,
                            )
                        : null,
                  ),
                PmPlanQueueEntry(:final PmPlan plan) => _PmPlanRow(
                    plan: plan,
                    now: now,
                    copy: copy,
                    showDivider: index < queue.length - 1,
                    onRecord: () => unawaited(_record(plan, copy)),
                  ),
              },
          ],
          const _SectionDivider(),
          if (canWorkOrders) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Center(
              child: TextButton.icon(
                key: const Key('pm.allWorkOrders'),
                onPressed: () => context.push(const WorkOrdersRoute().location),
                iconAlignment: IconAlignment.end,
                style: TextButton.styleFrom(foregroundColor: palette.primary),
                // chevron_right_rounded sets matchTextDirection, so Flutter
                // mirrors it under RTL on its own.
                icon: const Icon(Icons.chevron_right_rounded),
                label: Text(
                  copy('allWorkOrders'),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            ),
            const SizedBox(height: TpSpace.xs),
            const _SectionDivider(),
          ],
          const SizedBox(height: TpSpace.lg),
          Text(
            copy('quickAccess'),
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: _QuickAccessTile(
                  icon: Icons.assignment,
                  tone: palette.ok,
                  label: copy('workOrders'),
                  hint: copy('workOrdersHint'),
                  onTap: canWorkOrders
                      ? () => context.push(const WorkOrdersRoute().location)
                      : null,
                ),
              ),
              const SizedBox(width: TpSpace.xs),
              Expanded(
                child: _QuickAccessTile(
                  icon: Icons.calendar_month,
                  tone: palette.info,
                  label: copy('pmSchedule'),
                  hint: copy('pmScheduleHint'),
                  onTap: () => setState(() => dueOnly = false),
                ),
              ),
              const SizedBox(width: TpSpace.xs),
              Expanded(
                child: _QuickAccessTile(
                  icon: Icons.verified_user,
                  tone: palette.unknown,
                  label: copy('inspections'),
                  hint: copy('inspectionsHint'),
                  onTap: canInspect
                      ? () => context.push(const NewInspectionRoute().location)
                      : null,
                ),
              ),
              const SizedBox(width: TpSpace.xs),
              Expanded(
                child: _QuickAccessTile(
                  icon: Icons.inventory_2,
                  tone: palette.warning,
                  label: copy('parts'),
                  hint: copy('partsHint'),
                  onTap: canStock
                      ? () => context.push(const StockCountRoute().location)
                      : null,
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          _TyresRow(
            label: copy('tyres'),
            hint: copy('tyresHint'),
            onTap: canTyres
                ? () => context.push(const TyreRecordsRoute().location)
                : null,
          ),
        ],
      ),
    );
  }

  Future<void> _createWorkOrder() async {
    await showCreateWorkOrderSheet(context);
  }

  Future<void> _record(PmPlan plan, PmCopy copy) async {
    final bool? saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (BuildContext context) =>
          _RecordServiceSheet(plan: plan, copy: copy),
    );
    if (saved == true) ref.invalidate(activePmPlansProvider);
  }
}

/// One KPI tile. Its number comes from one source only: a count that is
/// still loading shows a spinner, a count that failed shows "-" (never 0,
/// which would read as a real measurement) and retries on tap.
class _PmMetric extends StatelessWidget {
  const _PmMetric({
    required this.metricKey,
    required this.value,
    required this.label,
    required this.icon,
    required this.status,
    required this.retryLabel,
    required this.onRetry,
  });

  final Key metricKey;
  final AsyncValue<int> value;
  final String label;
  final IconData icon;
  final TpStatus status;
  final String retryLabel;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(status);
    final bool failed = value.hasError && !value.isLoading;
    final int? count = failed ? null : value.value;
    final TextStyle? numberStyle =
        Theme.of(context).textTheme.headlineMedium?.copyWith(
              color: failed ? TpPalette.of(context).textMuted : colors.base,
              fontWeight: FontWeight.w900,
              height: 1.1,
            );
    final Widget number = failed
        ? Text('-', key: const Key('pm.kpi.unavailable'), style: numberStyle)
        : count == null
            ? SizedBox(
                height: 30,
                child: Center(
                  child: SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.4,
                      color: colors.base,
                    ),
                  ),
                ),
              )
            : Text('$count', maxLines: 1, style: numberStyle);
    final Widget tile = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          DecoratedBox(
            decoration: BoxDecoration(
              color: colors.soft,
              shape: BoxShape.circle,
            ),
            child: SizedBox(
              width: 52,
              height: 52,
              child: Icon(icon, color: colors.base, size: 28),
            ),
          ),
          const SizedBox(height: TpSpace.xs),
          FittedBox(fit: BoxFit.scaleDown, child: number),
          const SizedBox(height: 2),
          // Two short lines at most, balanced and centred, so "Active plans"
          // or an Arabic label never breaks mid-word into a ragged stack.
          Text(
            label,
            maxLines: 2,
            softWrap: true,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .labelMedium
                ?.copyWith(height: 1.15, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
    if (!failed) return KeyedSubtree(key: metricKey, child: tile);
    return Tooltip(
      key: metricKey,
      message: retryLabel,
      child: InkWell(
        onTap: onRetry,
        borderRadius: BorderRadius.circular(TpRadius.md),
        child: Semantics(button: true, label: retryLabel, child: tile),
      ),
    );
  }
}

class _PmMetricDivider extends StatelessWidget {
  const _PmMetricDivider();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
        child: SizedBox(
          width: 1,
          child: ColoredBox(color: TpPalette.of(context).border),
        ),
      );
}

/// A full-bleed hairline between sections, as in the mock.
class _SectionDivider extends StatelessWidget {
  const _SectionDivider();

  @override
  Widget build(BuildContext context) =>
      Divider(height: 1, thickness: 1, color: TpPalette.of(context).border);
}

/// The signed-in user's initials beside the page title. Falls back to a
/// person glyph when the profile carries no usable name - never invented
/// letters.
class _PmInitialsAvatar extends StatelessWidget {
  const _PmInitialsAvatar({required this.fullName});

  final String? fullName;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String? initials = pmInitials(fullName);
    return Container(
      key: const Key('pm.avatar'),
      width: 48,
      height: 48,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: palette.primary,
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: initials == null
          ? Icon(Icons.person_outline_rounded, color: palette.onPrimary)
          : Text(
              initials,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: palette.onPrimary,
                    fontWeight: FontWeight.w800,
                  ),
            ),
    );
  }
}

/// Up to two initials from [fullName]; null when there is no usable name.
@visibleForTesting
String? pmInitials(String? fullName) {
  final List<String> words = (fullName ?? '')
      .trim()
      .split(RegExp(r'\s+'))
      .where((String word) => word.isNotEmpty)
      .toList(growable: false);
  if (words.isEmpty) return null;
  final String first = words.first.characters.first;
  final String last = words.length > 1 ? words.last.characters.first : '';
  return '$first$last'.toUpperCase();
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({
    required this.title,
    required this.action,
    required this.onAction,
  });

  final String title;
  final String action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      children: <Widget>[
        Expanded(
          child: Text(
            title,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w900),
          ),
        ),
        if (onAction != null)
          TextButton.icon(
            onPressed: onAction,
            iconAlignment: IconAlignment.end,
            style: TextButton.styleFrom(foregroundColor: palette.primary),
            icon: const Icon(Icons.chevron_right_rounded),
            label: Text(
              action,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
      ],
    );
  }
}

/// Two text toggles ("Due now" / "All plans") styled as a quiet filter rather
/// than a segmented control. The selected one is bold and green.
class _QuietFilter extends StatelessWidget {
  const _QuietFilter({
    required this.dueLabel,
    required this.allLabel,
    required this.dueOnly,
    required this.onChanged,
  });

  final String dueLabel;
  final String allLabel;
  final bool dueOnly;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: TpSpace.xs),
        child: Row(
          children: <Widget>[
            Icon(
              Icons.filter_list_rounded,
              size: TpSizing.iconSm,
              color: TpPalette.of(context).textMuted,
            ),
            const SizedBox(width: TpSpace.xs),
            _QuietFilterOption(
              label: dueLabel,
              selected: dueOnly,
              onTap: () => onChanged(true),
            ),
            const SizedBox(width: TpSpace.sm),
            _QuietFilterOption(
              label: allLabel,
              selected: !dueOnly,
              onTap: () => onChanged(false),
            ),
          ],
        ),
      );
}

class _QuietFilterOption extends StatelessWidget {
  const _QuietFilterOption({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      button: true,
      selected: selected,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(TpRadius.sm),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 40),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: TpSpace.xs),
            child: Center(
              widthFactor: 1,
              child: Text(
                label,
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: selected ? palette.primary : palette.textSecondary,
                      fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
                    ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _QuickAccessTile extends StatelessWidget {
  const _QuickAccessTile({
    required this.icon,
    required this.tone,
    required this.label,
    required this.hint,
    required this.onTap,
  });

  final IconData icon;
  final TpStatusColors tone;
  final String label;
  final String hint;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      button: onTap != null,
      enabled: onTap != null,
      child: Material(
        color: onTap == null ? palette.surface : tone.soft,
        shape: RoundedRectangleBorder(
          side: BorderSide(
            color: onTap == null
                ? palette.border
                : tone.base.withValues(alpha: 0.25),
          ),
          borderRadius: BorderRadius.circular(TpRadius.md),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            height: 128,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: TpSpace.xs,
                vertical: TpSpace.sm,
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: onTap == null ? palette.surfaceSunken : tone.base,
                      borderRadius: BorderRadius.circular(TpRadius.md),
                      boxShadow: onTap == null ||
                              palette.brightness != Brightness.light
                          ? null
                          : <BoxShadow>[
                              BoxShadow(
                                color: tone.base.withValues(alpha: 0.3),
                                blurRadius: 8,
                                offset: const Offset(0, 3),
                              ),
                            ],
                    ),
                    alignment: Alignment.center,
                    child: Icon(
                      icon,
                      color: onTap == null ? palette.textMuted : tone.onBase,
                      size: 24,
                    ),
                  ),
                  const SizedBox(height: TpSpace.sm),
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color:
                              onTap == null ? palette.textMuted : palette.text,
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    hint,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: palette.textMuted, height: 1.1),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The wide tyres entry under the quick-access grid: a filled brand badge on
/// a tinted surface, matching the mock's full-width "Tyres" card.
class _TyresRow extends StatelessWidget {
  const _TyresRow({
    required this.label,
    required this.hint,
    required this.onTap,
  });

  final String label;
  final String hint;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final bool enabled = onTap != null;
    return Semantics(
      button: enabled,
      enabled: enabled,
      child: Material(
        color: palette.surfaceAlt,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: palette.border),
          borderRadius: BorderRadius.circular(TpRadius.md),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 68),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: TpSpace.md,
                vertical: TpSpace.sm,
              ),
              child: Row(
                children: <Widget>[
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: enabled ? palette.primary : palette.surfaceSunken,
                      shape: BoxShape.circle,
                    ),
                    alignment: Alignment.center,
                    child: Icon(
                      Icons.tire_repair_rounded,
                      color: enabled ? palette.onPrimary : palette.textMuted,
                    ),
                  ),
                  const SizedBox(width: TpSpace.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(
                          label,
                          style: text.titleSmall?.copyWith(
                            color: enabled ? palette.text : palette.textMuted,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          hint,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: text.bodySmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (enabled)
                    Icon(
                      Icons.chevron_right_rounded,
                      color: palette.textSecondary,
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One compact queue row: photo, asset number, type/plan, site, the due
/// status chip and due date. Tapping the row records a service; the trailing
/// check is the same action for users who look for an explicit button.
///
/// No technician is shown: `pm_programs` carries no assignee column, so the
/// mock's technician avatar has no real data behind it.
class _PmPlanRow extends StatelessWidget {
  const _PmPlanRow({
    required this.plan,
    required this.now,
    required this.copy,
    required this.showDivider,
    required this.onRecord,
  });
  final PmPlan plan;
  final DateTime now;
  final PmCopy copy;
  final bool showDivider;
  final VoidCallback onRecord;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final PmDueBand band = plan.dueBand(now);
    final int? days = plan.daysToDue(now);
    final TpStatus status = switch (band) {
      PmDueBand.overdue => TpStatus.critical,
      PmDueBand.dueSoon => TpStatus.warning,
      PmDueBand.ok => TpStatus.ok,
      PmDueBand.none => TpStatus.neutral,
    };
    final String title = plan.assetNo ?? plan.name ?? copy('plan');
    // The category is carried by its own chip below, so the detail line is
    // the plan name when the asset number is already the title.
    final String detail =
        (plan.assetNo != null && plan.name != null) ? plan.name! : '';
    final DateTime? due = plan.nextDue;
    final String dueText = <String>[
      if (due != null)
        MaterialLocalizations.of(context).formatShortDate(due.toLocal()),
      if (plan.nextDueMeter != null && plan.meterUnit.isNotEmpty)
        '${plan.nextDueMeter} ${plan.meterUnit}',
    ].join(' · ');
    final VehicleAsset asset = VehicleAsset(
      id: plan.id,
      assetNo: plan.assetNo,
      vehicleType: plan.assetCategory,
      site: plan.site,
      status: plan.status,
    );
    final String? photo = vehiclePhotoAsset(asset);
    final TpStatusColors tone = palette.forStatus(status);
    final String dueLabel = switch (band) {
      PmDueBand.overdue => '${days!.abs()} ${copy('daysOverdue')}',
      PmDueBand.dueSoon => '$days ${copy('daysLeft')}',
      PmDueBand.ok => '$days ${copy('daysLeft')}',
      PmDueBand.none => copy('noDate'),
    };
    final IconData dueIcon = switch (band) {
      PmDueBand.overdue => Icons.schedule_rounded,
      PmDueBand.dueSoon => Icons.event_rounded,
      PmDueBand.ok => Icons.event_available_rounded,
      PmDueBand.none => Icons.event_busy_rounded,
    };
    final String? bandChip = switch (band) {
      PmDueBand.overdue => copy('overdue'),
      PmDueBand.dueSoon => copy('dueSoon'),
      PmDueBand.ok || PmDueBand.none => null,
    };
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        InkWell(
          key: Key('pm.plan.${plan.id}'),
          onTap: onRecord,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _QueueThumbnail(asset: asset, photo: photo),
                const SizedBox(width: TpSpace.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: text.titleMedium?.copyWith(
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          const SizedBox(width: TpSpace.xs),
                          Icon(dueIcon, size: 16, color: tone.base),
                          const SizedBox(width: 3),
                          Flexible(
                            child: Text(
                              dueLabel,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: text.labelMedium?.copyWith(
                                color: tone.base,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                      if (detail.isNotEmpty)
                        Text(
                          detail,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: text.bodySmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                        ),
                      if (plan.site != null || dueText.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Row(
                            children: <Widget>[
                              if (plan.site != null) ...<Widget>[
                                Icon(
                                  Icons.location_on_outlined,
                                  size: 14,
                                  color: palette.textMuted,
                                ),
                                const SizedBox(width: 2),
                                Flexible(
                                  child: Text(
                                    plan.site!,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: text.bodySmall?.copyWith(
                                      color: palette.textSecondary,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: TpSpace.sm),
                              ],
                              if (dueText.isNotEmpty)
                                Flexible(
                                  flex: 2,
                                  child: Text(
                                    dueText,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: text.bodySmall?.copyWith(
                                      color: palette.textMuted,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      const SizedBox(height: TpSpace.sm),
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: Wrap(
                              spacing: TpSpace.xs,
                              runSpacing: TpSpace.xs,
                              children: <Widget>[
                                // The row type tag, as in the mock: this
                                // row is preventive maintenance, not a job
                                // card.
                                _PmChip(
                                  key: Key('pm.plan.${plan.id}.tag'),
                                  label: copy('pmDue'),
                                  tone: band == PmDueBand.overdue
                                      ? palette.critical
                                      : palette.warning,
                                ),
                                if (bandChip != null &&
                                    band != PmDueBand.overdue)
                                  _PmChip(label: bandChip, tone: tone),
                                if (plan.priority != null)
                                  _PmChip(
                                    label: _capitalised(plan.priority!),
                                    tone: palette.forStatus(
                                      workOrderToneToStatus(
                                        workOrderPriorityTone(plan.priority),
                                      ),
                                    ),
                                  )
                                else if (plan.assetCategory != null)
                                  _PmChip(
                                    label: plan.assetCategory!,
                                    tone: palette.info,
                                  ),
                              ],
                            ),
                          ),
                          SizedBox.square(
                            dimension: 40,
                            child: IconButton(
                              key: Key('pm.record.${plan.id}'),
                              tooltip: copy('record'),
                              onPressed: onRecord,
                              padding: EdgeInsets.zero,
                              style: IconButton.styleFrom(
                                backgroundColor: palette.primarySoft,
                                foregroundColor: palette.primary,
                              ),
                              icon: const Icon(
                                Icons.check_circle_outline_rounded,
                                size: 22,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        if (showDivider)
          Divider(height: 1, thickness: 1, color: palette.border),
      ],
    );
  }
}

/// `pm_programs.priority` is stored lower case (V253 CHECK); the chip shows
/// it the way the work order vocabulary spells it.
String _capitalised(String value) {
  final String trimmed = value.trim();
  if (trimmed.isEmpty) return trimmed;
  return trimmed[0].toUpperCase() + trimmed.substring(1).toLowerCase();
}

/// The queue's loading row, shown until both sources have answered once.
class _QueueLoading extends StatelessWidget {
  const _QueueLoading();

  @override
  Widget build(BuildContext context) => const SizedBox(
        key: Key('pm.queue.loading'),
        height: 160,
        child: Center(child: CircularProgressIndicator()),
      );
}

/// One source of the queue failed. The other source's rows still render;
/// this row says which part is missing and retries only that part.
class _QueueError extends StatelessWidget {
  const _QueueError({
    required this.message,
    required this.retryLabel,
    required this.onRetry,
    super.key,
  });

  final String message;
  final String retryLabel;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors tone = palette.critical;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: tone.soft,
          borderRadius: BorderRadius.circular(TpRadius.md),
          border: Border.all(color: tone.base.withValues(alpha: 0.25)),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.md,
            TpSpace.xs,
            TpSpace.xs,
            TpSpace.xs,
          ),
          child: Row(
            children: <Widget>[
              Icon(Icons.error_outline_rounded, color: tone.base, size: 20),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  message,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: tone.onSoft),
                ),
              ),
              TextButton(
                onPressed: onRetry,
                style: TextButton.styleFrom(foregroundColor: tone.base),
                child: Text(
                  retryLabel,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One open work order in the priority queue: photo, asset, job card and
/// type, site, the due or opened date, type/priority/status chips and the
/// assigned technician. Tapping opens the existing work order detail.
///
/// The technician is `work_orders.assigned_owner_id` resolved to
/// `profiles.full_name`; an unassigned job shows no name rather than an
/// invented one.
class _WorkOrderRow extends StatelessWidget {
  const _WorkOrderRow({
    required this.order,
    required this.now,
    required this.copy,
    required this.showDivider,
    required this.onOpen,
  });

  final MaintenanceWorkOrder order;
  final DateTime now;
  final PmCopy copy;
  final bool showDivider;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final MaterialLocalizations dates = MaterialLocalizations.of(context);
    final int? days = order.daysToTarget(now);
    final DateTime? target = order.targetCompletion?.toLocal();
    final DateTime? opened = order.openedAt?.toLocal();
    final TpStatus dueStatus = switch (days) {
      null => TpStatus.neutral,
      < 0 => TpStatus.critical,
      0 => TpStatus.warning,
      _ => TpStatus.ok,
    };
    final TpStatusColors dueTone = palette.forStatus(dueStatus);
    final String? dueLabel = switch (days) {
      null => null,
      < 0 => copy('overdue'),
      0 => copy('dueToday'),
      _ => '$days ${copy('daysLeft')}',
    };
    final String dateText = switch (days) {
      null when opened != null =>
        '${copy('opened')} ${dates.formatShortDate(opened)}',
      null => '',
      < 0 => '${copy('since')} ${dates.formatShortDate(target!)}',
      _ => dates.formatShortDate(target!),
    };
    final String title =
        order.assetNo ?? order.workOrderNo ?? copy('workOrder');
    final String detail = <String>[
      if (order.assetNo != null && order.workOrderNo != null)
        order.workOrderNo!,
      if (!order.isBreakdown) workOrderWorkTypeLabel(l10n, order.workType),
    ].join(' · ');
    final VehicleAsset asset = VehicleAsset(
      id: order.id,
      assetNo: order.assetNo,
      vehicleType: order.assetCategory,
      site: order.site,
    );
    final String? photo = vehiclePhotoAsset(asset);
    final TpStatusColors statusTone = palette.forStatus(
      workOrderToneToStatus(workOrderStatusTone(order.status)),
    );
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        InkWell(
          key: Key('pm.wo.${order.id}'),
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _QueueThumbnail(asset: asset, photo: photo),
                const SizedBox(width: TpSpace.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: text.titleMedium?.copyWith(
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          if (dueLabel != null) ...<Widget>[
                            const SizedBox(width: TpSpace.xs),
                            Icon(
                              days! < 0
                                  ? Icons.schedule_rounded
                                  : Icons.event_rounded,
                              size: 16,
                              color: dueTone.base,
                            ),
                            const SizedBox(width: 3),
                            Flexible(
                              child: Text(
                                dueLabel,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: text.labelMedium?.copyWith(
                                  color: dueTone.base,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      if (detail.isNotEmpty)
                        Text(
                          detail,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: text.bodySmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                        ),
                      if (order.site != null || dateText.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Row(
                            children: <Widget>[
                              if (order.site != null) ...<Widget>[
                                Icon(
                                  Icons.location_on_outlined,
                                  size: 14,
                                  color: palette.textMuted,
                                ),
                                const SizedBox(width: 2),
                                Flexible(
                                  child: Text(
                                    order.site!,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: text.bodySmall?.copyWith(
                                      color: palette.textSecondary,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: TpSpace.sm),
                              ],
                              if (dateText.isNotEmpty)
                                Flexible(
                                  flex: 2,
                                  child: Text(
                                    dateText,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: text.bodySmall?.copyWith(
                                      color: palette.textMuted,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      const SizedBox(height: TpSpace.sm),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: <Widget>[
                          Expanded(
                            child: Wrap(
                              spacing: TpSpace.xs,
                              runSpacing: TpSpace.xs,
                              children: <Widget>[
                                _PmChip(
                                  key: Key('pm.wo.${order.id}.tag'),
                                  label: order.isBreakdown
                                      ? copy('breakdown')
                                      : copy('workOrder'),
                                  tone: order.isBreakdown
                                      ? palette.critical
                                      : palette.info,
                                ),
                                if (order.priority != null)
                                  _PmChip(
                                    label: order.priority!,
                                    tone: palette.forStatus(
                                      workOrderToneToStatus(
                                        workOrderPriorityTone(order.priority),
                                      ),
                                    ),
                                  ),
                                _PmChip(
                                  label: workOrderStatusLabel(
                                    l10n,
                                    order.status,
                                  ),
                                  tone: statusTone,
                                ),
                              ],
                            ),
                          ),
                          if (order.technicianName != null)
                            _TechnicianTag(name: order.technicianName!)
                          else if (onOpen != null)
                            Icon(
                              Icons.chevron_right_rounded,
                              color: palette.textMuted,
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        if (showDivider)
          Divider(height: 1, thickness: 1, color: palette.border),
      ],
    );
  }
}

/// The assigned technician: initials in a soft circle and the first name.
class _TechnicianTag extends StatelessWidget {
  const _TechnicianTag({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String initials = pmInitials(name) ?? '';
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 104),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: palette.primarySoft,
              shape: BoxShape.circle,
            ),
            child: Text(
              initials,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: palette.primary,
                    fontWeight: FontWeight.w900,
                  ),
            ),
          ),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context)
                  .textTheme
                  .labelMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

/// The equipment thumbnail shared by both kinds of queue row.
class _QueueThumbnail extends StatelessWidget {
  const _QueueThumbnail({required this.asset, required this.photo});

  final VehicleAsset asset;
  final String? photo;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Container(
      width: 84,
      height: 76,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: <Color>[palette.surfaceAlt, palette.surfaceSunken],
        ),
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.border),
      ),
      clipBehavior: Clip.antiAlias,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(4),
      child: photo == null
          ? Icon(vehicleFallbackIcon(asset), size: 32, color: palette.primary)
          : Image.asset(
              photo!,
              width: double.infinity,
              height: double.infinity,
              fit: BoxFit.contain,
              filterQuality: FilterQuality.high,
            ),
    );
  }
}

/// A soft, tone-coloured label chip for the queue rows.
class _PmChip extends StatelessWidget {
  const _PmChip({required this.label, required this.tone, super.key});

  final String label;
  final TpStatusColors tone;

  @override
  Widget build(BuildContext context) => DecoratedBox(
        decoration: BoxDecoration(
          color: tone.soft,
          borderRadius: BorderRadius.circular(TpRadius.sm),
          border: Border.all(color: tone.base.withValues(alpha: 0.2)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: tone.onSoft,
                  fontWeight: FontWeight.w800,
                ),
          ),
        ),
      );
}

class _RecordServiceSheet extends ConsumerStatefulWidget {
  const _RecordServiceSheet({required this.plan, required this.copy});
  final PmPlan plan;
  final PmCopy copy;

  @override
  ConsumerState<_RecordServiceSheet> createState() =>
      _RecordServiceSheetState();
}

class _RecordServiceSheetState extends ConsumerState<_RecordServiceSheet> {
  final TextEditingController meter = TextEditingController();
  final TextEditingController performedBy = TextEditingController();
  final TextEditingController workshop = TextEditingController();
  final TextEditingController partsCost = TextEditingController();
  final TextEditingController labourCost = TextEditingController();
  final TextEditingController findings = TextEditingController();
  PmServiceOutcome outcome = PmServiceOutcome.completed;
  bool saving = false;

  @override
  void initState() {
    super.initState();
    performedBy.text =
        ref.read(workspaceContextProvider)?.fullName?.trim() ?? '';
  }

  @override
  void dispose() {
    for (final TextEditingController controller in <TextEditingController>[
      meter,
      performedBy,
      workshop,
      partsCost,
      labourCost,
      findings,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final PmCopy copy = widget.copy;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.md,
        TpSpace.lg,
        MediaQuery.viewInsetsOf(context).bottom + TpSpace.lg,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(copy('record'), style: Theme.of(context).textTheme.titleLarge),
            Text(widget.plan.name ?? widget.plan.assetNo ?? copy('plan')),
            if (widget.plan.meterUnit.isNotEmpty)
              _PmInput(
                controller: meter,
                label: '${copy('meter')} (${widget.plan.meterUnit})',
                keyName: 'meter',
                numeric: true,
              ),
            _PmInput(
              controller: performedBy,
              label: copy('performedBy'),
              keyName: 'performedBy',
            ),
            _PmInput(
              controller: workshop,
              label: copy('workshop'),
              keyName: 'workshop',
            ),
            _PmInput(
              controller: partsCost,
              label: copy('partsCost'),
              keyName: 'partsCost',
              numeric: true,
            ),
            _PmInput(
              controller: labourCost,
              label: copy('labourCost'),
              keyName: 'labourCost',
              numeric: true,
            ),
            _PmInput(
              controller: findings,
              label: copy('findings'),
              keyName: 'findings',
              lines: 3,
            ),
            const SizedBox(height: TpSpace.md),
            Wrap(
              spacing: TpSpace.xs,
              children: <Widget>[
                for (final PmServiceOutcome value in PmServiceOutcome.values)
                  ChoiceChip(
                    label: Text(copy(value.name)),
                    selected: outcome == value,
                    onSelected: (_) => setState(() => outcome = value),
                  ),
              ],
            ),
            const SizedBox(height: TpSpace.xl),
            FilledButton(
              key: const Key('pm.save'),
              onPressed: saving ? null : () => unawaited(_save(copy)),
              child: Text(copy('save')),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save(PmCopy copy) async {
    final num? meterValue = _number(meter.text);
    final num? parts = _number(partsCost.text);
    final num? labour = _number(labourCost.text);
    if ((meter.text.trim().isNotEmpty && meterValue == null) ||
        (partsCost.text.trim().isNotEmpty && parts == null) ||
        (labourCost.text.trim().isNotEmpty && labour == null)) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(copy('invalidNumber'))));
      return;
    }
    setState(() => saving = true);
    try {
      await ref.read(pmRepositoryProvider).recordService(
            RecordPmServiceInput(
              programId: widget.plan.id,
              serviceDate: DateTime.now(),
              outcome: outcome,
              meterReading: meterValue,
              performedBy: performedBy.text,
              workshop: workshop.text,
              site: widget.plan.site,
              partsCost: parts,
              labourCost: labour,
              findings: findings.text,
            ),
          );
      if (mounted) Navigator.pop(context, true);
    } on Object {
      if (mounted) {
        setState(() => saving = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(copy('saveFailed'))));
      }
    }
  }
}

class _PmInput extends StatelessWidget {
  const _PmInput({
    required this.controller,
    required this.label,
    required this.keyName,
    this.numeric = false,
    this.lines = 1,
  });
  final TextEditingController controller;
  final String label;
  final String keyName;
  final bool numeric;
  final int lines;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: TpSpace.md),
        child: TextField(
          key: Key('pm.$keyName'),
          controller: controller,
          keyboardType: numeric
              ? const TextInputType.numberWithOptions(decimal: true)
              : null,
          minLines: lines,
          maxLines: lines == 1 ? 1 : 5,
          decoration: InputDecoration(labelText: label),
        ),
      );
}

num? _number(String raw) {
  final String value = raw.trim().replaceAll(',', '');
  return value.isEmpty ? null : num.tryParse(value);
}
