/// Submitted inspections (`InspectionSubmissionQueue`) on Profile's sync
/// queue: the read helpers, the merged list and the "Pending sync" count.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue_reads.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/profile/domain/combine_latest.dart';
import 'package:tyre_pulse/features/profile/profile_providers.dart';
import 'package:tyre_pulse/features/profile/sync_queue_providers.dart';

import '../../core/database/database_test_support.dart';

QueuedInspection _queued(
  String id, {
  String draftKey = 'user-1|TM514#submitted:x',
  String assetNo = 'TM514',
  String? createdBy,
  InspectionQueueStatus status = InspectionQueueStatus.pending,
  int attempts = 0,
  String? error,
  DateTime? createdAt,
}) {
  final DateTime at = createdAt ?? DateTime.utc(2026, 11, 20, 9);
  return QueuedInspection(
    id: id,
    draftKey: draftKey,
    createdAt: at,
    status: status,
    attempts: attempts,
    error: error,
    payload: InspectionPayload(
      title: 't',
      site: 'NHC',
      assetNo: assetNo,
      vehicleType: 'Tr-Mixer',
      inspector: 'Inspector',
      createdBy: createdBy,
      inspectionDate: at,
      scheduledDate: at,
      tyreConditions: const <String, TyrePositionReading>{},
    ),
  );
}

final class _Queue implements InspectionSubmissionQueue {
  _Queue(this.items);

  List<QueuedInspection> items;
  bool unreadable = false;

  @override
  Future<InspectionQueueReadResult> list() async => unreadable
      ? const InspectionQueueReadResult.unreadable()
      : InspectionQueueReadResult.ok(items);

  @override
  Future<int> pendingCount() async => pendingInspectionCount(items);

  @override
  Future<QueuedInspection?> byId(String id) async =>
      items.where((q) => q.id == id).firstOrNull;

  @override
  Future<void> enqueue(QueuedInspection item) async => items.add(item);

  @override
  Future<void> markFailed(String id, {required String error}) async {}

  @override
  Future<void> markSynced(String id, DateTime at) async {}

  @override
  Future<void> remove(String id) async => items.removeWhere((q) => q.id == id);
}

WorkspaceContext _workspace() {
  final WorkspaceProfile profile = WorkspaceProfile.fromRow(<String, Object?>{
    'id': 'user-1',
    'role': 'Manager',
    'org_id': 'org-1',
    'organisation_id': 'org-1',
    'approved': true,
    'locked': false,
  });
  return WorkspaceContext(
    userId: 'user-1',
    role: profile.role,
    effectivePermissions: AccessState(role: profile.role),
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: workspaceA,
    tenantId: workspaceA,
  );
}

void main() {
  group('readUserInspectionSubmissions', () {
    test("keeps only the signed-in person's submissions", () async {
      final _Queue queue = _Queue(<QueuedInspection>[
        _queued('mine-by-key'),
        _queued('mine-by-creator', draftKey: 'x', createdBy: 'user-1'),
        _queued('theirs', draftKey: 'user-2|TM600#submitted:y'),
      ]);
      final List<QueuedInspection> mine = await readUserInspectionSubmissions(
        queue,
        userId: 'user-1',
      );
      expect(
        mine.map((q) => q.id).toSet(),
        <String>{'mine-by-key', 'mine-by-creator'},
      );
    });

    test('an unreadable queue throws, never an empty list', () async {
      final _Queue queue = _Queue(<QueuedInspection>[_queued('a')])
        ..unreadable = true;
      await expectLater(
        readUserInspectionSubmissions(queue, userId: 'user-1'),
        throwsA(isA<StateError>()),
      );
    });

    test('pendingInspectionCount leaves synced entries out', () {
      expect(
        pendingInspectionCount(<QueuedInspection>[
          _queued('a'),
          _queued('b', status: InspectionQueueStatus.failed),
          _queued('c', status: InspectionQueueStatus.synced),
        ]),
        2,
      );
    });
  });

  test('a queued inspection becomes a sync queue entry', () {
    final SyncQueueEntry failed = SyncQueueEntry.fromInspection(
      _queued(
        'a',
        status: InspectionQueueStatus.failed,
        attempts: 3,
        error: 'No connection to the server.',
      ),
    );
    expect(failed.isInspection, isTrue);
    expect(failed.inspectionAsset, 'TM514');
    expect(failed.state, SyncQueueItemState.needsAttention);
    expect(failed.attempts, 3);
    expect(failed.lastError, 'No connection to the server.');
    expect(
      SyncQueueEntry.fromInspection(_queued('b')).state,
      SyncQueueItemState.waiting,
    );
    expect(
      SyncQueueEntry.fromInspection(
        _queued('c', status: InspectionQueueStatus.synced),
      ).state,
      SyncQueueItemState.sent,
    );
  });

  test('commands and inspections merge newest first', () async {
    final AppDatabase db = newMemoryDatabase();
    addTearDown(db.close);
    await seedCommand(db, id: 'cmd-1', now: DateTime.utc(2026, 11, 20, 10));
    final List<PendingCommand> rows = await db.queueDao.outstandingCommands();
    final List<SyncQueueEntry> merged = mergeSyncQueueEntries(
      rows,
      <QueuedInspection>[
        _queued('older', createdAt: DateTime.utc(2026, 11, 19)),
        _queued('newer', createdAt: DateTime.utc(2026, 11, 21)),
      ],
    );
    expect(
      merged.map((e) => e.id).toList(),
      <String>['newer', 'cmd-1', 'older'],
    );
  });

  test('combineLatestPair emits once both have values, forwards errors',
      () async {
    final List<Object> seen = <Object>[];
    await combineLatestPair<int, int, int>(
      Stream<int>.fromIterable(<int>[1, 2]),
      Stream<int>.value(10),
      (int a, int b) => a + b,
    ).forEach(seen.add);
    expect(seen.last, 12);

    await expectLater(
      combineLatestPair<int, int, int>(
        Stream<int>.value(1),
        Stream<int>.error(StateError('x')),
        (int a, int b) => a + b,
      ),
      emitsError(isA<StateError>()),
    );
  });

  group('Pending sync count and queue list', () {
    late AppDatabase db;
    late _Queue queue;
    late ProviderContainer container;

    setUp(() async {
      db = newMemoryDatabase();
      queue = _Queue(<QueuedInspection>[
        _queued('i-1'),
        _queued('i-2', status: InspectionQueueStatus.failed),
        _queued('i-3', status: InspectionQueueStatus.synced),
        _queued('other', draftKey: 'user-2|X#submitted:z'),
      ]);
      container = ProviderContainer(
        overrides: <Override>[
          workspaceContextProvider.overrideWithValue(_workspace()),
          appDatabaseProvider.overrideWithValue(db),
          inspectionSubmissionQueueProvider.overrideWithValue(queue),
        ],
      );
      await seedCommand(db, id: 'cmd-1');
    });

    tearDown(() async {
      container.dispose();
      await db.close();
    });

    test('Profile counts queued commands plus unsent inspections', () async {
      final ProviderSubscription<AsyncValue<int>> sub = container.listen(
        profilePendingSyncCountProvider,
        (_, __) {},
      );
      addTearDown(sub.close);
      expect(await container.read(profilePendingSyncCountProvider.future), 3);
    });

    test('Profile count is an error when the inspection queue is unreadable',
        () async {
      queue.unreadable = true;
      final ProviderSubscription<AsyncValue<int>> sub = container.listen(
        profilePendingSyncCountProvider,
        (_, __) {},
      );
      addTearDown(sub.close);
      await expectLater(
        container.read(profilePendingSyncCountProvider.future),
        throwsA(isA<StateError>()),
      );
    });

    test('the sync queue lists both queues for this person', () async {
      final ProviderSubscription<AsyncValue<List<SyncQueueEntry>>> sub =
          container.listen(syncQueueEntriesProvider, (_, __) {});
      addTearDown(sub.close);
      final List<SyncQueueEntry> entries =
          await container.read(syncQueueEntriesProvider.future);
      expect(
        entries.map((e) => e.id).toSet(),
        <String>{'cmd-1', 'i-1', 'i-2', 'i-3'},
      );
    });
  });
}
