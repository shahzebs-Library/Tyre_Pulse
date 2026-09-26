/// Workshop route: the technician's "My Jobs" screen for field trades, the
/// actionable job-card board for everyone who supervises.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/work_orders/presentation/work_orders_list_screen.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_technician_screen.dart';

/// The roles that DO the work and therefore get the technician screen
/// (`mobile/app/(app)/workshop.tsx`, module label "My Jobs"): the trades
/// the `workshop` module grants by default, minus the managers.
const Set<RoleId> kWorkshopTechnicianRoles = <RoleId>{
  RoleId.tyreMan,
  RoleId.inspector,
  RoleId.mechanic,
  RoleId.electrician,
};

/// True when [workspace] belongs to a field trade that records its own
/// activity, rather than a supervisor who manages the board.
bool isWorkshopTechnician(WorkspaceContext? workspace) {
  final RoleId? role = workspace?.role.id;
  return role != null && kWorkshopTechnicianRoles.contains(role);
}

/// The production notification contract sends assignment, job, parts, QC and
/// workshop events to one route. A supervisor lands on the work-order board
/// (Flutter's implemented job-card board, reused rather than a second,
/// drifting list); a technician lands on their own job list with the
/// activity buttons, matching the mobile Workshop Live Control screen. The
/// technician screen deliberately has no link to the board: `workorders` is
/// an admin-only module on mobile, so a link would lead a technician to a
/// refusal.
class WorkshopScreen extends ConsumerWidget {
  const WorkshopScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (isWorkshopTechnician(ref.watch(workspaceContextProvider))) {
      return const WorkshopTechnicianScreen();
    }
    return const WorkOrdersListScreen(route: WorkOrdersRoute());
  }
}
