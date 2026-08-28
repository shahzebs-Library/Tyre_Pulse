library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/tasks/presentation/tasks_screen.dart';

final Map<String, TpScreenBuilder> tasksScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.tasks: _buildTasksScreen,
};

Widget _buildTasksScreen(BuildContext context, TpRoute route) {
  if (route is! TasksRoute) return TpScreenNotAvailable(route: route);
  return TasksScreen(route: route);
}
