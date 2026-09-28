/// "Today's field plan" - the signed-in person's day, as a timeline.
///
/// This used to list every scheduled inspection, PM program and corrective
/// action in the country: an organisation-wide calendar with the person's
/// name printed above it. The owner's mock is a PERSONAL plan, so the day is
/// now built from the same `myWorkSnapshotProvider` as "My tasks": the
/// checklists due for this person's role, their inspection plans, their
/// assigned work orders, their corrective actions and the checklist drafts
/// on this device.
///
/// Times are shown only where the source carries one (an inspection plan's
/// `inspection_time`, a timestamped due moment). A checklist assignment's
/// `due_date` is a day, so its row shows its state and no invented time.
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
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_board.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_item.dart';
import 'package:tyre_pulse/features/my_work/my_work_providers.dart';
import 'package:tyre_pulse/features/my_work/presentation/my_work_widgets.dart';

abstract final class CalendarScreenKeys {
  static Key day(int offset) => ValueKey<String>('fieldPlan.day.$offset');
  static Key item(String id) => ValueKey<String>('fieldPlan.item.$id');
  static const Key site = ValueKey<String>('fieldPlan.site');
  static const Key timeline = ValueKey<String>('fieldPlan.timeline');
}

class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({required this.route, super.key});
  final CalendarRoute route;

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  /// -1 yesterday, 0 today, 1 tomorrow.
  int _offset = 0;
  String? _site;

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
        data: (MyWorkSnapshot snapshot) => _plan(context, l10n, snapshot),
      ),
    );
  }

  Widget _plan(
    BuildContext context,
    AppLocalizations l10n,
    MyWorkSnapshot snapshot,
  ) {
    final TpPalette palette = TpPalette.of(context);
    final MaterialLocalizations ml = MaterialLocalizations.of(context);
    final DateTime now = ref.watch(myWorkClockProvider)();
    final DateTime today = myWorkDay(now);
    final DateTime day = today.add(Duration(days: _offset));
    final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
    final MyWorkAccess access = readMyWorkAccess(ref);

    final List<String> sites = sitesOf(snapshot.items);
    final String? site = sites.contains(_site) ? _site : null;
    final List<MyWorkItem> dayItems = <MyWorkItem>[
      for (final MyWorkItem i
          in itemsForDay(snapshot.items, day: day, now: now))
        if (site == null || i.site == site) i,
    ];
    final Set<String> langs = snapshot.contentLanguagesFor(dayItems);

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.sm,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          Text(
            l10n.myWorkFieldPlanTitle,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            ml.formatMediumDate(day),
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: palette.textSecondary),
          ),
          const SizedBox(height: TpSpace.md),
          Row(
            children: <Widget>[
              Icon(Icons.person_outline_rounded, color: palette.ok.base),
              const SizedBox(width: TpSpace.xs),
              Expanded(
                child: Text(
                  workspace?.fullName?.trim().isNotEmpty == true
                      ? workspace!.fullName!.trim()
                      : l10n.myWorkNotRecorded,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              if (sites.length > 1)
                DropdownButton<String?>(
                  key: CalendarScreenKeys.site,
                  value: site,
                  underline: const SizedBox.shrink(),
                  onChanged: (String? v) => setState(() => _site = v),
                  items: <DropdownMenuItem<String?>>[
                    DropdownMenuItem<String?>(
                      child: Text(l10n.myWorkAllSites),
                    ),
                    for (final String s in sites)
                      DropdownMenuItem<String?>(value: s, child: Text(s)),
                  ],
                ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          MyWorkStatStrip(
            stats: <MyWorkStat>[
              MyWorkStat(
                icon: Icons.description_outlined,
                value: dayItems.length,
                label: l10n.myWorkStatTasks,
                status: TpStatus.info,
              ),
              MyWorkStat(
                icon: Icons.verified_user_outlined,
                value: dayItems
                    .where((MyWorkItem i) => i.state == MyWorkState.completed)
                    .length,
                label: l10n.myWorkStatCompleted,
                status: TpStatus.ok,
              ),
              MyWorkStat(
                icon: Icons.warning_amber_rounded,
                value: dayItems
                    .where((MyWorkItem i) => i.state == MyWorkState.overdue)
                    .length,
                label: l10n.myWorkStatOverdue,
                status: TpStatus.critical,
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          _DayStrip(
            today: today,
            offset: _offset,
            onSelect: (int o) => setState(() => _offset = o),
          ),
          if (snapshot.partial) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            MyWorkPartialBanner(failed: snapshot.failed, onRetry: _refresh),
          ],
          const SizedBox(height: TpSpace.sm),
          if (dayItems.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: TpSpace.xxl),
              child: TpEmptyState(
                icon: Icons.event_available_outlined,
                title: l10n.myWorkDayEmpty,
                message: l10n.myWorkEmptyBody,
              ),
            )
          else
            Column(
              key: CalendarScreenKeys.timeline,
              children: <Widget>[
                for (int n = 0; n < dayItems.length; n++)
                  _TimelineRow(
                    item: dayItems[n],
                    now: now,
                    access: access,
                    langs: snapshot.langsFor(dayItems[n]),
                    isFirst: n == 0,
                    isLast: n == dayItems.length - 1,
                  ),
              ],
            ),
          if (langs.length > 1) ...<Widget>[
            const SizedBox(height: TpSpace.lg),
            MyWorkLanguageSelector(
              available: langs,
              selected: ref.watch(checklistContentLanguageProvider),
              onSelected: (String code) => ref
                  .read(checklistContentLanguageProvider.notifier)
                  .select(code),
            ),
          ],
          if (access.approvals &&
              snapshot.attempted
                  .contains(MyWorkSource.checklistApprovals)) ...<Widget>[
            const SizedBox(height: TpSpace.lg),
            MyWorkApprovalQueues(
              checklists: snapshot.checklistApprovals,
              inspections: snapshot.inspectionApprovals,
            ),
          ],
        ],
      ),
    );
  }
}

class _DayStrip extends StatelessWidget {
  const _DayStrip({
    required this.today,
    required this.offset,
    required this.onSelect,
  });

  final DateTime today;
  final int offset;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final MaterialLocalizations ml = MaterialLocalizations.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surfaceSunken,
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.xs),
        child: Row(
          children: <Widget>[
            for (final int o in const <int>[-1, 0, 1])
              Expanded(
                child: Semantics(
                  selected: o == offset,
                  button: true,
                  child: InkWell(
                    key: CalendarScreenKeys.day(o),
                    borderRadius: BorderRadius.circular(TpRadius.sm),
                    onTap: () => onSelect(o),
                    child: Container(
                      constraints: const BoxConstraints(
                        minHeight: TpSizing.minTouchTarget,
                      ),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: o == offset ? palette.primaryDark : null,
                        borderRadius: BorderRadius.circular(TpRadius.sm),
                      ),
                      child: Text(
                        ml.formatShortMonthDay(
                          today.add(Duration(days: o)),
                        ),
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                              color: o == offset
                                  ? palette.onPrimary
                                  : palette.text,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({
    required this.item,
    required this.now,
    required this.access,
    required this.isFirst,
    required this.isLast,
    this.langs,
  });

  final MyWorkItem item;
  final DateTime now;
  final MyWorkAccess access;
  final Set<String>? langs;
  final bool isFirst;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TpStatus tone = myWorkStateTone(item.state);
    final TpStatusColors c = palette.forStatus(tone);
    final MyWorkAction? action = myWorkActionFor(l10n, item, access);
    final MyWorkLateness? late = latenessOf(item, now);
    final IconData node = switch (item.state) {
      MyWorkState.completed => Icons.check_circle_rounded,
      MyWorkState.overdue => Icons.error_rounded,
      MyWorkState.inProgress => Icons.radio_button_checked_rounded,
      _ => Icons.radio_button_unchecked_rounded,
    };
    final Set<String> otherLangs = <String>{...?langs}
      ..remove(kChecklistDefaultLang);

    final List<Widget> detail = <Widget>[
      if (item.answered != null && item.total != null)
        Text(
          l10n.myWorkAnswered(item.answered!, item.total!),
          style: text.labelSmall?.copyWith(color: palette.primaryDark),
        ),
      if (late != null)
        Text(
          '${l10n.myWorkOverdueBy} ${myWorkLatenessLabel(l10n, late)}',
          style: text.labelSmall?.copyWith(color: palette.critical.base),
        ),
      if (otherLangs.isNotEmpty)
        Text(
          l10n.myWorkContentAvailable(
            orderedLangs(otherLangs)
                .map((ChecklistLang l) => l.native)
                .join(', '),
          ),
          style: text.labelSmall?.copyWith(color: palette.textMuted),
        ),
      if (item.kind == MyWorkKind.inspectionPlan)
        Text(
          l10n.myWorkTyreWorkflowTag,
          style: text.labelSmall?.copyWith(color: palette.textMuted),
        ),
    ];

    return IntrinsicHeight(
      key: CalendarScreenKeys.item(item.id),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          SizedBox(
            width: 28,
            child: Column(
              children: <Widget>[
                Container(
                  width: 2,
                  height: TpSpace.lg,
                  color: isFirst ? Colors.transparent : palette.border,
                ),
                Icon(node, color: c.base, size: TpSizing.iconLg),
                Expanded(
                  child: Container(
                    width: 2,
                    color: isLast ? Colors.transparent : palette.border,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          SizedBox(
            width: 76,
            child: Padding(
              padding: const EdgeInsets.only(top: TpSpace.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  if (item.dueAt != null)
                    Text(
                      myWorkTime(context, item.dueAt!),
                      style: text.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  const SizedBox(height: 2),
                  TpStatusChip(
                    status: tone,
                    label: myWorkStateLabel(l10n, item.state),
                    isCompact: true,
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: InkWell(
              onTap:
                  action == null ? null : () => context.push(action.location),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
                decoration: BoxDecoration(
                  border: isLast
                      ? null
                      : Border(bottom: BorderSide(color: palette.border)),
                ),
                child: Row(
                  children: <Widget>[
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: c.soft,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(myWorkIcon(item), color: c.base, size: 20),
                    ),
                    const SizedBox(width: TpSpace.sm),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            myWorkTitle(l10n, item),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: text.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                          if ((item.reference ?? item.assetNo) != null)
                            TpIdentifierText(
                              item.reference ?? item.assetNo!,
                              style: text.labelMedium
                                  ?.copyWith(color: palette.textSecondary),
                            ),
                          ...detail,
                          if (action != null) ...<Widget>[
                            const SizedBox(height: TpSpace.xs),
                            TpButton(
                              key: MyWorkKeys.action(item.id),
                              label: action.label,
                              isCompact: true,
                              variant: action.primary
                                  ? TpButtonVariant.primary
                                  : TpButtonVariant.secondary,
                              onPressed: () => context.push(action.location),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
