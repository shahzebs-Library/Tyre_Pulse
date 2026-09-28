/// Loads everything assigned to the signed-in person, from the repositories
/// that already own each source. This file adds NO new table, RPC or query:
///
/// - checklist assignments + templates: `ChecklistRemoteRepository`
///   (`checklist_assignments`, `checklist_templates`), filtered to the role
///   exactly as the checklists hub filters them;
/// - checklist drafts: the Drift draft store on this device;
/// - inspection plans: `InspectionPlanRepository.myPlans` (this profile only);
/// - work orders: `WorkshopRepository.listMyJobs` (`wo_assignments` +
///   `work_orders.assigned_owner_id`);
/// - corrective actions: `TasksRepository.listRecent`;
/// - approval queue sizes: the checklist and inspection approval queues.
///
/// # One source failing is not the screen failing
///
/// Each source is read independently. A failed source is RECORDED in
/// [MyWorkSnapshot.failed] and the screen says which part could not be
/// checked - it never renders a failed read as "nothing assigned". Only when
/// every attempted source failed does the load throw, so the screen shows
/// its error state with Retry.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_plan.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_board.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_item.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';

enum MyWorkSource {
  checklists,
  drafts,
  inspectionPlans,
  workOrders,
  correctiveActions,
  checklistApprovals,
  inspectionApprovals,
}

/// Checklist assignments plus the templates they point at.
@immutable
final class MyWorkChecklistData {
  const MyWorkChecklistData({
    required this.assignments,
    this.templates = const <ChecklistTemplateRecord>[],
  });

  final List<ChecklistAssignmentRecord> assignments;
  final List<ChecklistTemplateRecord> templates;
}

/// A queue size. [capped] when the read was a bounded page that came back
/// full, so the true size may be larger and the screen shows `N+`.
@immutable
final class MyWorkQueueCount {
  const MyWorkQueueCount(this.count, {this.capped = false});

  final int count;
  final bool capped;
}

/// The real reads, one function per source. Screens never build this; the
/// provider does, and tests replace it.
@immutable
final class MyWorkGateway {
  const MyWorkGateway({
    this.checklists,
    this.drafts,
    this.inspectionPlans,
    this.workOrders,
    this.correctiveActions,
    this.checklistApprovals,
    this.inspectionApprovals,
  });

  final Future<MyWorkChecklistData> Function()? checklists;
  final Future<List<ChecklistDraftHeader>> Function()? drafts;
  final Future<List<InspectionPlan>> Function()? inspectionPlans;
  final Future<List<WorkshopJob>> Function()? workOrders;
  final Future<List<TaskItem>> Function()? correctiveActions;
  final Future<MyWorkQueueCount> Function()? checklistApprovals;
  final Future<MyWorkQueueCount> Function()? inspectionApprovals;
}

@immutable
final class MyWorkSnapshot {
  const MyWorkSnapshot({
    required this.items,
    required this.loadedAt,
    this.attempted = const <MyWorkSource>{},
    this.failed = const <MyWorkSource>{},
    this.templateLangs = const <String, Set<String>>{},
    this.checklistApprovals,
    this.inspectionApprovals,
  });

  final List<MyWorkItem> items;
  final DateTime loadedAt;
  final Set<MyWorkSource> attempted;
  final Set<MyWorkSource> failed;

  /// Template id -> checklist content languages that template carries.
  final Map<String, Set<String>> templateLangs;

  /// Null when the person cannot reach that queue, or its read failed
  /// (see [failed] to tell the two apart).
  final MyWorkQueueCount? checklistApprovals;
  final MyWorkQueueCount? inspectionApprovals;

  bool get partial => failed.isNotEmpty;

  /// Languages carried by the checklists in [items].
  Set<String> contentLanguagesFor(Iterable<MyWorkItem> items) {
    final Set<String> langs = <String>{};
    for (final MyWorkItem i in items) {
      final Set<String>? l = langsFor(i);
      if (l != null) langs.addAll(l);
    }
    return langs;
  }

  Set<String>? langsFor(MyWorkItem item) {
    final String? id = item.templateId;
    return id == null ? null : templateLangs[id];
  }
}

/// Thrown when every attempted source failed. Carries the first cause so the
/// error mapper can explain it (offline, permission, ...).
final class MyWorkLoadFailure implements Exception {
  const MyWorkLoadFailure(this.cause);
  final Object cause;

  @override
  String toString() => 'MyWorkLoadFailure($cause)';
}

Future<MyWorkSnapshot> loadMyWork(
  MyWorkGateway gateway, {
  required DateTime now,
}) async {
  final Set<MyWorkSource> attempted = <MyWorkSource>{};
  final Set<MyWorkSource> failed = <MyWorkSource>{};
  Object? firstError;

  Future<T?> read<T>(MyWorkSource source, Future<T> Function()? fn) async {
    if (fn == null) return null;
    attempted.add(source);
    try {
      return await fn();
    } on Object catch (error) {
      failed.add(source);
      firstError ??= error;
      return null;
    }
  }

  final List<Object?> results = await Future.wait<Object?>(<Future<Object?>>[
    read(MyWorkSource.checklists, gateway.checklists),
    read(MyWorkSource.drafts, gateway.drafts),
    read(MyWorkSource.inspectionPlans, gateway.inspectionPlans),
    read(MyWorkSource.workOrders, gateway.workOrders),
    read(MyWorkSource.correctiveActions, gateway.correctiveActions),
    read(MyWorkSource.checklistApprovals, gateway.checklistApprovals),
    read(MyWorkSource.inspectionApprovals, gateway.inspectionApprovals),
  ]);

  if (attempted.isNotEmpty && failed.length == attempted.length) {
    throw MyWorkLoadFailure(firstError ?? StateError('no source'));
  }

  final MyWorkChecklistData? checklists = results[0] as MyWorkChecklistData?;
  final Map<String, Set<String>> langs = <String, Set<String>>{
    for (final ChecklistTemplateRecord r
        in checklists?.templates ?? const <ChecklistTemplateRecord>[])
      if (r.template.id != null) r.template.id!: templateLanguages(r.template),
  };

  return MyWorkSnapshot(
    items: buildMyWork(
      now: now,
      assignments:
          checklists?.assignments ?? const <ChecklistAssignmentRecord>[],
      drafts: (results[1] as List<ChecklistDraftHeader>?) ??
          const <ChecklistDraftHeader>[],
      plans: (results[2] as List<InspectionPlan>?) ?? const <InspectionPlan>[],
      workOrders: (results[3] as List<WorkshopJob>?) ?? const <WorkshopJob>[],
      correctiveActions: (results[4] as List<TaskItem>?) ?? const <TaskItem>[],
    ),
    loadedAt: now,
    attempted: attempted,
    failed: failed,
    templateLangs: langs,
    checklistApprovals: results[5] as MyWorkQueueCount?,
    inspectionApprovals: results[6] as MyWorkQueueCount?,
  );
}
