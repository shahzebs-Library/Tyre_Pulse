/// Workshop notification landing: the actionable job-card board.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/features/work_orders/presentation/work_orders_list_screen.dart';

/// The production notification contract sends assignment, job, parts, QC and
/// workshop events to one board. Flutter's implemented job-card board is the
/// work-order list, so the Workshop route deliberately reuses that complete
/// surface instead of maintaining a second, drifting list.
class WorkshopScreen extends StatelessWidget {
  const WorkshopScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const WorkOrdersListScreen(route: WorkOrdersRoute());
  }
}
