import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_history_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_history_row.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_repository.dart';

import '../../../core/database/database_test_support.dart';

void main() {
  late AppDatabase db;
  setUp(() => db = newMemoryDatabase());
  tearDown(() => db.close());

  List<ChecklistHistoryRow> rows(int n) => <ChecklistHistoryRow>[
        for (var i = 0; i < n; i++) ChecklistHistoryRow(id: 'sub-$i'),
      ];

  test('keeps every completed row past 200 and carries the server total',
      () async {
    final repo = DefaultChecklistHistoryRepository(
      queueDao: db.queueDao,
      loadCompleted: (_) async => rows(437),
      loadCompletedCount: (_) async => 437,
    );
    final ChecklistHistory h =
        await repo.load(userId: testUser, workspaceId: workspaceA);
    expect(h.completed, hasLength(437));
    expect(h.completedTotal, 437);
  });

  test('a failed count reads as unknown, never as a guessed number', () async {
    final repo = DefaultChecklistHistoryRepository(
      queueDao: db.queueDao,
      loadCompleted: (_) async => rows(3),
      loadCompletedCount: (_) async => throw StateError('offline'),
    );
    final ChecklistHistory h =
        await repo.load(userId: testUser, workspaceId: workspaceA);
    expect(h.completed, hasLength(3));
    expect(h.completedTotal, isNull);
  });

  test('history pages never exceed the PostgREST response cap', () {
    expect(historyPageSize, lessThanOrEqualTo(1000));
    expect(historyMaxRows, greaterThan(200));
  });
}
