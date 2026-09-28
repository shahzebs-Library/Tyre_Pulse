import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';

void main() {
  final DateTime now = DateTime(2026, 8, 28, 10);

  test('one failed source is recorded, the rest still load', () async {
    final MyWorkSnapshot snapshot = await loadMyWork(
      MyWorkGateway(
        checklists: () async => const MyWorkChecklistData(
          assignments: <ChecklistAssignmentRecord>[
            ChecklistAssignmentRecord(id: 'a', dueDate: '2026-08-28'),
          ],
        ),
        correctiveActions: () => Future<List<TaskItem>>.error(
          Exception('offline'),
        ),
        checklistApprovals: () async => const MyWorkQueueCount(2),
      ),
      now: now,
    );
    expect(snapshot.items, hasLength(1));
    expect(snapshot.failed, <MyWorkSource>{MyWorkSource.correctiveActions});
    expect(snapshot.partial, isTrue);
    expect(snapshot.checklistApprovals?.count, 2);
    expect(
      snapshot.attempted.contains(MyWorkSource.workOrders),
      isFalse,
      reason: 'a source the person cannot reach is never read',
    );
  });

  test('every attempted source failing throws, never an empty list', () {
    expect(
      loadMyWork(
        MyWorkGateway(
          correctiveActions: () =>
              Future<List<TaskItem>>.error(Exception('offline')),
        ),
        now: now,
      ),
      throwsA(isA<MyWorkLoadFailure>()),
    );
  });

  test('no reachable source is an honest empty snapshot', () async {
    final MyWorkSnapshot snapshot =
        await loadMyWork(const MyWorkGateway(), now: now);
    expect(snapshot.items, isEmpty);
    expect(snapshot.partial, isFalse);
  });
}
