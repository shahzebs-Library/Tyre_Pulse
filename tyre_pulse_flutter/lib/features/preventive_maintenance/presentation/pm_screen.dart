library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';
import 'package:tyre_pulse/features/preventive_maintenance/pm_providers.dart';
import 'package:tyre_pulse/features/preventive_maintenance/presentation/pm_copy.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/create_work_order_sheet.dart';

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
    final AsyncValue<List<PmPlan>> state = ref.watch(activePmPlansProvider);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
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
            tooltip: MaterialLocalizations.of(context).showMenuTooltip,
            onPressed: () => context.push(const NotificationsRoute().location),
            icon: const Badge(
              smallSize: 8,
              child: Icon(Icons.notifications_none_rounded),
            ),
          ),
          const SizedBox(width: TpSpace.sm),
        ],
      ),
      body: state.when(
        loading: () => const TpLoadingState(),
        error: (Object error, StackTrace stackTrace) => TpErrorState(
          error: switch (error) {
            final SupabaseFailure failure => failure.error,
            final AppError appError => appError,
            _ => AppError(
                kind: AppErrorKind.unknown,
                message: copy('loadFailed'),
                cause: error,
                isRetryable: true,
              ),
          },
          onRetry: () => ref.invalidate(activePmPlansProvider),
        ),
        data: (List<PmPlan> plans) => _content(copy, plans),
      ),
    );
  }

  Widget _content(PmCopy copy, List<PmPlan> plans) {
    final DateTime now = DateTime.now();
    final int overdue = plans
        .where((PmPlan plan) => plan.dueBand(now) == PmDueBand.overdue)
        .length;
    final int soon = plans
        .where((PmPlan plan) => plan.dueBand(now) == PmDueBand.dueSoon)
        .length;
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
    final bool canWorkOrders =
        ref.watch(canAccessModuleProvider(ModuleKey.workorders));
    final bool canInspect =
        ref.watch(canAccessModuleProvider(ModuleKey.inspect));
    final bool canStock = ref.watch(canAccessModuleProvider(ModuleKey.stock));
    final bool canTyres = ref.watch(canAccessModuleProvider(ModuleKey.records));
    final TpPalette palette = TpPalette.of(context);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(activePmPlansProvider);
        await ref.read(activePmPlansProvider.future);
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
          Text(
            copy('title'),
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w900,
                  letterSpacing: -0.6,
                ),
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            copy('subtitle'),
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: palette.textSecondary,
                ),
          ),
          const SizedBox(height: TpSpace.lg),
          if (canWorkOrders) ...<Widget>[
            SizedBox(
              height: 72,
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
                      decoration: const BoxDecoration(
                        color: Colors.white,
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
            const SizedBox(height: TpSpace.xl),
          ],
          TpCard(
            padding: const EdgeInsets.symmetric(
              horizontal: TpSpace.xs,
              vertical: TpSpace.lg,
            ),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: _PmMetric(
                    value: overdue + soon,
                    label: copy('pmDue'),
                    icon: Icons.build_circle_outlined,
                    status: TpStatus.warning,
                  ),
                ),
                const _PmMetricDivider(),
                Expanded(
                  child: _PmMetric(
                    value: overdue,
                    label: copy('overdue'),
                    icon: Icons.warning_rounded,
                    status: TpStatus.critical,
                  ),
                ),
                const _PmMetricDivider(),
                Expanded(
                  child: _PmMetric(
                    value: plans.length,
                    label: copy('active'),
                    icon: Icons.assignment_outlined,
                    status: TpStatus.info,
                  ),
                ),
                const _PmMetricDivider(),
                Expanded(
                  child: _PmMetric(
                    value: soon,
                    label: copy('dueSoon'),
                    icon: Icons.verified_user_outlined,
                    status: TpStatus.ok,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.xl),
          _SectionHeading(
            title: copy('priorityQueue'),
            action: copy('viewAll'),
            onAction: canWorkOrders
                ? () => context.push(const WorkOrdersRoute().location)
                : null,
          ),
          const SizedBox(height: TpSpace.sm),
          SegmentedButton<bool>(
            style: const ButtonStyle(
              visualDensity: VisualDensity.compact,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            segments: <ButtonSegment<bool>>[
              ButtonSegment<bool>(value: true, label: Text(copy('due'))),
              ButtonSegment<bool>(value: false, label: Text(copy('all'))),
            ],
            selected: <bool>{dueOnly},
            onSelectionChanged: (Set<bool> value) =>
                setState(() => dueOnly = value.single),
          ),
          const SizedBox(height: TpSpace.sm),
          Container(
            decoration: BoxDecoration(
              color: palette.surface,
              border: Border.all(color: palette.border),
              borderRadius: BorderRadius.circular(TpRadius.md),
            ),
            clipBehavior: Clip.antiAlias,
            child: visible.isEmpty
                ? SizedBox(
                    height: 220,
                    child: TpEmptyState(
                      icon: Icons.build_circle_outlined,
                      title: copy('empty'),
                      message: dueOnly ? copy('emptyDue') : copy('emptyAll'),
                    ),
                  )
                : Column(
                    children: <Widget>[
                      for (int index = 0; index < visible.length; index++)
                        _PmPlanCard(
                          plan: visible[index],
                          now: now,
                          copy: copy,
                          showDivider: index < visible.length - 1,
                          onRecord: () =>
                              unawaited(_record(visible[index], copy)),
                        ),
                    ],
                  ),
          ),
          if (canWorkOrders)
            TpButton.text(
              label: copy('allWorkOrders'),
              icon: Directionality.of(context) == TextDirection.rtl
                  ? Icons.chevron_left_rounded
                  : Icons.chevron_right_rounded,
              onPressed: () => context.push(const WorkOrdersRoute().location),
              isFullWidth: true,
            ),
          const SizedBox(height: TpSpace.lg),
          Text(
            copy('quickAccess'),
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
          ),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: _QuickAccessTile(
                  icon: Icons.assignment_rounded,
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
                  icon: Icons.calendar_month_rounded,
                  label: copy('pmSchedule'),
                  hint: copy('pmScheduleHint'),
                  onTap: () => setState(() => dueOnly = false),
                ),
              ),
              const SizedBox(width: TpSpace.xs),
              Expanded(
                child: _QuickAccessTile(
                  icon: Icons.verified_user_outlined,
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
                  icon: Icons.inventory_2_outlined,
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
          TpCard(
            padding: EdgeInsets.zero,
            child: TpActionRow(
              icon: Icons.tire_repair_rounded,
              label: copy('tyres'),
              value: copy('tyresHint'),
              showDivider: false,
              onTap: canTyres
                  ? () => context.push(const TyreRecordsRoute().location)
                  : null,
            ),
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
      builder: (BuildContext context) => _RecordServiceSheet(
        plan: plan,
        copy: copy,
      ),
    );
    if (saved == true) ref.invalidate(activePmPlansProvider);
  }
}

class _PmMetric extends StatelessWidget {
  const _PmMetric({
    required this.value,
    required this.label,
    required this.icon,
    required this.status,
  });

  final int value;
  final String label;
  final IconData icon;
  final TpStatus status;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).forStatus(status);
    return Column(
      children: <Widget>[
        DecoratedBox(
          decoration: BoxDecoration(color: colors.soft, shape: BoxShape.circle),
          child: Padding(
            padding: const EdgeInsets.all(TpSpace.sm),
            child: Icon(icon, color: colors.onSoft, size: TpSizing.iconLg),
          ),
        ),
        const SizedBox(height: TpSpace.xs),
        Text(
          '$value',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                color: colors.base,
                fontWeight: FontWeight.w900,
              ),
        ),
        Text(
          label,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.labelSmall,
        ),
      ],
    );
  }
}

class _PmMetricDivider extends StatelessWidget {
  const _PmMetricDivider();

  @override
  Widget build(BuildContext context) => Container(
        width: 1,
        height: 82,
        color: TpPalette.of(context).border,
      );
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
  Widget build(BuildContext context) => Row(
        children: <Widget>[
          Expanded(
            child: Text(
              title,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
            ),
          ),
          if (onAction != null)
            TextButton.icon(
              onPressed: onAction,
              iconAlignment: IconAlignment.end,
              icon: Icon(
                Directionality.of(context) == TextDirection.rtl
                    ? Icons.chevron_left_rounded
                    : Icons.chevron_right_rounded,
              ),
              label: Text(action),
            ),
        ],
      );
}

class _QuickAccessTile extends StatelessWidget {
  const _QuickAccessTile({
    required this.icon,
    required this.label,
    required this.hint,
    required this.onTap,
  });

  final IconData icon;
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
        color: palette.surface,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: palette.border),
          borderRadius: BorderRadius.circular(TpRadius.md),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            height: 116,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: TpSpace.xs,
                vertical: TpSpace.sm,
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Icon(icon, color: palette.primary, size: 28),
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
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: palette.textMuted,
                          height: 1.1,
                        ),
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

class _PmPlanCard extends StatelessWidget {
  const _PmPlanCard({
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
    final PmDueBand band = plan.dueBand(now);
    final int? days = plan.daysToDue(now);
    final TpStatus status = switch (band) {
      PmDueBand.overdue => TpStatus.critical,
      PmDueBand.dueSoon => TpStatus.warning,
      PmDueBand.ok => TpStatus.ok,
      PmDueBand.none => TpStatus.neutral,
    };
    final List<String> meta = <String>[
      if (plan.assetNo != null) plan.assetNo!,
      if (plan.site != null) plan.site!,
      if (plan.assetCategory != null) plan.assetCategory!,
    ];
    final VehicleAsset asset = VehicleAsset(
      id: plan.id,
      assetNo: plan.assetNo,
      vehicleType: plan.assetCategory,
      site: plan.site,
      status: plan.status,
    );
    final String? photo = vehiclePhotoAsset(asset);
    return TpCard(
      key: Key('pm.plan.${plan.id}'),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              Container(
                width: 94,
                height: 82,
                decoration: BoxDecoration(
                  color: palette.surfaceAlt,
                  borderRadius: BorderRadius.circular(TpRadius.md),
                  border: Border.all(color: palette.border),
                ),
                clipBehavior: Clip.antiAlias,
                alignment: Alignment.center,
                child: photo == null
                    ? Icon(
                        vehicleFallbackIcon(asset),
                        size: 38,
                        color: palette.primary,
                      )
                    : Image.asset(
                        photo,
                        width: double.infinity,
                        height: double.infinity,
                        fit: BoxFit.contain,
                        filterQuality: FilterQuality.high,
                      ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      plan.name ?? plan.assetNo ?? copy('plan'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context)
                          .textTheme
                          .titleSmall
                          ?.copyWith(fontWeight: FontWeight.w900),
                    ),
                    if (meta.isNotEmpty) ...<Widget>[
                      const SizedBox(height: TpSpace.xs),
                      Text(
                        meta.join(' · '),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: palette.textSecondary),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              TpStatusChip(
                status: status,
                label: switch (band) {
                  PmDueBand.overdue => '${days!.abs()} ${copy('daysOverdue')}',
                  PmDueBand.dueSoon => '$days ${copy('daysLeft')}',
                  PmDueBand.ok => '$days ${copy('daysLeft')}',
                  PmDueBand.none => copy('noDate'),
                },
              ),
            ],
          ),
          if (plan.nextDueMeter != null &&
              plan.meterUnit.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            Row(
              children: <Widget>[
                Icon(
                  Icons.speed_rounded,
                  size: TpSizing.iconSm,
                  color: palette.textMuted,
                ),
                const SizedBox(width: TpSpace.xs),
                Text('${plan.nextDueMeter} ${plan.meterUnit}'),
              ],
            ),
          ],
          const SizedBox(height: TpSpace.md),
          TpButton.primary(
            label: copy('record'),
            icon: Icons.check_circle_outline_rounded,
            onPressed: onRecord,
            isFullWidth: true,
            isCompact: true,
          ),
          if (showDivider) const SizedBox(height: TpSpace.xs),
        ],
      ),
    );
  }
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
