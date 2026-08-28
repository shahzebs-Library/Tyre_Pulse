library;

import 'package:tyre_pulse/features/tasks/data/task_item.dart';

enum TaskBoardFilter { today, inProgress, completed }

enum TaskBoardSection { urgent, inProgress, upcoming, completed }

String _normal(String? value) => value?.trim().toLowerCase() ?? '';

bool isTaskCompleted(TaskItem item) {
  final String status = _normal(item.status);
  return status == 'closed' || status == 'completed' || status == 'resolved';
}

bool isTaskInProgress(TaskItem item) {
  final String status = _normal(item.status).replaceAll('_', ' ');
  return status == 'in progress' || status == 'started';
}

bool isTaskUrgent(TaskItem item, DateTime now) {
  if (isTaskCompleted(item)) return false;
  final String priority = _normal(item.priority);
  final DateTime? due = item.dueDate;
  return priority == 'critical' ||
      priority == 'high' ||
      (due != null && due.isBefore(now));
}

List<TaskItem> filterTasks(
  List<TaskItem> items,
  TaskBoardFilter filter,
) {
  return switch (filter) {
    TaskBoardFilter.today => items
        .where((TaskItem item) => !isTaskCompleted(item))
        .toList(growable: false),
    TaskBoardFilter.inProgress => items
        .where(
          (TaskItem item) => !isTaskCompleted(item) && isTaskInProgress(item),
        )
        .toList(growable: false),
    TaskBoardFilter.completed =>
      items.where(isTaskCompleted).toList(growable: false),
  };
}

Map<TaskBoardSection, List<TaskItem>> groupTasks(
  List<TaskItem> items, {
  required DateTime now,
}) {
  final Map<TaskBoardSection, List<TaskItem>> grouped =
      <TaskBoardSection, List<TaskItem>>{
    for (final TaskBoardSection section in TaskBoardSection.values)
      section: <TaskItem>[],
  };
  for (final TaskItem item in items) {
    final TaskBoardSection section;
    if (isTaskCompleted(item)) {
      section = TaskBoardSection.completed;
    } else if (isTaskUrgent(item, now)) {
      section = TaskBoardSection.urgent;
    } else if (isTaskInProgress(item)) {
      section = TaskBoardSection.inProgress;
    } else {
      section = TaskBoardSection.upcoming;
    }
    grouped[section]!.add(item);
  }
  return grouped;
}
