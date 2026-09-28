/// "My tasks" - everything assigned to the signed-in person, in one list.
///
/// Before this screen read only `corrective_actions`, so a checklist a
/// schedule generated for the person's role, an inspection plan with their
/// name on it, a checklist half-filled on this very phone and a work order
/// assigned to them all lived on other screens, and "My work" was not the
/// person's work. The list now comes from `myWorkSnapshotProvider`, which
/// reads each of those sources through the repository that already owns it.
///
/// Layout follows the owner's "My tasks" mock (header with Report an issue,
/// Assigned / In progress / Completed tabs with search and a type filter,
/// the Assigned / Due today / Overdue strip, then Overdue, In progress, Due
/// today, Work orders and a collapsed "Coming up" group, then "View my work
/// history"), plus the parts of the "My work" mock that have real data: the
/// checklist content-language selector and the approval-queue counts.
library;

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
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_board.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_item.dart';
import 'package:tyre_pulse/features/my_work/my_work_providers.dart';
import 'package:tyre_pulse/features/my_work/presentation/my_work_widgets.dart';

abstract final class TasksScreenKeys {
  static Key task(String id) => MyWorkKeys.item(id);
  static const Key board = ValueKey<String>('tasks.board');
  static const Key stats = MyWorkKeys.stats;
  static const Key reportIssue = ValueKey<String>('tasks.report-issue');
  static const Key todayTab = ValueKey<String>('tasks.tab.today');
  static const Key inProgressTab = ValueKey<String>('tasks.tab.in-progress');
  static const Key completedTab = ValueKey<String>('tasks.tab.completed');
  static const Key searchToggle = ValueKey<String>('tasks.search');
  static const Key searchField = ValueKey<String>('tasks.search-field');
  static const Key filter = ValueKey<String>('tasks.filter');
  static const Key comingUp = ValueKey<String>('tasks.coming-up');
  static const Key history = ValueKey<String>('tasks.history');
}

enum TasksTab { assigned, inProgress, completed }

class TasksScreen extends ConsumerStatefulWidget {
  const TasksScreen({required this.route, super.key});

  final TasksRoute route;

  @override
  ConsumerState<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends ConsumerState<TasksScreen> {
  TasksTab _tab = TasksTab.assigned;
  MyWorkKind? _kind;
  bool _searching = false;
  String _query = '';
  bool _showComingUp = false;
  final Set<String> _expanded = <String>{};

  Future<void> _refresh() async {
    ref
      ..invalidate(myWorkSnapshotProvider)
      ..invalidate(myWorkPendingSyncProvider);
    await ref.read(myWorkSnapshotProvider.future).catchError(
          (Object _) => MyWorkSnapshot(
            items: const <MyWorkItem>[],
            loadedAt: DateTime.now(),
          ),
        );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final AsyncValue<MyWorkSnapshot> state = ref.watch(myWorkSnapshotProvider);
    final MyWorkAccess access = readMyWorkAccess(ref);

    return TpScaffold(
      backFallback: fallback,
      appBar: myWorkAppBar(
        context,
        pendingSync: ref.watch(myWorkPendingSyncProvider),
      ),
      body: state.when(
        loading: () => const TpLoadingState(),
        error: (Object error, StackTrace _) => TpErrorState(
          error: myWorkAppError(l10n, error),
          onRetry: _refresh,
        ),
        data: (MyWorkSnapshot snapshot) =>
            _board(context, l10n, snapshot, access),
      ),
    );
  }

  Widget _board(
    BuildContext context,
    AppLocalizations l10n,
    MyWorkSnapshot snapshot,
    MyWorkAccess access,
  ) {
    final TpPalette palette = TpPalette.of(context);
    final DateTime now = ref.watch(myWorkClockProvider)();
    final List<MyWorkItem> all = snapshot.items;
    final List<MyWorkItem> open =
        all.where((MyWorkItem i) => i.isOpen).toList(growable: false);
    final List<MyWorkItem> shown = <MyWorkItem>[
      for (final MyWorkItem i in all)
        if ((_kind == null || _kindMatches(i, _kind!)) &&
            myWorkMatches(i, _query))
          i,
    ];
    final Set<String> langs = snapshot.contentLanguagesFor(open);

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        key: TasksScreenKeys.board,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.sm,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          _Header(access: access, now: now),
          const SizedBox(height: TpSpace.lg),
          _TabRow(
            selected: _tab,
            searching: _searching,
            kind: _kind,
            onTab: (TasksTab t) => setState(() => _tab = t),
            onSearch: () => setState(() {
              _searching = !_searching;
              if (!_searching) _query = '';
            }),
            onKind: (MyWorkKind? k) => setState(() => _kind = k),
          ),
          if (_searching) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            TpSearchField(
              key: TasksScreenKeys.searchField,
              hint: l10n.myWorkSearchHint,
              autofocus: true,
              onChanged: (String v) => setState(() => _query = v),
            ),
          ],
          const SizedBox(height: TpSpace.md),
          MyWorkStatStrip(
            stats: <MyWorkStat>[
              MyWorkStat(
                icon: Icons.assignment_outlined,
                value: open.length,
                label: l10n.myWorkStatAssigned,
                status: TpStatus.ok,
              ),
              MyWorkStat(
                icon: Icons.schedule_rounded,
                value: open
                    .where((MyWorkItem i) => i.state == MyWorkState.dueToday)
                    .length,
                label: l10n.myWorkStatDueToday,
                status: TpStatus.ok,
              ),
              MyWorkStat(
                icon: Icons.error_outline_rounded,
                value: open
                    .where((MyWorkItem i) => i.state == MyWorkState.overdue)
                    .length,
                label: l10n.myWorkStatOverdue,
                status: TpStatus.critical,
              ),
            ],
          ),
          if (snapshot.partial) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            MyWorkPartialBanner(failed: snapshot.failed, onRetry: _refresh),
          ],
          if (langs.length > 1) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            MyWorkLanguageSelector(
              available: langs,
              selected: ref.watch(checklistContentLanguageProvider),
              onSelected: (String code) => ref
                  .read(checklistContentLanguageProvider.notifier)
                  .select(code),
            ),
          ],
          ..._sections(context, l10n, snapshot, shown, now, access),
          if (access.approvals &&
              (snapshot.attempted
                  .contains(MyWorkSource.checklistApprovals))) ...<Widget>[
            const SizedBox(height: TpSpace.lg),
            MyWorkApprovalQueues(
              checklists: snapshot.checklistApprovals,
              inspections: snapshot.inspectionApprovals,
            ),
          ],
          if (access.checklists || access.history) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            TpCard(
              padding: EdgeInsets.zero,
              child: TpActionRow(
                key: TasksScreenKeys.history,
                icon: Icons.history_rounded,
                label: l10n.myWorkHistory,
                showDivider: false,
                trailing: Icon(
                  TpDirection.isRtl(context)
                      ? Icons.chevron_left_rounded
                      : Icons.chevron_right_rounded,
                  color: palette.primaryDark,
                ),
                onTap: () => context.push(
                  access.checklists
                      ? const ChecklistHistoryRoute().location
                      : const ActivityHistoryRoute().location,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  List<Widget> _sections(
    BuildContext context,
    AppLocalizations l10n,
    MyWorkSnapshot snapshot,
    List<MyWorkItem> shown,
    DateTime now,
    MyWorkAccess access,
  ) {
    Widget row(MyWorkItem i, {bool last = false}) => MyWorkRow(
          item: i,
          now: now,
          access: access,
          langs: snapshot.langsFor(i),
          showDivider: !last,
          expanded: _expanded.contains(i.id),
          onToggle: () => setState(() {
            if (!_expanded.add(i.id)) _expanded.remove(i.id);
          }),
        );

    List<Widget> group(String label, TpStatus tone, List<MyWorkItem> list) =>
        list.isEmpty
            ? const <Widget>[]
            : <Widget>[
                MyWorkSectionHeader(label: label, tone: tone),
                for (int n = 0; n < list.length; n++)
                  row(list[n], last: n == list.length - 1),
              ];

    Widget empty(String title, String body) => Padding(
          padding: const EdgeInsets.symmetric(vertical: TpSpace.xxl),
          child: TpEmptyState(
            icon: Icons.task_alt_rounded,
            title: title,
            message: body,
          ),
        );

    final bool filtered = _kind != null || _query.trim().isNotEmpty;

    switch (_tab) {
      case TasksTab.inProgress:
        final List<MyWorkItem> list = shown
            .where((MyWorkItem i) => i.state == MyWorkState.inProgress)
            .toList(growable: false);
        if (list.isEmpty) {
          return <Widget>[
            empty(
              filtered ? l10n.myWorkEmptyFiltered : l10n.myWorkEmptyTitle,
              l10n.myWorkEmptyBody,
            ),
          ];
        }
        return group(l10n.myWorkSectionInProgress, TpStatus.info, list);
      case TasksTab.completed:
        final List<MyWorkItem> list = shown
            .where((MyWorkItem i) => i.state == MyWorkState.completed)
            .toList(growable: false);
        if (list.isEmpty) {
          return <Widget>[
            empty(
              filtered ? l10n.myWorkEmptyFiltered : l10n.myWorkCompletedEmpty,
              l10n.myWorkEmptyBody,
            ),
          ];
        }
        return group(l10n.myWorkSectionCompleted, TpStatus.ok, list);
      case TasksTab.assigned:
        final List<MyWorkItem> open =
            shown.where((MyWorkItem i) => i.isOpen).toList(growable: false);
        if (open.isEmpty) {
          return <Widget>[
            empty(
              filtered ? l10n.myWorkEmptyFiltered : l10n.myWorkEmptyTitle,
              l10n.myWorkEmptyBody,
            ),
          ];
        }
        bool notWo(MyWorkItem i) => i.kind != MyWorkKind.workOrder;
        List<MyWorkItem> by(MyWorkState s) => open
            .where((MyWorkItem i) => notWo(i) && i.state == s)
            .toList(growable: false);
        final List<MyWorkItem> workOrders =
            open.where((MyWorkItem i) => !notWo(i)).toList(growable: false);
        final List<MyWorkItem> later = by(MyWorkState.upcoming);
        return <Widget>[
          ...group(
            l10n.myWorkSectionOverdue,
            TpStatus.critical,
            by(MyWorkState.overdue),
          ),
          ...group(
            l10n.myWorkSectionInProgress,
            TpStatus.info,
            by(MyWorkState.inProgress),
          ),
          ...group(
            l10n.myWorkSectionDueToday,
            TpStatus.neutral,
            by(MyWorkState.dueToday),
          ),
          ...group(l10n.myWorkSectionWorkOrders, TpStatus.neutral, workOrders),
          if (later.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            TpCard(
              padding: EdgeInsets.zero,
              child: TpActionRow(
                key: TasksScreenKeys.comingUp,
                icon: Icons.calendar_month_outlined,
                label: '${l10n.myWorkSectionComingUp}  ${later.length}',
                showDivider: false,
                trailing: Icon(
                  _showComingUp
                      ? Icons.keyboard_arrow_up_rounded
                      : Icons.keyboard_arrow_down_rounded,
                ),
                onTap: () => setState(() => _showComingUp = !_showComingUp),
              ),
            ),
            if (_showComingUp)
              for (int n = 0; n < later.length; n++)
                row(later[n], last: n == later.length - 1),
          ],
        ];
    }
  }
}

bool _kindMatches(MyWorkItem item, MyWorkKind kind) =>
    item.kind == kind ||
    (kind == MyWorkKind.checklist && item.kind == MyWorkKind.draft);

class _Header extends StatelessWidget {
  const _Header({required this.access, required this.now});

  final MyWorkAccess access;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                l10n.myWorkTasksTitle,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
              ),
              const SizedBox(height: TpSpace.xs),
              Text(
                MaterialLocalizations.of(context).formatMediumDate(now),
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: palette.textSecondary),
              ),
            ],
          ),
        ),
        if (access.reportIssue)
          TpButton(
            key: TasksScreenKeys.reportIssue,
            label: l10n.myWorkReportIssue,
            icon: Icons.report_problem_outlined,
            variant: TpButtonVariant.secondary,
            isCompact: true,
            onPressed: () => context.push(const ReportIssueRoute().location),
          ),
      ],
    );
  }
}

class _TabRow extends StatelessWidget {
  const _TabRow({
    required this.selected,
    required this.searching,
    required this.kind,
    required this.onTab,
    required this.onSearch,
    required this.onKind,
  });

  final TasksTab selected;
  final bool searching;
  final MyWorkKind? kind;
  final ValueChanged<TasksTab> onTab;
  final VoidCallback onSearch;
  final ValueChanged<MyWorkKind?> onKind;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    Widget tab(Key key, TasksTab value, String label) {
      final bool on = selected == value;
      return Expanded(
        child: InkWell(
          key: key,
          onTap: () => onTab(value),
          child: Container(
            constraints:
                const BoxConstraints(minHeight: TpSizing.minTouchTarget),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(
                  width: 3,
                  color: on ? palette.primaryDark : Colors.transparent,
                ),
              ),
            ),
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: on ? palette.primaryDark : palette.textSecondary,
                    fontWeight: on ? FontWeight.w800 : FontWeight.w600,
                  ),
            ),
          ),
        ),
      );
    }

    return Row(
      children: <Widget>[
        Expanded(
          child: DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(color: palette.border),
              borderRadius: BorderRadius.circular(TpRadius.md),
            ),
            child: Row(
              children: <Widget>[
                tab(
                  TasksScreenKeys.todayTab,
                  TasksTab.assigned,
                  l10n.myWorkTabAssigned,
                ),
                tab(
                  TasksScreenKeys.inProgressTab,
                  TasksTab.inProgress,
                  l10n.myWorkTabInProgress,
                ),
                tab(
                  TasksScreenKeys.completedTab,
                  TasksTab.completed,
                  l10n.myWorkTabCompleted,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: TpSpace.xs),
        IconButton.outlined(
          key: TasksScreenKeys.searchToggle,
          tooltip: l10n.myWorkSearchTooltip,
          isSelected: searching,
          onPressed: onSearch,
          icon: const Icon(Icons.search_rounded),
        ),
        PopupMenuButton<int>(
          key: TasksScreenKeys.filter,
          tooltip: l10n.myWorkFilterTooltip,
          initialValue: kind?.index ?? -1,
          onSelected: (int v) => onKind(v < 0 ? null : MyWorkKind.values[v]),
          icon: Badge(
            isLabelVisible: kind != null,
            smallSize: 8,
            child: const Icon(Icons.tune_rounded),
          ),
          itemBuilder: (BuildContext context) => <PopupMenuEntry<int>>[
            PopupMenuItem<int>(
              value: -1,
              child: Text(l10n.myWorkFilterAll),
            ),
            for (final MyWorkKind k in const <MyWorkKind>[
              MyWorkKind.checklist,
              MyWorkKind.inspectionPlan,
              MyWorkKind.workOrder,
              MyWorkKind.correctiveAction,
            ])
              PopupMenuItem<int>(
                value: k.index,
                child: Text(myWorkKindLabel(l10n, k)),
              ),
          ],
        ),
      ],
    );
  }
}
