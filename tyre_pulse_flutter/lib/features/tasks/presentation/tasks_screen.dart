library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';
import 'package:tyre_pulse/features/tasks/domain/task_board.dart';
import 'package:tyre_pulse/features/tasks/presentation/tasks_copy.dart';
import 'package:tyre_pulse/features/tasks/tasks_providers.dart';

abstract final class TasksScreenKeys {
  static Key task(String id) => ValueKey<String>('tasks.task.$id');
  static const Key board = ValueKey<String>('tasks.board');
  static const Key stats = ValueKey<String>('tasks.stats');
  static const Key reportIssue = ValueKey<String>('tasks.report-issue');
  static const Key todayTab = ValueKey<String>('tasks.tab.today');
  static const Key inProgressTab = ValueKey<String>('tasks.tab.in-progress');
  static const Key completedTab = ValueKey<String>('tasks.tab.completed');
}

class TasksScreen extends ConsumerStatefulWidget {
  const TasksScreen({required this.route, super.key});

  final TasksRoute route;

  @override
  ConsumerState<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends ConsumerState<TasksScreen> {
  bool _loading = true;
  Object? _error;
  List<TaskItem> _items = const <TaskItem>[];
  TaskBoardFilter _filter = TaskBoardFilter.today;
  final Set<String> _expandedIds = <String>{};

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
      final List<TaskItem> items = await ref
          .read(tasksRepositoryProvider)
          .listRecent(country: ref.read(activeCountryProvider));
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  void _selectFilter(TaskBoardFilter value) {
    if (_filter == value) return;
    setState(() {
      _filter = value;
      _expandedIds.clear();
    });
  }

  void _toggleDetails(String id) {
    setState(() {
      if (!_expandedIds.add(id)) _expandedIds.remove(id);
    });
  }

  @override
  Widget build(BuildContext context) {
    final TasksCopy copy = TasksCopy.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final int activeCount =
        _items.where((TaskItem item) => !isTaskCompleted(item)).length;

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: copy('title'),
        subtitle: _loading ? null : '$activeCount ${copy('open')}',
        backFallback: fallback,
        actions: <Widget>[
          IconButton(
            key: TasksScreenKeys.reportIssue,
            icon: const Icon(Icons.report_problem_outlined),
            tooltip: copy('reportIssue'),
            onPressed: () => context.push(const ReportIssueRoute().location),
          ),
          PopupMenuButton<TaskBoardFilter>(
            icon: const Icon(Icons.tune_rounded),
            tooltip: copy('status'),
            initialValue: _filter,
            onSelected: _selectFilter,
            itemBuilder: (BuildContext context) =>
                <PopupMenuEntry<TaskBoardFilter>>[
              PopupMenuItem<TaskBoardFilter>(
                value: TaskBoardFilter.today,
                child: Text(copy('today')),
              ),
              PopupMenuItem<TaskBoardFilter>(
                value: TaskBoardFilter.inProgress,
                child: Text(copy('inProgress')),
              ),
              PopupMenuItem<TaskBoardFilter>(
                value: TaskBoardFilter.completed,
                child: Text(copy('completed')),
              ),
            ],
          ),
        ],
      ),
      body: _body(copy),
    );
  }

  Widget _body(TasksCopy copy) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      final Object error = _error!;
      final AppError appError;
      if (error is AppError) {
        appError = error;
      } else if (error is SupabaseFailure) {
        appError = error.error;
      } else {
        appError = AppError(
          kind: AppErrorKind.unknown,
          message: copy('loadError'),
          technical: error.toString(),
          cause: error,
          isRetryable: true,
        );
      }
      return TpErrorState(error: appError, onRetry: _load);
    }

    final List<TaskItem> shown = filterTasks(_items, _filter);
    return Column(
      children: <Widget>[
        _TaskStats(items: _items, copy: copy),
        _TaskTabs(
          selected: _filter,
          todayCount: filterTasks(_items, TaskBoardFilter.today).length,
          inProgressCount:
              filterTasks(_items, TaskBoardFilter.inProgress).length,
          completedCount: filterTasks(_items, TaskBoardFilter.completed).length,
          copy: copy,
          onSelected: _selectFilter,
        ),
        Expanded(
          child: shown.isEmpty
              ? RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: <Widget>[
                      SizedBox(
                        height: MediaQuery.sizeOf(context).height * 0.55,
                        child: TpEmptyState(
                          icon: Icons.task_alt_rounded,
                          title: copy('emptyTitle'),
                          message: copy('emptyMessage'),
                        ),
                      ),
                    ],
                  ),
                )
              : _TaskBoard(
                  key: TasksScreenKeys.board,
                  items: shown,
                  now: DateTime.now(),
                  copy: copy,
                  expandedIds: _expandedIds,
                  onRefresh: _load,
                  onToggleDetails: _toggleDetails,
                ),
        ),
      ],
    );
  }
}

class _TaskStats extends StatelessWidget {
  const _TaskStats({required this.items, required this.copy});

  final List<TaskItem> items;
  final TasksCopy copy;

  @override
  Widget build(BuildContext context) {
    final DateTime now = DateTime.now();
    final DateTime today = DateTime(now.year, now.month, now.day);
    final DateTime tomorrow = today.add(const Duration(days: 1));
    final int assigned =
        items.where((TaskItem item) => !isTaskCompleted(item)).length;
    final int dueToday = items.where((TaskItem item) {
      final DateTime? due = item.dueDate?.toLocal();
      return !isTaskCompleted(item) &&
          due != null &&
          !due.isBefore(today) &&
          due.isBefore(tomorrow);
    }).length;
    final int overdue = items.where((TaskItem item) {
      final DateTime? due = item.dueDate?.toLocal();
      return !isTaskCompleted(item) && due != null && due.isBefore(today);
    }).length;

    return Padding(
      key: TasksScreenKeys.stats,
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.md,
        TpSpace.lg,
        TpSpace.md,
      ),
      child: TpCard(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
        child: Row(
          children: <Widget>[
            Expanded(
              child: _TaskStat(
                icon: Icons.assignment_outlined,
                value: assigned,
                label: copy('assignedTab'),
                status: TpStatus.ok,
              ),
            ),
            const _TaskStatDivider(),
            Expanded(
              child: _TaskStat(
                icon: Icons.schedule_outlined,
                value: dueToday,
                label: copy('dueToday'),
                status: TpStatus.ok,
              ),
            ),
            const _TaskStatDivider(),
            Expanded(
              child: _TaskStat(
                icon: Icons.error_outline_rounded,
                value: overdue,
                label: copy('overdue'),
                status: TpStatus.critical,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TaskStatDivider extends StatelessWidget {
  const _TaskStatDivider();

  @override
  Widget build(BuildContext context) {
    return Container(width: 1, height: 56, color: TpPalette.of(context).border);
  }
}

class _TaskStat extends StatelessWidget {
  const _TaskStat({
    required this.icon,
    required this.value,
    required this.label,
    required this.status,
  });

  final IconData icon;
  final int value;
  final String label;
  final TpStatus status;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(status);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: TpSpace.sm),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Container(
            width: 42,
            height: 42,
            decoration:
                BoxDecoration(color: colors.soft, shape: BoxShape.circle),
            child: Icon(icon, color: colors.base, size: TpSizing.iconLg),
          ),
          const SizedBox(width: TpSpace.sm),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  '$value',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: colors.onSoft,
                        fontWeight: FontWeight.w800,
                        height: 1,
                      ),
                ),
                const SizedBox(height: 3),
                Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: palette.textSecondary,
                        fontWeight: FontWeight.w600,
                        height: 1.1,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TaskTabs extends StatelessWidget {
  const _TaskTabs({
    required this.selected,
    required this.todayCount,
    required this.inProgressCount,
    required this.completedCount,
    required this.copy,
    required this.onSelected,
  });

  final TaskBoardFilter selected;
  final int todayCount;
  final int inProgressCount;
  final int completedCount;
  final TasksCopy copy;
  final ValueChanged<TaskBoardFilter> onSelected;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: Row(
        children: <Widget>[
          _TaskTab(
            key: TasksScreenKeys.todayTab,
            label: copy('assignedTab'),
            count: todayCount,
            selected: selected == TaskBoardFilter.today,
            onTap: () => onSelected(TaskBoardFilter.today),
          ),
          _TaskTab(
            key: TasksScreenKeys.inProgressTab,
            label: copy('inProgress'),
            count: inProgressCount,
            selected: selected == TaskBoardFilter.inProgress,
            onTap: () => onSelected(TaskBoardFilter.inProgress),
          ),
          _TaskTab(
            key: TasksScreenKeys.completedTab,
            label: copy('completed'),
            count: completedCount,
            selected: selected == TaskBoardFilter.completed,
            onTap: () => onSelected(TaskBoardFilter.completed),
          ),
        ],
      ),
    );
  }
}

class _TaskTab extends StatelessWidget {
  const _TaskTab({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
          child: DecoratedBox(
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  width: selected ? 3 : 0,
                  color: selected ? palette.primary : Colors.transparent,
                ),
              ),
            ),
            child: Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                            color: selected
                                ? palette.primaryDark
                                : palette.textSecondary,
                            fontWeight:
                                selected ? FontWeight.w800 : FontWeight.w600,
                          ),
                    ),
                  ),
                  if (count > 0) ...<Widget>[
                    const SizedBox(width: TpSpace.xs),
                    DecoratedBox(
                      decoration: BoxDecoration(
                        color:
                            selected ? palette.primary : palette.surfaceSunken,
                        borderRadius: BorderRadius.circular(TpRadius.pill),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 1,
                        ),
                        child: Text(
                          '$count',
                          style:
                              Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: selected
                                        ? palette.onPrimary
                                        : palette.textMuted,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800,
                                  ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TaskBoard extends StatelessWidget {
  const _TaskBoard({
    required this.items,
    required this.now,
    required this.copy,
    required this.expandedIds,
    required this.onRefresh,
    required this.onToggleDetails,
    super.key,
  });

  final List<TaskItem> items;
  final DateTime now;
  final TasksCopy copy;
  final Set<String> expandedIds;
  final Future<void> Function() onRefresh;
  final ValueChanged<String> onToggleDetails;

  @override
  Widget build(BuildContext context) {
    final Map<TaskBoardSection, List<TaskItem>> grouped =
        groupTasks(items, now: now);
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          for (final TaskBoardSection section in TaskBoardSection.values)
            if (grouped[section]!.isNotEmpty) ...<Widget>[
              _SectionLabel(section: section, copy: copy),
              const SizedBox(height: TpSpace.sm),
              for (final TaskItem item in grouped[section]!)
                _TaskCard(
                  item: item,
                  section: section,
                  expanded: expandedIds.contains(item.id),
                  copy: copy,
                  onToggleDetails: () => onToggleDetails(item.id),
                ),
              const SizedBox(height: TpSpace.sm),
            ],
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.section, required this.copy});

  final TaskBoardSection section;
  final TasksCopy copy;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color color = switch (section) {
      TaskBoardSection.urgent => palette.critical.base,
      TaskBoardSection.inProgress => palette.ok.base,
      TaskBoardSection.upcoming => palette.textSecondary,
      TaskBoardSection.completed => palette.ok.base,
    };
    final String key = switch (section) {
      TaskBoardSection.urgent => 'urgent',
      TaskBoardSection.inProgress => 'inProgress',
      TaskBoardSection.upcoming => 'upcoming',
      TaskBoardSection.completed => 'completed',
    };
    return Text(
      copy(key).toUpperCase(),
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: color,
            fontWeight: FontWeight.w900,
            letterSpacing: 0.8,
          ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({
    required this.item,
    required this.section,
    required this.expanded,
    required this.copy,
    required this.onToggleDetails,
  });

  final TaskItem item;
  final TaskBoardSection section;
  final bool expanded;
  final TasksCopy copy;
  final VoidCallback onToggleDetails;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color accent = switch (section) {
      TaskBoardSection.urgent => palette.critical.base,
      TaskBoardSection.inProgress => palette.ok.base,
      TaskBoardSection.upcoming => palette.ok.base,
      TaskBoardSection.completed => palette.ok.base,
    };
    final String? asset = item.assetNo;
    final String? site = item.site;
    final String priority = item.priority ?? copy('normal');
    final bool hasDetails = item.description != null ||
        item.assignedTo != null ||
        item.dueDate != null;
    final TpStatus tone = switch (section) {
      TaskBoardSection.urgent => TpStatus.critical,
      TaskBoardSection.inProgress => TpStatus.warning,
      TaskBoardSection.upcoming => TpStatus.info,
      TaskBoardSection.completed => TpStatus.ok,
    };
    final TpStatusColors statusColors = palette.forStatus(tone);
    final String badgeLabel = item.status ?? priority;
    final String? dueLabel;
    if (item.dueDate == null) {
      dueLabel = null;
    } else {
      final String date = MaterialLocalizations.of(context)
          .formatMediumDate(item.dueDate!.toLocal());
      dueLabel = '${copy('due')} $date';
    }

    return TpCard(
      key: TasksScreenKeys.task(item.id),
      margin: const EdgeInsets.only(bottom: TpSpace.md),
      padding: EdgeInsets.zero,
      borderColor: palette.border,
      onTap: hasDetails ? onToggleDetails : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.all(TpSpace.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: <Widget>[
                _TaskIcon(item: item, status: tone),
                const SizedBox(width: TpSpace.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        item.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              color: palette.text,
                              fontWeight: FontWeight.w800,
                              height: 1.25,
                            ),
                      ),
                      if (asset != null) ...<Widget>[
                        const SizedBox(height: 2),
                        Text(
                          asset,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context)
                              .textTheme
                              .labelMedium
                              ?.copyWith(color: palette.primary),
                        ),
                      ],
                      if (site != null) ...<Widget>[
                        const SizedBox(height: TpSpace.xs),
                        Row(
                          children: <Widget>[
                            Icon(
                              Icons.location_on_outlined,
                              size: TpSizing.iconSm,
                              color: palette.primary,
                            ),
                            const SizedBox(width: TpSpace.xs),
                            Expanded(
                              child: Text(
                                site,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: Theme.of(context)
                                    .textTheme
                                    .labelSmall
                                    ?.copyWith(color: palette.textSecondary),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    _CompactBadge(
                      label: badgeLabel,
                      color: statusColors.onSoft,
                      background: statusColors.soft,
                    ),
                    if (dueLabel != null) ...<Widget>[
                      const SizedBox(height: TpSpace.xs),
                      Text(
                        dueLabel,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: accent,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                    ],
                    if (hasDetails) ...<Widget>[
                      const SizedBox(height: TpSpace.sm),
                      TpButton(
                        label: copy('view'),
                        variant: section == TaskBoardSection.urgent
                            ? TpButtonVariant.primary
                            : TpButtonVariant.secondary,
                        isCompact: true,
                        onPressed: onToggleDetails,
                      ),
                    ],
                  ],
                ),
                const SizedBox(width: TpSpace.xs),
                Icon(
                  expanded
                      ? Icons.keyboard_arrow_up_rounded
                      : (TpDirection.isRtl(context)
                          ? Icons.arrow_back_ios_new_rounded
                          : Icons.arrow_forward_ios_rounded),
                  size: TpSizing.iconSm,
                  color: palette.primaryDark,
                ),
              ],
            ),
          ),
          if (expanded) ...<Widget>[
            Divider(height: 1, color: palette.border),
            Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  if (item.description != null)
                    Text(
                      item.description!,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                    ),
                  if (item.description != null &&
                      (item.assignedTo != null || item.status != null))
                    const SizedBox(height: TpSpace.sm),
                  if (item.assignedTo != null)
                    _DetailLine(
                      icon: Icons.person_outline_rounded,
                      label: copy('assigned'),
                      value: item.assignedTo!,
                    ),
                  if (item.status != null)
                    _DetailLine(
                      icon: Icons.flag_outlined,
                      label: copy('status'),
                      value: item.status!,
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _TaskIcon extends StatelessWidget {
  const _TaskIcon({required this.item, required this.status});

  final TaskItem item;
  final TpStatus status;

  @override
  Widget build(BuildContext context) {
    final String value = item.title.toLowerCase();
    final IconData icon = value.contains('tyre') || value.contains('tire')
        ? Icons.tire_repair_outlined
        : value.contains('wash')
            ? Icons.local_car_wash_outlined
            : value.contains('meter') || value.contains('odometer')
                ? Icons.speed_outlined
                : value.contains('check') || value.contains('inspect')
                    ? Icons.assignment_turned_in_outlined
                    : Icons.build_outlined;
    final TpStatusColors colors = TpPalette.of(context).forStatus(status);
    return Container(
      width: 52,
      height: 52,
      decoration: BoxDecoration(
        color: colors.soft,
        shape: BoxShape.circle,
        border: Border.all(color: colors.base.withValues(alpha: 0.18)),
      ),
      child: Icon(icon, color: colors.base, size: 28),
    );
  }
}

class _CompactBadge extends StatelessWidget {
  const _CompactBadge({
    required this.label,
    required this.color,
    required this.background,
  });

  final String label;
  final Color color;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(TpRadius.pill),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.sm,
          vertical: TpSpace.xs,
        ),
        child: Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: color,
                fontWeight: FontWeight.w800,
              ),
        ),
      ),
    );
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: TpSpace.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: TpSizing.iconSm, color: palette.textMuted),
          const SizedBox(width: TpSpace.xs),
          Text(
            '$label: ',
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: palette.textMuted),
          ),
          Expanded(
            child: Text(
              value,
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: palette.textSecondary),
            ),
          ),
        ],
      ),
    );
  }
}
