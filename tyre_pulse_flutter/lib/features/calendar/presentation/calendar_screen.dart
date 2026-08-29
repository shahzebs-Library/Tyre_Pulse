library;

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
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/calendar/calendar_providers.dart';
import 'package:tyre_pulse/features/calendar/domain/schedule_item.dart';
import 'package:tyre_pulse/features/calendar/presentation/calendar_copy.dart';

class CalendarScreen extends ConsumerWidget {
  const CalendarScreen({required this.route, super.key});
  final CalendarRoute route;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CalendarCopy copy = CalendarCopy.of(context);
    final AsyncValue<List<ScheduleItem>> state =
        ref.watch(calendarItemsProvider);
    final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
    final String fallback = TpBackFallbacks.forRoute(route);
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: copy('title'),
        subtitle: switch (state) {
          AsyncData<List<ScheduleItem>>(:final value) =>
            '${value.length} ${copy('scheduled')}',
          _ => null,
        },
        backFallback: fallback,
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
          onRetry: () => ref.invalidate(calendarItemsProvider),
        ),
        data: (List<ScheduleItem> items) => _CalendarBody(
          items: items,
          copy: copy,
          assignee: workspace?.fullName,
          scopeLabel: workspace?.activeSites.isNotEmpty == true
              ? workspace!.activeSites.join(', ')
              : workspace?.legacySite ?? workspace?.activeCountry,
          onRefresh: () async {
            ref.invalidate(calendarItemsProvider);
            await ref.read(calendarItemsProvider.future);
          },
        ),
      ),
    );
  }
}

class _CalendarBody extends StatelessWidget {
  const _CalendarBody({
    required this.items,
    required this.copy,
    required this.assignee,
    required this.scopeLabel,
    required this.onRefresh,
  });
  final List<ScheduleItem> items;
  final CalendarCopy copy;
  final String? assignee;
  final String? scopeLabel;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final DateTime now = DateTime.now();
    final Map<ScheduleBucket, List<ScheduleItem>> groups =
        <ScheduleBucket, List<ScheduleItem>>{
      for (final ScheduleBucket bucket in ScheduleBucket.values)
        bucket: items
            .where((ScheduleItem item) => item.bucket(now) == bucket)
            .toList(growable: false),
    };
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          _FieldPlanHeader(
            title: copy('title'),
            assignee: assignee,
            scopeLabel: scopeLabel,
          ),
          const SizedBox(height: TpSpace.lg),
          TpCard(
            padding: const EdgeInsets.symmetric(
              horizontal: TpSpace.sm,
              vertical: TpSpace.lg,
            ),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: _PlanMetric(
                    value: items.length,
                    label: copy('scheduled'),
                    icon: Icons.assignment_outlined,
                    status: TpStatus.info,
                  ),
                ),
                const _MetricDivider(),
                Expanded(
                  child: _PlanMetric(
                    value: groups[ScheduleBucket.today]!.length,
                    label: copy('today'),
                    icon: Icons.event_available_outlined,
                    status: TpStatus.ok,
                  ),
                ),
                const _MetricDivider(),
                Expanded(
                  child: _PlanMetric(
                    value: groups[ScheduleBucket.overdue]!.length,
                    label: copy('overdue'),
                    icon: Icons.warning_amber_rounded,
                    status: TpStatus.critical,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.xl),
          if (items.isEmpty)
            SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.45,
              child: TpEmptyState(
                icon: Icons.event_available_outlined,
                title: copy('empty'),
                message: copy('emptyBody'),
              ),
            )
          else
            for (final ScheduleBucket bucket in ScheduleBucket.values)
              if (groups[bucket]!.isNotEmpty) ...<Widget>[
                Text(
                  copy(bucket.name),
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w900,
                      ),
                ),
                const SizedBox(height: TpSpace.sm),
                for (final ScheduleItem item in groups[bucket]!) ...<Widget>[
                  _ScheduleCard(item: item, bucket: bucket, copy: copy),
                  const SizedBox(height: TpSpace.sm),
                ],
                const SizedBox(height: TpSpace.sm),
              ],
        ],
      ),
    );
  }
}

class _FieldPlanHeader extends StatelessWidget {
  const _FieldPlanHeader({
    required this.title,
    required this.assignee,
    required this.scopeLabel,
  });

  final String title;
  final String? assignee;
  final String? scopeLabel;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final MaterialLocalizations localizations =
        MaterialLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          title,
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w900,
              ),
        ),
        const SizedBox(height: TpSpace.xs),
        Text(
          localizations.formatFullDate(DateTime.now()),
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: palette.textSecondary,
              ),
        ),
        if ((assignee ?? '').trim().isNotEmpty ||
            (scopeLabel ?? '').trim().isNotEmpty) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          Row(
            children: <Widget>[
              Icon(
                Icons.person_outline_rounded,
                color: palette.primary,
                size: TpSizing.iconLg,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  (assignee ?? '').trim().isEmpty ? '—' : assignee!.trim(),
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
              if ((scopeLabel ?? '').trim().isNotEmpty)
                TpStatusChip(
                  status: TpStatus.neutral,
                  label: scopeLabel!.trim(),
                  icon: Icons.location_on_outlined,
                  isCompact: true,
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _PlanMetric extends StatelessWidget {
  const _PlanMetric({
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
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        DecoratedBox(
          decoration: BoxDecoration(
            color: colors.soft,
            shape: BoxShape.circle,
          ),
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
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.labelMedium,
        ),
      ],
    );
  }
}

class _MetricDivider extends StatelessWidget {
  const _MetricDivider();

  @override
  Widget build(BuildContext context) => Container(
        width: 1,
        height: 74,
        color: TpPalette.of(context).border,
      );
}

class _ScheduleCard extends StatelessWidget {
  const _ScheduleCard({
    required this.item,
    required this.bucket,
    required this.copy,
  });
  final ScheduleItem item;
  final ScheduleBucket bucket;
  final CalendarCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final IconData icon = switch (item.kind) {
      ScheduleKind.inspection => Icons.fact_check_outlined,
      ScheduleKind.maintenance => Icons.build_circle_outlined,
      ScheduleKind.task => Icons.task_alt_outlined,
    };
    final TpStatus status = switch (bucket) {
      ScheduleBucket.overdue => TpStatus.critical,
      ScheduleBucket.today => TpStatus.warning,
      ScheduleBucket.week => TpStatus.info,
      ScheduleBucket.later => TpStatus.neutral,
    };
    final bool actionable = item.kind != ScheduleKind.maintenance;
    return TpCard(
      key: Key('calendar.item.${item.id}'),
      padding: EdgeInsets.zero,
      borderColor: palette.borderStrong,
      child: InkWell(
        onTap: actionable ? () => _open(context) : null,
        borderRadius: BorderRadius.circular(TpRadius.lg),
        child: Padding(
          padding: const EdgeInsets.all(TpSpace.md),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              SizedBox(
                width: 58,
                child: Column(
                  children: <Widget>[
                    Text(
                      MaterialLocalizations.of(context).formatTimeOfDay(
                        TimeOfDay.fromDateTime(item.date.toLocal()),
                        alwaysUse24HourFormat:
                            MediaQuery.alwaysUse24HourFormatOf(context),
                      ),
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w900,
                          ),
                    ),
                    const SizedBox(height: TpSpace.xs),
                    TpStatusChip(
                      status: status,
                      label: copy(bucket.name),
                      isCompact: true,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: TpSpace.md),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: palette.forStatus(status).soft,
                  shape: BoxShape.circle,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(TpSpace.md),
                  child: Icon(
                    icon,
                    color: palette.forStatus(status).onSoft,
                    size: TpSizing.iconLg,
                  ),
                ),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      item.title,
                      style: Theme.of(context)
                          .textTheme
                          .titleSmall
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    Text(
                      item.subtitle == null
                          ? copy(item.kind.name)
                          : '${copy(item.kind.name)} / ${item.subtitle}',
                      style: TextStyle(color: palette.textSecondary),
                    ),
                  ],
                ),
              ),
              if (actionable)
                const Icon(Icons.chevron_right_rounded, size: TpSizing.iconSm),
            ],
          ),
        ),
      ),
    );
  }

  void _open(BuildContext context) {
    switch (item.kind) {
      case ScheduleKind.inspection:
        final String? id = item.sourceId;
        if (id != null) {
          context.push(
            InspectionDetailRoute(inspectionId: InspectionId(id)).location,
          );
        }
      case ScheduleKind.task:
        context.push(const TasksRoute().location);
      case ScheduleKind.maintenance:
        break;
    }
  }
}
