/// The building blocks the "my work" screens share: the brand app bar with
/// the real sync state, the three-figure stat strip, the work row, the
/// checklist content-language selector, the approval-queue card and the
/// partial-load banner.
///
/// Every control here takes a real callback or is rendered disabled; nothing
/// is a dead press (AGENTS.md rule 7).
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
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_board.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_item.dart';

/// Which destinations this person may open. Built once by the screen from
/// the permission layer, so a row never offers an action the router refuses.
@immutable
final class MyWorkAccess {
  const MyWorkAccess({
    this.checklists = false,
    this.inspect = false,
    this.workOrders = false,
    this.approvals = false,
    this.reportIssue = false,
    this.history = false,
  });

  final bool checklists;
  final bool inspect;
  final bool workOrders;
  final bool approvals;
  final bool reportIssue;
  final bool history;
}

/// Reads the permission layer into the flags the rows need.
MyWorkAccess readMyWorkAccess(WidgetRef ref) {
  bool can(ModuleKey key) => ref.watch(canAccessModuleProvider(key));
  return MyWorkAccess(
    checklists: can(ModuleKey.checklists),
    inspect: can(ModuleKey.inspect),
    workOrders: can(ModuleKey.workorders),
    approvals: can(ModuleKey.approvals),
    reportIssue: can(ModuleKey.reportIssue),
    history: can(ModuleKey.history),
  );
}

AppError myWorkAppError(AppLocalizations l10n, Object error) {
  final Object cause = error is MyWorkLoadFailure ? error.cause : error;
  return switch (cause) {
    final AppError e => e,
    final SupabaseFailure f => f.error,
    _ => AppError(
        kind: AppErrorKind.unknown,
        message: l10n.myWorkLoadError,
        technical: cause.toString(),
        cause: cause,
        isRetryable: true,
      ),
  };
}

abstract final class MyWorkKeys {
  static Key item(String id) => ValueKey<String>('myWork.item.$id');
  static Key action(String id) => ValueKey<String>('myWork.action.$id');
  static const Key stats = ValueKey<String>('myWork.stats');
  static const Key partial = ValueKey<String>('myWork.partial');
  static const Key incomplete = ValueKey<String>('myWork.incomplete');
  static const Key language = ValueKey<String>('myWork.language');
  static Key languageOption(String code) =>
      ValueKey<String>('myWork.language.$code');
  static const Key approvals = ValueKey<String>('myWork.approvals');
  static const Key checklistApprovals =
      ValueKey<String>('myWork.approvals.checklists');
  static const Key inspectionApprovals =
      ValueKey<String>('myWork.approvals.inspections');
  static const Key sync = ValueKey<String>('myWork.sync');
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

String myWorkKindLabel(AppLocalizations l10n, MyWorkKind kind) =>
    switch (kind) {
      MyWorkKind.checklist => l10n.myWorkKindChecklist,
      MyWorkKind.draft => l10n.myWorkKindDraft,
      MyWorkKind.inspectionPlan => l10n.myWorkKindInspection,
      MyWorkKind.workOrder => l10n.myWorkKindWorkOrder,
      MyWorkKind.correctiveAction => l10n.myWorkKindCorrective,
    };

String myWorkStateLabel(AppLocalizations l10n, MyWorkState state) =>
    switch (state) {
      MyWorkState.overdue => l10n.myWorkStateOverdue,
      MyWorkState.inProgress => l10n.myWorkStateInProgress,
      MyWorkState.dueToday => l10n.myWorkStateDueToday,
      MyWorkState.upcoming => l10n.myWorkStateUpcoming,
      MyWorkState.completed => l10n.myWorkStateCompleted,
    };

TpStatus myWorkStateTone(MyWorkState state) => switch (state) {
      MyWorkState.overdue => TpStatus.critical,
      MyWorkState.inProgress => TpStatus.info,
      MyWorkState.dueToday => TpStatus.ok,
      MyWorkState.upcoming => TpStatus.neutral,
      MyWorkState.completed => TpStatus.ok,
    };

String myWorkSourceLabel(AppLocalizations l10n, MyWorkSource source) =>
    switch (source) {
      MyWorkSource.checklists => l10n.myWorkSourceChecklists,
      MyWorkSource.drafts => l10n.myWorkSourceDrafts,
      MyWorkSource.inspectionPlans => l10n.myWorkSourcePlans,
      MyWorkSource.workOrders => l10n.myWorkSourceWorkOrders,
      MyWorkSource.correctiveActions => l10n.myWorkSourceCorrective,
      MyWorkSource.checklistApprovals ||
      MyWorkSource.inspectionApprovals =>
        l10n.myWorkSourceApprovals,
    };

String myWorkLatenessLabel(AppLocalizations l10n, MyWorkLateness late) =>
    switch (late) {
      LateByMinutes(:final int minutes) => l10n.myWorkLateMinutes(minutes),
      LateByHours(:final int hours) => l10n.myWorkLateHours(hours),
      LateByDays(:final int days) => l10n.myWorkLateDays(days),
    };

String myWorkTitle(AppLocalizations l10n, MyWorkItem item) =>
    item.title ?? myWorkKindLabel(l10n, item.kind);

String myWorkTime(BuildContext context, DateTime at) =>
    MaterialLocalizations.of(context).formatTimeOfDay(
      TimeOfDay.fromDateTime(at),
      alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context),
    );

IconData myWorkIcon(MyWorkItem item) {
  switch (item.kind) {
    case MyWorkKind.inspectionPlan:
      return Icons.tire_repair_outlined;
    case MyWorkKind.workOrder:
      return Icons.build_outlined;
    case MyWorkKind.draft:
      return Icons.edit_note_rounded;
    case MyWorkKind.checklist:
    case MyWorkKind.correctiveAction:
      final String t = (item.title ?? '').toLowerCase();
      if (t.contains('wash')) return Icons.local_car_wash_outlined;
      if (t.contains('odometer') || t.contains('meter')) {
        return Icons.speed_outlined;
      }
      if (t.contains('tyre') || t.contains('tire')) {
        return Icons.tire_repair_outlined;
      }
      return item.kind == MyWorkKind.checklist
          ? Icons.assignment_outlined
          : Icons.task_alt_outlined;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/// What the row's button does, or null when this person cannot act on it
/// from here (no permission, or the source carries nothing to route with).
@immutable
final class MyWorkAction {
  const MyWorkAction({
    required this.label,
    required this.location,
    this.primary = true,
  });
  final String label;
  final String location;
  final bool primary;
}

MyWorkAction? myWorkActionFor(
  AppLocalizations l10n,
  MyWorkItem item,
  MyWorkAccess access,
) {
  switch (item.kind) {
    case MyWorkKind.checklist:
    case MyWorkKind.draft:
      final String? templateId = item.templateId;
      if (!access.checklists || templateId == null) return null;
      if (!item.isOpen) return null;
      return MyWorkAction(
        label: item.hasDraft ? l10n.myWorkResume : l10n.myWorkStart,
        primary: !item.hasDraft,
        location: ChecklistFillRoute(
          templateId: TemplateId(templateId),
          assignmentId: item.assignmentId == null
              ? null
              : AssignmentId(item.assignmentId!),
          assetNo: item.assetNo == null ? null : AssetNo(item.assetNo!),
          siteName: item.site == null ? null : SiteName(item.site!),
          draftKey: item.draftKey == null ? null : DraftKey(item.draftKey!),
        ).location,
      );
    case MyWorkKind.inspectionPlan:
      if (!access.inspect || !item.isOpen || item.assetNo == null) return null;
      return MyWorkAction(
        label: item.state == MyWorkState.inProgress
            ? l10n.myWorkResume
            : l10n.myWorkStartInspection,
        location: NewInspectionRoute(
          assetNo: AssetNo(item.assetNo!),
          siteName: item.site == null ? null : SiteName(item.site!),
        ).location,
      );
    case MyWorkKind.workOrder:
      final String? id = item.sourceId;
      if (!access.workOrders || id == null) return null;
      return MyWorkAction(
        label: l10n.myWorkView,
        primary: false,
        location: WorkOrderDetailRoute(workOrderId: WorkOrderId(id)).location,
      );
    case MyWorkKind.correctiveAction:
      return null;
  }
}

// ---------------------------------------------------------------------------
// App bar
// ---------------------------------------------------------------------------

/// Brand lockup, back when there is somewhere to go back to, and the REAL
/// sync state of the offline queue: "Synced" only once the queue was read
/// and is empty; a count otherwise; nothing while it is unknown.
PreferredSizeWidget myWorkAppBar(
  BuildContext context, {
  required AsyncValue<int> pendingSync,
  List<Widget> extra = const <Widget>[],
}) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final TpPalette palette = TpPalette.of(context);
  final bool canPop =
      GoRouter.maybeOf(context)?.canPop() ?? Navigator.of(context).canPop();
  return AppBar(
    automaticallyImplyLeading: false,
    backgroundColor: palette.surface,
    surfaceTintColor: Colors.transparent,
    titleSpacing: canPop ? 0 : TpSpace.lg,
    leading: canPop
        ? IconButton(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            // arrow_back_rounded mirrors itself in RTL (matchTextDirection);
            // choosing a different icon for RTL would flip it back.
            icon: const Icon(Icons.arrow_back_rounded),
            onPressed: () => Navigator.of(context).maybePop(),
          )
        : null,
    // The lockup is a logotype (WCAG 1.4.4 exempts it from text resize):
    // at large text sizes it scales down to the room the actions leave it
    // instead of overflowing the bar.
    title: const FittedBox(
      fit: BoxFit.scaleDown,
      alignment: AlignmentDirectional.centerStart,
      child: TpBrandLockup(compact: true),
    ),
    actions: <Widget>[
      switch (pendingSync) {
        AsyncData<int>(:final int value) => Padding(
            key: MyWorkKeys.sync,
            padding: const EdgeInsets.symmetric(horizontal: TpSpace.sm),
            child: Center(
              child: TpSyncLabel(
                label: value == 0
                    ? l10n.inspectionStatusSynced
                    : l10n.myWorkSyncPending(value),
                isPending: value > 0,
              ),
            ),
          ),
        _ => const SizedBox.shrink(),
      },
      ...extra,
      const SizedBox(width: TpSpace.sm),
    ],
  );
}

// ---------------------------------------------------------------------------
// Stat strip
// ---------------------------------------------------------------------------

/// The work order priority in the reader's language. The four catalogue
/// values are translated; anything else the server stores is shown as is,
/// never guessed into a band.
String myWorkPriorityLabel(AppLocalizations l10n, String raw) =>
    switch (raw.trim().toLowerCase()) {
      'low' => l10n.workOrderPriorityLow,
      'medium' => l10n.workOrderPriorityMedium,
      'high' => l10n.workOrderPriorityHigh,
      'critical' => l10n.workOrderPriorityCritical,
      _ => raw,
    };

@immutable
final class MyWorkStat {
  const MyWorkStat({
    required this.icon,
    required this.value,
    required this.label,
    required this.status,
  });
  final IconData icon;
  final int value;
  final String label;
  final TpStatus status;
}

class MyWorkStatStrip extends StatelessWidget {
  const MyWorkStatStrip({required this.stats, super.key});

  final List<MyWorkStat> stats;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      key: MyWorkKeys.stats,
      padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < stats.length; i++) ...<Widget>[
            if (i > 0) Container(width: 1, height: 52, color: palette.border),
            Expanded(child: _StatCell(stat: stats[i])),
          ],
        ],
      ),
    );
  }
}

class _StatCell extends StatelessWidget {
  const _StatCell({required this.stat});
  final MyWorkStat stat;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors c = palette.forStatus(stat.status);
    return Semantics(
      label: '${stat.value} ${stat.label}',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: TpSpace.sm),
        // On a narrow phone (360dp) a third of the card leaves the label
        // about 45dp beside the icon, which broke "Assigned" and "Overdue"
        // mid-word; below that width the icon sits above the figures.
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final bool stacked = constraints.maxWidth < 100;
            final Widget badge = Container(
              width: stacked ? 32 : 40,
              height: stacked ? 32 : 40,
              decoration: BoxDecoration(color: c.soft, shape: BoxShape.circle),
              child: Icon(
                stat.icon,
                color: c.base,
                size: stacked ? TpSizing.iconSm : TpSizing.iconMd,
              ),
            );
            final Widget figures = Column(
              crossAxisAlignment: stacked
                  ? CrossAxisAlignment.center
                  : CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  '${stat.value}',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: c.base,
                        fontWeight: FontWeight.w800,
                        height: 1,
                      ),
                ),
                const SizedBox(height: 2),
                Text(
                  stat.label,
                  maxLines: 2,
                  textAlign: stacked ? TextAlign.center : TextAlign.start,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: palette.textSecondary,
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ],
            );
            if (stacked) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  badge,
                  const SizedBox(height: TpSpace.xs),
                  figures,
                ],
              );
            }
            return Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                badge,
                const SizedBox(width: TpSpace.sm),
                Flexible(child: figures),
              ],
            );
          },
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// The work row
// ---------------------------------------------------------------------------

class MyWorkRow extends StatelessWidget {
  const MyWorkRow({
    required this.item,
    required this.now,
    required this.access,
    this.langs,
    this.expanded = false,
    this.onToggle,
    this.showDivider = true,
    super.key,
  });

  final MyWorkItem item;
  final DateTime now;
  final MyWorkAccess access;

  /// Content languages the item's checklist carries, when known.
  final Set<String>? langs;

  /// Corrective actions have no screen of their own; their row expands.
  final bool expanded;
  final VoidCallback? onToggle;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TpStatusColors tone = palette.forStatus(myWorkStateTone(item.state));
    final MyWorkAction? action = myWorkActionFor(l10n, item, access);
    final bool expandable =
        item.kind == MyWorkKind.correctiveAction && onToggle != null;
    final VoidCallback? onTap = action != null
        ? () => context.push(action.location)
        : (expandable ? onToggle : null);
    final String? reference = item.reference ?? item.assetNo;

    return Semantics(
      container: true,
      child: InkWell(
        key: MyWorkKeys.item(item.id),
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            border: showDivider
                ? Border(bottom: BorderSide(color: palette.border))
                : null,
          ),
          padding: const EdgeInsets.symmetric(vertical: TpSpace.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: tone.soft,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(myWorkIcon(item), color: tone.base, size: 24),
                  ),
                  const SizedBox(width: TpSpace.md),
                  Expanded(
                    flex: 5,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          myWorkTitle(l10n, item),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: text.titleSmall?.copyWith(
                            color: palette.text,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        if (reference != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: TpIdentifierText(
                              reference,
                              style: text.labelMedium?.copyWith(
                                color: palette.textSecondary,
                              ),
                            ),
                          ),
                        if (item.kind == MyWorkKind.workOrder &&
                            item.reference != null &&
                            item.assetNo != null)
                          Text(
                            item.assetNo!,
                            style: text.labelSmall
                                ?.copyWith(color: palette.textSecondary),
                          ),
                        if (item.site != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Row(
                              children: <Widget>[
                                Icon(
                                  Icons.location_on_outlined,
                                  size: TpSizing.iconSm,
                                  color: palette.textMuted,
                                ),
                                const SizedBox(width: 2),
                                Expanded(
                                  child: Text(
                                    item.site!,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: text.labelSmall?.copyWith(
                                      color: palette.textSecondary,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                  Container(
                    width: 1,
                    height: 52,
                    margin: const EdgeInsets.symmetric(horizontal: TpSpace.sm),
                    color: palette.border,
                  ),
                  Expanded(
                    flex: 4,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        _DueColumn(item: item, now: now, langs: langs),
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
                  if (onTap != null)
                    Icon(
                      expandable && expanded
                          ? Icons.keyboard_arrow_up_rounded
                          : Icons.chevron_right_rounded,
                      color: palette.primaryDark,
                    ),
                ],
              ),
              if (expandable && expanded) _Details(item: item),
            ],
          ),
        ),
      ),
    );
  }
}

class _DueColumn extends StatelessWidget {
  const _DueColumn({required this.item, required this.now, this.langs});

  final MyWorkItem item;
  final DateTime now;
  final Set<String>? langs;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final List<Widget> lines = <Widget>[];
    final MyWorkLateness? late = latenessOf(item, now);

    Widget big(String value, Color color) => Row(
          children: <Widget>[
            Icon(Icons.schedule_rounded, size: TpSizing.iconSm, color: color),
            const SizedBox(width: 4),
            Flexible(
              child: Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: text.titleSmall
                    ?.copyWith(color: color, fontWeight: FontWeight.w800),
              ),
            ),
          ],
        );
    TextStyle? small(Color c) =>
        text.labelSmall?.copyWith(color: c, fontWeight: FontWeight.w600);

    if (item.answered != null && item.total != null) {
      lines
        ..add(
          Text(
            l10n.myWorkAnswered(item.answered!, item.total!),
            style: small(palette.primaryDark),
          ),
        )
        ..add(Text(l10n.myWorkDraftSaved, style: small(palette.textSecondary)));
    } else if (late != null) {
      lines
        ..add(Text(l10n.myWorkOverdueBy, style: small(palette.critical.base)))
        ..add(big(myWorkLatenessLabel(l10n, late), palette.critical.base));
    } else if (item.state == MyWorkState.completed) {
      lines.add(Text(l10n.myWorkStateCompleted, style: small(palette.ok.base)));
    } else if (item.dueDay != null) {
      final bool today = item.dueDay == myWorkDay(now);
      lines.add(
        Text(
          today
              ? l10n.myWorkDueToday
              : l10n.myWorkDueOn(
                  MaterialLocalizations.of(context)
                      .formatShortDate(item.dueDay!),
                ),
          style: small(palette.textSecondary),
        ),
      );
      if (item.dueAt != null) {
        lines.add(big(myWorkTime(context, item.dueAt!), palette.ok.base));
      }
    } else {
      lines.add(Text(l10n.myWorkNoDueDate, style: small(palette.textMuted)));
    }
    if (item.kind == MyWorkKind.workOrder && item.priority != null) {
      lines.add(
        Text(
          '${l10n.myWorkPriority} ${myWorkPriorityLabel(l10n, item.priority!)}',
          style: small(palette.textSecondary),
        ),
      );
    }
    if (item.kind == MyWorkKind.inspectionPlan) {
      lines.add(
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: TpStatusChip(
            status: TpStatus.ok,
            label: l10n.myWorkTyreWorkflowTag,
            isCompact: true,
          ),
        ),
      );
    }
    final Set<String> other = <String>{...?langs}
      ..remove(kChecklistDefaultLang);
    if (other.isNotEmpty) {
      lines.add(
        Row(
          children: <Widget>[
            Icon(Icons.language_rounded, size: 12, color: palette.textMuted),
            const SizedBox(width: 2),
            Flexible(
              child: Text(
                orderedLangs(other)
                    .map((ChecklistLang l) => l.native)
                    .join(' '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: small(palette.textMuted),
              ),
            ),
          ],
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: lines,
    );
  }
}

class _Details extends StatelessWidget {
  const _Details({required this.item});
  final MyWorkItem item;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextStyle? style = Theme.of(context)
        .textTheme
        .bodySmall
        ?.copyWith(color: palette.textSecondary);
    return Padding(
      padding: const EdgeInsetsDirectional.only(start: 60, top: TpSpace.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (item.description != null) Text(item.description!, style: style),
          if (item.assignedTo != null)
            Text('${l10n.myWorkAssignedTo}: ${item.assignedTo}', style: style),
          if (item.status != null)
            Text('${l10n.myWorkStatus}: ${item.status}', style: style),
          if (item.priority != null)
            Text(
              '${l10n.myWorkPriority}: '
              '${myWorkPriorityLabel(l10n, item.priority!)}',
              style: style,
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

class MyWorkSectionHeader extends StatelessWidget {
  const MyWorkSectionHeader({
    required this.label,
    required this.tone,
    this.count,
    super.key,
  });

  final String label;
  final TpStatus tone;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color color = tone == TpStatus.neutral
        ? palette.primaryDark
        : palette.forStatus(tone).base;
    return Container(
      padding: const EdgeInsets.only(top: TpSpace.lg, bottom: TpSpace.xs),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: Text(
        count == null ? label : '$label  $count',
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: color,
              fontWeight: FontWeight.w800,
            ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Checklist content language
// ---------------------------------------------------------------------------

/// Offers only the languages the assigned checklists actually carry. Writes
/// the shared checklist-content preference, which seeds a newly opened sheet
/// (an existing draft keeps its own saved language).
class MyWorkLanguageSelector extends StatelessWidget {
  const MyWorkLanguageSelector({
    required this.available,
    required this.selected,
    required this.onSelected,
    super.key,
  });

  final Set<String> available;
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final List<ChecklistLang> langs =
        orderedLangs(<String>{kChecklistDefaultLang, ...available});
    return Column(
      key: MyWorkKeys.language,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Icon(
              Icons.language_rounded,
              size: TpSizing.iconSm,
              color: palette.textSecondary,
            ),
            const SizedBox(width: TpSpace.xs),
            Flexible(
              child: Text(
                l10n.myWorkContentLanguage,
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: palette.text,
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final ChecklistLang lang in langs)
              ChoiceChip(
                key: MyWorkKeys.languageOption(lang.code),
                label: Text(
                  lang.native,
                  textDirection:
                      lang.isRtl ? TextDirection.rtl : TextDirection.ltr,
                ),
                selected: normalizeLang(selected) == lang.code,
                onSelected: (_) => onSelected(lang.code),
              ),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Approval queues
// ---------------------------------------------------------------------------

class MyWorkApprovalQueues extends StatelessWidget {
  const MyWorkApprovalQueues({
    required this.checklists,
    required this.inspections,
    super.key,
  });

  /// Null when that queue could not be read.
  final MyWorkQueueCount? checklists;
  final MyWorkQueueCount? inspections;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpCard(
      key: MyWorkKeys.approvals,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            l10n.myWorkApprovalQueues,
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: _QueueTile(
                  key: MyWorkKeys.checklistApprovals,
                  icon: Icons.fact_check_outlined,
                  label: l10n.myWorkChecklistApprovals,
                  count: checklists,
                  onTap: () =>
                      context.push(const ChecklistApprovalsRoute().location),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: _QueueTile(
                  key: MyWorkKeys.inspectionApprovals,
                  icon: Icons.tire_repair_outlined,
                  label: l10n.myWorkInspectionApprovals,
                  count: inspections,
                  onTap: () =>
                      context.push(const InspectionApprovalsRoute().location),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _QueueTile extends StatelessWidget {
  const _QueueTile({
    required this.icon,
    required this.label,
    required this.count,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String label;
  final MyWorkQueueCount? count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final MyWorkQueueCount? c = count;
    final String value =
        c == null ? '?' : (c.capped ? '${c.count}+' : '${c.count}');
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(TpRadius.md),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
        child: Row(
          children: <Widget>[
            Icon(icon, color: palette.primaryDark),
            const SizedBox(width: TpSpace.xs),
            Expanded(
              child: Text(
                label,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelMedium,
              ),
            ),
            Text(
              value,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    color: palette.primaryDark,
                    fontWeight: FontWeight.w800,
                  ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              color: palette.primaryDark,
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Partial load
// ---------------------------------------------------------------------------

class MyWorkPartialBanner extends StatelessWidget {
  const MyWorkPartialBanner({
    required this.failed,
    required this.onRetry,
    this.incomplete = const <MyWorkSource>{},
    super.key,
  });

  /// Sources whose read failed.
  final Set<MyWorkSource> failed;

  /// Sources that loaded but hit their row ceiling, so work may be missing.
  final Set<MyWorkSource> incomplete;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    String names(Set<MyWorkSource> sources) => <String>{
          for (final MyWorkSource s in sources) myWorkSourceLabel(l10n, s),
        }.join(', ');
    final TextStyle? style = Theme.of(context)
        .textTheme
        .bodySmall
        ?.copyWith(color: palette.warning.onSoft);
    return TpCard(
      key: MyWorkKeys.partial,
      background: palette.warning.soft,
      borderColor: palette.warning.base,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        children: <Widget>[
          Icon(Icons.warning_amber_rounded, color: palette.warning.base),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                if (failed.isNotEmpty)
                  Text(l10n.myWorkPartial(names(failed)), style: style),
                if (incomplete.isNotEmpty)
                  Text(
                    l10n.myWorkFixIncomplete(names(incomplete)),
                    key: MyWorkKeys.incomplete,
                    style: style,
                  ),
              ],
            ),
          ),
          TextButton(onPressed: onRetry, child: Text(l10n.myWorkRetry)),
        ],
      ),
    );
  }
}
