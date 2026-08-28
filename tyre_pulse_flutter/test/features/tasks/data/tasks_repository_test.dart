library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';
import 'package:tyre_pulse/features/tasks/data/tasks_repository.dart';

void main() {
  group('taskCountryFilter', () {
    test('does not narrow an unscoped or All workspace', () {
      expect(taskCountryFilter(null), isNull);
      expect(taskCountryFilter(''), isNull);
      expect(taskCountryFilter('  '), isNull);
      expect(taskCountryFilter('All'), isNull);
    });

    test('keeps country-null rows visible inside a country workspace', () {
      expect(taskCountryFilter('KSA'), 'country.eq.KSA,country.is.null');
    });
  });

  group('TaskItem.fromRow', () {
    test('decodes the verified corrective_actions projection', () {
      final TaskItem task = TaskItem.fromRow(<String, Object?>{
        'id': 'task-1',
        'title': 'Hydraulic leakage',
        'priority': 'High',
        'status': 'In Progress',
        'site': 'Qiddiya G2',
        'asset_no': 'MP2104',
        'description': 'Leak under pump deck',
        'assigned_to': 'Eng Vinay',
        'due_date': '2026-08-28T14:00:00.000Z',
        'created_at': '2026-08-28T10:00:00.000Z',
      });

      expect(task.id, 'task-1');
      expect(task.title, 'Hydraulic leakage');
      expect(task.priority, 'High');
      expect(task.status, 'In Progress');
      expect(task.site, 'Qiddiya G2');
      expect(task.assetNo, 'MP2104');
      expect(task.description, 'Leak under pump deck');
      expect(task.assignedTo, 'Eng Vinay');
      expect(task.dueDate, DateTime.utc(2026, 8, 28, 14));
      expect(task.createdAt, DateTime.utc(2026, 8, 28, 10));
    });

    test('trims optional text and rejects a missing identity', () {
      final TaskItem task = TaskItem.fromRow(<String, Object?>{
        'id': 'task-2',
        'title': 'Inspection follow-up',
        'site': '   ',
      });
      expect(task.site, isNull);
      expect(
        () => TaskItem.fromRow(<String, Object?>{'id': 'task-3'}),
        throwsFormatException,
      );
    });
  });
}
