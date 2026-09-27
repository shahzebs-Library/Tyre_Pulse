/// Coverage for [InspectionSyncEngine] - the commit-then-attempt ordering
/// that closes risk R2's actual gap ("a process kill between a slow
/// request and its catch block loses the submission with no trace"), and
/// the rule that a draft is discarded only once delivery is CONFIRMED,
/// never merely because a submit button was pressed.
///
/// Every collaborator is a hand-written fake implementing the feature's own
/// plain-Dart interfaces - no Supabase type, no mocktail - mirroring
/// `test/features/assets/data/vehicle_fleet_repository_test.dart`'s own
/// `_FakeVehicleFleetSource` precedent.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_draft_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_uploader.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_sync_engine.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_record.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class _FakeSubmissionQueue implements InspectionSubmissionQueue {
  final Map<String, QueuedInspection> _store = <String, QueuedInspection>{};
  final List<String> enqueueCalls = <String>[];

  @override
  Future<void> enqueue(QueuedInspection item) async {
    enqueueCalls.add(item.id);
    _store[item.id] = item;
  }

  @override
  Future<InspectionQueueReadResult> list() async =>
      InspectionQueueReadResult.ok(_store.values.toList(growable: false));

  @override
  Future<QueuedInspection?> byId(String id) async => _store[id];

  @override
  Future<void> markSynced(String id, DateTime at) async {
    final QueuedInspection? current = _store[id];
    if (current == null) return;
    _store[id] = current.copyWith(
      status: InspectionQueueStatus.synced,
      syncedAt: at,
      clearError: true,
    );
  }

  @override
  Future<void> markFailed(String id, {required String error}) async {
    final QueuedInspection? current = _store[id];
    if (current == null) return;
    _store[id] = current.copyWith(
      status: InspectionQueueStatus.failed,
      error: error,
      attempts: current.attempts + 1,
    );
  }

  @override
  Future<void> remove(String id) async => _store.remove(id);

  @override
  Future<int> pendingCount() async => _store.values
      .where((q) => q.status != InspectionQueueStatus.synced)
      .length;
}

class _FakeRemoteRepository implements InspectionRemoteRepository {
  /// Set to throw a specific object on the next [upsertInspection] call.
  Object? failWith;
  final List<String> upsertedClientUuids = <String>[];
  final List<InspectionPayload> upsertedPayloads = <InspectionPayload>[];

  @override
  Future<List<String>> listSites({String? country}) async => <String>[];

  @override
  Future<void> upsertInspection({
    required InspectionPayload payload,
    required String clientUuid,
  }) async {
    final Object? failure = failWith;
    if (failure != null) {
      throw failure; // ignore: only_throw_errors - deliberate arbitrary-error injection
    }
    upsertedClientUuids.add(clientUuid);
    upsertedPayloads.add(payload);
  }

  @override
  Future<InspectionRecord?> byId(String id) async => null;

  @override
  Future<List<InspectionRecord>> myInspections({
    required String createdBy,
    int limit = 100,
  }) async =>
      <InspectionRecord>[];
}

class _FakePhotoUploader implements InspectionPhotoUploader {
  bool shouldFail = false;
  final List<String> uploadedPaths = <String>[];

  @override
  Future<String> upload({
    required String localPath,
    required String inspectionId,
    required String position,
  }) async {
    if (shouldFail) {
      throw const SupabaseFailure(
        error: AppError(
          kind: AppErrorKind.storage,
          message: 'Could not upload the photo.',
        ),
        cause: SupabaseFailureCause.offline,
      );
    }
    uploadedPaths.add(localPath);
    return 'https://example.test/uploaded/$position.jpg';
  }
}

class _FakeDraftRepository implements InspectionDraftRepository {
  final Map<String, Map<String, TyrePositionReading>> readingsByDraft =
      <String, Map<String, TyrePositionReading>>{};
  final List<String> discardCalls = <String>[];
  final Map<String, List<String>> orphanedPathsByDraft =
      <String, List<String>>{};

  @override
  Future<void> saveHeader({
    required String userId,
    required String workspaceId,
    required String assetNo,
    required int filled,
    required int total,
    String? country,
    String? vehicleType,
    String? site,
    String? inspectorName,
    int? odometerKm,
    double? engineHours,
    String? findings,
  }) async {}

  final List<(String, String)> detachCalls = <(String, String)>[];

  @override
  Future<InspectionDraftHeader?> header(String draftKey) async => null;

  @override
  Future<List<String>> removePhotos(String draftKey, String position) async =>
      <String>[];

  @override
  Future<bool> detachForSubmission({
    required String fromKey,
    required String toKey,
  }) async {
    detachCalls.add((fromKey, toKey));
    if (readingsByDraft.containsKey(toKey)) return true;
    final Map<String, TyrePositionReading>? moved =
        readingsByDraft.remove(fromKey);
    if (moved == null) return false;
    readingsByDraft[toKey] = moved;
    return true;
  }

  @override
  Future<void> saveTyreReading(
    String draftKey,
    TyrePositionReading reading, {
    bool markChecked = true,
  }) async {
    final Map<String, TyrePositionReading> map = readingsByDraft.putIfAbsent(
      draftKey,
      () => <String, TyrePositionReading>{},
    );
    map[reading.position] = reading.copyWith(checked: true);
  }

  @override
  Future<Map<String, TyrePositionReading>> tyreReadings(
    String draftKey,
  ) async =>
      Map<String, TyrePositionReading>.of(
        readingsByDraft[draftKey] ?? <String, TyrePositionReading>{},
      );

  @override
  Future<Map<String, TyrePositionReading>> tyreReadingsWithPhotos(
    String draftKey,
  ) async =>
      tyreReadings(draftKey);

  @override
  Future<void> addPhoto({
    required String draftKey,
    required String position,
    required String localPath,
    required DateTime capturedAt,
    int? sizeBytes,
    String? mimeType,
  }) async {}

  @override
  Future<List<InspectionDraftPhoto>> photosFor(String draftKey) async =>
      <InspectionDraftPhoto>[];

  @override
  Future<InspectionDraftSignature?> signature(String draftKey) async => null;

  @override
  Future<void> saveSignature({
    required String draftKey,
    required String payload,
    required String source,
    String? strokesJson,
    String? signerUserId,
    String? signerName,
  }) async {}

  @override
  Future<List<InspectionDraftSummary>> draftsForUser(String userId) async =>
      <InspectionDraftSummary>[];

  @override
  Future<bool> hasContent(String draftKey) async =>
      readingsByDraft[draftKey]?.isNotEmpty ?? false;

  @override
  Future<List<String>> discardDraft(String draftKey) async {
    discardCalls.add(draftKey);
    return orphanedPathsByDraft[draftKey] ?? <String>[];
  }
}

// ---------------------------------------------------------------------------

InspectionPayload _payload({
  Map<String, TyrePositionReading> tyreConditions =
      const <String, TyrePositionReading>{},
}) {
  final DateTime now = DateTime.utc(2026, 8, 20, 9);
  return InspectionPayload(
    title: 't',
    site: 'NHC',
    assetNo: 'TM514',
    vehicleType: 'Tr-Mixer',
    inspector: 'user-1',
    inspectionDate: now,
    scheduledDate: now,
    tyreConditions: tyreConditions,
  );
}

void main() {
  late _FakeSubmissionQueue queue;
  late _FakeRemoteRepository remote;
  late _FakePhotoUploader uploader;
  late _FakeDraftRepository draftRepo;
  late InspectionSyncEngine engine;

  setUp(() {
    queue = _FakeSubmissionQueue();
    remote = _FakeRemoteRepository();
    uploader = _FakePhotoUploader();
    draftRepo = _FakeDraftRepository();
    engine = InspectionSyncEngine(
      draftRepository: draftRepo,
      queue: queue,
      remote: remote,
      photoUploader: uploader,
    );
  });

  group('submitNow - the commit-then-attempt order', () {
    test(
      'the item is durably enqueued BEFORE any delivery attempt - the '
      'queue write happens even if delivery has not been reached yet',
      () async {
        // A deliberately-failing remote makes this observable: even though
        // delivery never succeeds, the enqueue call is recorded first.
        // Thrown as a real SupabaseFailure so `error is SupabaseFailure`
        // short-circuits inside the engine and the outcome does not depend
        // on classifySupabaseError's dispatch for a bare AppError, which
        // this test has no need to assume anything about.
        remote.failWith = const SupabaseFailure(
          error: AppError.network(),
          cause: SupabaseFailureCause.offline,
        );
        await engine.submitNow(
          draftKey: 'draft-1',
          payload: _payload(),
          clientUuid: 'c-1',
        );
        expect(queue.enqueueCalls, isNotEmpty);
        expect(queue.enqueueCalls.first, 'c-1');
      },
    );

    test(
        'a successful delivery returns deliveredNow, marks the queue '
        'entry synced, removes it, and discards the draft', () async {
      final InspectionSubmitResult result = await engine.submitNow(
        draftKey: 'draft-1',
        payload: _payload(),
        clientUuid: 'c-1',
      );

      expect(result.outcome, InspectionSubmitOutcome.deliveredNow);
      expect(result.warning, isNull);
      expect(remote.upsertedClientUuids, <String>['c-1']);

      // Removed from the queue - a synced item does not linger.
      expect(await queue.byId('c-1'), isNull);

      // The draft is discarded ONLY on confirmed delivery.
      expect(draftRepo.discardCalls, <String>['draft-1#submitted:c-1']);
    });

    test(
        'a network failure queues the submission silently - no warning, '
        'and the draft is NOT discarded', () async {
      remote.failWith = const SupabaseFailure(
        error: AppError.network(),
        cause: SupabaseFailureCause.offline,
      );

      final InspectionSubmitResult result = await engine.submitNow(
        draftKey: 'draft-1',
        payload: _payload(),
        clientUuid: 'c-1',
      );

      expect(result.outcome, InspectionSubmitOutcome.queued);
      expect(result.warning, isNull);

      final QueuedInspection? stillQueued = await queue.byId('c-1');
      expect(stillQueued, isNotNull);
      expect(stillQueued!.status, InspectionQueueStatus.failed);

      // The work is not lost: the draft's rows are still there for the
      // next attempt to re-read.
      expect(draftRepo.discardCalls, isEmpty);
    });

    test(
        'a definitive, non-retryable server refusal queues WITH a '
        'warning the inspector should see', () async {
      remote.failWith = const SupabaseFailure(
        error: AppError.conflict(),
        // `cause` is never read by the engine (only `.error` is) - any
        // valid value is fine here; `serverRaise` is the closest semantic
        // match to "the server deliberately refused this".
        cause: SupabaseFailureCause.serverRaise,
      );

      final InspectionSubmitResult result = await engine.submitNow(
        draftKey: 'draft-1',
        payload: _payload(),
        clientUuid: 'c-1',
      );

      expect(result.outcome, InspectionSubmitOutcome.queuedWithWarning);
      expect(result.warning, isNotNull);
      expect(result.warning!.kind, AppErrorKind.conflict);
      expect(draftRepo.discardCalls, isEmpty);
    });

    test('submitNow never throws, whatever the remote does', () async {
      remote.failWith = StateError('completely unexpected');
      await expectLater(
        engine.submitNow(
          draftKey: 'draft-1',
          payload: _payload(),
          clientUuid: 'c-1',
        ),
        completes,
      );
    });
  });

  group('photo upload during delivery', () {
    test(
      'a position with a local-only photo is uploaded and the payload '
      'sent to the server carries the resulting URL, not the local path',
      () async {
        draftRepo.readingsByDraft['draft-1'] = <String, TyrePositionReading>{
          'LHF1': const TyrePositionReading(
            position: 'LHF1',
            photoLocalPath: '/tmp/lhf1.jpg',
            checked: true,
          ),
        };

        await engine.submitNow(
          draftKey: 'draft-1',
          payload: _payload(
            tyreConditions: <String, TyrePositionReading>{
              'LHF1': const TyrePositionReading(
                position: 'LHF1',
                photoLocalPath: '/tmp/lhf1.jpg',
                checked: true,
              ),
            },
          ),
          clientUuid: 'c-1',
        );

        expect(uploader.uploadedPaths, <String>['/tmp/lhf1.jpg']);
      },
    );

    test(
        'a failed photo upload retains the draft and queue until retry '
        'confirms evidence delivery', () async {
      uploader.shouldFail = true;
      draftRepo.readingsByDraft['draft-1'] = <String, TyrePositionReading>{
        'LHF1': const TyrePositionReading(
          position: 'LHF1',
          photoLocalPath: '/tmp/lhf1.jpg',
          checked: true,
        ),
      };

      final InspectionSubmitResult result = await engine.submitNow(
        draftKey: 'draft-1',
        payload: _payload(
          tyreConditions: <String, TyrePositionReading>{
            'LHF1': const TyrePositionReading(
              position: 'LHF1',
              photoLocalPath: '/tmp/lhf1.jpg',
              checked: true,
            ),
          },
        ),
        clientUuid: 'c-1',
      );

      expect(result.outcome, isNot(InspectionSubmitOutcome.deliveredNow));
      expect(draftRepo.discardCalls, isEmpty);
      expect(await queue.byId('c-1'), isNotNull);
      expect(remote.upsertedClientUuids, isEmpty);

      uploader.shouldFail = false;
      await engine.flushQueue();
      expect(draftRepo.discardCalls, <String>['draft-1#submitted:c-1']);
      expect(await queue.byId('c-1'), isNull);
    });

    test('a position that already has photoUrl is never re-uploaded', () async {
      draftRepo.readingsByDraft['draft-1'] = <String, TyrePositionReading>{
        'LHF1': const TyrePositionReading(
          position: 'LHF1',
          photoLocalPath: '/tmp/lhf1.jpg',
          photoUrl: 'https://example.test/already-uploaded.jpg',
          checked: true,
        ),
      };

      await engine.submitNow(
        draftKey: 'draft-1',
        payload: _payload(),
        clientUuid: 'c-1',
      );

      expect(uploader.uploadedPaths, isEmpty);
    });
  });

  group('P0-1: per-tyre notes survive delivery', () {
    test(
        'the delivered payload keeps each wheel\'s notes and readings from the '
        'queued snapshot; the draft (which has no notes column) only '
        'supplies the photo path', () async {
      draftRepo.readingsByDraft['draft-1'] = <String, TyrePositionReading>{
        // What the draft row really holds: no notes, a photo path folded in.
        'LHF1': const TyrePositionReading(
          position: 'LHF1',
          checked: true,
          photoLocalPath: '/tmp/lhf1.jpg',
        ),
      };

      await engine.submitNow(
        draftKey: 'draft-1',
        payload: _payload(
          tyreConditions: <String, TyrePositionReading>{
            'LHF1': const TyrePositionReading(
              position: 'LHF1',
              condition: TyreReadingCondition.worn,
              pressurePsi: 0,
              checked: true,
              notes: 'Sidewall bulge, inner edge',
            ),
          },
        ),
        clientUuid: 'c-1',
      );

      final TyrePositionReading sent =
          remote.upsertedPayloads.single.tyreConditions['LHF1']!;
      expect(sent.notes, 'Sidewall bulge, inner edge');
      expect(sent.condition, TyreReadingCondition.worn);
      expect(sent.pressurePsi, 0);
      expect(sent.photoUrl, 'https://example.test/uploaded/LHF1.jpg');
      expect(uploader.uploadedPaths, <String>['/tmp/lhf1.jpg']);
    });

    test(
        'mergeDraftPhotos never adds a wheel the snapshot did not submit '
        'and never replaces a permanent photo URL', () {
      final Map<String, TyrePositionReading> merged = mergeDraftPhotos(
        snapshot: <String, TyrePositionReading>{
          'LHF1': const TyrePositionReading(
            position: 'LHF1',
            notes: 'keep',
            photoUrl: 'https://x/lhf1.jpg',
          ),
          'RHF1': const TyrePositionReading(position: 'RHF1', notes: 'n'),
        },
        draft: <String, TyrePositionReading>{
          'LHF1': const TyrePositionReading(
            position: 'LHF1',
            photoLocalPath: '/tmp/a.jpg',
          ),
          'RHF1': const TyrePositionReading(
            position: 'RHF1',
            photoLocalPath: '/tmp/b.jpg',
          ),
          'LHR1': const TyrePositionReading(
            position: 'LHR1',
            photoLocalPath: '/tmp/c.jpg',
          ),
        },
      );
      expect(merged.keys, unorderedEquals(<String>['LHF1', 'RHF1']));
      expect(merged['LHF1']!.photoUrl, 'https://x/lhf1.jpg');
      expect(merged['LHF1']!.photoLocalPath, isNull);
      expect(merged['RHF1']!.photoLocalPath, '/tmp/b.jpg');
      expect(merged['RHF1']!.notes, 'n');
    });
  });

  group('P0-3: a submitted draft leaves the live key', () {
    test(
        'submitNow queues under the submitted key and moves the draft there '
        'before any delivery attempt', () async {
      remote.failWith = const SupabaseFailure(
        error: AppError.network(),
        cause: SupabaseFailureCause.offline,
      );
      draftRepo.readingsByDraft['user-1|TM514'] = <String, TyrePositionReading>{
        'LHF1': const TyrePositionReading(position: 'LHF1', checked: true),
      };

      await engine.submitNow(
        draftKey: 'user-1|TM514',
        payload: _payload(),
        clientUuid: 'c-9',
      );

      final QueuedInspection queued = (await queue.byId('c-9'))!;
      expect(queued.draftKey, 'user-1|TM514#submitted:c-9');
      expect(draftRepo.detachCalls, <(String, String)>[
        ('user-1|TM514', 'user-1|TM514#submitted:c-9'),
      ]);
      // The live key is now free for the next inspection of TM514.
      expect(draftRepo.readingsByDraft.containsKey('user-1|TM514'), isFalse);
    });

    test(
        'reconcile upgrades an entry an older build queued under the live '
        'key: the draft moves and the entry is rewritten', () async {
      draftRepo.readingsByDraft['user-1|TM514'] = <String, TyrePositionReading>{
        'LHF1': const TyrePositionReading(position: 'LHF1', checked: true),
      };
      await queue.enqueue(
        QueuedInspection(
          id: 'old-1',
          draftKey: 'user-1|TM514',
          payload: _payload(),
          createdAt: DateTime.utc(2026, 8, 20),
          status: InspectionQueueStatus.failed,
        ),
      );

      await engine.reconcileQueuedDrafts();

      expect(
        (await queue.byId('old-1'))!.draftKey,
        'user-1|TM514#submitted:old-1',
      );
      expect(
        draftRepo.readingsByDraft.keys,
        <String>['user-1|TM514#submitted:old-1'],
      );
      // Running it again changes nothing.
      await engine.reconcileQueuedDrafts();
      expect(
        (await queue.byId('old-1'))!.draftKey,
        'user-1|TM514#submitted:old-1',
      );
    });

    test(
        'reconcile completes a move a crash interrupted, from the live key '
        'the submitted key names', () async {
      draftRepo.readingsByDraft['user-1|TM514'] = <String, TyrePositionReading>{
        'LHF1': const TyrePositionReading(position: 'LHF1', checked: true),
      };
      await queue.enqueue(
        QueuedInspection(
          id: 'c-2',
          draftKey: 'user-1|TM514#submitted:c-2',
          payload: _payload(),
          createdAt: DateTime.utc(2026, 8, 20),
        ),
      );

      await engine.reconcileQueuedDrafts();

      expect(
        draftRepo.readingsByDraft.keys,
        <String>['user-1|TM514#submitted:c-2'],
      );
    });
  });

  group('flushQueue', () {
    test(
      'retries every non-synced entry and reports how many delivered',
      () async {
        await queue.enqueue(
          QueuedInspection(
            id: 'a',
            draftKey: 'draft-a',
            payload: _payload(),
            createdAt: DateTime.utc(2026, 8, 20),
          ),
        );
        await queue.enqueue(
          QueuedInspection(
            id: 'b',
            draftKey: 'draft-b',
            payload: _payload(),
            createdAt: DateTime.utc(2026, 8, 20),
            status: InspectionQueueStatus.synced,
            syncedAt: DateTime.utc(2026, 8, 20),
          ),
        );

        final InspectionFlushSummary summary = await engine.flushQueue();

        // Only the non-synced entry ('a') was attempted; 'b' was already
        // synced and is skipped.
        expect(summary.attempted, 1);
        expect(summary.delivered, 1);
        expect(summary.stillPending, 0);
      },
    );

    test(
        'an unreadable queue store refuses rather than guessing - '
        'reports nothing attempted, never "everything is fine"', () async {
      final _UnreadableQueue unreadable = _UnreadableQueue();
      final InspectionSyncEngine engineOverUnreadable = InspectionSyncEngine(
        draftRepository: draftRepo,
        queue: unreadable,
        remote: remote,
        photoUploader: uploader,
      );
      final InspectionFlushSummary summary =
          await engineOverUnreadable.flushQueue();
      expect(summary.attempted, 0);
      expect(summary.delivered, 0);
    });
  });
}

class _UnreadableQueue implements InspectionSubmissionQueue {
  @override
  Future<void> enqueue(QueuedInspection item) async {}

  @override
  Future<InspectionQueueReadResult> list() async =>
      const InspectionQueueReadResult.unreadable();

  @override
  Future<QueuedInspection?> byId(String id) async => null;

  @override
  Future<void> markSynced(String id, DateTime at) async {}

  @override
  Future<void> markFailed(String id, {required String error}) async {}

  @override
  Future<void> remove(String id) async {}

  @override
  Future<int> pendingCount() async => 0;
}
