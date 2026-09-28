/// Pure mapping and arrangement of the "my work" list.
///
/// Everything here takes an explicit `now`, so it is deterministic in tests
/// and never reads the clock itself.
library;

import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_plan.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_item.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';
import 'package:tyre_pulse/features/tasks/domain/task_board.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';

DateTime myWorkDay(DateTime value) =>
    DateTime(value.year, value.month, value.day);

String? _clean(String? value) {
  final String text = value?.trim() ?? '';
  return text.isEmpty ? null : text;
}

/// Parses a `date` column value (`YYYY-MM-DD`) as a local day.
DateTime? parseMyWorkDay(String? raw) {
  final String? text = _clean(raw);
  if (text == null) return null;
  final DateTime? parsed = DateTime.tryParse(text);
  if (parsed == null) return null;
  return DateTime(parsed.year, parsed.month, parsed.day);
}

/// The state of an open item from its due day and, when real, due time.
MyWorkState stateForDue({
  required DateTime now,
  DateTime? dueDay,
  DateTime? dueAt,
  bool inProgress = false,
}) {
  final DateTime today = myWorkDay(now);
  if (dueAt != null && dueAt.isBefore(now)) return MyWorkState.overdue;
  if (dueDay != null && dueDay.isBefore(today)) return MyWorkState.overdue;
  if (inProgress) return MyWorkState.inProgress;
  if (dueDay != null && dueDay == today) return MyWorkState.dueToday;
  return MyWorkState.upcoming;
}

/// One `checklist_assignments` row. Skipped assignments are not work.
MyWorkItem? itemFromAssignment(
  ChecklistAssignmentRecord record, {
  required DateTime now,
}) {
  final String status = record.status?.trim().toLowerCase() ?? '';
  if (status == 'skipped') return null;
  final DateTime? day = parseMyWorkDay(record.dueDate);
  final MyWorkState state = status == 'completed'
      ? MyWorkState.completed
      : status == 'overdue'
          ? MyWorkState.overdue
          : stateForDue(now: now, dueDay: day);
  return MyWorkItem(
    id: 'checklist:${record.id}',
    kind: MyWorkKind.checklist,
    state: state,
    title: _clean(record.templateName),
    assetNo: _clean(record.assetNo),
    site: _clean(record.site),
    dueDay: day,
    status: record.status,
    templateId: _clean(record.templateId),
    assignmentId: record.id,
    sourceId: record.id,
  );
}

/// One on-device checklist draft with no open assignment behind it.
MyWorkItem itemFromDraft(ChecklistDraftHeader draft) => MyWorkItem(
      id: 'draft:${draft.draftKey}',
      kind: MyWorkKind.draft,
      state: MyWorkState.inProgress,
      title: _clean(draft.templateName) ?? _clean(draft.title),
      assetNo: _clean(draft.assetNo),
      site: _clean(draft.site),
      answered: draft.filled,
      total: draft.total,
      templateId: draft.templateId,
      draftKey: draft.draftKey,
      sourceId: draft.draftKey,
    );

/// `HH:MM` on [day], or null when the text is not a usable time.
DateTime? _timeOn(DateTime day, String? hhmm) {
  final String? text = _clean(hhmm);
  if (text == null) return null;
  final RegExpMatch? m = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(text);
  if (m == null) return null;
  final int h = int.parse(m.group(1)!);
  final int min = int.parse(m.group(2)!);
  if (h > 23 || min > 59) return null;
  return DateTime(day.year, day.month, day.day, h, min);
}

/// One inspection plan. Cancelled plans are not work.
MyWorkItem? itemFromPlan(InspectionPlan plan, {required DateTime now}) {
  if (plan.id.isEmpty) return null;
  if (plan.state == InspectionPlanState.cancelled) return null;
  final DateTime s = plan.scheduledDate;
  final DateTime day = DateTime(s.year, s.month, s.day);
  final DateTime? at = _timeOn(day, plan.inspectionTime);
  final MyWorkState state = switch (plan.state) {
    InspectionPlanState.done => MyWorkState.completed,
    InspectionPlanState.missed => MyWorkState.overdue,
    InspectionPlanState.started => MyWorkState.inProgress,
    InspectionPlanState.due => stateForDue(now: now, dueDay: day, dueAt: at),
    _ => stateForDue(now: now, dueDay: day, dueAt: at),
  };
  return MyWorkItem(
    id: 'plan:${plan.id}',
    kind: MyWorkKind.inspectionPlan,
    state: state,
    title: _clean(plan.inspectionType),
    assetNo: _clean(plan.assetNo),
    site: _clean(plan.site),
    dueDay: day,
    dueAt: at,
    priority: _clean(plan.priority),
    description: _clean(plan.notes),
    sourceId: plan.id,
  );
}

bool _inProgressStatus(String? raw) {
  final String s = (raw ?? '').trim().toLowerCase().replaceAll('_', ' ');
  return s == 'in progress' || s == 'started';
}

/// One open work order assigned to this person.
MyWorkItem itemFromWorkOrder(WorkshopJob job, {required DateTime now}) {
  final DateTime? parsed = DateTime.tryParse(job.targetCompletion ?? '');
  final DateTime? local = parsed?.toLocal();
  final DateTime? day = local == null ? null : myWorkDay(local);
  final bool hasTime = local != null && (local.hour != 0 || local.minute != 0);
  return MyWorkItem(
    id: 'wo:${job.id}',
    kind: MyWorkKind.workOrder,
    state: stateForDue(
      now: now,
      dueDay: day,
      dueAt: hasTime ? local : null,
      inProgress: _inProgressStatus(job.status),
    ),
    reference: _clean(job.workOrderNo),
    assetNo: _clean(job.assetNo),
    site: _clean(job.site),
    dueDay: day,
    dueAt: hasTime ? local : null,
    priority: _clean(job.priority),
    status: _clean(job.status),
    sourceId: job.id,
  );
}

/// One corrective action.
MyWorkItem itemFromCorrective(TaskItem task, {required DateTime now}) {
  final DateTime? local = task.dueDate?.toLocal();
  final DateTime? day = local == null ? null : myWorkDay(local);
  final bool hasTime = local != null && (local.hour != 0 || local.minute != 0);
  return MyWorkItem(
    id: 'ca:${task.id}',
    kind: MyWorkKind.correctiveAction,
    state: isTaskCompleted(task)
        ? MyWorkState.completed
        : stateForDue(
            now: now,
            dueDay: day,
            dueAt: hasTime ? local : null,
            inProgress: isTaskInProgress(task),
          ),
    title: task.title,
    assetNo: _clean(task.assetNo),
    site: _clean(task.site),
    dueDay: day,
    dueAt: hasTime ? local : null,
    priority: _clean(task.priority),
    status: _clean(task.status),
    description: _clean(task.description),
    assignedTo: _clean(task.assignedTo),
    sourceId: task.id,
  );
}

/// Builds the whole list. A draft that belongs to an open assignment is
/// folded INTO that assignment (same work, now in progress), never shown twice.
List<MyWorkItem> buildMyWork({
  required DateTime now,
  List<ChecklistAssignmentRecord> assignments =
      const <ChecklistAssignmentRecord>[],
  List<ChecklistDraftHeader> drafts = const <ChecklistDraftHeader>[],
  List<InspectionPlan> plans = const <InspectionPlan>[],
  List<WorkshopJob> workOrders = const <WorkshopJob>[],
  List<TaskItem> correctiveActions = const <TaskItem>[],
}) {
  final Map<String, ChecklistDraftHeader> draftByAssignment =
      <String, ChecklistDraftHeader>{};
  for (final ChecklistDraftHeader d in drafts) {
    final String? a = _clean(d.assignmentId);
    if (a == null) continue;
    final ChecklistDraftHeader? seen = draftByAssignment[a];
    if (seen == null || d.updatedAt.isAfter(seen.updatedAt)) {
      draftByAssignment[a] = d;
    }
  }
  final Set<String> usedDrafts = <String>{};
  final List<MyWorkItem> items = <MyWorkItem>[];
  for (final ChecklistAssignmentRecord record in assignments) {
    MyWorkItem? item = itemFromAssignment(record, now: now);
    if (item == null) continue;
    final ChecklistDraftHeader? draft = draftByAssignment[record.id];
    if (draft != null && item.isOpen) {
      usedDrafts.add(draft.draftKey);
      item = item.copyWith(
        state: item.state == MyWorkState.overdue
            ? MyWorkState.overdue
            : MyWorkState.inProgress,
        answered: draft.filled,
        total: draft.total,
        draftKey: draft.draftKey,
      );
    }
    items.add(item);
  }
  for (final ChecklistDraftHeader d in drafts) {
    if (usedDrafts.contains(d.draftKey)) continue;
    items.add(itemFromDraft(d));
  }
  for (final InspectionPlan p in plans) {
    final MyWorkItem? item = itemFromPlan(p, now: now);
    if (item != null) items.add(item);
  }
  for (final WorkshopJob j in workOrders) {
    items.add(itemFromWorkOrder(j, now: now));
  }
  for (final TaskItem t in correctiveActions) {
    items.add(itemFromCorrective(t, now: now));
  }
  items.sort(compareMyWork);
  return items;
}

/// Worst state first, then soonest, then id for a stable order.
int compareMyWork(MyWorkItem a, MyWorkItem b) {
  final int byState = a.state.index.compareTo(b.state.index);
  if (byState != 0) return byState;
  final DateTime? da = a.dueAt ?? a.dueDay;
  final DateTime? db = b.dueAt ?? b.dueDay;
  if (da != null && db != null) {
    final int byDate = da.compareTo(db);
    if (byDate != 0) return byDate;
  } else if (da != null) {
    return -1;
  } else if (db != null) {
    return 1;
  }
  return a.id.compareTo(b.id);
}

/// How late an overdue item is. Minutes and hours only when a real time
/// exists; otherwise whole days.
sealed class MyWorkLateness {
  const MyWorkLateness();
}

final class LateByMinutes extends MyWorkLateness {
  const LateByMinutes(this.minutes);
  final int minutes;
}

final class LateByHours extends MyWorkLateness {
  const LateByHours(this.hours);
  final int hours;
}

final class LateByDays extends MyWorkLateness {
  const LateByDays(this.days);
  final int days;
}

/// Null when the item is not overdue or no due information exists.
MyWorkLateness? latenessOf(MyWorkItem item, DateTime now) {
  if (item.state != MyWorkState.overdue) return null;
  final DateTime? at = item.dueAt;
  if (at != null && at.isBefore(now)) {
    final int minutes = now.difference(at).inMinutes;
    if (minutes < 60) return LateByMinutes(minutes < 1 ? 1 : minutes);
    if (minutes < 24 * 60) return LateByHours(minutes ~/ 60);
    return LateByDays(minutes ~/ (24 * 60));
  }
  final DateTime? day = item.dueDay;
  if (day == null) return null;
  final int days = myWorkDay(now).difference(day).inDays;
  return days <= 0 ? null : LateByDays(days);
}

/// The items that belong to [day]: due that day, plus - on today only -
/// every earlier item still open, because overdue work has not gone away.
List<MyWorkItem> itemsForDay(
  List<MyWorkItem> items, {
  required DateTime day,
  required DateTime now,
}) {
  final DateTime target = myWorkDay(day);
  final bool isToday = target == myWorkDay(now);
  return <MyWorkItem>[
    for (final MyWorkItem i in items)
      if ((i.dueDay != null && i.dueDay == target) ||
          (isToday && i.isOpen && i.state == MyWorkState.overdue) ||
          (isToday && i.dueDay == null && i.state == MyWorkState.inProgress))
        i,
  ]..sort((MyWorkItem a, MyWorkItem b) {
      final DateTime? ta = a.dueAt;
      final DateTime? tb = b.dueAt;
      if (ta != null && tb != null) return ta.compareTo(tb);
      if (ta != null) return -1;
      if (tb != null) return 1;
      return compareMyWork(a, b);
    });
}

/// Items with no due day, or due after today and within the next [days].
bool isLaterThisWeek(MyWorkItem item, DateTime now, {int days = 7}) {
  if (item.state != MyWorkState.upcoming) return false;
  final DateTime? d = item.dueDay;
  if (d == null) return false;
  final int diff = d.difference(myWorkDay(now)).inDays;
  return diff > 0 && diff <= days;
}

/// Case-insensitive free-text match over the visible fields.
bool myWorkMatches(MyWorkItem item, String query) {
  final String q = query.trim().toLowerCase();
  if (q.isEmpty) return true;
  for (final String? v in <String?>[
    item.title,
    item.reference,
    item.assetNo,
    item.site,
    item.status,
  ]) {
    if (v != null && v.toLowerCase().contains(q)) return true;
  }
  return false;
}

/// The checklist content languages a template ACTUALLY carries: English
/// always (it is the source), plus any language with at least one usable
/// translated field label. Offering a language no field carries would show
/// the operator an English sheet under an Arabic heading.
Set<String> templateLanguages(ChecklistTemplate template) {
  final Set<String> langs = <String>{kChecklistDefaultLang};
  for (final field in template.fields) {
    field.labels.forEach((String code, String label) {
      if (isChecklistLang(code) && label.trim().isNotEmpty) langs.add(code);
    });
  }
  return langs;
}

/// Languages in [langs] in the fixed display order of [kChecklistLangs].
List<ChecklistLang> orderedLangs(Set<String> langs) => <ChecklistLang>[
      for (final ChecklistLang l in kChecklistLangs)
        if (langs.contains(l.code)) l,
    ];

/// Sites named by [items], sorted, for the site filter.
List<String> sitesOf(Iterable<MyWorkItem> items) {
  final Set<String> sites = <String>{
    for (final MyWorkItem i in items)
      if (i.site != null) i.site!,
  };
  return sites.toList()..sort();
}
