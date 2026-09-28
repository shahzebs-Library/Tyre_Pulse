/// Riverpod wiring for "my work": which sources this person may read, and
/// the one snapshot every my-work screen renders.
///
/// A source the person cannot reach (by module permission) is not read at
/// all - so a Tyre Man is never shown a work-order count their role cannot
/// open, and a permission refusal is never mistaken for a failed read.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/approvals/checklist_approvals_providers.dart';
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/home/domain/home_work.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_plan_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_plan.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';
import 'package:tyre_pulse/features/tasks/data/tasks_repository.dart';
import 'package:tyre_pulse/features/tasks/tasks_providers.dart';
import 'package:tyre_pulse/features/workshop/workshop_providers.dart';

/// The approval queue read is a bounded page of this size.
const int kMyWorkChecklistApprovalPage = 200;

/// The clock. Overridden in tests so "today" and "overdue by" are fixed.
final Provider<DateTime Function()> myWorkClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);

final Provider<MyWorkGateway> myWorkGatewayProvider =
    Provider<MyWorkGateway>((ref) {
  final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
  if (workspace == null) return const MyWorkGateway();
  bool can(ModuleKey key) => ref.watch(canAccessModuleProvider(key));

  final String userId = workspace.userId;
  final String assignee = workspace.fullName?.trim() ?? '';
  final String? country = workspace.activeCountry;
  final String? role =
      workspace.role.rawValue.isEmpty ? null : workspace.role.rawValue;

  final bool checklists = can(ModuleKey.checklists);
  final bool inspect = can(ModuleKey.inspect);
  final bool workOrders = can(ModuleKey.workorders) || can(ModuleKey.workshop);
  final bool tasks = can(ModuleKey.tasks);
  final bool approvals = can(ModuleKey.approvals);

  return MyWorkGateway(
    checklists: !checklists
        ? null
        : () async {
            final remote = ref.read(checklistRemoteRepositoryProvider);
            final List<ChecklistAssignmentRecord> assignments =
                await remote.listAssignments(
              country: country,
              role: role,
              isSuperAdmin: workspace.isSuperAdmin,
            );
            final List<ChecklistTemplateRecord> templates =
                await remote.listTemplates(
              country: country,
              role: role,
              isSuperAdmin: workspace.isSuperAdmin,
            );
            return MyWorkChecklistData(
              assignments: assignments,
              templates: templates,
            );
          },
    drafts: !checklists || userId.isEmpty
        ? null
        : () => ref.read(checklistDraftRepositoryProvider).draftsForUser(
              userId,
            ),
    inspectionPlans: !inspect || userId.isEmpty
        ? null
        : () async {
            final InspectionPlanPage page =
                await ref.read(inspectionPlanRepositoryProvider).myPlans(
                      assignedTo: userId,
                      country: country,
                    );
            // Keep the RPC's row-ceiling signal: a capped country-wide page
            // may have dropped some of this person's plans, and the screen
            // must say so rather than show the page as the whole list.
            return MyWorkPage<InspectionPlan>(
              page.plans,
              truncated: page.truncated,
            );
          },
    workOrders: !workOrders || userId.isEmpty
        ? null
        : () => ref.read(workshopRepositoryProvider).listMyJobs(userId),
    // `corrective_actions.assigned_to` holds a NAME, not an id. With no name
    // on the profile nothing can be matched to this person, so the source is
    // not read at all rather than showing colleagues' actions as theirs.
    correctiveActions: !tasks || assignee.isEmpty
        ? null
        : () async {
            final List<TaskItem> items =
                await ref.read(tasksRepositoryProvider).listAssignedTo(
                      assignee: assignee,
                      country: country,
                    );
            return MyWorkPage<TaskItem>(
              items,
              truncated: items.length >= kTasksAssignedPage,
            );
          },
    checklistApprovals: !approvals
        ? null
        : () async {
            final int n = (await ref
                    .read(checklistApprovalRepositoryProvider)
                    .listPending(country: country))
                .length;
            return MyWorkQueueCount(
              n,
              capped: n >= kMyWorkChecklistApprovalPage,
            );
          },
    inspectionApprovals: !approvals
        ? null
        : () async {
            final HomePendingApprovals pending = await ref
                .read(homeRemoteRepositoryProvider)
                .pendingInspectionApprovals(country: country);
            return MyWorkQueueCount(pending.count);
          },
  );
});

/// The snapshot every my-work screen renders. Invalidate to refresh.
final FutureProvider<MyWorkSnapshot> myWorkSnapshotProvider =
    FutureProvider<MyWorkSnapshot>((ref) {
  return loadMyWork(
    ref.watch(myWorkGatewayProvider),
    now: ref.watch(myWorkClockProvider)(),
  );
});

/// Queued commands not yet delivered, for the "Synced" label. Reuses Home's
/// read of the one shared offline queue.
final FutureProvider<int> myWorkPendingSyncProvider = FutureProvider<int>(
  (ref) => ref.watch(homePendingSyncCountProvider.future),
);
