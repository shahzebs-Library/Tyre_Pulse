library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';
import 'package:tyre_pulse/features/tasks/domain/task_board.dart';

const TaskItem _urgent = TaskItem(
  id: 'urgent',
  title: 'Breakdown',
  priority: 'High',
  status: 'Open',
);
const TaskItem _progress = TaskItem(
  id: 'progress',
  title: 'Hydraulic leak',
  priority: 'Medium',
  status: 'In Progress',
);
const TaskItem _upcoming = TaskItem(
  id: 'upcoming',
  title: 'Preventive maintenance',
  priority: 'Low',
  status: 'Open',
);
const TaskItem _closed = TaskItem(
  id: 'closed',
  title: 'Resolved fault',
  status: 'Closed',
);

void main() {
  test('the Today board is the live open queue from the verified source', () {
    expect(
      filterTasks(
        const <TaskItem>[_urgent, _progress, _upcoming, _closed],
        TaskBoardFilter.today,
      ).map((TaskItem item) => item.id),
      <String>['urgent', 'progress', 'upcoming'],
    );
  });

  test('status tabs never mix completed and in-progress records', () {
    const List<TaskItem> items = <TaskItem>[
      _urgent,
      _progress,
      _upcoming,
      _closed,
    ];
    expect(
      filterTasks(items, TaskBoardFilter.inProgress).single.id,
      'progress',
    );
    expect(filterTasks(items, TaskBoardFilter.completed).single.id, 'closed');
  });

  test('cards are grouped once, with urgent taking precedence', () {
    final Map<TaskBoardSection, List<TaskItem>> groups = groupTasks(
      const <TaskItem>[_urgent, _progress, _upcoming, _closed],
      now: DateTime.utc(2026, 8, 28),
    );
    expect(groups[TaskBoardSection.urgent]!.single.id, 'urgent');
    expect(groups[TaskBoardSection.inProgress]!.single.id, 'progress');
    expect(groups[TaskBoardSection.upcoming]!.single.id, 'upcoming');
    expect(groups[TaskBoardSection.completed]!.single.id, 'closed');
    expect(groups.values.expand((List<TaskItem> value) => value).length, 4);
  });

  test('an overdue low-priority task is still urgent', () {
    final TaskItem overdue = TaskItem(
      id: 'late',
      title: 'Late task',
      priority: 'Low',
      status: 'Open',
      dueDate: DateTime.utc(2026, 8, 27),
    );
    expect(isTaskUrgent(overdue, DateTime.utc(2026, 8, 28)), isTrue);
  });
}
