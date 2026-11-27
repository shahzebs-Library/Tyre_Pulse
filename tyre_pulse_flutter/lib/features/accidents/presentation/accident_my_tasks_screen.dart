/// My accident tasks (C1): the open case steps owned by me ("Assigned to me")
/// and by my role in my country and site ("For my team"), overdue first.
///
/// The same `accident_my_tasks()` read the web inbox uses, so the phone and the
/// web list the same tasks. A tap opens the case workstream screen.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_tasks_repository.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/queue_list_kit.dart';

abstract final class AccidentMyTasksScreenKeys {
  static Key row(String workstreamId) =>
      Key('accident.tasks.row.$workstreamId');
  static const Key mine = Key('accident.tasks.mine');
  static const Key team = Key('accident.tasks.team');
}

class AccidentMyTasksScreen extends ConsumerWidget {
  const AccidentMyTasksScreen({required this.route, super.key});
  final AccidentTasksRoute route;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<AccidentTasksResult> tasks =
        ref.watch(accidentMyTasksProvider);
    return TpScaffold(
      backgroundColor: TpPalette.of(context).background,
      appBar: TpAppBar(title: l10n.accidentTasksTitle),
      body: switch (tasks) {
        AsyncData<AccidentTasksResult>(:final AccidentTasksResult value) =>
          _List(result: value),
        AsyncError<AccidentTasksResult>(:final Object error) => TpErrorState(
            error: accidentAppError(error, AccidentCopy.of(context)),
            onRetry: () => ref.invalidate(accidentMyTasksProvider),
          ),
        _ => TpLoadingState(message: l10n.accidentTasksLoading),
      },
    );
  }
}

class _List extends ConsumerWidget {
  const _List({required this.result});
  final AccidentTasksResult result;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    if (!result.available) {
      return TpEmptyState(
        icon: Icons.assignment_late_outlined,
        title: l10n.accidentTasksTitle,
        message: l10n.accidentTasksNotOn,
      );
    }
    if (result.tasks.isEmpty) {
      return RefreshIndicator(
        onRefresh: () async => ref.invalidate(accidentMyTasksProvider),
        child: ListView(
          children: <Widget>[
            SizedBox(
              height: 420,
              child: TpEmptyState(
                icon: Icons.task_alt_outlined,
                title: l10n.accidentTasksTitle,
                message: l10n.accidentTasksEmpty,
              ),
            ),
          ],
        ),
      );
    }
    final List<AccidentTask> mine =
        result.tasks.where((AccidentTask t) => t.assignedToMe).toList();
    final List<AccidentTask> team =
        result.tasks.where((AccidentTask t) => !t.assignedToMe).toList();
    final TpPalette palette = TpPalette.of(context);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(accidentMyTasksProvider),
      child: ListView(
        padding: const EdgeInsets.only(bottom: TpSpace.xxl),
        children: <Widget>[
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(
              TpSpace.lg,
              TpSpace.lg,
              TpSpace.lg,
              0,
            ),
            child: Text(
              l10n.accidentTasksSummary(
                '${result.tasks.length}',
                '${result.overdueCount}',
              ),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: result.overdueCount > 0
                        ? palette.forStatus(TpStatus.critical).base
                        : palette.textSecondary,
                  ),
            ),
          ),
          if (mine.isNotEmpty) ...<Widget>[
            QueueSectionHeader(
              key: AccidentMyTasksScreenKeys.mine,
              title: '${l10n.accidentTasksAssignedToMe} (${mine.length})',
            ),
            for (int i = 0; i < mine.length; i++)
              _TaskRow(
                task: mine[i],
                isFirst: i == 0,
                showDivider: i < mine.length - 1,
              ),
          ],
          if (team.isNotEmpty) ...<Widget>[
            QueueSectionHeader(
              key: AccidentMyTasksScreenKeys.team,
              title: '${l10n.accidentTasksForMyTeam} (${team.length})',
            ),
            for (int i = 0; i < team.length; i++)
              _TaskRow(
                task: team[i],
                isFirst: i == 0,
                showDivider: i < team.length - 1,
              ),
          ],
        ],
      ),
    );
  }
}

class _TaskRow extends StatelessWidget {
  const _TaskRow({
    required this.task,
    required this.isFirst,
    required this.showDivider,
  });
  final AccidentTask task;
  final bool isFirst;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ({String label, TpStatus status}) sla = accidentTaskSla(l10n, task);
    final String? due = task.dueAt == null
        ? null
        : MaterialLocalizations.of(context).formatShortMonthDay(task.dueAt!);
    final String step =
        workstreamLabel(AccidentCopy.of(context), task.workstreamKey);
    return QueueListRow(
      key: AccidentMyTasksScreenKeys.row(task.workstreamId),
      icon: Icons.assignment_outlined,
      status: sla.status,
      title: task.referenceNo == null
          ? step
          : l10n.accidentTasksCase(TpDirection.isolateLtr(task.referenceNo!)),
      titleMaxLines: 2,
      time: due == null ? null : l10n.accidentTasksDue(due),
      tags: <Widget>[QueueStatusTag(label: sla.label, status: sla.status)],
      details: <String>[
        step,
        <String>[
          if (task.assetNo != null) TpDirection.isolateLtr(task.assetNo!),
          if (task.site != null) TpDirection.isolateLtr(task.site!),
        ].join(' • '),
        // Its own line: a Latin asset code in the same line would let the
        // bidi algorithm split "2 days" apart in Arabic.
        l10n.accidentTasksInStep(
          accidentTaskDaysLabel(l10n, task.daysInStep),
        ),
        if (!task.assignedToMe && task.ownerRole != null) task.ownerRole!,
      ],
      isFirst: isFirst,
      showDivider: showDivider,
      onTap: () => context.push(
        AccidentCaseRoute(accidentId: AccidentId(task.accidentId)).location,
      ),
    );
  }
}

/// SLA badge label + tone for one task. Mirrors the web slaStateLabel().
({String label, TpStatus status}) accidentTaskSla(
  AppLocalizations l10n,
  AccidentTask task,
) {
  if (task.overdue || task.slaState == 'breached') {
    return (label: l10n.accidentTasksOverdue, status: TpStatus.critical);
  }
  return switch (task.slaState) {
    'warning' => (label: l10n.accidentTasksDueSoon, status: TpStatus.warning),
    'running' || 'met' => (
        label: l10n.accidentTasksOnTime,
        status: TpStatus.ok
      ),
    _ => (label: l10n.accidentTasksNoTarget, status: TpStatus.unknown),
  };
}

/// "today" / "3.5 days".
String accidentTaskDaysLabel(AppLocalizations l10n, num? days) {
  if (days == null || days < 1) return l10n.accidentTasksToday;
  final num rounded = (days * 10).round() / 10;
  final String text = rounded == rounded.roundToDouble()
      ? rounded.toInt().toString()
      : rounded.toString();
  return l10n.accidentTasksDays(text);
}
